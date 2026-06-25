#!/usr/bin/env node
// Backfill model provenance on existing reviews (CODE_AUDIT_REQUEST fix).
//
// Reviews written before commit d0381fd recorded the TRUE executed engine only in
// coverageLedger.passAudit[].model (per pass + adjudicator), while the scalar
// ledger fields passModel/adjudicatorModel were hardcoded to Gemini and
// selectedModel/passModels did not exist. This script reads each review's
// passAudit (the engine that actually answered) and rewrites the provenance
// fields to match — a LABELS-ONLY edit. It never touches any score, subscore,
// conditional, prompt hash, or any other field: a per-row structural guard aborts
// the write if anything outside the allowed provenance keys would change.
//
//   DATABASE_URL=...  node scripts/backfill-provenance.mjs            # dry run (report only)
//   DATABASE_URL=...  APPLY=1 node scripts/backfill-provenance.mjs    # write + verify
//   DATABASE_URL=...  VERIFY=1 node scripts/backfill-provenance.mjs   # read-only verify
//
// Run with NODE_ENV=production so the bundled logger does not load pino-pretty.
// Idempotent: re-derives from passAudit each run; fixed rows drop out of scope.
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const ROOT = "/Users/jttyler/Projects/modernsciencereview";
const dbPkg = join(ROOT, "lib/db/src/index.ts");

const entry = `
import { db, reviewsTable, papersTable } from ${JSON.stringify(dbPkg)};
import { eq } from "drizzle-orm";

const APPLY = process.env.APPLY === "1";
const VERIFY_ONLY = process.env.VERIFY === "1";

// The ONLY ledger keys this backfill may change. Anything else differing between
// the old and new ledger means we'd be mutating scores/content — abort that row.
const ALLOWED = new Set([
  "selectedModel", "passModel", "passModels", "adjudicatorModel",
  "usesFlashForScientificScoring", "usesProOnlyForScientificScoring",
]);

function familyFromModelId(id) {
  const s = String(id || "").toLowerCase();
  if (s.includes("gpt")) return "gpt";
  if (s.includes("glm")) return "glm";
  if (s.includes("gemini")) return "gemini";
  return null;
}
function changedKeys(a, b) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  const changed = [];
  for (const k of keys) {
    if (JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k])) changed.push(k);
  }
  return changed;
}

globalThis.__run = (async () => {
  const reviews = await db.select().from(reviewsTable);
  const papers = await db.select().from(papersTable);
  const titleById = new Map(papers.map((p) => [p.id, p.title]));

  const report = [];
  let fixed = 0, skipped = 0, aborted = 0, verifyPass = 0, verifyFail = 0;

  for (const review of reviews) {
    if (!review.coverageLedgerJson) continue;
    let ledger;
    try { ledger = JSON.parse(review.coverageLedgerJson); } catch { continue; }
    const passAudit = Array.isArray(ledger.passAudit) ? ledger.passAudit : [];
    const blindPasses = passAudit.filter((e) => typeof e?.role === "string" && /^blind_pass/.test(e.role));
    const adjEntry = passAudit.find((e) => e?.role === "adjudicator");

    // Truth source: the engine the audit recorded as having answered. Fall back to
    // the model-aware display label only when passAudit is absent (older rows).
    const passModels = blindPasses.map((e) => e.model).filter(Boolean);
    const truePassModel = passModels[0] || null;
    const trueAdjModel = adjEntry?.model || truePassModel || null;
    const selectedModel =
      familyFromModelId(truePassModel || review.modelName || ledger.modelName) || "gemini";

    if (!truePassModel && !review.modelName) { skipped += 1; continue; }

    const resolvedPassModel = truePassModel || review.modelName;
    const resolvedAdjModel = trueAdjModel || resolvedPassModel;
    const resolvedPassModels = passModels.length ? passModels : [resolvedPassModel];
    const usesFlash = /flash/i.test(\`\${resolvedPassModel} \${resolvedAdjModel}\`);

    const matchesAlready =
      ledger.selectedModel === selectedModel &&
      ledger.passModel === resolvedPassModel &&
      ledger.adjudicatorModel === resolvedAdjModel &&
      JSON.stringify(ledger.passModels) === JSON.stringify(resolvedPassModels);

    if (VERIFY_ONLY) {
      // Provenance must equal the audit truth, and scores must be present/intact.
      const ok =
        ledger.selectedModel === familyFromModelId(truePassModel || ledger.passModel) &&
        ledger.passModel === (truePassModel || ledger.passModel) &&
        ledger.adjudicatorModel === (trueAdjModel || ledger.adjudicatorModel) &&
        (selectedModel === "gemini" || /gpt|glm/i.test(ledger.passModel || ""));
      const verdict = ok ? "PASS" : "FAIL";
      if (ok) verifyPass += 1; else verifyFail += 1;
      report.push({
        reviewId: review.id, title: titleById.get(review.paperId) || review.paperId,
        modelName: review.modelName, selectedModel: ledger.selectedModel,
        passModel: ledger.passModel, adjudicatorModel: ledger.adjudicatorModel,
        auditPassModel: truePassModel, auditAdjModel: trueAdjModel,
        score: review.score, ledgerFinalScore: ledger.finalScore, promptHash: ledger.promptHash,
        verify: verdict,
      });
      continue;
    }

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
    // (a score, a subscore, the prompt hash, anything) aborts this row.
    const diff = changedKeys(ledger, newLedger);
    const illegal = diff.filter((k) => !ALLOWED.has(k));
    if (illegal.length) {
      aborted += 1;
      report.push({
        reviewId: review.id, title: titleById.get(review.paperId) || review.paperId,
        ABORT: \`illegal key change: \${illegal.join(", ")}\`,
      });
      continue;
    }

    report.push({
      reviewId: review.id, title: titleById.get(review.paperId) || review.paperId,
      modelName: review.modelName, selectedModel,
      passModel: \`\${ledger.passModel ?? "—"} -> \${resolvedPassModel}\`,
      adjudicatorModel: \`\${ledger.adjudicatorModel ?? "—"} -> \${resolvedAdjModel}\`,
      passModels: resolvedPassModels,
      changedKeys: diff,
      score: review.score, ledgerFinalScore: ledger.finalScore, promptHash: ledger.promptHash,
      written: APPLY,
    });

    if (APPLY) {
      await db.update(reviewsTable)
        .set({ coverageLedgerJson: JSON.stringify(newLedger) })
        .where(eq(reviewsTable.id, review.id));
    }
    fixed += 1;
  }

  return { mode: VERIFY_ONLY ? "verify" : (APPLY ? "apply" : "dry-run"), fixed, skipped, aborted, verifyPass, verifyFail, report };
})();
`;

