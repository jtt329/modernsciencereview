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
import { and, desc, eq, inArray, sql as dsql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import {
  papersTable, reviewVersionsTable,
  fieldPagesTable, fieldPageVersionsTable, pageSectionsTable, pageReferencesTable,
  pageSpansTable, proposedOverviewEditsTable, attributionChecksTable, pageLinksTable,
  divergenceFlagsTable, pageBlocksTable, pageVersionBlocksTable, consistencyFindingsTable,
  type PageBlock, type PageBlockKind,
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
  linkTargetSlug?: string; // add_link destination / reorganize_parent new parent (from the index)
  parentSlug?: string; // create_page: parent from the index or created earlier in this batch (S2)
  reorganizeChildSlugs?: string[]; // reorganize_parent: existing pages to move (S2)
  targetBlockId?: string; // block substrate: precise block targeting (ids from the STEP-2 block listing)
  anchorText?: string;
  proposedMarkdown?: string;
  // Maintained multi-resolution summaries of the PAGE after this edit (slice 4) — the same
  // structure that powers the reader's [+] descent powers the editor's retrieval index.
  pageSummaryOneLine?: string;
  pageSummaryShort?: string;
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

// ===================== BLOCK SUBSTRATE (DESIGN_block_substrate.md, JT-approved) ==============
// Pages are ordered lists of IMMUTABLE block rows; markdownFull on a version is a DERIVED
// render cache. Every change (prose OR provenance) creates a new block generation with
// supersedesBlockId lineage; a version is a set of join rows pointing at block rows. The
// page-level carry-forward loop is retired: an untouched block's provenance rows are
// literally the same rows in the next version.

export type BlockDescriptor = { kind: PageBlockKind; markdown: string };
export type OrderedBlock = PageBlock & { orderKey: number };

export function splitMarkdownIntoBlocks(markdown: string): BlockDescriptor[] {
  return markdown.split(/\n{2,}/).map((c) => c.trim()).filter(Boolean).map((c) => ({
    kind: (c.startsWith("#") ? "heading"
      : c.startsWith("$$") ? "equation_display"
      : /^[-*] /.test(c) ? "list"
      : c.startsWith(">") ? "quote"
      : "paragraph") as PageBlockKind,
    markdown: c,
  }));
}

export function renderBlocksToMarkdown(blocks: { markdown: string }[]): string {
  return blocks.map((b) => b.markdown).join("\n\n") + (blocks.length ? "\n" : "");
}

const ORDER_STEP = 1024; // insertion-tolerant ordering: appends step by this, inserts take midpoints

export async function blocksOfVersion(db: Db, versionId: string): Promise<OrderedBlock[]> {
  const joins = await db.select().from(pageVersionBlocksTable).where(eq(pageVersionBlocksTable.versionId, versionId));
  if (joins.length === 0) return [];
  const rows = await db.select().from(pageBlocksTable).where(inArray(pageBlocksTable.id, joins.map((j: any) => j.blockId)));
  const byId = new Map(rows.map((b: any) => [b.id, b]));
  return joins
    .sort((a: any, b: any) => a.orderKey - b.orderKey)
    .map((j: any) => ({ ...(byId.get(j.blockId) as PageBlock), orderKey: j.orderKey }))
    .filter((b: any) => b.id);
}

// Create a new DRAFT version from an explicit ordered block set. The render cache, sections,
// and page pointer are maintained here; NO provenance copying happens (that is the point).
async function newVersionWithBlockSet(
  db: Db, pageId: string, blockSet: { blockId: string; orderKey: number }[],
  changeLog: FieldPageChangeLogEntry[], createdByUserId?: string | null,
  summaries?: { oneLine?: string; short?: string },
) {
  const prev = await latestVersion(db, pageId);
  const priorLog = (prev?.changeLog as FieldPageChangeLogEntry[] | undefined) ?? [];
  const blockRows = blockSet.length
    ? await db.select().from(pageBlocksTable).where(inArray(pageBlocksTable.id, blockSet.map((b) => b.blockId)))
    : [];
  const byId = new Map(blockRows.map((b: any) => [b.id, b]));
  const ordered = [...blockSet].sort((a, b) => a.orderKey - b.orderKey).map((b) => byId.get(b.blockId)).filter(Boolean) as PageBlock[];
  const rendered = renderBlocksToMarkdown(ordered);
  const [version] = await db.insert(fieldPageVersionsTable).values({
    pageId,
    versionNumber: (prev?.versionNumber ?? 0) + 1,
    summaryOneLine: summaries?.oneLine ?? prev?.summaryOneLine ?? "",
    summaryShort: summaries?.short ?? prev?.summaryShort ?? "",
    markdownFull: rendered, // derived render cache — blocks are the store
    visibility: "draft",
    changeLog: [...priorLog, ...changeLog],
    createdByUserId: createdByUserId ?? null,
  }).returning();
  for (const b of blockSet) {
    await db.insert(pageVersionBlocksTable).values({ versionId: version.id, blockId: b.blockId, orderKey: b.orderKey });
  }
  await db.update(fieldPagesTable)
    .set({ currentVersionId: version.id, updatedAt: new Date() })
    .where(eq(fieldPagesTable.id, pageId));
  await regenerateSections(db, pageId, version.id, rendered);
  return version;
}

// New block generation: immutable rows — every change is a new row with lineage.
async function insertBlock(db: Db, args: {
  pageId: string; kind: PageBlockKind; markdown: string;
  supersedesBlockId?: string | null; reviewVersionId?: string | null; paperId?: string | null;
}) {
  const [row] = await db.insert(pageBlocksTable).values({
    pageId: args.pageId, kind: args.kind, markdown: args.markdown,
    supersedesBlockId: args.supersedesBlockId ?? null,
    createdByReviewVersionId: args.reviewVersionId ?? null, createdByPaperId: args.paperId ?? null,
  }).returning();
  return row;
}

// Block-generation provenance copy (bounded, block-scoped — NOT the old page-wide loop):
// when a block gets a new generation (rewrite/sourcing/link), its spans/refs/links whose text
// still appears in the new markdown are copied re-anchored; the rest stay on the old
// generation as history.
async function copyBlockProvenance(db: Db, oldBlockId: string, newBlock: PageBlock) {
  const refIdMap = new Map<string, string>();
  const refs = await db.select().from(pageReferencesTable).where(eq(pageReferencesTable.blockId, oldBlockId));
  for (const r of refs) {
    const anchor = r.anchorText ?? "";
    const idx = anchor ? newBlock.markdown.indexOf(anchor) : -1;
    if (idx < 0 && anchor) continue; // anchored text gone — history keeps the old generation's row
    const [copy] = await db.insert(pageReferencesTable).values({
      pageId: r.pageId, versionId: r.versionId, blockId: newBlock.id,
      startOffsetInBlock: idx >= 0 ? idx : null, endOffsetInBlock: idx >= 0 ? idx + anchor.length : null,
      sectionId: r.sectionId, anchorText: r.anchorText, anchorStartOffset: null, anchorEndOffset: null,
      paperId: r.paperId, reviewVersionId: r.reviewVersionId, externalReferenceId: r.externalReferenceId,
      claimIds: r.claimIds, claimStatus: r.claimStatus, note: r.note, status: r.status, provenance: r.provenance,
    }).returning();
    refIdMap.set(r.id, copy.id);
  }
  const spans = await db.select().from(pageSpansTable).where(eq(pageSpansTable.blockId, oldBlockId));
  for (const s of spans) {
    const idx = s.text ? newBlock.markdown.indexOf(s.text) : -1;
    if (idx < 0) continue;
    await db.insert(pageSpansTable).values({
      pageId: s.pageId, versionId: s.versionId, blockId: newBlock.id,
      startOffsetInBlock: idx, endOffsetInBlock: idx + s.text.length,
      sectionSlug: s.sectionSlug, text: s.text, startOffset: null, endOffset: null,
      supportStatus: s.supportStatus, superseded: false,
      referenceId: s.referenceId ? (refIdMap.get(s.referenceId) ?? s.referenceId) : null,
      createdByReviewVersionId: s.createdByReviewVersionId, createdByPaperId: s.createdByPaperId,
    });
  }
  const links = await db.select().from(pageLinksTable).where(eq(pageLinksTable.blockId, oldBlockId));
  for (const l of links) {
    const idx = l.phrase ? newBlock.markdown.indexOf(l.phrase) : -1;
    if (idx < 0) continue;
    await db.insert(pageLinksTable).values({
      fromPageId: l.fromPageId, toPageId: l.toPageId, phrase: l.phrase,
      blockId: newBlock.id, startOffsetInBlock: idx, endOffsetInBlock: idx + l.phrase.length,
      versionId: l.versionId, anchorStartOffset: null, anchorEndOffset: null,
      superseded: false, createdByReviewVersionId: l.createdByReviewVersionId,
    });
  }
}

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

// LEGACY-SHAPED creator (markdown in) — now BLOCK-NATIVE: splits the markdown into fresh
// immutable block rows and creates the version from that set. Used for brand-new pages
// (skeleton, create_subpage, disputed auto-create); existing pages evolve per-block in the
// edit branches. The page-wide provenance carry-forward is RETIRED: an untouched block's
// spans/refs/links are literally the same rows in the next version (block membership).
async function newDraftVersion(
  db: Db, pageId: string, markdown: string,
  changeLog: FieldPageChangeLogEntry[], createdByUserId?: string | null,
  summaries?: { oneLine?: string; short?: string },
  provenanceIds?: { reviewVersionId?: string | null; paperId?: string | null },
) {
  const descriptors = splitMarkdownIntoBlocks(markdown);
  const blockSet: { blockId: string; orderKey: number }[] = [];
  let key = ORDER_STEP;
  for (const d of descriptors) {
    const block = await insertBlock(db, { pageId, kind: d.kind, markdown: d.markdown, reviewVersionId: provenanceIds?.reviewVersionId ?? null, paperId: provenanceIds?.paperId ?? null });
    blockSet.push({ blockId: block.id, orderKey: key });
    key += ORDER_STEP;
  }
  return newVersionWithBlockSet(db, pageId, blockSet, changeLog, createdByUserId, summaries);
}

// ---- Block-set helpers (insertion-tolerant ordering) --------------------------------
type BlockSetEntry = { blockId: string; orderKey: number };

function setAppend(set: BlockSetEntry[], blockIds: string[]): BlockSetEntry[] {
  const max = set.length ? Math.max(...set.map((b) => b.orderKey)) : 0;
  return [...set, ...blockIds.map((id, i) => ({ blockId: id, orderKey: max + ORDER_STEP * (i + 1) }))];
}
function setInsertAfter(set: BlockSetEntry[], afterKey: number, blockIds: string[]): BlockSetEntry[] {
  const sorted = [...set].sort((a, b) => a.orderKey - b.orderKey);
  const next = sorted.find((b) => b.orderKey > afterKey);
  const hi = next ? next.orderKey : afterKey + ORDER_STEP * (blockIds.length + 1);
  const step = (hi - afterKey) / (blockIds.length + 1);
  return [...set, ...blockIds.map((id, i) => ({ blockId: id, orderKey: afterKey + step * (i + 1) }))];
}
function setReplace(set: BlockSetEntry[], oldBlockId: string, blockIds: string[]): BlockSetEntry[] {
  const old = set.find((b) => b.blockId === oldBlockId);
  if (!old) return set;
  const rest = set.filter((b) => b.blockId !== oldBlockId);
  return setInsertAfter(rest, old.orderKey - 1e-6, blockIds);
}
// Section range on blocks: the heading block whose title slug matches, through the block
// before the next heading (or the end).
function sectionEndKey(blocks: OrderedBlock[], sectionSlug: string): number | null {
  let inSection = false; let lastKey: number | null = null;
  for (const b of blocks) {
    if (b.kind === "heading") {
      if (inSection) break;
      const title = b.markdown.replace(/^#+\s*/, "").trim();
      if (slugify(title) === sectionSlug) { inSection = true; lastKey = b.orderKey; }
      continue;
    }
    if (inSection) lastKey = b.orderKey;
  }
  return inSection ? lastKey : null;
}

async function createReference(
  db: Db, args: {
    pageId: string; versionId: string; blockId: string; blockMarkdown: string; anchorText: string;
    paperId: string; reviewVersionId?: string | null; claimIds: string[];
    claimStatus?: ChipClaimStatus | null;
    provenance: "model_review" | "seed_overview" | "admin_manual"; note?: string;
  },
) {
  const idx = args.blockMarkdown.indexOf(args.anchorText);
  const [ref] = await db.insert(pageReferencesTable).values({
    pageId: args.pageId, versionId: args.versionId, blockId: args.blockId,
    anchorText: args.anchorText,
    startOffsetInBlock: idx >= 0 ? idx : null,
    endOffsetInBlock: idx >= 0 ? idx + args.anchorText.length : null,
    paperId: args.paperId, reviewVersionId: args.reviewVersionId ?? null,
    claimIds: args.claimIds, claimStatus: args.claimStatus ?? null, note: args.note ?? "",
    status: "approved", provenance: args.provenance,
  }).returning();
  return ref;
}

async function createSpan(
  db: Db, args: {
    pageId: string; versionId: string; blockId: string; blockMarkdown: string;
    sectionSlug?: string | null; text: string;
    supportStatus: SpanSupportStatus; referenceId?: string | null;
    reviewVersionId?: string | null; paperId?: string | null;
  },
) {
  const idx = args.blockMarkdown.indexOf(args.text);
  const [span] = await db.insert(pageSpansTable).values({
    pageId: args.pageId, versionId: args.versionId, blockId: args.blockId,
    sectionSlug: args.sectionSlug ?? null,
    text: args.text.slice(0, 4000),
    startOffsetInBlock: idx >= 0 ? idx : null,
    endOffsetInBlock: idx >= 0 ? idx + Math.min(args.text.length, 4000) : null,
    supportStatus: args.supportStatus, referenceId: args.referenceId ?? null,
    createdByReviewVersionId: args.reviewVersionId ?? null, createdByPaperId: args.paperId ?? null,
  }).returning();
  return span;
}

// Resolve cited paper ids against real papers — the hard integrity check (§10.2). Anything
// unresolved is a dangling citation and must NOT become a stored reference.
async function resolveCitedPapers(db: Db, ids: string[]): Promise<{ resolved: string[]; dropped: string[] }> {
  const unique = Array.from(new Set((ids ?? []).filter(Boolean)));
  if (unique.length === 0) return { resolved: [], dropped: [] };
  const rows = await db.select({ id: papersTable.id }).from(papersTable).where(inArray(papersTable.id, unique));
  const found = new Set(rows.map((r: any) => r.id));
  return { resolved: unique.filter((id) => found.has(id)), dropped: unique.filter((id) => !found.has(id)) };
}

// Deterministic key for one edit within one review — the idempotency unit (P1.4).
function editIdempotencyKey(input: ApplyOverviewInput, edit: OverviewImpactEdit): string {
  return createHash("sha256").update(JSON.stringify({
    rv: input.reviewVersionId ?? null, paper: input.paperId, overview: input.overviewSlug,
    action: edit.action, target: edit.targetPageSlug ?? null, section: edit.targetSectionSlug ?? null,
    linkTarget: edit.linkTargetSlug ?? null, block: edit.targetBlockId ?? null,
    parent: edit.parentSlug ?? null, reorg: edit.reorganizeChildSlugs ?? [],
    anchor: edit.anchorText ?? null, md: edit.proposedMarkdown ?? "",
    cp: edit.citedPaperIds ?? [], cc: edit.citedClaimIds ?? [],
  })).digest("hex").slice(0, 40);
}

// Per-field serialization (slice 6): in-process promise chain as the fast path; the Postgres
// advisory lock inside each edit's transaction covers multi-process appliers (JT-approved).
const fieldLocks = new Map<string, Promise<unknown>>();

export async function applyOverviewImpact(db: Db, input: ApplyOverviewInput): Promise<AppliedEditResult[]> {
  const prev = fieldLocks.get(input.overviewSlug) ?? Promise.resolve();
  const run = prev.then(() => applyOverviewImpactInner(db, input), () => applyOverviewImpactInner(db, input));
  fieldLocks.set(input.overviewSlug, run.then(() => undefined, () => undefined));
  return run;
}

async function applyOverviewImpactInner(db: Db, input: ApplyOverviewInput): Promise<AppliedEditResult[]> {
  const provenance = input.provenance ?? "model_review";
  const results: AppliedEditResult[] = [];
  const disputedSlug = `${input.overviewSlug}-${DISPUTED_PAGE_SLUG_SUFFIX}`;
  // Fail closed (P0.3): unknown correctness -> hold every edit; never default to the sound path.
  const KNOWN_CORRECTNESS = ["sound", "contested", "flawed", "hidden", "fatal_unverified"];
  const correctnessKnown = input.correctnessPublic != null && KNOWN_CORRECTNESS.includes(input.correctnessPublic);

  for (const edit of input.edits) {
    // Idempotency (P1.4): re-applying the same review's edit is a no-op.
    const idempotencyKey = editIdempotencyKey(input, edit);
    const dup = (await db.select().from(proposedOverviewEditsTable).where(eq(proposedOverviewEditsTable.idempotencyKey, idempotencyKey)).limit(1))[0];
    if (dup && (dup.status === "draft_applied" || dup.status === "published")) {
      results.push({ action: edit.action, targetPageSlug: dup.targetPageSlug ?? null, status: "skipped_idempotent", proposedOverviewEditId: dup.id, appliedVersionId: dup.appliedVersionId ?? undefined });
      continue;
    }

    // Each edit applies ATOMICALLY (P1.4). BLOCK SUBSTRATE: an edit touches exactly the block
    // generations it changes; untouched blocks' provenance rows carry into the new version by
    // membership — no page-wide copying.
    const applyOne = async (tx: Db): Promise<AppliedEditResult> => {
      // Postgres advisory lock (JT-approved): serializes appliers across PROCESSES per field;
      // released at commit. The in-process promise chain remains as the cheap fast path.
      await (tx as any).execute(dsql`SELECT pg_advisory_xact_lock(hashtext(${input.overviewSlug}))`);
      // Equation-fidelity WATCH (P2): stored on the edit row; live pipeline adds image verification.
      const eqUnmatched = checkEquationFidelity(edit.proposedMarkdown ?? "", input.claims ?? []).map((f) => f.equation);
      const equationFlags: EquationFlags | null = eqUnmatched.length ? { unmatched: eqUnmatched } : null;
      const recordEdit = async (
        status: "draft_applied" | "rejected" | "no_change",
        extra: { targetPageSlug?: string | null; appliedVersionId?: string; rejectionReason?: string; structuralChange?: { newParentSlug: string; children: { slug: string; oldParentSlug: string | null }[] } } = {},
      ) => {
        const [row] = await tx.insert(proposedOverviewEditsTable).values({
          reviewVersionId: input.reviewVersionId ?? null, paperId: input.paperId,
          overviewSlug: input.overviewSlug, action: edit.action, editType: edit.editType ?? null,
          targetPageSlug: extra.targetPageSlug ?? edit.targetPageSlug ?? null,
          targetSectionSlug: edit.targetSectionSlug ?? null,
          linkTargetSlug: edit.linkTargetSlug ?? null,
          parentSlug: edit.parentSlug ?? null,
          structuralChange: extra.structuralChange ?? null,
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
      // Pending correctness holds everything: verification precedes edits (§10.6).
      if (input.correctnessPublic === "fatal_unverified") {
        const id = await recordEdit("rejected", { rejectionReason: "fatal_unverified: unverified fatal allegation — edits held pending image-grounded verification (verification precedes edits)" });
        return { action: edit.action, targetPageSlug: edit.targetPageSlug ?? null, status: "rejected", proposedOverviewEditId: id, rejectionReason: "fatal_unverified" };
      }
      // Integrity: paper text is data (model self-report), plus the INDEPENDENT screen (P2).
      const sc = edit.safetyCheck;
      if (sc && (sc.paperTextTreatedAsData === false || (sc.suspiciousInstructionsDetected && sc.actionTaken !== "ignored_instructions"))) {
        const id = await recordEdit("rejected", { rejectionReason: "safety: suspicious instructions held for manual_review" });
        return { action: edit.action, targetPageSlug: edit.targetPageSlug ?? null, status: "rejected", proposedOverviewEditId: id, rejectionReason: "manual_review" };
      }
      const screen = independentInjectionScreen(edit.proposedMarkdown ?? "");
      if (screen.tripped) {
        const id = await recordEdit("rejected", { rejectionReason: `injection_screen: independent pattern screen tripped ("${screen.pattern}") — held for manual_review` });
        return { action: edit.action, targetPageSlug: edit.targetPageSlug ?? null, status: "rejected", proposedOverviewEditId: id, rejectionReason: "injection_screen" };
      }

      // EXPLANATION-FIRST sourcing (§3.2/§10.2a): the reviewed paper self-sources its claims;
      // other cited ids resolve against the DB or are dropped (never dangling/mis-attributed).
      const { dropped } = await resolveCitedPapers(tx, (edit.citedPaperIds ?? []).filter((x) => x !== input.paperId));
      const wantsSource = edit.supportStatus === "sourced" || (edit.citedClaimIds?.length ?? 0) > 0
        || (edit.citedPaperIds ?? []).some((x) => x === input.paperId) || edit.action === "add_reference";
      const isSourced = wantsSource;
      const sourcePaperId = isSourced ? input.paperId : null;
      const claimIds = edit.citedClaimIds ?? [];
      const supportStatus: SpanSupportStatus = isSourced ? "sourced" : (edit.supportStatus ?? "unsourced_explanatory");
      const claimStatus = chipStatusFromClaims(claimIds, input.claims);
      const provIds = { reviewVersionId: input.reviewVersionId ?? null, paperId: input.paperId };
      const summaries = { oneLine: edit.pageSummaryOneLine, short: edit.pageSummaryShort };

      // Fatal routing: a flawed paper may only touch the disputed page.
      const isCreatePage = edit.action === "create_page" || edit.action === "create_subpage"; // create_subpage = legacy alias
      const targetSlug = input.correctnessPublic === "flawed"
        ? disputedSlug
        : (isCreatePage ? (edit.targetPageSlug || slugify(edit.proposedMarkdown?.split("\n")[0] ?? "new-page")) : (edit.targetPageSlug || input.overviewSlug));

      // reorganize_parent (S2): a versioned, reversible STRUCTURAL edit — re-parent existing
      // pages under a better parent. Slug discipline holds: parent + children from the index
      // (or created earlier in this batch); never invented.
      if (edit.action === "reorganize_parent") {
        const newParent = edit.linkTargetSlug ? await getPageBySlug(tx, edit.linkTargetSlug) : null;
        if (!newParent) {
          const id = await recordEdit("rejected", { rejectionReason: "unknown_parent_slug: reorganize_parent target does not exist" });
          return { action: edit.action, targetPageSlug: edit.linkTargetSlug ?? null, status: "rejected", proposedOverviewEditId: id, rejectionReason: "unknown_parent_slug" };
        }
        const childSlugs = (edit.reorganizeChildSlugs ?? []).filter((s) => s && s !== edit.linkTargetSlug);
        const children: { slug: string; oldParentSlug: string | null; id: string }[] = [];
        for (const cs of childSlugs) {
          const child = await getPageBySlug(tx, cs);
          if (!child) {
            const id = await recordEdit("rejected", { rejectionReason: `unknown_target_slug: reorganize child "${cs}" does not exist` });
            return { action: edit.action, targetPageSlug: edit.linkTargetSlug ?? null, status: "rejected", proposedOverviewEditId: id, rejectionReason: "unknown_target_slug" };
          }
          const oldParent = child.parentPageId ? (await tx.select().from(fieldPagesTable).where(eq(fieldPagesTable.id, child.parentPageId)))[0] : null;
          children.push({ slug: cs, oldParentSlug: oldParent?.slug ?? null, id: child.id });
        }
        if (children.length === 0) {
          const id = await recordEdit("rejected", { rejectionReason: "empty_edit: reorganize_parent with no children" });
          return { action: edit.action, targetPageSlug: edit.linkTargetSlug ?? null, status: "rejected", proposedOverviewEditId: id, rejectionReason: "empty_edit" };
        }
        for (const c of children) await tx.update(fieldPagesTable).set({ parentPageId: newParent.id, updatedAt: new Date() }).where(eq(fieldPagesTable.id, c.id));
        const id = await recordEdit("draft_applied", { targetPageSlug: edit.linkTargetSlug, structuralChange: { newParentSlug: edit.linkTargetSlug!, children: children.map(({ slug, oldParentSlug }) => ({ slug, oldParentSlug })) } });
        return { action: "reorganize_parent", targetPageSlug: edit.linkTargetSlug ?? null, status: "draft_applied", proposedOverviewEditId: id };
      }

      // create_page (S2; create_subpage is the legacy alias): brand-new page with an EMERGENT
      // parent — parentSlug from the index or created earlier in this batch; empty = top level.
      if (isCreatePage && input.correctnessPublic !== "flawed") {
        const existing = await getPageBySlug(tx, targetSlug);
        if (existing) {
          edit.action = "add_paragraph"; // slug exists — improve it, don't duplicate
        } else {
          let parent = null as any;
          if (edit.parentSlug) {
            parent = await getPageBySlug(tx, edit.parentSlug);
            if (!parent) {
              const id = await recordEdit("rejected", { targetPageSlug: targetSlug, rejectionReason: "unknown_parent_slug: create_page parent does not exist (use the index or create it earlier in this batch)" });
              return { action: edit.action, targetPageSlug: targetSlug, status: "rejected", proposedOverviewEditId: id, rejectionReason: "unknown_parent_slug" };
            }
          } else if (edit.action === "create_subpage") {
            parent = await getPageBySlug(tx, input.overviewSlug); // legacy alias default
          }
          const title = (edit.proposedMarkdown?.match(/^#+\s*(.+)/)?.[1] || targetSlug.replace(/-/g, " ")).slice(0, 120);
          const [page] = await tx.insert(fieldPagesTable).values({ slug: targetSlug, title, parentPageId: parent?.id ?? null, scopeStatement: edit.reason ?? "", summary: "" }).returning();
          const md = edit.proposedMarkdown ?? `## ${title}\n`;
          const version = await newDraftVersion(tx, page.id, md, [{ at: new Date().toISOString(), action: `create_subpage from paper ${input.paperId}`, note: edit.reason }], input.createdByUserId, summaries, provIds);
          const vBlocks = await blocksOfVersion(tx, version.id);
          const firstContent = vBlocks.find((b) => b.kind !== "heading") ?? vBlocks[0];
          let refId: string | undefined; let spanId: string | undefined;
          if (firstContent) {
            if (isSourced && sourcePaperId) {
              const ref = await createReference(tx, { pageId: page.id, versionId: version.id, blockId: firstContent.id, blockMarkdown: firstContent.markdown, anchorText: edit.anchorText || firstContent.markdown.slice(0, 120), paperId: sourcePaperId, reviewVersionId: input.reviewVersionId, claimIds, claimStatus, provenance });
              refId = ref.id;
            }
            const span = await createSpan(tx, { pageId: page.id, versionId: version.id, blockId: firstContent.id, blockMarkdown: firstContent.markdown, text: firstContent.markdown.slice(0, 400), supportStatus, referenceId: refId ?? null, reviewVersionId: input.reviewVersionId, paperId: input.paperId });
            spanId = span.id;
          }
          const id = await recordEdit("draft_applied", { targetPageSlug: targetSlug, appliedVersionId: version.id });
          if (firstContent) await recordAttributionWatch({ editId: id, refId, spanId, pageId: page.id, anchoredText: firstContent.markdown.slice(0, 400) });
          return { action: edit.action, targetPageSlug: targetSlug, status: "draft_applied", proposedOverviewEditId: id, appliedVersionId: version.id, referenceId: refId, spanId, supportStatus, droppedCitations: dropped };
        }
      }

      // Resolve the target page. SLUG DISCIPLINE (P1.5) unchanged.
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
      const currentVersion = await latestVersion(tx, page.id);
      const blocks = currentVersion ? await blocksOfVersion(tx, currentVersion.id) : [];
      if (blocks.length === 0) {
        // Pre-block page (should not occur on fresh substrates) — loud reject rather than a
        // silent string fallback; migrate first (migrateToBlocks).
        const id = await recordEdit("rejected", { targetPageSlug: targetSlug, rejectionReason: "page_not_migrated: page has no block substrate — run migrateToBlocks first" });
        return { action: edit.action, targetPageSlug: targetSlug, status: "rejected", proposedOverviewEditId: id, rejectionReason: "page_not_migrated" };
      }
      const currentSet: BlockSetEntry[] = blocks.map((b) => ({ blockId: b.id, orderKey: b.orderKey }));
      const findBlockByAnchor = (anchor: string | undefined | null): OrderedBlock | undefined => {
        if (edit.targetBlockId) { const byId = blocks.find((b) => b.id === edit.targetBlockId); if (byId) return byId; }
        if (!anchor) return undefined;
        return blocks.find((b) => b.markdown.includes(anchor));
      };
      const logEntry = (action: string) => [{ at: new Date().toISOString(), action, note: edit.reason }];

      if (edit.action === "add_link") {
        // Inter-page link (slice 1) on the block substrate: a new generation of the block
        // carrying the phrase; the link row hangs off the new generation.
        const linkTarget = edit.linkTargetSlug ? await getPageBySlug(tx, edit.linkTargetSlug) : null;
        if (!linkTarget) {
          const id = await recordEdit("rejected", { targetPageSlug: targetSlug, rejectionReason: "unknown_link_target: link destination slug does not exist (choose from the supplied index)" });
          return { action: edit.action, targetPageSlug: targetSlug, status: "rejected", proposedOverviewEditId: id, rejectionReason: "unknown_link_target" };
        }
        const phrase = edit.anchorText?.trim() ?? "";
        const host = findBlockByAnchor(phrase);
        if (!phrase || !host) {
          const id = await recordEdit("rejected", { targetPageSlug: targetSlug, rejectionReason: "anchor_not_found: link phrase not present on the page" });
          return { action: edit.action, targetPageSlug: targetSlug, status: "rejected", proposedOverviewEditId: id, rejectionReason: "anchor_not_found" };
        }
        const gen = await insertBlock(tx, { pageId: page.id, kind: host.kind, markdown: host.markdown, supersedesBlockId: host.id, reviewVersionId: input.reviewVersionId, paperId: input.paperId });
        await copyBlockProvenance(tx, host.id, gen);
        const version = await newVersionWithBlockSet(tx, page.id, setReplace(currentSet, host.id, [gen.id]), logEntry(`add_link "${phrase.slice(0, 40)}" -> ${edit.linkTargetSlug} from paper ${input.paperId}`), input.createdByUserId, summaries);
        const idx = gen.markdown.indexOf(phrase);
        await tx.insert(pageLinksTable).values({
          fromPageId: page.id, toPageId: linkTarget.id, phrase, blockId: gen.id,
          startOffsetInBlock: idx, endOffsetInBlock: idx + phrase.length,
          versionId: version.id, createdByReviewVersionId: input.reviewVersionId ?? null,
        });
        const id = await recordEdit("draft_applied", { targetPageSlug: targetSlug, appliedVersionId: version.id });
        return { action: "add_link", targetPageSlug: targetSlug, status: "draft_applied", proposedOverviewEditId: id, appliedVersionId: version.id };
      }

      if (edit.action === "add_reference") {
        // Accretion (§3.2): source an existing sentence — a new generation of its block with the
        // span converted to sourced. A phrase on no block is a LOUD anchor miss (P1.1
        // discipline; the old floating-span behavior was a silent mis-anchor).
        const anchor = edit.anchorText?.trim() ?? "";
        const host = findBlockByAnchor(anchor);
        if (!anchor || !host) {
          const id = await recordEdit("rejected", { targetPageSlug: targetSlug, rejectionReason: "anchor_not_found: sentence to source not present on the page" });
          return { action: edit.action, targetPageSlug: targetSlug, status: "rejected", proposedOverviewEditId: id, rejectionReason: "anchor_not_found" };
        }
        const gen = await insertBlock(tx, { pageId: page.id, kind: host.kind, markdown: host.markdown, supersedesBlockId: host.id, reviewVersionId: input.reviewVersionId, paperId: input.paperId });
        await copyBlockProvenance(tx, host.id, gen);
        const version = await newVersionWithBlockSet(tx, page.id, setReplace(currentSet, host.id, [gen.id]), logEntry(`add_reference (source span) from paper ${input.paperId}`), input.createdByUserId, summaries);
        let refId: string | undefined, spanId: string | undefined, finalStatus: SpanSupportStatus = supportStatus;
        if (isSourced && sourcePaperId) {
          const ref = await createReference(tx, { pageId: page.id, versionId: version.id, blockId: gen.id, blockMarkdown: gen.markdown, anchorText: anchor, paperId: sourcePaperId, reviewVersionId: input.reviewVersionId, claimIds, claimStatus, provenance });
          refId = ref.id;
          const genSpans = await tx.select().from(pageSpansTable).where(eq(pageSpansTable.blockId, gen.id));
          const match = genSpans.find((s: any) => s.text && (s.text.includes(anchor) || (anchor.length > 20 && anchor.includes(s.text.slice(0, 40)))));
          if (match) { await tx.update(pageSpansTable).set({ supportStatus: "sourced", referenceId: ref.id }).where(eq(pageSpansTable.id, match.id)); spanId = match.id; finalStatus = "sourced"; }
          else { const sp = await createSpan(tx, { pageId: page.id, versionId: version.id, blockId: gen.id, blockMarkdown: gen.markdown, text: anchor, supportStatus: "sourced", referenceId: ref.id, reviewVersionId: input.reviewVersionId, paperId: input.paperId }); spanId = sp.id; }
        }
        const id = await recordEdit("draft_applied", { targetPageSlug: targetSlug, appliedVersionId: version.id });
        await recordAttributionWatch({ editId: id, refId, spanId, pageId: page.id, anchoredText: anchor });
        return { action: "add_reference", targetPageSlug: targetSlug, status: "draft_applied", proposedOverviewEditId: id, appliedVersionId: version.id, referenceId: refId, spanId, supportStatus: finalStatus, droppedCitations: dropped };
      }

      // Prose edits on blocks: rewrite = new generation(s) replacing the host block;
      // add_paragraph/add_subsection/merge = new blocks inserted/appended.
      const para = (edit.proposedMarkdown ?? "").trim();
      const newDescriptors = splitMarkdownIntoBlocks(edit.action === "add_subsection" && !para.startsWith("#")
        ? `## ${(edit.targetSectionSlug ? edit.targetSectionSlug.replace(/-/g, " ") : para.split("\n")[0].slice(0, 60))}\n\n${para}`
        : para);
      if (newDescriptors.length === 0) {
        const id = await recordEdit("rejected", { targetPageSlug: targetSlug, rejectionReason: "empty_edit: no prose supplied" });
        return { action: edit.action, targetPageSlug: targetSlug, status: "rejected", proposedOverviewEditId: id, rejectionReason: "empty_edit" };
      }

      let newSet: BlockSetEntry[];
      let supersededHost: OrderedBlock | undefined;
      if (edit.action === "edit_existing_text") {
        supersededHost = findBlockByAnchor(edit.anchorText);
        if (!supersededHost) {
          // Loud failure, never a silent append (P1.1).
          const id = await recordEdit("rejected", { targetPageSlug: targetSlug, rejectionReason: "anchor_not_found" });
          return { action: edit.action, targetPageSlug: targetSlug, status: "rejected", proposedOverviewEditId: id, rejectionReason: "anchor_not_found" };
        }
      } else if (edit.action === "add_paragraph" && edit.targetSectionSlug) {
        const endKey = sectionEndKey(blocks, edit.targetSectionSlug);
        if (endKey == null) {
          const id = await recordEdit("rejected", { targetPageSlug: targetSlug, rejectionReason: "section_not_found" });
          return { action: edit.action, targetPageSlug: targetSlug, status: "rejected", proposedOverviewEditId: id, rejectionReason: "section_not_found" };
        }
      }
      const newBlocks: PageBlock[] = [];
      for (let i = 0; i < newDescriptors.length; i += 1) {
        const d = newDescriptors[i];
        newBlocks.push(await insertBlock(tx, {
          pageId: page.id, kind: d.kind, markdown: d.markdown,
          supersedesBlockId: edit.action === "edit_existing_text" && i === 0 ? supersededHost!.id : null,
          reviewVersionId: input.reviewVersionId, paperId: input.paperId,
        }));
      }
      if (edit.action === "edit_existing_text") {
        await copyBlockProvenance(tx, supersededHost!.id, newBlocks[0]);
        newSet = setReplace(currentSet, supersededHost!.id, newBlocks.map((b) => b.id));
      } else if (edit.action === "add_paragraph" && edit.targetSectionSlug) {
        newSet = setInsertAfter(currentSet, sectionEndKey(blocks, edit.targetSectionSlug)!, newBlocks.map((b) => b.id));
      } else {
        newSet = setAppend(currentSet, newBlocks.map((b) => b.id));
      }
      const version = await newVersionWithBlockSet(tx, page.id, newSet, logEntry(`${edit.action} from paper ${input.paperId}`), input.createdByUserId, summaries);
      const anchorBlock = newBlocks.find((b) => b.kind !== "heading") ?? newBlocks[0];
      const insertedText = anchorBlock.markdown;
      let refId: string | undefined;
      if (isSourced && sourcePaperId) {
        const ref = await createReference(tx, { pageId: page.id, versionId: version.id, blockId: anchorBlock.id, blockMarkdown: anchorBlock.markdown, anchorText: insertedText.slice(0, 200), paperId: sourcePaperId, reviewVersionId: input.reviewVersionId, claimIds, claimStatus, provenance });
        refId = ref.id;
      }
      const span = await createSpan(tx, { pageId: page.id, versionId: version.id, blockId: anchorBlock.id, blockMarkdown: anchorBlock.markdown, sectionSlug: edit.targetSectionSlug ?? null, text: insertedText, supportStatus, referenceId: refId ?? null, reviewVersionId: input.reviewVersionId, paperId: input.paperId });
      const id = await recordEdit("draft_applied", { targetPageSlug: targetSlug, appliedVersionId: version.id });
      await recordAttributionWatch({ editId: id, refId, spanId: span.id, pageId: page.id, anchoredText: insertedText });
      return { action: edit.action, targetPageSlug: targetSlug, status: "draft_applied", proposedOverviewEditId: id, appliedVersionId: version.id, referenceId: refId, spanId: span.id, supportStatus, droppedCitations: dropped };
    };

    try {
      results.push(await (db as any).transaction(async (tx: Db) => applyOne(tx)));
    } catch (e) {
      // The transaction rolled back — record the failure OUTSIDE it (auditable, loud, retryable).
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
  // Extract display $$...$$ blocks FIRST, then inline $...$ on the remainder — a naive single
  // regex mispairs the closing $ of a display block with the opening $ of the next inline math
  // and "verifies" the prose fragment between them (seen in the Frodden spot run).
  const extractMath = (s: string) => {
    const display = s.match(/\$\$[^$]+\$\$/g) ?? [];
    const rest = s.replace(/\$\$[^$]+\$\$/g, " ");
    const inline = rest.match(/\$[^$\n]+\$/g) ?? [];
    return [...display, ...inline];
  };
  const claimMath = claims.flatMap((c) => extractMath(c.statement).map(norm));
  const proseMath = Array.from(new Set(extractMath(prose).filter(isEquation)));
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

// ---- Renderer-computed prominence (§10.5) — STRUCTURAL on blocks, still provisional ----
// Never model-assigned. Reads real structure now (block membership + section position), but
// remains labeled provisional and advisory-only until thresholds are recalibrated from seed
// data (JT). Reads NO soft statuses and NO link graph.
export async function computeProminence(db: Db, overviewSlug: string, paperId: string): Promise<{ prominence: ComputedProminence; locationSlug: string | null }> {
  const rank = (p: ComputedProminence) => ["not_in_overview", "footnote_reference", "inline_reference", "paragraph_reference", "subsection_anchor", "section_anchor", "page_subject"].indexOf(p);
  let best: ComputedProminence = "not_in_overview";
  let locationSlug: string | null = null;
  const consider = async (pageId: string, here: ComputedProminence) => {
    if (rank(here) <= rank(best)) return;
    const page = (await db.select().from(fieldPagesTable).where(eq(fieldPagesTable.id, pageId)).limit(1))[0];
    if (!page) return;
    best = here; locationSlug = page.slug;
  };
  // Papers with live BLOCKS: position read off the block structure.
  const ownBlocks = await db.select().from(pageBlocksTable).where(eq(pageBlocksTable.createdByPaperId, paperId));
  const byPage = new Map<string, typeof ownBlocks>();
  for (const b of ownBlocks) { if (!byPage.has(b.pageId)) byPage.set(b.pageId, [] as any); (byPage.get(b.pageId) as any).push(b); }
  for (const [pageId, blist] of byPage) {
    const v = await latestVersion(db, pageId);
    if (!v) continue;
    const ordered = await blocksOfVersion(db, v.id);
    const liveIds = new Set(ordered.map((b) => b.id));
    const mine = blist.filter((b: any) => liveIds.has(b.id));
    if (mine.length === 0) continue;
    const content = ordered.filter((b) => b.kind !== "heading");
    const mineContent = mine.filter((b: any) => b.kind !== "heading");
    if (content.length > 0 && mineContent.length / content.length > 0.5) { await consider(pageId, "page_subject"); continue; }
    // section anchor: one of the paper's blocks is the FIRST content block after a heading.
    let isAnchor = false;
    for (let i = 0; i < ordered.length; i += 1) {
      if (ordered[i].kind !== "heading") continue;
      const next = ordered.slice(i + 1).find((b) => b.kind !== "heading");
      if (next && mine.some((m: any) => m.id === next.id)) { isAnchor = true; break; }
    }
    if (isAnchor) { await consider(pageId, "section_anchor"); continue; }
    if (mineContent.length > 0) { await consider(pageId, "paragraph_reference"); continue; }
  }
  // Accretion-only presence: live references on OTHERS' blocks.
  if (best === "not_in_overview") {
    const refs = (await db.select().from(pageReferencesTable).where(eq(pageReferencesTable.paperId, paperId))).filter((r: any) => r.status === "approved" && r.blockId);
    for (const r of refs) {
      const v = await latestVersion(db, r.pageId);
      if (!v) continue;
      const joins = await db.select().from(pageVersionBlocksTable).where(eq(pageVersionBlocksTable.versionId, v.id));
      if (joins.some((j: any) => j.blockId === r.blockId)) { await consider(r.pageId, "inline_reference"); }
    }
  }
  return { prominence: best, locationSlug };
}

// ---- Assemble the draft overview into markdown (for review / export) ---------------
// markdownFull is the maintained render cache; provenance counts come from block membership.
export async function assembleOverviewMarkdown(db: Db, overviewSlug: string): Promise<string> {
  const ordered = await pagesInScope(db, overviewSlug);
  const chunks: string[] = [];
  for (const p of ordered) {
    const v = await latestVersion(db, p.id);
    const prov = v ? await liveProvenanceForVersion(db, v.id) : { spans: [], refs: [], links: [] };
    const sourced = prov.spans.filter((s: any) => s.supportStatus === "sourced").length;
    const unsourced = prov.spans.length - sourced;
    chunks.push(`# ${p.title}  (\`/fields/${p.slug}\`)\n\n${v?.markdownFull ?? ""}\n\n_Provenance: ${prov.refs.length} source chip(s); spans ${sourced} sourced / ${unsourced} unsourced-explanatory._\n`);
  }
  return chunks.join("\n\n---\n\n");
}

// Live provenance of a version via BLOCK MEMBERSHIP, with ABSOLUTE offsets computed against
// the version's render cache (blockStart + block-local). Pre-block versions fall back to the
// frozen per-version rows. This is the single reader the route and assembler share.
export async function liveProvenanceForVersion(db: Db, versionId: string) {
  const blocks = await blocksOfVersion(db, versionId);
  if (blocks.length === 0) {
    // Frozen pre-migration version: old-style scoping.
    const spans = (await db.select().from(pageSpansTable).where(eq(pageSpansTable.versionId, versionId))).filter((s: any) => !s.superseded);
    const refs = (await db.select().from(pageReferencesTable).where(eq(pageReferencesTable.versionId, versionId))).filter((r: any) => r.status === "approved");
    const links = (await db.select().from(pageLinksTable).where(eq(pageLinksTable.versionId, versionId))).filter((l: any) => !l.superseded);
    return { blocks, spans, refs, links };
  }
  // Compute each block's start offset in the render (must mirror renderBlocksToMarkdown).
  const startOf = new Map<string, number>();
  let pos = 0;
  for (let i = 0; i < blocks.length; i += 1) {
    startOf.set(blocks[i].id, pos);
    pos += blocks[i].markdown.length + 2; // "\n\n" joiner
  }
  const ids = blocks.map((b) => b.id);
  const abs = (blockId: string | null, local: number | null) =>
    blockId != null && local != null && startOf.has(blockId) ? startOf.get(blockId)! + local : null;
  const spans = (await db.select().from(pageSpansTable).where(inArray(pageSpansTable.blockId, ids)))
    .map((s: any) => ({ ...s, startOffset: abs(s.blockId, s.startOffsetInBlock), endOffset: abs(s.blockId, s.endOffsetInBlock) }));
  const refs = (await db.select().from(pageReferencesTable).where(inArray(pageReferencesTable.blockId, ids)))
    .filter((r: any) => r.status === "approved")
    .map((r: any) => ({ ...r, anchorStartOffset: abs(r.blockId, r.startOffsetInBlock), anchorEndOffset: abs(r.blockId, r.endOffsetInBlock) }));
  const links = (await db.select().from(pageLinksTable).where(inArray(pageLinksTable.blockId, ids)))
    .map((l: any) => ({ ...l, anchorStartOffset: abs(l.blockId, l.startOffsetInBlock), anchorEndOffset: abs(l.blockId, l.endOffsetInBlock) }));
  return { blocks, spans, refs, links };
}

// ---- MIGRATION (DESIGN §4, JT: migrate NOW, before the seed) -------------------------
// One-time, per page, in a transaction: split the latest version's markdown into blocks, map
// live provenance by offset containment, verify render equality + span slices, abort loudly
// on any mismatch. Idempotent: pages whose latest version already has blocks are skipped.
// Frozen history (older versions, superseded rows) is kept forever, untouched.
export async function migrateToBlocks(db: Db, onlyPageId?: string): Promise<{ migrated: number; skipped: number }> {
  const pages = onlyPageId
    ? await db.select().from(fieldPagesTable).where(eq(fieldPagesTable.id, onlyPageId))
    : await db.select().from(fieldPagesTable);
  let migrated = 0, skipped = 0;
  for (const page of pages) {
    const v = await latestVersion(db, page.id);
    if (!v) { skipped += 1; continue; }
    const existing = await db.select().from(pageVersionBlocksTable).where(eq(pageVersionBlocksTable.versionId, v.id));
    if (existing.length > 0) { skipped += 1; continue; }
    await (db as any).transaction(async (tx: Db) => {
      const source = v.markdownFull;
      const descriptors = splitMarkdownIntoBlocks(source);
      // Locate each chunk's start in the ORIGINAL string for offset containment.
      const chunkStarts: number[] = [];
      let cursor = 0;
      for (const d of descriptors) {
        const at = source.indexOf(d.markdown, cursor);
        if (at < 0) throw new Error(`migrateToBlocks: chunk not found in source for page ${page.slug} — aborting (loud)`);
        chunkStarts.push(at); cursor = at + d.markdown.length;
      }
      const blockSet: { blockId: string; orderKey: number }[] = [];
      const blockRows: PageBlock[] = [];
      let key = ORDER_STEP;
      for (const d of descriptors) {
        const b = await insertBlock(tx, { pageId: page.id, kind: d.kind, markdown: d.markdown });
        blockRows.push(b); blockSet.push({ blockId: b.id, orderKey: key }); key += ORDER_STEP;
      }
      // Verify render equality (normalized) BEFORE touching provenance.
      const rendered = renderBlocksToMarkdown(blockRows);
      const norm = (s: string) => s.replace(/\n{2,}/g, "\n\n").trim();
      if (norm(rendered) !== norm(source)) throw new Error(`migrateToBlocks: render mismatch for page ${page.slug} — aborting (loud)`);
      // Map LIVE provenance of the latest version by offset containment (text fallback).
      const containing = (absStart: number | null, text: string | null): { idx: number; local: number } | null => {
        if (absStart != null) {
          for (let i = 0; i < descriptors.length; i += 1) {
            const s = chunkStarts[i], e = s + descriptors[i].markdown.length;
            if (absStart >= s && absStart < e) return { idx: i, local: absStart - s };
          }
        }
        if (text) {
          for (let i = 0; i < descriptors.length; i += 1) {
            const at = descriptors[i].markdown.indexOf(text);
            if (at >= 0) return { idx: i, local: at };
          }
        }
        return null;
      };
      const liveSpans = (await tx.select().from(pageSpansTable).where(eq(pageSpansTable.versionId, v.id))).filter((s: any) => !s.superseded);
      for (const s of liveSpans) {
        const hit = containing(s.startOffset, s.text);
        if (!hit) continue; // floating span: stays frozen (blockId null), history intact
        const block = blockRows[hit.idx];
        if (s.text && block.markdown.slice(hit.local, hit.local + s.text.length) !== s.text) throw new Error(`migrateToBlocks: span slice mismatch on ${page.slug} — aborting (loud)`);
        await tx.update(pageSpansTable).set({ blockId: block.id, startOffsetInBlock: hit.local, endOffsetInBlock: s.text ? hit.local + s.text.length : null }).where(eq(pageSpansTable.id, s.id));
      }
      const liveRefs = (await tx.select().from(pageReferencesTable).where(eq(pageReferencesTable.versionId, v.id))).filter((r: any) => r.status === "approved");
      for (const r of liveRefs) {
        const hit = containing(r.anchorStartOffset, r.anchorText);
        if (!hit) continue;
        await tx.update(pageReferencesTable).set({ blockId: blockRows[hit.idx].id, startOffsetInBlock: hit.local, endOffsetInBlock: r.anchorText ? hit.local + r.anchorText.length : null }).where(eq(pageReferencesTable.id, r.id));
      }
      const liveLinks = (await tx.select().from(pageLinksTable).where(eq(pageLinksTable.versionId, v.id))).filter((l: any) => !l.superseded);
      for (const l of liveLinks) {
        const hit = containing(l.anchorStartOffset, l.phrase);
        if (!hit) continue;
        await tx.update(pageLinksTable).set({ blockId: blockRows[hit.idx].id, startOffsetInBlock: hit.local, endOffsetInBlock: hit.local + l.phrase.length }).where(eq(pageLinksTable.id, l.id));
      }
      // New version pointing at the block set (the migration is itself a versioned change).
      await newVersionWithBlockSet(tx, page.id, blockSet, [{ at: new Date().toISOString(), action: "migrated to block substrate" }], null, { oneLine: v.summaryOneLine, short: v.summaryShort });
      // Attach the just-mapped provenance rows' blockIds — they now live on blocks, so they are
      // visible in the new version by membership automatically.
    });
    migrated += 1;
  }
  return { migrated, skipped };
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

// ---- Divergence signal (slice 5.4) — MONITORING ONLY, never a score/placement change ----
// Compares the review's estimated-importance range with the realized structural position.
// Sharp disagreement (estimate says landmark, structure says footnote — or vice versa) writes
// a flag row for the admin surface: the trigger for a human LOOK at a stale page or a flipped
// judgment. Nothing reads these flags to compute anything.
export async function checkImportanceDivergence(db: Db, overviewSlug: string, paperId: string): Promise<{ flagged: boolean; note?: string }> {
  const rv = (await db.select().from(reviewVersionsTable).where(eq(reviewVersionsTable.paperId, paperId)).orderBy(desc(reviewVersionsTable.createdAt)).limit(1))[0];
  if (!rv || rv.estimatedImportanceLow == null || rv.estimatedImportanceHigh == null) return { flagged: false };
  const { prominence, locationSlug } = await computeProminence(db, overviewSlug, paperId);
  const lowProminence = ["not_in_overview", "footnote_reference", "inline_reference"].includes(prominence);
  const highProminence = ["page_subject", "section_anchor"].includes(prominence);
  let note: string | null = null;
  // Thresholds RECALIBRATED from the 15-paper seed (2026-07-04): the modest-estimate side was
  // estHigh<=40 and missed the exact designed case — Ong (est 37-47) holding a root-page
  // section anchor. Seed distribution: Ong hi=47, next-lowest hi=77 (Verlinde) — 55 sits in
  // the gap with margin both ways. Landmark side unchanged (lowest landmark lo in seed = 85;
  // Parikh-Wilczek 79-89 stays under it by design). Advisory-only, still monitoring not
  // placement; re-recalibrate as the corpus grows.
  if (rv.estimatedImportanceLow >= 80 && lowProminence) {
    note = `estimate says landmark (~${rv.estimatedImportanceLow}-${rv.estimatedImportanceHigh}) but realized position is ${prominence} — stale page or flipped judgment; take a look`;
  } else if (rv.estimatedImportanceHigh <= 55 && highProminence) {
    note = `estimate says minor/solid (~${rv.estimatedImportanceLow}-${rv.estimatedImportanceHigh}) but realized position is ${prominence} — displacement candidate or over-prominence; take a look`;
  }
  if (!note) return { flagged: false };
  await db.insert(divergenceFlagsTable).values({
    paperId, overviewSlug, estimatedLow: rv.estimatedImportanceLow, estimatedHigh: rv.estimatedImportanceHigh,
    computedProminence: prominence, locationSlug, note,
  });
  return { flagged: true, note };
}

// ---- Contribution transclusion (slice 3, now on BLOCK lineage) ----------------------
// The paper page's "Contribution to the Explanatory Structure" is a live transclusion of the
// paper's blocks in the CURRENT page versions. A superseded contribution follows the block
// lineage (supersedesBlockId, walked FORWARD) to its live descendant — watching a contribution
// get absorbed or refined is informative.
export type ContributionRegion = {
  pageSlug: string; pageTitle: string;
  status: "live" | "superseded";
  originalText: string;
  currentText: string | null;
  supportStatus: string;
};

export async function getContributionTransclusion(db: Db, paperId: string): Promise<{ regions: ContributionRegion[]; fallbackPassage: string | null }> {
  const blocks = await db.select().from(pageBlocksTable).where(eq(pageBlocksTable.createdByPaperId, paperId));
  const regions: ContributionRegion[] = [];
  const latestSetByPage = new Map<string, Set<string>>();
  const pageMeta = new Map<string, { slug: string; title: string }>();
  for (const b of blocks) {
    if (b.kind === "heading") continue; // headings are structure, not contribution prose
    if (!latestSetByPage.has(b.pageId)) {
      const v = await latestVersion(db, b.pageId);
      const joins = v ? await db.select().from(pageVersionBlocksTable).where(eq(pageVersionBlocksTable.versionId, v.id)) : [];
      latestSetByPage.set(b.pageId, new Set(joins.map((j: any) => j.blockId)));
      const p = (await db.select().from(fieldPagesTable).where(eq(fieldPagesTable.id, b.pageId)).limit(1))[0];
      if (p) pageMeta.set(b.pageId, { slug: p.slug, title: p.title });
    }
    const liveSet = latestSetByPage.get(b.pageId)!;
    const meta = pageMeta.get(b.pageId);
    if (!meta) continue;
    const spanStatus = (await db.select().from(pageSpansTable).where(eq(pageSpansTable.blockId, b.id)).limit(1))[0]?.supportStatus ?? "unsourced_explanatory";
    if (liveSet.has(b.id)) {
      regions.push({ pageSlug: meta.slug, pageTitle: meta.title, status: "live", originalText: b.markdown, currentText: b.markdown, supportStatus: spanStatus });
      continue;
    }
    // Walk the lineage FORWARD: find the block that supersedes this one, repeatedly.
    let currentId = b.id; let descendant: any = null;
    for (let hop = 0; hop < 12; hop += 1) {
      const next = (await db.select().from(pageBlocksTable).where(eq(pageBlocksTable.supersedesBlockId, currentId)).limit(1))[0];
      if (!next) break;
      descendant = next; currentId = next.id;
      if (liveSet.has(next.id)) break;
    }
    regions.push({
      pageSlug: meta.slug, pageTitle: meta.title, status: "superseded",
      originalText: b.markdown,
      currentText: descendant && liveSet.has(descendant.id) ? descendant.markdown : null,
      supportStatus: spanStatus,
    });
  }
  const rv = (await db.select().from(reviewVersionsTable).where(eq(reviewVersionsTable.paperId, paperId)).orderBy(desc(reviewVersionsTable.createdAt)).limit(1))[0];
  return { regions, fallbackPassage: regions.length ? null : (rv?.contributionPassage || null) };
}

// ---- S8: claim internal-consistency check (deterministic; the GSL class) -------------
// A claim whose FORMULA contradicts its own STATEMENT PROSE ("never decreases" with a strict
// ">") is the wrong-but-consistent error the text-only watch cannot see downstream — catch it
// at the claim, then image-verify. Watch + verification trigger, never a gate.
export function checkClaimInternalConsistency(claims: ReviewClaim[]): { claimId: string; detail: string }[] {
  const out: { claimId: string; detail: string }[] = [];
  for (const c of claims ?? []) {
    const s = c.statement ?? "";
    const math = (s.match(/\$[^$]+\$/g) ?? []).join(" ");
    if (!math) continue;
    const hasStrictGt = /(^|[^=\\])>(?!=)/.test(math.replace(/\\g[et]q?\b/g, "")) && !/\\ge|\\geq|>=/.test(math);
    const hasStrictLt = /(^|[^=\\])<(?!=)/.test(math.replace(/\\l[et]q?\b/g, "")) && !/\\le|\\leq|<=/.test(math);
    const proseNonStrictLower = /never decreases|non-?decreasing|at least|greater than or equal/i.test(s);
    const proseNonStrictUpper = /never increases|non-?increasing|at most|less than or equal/i.test(s);
    if (proseNonStrictLower && hasStrictGt) out.push({ claimId: c.id, detail: `statement prose says a NON-STRICT bound ("never decreases"/"at least") but the formula uses strict ">" — reversible/saturating cases contradict it: ${math.slice(0, 80)}` });
    if (proseNonStrictUpper && hasStrictLt) out.push({ claimId: c.id, detail: `statement prose says a NON-STRICT bound ("never increases"/"at most") but the formula uses strict "<": ${math.slice(0, 80)}` });
  }
  return out;
}

// ---- S4: review<->overview consistency pass ------------------------------------------
// Post-edit verifier over affected sourced regions. Findings feed ONE regeneration retry with
// the findings in context (generator feedback, not output patching); a second failure stores a
// consistency_findings row for the auditor. Watch + feedback loop — never a score, never a
// rigid gate (mis-attribution stays fail-closed elsewhere).
export type ConsistencyFindingItem = { check: string; detail: string };
export type ConsistencyChecker = (input: {
  blockMarkdown: string; claims: ReviewClaim[]; scope?: string | null; correctnessInternal?: string | null;
}) => Promise<ConsistencyFindingItem[]>;

// Deterministic heuristic checker: the synthetic-suite checker and a free live pre-filter.
// Deliberately conservative — the live pipeline layers the model checker on top.
export const heuristicConsistencyChecker: ConsistencyChecker = async ({ blockMarkdown, claims, scope }) => {
  const findings: ConsistencyFindingItem[] = [];
  const contested = (claims ?? []).filter((c) => c.status === "contested");
  if (contested.length && !/contest|debat|disput|object|criticiz|circular/i.test(blockMarkdown)) {
    findings.push({ check: "status_mismatch", detail: "cites contested claim(s) but the prose never states the dispute or its central objection" });
  }
  const firstSentence = blockMarkdown.replace(/^#+[^\n]*\n+/, "").split(/(?<=[.!?])\s/)[0] ?? "";
  if ((scope === "speculative_interpretation" || scope === "model_heuristic" || (claims ?? []).some((c) => c.status === "speculative"))
      && !/speculat|heuristic|model-dependent|conjectur|proposal/i.test(firstSentence)) {
    findings.push({ check: "scope_announcement", detail: "speculative/model-heuristic content must announce its status in the FIRST sentence of the region" });
  }
  if ((claims ?? []).some((c) => c.status !== "established") && /\b(proves?|proved|establishes? conclusively|definitively (shows?|established))\b/i.test(blockMarkdown)) {
    findings.push({ check: "overreach", detail: "prose asserts proof/conclusive establishment while a cited claim is not status=established" });
  }
  return findings;
};

export async function runConsistencyPass(db: Db, opts: {
  overviewSlug: string;
  paperId: string;
  reviewVersionId?: string | null;
  claims: ReviewClaim[];
  scope?: string | null;
  correctnessPublic?: "sound" | "contested" | "flawed" | "hidden" | "fatal_unverified";
  applied: AppliedEditResult[];
  checker: ConsistencyChecker;
  regenerate?: (blockMarkdown: string, findings: ConsistencyFindingItem[]) => Promise<string | null>;
}): Promise<{ checked: number; regenerated: number; findingsStored: number }> {
  let checked = 0, regenerated = 0, findingsStored = 0;
  for (const r of opts.applied) {
    if (r.status !== "draft_applied" || !r.spanId) continue;
    const span = (await db.select().from(pageSpansTable).where(eq(pageSpansTable.id, r.spanId)))[0];
    if (!span?.blockId || span.supportStatus !== "sourced") continue;
    const block = (await db.select().from(pageBlocksTable).where(eq(pageBlocksTable.id, span.blockId)))[0];
    if (!block) continue;
    checked += 1;
    const findings = await opts.checker({ blockMarkdown: block.markdown, claims: opts.claims, scope: opts.scope ?? null });
    if (findings.length === 0) continue;
    let residual = findings;
    if (opts.regenerate) {
      const newMd = await opts.regenerate(block.markdown, findings);
      if (newMd && newMd.trim() && newMd.trim() !== block.markdown.trim()) {
        const reapplied = await applyOverviewImpact(db, {
          overviewSlug: opts.overviewSlug, paperId: opts.paperId, reviewVersionId: opts.reviewVersionId,
          correctnessPublic: opts.correctnessPublic ?? "sound", claims: opts.claims, provenance: "model_review",
          edits: [{ action: "edit_existing_text", targetPageSlug: r.targetPageSlug ?? opts.overviewSlug, targetBlockId: block.id,
            anchorText: block.markdown.slice(0, 120), proposedMarkdown: newMd.trim(),
            citedPaperIds: [opts.paperId], citedClaimIds: (opts.claims ?? []).map((c) => c.id),
            supportStatus: "sourced",
            safetyCheck: { paperTextTreatedAsData: true, suspiciousInstructionsDetected: false, actionTaken: "none" },
            reason: `consistency regeneration: ${findings.map((f) => f.check).join(",")}` }],
        });
        const newSpanId = reapplied[0]?.spanId;
        if (reapplied[0]?.status === "draft_applied" && newSpanId) {
          regenerated += 1;
          const newSpan = (await db.select().from(pageSpansTable).where(eq(pageSpansTable.id, newSpanId)))[0];
          const newBlock = newSpan?.blockId ? (await db.select().from(pageBlocksTable).where(eq(pageBlocksTable.id, newSpan.blockId)))[0] : null;
          residual = newBlock ? await opts.checker({ blockMarkdown: newBlock.markdown, claims: opts.claims, scope: opts.scope ?? null }) : findings;
          if (residual.length && newBlock) {
            await db.insert(consistencyFindingsTable).values({ proposedOverviewEditId: reapplied[0].proposedOverviewEditId ?? null, blockId: newBlock.id, pageId: newBlock.pageId, paperId: opts.paperId, findings: residual });
            findingsStored += 1;
          }
          continue;
        }
      }
    }
    // No regeneration possible (or it failed to apply): store the finding for the auditor.
    await db.insert(consistencyFindingsTable).values({ proposedOverviewEditId: r.proposedOverviewEditId ?? null, blockId: block.id, pageId: block.pageId, paperId: opts.paperId, findings: residual });
    findingsStored += 1;
  }
  return { checked, regenerated, findingsStored };
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
  const scope = await pagesInScope(db, overviewSlug);
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

// ---- reverse a reorganize_parent edit (S2 reversibility) ----------------------------
export async function rollbackReorganize(db: Db, editId: string) {
  const edit = (await db.select().from(proposedOverviewEditsTable).where(eq(proposedOverviewEditsTable.id, editId)))[0];
  const change = edit?.structuralChange as { newParentSlug: string; children: { slug: string; oldParentSlug: string | null }[] } | null;
  if (!edit || edit.action !== "reorganize_parent" || !change) throw new Error("not a reversible reorganize_parent edit");
  for (const c of change.children) {
    const child = await getPageBySlug(db, c.slug);
    if (!child) continue;
    const oldParent = c.oldParentSlug ? await getPageBySlug(db, c.oldParentSlug) : null;
    await db.update(fieldPagesTable).set({ parentPageId: oldParent?.id ?? null, updatedAt: new Date() }).where(eq(fieldPagesTable.id, child.id));
  }
  await db.update(proposedOverviewEditsTable).set({ status: "reverted" }).where(eq(proposedOverviewEditsTable.id, editId));
  return { reverted: change.children.length };
}

// ---- Emergent-hierarchy scope (S3): the namespace is the whole page tree ------------
// With emergence there is no pre-declared root: if a page named by the namespace slug exists,
// scope = it + all descendants; otherwise scope = every page (single-field deployments).
export async function pagesInScope(db: Db, overviewSlug: string) {
  const all = await db.select().from(fieldPagesTable);
  const root = all.find((p: any) => p.slug === overviewSlug);
  if (!root) return all;
  const byParent = new Map<string, any[]>();
  for (const p of all) {
    const key = p.parentPageId ?? "__top__";
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(p);
  }
  const out: any[] = [];
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop()!;
    out.push(cur);
    for (const child of byParent.get(cur.id) ?? []) stack.push(child);
  }
  // The disputed page is namespace machinery even when parentless.
  const disputed = all.find((p: any) => p.slug === `${overviewSlug}-${DISPUTED_PAGE_SLUG_SUFFIX}`);
  if (disputed && !out.some((p) => p.id === disputed.id)) out.push(disputed);
  return out;
}

// ---- rollback a page to a prior version (preserves history) ------------------------
// Block substrate: rollback REPOINTS — a new version whose join rows are the target's block
// set; spans/refs/links reappear by membership (no restoration copying). Pre-block targets
// (frozen markdownFull) fall back to the compat shim: split into fresh blocks.
export async function rollbackPage(db: Db, pageId: string, toVersionId: string) {
  const target = (await db.select().from(fieldPageVersionsTable).where(and(eq(fieldPageVersionsTable.id, toVersionId), eq(fieldPageVersionsTable.pageId, pageId))).limit(1))[0];
  if (!target) throw new Error("rollback target version not found for page");
  const targetSet = await db.select().from(pageVersionBlocksTable).where(eq(pageVersionBlocksTable.versionId, toVersionId));
  const log = [{ at: new Date().toISOString(), action: `rolled back to version ${toVersionId}` }];
  const summaries = { oneLine: target.summaryOneLine, short: target.summaryShort };
  if (targetSet.length) {
    return newVersionWithBlockSet(db, pageId, targetSet.map((j: any) => ({ blockId: j.blockId, orderKey: j.orderKey })), log, null, summaries);
  }
  return newDraftVersion(db, pageId, target.markdownFull, log, null, summaries);
}
