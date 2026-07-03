// Autonomous overview-editor service — FIELD_MAP_and_importance_phase1.md §3/§4/§10.
// Applies a review's overviewImpact (model-as-editor prose diffs) to the DRAFT overview:
// versioned, provenance-carrying, integrity-guarded, and fully autonomous (no per-edit
// approval). Shared by the API routes (live db) and the seed harness (pglite) — it takes a
// drizzle db instance as a param and never imports the singleton client, so it is driver-agnostic.
//
// Integrity invariants enforced DETERMINISTICALLY here (§10.2 / §10.2a — NOT scoring clamps,
// and NOT "provenance-required" — the overview is explanation-first, §3.2):
//   - UNSOURCED explanatory prose IS allowed; each span carries a soft supportStatus.
//   - A citation that IS present must RESOLVE to a real paper — never dangling, never
//     mis-attributed. Unresolved citations are dropped and the span marked needs_source.
//   - a fatal_verified paper's edits are ROUTED to the disputed/failed-claims page only;
//   - paper text is data: a suspicious-instruction edit not neutralized by the model is
//     held for manual_review, never auto-applied;
//   - every applied edit creates a new versioned FieldPageVersion (rollback preserves history);
//   - prominence is renderer-COMPUTED (computeProminence), never taken from the model;
//   - inline citation links are rendered from the DB paperId via canonicalPaperSlug — the
//     model never writes slugs.

import { createHash } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import {
  papersTable, reviewVersionsTable,
  fieldPagesTable, fieldPageVersionsTable, pageSectionsTable, pageReferencesTable,
  pageSpansTable, proposedOverviewEditsTable, attributionChecksTable, pageLinksTable,
  type ComputedProminence, type FieldPageChangeLogEntry,
  type OverviewEditAction, type OverviewEditType,
  type OverviewEditorRationale, type OverviewEditSafetyCheck, type SpanSupportStatus,
  type ReviewClaim, type ChipClaimStatus, type EquationFlags,
} from "@workspace/db";

// Independent prompt-injection screen (brief P2): a cheap pattern check on the OUTPUT prose,
// deliberately NOT sharing fate with the model's own safetyCheck self-report — a compromised
// model cannot un-trip a regex. Conservative patterns (physics prose legitimately says things
// like "horizons act as thermodynamic systems", so no loose verb matching). Trip → hold.
const INJECTION_PATTERNS: RegExp[] = [
  /\b(ignore|disregard|forget|override)\b.{0,50}\b(instruction|prompt|rule|guideline|directive)s?\b/i,
  /\bsystem prompt\b/i,
  /\byou (are|'re) (now )?(an? )?(ai|llm|assistant|language model)\b/i,
  /\b(score|rate|mark) (this|the) (paper|manuscript)\b/i,
  /\bdo not (tell|reveal|mention).{0,30}\b(user|admin|reviewer)\b/i,
];
export function independentInjectionScreen(text: string): { tripped: boolean; pattern?: string } {
  for (const re of INJECTION_PATTERNS) {
    const m = text.match(re);
    if (m) return { tripped: true, pattern: m[0].slice(0, 80) };
  }
  return { tripped: false };
}

// Attribution overlap (brief P2 mis-sourcing WATCH): content-word containment between the cited
// claim statements and the anchored sentence, 0-100. Low overlap → admin spot-check queue.
// Never a gate — attribution correctness stays model judgment; this only triggers a LOOK.
export function attributionOverlapScore(claimStatements: string[], anchoredText: string): number {
  const words = (s: string) => new Set(
    s.toLowerCase().replace(/\$[^$]*\$/g, " ").replace(/\\[a-z]+/gi, " ").split(/[^a-z0-9]+/).filter((w) => w.length > 3),
  );
  const claimWords = words(claimStatements.join(" "));
  const textWords = words(anchoredText);
  if (claimWords.size === 0 || textWords.size === 0) return 0;
  let hit = 0;
  for (const w of textWords) if (claimWords.has(w)) hit += 1;
  return Math.round((100 * hit) / Math.min(textWords.size, claimWords.size));
}
const ATTRIBUTION_WATCH_THRESHOLD = 20; // below → queue for a human glance

// Chip claim status from the cited claims (per-claim, MIXED if they differ). Read-only surfacing.
function chipStatusFromClaims(citedClaimIds: string[], claims?: ReviewClaim[]): ChipClaimStatus | null {
  if (!claims?.length || !citedClaimIds?.length) return null;
  const statuses = Array.from(new Set(
    citedClaimIds.map((id) => claims.find((c) => c.id === id)?.status).filter(Boolean),
  )) as string[];
  if (statuses.length === 0) return null;
  if (statuses.length === 1) return statuses[0] as ChipClaimStatus;
  return "mixed";
}

// Canonical slug for a paper — the ONLY place a paper URL is formed (§10.2a item 3 / item 7).
export function canonicalPaperSlug(paperId: string, title?: string | null): string {
  const base = (title ?? "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60);
  return base ? `${base}-${paperId.slice(0, 8)}` : paperId;
}

type Db = PgDatabase<any, any, any>;

export const DISPUTED_PAGE_SLUG_SUFFIX = "disputed-and-failed-claims";

export type OverviewImpactEdit = {
  action: OverviewEditAction;
  editType?: OverviewEditType | null;
  targetPageSlug?: string;
  targetSectionSlug?: string;
  linkTargetSlug?: string; // add_link: destination page slug, chosen FROM THE INDEX (slice 1)
  anchorText?: string;
  proposedMarkdown?: string;
  citedPaperIds?: string[];
  citedClaimIds?: string[];
  supportStatus?: SpanSupportStatus; // model-assigned; sourced only if a citation actually resolves
  editorRationale?: OverviewEditorRationale | null;
  safetyCheck?: OverviewEditSafetyCheck | null;
  reason?: string;
};

export type ApplyOverviewInput = {
  overviewSlug: string;
  paperId: string;
  reviewVersionId?: string | null;
  // Public correctness of the paper (drives fatal routing). "flawed" => disputed page only.
  // FAIL CLOSED (brief P0.3): if this is missing or unrecognized (e.g. a malformed adjudicator
  // response), ALL edits are held as rejected/correctness_unavailable — corrupted model output
  // must never take the permissive branch.
  // "fatal_unverified" (an UNVERIFIED fatal allegation) also holds all edits: contested is an
  // EARNED state, unverified-fatal is a PENDING one — verification precedes edits (§10.6).
  correctnessPublic?: "sound" | "contested" | "flawed" | "hidden" | "fatal_unverified";
  edits: OverviewImpactEdit[];
  claims?: ReviewClaim[]; // the review's claim table (with per-claim status) — for chip claimStatus
  createdByUserId?: string | null;
  provenance?: "model_review" | "seed_overview" | "admin_manual";
};

export type AppliedEditResult = {
  action: OverviewEditAction;
  targetPageSlug: string | null;
  status: "draft_applied" | "rejected" | "no_change" | "skipped_idempotent";
  proposedOverviewEditId?: string;
  appliedVersionId?: string;
  referenceId?: string;
  spanId?: string;
  supportStatus?: SpanSupportStatus;
  droppedCitations?: string[]; // citations the model gave that did NOT resolve (watch signal)
  rejectionReason?: string;
};

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80) || "section";

// Regenerate section metadata rows from "## Heading" lines in the markdown.
async function regenerateSections(db: Db, pageId: string, versionId: string, markdown: string) {
  const lines = markdown.split("\n");
  let order = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^##\s+(.+?)\s*$/);
    if (!m) continue;
    const title = m[1].trim();
    await db.insert(pageSectionsTable).values({
      pageId, versionId, slug: slugify(title), title, order: order++, markdown: "", anchorIds: [],
    });
  }
}