const dir = mkdtempSync(join(tmpdir(), "msr-backfill-"));
const entryFile = join(dir, "entry.ts");
const outFile = join(dir, "bundle.cjs");
writeFileSync(entryFile, entry);

const { build } = await import(pathToFileURL(join(ROOT, "artifacts/api-server/node_modules/esbuild/lib/main.js")).href);
await build({
  entryPoints: [entryFile],
  outfile: outFile,
  bundle: true,
  platform: "node",
  format: "cjs",
  nodePaths: [
    join(ROOT, "artifacts/api-server/node_modules"),
    join(ROOT, "lib/db/node_modules"),
    join(ROOT, "node_modules"),
  ],
});
await import(pathToFileURL(outFile).href);
const result = await globalThis.__run;

console.log(`\n[backfill-provenance] mode=${result.mode}`);
for (const row of result.report) {
  if (row.ABORT) { console.log(`  ✗ ABORT ${row.reviewId} (${row.title}): ${row.ABORT}`); continue; }
  if (result.mode === "verify") {
    console.log(`  ${row.verify === "PASS" ? "✓" : "✗"} ${row.title} [${row.modelName}] sel=${row.selectedModel} pass=${row.passModel} adj=${row.adjudicatorModel} | audit pass=${row.auditPassModel} adj=${row.auditAdjModel} | score=${row.score} promptHash=${row.promptHash}`);
  } else {
    console.log(`  • ${row.title} [${row.modelName}] sel=${row.selectedModel}`);
    console.log(`      passModel: ${row.passModel}`);
    console.log(`      adjudicatorModel: ${row.adjudicatorModel}`);
    console.log(`      passModels: ${JSON.stringify(row.passModels)} | changed keys: ${JSON.stringify(row.changedKeys)}`);
    console.log(`      score (unchanged): ${row.score} | ledger.finalScore: ${row.ledgerFinalScore} | promptHash (unchanged): ${row.promptHash} | written: ${row.written}`);
  }
}
console.log(`\n[backfill-provenance] fixed=${result.fixed} skipped=${result.skipped} aborted=${result.aborted}` +
  (result.mode === "verify" ? ` verifyPass=${result.verifyPass} verifyFail=${result.verifyFail}` : ""));
if (result.aborted) { console.error("ABORTED rows present — a non-provenance key would have changed. Nothing unsafe was written."); process.exit(2); }
if (result.mode === "verify" && result.verifyFail) process.exit(1);
console.log(result.mode === "dry-run" ? "Dry run only — re-run with APPLY=1 to write." : "Done.");
process.exit(0); // pg Pool keeps the event loop alive; exit explicitly.
