import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

const root = process.cwd();
const promptPath = join(root, "artifacts/api-server/src/lib/prompts/diagnosticOnlyV17.ts");
const enginePath = join(root, "artifacts/api-server/src/lib/reviewEngineCompat.ts");
const routesPath = join(root, "artifacts/api-server/src/routes/papers.ts");
const apiBuildPath = join(root, "artifacts/api-server/build.mjs");
const apiSupervisorPath = join(root, "artifacts/api-server/src/supervisor.ts");
const apiWorkerPath = join(root, "artifacts/api-server/src/worker.ts");
const appPath = join(root, "artifacts/scireview/src/App.tsx");
const submissionFormPath = join(root, "artifacts/scireview/src/components/SubmissionForm.tsx");
const apiPackagePath = join(root, "artifacts/api-server/package.json");
const pdfParseTypesPath = join(root, "artifacts/api-server/src/types/pdf-parse.d.ts");

const promptSource = readFileSync(promptPath, "utf8");
const engineSource = readFileSync(enginePath, "utf8");
const routesSource = readFileSync(routesPath, "utf8");
const apiBuildSource = readFileSync(apiBuildPath, "utf8");
const apiSupervisorSource = readFileSync(apiSupervisorPath, "utf8");
const apiWorkerSource = readFileSync(apiWorkerPath, "utf8");
const appSource = readFileSync(appPath, "utf8");
const submissionFormSource = readFileSync(submissionFormPath, "utf8");
const apiPackageSource = readFileSync(apiPackagePath, "utf8");
const pdfParseTypesSource = readFileSync(pdfParseTypesPath, "utf8");

function extractRawConst(source, name) {
  const marker = `export const ${name} = String.raw\``;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} not found`);
  const bodyStart = start + marker.length;
  const end = source.indexOf("`;", bodyStart);
  assert.notEqual(end, -1, `${name} raw template did not terminate`);
  return source.slice(bodyStart, end);
}

function normalizeDiagnosticSubscore(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.max(0, Math.min(10, value)) * 2) / 2;
}

function computedScore(i, c, o) {
  return Math.round(10 * ((i + c + o) / 3));
}

const blindPrompt = extractRawConst(promptSource, "BLIND_REVIEW_PASS_V17_1_PROMPT");
const adjudicatorAddendum = extractRawConst(promptSource, "INTRINSIC_ADJUDICATOR_V17_1_ADDENDUM");

