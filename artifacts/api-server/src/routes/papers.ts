import { Router } from "express";
import { db, papersTable, reviewsTable, commentsTable, likesTable, reviewAttemptsTable, calibrationPairsTable, sandboxReviewsTable, realizedYieldAssessmentsTable } from "@workspace/db";
import { eq, desc, and, sql } from "drizzle-orm";
import { createHash, randomUUID } from "crypto";
import { ai as geminiAI } from "@workspace/integrations-gemini-ai";
import { logger } from "../lib/logger";
import {
  BENCHMARK_SET_VERSION,
  GEMINI_CALIBRATION_MODEL,
  GEMINI_META_MODEL,
  GEMINI_METADATA_MODEL,
  GEMINI_PASS_MODEL,
  REVIEW_FULL_PROMPT_SYSTEM,
  REVIEW_PROMPT_HASH,
  REVIEW_PROMPT_NAME,
  REVIEW_PROMPT_VERSION,
  REVIEW_SYSTEM_INSTRUCTION as LATEST_REVIEW_SYSTEM_INSTRUCTION,
  assessExtractionCompleteness,
  benchmarkAnchorEligible,
  calibrationAnchorEligible,
  clusteringScopeIncludesReview,
  isAdminPinnedAnchorOverride,
  buildPdfFallbackText,
  compactAggregateForStorage,
  expectedReviewModelName,
  extractManuscriptTextFromPdfForReview,
  detectReviewerDirectedText,
  extractMetadata as extractLatestMetadata,
  generateCompatReview,
  isExtractionBlockingStatus,
  isExtractionReviewableStatus,
  isCalibrationCompatibleReviewObject,
  normalizePaperDisplayMetadata,
  normalizeReviewPipelineMode,
  parseGeminiJsonResponse,
  recalibrateStoredAggregateWithComparators,
  reviewRuntimeInfo,
  v15ComparatorCalibrationForStorage,
  type ComparatorContextSelector,
  type ReviewPipelineMode,
  type ReviewComparatorContextItem,
  type ReviewModel,
  type ReviewInput,
  type ExtractionCompletenessReport,
  type ExtractedPaperMetadata,
} from "../lib/reviewEngineCompat";
import { BENCHMARK_PROFILE_CLUSTERING_V9_PROMPT } from "../lib/prompts/benchmarkCalibratedV9";
import { REALIZED_YIELD_V1_PROMPT } from "../lib/prompts/realizedYieldV1";
import { stripPdfIdentifyingMetadataSafe } from "../lib/pdfBlinding";
import {
  PAIRWISE_CALIBRATION_PROMPT_HASH,
  PAIRWISE_CALIBRATION_VERSION,
  PAIRWISE_JUDGE_CONCURRENCY,
  judgePair,
  outcomeFromStoredPair,
  planCohortPairs,
  runWithConcurrency,
  strippedReviewForPairwise,
  type PairwiseCalibrationMember,
  type PlannedPair,
} from "../lib/pairwiseCalibration";
import {
  CALIBRATION_MODE_PAIRWISE_BT_V2,
  CALIBRATION_TRIPWIRE_DELTA_POINTS,
  calibrateCohortsV2,
  calibrationTripwireTriggered,
  type CalibrationCohortInput,
  type CalibrationPairOutcome,
  type CohortFitResult,
} from "../lib/calibrationFit";

const ADMIN_EMAIL = process.env.VITE_ADMIN_EMAIL || process.env.ADMIN_EMAIL || "";

const router = Router();
const recentSubmissions = new Map<string, Promise<{ paper: typeof papersTable.$inferSelect; review: typeof reviewsTable.$inferSelect | null }>>();
const REVIEW_JOB_CONCURRENCY = Math.max(1, Number(process.env.REVIEW_JOB_CONCURRENCY ?? 2) || 2);
const REVIEW_JOB_STALE_MS = Math.max(5 * 60 * 1000, Number(process.env.REVIEW_JOB_STALE_MS ?? 15 * 60 * 1000) || 15 * 60 * 1000);
const REVIEW_JOB_LEASE_MS = Math.max(REVIEW_JOB_STALE_MS, Number(process.env.REVIEW_JOB_LEASE_MS ?? 25 * 60 * 1000) || 25 * 60 * 1000);
const REVIEW_JOB_HEARTBEAT_MS = Math.max(15 * 1000, Number(process.env.REVIEW_JOB_HEARTBEAT_MS ?? 45 * 1000) || 45 * 1000);
const REVIEW_JOB_RECOVERY_INTERVAL_MS = Math.max(5 * 1000, Number(process.env.REVIEW_JOB_RECOVERY_INTERVAL_MS ?? 5 * 1000) || 5 * 1000);
const REVIEW_JOB_RECOVERY_LIMIT = Math.max(20, Number(process.env.REVIEW_JOB_RECOVERY_LIMIT ?? 300) || 300);
const REVIEW_JOB_AUTO_RECOVERY = process.env.REVIEW_JOB_AUTO_RECOVERY === "true";
const REVIEW_JOB_MAX_AUTO_RETRIES = Math.max(0, Number(process.env.REVIEW_JOB_MAX_AUTO_RETRIES ?? 0) || 0);
const PAPER_FEED_LIMIT = Math.max(1, Math.min(500, Number(process.env.PAPER_FEED_LIMIT ?? 250) || 250));
const RETAIN_COMPLETED_REVIEW_JOB_SOURCE_SNAPSHOTS = process.env.RETAIN_COMPLETED_REVIEW_JOB_SOURCE_SNAPSHOTS === "true";
const RETAIN_FAILED_REVIEW_JOB_SOURCE_SNAPSHOTS = process.env.RETAIN_FAILED_REVIEW_JOB_SOURCE_SNAPSHOTS === "true";
const REVIEW_PROCESS_ROLE = process.env.REVIEW_PROCESS_ROLE || "combined";
const REVIEW_JOB_PROCESSING_ENABLED =
  process.env.REVIEW_JOB_PROCESSING_ENABLED !== "false" && REVIEW_PROCESS_ROLE !== "web";
const REVIEW_JOB_WORKER_ID = [
  REVIEW_PROCESS_ROLE,
  process.env.RAILWAY_DEPLOYMENT_ID || process.env.RAILWAY_REPLICA_ID || "local",
  process.pid,
  randomUUID().slice(0, 8),
].join(":");
const queuedReviewJobIds: string[] = [];
const activeReviewJobIds = new Set<string>();
let reviewJobDrainScheduled = false;
let reviewJobRecoveryStarted = false;

type ReviewAttemptStageName =
  | "upload_received"
  | "request_received"
  | "client_failure"
  | "file_read_failed"
  | "interrupted_by_server_restart"
  | "worker_build_mismatch"
  | "metadata_extraction"
  | "title_author_extraction"
  | "pdf_text_extraction"
  | "pdf_fallback_extraction"
  | "pdf_visible_last_resort"
  | "extraction_quality_check"
  | "blind_pass_1"
  | "blind_pass_2"
  | "adjudicator"
  | "json_parse"
  | "review_validation"
  | "save_review";

type ReviewAttemptStageType = "queue" | "request" | "client" | "system" | "extraction" | "helper" | "scientific_review" | "validation" | "storage";

interface ReviewAttemptRecord {
  attemptId: string;
  batchRunId: string | null;
  queueItemId: string | null;
  frontendSiteVersion: string | null;
  userId: string | null;
  paperId: string | null;
  fileName: string | null;
  reviewRunId: string | null;
  stageName: ReviewAttemptStageName;
  stageType: ReviewAttemptStageType;
  model: string | null;
  promptVersion: string | null;
  promptHash: string | null;
  requestId: string | null;
  errorMessage: string;
  rawErrorCode: string | number | null;
  retryCount: number;
  extractionCompletenessStatus: string | null;
  extractionWarnings: string[];
  extractionRetryAttempted: boolean;
  pdfFallbackAttempted: boolean;
  pdfVisibleFallbackUsed: boolean;
  fallbackSucceeded: boolean;
  reviewStatus: string | null;
  failureStatus: string | null;
  scientificScoringAttempted: boolean;
  debugPayload: Record<string, unknown> | null;
  retryable: boolean;
  createdAt: string;
}

interface ReviewAttemptContext {
  attemptId: string;
  batchRunId: string | null;
  queueItemId: string | null;
  frontendSiteVersion: string | null;
  createdAt: string;
  userId: string | null;
  paperId: string | null;
  fileName: string | null;
  reviewRunId: string | null;
  stageName: ReviewAttemptStageName;
  stageType: ReviewAttemptStageType;
  model: string | null;
  promptVersion: string | null;
  promptHash: string | null;
  requestId: string | null;
  retryCount: number;
  extractionCompletenessStatus: string | null;
  extractionWarnings: string[];
  extractionRetryAttempted: boolean;
  pdfFallbackAttempted: boolean;
  pdfVisibleFallbackUsed: boolean;
  fallbackSucceeded: boolean;
  reviewStatus: string | null;
  scientificScoringAttempted: boolean;
  debugPayload: Record<string, unknown> | null;
}

const failedReviewAttempts: ReviewAttemptRecord[] = [];
const MAX_FAILED_REVIEW_ATTEMPTS = 500;

function setAttemptStage(
  context: ReviewAttemptContext,
  stageName: ReviewAttemptStageName,
  stageType: ReviewAttemptStageType,
  model: string | null = context.model,
) {
  context.stageName = stageName;
  context.stageType = stageType;
  context.model = model;
  if (stageType === "scientific_review") {
    context.scientificScoringAttempted = true;
  }
}

function updateAttemptExtractionContext(context: ReviewAttemptContext, report: ExtractionCompletenessReport | null) {
  if (!report) return;
  context.extractionCompletenessStatus = report.extractionCompletenessStatus;
  context.extractionWarnings = report.extractionWarnings;
}

function rawErrorCode(err: any): string | number | null {
  return err?.code ?? err?.status ?? err?.statusCode ?? err?.cause?.code ?? err?.cause?.status ?? null;
}

function retryCountFromErrorMessage(message: string) {
  const explicit = message.match(/failed after\s+(\d+)\s+attempts/i)?.[1];
  if (explicit) return Number(explicit);
  const attempts = [...message.matchAll(/attempt\s+(\d+)/gi)].map((match) => Number(match[1])).filter(Number.isFinite);
  return attempts.length ? Math.max(...attempts) : 0;
}

function classifyAttemptFromError(context: ReviewAttemptContext, err: unknown, message: string): ReviewAttemptContext {
  const next = { ...context };
  if (/pass\s*1|blind[_ -]?pass[_ -]?1/i.test(message)) {
    setAttemptStage(next, "blind_pass_1", "scientific_review", GEMINI_PASS_MODEL);
  } else if (/pass\s*2|blind[_ -]?pass[_ -]?2/i.test(message)) {
    setAttemptStage(next, "blind_pass_2", "scientific_review", GEMINI_PASS_MODEL);
  } else if (/adjudicat/i.test(message)) {
    setAttemptStage(next, "adjudicator", "scientific_review", GEMINI_META_MODEL);
  } else if (/input self-check failed|deterministic reviewable extraction/i.test(message)) {
    next.stageType = context.stageType === "scientific_review" ? "scientific_review" : "validation";
    next.reviewStatus = "failed_validation";
  } else if (/bad escaped character|could not parse|did not contain valid json|invalid json|json/i.test(message)) {
    next.stageName = context.stageName === "metadata_extraction" || context.stageName === "title_author_extraction" || context.stageName === "pdf_fallback_extraction"
      ? context.stageName
      : "json_parse";
    next.stageType = context.stageType === "scientific_review" ? "scientific_review" : "helper";
  } else if ((err as any)?.reviewStatus === "invalid_extraction_truncated" || /truncated|extraction/i.test(message)) {
    setAttemptStage(next, "extraction_quality_check", "extraction", null);
    next.reviewStatus = "invalid_extraction_truncated";
  }
  if (/input self-check failed|deterministic reviewable extraction/i.test(message)) {
    next.reviewStatus = "failed_validation";
  }
  return next;
}

function isRetryableAttemptError(message: string, statusCode: number | null) {
  if (statusCode === 422 || /invalid_extraction_truncated/i.test(message)) return true;
  if ([429, 500, 502, 503, 504].includes(statusCode ?? 0)) return true;
  return /bad escaped character|could not parse|json|transient model error|resource[_ ]exhausted|unavailable|overloaded|rate limit|quota|temporar|\b(429|500|502|503|504)\b/i.test(message);
}

function failureStatusForAttempt(record: Pick<ReviewAttemptRecord, "stageName" | "stageType" | "errorMessage" | "reviewStatus" | "extractionCompletenessStatus" | "retryable">): string | null {
  const message = record.errorMessage || "";
  if (!message.trim()) {
    const activeReviewStatuses = new Set([
      "upload_received",
      "queued",
      "running",
      "request_received",
      "pdf_text_extraction",
      "pdf_fallback_extraction",
      "pdf_visible_last_resort",
      "extraction_quality_check",
      "metadata_extraction",
      "title_author_extraction",
      "blind_pass_1",
      "blind_pass_2",
      "adjudicator",
      "json_parse",
      "review_validation",
      "save_review",
      "manual_text_received",
    ]);
    const activeStageNames = new Set<ReviewAttemptStageName>([
      "upload_received",
      "request_received",
      "pdf_text_extraction",
      "pdf_fallback_extraction",
      "pdf_visible_last_resort",
      "extraction_quality_check",
      "metadata_extraction",
      "title_author_extraction",
      "blind_pass_1",
      "blind_pass_2",
      "adjudicator",
      "json_parse",
      "review_validation",
      "save_review",
    ]);
    if (
      activeReviewStatuses.has(record.reviewStatus ?? "") ||
      activeStageNames.has(record.stageName)
    ) {
      return null;
    }
  }
  if (/input self-check failed|deterministic reviewable extraction/i.test(message)) {
    return "failed_validation";
  }
  if (record.stageName === "pdf_fallback_extraction" && /json|bad escaped character|parse/i.test(message)) {
    return "failed_pdf_fallback_json";
  }
  if (
    (record.stageType === "scientific_review" || record.stageName === "json_parse") &&
    /json|bad escaped character|parse/i.test(message)
  ) {
    return "failed_review_json";
  }
  if (
    record.reviewStatus === "invalid_extraction_truncated" ||
    (record.extractionCompletenessStatus && isExtractionBlockingStatus(record.extractionCompletenessStatus))
  ) {
    return record.extractionCompletenessStatus === "needs_manual_repair" ? "needs_manual_repair" : "failed_extraction_truncated";
  }
  if (
    record.stageName === "interrupted_by_server_restart" ||
    record.stageName === "worker_build_mismatch" ||
    record.reviewStatus === "interrupted_by_server_restart"
  ) {
    return "interrupted_by_server_restart";
  }
  if (record.stageName === "review_validation" || /validation|missing|required|invalid/i.test(message)) {
    return "failed_validation";
  }
  return record.retryable ? "retryable" : "needs_manual_repair";
}

function toDbBool(value: boolean) {
  return value ? 1 : 0;
}

function debugPayloadObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function debugString(payload: Record<string, unknown> | null, key: string): string | null {
  const value = payload?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function runtimeGitSha(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const build = (value as any).build;
  const sha = build && typeof build === "object" ? build.railwayGitCommitSha : null;
  return typeof sha === "string" && sha.trim() ? sha.trim() : null;
}

function debugNumber(payload: Record<string, unknown> | null, key: string): number | null {
  const value = payload?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function attemptDebugPayload(context: ReviewAttemptContext, extra: Record<string, unknown> = {}) {
  return {
    ...debugPayloadObject(context.debugPayload),
    batchRunId: context.batchRunId,
    queueItemId: context.queueItemId,
    frontendSiteVersion: context.frontendSiteVersion,
    apiRuntime: reviewRuntimeInfo(),
    ...extra,
  };
}

function completedAttemptDebugPayload(context: ReviewAttemptContext, extra: Record<string, unknown> = {}) {
  const payload: Record<string, unknown> = attemptDebugPayload(context, {
    ...extra,
    jobStatus: "completed",
    completedAt: new Date().toISOString(),
    apiRuntimeAtCompleted: reviewRuntimeInfo(),
  });
  if (!RETAIN_COMPLETED_REVIEW_JOB_SOURCE_SNAPSHOTS && payload.sourceSnapshot) {
    payload.sourceSnapshot = summarizeSourceSnapshot(payload.sourceSnapshot);
    payload.sourceSnapshotRedacted = true;
    payload.sourceSnapshotRetentionNote = "Completed review job source payload was redacted after completion to avoid retaining uploaded PDF/text bodies in Postgres.";
  }
  return payload;
}

function failedAttemptDebugPayload(context: ReviewAttemptContext, extra: Record<string, unknown> = {}) {
  const payload: Record<string, unknown> = attemptDebugPayload(context, {
    ...extra,
    jobStatus: "failed",
    failedAt: typeof extra.failedAt === "string" ? extra.failedAt : new Date().toISOString(),
    apiRuntimeAtFailed: reviewRuntimeInfo(),
  });
  return redactTerminalAttemptSourcePayload(payload);
}

function redactTerminalAttemptSourcePayload(payload: Record<string, unknown>) {
  if (RETAIN_FAILED_REVIEW_JOB_SOURCE_SNAPSHOTS) return payload;
  const redacted = { ...payload };
  let redactedSource = false;
  if (redacted.sourceSnapshot) {
    redacted.sourceSnapshot = summarizeSourceSnapshot(redacted.sourceSnapshot);
    redactedSource = true;
  }
  if (redacted.source) {
    redacted.source = summarizeSourceSnapshot(redacted.source);
    redactedSource = true;
  }
  if (redactedSource) {
    redacted.sourceSnapshotRedacted = true;
    redacted.sourceSnapshotRetentionNote =
      "Terminal failed review job source payload was redacted to avoid retaining uploaded PDF/text bodies in Postgres. Re-upload the file or provide manual text to retry.";
  }
  return redacted;
}

function reviewJobLeaseExpiresAt(now = Date.now()) {
  return new Date(now + REVIEW_JOB_LEASE_MS).toISOString();
}

function reviewJobAutoRetryCount(record: ReviewAttemptRecord) {
  const payload = debugPayloadObject(record.debugPayload);
  return debugNumber(payload, "autoRecoveryCount") ?? 0;
}

function canAutoRecoverReviewJob(record: ReviewAttemptRecord) {
  return REVIEW_JOB_MAX_AUTO_RETRIES > 0 && reviewJobAutoRetryCount(record) < REVIEW_JOB_MAX_AUTO_RETRIES;
}

function jobLeaseExpired(record: ReviewAttemptRecord, now = Date.now()) {
  const payload = debugPayloadObject(record.debugPayload);
  if (payload.jobStatus !== "running") return false;
  const leaseExpiresAt = timestampMs(payload.leaseExpiresAt);
  if (leaseExpiresAt == null) return ageForAttempt(record, now).ageMs != null && ageForAttempt(record, now).ageMs! > REVIEW_JOB_STALE_MS;
  return leaseExpiresAt + 1000 < now;
}

function reviewAttemptInsertValues(record: ReviewAttemptRecord): typeof reviewAttemptsTable.$inferInsert {
  return {
    id: record.attemptId,
    userId: record.userId,
    paperId: record.paperId,
    fileName: record.fileName,
    reviewRunId: record.reviewRunId,
    stageName: record.stageName,
    stageType: record.stageType,
    model: record.model,
    promptVersion: record.promptVersion,
    promptHash: record.promptHash,
    requestId: record.requestId,
    errorMessage: record.errorMessage,
    rawErrorCode: record.rawErrorCode == null ? null : String(record.rawErrorCode),
    retryCount: record.retryCount,
    extractionCompletenessStatus: record.extractionCompletenessStatus,
    extractionWarnings: record.extractionWarnings,
    extractionRetryAttempted: toDbBool(record.extractionRetryAttempted),
    pdfFallbackAttempted: toDbBool(record.pdfFallbackAttempted),
    pdfVisibleFallbackUsed: toDbBool(record.pdfVisibleFallbackUsed),
    fallbackSucceeded: toDbBool(record.fallbackSucceeded),
    reviewStatus: record.reviewStatus,
    failureStatus: record.failureStatus,
    scientificScoringAttempted: toDbBool(record.scientificScoringAttempted),
    debugPayload: record.debugPayload,
    retryable: toDbBool(record.retryable),
  };
}

function reviewAttemptRecordFromRow(row: typeof reviewAttemptsTable.$inferSelect): ReviewAttemptRecord {
  const debugPayload = row.debugPayload ?? null;
  return {
    attemptId: row.id,
    batchRunId: debugString(debugPayload, "batchRunId"),
    queueItemId: debugString(debugPayload, "queueItemId"),
    frontendSiteVersion: debugString(debugPayload, "frontendSiteVersion"),
    userId: row.userId,
    paperId: row.paperId,
    fileName: row.fileName,
    reviewRunId: row.reviewRunId,
    stageName: row.stageName as ReviewAttemptStageName,
    stageType: row.stageType as ReviewAttemptStageType,
    model: row.model,
    promptVersion: row.promptVersion,
    promptHash: row.promptHash,
    requestId: row.requestId,
    errorMessage: row.errorMessage,
    rawErrorCode: row.rawErrorCode,
    retryCount: row.retryCount,
    extractionCompletenessStatus: row.extractionCompletenessStatus,
    extractionWarnings: Array.isArray(row.extractionWarnings) ? row.extractionWarnings : [],
    extractionRetryAttempted: row.extractionRetryAttempted === 1,
    pdfFallbackAttempted: row.pdfFallbackAttempted === 1,
    pdfVisibleFallbackUsed: row.pdfVisibleFallbackUsed === 1,
    fallbackSucceeded: row.fallbackSucceeded === 1,
    reviewStatus: row.reviewStatus,
    failureStatus: row.failureStatus ?? failureStatusForAttempt({
      stageName: row.stageName as ReviewAttemptStageName,
      stageType: row.stageType as ReviewAttemptStageType,
      errorMessage: row.errorMessage,
      reviewStatus: row.reviewStatus,
      extractionCompletenessStatus: row.extractionCompletenessStatus,
      retryable: row.retryable === 1,
    }),
    scientificScoringAttempted: row.scientificScoringAttempted === 1,
    debugPayload,
    retryable: row.retryable === 1,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : new Date(row.createdAt).toISOString(),
  };
}

function reviewAttemptRecordFromContext(
  context: ReviewAttemptContext,
  overrides: Partial<ReviewAttemptRecord> = {},
): ReviewAttemptRecord {
  const record: ReviewAttemptRecord = {
    attemptId: context.attemptId,
    batchRunId: context.batchRunId,
    queueItemId: context.queueItemId,
    frontendSiteVersion: context.frontendSiteVersion,
    userId: context.userId,
    paperId: context.paperId,
    fileName: context.fileName,
    reviewRunId: context.reviewRunId,
    stageName: context.stageName,
    stageType: context.stageType,
    model: context.model,
    promptVersion: context.promptVersion,
    promptHash: context.promptHash,
    requestId: context.requestId,
    errorMessage: "",
    rawErrorCode: null,
    retryCount: context.retryCount,
    extractionCompletenessStatus: context.extractionCompletenessStatus,
    extractionWarnings: context.extractionWarnings,
    extractionRetryAttempted: context.extractionRetryAttempted,
    pdfFallbackAttempted: context.pdfFallbackAttempted,
    pdfVisibleFallbackUsed: context.pdfVisibleFallbackUsed,
    fallbackSucceeded: context.fallbackSucceeded,
    reviewStatus: context.reviewStatus,
    failureStatus: null,
    scientificScoringAttempted: context.scientificScoringAttempted,
    debugPayload: attemptDebugPayload(context),
    retryable: true,
    createdAt: context.createdAt,
  };
  return { ...record, ...overrides };
}

async function persistReviewAttemptRecord(record: ReviewAttemptRecord) {
  const values = reviewAttemptInsertValues(record);
  const { id: _id, createdAt: _createdAt, ...updateValues } = values as Record<string, unknown>;
  await db.insert(reviewAttemptsTable)
    .values(values)
    .onConflictDoUpdate({
      target: reviewAttemptsTable.id,
      set: updateValues,
    });
}

async function updateReviewAttemptProgress(
  context: ReviewAttemptContext,
  overrides: Partial<ReviewAttemptRecord> = {},
) {
  const record = reviewAttemptRecordFromContext(context, {
    ...overrides,
    debugPayload: attemptDebugPayload(context, debugPayloadObject(overrides.debugPayload)),
  });
  try {
    await persistReviewAttemptRecord(record);
  } catch (err) {
    logger.error({ err, attempt: record }, "Failed to persist review attempt progress");
  }
  return record;
}

function isClientAttempt(record: ReviewAttemptRecord) {
  return record.stageType === "client" ||
    record.stageName === "client_failure" ||
    debugPayloadObject(record.debugPayload).clientFailure === true;
}

function isCompletedAttempt(record: ReviewAttemptRecord) {
  return record.failureStatus === "completed" ||
    record.reviewStatus === "completed" ||
    record.reviewStatus === "duplicate_existing" ||
    record.reviewStatus === "completed_reused" ||
    record.reviewStatus === "completed_reused_inflight";
}

function isInterruptedReviewAttempt(record: ReviewAttemptRecord) {
  const payload = debugPayloadObject(record.debugPayload);
  return record.stageName === "interrupted_by_server_restart" ||
    record.reviewStatus === "interrupted_by_server_restart" ||
    record.failureStatus === "interrupted_by_server_restart" ||
    payload.interruptedByServerRestart === true;
}

function isTerminalAttempt(record: ReviewAttemptRecord) {
  if (isCompletedAttempt(record)) return true;
  if (isClientAttempt(record)) return true;
  if (record.errorMessage.trim()) return true;
  if (record.retryable === false) return true;
  return Boolean(record.failureStatus && record.failureStatus !== "retryable");
}

function apiProcessStartedAtMs() {
  const processStartedAt = reviewRuntimeInfo()?.build?.processStartedAt;
  const timestamp = typeof processStartedAt === "string" ? Date.parse(processStartedAt) : NaN;
  return Number.isFinite(timestamp) ? timestamp : null;
}

function timestampMs(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function runtimeStartedAtMs(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  return timestampMs((value as any)?.build?.processStartedAt);
}

function frontendPageStaleAfterApiRestart(source: any) {
  const pageLoadedAt = timestampMs(optionalSourceString(source, "frontendPageLoadedAt"));
  const processStartedAt = apiProcessStartedAtMs();
  return pageLoadedAt != null && processStartedAt != null && processStartedAt > pageLoadedAt + 1000;
}

function sourceSnapshotBackendGitSha(sourceSnapshot: Record<string, any>, record: ReviewAttemptRecord) {
  const payload = debugPayloadObject(record.debugPayload);
  return runtimeGitSha(sourceSnapshot.apiRuntimeVersion) ??
    runtimeGitSha(sourceSnapshot.apiRuntimeAtBatchStart) ??
    runtimeGitSha(payload.apiRuntimeAtRegistration) ??
    runtimeGitSha(payload.apiRuntimeAtQueued) ??
    null;
}

async function markReviewJobWorkerBuildMismatch(record: ReviewAttemptRecord, sourceSnapshot: Record<string, any>, expectedGitSha: string, workerGitSha: string) {
  const payload = debugPayloadObject(record.debugPayload);
  const mismatchRecord: ReviewAttemptRecord = {
    ...record,
    stageName: "worker_build_mismatch",
    stageType: "system",
    errorMessage: `Worker build mismatch: job was created by ${expectedGitSha}, but this worker is running ${workerGitSha}. Refresh/retry so the paper is reviewed by one consistent deployment.`,
    rawErrorCode: "WORKER_BUILD_MISMATCH",
    reviewStatus: "interrupted_by_server_restart",
    failureStatus: "interrupted_by_server_restart",
    retryable: true,
    debugPayload: {
      ...payload,
      jobStatus: "interrupted_by_worker_build_mismatch",
      expectedApiGitSha: expectedGitSha,
      workerGitSha,
      sourceSnapshotApiRuntimeVersion: sourceSnapshot.apiRuntimeVersion ?? null,
      apiRuntimeAtMismatch: reviewRuntimeInfo(),
      workerId: REVIEW_JOB_WORKER_ID,
    },
  };
  await persistReviewAttemptRecord(mismatchRecord);
  return mismatchRecord;
}

function attemptLifecycleStartedAtMs(record: ReviewAttemptRecord): number | null {
  const payload = debugPayloadObject(record.debugPayload);
  const candidates = [
    timestampMs(record.createdAt),
    timestampMs(payload.queuedAt),
    timestampMs(payload.requestReceivedAt),
    timestampMs(payload.clientRequestStartedAt),
    timestampMs(payload.workerStartedAt),
    timestampMs(payload.workerHeartbeatAt),
    timestampMs(payload.leaseStartedAt),
    runtimeStartedAtMs(payload.apiRuntimeAtQueued),
    runtimeStartedAtMs(payload.apiRuntimeAtWorkerStart),
    runtimeStartedAtMs(payload.apiRuntimeAtHeartbeat),
    runtimeStartedAtMs(payload.apiRuntimeAtRequestStart),
    runtimeStartedAtMs(payload.apiRuntimeAtRegistration),
    runtimeStartedAtMs(payload.apiRuntimeVersion),
  ].filter((timestamp): timestamp is number => timestamp != null);
  return candidates.length ? Math.max(...candidates) : null;
}

function interruptedByServerRestart(record: ReviewAttemptRecord) {
  if (REVIEW_PROCESS_ROLE === "web") return false;
  if (isTerminalAttempt(record)) return false;
  if (isClientAttempt(record)) return false;
  const payload = debugPayloadObject(record.debugPayload);
  if (payload.jobStatus !== "running" && record.reviewStatus !== "running") return false;
  const processStartedAt = apiProcessStartedAtMs();
  const lifecycleStartedAt = attemptLifecycleStartedAtMs(record);
  return processStartedAt != null && lifecycleStartedAt != null && processStartedAt > lifecycleStartedAt + 1000;
}

function withRuntimeAttemptStatus(record: ReviewAttemptRecord): ReviewAttemptRecord {
  if (!interruptedByServerRestart(record)) return record;
  const payload = debugPayloadObject(record.debugPayload);
  const oldProcessStartedAt =
    (payload.apiRuntimeAtRequestStart as any)?.build?.processStartedAt ??
    (payload.apiRuntimeAtRegistration as any)?.build?.processStartedAt ??
    (payload.apiRuntimeVersion as any)?.build?.processStartedAt ??
    null;
  const newProcessStartedAt = reviewRuntimeInfo()?.build?.processStartedAt ?? null;
  return {
    ...record,
    stageName: "interrupted_by_server_restart",
    stageType: "system",
    errorMessage: "Interrupted by server restart; safe to retry.",
    reviewStatus: "interrupted_by_server_restart",
    failureStatus: "interrupted_by_server_restart",
    retryable: true,
    debugPayload: {
      ...payload,
      interruptedByServerRestart: true,
      apiRuntimePreviousProcessStartedAt: oldProcessStartedAt,
      apiRuntimeCurrentProcessStartedAt: newProcessStartedAt,
      apiRuntimeAtExport: reviewRuntimeInfo(),
      originalStageName: record.stageName,
      originalStageType: record.stageType,
      originalReviewStatus: record.reviewStatus,
    },
  };
}

function ageForAttempt(record: ReviewAttemptRecord, now = Date.now()) {
  const timestamp = attemptLifecycleStartedAtMs(record);
  const ageMs = timestamp != null ? Math.max(0, now - timestamp) : null;
  return {
    ...record,
    ageMs,
    ageMinutes: ageMs == null ? null : Math.round(ageMs / 60000),
  };
}

function redactedStringSummary(value: unknown) {
  if (typeof value !== "string") return value;
  return {
    redacted: true,
    charCount: value.length,
    sha256: createHash("sha256").update(value).digest("hex"),
  };
}

function summarizeSourceSnapshot(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const snapshot = value as Record<string, unknown>;
  return {
    ...snapshot,
    data: redactedStringSummary(snapshot.data),
    manualText: redactedStringSummary(snapshot.manualText),
    rawText: redactedStringSummary(snapshot.rawText),
    text: redactedStringSummary(snapshot.text),
  };
}

function sanitizeAttemptDebugPayload(value: unknown) {
  const payload = debugPayloadObject(value);
  const sanitized: Record<string, unknown> = { ...payload };
  if ("sourceSnapshot" in sanitized) {
    sanitized.sourceSnapshot = summarizeSourceSnapshot(sanitized.sourceSnapshot);
    sanitized.sourceSnapshotRedacted = true;
  }
  if ("source" in sanitized) {
    sanitized.source = summarizeSourceSnapshot(sanitized.source);
  }
  if (typeof sanitized.data === "string") {
    sanitized.data = redactedStringSummary(sanitized.data);
  }
  return sanitized;
}

function attemptForResponse<T extends ReviewAttemptRecord>(record: T): T {
  return {
    ...record,
    debugPayload: sanitizeAttemptDebugPayload(record.debugPayload),
  };
}

function ageForAttemptResponse(record: ReviewAttemptRecord, now = Date.now()) {
  return attemptForResponse(ageForAttempt(record, now));
}

function latestAttemptByCreatedAt(records: ReviewAttemptRecord[]) {
  return [...records].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] ?? null;
}

function buildBatchExport(records: ReviewAttemptRecord[], requestedBatchRunId?: string | null) {
  const now = Date.now();
  const normalizedRecords = records.map(withRuntimeAttemptStatus);
  const batchRunId =
    requestedBatchRunId ||
    latestAttemptByCreatedAt(normalizedRecords.filter((attempt) => attempt.batchRunId))?.batchRunId ||
    null;
  if (!batchRunId) {
    return {
      currentBatch: null,
      historicalFailedAttempts: normalizedRecords
        .filter((attempt) => !isCompletedAttempt(attempt))
        .map((attempt) => ageForAttemptResponse(attempt, now)),
    };
  }

  const currentRecords = normalizedRecords.filter((attempt) => attempt.batchRunId === batchRunId);
  const historicalRecords = normalizedRecords.filter((attempt) => attempt.batchRunId !== batchRunId);
  const byQueueItem = new Map<string, ReviewAttemptRecord[]>();
  for (const attempt of currentRecords) {
    const key = attempt.queueItemId || attempt.fileName || attempt.attemptId;
    const group = byQueueItem.get(key) ?? [];
    group.push(attempt);
    byQueueItem.set(key, group);
  }
  const items = Array.from(byQueueItem.entries()).map(([key, group]) => {
    const latest = latestAttemptByCreatedAt(group) ?? group[0];
    const latestServer = latestAttemptByCreatedAt(group.filter((attempt) => !isClientAttempt(attempt)));
    const latestClient = latestAttemptByCreatedAt(group.filter(isClientAttempt));
    const completedServer = latestAttemptByCreatedAt(group.filter((attempt) => !isClientAttempt(attempt) && isCompletedAttempt(attempt)));
    const effectiveLatest = completedServer ?? latestServer ?? latestClient ?? latest;
    const latestPayload = debugPayloadObject(effectiveLatest.debugPayload);
    const terminal = isCompletedAttempt(effectiveLatest)
      ? "completed"
      : effectiveLatest.failureStatus || effectiveLatest.reviewStatus || "in_progress";
    return {
      key,
      queueItemId: effectiveLatest.queueItemId,
      fileName: effectiveLatest.fileName,
      status: terminal,
      stageName: effectiveLatest.stageName,
      stageType: effectiveLatest.stageType,
      latestStageName: effectiveLatest.stageName,
      latestStageType: effectiveLatest.stageType,
      latestReviewStatus: effectiveLatest.reviewStatus,
      latestFailureStatus: effectiveLatest.failureStatus,
      latestErrorMessage: effectiveLatest.errorMessage,
      retryable: effectiveLatest.retryable,
      createdAt: effectiveLatest.createdAt,
      ageMs: ageForAttempt(effectiveLatest, now).ageMs,
      serverAttemptIds: group.filter((attempt) => !isClientAttempt(attempt)).map((attempt) => attempt.attemptId),
      clientFailureIds: group.filter(isClientAttempt).map((attempt) => attempt.attemptId),
      latestServerAttemptId: latestServer?.attemptId ?? null,
      latestClientFailureId: latestClient?.attemptId ?? null,
      latestServerStatus: latestServer?.failureStatus ?? latestServer?.reviewStatus ?? null,
      latestClientFailureStatus: latestClient?.failureStatus ?? latestClient?.reviewStatus ?? null,
      apiInterrupted: group.some((attempt) => attempt.failureStatus === "interrupted_by_server_restart"),
      apiRuntimePreviousProcessStartedAt: latestPayload.apiRuntimePreviousProcessStartedAt ?? null,
      apiRuntimeCurrentProcessStartedAt: latestPayload.apiRuntimeCurrentProcessStartedAt ?? null,
      apiRuntimeRestartDetectedAt: latestPayload.apiRuntimeRestartDetectedAt ?? null,
    };
  }).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  return {
    currentBatch: {
      batchRunId,
      itemCount: items.length,
      items,
      serverAttempts: currentRecords
        .filter((attempt) => !isClientAttempt(attempt))
        .map((attempt) => ageForAttemptResponse(attempt, now)),
      clientFailures: currentRecords
        .filter(isClientAttempt)
        .map((attempt) => ageForAttemptResponse(attempt, now)),
    },
    historicalFailedAttempts: historicalRecords
      .filter((attempt) => !isCompletedAttempt(attempt))
      .map((attempt) => ageForAttemptResponse(attempt, now)),
  };
}

async function recordFailedReviewAttempt(context: ReviewAttemptContext, err: unknown): Promise<ReviewAttemptRecord> {
  const message = submissionErrorMessage(err);
  const classified = classifyAttemptFromError(context, err, message);
  const statusCode = typeof (err as any)?.statusCode === "number" ? (err as any).statusCode : null;
  const record: ReviewAttemptRecord = {
    attemptId: classified.attemptId,
    batchRunId: classified.batchRunId,
    queueItemId: classified.queueItemId,
    frontendSiteVersion: classified.frontendSiteVersion,
    userId: classified.userId,
    paperId: classified.paperId,
    fileName: classified.fileName,
    reviewRunId: classified.reviewRunId,
    stageName: classified.stageName,
    stageType: classified.stageType,
    model: classified.model,
    promptVersion: classified.promptVersion,
    promptHash: classified.promptHash,
    requestId: classified.requestId,
    errorMessage: message,
    rawErrorCode: rawErrorCode(err),
    retryCount: classified.retryCount || retryCountFromErrorMessage(message),
    extractionCompletenessStatus: classified.extractionCompletenessStatus,
    extractionWarnings: classified.extractionWarnings,
    extractionRetryAttempted: classified.extractionRetryAttempted,
    pdfFallbackAttempted: classified.pdfFallbackAttempted,
    pdfVisibleFallbackUsed: classified.pdfVisibleFallbackUsed,
    fallbackSucceeded: classified.fallbackSucceeded,
    reviewStatus: classified.reviewStatus ?? ((err as any)?.reviewStatus ?? null),
    failureStatus: null,
    scientificScoringAttempted: classified.scientificScoringAttempted,
    debugPayload: failedAttemptDebugPayload(classified, {
      errorName: err instanceof Error ? err.name : typeof err,
      failedAt: new Date().toISOString(),
    }),
    retryable: isRetryableAttemptError(message, statusCode),
    createdAt: new Date().toISOString(),
  };
  record.failureStatus = failureStatusForAttempt(record);
  const existingIndex = failedReviewAttempts.findIndex((attempt) => attempt.attemptId === record.attemptId);
  if (existingIndex >= 0) failedReviewAttempts.splice(existingIndex, 1);
  failedReviewAttempts.unshift(record);
  failedReviewAttempts.splice(MAX_FAILED_REVIEW_ATTEMPTS);
  try {
    await persistReviewAttemptRecord(record);
  } catch (insertErr) {
    logger.error({ err: insertErr, attempt: record }, "Failed to persist review attempt");
  }
  logger.error(record, "Review attempt failed");
  return record;
}

function parseJsonObject(value: string | null): Record<string, any> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseJsonArray(value: string | null): any[] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function extractJsonValue(text: string): any {
  try {
    return parseGeminiJsonResponse(text);
  } catch (err: any) {
    throw new Error(`Model response did not contain valid JSON: ${err?.message ?? String(err)}`);
  }
}

function sourceHashFor(source: any): string | null {
  if (!source?.type || typeof source.data !== "string") return null;
  const normalized = source.type === "url" ? source.data.trim() : source.data;
  if (!normalized) return null;
  return createHash("sha256")
    .update(source.type)
    .update("\0")
    .update(normalized)
    .digest("hex");
}

function duplicateKey(paper: typeof papersTable.$inferSelect) {
  const sourceHash = (paper as any).sourceHash;
  if (sourceHash) return `source:${paper.authorId}:${sourceHash}:${paper.modelName ?? ""}`;
  return [
    "meta",
    paper.authorId,
    paper.title,
    paper.paperAuthors ?? "",
    paper.modelName ?? "",
  ].join("\0").toLowerCase().replace(/\s+/g, " ").trim();
}

function promptScopedFeedDuplicateKey(paper: typeof papersTable.$inferSelect, promptVersion?: string | null) {
  const sourceHash = (paper as any).sourceHash;
  if (sourceHash) {
    return `source:${paper.authorId}:${sourceHash}:${paper.modelName ?? ""}:${promptVersion ?? "unknown-prompt"}`;
  }
  return [
    "meta",
    paper.authorId,
    paper.title,
    paper.paperAuthors ?? "",
    paper.modelName ?? "",
    promptVersion ?? "unknown-prompt",
  ].join("\0").toLowerCase().replace(/\s+/g, " ").trim();
}

function dedupePapers<T extends typeof papersTable.$inferSelect>(papers: T[]): T[] {
  const seen = new Set<string>();
  return papers.filter((paper) => {
    const key = duplicateKey(paper);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function reviewMetadataNormalizationText(review?: {
  centralClaim?: string | null;
  summary?: string | null;
  finalJudgment?: string | null;
  coverageLedgerJson?: string | null;
} | null) {
  if (!review) return "";
  const ledger = parseJsonObject(review.coverageLedgerJson ?? null);
  const organicCohortProfile = ledger?.organicCohortProfile && typeof ledger.organicCohortProfile === "object"
    ? ledger.organicCohortProfile as Record<string, unknown>
    : {};
  return [
    review.centralClaim,
    review.summary,
    review.finalJudgment,
    ledger?.centralClaim,
    ledger?.scientificReview,
    ledger?.comparisonCohort,
    ledger?.localCohort,
    ledger?.broadField,
    ledger?.specialtyField,
    organicCohortProfile.comparatorSearchSummary,
    Array.isArray(ledger?.subfields) ? ledger.subfields.join(" ") : "",
  ].filter(Boolean).join("\n").slice(0, 6000);
}

function splitAuthorNamesForMetadata(value: string) {
  return value
    .split(/\s*(?:;|\band\b|,(?=\s*[A-Z][A-Za-z.'-]+(?:\s|$)))\s*/i)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 30);
}

function requireAdmin(req: any, res: any): boolean {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return false; }
  if (!ADMIN_EMAIL || req.user.email !== ADMIN_EMAIL) { res.status(403).json({ error: "Forbidden" }); return false; }
  return true;
}

async function existingLogicalSubmission(
  authorId: string,
  title: string,
  paperAuthors: string,
  modelName: string,
) {
  const [paper] = await db.select().from(papersTable).where(
    and(
      eq(papersTable.authorId, authorId),
      eq(papersTable.title, title),
      eq(papersTable.paperAuthors, paperAuthors),
      eq(papersTable.modelName, modelName),
    ),
  ).orderBy(desc(papersTable.createdAt));
  if (!paper) return null;
  const [review] = await db.select().from(reviewsTable).where(eq(reviewsTable.paperId, paper.id));
  return { paper, review: review || null };
}

async function existingSourceSubmission(
  authorId: string,
  sourceHash: string,
  promptHash: string,
  promptVersion: string,
) {
  const userPapers = await db.select().from(papersTable).where(
    eq(papersTable.authorId, authorId),
  ).orderBy(desc(papersTable.createdAt));
  if (userPapers.length === 0) return null;

  const visiblePaperIds = new Set(dedupePapers(userPapers).map((paper) => paper.id));
  const reviews = await db.select().from(reviewsTable);
  const reviewByPaper = new Map(reviews.map((review) => [review.paperId, review]));

  const sourceAttempts = await db.select().from(reviewAttemptsTable).where(
    and(
      eq(reviewAttemptsTable.userId, authorId),
      sql`${reviewAttemptsTable.debugPayload}->>'sourceHash' = ${sourceHash}`,
      sql`${reviewAttemptsTable.paperId} is not null`,
    ),
  ).orderBy(desc(reviewAttemptsTable.createdAt)).limit(50);
  for (const attempt of sourceAttempts) {
    if (!attempt.paperId) continue;
    const paper = userPapers.find((candidate) => candidate.id === attempt.paperId);
    if (!paper) continue;
    const review = reviewByPaper.get(paper.id);
    if (!visiblePaperIds.has(paper.id)) {
      logger.warn({
        paperId: paper.id,
        title: paper.title,
        activePromptVersion: promptVersion,
        activePromptHash: promptHash,
      }, "Ignoring exact-source duplicate from review attempt hidden by public feed dedupe");
      continue;
    }
    const ledger = parseJsonObject(review?.coverageLedgerJson ?? null);
    const existingPromptHash = typeof ledger?.promptHash === "string" ? ledger.promptHash : null;
    const existingPromptVersion = typeof ledger?.promptVersion === "string" ? ledger.promptVersion : null;
    const matchingPrompt =
      existingPromptHash === promptHash &&
      existingPromptVersion === promptVersion;
    if (!matchingPrompt) {
      logger.info({
        paperId: paper.id,
        title: paper.title,
        existingPromptVersion,
        existingPromptHash,
        activePromptVersion: promptVersion,
        activePromptHash: promptHash,
      }, "Allowing exact-source submission because existing review used a different prompt");
      continue;
    }
    return {
      paper,
      review: review || null,
      promptMatches: true as const,
      existingPromptHash,
      existingPromptVersion,
    };
  }

  for (const paper of userPapers) {
    const review = reviewByPaper.get(paper.id);
    const ledger = parseJsonObject(review?.coverageLedgerJson ?? null);
    if (ledger?.submissionSourceHash !== sourceHash) continue;
    const existingPromptHash = typeof ledger?.promptHash === "string" ? ledger.promptHash : null;
    const existingPromptVersion = typeof ledger?.promptVersion === "string" ? ledger.promptVersion : null;
    const matchingPrompt =
      existingPromptHash === promptHash &&
      existingPromptVersion === promptVersion;
    if (!visiblePaperIds.has(paper.id)) {
      logger.warn({
        paperId: paper.id,
        title: paper.title,
        existingPromptVersion,
        existingPromptHash,
        activePromptVersion: promptVersion,
        activePromptHash: promptHash,
      }, "Ignoring exact-source duplicate hidden by public feed dedupe");
      continue;
    }
    if (matchingPrompt) {
      return {
        paper,
        review: review || null,
        promptMatches: true as const,
        existingPromptHash,
        existingPromptVersion,
      };
    }
    logger.info({
      paperId: paper.id,
      title: paper.title,
      existingPromptVersion,
      existingPromptHash,
      activePromptVersion: promptVersion,
      activePromptHash: promptHash,
    }, "Allowing exact-source submission because existing review used a different prompt");
  }
  return null;
}

type ExistingReviewSubmissionMatch = {
  paper: typeof papersTable.$inferSelect;
  review: typeof reviewsTable.$inferSelect | null;
  promptMatches: boolean;
  existingPromptHash: string | null;
  existingPromptVersion: string | null;
  duplicateReason: "doi" | "arxivId" | "titleAuthors";
};

function normalizeIdentityText(value?: string | null) {
  return (value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[\u2010-\u2015]/g, "-")
    .toLowerCase()
    .replace(/\b(?:unknown\s+title|unknown\s+authors?)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeIdentityTitle(value?: string | null) {
  return normalizeIdentityText(value)
    .replace(/\b(?:the|a|an)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeIdentityAuthor(value?: string | null) {
  return normalizeIdentityText(value)
    .replace(/\b(?:jr|sr|ii|iii|iv)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDoi(value?: string | null) {
  return (value || "")
    .trim()
    .replace(/^doi:\s*/i, "")
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/[)\].,;:\s]+$/g, "")
    .toLowerCase();
}

function normalizeArxivId(value?: string | null) {
  return (value || "")
    .trim()
    .replace(/^arxiv:\s*/i, "")
    .replace(/^https?:\/\/arxiv\.org\/(?:abs|pdf)\//i, "")
    .replace(/\.pdf$/i, "")
    .replace(/v\d+$/i, "")
    .toLowerCase();
}

function paperDateMetadataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringArrayFromMetadata(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean)
    : [];
}

function cleanIdentityAuthors(values: string[]) {
  const authors = values
    .map((author) => author.replace(/\s+/g, " ").trim())
    .filter((author) => author && !/^unknown authors?$/i.test(author));
  return Array.from(new Set(authors.map((author) => normalizeIdentityAuthor(author))))
    .filter((author) => author.length >= 2);
}

function cleanIdentityAuthorLastNames(values: string[]) {
  const lastNames = values
    .map((author) => {
      const normalized = normalizeIdentityAuthor(author);
      const parts = normalized.split(/\s+/).filter(Boolean);
      return parts.at(-1) || "";
    })
    .filter((lastName) => lastName.length >= 2 && !/^(?:unknown|author|authors)$/.test(lastName));
  return Array.from(new Set(lastNames));
}

function authorsIdentityCompatible(targetAuthors: string[], existingAuthors: string[]) {
  if (targetAuthors.length === 0 || existingAuthors.length === 0) return false;
  const existing = new Set(existingAuthors);
  const overlap = targetAuthors.filter((author) => existing.has(author)).length;
  const smaller = Math.min(targetAuthors.length, existingAuthors.length);
  if (smaller <= 1) return overlap >= 1;
  return overlap >= Math.min(2, smaller) && overlap / smaller >= 0.8;
}

function authorLastNamesIdentityCompatible(targetLastNames: string[], existingLastNames: string[]) {
  if (targetLastNames.length === 0 || existingLastNames.length === 0) return false;
  const existing = new Set(existingLastNames);
  const overlap = targetLastNames.filter((lastName) => existing.has(lastName)).length;
  const smaller = Math.min(targetLastNames.length, existingLastNames.length);
  if (smaller <= 1) return overlap >= 1;
  return overlap >= Math.min(2, smaller) && overlap / smaller >= 0.8;
}

function authorsOrLastNamesIdentityCompatible(
  targetAuthors: string[],
  existingAuthors: string[],
  targetLastNames: string[],
  existingLastNames: string[],
) {
  return authorsIdentityCompatible(targetAuthors, existingAuthors) ||
    authorLastNamesIdentityCompatible(targetLastNames, existingLastNames);
}

function promptIdentityForReview(review?: typeof reviewsTable.$inferSelect | null) {
  const ledger = parseJsonObject(review?.coverageLedgerJson ?? null);
  const existingPromptHash = typeof ledger?.promptHash === "string" ? ledger.promptHash : null;
  const existingPromptVersion = typeof ledger?.promptVersion === "string" ? ledger.promptVersion : null;
  return {
    existingPromptHash,
    existingPromptVersion,
    promptMatches:
      existingPromptHash === REVIEW_PROMPT_HASH &&
      existingPromptVersion === REVIEW_PROMPT_VERSION,
  };
}

function extractedMetadataIdentity(metadata: ExtractedPaperMetadata) {
  const dateMetadata = metadata.dateMetadata ?? ({} as ExtractedPaperMetadata["dateMetadata"]);
  const title = dateMetadata.displayedTitle || metadata.title || "";
  const authors = dateMetadata.displayedAuthors?.length
    ? dateMetadata.displayedAuthors
    : splitAuthorNamesForMetadata(metadata.authors || "");
  const titleConfidence = Number(dateMetadata.titleConfidence ?? 0);
  const authorsConfidence = Number(dateMetadata.authorsConfidence ?? 0);
  const titleKey = normalizeIdentityTitle(title);
  const authorKeys = cleanIdentityAuthors(authors);
  const authorLastNames = cleanIdentityAuthorLastNames(authors);
  const doi = normalizeDoi(dateMetadata.doi);
  const arxivId = normalizeArxivId(dateMetadata.arxivId);
  const hasUsableTitle = titleKey.length >= 12 && !/^unknown title$/i.test(title.trim());
  const hasUsableAuthors = (authorKeys.length > 0 || authorLastNames.length > 0) && !/^unknown authors?$/i.test((metadata.authors || "").trim());
  return {
    title,
    authors,
    titleKey,
    authorKeys,
    authorLastNames,
    doi,
    arxivId,
    titleConfidence,
    authorsConfidence,
    strong:
      hasUsableTitle &&
      (
        Boolean(doi || arxivId) ||
        (hasUsableAuthors && titleConfidence >= 0.85 && authorsConfidence >= 0.8)
      ),
  };
}

function paperMetadataIdentity(paper: typeof papersTable.$inferSelect) {
  const dateMetadata = paperDateMetadataObject(paper.dateMetadata);
  const displayedAuthors = stringArrayFromMetadata(dateMetadata.displayedAuthors);
  const title = typeof dateMetadata.displayedTitle === "string" && dateMetadata.displayedTitle.trim()
    ? dateMetadata.displayedTitle
    : paper.title;
  const authors = displayedAuthors.length > 0
    ? displayedAuthors
    : splitAuthorNamesForMetadata(paper.paperAuthors || "");
  return {
    title,
    authors,
    titleKey: normalizeIdentityTitle(title),
    authorKeys: cleanIdentityAuthors(authors),
    authorLastNames: cleanIdentityAuthorLastNames(authors),
    doi: normalizeDoi(typeof dateMetadata.doi === "string" ? dateMetadata.doi : ""),
    arxivId: normalizeArxivId(typeof dateMetadata.arxivId === "string" ? dateMetadata.arxivId : ""),
  };
}

function metadataIdentityDuplicateReason(
  target: ReturnType<typeof extractedMetadataIdentity>,
  existing: ReturnType<typeof paperMetadataIdentity>,
): ExistingReviewSubmissionMatch["duplicateReason"] | null {
  if (!target.strong) return null;
  if (target.doi && existing.doi && target.doi === existing.doi) return "doi";
  if (target.arxivId && existing.arxivId && target.arxivId === existing.arxivId) return "arxivId";
  if (
    target.titleKey &&
    existing.titleKey &&
    target.titleKey === existing.titleKey &&
    authorsOrLastNamesIdentityCompatible(
      target.authorKeys,
      existing.authorKeys,
      target.authorLastNames,
      existing.authorLastNames,
    )
  ) {
    return "titleAuthors";
  }
  return null;
}

async function existingMetadataIdentitySubmission(
  authorId: string,
  metadata: ExtractedPaperMetadata,
): Promise<ExistingReviewSubmissionMatch | null> {
  const target = extractedMetadataIdentity(metadata);
  if (!target.strong) return null;

  const userPapers = await db.select().from(papersTable).where(
    eq(papersTable.authorId, authorId),
  ).orderBy(desc(papersTable.createdAt));
  if (userPapers.length === 0) return null;

  const reviews = await db.select().from(reviewsTable);
  const reviewByPaper = new Map(reviews.map((review) => [review.paperId, review]));

  for (const paper of userPapers) {
    const review = reviewByPaper.get(paper.id);
    if (!review) continue;
    const existing = paperMetadataIdentity(normalizePaperDisplayMetadata(paper, reviewMetadataNormalizationText(review)));
    const duplicateReason = metadataIdentityDuplicateReason(target, existing);
    if (!duplicateReason) continue;
    const promptIdentity = promptIdentityForReview(review);
    if (!promptIdentity.promptMatches) {
      logger.info({
        paperId: paper.id,
        title: paper.title,
        existingPromptVersion: promptIdentity.existingPromptVersion,
        existingPromptHash: promptIdentity.existingPromptHash,
        activePromptVersion: REVIEW_PROMPT_VERSION,
        activePromptHash: REVIEW_PROMPT_HASH,
        duplicateReason,
      }, "Allowing metadata-matched submission because existing review used a different prompt");
      continue;
    }
    return {
      paper,
      review,
      promptMatches: true,
      existingPromptHash: promptIdentity.existingPromptHash,
      existingPromptVersion: promptIdentity.existingPromptVersion,
      duplicateReason,
    };
  }
  return null;
}

function addSubmissionCostControls(reviewValues: Record<string, any>, sourceHash: string | null, reviewMode: ReviewPipelineMode) {
  const ledger = parseJsonObject(reviewValues.coverageLedgerJson ?? null) ?? {};
  reviewValues.coverageLedgerJson = JSON.stringify({
    ...ledger,
    submissionSourceHash: sourceHash,
    retryPolicy: {
      modelCallAttempts: Number(process.env.SCIREVIEW_MODEL_CALL_ATTEMPTS || 2),
      passGenerationAttempts: Number(process.env.SCIREVIEW_PASS_GENERATION_ATTEMPTS || 1),
      replacementPassAttempts: Number(process.env.SCIREVIEW_REPLACEMENT_PASS_ATTEMPTS || 1),
      automaticWholePaperBrowserRetries: 0,
      saveFallbackWhenAtLeastOnePassSucceeds: reviewMode !== "benchmark-ingestion",
    },
  });
  return reviewValues;
}

function benchmarkSnapshotIsDeterministicallyReviewable(ledger: Record<string, any>) {
  const snapshot = ledger.reviewInputSnapshot && typeof ledger.reviewInputSnapshot === "object"
    ? ledger.reviewInputSnapshot as Record<string, any>
    : {};
  const status = String(
    snapshot.extractionCompletenessStatus ??
    ledger.extractionCompletenessStatus ??
    "",
  );
  if (!isExtractionReviewableStatus(status)) return false;
  if (snapshot.pdfVisibleFallbackUsed === true && typeof snapshot.pdfHash === "string" && snapshot.pdfHash) {
    return true;
  }

  const charCount = Number(snapshot.extractedTextCharCount ?? ledger.extractedTextCharCount ?? 0);
  if (!Number.isFinite(charCount) || charCount < 12_000) return false;

  const estimatedPages = Number(snapshot.estimatedPdfPageCount ?? ledger.estimatedPdfPageCount ?? 0);
  const extractedPages = Number(snapshot.extractedPageCount ?? ledger.extractedPageCount ?? 0);
  if (
    Number.isFinite(estimatedPages) &&
    Number.isFinite(extractedPages) &&
    estimatedPages > 0 &&
    extractedPages > 0 &&
    extractedPages < Math.max(2, Math.floor(estimatedPages * 0.8))
  ) {
    return false;
  }

  const text = [
    snapshot.rawExtractedText,
    snapshot.blindedReviewText,
    snapshot.rawExtractedTextFirst2000,
    snapshot.rawExtractedTextLast2000,
    snapshot.blindedReviewTextFirst2000,
    snapshot.blindedReviewTextLast2000,
  ].filter((value) => typeof value === "string").join("\n");
  const hasLateBody = /\b(references|bibliography|appendix|conclusion|section\s+(iii|iv|v|vi|vii|viii|ix|x)|\n\s*(III|IV|V|VI|VII|VIII|IX|X)\.?\s+[A-Z])/i.test(text);
  const hasScientificBody = /\b(definition|equation|theorem|derivation|horizon|field equation|thermodynamic|entropy|energy|mass|surface gravity|result)\b/i.test(text);
  return hasLateBody && hasScientificBody;
}

function benchmarkCompletionIssue(reviewValues: Record<string, any>) {
  const ledger = parseJsonObject(reviewValues.coverageLedgerJson ?? null);
  if (!ledger) return "Review ledger was not saved.";
  const passAudit = Array.isArray(ledger.passAudit) ? ledger.passAudit : [];
  const blindPassAudit = passAudit.filter((entry: any) => /^blind_pass_[12]$/.test(String(entry?.role ?? "")));
  const adjudicatorAudit = passAudit.find((entry: any) => entry?.role === "adjudicator");
  const textHashes = new Set(blindPassAudit.map((entry: any) => entry?.textHash).filter(Boolean));
  const pdfHashes = new Set(blindPassAudit.map((entry: any) => entry?.pdfHash ?? ""));
  const deterministicReviewable = benchmarkSnapshotIsDeterministicallyReviewable(ledger);
  const invalidQuality = [
    ledger.reviewInputQuality,
    ...(Array.isArray(ledger.blindPassReviews) ? ledger.blindPassReviews.map((pass: any) => pass?.reviewInputQuality) : []),
  ].some((quality: any) => quality?.shouldInvalidateReview === true) && !deterministicReviewable;

  if (isExtractionBlockingStatus(ledger.extractionCompletenessStatus) && !deterministicReviewable) {
    return `Extraction completeness status is ${ledger.extractionCompletenessStatus ?? "unknown"}.`;
  }
  if (
    ledger.reviewInputSnapshot?.extractionCompletenessStatus &&
    isExtractionBlockingStatus(ledger.reviewInputSnapshot.extractionCompletenessStatus) &&
    !deterministicReviewable
  ) {
    return `Review input snapshot extraction status is ${ledger.reviewInputSnapshot.extractionCompletenessStatus}.`;
  }
  if (Number(ledger.validPassCount ?? 0) !== 2 || blindPassAudit.length !== 2) {
    return `Expected 2 valid blind passes but found ${ledger.validPassCount ?? blindPassAudit.length}.`;
  }
  if (ledger.adjudicatorStatus !== "success") {
    return `Adjudicator status is ${ledger.adjudicatorStatus ?? "unknown"}.`;
  }
  if (!adjudicatorAudit) {
    return "Adjudicator audit entry is missing.";
  }
  if (textHashes.size !== 1 || pdfHashes.size > 1) {
    return "Blind-pass input hashes do not match.";
  }
  if (adjudicatorAudit?.textHash && textHashes.size === 1 && !textHashes.has(adjudicatorAudit.textHash)) {
    return "Adjudicator input hash does not match the blind-pass input hash.";
  }
  if (invalidQuality) {
    return "A blind pass or adjudicator flagged truncated review input.";
  }
  return null;
}

function attachPaperIdToReviewAudit(reviewValues: Record<string, any>, paperId: string) {
  const ledger = parseJsonObject(reviewValues.coverageLedgerJson ?? null) ?? {};
  const passAudit = Array.isArray(ledger.passAudit)
    ? ledger.passAudit.map((entry: any) => ({ ...entry, paperId }))
    : [];
  reviewValues.coverageLedgerJson = JSON.stringify({
    ...ledger,
    passAudit,
  });
  for (const entry of passAudit) {
    logger.info(entry, "Review pipeline audit entry stored");
  }
  return reviewValues;
}

function buildReviewInsertValues(
  paperId: string,
  reviewValues: Record<string, any>,
): typeof reviewsTable.$inferInsert {
  const audited = attachPaperIdToReviewAudit(reviewValues, paperId);
  return {
    paperId,
    summary: String(audited.summary ?? ""),
    correctness: String(audited.correctness ?? ""),
    novelty: String(audited.novelty ?? ""),
    overallEvaluation: String(audited.overallEvaluation ?? ""),
    score: typeof audited.score === "number" ? audited.score : 0,
    relatedWork: String(audited.relatedWork ?? ""),
    centralClaim: audited.centralClaim ?? null,
    establishedResults: audited.establishedResults ?? null,
    interpretiveClaims: audited.interpretiveClaims ?? null,
    speculativeClaims: audited.speculativeClaims ?? null,
    economy: audited.economy ?? null,
    scopeDepth: audited.scopeDepth ?? null,
    unifyingPower: audited.unifyingPower ?? null,
    strongestCaseForImportance: audited.strongestCaseForImportance ?? null,
    strongestObjection: audited.strongestObjection ?? null,
    decisiveCheck: audited.decisiveCheck ?? null,
    internalTechnicalTraction: audited.internalTechnicalTraction ?? null,
    noveltyConfidence: audited.noveltyConfidence ?? null,
    explanatoryTargetBreadth: audited.explanatoryTargetBreadth ?? null,
    theorySpaceBreadth: audited.theorySpaceBreadth ?? null,
    intrinsicScientificMeritScore: audited.intrinsicScientificMeritScore ?? null,
    explanatoryTargetBreadthScore: audited.explanatoryTargetBreadthScore ?? null,
    theorySpaceBreadthScore: audited.theorySpaceBreadthScore ?? null,
    breadthOfImpactScore: audited.breadthOfImpactScore ?? null,
    overallIntrinsicScore: audited.overallIntrinsicScore ?? null,
    bestClassification: audited.bestClassification ?? null,
    finalJudgment: audited.finalJudgment ?? null,
    coverageLedgerJson: audited.coverageLedgerJson ?? null,
    thinkingText: audited.thinkingText ?? null,
    modelName: String(audited.modelName ?? ""),
    systemPrompt: String(audited.systemPrompt ?? ""),
  };
}

function compactPassAuditEntry(entry: any) {
  return {
    reviewRunId: typeof entry?.reviewRunId === "string" ? entry.reviewRunId : null,
    paperId: typeof entry?.paperId === "string" ? entry.paperId : null,
    role: typeof entry?.role === "string" ? entry.role : null,
    promptVersion: typeof entry?.promptVersion === "string" ? entry.promptVersion : null,
    promptHash: typeof entry?.promptHash === "string" ? entry.promptHash : null,
    passNumber: typeof entry?.passNumber === "number" ? entry.passNumber : null,
    model: typeof entry?.model === "string" ? entry.model : null,
    requestId: typeof entry?.requestId === "string" ? entry.requestId : null,
    cacheUsed: entry?.cacheUsed === true,
    previousReviewUsed: entry?.previousReviewUsed === true,
    comparatorContextIncluded: entry?.comparatorContextIncluded === true,
    adjudicatorContextIncluded: entry?.adjudicatorContextIncluded === true,
    calibrationContextIncluded: entry?.calibrationContextIncluded === true,
    calibrationMode: typeof entry?.calibrationMode === "string" ? entry.calibrationMode : null,
    calibrationVersion: typeof entry?.calibrationVersion === "string" ? entry.calibrationVersion : null,
    targetOnly: entry?.targetOnly === true,
    existingPapersModified: entry?.existingPapersModified === true,
    modifiedPaperIds: Array.isArray(entry?.modifiedPaperIds) ? entry.modifiedPaperIds.filter((id: unknown) => typeof id === "string") : [],
    textHash: typeof entry?.textHash === "string" ? entry.textHash : null,
    pdfHash: typeof entry?.pdfHash === "string" ? entry.pdfHash : null,
    inputTokenCount: typeof entry?.inputTokenCount === "number" ? entry.inputTokenCount : null,
    outputTokenCount: typeof entry?.outputTokenCount === "number" ? entry.outputTokenCount : null,
    inputStrengthScore: typeof entry?.inputStrengthScore === "number" ? entry.inputStrengthScore : null,
    constructionStrengthScore: typeof entry?.constructionStrengthScore === "number" ? entry.constructionStrengthScore : null,
    outputStrengthScore: typeof entry?.outputStrengthScore === "number" ? entry.outputStrengthScore : null,
    rawDiagnosticScore: typeof entry?.rawDiagnosticScore === "number" ? entry.rawDiagnosticScore : null,
    computedScore: typeof entry?.computedScore === "number" ? entry.computedScore : null,
    score: typeof entry?.score === "number" ? entry.score : null,
    classification: typeof entry?.classification === "string" ? entry.classification : null,
  };
}

function compactReviewInputSnapshot(snapshot: any, paperId: string) {
  if (!snapshot || typeof snapshot !== "object") return null;
  return {
    rawExtractedTextHash: typeof snapshot.rawExtractedTextHash === "string" ? snapshot.rawExtractedTextHash : null,
    blindedReviewTextHash: typeof snapshot.blindedReviewTextHash === "string" ? snapshot.blindedReviewTextHash : null,
    extractedTextCharCount: typeof snapshot.extractedTextCharCount === "number" ? snapshot.extractedTextCharCount : null,
    extractedTextTokenCount: typeof snapshot.extractedTextTokenCount === "number" ? snapshot.extractedTextTokenCount : null,
    estimatedPdfPageCount: typeof snapshot.estimatedPdfPageCount === "number" ? snapshot.estimatedPdfPageCount : null,
    extractedPageCount: typeof snapshot.extractedPageCount === "number" ? snapshot.extractedPageCount : null,
    extractionCompletenessStatus: typeof snapshot.extractionCompletenessStatus === "string" ? snapshot.extractionCompletenessStatus : null,
    extractionWarnings: Array.isArray(snapshot.extractionWarnings) ? snapshot.extractionWarnings.filter((item: unknown) => typeof item === "string") : [],
    rawExtractedTextFirst2000: typeof snapshot.rawExtractedTextFirst2000 === "string" ? snapshot.rawExtractedTextFirst2000 : "",
    rawExtractedTextLast2000: typeof snapshot.rawExtractedTextLast2000 === "string" ? snapshot.rawExtractedTextLast2000 : "",
    blindedReviewTextFirst2000: typeof snapshot.blindedReviewTextFirst2000 === "string" ? snapshot.blindedReviewTextFirst2000 : "",
    blindedReviewTextLast2000: typeof snapshot.blindedReviewTextLast2000 === "string" ? snapshot.blindedReviewTextLast2000 : "",
    rawExtractedTextDownloadUrl: `/api/admin/papers/${paperId}/review-input/raw`,
    blindedReviewTextDownloadUrl: `/api/admin/papers/${paperId}/review-input/blinded`,
  };
}

function extractionErrorPayload(report: ExtractionCompletenessReport) {
  return {
    error: "Review not completed: extracted manuscript text is not complete enough for a reliable review. Retry extraction, PDF fallback, or manual repair.",
    transient: false,
    reviewStatus: "invalid_extraction_truncated",
    extractionCompletenessStatus: report.extractionCompletenessStatus,
    extractionWarnings: report.extractionWarnings,
  };
}

function cleanExtractedManuscriptText(text: string) {
  return (text || "").replace(/\x00/g, "").replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ");
}

function textEdgeSnippets(text: string) {
  return {
    first2000: text.slice(0, 2000),
    last2000: text.slice(Math.max(0, text.length - 2000)),
  };
}

function sectionMarkerInventory(text: string) {
  const markers = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "References"];
  return markers.map((marker) => {
    const pattern = marker === "References"
      ? /\b(references|bibliography)\b/i
      : new RegExp(`(?:^|\\n)\\s*(?:section\\s+)?${marker}\\.?\\s+[^\\n]{2,120}`, "i");
    const match = pattern.exec(text);
    return {
      marker,
      present: Boolean(match),
      index: match?.index ?? -1,
      sample: match?.[0]?.slice(0, 160) ?? "",
    };
  });
}

function updateAttemptInputDebugPayload(
  context: ReviewAttemptContext,
  text: string,
  report: ExtractionCompletenessReport | null,
  extra: Record<string, unknown> = {},
) {
  const snippets = textEdgeSnippets(text || "");
  const rawText = text || "";
  context.debugPayload = {
    ...context.debugPayload,
    ...extra,
    rawExtractedTextHash: createHash("sha256").update(rawText).digest("hex"),
    blindedReviewTextHash: createHash("sha256").update(rawText).digest("hex"),
    extractedTextCharCount: rawText.length,
    extractedTextTokenCount: Math.ceil(rawText.length / 4),
    extractedTextFirst2000: snippets.first2000,
    extractedTextLast2000: snippets.last2000,
    rawExtractedTextFirst2000: snippets.first2000,
    rawExtractedTextLast2000: snippets.last2000,
    blindedReviewTextFirst2000: snippets.first2000,
    blindedReviewTextLast2000: snippets.last2000,
    sectionMarkerInventory: sectionMarkerInventory(rawText),
    phraseIndexAListOf: rawText.toLowerCase().indexOf("a list of"),
    extractionCompletenessStatus: report?.extractionCompletenessStatus ?? context.extractionCompletenessStatus,
    extractionWarnings: report?.extractionWarnings ?? context.extractionWarnings,
    estimatedPdfPageCount: report?.estimatedPdfPageCount ?? null,
    extractedPageCount: report?.extractedPageCount ?? null,
  };
}

async function repairPdfExtractionIfNeeded(options: {
  report: ExtractionCompletenessReport;
  text: string;
  metadataHints: { fileName?: string; pdfTitle?: string; pdfAuthor?: string; pdfBase64?: string; mimeType?: string };
}) {
  if (isExtractionReviewableStatus(options.report.extractionCompletenessStatus)) {
    return { text: options.text, report: options.report, fallbackUsed: false };
  }
  if (!options.metadataHints.pdfBase64) {
    return { text: options.text, report: options.report, fallbackUsed: false };
  }

  logger.warn({
    extractionCompletenessStatus: options.report.extractionCompletenessStatus,
    extractionWarnings: options.report.extractionWarnings,
    fileName: options.metadataHints.fileName,
  }, "Retrying weak PDF text extraction with Gemini PDF extraction fallback");

  const fallback = await extractManuscriptTextFromPdfForReview({
    pdfBase64: options.metadataHints.pdfBase64,
    mimeType: options.metadataHints.mimeType,
    textHint: [
      options.metadataHints.fileName ? `Filename hint: ${options.metadataHints.fileName}` : "",
      options.metadataHints.pdfTitle ? `Embedded PDF title hint: ${options.metadataHints.pdfTitle}` : "",
      options.metadataHints.pdfAuthor ? `Embedded PDF author hint: ${options.metadataHints.pdfAuthor}` : "",
    ].filter(Boolean).join("\n"),
  });
  const repairedText = cleanExtractedManuscriptText(fallback.manuscriptText);
  const repairedReport = assessExtractionCompleteness(repairedText, {
    estimatedPdfPageCount: fallback.estimatedPageCount ?? options.report.estimatedPdfPageCount,
    extractedPageCount: fallback.estimatedPageCount ?? options.report.extractedPageCount,
  });
  return {
    text: repairedText,
    report: {
      ...repairedReport,
      extractionWarnings: [
        ...repairedReport.extractionWarnings,
        ...fallback.extractionNotes.map((note) => `Gemini PDF extraction note: ${note}`),
      ],
    },
    fallbackUsed: true,
  };
}

function shouldSkipAutomaticPdfTextFallback(report: ExtractionCompletenessReport | null, text: string) {
  if (!report) return false;
  const pageCount = report.estimatedPdfPageCount ?? report.extractedPageCount ?? null;
  const extractedChars = report.extractedTextCharCount ?? cleanExtractedManuscriptText(text || "").length;
  return report.extractionCompletenessStatus === "failed" &&
    Boolean(pageCount && pageCount >= 6) &&
    extractedChars < 100;
}

function skippedPdfTextFallbackWarning(report: ExtractionCompletenessReport | null) {
  const pages = report?.estimatedPdfPageCount ?? report?.extractedPageCount ?? null;
  return pages
    ? `Automatic PDF text fallback skipped because the PDF text layer yielded fewer than 100 readable characters from a ${pages}-page PDF; use manual OCR/text or PDF-visible last resort.`
    : "Automatic PDF text fallback skipped because the PDF text layer yielded fewer than 100 readable characters; use manual OCR/text or PDF-visible last resort.";
}

// Injection scan for the PDF-visible lane: white-text or hidden-layer
// instructions show up in the text layer even when the model reads the
// rendered PDF, so the text layer is extracted separately and scanned.
async function pdfTextLayerInjectionSuspected(buffer: Buffer): Promise<boolean> {
  try {
    const pdfParse = (await import("pdf-parse")).default;
    const parsed = await pdfParse(buffer);
    return detectReviewerDirectedText(parsed.text ?? "");
  } catch {
    return false;
  }
}

function pdfVisibleLastResortExtractionReport(text: string): ExtractionCompletenessReport {
  const cleanText = cleanExtractedManuscriptText(text);
  return {
    extractionCompletenessStatus: "reviewable_with_warnings",
    extractionWarnings: [
      "PDF-visible last-resort lane selected: local PDF text extraction was bypassed and Gemini will read the attached rendered/native PDF directly. Blinding strength is lower.",
    ],
    estimatedPdfPageCount: null,
    extractedPageCount: null,
    extractedTextCharCount: cleanText.length,
    extractedTextTokenCount: Math.ceil(cleanText.length / 4),
    rawExtractedTextHash: createHash("sha256").update(cleanText).digest("hex"),
  };
}

function truncationIndicatorMatches(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const indicators = [
    "truncated",
    "missing derivations",
    "provided text",
    "incomplete text",
    "manuscript ends abruptly",
    "only abstract",
    "only introduction",
    "full paper not available",
  ];
  return indicators.filter((indicator) => text.toLowerCase().includes(indicator));
}

function submissionErrorMessage(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  if (message && message !== "Error" && message !== "[object Object]") return message;
  const cause = err instanceof Error ? err.cause : null;
  if (cause instanceof Error && cause.message && cause.message !== "Error") return cause.message;
  return "Unknown server error while creating this review. The API logged the full error; retry after the current deploy, or check Railway logs if it repeats.";
}

function optionalSourceString(source: any, key: string): string | null {
  const value = source?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function attemptIdForSubmission(userId: string, source: any, fallbackFileName: string | null) {
  const explicit = optionalSourceString(source, "attemptId");
  if (explicit) return explicit;
  return createHash("sha256")
    .update([
      userId,
      optionalSourceString(source, "batchRunId") ?? "",
      optionalSourceString(source, "queueItemId") ?? "",
      optionalSourceString(source, "requestId") ?? "",
      fallbackFileName ?? "",
      Date.now().toString(),
      Math.random().toString(36),
    ].join("\0"))
    .digest("hex")
    .slice(0, 24);
}

function jobUserSnapshot(user: any) {
  return {
    id: user?.id,
    email: typeof user?.email === "string" ? user.email : null,
    firstName: typeof user?.firstName === "string" ? user.firstName : null,
    lastName: typeof user?.lastName === "string" ? user.lastName : null,
  };
}

function jobSourceSnapshot(source: any, attemptId: string, requestId: string) {
  return {
    ...source,
    attemptId,
    requestId,
    durableJob: true,
  };
}

function sourceSnapshotFromAttempt(record: ReviewAttemptRecord): Record<string, any> | null {
  const payload = debugPayloadObject(record.debugPayload);
  const snapshot = payload.sourceSnapshot;
  return snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
    ? snapshot as Record<string, any>
    : null;
}

function userSnapshotFromAttempt(record: ReviewAttemptRecord): Record<string, any> | null {
  const payload = debugPayloadObject(record.debugPayload);
  const snapshot = payload.userSnapshot;
  return snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
    ? snapshot as Record<string, any>
    : null;
}

async function reviewAttemptById(attemptId: string) {
  const [row] = await db.select().from(reviewAttemptsTable).where(eq(reviewAttemptsTable.id, attemptId));
  return row ? withRuntimeAttemptStatus(reviewAttemptRecordFromRow(row)) : null;
}

function shouldResumeReviewJob(record: ReviewAttemptRecord, now = Date.now()) {
  const payload = debugPayloadObject(record.debugPayload);
  if (!sourceSnapshotFromAttempt(record)) return false;
  if (isCompletedAttempt(record)) return false;
  if (isClientAttempt(record)) return false;
  if (payload.jobStatus === "auto_recovery_exceeded") return false;
  if (activeReviewJobIds.has(record.attemptId) || queuedReviewJobIds.includes(record.attemptId)) return false;
  if (jobLeaseExpired(record, now)) return true;
  if (record.reviewStatus === "queued" || record.reviewStatus === "upload_received") return true;
  if (isInterruptedReviewAttempt(record)) return true;
  if (interruptedByServerRestart(record)) return true;
  if (!record.errorMessage.trim() && record.retryable && !record.failureStatus) {
    const ageMs = ageForAttempt(record, now).ageMs;
    return ageMs != null && ageMs > REVIEW_JOB_STALE_MS;
  }
  return false;
}

async function markReviewJobQueued(record: ReviewAttemptRecord, reason: string) {
  const payload = debugPayloadObject(record.debugPayload);
  const queuedRecord: ReviewAttemptRecord = {
    ...record,
    stageName: "upload_received",
    stageType: "queue",
    errorMessage: "",
    rawErrorCode: null,
    reviewStatus: "queued",
    failureStatus: null,
    retryable: true,
    debugPayload: {
      ...payload,
      jobStatus: "queued",
      queuedAt: new Date().toISOString(),
      queueReason: reason,
      apiRuntimeAtQueued: reviewRuntimeInfo(),
    },
  };
  await persistReviewAttemptRecord(queuedRecord);
  return queuedRecord;
}

async function markReviewJobRunning(record: ReviewAttemptRecord, reason: string) {
  const payload = debugPayloadObject(record.debugPayload);
  const now = Date.now();
  const runningRecord: ReviewAttemptRecord = {
    ...record,
    stageName: "request_received",
    stageType: "request",
    errorMessage: "",
    rawErrorCode: null,
    reviewStatus: "running",
    failureStatus: null,
    retryable: true,
    debugPayload: {
      ...payload,
      jobStatus: "running",
      workerId: REVIEW_JOB_WORKER_ID,
      workerStartReason: reason,
      workerStartedAt: new Date(now).toISOString(),
      workerHeartbeatAt: new Date(now).toISOString(),
      leaseStartedAt: new Date(now).toISOString(),
      leaseExpiresAt: reviewJobLeaseExpiresAt(now),
      apiRuntimeAtWorkerStart: reviewRuntimeInfo(),
    },
  };
  await persistReviewAttemptRecord(runningRecord);
  return runningRecord;
}

async function touchReviewJobHeartbeat(attemptId: string) {
  const record = await reviewAttemptById(attemptId);
  if (!record || isCompletedAttempt(record)) return;
  const payload = debugPayloadObject(record.debugPayload);
  if (payload.workerId && payload.workerId !== REVIEW_JOB_WORKER_ID) return;
  const now = Date.now();
  await persistReviewAttemptRecord({
    ...record,
    debugPayload: {
      ...payload,
      jobStatus: "running",
      workerId: REVIEW_JOB_WORKER_ID,
      workerHeartbeatAt: new Date(now).toISOString(),
      leaseExpiresAt: reviewJobLeaseExpiresAt(now),
      apiRuntimeAtHeartbeat: reviewRuntimeInfo(),
    },
  });
}

async function markReviewJobAutoRecoveryExceeded(record: ReviewAttemptRecord, reason: string) {
  const payload = debugPayloadObject(record.debugPayload);
  const originalStageName =
    typeof payload.originalStageName === "string" && payload.originalStageName
      ? payload.originalStageName as ReviewAttemptStageName
      : record.stageName;
  const originalStageType =
    typeof payload.originalStageType === "string" && payload.originalStageType
      ? payload.originalStageType as ReviewAttemptStageType
      : record.stageType;
  const extractionBlocked =
    Boolean(record.extractionCompletenessStatus && isExtractionBlockingStatus(record.extractionCompletenessStatus)) ||
    originalStageName === "pdf_fallback_extraction" ||
    originalStageName === "extraction_quality_check" ||
    originalStageName === "pdf_text_extraction";
  const finalStageName = extractionBlocked
    ? (originalStageName === "pdf_fallback_extraction" ? "pdf_fallback_extraction" : "extraction_quality_check")
    : "interrupted_by_server_restart";
  const finalStageType = extractionBlocked
    ? (originalStageName === "pdf_fallback_extraction" ? "helper" : originalStageType === "helper" ? "helper" : "extraction")
    : "system";
  const errorMessage = extractionBlocked
    ? `Extraction/PDF fallback did not produce reviewable manuscript text before job recovery stopped (${reason}). Manual text repair, cleaner PDF, or PDF-visible last resort is available.`
    : `Review job exceeded ${REVIEW_JOB_MAX_AUTO_RETRIES} automatic restart recoveries (${reason}). Manual retry is available.`;
  const failedRecord: ReviewAttemptRecord = {
    ...record,
    stageName: finalStageName,
    stageType: finalStageType,
    errorMessage,
    reviewStatus: "needs_manual_retry",
    failureStatus: failureStatusForAttempt({
      ...record,
      stageName: finalStageName,
      stageType: finalStageType,
      errorMessage,
      reviewStatus: "needs_manual_retry",
      retryable: true,
    }),
    retryable: true,
    debugPayload: redactTerminalAttemptSourcePayload({
      ...payload,
      jobStatus: "auto_recovery_exceeded",
      autoRecoveryExceededAt: new Date().toISOString(),
      autoRecoveryExceededReason: reason,
      autoRecoveryCount: reviewJobAutoRetryCount(record),
      maxAutoRecoveries: REVIEW_JOB_MAX_AUTO_RETRIES,
      autoRecoveryExceededOriginalStageName: originalStageName,
      autoRecoveryExceededOriginalStageType: originalStageType,
      autoRecoveryExceededPreservedFailureStage: extractionBlocked,
      apiRuntimeAtAutoRecoveryExceeded: reviewRuntimeInfo(),
    }),
  };
  await persistReviewAttemptRecord(failedRecord);
  return failedRecord;
}

function enqueueReviewJob(attemptId: string) {
  if (!REVIEW_JOB_PROCESSING_ENABLED) return;
  if (!attemptId) return;
  if (activeReviewJobIds.has(attemptId) || queuedReviewJobIds.includes(attemptId)) return;
  queuedReviewJobIds.push(attemptId);
  scheduleReviewJobDrain();
}

function scheduleReviewJobDrain() {
  if (!REVIEW_JOB_PROCESSING_ENABLED) return;
  if (reviewJobDrainScheduled) return;
  reviewJobDrainScheduled = true;
  setTimeout(() => {
    reviewJobDrainScheduled = false;
    void drainReviewJobQueue();
  }, 0).unref?.();
}

async function drainReviewJobQueue() {
  if (!REVIEW_JOB_PROCESSING_ENABLED) return;
  while (activeReviewJobIds.size < REVIEW_JOB_CONCURRENCY && queuedReviewJobIds.length) {
    const attemptId = queuedReviewJobIds.shift();
    if (!attemptId || activeReviewJobIds.has(attemptId)) continue;
    activeReviewJobIds.add(attemptId);
    void runReviewJob(attemptId)
      .catch((err) => logger.error({ err, attemptId }, "Durable review job crashed outside pipeline"))
      .finally(() => {
        activeReviewJobIds.delete(attemptId);
        scheduleReviewJobDrain();
      });
  }
}

async function runReviewJob(attemptId: string) {
  const record = await reviewAttemptById(attemptId);
  if (!record) return;
  if (isCompletedAttempt(record)) return;

  const sourceSnapshot = sourceSnapshotFromAttempt(record);
  const userSnapshot = userSnapshotFromAttempt(record);
  if (!sourceSnapshot || !userSnapshot?.id) {
    const err = new Error("Durable review job is missing its stored source/user snapshot.");
    const context = reviewAttemptContextFromRecord(record, {
      stageName: "review_validation",
      stageType: "validation",
      reviewStatus: "failed_validation",
      debugPayload: {
        ...debugPayloadObject(record.debugPayload),
        jobStatus: "failed",
        missingSourceSnapshot: !sourceSnapshot,
        missingUserSnapshot: !userSnapshot?.id,
      },
    });
    await recordFailedReviewAttempt(context, err);
    return;
  }

  const expectedGitSha = sourceSnapshotBackendGitSha(sourceSnapshot, record);
  const workerGitSha = reviewRuntimeInfo()?.build?.railwayGitCommitSha ?? null;
  if (expectedGitSha && workerGitSha && expectedGitSha !== workerGitSha) {
    await markReviewJobWorkerBuildMismatch(record, sourceSnapshot, expectedGitSha, workerGitSha);
    return;
  }

  const runningRecord = await markReviewJobRunning(record, "worker_start");
  const source = {
    ...sourceSnapshot,
    attemptId,
    durableJob: true,
    jobDebugPayload: runningRecord.debugPayload,
    clientRequestStartedAt: debugString(debugPayloadObject(runningRecord.debugPayload), "clientRequestStartedAt") ?? sourceSnapshot.clientRequestStartedAt,
  };
  const heartbeat = setInterval(() => {
    void touchReviewJobHeartbeat(attemptId).catch((err) => {
      logger.warn({ err, attemptId }, "Failed to update durable review job heartbeat");
    });
  }, REVIEW_JOB_HEARTBEAT_MS);
  heartbeat.unref?.();
  try {
    await processPaperSubmission(userSnapshot, source);
  } catch (err) {
    logger.error({ err, attemptId }, "Durable review job failed");
  } finally {
    clearInterval(heartbeat);
  }
}

function reviewAttemptContextFromRecord(
  record: ReviewAttemptRecord,
  overrides: Partial<ReviewAttemptRecord> = {},
): ReviewAttemptContext {
  return {
    attemptId: record.attemptId,
    batchRunId: record.batchRunId,
    queueItemId: record.queueItemId,
    frontendSiteVersion: record.frontendSiteVersion,
    createdAt: record.createdAt,
    userId: record.userId,
    paperId: record.paperId,
    fileName: record.fileName,
    reviewRunId: record.reviewRunId,
    stageName: overrides.stageName ?? record.stageName,
    stageType: overrides.stageType ?? record.stageType,
    model: overrides.model ?? record.model,
    promptVersion: overrides.promptVersion ?? record.promptVersion,
    promptHash: overrides.promptHash ?? record.promptHash,
    requestId: overrides.requestId ?? record.requestId,
    retryCount: overrides.retryCount ?? record.retryCount,
    extractionCompletenessStatus: overrides.extractionCompletenessStatus ?? record.extractionCompletenessStatus,
    extractionWarnings: overrides.extractionWarnings ?? record.extractionWarnings,
    extractionRetryAttempted: overrides.extractionRetryAttempted ?? record.extractionRetryAttempted,
    pdfFallbackAttempted: overrides.pdfFallbackAttempted ?? record.pdfFallbackAttempted,
    pdfVisibleFallbackUsed: overrides.pdfVisibleFallbackUsed ?? record.pdfVisibleFallbackUsed,
    fallbackSucceeded: overrides.fallbackSucceeded ?? record.fallbackSucceeded,
    reviewStatus: overrides.reviewStatus ?? record.reviewStatus,
    scientificScoringAttempted: overrides.scientificScoringAttempted ?? record.scientificScoringAttempted,
    debugPayload: {
      ...debugPayloadObject(record.debugPayload),
      ...debugPayloadObject(overrides.debugPayload),
    },
  };
}

async function recoverReviewJobs() {
  if (!REVIEW_JOB_PROCESSING_ENABLED) return;
  try {
    const rows = await db.select()
      .from(reviewAttemptsTable)
      .orderBy(desc(reviewAttemptsTable.createdAt))
      .limit(REVIEW_JOB_RECOVERY_LIMIT);
    const now = Date.now();
    for (const row of rows) {
      const record = withRuntimeAttemptStatus(reviewAttemptRecordFromRow(row));
      if (!shouldResumeReviewJob(record, now)) continue;
      const reason = interruptedByServerRestart(record)
        ? "server_restart_recovery"
        : jobLeaseExpired(record, now)
          ? "lease_expired_recovery"
          : "stale_or_queued_recovery";
      if ((reason === "server_restart_recovery" || reason === "lease_expired_recovery") && !canAutoRecoverReviewJob(record)) {
        await markReviewJobAutoRecoveryExceeded(record, reason);
        continue;
      }
      const payload = debugPayloadObject(record.debugPayload);
      const autoRecoveryCount = reason === "server_restart_recovery" || reason === "lease_expired_recovery"
        ? reviewJobAutoRetryCount(record) + 1
        : reviewJobAutoRetryCount(record);
      const queued = await markReviewJobQueued({
        ...record,
        retryCount: reason === "server_restart_recovery" || reason === "lease_expired_recovery"
          ? record.retryCount + 1
          : record.retryCount,
        debugPayload: {
          ...payload,
          autoRecoveryCount,
          lastAutoRecoveryReason: reason,
          lastAutoRecoveryAt: new Date().toISOString(),
          recoveredByWorkerId: REVIEW_JOB_WORKER_ID,
        },
      }, reason);
      enqueueReviewJob(queued.attemptId);
    }
  } catch (err) {
    logger.error({ err }, "Failed to recover durable review jobs");
  }
}

function startReviewJobRecovery() {
  if (!REVIEW_JOB_PROCESSING_ENABLED) {
    logger.info({ reviewProcessRole: REVIEW_PROCESS_ROLE }, "Durable review job processing disabled in this process");
    return;
  }
  if (!REVIEW_JOB_AUTO_RECOVERY) {
    logger.info("Durable review job automatic retry disabled; queued/stale jobs still recover, interrupted running jobs move to manual retry");
  }
  if (reviewJobRecoveryStarted) return;
  reviewJobRecoveryStarted = true;
  setTimeout(() => { void recoverReviewJobs(); }, 1000).unref?.();
  setInterval(() => { void recoverReviewJobs(); }, REVIEW_JOB_RECOVERY_INTERVAL_MS).unref?.();
}

async function createDurableReviewJob(user: any, source: any) {
  if (!source?.type || !source?.data) {
    throw submissionHttpError("source.type and source.data are required", 400);
  }
  if (frontendPageStaleAfterApiRestart(source)) {
    throw submissionHttpError("Modern Science Review was redeployed after this page loaded. Please refresh before starting or continuing this batch.", 409, {
      code: "STALE_FRONTEND_AFTER_API_RESTART",
      reviewStatus: "stale_frontend_after_api_restart",
      retryable: true,
      apiRuntime: reviewRuntimeInfo(),
      frontendPageLoadedAt: optionalSourceString(source, "frontendPageLoadedAt"),
    });
  }
  const fileName = typeof source.fileName === "string" && source.fileName.trim()
    ? source.fileName.trim()
    : null;
  const batchRunId = optionalSourceString(source, "batchRunId");
  const queueItemId = optionalSourceString(source, "queueItemId");
  const frontendSiteVersion = optionalSourceString(source, "frontendSiteVersion");
  const requestId = optionalSourceString(source, "requestId") ?? createHash("sha256")
    .update(`${user.id}\0${batchRunId ?? ""}\0${queueItemId ?? ""}\0${Date.now()}\0${Math.random()}`)
    .digest("hex")
    .slice(0, 16);
  const attemptId = attemptIdForSubmission(user.id, source, fileName);
  const storedSource = jobSourceSnapshot(source, attemptId, requestId);
  const now = new Date().toISOString();
  const context: ReviewAttemptContext = {
    attemptId,
    batchRunId,
    queueItemId,
    frontendSiteVersion,
    createdAt: now,
    userId: user.id,
    paperId: null,
    fileName,
    reviewRunId: null,
    stageName: "upload_received",
    stageType: "queue",
    model: null,
    promptVersion: REVIEW_PROMPT_VERSION,
    promptHash: REVIEW_PROMPT_HASH,
    requestId,
    retryCount: 0,
    extractionCompletenessStatus: null,
    extractionWarnings: [],
    extractionRetryAttempted: false,
    pdfFallbackAttempted: false,
    pdfVisibleFallbackUsed: false,
    fallbackSucceeded: false,
    reviewStatus: "queued",
    scientificScoringAttempted: false,
    debugPayload: {
      sourceType: source.type,
      sourceHash: sourceHashFor(source),
      sourceSnapshot: storedSource,
      userSnapshot: jobUserSnapshot(user),
      jobStatus: "queued",
      autoRecoveryCount: 0,
      durableJob: true,
      queuedAt: now,
      clientRequestStartedAt: optionalSourceString(source, "clientRequestStartedAt"),
      frontendPageLoadedAt: optionalSourceString(source, "frontendPageLoadedAt"),
      apiRuntimeVersion: source.apiRuntimeVersion ?? null,
      apiRuntimeAtBatchStart: source.apiRuntimeAtBatchStart ?? null,
      apiRuntimeAtRegistration: reviewRuntimeInfo(),
    },
  };
  const record = reviewAttemptRecordFromContext(context, {
    reviewStatus: "queued",
    retryable: true,
  });
  await persistReviewAttemptRecord(record);
  enqueueReviewJob(record.attemptId);
  return record;
}

const COMPARATOR_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "into", "is", "it",
  "of", "on", "or", "over", "the", "to", "via", "with", "within", "without", "paper", "review",
  "study", "using", "through", "toward", "towards",
]);

function normalizeComparatorTitle(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function comparatorTokens(value: string) {
  return new Set(
    normalizeComparatorTitle(value)
      .split(" ")
      .filter((token) => token.length >= 4 && !COMPARATOR_STOP_WORDS.has(token))
      .slice(0, 2000),
  );
}

function tokenOverlapScore(sourceTokens: Set<string>, candidateText: string) {
  if (sourceTokens.size === 0) return 0;
  const candidateTokens = comparatorTokens(candidateText);
  if (candidateTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of sourceTokens) {
    if (candidateTokens.has(token)) overlap += 1;
  }
  return overlap / Math.sqrt(sourceTokens.size * candidateTokens.size);
}

function safeStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => {
        if (typeof item === "string") return item.trim();
        if (!item || typeof item !== "object") return "";
        const source = item as Record<string, unknown>;
        return String(source.input ?? source.construction ?? source.output ?? source.name ?? "").trim();
      }).filter(Boolean)
    : [];
}

function compactLedger(value: any) {
  if (!value || typeof value !== "object") return null;
  const canonicalInput = value.input && typeof value.input === "object" ? value.input : null;
  const canonicalConstruction = value.construction && typeof value.construction === "object" ? value.construction : null;
  const canonicalOutput = value.output && typeof value.output === "object" ? value.output : null;
  const outputsSource = canonicalOutput?.outputs ?? value.outputs;
  const outputs = Array.isArray(outputsSource)
    ? outputsSource
        .map((item: any) => {
          if (typeof item === "string") return { output: item.slice(0, 700) };
          if (!item || typeof item !== "object") return null;
          return {
            output: typeof item.output === "string" ? item.output.slice(0, 700) : "",
            inputsUsed: safeStringArray(item.inputsUsed ?? item.dependsOnInputs).slice(0, 5),
            constructionsUsed: safeStringArray(item.constructionsUsed ?? item.dependsOnConstructions).slice(0, 5),
            dependsOnInputs: safeStringArray(item.inputsUsed ?? item.dependsOnInputs).slice(0, 5),
            dependsOnConstructions: safeStringArray(item.constructionsUsed ?? item.dependsOnConstructions).slice(0, 5),
            externalContextIfAny: typeof item.externalContextIfAny === "string" ? item.externalContextIfAny.slice(0, 500) : "",
            support: typeof item.support === "string" ? item.support.slice(0, 500) : "",
            validity: typeof item.validity === "string" ? item.validity.slice(0, 500) : "",
            centrality: typeof item.centrality === "string" ? item.centrality : "",
          };
        })
        .filter((item: any) => item?.output)
        .slice(0, 6)
    : [];
  return {
    primitiveInputs: safeStringArray(canonicalInput?.primitiveInputs ?? value.primitiveInputs).slice(0, 5),
    introducedConstructions: safeStringArray(canonicalConstruction?.introducedConstructions ?? value.introducedConstructions).slice(0, 5),
    outputs,
    whyOutputsMatter: typeof canonicalOutput?.whyOutputsMatter === "string" ? canonicalOutput.whyOutputsMatter.slice(0, 700) : typeof value.whyOutputsMatter === "string" ? value.whyOutputsMatter.slice(0, 700) : "",
    assessment: typeof value.assessment === "string" ? value.assessment.slice(0, 700) : [canonicalInput?.assessment, canonicalConstruction?.assessment, canonicalOutput?.assessment].filter(Boolean).join("\n\n").slice(0, 700),
  };
}

function compactCentralOutputDependency(value: any) {
  if (!value || typeof value !== "object") return null;
  return {
    centralOutput: typeof value.centralOutput === "string" ? value.centralOutput.slice(0, 700) : "",
    dependsOnPrimitiveInputs: safeStringArray(value.dependsOnPrimitiveInputs).slice(0, 6),
    dependsOnIntroducedConstructions: safeStringArray(value.dependsOnIntroducedConstructions).slice(0, 6),
    weakestDependency: typeof value.weakestDependency === "string" ? value.weakestDependency.slice(0, 500) : "",
    assessment: typeof value.assessment === "string" ? value.assessment.slice(0, 700) : "",
  };
}

function compactOutputValidityAssessment(value: any) {
  if (!value || typeof value !== "object") return null;
  return {
    knownResultRecoveries: safeStringArray(value.knownResultRecoveries).slice(0, 6),
    novelPredictionsOrConstraints: safeStringArray(value.novelPredictionsOrConstraints).slice(0, 6),
    failedOutputsOrConstraints: safeStringArray(value.failedOutputsOrConstraints).slice(0, 6),
    assessment: typeof value.assessment === "string" ? value.assessment.slice(0, 700) : "",
  };
}

function comparatorMetadata(review: typeof reviewsTable.$inferSelect | null) {
  const parsed = review ? parseJsonObject(review.coverageLedgerJson) : null;
  const aggregateFromField = review ? parseJsonObject((review as any).aggregateMetaJson ?? null) : null;
  const aggregate = parsed?.aggregate && typeof parsed.aggregate === "object" ? parsed.aggregate : null;
  const comparatorCalibration = parsed?.comparatorCalibration ?? aggregate?.comparatorCalibration ?? null;
  const diagnosticComparatorCalibration =
    parsed?.diagnosticComparatorCalibration ??
    aggregate?.diagnosticComparatorCalibration ??
    null;
  const contributionArchetype = parsed?.contributionArchetype ?? aggregate?.contributionArchetype ?? null;
  const comparatorProfile =
    parsed?.organicCohortProfile ??
    parsed?.comparatorProfile ??
    aggregate?.comparatorProfile ??
    aggregateFromField?.organicCohortProfile ??
    aggregateFromField?.comparatorProfile ??
    null;
  const inputConstructionOutputLedger =
    compactLedger(
      parsed?.inputConstructionOutputAssessment ??
        parsed?.inputConstructionOutputLedger ??
        aggregate?.inputConstructionOutputAssessment ??
        aggregate?.inputConstructionOutputLedger ??
        aggregateFromField?.inputConstructionOutputAssessment ??
        aggregateFromField?.inputConstructionOutputLedger,
    );
  const centralOutputDependency =
    compactCentralOutputDependency(parsed?.centralOutputDependency ?? aggregate?.centralOutputDependency ?? comparatorProfile?.centralOutputDependency);
  const outputValidityAssessment =
    compactOutputValidityAssessment(parsed?.outputValidityAssessment ?? aggregate?.outputValidityAssessment ?? comparatorProfile?.outputValidityAssessment);

  return {
    contributionArchetype,
    inputConstructionOutputLedger,
    centralOutputDependency,
    outputValidityAssessment,
    centralClaim: review?.centralClaim || parsed?.centralClaim || aggregate?.finalCentralClaim || null,
    summary: parsed?.scientificReview || review?.summary || aggregate?.finalSummary || null,
    classification: review?.bestClassification || aggregate?.finalClassification || null,
    localCohort: parsed?.localCohort || parsed?.finalLocalCohort || aggregate?.finalLocalCohort || aggregateFromField?.localCohort || aggregateFromField?.finalLocalCohort || comparatorProfile?.localCohort || null,
    comparisonCohort: parsed?.comparisonCohort || parsed?.finalComparisonCohort || aggregate?.finalComparisonCohort || null,
    score: parsed?.calibratedScore ?? parsed?.intrinsicScore ?? parsed?.finalScore ?? diagnosticComparatorCalibration?.calibratedScore ?? comparatorCalibration?.finalPublicScoreBand?.median ?? review?.overallIntrinsicScore ?? review?.score ?? null,
    inputStrengthScore: parsed?.inputStrengthScore ?? aggregate?.inputStrengthScore ?? null,
    constructionStrengthScore: parsed?.constructionStrengthScore ?? aggregate?.constructionStrengthScore ?? null,
    outputStrengthScore: parsed?.outputStrengthScore ?? aggregate?.outputStrengthScore ?? null,
    rawDiagnosticScore: parsed?.rawDiagnosticScore ?? parsed?.rawFinalDiagnosticScore ?? null,
    computedScore: parsed?.computedScore ?? parsed?.intrinsicScore ?? parsed?.finalScore ?? null,
    calibratedInputStrengthScore: parsed?.calibratedInputStrengthScore ?? diagnosticComparatorCalibration?.calibratedInputStrengthScore ?? null,
    calibratedConstructionStrengthScore: parsed?.calibratedConstructionStrengthScore ?? diagnosticComparatorCalibration?.calibratedConstructionStrengthScore ?? null,
    calibratedOutputStrengthScore: parsed?.calibratedOutputStrengthScore ?? diagnosticComparatorCalibration?.calibratedOutputStrengthScore ?? null,
    rawCalibratedScore: parsed?.rawCalibratedScore ?? diagnosticComparatorCalibration?.rawCalibratedScore ?? null,
    calibratedScore: parsed?.calibratedScore ?? diagnosticComparatorCalibration?.calibratedScore ?? null,
    scopeProfile: parsed?.scopeProfile ?? aggregate?.scopeProfile ?? null,
    organicCohortProfile: parsed?.organicCohortProfile ?? comparatorProfile ?? null,
    failureMode: parsed?.failureAnalysis?.failureMode ?? aggregate?.failureAnalysis?.failureMode ?? null,
    frameworkConditionality: parsed?.technicalAssessment?.frameworkDependence?.level || parsed?.frameworkConditionalityLevel || comparatorProfile?.frameworkConditionality || null,
    frameworkDependence: parsed?.technicalAssessment?.frameworkDependence ?? null,
    comparatorSearchSummary: comparatorProfile?.comparatorSearchSummary || null,
    canonicalClusterLabel: parsed?.canonicalClusterLabel || parsed?.benchmarkCluster?.canonicalClusterLabel || aggregate?.canonicalClusterLabel || aggregateFromField?.canonicalClusterLabel || null,
    clusterVersion: parsed?.clusterVersion || aggregate?.clusterVersion || aggregateFromField?.clusterVersion || null,
    clusterFeatureTags: safeStringArray(comparatorProfile?.clusterFeatureTags),
    benchmarkSetCandidate: Boolean(parsed?.benchmarkSetCandidate),
    blindingStrength: typeof parsed?.blindingStrength === "string" ? parsed.blindingStrength : "strong",
    recognitionSuspected: parsed?.recognitionSuspected === true,
    benchmarkSetVersion: parsed?.benchmarkSetVersion || comparatorCalibration?.benchmarkSetVersion || null,
    comparatorCalibrationStatus: parsed?.comparatorCalibrationStatus || diagnosticComparatorCalibration?.comparatorCalibrationStatus || comparatorCalibration?.comparatorCalibrationStatus || null,
    calibratedScoreBand: comparatorCalibration?.finalPublicScoreBand ?? aggregate?.finalScoreBand ?? aggregateFromField?.finalScoreBand ?? null,
    explanatoryDeltaAssessment: parsed?.explanatoryDeltaAssessment || comparatorCalibration?.explanatoryDeltaAssessment || null,
  };
}

async function selectComparatorContextForProfile(
  profile: Parameters<ComparatorContextSelector>[0],
  excludePaperId?: string,
) {
  const sourceText = [
    profile.localCohort,
    profile.primaryCohort,
    profile.adjacentBroadCohort,
    profile.contributionArchetype?.primary,
    profile.contributionArchetype?.secondary,
    ...(Array.isArray(profile.primitiveInputs) ? profile.primitiveInputs : []),
    ...(Array.isArray(profile.introducedConstructions) ? profile.introducedConstructions : []),
    ...(Array.isArray(profile.outputs) ? profile.outputs : []),
    ...(Array.isArray(profile.clusterFeatureTags) ? profile.clusterFeatureTags : []),
    profile.comparatorSearchSummary,
  ].filter(Boolean).join("\n");
  const sourceTokens = comparatorTokens(sourceText);
  if (sourceTokens.size === 0) return [];

  const existingPapers = dedupePapers(await db.select().from(papersTable).orderBy(desc(papersTable.createdAt)));
  if (existingPapers.length <= 4) return [];
  const reviews = await db.select().from(reviewsTable);
  const reviewMap = new Map(reviews.map((review) => [review.paperId, review]));

  const candidates = existingPapers
    .map((paper) => {
      if (paper.id === excludePaperId) return null;
      const review = reviewMap.get(paper.id) ?? null;
      if (!review) return null;
      const paperTitle = paper.title || "";
      const candidateTitle = normalizeComparatorTitle(paperTitle);
      if (!candidateTitle) return null;

      const metadata = comparatorMetadata(review);
      const subfields = safeStringArray(paper.subfields);
      const candidateText = [
        paperTitle,
        paper.field,
        subfields.join(" "),
        metadata.comparisonCohort,
        metadata.classification,
        metadata.centralClaim,
        metadata.summary,
        metadata.localCohort,
        metadata.canonicalClusterLabel,
        metadata.clusterFeatureTags.join(" "),
        metadata.scopeProfile ? JSON.stringify(metadata.scopeProfile) : "",
        metadata.frameworkDependence ? JSON.stringify(metadata.frameworkDependence) : "",
        metadata.failureMode,
        [metadata.inputStrengthScore, metadata.constructionStrengthScore, metadata.outputStrengthScore].join(" "),
        metadata.inputConstructionOutputLedger?.primitiveInputs.join(" "),
        metadata.inputConstructionOutputLedger?.introducedConstructions.join(" "),
        metadata.inputConstructionOutputLedger?.outputs.map((item: any) => item.output).join(" "),
      ].filter(Boolean).join("\n");

      const overlap = tokenOverlapScore(sourceTokens, candidateText);
      const sparseDatabase = existingPapers.length <= 15;
      if (overlap <= (sparseDatabase ? 0.08 : 0.02)) return null;

      return {
        rankScore: overlap,
        // Weakly blinded or recognition-suspected reviews stay valid
        // calibration targets but never serve as anchors.
        isBenchmarkCandidate: metadata.benchmarkSetCandidate && benchmarkAnchorEligible(metadata),
        item: {
          comparatorId: "",
          sitePaperId: paper.id,
          title: paperTitle,
          field: paper.field || null,
          subfields,
          score: typeof metadata.score === "number" ? metadata.score : null,
          classification: metadata.classification,
          localCohort: metadata.localCohort,
          comparisonCohort: metadata.comparisonCohort,
          canonicalClusterLabel: metadata.canonicalClusterLabel,
          clusterVersion: metadata.clusterVersion,
          clusterFeatureTags: metadata.clusterFeatureTags,
          contributionArchetype: metadata.contributionArchetype ?? undefined,
          centralClaim: metadata.centralClaim ? String(metadata.centralClaim).slice(0, 900) : null,
          summary: metadata.summary ? String(metadata.summary).slice(0, 900) : null,
          inputConstructionOutputLedger: metadata.inputConstructionOutputLedger as any,
          inputConstructionOutputAssessment: metadata.inputConstructionOutputLedger as any,
          scopeProfile: metadata.scopeProfile,
          organicCohortProfile: metadata.organicCohortProfile,
          inputStrengthScore: metadata.inputStrengthScore,
          constructionStrengthScore: metadata.constructionStrengthScore,
          outputStrengthScore: metadata.outputStrengthScore,
          rawDiagnosticScore: metadata.rawDiagnosticScore,
          computedScore: metadata.computedScore,
          calibratedInputStrengthScore: metadata.calibratedInputStrengthScore,
          calibratedConstructionStrengthScore: metadata.calibratedConstructionStrengthScore,
          calibratedOutputStrengthScore: metadata.calibratedOutputStrengthScore,
          rawCalibratedScore: metadata.rawCalibratedScore,
          calibratedScore: metadata.calibratedScore,
          failureMode: metadata.failureMode,
          frameworkConditionality: metadata.frameworkConditionality,
          frameworkDependence: metadata.frameworkDependence,
          comparatorSearchSummary: metadata.comparatorSearchSummary,
          benchmarkSetVersion: metadata.benchmarkSetVersion,
          comparatorCalibrationStatus: metadata.comparatorCalibrationStatus,
          calibratedScoreBand: metadata.calibratedScoreBand,
          explanatoryDeltaAssessment: metadata.explanatoryDeltaAssessment,
        } satisfies ReviewComparatorContextItem,
      };
    })
    .filter(Boolean) as { rankScore: number; isBenchmarkCandidate: boolean; item: ReviewComparatorContextItem }[];

  const benchmarkCandidates = candidates.filter(
    (candidate) => candidate.isBenchmarkCandidate && candidate.item.benchmarkSetVersion === BENCHMARK_SET_VERSION,
  );
  const candidatePool = benchmarkCandidates.length > 0 ? benchmarkCandidates : [];

  return candidatePool
    .sort((a, b) => b.rankScore - a.rankScore)
    .slice(0, 8)
    .map((candidate, index) => ({
      ...candidate.item,
      comparatorId: `C${index + 1}`,
    }));
}

const selectComparatorContext: ComparatorContextSelector = async (profile) => selectComparatorContextForProfile(profile);

function benchmarkProfileForClustering(
  paper: typeof papersTable.$inferSelect,
  review: typeof reviewsTable.$inferSelect,
  coverageLedger: Record<string, any>,
) {
  const aggregate = coverageLedger.aggregate && typeof coverageLedger.aggregate === "object"
    ? coverageLedger.aggregate
    : null;
  const comparatorProfile = coverageLedger.organicCohortProfile ?? coverageLedger.comparatorProfile ?? aggregate?.comparatorProfile ?? null;
  const ico = compactLedger(
    coverageLedger.inputConstructionOutputAssessment ??
      coverageLedger.inputConstructionOutputLedger ??
      aggregate?.inputConstructionOutputAssessment ??
      aggregate?.inputConstructionOutputLedger,
  );
  return {
    paperId: paper.id,
    title: paper.title,
    localCohort: coverageLedger.localCohort ?? coverageLedger.finalLocalCohort ?? aggregate?.finalLocalCohort ?? comparatorProfile?.localCohort ?? "",
    broadField: paper.field ?? coverageLedger.broadField ?? "",
    subfields: safeStringArray(paper.subfields),
    contributionArchetype: coverageLedger.contributionArchetype ?? aggregate?.contributionArchetype ?? comparatorProfile?.contributionArchetype ?? null,
    inputConstructionOutputLedger: ico,
    frameworkConditionality: coverageLedger.technicalAssessment?.frameworkDependence?.level ?? comparatorProfile?.frameworkConditionality ?? coverageLedger.frameworkConditionalityLevel ?? null,
    score: review.overallIntrinsicScore ?? review.score ?? null,
    classification: review.bestClassification ?? aggregate?.finalClassification ?? null,
    strongestObjection: review.strongestObjection ?? aggregate?.strongestObjection ?? "",
    comparatorSearchSummary: comparatorProfile?.comparatorSearchSummary ?? "",
    clusterFeatureTags: safeStringArray(comparatorProfile?.clusterFeatureTags),
  };
}

// GET /api/papers/system-prompt — return the review system prompt
router.get("/papers/system-prompt", (_req, res) => {
  res.json({
    prompt: LATEST_REVIEW_SYSTEM_INSTRUCTION,
    fullPromptSystem: REVIEW_FULL_PROMPT_SYSTEM,
    promptVersion: REVIEW_PROMPT_VERSION,
    promptName: REVIEW_PROMPT_NAME,
    promptHash: REVIEW_PROMPT_HASH,
    defaultReviewMode: "benchmark-ingestion",
    benchmarkSetVersion: BENCHMARK_SET_VERSION,
  });
});

// GET /api/admin/review-attempts — admin repair lane for failed/retryable submissions
router.get("/admin/review-attempts", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 100);
    const rows = await db.select().from(reviewAttemptsTable).orderBy(desc(reviewAttemptsTable.createdAt)).limit(limit);
    res.json({
      attempts: rows.map(reviewAttemptRecordFromRow).map(withRuntimeAttemptStatus).map(attemptForResponse),
      repairOptions: [
        "retry_normal_extraction",
        "retry_pdf_fallback",
        "upload_cleaner_pdf",
        "submit_manual_extracted_text",
        "pdf_visible_last_resort",
      ],
    });
  } catch (err: any) {
    logger.error({ err }, "Error listing review attempts");
    res.status(500).json({ error: err.message });
  }
});

// POST /api/review-batches/register — durably register visible queue rows before long review requests start
router.post("/review-batches/register", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const body = debugPayloadObject(req.body);
    const batchRunId = debugString(body, "batchRunId");
    if (!batchRunId) {
      res.status(400).json({ error: "batchRunId is required" });
      return;
    }
    const frontendSiteVersion = debugString(body, "frontendSiteVersion");
    const frontendPageLoadedAt = debugString(body, "frontendPageLoadedAt");
    const apiRuntimeVersion = body.apiRuntimeVersion ?? null;
    const rawItems = Array.isArray(body.items) ? body.items : [];
    if (rawItems.length === 0) {
      res.status(400).json({ error: "items are required" });
      return;
    }

    const registered: ReviewAttemptRecord[] = [];
    for (const rawItem of rawItems) {
      const item = debugPayloadObject(rawItem);
      const queueItemId = debugString(item, "queueItemId");
      const fileName = debugString(item, "fileName");
      const attemptId = debugString(item, "attemptId") ?? createHash("sha256")
        .update([
          req.user.id,
          batchRunId,
          queueItemId ?? "",
          fileName ?? "",
          "upload_received",
        ].join("\0"))
        .digest("hex")
        .slice(0, 24);
      const context: ReviewAttemptContext = {
        attemptId,
        batchRunId,
        queueItemId,
        frontendSiteVersion,
        createdAt: new Date().toISOString(),
        userId: req.user.id,
        paperId: null,
        fileName,
        reviewRunId: null,
        stageName: "upload_received",
        stageType: "queue",
        model: null,
        promptVersion: REVIEW_PROMPT_VERSION,
        promptHash: REVIEW_PROMPT_HASH,
        requestId: debugString(item, "requestId"),
        retryCount: 0,
        extractionCompletenessStatus: null,
        extractionWarnings: [],
        extractionRetryAttempted: false,
        pdfFallbackAttempted: false,
        pdfVisibleFallbackUsed: false,
        fallbackSucceeded: false,
        reviewStatus: "upload_received",
        scientificScoringAttempted: false,
        debugPayload: {
          fileSize: typeof item.fileSize === "number" ? item.fileSize : null,
          reviewMode: debugString(item, "reviewMode"),
          registeredAt: new Date().toISOString(),
          frontendPageLoadedAt,
          apiRuntimeVersion,
          apiRuntimeAtRegistration: reviewRuntimeInfo(),
        },
      };
      const record = reviewAttemptRecordFromContext(context, {
        reviewStatus: "upload_received",
        failureStatus: null,
        retryable: true,
      });
      await persistReviewAttemptRecord(record);
      registered.push(record);
    }

    res.status(201).json({
      batchRunId,
      itemCount: registered.length,
      attempts: registered.map(attemptForResponse),
      apiRuntime: reviewRuntimeInfo(),
    });
  } catch (err: any) {
    logger.error({ err }, "Error registering review batch");
    res.status(500).json({ error: err.message });
  }
});

// POST /api/review-attempts/client-failure — frontend-only queue failure audit
router.post("/review-attempts/client-failure", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const body = debugPayloadObject(req.body);
    const fileName = debugString(body, "fileName");
    const batchRunId = debugString(body, "batchRunId");
    const queueItemId = debugString(body, "queueItemId");
    const frontendSiteVersion = debugString(body, "frontendSiteVersion");
    const attemptId = debugString(body, "attemptId") ?? createHash("sha256")
      .update([
        req.user.id,
        batchRunId ?? "",
        queueItemId ?? "",
        fileName ?? "",
        debugString(body, "clientRequestStartedAt") ?? "",
        Date.now().toString(),
      ].join("\0"))
      .digest("hex")
      .slice(0, 24);
    const message = debugString(body, "errorMessage")
      ?? debugString(body, "message")
      ?? "Frontend request failed before a completed API response was received.";
    const failureKind = debugString(body, "failureKind") ?? "frontend_failure";
    const interruptedByRestart = failureKind === "interrupted_by_server_restart" ||
      debugString(body, "apiRuntimePreviousProcessStartedAt") != null ||
      debugString(body, "apiRuntimeCurrentProcessStartedAt") != null;
    const fileReadFailed = failureKind === "file_read_failed";
    const stageName = interruptedByRestart
      ? "interrupted_by_server_restart"
      : fileReadFailed
        ? "file_read_failed"
        : "client_failure";
    const reviewStatus = interruptedByRestart
      ? "interrupted_by_server_restart"
      : fileReadFailed
        ? "file_read_failed"
        : "client_failure";
    const context: ReviewAttemptContext = {
      attemptId,
      batchRunId,
      queueItemId,
      frontendSiteVersion,
      createdAt: new Date().toISOString(),
      userId: req.user.id,
      paperId: null,
      fileName,
      reviewRunId: null,
      stageName,
      stageType: interruptedByRestart ? "system" : "client",
      model: null,
      promptVersion: REVIEW_PROMPT_VERSION,
      promptHash: REVIEW_PROMPT_HASH,
      requestId: debugString(body, "requestId"),
      retryCount: 0,
      extractionCompletenessStatus: null,
      extractionWarnings: [],
      extractionRetryAttempted: false,
      pdfFallbackAttempted: false,
      pdfVisibleFallbackUsed: false,
      fallbackSucceeded: false,
      reviewStatus,
      scientificScoringAttempted: false,
      debugPayload: {
        ...body,
        clientFailure: !interruptedByRestart,
        fileReadFailed,
        interruptedByServerRestart: interruptedByRestart,
        failureKind,
        apiRuntimeAtClientFailureReceipt: reviewRuntimeInfo(),
      },
    };
    const record = reviewAttemptRecordFromContext(context, {
      errorMessage: message,
      rawErrorCode: typeof body.httpStatus === "number"
        ? body.httpStatus
        : debugString(body, "httpStatus") ?? debugString(body, "errorName") ?? failureKind,
      failureStatus: interruptedByRestart ? "interrupted_by_server_restart" : "retryable",
      retryable: true,
      debugPayload: attemptDebugPayload(context),
    });
    await persistReviewAttemptRecord(record);
    const existingIndex = failedReviewAttempts.findIndex((attempt) => attempt.attemptId === record.attemptId);
    if (existingIndex >= 0) failedReviewAttempts.splice(existingIndex, 1);
    failedReviewAttempts.unshift(record);
    failedReviewAttempts.splice(MAX_FAILED_REVIEW_ATTEMPTS);
    res.status(201).json({ attempt: attemptForResponse(record) });
  } catch (err: any) {
    logger.error({ err }, "Error recording frontend review attempt failure");
    res.status(500).json({ error: err.message });
  }
});

// POST /api/review-jobs — create a durable background review job and return immediately
router.post("/review-jobs", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const { source } = req.body;
    const attempt = await createDurableReviewJob(req.user, source);
    res.status(202).json({
      jobId: attempt.attemptId,
      attempt: attemptForResponse(attempt),
      batchRunId: attempt.batchRunId,
      queueItemId: attempt.queueItemId,
      apiRuntime: reviewRuntimeInfo(),
    });
  } catch (err: any) {
    const response = submissionResponsePayload(err);
    res.status(response.status).json(response.body);
  }
});

