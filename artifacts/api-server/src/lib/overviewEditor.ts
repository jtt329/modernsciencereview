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

import { and, desc, eq, inArray } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import {
  papersTable,
  fieldPagesTable, fieldPageVersionsTable, pageSectionsTable, pageReferencesTable,
  pageSpansTable, proposedOverviewEditsTable,
  type ComputedProminence, type FieldPageChangeLogEntry,
  type OverviewEditAction, type OverviewEditType,
  type OverviewEditorRationale, type OverviewEditSafetyCheck, type SpanSupportStatus,
  type ReviewClaim, type ChipClaimStatus,
} from "@workspace/db";

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
  correctnessPublic?: "sound" | "contested" | "flawed" | "hidden";
  edits: OverviewImpactEdit[];
  claims?: ReviewClaim[]; // the review's claim table (with per-claim status) — for chip claimStatus
  createdByUserId?: string | null;
  provenance?: "model_review" | "seed_overview" | "admin_manual";
};

export type AppliedEditResult = {
  action: OverviewEditAction;
  targetPageSlug: string | null;
  status: "draft_applied" | "rejected" | "no_change";
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
  const rows = await db.select().from(fieldPageVersionsTable)
    .where(eq(fieldPageVersionsTable.pageId, pageId))
    .orderBy(desc(fieldPageVersionsTable.createdAt)).limit(1);
  return rows[0] ?? null;
}

async function getPageBySlug(db: Db, slug: string) {
  const rows = await db.select().from(fieldPagesTable).where(eq(fieldPagesTable.slug, slug)).limit(1);
  return rows[0] ?? null;
}