async function latestVersion(db: Db, pageId: string) {
  // versionNumber is the ordering truth (P2): createdAt ties happen in fast loops.
  const rows = await db.select().from(fieldPageVersionsTable)
    .where(eq(fieldPageVersionsTable.pageId, pageId))
    .orderBy(desc(fieldPageVersionsTable.versionNumber), desc(fieldPageVersionsTable.createdAt)).limit(1);
  return rows[0] ?? null;
}

async function getPageBySlug(db: Db, slug: string) {
  const rows = await db.select().from(fieldPagesTable).where(eq(fieldPagesTable.slug, slug)).limit(1);
  return rows[0] ?? null;
}

// Create a new DRAFT version carrying `markdown`, point the page at it, log the change.
// PROVENANCE CARRY-FORWARD (brief P0.1 — this is what makes accretion possible): every span
// and reference from the source version (default: the previous latest; rollback passes the
// restore target) is copied onto the new version. Re-anchoring is by text search in the new
// markdown: found -> live copy with updated offsets; not found -> superseded copy (references
// get status "superseded"). History is never deleted; the accretion ledger survives rewrites.
async function newDraftVersion(
  db: Db, pageId: string, markdown: string,
  changeLog: FieldPageChangeLogEntry[], createdByUserId?: string | null,
  summaries?: { oneLine?: string; short?: string },
  carryFromVersionId?: string,
) {
  const prev = await latestVersion(db, pageId);
  const priorLog = (prev?.changeLog as FieldPageChangeLogEntry[] | undefined) ?? [];
  const [version] = await db.insert(fieldPageVersionsTable).values({
    pageId,
    versionNumber: (prev?.versionNumber ?? 0) + 1,
    summaryOneLine: summaries?.oneLine ?? prev?.summaryOneLine ?? "",
    summaryShort: summaries?.short ?? prev?.summaryShort ?? "",
    markdownFull: markdown,
    visibility: "draft",
    changeLog: [...priorLog, ...changeLog],
    createdByUserId: createdByUserId ?? null,
  }).returning();
  await db.update(fieldPagesTable)
    .set({ currentVersionId: version.id, updatedAt: new Date() })
    .where(eq(fieldPagesTable.id, pageId));
  await regenerateSections(db, pageId, version.id, markdown);

  const sourceVersionId = carryFromVersionId ?? prev?.id ?? null;
  if (sourceVersionId) {
    // 1. References first (spans point at them) — build old->new id map.
    const prevRefs = await db.select().from(pageReferencesTable).where(eq(pageReferencesTable.versionId, sourceVersionId));
    const refIdMap = new Map<string, string>();
    for (const r of prevRefs) {
      const anchor = r.anchorText ?? "";
      const idx = anchor ? markdown.indexOf(anchor) : -1;
      const [copy] = await db.insert(pageReferencesTable).values({
        pageId, versionId: version.id, sectionId: r.sectionId,
        anchorText: r.anchorText,
        anchorStartOffset: idx >= 0 ? idx : null,
        anchorEndOffset: idx >= 0 ? idx + anchor.length : null,
        paperId: r.paperId, reviewVersionId: r.reviewVersionId, externalReferenceId: r.externalReferenceId,
        claimIds: r.claimIds, claimStatus: r.claimStatus, note: r.note,
        status: idx >= 0 ? (r.status === "superseded" ? "superseded" : r.status) : "superseded",
        provenance: r.provenance,
      }).returning();
      refIdMap.set(r.id, copy.id);
    }
    // 2. Spans, re-anchored; superseded reflects presence in THIS version's markdown.
    // Two passes: copy first (building old->new id map), then remap supersededBySpanId lineage
    // pointers so a superseded contribution keeps pointing at its live replacement (slice 3).
    const prevSpans = await db.select().from(pageSpansTable).where(eq(pageSpansTable.versionId, sourceVersionId));
    const spanIdMap = new Map<string, string>();
    for (const s of prevSpans) {
      const idx = s.text ? markdown.indexOf(s.text) : -1;
      const [copy] = await db.insert(pageSpansTable).values({
        pageId, versionId: version.id, sectionSlug: s.sectionSlug, text: s.text,
        startOffset: idx >= 0 ? idx : null,
        endOffset: idx >= 0 ? idx + s.text.length : null,
        supportStatus: s.supportStatus,
        superseded: idx < 0,
        supersededBySpanId: s.supersededBySpanId, // remapped below once all copies exist
        referenceId: s.referenceId ? (refIdMap.get(s.referenceId) ?? s.referenceId) : null,
        createdByReviewVersionId: s.createdByReviewVersionId, createdByPaperId: s.createdByPaperId,
      }).returning();
      spanIdMap.set(s.id, copy.id);
    }
    for (const s of prevSpans) {
      if (s.supersededBySpanId && spanIdMap.has(s.supersededBySpanId)) {
        await db.update(pageSpansTable)
          .set({ supersededBySpanId: spanIdMap.get(s.supersededBySpanId)! })
          .where(eq(pageSpansTable.id, spanIdMap.get(s.id)!));
      }
    }
    // 3. Inter-page links (slice 1), re-anchored by phrase; orphaned -> superseded copy.
    const prevLinks = await db.select().from(pageLinksTable).where(eq(pageLinksTable.versionId, sourceVersionId));
    for (const l of prevLinks) {
      const idx = l.phrase ? markdown.indexOf(l.phrase) : -1;
      await db.insert(pageLinksTable).values({
        fromPageId: pageId, toPageId: l.toPageId, phrase: l.phrase,
        versionId: version.id,
        anchorStartOffset: idx >= 0 ? idx : null,
        anchorEndOffset: idx >= 0 ? idx + l.phrase.length : null,
        superseded: idx < 0,
        createdByReviewVersionId: l.createdByReviewVersionId,
      });
    }
  }
  return version;
}