// POST /api/review-jobs/:id/retry — retry a durable review job from its stored source snapshot
router.post("/review-jobs/:id/retry", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const record = await reviewAttemptById(req.params.id);
    if (!record) {
      res.status(404).json({ error: "Review job not found" });
      return;
    }
    if (record.userId !== req.user.id && !requireAdmin(req, res)) return;
    if (!sourceSnapshotFromAttempt(record)) {
      res.status(409).json({ error: "This review job has no stored source snapshot to retry." });
      return;
    }
    const queued = await markReviewJobQueued({
      ...record,
      retryCount: record.retryCount + 1,
      debugPayload: {
        ...debugPayloadObject(record.debugPayload),
        autoRecoveryCount: 0,
        manualRetryAt: new Date().toISOString(),
        manualRetryByUserId: req.user.id,
      },
    }, "manual_retry");
    enqueueReviewJob(queued.attemptId);
    res.status(202).json({ jobId: queued.attemptId, attempt: attemptForResponse(queued), apiRuntime: reviewRuntimeInfo() });
  } catch (err: any) {
    logger.error({ err }, "Error retrying review job");
    res.status(500).json({ error: err.message });
  }
});

// GET /api/review-jobs/:id — inspect one durable review attempt/job
router.get("/review-jobs/:id", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const [row] = await db.select().from(reviewAttemptsTable).where(eq(reviewAttemptsTable.id, req.params.id));
    if (!row) {
      res.status(404).json({ error: "Review job not found" });
      return;
    }
    let attempt = withRuntimeAttemptStatus(reviewAttemptRecordFromRow(row));
    if (attempt.userId !== req.user.id && !requireAdmin(req, res)) return;
    if (REVIEW_JOB_AUTO_RECOVERY && REVIEW_JOB_PROCESSING_ENABLED && shouldResumeReviewJob(attempt)) {
      const reason = isInterruptedReviewAttempt(attempt)
        ? "poll_server_restart_recovery"
        : jobLeaseExpired(attempt)
          ? "poll_lease_expired_recovery"
          : "poll_stale_recovery";
      const countsAgainstAutoRetries = reason === "poll_server_restart_recovery" || reason === "poll_lease_expired_recovery";
      if (countsAgainstAutoRetries && !canAutoRecoverReviewJob(attempt)) {
        attempt = await markReviewJobAutoRecoveryExceeded(attempt, reason);
      } else {
        const payload = debugPayloadObject(attempt.debugPayload);
        const autoRecoveryCount = countsAgainstAutoRetries
          ? reviewJobAutoRetryCount(attempt) + 1
          : reviewJobAutoRetryCount(attempt);
        attempt = await markReviewJobQueued({
          ...attempt,
          retryCount: countsAgainstAutoRetries ? attempt.retryCount + 1 : attempt.retryCount,
          debugPayload: {
            ...payload,
            autoRecoveryCount,
            lastAutoRecoveryReason: reason,
            lastAutoRecoveryAt: new Date().toISOString(),
            recoveredByWorkerId: REVIEW_JOB_WORKER_ID,
          },
        }, reason);
        enqueueReviewJob(attempt.attemptId);
      }
    }
    let paper: typeof papersTable.$inferSelect | null = null;
    let review: typeof reviewsTable.$inferSelect | null = null;
    if (attempt.paperId && isCompletedAttempt(attempt)) {
      const [paperRow] = await db.select().from(papersTable).where(eq(papersTable.id, attempt.paperId));
      paper = paperRow ?? null;
      if (paper) {
        const [reviewRow] = await db.select().from(reviewsTable).where(eq(reviewsTable.paperId, paper.id));
        review = reviewRow ?? null;
      }
    }
    res.json({ attempt: attemptForResponse(attempt), paper, review, apiRuntime: reviewRuntimeInfo() });
  } catch (err: any) {
    logger.error({ err }, "Error getting review job");
    res.status(500).json({ error: err.message });
  }
});