// Create a new DRAFT version carrying `markdown`, point the page at it, log the change.
async function newDraftVersion(
  db: Db, pageId: string, markdown: string,
  changeLog: FieldPageChangeLogEntry[], createdByUserId?: string | null,
  summaries?: { oneLine?: string; short?: string },
) {
  const prev = await latestVersion(db, pageId);
  const priorLog = (prev?.changeLog as FieldPageChangeLogEntry[] | undefined) ?? [];
  const [version] = await db.insert(fieldPageVersionsTable).values({
    pageId,
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
  return version;
}

// Insert prose into the markdown per the edit action. Returns { markdown, anchorText }.
function applyToMarkdown(current: string, edit: OverviewImpactEdit): { markdown: string; anchor: string } {
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
        if (insertAt >= 0) { lines.splice(insertAt, 0, "", para, ""); return { markdown: lines.join("\n"), anchor }; }
      }
      return { markdown: `${current.trimEnd()}\n\n${para}\n`, anchor };
    }
    case "edit_existing_text": {
      if (edit.anchorText && current.includes(edit.anchorText)) {
        return { markdown: current.replace(edit.anchorText, para), anchor: para.slice(0, 120) };
      }
      return { markdown: `${current.trimEnd()}\n\n${para}\n`, anchor };
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
export async function applyOverviewImpact(db: Db, input: ApplyOverviewInput): Promise<AppliedEditResult[]> {
  const provenance = input.provenance ?? "model_review";
  const results: AppliedEditResult[] = [];
  const disputedSlug = `${input.overviewSlug}-${DISPUTED_PAGE_SLUG_SUFFIX}`;

  for (const edit of input.edits) {
    const recordEdit = async (
      status: "draft_applied" | "rejected" | "no_change",
      extra: { targetPageSlug?: string | null; appliedVersionId?: string; rejectionReason?: string } = {},
    ) => {
      const [row] = await db.insert(proposedOverviewEditsTable).values({
        reviewVersionId: input.reviewVersionId ?? null, paperId: input.paperId,
        overviewSlug: input.overviewSlug, action: edit.action, editType: edit.editType ?? null,
        targetPageSlug: extra.targetPageSlug ?? edit.targetPageSlug ?? null,
        targetSectionSlug: edit.targetSectionSlug ?? null,
        proposedMarkdown: edit.proposedMarkdown ?? "",
        citedPaperIds: edit.citedPaperIds ?? [], citedClaimIds: edit.citedClaimIds ?? [],
        editorRationale: edit.editorRationale ?? null, safetyCheck: edit.safetyCheck ?? null,
        reason: extra.rejectionReason ? `${edit.reason ?? ""} [${extra.rejectionReason}]` : (edit.reason ?? ""),
        status: status === "no_change" ? "draft_applied" : (status === "rejected" ? "rejected" : "draft_applied"),
        appliedVersionId: extra.appliedVersionId ?? null,
      }).returning();
      return row.id;
    };

    if (edit.action === "no_change") {
      results.push({ action: edit.action, targetPageSlug: null, status: "no_change", proposedOverviewEditId: await recordEdit("no_change") });
      continue;
    }

    // Integrity: paper text is data. A live instruction the model did not neutralize => manual review.
    const sc = edit.safetyCheck;
    if (sc && (sc.paperTextTreatedAsData === false || (sc.suspiciousInstructionsDetected && sc.actionTaken !== "ignored_instructions"))) {
      const id = await recordEdit("rejected", { rejectionReason: "safety: suspicious instructions held for manual_review" });
      results.push({ action: edit.action, targetPageSlug: edit.targetPageSlug ?? null, status: "rejected", proposedOverviewEditId: id, rejectionReason: "manual_review" });
      continue;
    }

    // EXPLANATION-FIRST (§3.2): unsourced prose is allowed. The REVIEWED paper is the natural,
    // always-resolvable source of its own claims — the model need not (and cannot) know DB ids, so
    // a span it marks sourced / backs with its own claims is sourced by input.paperId. Any OTHER
    // cited paper ids are resolved against the DB (accretion / multi-source); unresolved ones are
    // ignored, never stored as dangling or mis-attributed references (§10.2 / §10.2a item 2).
    const { dropped } = await resolveCitedPapers(db, (edit.citedPaperIds ?? []).filter((x) => x !== input.paperId));
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
      const existing = await getPageBySlug(db, targetSlug);
      if (existing) {
        edit.action = "add_paragraph"; // slug exists — improve it, don't duplicate
      } else {
        const root = await getPageBySlug(db, input.overviewSlug);
        const title = (edit.proposedMarkdown?.match(/^#+\s*(.+)/)?.[1] || targetSlug.replace(/-/g, " ")).slice(0, 120);
        const [page] = await db.insert(fieldPagesTable).values({ slug: targetSlug, title, parentPageId: root?.id ?? null, scopeStatement: edit.reason ?? "", summary: "" }).returning();
        const md = edit.proposedMarkdown ?? `## ${title}\n`;
        const version = await newDraftVersion(db, page.id, md, [{ at: new Date().toISOString(), action: `create_subpage from paper ${input.paperId}`, note: edit.reason }], input.createdByUserId);
        let refId: string | undefined;
        if (isSourced && sourcePaperId) { const ref = await createReference(db, { pageId: page.id, versionId: version.id, markdown: md, anchorText: edit.anchorText || title, paperId: sourcePaperId, reviewVersionId: input.reviewVersionId, claimIds, claimStatus, provenance }); refId = ref.id; }
        const span = await createSpan(db, { pageId: page.id, versionId: version.id, text: (edit.proposedMarkdown ?? title).slice(0, 400), markdown: md, supportStatus, referenceId: refId ?? null, reviewVersionId: input.reviewVersionId, paperId: input.paperId });
        const id = await recordEdit("draft_applied", { targetPageSlug: targetSlug, appliedVersionId: version.id });
        results.push({ action: "create_subpage", targetPageSlug: targetSlug, status: "draft_applied", proposedOverviewEditId: id, appliedVersionId: version.id, referenceId: refId, spanId: span.id, supportStatus, droppedCitations: dropped });
        continue;
      }
    }

    // Resolve (or auto-create) the target page.
    let page = await getPageBySlug(db, targetSlug);
    if (!page) {
      const root = await getPageBySlug(db, input.overviewSlug);
      const [created] = await db.insert(fieldPagesTable).values({ slug: targetSlug, title: targetSlug.replace(/-/g, " "), parentPageId: root?.id ?? null, scopeStatement: input.correctnessPublic === "flawed" ? "Disputed and failed claims." : "" }).returning();
      page = created;
      await newDraftVersion(db, page.id, `## ${page.title}\n`, [{ at: new Date().toISOString(), action: "auto-created target page" }], input.createdByUserId);
    }
    const current = (await latestVersion(db, page.id))?.markdownFull ?? `## ${page.title}\n`;

    if (edit.action === "add_reference") {
      // Accretion-as-query (§3.2 / item 4): SOURCE an existing (unsourced) span with this paper.
      const anchor = edit.anchorText?.trim() || current.slice(0, 80);
      const spans = await db.select().from(pageSpansTable).where(eq(pageSpansTable.pageId, page.id));
      const match = spans.find((s: any) => s.text && (s.text.includes(anchor) || (anchor.length > 20 && anchor.includes(s.text.slice(0, 40)))));
      const version = await newDraftVersion(db, page.id, current, [{ at: new Date().toISOString(), action: `add_reference (source span) from paper ${input.paperId}`, note: edit.reason }], input.createdByUserId);
      let refId: string | undefined, spanId: string | undefined, finalStatus: SpanSupportStatus = supportStatus;
      if (isSourced && sourcePaperId) {
        const ref = await createReference(db, { pageId: page.id, versionId: version.id, markdown: current, anchorText: anchor, paperId: sourcePaperId, reviewVersionId: input.reviewVersionId, claimIds, claimStatus, provenance });
        refId = ref.id;
        if (match) { await db.update(pageSpansTable).set({ supportStatus: "sourced", referenceId: ref.id }).where(eq(pageSpansTable.id, match.id)); spanId = match.id; finalStatus = "sourced"; }
        else { const sp = await createSpan(db, { pageId: page.id, versionId: version.id, text: anchor, markdown: current, supportStatus: "sourced", referenceId: ref.id, reviewVersionId: input.reviewVersionId, paperId: input.paperId }); spanId = sp.id; }
      } else if (match) {
        await db.update(pageSpansTable).set({ supportStatus: "needs_source" }).where(eq(pageSpansTable.id, match.id)); spanId = match.id; finalStatus = "needs_source";
      }
      const id = await recordEdit("draft_applied", { targetPageSlug: targetSlug, appliedVersionId: version.id });
      results.push({ action: "add_reference", targetPageSlug: targetSlug, status: "draft_applied", proposedOverviewEditId: id, appliedVersionId: version.id, referenceId: refId, spanId, supportStatus: finalStatus, droppedCitations: dropped });
      continue;
    }

    // Prose edits (add_paragraph / add_subsection / edit_existing_text / merge_or_reorganize).
    const { markdown, anchor } = applyToMarkdown(current, edit);
    const insertedText = (edit.proposedMarkdown ?? anchor).trim();
    const version = await newDraftVersion(db, page.id, markdown, [{ at: new Date().toISOString(), action: `${edit.action} from paper ${input.paperId}`, note: edit.reason }], input.createdByUserId);
    let refId: string | undefined;
    if (isSourced && sourcePaperId) { const ref = await createReference(db, { pageId: page.id, versionId: version.id, markdown, anchorText: anchor, paperId: sourcePaperId, reviewVersionId: input.reviewVersionId, claimIds, claimStatus, provenance }); refId = ref.id; }
    const span = await createSpan(db, { pageId: page.id, versionId: version.id, sectionSlug: edit.targetSectionSlug ?? null, text: insertedText, markdown, supportStatus, referenceId: refId ?? null, reviewVersionId: input.reviewVersionId, paperId: input.paperId });
    const id = await recordEdit("draft_applied", { targetPageSlug: targetSlug, appliedVersionId: version.id });
    results.push({ action: edit.action, targetPageSlug: targetSlug, status: "draft_applied", proposedOverviewEditId: id, appliedVersionId: version.id, referenceId: refId, spanId: span.id, supportStatus, droppedCitations: dropped });
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
  const refs = await db.select().from(pageReferencesTable).where(eq(pageReferencesTable.paperId, paperId));
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
    const refs = await db.select().from(pageReferencesTable).where(eq(pageReferencesTable.pageId, p.id));
    const spans = v ? await db.select().from(pageSpansTable).where(eq(pageSpansTable.versionId, v.id)) : [];
    const sourced = spans.filter((s: any) => s.supportStatus === "sourced").length;
    const unsourced = spans.length - sourced;
    chunks.push(`# ${p.title}  (\`/fields/${p.slug}\`)\n\n${v?.markdownFull ?? ""}\n\n_Provenance: ${refs.length} source chip(s); spans ${sourced} sourced / ${unsourced} unsourced-explanatory._\n`);
  }
  return chunks.join("\n\n---\n\n");
}

// ---- Corrections ledger (§3.2) — compact "what changed and why" per page, fed to the editor
// so a settled point isn't re-litigated and two models don't oscillate. Provenance-justified and
// reversible (derived from the applied-edit history; introduces no new store).
export async function assembleCorrectionsLedger(db: Db, overviewSlug: string, targetPageSlug?: string): Promise<string> {
  const rows = await db.select().from(proposedOverviewEditsTable)
    .where(eq(proposedOverviewEditsTable.overviewSlug, overviewSlug))
    .orderBy(desc(proposedOverviewEditsTable.createdAt)).limit(60);
  const scoped = targetPageSlug ? rows.filter((r: any) => r.targetPageSlug === targetPageSlug) : rows;
  if (scoped.length === 0) return "(no prior corrections)";
  return scoped.slice(0, 30).map((r: any) => {
    const why = (r.editorRationale as OverviewEditorRationale | null)?.whatThisPaperAdds || r.reason || "";
    return `- [${r.targetPageSlug ?? overviewSlug}] ${r.action}${r.status === "reverted" ? " (reverted)" : ""}: ${String(why).slice(0, 160)}`;
  }).join("\n");
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
  await db.update(proposedOverviewEditsTable).set({ status: "published" }).where(eq(proposedOverviewEditsTable.overviewSlug, overviewSlug));
  return { publishedVersions: published };
}

// ---- rollback a page to a prior version (preserves history) ------------------------
export async function rollbackPage(db: Db, pageId: string, toVersionId: string) {
  const target = (await db.select().from(fieldPageVersionsTable).where(and(eq(fieldPageVersionsTable.id, toVersionId), eq(fieldPageVersionsTable.pageId, pageId))).limit(1))[0];
  if (!target) throw new Error("rollback target version not found for page");
  const restored = await newDraftVersion(db, pageId, target.markdownFull,
    [{ at: new Date().toISOString(), action: `rolled back to version ${toVersionId}` }], null,
    { oneLine: target.summaryOneLine, short: target.summaryShort });
  return restored;
}
