CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);

CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar,
	"first_name" varchar,
	"last_name" varchar,
	"profile_image_url" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);

CREATE TABLE "conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "attribution_checks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposed_overview_edit_id" varchar,
	"reference_id" varchar,
	"span_id" varchar,
	"page_id" varchar,
	"paper_id" varchar,
	"claim_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"claim_statements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"anchored_text" text DEFAULT '' NOT NULL,
	"overlap_score" integer DEFAULT 0 NOT NULL,
	"status" varchar DEFAULT 'queued' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "field_page_versions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" varchar NOT NULL,
	"version_number" integer DEFAULT 0 NOT NULL,
	"summary_one_line" text DEFAULT '' NOT NULL,
	"summary_short" text DEFAULT '' NOT NULL,
	"markdown_full" text DEFAULT '' NOT NULL,
	"visibility" varchar DEFAULT 'draft' NOT NULL,
	"change_log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_user_id" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "field_pages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar NOT NULL,
	"title" text NOT NULL,
	"parent_page_id" varchar,
	"scope_statement" text DEFAULT '' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"current_version_id" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "field_pages_slug_unique" UNIQUE("slug")
);

CREATE TABLE "ingestion_queue" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"citation" text NOT NULL,
	"title" text,
	"arxiv_id" varchar,
	"doi" varchar,
	"requested_by_reference_id" varchar,
	"resolved_paper_id" varchar,
	"status" varchar DEFAULT 'queued' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "page_references" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" varchar NOT NULL,
	"version_id" varchar,
	"section_id" varchar,
	"anchor_text" text,
	"anchor_start_offset" integer,
	"anchor_end_offset" integer,
	"paper_id" varchar,
	"review_version_id" varchar,
	"external_reference_id" varchar,
	"claim_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"claim_status" varchar,
	"note" text DEFAULT '' NOT NULL,
	"status" varchar DEFAULT 'approved' NOT NULL,
	"provenance" varchar DEFAULT 'model_review' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "page_sections" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" varchar NOT NULL,
	"version_id" varchar NOT NULL,
	"slug" varchar NOT NULL,
	"title" text NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"one_line" text DEFAULT '' NOT NULL,
	"short_explanation" text DEFAULT '' NOT NULL,
	"markdown" text DEFAULT '' NOT NULL,
	"anchor_ids" jsonb DEFAULT '[]'::jsonb NOT NULL
);

CREATE TABLE "page_spans" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" varchar NOT NULL,
	"version_id" varchar NOT NULL,
	"section_slug" varchar,
	"text" text DEFAULT '' NOT NULL,
	"start_offset" integer,
	"end_offset" integer,
	"support_status" varchar DEFAULT 'unsourced_explanatory' NOT NULL,
	"superseded" boolean DEFAULT false NOT NULL,
	"reference_id" varchar,
	"created_by_review_version_id" varchar,
	"created_by_paper_id" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "proposed_overview_edits" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_version_id" varchar,
	"paper_id" varchar,
	"overview_slug" varchar NOT NULL,
	"action" varchar NOT NULL,
	"edit_type" varchar,
	"target_page_slug" varchar,
	"target_section_slug" varchar,
	"proposed_markdown" text DEFAULT '' NOT NULL,
	"cited_paper_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cited_claim_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"editor_rationale" jsonb,
	"safety_check" jsonb,
	"reason" text DEFAULT '' NOT NULL,
	"status" varchar DEFAULT 'draft_applied' NOT NULL,
	"applied_version_id" varchar,
	"reverted_from_version_id" varchar,
	"idempotency_key" varchar,
	"equation_flags" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "review_versions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"paper_id" varchar NOT NULL,
	"prompt_name" varchar DEFAULT 'explanatory-update-B2.1' NOT NULL,
	"prompt_version" varchar DEFAULT '' NOT NULL,
	"prompt_hash" varchar DEFAULT '' NOT NULL,
	"recommended_score" integer,
	"estimated_importance_low" integer,
	"estimated_importance_high" integer,
	"scope" varchar,
	"correctness_internal" varchar,
	"correctness_public" varchar DEFAULT 'hidden' NOT NULL,
	"claims" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence_packets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"overview_impact" jsonb,
	"contribution_passage" text DEFAULT '' NOT NULL,
	"adjudicated_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "calibration_pairs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id_a" varchar NOT NULL,
	"review_id_b" varchar NOT NULL,
	"prompt_hash" varchar NOT NULL,
	"cohort_id" varchar,
	"calibration_version" varchar,
	"model" varchar,
	"overall_winner_review_id" varchar,
	"margin" varchar,
	"position_inconsistent" integer DEFAULT 0 NOT NULL,
	"input_strength_winner_review_id" varchar,
	"construction_strength_winner_review_id" varchar,
	"output_strength_winner_review_id" varchar,
	"judgments_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unique_calibration_pair" UNIQUE("review_id_a","review_id_b","prompt_hash")
);

CREATE TABLE "comments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"paper_id" varchar NOT NULL,
	"author_id" varchar NOT NULL,
	"author_name" varchar NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "likes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"target_id" varchar NOT NULL,
	"target_type" varchar NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unique_like" UNIQUE("user_id","target_id")
);

