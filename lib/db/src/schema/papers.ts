import { sql } from "drizzle-orm";
import { integer, jsonb, numeric, pgTable, text, timestamp, unique, varchar } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

export type PaperDateMetadata = {
  displayedTitle: string;
  displayedAuthors: string[];
  arxivId: string;
  doi: string;
  journalName: string;
  journalPublicationDate: string;
  arxivFirstSubmissionDate: string;
  manuscriptDatePrintedOnPdf: string;
  originalPublicationDateBestGuess: string;
  dateSource: string;
  dateConfidence: number;
  dateNotes: string;
};

export const papersTable = pgTable("papers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  content: text("content").notNull(),
  authorId: varchar("author_id").notNull().references(() => usersTable.id),
  authorName: varchar("author_name").notNull(),   // submitter's display name
  paperAuthors: text("paper_authors"),             // actual authors extracted from the paper
  dateMetadata: jsonb("date_metadata").$type<PaperDateMetadata | null>(),
  field: varchar("field").notNull().default("Unknown"),
  subfields: jsonb("subfields").$type<string[]>().default([]),
  score: integer("score"),
  modelName: varchar("model_name"),
  pdfUrl: text("pdf_url"),
  displayPdf: integer("display_pdf").notNull().default(0),
  likesCount: integer("likes_count").notNull().default(0),
  viewCount: integer("view_count").notNull().default(0),
  commentCount: integer("comment_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reviewsTable = pgTable("reviews", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  paperId: varchar("paper_id").notNull().references(() => papersTable.id, { onDelete: "cascade" }),
  // Legacy fields (kept for old reviews)
  summary: text("summary").notNull().default(""),
  correctness: text("correctness").notNull().default(""),
  novelty: text("novelty").notNull().default(""),
  overallEvaluation: text("overall_evaluation").notNull().default(""),
  score: integer("score").notNull().default(0),
  relatedWork: text("related_work").notNull().default(""),
  // Structured review fields
  centralClaim: text("central_claim"),
  establishedResults: text("established_results"),
  interpretiveClaims: text("interpretive_claims"),
  speculativeClaims: text("speculative_claims"),
  economy: text("economy"),
  scopeDepth: text("scope_depth"),
  unifyingPower: text("unifying_power"),
  strongestCaseForImportance: text("strongest_case_for_importance"),
  strongestObjection: text("strongest_objection"),
  decisiveCheck: text("decisive_check"),
  internalTechnicalTraction: text("internal_technical_traction"),
  noveltyConfidence: numeric("novelty_confidence"),
  explanatoryTargetBreadth: text("explanatory_target_breadth"),
  theorySpaceBreadth: text("theory_space_breadth"),
  intrinsicScientificMeritScore: integer("intrinsic_scientific_merit_score"),
  explanatoryTargetBreadthScore: integer("explanatory_target_breadth_score"),
  theorySpaceBreadthScore: integer("theory_space_breadth_score"),
  breadthOfImpactScore: integer("breadth_of_impact_score"),
  overallIntrinsicScore: integer("overall_intrinsic_score"),
  bestClassification: varchar("best_classification"),
  finalJudgment: text("final_judgment"),
  coverageLedgerJson: text("coverage_ledger_json"),
  thinkingText: text("thinking_text"),
  // Metadata
  modelName: varchar("model_name").notNull(),
  systemPrompt: text("system_prompt").notNull().default(""),
  likesCount: integer("likes_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const commentsTable = pgTable("comments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  paperId: varchar("paper_id").notNull().references(() => papersTable.id, { onDelete: "cascade" }),
  authorId: varchar("author_id").notNull().references(() => usersTable.id),
  authorName: varchar("author_name").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const likesTable = pgTable("likes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => usersTable.id),
  targetId: varchar("target_id").notNull(),
  targetType: varchar("target_type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("unique_like").on(t.userId, t.targetId)]);

export const reviewAttemptsTable = pgTable("review_attempts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => usersTable.id),
  paperId: varchar("paper_id").references(() => papersTable.id, { onDelete: "set null" }),
  fileName: text("file_name"),
  reviewRunId: varchar("review_run_id"),
  stageName: varchar("stage_name").notNull(),
  stageType: varchar("stage_type").notNull(),
  model: varchar("model"),
  promptVersion: varchar("prompt_version"),
  promptHash: varchar("prompt_hash"),
  requestId: varchar("request_id"),
  errorMessage: text("error_message").notNull(),
  rawErrorCode: varchar("raw_error_code"),
  retryCount: integer("retry_count").notNull().default(0),
  extractionCompletenessStatus: varchar("extraction_completeness_status"),
  extractionWarnings: jsonb("extraction_warnings").$type<string[]>().default([]),
  extractionRetryAttempted: integer("extraction_retry_attempted").notNull().default(0),
  pdfFallbackAttempted: integer("pdf_fallback_attempted").notNull().default(0),
  pdfVisibleFallbackUsed: integer("pdf_visible_fallback_used").notNull().default(0),
  fallbackSucceeded: integer("fallback_succeeded").notNull().default(0),
  reviewStatus: varchar("review_status"),
  failureStatus: varchar("failure_status"),
  scientificScoringAttempted: integer("scientific_scoring_attempted").notNull().default(0),
  debugPayload: jsonb("debug_payload").$type<Record<string, unknown> | null>(),
  retryable: integer("retryable").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Pairwise calibration judgments. One row per unordered review pair per
// prompt hash; reviewIdA < reviewIdB lexicographically. Rows are immutable
// once written so any calibration fit is exactly reproducible from them.
export const calibrationPairsTable = pgTable("calibration_pairs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  reviewIdA: varchar("review_id_a").notNull(),
  reviewIdB: varchar("review_id_b").notNull(),
  promptHash: varchar("prompt_hash").notNull(),
  cohortId: varchar("cohort_id"),
  calibrationVersion: varchar("calibration_version"),
  model: varchar("model"),
  // Reconciled outcome of the two position-swapped judgments.
  overallWinnerReviewId: varchar("overall_winner_review_id"), // null = equal
  margin: varchar("margin"),                                  // slight | clear | decisive
  positionInconsistent: integer("position_inconsistent").notNull().default(0),
  // Per-dimension reconciled winners (review id or null for equal).
  inputStrengthWinnerReviewId: varchar("input_strength_winner_review_id"),
  constructionStrengthWinnerReviewId: varchar("construction_strength_winner_review_id"),
  outputStrengthWinnerReviewId: varchar("output_strength_winner_review_id"),
  // Both raw judgments including the randomized A/B assignment per call.
  judgmentsJson: jsonb("judgments_json").$type<Record<string, unknown>[] | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("unique_calibration_pair").on(t.reviewIdA, t.reviewIdB, t.promptHash)]);

export type Paper = typeof papersTable.$inferSelect;
export type InsertPaper = typeof papersTable.$inferInsert;
export type Review = typeof reviewsTable.$inferSelect;
export type InsertReview = typeof reviewsTable.$inferInsert;
export type Comment = typeof commentsTable.$inferSelect;
export type InsertComment = typeof commentsTable.$inferInsert;
export type ReviewAttempt = typeof reviewAttemptsTable.$inferSelect;
export type InsertReviewAttempt = typeof reviewAttemptsTable.$inferInsert;
export type CalibrationPair = typeof calibrationPairsTable.$inferSelect;
export type InsertCalibrationPair = typeof calibrationPairsTable.$inferInsert;
