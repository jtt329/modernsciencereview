import { sql } from "drizzle-orm";
import { integer, jsonb, numeric, pgTable, text, timestamp, unique, varchar } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

export const papersTable = pgTable("papers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  content: text("content").notNull(),
  authorId: varchar("author_id").notNull().references(() => usersTable.id),
  authorName: varchar("author_name").notNull(),   // submitter's display name
  paperAuthors: text("paper_authors"),             // actual authors extracted from the paper
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

export type Paper = typeof papersTable.$inferSelect;
export type InsertPaper = typeof papersTable.$inferInsert;
export type Review = typeof reviewsTable.$inferSelect;
export type InsertReview = typeof reviewsTable.$inferInsert;
export type Comment = typeof commentsTable.$inferSelect;
export type InsertComment = typeof commentsTable.$inferInsert;