CREATE TABLE "papers" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"author_id" varchar NOT NULL,
	"author_name" varchar NOT NULL,
	"paper_authors" text,
	"date_metadata" jsonb,
	"field" varchar DEFAULT 'Unknown' NOT NULL,
	"subfields" jsonb DEFAULT '[]'::jsonb,
	"score" integer,
	"model_name" varchar,
	"pdf_url" text,
	"display_pdf" integer DEFAULT 0 NOT NULL,
	"likes_count" integer DEFAULT 0 NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"comment_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "realized_yield_assessments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"paper_id" varchar NOT NULL,
	"realized_yield_score" integer NOT NULL,
	"trajectory_assessment" varchar NOT NULL,
	"rationale" text DEFAULT '' NOT NULL,
	"evidence_json" jsonb,
	"publication_date" varchar,
	"paper_age_years" numeric,
	"paper_type" varchar,
	"prompt_hash" varchar,
	"model_name" varchar,
	"assessment_json" jsonb,
	"assessed_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "review_attempts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"paper_id" varchar,
	"file_name" text,
	"review_run_id" varchar,
	"stage_name" varchar NOT NULL,
	"stage_type" varchar NOT NULL,
	"model" varchar,
	"prompt_version" varchar,
	"prompt_hash" varchar,
	"request_id" varchar,
	"error_message" text NOT NULL,
	"raw_error_code" varchar,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"extraction_completeness_status" varchar,
	"extraction_warnings" jsonb DEFAULT '[]'::jsonb,
	"extraction_retry_attempted" integer DEFAULT 0 NOT NULL,
	"pdf_fallback_attempted" integer DEFAULT 0 NOT NULL,
	"pdf_visible_fallback_used" integer DEFAULT 0 NOT NULL,
	"fallback_succeeded" integer DEFAULT 0 NOT NULL,
	"review_status" varchar,
	"failure_status" varchar,
	"scientific_scoring_attempted" integer DEFAULT 0 NOT NULL,
	"debug_payload" jsonb,
	"retryable" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "reviews" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"paper_id" varchar NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"correctness" text DEFAULT '' NOT NULL,
	"novelty" text DEFAULT '' NOT NULL,
	"overall_evaluation" text DEFAULT '' NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"related_work" text DEFAULT '' NOT NULL,
	"central_claim" text,
	"established_results" text,
	"interpretive_claims" text,
	"speculative_claims" text,
	"economy" text,
	"scope_depth" text,
	"unifying_power" text,
	"strongest_case_for_importance" text,
	"strongest_objection" text,
	"decisive_check" text,
	"internal_technical_traction" text,
	"novelty_confidence" numeric,
	"explanatory_target_breadth" text,
	"theory_space_breadth" text,
	"intrinsic_scientific_merit_score" integer,
	"explanatory_target_breadth_score" integer,
	"theory_space_breadth_score" integer,
	"breadth_of_impact_score" integer,
	"overall_intrinsic_score" integer,
	"best_classification" varchar,
	"final_judgment" text,
	"coverage_ledger_json" text,
	"thinking_text" text,
	"simplified_explanation" text,
	"model_name" varchar NOT NULL,
	"system_prompt" text DEFAULT '' NOT NULL,
	"likes_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "sandbox_reviews" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"paper_id" varchar NOT NULL,
	"label" varchar NOT NULL,
	"prompt_hash" varchar NOT NULL,
	"prompt_text" text NOT NULL,
	"model_name" varchar,
	"review_json" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "review_sessions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prompt_text" text DEFAULT '' NOT NULL,
	"model_names" text DEFAULT '' NOT NULL,
	"paper_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "session_papers" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" varchar NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"paper_authors" text,
	"field" varchar,
	"model_name" varchar,
	"best_classification" varchar,
	"overall_score" integer,
	"intrinsic_merit_score" integer,
	"explanatory_target_breadth_score" integer,
	"theory_space_breadth_score" integer,
	"breadth_of_impact_score" integer,
	"review_json" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "attribution_checks" ADD CONSTRAINT "attribution_checks_paper_id_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "field_page_versions" ADD CONSTRAINT "field_page_versions_page_id_field_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."field_pages"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "field_page_versions" ADD CONSTRAINT "field_page_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "ingestion_queue" ADD CONSTRAINT "ingestion_queue_resolved_paper_id_papers_id_fk" FOREIGN KEY ("resolved_paper_id") REFERENCES "public"."papers"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "page_references" ADD CONSTRAINT "page_references_page_id_field_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."field_pages"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "page_references" ADD CONSTRAINT "page_references_version_id_field_page_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."field_page_versions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "page_references" ADD CONSTRAINT "page_references_paper_id_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "page_sections" ADD CONSTRAINT "page_sections_page_id_field_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."field_pages"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "page_sections" ADD CONSTRAINT "page_sections_version_id_field_page_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."field_page_versions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "page_spans" ADD CONSTRAINT "page_spans_page_id_field_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."field_pages"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "page_spans" ADD CONSTRAINT "page_spans_version_id_field_page_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."field_page_versions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "proposed_overview_edits" ADD CONSTRAINT "proposed_overview_edits_paper_id_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "review_versions" ADD CONSTRAINT "review_versions_paper_id_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "comments" ADD CONSTRAINT "comments_paper_id_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "likes" ADD CONSTRAINT "likes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "papers" ADD CONSTRAINT "papers_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "realized_yield_assessments" ADD CONSTRAINT "realized_yield_assessments_paper_id_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "review_attempts" ADD CONSTRAINT "review_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "review_attempts" ADD CONSTRAINT "review_attempts_paper_id_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_paper_id_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "sandbox_reviews" ADD CONSTRAINT "sandbox_reviews_paper_id_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "session_papers" ADD CONSTRAINT "session_papers_session_id_review_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."review_sessions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");
CREATE UNIQUE INDEX "proposed_overview_edits_idem_idx" ON "proposed_overview_edits" USING btree ("idempotency_key");