// GET /api/batches/:batchRunId — inspect durable status for the current or requested batch
router.get("/batches/:batchRunId", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const batchRunId = req.params.batchRunId;
    const limit = Math.min(Math.max(Number(req.query.limit ?? 100), 1), 500);
    const rows = await db.select()
      .from(reviewAttemptsTable)
      .where(sql`${reviewAttemptsTable.debugPayload}->>'batchRunId' = ${batchRunId}`)
      .orderBy(desc(reviewAttemptsTable.createdAt))
      .limit(limit);
    const attempts = rows
      .map(reviewAttemptRecordFromRow)
      .filter((attempt) => attempt.userId === req.user.id || (ADMIN_EMAIL && req.user.email === ADMIN_EMAIL));
    res.json({
      ...buildBatchExport(attempts, req.params.batchRunId),
      apiRuntime: reviewRuntimeInfo(),
    });
  } catch (err: any) {
    logger.error({ err }, "Error getting review batch");
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/admin/review-attempts/:id/supersede — mark an old failed attempt as superseded
router.patch("/admin/review-attempts/:id/supersede", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const [updated] = await db.update(reviewAttemptsTable)
      .set({
        reviewStatus: "superseded",
        failureStatus: "superseded",
        retryable: 0,
      })
      .where(eq(reviewAttemptsTable.id, req.params.id))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Review attempt not found" });
      return;
    }
    res.json({ attempt: attemptForResponse(reviewAttemptRecordFromRow(updated)) });
  } catch (err: any) {
    logger.error({ err }, "Error superseding review attempt");
    res.status(500).json({ error: err.message });
  }
});

// POST /api/papers/benchmark-clusters — admin-only organic clustering before comparator backfill
router.post("/papers/benchmark-clusters", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const benchmarkSetVersion =
      typeof req.body?.benchmarkSetVersion === "string" && req.body.benchmarkSetVersion.trim()
        ? req.body.benchmarkSetVersion.trim()
        : BENCHMARK_SET_VERSION;
    const clusterVersion =
      typeof req.body?.clusterVersion === "string" && req.body.clusterVersion.trim()
        ? req.body.clusterVersion.trim()
        : `v11-central-output-profile-${benchmarkSetVersion}`;

    const papers = dedupePapers(await db.select().from(papersTable).orderBy(desc(papersTable.createdAt)));
    const reviews = await db.select().from(reviewsTable);
    const reviewMap = new Map(reviews.map((review) => [review.paperId, review]));
    const profiles: ReturnType<typeof benchmarkProfileForClustering>[] = [];

    for (const paper of papers) {
      const review = reviewMap.get(paper.id);
      if (!review) continue;
      const coverageLedger = parseJsonObject(review.coverageLedgerJson);
      if (!coverageLedger) continue;
      // Cluster every calibration-compatible review, not just benchmark
      // candidates: recognition-suspected and weaker-blinded reviews are
      // excluded from anchor service only and must still receive cluster
      // labels so they join pairwise-calibration cohorts.
      if (!clusteringScopeIncludesReview(coverageLedger)) continue;
      profiles.push(benchmarkProfileForClustering(paper, review, coverageLedger));
    }

    if (profiles.length < 2) {
      res.status(400).json({ error: "Need at least two v11 benchmark profiles to cluster.", profileCount: profiles.length });
      return;
    }

    const response = await (geminiAI.models.generateContent as any)({
      model: GEMINI_META_MODEL,
      contents: [{
        role: "user",
        parts: [{ text: JSON.stringify({ benchmarkSetVersion, clusterVersion, profiles }, null, 2) }],
      }],
      config: {
        systemInstruction: BENCHMARK_PROFILE_CLUSTERING_V9_PROMPT,
        responseMimeType: "application/json",
        maxOutputTokens: 32768,
      },
    });
    const parsed = extractJsonValue(response.text ?? "");
    const clusters = Array.isArray(parsed?.clusters) ? parsed.clusters : [];
    const clusterByPaperId = new Map<string, any>();

    clusters.forEach((cluster: any, index: number) => {
      const clusterId = cluster.benchmarkClusterId || cluster.clusterId || `cluster-${index + 1}`;
      const includedIds = Array.isArray(cluster.includedPaperIds) ? cluster.includedPaperIds : [];
      for (const paperId of includedIds) {
        if (typeof paperId === "string") {
          clusterByPaperId.set(paperId, { ...cluster, benchmarkClusterId: clusterId });
        }
      }
    });

    let updated = 0;
    for (const paper of papers) {
      const cluster = clusterByPaperId.get(paper.id);
      if (!cluster) continue;
      const review = reviewMap.get(paper.id);
      if (!review) continue;
      const coverageLedger = parseJsonObject(review.coverageLedgerJson);
      if (!coverageLedger) continue;
      const updatedLedger = {
        ...coverageLedger,
        // Clustering must not promote non-candidates: candidacy is
        // preserved (and still subject to the anchor-hygiene exclusions),
        // while cluster labels are written for every compatible review.
        benchmarkSetCandidate: coverageLedger.benchmarkSetCandidate === true && benchmarkAnchorEligible(coverageLedger),
        benchmarkSetVersion,
        clusterVersion,
        benchmarkClusterId: cluster.benchmarkClusterId,
        canonicalClusterLabel: cluster.canonicalClusterLabel ?? null,
        localCohortAliases: cluster.localCohortAliases ?? [],
        benchmarkCluster: {
          benchmarkClusterId: cluster.benchmarkClusterId,
          canonicalClusterLabel: cluster.canonicalClusterLabel ?? null,
          clusterDescription: cluster.clusterDescription ?? "",
          localCohortAliases: cluster.localCohortAliases ?? [],
          centralComparatorPapers: cluster.centralComparatorPapers ?? [],
          boundaryCases: cluster.boundaryCases ?? [],
          nearbyClusters: cluster.nearbyClusters ?? [],
          rationale: cluster.whyTheseBelongTogether ?? cluster.rationale ?? "",
        },
        clusteredAt: new Date().toISOString(),
      };
      await db.update(reviewsTable)
        .set({ coverageLedgerJson: JSON.stringify(updatedLedger) })
        .where(eq(reviewsTable.id, review.id));
      updated += 1;
    }

    res.json({
      benchmarkSetVersion,
      clusterVersion,
      profileCount: profiles.length,
      clusterCount: clusters.length,
      updated,
      clusters,
      singletonOrOutlierPapers: parsed?.singletonOrOutlierPapers ?? [],
      globalNotes: parsed?.globalNotes ?? "",
    });
  } catch (err: any) {
    logger.error({ err }, "Benchmark clustering failed");
    res.status(500).json({ error: err.message });
  }
});

// Calibration engine selection: the legacy sequential comparator backfill
// stays available behind CALIBRATION_ENGINE=legacy; the default engine is
// the pairwise Bradley-Terry calibration below.
const CALIBRATION_ENGINE = process.env.CALIBRATION_ENGINE === "legacy" ? "legacy" : "pairwise";

// POST /api/papers/comparator-backfill — admin-only recalibration after a batch has populated the database
router.post("/papers/comparator-backfill", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  if (CALIBRATION_ENGINE !== "legacy") {
    res.status(409).json({
      error: "Legacy comparator calibration is disabled (CALIBRATION_ENGINE defaults to \"pairwise\"). Set CALIBRATION_ENGINE=legacy to run the legacy backfill.",
      calibrationEngine: CALIBRATION_ENGINE,
    });
    return;
  }
  try {
    const includeAll = req.body?.includeAll === true;
    const benchmarkSetVersion =
      typeof req.body?.benchmarkSetVersion === "string" && req.body.benchmarkSetVersion.trim()
        ? req.body.benchmarkSetVersion.trim()
        : BENCHMARK_SET_VERSION;
    const calibrationMode =
      req.body?.calibrationMode === "affected_neighborhood"
        ? "affected_neighborhood"
        : "backfill_cluster";
    const papers = dedupePapers(await db.select().from(papersTable).orderBy(desc(papersTable.createdAt)));
    const reviews = await db.select().from(reviewsTable);
    const reviewMap = new Map(reviews.map((review) => [review.paperId, review]));
    let updated = 0;
    let skipped = 0;
    const modifiedPaperIds: string[] = [];
    const errors: { paperId: string; title: string; error: string }[] = [];

    for (const paper of papers) {
      const review = reviewMap.get(paper.id);
      if (!review) { skipped += 1; continue; }

      const coverageLedger = parseJsonObject(review.coverageLedgerJson);
      const aggregateMeta = parseJsonObject((review as any).aggregateMetaJson ?? null);
      const aggregate = coverageLedger?.aggregate ?? aggregateMeta ?? coverageLedger ?? null;
      const aggregateAny = aggregate && typeof aggregate === "object" ? aggregate as Record<string, any> : null;
      const benchmarkSetCandidate = Boolean(coverageLedger?.benchmarkSetCandidate);
      const profileSource = aggregateAny?.comparatorProfile ?? aggregateAny?.organicCohortProfile ?? coverageLedger?.organicCohortProfile ?? null;
      if (!isCalibrationCompatibleReviewObject(coverageLedger ?? aggregateAny) || !profileSource || (!includeAll && !benchmarkSetCandidate)) {
        skipped += 1;
        continue;
      }

      try {
        const profileForSelection = {
          ...profileSource,
          localCohort: coverageLedger?.finalLocalCohort || coverageLedger?.localCohort || profileSource.localCohort,
          primaryCohort: profileSource.primaryCohort || coverageLedger?.comparisonCohort || coverageLedger?.localCohort,
	          adjacentBroadCohort: profileSource.adjacentBroadCohort || coverageLedger?.broadField,
	          primitiveInputs: profileSource.primitiveInputs ?? safeStringArray((coverageLedger?.inputConstructionOutputAssessment as any)?.input?.primitiveInputs),
	          introducedConstructions: profileSource.introducedConstructions ?? safeStringArray((coverageLedger?.inputConstructionOutputAssessment as any)?.construction?.introducedConstructions),
	          outputs: profileSource.outputs ?? safeStringArray((coverageLedger?.inputConstructionOutputAssessment as any)?.output?.outputs),
          clusterFeatureTags: [
            ...safeStringArray(profileSource.clusterFeatureTags),
            coverageLedger?.canonicalClusterLabel,
          ].filter(Boolean),
        };
	        const comparatorContext = await selectComparatorContextForProfile(profileForSelection, paper.id);
	        const { aggregate: updatedAggregate, thinkingText } = await recalibrateStoredAggregateWithComparators(
	          aggregate,
	          comparatorContext,
            calibrationMode,
            [paper.id],
	        );
	        const updatedAggregateAny = updatedAggregate && typeof updatedAggregate === "object" ? updatedAggregate as Record<string, any> : {};
	        const diagnosticCalibration = updatedAggregateAny.diagnosticComparatorCalibration ?? null;
	        const versionedAggregate = updatedAggregateAny.finalScoreBand ? {
	          ...updatedAggregateAny,
	          comparatorCalibration: {
	            ...updatedAggregateAny.comparatorCalibration,
	            benchmarkSetVersion,
	          },
	        } : updatedAggregateAny;
	        const storedVersionedAggregate = updatedAggregateAny.finalScoreBand
	          ? compactAggregateForStorage(versionedAggregate as any)
	          : versionedAggregate;
	        const storedVersionedAggregateAny = storedVersionedAggregate && typeof storedVersionedAggregate === "object"
	          ? storedVersionedAggregate as Record<string, any>
	          : {};
	        const storedComparatorCalibration = updatedAggregateAny.comparatorCalibration
	          ? v15ComparatorCalibrationForStorage(updatedAggregateAny.comparatorCalibration)
	          : null;
	        const updatedCoverageLedger = {
	          ...coverageLedger,
	          nearestComparators: storedVersionedAggregateAny.nearestComparators ?? coverageLedger?.nearestComparators ?? [],
	          externalComparatorSuggestions: storedVersionedAggregateAny.externalComparatorSuggestions ?? coverageLedger?.externalComparatorSuggestions ?? [],
	          publicComparatorSummary: storedVersionedAggregateAny.publicComparatorSummary ?? diagnosticCalibration?.calibrationRationale ?? coverageLedger?.publicComparatorSummary ?? "",
	          adminComparatorNotes: storedVersionedAggregateAny.adminComparatorNotes ?? "Diagnostic comparator backfill completed.",
	          ...(storedVersionedAggregateAny.comparatorProfile ? { comparatorProfile: storedVersionedAggregateAny.comparatorProfile } : {}),
	          ...(storedComparatorCalibration ? { comparatorCalibration: storedComparatorCalibration } : {}),
          diagnosticComparatorCalibration: diagnosticCalibration,
          comparatorCalibrationStatus: diagnosticCalibration?.comparatorCalibrationStatus ?? storedComparatorCalibration?.comparatorCalibrationStatus ?? "insufficient_comparators",
          calibrationMode: diagnosticCalibration?.calibrationMode ?? calibrationMode,
          calibrationVersion: diagnosticCalibration?.calibrationVersion ?? benchmarkSetVersion,
          comparatorRunId: diagnosticCalibration?.comparatorRunId ?? null,
          comparatorModel: diagnosticCalibration?.comparatorModel ?? null,
          comparatorPromptHash: diagnosticCalibration?.comparatorPromptHash ?? null,
          comparatorIds: diagnosticCalibration?.comparatorIds ?? comparatorContext.map((candidate, index) => candidate.comparatorId || `C${index + 1}`),
          comparatorRetrievalMethod: diagnosticCalibration?.comparatorRetrievalMethod ?? "canonical-profile-token-overlap-k8",
          targetOnly: diagnosticCalibration?.targetOnly ?? false,
          existingPapersModified: diagnosticCalibration?.existingPapersModified ?? true,
          modifiedPaperIds: diagnosticCalibration?.modifiedPaperIds ?? [paper.id],
          comparatorContextIncluded: comparatorContext.length > 0,
          calibrationContextIncluded: diagnosticCalibration?.calibrationContextIncluded ?? false,
          calibratedInputStrengthScore: diagnosticCalibration?.calibratedInputStrengthScore ?? null,
          calibratedConstructionStrengthScore: diagnosticCalibration?.calibratedConstructionStrengthScore ?? null,
          calibratedOutputStrengthScore: diagnosticCalibration?.calibratedOutputStrengthScore ?? null,
          rawCalibratedScore: diagnosticCalibration?.rawCalibratedScore ?? null,
          calibratedScore: diagnosticCalibration?.calibratedScore ?? null,
          diagnosticChanges: diagnosticCalibration?.diagnosticChanges ?? [],
          calibrationRationale: diagnosticCalibration?.calibrationRationale ?? "",
          benchmarkSetCandidate: benchmarkAnchorEligible(coverageLedger),
          benchmarkSetVersion,
          backfilledAt: new Date().toISOString(),
        };
	        const finalScore =
	          diagnosticCalibration?.calibratedScore ??
	          (versionedAggregate as any)?.finalScoreBand?.median ??
	          coverageLedger?.intrinsicScore ??
	          coverageLedger?.finalScore ??
	          review.overallIntrinsicScore ??
	          review.score;
	        await db.update(reviewsTable)
	          .set({
	            score: finalScore,
	            overallIntrinsicScore: finalScore,
	            bestClassification: (versionedAggregate as any)?.finalClassification ?? review.bestClassification,
	            finalJudgment: (versionedAggregate as any)?.publicOneParagraphVerdict ?? review.finalJudgment,
            coverageLedgerJson: JSON.stringify(updatedCoverageLedger),
            thinkingText: [review.thinkingText, thinkingText].filter(Boolean).join("\n\n---\n\n") || review.thinkingText,
          })
          .where(eq(reviewsTable.id, review.id));
	        await db.update(papersTable)
	          .set({ score: finalScore })
	          .where(eq(papersTable.id, paper.id));
	        updated += 1;
        modifiedPaperIds.push(paper.id);
      } catch (err: any) {
        errors.push({ paperId: paper.id, title: paper.title, error: err?.message ?? String(err) });
      }
    }

    res.json({ updated, skipped, errors, benchmarkSetVersion, calibrationMode, modifiedPaperIds });
  } catch (err: any) {
    logger.error({ err }, "Comparator backfill failed");
    res.status(500).json({ error: err.message });
  }
});