// Insert prose into the markdown per the edit action. Returns { markdown, anchor } or a
// FAILURE — never a silent append (brief P1.1): a rewrite whose anchor is missing must not be
// appended alongside the old text (that produces a page asserting both the wrong and the right
// thing); a paragraph targeting a missing section must not land somewhere else.
function applyToMarkdown(current: string, edit: OverviewImpactEdit): { markdown: string; anchor: string; failure?: "anchor_not_found" | "section_not_found" } {
  const para = (edit.proposedMarkdown ?? "").trim();
  const anchor = edit.anchorText?.trim() || para.split(/(?<=[.!?])\s/)[0]?.slice(0, 120) || para.slice(0, 80);
  if (!para) return { markdown: current, anchor };
  switch (edit.action) {
    case "add_subsection": {
      const title = edit.targetSectionSlug ? edit.targetSectionSlug.replace(/-/g, " ") : (para.split("\n")[0].slice(0, 60));
      const heading = para.startsWith("#") ? para : `## ${title}\n\n${para}`;
      return { markdown: `${current.trimEnd()}\n\n${heading}\n`, anchor };
    }
    case "add_paragraph": {
      if (edit.targetSectionSlug) {
        const lines = current.split("\n");
        // find the target "## heading" whose slug matches, insert before the next "## " or EOF
        let insertAt = -1;
        for (let i = 0; i < lines.length; i += 1) {
          const m = lines[i].match(/^##\s+(.+?)\s*$/);
          if (m && slugify(m[1]) === edit.targetSectionSlug) {
            insertAt = i + 1;
            for (let j = i + 1; j < lines.length; j += 1) { if (/^##\s+/.test(lines[j])) { insertAt = j; break; } insertAt = j + 1; }
            break;
          }
        }
        if (insertAt < 0) return { markdown: current, anchor, failure: "section_not_found" };
        lines.splice(insertAt, 0, "", para, "");
        return { markdown: lines.join("\n"), anchor };
      }
      return { markdown: `${current.trimEnd()}\n\n${para}\n`, anchor };
    }
    case "edit_existing_text": {
      if (edit.anchorText && current.includes(edit.anchorText)) {
        return { markdown: current.replace(edit.anchorText, para), anchor: para.slice(0, 120) };
      }
      return { markdown: current, anchor, failure: "anchor_not_found" };
    }
    case "merge_or_reorganize":
      return { markdown: `${current.trimEnd()}\n\n${para}\n`, anchor };
    default: // add_reference / no_change / create_subpage handled by caller
      return { markdown: current, anchor };
  }
}

async function createReference(
  db: Db, args: {
    pageId: string; versionId: string; markdown: string; anchorText: string;
    paperId: string; reviewVersionId?: string | null; claimIds: string[];
    claimStatus?: ChipClaimStatus | null;
    provenance: "model_review" | "seed_overview" | "admin_manual"; note?: string;
  },
) {
  const idx = args.markdown.indexOf(args.anchorText);
  const [ref] = await db.insert(pageReferencesTable).values({
    pageId: args.pageId, versionId: args.versionId, anchorText: args.anchorText,
    anchorStartOffset: idx >= 0 ? idx : null,
    anchorEndOffset: idx >= 0 ? idx + args.anchorText.length : null,
    paperId: args.paperId, reviewVersionId: args.reviewVersionId ?? null,
    claimIds: args.claimIds, claimStatus: args.claimStatus ?? null, note: args.note ?? "",
    status: "approved", provenance: args.provenance,
  }).returning();
  return ref;
}

// Resolve cited paper ids against real papers — the hard integrity check (§10.2). Returns the
// subset that exist. Anything else is a dangling citation and must NOT become a stored reference.
async function resolveCitedPapers(db: Db, ids: string[]): Promise<{ resolved: string[]; dropped: string[] }> {
  const unique = Array.from(new Set((ids ?? []).filter(Boolean)));
  if (unique.length === 0) return { resolved: [], dropped: [] };
  const rows = await db.select({ id: papersTable.id }).from(papersTable).where(inArray(papersTable.id, unique));
  const found = new Set(rows.map((r: any) => r.id));
  return { resolved: unique.filter((id) => found.has(id)), dropped: unique.filter((id) => !found.has(id)) };
}

// Create a prose span with its support status (§3.2). Unsourced is fine; only attach a
// referenceId when a real citation resolved (no dangling, no mis-attribution).
async function createSpan(
  db: Db, args: {
    pageId: string; versionId: string; sectionSlug?: string | null; text: string; markdown: string;
    supportStatus: SpanSupportStatus; referenceId?: string | null;
    reviewVersionId?: string | null; paperId?: string | null;
  },
) {
  const idx = args.markdown.indexOf(args.text);
  const [span] = await db.insert(pageSpansTable).values({
    pageId: args.pageId, versionId: args.versionId, sectionSlug: args.sectionSlug ?? null,
    text: args.text.slice(0, 4000),
    startOffset: idx >= 0 ? idx : null, endOffset: idx >= 0 ? idx + args.text.length : null,
    supportStatus: args.supportStatus, referenceId: args.referenceId ?? null,
    createdByReviewVersionId: args.reviewVersionId ?? null, createdByPaperId: args.paperId ?? null,
  }).returning();
  return span;
}

// ---- Public: apply a review's overviewImpact edits to the draft overview ----------
// Deterministic key for one edit within one review — the idempotency unit (P1.4).
function editIdempotencyKey(input: ApplyOverviewInput, edit: OverviewImpactEdit): string {
  return createHash("sha256").update(JSON.stringify({
    rv: input.reviewVersionId ?? null, paper: input.paperId, overview: input.overviewSlug,
    action: edit.action, target: edit.targetPageSlug ?? null, section: edit.targetSectionSlug ?? null,
    linkTarget: edit.linkTargetSlug ?? null,
    anchor: edit.anchorText ?? null, md: edit.proposedMarkdown ?? "",
    cp: edit.citedPaperIds ?? [], cc: edit.citedClaimIds ?? [],
  })).digest("hex").slice(0, 40);
}

export async function applyOverviewImpact(db: Db, input: ApplyOverviewInput): Promise<AppliedEditResult[]> {
  const provenance = input.provenance ?? "model_review";
  const results: AppliedEditResult[] = [];
  const disputedSlug = `${input.overviewSlug}-${DISPUTED_PAGE_SLUG_SUFFIX}`;
  // Fail closed (P0.3): unknown correctness → hold every edit; never default to the sound path.
  const KNOWN_CORRECTNESS = ["sound", "contested", "flawed", "hidden", "fatal_unverified"];
  const correctnessKnown = input.correctnessPublic != null && KNOWN_CORRECTNESS.includes(input.correctnessPublic);

  for (const edit of input.edits) {
    // Idempotency (P1.4): re-applying the same review's edit is a no-op — an autonomous editor
    // that duplicates paragraphs on retry is not autonomous, it's unattended. (Rejected rows
    // carry no key, so a fixed retry of a previously-failed edit is not blocked.)
    const idempotencyKey = editIdempotencyKey(input, edit);
    const dup = (await db.select().from(proposedOverviewEditsTable).where(eq(proposedOverviewEditsTable.idempotencyKey, idempotencyKey)).limit(1))[0];
    if (dup && (dup.status === "draft_applied" || dup.status === "published")) {
      results.push({ action: edit.action, targetPageSlug: dup.targetPageSlug ?? null, status: "skipped_idempotent", proposedOverviewEditId: dup.id, appliedVersionId: dup.appliedVersionId ?? undefined });
      continue;
    }

    // Each edit applies ATOMICALLY (P1.4): version + sections + carried spans/refs + new
    // span/ref + the edit record commit together or not at all.
    const applyOne = async (tx: Db): Promise<AppliedEditResult> => {
      // Equation-fidelity WATCH (P2): equations in this edit's prose that match no review claim.
      // Stored on the edit row for the admin list; the live pipeline adds image verification.
      const eqUnmatched = checkEquationFidelity(edit.proposedMarkdown ?? "", input.claims ?? []).map((f) => f.equation);
      const equationFlags: EquationFlags | null = eqUnmatched.length ? { unmatched: eqUnmatched } : null;
      const recordEdit = async (
        status: "draft_applied" | "rejected" | "no_change",
        extra: { targetPageSlug?: string | null; appliedVersionId?: string; rejectionReason?: string } = {},
      ) => {
        const [row] = await tx.insert(proposedOverviewEditsTable).values({
          reviewVersionId: input.reviewVersionId ?? null, paperId: input.paperId,
          overviewSlug: input.overviewSlug, action: edit.action, editType: edit.editType ?? null,
          targetPageSlug: extra.targetPageSlug ?? edit.targetPageSlug ?? null,
          targetSectionSlug: edit.targetSectionSlug ?? null,
          linkTargetSlug: edit.linkTargetSlug ?? null,
          proposedMarkdown: edit.proposedMarkdown ?? "",
          citedPaperIds: edit.citedPaperIds ?? [], citedClaimIds: edit.citedClaimIds ?? [],
          editorRationale: edit.editorRationale ?? null, safetyCheck: edit.safetyCheck ?? null,
          reason: extra.rejectionReason ? `${edit.reason ?? ""} [${extra.rejectionReason}]` : (edit.reason ?? ""),
          status: status === "no_change" ? "draft_applied" : (status === "rejected" ? "rejected" : "draft_applied"),
          appliedVersionId: extra.appliedVersionId ?? null,
          idempotencyKey: status === "rejected" ? null : idempotencyKey,
          equationFlags,
        }).returning();
        return row.id;
      };
      // Mis-sourcing WATCH (P2): queue low-overlap sourced sentences for an admin glance.
      const recordAttributionWatch = async (args: { editId: string; refId?: string; spanId?: string; pageId: string; anchoredText: string }) => {
        const claimIds = edit.citedClaimIds ?? [];
        if (!args.refId || claimIds.length === 0) return;
        const statements = claimIds.map((id) => (input.claims ?? []).find((c) => c.id === id)?.statement ?? "").filter(Boolean);
        if (statements.length === 0) return;
        const score = attributionOverlapScore(statements, args.anchoredText);
        if (score >= ATTRIBUTION_WATCH_THRESHOLD) return;
        await tx.insert(attributionChecksTable).values({
          proposedOverviewEditId: args.editId, referenceId: args.refId, spanId: args.spanId ?? null,
          pageId: args.pageId, paperId: input.paperId, claimIds, claimStatements: statements,
          anchoredText: args.anchoredText.slice(0, 2000), overlapScore: score,
          note: "low lexical overlap between cited claim(s) and anchored sentence — verify attribution",
        });
      };

      if (edit.action === "no_change") {
        return { action: edit.action, targetPageSlug: null, status: "no_change", proposedOverviewEditId: await recordEdit("no_change") };
      }

      // Fail closed (P0.3): without a valid correctness verdict, no edit touches a page.
      if (!correctnessKnown) {
        const id = await recordEdit("rejected", { rejectionReason: "correctness_unavailable: missing/unrecognized correctness verdict — all edits held (fail closed)" });
        return { action: edit.action, targetPageSlug: edit.targetPageSlug ?? null, status: "rejected", proposedOverviewEditId: id, rejectionReason: "correctness_unavailable" };
      }
      // Fail closed on PENDING correctness: an unverified fatal allegation holds every edit —
      // it must not route as contested (earned) nor touch any page until verified (§10.6).
      if (input.correctnessPublic === "fatal_unverified") {
        const id = await recordEdit("rejected", { rejectionReason: "fatal_unverified: unverified fatal allegation — edits held pending image-grounded verification (verification precedes edits)" });
        return { action: edit.action, targetPageSlug: edit.targetPageSlug ?? null, status: "rejected", proposedOverviewEditId: id, rejectionReason: "fatal_unverified" };
      }

      // Integrity: paper text is data. A live instruction the model did not neutralize => manual review.
      const sc = edit.safetyCheck;
      if (sc && (sc.paperTextTreatedAsData === false || (sc.suspiciousInstructionsDetected && sc.actionTaken !== "ignored_instructions"))) {
        const id = await recordEdit("rejected", { rejectionReason: "safety: suspicious instructions held for manual_review" });
        return { action: edit.action, targetPageSlug: edit.targetPageSlug ?? null, status: "rejected", proposedOverviewEditId: id, rejectionReason: "manual_review" };
      }
      // INDEPENDENT injection screen on the output prose (P2) — does not share fate with the
      // model's self-report above; a compromised model cannot un-trip a regex. Trip → hold.
      const screen = independentInjectionScreen(edit.proposedMarkdown ?? "");
      if (screen.tripped) {
        const id = await recordEdit("rejected", { rejectionReason: `injection_screen: independent pattern screen tripped ("${screen.pattern}") — held for manual_review` });
        return { action: edit.action, targetPageSlug: edit.targetPageSlug ?? null, status: "rejected", proposedOverviewEditId: id, rejectionReason: "injection_screen" };
      }

      // EXPLANATION-FIRST (§3.2): unsourced prose is allowed. The REVIEWED paper is the natural,
      // always-resolvable source of its own claims — the model need not (and cannot) know DB ids, so
      // a span it marks sourced / backs with its own claims is sourced by input.paperId. Any OTHER
      // cited paper ids are resolved against the DB (accretion / multi-source); unresolved ones are
      // ignored, never stored as dangling or mis-attributed references (§10.2 / §10.2a item 2).
      const { dropped } = await resolveCitedPapers(tx, (edit.citedPaperIds ?? []).filter((x) => x !== input.paperId));
      const wantsSource = edit.supportStatus === "sourced" || (edit.citedClaimIds?.length ?? 0) > 0
        || (edit.citedPaperIds ?? []).some((x) => x === input.paperId) || edit.action === "add_reference";
      const isSourced = wantsSource;
      const sourcePaperId = isSourced ? input.paperId : null;
      const claimIds = edit.citedClaimIds ?? [];
      const supportStatus: SpanSupportStatus = isSourced ? "sourced" : (edit.supportStatus ?? "unsourced_explanatory");
      // Chip claim status (soft, per-claim; separate axis from supportStatus) — drives NOTHING.
      const claimStatus = chipStatusFromClaims(claimIds, input.claims);

      // Fatal routing: a flawed paper may only touch the disputed page.
      const targetSlug = input.correctnessPublic === "flawed"
        ? disputedSlug
        : (edit.action === "create_subpage" ? (edit.targetPageSlug || slugify(edit.proposedMarkdown?.split("\n")[0] ?? "new-page")) : (edit.targetPageSlug || input.overviewSlug));

      // create_subpage: make a new page under the overview root, seed its first draft version.
      if (edit.action === "create_subpage" && input.correctnessPublic !== "flawed") {
        const existing = await getPageBySlug(tx, targetSlug);
        if (existing) {
          edit.action = "add_paragraph"; // slug exists — improve it, don't duplicate
        } else {
          const root = await getPageBySlug(tx, input.overviewSlug);
          const title = (edit.proposedMarkdown?.match(/^#+\s*(.+)/)?.[1] || targetSlug.replace(/-/g, " ")).slice(0, 120);
          const [page] = await tx.insert(fieldPagesTable).values({ slug: targetSlug, title, parentPageId: root?.id ?? null, scopeStatement: edit.reason ?? "", summary: "" }).returning();
          const md = edit.proposedMarkdown ?? `## ${title}\n`;
          const version = await newDraftVersion(tx, page.id, md, [{ at: new Date().toISOString(), action: `create_subpage from paper ${input.paperId}`, note: edit.reason }], input.createdByUserId);
          let refId: string | undefined;
          if (isSourced && sourcePaperId) { const ref = await createReference(tx, { pageId: page.id, versionId: version.id, markdown: md, anchorText: edit.anchorText || title, paperId: sourcePaperId, reviewVersionId: input.reviewVersionId, claimIds, claimStatus, provenance }); refId = ref.id; }
          const span = await createSpan(tx, { pageId: page.id, versionId: version.id, text: (edit.proposedMarkdown ?? title).slice(0, 400), markdown: md, supportStatus, referenceId: refId ?? null, reviewVersionId: input.reviewVersionId, paperId: input.paperId });
          const id = await recordEdit("draft_applied", { targetPageSlug: targetSlug, appliedVersionId: version.id });
          await recordAttributionWatch({ editId: id, refId, spanId: span.id, pageId: page.id, anchoredText: (edit.proposedMarkdown ?? title).slice(0, 400) });
          return { action: "create_subpage", targetPageSlug: targetSlug, status: "draft_applied", proposedOverviewEditId: id, appliedVersionId: version.id, referenceId: refId, spanId: span.id, supportStatus, droppedCitations: dropped };
        }
      }

      // Resolve the target page. SLUG DISCIPLINE (P1.5): only create_subpage may create a page;
      // the disputed page is a SYSTEM slug (computed here, never model-written) and may be
      // auto-created; any other unknown slug is a model typo and must not fork the wiki.
      let page = await getPageBySlug(tx, targetSlug);
      if (!page) {
        if (targetSlug !== disputedSlug) {
          const id = await recordEdit("rejected", { targetPageSlug: targetSlug, rejectionReason: "unknown_target_slug: page does not exist (only create_subpage creates pages)" });
          return { action: edit.action, targetPageSlug: targetSlug, status: "rejected", proposedOverviewEditId: id, rejectionReason: "unknown_target_slug" };
        }
        const root = await getPageBySlug(tx, input.overviewSlug);
        const [created] = await tx.insert(fieldPagesTable).values({ slug: targetSlug, title: "Disputed & failed claims", parentPageId: root?.id ?? null, scopeStatement: "Disputed and failed claims." }).returning();
        page = created;
        await newDraftVersion(tx, page.id, `## ${page.title}\n`, [{ at: new Date().toISOString(), action: "auto-created disputed page (system slug)" }], input.createdByUserId);
      }
      const current = (await latestVersion(tx, page.id))?.markdownFull ?? `## ${page.title}\n`;

      if (edit.action === "add_link") {
        // Inter-page link (slice 1): the model proposes { phrase, linkTargetSlug } with the
        // target chosen FROM THE INDEX it was given — the application validates the slug and
        // stores the link; the model never writes URLs. Unknown target -> reject; a link whose
        // phrase is not on the page is an anchor miss -> reject (loud, P1.1 discipline).
        const linkTarget = edit.linkTargetSlug ? await getPageBySlug(tx, edit.linkTargetSlug) : null;
        if (!linkTarget) {
          const id = await recordEdit("rejected", { targetPageSlug: targetSlug, rejectionReason: "unknown_link_target: link destination slug does not exist (choose from the supplied index)" });
          return { action: edit.action, targetPageSlug: targetSlug, status: "rejected", proposedOverviewEditId: id, rejectionReason: "unknown_link_target" };
        }
        const phrase = edit.anchorText?.trim() ?? "";
        if (!phrase || !current.includes(phrase)) {
          const id = await recordEdit("rejected", { targetPageSlug: targetSlug, rejectionReason: "anchor_not_found: link phrase not present on the page" });
          return { action: edit.action, targetPageSlug: targetSlug, status: "rejected", proposedOverviewEditId: id, rejectionReason: "anchor_not_found" };
        }
        const version = await newDraftVersion(tx, page.id, current, [{ at: new Date().toISOString(), action: `add_link "${phrase.slice(0, 40)}" -> ${edit.linkTargetSlug} from paper ${input.paperId}`, note: edit.reason }], input.createdByUserId);
        const idx = current.indexOf(phrase);
        await tx.insert(pageLinksTable).values({
          fromPageId: page.id, toPageId: linkTarget.id, phrase, versionId: version.id,
          anchorStartOffset: idx, anchorEndOffset: idx + phrase.length,
          createdByReviewVersionId: input.reviewVersionId ?? null,
        });
        const id = await recordEdit("draft_applied", { targetPageSlug: targetSlug, appliedVersionId: version.id });
        return { action: "add_link", targetPageSlug: targetSlug, status: "draft_applied", proposedOverviewEditId: id, appliedVersionId: version.id };
      }

      if (edit.action === "add_reference") {
        // Accretion-as-query (§3.2 / item 4): SOURCE an existing (unsourced) span with this paper.
        // Create the new version FIRST (carry-forward copies every span onto it), then match and
        // update the NEW version's copy — updating the old version's row would be lost (P0.1).
        const anchor = edit.anchorText?.trim() || current.slice(0, 80);
        const version = await newDraftVersion(tx, page.id, current, [{ at: new Date().toISOString(), action: `add_reference (source span) from paper ${input.paperId}`, note: edit.reason }], input.createdByUserId);
        const spans = (await tx.select().from(pageSpansTable).where(eq(pageSpansTable.versionId, version.id))).filter((s: any) => !s.superseded);
        const match = spans.find((s: any) => s.text && (s.text.includes(anchor) || (anchor.length > 20 && anchor.includes(s.text.slice(0, 40)))));
        let refId: string | undefined, spanId: string | undefined, finalStatus: SpanSupportStatus = supportStatus;
        if (isSourced && sourcePaperId) {
          const ref = await createReference(tx, { pageId: page.id, versionId: version.id, markdown: current, anchorText: anchor, paperId: sourcePaperId, reviewVersionId: input.reviewVersionId, claimIds, claimStatus, provenance });
          refId = ref.id;
          if (match) { await tx.update(pageSpansTable).set({ supportStatus: "sourced", referenceId: ref.id }).where(eq(pageSpansTable.id, match.id)); spanId = match.id; finalStatus = "sourced"; }
          else { const sp = await createSpan(tx, { pageId: page.id, versionId: version.id, text: anchor, markdown: current, supportStatus: "sourced", referenceId: ref.id, reviewVersionId: input.reviewVersionId, paperId: input.paperId }); spanId = sp.id; }
        } else if (match) {
          await tx.update(pageSpansTable).set({ supportStatus: "needs_source" }).where(eq(pageSpansTable.id, match.id)); spanId = match.id; finalStatus = "needs_source";
        }
        const id = await recordEdit("draft_applied", { targetPageSlug: targetSlug, appliedVersionId: version.id });
        await recordAttributionWatch({ editId: id, refId, spanId, pageId: page.id, anchoredText: anchor });
        return { action: "add_reference", targetPageSlug: targetSlug, status: "draft_applied", proposedOverviewEditId: id, appliedVersionId: version.id, referenceId: refId, spanId, supportStatus: finalStatus, droppedCitations: dropped };
      }

      // Prose edits (add_paragraph / add_subsection / edit_existing_text / merge_or_reorganize).
      const { markdown, anchor, failure } = applyToMarkdown(current, edit);
      if (failure) {
        // Loud failure, never a silent append (P1.1) — the model can retry with a fresh anchor.
        const id = await recordEdit("rejected", { targetPageSlug: targetSlug, rejectionReason: failure });
        return { action: edit.action, targetPageSlug: targetSlug, status: "rejected", proposedOverviewEditId: id, rejectionReason: failure };
      }
      const insertedText = (edit.proposedMarkdown ?? anchor).trim();
      const version = await newDraftVersion(tx, page.id, markdown, [{ at: new Date().toISOString(), action: `${edit.action} from paper ${input.paperId}`, note: edit.reason }], input.createdByUserId);
      let refId: string | undefined;
      if (isSourced && sourcePaperId) { const ref = await createReference(tx, { pageId: page.id, versionId: version.id, markdown, anchorText: anchor, paperId: sourcePaperId, reviewVersionId: input.reviewVersionId, claimIds, claimStatus, provenance }); refId = ref.id; }
      const span = await createSpan(tx, { pageId: page.id, versionId: version.id, sectionSlug: edit.targetSectionSlug ?? null, text: insertedText, markdown, supportStatus, referenceId: refId ?? null, reviewVersionId: input.reviewVersionId, paperId: input.paperId });
      // Lineage (slice 3): a rewrite's replaced span(s) point at their replacement, so the
      // original contributor's paper page can transclude the CURRENT state of its region.
      if (edit.action === "edit_existing_text" && edit.anchorText) {
        await tx.update(pageSpansTable)
          .set({ supersededBySpanId: span.id })
          .where(and(eq(pageSpansTable.versionId, version.id), eq(pageSpansTable.superseded, true), eq(pageSpansTable.text, edit.anchorText)));
      }
      const id = await recordEdit("draft_applied", { targetPageSlug: targetSlug, appliedVersionId: version.id });
      await recordAttributionWatch({ editId: id, refId, spanId: span.id, pageId: page.id, anchoredText: insertedText });
      return { action: edit.action, targetPageSlug: targetSlug, status: "draft_applied", proposedOverviewEditId: id, appliedVersionId: version.id, referenceId: refId, spanId: span.id, supportStatus, droppedCitations: dropped };
    };

    try {
      results.push(await (db as any).transaction(async (tx: Db) => applyOne(tx)));
    } catch (e) {
      // The transaction rolled back — record the failure OUTSIDE it (auditable, loud, retryable:
      // no idempotency key on failure rows).
      const [row] = await db.insert(proposedOverviewEditsTable).values({
        reviewVersionId: input.reviewVersionId ?? null, paperId: input.paperId,
        overviewSlug: input.overviewSlug, action: edit.action, editType: edit.editType ?? null,
        targetPageSlug: edit.targetPageSlug ?? null, targetSectionSlug: edit.targetSectionSlug ?? null,
        proposedMarkdown: edit.proposedMarkdown ?? "",
        citedPaperIds: edit.citedPaperIds ?? [], citedClaimIds: edit.citedClaimIds ?? [],
        reason: `${edit.reason ?? ""} [apply_failed: ${String((e as Error)?.message ?? e).slice(0, 300)}]`,
        status: "rejected",
      }).returning();
      results.push({ action: edit.action, targetPageSlug: edit.targetPageSlug ?? null, status: "rejected", proposedOverviewEditId: row.id, rejectionReason: "apply_failed" });
    }
  }
  return results;
}

// ---- Equation-fidelity check (§10.2a / item 6) — a LIGHT watch, not a hard gate ----
// Flags inline $...$ equations in overview prose that don't appear (normalized) in any of the
// review's verified claims — the editor should carry equations verbatim, not re-render them.
export function checkEquationFidelity(prose: string, claims: { statement: string }[]): { equation: string; foundInClaims: boolean }[] {
  const norm = (s: string) => s.replace(/\\\\/g, "\\").replace(/[\s{}]/g, "").toLowerCase();
  // Only check REAL equations — a relation (=, <, >), a fraction, or several tokens. Lone inline
  // symbols ($\kappa$, $m$, $\Delta x$) are not equations and are not worth flagging.
  const isEquation = (m: string) => /[=<>]|\\frac|\\sim|\\propto/.test(m) || m.replace(/[$\\{}\s]/g, "").length >= 6;
  const claimMath = claims.flatMap((c) => (c.statement.match(/\$[^$]+\$/g) ?? []).map(norm));
  const proseMath = Array.from(new Set((prose.match(/\$[^$]+\$/g) ?? []).filter(isEquation)));
  return proseMath.map((eq) => {
    const n = norm(eq);
    return { equation: eq, foundInClaims: claimMath.some((cm) => cm.includes(n) || n.includes(cm)) };
  }).filter((r) => !r.foundInClaims);
}

// ---- Seed skeleton: thin stub pages with scope statements (no prose yet) ----------
export type SeedPageSpec = { slug: string; title: string; scopeStatement: string; parentSlug?: string; summaryOneLine?: string };

export async function ensureOverviewSkeleton(db: Db, pages: SeedPageSpec[], createdByUserId?: string | null) {
  const bySlug = new Map<string, string>();
  // First pass: create pages.
  for (const spec of pages) {
    let page = await getPageBySlug(db, spec.slug);
    if (!page) {
      const [created] = await db.insert(fieldPagesTable).values({
        slug: spec.slug, title: spec.title, scopeStatement: spec.scopeStatement, summary: spec.summaryOneLine ?? "",
      }).returning();
      page = created;
    }
    bySlug.set(spec.slug, page.id);
  }
  // Second pass: parent links + initial empty draft version.
  for (const spec of pages) {
    const pageId = bySlug.get(spec.slug)!;
    if (spec.parentSlug && bySlug.has(spec.parentSlug)) {
      await db.update(fieldPagesTable).set({ parentPageId: bySlug.get(spec.parentSlug)! }).where(eq(fieldPagesTable.id, pageId));
    }
    if (!(await latestVersion(db, pageId))) {
      await newDraftVersion(db, pageId, `## ${spec.title}\n\n_${spec.scopeStatement}_\n`,
        [{ at: new Date().toISOString(), action: "seed skeleton stub" }], createdByUserId,
        { oneLine: spec.summaryOneLine ?? spec.title, short: spec.scopeStatement });
    }
  }
  return bySlug;
}

// ---- Renderer-computed prominence (§10.5) — never model-assigned -------------------
export async function computeProminence(db: Db, overviewSlug: string, paperId: string): Promise<{ prominence: ComputedProminence; locationSlug: string | null }> {
  // References are keyed per-version (carry-forward copies) — only the LATEST version of each
  // page counts, and only live (approved) refs; superseded copies are history, not position.
  const allRefs = await db.select().from(pageReferencesTable).where(eq(pageReferencesTable.paperId, paperId));
  const refs: typeof allRefs = [];
  const latestByPage = new Map<string, string | null>();
  for (const ref of allRefs) {
    if (ref.status !== "approved") continue;
    if (!latestByPage.has(ref.pageId)) latestByPage.set(ref.pageId, (await latestVersion(db, ref.pageId))?.id ?? null);
    if (ref.versionId && ref.versionId === latestByPage.get(ref.pageId)) refs.push(ref);
  }
  if (refs.length === 0) return { prominence: "not_in_overview", locationSlug: null };
  // Is the paper the SUBJECT of a page (its slug carries the paper) or the anchor of a section?
  let best: ComputedProminence = "footnote_reference";
  let locationSlug: string | null = null;
  for (const ref of refs) {
    const page = (await db.select().from(fieldPagesTable).where(eq(fieldPagesTable.id, ref.pageId)).limit(1))[0];
    if (!page) continue;
    locationSlug = locationSlug ?? page.slug;
    // A reference sitting at/near the top of a page/section is more prominent than a mid-body inline.
    const rank = (p: ComputedProminence) => ["not_in_overview", "footnote_reference", "inline_reference", "paragraph_reference", "subsection_anchor", "section_anchor", "page_subject"].indexOf(p);
    let here: ComputedProminence = "inline_reference";
    if ((ref.anchorStartOffset ?? 9999) < 200) here = "section_anchor";
    else here = "paragraph_reference";
    if (rank(here) > rank(best)) { best = here; locationSlug = page.slug; }
  }
  return { prominence: best, locationSlug };
}

// ---- Assemble the draft overview into markdown (for review / export) ---------------
export async function assembleOverviewMarkdown(db: Db, overviewSlug: string): Promise<string> {
  const root = await getPageBySlug(db, overviewSlug);
  const pages = await db.select().from(fieldPagesTable);
  const ordered = pages.filter((p: any) => p.slug === overviewSlug || p.parentPageId === (root?.id ?? "__none__"));
  const chunks: string[] = [];
  for (const p of [root, ...ordered.filter((x: any) => x.id !== root?.id)].filter(Boolean) as any[]) {
    const v = await latestVersion(db, p.id);
    // Per-version reads: the served version's live refs/spans (carry-forward makes these cumulative).
    const refs = v ? (await db.select().from(pageReferencesTable).where(eq(pageReferencesTable.versionId, v.id))).filter((r: any) => r.status === "approved") : [];
    const spans = v ? (await db.select().from(pageSpansTable).where(eq(pageSpansTable.versionId, v.id))).filter((s: any) => !s.superseded) : [];
    const sourced = spans.filter((s: any) => s.supportStatus === "sourced").length;
    const unsourced = spans.length - sourced;
    chunks.push(`# ${p.title}  (\`/fields/${p.slug}\`)\n\n${v?.markdownFull ?? ""}\n\n_Provenance: ${refs.length} source chip(s); spans ${sourced} sourced / ${unsourced} unsourced-explanatory._\n`);
  }
  return chunks.join("\n\n---\n\n");
}

// ---- Production write-path hook (brief P1.6) — gated by env flag, default OFF -------
// Invoked post-review from the submission pipeline (and manually via the admin route). Reads
// the paper's persisted B.2.1 review_versions row and applies its overviewImpact edits with the
// FAIL-CLOSED correctness mapping (P0.3 + fatal_alleged_unverified hold, §10.6). No-ops (with a
// reason) when the flag is off, when no review_versions row exists yet (the v19 pipeline does
// not produce one — write-path integration completes when B.2.1 reviews land in production),
// or when the review proposed no edits.
export function overviewEditorEnabled(): boolean {
  return process.env.SCIREVIEW_OVERVIEW_EDITOR_ENABLED === "true";
}

export async function runPostReviewOverviewHook(
  db: Db, paperId: string, defaultOverviewSlug = "horizon-thermodynamics",
): Promise<{ applied: AppliedEditResult[] | null; skipped?: string }> {
  if (!overviewEditorEnabled()) return { applied: null, skipped: "flag_disabled" };
  const rv = (await db.select().from(reviewVersionsTable)
    .where(eq(reviewVersionsTable.paperId, paperId))
    .orderBy(desc(reviewVersionsTable.createdAt)).limit(1))[0];
  if (!rv) return { applied: null, skipped: "no_review_version" };
  const oi = rv.overviewImpact as { overviewSlug?: string; proposedEdits?: OverviewImpactEdit[] } | null;
  const edits = Array.isArray(oi?.proposedEdits) ? oi!.proposedEdits! : [];
  if (edits.length === 0) return { applied: null, skipped: "no_proposed_edits" };
  // Fail-closed mapping from the PERSISTED internal verdict; anything unrecognized routes
  // undefined and the service holds every edit.
  const internal = rv.correctnessInternal;
  const routing = internal === "sound" ? "sound" as const
    : internal === "contested_defensible" ? "contested" as const
    : internal === "fatal_verified" ? "flawed" as const
    : internal === "fatal_alleged_unverified" ? "fatal_unverified" as const
    : undefined;
  const applied = await applyOverviewImpact(db, {
    overviewSlug: oi?.overviewSlug || defaultOverviewSlug, paperId, reviewVersionId: rv.id,
    correctnessPublic: routing, edits, claims: (rv.claims as ReviewClaim[] | null) ?? [],
  });
  return { applied };
}

// ---- Contribution transclusion (slice 3 — review<->page convergence, spec §2.1) -----
// The review is the PAPER-CENTRIC lens and the field page the NATURE-CENTRIC lens on one
// claim-and-justification store: the review explains the delta, the page explains the sum.
// The paper page's "Contribution to the Explanatory Structure" section is therefore a LIVE
// TRANSCLUSION of the paper's applied edit regions in the CURRENT page versions — never a
// separately-stored copy that drifts. A superseded contribution shows its current state via
// the span lineage chain (watching a contribution get absorbed or superseded is informative).
export type ContributionRegion = {
  pageSlug: string; pageTitle: string;
  status: "live" | "superseded";
  originalText: string;
  currentText: string | null; // for superseded: the live replacement via lineage, if traceable
  supportStatus: string;
};

export async function getContributionTransclusion(db: Db, paperId: string): Promise<{ regions: ContributionRegion[]; fallbackPassage: string | null }> {
  const spans = await db.select().from(pageSpansTable).where(eq(pageSpansTable.createdByPaperId, paperId));
  const regions: ContributionRegion[] = [];
  const latestByPage = new Map<string, string | null>();
  const pageMeta = new Map<string, { slug: string; title: string }>();
  for (const s of spans) {
    if (!latestByPage.has(s.pageId)) {
      latestByPage.set(s.pageId, (await latestVersion(db, s.pageId))?.id ?? null);
      const p = (await db.select().from(fieldPagesTable).where(eq(fieldPagesTable.id, s.pageId)).limit(1))[0];
      if (p) pageMeta.set(s.pageId, { slug: p.slug, title: p.title });
    }
    if (!s.versionId || s.versionId !== latestByPage.get(s.pageId)) continue; // only the CURRENT version
    const meta = pageMeta.get(s.pageId);
    if (!meta) continue;
    if (!s.superseded) {
      regions.push({ pageSlug: meta.slug, pageTitle: meta.title, status: "live", originalText: s.text, currentText: s.text, supportStatus: s.supportStatus });
    } else {
      // Follow the lineage chain to the live replacement (bounded walk; chains are short).
      let current: typeof s | null = s;
      for (let hop = 0; hop < 10 && current?.supersededBySpanId; hop += 1) {
        current = (await db.select().from(pageSpansTable).where(eq(pageSpansTable.id, current.supersededBySpanId)).limit(1))[0] ?? null;
        if (current && !current.superseded) break;
      }
      regions.push({
        pageSlug: meta.slug, pageTitle: meta.title, status: "superseded",
        originalText: s.text,
        currentText: current && current.id !== s.id && !current.superseded ? current.text : null,
        supportStatus: s.supportStatus,
      });
    }
  }
  // Fallback for papers whose review proposed no_change (they touched no page).
  const rv = (await db.select().from(reviewVersionsTable).where(eq(reviewVersionsTable.paperId, paperId)).orderBy(desc(reviewVersionsTable.createdAt)).limit(1))[0];
  return { regions, fallbackPassage: regions.length ? null : (rv?.contributionPassage || null) };
}

// ---- Corrections ledger (§3.2) — compact "what changed and why" per page, fed to the editor
// so a settled point isn't re-litigated and two models don't oscillate. Provenance-justified and
// reversible (derived from the applied-edit history; introduces no new store).
export async function assembleCorrectionsLedger(db: Db, overviewSlug: string, targetPageSlug?: string): Promise<string> {
  const rows = await db.select().from(proposedOverviewEditsTable)
    .where(eq(proposedOverviewEditsTable.overviewSlug, overviewSlug))
    .orderBy(desc(proposedOverviewEditsTable.createdAt));
  const scoped = targetPageSlug ? rows.filter((r: any) => r.targetPageSlug === targetPageSlug) : rows;
  if (scoped.length === 0) return "(no prior corrections)";
  // Truncation is ANNOTATED, never silent (P1.2); reverted/rejected entries are pinned so a
  // settled correction can't age out of view and get re-introduced.
  const CAP = 40;
  const pinned = scoped.filter((r: any) => r.status === "reverted" || r.status === "rejected");
  const rest = scoped.filter((r: any) => r.status !== "reverted" && r.status !== "rejected");
  const shown = [...pinned, ...rest.slice(0, Math.max(0, CAP - pinned.length))];
  const header = scoped.length > shown.length
    ? `(ledger truncated: showing ${shown.length} of ${scoped.length}; all reverted/held entries pinned)\n`
    : "";
  // Grouped PER PAGE (P2): the editor reads each page's own history, not one interleaved blob.
  const byPage = new Map<string, any[]>();
  for (const r of shown) {
    const key = r.targetPageSlug ?? overviewSlug;
    if (!byPage.has(key)) byPage.set(key, []);
    byPage.get(key)!.push(r);
  }
  const line = (r: any) => {
    const why = (r.editorRationale as OverviewEditorRationale | null)?.whatThisPaperAdds || r.reason || "";
    return `  - ${r.action}${r.status === "reverted" ? " (reverted)" : r.status === "rejected" ? " (held)" : ""}: ${String(why).slice(0, 160)}`;
  };
  return header + Array.from(byPage.entries())
    .map(([slug, rows]) => `[${slug}]\n${rows.map(line).join("\n")}`)
    .join("\n");
}

// ---- draft -> published (single switch, not a per-edit gate) -----------------------
export async function publishOverview(db: Db, overviewSlug: string) {
  const root = await getPageBySlug(db, overviewSlug);
  const pages = await db.select().from(fieldPagesTable);
  const scope = pages.filter((p: any) => p.slug === overviewSlug || p.parentPageId === (root?.id ?? "__none__"));
  let published = 0;
  for (const p of scope) {
    const v = await latestVersion(db, p.id);
    if (v && v.visibility === "draft") {
      await db.update(fieldPageVersionsTable).set({ visibility: "published" }).where(eq(fieldPageVersionsTable.id, v.id));
      published += 1;
    }
  }
  // Only promote applied drafts — never clobber rejected (safety-held) or reverted records;
  // publish is a visibility switch, not a rewrite of edit history (brief P0.4).
  await db.update(proposedOverviewEditsTable).set({ status: "published" })
    .where(and(eq(proposedOverviewEditsTable.overviewSlug, overviewSlug), eq(proposedOverviewEditsTable.status, "draft_applied")));
  return { publishedVersions: published };
}

// ---- rollback a page to a prior version (preserves history) ------------------------
// Restores the target version's SPANS and REFERENCES too (brief P0.1), by carrying forward
// from the rollback TARGET rather than from the (bad) latest version — chips reappear.
export async function rollbackPage(db: Db, pageId: string, toVersionId: string) {
  const target = (await db.select().from(fieldPageVersionsTable).where(and(eq(fieldPageVersionsTable.id, toVersionId), eq(fieldPageVersionsTable.pageId, pageId))).limit(1))[0];
  if (!target) throw new Error("rollback target version not found for page");
  const restored = await newDraftVersion(db, pageId, target.markdownFull,
    [{ at: new Date().toISOString(), action: `rolled back to version ${toVersionId}` }], null,
    { oneLine: target.summaryOneLine, short: target.summaryShort },
    toVersionId);
  return restored;
}