assert.match(promptSource, /v17\.1 computed ICO half-point/i);
assert.match(engineSource, /v17\.1-computed-ico-halfpoint/);
assert.match(engineSource, /v17\.1-diagnostic-only-halfpoint/);
assert.match(engineSource, /jacobson-kang-myers-increase-black-hole-entropy/);
assert.match(engineSource, /jacobson-kang-myers-black-hole-entropy-higher-curvature/);
assert.match(engineSource, /eling-guedens-jacobson-non-equilibrium-spacetime/);
assert.match(engineSource, /akbar-cai-fgravity-field-equations/);
assert.match(engineSource, /"gr-qc\/9503020": \["Ted Jacobson", "Gungwon Kang", "Robert C\. Myers"\]/);
assert.match(engineSource, /"gr-qc\/9502009": \["Ted Jacobson", "Gungwon Kang", "Robert C\. Myers"\]/);
assert.doesNotMatch(engineSource, /thermodynamics-spacetime"[\s\S]{0,900}ted\\s\+jacobson/);
assert.doesNotMatch(engineSource, /thermodynamics-spacetime"[\s\S]{0,900}t\\.\\?\\s\+jacobson/);
assert.match(engineSource, /score \+= 100/);
assert.match(engineSource, /score \+= 80/);

assert.match(blindPrompt, /0 to 10 in 0\.5 increments/);
assert.match(blindPrompt, /Use 0 when no correct, relevant, manuscript-contained contribution survives/);
assert.match(blindPrompt, /Do not output, infer, or choose a 0-100 final score/);
assert.match(blindPrompt, /The application will compute any public score/);
assert.match(blindPrompt, /Review input quality/);
assert.match(blindPrompt, /reviewInputQuality/);
assert.match(blindPrompt, /shouldInvalidateReview/);
assert.match(blindPrompt, /Do not lower Output Strength merely because extraction omitted central derivations or sections/);

for (const forbidden of [
  '"intrinsicScore"',
  '"publicMagnitudeLabel"',
  '"scoreBand"',
  '"finalScoreBand"',
  '"fatalObjectionPresent"',
  '"paperFatalError"',
  '"survivingHighValueContributions"',
  '"failedClaimsExcludedFromScore"',
  '"failedConstructionsExcludedFromScore"',
  '"failedOutputsExcludedFromScore"',
]) {
  assert.equal(blindPrompt.includes(forbidden), false, `active blind prompt still asks for ${forbidden}`);
}

assert.match(blindPrompt, /"failedClaimsExcludedFromDiagnostics"/);
assert.match(blindPrompt, /"failedConstructionsExcludedFromDiagnostics"/);
assert.match(blindPrompt, /"failedOutputsExcludedFromDiagnostics"/);

assert.match(adjudicatorAddendum, /Read:\n- the blinded manuscript;\n- Blind Pass 1;\n- Blind Pass 2\./);
assert.match(adjudicatorAddendum, /Do not output a 0-100 final score/);
assert.match(adjudicatorAddendum, /Do not receive, request, or use comparator papers/);
assert.match(adjudicatorAddendum, /mark reviewInputQuality\.shouldInvalidateReview as true/);

assert.equal(normalizeDiagnosticSubscore(0), 0);
assert.equal(normalizeDiagnosticSubscore(0.24), 0);
assert.equal(normalizeDiagnosticSubscore(0.26), 0.5);
assert.equal(normalizeDiagnosticSubscore(7.74), 7.5);
assert.equal(normalizeDiagnosticSubscore(7.76), 8);
assert.equal(normalizeDiagnosticSubscore(-4), 0);
assert.equal(normalizeDiagnosticSubscore(12), 10);

assert.equal(computedScore(0, 0, 0), 0);
assert.equal(computedScore(8, 2, 2), 40);
assert.equal(computedScore(8.5, 7.5, 9), 83);

assert.match(engineSource, /Math\.round\(Math\.max\(0, Math\.min\(10, value\)\) \* 2\) \/ 2/);
assert.match(engineSource, /average \* 10/);
assert.match(engineSource, /diagnosticScoreFormula: "10 \* average\(inputStrengthScore, constructionStrengthScore, outputStrengthScore\)"/);
assert.match(engineSource, /not_run_benchmark_ingestion/);
assert.match(engineSource, /comparatorContextIncluded: false/);
assert.match(engineSource, /calibrationContextIncluded: false/);
assert.match(engineSource, /reviewInputWithExtractionQaNote/);
assert.match(engineSource, /EXTRACTION QA NOTE/);
assert.match(engineSource, /modelBlindedContent = reviewInputWithExtractionQaNote\(blindedContent, reviewInputSnapshot\)/);
assert.match(engineSource, /reviewInputAuditHashes\(modelBlindedContent\)/);
assert.match(engineSource, /runPassWithGenerationRetries\(systemPrompt, modelBlindedContent/);
assert.match(engineSource, /buildAdjudicatorInput\(modelBlindedContent, individualReviews\)/);
assert.match(engineSource, /textHash: inputAuditHashes\.textHash/);
assert.match(engineSource, /pdfHash: inputAuditHashes\.pdfHash/);
assert.match(engineSource, /cacheUsed: false/);
assert.match(engineSource, /previousReviewUsed: false/);
assert.match(engineSource, /adjudicatorContextIncluded: false/);
assert.match(engineSource, /blindPassTextHashes/);
assert.match(engineSource, /Blind pass input hashes diverged/);
assert.match(engineSource, /assessExtractionCompleteness/);
assert.match(engineSource, /ExtractionCompletenessStatus =\s*\n\s*\| "complete"\s*\n\s*\| "complete_with_warnings"\s*\n\s*\| "reviewable_with_warnings"\s*\n\s*\| "needs_manual_repair"\s*\n\s*\| "invalid_truncated"\s*\n\s*\| "failed"/);
assert.match(engineSource, /isExtractionReviewableStatus/);
assert.match(engineSource, /isExtractionBlockingStatus/);
assert.match(engineSource, /tailLooksLikeReferencesOrPageArtifact/);
assert.match(engineSource, /hasLikelyScientificBody/);
assert.match(engineSource, /Extracted text tail appears to be references, citation fragments, or page-number artifacts/);
assert.match(engineSource, /status = hasScientificBody \? "complete_with_warnings" : "reviewable_with_warnings"/);
assert.match(engineSource, /rawExtractedTextFirst2000/);
assert.match(engineSource, /blindedReviewTextLast2000/);
assert.match(engineSource, /invalid_extraction_truncated/);
assert.match(engineSource, /reviewQualityRequiresInvalidation/);
assert.match(engineSource, /invalidReviewInputQualityError\(invalidPass, "Blind pass", reviewInputSnapshot\)/);
assert.match(engineSource, /invalidReviewInputQualityError\(aggregate, "Adjudicator", reviewInputSnapshot\)/);
assert.match(engineSource, /deterministicSnapshotIsReviewable/);
assert.match(engineSource, /reviewInputSelfCheckError/);
assert.match(engineSource, /input self-check failed despite deterministic reviewable extraction/);
assert.match(engineSource, /reviewQualityRequiresInvalidation\(review, reviewInputSnapshot\)/);
assert.match(engineSource, /reviewQualityRequiresInvalidation\(aggregate, reviewInputSnapshot\)/);
assert.match(engineSource, /individualReviews\.find\(\(review\) => reviewQualityRequiresInvalidation\(review, reviewInputSnapshot\)\)/);
assert.doesNotMatch(engineSource, /reviewQualityRequiresInvalidation\(review\)/);
assert.doesNotMatch(engineSource, /reviewQualityRequiresInvalidation\(aggregate\)/);
assert.match(engineSource, /extractManuscriptTextFromPdfForReview/);
assert.match(engineSource, /PDF_EXTRACTION_FALLBACK_PLAIN_TEXT_PROMPT/);
assert.match(engineSource, /callGeminiPlainText/);
assert.match(engineSource, /Structured PDF extraction JSON failed; plain-text PDF extraction fallback was used/);
assert.match(engineSource, /export function parseGeminiJsonResponse/);

assert.match(apiPackageSource, /"pretypecheck": "pnpm -w run typecheck:libs"/);
assert.match(apiPackageSource, /"start": "node --enable-source-maps \.\/dist\/supervisor\.mjs"/);
assert.match(apiPackageSource, /"start:web": "REVIEW_PROCESS_ROLE=web REVIEW_JOB_PROCESSING_ENABLED=false/);
assert.match(apiPackageSource, /"start:worker": "REVIEW_PROCESS_ROLE=worker REVIEW_JOB_PROCESSING_ENABLED=true/);
assert.match(apiBuildSource, /src\/index\.ts/);
assert.match(apiBuildSource, /src\/worker\.ts/);
assert.match(apiBuildSource, /src\/supervisor\.ts/);
assert.match(apiSupervisorSource, /REVIEW_PROCESS_ROLE: role/);
assert.match(apiSupervisorSource, /REVIEW_JOB_PROCESSING_ENABLED: role === "worker" \? "true" : "false"/);
assert.match(apiSupervisorSource, /Review worker exited; restarting worker without taking down web/);
assert.match(apiSupervisorSource, /Web process exited; supervisor will exit so Railway restarts the service/);
assert.match(apiWorkerSource, /Review worker started/);
assert.match(pdfParseTypesSource, /declare module "pdf-parse"/);
assert.match(pdfParseTypesSource, /text: string/);
assert.match(pdfParseTypesSource, /numpages: number/);
assert.match(pdfParseTypesSource, /metadata\?: unknown/);

assert.match(routesSource, /buildReviewInsertValues/);
assert.match(routesSource, /typeof reviewsTable\.\$inferInsert/);
assert.match(routesSource, /db\.insert\(reviewsTable\)\.values\(buildReviewInsertValues/);
assert.match(routesSource, /repairPdfExtractionIfNeeded/);
assert.match(routesSource, /isExtractionBlockingStatus\(extractionCompleteness\.extractionCompletenessStatus\)/);
assert.match(routesSource, /isExtractionReviewableStatus\(extractionCompleteness\.extractionCompletenessStatus\)/);
assert.match(routesSource, /extractionCompletenessStatus: "reviewable_with_warnings"/);
assert.match(routesSource, /\/admin\/papers\/:id\/review-input\/:kind/);
assert.match(routesSource, /\/admin\/reviews\/extraction-qa-scan/);
assert.match(routesSource, /debugAudit/);
assert.match(routesSource, /if \(debugAudit && !requireAdmin\(req, res\)\) return/);
assert.match(routesSource, /rawExtractedTextDownloadUrl/);
assert.match(routesSource, /blindedReviewTextDownloadUrl/);
assert.match(routesSource, /parseGeminiJsonResponse\(text\)/);
assert.match(routesSource, /failedReviewAttempts/);
assert.match(routesSource, /includeFailedAttempts/);
assert.match(routesSource, /recordFailedReviewAttempt/);
assert.match(routesSource, /batchRunId/);
assert.match(routesSource, /queueItemId/);
assert.match(routesSource, /frontendSiteVersion/);
assert.match(routesSource, /request_received/);
assert.match(routesSource, /upload_received/);
assert.match(routesSource, /client_failure/);
assert.match(routesSource, /interrupted_by_server_restart/);
assert.match(routesSource, /\/review-batches\/register/);
assert.match(routesSource, /\/review-jobs/);
assert.match(routesSource, /createDurableReviewJob/);
assert.match(routesSource, /sourceSnapshot/);
assert.match(routesSource, /userSnapshot/);
assert.match(routesSource, /sanitizeAttemptDebugPayload/);
assert.match(routesSource, /summarizeSourceSnapshot/);
assert.match(routesSource, /sourceSnapshotRedacted/);
assert.match(routesSource, /attemptForResponse/);
assert.match(routesSource, /enqueueReviewJob/);
assert.match(routesSource, /runReviewJob/);
assert.match(routesSource, /recoverReviewJobs/);
assert.match(routesSource, /startReviewJobRecovery/);
assert.match(routesSource, /const REVIEW_JOB_AUTO_RECOVERY = process\.env\.REVIEW_JOB_AUTO_RECOVERY === "true"/);
assert.match(routesSource, /const REVIEW_JOB_WORKER_ID =/);
assert.match(routesSource, /const REVIEW_PROCESS_ROLE =/);
assert.match(routesSource, /const REVIEW_JOB_PROCESSING_ENABLED =/);
assert.match(routesSource, /REVIEW_PROCESS_ROLE !== "web"/);
assert.match(routesSource, /if \(REVIEW_PROCESS_ROLE === "web"\) return false/);
assert.match(routesSource, /payload\.jobStatus !== "running" && record\.reviewStatus !== "running"/);
assert.match(routesSource, /if \(!REVIEW_JOB_PROCESSING_ENABLED\) return/);
assert.match(routesSource, /const REVIEW_JOB_LEASE_MS =/);
assert.match(routesSource, /const REVIEW_JOB_HEARTBEAT_MS =/);
assert.match(routesSource, /const REVIEW_JOB_MAX_AUTO_RETRIES =/);
assert.match(routesSource, /markReviewJobRunning/);
assert.match(routesSource, /touchReviewJobHeartbeat/);
assert.match(routesSource, /leaseExpiresAt/);
assert.match(routesSource, /jobLeaseExpired/);
assert.match(routesSource, /markReviewJobAutoRecoveryExceeded/);
assert.match(routesSource, /auto_recovery_exceeded/);
assert.match(routesSource, /autoRecoveryCount/);
assert.match(routesSource, /reviewJobAutoRetryCount/);
assert.match(routesSource, /canAutoRecoverReviewJob/);
assert.match(routesSource, /workerHeartbeatAt/);
assert.match(routesSource, /apiRuntimeAtWorkerStart/);
assert.match(routesSource, /frontendPageStaleAfterApiRestart/);
assert.match(routesSource, /STALE_FRONTEND_AFTER_API_RESTART/);
assert.doesNotMatch(routesSource, /if \(!REVIEW_JOB_AUTO_RECOVERY\) return/);
assert.match(routesSource, /queued\/stale jobs still recover/);
assert.match(routesSource, /debugPayload}->>'batchRunId'/);
assert.match(routesSource, /processPaperSubmission/);
assert.match(routesSource, /\/review-jobs\/:id/);
assert.match(routesSource, /\/batches\/:batchRunId/);
assert.match(routesSource, /\/review-attempts\/client-failure/);
assert.match(routesSource, /currentBatch/);
assert.match(routesSource, /historicalFailedAttempts/);
assert.match(routesSource, /serverAttempts/);
assert.match(routesSource, /clientFailures/);
assert.match(routesSource, /buildBatchExport/);
assert.match(routesSource, /reviewRuntimeInfo\(\)/);
assert.match(routesSource, /failureStatusForAttempt/);
assert.match(routesSource, /apiRuntimePreviousProcessStartedAt/);
assert.match(routesSource, /apiRuntimeCurrentProcessStartedAt/);
assert.match(routesSource, /apiRuntimeRestartDetectedAt/);
assert.match(routesSource, /isInterruptedReviewAttempt/);
assert.match(routesSource, /attemptLifecycleStartedAtMs/);
assert.match(routesSource, /payload\.queuedAt/);
assert.match(routesSource, /payload\.requestReceivedAt/);
assert.match(routesSource, /runtimeStartedAtMs\(payload\.apiRuntimeAtQueued\)/);
assert.match(routesSource, /processStartedAt > lifecycleStartedAt \+ 1000/);
assert.match(routesSource, /REVIEW_JOB_AUTO_RECOVERY && REVIEW_JOB_PROCESSING_ENABLED && shouldResumeReviewJob\(attempt\)/);
assert.match(routesSource, /poll_server_restart_recovery/);
assert.match(routesSource, /stageName: interruptedByRestart \? "interrupted_by_server_restart" : "client_failure"/);
assert.match(routesSource, /failureStatus: interruptedByRestart \? "interrupted_by_server_restart" : "retryable"/);
assert.match(routesSource, /failed_pdf_fallback_json/);
assert.match(routesSource, /failed_review_json/);
assert.match(routesSource, /needs_manual_repair/);
assert.match(routesSource, /scientificScoringAttempted/);
assert.match(routesSource, /debugPayload/);
assert.match(routesSource, /textEdgeSnippets/);
assert.match(routesSource, /sectionMarkerInventory/);
assert.match(routesSource, /phraseIndexAListOf/);
assert.match(routesSource, /reviewMode !== "benchmark-ingestion"/);
assert.match(routesSource, /const forceFreshReview = source\.forceFreshReview === true \|\| source\.forceFresh === true/);
assert.doesNotMatch(routesSource, /forceFreshReview = .*reviewMode === "benchmark-ingestion"/);
assert.match(routesSource, /benchmarkCompletionIssue/);
assert.match(routesSource, /Benchmark review incomplete/);
assert.match(routesSource, /benchmarkSnapshotIsDeterministicallyReviewable/);
assert.match(routesSource, /invalidQuality[\s\S]*&& !deterministicReviewable/);
assert.match(routesSource, /\/admin\/review-attempts/);
assert.match(routesSource, /submit_manual_extracted_text/);
assert.match(routesSource, /usePdfVisibleLastResort/);
assert.match(routesSource, /pdfVisibleFallbackRequested/);
assert.match(routesSource, /stageName: ReviewAttemptStageName/);
assert.match(routesSource, /metadata_extraction/);
assert.match(routesSource, /blind_pass_1/);
assert.match(routesSource, /adjudicator/);
assert.match(routesSource, /GEMINI_METADATA_MODEL/);
assert.match(routesSource, /GEMINI_PASS_MODEL/);
assert.match(routesSource, /attempt \? \{ attempt \}/);

assert.match(appSource, /error\.attempt = data\.attempt/);
assert.match(appSource, /\/api\/review-jobs/);
assert.match(appSource, /pollReviewJob/);
assert.match(appSource, /REVIEW_JOB_POLL_TRANSIENT_WINDOW_MS/);
assert.match(appSource, /isTransientReviewJobPollError/);
assert.match(appSource, /firstTransientPollErrorAt/);
assert.match(appSource, /jobAttemptFailure/);
assert.match(appSource, /if \(\(err as any\)\?\.jobAttemptFailure\) throw err/);
assert.match(appSource, /Review job status polling could not reach the API/);
assert.match(appSource, /attempt\.reviewStatus === 'interrupted_by_server_restart'/);
assert.match(appSource, /params\.set\('includeFailedAttempts', 'true'\)/);
assert.match(appSource, /batchRunId/);
assert.match(appSource, /scireview:lastBatchRunId/);
assert.match(submissionFormSource, /stageLabel/);
assert.match(submissionFormSource, /SITE_VERSION/);
assert.match(submissionFormSource, /FRONTEND_PAGE_LOADED_AT/);
assert.match(submissionFormSource, /batchRunId/);
assert.match(submissionFormSource, /queueItemId/);
assert.match(submissionFormSource, /registerBatchItems/);
assert.match(submissionFormSource, /\/api\/review-batches\/register/);
assert.match(submissionFormSource, /startBatchRuntimeMonitor/);
assert.match(submissionFormSource, /RUNTIME_POLL_INTERVAL_MS/);
assert.match(submissionFormSource, /detectRuntimeRestart/);
assert.match(submissionFormSource, /moved to the repair lane for manual retry/);
assert.doesNotMatch(submissionFormSource, /Temporary model\/API issue\. Retrying/);
assert.match(submissionFormSource, /frontendSiteVersion/);
assert.match(submissionFormSource, /clientRequestStartedAt/);
assert.match(submissionFormSource, /reportClientFailure/);
assert.match(submissionFormSource, /\/api\/review-attempts\/client-failure/);
assert.match(submissionFormSource, /fetchReviewRuntime/);
assert.match(submissionFormSource, /apiProcessStartedAfterPageLoad/);
assert.match(submissionFormSource, /The API was redeployed after this page loaded/);
assert.match(submissionFormSource, /Interrupted by server restart/);
assert.match(submissionFormSource, /Metadata helper/);
assert.match(submissionFormSource, /PDF fallback extraction helper/);
assert.match(submissionFormSource, /JSON parse failed/);
assert.match(submissionFormSource, /Extraction invalid: central manuscript content is missing or unusable/);
assert.match(submissionFormSource, /Paste manual extracted text for retry/);
assert.match(submissionFormSource, /Paste clean extracted manuscript text here/);
assert.match(submissionFormSource, /Use PDF-visible last resort on retry/);
assert.match(submissionFormSource, /pdfVisibleFallback: qf\.usePdfVisibleFallback/);

assert.match(engineSource, /deterministicSnapshotIsReviewable/);
assert.match(engineSource, /reviewInputSelfCheckError/);
assert.match(engineSource, /input self-check failed despite deterministic reviewable extraction/);

const comparatorPromptStart = engineSource.indexOf("const DIAGNOSTIC_COMPARATOR_CALIBRATION_PROMPT");
assert.notEqual(comparatorPromptStart, -1, "comparator calibration prompt missing");
const comparatorPrompt = engineSource.slice(comparatorPromptStart, engineSource.indexOf("function buildComparatorCalibrationInput", comparatorPromptStart));
assert.match(comparatorPrompt, /You may adjust only those three diagnostic scores/i);
assert.match(comparatorPrompt, /Do not output a free final score/i);
assert.match(comparatorPrompt, /calibratedInputStrengthScore/);
assert.match(comparatorPrompt, /calibratedConstructionStrengthScore/);
assert.match(comparatorPrompt, /calibratedOutputStrengthScore/);

const canonicalExportStart = routesSource.indexOf("const canonicalReview: Record<string, any> = {");
assert.notEqual(canonicalExportStart, -1, "canonical standard export block missing");
const canonicalExport = routesSource.slice(canonicalExportStart, routesSource.indexOf("return {\n          paper:", canonicalExportStart));
for (const forbidden of [
  "aggregate:",
  "finalIntrinsicReview:",
  "coverageLedger:",
  "scoreBand:",
  "finalScoreBand:",
]) {
  assert.equal(canonicalExport.includes(forbidden), false, `standard canonical export includes ${forbidden}`);
}

console.log("v17.1 review invariants passed");