function pairwiseCohortIdForLedger(ledger: Record<string, any>): string | null {
  const cohortId =
    ledger.benchmarkClusterId ??
    ledger.benchmarkCluster?.benchmarkClusterId ??
    ledger.canonicalClusterLabel ??
    ledger.finalLocalCohort ??
    ledger.localCohort ??
    null;
  return typeof cohortId === "string" && cohortId.trim() ? cohortId.trim() : null;
}

type PairwiseCohortAssembly = {
  cohorts: Map<string, PairwiseCalibrationMember[]>;
  membersById: Map<string, PairwiseCalibrationMember>;
  ledgersByReviewId: Map<string, Record<string, any>>;
  reviewRowsById: Map<string, typeof reviewsTable.$inferSelect>;
  paperIdByReviewId: Map<string, string>;
};

async function assemblePairwiseCohorts(): Promise<PairwiseCohortAssembly> {
  const papers = dedupePapers(await db.select().from(papersTable).orderBy(desc(papersTable.createdAt)));
  const reviews = await db.select().from(reviewsTable);
  const reviewMap = new Map(reviews.map((review) => [review.paperId, review]));
  const cohorts = new Map<string, PairwiseCalibrationMember[]>();
  const membersById = new Map<string, PairwiseCalibrationMember>();
  const ledgersByReviewId = new Map<string, Record<string, any>>();
  const reviewRowsById = new Map<string, typeof reviewsTable.$inferSelect>();
  const paperIdByReviewId = new Map<string, string>();

  for (const paper of papers) {
    const review = reviewMap.get(paper.id);
    if (!review) continue;
    const ledger = parseJsonObject(review.coverageLedgerJson);
    if (!ledger || !isCalibrationCompatibleReviewObject(ledger)) continue;
    const cohortId = pairwiseCohortIdForLedger(ledger);
    if (!cohortId) continue;

    const comparatorProfile = ledger.organicCohortProfile ?? ledger.comparatorProfile ?? {};
    const ico = ledger.inputConstructionOutputAssessment ?? {};
    const profileText = [
      cohortId,
      ledger.canonicalClusterLabel,
      ledger.localCohort,
      ledger.finalLocalCohort,
      ledger.specialtyField,
      comparatorProfile?.localCohort,
      comparatorProfile?.primaryCohort,
      safeStringArray(comparatorProfile?.clusterFeatureTags).join(" "),
      safeStringArray(comparatorProfile?.primitiveInputs).join(" "),
      safeStringArray(comparatorProfile?.introducedConstructions).join(" "),
      safeStringArray(comparatorProfile?.outputs).join(" "),
      typeof ico?.input?.overallAssessment === "string" ? ico.input.overallAssessment : "",
    ].filter(Boolean).join("\n");

    const computedScore = Number(
      ledger.computedScore ?? ledger.intrinsicScore ?? review.overallIntrinsicScore ?? review.score ?? 0,
    );
    const member: PairwiseCalibrationMember = {
      reviewId: review.id,
      cohortId,
      profileText,
      strippedReview: strippedReviewForPairwise(ledger),
      downWeighted: ledger.blindingStrength === "weaker" || ledger.recognitionSuspected === true,
      computedScore: Number.isFinite(computedScore) ? computedScore : 0,
      calibrationAnchor: calibrationAnchorEligible(ledger),
      anchorOverride: isAdminPinnedAnchorOverride(ledger),
    };
    membersById.set(review.id, member);
    ledgersByReviewId.set(review.id, ledger);
    reviewRowsById.set(review.id, review);
    paperIdByReviewId.set(review.id, paper.id);
    cohorts.set(cohortId, [...(cohorts.get(cohortId) ?? []), member]);

    const bridgeCohortId = typeof ledger.bridgeCohortId === "string" ? ledger.bridgeCohortId.trim() : "";
    if (bridgeCohortId && bridgeCohortId !== cohortId) {
      cohorts.set(bridgeCohortId, [...(cohorts.get(bridgeCohortId) ?? []), { ...member, cohortId: bridgeCohortId }]);
    }
  }

  return { cohorts, membersById, ledgersByReviewId, reviewRowsById, paperIdByReviewId };
}

type PairwiseCalibrationPlan = {
  cohortPlans: {
    cohortId: string;
    memberCount: number;
    anchorCount: number;
    downWeightedCount: number;
    pairs: PlannedPair[];
    cachedPairCount: number;
    newPairCount: number;
  }[];
  plannedPairs: PlannedPair[];
  newPairs: PlannedPair[];
  cachedPairsByKey: Map<string, typeof calibrationPairsTable.$inferSelect>;
};

async function buildPairwiseCalibrationPlan(assembly: PairwiseCohortAssembly): Promise<PairwiseCalibrationPlan> {
  const cachedRows = await db.select().from(calibrationPairsTable)
    .where(eq(calibrationPairsTable.promptHash, PAIRWISE_CALIBRATION_PROMPT_HASH));
  const cachedPairsByKey = new Map(cachedRows.map((row) => [`${row.reviewIdA}\0${row.reviewIdB}`, row]));

  const cohortPlans: PairwiseCalibrationPlan["cohortPlans"] = [];
  const plannedByKey = new Map<string, PlannedPair>();
  for (const [cohortId, members] of [...assembly.cohorts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (members.length < 2) continue;
    const pairs = planCohortPairs(cohortId, members);
    let cachedPairCount = 0;
    for (const pair of pairs) {
      const key = `${pair.reviewIdA}\0${pair.reviewIdB}`;
      if (cachedPairsByKey.has(key)) cachedPairCount += 1;
      if (!plannedByKey.has(key)) plannedByKey.set(key, pair);
    }
    cohortPlans.push({
      cohortId,
      memberCount: members.length,
      anchorCount: members.filter((member) => member.calibrationAnchor).length,
      downWeightedCount: members.filter((member) => member.downWeighted).length,
      pairs,
      cachedPairCount,
      newPairCount: pairs.filter((pair) => !cachedPairsByKey.has(`${pair.reviewIdA}\0${pair.reviewIdB}`)).length,
    });
  }
  const plannedPairs = [...plannedByKey.values()];
  const newPairs = plannedPairs.filter((pair) => !cachedPairsByKey.has(`${pair.reviewIdA}\0${pair.reviewIdB}`));
  return { cohortPlans, plannedPairs, newPairs, cachedPairsByKey };
}

// A cohort mixing reviews whose intrinsic computedScores span more than
// this many points likely mixes frontier and failed papers; flagged for a
// human split decision (never auto-split).
const COHORT_HETEROGENEITY_SPAN_POINTS = 55;

function cohortHeterogeneityWarning(cohortId: string, members: PairwiseCalibrationMember[]) {
  const scores = members.map((member) => member.computedScore);
  if (scores.length < 2) return null;
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);
  const span = maxScore - minScore;
  if (span <= COHORT_HETEROGENEITY_SPAN_POINTS) return null;
  return { cohortId, span, minScore, maxScore };
}

// POST /api/papers/pairwise-calibration/dry-run — admin-only cost preview.
// Prints planned cohorts, pair counts, and estimated model calls without
// running any model calls.
router.post("/papers/pairwise-calibration/dry-run", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const assembly = await assemblePairwiseCohorts();
    const plan = await buildPairwiseCalibrationPlan(assembly);
    const cohortHeterogeneityWarnings = plan.cohortPlans
      .map((cohort) => cohortHeterogeneityWarning(cohort.cohortId, assembly.cohorts.get(cohort.cohortId) ?? []))
      .filter((warning): warning is NonNullable<typeof warning> => warning !== null);
    res.json({
      calibrationEngine: CALIBRATION_ENGINE,
      calibrationVersion: PAIRWISE_CALIBRATION_VERSION,
      promptHash: PAIRWISE_CALIBRATION_PROMPT_HASH,
      cohorts: plan.cohortPlans.map((cohort) => ({
        cohortId: cohort.cohortId,
        memberCount: cohort.memberCount,
        anchorCount: cohort.anchorCount,
        anchorOverrideCount: (assembly.cohorts.get(cohort.cohortId) ?? [])
          .filter((member) => member.calibrationAnchor && member.anchorOverride).length,
        downWeightedCount: cohort.downWeightedCount,
        pairCount: cohort.pairs.length,
        cachedPairCount: cohort.cachedPairCount,
        newPairCount: cohort.newPairCount,
        unanchored: cohort.anchorCount === 0,
        heterogeneityWarning: cohortHeterogeneityWarnings.some((warning) => warning.cohortId === cohort.cohortId),
      })),
      cohortHeterogeneityWarnings,
      totalPlannedPairs: plan.plannedPairs.length,
      totalCachedPairs: plan.plannedPairs.length - plan.newPairs.length,
      totalNewPairs: plan.newPairs.length,
      // Two model calls per new pair (position-swapped double judgment).
      estimatedModelCalls: plan.newPairs.length * 2,
      modelCallsOnRerunWithNoNewReviews: 0,
    });
  } catch (err: any) {
    logger.error({ err }, "Pairwise calibration dry-run failed");
    res.status(500).json({ error: err.message });
  }
});

// POST /api/papers/pairwise-calibration — admin-only pairwise BT calibration.
// Judges uncached pairs (twice each, A/B swapped), persists outcomes, fits
// Bradley-Terry per cohort in app code, maps through admin anchors, and
// stores calibratedScore separately from the intrinsic computedScore.
router.post("/papers/pairwise-calibration", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const assembly = await assemblePairwiseCohorts();
    const plan = await buildPairwiseCalibrationPlan(assembly);

    const judged = await runWithConcurrency(plan.newPairs, PAIRWISE_JUDGE_CONCURRENCY, async (pair) => {
      const outcome = await judgePair(pair, assembly.membersById);
      await db.insert(calibrationPairsTable).values({
        reviewIdA: outcome.reviewIdA,
        reviewIdB: outcome.reviewIdB,
        promptHash: PAIRWISE_CALIBRATION_PROMPT_HASH,
        cohortId: pair.cohortId,
        calibrationVersion: PAIRWISE_CALIBRATION_VERSION,
        model: GEMINI_CALIBRATION_MODEL,
        overallWinnerReviewId: outcome.overallWinnerReviewId,
        margin: outcome.margin,
        positionInconsistent: outcome.positionInconsistent ? 1 : 0,
        inputStrengthWinnerReviewId: outcome.inputStrengthWinnerReviewId,
        constructionStrengthWinnerReviewId: outcome.constructionStrengthWinnerReviewId,
        outputStrengthWinnerReviewId: outcome.outputStrengthWinnerReviewId,
        judgmentsJson: outcome.judgments as unknown as Record<string, unknown>[],
      }).onConflictDoNothing();
      return outcome;
    });
    const failedPairs = judged.filter((entry) => entry.error).map((entry) => ({
      reviewIdA: entry.item.reviewIdA,
      reviewIdB: entry.item.reviewIdB,
      error: String((entry.error as any)?.message ?? entry.error),
    }));

    // Re-read the cache so the fit uses exactly the stored, reproducible rows.
    const refreshed = await buildPairwiseCalibrationPlan(assembly);
    const cohortInputs: CalibrationCohortInput[] = refreshed.cohortPlans.map((cohort) => {
      const members = assembly.cohorts.get(cohort.cohortId) ?? [];
      const memberIds = members.map((member) => member.reviewId);
      const memberSet = new Set(memberIds);
      const outcomes: CalibrationPairOutcome[] = [];
      for (const pair of cohort.pairs) {
        const row = refreshed.cachedPairsByKey.get(`${pair.reviewIdA}\0${pair.reviewIdB}`);
        if (!row || !memberSet.has(row.reviewIdA) || !memberSet.has(row.reviewIdB)) continue;
        const downWeighted =
          assembly.membersById.get(row.reviewIdA)?.downWeighted ||
          assembly.membersById.get(row.reviewIdB)?.downWeighted;
        outcomes.push(outcomeFromStoredPair({
          reviewIdA: row.reviewIdA,
          reviewIdB: row.reviewIdB,
          overallWinnerReviewId: row.overallWinnerReviewId,
          inputStrengthWinnerReviewId: row.inputStrengthWinnerReviewId,
          constructionStrengthWinnerReviewId: row.constructionStrengthWinnerReviewId,
          outputStrengthWinnerReviewId: row.outputStrengthWinnerReviewId,
          margin: row.margin,
          positionInconsistent: row.positionInconsistent === 1,
        }, downWeighted ? 0.5 : 1));
      }
      return {
        cohortId: cohort.cohortId,
        members: memberIds,
        anchors: members
          .filter((member) => member.calibrationAnchor)
          .map((member) => ({
            reviewId: member.reviewId,
            frozenComputedScore: member.computedScore,
            adminPinnedOverride: member.anchorOverride,
          })),
        computedScores: Object.fromEntries(members.map((member) => [member.reviewId, member.computedScore])),
        outcomes,
      };
    }).filter((input) => input.outcomes.length > 0);

    const { fits, finalScores, pooledAnchors, mappingStrainWarnings, boundingAnchorsByReview } =
      calibrateCohortsV2(cohortInputs);
    const fitByCohort = new Map<string, CohortFitResult>(fits.map((fit) => [fit.cohortId, fit]));
    const calibrationHolds: { reviewId: string; paperId: string; intrinsicScore: number; calibratedScore: number; reason: string }[] = [];

    let updatedReviews = 0;
    for (const [reviewId, calibratedScore] of Object.entries(finalScores).sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const ledger = assembly.ledgersByReviewId.get(reviewId);
      const reviewRow = assembly.reviewRowsById.get(reviewId);
      const paperId = assembly.paperIdByReviewId.get(reviewId);
      if (!ledger || !reviewRow || !paperId) continue;

      const memberCohorts = [...fitByCohort.values()].filter((fit) => reviewId in fit.calibratedScores);
      const partnerIds = new Set<string>();
      const pairSummaries: Record<string, unknown>[] = [];
      for (const fit of memberCohorts) {
        const cohortPlan = refreshed.cohortPlans.find((cohort) => cohort.cohortId === fit.cohortId);
        for (const pair of cohortPlan?.pairs ?? []) {
          if (pair.reviewIdA !== reviewId && pair.reviewIdB !== reviewId) continue;
          const row = refreshed.cachedPairsByKey.get(`${pair.reviewIdA}\0${pair.reviewIdB}`);
          if (!row) continue;
          const partnerId = pair.reviewIdA === reviewId ? pair.reviewIdB : pair.reviewIdA;
          partnerIds.add(partnerId);
          pairSummaries.push({
            cohortId: fit.cohortId,
            partnerReviewId: partnerId,
            overall: row.overallWinnerReviewId == null ? "equal" : row.overallWinnerReviewId === reviewId ? "win" : "loss",
            margin: row.margin,
            positionInconsistent: row.positionInconsistent === 1,
          });
        }
      }
      const primaryFit = memberCohorts[0];
      const rank = primaryFit ? primaryFit.ranking.indexOf(reviewId) + 1 : 0;
      const wins = pairSummaries.filter((pair) => pair.overall === "win").length;
      const losses = pairSummaries.filter((pair) => pair.overall === "loss").length;
      const equals = pairSummaries.filter((pair) => pair.overall === "equal").length;
      const anchorsUsed = memberCohorts.flatMap((fit) => {
        const input = cohortInputs.find((cohort) => cohort.cohortId === fit.cohortId);
        return (input?.anchors ?? []).map((anchor) => anchor.reviewId);
      });
      const anchorOverrides = memberCohorts
        .flatMap((fit) => fit.anchorOverrides)
        .filter((override, index, array) =>
          array.findIndex((candidate) => candidate.reviewId === override.reviewId) === index)
        .sort((a, b) => (a.reviewId < b.reviewId ? -1 : 1));
      const calibrationRationale = [
        `Pairwise Bradley-Terry calibration: rank ${rank} of ${primaryFit ? primaryFit.ranking.length : 0} in cohort "${primaryFit?.cohortId ?? "unknown"}"`,
        `(${wins} wins / ${losses} losses / ${equals} equal overall, ${pairSummaries.length} comparisons).`,
        anchorsUsed.length > 0
          ? `Mapped through ${anchorsUsed.length} admin anchor(s).`
          : "No anchors in cohort; level set by virtual median anchor (unanchored).",
      ].join(" ");

      // Publish-safety tripwire: large intrinsic-to-calibrated movement or
      // strain in the paper's cohort holds the calibrated score for human
      // approval; the intrinsic score stays public meanwhile.
      const intrinsicScoreForReview = Math.round(Number(
        ledger.computedScore ?? ledger.intrinsicScore ?? reviewRow.overallIntrinsicScore ?? reviewRow.score ?? 0,
      ));
      const cohortStrainHit = [...fitByCohort.values()].some((fit) =>
        reviewId in fit.calibratedScores &&
        mappingStrainWarnings.some((warning) => warning.cohortId === fit.cohortId));
      const calibrationUnderReview = calibrationTripwireTriggered({
        calibratedScore,
        computedScore: intrinsicScoreForReview,
        cohortHasMappingStrainWarning: cohortStrainHit,
      });
      const calibrationHoldReason = calibrationUnderReview
        ? [
            Math.abs(calibratedScore - intrinsicScoreForReview) > CALIBRATION_TRIPWIRE_DELTA_POINTS
              ? `calibrated score moved ${Math.abs(calibratedScore - intrinsicScoreForReview)} points from intrinsic (limit ${CALIBRATION_TRIPWIRE_DELTA_POINTS})`
              : "",
            cohortStrainHit ? "mapping strain warning in this paper's cohort" : "",
          ].filter(Boolean).join("; ")
        : null;
      const publicScore = calibrationUnderReview ? intrinsicScoreForReview : calibratedScore;
      const anchorDetailById = new Map(cohortInputs
        .flatMap((cohort) => cohort.anchors)
        .map((anchor) => [anchor.reviewId, anchor]));
      const anchorsDetail = [...new Set(anchorsUsed)].sort().map((anchorReviewId) => ({
        reviewId: anchorReviewId,
        frozenComputedScore: anchorDetailById.get(anchorReviewId)?.frozenComputedScore ?? null,
        adminPinnedOverride: anchorDetailById.get(anchorReviewId)?.adminPinnedOverride === true,
      }));
      const memberCohortIds = new Set(memberCohorts.map((fit) => fit.cohortId));
      const updatedLedger = {
        ...ledger,
        calibratedScore,
        rawCalibratedScore: calibratedScore,
        calibrationUnderReview,
        calibrationHoldReason,
        calibrationApprovedAt: calibrationUnderReview ? null : (ledger.calibrationApprovedAt ?? null),
        calibrationMode: CALIBRATION_MODE_PAIRWISE_BT_V2,
        calibrationVersion: PAIRWISE_CALIBRATION_VERSION,
        comparatorCalibrationStatus: "applied",
        comparatorPromptHash: PAIRWISE_CALIBRATION_PROMPT_HASH,
        comparatorRetrievalMethod: "pairwise-cohort-pairs-v1",
        comparatorIds: [...partnerIds].sort(),
        calibrationRationale,
        pairwiseCalibration: {
          calibrationMode: CALIBRATION_MODE_PAIRWISE_BT_V2,
          calibrationVersion: PAIRWISE_CALIBRATION_VERSION,
          promptHash: PAIRWISE_CALIBRATION_PROMPT_HASH,
          cohorts: memberCohorts.map((fit) => ({
            cohortId: fit.cohortId,
            rank: fit.ranking.indexOf(reviewId) + 1,
            cohortSize: fit.ranking.length,
            unanchored: fit.unanchored,
            dimensionWinRates: fit.dimensionWinRates[reviewId] ?? null,
          })),
          anchorsUsed: [...new Set(anchorsUsed)].sort(),
          anchorsDetail,
          anchorOverrides,
          mapping: {
            // The pooled global-curve anchors bounding this paper's
            // position; the curve is shared by all cohorts in v2.
            boundingAnchors: boundingAnchorsByReview[reviewId] ?? [],
            pooledAnchorCount: pooledAnchors.length,
          },
          mappingStrainWarnings: mappingStrainWarnings.filter((warning) => memberCohortIds.has(warning.cohortId)),
          pairs: pairSummaries,
          calibratedAt: new Date().toISOString(),
        },
      };

      await db.update(reviewsTable)
        .set({ score: publicScore, coverageLedgerJson: JSON.stringify(updatedLedger) })
        .where(eq(reviewsTable.id, reviewId));
      await db.update(papersTable)
        .set({ score: publicScore })
        .where(eq(papersTable.id, paperId));
      if (calibrationUnderReview) {
        calibrationHolds.push({
          reviewId,
          paperId,
          intrinsicScore: intrinsicScoreForReview,
          calibratedScore,
          reason: calibrationHoldReason ?? "",
        });
      }
      updatedReviews += 1;
    }

    res.json({
      calibrationEngine: CALIBRATION_ENGINE,
      calibrationVersion: PAIRWISE_CALIBRATION_VERSION,
      promptHash: PAIRWISE_CALIBRATION_PROMPT_HASH,
      judgedNewPairs: plan.newPairs.length - failedPairs.length,
      cachedPairs: plan.plannedPairs.length - plan.newPairs.length,
      failedPairs,
      updatedReviews,
      calibrationHolds,
      pooledAnchors,
      mappingStrainWarnings,
      cohorts: fits.map((fit) => ({
        cohortId: fit.cohortId,
        unanchored: fit.unanchored,
        ranking: fit.ranking,
        calibratedScores: fit.calibratedScores,
        anchorOverrides: fit.anchorOverrides,
      })),
    });
  } catch (err: any) {
    logger.error({ err }, "Pairwise calibration failed");
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/reviews/:reviewId/calibration-flags — admin toggles for
// calibrationAnchor and bridgeCohortId. Anchors are explicit human choices;
// weaker-blinded or recognition-suspected reviews can never anchor.
router.post("/admin/reviews/:reviewId/calibration-flags", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const [reviewRow] = await db.select().from(reviewsTable).where(eq(reviewsTable.id, req.params.reviewId));
    if (!reviewRow) { res.status(404).json({ error: "Review not found" }); return; }
    const ledger = parseJsonObject(reviewRow.coverageLedgerJson);
    if (!ledger) { res.status(400).json({ error: "Review has no canonical coverage ledger." }); return; }

    const body = req.body && typeof req.body === "object" ? req.body : {};
    if (typeof body.calibrationAnchor === "boolean") {
      // Admin pinning is allowed even for weaker-blinded or
      // recognition-suspected reviews; calibration runs record it as an
      // anchorOverride ("admin-pinned") rather than refusing it.
      ledger.calibrationAnchor = body.calibrationAnchor;
    }
    if ("bridgeCohortId" in body) {
      ledger.bridgeCohortId =
        typeof body.bridgeCohortId === "string" && body.bridgeCohortId.trim() ? body.bridgeCohortId.trim() : null;
    }
    if ("canonicalClusterLabel" in body) {
      // Admin cluster reassignment: written to both the cluster id and the
      // label (benchmarkClusterId is what pairwiseCohortIdForLedger reads
      // first), so the next cohort assembly respects the human decision.
      const label = typeof body.canonicalClusterLabel === "string" && body.canonicalClusterLabel.trim()
        ? body.canonicalClusterLabel.trim()
        : null;
      ledger.benchmarkClusterId = label;
      ledger.canonicalClusterLabel = label;
      ledger.clusterReassignedAt = label ? new Date().toISOString() : null;
    }

    await db.update(reviewsTable)
      .set({ coverageLedgerJson: JSON.stringify(ledger) })
      .where(eq(reviewsTable.id, reviewRow.id));
    res.json({
      reviewId: reviewRow.id,
      calibrationAnchor: ledger.calibrationAnchor === true,
      anchorOverride: isAdminPinnedAnchorOverride(ledger),
      bridgeCohortId: ledger.bridgeCohortId ?? null,
      canonicalClusterLabel: ledger.canonicalClusterLabel ?? null,
    });
  } catch (err: any) {
    logger.error({ err }, "Calibration flags update failed");
    res.status(500).json({ error: err.message });
  }
});

function sandboxSubscores(reviewJson: string | null) {
  const ledger = parseJsonObject(reviewJson);
  return {
    inputStrengthScore: ledger?.inputStrengthScore ?? null,
    constructionStrengthScore: ledger?.constructionStrengthScore ?? null,
    outputStrengthScore: ledger?.outputStrengthScore ?? null,
    computedScore: ledger?.computedScore ?? ledger?.intrinsicScore ?? null,
  };
}

// Resolves the manuscript text a sandbox run reviews: an explicit override,
// else the stored blinded snapshot (exactly what the canonical review saw),
// else the paper's stored content when it is real text rather than the
// "[PDF] <title>" stub written for PDF uploads.
function resolveSandboxManuscriptText(
  paper: typeof papersTable.$inferSelect,
  review: typeof reviewsTable.$inferSelect | null,
  explicitText: unknown,
): { text: string; source: string } | null {
  if (typeof explicitText === "string" && explicitText.trim().length > 200) {
    return { text: explicitText, source: "request-body" };
  }
  const ledger = review ? parseJsonObject(review.coverageLedgerJson) : null;
  const snapshot = ledger?.reviewInputSnapshot && typeof ledger.reviewInputSnapshot === "object"
    ? ledger.reviewInputSnapshot as Record<string, unknown>
    : null;
  if (typeof snapshot?.blindedReviewText === "string" && snapshot.blindedReviewText.length > 200) {
    // Prepend a placeholder line so re-blinding is a no-op: the blinder's
    // pre-abstract cut (or title redaction) consumes it instead of eating
    // the stored text's own first line.
    return { text: `[TITLE REDACTED]\n\n${snapshot.blindedReviewText}`, source: "stored-blinded-snapshot" };
  }
  if (typeof paper.content === "string" && !paper.content.startsWith("[PDF]") && paper.content.length > 2000) {
    return { text: paper.content, source: "paper-content" };
  }
  return null;
}

// POST /api/admin/sandbox-reviews — run a paper's stored blinded text
// through an arbitrary prompt. The result lives only in sandbox_reviews:
// never in feeds, public exports, clustering, or calibration.
router.post("/admin/sandbox-reviews", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const paperId = typeof body.paperId === "string" ? body.paperId.trim() : "";
    const label = typeof body.label === "string" && body.label.trim() ? body.label.trim() : "unlabeled";
    const promptText = typeof body.promptText === "string" ? body.promptText : "";
    if (!paperId || promptText.trim().length < 200) {
      res.status(400).json({ error: "paperId and a full promptText (>= 200 chars) are required." });
      return;
    }
    const [paper] = await db.select().from(papersTable).where(eq(papersTable.id, paperId));
    if (!paper) { res.status(404).json({ error: "Paper not found" }); return; }
    const [review] = await db.select().from(reviewsTable).where(eq(reviewsTable.paperId, paperId));
    const resolved = resolveSandboxManuscriptText(paper, review ?? null, body.manuscriptText);
    if (!resolved) {
      res.status(422).json({
        error: "No stored manuscript text for this paper. The blinded snapshot was not stored (STORE_FULL_REVIEW_INPUT_SNAPSHOTS) and the paper content is a PDF stub; pass manuscriptText explicitly.",
      });
      return;
    }
    const promptHash = createHash("sha256").update(promptText).digest("hex").slice(0, 16);
    const { metadata, reviewValues } = await generateCompatReview(resolved.text, "gemini", promptText, {
      reviewMode: "benchmark-ingestion",
    });
    const [inserted] = await db.insert(sandboxReviewsTable).values({
      paperId,
      label,
      promptHash,
      promptText,
      modelName: metadata.modelName,
      reviewJson: reviewValues.coverageLedgerJson ?? "{}",
    }).returning();
    res.json({
      sandboxReview: {
        id: inserted.id,
        paperId,
        label,
        promptHash,
        manuscriptTextSource: resolved.source,
        createdAt: inserted.createdAt,
        ...sandboxSubscores(inserted.reviewJson),
      },
    });
  } catch (err: any) {
    logger.error({ err }, "Sandbox review failed");
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/sandbox-reviews?paperId= — sandbox runs with the paper's
// canonical subscores for side-by-side comparison.
router.get("/admin/sandbox-reviews", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const paperId = typeof req.query.paperId === "string" ? req.query.paperId.trim() : "";
    const rows = paperId
      ? await db.select().from(sandboxReviewsTable).where(eq(sandboxReviewsTable.paperId, paperId)).orderBy(desc(sandboxReviewsTable.createdAt))
      : await db.select().from(sandboxReviewsTable).orderBy(desc(sandboxReviewsTable.createdAt));
    const canonical = paperId
      ? await db.select().from(reviewsTable).where(eq(reviewsTable.paperId, paperId))
      : [];
    const canonicalLedger = canonical[0] ? parseJsonObject(canonical[0].coverageLedgerJson) : null;
    res.json({
      canonical: canonicalLedger ? {
        promptVersion: canonicalLedger.promptVersion ?? null,
        inputStrengthScore: canonicalLedger.inputStrengthScore ?? null,
        constructionStrengthScore: canonicalLedger.constructionStrengthScore ?? null,
        outputStrengthScore: canonicalLedger.outputStrengthScore ?? null,
        computedScore: canonicalLedger.computedScore ?? canonicalLedger.intrinsicScore ?? null,
      } : null,
      sandboxReviews: rows.map((row) => ({
        id: row.id,
        paperId: row.paperId,
        label: row.label,
        promptHash: row.promptHash,
        modelName: row.modelName,
        createdAt: row.createdAt,
        ...sandboxSubscores(row.reviewJson),
      })),
    });
  } catch (err: any) {
    logger.error({ err }, "Sandbox review listing failed");
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/sandbox-reviews/export — the dedicated sandbox export
// (full stored review objects; the public export never includes these).
router.get("/admin/sandbox-reviews/export", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const rows = await db.select().from(sandboxReviewsTable).orderBy(desc(sandboxReviewsTable.createdAt));
    res.json({
      sandboxReviews: rows.map((row) => ({
        id: row.id,
        paperId: row.paperId,
        label: row.label,
        promptHash: row.promptHash,
        promptText: row.promptText,
        modelName: row.modelName,
        createdAt: row.createdAt,
        review: parseJsonObject(row.reviewJson),
      })),
    });
  } catch (err: any) {
    logger.error({ err }, "Sandbox export failed");
    res.status(500).json({ error: err.message });
  }
});

const REALIZED_YIELD_PROMPT_HASH = createHash("sha256").update(REALIZED_YIELD_V1_PROMPT).digest("hex").slice(0, 16);

