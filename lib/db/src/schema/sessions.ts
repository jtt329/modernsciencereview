import { sql } from "drizzle-orm";
import { integer, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const reviewSessionsTable = pgTable("review_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  promptText: text("prompt_text").notNull().default(""),
  modelNames: text("model_names").notNull().default(""),
  paperCount: integer("paper_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessionPapersTable = pgTable("session_papers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").notNull().references(() => reviewSessionsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull().default(""),
  paperAuthors: text("paper_authors"),
  field: varchar("field"),
  modelName: varchar("model_name"),
  bestClassification: varchar("best_classification"),
  overallScore: integer("overall_score"),
  intrinsicMeritScore: integer("intrinsic_merit_score"),
  explanatoryTargetBreadthScore: integer("explanatory_target_breadth_score"),
  theorySpaceBreadthScore: integer("theory_space_breadth_score"),
  breadthOfImpactScore: integer("breadth_of_impact_score"),
  reviewJson: text("review_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ReviewSession = typeof reviewSessionsTable.$inferSelect;
export type SessionPaper = typeof sessionPapersTable.$inferSelect;
