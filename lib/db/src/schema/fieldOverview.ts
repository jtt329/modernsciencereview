// Field-overview "wiki" engine (Phase 1) — FIELD_MAP_and_importance_phase1.md §4 + §10.
// SUPERSEDES the concept-graph design: NO ConceptNode / ConceptPaperRef / typed role /
// localImportance / role-weighted centrality / create-merge-split governance. The graph
// EMERGES from pages, sections, and cited references — never a thing the model must satisfy.
//
// Disciplines encoded here (EXPLANATION-FIRST — §3.2 / §10.2 / §10.2a):
//   1. Provenance ACCURACY, not provenance-required. Unsourced explanatory prose is ALLOWED
//      (the overview is the best explanation now; citations accrete later). A prose span
//      carries a soft, model-assigned supportStatus (sourced | unsourced_explanatory |
//      needs_source | source_disputed). The HARD invariant is only that a citation that IS
//      present must resolve to a real paper — never a dangling or mis-attributed reference.
//   2. Corrigibility via VERSIONING, not a human approval gate (§4.2 / §10.1): the overview
//      editor is autonomous — edits AUTO-APPLY to a draft. There is no per-edit approval.
//      What is kept is versioning + provenance + rollback. draft->published is a single
//      visibility switch, never a per-edit gate.
//   3. Prominence is DERIVED (§4.3 / §10.5): there is no model-assigned importance column.
//      computedProminence is derived by the RENDERER from where a paper sits in the structure
//      (see helper in the route layer) — never stored as a model output.
//
// "No deterministic clamps" (§10.2) = no SCORING clamps. Integrity invariants (no uncited
// published sentence, no unverified fatal public, paper-text-as-data, versioned edits +
// rollback history, correctness chip hidden until spot-check) ARE enforced deterministically.
//
// Legacy: the v19.1.0 corpus is internal/legacy, never public overview truth — enforced by
// only ever creating references/edits from B.2.1 reviews (v19.1.0 excluded by promptVersion).