const realizedYieldJsonSchema = {
  type: "object",
  required: ["realizedYieldScore", "trajectoryAssessment", "rationale", "evidence", "refutationNoted", "confidence"],
  additionalProperties: false,
  properties: {
    realizedYieldScore: { type: "number" },
    trajectoryAssessment: { type: "string", enum: ["ahead", "typical", "behind"] },
    rationale: { type: "string" },
    evidence: {
      type: "array",
      items: {
        type: "object",
        required: ["construction", "terminalFirmness", "loadBearingness", "evidence"],
        additionalProperties: false,
        properties: {
          construction: { type: "string" },
          terminalFirmness: { type: "string", enum: ["F1", "F2", "F3", "F4", "refuted"] },
          loadBearingness: { type: "string", enum: ["essential", "supporting", "incidental"] },
          evidence: { type: "string" },
        },
      },
    },
    refutationNoted: { type: "boolean" },
    confidence: { type: "number" },
  },
};

function realizedYieldPublicationDate(paper: typeof papersTable.$inferSelect): string | null {
  const metadata = paper.dateMetadata as Record<string, string> | null;
  const candidate = metadata?.originalPublicationDateBestGuess || metadata?.journalPublicationDate || metadata?.arxivFirstSubmissionDate || "";
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : null;
}

// Runs one realized-yield assessment and appends a row. Each row logs
// (age, paperType, yield) so empirical age-yield curves accumulate;
// parametric scaling may be fit later from that data, never assumed now.
async function runRealizedYieldAssessment(paper: typeof papersTable.$inferSelect) {
  const [review] = await db.select().from(reviewsTable).where(eq(reviewsTable.paperId, paper.id));
  const ledger = review ? parseJsonObject(review.coverageLedgerJson) : null;
  const publicationDate = realizedYieldPublicationDate(paper);
  const paperAgeYears = publicationDate
    ? Math.max(0, (Date.now() - Date.parse(publicationDate)) / (365.25 * 24 * 3600 * 1000))
    : null;
  const previousRows = await db.select().from(realizedYieldAssessmentsTable)
    .where(eq(realizedYieldAssessmentsTable.paperId, paper.id))
    .orderBy(desc(realizedYieldAssessmentsTable.assessedAt));
  const previousMax = previousRows.reduce((max, row) => Math.max(max, row.realizedYieldScore), 0);

  const response = await (geminiAI.models.generateContent as any)({
    model: GEMINI_META_MODEL,
    contents: [{
      role: "user",
      parts: [{
        text: JSON.stringify({
          title: paper.title,
          authors: paper.paperAuthors,
          publicationDate,
          paperAgeYears: paperAgeYears != null ? Math.round(paperAgeYears * 10) / 10 : null,
          paperType: ledger?.paperType ?? null,
          centralClaim: ledger?.centralClaim ?? null,
          inputConstructionOutputAssessment: ledger?.inputConstructionOutputAssessment ?? null,
          previousAssessment: previousRows[0]
            ? { realizedYieldScore: previousRows[0].realizedYieldScore, assessedAt: previousRows[0].assessedAt }
            : null,
        }, null, 2),
      }],
    }],
    config: {
      systemInstruction: REALIZED_YIELD_V1_PROMPT,
      responseMimeType: "application/json",
      responseJsonSchema: realizedYieldJsonSchema,
      temperature: 0.2,
      maxOutputTokens: 8192,
    },
  });
  const parsed = parseGeminiJsonResponse(response.text ?? "") as Record<string, any>;
  const modelScore = Math.round(Math.max(0, Math.min(100, Number(parsed.realizedYieldScore ?? 0))));
  const refutationNoted = parsed.refutationNoted === true;
  // Confirmed yield is monotonically non-decreasing across re-assessments
  // unless a central claim was actually refuted.
  const realizedYieldScore = refutationNoted ? modelScore : Math.max(modelScore, previousMax);
  const trajectoryAssessment = ["ahead", "typical", "behind"].includes(parsed.trajectoryAssessment)
    ? parsed.trajectoryAssessment
    : "typical";

  const [inserted] = await db.insert(realizedYieldAssessmentsTable).values({
    paperId: paper.id,
    realizedYieldScore,
    trajectoryAssessment,
    rationale: typeof parsed.rationale === "string" ? parsed.rationale : "",
    evidenceJson: Array.isArray(parsed.evidence) ? parsed.evidence : [],
    publicationDate,
    paperAgeYears: paperAgeYears != null ? String(Math.round(paperAgeYears * 10) / 10) : null,
    paperType: typeof ledger?.paperType === "string" ? ledger.paperType : null,
    promptHash: REALIZED_YIELD_PROMPT_HASH,
    modelName: GEMINI_META_MODEL,
    assessmentJson: parsed,
  }).returning();
  return inserted;
}

function realizedYieldForResponse(row: typeof realizedYieldAssessmentsTable.$inferSelect) {
  return {
    assessed: true,
    paperId: row.paperId,
    realizedYieldScore: row.realizedYieldScore,
    trajectoryAssessment: row.trajectoryAssessment,
    rationale: row.rationale,
    evidence: row.evidenceJson ?? [],
    publicationDate: row.publicationDate,
    paperAgeYears: row.paperAgeYears != null ? Number(row.paperAgeYears) : null,
    paperType: row.paperType,
    promptHash: row.promptHash,
    assessedAt: row.assessedAt,
  };
}

// POST /api/admin/papers/:id/realized-yield — run one hindsight-permitted
// realized-yield assessment. Separate axis: never blended with intrinsic
// or calibrated scores, never anchor-eligible, excluded from calibration.
router.post("/admin/papers/:id/realized-yield", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const [paper] = await db.select().from(papersTable).where(eq(papersTable.id, req.params.id));
    if (!paper) { res.status(404).json({ error: "Paper not found" }); return; }
    const row = await runRealizedYieldAssessment(paper);
    res.json({ realizedYield: realizedYieldForResponse(row) });
  } catch (err: any) {
    logger.error({ err }, "Realized yield assessment failed");
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/realized-yield/batch — assess every reviewed paper.
router.post("/admin/realized-yield/batch", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const papers = dedupePapers(await db.select().from(papersTable).orderBy(desc(papersTable.createdAt)));
    const reviews = await db.select().from(reviewsTable);
    const reviewedPaperIds = new Set(reviews.map((review) => review.paperId));
    const targets = papers.filter((paper) => reviewedPaperIds.has(paper.id));
    const results = await runWithConcurrency(targets, 2, (paper) => runRealizedYieldAssessment(paper));
    const assessed = results.filter((entry) => entry.result).map((entry) => realizedYieldForResponse(entry.result!));
    const failures = results.filter((entry) => entry.error).map((entry) => ({
      paperId: entry.item.id,
      title: entry.item.title,
      error: String((entry.error as any)?.message ?? entry.error),
    }));
    res.json({ assessedCount: assessed.length, failures, assessed });
  } catch (err: any) {
    logger.error({ err }, "Realized yield batch failed");
    res.status(500).json({ error: err.message });
  }
});

// GET /api/papers/:id/realized-yield — latest assessment for the chip.
router.get("/papers/:id/realized-yield", async (req, res) => {
  try {
    const [latest] = await db.select().from(realizedYieldAssessmentsTable)
      .where(eq(realizedYieldAssessmentsTable.paperId, req.params.id))
      .orderBy(desc(realizedYieldAssessmentsTable.assessedAt))
      .limit(1);
    if (!latest) { res.json({ assessed: false }); return; }
    res.json(realizedYieldForResponse(latest));
  } catch (err: any) {
    logger.error({ err }, "Realized yield lookup failed");
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/calibration/holds — reviews whose calibrated score is
// held by the publish-safety tripwire (intrinsic score shown publicly).
router.get("/admin/calibration/holds", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const papers = dedupePapers(await db.select().from(papersTable).orderBy(desc(papersTable.createdAt)));
    const reviews = await db.select().from(reviewsTable);
    const paperById = new Map(papers.map((paper) => [paper.id, paper]));
    const holds = reviews.flatMap((review) => {
      const ledger = parseJsonObject(review.coverageLedgerJson);
      if (!ledger || ledger.calibrationUnderReview !== true) return [];
      const paper = paperById.get(review.paperId);
      return [{
        reviewId: review.id,
        paperId: review.paperId,
        title: paper?.title ?? null,
        intrinsicScore: ledger.computedScore ?? ledger.intrinsicScore ?? null,
        calibratedScore: ledger.calibratedScore ?? null,
        reason: ledger.calibrationHoldReason ?? "",
        calibratedAt: ledger.pairwiseCalibration?.calibratedAt ?? null,
      }];
    });
    res.json({ holds });
  } catch (err: any) {
    logger.error({ err }, "Calibration holds listing failed");
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/calibration/holds/:reviewId — one-tap approve/hold.
// Approval publishes the calibrated score; hold keeps the intrinsic score
// public and the review in the queue.
router.post("/admin/calibration/holds/:reviewId", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const action = req.body?.action === "approve" ? "approve" : req.body?.action === "hold" ? "hold" : null;
    if (!action) { res.status(400).json({ error: "action must be \"approve\" or \"hold\"" }); return; }
    const [reviewRow] = await db.select().from(reviewsTable).where(eq(reviewsTable.id, req.params.reviewId));
    if (!reviewRow) { res.status(404).json({ error: "Review not found" }); return; }
    const ledger = parseJsonObject(reviewRow.coverageLedgerJson);
    if (!ledger || typeof ledger.calibratedScore !== "number") {
      res.status(400).json({ error: "Review has no calibrated score to approve." });
      return;
    }
    if (action === "approve") {
      ledger.calibrationUnderReview = false;
      ledger.calibrationApprovedAt = new Date().toISOString();
      await db.update(reviewsTable)
        .set({ score: ledger.calibratedScore, coverageLedgerJson: JSON.stringify(ledger) })
        .where(eq(reviewsTable.id, reviewRow.id));
      await db.update(papersTable)
        .set({ score: ledger.calibratedScore })
        .where(eq(papersTable.id, reviewRow.paperId));
    } else {
      ledger.calibrationUnderReview = true;
      ledger.calibrationHeldAt = new Date().toISOString();
      await db.update(reviewsTable)
        .set({ coverageLedgerJson: JSON.stringify(ledger) })
        .where(eq(reviewsTable.id, reviewRow.id));
    }
    res.json({
      reviewId: reviewRow.id,
      action,
      calibrationUnderReview: ledger.calibrationUnderReview === true,
      publishedScore: action === "approve" ? ledger.calibratedScore : ledger.computedScore ?? null,
    });
  } catch (err: any) {
    logger.error({ err }, "Calibration hold action failed");
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/calibration/cluster-labels — distinct cluster labels for
// the admin reassign-cluster dropdown.
router.get("/admin/calibration/cluster-labels", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const reviews = await db.select().from(reviewsTable);
    const labels = new Set<string>();
    for (const review of reviews) {
      const ledger = parseJsonObject(review.coverageLedgerJson);
      if (!ledger) continue;
      const label = pairwiseCohortIdForLedger(ledger);
      if (label) labels.add(label);
    }
    res.json({ labels: [...labels].sort() });
  } catch (err: any) {
    logger.error({ err }, "Cluster label listing failed");
    res.status(500).json({ error: err.message });
  }
});

// GET /api/papers/:id/calibration — full calibration trail for the
// transparency tab: cohort membership, BT outcome, every pair with both
// raw model rationales, and the anchor mapping. Nothing is stripped.
router.get("/papers/:id/calibration", async (req, res) => {
  try {
    const [paper] = await db.select().from(papersTable).where(eq(papersTable.id, req.params.id));
    if (!paper) { res.status(404).json({ error: "Paper not found" }); return; }
    const [review] = await db.select().from(reviewsTable).where(eq(reviewsTable.paperId, paper.id));
    const ledger = review ? parseJsonObject(review.coverageLedgerJson) : null;
    const pairwiseCalibration = ledger?.pairwiseCalibration;
    if (!review || !ledger || !pairwiseCalibration || typeof pairwiseCalibration !== "object") {
      res.json({ calibrated: false });
      return;
    }

    const allPapers = dedupePapers(await db.select().from(papersTable).orderBy(desc(papersTable.createdAt)));
    const allReviews = await db.select().from(reviewsTable);
    const reviewById = new Map(allReviews.map((row) => [row.id, row]));
    const paperById = new Map(allPapers.map((row) => [row.id, row]));
    const titleByReviewId = (reviewId: string) => {
      const reviewRow = reviewById.get(reviewId);
      const paperRow = reviewRow ? paperById.get(reviewRow.paperId) : null;
      return paperRow?.title ?? null;
    };

    const cohortIds = new Set(
      (Array.isArray(pairwiseCalibration.cohorts) ? pairwiseCalibration.cohorts : [])
        .map((cohort: any) => cohort?.cohortId)
        .filter((cohortId: unknown): cohortId is string => typeof cohortId === "string"),
    );
    const cohortMembers: { reviewId: string; paperId: string; title: string | null; cohortId: string }[] = [];
    for (const paperRow of allPapers) {
      const memberReview = allReviews.find((row) => row.paperId === paperRow.id);
      if (!memberReview) continue;
      const memberLedger = parseJsonObject(memberReview.coverageLedgerJson);
      if (!memberLedger) continue;
      const memberCohortId = pairwiseCohortIdForLedger(memberLedger);
      if (!memberCohortId || !cohortIds.has(memberCohortId)) continue;
      cohortMembers.push({ reviewId: memberReview.id, paperId: paperRow.id, title: paperRow.title, cohortId: memberCohortId });
    }

    const promptHash = typeof pairwiseCalibration.promptHash === "string"
      ? pairwiseCalibration.promptHash
      : PAIRWISE_CALIBRATION_PROMPT_HASH;
    const pairRows = await db.select().from(calibrationPairsTable)
      .where(eq(calibrationPairsTable.promptHash, promptHash));
    const pairRowByKey = new Map(pairRows.map((row) => [`${row.reviewIdA}\0${row.reviewIdB}`, row]));
    const pairs = (Array.isArray(pairwiseCalibration.pairs) ? pairwiseCalibration.pairs : []).map((pair: any) => {
      const partnerReviewId = typeof pair?.partnerReviewId === "string" ? pair.partnerReviewId : "";
      const [reviewIdA, reviewIdB] = review.id < partnerReviewId ? [review.id, partnerReviewId] : [partnerReviewId, review.id];
      const row = pairRowByKey.get(`${reviewIdA}\0${reviewIdB}`);
      return {
        ...pair,
        partnerTitle: titleByReviewId(partnerReviewId),
        judgments: (Array.isArray(row?.judgmentsJson) ? row.judgmentsJson : []).map((judgment: any) => ({
          ...judgment,
          // Per-judgment A/B assignment resolved to real titles; rationale
          // prose may still say "Paper A"/"Paper B", so the UI shows a key.
          paperATitle: typeof judgment?.paperAReviewId === "string" ? titleByReviewId(judgment.paperAReviewId) : null,
          paperBTitle: typeof judgment?.paperBReviewId === "string" ? titleByReviewId(judgment.paperBReviewId) : null,
        })),
      };
    });

    const anchorsDetail = (Array.isArray(pairwiseCalibration.anchorsDetail) ? pairwiseCalibration.anchorsDetail : [])
      .map((anchor: any) => ({ ...anchor, title: typeof anchor?.reviewId === "string" ? titleByReviewId(anchor.reviewId) : null }));
    const boundingAnchors = (Array.isArray(pairwiseCalibration.mapping?.boundingAnchors) ? pairwiseCalibration.mapping.boundingAnchors : [])
      .map((anchor: any) => ({ ...anchor, title: typeof anchor?.reviewId === "string" ? titleByReviewId(anchor.reviewId) : null }));

    res.json({
      calibrated: true,
      paperId: paper.id,
      reviewId: review.id,
      calibratedScore: ledger.calibratedScore ?? null,
      intrinsicScore: ledger.computedScore ?? ledger.intrinsicScore ?? review.overallIntrinsicScore ?? review.score ?? null,
      calibrationMode: ledger.calibrationMode ?? null,
      calibrationVersion: pairwiseCalibration.calibrationVersion ?? ledger.calibrationVersion ?? null,
      promptHash,
      calibratedAt: pairwiseCalibration.calibratedAt ?? null,
      calibrationRationale: ledger.calibrationRationale ?? "",
      cohorts: pairwiseCalibration.cohorts ?? [],
      cohortMembers,
      anchorsUsed: pairwiseCalibration.anchorsUsed ?? [],
      anchorsDetail,
      anchorOverrides: pairwiseCalibration.anchorOverrides ?? [],
      mapping: { ...(pairwiseCalibration.mapping ?? {}), boundingAnchors },
      mappingStrainWarnings: pairwiseCalibration.mappingStrainWarnings ?? [],
      pairs,
    });
  } catch (err: any) {
    logger.error({ err }, "Calibration detail lookup failed");
    res.status(500).json({ error: err.message });
  }
});

// GET /api/papers/export — download all reviews as structured JSON (model output only)
router.get("/papers/export", async (req, res) => {
  try {
    const includeSystemPrompt = req.query.includeSystemPrompt === "true";
    const debugAudit = req.query.debugAudit === "true";
    const includeFailedAttempts = debugAudit && req.query.includeFailedAttempts === "true";
    const requestedBatchRunId = typeof req.query.batchRunId === "string" && req.query.batchRunId.trim()
      ? req.query.batchRunId.trim()
      : null;
    if (debugAudit && !requireAdmin(req, res)) return;
    const papers = dedupePapers(await db.select().from(papersTable).orderBy(desc(papersTable.createdAt)));
    const reviews = await db.select().from(reviewsTable);
    const reviewMap = new Map(reviews.map(r => [r.paperId, r]));
    // Latest realized-yield assessment per paper: the intrinsic-vs-realized
    // scatter across the benchmark is the instrument-validation dataset.
    const realizedYieldRows = await db.select().from(realizedYieldAssessmentsTable)
      .orderBy(desc(realizedYieldAssessmentsTable.assessedAt));
    const latestRealizedYieldByPaper = new Map<string, typeof realizedYieldAssessmentsTable.$inferSelect>();
    for (const row of realizedYieldRows) {
      if (!latestRealizedYieldByPaper.has(row.paperId)) latestRealizedYieldByPaper.set(row.paperId, row);
    }
    const persistedFailedAttempts = includeFailedAttempts
      ? (requestedBatchRunId
          ? await db.select()
              .from(reviewAttemptsTable)
              .where(sql`${reviewAttemptsTable.debugPayload}->>'batchRunId' = ${requestedBatchRunId}`)
              .orderBy(desc(reviewAttemptsTable.createdAt))
              .limit(100)
          : await db.select()
              .from(reviewAttemptsTable)
              .orderBy(desc(reviewAttemptsTable.createdAt))
              .limit(50)
        ).map(reviewAttemptRecordFromRow)
      : [];
    const failedAttemptsForExport = includeFailedAttempts
      ? Array.from(new Map([...persistedFailedAttempts, ...failedReviewAttempts].map((attempt) => [attempt.attemptId, attempt])).values())
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
          .slice(0, MAX_FAILED_REVIEW_ATTEMPTS)
      : [];
    const batchAttemptExport = includeFailedAttempts
      ? buildBatchExport(failedAttemptsForExport, requestedBatchRunId)
      : null;

    const exported = papers.map(paperRecord => {
      const r = reviewMap.get(paperRecord.id);
      const p = normalizePaperDisplayMetadata(paperRecord, reviewMetadataNormalizationText(r));
      const coverageLedger = r ? parseJsonObject(r.coverageLedgerJson) : null;
      const reviewObjectVersion = String(coverageLedger?.reviewObjectVersion ?? "");
      const isCanonicalReview =
        coverageLedger?.reviewObjectVersion === "v16.7-canonical" ||
        reviewObjectVersion.startsWith("v17");
      if (r && coverageLedger && isCanonicalReview) {
        const isV17 = reviewObjectVersion.startsWith("v17");
        const blindPassReviewsFromField = parseJsonArray((r as any).individualReviewsJson ?? null);
        const blindPassReviews = Array.isArray(coverageLedger.blindPassReviews)
          ? coverageLedger.blindPassReviews
          : Array.isArray(blindPassReviewsFromField)
            ? blindPassReviewsFromField
            : [];
        const comparatorCalibrationRan =
          coverageLedger.comparatorCalibrationStatus === "applied" ||
          coverageLedger.comparatorCalibrationStatus === "weak";
        const canonicalReview: Record<string, any> = {
          reviewObjectVersion: coverageLedger.reviewObjectVersion,
          calibrationCompatibilityFamily: coverageLedger.calibrationCompatibilityFamily ?? null,
          diagnosticScaleVersion: coverageLedger.diagnosticScaleVersion ?? null,
          scoringFormulaVersion: coverageLedger.scoringFormulaVersion ?? null,
          promptVersion: coverageLedger.promptVersion ?? REVIEW_PROMPT_VERSION,
          promptName: coverageLedger.promptName ?? REVIEW_PROMPT_NAME,
          promptHash: coverageLedger.promptHash ?? REVIEW_PROMPT_HASH,
          pipelineMode: coverageLedger.pipelineMode ?? null,
          benchmarkSetCandidate: coverageLedger.benchmarkSetCandidate ?? false,
          benchmarkSetVersion: coverageLedger.benchmarkSetVersion ?? null,
          extractionMethod: coverageLedger.extractionMethod ?? null,
          extractionCompletenessStatus: coverageLedger.extractionCompletenessStatus ?? null,
          extractionWarnings: coverageLedger.extractionWarnings ?? [],
          pdfVisibleFallbackUsed: coverageLedger.pdfVisibleFallbackUsed ?? false,
          blindingStrength: coverageLedger.blindingStrength ?? "strong",
          recognitionAssessment: coverageLedger.recognitionAssessment ?? null,
          recognitionSuspected: coverageLedger.recognitionSuspected ?? false,
          injectionSuspected: coverageLedger.injectionSuspected ?? false,
          comparisonCohort: coverageLedger.comparisonCohort ?? null,
          localCohort: coverageLedger.localCohort ?? null,
          broadField: coverageLedger.broadField ?? null,
          specialtyField: coverageLedger.specialtyField ?? null,
          subfields: coverageLedger.subfields ?? [],
          paperType: coverageLedger.paperType ?? null,
          centralClaim: coverageLedger.centralClaim ?? r.centralClaim ?? null,
          scientificReview: coverageLedger.scientificReview ?? null,
          contributionArchetype: coverageLedger.contributionArchetype ?? null,
          scopeProfile: coverageLedger.scopeProfile ?? null,
          inputStrengthScore: coverageLedger.inputStrengthScore ?? null,
          constructionStrengthScore: coverageLedger.constructionStrengthScore ?? null,
          outputStrengthScore: coverageLedger.outputStrengthScore ?? null,
          subscoreRationale: coverageLedger.subscoreRationale ?? null,
          inputConstructionOutputAssessment: coverageLedger.inputConstructionOutputAssessment ?? null,
          technicalAssessment: coverageLedger.technicalAssessment ?? null,
          failureAnalysis: coverageLedger.failureAnalysis ?? null,
          organicCohortProfile: coverageLedger.organicCohortProfile ?? null,
          intrinsicInputStrengthScore: coverageLedger.intrinsicInputStrengthScore ?? coverageLedger.inputStrengthScore ?? null,
          intrinsicConstructionStrengthScore: coverageLedger.intrinsicConstructionStrengthScore ?? coverageLedger.constructionStrengthScore ?? null,
          intrinsicOutputStrengthScore: coverageLedger.intrinsicOutputStrengthScore ?? coverageLedger.outputStrengthScore ?? null,
          intrinsicScore: coverageLedger.intrinsicScore ?? coverageLedger.finalScore ?? r.overallIntrinsicScore ?? r.score ?? null,
          rawDiagnosticScore: coverageLedger.rawDiagnosticScore ?? coverageLedger.rawFinalDiagnosticScore ?? null,
          computedScore: coverageLedger.computedScore ?? coverageLedger.intrinsicScore ?? coverageLedger.finalScore ?? r.overallIntrinsicScore ?? r.score ?? null,
          calibratedInputStrengthScore: comparatorCalibrationRan ? coverageLedger.calibratedInputStrengthScore ?? null : null,
          calibratedConstructionStrengthScore: comparatorCalibrationRan ? coverageLedger.calibratedConstructionStrengthScore ?? null : null,
          calibratedOutputStrengthScore: comparatorCalibrationRan ? coverageLedger.calibratedOutputStrengthScore ?? null : null,
          rawCalibratedScore: comparatorCalibrationRan ? coverageLedger.rawCalibratedScore ?? null : null,
          calibratedScore: comparatorCalibrationRan ? coverageLedger.calibratedScore ?? null : null,
          diagnosticChanges: comparatorCalibrationRan ? coverageLedger.diagnosticChanges ?? [] : [],
          calibrationRationale: comparatorCalibrationRan ? coverageLedger.calibrationRationale ?? "" : "",
          calibrationMode: coverageLedger.calibrationMode ?? "none",
          calibrationVersion: coverageLedger.calibrationVersion ?? null,
          calibrationAnchor: coverageLedger.calibrationAnchor === true,
          bridgeCohortId: coverageLedger.bridgeCohortId ?? null,
          pairwiseCalibration: coverageLedger.pairwiseCalibration ?? null,
          calibrationUnderReview: coverageLedger.calibrationUnderReview === true,
          calibrationHoldReason: coverageLedger.calibrationHoldReason ?? null,
          realizedYield: latestRealizedYieldByPaper.has(p.id)
            ? realizedYieldForResponse(latestRealizedYieldByPaper.get(p.id)!)
            : null,
          comparatorIds: coverageLedger.comparatorIds ?? [],
          targetOnly: coverageLedger.targetOnly ?? false,
          existingPapersModified: coverageLedger.existingPapersModified ?? false,
          modifiedPaperIds: coverageLedger.modifiedPaperIds ?? [],
          diagnosticScoreFormula: coverageLedger.diagnosticScoreFormula ?? null,
          publicMagnitudeLabel: coverageLedger.publicMagnitudeLabel ?? coverageLedger.bestClassification ?? r.bestClassification ?? null,
          diagnosticAssessmentConfidence: coverageLedger.diagnosticAssessmentConfidence ?? coverageLedger.scoreConfidence ?? null,
          adjudicationRationale: coverageLedger.adjudicationRationale ?? null,
          ...(isV17 ? {} : {
            scoreConfidence: coverageLedger.scoreConfidence ?? null,
            scoreCappingReason: coverageLedger.scoreCappingReason ?? "",
            scoreAdjustmentReason: coverageLedger.scoreAdjustmentReason ?? "",
          }),
          ...(isV17 ? {} : {
            bestClassification: coverageLedger.bestClassification ?? coverageLedger.publicMagnitudeLabel ?? r.bestClassification ?? null,
          }),
          promptMetadata: {
            modelName: coverageLedger.modelName ?? r.modelName,
            passModel: coverageLedger.passModel ?? null,
            adjudicatorModel: coverageLedger.adjudicatorModel ?? null,
            passCount: coverageLedger.passCount ?? null,
            validPassCount: coverageLedger.validPassCount ?? null,
            blindPassScores: coverageLedger.blindPassScores ?? [],
            blindPassSpread: coverageLedger.blindPassSpread ?? coverageLedger.passDisagreement ?? null,
            passDisagreement: coverageLedger.passDisagreement ?? coverageLedger.blindPassSpread ?? null,
            scoreStability: coverageLedger.scoreStability ?? null,
            adjudicatorStatus: coverageLedger.adjudicatorStatus ?? null,
            diagnosticBaselineScore: coverageLedger.diagnosticBaselineScore ?? null,
            diagnosticBaselineDelta: coverageLedger.diagnosticBaselineDelta ?? null,
            rawFinalDiagnosticScore: coverageLedger.rawFinalDiagnosticScore ?? null,
            finalInputStrengthScore: coverageLedger.finalInputStrengthScore ?? null,
            finalConstructionStrengthScore: coverageLedger.finalConstructionStrengthScore ?? null,
            finalOutputStrengthScore: coverageLedger.finalOutputStrengthScore ?? null,
            comparatorCalibrationStatus: coverageLedger.comparatorCalibrationStatus ?? null,
            calibrationMode: coverageLedger.calibrationMode ?? "none",
            calibrationVersion: coverageLedger.calibrationVersion ?? null,
            comparatorRunId: comparatorCalibrationRan ? coverageLedger.comparatorRunId ?? null : null,
            comparatorModel: comparatorCalibrationRan ? coverageLedger.comparatorModel ?? null : null,
            comparatorPromptHash: comparatorCalibrationRan ? coverageLedger.comparatorPromptHash ?? null : null,
            comparatorIds: comparatorCalibrationRan ? coverageLedger.comparatorIds ?? [] : [],
            comparatorRetrievalMethod: comparatorCalibrationRan ? coverageLedger.comparatorRetrievalMethod ?? null : null,
            comparatorContextIncluded: coverageLedger.comparatorContextIncluded ?? false,
            calibrationContextIncluded: coverageLedger.calibrationContextIncluded ?? false,
            ...(debugAudit ? {
              passAudit: Array.isArray(coverageLedger.passAudit)
                ? coverageLedger.passAudit.map(compactPassAuditEntry)
                : [],
              reviewInputSnapshot: compactReviewInputSnapshot(coverageLedger.reviewInputSnapshot, p.id),
            } : {}),
          },
          blindPassReviews,
        };
        return {
          paper: {
            id: p.id,
            title: p.title,
            paperAuthors: p.paperAuthors,
            dateMetadata: p.dateMetadata,
            field: p.field,
            subfields: p.subfields,
            createdAt: p.createdAt,
            pdfUrl: p.pdfUrl,
          },
          review: canonicalReview,
        };
      }
      const aggregateFromField = r ? parseJsonObject((r as any).aggregateMetaJson ?? null) : null;
      const aggregate = coverageLedger?.aggregate && typeof coverageLedger.aggregate === "object"
        ? coverageLedger.aggregate
        : aggregateFromField;
      const comparatorCalibration =
        coverageLedger?.comparatorCalibration ??
        aggregate?.comparatorCalibration ??
        null;
      const diagnosticComparatorCalibration =
        coverageLedger?.diagnosticComparatorCalibration ??
        aggregate?.diagnosticComparatorCalibration ??
        null;
      const adjudication =
        coverageLedger?.adjudication ??
        aggregate?.adjudication ??
        coverageLedger?.reviewPassComparison ??
        null;
      const comparatorProfile =
        coverageLedger?.comparatorProfile ??
        aggregate?.comparatorProfile ??
        null;
      const calibratedScore =
        typeof coverageLedger?.calibratedScore === "number"
          ? coverageLedger.calibratedScore
          : typeof diagnosticComparatorCalibration?.calibratedScore === "number"
            ? diagnosticComparatorCalibration.calibratedScore
            : null;
      const finalScoreBand =
        calibratedScore != null
          ? { low: calibratedScore, median: calibratedScore, high: calibratedScore }
          : coverageLedger?.comparatorCalibratedFinalScoreBand ??
            aggregate?.finalScoreBand ??
            null;
      const inputConstructionOutputLedger =
        coverageLedger?.inputConstructionOutputAssessment ??
        coverageLedger?.inputConstructionOutputLedger ??
        aggregate?.inputConstructionOutputAssessment ??
        aggregate?.inputConstructionOutputLedger ??
        null;
      const isV15Review =
        coverageLedger?.schemaVersion === "v15" ||
        String(coverageLedger?.promptVersion ?? "").startsWith("v15");
      const isCanonicalIcoReview =
        /^v(?:16|17)(?:\.|\b|-)/.test(String(coverageLedger?.schemaVersion ?? "")) ||
        /^v(?:16|17)(?:\.|\b|-)/.test(String(coverageLedger?.promptVersion ?? ""));
      const comparatorCalibrationStatus =
        coverageLedger?.comparatorCalibrationStatus ??
        diagnosticComparatorCalibration?.comparatorCalibrationStatus ??
        comparatorCalibration?.comparatorCalibrationStatus ??
        null;
      const calibrationAdjustment = Number(comparatorCalibration?.calibrationAdjustment ?? 0);
      const comparatorCalibrationApplied = Boolean(
        (calibratedScore != null &&
          (comparatorCalibrationStatus === "applied" || comparatorCalibrationStatus === "weak")) ||
          (comparatorCalibration &&
            Number.isFinite(calibrationAdjustment) &&
            Math.abs(calibrationAdjustment) > 0),
      );
      const visibleComparatorCalibration = comparatorCalibrationApplied ? comparatorCalibration : null;
      const centralOutputDependency =
        isV15Review || isCanonicalIcoReview
          ? undefined
          : coverageLedger?.centralOutputDependency ??
            aggregate?.centralOutputDependency ??
            comparatorProfile?.centralOutputDependency ??
            null;
      const outputValidityAssessment =
        isV15Review || isCanonicalIcoReview
          ? undefined
          : coverageLedger?.outputValidityAssessment ??
            aggregate?.outputValidityAssessment ??
            comparatorProfile?.outputValidityAssessment ??
            null;
      return {
        paper: {
          id: p.id,
          title: p.title,
          paperAuthors: p.paperAuthors,
          dateMetadata: p.dateMetadata,
          field: p.field,
          subfields: p.subfields,
          createdAt: p.createdAt,
          pdfUrl: p.pdfUrl,
        },
        review: r ? {
          promptVersion: coverageLedger?.promptVersion ?? REVIEW_PROMPT_VERSION,
          pipelineMode: coverageLedger?.pipelineMode ?? null,
          benchmarkSetCandidate: coverageLedger?.benchmarkSetCandidate ?? false,
          benchmarkSetVersion: coverageLedger?.benchmarkSetVersion ?? null,
          clusterVersion: coverageLedger?.clusterVersion ?? aggregate?.clusterVersion ?? null,
          canonicalClusterLabel: coverageLedger?.canonicalClusterLabel ?? coverageLedger?.benchmarkCluster?.canonicalClusterLabel ?? aggregate?.canonicalClusterLabel ?? null,
          extractionMethod: coverageLedger?.extractionMethod ?? null,
          pdfVisibleFallbackUsed: coverageLedger?.pdfVisibleFallbackUsed ?? false,
          blindingStrength: coverageLedger?.blindingStrength ?? "strong",
          blindPassScores: adjudication?.individualScores ?? aggregate?.individualScores ?? [],
          passDisagreement: adjudication?.passDisagreement ?? adjudication?.scoreRange ?? aggregate?.passDisagreement ?? null,
          scoreStability: adjudication?.scoreStability ?? aggregate?.scoreStability ?? coverageLedger?.scoreStability ?? null,
	          adjudicatorRating: aggregate?.adjudicatorRating ?? coverageLedger?.adjudicatorRating ?? coverageLedger?.blindIntrinsicScoreBand?.median ?? null,
		          comparatorCalibrationStatus,
		          calibrationMode: coverageLedger?.calibrationMode ?? diagnosticComparatorCalibration?.calibrationMode ?? (comparatorCalibrationApplied ? "target_only" : "none"),
		          calibrationVersion: coverageLedger?.calibrationVersion ?? diagnosticComparatorCalibration?.calibrationVersion ?? null,
		          targetOnly: coverageLedger?.targetOnly ?? diagnosticComparatorCalibration?.targetOnly ?? comparatorCalibrationApplied,
		          existingPapersModified: coverageLedger?.existingPapersModified ?? diagnosticComparatorCalibration?.existingPapersModified ?? false,
		          modifiedPaperIds: coverageLedger?.modifiedPaperIds ?? diagnosticComparatorCalibration?.modifiedPaperIds ?? [],
		          calibrationAdjustment: comparatorCalibrationApplied ? comparatorCalibration?.calibrationAdjustment ?? null : null,
		          finalCalibratedScore: finalScoreBand?.median ?? r.overallIntrinsicScore ?? r.score ?? null,
	          calibratedInputStrengthScore: comparatorCalibrationApplied ? coverageLedger?.calibratedInputStrengthScore ?? diagnosticComparatorCalibration?.calibratedInputStrengthScore ?? null : null,
	          calibratedConstructionStrengthScore: comparatorCalibrationApplied ? coverageLedger?.calibratedConstructionStrengthScore ?? diagnosticComparatorCalibration?.calibratedConstructionStrengthScore ?? null : null,
	          calibratedOutputStrengthScore: comparatorCalibrationApplied ? coverageLedger?.calibratedOutputStrengthScore ?? diagnosticComparatorCalibration?.calibratedOutputStrengthScore ?? null : null,
	          rawCalibratedScore: comparatorCalibrationApplied ? coverageLedger?.rawCalibratedScore ?? diagnosticComparatorCalibration?.rawCalibratedScore ?? null : null,
	          calibratedScore: comparatorCalibrationApplied ? calibratedScore : null,
	          diagnosticChanges: comparatorCalibrationApplied ? coverageLedger?.diagnosticChanges ?? diagnosticComparatorCalibration?.diagnosticChanges ?? [] : [],
	          calibrationRationale: comparatorCalibrationApplied ? coverageLedger?.calibrationRationale ?? diagnosticComparatorCalibration?.calibrationRationale ?? "" : "",
          localCohort: coverageLedger?.finalLocalCohort ?? coverageLedger?.localCohort ?? aggregate?.finalLocalCohort ?? comparatorProfile?.localCohort ?? null,
          intrinsicInputStrengthScore: coverageLedger?.intrinsicInputStrengthScore ?? coverageLedger?.inputStrengthScore ?? aggregate?.inputStrengthScore ?? null,
          intrinsicConstructionStrengthScore: coverageLedger?.intrinsicConstructionStrengthScore ?? coverageLedger?.constructionStrengthScore ?? aggregate?.constructionStrengthScore ?? null,
          intrinsicOutputStrengthScore: coverageLedger?.intrinsicOutputStrengthScore ?? coverageLedger?.outputStrengthScore ?? aggregate?.outputStrengthScore ?? null,
          intrinsicScore: coverageLedger?.intrinsicScore ?? coverageLedger?.computedScore ?? r.overallIntrinsicScore ?? r.score ?? null,
          inputStrengthScore: coverageLedger?.inputStrengthScore ?? aggregate?.inputStrengthScore ?? null,
          constructionStrengthScore: coverageLedger?.constructionStrengthScore ?? aggregate?.constructionStrengthScore ?? null,
          outputStrengthScore: coverageLedger?.outputStrengthScore ?? aggregate?.outputStrengthScore ?? null,
          outputReachScore: isV15Review || isCanonicalIcoReview ? undefined : coverageLedger?.outputReachScore ?? aggregate?.outputReachScore ?? null,
          generalizationBreadthScore: isV15Review || isCanonicalIcoReview ? undefined : coverageLedger?.generalizationBreadthScore ?? aggregate?.generalizationBreadthScore ?? null,
          subscoreRationale: coverageLedger?.subscoreRationale ?? aggregate?.subscoreRationale ?? null,
          adjudicatorStatus: coverageLedger?.adjudicatorStatus ?? adjudication?.adjudicatorStatus ?? aggregate?.adjudicatorStatus ?? null,
          diagnosticBaselineScore: coverageLedger?.diagnosticBaselineScore ?? adjudication?.diagnosticBaselineScore ?? aggregate?.diagnosticBaselineScore ?? null,
          diagnosticBaselineDelta: coverageLedger?.diagnosticBaselineDelta ?? adjudication?.diagnosticBaselineDelta ?? aggregate?.diagnosticBaselineDelta ?? null,
          scoreAdjustmentReason: coverageLedger?.scoreAdjustmentReason ?? adjudication?.scoreAdjustmentReason ?? aggregate?.scoreAdjustmentReason ?? null,
          scoringAnomaly: coverageLedger?.scoringAnomaly ?? adjudication?.scoringAnomaly ?? aggregate?.scoringAnomaly ?? null,
          failedClaimsExcludedFromDiagnostics: coverageLedger?.failureAnalysis?.failedClaimsExcludedFromDiagnostics ?? coverageLedger?.failureAnalysis?.failedClaimsExcludedFromScore ?? coverageLedger?.failedClaimsExcludedFromDiagnostics ?? coverageLedger?.failedClaimsExcludedFromScore ?? adjudication?.failedClaimsExcludedFromDiagnostics ?? adjudication?.failedClaimsExcludedFromScore ?? aggregate?.failedClaimsExcludedFromDiagnostics ?? aggregate?.failedClaimsExcludedFromScore ?? [],
          failedConstructionsExcludedFromDiagnostics: coverageLedger?.failureAnalysis?.failedConstructionsExcludedFromDiagnostics ?? coverageLedger?.failureAnalysis?.failedConstructionsExcludedFromScore ?? coverageLedger?.failedConstructionsExcludedFromDiagnostics ?? coverageLedger?.failedConstructionsExcludedFromScore ?? adjudication?.failedConstructionsExcludedFromDiagnostics ?? adjudication?.failedConstructionsExcludedFromScore ?? aggregate?.failedConstructionsExcludedFromDiagnostics ?? aggregate?.failedConstructionsExcludedFromScore ?? [],
          failedOutputsExcludedFromDiagnostics: coverageLedger?.failureAnalysis?.failedOutputsExcludedFromDiagnostics ?? coverageLedger?.failureAnalysis?.failedOutputsExcludedFromScore ?? coverageLedger?.failedOutputsExcludedFromDiagnostics ?? coverageLedger?.failedOutputsExcludedFromScore ?? adjudication?.failedOutputsExcludedFromDiagnostics ?? adjudication?.failedOutputsExcludedFromScore ?? aggregate?.failedOutputsExcludedFromDiagnostics ?? aggregate?.failedOutputsExcludedFromScore ?? [],
          survivingCorrectContributions: coverageLedger?.failureAnalysis?.survivingCorrectContributions ?? coverageLedger?.survivingCorrectContributions ?? adjudication?.survivingCorrectContributions ?? aggregate?.survivingCorrectContributions ?? [],
          scoreBasisAfterExcludingFailures: coverageLedger?.failureAnalysis?.scoreBasisAfterExcludingFailures ?? coverageLedger?.scoreBasisAfterExcludingFailures ?? adjudication?.scoreBasisAfterExcludingFailures ?? aggregate?.scoreBasisAfterExcludingFailures ?? null,
          overallCorrectnessSummary: coverageLedger?.failureAnalysis?.overallCorrectnessSummary ?? coverageLedger?.overallCorrectnessSummary ?? adjudication?.overallCorrectnessSummary ?? aggregate?.overallCorrectnessSummary ?? null,
          scoreCappingReason: coverageLedger?.scoreCappingReason ?? aggregate?.scoreCappingReason ?? comparatorCalibration?.scoreCappingReason ?? null,
          validationWarnings: {
            subscoreConsistencyWarning: coverageLedger?.subscoreConsistencyWarning ?? aggregate?.subscoreConsistencyWarning ?? adjudication?.subscoreConsistencyWarning ?? null,
            subscoreSaturationWarning: coverageLedger?.subscoreSaturationWarning ?? aggregate?.subscoreSaturationWarning ?? adjudication?.subscoreSaturationWarning ?? false,
          },
          ...(includeSystemPrompt ? { systemPrompt: r.systemPrompt } : {}),
          modelName: r.modelName,
          overallIntrinsicScore: r.overallIntrinsicScore,
          intrinsicScientificMeritScore: isV15Review || isCanonicalIcoReview ? undefined : r.intrinsicScientificMeritScore,
          explanatoryTargetBreadthScore: isV15Review || isCanonicalIcoReview ? undefined : r.explanatoryTargetBreadthScore,
          theorySpaceBreadthScore: isV15Review || isCanonicalIcoReview ? undefined : r.theorySpaceBreadthScore,
          breadthOfImpactScore: isV15Review || isCanonicalIcoReview ? undefined : r.breadthOfImpactScore,
          bestClassification: r.bestClassification,
          centralClaim: r.centralClaim,
          scientificReview: coverageLedger?.scientificReview ?? aggregate?.scientificReview ?? coverageLedger?.finalIntrinsicReview?.scientificReview ?? null,
          summary: isCanonicalIcoReview ? undefined : r.summary,
          correctness: r.correctness,
          novelty: r.novelty,
          noveltyConfidence: r.noveltyConfidence,
          internalTechnicalTraction: r.internalTechnicalTraction,
          economy: r.economy,
          scopeDepth: r.scopeDepth,
          unifyingPower: r.unifyingPower,
          explanatoryTargetBreadth: r.explanatoryTargetBreadth,
          theorySpaceBreadth: r.theorySpaceBreadth,
          establishedResults: r.establishedResults,
          interpretiveClaims: r.interpretiveClaims,
          speculativeClaims: r.speculativeClaims,
          strongestCaseForImportance: r.strongestCaseForImportance,
          strongestObjection: r.strongestObjection,
          assessmentSensitivity: coverageLedger?.assessmentSensitivity ?? aggregate?.assessmentSensitivity ?? null,
          legacyDecisiveCheck: isV15Review || isCanonicalIcoReview ? undefined : r.decisiveCheck,
          finalJudgment: isCanonicalIcoReview ? undefined : r.finalJudgment,
          relatedWork: r.relatedWork,
          coverageLedger: isCanonicalIcoReview ? undefined : coverageLedger,
          contributionArchetype: coverageLedger?.contributionArchetype ?? aggregate?.contributionArchetype ?? null,
          inputConstructionOutputLedger,
          inputConstructionOutputAssessment: inputConstructionOutputLedger,
          centralOutputDependency,
          outputValidityAssessment,
          nearestComparators: comparatorCalibrationApplied ? coverageLedger?.nearestComparators ?? aggregate?.nearestComparators ?? [] : [],
          blindIntrinsicScoreBand: coverageLedger?.blindIntrinsicScoreBand ?? coverageLedger?.aggregate?.blindIntrinsicScoreBand ?? null,
          comparatorCalibration: visibleComparatorCalibration,
          explanatoryDeltaAssessment: comparatorCalibrationApplied
            ? coverageLedger?.explanatoryDeltaAssessment ?? comparatorCalibration?.explanatoryDeltaAssessment ?? null
            : null,
          comparatorsNeedingRecalibration: comparatorCalibrationApplied ? coverageLedger?.comparatorsNeedingRecalibration ?? comparatorCalibration?.comparatorsNeedingRecalibration ?? [] : [],
          comparatorCalibratedFinalScoreBand: comparatorCalibrationApplied ? finalScoreBand : null,
          comparatorProfile: comparatorCalibrationApplied ? comparatorProfile : null,
          externalComparatorSuggestions: coverageLedger?.externalComparatorSuggestions ?? aggregate?.externalComparatorSuggestions ?? [],
          publicComparatorSummary: coverageLedger?.publicComparatorSummary ?? aggregate?.publicComparatorSummary ?? null,
          adminComparatorNotes: coverageLedger?.adminComparatorNotes ?? aggregate?.adminComparatorNotes ?? null,
          reviewPassComparison: adjudication,
          finalIntrinsicReview: isCanonicalIcoReview ? undefined : coverageLedger?.finalIntrinsicReview ?? null,
          adjudication,
          inputGrounding: coverageLedger?.inputGrounding ?? aggregate?.inputGroundingAssessment ?? null,
          inputFundamentality: coverageLedger?.inputFundamentality ?? aggregate?.inputFundamentalityAssessment ?? null,
          frameworkIndependence: coverageLedger?.frameworkIndependence ?? aggregate?.frameworkIndependenceAssessment ?? null,
          hardToVaryAssessment: coverageLedger?.hardToVaryAssessment ?? aggregate?.hardToVaryAssessment ?? null,
          manuscriptOriginalContribution: coverageLedger?.manuscriptOriginalContribution ?? aggregate?.originalContributionAssessment ?? null,
          whatWouldRaiseScore: coverageLedger?.whatWouldRaiseScore ?? aggregate?.whatWouldRaiseScore ?? null,
          whatWouldLowerScore: coverageLedger?.whatWouldLowerScore ?? aggregate?.whatWouldLowerScore ?? null,
          createdAt: r.createdAt,
        } : null,
      };
    });

    res.json({
      exportedAt: new Date().toISOString(),
      promptVersion: REVIEW_PROMPT_VERSION,
      promptName: REVIEW_PROMPT_NAME,
      promptHash: REVIEW_PROMPT_HASH,
      ...(debugAudit ? { debugAudit: true, apiRuntime: reviewRuntimeInfo() } : {}),
      ...(includeSystemPrompt ? { systemPrompt: LATEST_REVIEW_SYSTEM_INSTRUCTION } : {}),
      ...(includeFailedAttempts && batchAttemptExport ? {
        currentBatch: batchAttemptExport.currentBatch,
        historicalFailedAttempts: batchAttemptExport.historicalFailedAttempts,
      } : {}),
      count: exported.length,
      papers: exported,
    });
  } catch (err: any) {
    logger.error({ err }, "Error exporting papers");
    res.status(500).json({ error: err.message });
  }
});

// GET /api/papers — list all papers
router.get("/papers", async (req, res) => {
  try {
    // Keep the public feed lightweight. Full review ledgers can be very large
    // because they include audit/input snapshots; loading them here was making
    // the homepage slow or unavailable as the benchmark grew.
    const paperRecords = await db.select().from(papersTable).orderBy(desc(papersTable.createdAt)).limit(PAPER_FEED_LIMIT);
    const reviews = await db.select({
      paperId: reviewsTable.paperId,
      summary: reviewsTable.summary,
      centralClaim: reviewsTable.centralClaim,
      finalJudgment: reviewsTable.finalJudgment,
      promptVersion: sql<string | null>`substring(${reviewsTable.coverageLedgerJson} from '"promptVersion"[[:space:]]*:[[:space:]]*"([^"]+)"')`,
    }).from(reviewsTable);
    const reviewMap = new Map(reviews.map(r => [r.paperId, r]));
    const papers = paperRecords.map((paper) => normalizePaperDisplayMetadata(paper, reviewMetadataNormalizationText(reviewMap.get(paper.id))));
    const seenPromptScopedPapers = new Set<string>();
    const papersWithSummary = papers.map(p => {
      const review = reviewMap.get(p.id);
      return {
        ...p,
        promptVersion: review?.promptVersion || null,
        reviewSummary: review?.summary || review?.finalJudgment || null,
        reviewCentralClaim: review?.centralClaim || null,
        reviewFinalJudgment: review?.finalJudgment || review?.summary || null,
      };
    }).filter((paper) => {
      const key = promptScopedFeedDuplicateKey(paper, paper.promptVersion);
      if (seenPromptScopedPapers.has(key)) return false;
      seenPromptScopedPapers.add(key);
      return true;
    });
    res.json({ papers: papersWithSummary });
  } catch (err: any) {
    logger.error({ err }, "Error listing papers");
    res.status(500).json({ error: err.message });
  }
});

router.get("/admin/papers/:id/review-input/:kind", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const kind = req.params.kind;
    if (kind !== "raw" && kind !== "blinded") {
      res.status(400).json({ error: "kind must be raw or blinded" });
      return;
    }
    const [review] = await db.select().from(reviewsTable).where(eq(reviewsTable.paperId, req.params.id));
    if (!review) { res.status(404).json({ error: "Review not found" }); return; }
    const ledger = parseJsonObject(review.coverageLedgerJson);
    const snapshot = ledger?.reviewInputSnapshot && typeof ledger.reviewInputSnapshot === "object"
      ? ledger.reviewInputSnapshot as Record<string, unknown>
      : null;
    const text = kind === "raw"
      ? snapshot?.rawExtractedText
      : snapshot?.blindedReviewText;
    if (typeof text !== "string") {
      res.status(404).json({ error: "Review input snapshot not stored for this review" });
      return;
    }
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send(text);
  } catch (err: any) {
    logger.error({ err }, "Error downloading review input snapshot");
    res.status(500).json({ error: err.message });
  }
});

router.get("/admin/reviews/extraction-qa-scan", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const papers = await db.select().from(papersTable).orderBy(desc(papersTable.createdAt));
    const reviews = await db.select().from(reviewsTable);
    const paperById = new Map(papers.map((paper) => [paper.id, paper]));
    const flagged = reviews.flatMap((review) => {
      const paper = paperById.get(review.paperId);
      const ledger = parseJsonObject(review.coverageLedgerJson);
      const haystack = {
        scientificReview: ledger?.scientificReview,
        paperType: ledger?.paperType,
        technicalAssessment: ledger?.technicalAssessment,
        failureAnalysis: ledger?.failureAnalysis,
        blindPassReviews: ledger?.blindPassReviews,
        thinkingText: review.thinkingText,
      };
      const indicators = truncationIndicatorMatches(haystack);
      if (indicators.length === 0) return [];
      return [{
        paperId: review.paperId,
        reviewId: review.id,
        title: paper?.title ?? null,
        indicators,
        shouldRerun: true,
        extractionCompletenessStatus: ledger?.extractionCompletenessStatus ?? null,
        extractionWarnings: ledger?.extractionWarnings ?? [],
      }];
    });
    res.json({ scanned: reviews.length, flagged });
  } catch (err: any) {
    logger.error({ err }, "Error scanning extraction QA");
    res.status(500).json({ error: err.message });
  }
});

