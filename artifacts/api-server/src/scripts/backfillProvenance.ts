// Backfill model provenance on existing reviews (CODE_AUDIT_REQUEST fix), as a
// BUNDLED dist entry so it runs in the deployed api-server image with no source
// tree and no pg-resolution risk (esbuild inlines pg + drizzle + schema).
//
// Run from the api-server Console (DATABASE_URL is already set there):
//   node dist/backfillProvenance.mjs            # dry run (report only, no writes)
//   APPLY=1 node dist/backfillProvenance.mjs    # write the labels-only update
//   VERIFY=1 node dist/backfillProvenance.mjs   # read-only verify vs passAudit
//
// Reviews written before commit d0381fd recorded the TRUE executed engine only in
// coverageLedger.passAudit[].model; the scalar passModel/adjudicatorModel were a
// Gemini default and selectedModel/passModels did not exist. This reads passAudit
// (the engine that actually answered) and rewrites the provenance fields to match.
// Labels-only: a per-row structural guard aborts the write if ANY key outside the
// allowed provenance set (any score, subscore, conditional, or promptHash) would
// change. Idempotent: re-derives from passAudit each run; fixed rows drop out.
import { db, reviewsTable, papersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const APPLY = process.env.APPLY === "1";
const VERIFY_ONLY = process.env.VERIFY === "1";

// The ONLY ledger keys this backfill may change.
const ALLOWED = new Set<string>([
  "selectedModel", "passModel", "passModels", "adjudicatorModel",
  "usesFlashForScientificScoring", "usesProOnlyForScientificScoring",
]);

function familyFromModelId(id: unknown): string | null {
  const s = String(id ?? "").toLowerCase();
  if (s.includes("gpt")) return "gpt";
  if (s.includes("glm")) return "glm";
  if (s.includes("gemini")) return "gemini";
  return null;
}
function changedKeys(a: Record<string, any>, b: Record<string, any>): string[] {
  const keys = new Set<string>([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  const changed: string[] = [];
  for (const k of keys) {
    if (JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k])) changed.push(k);
  }
  return changed;
}

async function main(): Promise<void> {
  const reviews = await db.select({
    id: reviewsTable.id,
    paperId: reviewsTable.paperId,
    score: reviewsTable.score,
    modelName: reviewsTable.modelName,
    coverageLedgerJson: reviewsTable.coverageLedgerJson,
  }).from(reviewsTable);
  const papers = await db.select({ id: papersTable.id, title: papersTable.title }).from(papersTable);
  const titleById = new Map(papers.map((p) => [p.id, p.title]));

  const mode = VERIFY_ONLY ? "verify" : APPLY ? "apply" : "dry-run";
  let fixed = 0, skipped = 0, aborted = 0, verifyPass = 0, verifyFail = 0;
  console.log(`\n[backfill-provenance] mode=${mode} reviews=${reviews.length}`);

  for (const review of reviews) {
    if (!review.coverageLedgerJson) continue;
    let ledger: Record<string, any>;
    try { ledger = JSON.parse(review.coverageLedgerJson); } catch { continue; }
    const passAudit: any[] = Array.isArray(ledger.passAudit) ? ledger.passAudit : [];
    const blindPasses = passAudit.filter((e) => typeof e?.role === "string" && /^blind_pass/.test(e.role));
    const adjEntry = passAudit.find((e) => e?.role === "adjudicator");
    const title = titleById.get(review.paperId) ?? review.paperId;

    const passModels: string[] = blindPasses.map((e) => e.model).filter(Boolean);
    const truePassModel: string | null = passModels[0] ?? null;
    const trueAdjModel: string | null = adjEntry?.model ?? truePassModel;
    const selectedModel = familyFromModelId(truePassModel ?? review.modelName ?? ledger.modelName) ?? "gemini";
    if (!truePassModel && !review.modelName) { skipped += 1; continue; }

    const resolvedPassModel = truePassModel ?? review.modelName!;
    const resolvedAdjModel = trueAdjModel ?? resolvedPassModel;
    const resolvedPassModels = passModels.length ? passModels : [resolvedPassModel];
    const usesFlash = /flash/i.test(`${resolvedPassModel} ${resolvedAdjModel}`);

    if (VERIFY_ONLY) {
      const ok =
        ledger.selectedModel === familyFromModelId(truePassModel ?? ledger.passModel) &&
        ledger.passModel === (truePassModel ?? ledger.passModel) &&
        ledger.adjudicatorModel === (trueAdjModel ?? ledger.adjudicatorModel) &&
        (selectedModel === "gemini" || /gpt|glm/i.test(String(ledger.passModel ?? "")));
      if (ok) verifyPass += 1; else verifyFail += 1;
      console.log(`  ${ok ? "✓" : "✗"} ${title} [${review.modelName}] sel=${ledger.selectedModel} pass=${ledger.passModel} adj=${ledger.adjudicatorModel} | audit pass=${truePassModel} adj=${trueAdjModel} | score=${review.score} promptHash=${ledger.promptHash}`);
      continue;
    }

    const matchesAlready =
      ledger.selectedModel === selectedModel &&
      ledger.passModel === resolvedPassModel &&
      ledger.adjudicatorModel === resolvedAdjModel &&
      JSON.stringify(ledger.passModels) === JSON.stringify(resolvedPassModels);
    if (matchesAlready) { skipped += 1; continue; }

    const newLedger = {
      ...ledger,
      selectedModel,
      passModel: resolvedPassModel,
      passModels: resolvedPassModels,
      adjudicatorModel: resolvedAdjModel,
      usesFlashForScientificScoring: usesFlash,
      usesProOnlyForScientificScoring: !usesFlash,
    };

    // LABELS-ONLY GUARD: only provenance keys may differ. Any other change
    // (a score, a subscore, the prompt hash) aborts this row.
    const diff = changedKeys(ledger, newLedger);
    const illegal = diff.filter((k) => !ALLOWED.has(k));
    if (illegal.length) {
      aborted += 1;
      console.log(`  ✗ ABORT ${title}: illegal key change: ${illegal.join(", ")}`);
      continue;
    }

    console.log(`  • ${title} [${review.modelName}] sel=${selectedModel}`);
    console.log(`      passModel: ${ledger.passModel ?? "—"} -> ${resolvedPassModel}`);
    console.log(`      adjudicatorModel: ${ledger.adjudicatorModel ?? "—"} -> ${resolvedAdjModel}`);
    console.log(`      passModels: ${JSON.stringify(resolvedPassModels)} | changed keys: ${JSON.stringify(diff)}`);
    console.log(`      score (unchanged): ${review.score} | promptHash (unchanged): ${ledger.promptHash} | written: ${APPLY}`);

    if (APPLY) {
      await db.update(reviewsTable)
        .set({ coverageLedgerJson: JSON.stringify(newLedger) })
        .where(eq(reviewsTable.id, review.id));
    }
    fixed += 1;
  }

  console.log(`\n[backfill-provenance] fixed=${fixed} skipped=${skipped} aborted=${aborted}` +
    (mode === "verify" ? ` verifyPass=${verifyPass} verifyFail=${verifyFail}` : ""));
  if (aborted) { console.error("ABORTED rows present — a non-provenance key would have changed. Nothing unsafe was written."); process.exit(2); }
  if (mode === "verify" && verifyFail) process.exit(1);
  console.log(mode === "dry-run" ? "Dry run only — re-run with APPLY=1 to write." : "Done.");
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
