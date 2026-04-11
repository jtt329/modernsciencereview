import { sql } from "drizzle-orm";
import { integer, jsonb, pgTable, text, timestamp, unique, varchar } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

export const papersTable = pgTable("papers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  content: text("content").notNull(),
  authorId: varchar("author_id").notNull().references(() => usersTable.id),
  authorName: varchar("author_name").notNull(),
  field: varchar("field").notNull().default("Unknown"),
  subfields: jsonb("subfields").$type<string[]>().default([]),
  score: integer("score"),
  modelName: varchar("model_name"),
  likesCount: integer("likes_count").notNull().default(0),
  viewCount: integer("view_count").notNull().default(0),
  commentCount: integer("comment_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reviewsTable = pgTable("reviews", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  paperId: varchar("paper_id").notNull().references(() => papersTable.id, { onDelete: "cascade" }),
  summary: text("summary").notNull(),
  correctness: text("correctness").notNull(),
  novelty: text("novelty").notNull(),
  overallEvaluation: text("overall_evaluation").notNull(),
  score: integer("score").notNull(),
  relatedWork: text("related_work").notNull().default(""),
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