// GET /api/papers/:id — get paper with review
router.get("/papers/:id", async (req, res) => {
  try {
    const [paper] = await db.select().from(papersTable).where(eq(papersTable.id, req.params.id));
    if (!paper) { res.status(404).json({ error: "Paper not found" }); return; }

    const [review] = await db.select().from(reviewsTable).where(eq(reviewsTable.paperId, paper.id));
    res.json({ paper: normalizePaperDisplayMetadata(paper, reviewMetadataNormalizationText(review)), review: review || null });
  } catch (err: any) {
    logger.error({ err }, "Error getting paper");
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/papers/:id — owner or admin can correct extracted paper metadata
router.patch("/papers/:id", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const [paper] = await db.select().from(papersTable).where(eq(papersTable.id, req.params.id));
    if (!paper) { res.status(404).json({ error: "Paper not found" }); return; }

    const isAdmin = ADMIN_EMAIL && req.user.email === ADMIN_EMAIL;
    if (!isAdmin && paper.authorId !== req.user.id) { res.status(403).json({ error: "Forbidden" }); return; }

    const title = typeof req.body.title === "string" ? req.body.title.trim() : "";
    const paperAuthors = typeof req.body.paperAuthors === "string" ? req.body.paperAuthors.trim() : "";

    if (!title) { res.status(400).json({ error: "Title is required" }); return; }
    if (title.length > 500) { res.status(400).json({ error: "Title is too long" }); return; }
    if (paperAuthors.length > 1000) { res.status(400).json({ error: "Authors field is too long" }); return; }

    const existingDateMetadata =
      paper.dateMetadata && typeof paper.dateMetadata === "object"
        ? paper.dateMetadata
        : null;

    const [updated] = await db.update(papersTable)
      .set({
        title,
        paperAuthors: paperAuthors || null,
        dateMetadata: existingDateMetadata
          ? {
              ...existingDateMetadata,
              displayedTitle: title,
              displayedAuthors: splitAuthorNamesForMetadata(paperAuthors),
            }
          : null,
      })
      .where(eq(papersTable.id, req.params.id))
      .returning();

    res.json({ paper: updated });
  } catch (err: any) {
    logger.error({ err }, "Error updating paper metadata");
    res.status(500).json({ error: err.message });
  }
});


class SubmissionHttpError extends Error {
  statusCode: number;
  payload: Record<string, unknown>;
  attempt?: ReviewAttemptRecord | null;
  reviewStatus?: string;

  constructor(message: string, statusCode: number, payload: Record<string, unknown> = {}) {
    super(message);
    this.name = "SubmissionHttpError";
    this.statusCode = statusCode;
    this.payload = payload;
  }
}

function submissionHttpError(message: string, statusCode: number, payload: Record<string, unknown> = {}) {
  return new SubmissionHttpError(message, statusCode, payload);
}

type SubmissionResult = {
  paper: typeof papersTable.$inferSelect;
  review: typeof reviewsTable.$inferSelect | null;
  attempt: ReviewAttemptRecord;
  batchRunId: string | null;
  queueItemId: string | null;
};

async function processPaperSubmission(user: any, source: any): Promise<SubmissionResult> {
  let submissionKey: string | null = null;
  let resolveSubmission: ((value: { paper: typeof papersTable.$inferSelect; review: typeof reviewsTable.$inferSelect | null }) => void) | undefined;
  let rejectSubmission: ((reason?: unknown) => void) | undefined;
  let attemptContext: ReviewAttemptContext | null = null;
  try {
if (!source?.type || !source?.data) { throw submissionHttpError("source.type and source.data are required", 400); }
const isAdmin = Boolean(ADMIN_EMAIL && user.email === ADMIN_EMAIL);
const requestedReviewMode: ReviewPipelineMode = normalizeReviewPipelineMode(source.reviewMode);
const reviewMode: ReviewPipelineMode = isAdmin ? requestedReviewMode : "normal-review";
const selectedModel: ReviewModel = "gemini";
const metadataHints: { fileName?: string; pdfTitle?: string; pdfAuthor?: string; pdfBase64?: string; mimeType?: string } = {
  fileName: typeof source.fileName === "string" ? source.fileName.trim() : undefined,
};
const batchRunId = optionalSourceString(source, "batchRunId");
const queueItemId = optionalSourceString(source, "queueItemId");
const frontendSiteVersion = optionalSourceString(source, "frontendSiteVersion");
const clientRequestStartedAt = optionalSourceString(source, "clientRequestStartedAt");
const durableJob = source.durableJob === true;
const requestId = optionalSourceString(source, "requestId") ?? createHash("sha256")
  .update(`${user.id}\0${batchRunId ?? ""}\0${queueItemId ?? ""}\0${Date.now()}\0${Math.random()}`)
  .digest("hex")
  .slice(0, 16);
attemptContext = {
  attemptId: attemptIdForSubmission(user.id, source, metadataHints.fileName ?? null),
  batchRunId,
  queueItemId,
  frontendSiteVersion,
  createdAt: new Date().toISOString(),
  userId: user.id,
  paperId: null,
  fileName: metadataHints.fileName ?? null,
  reviewRunId: null,
  stageName: "request_received",
  stageType: "request",
  model: null,
  promptVersion: REVIEW_PROMPT_VERSION,
  promptHash: REVIEW_PROMPT_HASH,
  requestId,
  retryCount: 0,
  extractionCompletenessStatus: null,
  extractionWarnings: [],
  extractionRetryAttempted: false,
  pdfFallbackAttempted: false,
  pdfVisibleFallbackUsed: false,
  fallbackSucceeded: false,
  reviewStatus: null,
  scientificScoringAttempted: false,
  debugPayload: {
    ...debugPayloadObject(source.jobDebugPayload),
    sourceType: source.type,
    reviewMode,
    selectedModel,
    durableJob,
    requestReceivedAt: new Date().toISOString(),
    clientRequestStartedAt,
    frontendPageLoadedAt: optionalSourceString(source, "frontendPageLoadedAt"),
    apiRuntimeVersion: source.apiRuntimeVersion ?? null,
    apiRuntimeAtBatchStart: source.apiRuntimeAtBatchStart ?? null,
    apiRuntimeProcessStartedAt: optionalSourceString(source, "apiRuntimeProcessStartedAt"),
    apiRuntimeRestartDetectedAt: optionalSourceString(source, "apiRuntimeRestartDetectedAt"),
    apiRuntimePreviousProcessStartedAt: optionalSourceString(source, "apiRuntimePreviousProcessStartedAt"),
    apiRuntimeCurrentProcessStartedAt: optionalSourceString(source, "apiRuntimeCurrentProcessStartedAt"),
    apiRuntimeAtRequestStart: reviewRuntimeInfo(),
  },
};
await updateReviewAttemptProgress(attemptContext, {
  reviewStatus: "request_received",
  retryable: true,
  debugPayload: { requestPhase: "received" },
});
const sourceHash = sourceHashFor(source);
const expectedModelName = expectedReviewModelName(reviewMode);
const reuseExistingReview = source.reuseExistingReview === true || source.reuseExisting === true;
const forceFreshReview = source.forceFreshReview === true || source.forceFresh === true;
const allowExistingReviewReuse =
  !forceFreshReview &&
  (reuseExistingReview || source.reuseExistingReview !== false);
submissionKey = !durableJob && allowExistingReviewReuse && sourceHash ? `${user.id}:${expectedModelName}:${sourceHash}` : null;
if (submissionKey && recentSubmissions.has(submissionKey)) {
  const payload = await recentSubmissions.get(submissionKey);
  if (!payload?.paper) {
    throw submissionHttpError("In-flight review reuse did not return a completed paper.", 503);
  }
  if (payload?.paper) {
    attemptContext.paperId = payload.paper.id;
  }
  await updateReviewAttemptProgress(attemptContext, {
    stageName: "save_review",
    stageType: "storage",
    reviewStatus: "completed_reused_inflight",
    failureStatus: "completed",
    retryable: false,
    debugPayload: completedAttemptDebugPayload(attemptContext, {
      cacheUsed: true,
      previousReviewUsed: true,
      reuseReason: "inFlight",
      savedPaperId: payload.paper.id,
      savedReviewId: payload.review?.id ?? null,
    }),
  });
  const attempt = reviewAttemptRecordFromContext(attemptContext, {
    stageName: "save_review",
    stageType: "storage",
    reviewStatus: "completed_reused_inflight",
    failureStatus: "completed",
    retryable: false,
    debugPayload: completedAttemptDebugPayload(attemptContext, {
      cacheUsed: true,
      previousReviewUsed: true,
      reuseReason: "inFlight",
      savedPaperId: payload.paper.id,
      savedReviewId: payload.review?.id ?? null,
    }),
  });
  return { ...payload, attempt, batchRunId, queueItemId };
}
if (submissionKey) {
  recentSubmissions.set(submissionKey, new Promise((resolve, reject) => {
    resolveSubmission = resolve;
    rejectSubmission = reject;
  }));
}

const existingBySource = allowExistingReviewReuse && sourceHash
  ? await existingSourceSubmission(
      user.id,
      sourceHash,
      REVIEW_PROMPT_HASH,
      REVIEW_PROMPT_VERSION,
    )
  : null;
if (existingBySource?.review) {
  const existingDisplayPaper = normalizePaperDisplayMetadata(
    existingBySource.paper,
    reviewMetadataNormalizationText(existingBySource.review),
  );
  logger.info({
    paperId: existingDisplayPaper.id,
    title: existingDisplayPaper.title,
    paperAuthors: existingDisplayPaper.paperAuthors,
    existingPromptVersion: existingBySource.existingPromptVersion,
    existingPromptHash: existingBySource.existingPromptHash,
    duplicatePromptMatchesActivePrompt: existingBySource.promptMatches,
    promptVersion: REVIEW_PROMPT_VERSION,
    promptHash: REVIEW_PROMPT_HASH,
    cacheUsed: true,
    previousReviewUsed: true,
    duplicateReason: "sourceHash",
    comparatorContextIncluded: false,
    adjudicatorContextIncluded: false,
  }, "Detected existing review by source hash before extraction");
  if (resolveSubmission) resolveSubmission({ ...existingBySource, paper: existingDisplayPaper });
  attemptContext.paperId = existingDisplayPaper.id;
  const attempt = await updateReviewAttemptProgress(attemptContext, {
    stageName: "save_review",
    stageType: "storage",
    reviewStatus: "duplicate_existing",
    failureStatus: "completed",
    retryable: false,
    errorMessage: `This exact PDF/text source is already in the system as "${existingDisplayPaper.title}" under the active prompt.`,
    debugPayload: completedAttemptDebugPayload(attemptContext, {
      cacheUsed: true,
      previousReviewUsed: true,
      reuseReason: "exactSourcePreExtraction",
      duplicateReason: "sourceHash",
      duplicatePromptMatchesActivePrompt: existingBySource.promptMatches,
      duplicateExistingPromptVersion: existingBySource.existingPromptVersion,
      duplicateExistingPromptHash: existingBySource.existingPromptHash,
      activePromptVersion: REVIEW_PROMPT_VERSION,
      activePromptHash: REVIEW_PROMPT_HASH,
      duplicateExistingPaperId: existingDisplayPaper.id,
      duplicateExistingReviewId: existingBySource.review.id,
      duplicateExistingTitle: existingDisplayPaper.title,
      duplicateExistingAuthors: existingDisplayPaper.paperAuthors,
      duplicateExistingCreatedAt: existingDisplayPaper.createdAt,
      savedPaperId: existingDisplayPaper.id,
      savedReviewId: existingBySource.review.id,
    }),
  });
  if (submissionKey) {
    const key = submissionKey;
    setTimeout(() => recentSubmissions.delete(key), 30 * 60 * 1000).unref?.();
  }
  return { paper: existingDisplayPaper, review: existingBySource.review, attempt, batchRunId, queueItemId };
}

let paperContent: string;
let metadataExtractionText: string;
let extractionCompleteness: ExtractionCompletenessReport | null = null;
let submittedPdfUrl: string | null = source.pdfUrl?.trim() || null;
const submittedDisplayPdf: boolean = !!(source.displayPdf && submittedPdfUrl);
const pdfVisibleLastResortRequested =
  source.pdfVisibleFallback === true && (source.type === "pdf" || source.type === "url");
if (source.pdfVisibleFallback === true && !isAdmin) {
  throw submissionHttpError("PDF-visible last-resort review is available only to admins.", 403);
}

if (source.type === "pdf") {
  const buffer = Buffer.from(source.data, "base64");
  // DocInfo/XMP metadata is stripped before any model-visible use of the
  // stored PDF (gemini PDF-fallback extraction, PDF-visible last resort,
  // title-page metadata fallback). pdf-parse below still reads the original
  // buffer so embedded Title/Author hints stay available to the unblinded
  // metadata step.
  metadataHints.pdfBase64 = (await stripPdfIdentifyingMetadataSafe(buffer)).toString("base64");
  metadataHints.mimeType = "application/pdf";
  if (pdfVisibleLastResortRequested) {
    setAttemptStage(attemptContext, "pdf_visible_last_resort", "extraction", null);
    attemptContext.pdfFallbackAttempted = false;
    attemptContext.pdfVisibleFallbackUsed = true;
    attemptContext.fallbackSucceeded = true;
    paperContent = buildPdfFallbackText(metadataHints);
    metadataExtractionText = paperContent;
    extractionCompleteness = {
      ...pdfVisibleLastResortExtractionReport(paperContent),
      injectionSuspected: await pdfTextLayerInjectionSuspected(buffer),
    };
    updateAttemptExtractionContext(attemptContext, extractionCompleteness);
    updateAttemptInputDebugPayload(attemptContext, paperContent, extractionCompleteness, {
      pdfVisibleFallbackRequested: true,
      pdfVisibleTextExtractionBypassed: true,
      pdfByteCount: buffer.length,
      injectionSuspectedInPdfTextLayer: Boolean(extractionCompleteness.injectionSuspected),
    });
    await updateReviewAttemptProgress(attemptContext, { reviewStatus: "pdf_visible_last_resort" });
  } else {
    setAttemptStage(attemptContext, "pdf_text_extraction", "extraction", null);
    await updateReviewAttemptProgress(attemptContext, { reviewStatus: "pdf_text_extraction" });
    const pdfParse = (await import("pdf-parse")).default;
    const parsed = await pdfParse(buffer);
    metadataHints.pdfTitle = typeof parsed.info?.Title === "string" ? parsed.info.Title : undefined;
    metadataHints.pdfAuthor = typeof parsed.info?.Author === "string" ? parsed.info.Author : undefined;
    paperContent = cleanExtractedManuscriptText(parsed.text);
    metadataExtractionText = paperContent;
    extractionCompleteness = assessExtractionCompleteness(paperContent, {
      estimatedPdfPageCount: typeof parsed.numpages === "number" ? parsed.numpages : null,
      extractedPageCount: typeof parsed.numpages === "number" ? parsed.numpages : null,
    });
    updateAttemptExtractionContext(attemptContext, extractionCompleteness);
    updateAttemptInputDebugPayload(attemptContext, paperContent, extractionCompleteness);
    await updateReviewAttemptProgress(attemptContext, { reviewStatus: extractionCompleteness.extractionCompletenessStatus });
    const skipAutomaticFallback = shouldSkipAutomaticPdfTextFallback(extractionCompleteness, paperContent);
    if (skipAutomaticFallback) {
      extractionCompleteness = {
        ...extractionCompleteness,
        extractionWarnings: [
          ...extractionCompleteness.extractionWarnings,
          skippedPdfTextFallbackWarning(extractionCompleteness),
        ],
      };
      updateAttemptExtractionContext(attemptContext, extractionCompleteness);
      updateAttemptInputDebugPayload(attemptContext, paperContent, extractionCompleteness, {
        pdfFallbackSkipped: true,
        pdfFallbackSkipReason: "text_layer_empty",
      });
    }
    attemptContext.pdfFallbackAttempted =
      !skipAutomaticFallback && isExtractionBlockingStatus(extractionCompleteness.extractionCompletenessStatus);
    if (attemptContext.pdfFallbackAttempted) setAttemptStage(attemptContext, "pdf_fallback_extraction", "helper", GEMINI_METADATA_MODEL);
    if (attemptContext.pdfFallbackAttempted) await updateReviewAttemptProgress(attemptContext, { reviewStatus: "pdf_fallback_extraction" });
    if (attemptContext.pdfFallbackAttempted) {
      const repaired = await repairPdfExtractionIfNeeded({ report: extractionCompleteness, text: paperContent, metadataHints });
      paperContent = repaired.text;
      metadataExtractionText = paperContent;
      extractionCompleteness = repaired.report;
      attemptContext.fallbackSucceeded = repaired.fallbackUsed && isExtractionReviewableStatus(extractionCompleteness.extractionCompletenessStatus);
    } else {
      attemptContext.fallbackSucceeded = false;
    }
    attemptContext.pdfVisibleFallbackUsed = false;
    updateAttemptExtractionContext(attemptContext, extractionCompleteness);
    updateAttemptInputDebugPayload(attemptContext, paperContent, extractionCompleteness, { pdfFallbackAttempted: attemptContext.pdfFallbackAttempted, fallbackSucceeded: attemptContext.fallbackSucceeded });
    await updateReviewAttemptProgress(attemptContext, { reviewStatus: extractionCompleteness.extractionCompletenessStatus });
  }
} else if (source.type === "url") {
  const url = source.data?.trim();
  if (!url) { throw submissionHttpError("A valid URL is required.", 400); }
  try { new URL(url); } catch { throw submissionHttpError("Invalid URL.", 400); }
  const fetchResp = await fetch(url);
  if (!fetchResp.ok) {
    setAttemptStage(attemptContext, "pdf_text_extraction", "extraction", null);
    await updateReviewAttemptProgress(attemptContext, {
      reviewStatus: "failed_url_fetch",
      errorMessage: `Could not fetch PDF from URL (${fetchResp.status}).`,
      rawErrorCode: fetchResp.status,
      failureStatus: "retryable",
      retryable: true,
    });
    throw submissionHttpError(`Could not fetch PDF from URL (${fetchResp.status}). Make sure it is a direct link to a publicly accessible PDF.`, 400);
  }
  const arrayBuf = await fetchResp.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);
  metadataHints.fileName ||= url.split("/").pop()?.split("?")[0];
  metadataHints.pdfBase64 = (await stripPdfIdentifyingMetadataSafe(buffer)).toString("base64");
  metadataHints.mimeType = "application/pdf";
  if (pdfVisibleLastResortRequested) {
    setAttemptStage(attemptContext, "pdf_visible_last_resort", "extraction", null);
    attemptContext.pdfFallbackAttempted = false;
    attemptContext.pdfVisibleFallbackUsed = true;
    attemptContext.fallbackSucceeded = true;
    paperContent = buildPdfFallbackText(metadataHints);
    metadataExtractionText = paperContent;
    extractionCompleteness = {
      ...pdfVisibleLastResortExtractionReport(paperContent),
      injectionSuspected: await pdfTextLayerInjectionSuspected(buffer),
    };
    updateAttemptExtractionContext(attemptContext, extractionCompleteness);
    updateAttemptInputDebugPayload(attemptContext, paperContent, extractionCompleteness, {
      pdfVisibleFallbackRequested: true,
      pdfVisibleTextExtractionBypassed: true,
      pdfByteCount: buffer.length,
      injectionSuspectedInPdfTextLayer: Boolean(extractionCompleteness.injectionSuspected),
    });
    await updateReviewAttemptProgress(attemptContext, { reviewStatus: "pdf_visible_last_resort" });
  } else {
    const pdfParse = (await import("pdf-parse")).default;
    const parsed = await pdfParse(buffer);
    metadataHints.pdfTitle = typeof parsed.info?.Title === "string" ? parsed.info.Title : undefined;
    metadataHints.pdfAuthor = typeof parsed.info?.Author === "string" ? parsed.info.Author : undefined;
    paperContent = cleanExtractedManuscriptText(parsed.text);
    metadataExtractionText = paperContent;
    extractionCompleteness = assessExtractionCompleteness(paperContent, {
      estimatedPdfPageCount: typeof parsed.numpages === "number" ? parsed.numpages : null,
      extractedPageCount: typeof parsed.numpages === "number" ? parsed.numpages : null,
    });
    updateAttemptExtractionContext(attemptContext, extractionCompleteness);
    updateAttemptInputDebugPayload(attemptContext, paperContent, extractionCompleteness);
    await updateReviewAttemptProgress(attemptContext, { reviewStatus: extractionCompleteness.extractionCompletenessStatus });
    const skipAutomaticFallback = shouldSkipAutomaticPdfTextFallback(extractionCompleteness, paperContent);
    if (skipAutomaticFallback) {
      extractionCompleteness = {
        ...extractionCompleteness,
        extractionWarnings: [
          ...extractionCompleteness.extractionWarnings,
          skippedPdfTextFallbackWarning(extractionCompleteness),
        ],
      };
      updateAttemptExtractionContext(attemptContext, extractionCompleteness);
      updateAttemptInputDebugPayload(attemptContext, paperContent, extractionCompleteness, {
        pdfFallbackSkipped: true,
        pdfFallbackSkipReason: "text_layer_empty",
      });
    }
    attemptContext.pdfFallbackAttempted =
      !skipAutomaticFallback && isExtractionBlockingStatus(extractionCompleteness.extractionCompletenessStatus);
    if (attemptContext.pdfFallbackAttempted) setAttemptStage(attemptContext, "pdf_fallback_extraction", "helper", GEMINI_METADATA_MODEL);
    if (attemptContext.pdfFallbackAttempted) await updateReviewAttemptProgress(attemptContext, { reviewStatus: "pdf_fallback_extraction" });
    if (attemptContext.pdfFallbackAttempted) {
      const repaired = await repairPdfExtractionIfNeeded({ report: extractionCompleteness, text: paperContent, metadataHints });
      paperContent = repaired.text;
      metadataExtractionText = paperContent;
      extractionCompleteness = repaired.report;
      attemptContext.fallbackSucceeded = repaired.fallbackUsed && isExtractionReviewableStatus(extractionCompleteness.extractionCompletenessStatus);
    } else {
      attemptContext.fallbackSucceeded = false;
    }
    attemptContext.pdfVisibleFallbackUsed = false;
    updateAttemptExtractionContext(attemptContext, extractionCompleteness);
    updateAttemptInputDebugPayload(attemptContext, paperContent, extractionCompleteness, { pdfFallbackAttempted: attemptContext.pdfFallbackAttempted, fallbackSucceeded: attemptContext.fallbackSucceeded });
    await updateReviewAttemptProgress(attemptContext, { reviewStatus: extractionCompleteness.extractionCompletenessStatus });
  }
  submittedPdfUrl = url;
} else {
  setAttemptStage(attemptContext, "pdf_text_extraction", "extraction", null);
  await updateReviewAttemptProgress(attemptContext, { reviewStatus: "manual_text_received" });
  paperContent = cleanExtractedManuscriptText(source.data);
  metadataExtractionText = paperContent;
  extractionCompleteness = assessExtractionCompleteness(paperContent);
  updateAttemptExtractionContext(attemptContext, extractionCompleteness);
  updateAttemptInputDebugPayload(attemptContext, paperContent, extractionCompleteness, { manualTextSupplied: source.type === "text" });
  await updateReviewAttemptProgress(attemptContext, { reviewStatus: extractionCompleteness.extractionCompletenessStatus });
}
// Strip null bytes and non-printable control characters that break JSON serialisation
paperContent = cleanExtractedManuscriptText(paperContent);
metadataExtractionText = cleanExtractedManuscriptText(metadataExtractionText || paperContent);
extractionCompleteness ??= assessExtractionCompleteness(paperContent);
updateAttemptExtractionContext(attemptContext, extractionCompleteness);
updateAttemptInputDebugPayload(attemptContext, paperContent, extractionCompleteness);
const usePdfVisibleLastResort = pdfVisibleLastResortRequested && Boolean(metadataHints.pdfBase64);
setAttemptStage(attemptContext, "extraction_quality_check", "validation", null);
await updateReviewAttemptProgress(attemptContext, { reviewStatus: extractionCompleteness.extractionCompletenessStatus });
if (isExtractionBlockingStatus(extractionCompleteness.extractionCompletenessStatus) && !usePdfVisibleLastResort) {
  attemptContext.reviewStatus = "invalid_extraction_truncated";
  const payload = extractionErrorPayload(extractionCompleteness);
  const err: any = submissionHttpError(payload.error, 422, payload);
  err.reviewStatus = "invalid_extraction_truncated";
  throw err;
}
if (usePdfVisibleLastResort && isExtractionBlockingStatus(extractionCompleteness.extractionCompletenessStatus)) {
  attemptContext.pdfVisibleFallbackUsed = true;
  extractionCompleteness = {
    ...extractionCompleteness,
    extractionCompletenessStatus: "reviewable_with_warnings",
    extractionWarnings: [
      ...extractionCompleteness.extractionWarnings,
      "Admin selected PDF-visible last-resort review after text extraction remained incomplete. Blinding strength is lower.",
    ],
  };
  updateAttemptExtractionContext(attemptContext, extractionCompleteness);
  updateAttemptInputDebugPayload(attemptContext, paperContent, extractionCompleteness, {
    pdfVisibleFallbackRequested: true,
  });
  await updateReviewAttemptProgress(attemptContext, { reviewStatus: extractionCompleteness.extractionCompletenessStatus });
}

// Step 1: extract real title and authors (before anonymous review)
setAttemptStage(attemptContext, "metadata_extraction", "helper", GEMINI_METADATA_MODEL);
await updateReviewAttemptProgress(attemptContext, { reviewStatus: "metadata_extraction" });
const metadata = await extractLatestMetadata(metadataExtractionText || paperContent, metadataHints);
const metadataTitle = metadata.dateMetadata?.displayedTitle || metadata.title || "";
const metadataAuthors = metadata.dateMetadata?.displayedAuthors?.join(", ") || metadata.authors || "";
const metadataNeedsRepair =
  source.type === "pdf" &&
  (
    !metadataTitle.trim() ||
    /^Unknown Title$/i.test(metadataTitle.trim()) ||
    !metadataAuthors.trim() ||
    /^Unknown Authors$/i.test(metadataAuthors.trim())
  );
if (metadataNeedsRepair && usePdfVisibleLastResort) {
  const fallbackTitle = typeof source.fileName === "string" && source.fileName.trim()
    ? source.fileName.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim()
    : "Untitled PDF-visible review";
  metadata.title = metadataTitle.trim() && !/^Unknown Title$/i.test(metadataTitle.trim())
    ? metadataTitle.trim()
    : fallbackTitle;
  metadata.authors = metadataAuthors.trim() && !/^Unknown Authors$/i.test(metadataAuthors.trim())
    ? metadataAuthors.trim()
    : "Unknown Authors";
  metadata.dateMetadata = {
    ...(metadata.dateMetadata ?? {}),
    displayedTitle: metadata.title,
    displayedAuthors: metadata.authors === "Unknown Authors" ? [] : splitAuthorNamesForMetadata(metadata.authors),
    rawExtractedTitle: metadata.dateMetadata?.rawExtractedTitle ?? metadataTitle,
    rawExtractedAuthors: metadata.dateMetadata?.rawExtractedAuthors ?? metadataAuthors,
    titleConfidence: Math.min(Number(metadata.dateMetadata?.titleConfidence ?? 0), metadata.title === fallbackTitle ? 0.2 : 0.6),
    authorsConfidence: Math.min(Number(metadata.dateMetadata?.authorsConfidence ?? 0), metadata.authors === "Unknown Authors" ? 0 : 0.6),
    titleCleaningNotes: [
      metadata.dateMetadata?.titleCleaningNotes,
      "PDF-visible last resort was explicitly requested, so missing/weak metadata did not block scientific review. Metadata should be corrected manually if needed.",
    ].filter(Boolean).join(" "),
    authorsExtractionNotes: [
      metadata.dateMetadata?.authorsExtractionNotes,
      "PDF-visible last resort was explicitly requested, so missing/weak authors did not block scientific review. Metadata should be corrected manually if needed.",
    ].filter(Boolean).join(" "),
    metadataQaWarnings: [
      ...((metadata.dateMetadata as any)?.metadataQaWarnings ?? []),
      "Metadata was weak during PDF-visible last-resort review; review proceeded with editable fallback metadata.",
    ],
  } as any;
  await updateReviewAttemptProgress(attemptContext, {
    reviewStatus: "metadata_weak_pdf_visible_continuing",
    retryable: true,
    debugPayload: {
      ...debugPayloadObject(attemptContext.debugPayload),
      metadataRepairBypassedForPdfVisibleLastResort: true,
      extractedMetadata: {
        title: metadataTitle,
        authors: metadataAuthors,
        fallbackTitle: metadata.title,
        fallbackAuthors: metadata.authors,
        titleConfidence: metadata.dateMetadata?.titleConfidence ?? null,
        authorsConfidence: metadata.dateMetadata?.authorsConfidence ?? null,
      },
    },
  });
} else if (metadataNeedsRepair) {
  const message = "Metadata repair required: title-page visual extraction could not confidently identify the paper title/authors.";
  attemptContext.reviewStatus = "needs_manual_repair";
  await updateReviewAttemptProgress(attemptContext, {
    reviewStatus: "needs_manual_repair",
    failureStatus: "needs_manual_repair",
    retryable: true,
    errorMessage: message,
    debugPayload: {
      ...debugPayloadObject(attemptContext.debugPayload),
      metadataRepairRequired: true,
      extractedMetadata: {
        title: metadataTitle,
        authors: metadataAuthors,
        titleConfidence: metadata.dateMetadata?.titleConfidence ?? null,
        authorsConfidence: metadata.dateMetadata?.authorsConfidence ?? null,
        titleCleaningNotes: metadata.dateMetadata?.titleCleaningNotes ?? null,
        authorsExtractionNotes: metadata.dateMetadata?.authorsExtractionNotes ?? null,
      },
    },
  });
  throw submissionHttpError(message, 422, {
    reviewStatus: "needs_manual_repair",
    failureStatus: "needs_manual_repair",
    retryable: true,
    stageName: "metadata_extraction",
    extractionCompletenessStatus: extractionCompleteness.extractionCompletenessStatus,
    extractionWarnings: extractionCompleteness.extractionWarnings,
  });
}

const existingByMetadata = allowExistingReviewReuse
  ? await existingMetadataIdentitySubmission(
      user.id,
      metadata,
    )
  : null;
if (existingByMetadata?.review) {
  const existingDisplayPaper = normalizePaperDisplayMetadata(
    existingByMetadata.paper,
    reviewMetadataNormalizationText(existingByMetadata.review),
  );
  logger.info({
    paperId: existingDisplayPaper.id,
    title: existingDisplayPaper.title,
    paperAuthors: existingDisplayPaper.paperAuthors,
    existingPromptVersion: existingByMetadata.existingPromptVersion,
    existingPromptHash: existingByMetadata.existingPromptHash,
    duplicatePromptMatchesActivePrompt: existingByMetadata.promptMatches,
    promptVersion: REVIEW_PROMPT_VERSION,
    promptHash: REVIEW_PROMPT_HASH,
    cacheUsed: true,
    previousReviewUsed: true,
    duplicateReason: existingByMetadata.duplicateReason,
    comparatorContextIncluded: false,
    adjudicatorContextIncluded: false,
  }, "Detected existing review by canonical metadata identity before scientific review");
  if (resolveSubmission) resolveSubmission({ ...existingByMetadata, paper: existingDisplayPaper });
  attemptContext.paperId = existingDisplayPaper.id;
  const metadataDuplicateLabel = existingByMetadata.duplicateReason === "doi"
    ? "DOI"
    : existingByMetadata.duplicateReason === "arxivId"
      ? "arXiv ID"
      : "title and authors";
  const attempt = await updateReviewAttemptProgress(attemptContext, {
    stageName: "save_review",
    stageType: "storage",
    reviewStatus: "duplicate_existing",
    failureStatus: "completed",
    retryable: false,
    errorMessage: `This paper is already in the system as "${existingDisplayPaper.title}" by ${existingDisplayPaper.paperAuthors || "Unknown Authors"} under the active prompt (${metadataDuplicateLabel} match).`,
    debugPayload: completedAttemptDebugPayload(attemptContext, {
      cacheUsed: true,
      previousReviewUsed: true,
      reuseReason: "metadataIdentityPreReview",
      duplicateReason: existingByMetadata.duplicateReason,
      duplicatePromptMatchesActivePrompt: existingByMetadata.promptMatches,
      duplicateExistingPromptVersion: existingByMetadata.existingPromptVersion,
      duplicateExistingPromptHash: existingByMetadata.existingPromptHash,
      activePromptVersion: REVIEW_PROMPT_VERSION,
      activePromptHash: REVIEW_PROMPT_HASH,
      duplicateExistingPaperId: existingDisplayPaper.id,
      duplicateExistingReviewId: existingByMetadata.review.id,
      duplicateExistingTitle: existingDisplayPaper.title,
      duplicateExistingAuthors: existingDisplayPaper.paperAuthors,
      duplicateExistingCreatedAt: existingDisplayPaper.createdAt,
      extractedMetadata: {
        title: metadataTitle,
        authors: metadataAuthors,
        doi: metadata.dateMetadata?.doi ?? null,
        arxivId: metadata.dateMetadata?.arxivId ?? null,
        titleConfidence: metadata.dateMetadata?.titleConfidence ?? null,
        authorsConfidence: metadata.dateMetadata?.authorsConfidence ?? null,
      },
      savedPaperId: existingDisplayPaper.id,
      savedReviewId: existingByMetadata.review.id,
    }),
  });
  if (submissionKey) {
    const key = submissionKey;
    setTimeout(() => recentSubmissions.delete(key), 30 * 60 * 1000).unref?.();
  }
  return { paper: existingDisplayPaper, review: existingByMetadata.review, attempt, batchRunId, queueItemId };
}

// Weak title/author metadata is still not used for reuse. Only exact source hashes
// or high-confidence canonical metadata identity can stop a new review.

// Step 2: run blind review/adjudication first, then retrieve comparators for calibration
setAttemptStage(attemptContext, "blind_pass_1", "scientific_review", GEMINI_PASS_MODEL);
await updateReviewAttemptProgress(attemptContext, { reviewStatus: "scientific_review_started" });
const reviewInput: ReviewInput = usePdfVisibleLastResort && metadataHints.pdfBase64
  ? {
      text: paperContent,
      pdfBase64: metadataHints.pdfBase64,
      mimeType: metadataHints.mimeType || "application/pdf",
    }
  : paperContent;
const { reviewValues, metadata: reviewMetadata } = await generateCompatReview(
  reviewInput,
  selectedModel,
  undefined,
  { selectComparatorContext, reviewMode, extractionCompleteness },
);
addSubmissionCostControls(reviewValues, sourceHash, reviewMode);
setAttemptStage(attemptContext, "review_validation", "validation", null);
await updateReviewAttemptProgress(attemptContext, { reviewStatus: "review_validation" });
if (reviewMode === "benchmark-ingestion") {
  const issue = benchmarkCompletionIssue(reviewValues);
  if (issue) {
    attemptContext.reviewStatus = /extraction|truncated/i.test(issue)
      ? "invalid_extraction_truncated"
      : "failed_validation";
    const err: any = new Error(`Benchmark review incomplete: ${issue}`);
    err.statusCode = 422;
    err.reviewStatus = attemptContext.reviewStatus;
    throw err;
  }
}

const submitterName = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || "Anonymous";

let paper: typeof papersTable.$inferSelect;
try {
  setAttemptStage(attemptContext, "save_review", "storage", null);
  await updateReviewAttemptProgress(attemptContext, { reviewStatus: "save_review" });
  [paper] = await db.insert(papersTable).values({
    title: metadata.title,
    content: (source.type === "pdf" || source.type === "url") ? `[PDF] ${metadata.title}` : paperContent,
    authorId: user.id,
    authorName: submitterName,
    paperAuthors: metadata.authors,
    dateMetadata: metadata.dateMetadata,
    field: reviewMetadata.field,
    subfields: reviewMetadata.subfields,
    score: reviewValues.score,
    modelName: reviewMetadata.modelName,
    pdfUrl: submittedPdfUrl,
    displayPdf: submittedDisplayPdf ? 1 : 0,
  }).returning();
} catch (insertErr: any) {
  throw insertErr;
}

attemptContext.paperId = paper.id;
const [review] = await db.insert(reviewsTable).values(buildReviewInsertValues(paper.id, reviewValues)).returning();
const attempt = await updateReviewAttemptProgress(attemptContext, {
  reviewStatus: "completed",
  failureStatus: "completed",
  retryable: false,
  debugPayload: completedAttemptDebugPayload(attemptContext, {
    savedPaperId: paper.id,
    savedReviewId: review.id,
    score: reviewValues.score,
  }),
});

const payload = { paper, review };
if (resolveSubmission) resolveSubmission(payload);
if (submissionKey) {
  const key = submissionKey;
  setTimeout(() => recentSubmissions.delete(key), 30 * 60 * 1000).unref?.();
}
return { ...payload, attempt, batchRunId, queueItemId };

  } catch (err: any) {
    if (rejectSubmission) rejectSubmission(err);
    if (submissionKey) {
      recentSubmissions.delete(submissionKey);
    }
    logger.error({ err }, "Error creating paper");
    if (attemptContext && !err?.attempt) {
      err.attempt = await recordFailedReviewAttempt(attemptContext, err);
    }
    throw err;
  }
}