import { sql } from "drizzle-orm";
import { boolean, doublePrecision, integer, jsonb, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { papersTable } from "./papers";
import { usersTable } from "./auth";

// --- ReviewVersion: persisted B.2.1 review output (the spec's reviewVersionId target) ---
// The B.2.1 review CORE is unchanged; this only PERSISTS its output so the wiki can point at
// it (references/edits carry reviewVersionId), the paper page can show the review + evidence
// packets + the "Contribution to the Explanatory Structure" passage (§2.1), and citedClaimIds
// resolve. correctnessPublic stays hidden in the UI until spot-check (§7) — stored, not shown.
export type ReviewCorrectnessInternal =
  | "sound" | "contested_defensible" | "fatal_verified" | "fatal_alleged_unverified";
export type ReviewCorrectnessPublic = "sound" | "contested" | "flawed" | "hidden";

// Per-claim epistemic status, read from the B.2.1 claim table (papers are MIXED — status is
// per claim, never whole-paper). Source chips inherit this; it is a SOFT descriptive surfacing
// that drives NOTHING (§3.2 hard invariant).
export type ClaimStatus = "established" | "contested" | "speculative" | "failed";
export type ReviewClaim = { id: string; statement: string; status?: ClaimStatus };
// The status a source chip displays; "mixed" when a span cites differently-statused claims.
export type ChipClaimStatus = ClaimStatus | "mixed";

export const reviewVersionsTable = pgTable("review_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  paperId: varchar("paper_id").notNull().references(() => papersTable.id, { onDelete: "cascade" }),
  promptName: varchar("prompt_name").notNull().default("explanatory-update-B2.1"),
  promptVersion: varchar("prompt_version").notNull().default(""),
  promptHash: varchar("prompt_hash").notNull().default(""),
  recommendedScore: integer("recommended_score"),
  estimatedImportanceLow: integer("estimated_importance_low"),
  estimatedImportanceHigh: integer("estimated_importance_high"),
  scope: varchar("scope"),
  correctnessInternal: varchar("correctness_internal").$type<ReviewCorrectnessInternal>(),
  correctnessPublic: varchar("correctness_public").$type<ReviewCorrectnessPublic>().notNull().default("hidden"),
  claims: jsonb("claims").$type<ReviewClaim[]>().notNull().default([]),
  evidencePackets: jsonb("evidence_packets").$type<unknown[]>().notNull().default([]),
  overviewImpact: jsonb("overview_impact").$type<unknown>(),
  // S8: image verification of ALL claim-table equations at review time (per-equation verdicts
  // + deterministic internal-contradiction flags). Watch + auditor input, never a gate.
  claimEquationChecks: jsonb("claim_equation_checks").$type<unknown>(),
  contributionPassage: text("contribution_passage").notNull().default(""),
  adjudicatedJson: jsonb("adjudicated_json").$type<unknown>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- FieldPage: a wiki page (overview root, subpage, or concept-as-page) ---------
export const fieldPagesTable = pgTable("field_pages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  slug: varchar("slug").notNull().unique(),
  title: text("title").notNull(),
  parentPageId: varchar("parent_page_id"), // self-ref (soft; nullable for root pages)
  scopeStatement: text("scope_statement").notNull().default(""), // seed skeleton stub scope
  summary: text("summary").notNull().default(""),
  currentVersionId: varchar("current_version_id"), // -> field_page_versions.id (soft, avoids FK cycle)
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FieldPageChangeLogEntry = {
  at: string;
  byUserId?: string;
  action: string; // e.g. "draft_applied ProposedOverviewEdit <id>" | "reverted <id>" | "published"
  proposedOverviewEditId?: string;
  note?: string;
};

// --- FieldPageVersion: an immutable rendered version of a page ---------------------
// Multi-resolution content (§10.4) powers the progressive-disclosure [+] UI (§6.1).
// visibility is the staging axis (§10.1): draft (autonomous), published, archived.
export type FieldPageVisibility = "draft" | "published" | "archived";

export const fieldPageVersionsTable = pgTable("field_page_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  pageId: varchar("page_id").notNull().references(() => fieldPagesTable.id, { onDelete: "cascade" }),
  // Monotonic per-page ordinal (brief P2): createdAt ties are possible in fast loops; version
  // ordering must never depend on timestamp resolution.
  versionNumber: integer("version_number").notNull().default(0),
  summaryOneLine: text("summary_one_line").notNull().default(""),
  summaryShort: text("summary_short").notNull().default(""),
  // Block substrate: for block-backed versions this is a DERIVED RENDER CACHE (regenerated by
  // renderBlocksToMarkdown; never authoritative). Pre-migration versions keep it as their
  // frozen source of truth (history kept forever, per JT).
  markdownFull: text("markdown_full").notNull().default(""),
  visibility: varchar("visibility").$type<FieldPageVisibility>().notNull().default("draft"),
  changeLog: jsonb("change_log").$type<FieldPageChangeLogEntry[]>().notNull().default([]),
  createdByUserId: varchar("created_by_user_id").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- PageSection: a section/anchor within a page version (multi-resolution) --------
export const pageSectionsTable = pgTable("page_sections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  pageId: varchar("page_id").notNull().references(() => fieldPagesTable.id, { onDelete: "cascade" }),
  versionId: varchar("version_id").notNull().references(() => fieldPageVersionsTable.id, { onDelete: "cascade" }),
  slug: varchar("slug").notNull(),
  title: text("title").notNull(),
  order: integer("order").notNull().default(0),
  oneLine: text("one_line").notNull().default(""),
  shortExplanation: text("short_explanation").notNull().default(""),
  markdown: text("markdown").notNull().default(""),
  anchorIds: jsonb("anchor_ids").$type<string[]>().notNull().default([]),
});

// --- PageReference: an inline citation from overview prose -> a paper review -------
// The corrigible "edge". Span offsets (§10.4) enable click-a-sentence provenance + [+].
export type PageReferenceStatus = "proposed" | "approved" | "superseded" | "reverted";
export type PageReferenceProvenance =
  | "model_review" | "admin_manual" | "seed_overview" | "accepted_dispute";

export const pageReferencesTable = pgTable("page_references", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  pageId: varchar("page_id").notNull().references(() => fieldPagesTable.id, { onDelete: "cascade" }),
  versionId: varchar("version_id").references(() => fieldPageVersionsTable.id, { onDelete: "cascade" }),
  blockId: varchar("block_id"), // block substrate: attach to a block generation (null = frozen pre-migration row)
  startOffsetInBlock: integer("start_offset_in_block"),
  endOffsetInBlock: integer("end_offset_in_block"),
  sectionId: varchar("section_id"),
  anchorText: text("anchor_text"), // the phrase the source chip attaches to
  anchorStartOffset: integer("anchor_start_offset"), // span within the page/section markdown
  anchorEndOffset: integer("anchor_end_offset"),
  paperId: varchar("paper_id").references(() => papersTable.id, { onDelete: "set null" }),
  reviewVersionId: varchar("review_version_id"), // -> reviews.id today; review_versions in 1.5/2 (soft)
  externalReferenceId: varchar("external_reference_id"), // -> ingestion_queue.id (referenced-but-unreviewed)
  claimIds: jsonb("claim_ids").$type<string[]>().notNull().default([]),
  // Chip's claim status (established|contested|speculative|failed|mixed) — a SEPARATE axis from
  // the span's supportStatus ("is the sentence grounded?"). Soft/descriptive; drives nothing.
  claimStatus: varchar("claim_status").$type<ChipClaimStatus>(),
  note: text("note").notNull().default(""),
  status: varchar("status").$type<PageReferenceStatus>().notNull().default("approved"),
  provenance: varchar("provenance").$type<PageReferenceProvenance>().notNull().default("model_review"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- ProposedOverviewEdit: model-as-editor output (autonomous, auto-applied) -------
// §10.1: status is an APPLIED edit-history record, not an approval queue. Prominence is
// NOT here — it is renderer-computed (§10.5). editorRationale / safetyCheck are stored
// (§10.4) so the injection-defense outcome and the "why" are auditable, not just prompted.
export type OverviewEditAction =
  | "no_change" | "add_reference" | "edit_existing_text" | "add_paragraph"
  | "add_subsection" | "create_subpage" /* legacy alias of create_page */ | "create_page"
  | "reorganize_parent" | "merge_or_reorganize" | "add_link";
export type OverviewEditType = "prose" | "reference_only" | "new_section" | "new_subpage" | "reorganization" | "link_only";
export type OverviewEditStatus = "draft_applied" | "published" | "reverted" | "superseded" | "rejected";

export type OverviewEditorRationale = {
  whyOverviewImproves: string;
  whatWasAlreadyCovered: string;
  whatThisPaperAdds: string;
  whyThisLocation: string;
};
export type OverviewEditSafetyCheck = {
  paperTextTreatedAsData: boolean;
  suspiciousInstructionsDetected: boolean;
  actionTaken: "none" | "ignored_instructions" | "manual_review";
  note?: string;
};

export const proposedOverviewEditsTable = pgTable("proposed_overview_edits", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  reviewVersionId: varchar("review_version_id"), // -> reviews.id today (soft)
  paperId: varchar("paper_id").references(() => papersTable.id, { onDelete: "cascade" }),
  overviewSlug: varchar("overview_slug").notNull(),
  action: varchar("action").$type<OverviewEditAction>().notNull(),
  editType: varchar("edit_type").$type<OverviewEditType>(),
  targetPageSlug: varchar("target_page_slug"),
  targetSectionSlug: varchar("target_section_slug"),
  linkTargetSlug: varchar("link_target_slug"), // add_link destination / reorganize_parent new parent (validated against the index)
  parentSlug: varchar("parent_slug"), // create_page: parent chosen from index or same batch (emergent hierarchy, S2)
  // reorganize_parent reversibility: the children moved and their previous parents.
  structuralChange: jsonb("structural_change").$type<{ newParentSlug: string; children: { slug: string; oldParentSlug: string | null }[] } | null>(),
  proposedMarkdown: text("proposed_markdown").notNull().default(""),
  citedPaperIds: jsonb("cited_paper_ids").$type<string[]>().notNull().default([]),
  citedClaimIds: jsonb("cited_claim_ids").$type<string[]>().notNull().default([]),
  editorRationale: jsonb("editor_rationale").$type<OverviewEditorRationale | null>(),
  safetyCheck: jsonb("safety_check").$type<OverviewEditSafetyCheck | null>(),
  reason: text("reason").notNull().default(""),
  status: varchar("status").$type<OverviewEditStatus>().notNull().default("draft_applied"),
  appliedVersionId: varchar("applied_version_id"), // the FieldPageVersion this edit produced
  revertedFromVersionId: varchar("reverted_from_version_id"),
  // Idempotency (brief P1.4): sha256 of (reviewVersionId + edit payload). Set only on applied
  // rows (null on rejected, so a fixed retry isn't blocked); unique index makes re-application
  // a no-op even under concurrency.
  idempotencyKey: varchar("idempotency_key"),
  // Equation-fidelity outcome (brief P2): equations in the edit's prose that did not match any
  // verified review claim, plus (when the live pipeline runs it) the image-grounded verification
  // result per equation. A WATCH stored for the admin edit list — never a gate.
  equationFlags: jsonb("equation_flags").$type<EquationFlags | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("proposed_overview_edits_idem_idx").on(t.idempotencyKey)]);

export type EquationFlags = {
  unmatched: string[]; // $...$ expressions in prose not found in the review's claims
  imageVerification?: { equation: string; verbatimFromImage: string; verdict: "matches" | "differs" | "not_found"; note?: string }[];
};

// --- AttributionCheck: mis-sourcing spot-check queue (brief P2) --------------------
// The code enforces "a citation resolves to a real paper", not "the RIGHT paper" — attribution
// correctness stays model judgment. This is a lightweight post-apply lexical WATCH comparing the
// cited claim's statement to the anchored sentence; low overlap lands here for an admin glance.
// Never a gate: the edit applies regardless.
export type AttributionCheckStatus = "queued" | "cleared" | "confirmed_missourced";

export const attributionChecksTable = pgTable("attribution_checks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  proposedOverviewEditId: varchar("proposed_overview_edit_id"),
  referenceId: varchar("reference_id"),
  spanId: varchar("span_id"),
  pageId: varchar("page_id"),
  paperId: varchar("paper_id").references(() => papersTable.id, { onDelete: "cascade" }),
  claimIds: jsonb("claim_ids").$type<string[]>().notNull().default([]),
  claimStatements: jsonb("claim_statements").$type<string[]>().notNull().default([]),
  anchoredText: text("anchored_text").notNull().default(""),
  overlapScore: integer("overlap_score").notNull().default(0), // 0-100
  status: varchar("status").$type<AttributionCheckStatus>().notNull().default("queued"),
  note: text("note").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- PageBlock: the block substrate (DESIGN_block_substrate.md, JT-approved) --------
// A page is an ordered list of IMMUTABLE block rows; markdown is a RENDER of blocks, never
// the store. A block's id is the stable identity of a passage: EVERY change — prose rewrite
// OR provenance change (sourcing a span, adding a link) — creates a NEW block row with
// supersedesBlockId lineage; old rows are never mutated (history is rows, not copies).
export type PageBlockKind = "heading" | "paragraph" | "equation_display" | "list" | "quote";

export const pageBlocksTable = pgTable("page_blocks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  pageId: varchar("page_id").notNull().references(() => fieldPagesTable.id, { onDelete: "cascade" }),
  kind: varchar("kind").$type<PageBlockKind>().notNull().default("paragraph"),
  markdown: text("markdown").notNull().default(""),
  createdByReviewVersionId: varchar("created_by_review_version_id"),
  createdByPaperId: varchar("created_by_paper_id"),
  supersedesBlockId: varchar("supersedes_block_id"), // lineage: the block generation this replaced
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Version -> block membership with INSERTION-TOLERANT ordering (JT note): orderKey is a
// double; inserting between neighbors uses the midpoint, appends use max+1024. Each version
// writes its own join rows (cheap ids), so ordering never needs global renumbering.
export const pageVersionBlocksTable = pgTable("page_version_blocks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  versionId: varchar("version_id").notNull().references(() => fieldPageVersionsTable.id, { onDelete: "cascade" }),
  blockId: varchar("block_id").notNull().references(() => pageBlocksTable.id, { onDelete: "cascade" }),
  orderKey: doublePrecision("order_key").notNull().default(0),
}, (t) => [uniqueIndex("page_version_blocks_version_block_idx").on(t.versionId, t.blockId)]);

// --- BlockExpansion: the zoom layer (schema NOW per §2.1; generation is Phase 2) ----
// Four buttons = the four reader gap-types: simpler ("make this simpler"), detail ("tell me
// more"), evidence ("how do we know this?"), significance ("why does this matter?").
// Pre-generated at edit time through the same pipeline (versioned, cited, integrity-checked;
// never live free-generation); ONE level deep — depth is navigation into pages/reviews; chips
// in expansions resolve to REVIEWS, never PDFs. Regenerated when their block is rewritten.
export type BlockExpansionType = "simpler" | "detail" | "evidence" | "significance";

export const blockExpansionsTable = pgTable("block_expansions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  blockId: varchar("block_id").notNull().references(() => pageBlocksTable.id, { onDelete: "cascade" }),
  type: varchar("type").$type<BlockExpansionType>().notNull(),
  markdown: text("markdown").notNull().default(""),
  generatedFromBlockHash: varchar("generated_from_block_hash"), // staleness detection
  createdByReviewVersionId: varchar("created_by_review_version_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- PageSpan: a prose span with soft support status (§3.2, explanation-first) -----
// Every added paragraph/sentence becomes a span. Unsourced spans are legitimate (best
// explanation now); a later paper's review can SOURCE an existing span (accretion-as-query).
// sourced spans carry a referenceId -> page_references; unsourced spans carry none.
export type SpanSupportStatus = "sourced" | "unsourced_explanatory" | "needs_source" | "source_disputed";

export const pageSpansTable = pgTable("page_spans", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  pageId: varchar("page_id").notNull().references(() => fieldPagesTable.id, { onDelete: "cascade" }),
  versionId: varchar("version_id").notNull().references(() => fieldPageVersionsTable.id, { onDelete: "cascade" }),
  // Block substrate: post-migration rows attach to a BLOCK generation with block-local offsets
  // (versionId then records creation provenance, not scoping — liveness = block ∈ latest set).
  // Pre-migration (frozen history) rows have null blockId and keep version scoping.
  blockId: varchar("block_id"),
  startOffsetInBlock: integer("start_offset_in_block"),
  endOffsetInBlock: integer("end_offset_in_block"),
  sectionSlug: varchar("section_slug"),
  text: text("text").notNull().default(""),
  startOffset: integer("start_offset"),
  endOffset: integer("end_offset"),
  supportStatus: varchar("support_status").$type<SpanSupportStatus>().notNull().default("unsourced_explanatory"),
  // Lifecycle flag (SEPARATE from the epistemic supportStatus axis): spans are carried forward
  // to every new page version; a span whose text no longer appears in the version's markdown is
  // kept as a superseded copy — history is never deleted (brief P0.1).
  superseded: boolean("superseded").notNull().default(false),
  // Lineage (slice 3): when a rewrite replaces this span's text, the replacing span's id — lets
  // the paper page TRANSCLUDE the current state of a contribution ("watch it get absorbed or
  // superseded"). Remapped during carry-forward like referenceId.
  supersededBySpanId: varchar("superseded_by_span_id"),
  referenceId: varchar("reference_id"), // -> page_references.id when sourced (soft)
  createdByReviewVersionId: varchar("created_by_review_version_id"),
  createdByPaperId: varchar("created_by_paper_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- PageLink: an inter-page link — how the graph emerges (Phase 1.5 slice 1) ------
// UNTYPED, UNWEIGHTED, carries no judgment: Wikipedia's graph, not the dropped concept graph
// (which demanded typed classification as input to a computation). HARD INVARIANT: the link
// graph may be READ (navigation, [+] descent, editor retrieval, orphan detection, search) but
// no code path may derive score, prominence, placement, publication, or routing from link
// structure — enforced by the same static CI check as soft statuses. Links carry provenance
// and version like everything else and are carried forward across versions like spans
// (phrase re-anchored; orphaned -> superseded copy).
export const pageLinksTable = pgTable("page_links", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  fromPageId: varchar("from_page_id").notNull().references(() => fieldPagesTable.id, { onDelete: "cascade" }),
  toPageId: varchar("to_page_id").notNull().references(() => fieldPagesTable.id, { onDelete: "cascade" }),
  phrase: text("phrase").notNull(),
  blockId: varchar("block_id"), // block substrate: attach to a block generation (null = frozen pre-migration row)
  startOffsetInBlock: integer("start_offset_in_block"),
  endOffsetInBlock: integer("end_offset_in_block"),
  versionId: varchar("version_id").references(() => fieldPageVersionsTable.id, { onDelete: "cascade" }),
  anchorStartOffset: integer("anchor_start_offset"),
  anchorEndOffset: integer("anchor_end_offset"),
  superseded: boolean("superseded").notNull().default(false),
  createdByReviewVersionId: varchar("created_by_review_version_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- ConsistencyFinding: review<->overview consistency pass residue (Phase 2a S4) ----
// A sourced region that failed the consistency checks TWICE (original + one regeneration with
// findings in context) lands here for the auditor. Watch + generator-feedback, never a gate.
export type ConsistencyFindingStatus = "queued" | "resolved";

export const consistencyFindingsTable = pgTable("consistency_findings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  proposedOverviewEditId: varchar("proposed_overview_edit_id"),
  blockId: varchar("block_id"),
  pageId: varchar("page_id"),
  paperId: varchar("paper_id").references(() => papersTable.id, { onDelete: "cascade" }),
  findings: jsonb("findings").$type<{ check: string; detail: string }[]>().notNull().default([]),
  status: varchar("status").$type<ConsistencyFindingStatus>().notNull().default("queued"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- DivergenceFlag: estimate vs realized-position disagreement (slice 5.4) --------
// The review's estimated-importance range and the realized structural position are the same
// qualitative judgment at two different times; sharp divergence means a stale page or a flipped
// judgment. MONITORING ONLY — a flag triggers a human look, never a score or placement change.
export type DivergenceFlagStatus = "queued" | "reviewed";

export const divergenceFlagsTable = pgTable("divergence_flags", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  paperId: varchar("paper_id").references(() => papersTable.id, { onDelete: "cascade" }),
  overviewSlug: varchar("overview_slug").notNull(),
  estimatedLow: integer("estimated_low"),
  estimatedHigh: integer("estimated_high"),
  computedProminence: varchar("computed_prominence"),
  locationSlug: varchar("location_slug"),
  note: text("note").notNull().default(""),
  status: varchar("status").$type<DivergenceFlagStatus>().notNull().default("queued"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- IngestionQueue: referenced-but-unreviewed papers (placeholder targets) -------
export type IngestionQueueStatus = "queued" | "ingesting" | "reviewed" | "skipped" | "failed";

export const ingestionQueueTable = pgTable("ingestion_queue", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  citation: text("citation").notNull(), // free-text reference as it appeared
  title: text("title"),
  arxivId: varchar("arxiv_id"),
  doi: varchar("doi"),
  requestedByReferenceId: varchar("requested_by_reference_id"), // the PageReference that needs it
  resolvedPaperId: varchar("resolved_paper_id").references(() => papersTable.id, { onDelete: "set null" }),
  status: varchar("status").$type<IngestionQueueStatus>().notNull().default("queued"),
  note: text("note").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// computedProminence (§10.5) is renderer-DERIVED, never stored as a model output.
// The route/render layer computes it from realized structure; kept here as the shared type.
export type ComputedProminence =
  | "page_subject" | "section_anchor" | "subsection_anchor"
  | "paragraph_reference" | "inline_reference" | "footnote_reference" | "not_in_overview";

// --- Types (repo convention: $inferSelect / $inferInsert) -------------------------
export type FieldPage = typeof fieldPagesTable.$inferSelect;
export type InsertFieldPage = typeof fieldPagesTable.$inferInsert;
export type FieldPageVersion = typeof fieldPageVersionsTable.$inferSelect;
export type InsertFieldPageVersion = typeof fieldPageVersionsTable.$inferInsert;
export type PageSection = typeof pageSectionsTable.$inferSelect;
export type InsertPageSection = typeof pageSectionsTable.$inferInsert;
export type PageReference = typeof pageReferencesTable.$inferSelect;
export type InsertPageReference = typeof pageReferencesTable.$inferInsert;
export type ProposedOverviewEdit = typeof proposedOverviewEditsTable.$inferSelect;
export type InsertProposedOverviewEdit = typeof proposedOverviewEditsTable.$inferInsert;
export type IngestionQueueItem = typeof ingestionQueueTable.$inferSelect;
export type InsertIngestionQueueItem = typeof ingestionQueueTable.$inferInsert;
export type ReviewVersion = typeof reviewVersionsTable.$inferSelect;
export type InsertReviewVersion = typeof reviewVersionsTable.$inferInsert;
export type PageSpan = typeof pageSpansTable.$inferSelect;
export type InsertPageSpan = typeof pageSpansTable.$inferInsert;
export type AttributionCheck = typeof attributionChecksTable.$inferSelect;
export type InsertAttributionCheck = typeof attributionChecksTable.$inferInsert;
export type PageLink = typeof pageLinksTable.$inferSelect;
export type InsertPageLink = typeof pageLinksTable.$inferInsert;
export type ConsistencyFinding = typeof consistencyFindingsTable.$inferSelect;
export type InsertConsistencyFinding = typeof consistencyFindingsTable.$inferInsert;
export type DivergenceFlag = typeof divergenceFlagsTable.$inferSelect;
export type InsertDivergenceFlag = typeof divergenceFlagsTable.$inferInsert;
export type PageBlock = typeof pageBlocksTable.$inferSelect;
export type InsertPageBlock = typeof pageBlocksTable.$inferInsert;
export type PageVersionBlock = typeof pageVersionBlocksTable.$inferSelect;
export type InsertPageVersionBlock = typeof pageVersionBlocksTable.$inferInsert;
export type BlockExpansion = typeof blockExpansionsTable.$inferSelect;
export type InsertBlockExpansion = typeof blockExpansionsTable.$inferInsert;