function submissionResponsePayload(err: any) {
  const message = submissionErrorMessage(err);
  const explicitStatusCode = typeof err?.statusCode === "number" ? err.statusCode : null;
  const attempt = err?.attempt ?? null;
  if (explicitStatusCode === 422 || err?.reviewStatus === "invalid_extraction_truncated" || err?.reviewStatus === "failed_validation") {
    return {
      status: 422,
      body: {
        ...debugPayloadObject(err?.payload),
        error: message,
        transient: false,
        reviewStatus: err?.reviewStatus ?? debugString(debugPayloadObject(err?.payload), "reviewStatus") ?? "failed_validation",
        extractionCompletenessStatus: attempt?.extractionCompletenessStatus ?? err?.payload?.extractionCompletenessStatus ?? undefined,
        extractionWarnings: attempt?.extractionWarnings ?? err?.payload?.extractionWarnings ?? undefined,
        ...(attempt ? { attempt } : {}),
      },
    };
  }
  const quotaExhausted =
    /daily request quota reached|generate_requests_per_model_per_day|per_model_per_day|please retry in|exceeded your current quota/i.test(message);
  const transient =
    !quotaExhausted &&
    /transient model error|resource[_ ]exhausted|unavailable|overloaded|rate limit|quota|temporar|\b(429|500|502|503|504)\b/i.test(message);
  const retryAfterText = message.match(/retry in\s*([^.;]+)/i)?.[1]?.trim() ?? null;
  return {
    status: explicitStatusCode ?? (quotaExhausted ? 429 : transient ? 503 : 500),
    body: {
      ...debugPayloadObject(err?.payload),
      error: message,
      transient,
      quotaExhausted,
      retryAfterText,
      ...(attempt ? { attempt } : {}),
    },
  };
}

// POST /api/papers — compatibility synchronous submission path
router.post("/papers", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const { source } = req.body;
    const payload = await processPaperSubmission(req.user, source);
    res.json(payload);
  } catch (err: any) {
    const response = submissionResponsePayload(err);
    res.status(response.status).json(response.body);
  }
});

// DELETE /api/papers/:id — owner or admin can delete
router.delete("/papers/:id", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const [paper] = await db.select().from(papersTable).where(eq(papersTable.id, req.params.id));
    if (!paper) { res.status(404).json({ error: "Not found" }); return; }
    const isAdmin = ADMIN_EMAIL && req.user.email === ADMIN_EMAIL;
    if (!isAdmin && paper.authorId !== req.user.id) { res.status(403).json({ error: "Forbidden" }); return; }
    await db.delete(papersTable).where(eq(papersTable.id, req.params.id));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/papers/:id/view
router.patch("/papers/:id/view", async (req, res) => {
  try {
    await db.execute(`UPDATE papers SET view_count = view_count + 1 WHERE id = '${req.params.id}'`);
    res.json({ success: true });
  } catch {
    res.json({ success: false });
  }
});

// GET /api/papers/:id/comments
router.get("/papers/:id/comments", async (req, res) => {
  try {
    const comments = await db
      .select()
      .from(commentsTable)
      .where(eq(commentsTable.paperId, req.params.id))
      .orderBy(commentsTable.createdAt);
    res.json({ comments });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/papers/:id/comments
router.post("/papers/:id/comments", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const { content } = req.body;
    if (!content?.trim()) { res.status(400).json({ error: "content is required" }); return; }

    const displayName = [req.user.firstName, req.user.lastName].filter(Boolean).join(" ") || req.user.email || "Anonymous";

    const [comment] = await db.insert(commentsTable).values({
      paperId: req.params.id,
      authorId: req.user.id,
      authorName: displayName,
      content: content.trim(),
    }).returning();

    await db.execute(`UPDATE papers SET comment_count = comment_count + 1 WHERE id = '${req.params.id}'`);
    res.json({ comment });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Helper: format a review into readable text for chat context
function buildReviewContext(review: any, paper: any): string {
  const parts: string[] = [];
  if (paper?.title) parts.push(`PAPER TITLE: ${paper.title}`);
  if (review.centralClaim) parts.push(`CENTRAL CLAIM:\n${review.centralClaim}`);
  if (review.establishedResults) parts.push(`ESTABLISHED RESULTS:\n${review.establishedResults}`);
  if (review.interpretiveClaims) parts.push(`INTERPRETIVE CLAIMS:\n${review.interpretiveClaims}`);
  if (review.speculativeClaims) parts.push(`SPECULATIVE CLAIMS:\n${review.speculativeClaims}`);
  if (review.economy) parts.push(`EXPLANATORY ECONOMY:\n${review.economy}`);
  if (review.explanatoryTargetBreadth) parts.push(`EXPLANATORY TARGET BREADTH:\n${review.explanatoryTargetBreadth}`);
  if (review.theorySpaceBreadth) parts.push(`THEORY SPACE BREADTH:\n${review.theorySpaceBreadth}`);
  if (review.scopeDepth) parts.push(`SCOPE AND DEPTH:\n${review.scopeDepth}`);
  if (review.unifyingPower) parts.push(`UNIFYING POWER:\n${review.unifyingPower}`);
  if (review.strongestCaseForImportance) parts.push(`STRONGEST CASE FOR IMPORTANCE:\n${review.strongestCaseForImportance}`);
  if (review.strongestObjection) parts.push(`STRONGEST OBJECTION:\n${review.strongestObjection}`);
  if (review.assessmentSensitivity) parts.push(`ASSESSMENT SENSITIVITY:\n${review.assessmentSensitivity}`);
  if (review.internalTechnicalTraction) parts.push(`INTERNAL TECHNICAL TRACTION:\n${review.internalTechnicalTraction}`);
  if (review.finalJudgment) parts.push(`FINAL JUDGMENT:\n${review.finalJudgment}`);
  const scores: string[] = [];
  if (review.inputStrengthScore != null) scores.push(`  Input Strength: ${review.inputStrengthScore}/10`);
  if (review.constructionStrengthScore != null) scores.push(`  Construction Strength: ${review.constructionStrengthScore}/10`);
  if (review.outputStrengthScore != null) scores.push(`  Output Strength: ${review.outputStrengthScore}/10`);
  if (review.overallIntrinsicScore != null) scores.push(`  OVERALL INTRINSIC SCORE: ${review.overallIntrinsicScore}/100`);
  if (scores.length > 0) parts.push(`SCORES:\n${scores.join('\n')}`);
  // Legacy fields
  if (!review.centralClaim) {
    if (review.summary) parts.push(`SUMMARY:\n${review.summary}`);
    if (review.correctness) parts.push(`CORRECTNESS:\n${review.correctness}`);
    if (review.novelty) parts.push(`NOVELTY:\n${review.novelty}`);
    if (review.overallEvaluation) parts.push(`OVERALL EVALUATION:\n${review.overallEvaluation}`);
  }
  return parts.join('\n\n');
}

// POST /api/papers/:id/simpler — plain-language explanation of the review.
// Generated once with the same model family as the reviewer, then cached
// on the review so re-opening the disclosure never re-calls the model.
router.post("/papers/:id/simpler", async (req, res) => {
  try {
    const [paper] = await db.select().from(papersTable).where(eq(papersTable.id, req.params.id));
    if (!paper) { res.status(404).json({ error: "Paper not found" }); return; }
    const [review] = await db.select().from(reviewsTable).where(eq(reviewsTable.paperId, paper.id));
    if (!review) { res.status(404).json({ error: "Review not found" }); return; }
    if (review.simplifiedExplanation && review.simplifiedExplanation.trim()) {
      res.json({ simplifiedExplanation: review.simplifiedExplanation, cached: true });
      return;
    }

    const reviewContext = buildReviewContext(review, paper);
    const ledger = parseJsonObject(review.coverageLedgerJson);
    const snapshot = ledger?.reviewInputSnapshot && typeof ledger.reviewInputSnapshot === "object"
      ? ledger.reviewInputSnapshot as Record<string, unknown>
      : null;
    const manuscriptText = typeof snapshot?.blindedReviewText === "string" && snapshot.blindedReviewText.length > 200
      ? snapshot.blindedReviewText.slice(0, 60000)
      : null;
    const response = await (geminiAI.models.generateContent as any)({
      model: GEMINI_META_MODEL,
      config: {
        systemInstruction: `You are explaining a completed scientific review to a curious non-specialist. You have the full review${manuscriptText ? " and the manuscript text" : ""} below. Answer in plain prose, no headers or lists, 2-4 short paragraphs.\n\nReview:\n---\n${reviewContext}\n---${manuscriptText ? `\n\nManuscript (blinded):\n---\n${manuscriptText}\n---` : ""}`,
      },
      contents: [{
        role: "user",
        parts: [{ text: "What does this mean in simple language? How does it change our understanding?" }],
      }],
    });
    const simplifiedExplanation = (response.text ?? "").trim();
    if (!simplifiedExplanation) {
      res.status(502).json({ error: "Model returned an empty explanation." });
      return;
    }
    await db.update(reviewsTable)
      .set({ simplifiedExplanation })
      .where(eq(reviewsTable.id, review.id));
    res.json({ simplifiedExplanation, cached: false });
  } catch (err: any) {
    logger.error({ err }, "Simplified explanation failed");
    res.status(500).json({ error: err.message });
  }
});

// POST /api/reviews/:reviewId/chat
router.post("/reviews/:reviewId/chat", async (req, res) => {
  try {
    const { reviewId } = req.params;
    const { messages } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: "messages array required" }); return;
    }

    const [review] = await db.select().from(reviewsTable).where(eq(reviewsTable.id, reviewId));
    if (!review) { res.status(404).json({ error: "Review not found" }); return; }

    const [paper] = await db.select().from(papersTable).where(eq(papersTable.id, review.paperId));

    const reviewContext = buildReviewContext(review, paper);
    const ledger = parseJsonObject(review.coverageLedgerJson);
    const snapshot = ledger?.reviewInputSnapshot && typeof ledger.reviewInputSnapshot === "object"
      ? ledger.reviewInputSnapshot as Record<string, unknown>
      : null;
    const manuscriptText = typeof snapshot?.blindedReviewText === "string" && snapshot.blindedReviewText.length > 200
      ? snapshot.blindedReviewText
      : typeof paper?.content === "string" && !paper.content.startsWith("[PDF]")
        ? paper.content
        : null;
    const calibrationSummary = ledger?.pairwiseCalibration
      ? JSON.stringify({
          calibratedScore: ledger.calibratedScore ?? null,
          intrinsicScore: ledger.computedScore ?? ledger.intrinsicScore ?? null,
          calibrationUnderReview: ledger.calibrationUnderReview === true,
          calibrationRationale: ledger.calibrationRationale ?? "",
          cohorts: ledger.pairwiseCalibration.cohorts ?? [],
          anchorsUsed: ledger.pairwiseCalibration.anchorsUsed ?? [],
        }, null, 2)
      : null;

    // Honest framing: the chat assistant is not the reviewer session and
    // must never claim model or session identity with it.
    const systemMessage = `You are an AI assistant with this paper and its full review in front of you. You did not produce the review yourself; it was generated earlier by an identity-blind multi-pass review pipeline. Never claim to be the reviewer or to remember producing the review — you are reading the same record the user sees.

The review was produced under this framework:
---
${review.systemPrompt}
---

The complete review:
---
${reviewContext}
---${manuscriptText ? `\n\nThe manuscript text the review was based on (blinded):\n---\n${manuscriptText.slice(0, 60000)}\n---` : ''}${calibrationSummary ? `\n\nCalibration summary (pairwise benchmark comparison applied after the blind review):\n---\n${calibrationSummary}\n---` : ''}${review.thinkingText ? `\n\nInternal reasoning recorded during the review:\n---\n${review.thinkingText}\n---` : ''}

Help the user understand the paper and its review:
- Explain any part of the analysis in more depth
- Clarify why specific dimensions were scored the way they were, based on the recorded rationales
- Discuss the paper's strengths and weaknesses in more detail
- Be honest about uncertainty and the limits of the assessment
- Speculate about implications or related work when asked, clearly labeled as speculation

Be concise, intellectually honest, and use markdown where helpful.`;

    const response = await (geminiAI.models.generateContent as any)({
      model: GEMINI_META_MODEL,
      config: { systemInstruction: systemMessage },
      contents: messages.map((m: any) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
    });
    res.json({ reply: response.text ?? "" });
  } catch (err: any) {
    logger.error({ err }, "Chat error");
    res.status(500).json({ error: err.message });
  }
});

// GET /api/likes
router.get("/likes", async (req, res) => {
  if (!req.isAuthenticated()) { res.json({ likes: [] }); return; }
  try {
    const likes = await db.select().from(likesTable).where(eq(likesTable.userId, req.user.id));
    res.json({ likes });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/likes
router.post("/likes", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const { targetId, targetType } = req.body;
    if (!targetId || !targetType) { res.status(400).json({ error: "targetId and targetType required" }); return; }

    const existing = await db.select().from(likesTable).where(
      and(eq(likesTable.userId, req.user.id), eq(likesTable.targetId, targetId))
    );

    if (existing.length > 0) {
      await db.delete(likesTable).where(
        and(eq(likesTable.userId, req.user.id), eq(likesTable.targetId, targetId))
      );
      if (targetType === "review") {
        await db.execute(`UPDATE reviews SET likes_count = GREATEST(likes_count - 1, 0) WHERE id = '${targetId}'`);
      } else if (targetType === "paper") {
        await db.execute(`UPDATE papers SET likes_count = GREATEST(likes_count - 1, 0) WHERE id = '${targetId}'`);
      }
      res.json({ liked: false });
    } else {
      await db.insert(likesTable).values({ userId: req.user.id, targetId, targetType });
      if (targetType === "review") {
        await db.execute(`UPDATE reviews SET likes_count = likes_count + 1 WHERE id = '${targetId}'`);
      } else if (targetType === "paper") {
        await db.execute(`UPDATE papers SET likes_count = likes_count + 1 WHERE id = '${targetId}'`);
      }
      res.json({ liked: true });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

startReviewJobRecovery();

export default router;
