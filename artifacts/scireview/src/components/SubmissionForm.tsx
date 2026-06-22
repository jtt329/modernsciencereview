import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, X, BookOpen, Loader2, FileText, Upload, CheckCircle2, AlertCircle, Cpu, Trash2, Link, Monitor } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { ReviewSource, ReviewModel, ReviewMode } from '../services/reviewService';
import { SITE_VERSION } from '../lib/version';

interface SubmissionFormProps {
  onSubmit: (source: ReviewSource, skipSelect?: boolean, onJobUpdate?: (attempt: any) => void) => Promise<any>;
  onEnqueueReviewJob: (source: ReviewSource) => Promise<any>;
  onPollReviewJob: (jobId: string, onJobUpdate?: (attempt: any) => void) => Promise<any>;
  onReviewJobComplete: (data: any, skipSelect?: boolean) => Promise<void>;
  onClose: () => void;
  isAdmin?: boolean;
}

interface QueuedFile {
  id: string;
  file: File;
  status: 'pending' | 'processing' | 'done' | 'duplicate' | 'error';
  error?: string;
  attempt?: any;
  attemptId?: string;
  requestId?: string;
  manualText?: string;
  showManualText?: boolean;
  usePdfVisibleFallback?: boolean;
}

const MAX_QUEUED_PDFS = 50;
const BATCH_CONCURRENCY = 2;
const FRONTEND_PAGE_LOADED_AT = new Date().toISOString();
const RUNTIME_POLL_INTERVAL_MS = 5_000;

function makeClientId(prefix: string) {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${random}`;
}

const reviewModeCopy: Record<ReviewMode, { label: string; shortLabel: string; description: string; processing: string }> = {
  'benchmark-ingestion': {
    label: 'Benchmark ingestion',
    shortLabel: 'Gemini Pro x2 + blind adjudicator',
    description: 'Identity-blind intrinsic review only (the manuscript is stripped of identifying information; the model discloses if it nevertheless recognizes the work). Use this for building the benchmark suite before calibration backfill.',
    processing: 'Reviewing with Gemini Pro x2 + blind adjudicator...',
  },
  'normal-review': {
    label: 'Normal calibrated review',
    shortLabel: 'Gemini Pro x2 + blind adjudicator + calibration',
    description: 'Identity-blind review first, then calibrate against nearby benchmark papers if available.',
    processing: 'Reviewing with Gemini Pro x2 + blind adjudicator + calibration...',
  },
};

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function errorMessage(err: unknown) {
  if (err instanceof Error) return err.message || String(err);
  if (typeof ProgressEvent !== 'undefined' && err instanceof ProgressEvent) {
    return `Browser file/read request failed (${err.type || 'progress event'}).`;
  }
  if (typeof Event !== 'undefined' && err instanceof Event) {
    return `Browser event failed (${err.type || 'event'}).`;
  }
  return String(err);
}

function isConnectionLoss(message: string) {
  return /failed to fetch|load failed|networkerror|network request failed|connection|timed out|aborted/i.test(message);
}

function isDailyQuotaError(err: unknown) {
  const message = errorMessage(err);
  return Boolean((err as any)?.quotaExhausted) ||
    /daily request quota reached|generate_requests_per_model_per_day|per_model_per_day|please retry in|exceeded your current quota/i.test(message);
}

function stageLabel(stageName: string | null | undefined) {
  switch (stageName) {
    case 'upload_received':
      return 'Upload registered';
    case 'request_received':
      return 'Request received';
    case 'client_failure':
      return 'Browser/client request';
    case 'file_read_failed':
      return 'Browser file read';
    case 'interrupted_by_server_restart':
      return 'Server restart';
    case 'metadata_extraction':
    case 'title_author_extraction':
      return 'Metadata helper';
    case 'pdf_text_extraction':
      return 'PDF text extraction';
    case 'pdf_fallback_extraction':
      return 'PDF fallback extraction helper';
    case 'pdf_visible_last_resort':
      return 'PDF-visible review lane';
    case 'extraction_quality_check':
      return 'Extraction quality check';
    case 'blind_pass_1':
      return 'Blind pass 1';
    case 'blind_pass_2':
      return 'Blind pass 2';
    case 'adjudicator':
      return 'Adjudicator';
    case 'json_parse':
      return 'JSON parse';
    case 'review_validation':
      return 'Review validation';
    case 'save_review':
      return 'Save review';
    default:
      return stageName || 'Review attempt';
  }
}

function activeStageLabel(attempt: any) {
  const stageName = attempt?.stageName || attempt?.debugPayload?.stageName;
  const reviewStatus = attempt?.reviewStatus || attempt?.debugPayload?.jobStatus;
  if (reviewStatus === 'duplicate_existing') {
    return duplicateExistingMessage(attempt);
  }
  switch (stageName) {
    case 'upload_received':
      return 'Queued on server...';
    case 'request_received':
      return 'Worker picked up job...';
    case 'metadata_extraction':
    case 'title_author_extraction':
      return 'Extracting title and authors...';
    case 'pdf_text_extraction':
      return 'Extracting PDF text...';
    case 'pdf_fallback_extraction':
      return 'Repairing PDF extraction...';
    case 'pdf_visible_last_resort':
      return 'Using PDF-visible review lane...';
    case 'extraction_quality_check':
      return 'Checking extraction quality...';
    case 'blind_pass_1':
      return 'Generating blind pass 1...';
    case 'blind_pass_2':
      return 'Generating blind pass 2...';
    case 'adjudicator':
      return 'Running blind adjudicator...';
    case 'json_parse':
      return 'Parsing model JSON...';
    case 'review_validation':
      return 'Validating review...';
    case 'save_review':
      return 'Saving completed review...';
    case 'interrupted_by_server_restart':
      return 'Server redeployed during review; retry this item after refresh...';
    default:
      if (reviewStatus === 'queued') return 'Queued behind another paper...';
      if (reviewStatus === 'running') return 'Review worker running...';
      return reviewModeCopy['benchmark-ingestion'].processing;
  }
}

function duplicateExistingMessage(attempt: any, paper?: any) {
  const payload = attempt?.debugPayload || {};
  const title = payload.duplicateExistingTitle || paper?.title;
  const authors = payload.duplicateExistingAuthors || paper?.paperAuthors;
  const reviewId = payload.duplicateExistingReviewId;
  if (title && authors) {
    return `Already in system as "${title}" by ${authors}; existing review was not rerun.`;
  }
  if (title) {
    return `Already in system as "${title}"; existing review was not rerun.`;
  }
  if (reviewId) {
    return `Already in system; matched existing review ${reviewId}.`;
  }
  return 'Already in system; existing review was not rerun.';
}

function failureStatusLabel(value: string | null | undefined) {
  switch (value) {
    case 'completed':
      return 'Completed';
    case 'duplicate_existing':
      return 'Already in system';
    case 'failed_extraction_truncated':
      return 'Invalid extraction';
    case 'failed_pdf_fallback_json':
      return 'PDF fallback helper JSON failed';
    case 'failed_review_json':
      return 'Review JSON failed';
    case 'failed_validation':
      return 'Validation failed';
    case 'retryable':
      return 'Retryable';
    case 'interrupted_by_server_restart':
      return 'Interrupted by server restart';
    case 'needs_manual_repair':
      return 'Needs manual repair';
    case 'superseded':
      return 'Superseded';
    default:
      return value || '';
  }
}

function shortAttemptError(message: string) {
  const withoutRetryNoise = message
    .replace(/For more information on this error, head to:\s*https?:\/\/\S+/gi, '')
    .replace(/To monitor your current usage, head to:\s*https?:\/\/\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return withoutRetryNoise.length > 220 ? `${withoutRetryNoise.slice(0, 217)}...` : withoutRetryNoise;
}

function friendlySubmissionError(err: unknown) {
  const message = errorMessage(err);
  const attempt = (err as any)?.attempt;
  const normalizedMessage = message.trim();
  if (attempt?.reviewStatus === 'invalid_extraction_truncated' || (err as any)?.reviewStatus === 'invalid_extraction_truncated') {
    return 'Extraction invalid: central manuscript content is missing or unusable. Retry extraction, PDF fallback, or manual repair.';
  }
  if (attempt && typeof attempt === 'object') {
    if (
      attempt.reviewStatus === 'interrupted_by_server_restart' ||
      attempt.failureStatus === 'interrupted_by_server_restart' ||
      attempt.stageName === 'interrupted_by_server_restart'
    ) {
      return 'Server redeployed during review. This item is retryable; completed reviews were saved.';
    }
    const stage = stageLabel(attempt.stageName);
    const failureStatus = failureStatusLabel(attempt.failureStatus);
    const suffix = attempt.retryable ? ' Retryable.' : '';
    const helperPrefix = attempt.stageType === 'helper' ? `${stage} failed` : `${stage} failed`;
    if (attempt.stageName === 'file_read_failed') {
      return `${failureStatus ? `${failureStatus}: ` : ''}Browser file read failed: ${shortAttemptError(message)}.${suffix}`;
    }
    if (/json/i.test(message) || /bad escaped character/i.test(message)) {
      return `${failureStatus ? `${failureStatus}: ` : ''}${helperPrefix}: JSON parse failed: ${shortAttemptError(message)}.${suffix}`;
    }
    return `${failureStatus ? `${failureStatus}: ` : ''}${helperPrefix}: ${shortAttemptError(message)}.${suffix}`;
  }
  if (!normalizedMessage || normalizedMessage === 'Error' || normalizedMessage === '[object Object]') {
    return 'Request failed before a detailed API response was received. The client failure was logged for this batch; retry after refreshing if it repeats.';
  }
  if (!isDailyQuotaError(err)) return message;
  const retryText = (err as any)?.retryAfterText || message.match(/retry in\s*([^.;]+)/i)?.[1]?.trim();
  const retrySuffix = retryText ? ` Google says to retry in ${retryText}.` : '';
  return `Gemini Pro daily request quota reached.${retrySuffix} Completed papers were saved; retry the pending papers after the quota resets or raise the Gemini Pro daily request quota.`;
}

async function waitForApiHealth(maxWaitMs = 180_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < maxWaitMs) {
    try {
      const response = await fetch('/api/healthz', {
        credentials: 'include',
        cache: 'no-store',
      });
      if (response.ok) return true;
    } catch {}
    await sleep(5_000);
  }
  return false;
}

async function fetchReviewRuntime() {
  const response = await fetch('/api/review-runtime', {
    credentials: 'include',
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Could not verify API runtime before batch start (${response.status}).`);
  }
  return response.json();
}

function runtimeProcessStartedAt(runtimeInfo: any) {
  const processStartedAt = runtimeInfo?.build?.processStartedAt;
  return typeof processStartedAt === 'string' && processStartedAt ? processStartedAt : null;
}

type RuntimeRestartInfo = {
  oldProcessStartedAt: string;
  newProcessStartedAt: string;
  detectedAt: string;
  runtimeInfo: unknown;
};

function detectRuntimeRestart(previousRuntimeInfo: unknown, nextRuntimeInfo: unknown): RuntimeRestartInfo | null {
  const oldProcessStartedAt = runtimeProcessStartedAt(previousRuntimeInfo);
  const newProcessStartedAt = runtimeProcessStartedAt(nextRuntimeInfo);
  if (!oldProcessStartedAt || !newProcessStartedAt || oldProcessStartedAt === newProcessStartedAt) {
    return null;
  }
  const oldTimestamp = Date.parse(oldProcessStartedAt);
  const newTimestamp = Date.parse(newProcessStartedAt);
  if (!Number.isFinite(oldTimestamp) || !Number.isFinite(newTimestamp) || newTimestamp <= oldTimestamp + 1_000) {
    return null;
  }
  return {
    oldProcessStartedAt,
    newProcessStartedAt,
    detectedAt: new Date().toISOString(),
    runtimeInfo: nextRuntimeInfo,
  };
}

function apiProcessStartedAfterPageLoad(runtimeInfo: any) {
  const processStartedAt = runtimeInfo?.build?.processStartedAt;
  if (typeof processStartedAt !== 'string') return false;
  const processStarted = Date.parse(processStartedAt);
  const pageLoaded = Date.parse(FRONTEND_PAGE_LOADED_AT);
  return Number.isFinite(processStarted) && Number.isFinite(pageLoaded) && processStarted > pageLoaded + 5_000;
}

function classifyClientFailure(err: unknown) {
  if ((err as any)?.failureKind === 'file_read_failed') return 'file_read_failed';
  const message = errorMessage(err);
  const status = typeof (err as any)?.status === 'number' ? (err as any).status : null;
  if (/browser file\/read request failed|could not read selected pdf|file read failed/i.test(message)) return 'file_read_failed';
  if (/aborted|abort/i.test(message)) return 'abort';
  if (/timeout|timed out/i.test(message)) return 'timeout';
  if (/failed to fetch|load failed|networkerror|network request failed/i.test(message)) return 'failed_to_fetch';
  if (status) return `http_${status}`;
  if (/json|unexpected token|non-json/i.test(message)) return 'non_json_response';
  return 'frontend_failure';
}

function startBatchRuntimeMonitor(params: {
  initialRuntimeInfo: unknown;
  onRestart: (info: RuntimeRestartInfo) => void;
}) {
  let stopped = false;
  let restartInfo: RuntimeRestartInfo | null = null;
  let latestRuntimeInfo = params.initialRuntimeInfo;
  let recoveryPromise: Promise<RuntimeRestartInfo | null> | null = null;

  const poll = async () => {
    while (!stopped && !restartInfo) {
      await sleep(RUNTIME_POLL_INTERVAL_MS);
      if (stopped || restartInfo) break;
      try {
        const runtimeInfo = await fetchReviewRuntime();
        const detected = detectRuntimeRestart(latestRuntimeInfo, runtimeInfo);
        latestRuntimeInfo = runtimeInfo;
        if (detected) {
          restartInfo = detected;
          params.onRestart(detected);
          break;
        }
      } catch {
        // A transient failed runtime poll is expected during deploy restarts.
      }
    }
  };

  void poll();

  return {
    stop() {
      stopped = true;
    },
    getLatestRuntimeInfo() {
      return latestRuntimeInfo;
    },
    getRestartInfo() {
      return restartInfo;
    },
    noteRuntime(runtimeInfo: unknown) {
      latestRuntimeInfo = runtimeInfo;
      const detected = detectRuntimeRestart(params.initialRuntimeInfo, runtimeInfo);
      if (detected && !restartInfo) {
        restartInfo = detected;
        params.onRestart(detected);
      }
      return restartInfo;
    },
    async waitForRecovery() {
      if (!restartInfo) return null;
      if (!recoveryPromise) {
        recoveryPromise = (async () => {
          await waitForApiHealth(120_000);
          try {
            const runtimeInfo = await fetchReviewRuntime();
            latestRuntimeInfo = runtimeInfo;
            const updated = detectRuntimeRestart(params.initialRuntimeInfo, runtimeInfo);
            if (updated) restartInfo = { ...updated, detectedAt: restartInfo?.detectedAt ?? updated.detectedAt };
          } catch {}
          return restartInfo;
        })();
      }
      return recoveryPromise;
    },
  };
}

async function reportClientFailure(params: {
  qf: QueuedFile;
  source: ReviewSource;
  err: unknown;
  clientRequestStartedAt: string;
  clientRequestEndedAt: string;
  apiRuntimeInfo: unknown;
  runtimeRestartInfo?: RuntimeRestartInfo | null;
}) {
  const failureKind = params.runtimeRestartInfo ? 'interrupted_by_server_restart' : classifyClientFailure(params.err);
  const body = JSON.stringify({
    fileName: params.qf.file.name,
    batchRunId: params.source.batchRunId,
    queueItemId: params.source.queueItemId,
    attemptId: params.source.attemptId,
    requestId: params.source.requestId,
    frontendSiteVersion: SITE_VERSION,
    frontendPageLoadedAt: FRONTEND_PAGE_LOADED_AT,
    apiRuntimeVersion: params.apiRuntimeInfo,
    apiRuntimeRestartDetectedAt: params.runtimeRestartInfo?.detectedAt ?? null,
    apiRuntimePreviousProcessStartedAt: params.runtimeRestartInfo?.oldProcessStartedAt ?? null,
    apiRuntimeCurrentProcessStartedAt: params.runtimeRestartInfo?.newProcessStartedAt ?? null,
    apiRuntimeAfterRestart: params.runtimeRestartInfo?.runtimeInfo ?? null,
    clientRequestStartedAt: params.clientRequestStartedAt,
    clientRequestEndedAt: params.clientRequestEndedAt,
    errorName: params.err instanceof Error ? params.err.name : typeof params.err,
    errorMessage: params.runtimeRestartInfo
      ? 'Server restarted during review; item moved to repair lane for manual retry.'
      : errorMessage(params.err),
    httpStatus: typeof (params.err as any)?.status === 'number' ? (params.err as any).status : null,
    failureKind,
  });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch('/api/review-attempts/client-failure', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      if (!response.ok) return null;
      const payload = await response.json();
      return payload?.attempt ?? null;
    } catch {
      if (attempt === 0) {
        await waitForApiHealth(60_000);
      } else {
        await sleep(1_000 * (attempt + 1));
      }
    }
  }
  return null;
}

async function registerBatchItems(params: {
  batchRunId: string;
  files: QueuedFile[];
  reviewMode: ReviewMode;
  apiRuntimeInfo: unknown;
}) {
  const response = await fetch('/api/review-batches/register', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      batchRunId: params.batchRunId,
      frontendSiteVersion: SITE_VERSION,
      frontendPageLoadedAt: FRONTEND_PAGE_LOADED_AT,
      apiRuntimeVersion: params.apiRuntimeInfo,
      items: params.files.map((qf) => ({
        queueItemId: qf.id,
        attemptId: qf.attemptId,
        requestId: qf.requestId,
        fileName: qf.file.name,
        fileSize: qf.file.size,
        reviewMode: params.reviewMode,
      })),
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Could not register this review batch (${response.status}). ${text}`.trim());
  }
  return response.json();
}

function isValidUrl(value: string) {
  try { new URL(value); return true; } catch { return false; }
}

export default function SubmissionForm({
  onSubmit,
  onEnqueueReviewJob,
  onPollReviewJob,
  onReviewJobComplete,
  onClose,
  isAdmin = false,
}: SubmissionFormProps) {
  const [submissionType, setSubmissionType] = useState<'pdf' | 'text'>('pdf');
  const [model, setModel] = useState<ReviewModel>('gemini');
  const [reviewMode, setReviewMode] = useState<ReviewMode>(isAdmin ? 'benchmark-ingestion' : 'normal-review');
  const [text, setText] = useState('');
  const [files, setFiles] = useState<QueuedFile[]>([]);
  const [providePdfLink, setProvidePdfLink] = useState(false);
  const [displayPdf, setDisplayPdf] = useState(false);
  const [pdfUrl, setPdfUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batchCompleteMessage, setBatchCompleteMessage] = useState<string | null>(null);
  const [doneCount, setDoneCount] = useState(0);

  const isBatch = files.length > 1;
  const isHandledFile = (file: QueuedFile) => file.status === 'done' || file.status === 'duplicate';
  const remainingFiles = files.filter(f => !isHandledFile(f));
  const failedFiles = files.filter(f => f.status === 'error');
  const effectiveReviewMode: ReviewMode = isAdmin ? reviewMode : 'normal-review';

  const onDrop = useCallback((acceptedFiles: File[]) => {
    setError(null);
    setBatchCompleteMessage(null);
    const pdfs = acceptedFiles.filter(f => f.type === 'application/pdf');
    if (pdfs.length === 0) {
      setError('Please upload PDF files.');
      return;
    }
    setFiles(prev => {
      const remainingSlots = Math.max(0, MAX_QUEUED_PDFS - prev.length);
      const accepted = pdfs.slice(0, remainingSlots);
      if (accepted.length < pdfs.length) {
        setError(`You can queue up to ${MAX_QUEUED_PDFS} PDFs at a time. Extra files were not added.`);
      }
      return [
        ...prev,
        ...accepted.map(f => ({ id: makeClientId('queue'), file: f, status: 'pending' as const })),
      ];
    });
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    multiple: true,
    disabled: isSubmitting || files.length >= MAX_QUEUED_PDFS,
  });

  const removeFile = (id: string) => setFiles(prev => prev.filter(f => f.id !== id));

  const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  };

  const readFileAsArrayBufferFallback = (file: File): Promise<ArrayBuffer> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error || new Error(`FileReader failed while reading ${file.name}.`));
      reader.onabort = () => reject(new Error(`FileReader was aborted while reading ${file.name}.`));
      reader.readAsArrayBuffer(file);
    });

  const readFileAsBase64 = async (file: File): Promise<string> => {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const buffer = typeof file.arrayBuffer === 'function'
          ? await file.arrayBuffer()
          : await readFileAsArrayBufferFallback(file);
        return arrayBufferToBase64(buffer);
      } catch (err) {
        lastError = err;
        if (attempt === 0) await sleep(250);
      }
    }
    const message = errorMessage(lastError);
    const error = new Error(`Browser could not read selected PDF file "${file.name}" (${(file.size / 1024 / 1024).toFixed(1)} MB): ${message}`);
    (error as any).failureKind = 'file_read_failed';
    throw error;
  };

  const setFileStatus = (id: string, patch: Partial<QueuedFile>) => {
    setFiles(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f));
  };

  const submitWithRetries = async (
    qf: QueuedFile,
    source: ReviewSource,
    skipSelectAfterSubmit: boolean,
    runtimeState: { initial: unknown; current: unknown; restartInfo: RuntimeRestartInfo | null },
    runtimeMonitor?: ReturnType<typeof startBatchRuntimeMonitor>,
  ) => {
    let lastError: unknown;

    for (let attempt = 0; attempt < 1; attempt++) {
      try {
        setFileStatus(qf.id, { status: 'processing', error: undefined });
        source.apiRuntimeVersion = runtimeState.current;
        source.apiRuntimeAtBatchStart = runtimeState.initial;
        source.apiRuntimeProcessStartedAt = runtimeProcessStartedAt(runtimeState.current) ?? undefined;
        if (runtimeState.restartInfo) {
          source.apiRuntimeRestartDetectedAt = runtimeState.restartInfo.detectedAt;
          source.apiRuntimePreviousProcessStartedAt = runtimeState.restartInfo.oldProcessStartedAt;
          source.apiRuntimeCurrentProcessStartedAt = runtimeState.restartInfo.newProcessStartedAt;
        }
        return await onSubmit(source, skipSelectAfterSubmit, (attempt) => {
          setFileStatus(qf.id, {
            status: 'processing',
            attempt,
            error: activeStageLabel(attempt),
          });
        });
      } catch (err) {
        lastError = err;
        let restartInfo = runtimeMonitor?.getRestartInfo() ?? runtimeState.restartInfo;
        if (!restartInfo && isConnectionLoss(errorMessage(err))) {
          try {
            const runtimeInfo = await fetchReviewRuntime();
            restartInfo = detectRuntimeRestart(runtimeState.current, runtimeInfo) || detectRuntimeRestart(runtimeState.initial, runtimeInfo);
            runtimeState.current = runtimeInfo;
            if (restartInfo) {
              runtimeMonitor?.noteRuntime(runtimeInfo);
            }
          } catch {}
        }
        if (restartInfo && !runtimeState.restartInfo) {
          runtimeState.restartInfo = restartInfo;
          runtimeState.current = restartInfo.runtimeInfo;
        }
        if (!(err as any)?.attempt) {
          const clientAttempt = await reportClientFailure({
            qf,
            source,
            err,
            clientRequestStartedAt: source.clientRequestStartedAt || new Date().toISOString(),
            clientRequestEndedAt: new Date().toISOString(),
            apiRuntimeInfo: runtimeState.current,
            runtimeRestartInfo: restartInfo,
          });
          if (clientAttempt && typeof err === 'object' && err !== null) {
            (err as any).attempt = clientAttempt;
          }
        }
        if (restartInfo) {
          setFileStatus(qf.id, {
            status: 'error',
            error: 'Server restarted during review; moved to the repair lane for manual retry.',
            attempt: (err as any)?.attempt,
          });
        }
        break;
      }
    }

    throw lastError;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBatchCompleteMessage(null);
    setIsSubmitting(true);
    setDoneCount(0);

    const linkUrl = providePdfLink && isValidUrl(pdfUrl.trim()) ? pdfUrl.trim() : undefined;

    try {
      const apiRuntimeInfo = await fetchReviewRuntime();
      if (apiProcessStartedAfterPageLoad(apiRuntimeInfo)) {
        setError('The API was redeployed after this page loaded. Please refresh Modern Science Review before starting this batch so the frontend and API versions match.');
        return;
      }
      const runtimeState: { initial: unknown; current: unknown; restartInfo: RuntimeRestartInfo | null } = {
        initial: apiRuntimeInfo,
        current: apiRuntimeInfo,
        restartInfo: null,
      };
      const batchRunId = makeClientId('batch');
      try {
        localStorage.setItem('scireview:lastBatchRunId', batchRunId);
      } catch {}

      if (submissionType === 'text') {
        if (!text.trim()) return;
        const clientRequestStartedAt = new Date().toISOString();
        await onSubmit({
          type: 'text',
          data: text.trim(),
          model,
          reviewMode: effectiveReviewMode,
          batchRunId,
          queueItemId: makeClientId('queue'),
          attemptId: makeClientId('attempt'),
          requestId: makeClientId('request'),
          frontendSiteVersion: SITE_VERSION,
          frontendPageLoadedAt: FRONTEND_PAGE_LOADED_AT,
          clientRequestStartedAt,
          apiRuntimeVersion: apiRuntimeInfo,
          apiRuntimeAtBatchStart: apiRuntimeInfo,
          apiRuntimeProcessStartedAt: runtimeProcessStartedAt(apiRuntimeInfo) ?? undefined,
        });
        onClose();
        return;
      }

      const filesToProcess = files.filter(f => !isHandledFile(f));
      if (filesToProcess.length === 0) {
        setBatchCompleteMessage('All queued papers are already handled. Click OK to return to the homepage.');
        return;
      }
      const filesWithAuditIds = filesToProcess.map((qf) => ({
        ...qf,
        attemptId: qf.attemptId || makeClientId('attempt'),
        requestId: qf.requestId || makeClientId('request'),
      }));
      setFiles(prev => prev.map((file) => {
        const withAudit = filesWithAuditIds.find((candidate) => candidate.id === file.id);
        return withAudit ? { ...file, attemptId: withAudit.attemptId, requestId: withAudit.requestId } : file;
      }));
      await registerBatchItems({
        batchRunId,
        files: filesWithAuditIds,
        reviewMode: effectiveReviewMode,
        apiRuntimeInfo,
      });

      let done = files.filter(isHandledFile).length;
      let failures = 0;
      const skipSelectAfterSubmit = files.length > 1;
      setDoneCount(done);
      let batchHalted = false;
      let haltMessage: string | null = null;
      const runtimeMonitor = startBatchRuntimeMonitor({
        initialRuntimeInfo: apiRuntimeInfo,
        onRestart: (restartInfo) => {
          runtimeState.restartInfo = restartInfo;
          runtimeState.current = restartInfo.runtimeInfo;
          setError('Server redeployed during this batch. Durable jobs remain on the server; interrupted running items will become retryable and queued items will continue after the API is healthy.');
        },
      });

      const waitForRuntimeIfRestarted = async () => {
        const restartInfo = runtimeMonitor.getRestartInfo();
        if (!restartInfo) return;
        setError('Server redeployed during this batch. Waiting for the API to become healthy before continuing queue setup.');
        await runtimeMonitor.waitForRecovery();
        try {
          const runtimeInfo = await fetchReviewRuntime();
          runtimeState.current = runtimeInfo;
          runtimeMonitor.noteRuntime(runtimeInfo);
        } catch {}
      };

      type JobEntry = { qf: QueuedFile; jobId: string; attempt?: any };

      const sourceAuditFieldsForFile = (qf: QueuedFile, clientRequestStartedAt = new Date().toISOString()) => ({
        model,
        reviewMode: effectiveReviewMode,
        fileName: qf.file.name,
        pdfUrl: linkUrl,
        displayPdf: displayPdf && !!linkUrl,
        batchRunId,
        queueItemId: qf.id,
        attemptId: qf.attemptId || makeClientId('attempt'),
        requestId: qf.requestId || makeClientId('request'),
        frontendSiteVersion: SITE_VERSION,
        frontendPageLoadedAt: FRONTEND_PAGE_LOADED_AT,
        clientRequestStartedAt,
        apiRuntimeVersion: runtimeState.current,
        apiRuntimeAtBatchStart: runtimeState.initial,
        apiRuntimeProcessStartedAt: runtimeProcessStartedAt(runtimeState.current) ?? undefined,
        apiRuntimeRestartDetectedAt: runtimeState.restartInfo?.detectedAt,
        apiRuntimePreviousProcessStartedAt: runtimeState.restartInfo?.oldProcessStartedAt,
        apiRuntimeCurrentProcessStartedAt: runtimeState.restartInfo?.newProcessStartedAt,
      });

      const buildSourceForFile = async (qf: QueuedFile, auditFields = sourceAuditFieldsForFile(qf)): Promise<ReviewSource> => {
        const manualText = qf.manualText?.trim();
        const base64 = manualText ? '' : await readFileAsBase64(qf.file);
        return {
          ...(manualText
            ? { type: 'text' as const, data: manualText, ...auditFields }
            : { type: 'pdf' as const, data: base64, ...auditFields, pdfVisibleFallback: qf.usePdfVisibleFallback }),
        };
      };

      const enqueueOne = async (qf: QueuedFile): Promise<JobEntry | null> => {
        if (batchHalted) return null;
        await waitForRuntimeIfRestarted();
        if (batchHalted) return null;
        setFileStatus(qf.id, { status: 'processing', error: 'Queued on server...' });
        let sourceWithAudit: ReviewSource | null = null;
        try {
          const auditFields = sourceAuditFieldsForFile(qf);
          sourceWithAudit = {
            type: qf.manualText?.trim() ? 'text' : 'pdf',
            data: qf.manualText?.trim() || '',
            ...auditFields,
            pdfVisibleFallback: qf.usePdfVisibleFallback,
          };
          sourceWithAudit = await buildSourceForFile(qf, auditFields);
          const job = await onEnqueueReviewJob(sourceWithAudit);
          const jobId = job?.jobId || job?.attempt?.attemptId;
          if (!jobId) throw new Error('Review job was created without a job id.');
          setFileStatus(qf.id, {
            status: 'processing',
            error: activeStageLabel(job?.attempt),
            attempt: job?.attempt,
          });
          return { qf, jobId, attempt: job?.attempt };
        } catch (err: any) {
          failures++;
          let restartInfo = runtimeMonitor.getRestartInfo() ?? runtimeState.restartInfo;
          if (!restartInfo && isConnectionLoss(errorMessage(err))) {
            try {
              const runtimeInfo = await fetchReviewRuntime();
              restartInfo = detectRuntimeRestart(runtimeState.current, runtimeInfo) || detectRuntimeRestart(runtimeState.initial, runtimeInfo);
              runtimeState.current = runtimeInfo;
              if (restartInfo) runtimeMonitor.noteRuntime(runtimeInfo);
            } catch {}
          }
          if (sourceWithAudit && !(err as any)?.attempt) {
            const clientAttempt = await reportClientFailure({
              qf,
              source: sourceWithAudit,
              err,
              clientRequestStartedAt: sourceWithAudit.clientRequestStartedAt || new Date().toISOString(),
              clientRequestEndedAt: new Date().toISOString(),
              apiRuntimeInfo: runtimeState.current,
              runtimeRestartInfo: restartInfo,
            });
            if (clientAttempt && typeof err === 'object' && err !== null) {
              (err as any).attempt = clientAttempt;
            }
          }
          const message = friendlySubmissionError(err);
          if (isDailyQuotaError(err)) {
            batchHalted = true;
            haltMessage = message;
          }
          setFileStatus(qf.id, { status: 'error', error: message, attempt: err?.attempt });
          return null;
        }
      };

      const jobEntries = (await Promise.all(filesWithAuditIds.map(enqueueOne)))
        .filter((entry): entry is JobEntry => Boolean(entry));

      let pollIndex = 0;
      const processJob = async (entry: JobEntry) => {
        try {
          const data = await onPollReviewJob(entry.jobId, (attempt) => {
            setFileStatus(entry.qf.id, {
              status: 'processing',
              attempt,
              error: activeStageLabel(attempt),
            });
          });
          await onReviewJobComplete(data, skipSelectAfterSubmit);
          done++;
          setDoneCount(done);
          const attempt = data?.attempt;
          if (attempt?.reviewStatus === 'duplicate_existing') {
            setFileStatus(entry.qf.id, {
              status: 'duplicate',
              error: duplicateExistingMessage(attempt, data?.paper),
              attempt,
            });
          } else {
            setFileStatus(entry.qf.id, { status: 'done', error: undefined, attempt: undefined });
          }
        } catch (err: any) {
          failures++;
          const message = friendlySubmissionError(err);
          if (isDailyQuotaError(err)) {
            batchHalted = true;
            haltMessage = message;
          }
          setFileStatus(entry.qf.id, { status: 'error', error: message, attempt: err?.attempt });
        }
      };

      const pollWorkers = Array.from(
        { length: Math.min(BATCH_CONCURRENCY, jobEntries.length) },
        async () => {
          while (!batchHalted && pollIndex < jobEntries.length) {
            const entry = jobEntries[pollIndex++];
            await processJob(entry);
          }
        },
      );

      await Promise.all(pollWorkers);
      runtimeMonitor.stop();

      if (failures > 0) {
        const message = haltMessage || `${failures} of ${filesToProcess.length} remaining papers need retry or repair. Completed papers were saved.`;
        setError(message);
        setBatchCompleteMessage('Batch finished with items in the repair lane. Review the rows above, then retry or repair only those items.');
      } else {
        setBatchCompleteMessage(`${filesToProcess.length} of ${filesToProcess.length} papers completed. Click OK to return to the homepage.`);
      }
    } catch (err: any) {
      setError(err?.message ?? String(err) ?? 'Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const pdfUrlValid = isValidUrl(pdfUrl.trim());
  const isFormValid = submissionType === 'text'
    ? !!text.trim()
    : remainingFiles.length > 0;
  const batchHasRetryableItems = remainingFiles.length > 0;
  const primaryButtonClosesModal = Boolean(batchCompleteMessage && !isSubmitting && !batchHasRetryableItems);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-white w-full max-w-4xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-indigo-600 text-white">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-2 rounded-xl">
              <BookOpen className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-black tracking-tight">Submit Scientific Paper</h2>
              <p className="text-xs font-bold text-indigo-200 uppercase tracking-widest">
                Blind AI Review · {reviewModeCopy[effectiveReviewMode].shortLabel}
                {isBatch && ` · ${files.length} papers queued`}
              </p>
            </div>
          </div>
          <button onClick={onClose} disabled={isSubmitting} className="p-2 hover:bg-white/10 rounded-full transition-colors disabled:opacity-40">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-8 space-y-8">

          {/* Method + Model row */}
          <div className="flex flex-col sm:flex-row gap-6">
            <div className="space-y-4 flex-1">
              <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Submission Method</label>
              <div className="flex gap-2">
                {[
                  { id: 'pdf', label: 'PDF Upload', icon: FileText },
                  { id: 'text', label: 'Raw Text', icon: Upload },
                ].map((type) => (
                  <button
                    key={type.id}
                    type="button"
                    onClick={() => { setSubmissionType(type.id as 'pdf' | 'text'); setFiles([]); }}
                    disabled={isSubmitting}
                    className={`flex items-center gap-2 px-5 py-3 rounded-xl font-bold text-sm transition-all border ${
                      submissionType === type.id
                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-lg shadow-indigo-100'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <type.icon className="w-4 h-4" />
                    {type.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <label className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                <Cpu className="w-3 h-3" /> Review Model
              </label>
              <div className="flex flex-wrap gap-2">
                {(([
                  { id: 'gemini', label: 'Gemini 3.1 Pro x2 + Calibration', adminOnly: false },
                  // Paid alternates are admin-gated to protect public cost; the
                  // backend accepts any of the three (brief #3, C).
                  { id: 'gpt', label: 'GPT-5.5 (standard)', adminOnly: true },
                  { id: 'glm', label: 'GLM-5.2 (OpenRouter)', adminOnly: true },
                ] as const).filter((m) => isAdmin || !m.adminOnly)).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setModel(m.id)}
                    disabled={isSubmitting}
                    className={`px-4 py-3 rounded-xl font-bold text-sm transition-all border ${
                      model === m.id
                        ? 'bg-violet-600 text-white border-violet-600 shadow-lg shadow-violet-100'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {isAdmin && (
            <div className="space-y-3">
              <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Review Mode</label>
              <div className="grid sm:grid-cols-2 gap-3">
                {(['benchmark-ingestion', 'normal-review'] as ReviewMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setReviewMode(mode)}
                    disabled={isSubmitting}
                    className={`text-left p-4 rounded-2xl border transition-all ${
                      reviewMode === mode
                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-lg shadow-indigo-100'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <p className="text-sm font-black">{reviewModeCopy[mode].label}</p>
                    <p className={`text-xs mt-1 ${reviewMode === mode ? 'text-indigo-100' : 'text-slate-500'}`}>
                      {reviewModeCopy[mode].description}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* PDF section */}
          {submissionType === 'pdf' && (
            <div className="space-y-5">
              {/* Dropzone */}
              <div
                {...getRootProps()}
                className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all ${
                  isDragActive ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 hover:border-indigo-400 hover:bg-indigo-50/40'
                } ${isSubmitting ? 'pointer-events-none opacity-60' : ''}`}
              >
                <input {...getInputProps()} />
                <FileText className="w-10 h-10 text-slate-400 mx-auto mb-3" />
                <p className="font-bold text-slate-700">
                  {isDragActive ? 'Drop PDFs here…' : 'Drop PDFs here, or click to browse'}
                </p>
                <p className="text-sm text-slate-400 mt-1">
                  Queue up to {MAX_QUEUED_PDFS} PDFs. Up to {BATCH_CONCURRENCY} files are reviewed at once and saved as each review finishes.
                </p>
              </div>

              {/* File list */}
              {files.length > 0 && (
                <div className="space-y-2">
                  {files.map(qf => (
                    <div
                      key={qf.id}
                      className={`p-3 rounded-xl border text-sm ${
                        qf.status === 'done' ? 'bg-emerald-50 border-emerald-200' :
                        qf.status === 'duplicate' ? 'bg-sky-50 border-sky-200' :
                        qf.status === 'error' ? 'bg-rose-50 border-rose-200' :
                        qf.status === 'processing' ? 'bg-indigo-50 border-indigo-200' :
                        'bg-slate-50 border-slate-200'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {qf.status === 'processing' ? (
                          <Loader2 className="w-4 h-4 text-indigo-500 animate-spin shrink-0" />
                        ) : qf.status === 'done' ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                        ) : qf.status === 'duplicate' ? (
                          <CheckCircle2 className="w-4 h-4 text-sky-500 shrink-0" />
                        ) : qf.status === 'error' ? (
                          <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
                        ) : (
                          <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-slate-800 truncate">{qf.file.name}</p>
                          {qf.status === 'processing' && (
                            <p className="text-xs text-indigo-500 break-words">{qf.error || reviewModeCopy[effectiveReviewMode].processing}</p>
                          )}
                          {qf.status === 'duplicate' && (
                            <p className="text-xs text-sky-600 break-words">{qf.error || 'Already in system.'}</p>
                          )}
                          {qf.status === 'error' && <p className="text-xs text-rose-600 break-words">{qf.error}</p>}
                        </div>
                        <span className="text-[10px] text-slate-400 font-bold shrink-0">
                          {(qf.file.size / 1024 / 1024).toFixed(1)} MB
                        </span>
                        {!isSubmitting && qf.status === 'pending' && (
                          <button onClick={() => removeFile(qf.id)} className="p-1 hover:bg-slate-200 rounded-lg transition-colors shrink-0">
                            <Trash2 className="w-3.5 h-3.5 text-slate-400" />
                          </button>
                        )}
                      </div>
                      {qf.status === 'error' && qf.attempt && (
                        <div className="mt-3 ml-7 rounded-xl border border-rose-100 bg-white/70 p-3 text-xs text-slate-600 space-y-1">
                          <p><span className="font-black text-slate-500">Status:</span> {failureStatusLabel(qf.attempt.failureStatus)}</p>
                          <p><span className="font-black text-slate-500">Failed stage:</span> {stageLabel(qf.attempt.stageName)}</p>
                          <p><span className="font-black text-slate-500">Extraction:</span> {qf.attempt.extractionCompletenessStatus || 'not recorded'}</p>
                          <p><span className="font-black text-slate-500">PDF fallback:</span> {qf.attempt.pdfFallbackAttempted ? 'attempted' : 'not attempted'}{qf.attempt.fallbackSucceeded ? ', succeeded' : ''}</p>
                          <p><span className="font-black text-slate-500">Scientific scoring:</span> {qf.attempt.scientificScoringAttempted ? 'attempted' : 'not attempted'}</p>
                          {isAdmin && (
                            <div className="mt-2 flex flex-wrap gap-3">
                              <button
                                type="button"
                                className="text-xs font-black text-indigo-600 hover:text-indigo-800"
                                onClick={() => setFileStatus(qf.id, { showManualText: !qf.showManualText })}
                              >
                                {qf.showManualText ? 'Hide manual extracted text repair' : 'Paste manual extracted text for retry'}
                              </button>
                              <button
                                type="button"
                                className={`text-xs font-black ${qf.usePdfVisibleFallback ? 'text-amber-700' : 'text-slate-500 hover:text-amber-700'}`}
                                onClick={() => setFileStatus(qf.id, { usePdfVisibleFallback: !qf.usePdfVisibleFallback })}
                              >
                                {qf.usePdfVisibleFallback ? 'PDF-visible last resort enabled' : 'Use PDF-visible last resort on retry'}
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                      {isAdmin && qf.showManualText && (
                        <div className="mt-3 ml-7 space-y-2">
                          <textarea
                            value={qf.manualText || ''}
                            onChange={(event) => setFileStatus(qf.id, { manualText: event.target.value })}
                            disabled={isSubmitting}
                            placeholder="Paste clean extracted manuscript text here. It will still be blinded before benchmark review."
                            className="w-full min-h-[140px] rounded-xl border border-indigo-200 bg-white p-3 text-xs font-mono text-slate-700 outline-none focus:ring-2 focus:ring-indigo-300"
                          />
                          <p className="text-[11px] font-semibold text-slate-500">Retry will use this text instead of PDF extraction for this file.</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Optional extras */}
              <div className="space-y-3 pt-1">
                {/* Checkbox: Provide PDF web link */}
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => { setProvidePdfLink(v => !v); if (providePdfLink) { setPdfUrl(''); setDisplayPdf(false); } }}
                    disabled={isSubmitting}
                    className="flex items-center gap-3 group"
                  >
                    <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-all ${
                      providePdfLink ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300 group-hover:border-indigo-400'
                    }`}>
                      {providePdfLink && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
                    </div>
                    <div className="text-left">
                      <p className="font-bold text-slate-800 text-sm flex items-center gap-1.5">
                        <Link className="w-3.5 h-3.5 text-slate-500" /> Provide PDF web link
                      </p>
                      <p className="text-xs text-slate-500">Adds a clickable link on the review page so visitors can read the source PDF</p>
                    </div>
                  </button>

                  <AnimatePresence>
                    {providePdfLink && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="pl-8"
                      >
                        <div className="relative">
                          <Link className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                          <input
                            type="url"
                            value={pdfUrl}
                            onChange={e => setPdfUrl(e.target.value)}
                            disabled={isSubmitting}
                            placeholder="https://arxiv.org/pdf/..."
                            className={`w-full pl-11 pr-4 py-3 rounded-xl border text-sm font-medium transition-all outline-none focus:ring-2 ${
                              pdfUrl && !pdfUrlValid
                                ? 'border-rose-300 bg-rose-50 focus:ring-rose-300'
                                : pdfUrlValid
                                  ? 'border-emerald-300 bg-emerald-50 focus:ring-emerald-300'
                                  : 'border-slate-200 bg-white focus:ring-indigo-300'
                            }`}
                          />
                        </div>
                        {pdfUrl && !pdfUrlValid && (
                          <p className="text-xs text-rose-600 font-medium mt-1">Please enter a valid URL</p>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Checkbox: Display PDF with review */}
                <button
                  type="button"
                  onClick={() => setDisplayPdf(v => !v)}
                  disabled={isSubmitting || (!providePdfLink || !pdfUrlValid)}
                  className={`flex items-center gap-3 group ${(!providePdfLink || !pdfUrlValid) ? 'opacity-40 cursor-not-allowed' : ''}`}
                >
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-all ${
                    displayPdf && providePdfLink && pdfUrlValid ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300 group-hover:border-indigo-400'
                  }`}>
                    {displayPdf && providePdfLink && pdfUrlValid && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
                  </div>
                  <div className="text-left">
                    <p className="font-bold text-slate-800 text-sm flex items-center gap-1.5">
                      <Monitor className="w-3.5 h-3.5 text-slate-500" /> Display PDF with review
                    </p>
                    <p className="text-xs text-slate-500">Embeds the PDF inline on the review page using the web link above</p>
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* Text section */}
          {submissionType === 'text' && (
            <div className="space-y-4">
              <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Paper Content</label>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Paste the full text of your paper here..."
                disabled={isSubmitting}
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-5 text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all resize-none min-h-[300px]"
              />
            </div>
          )}

          {error && (
            <div className="flex items-start gap-3 bg-rose-50 border border-rose-200 rounded-2xl p-5">
              <AlertCircle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
              <p className="text-rose-700 text-sm font-medium">{error}</p>
            </div>
          )}

          {batchCompleteMessage && !isSubmitting && (
            <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-200 rounded-2xl p-5">
              <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
              <p className="text-emerald-700 text-sm font-medium">{batchCompleteMessage}</p>
            </div>
          )}

          {isSubmitting && (
            <div className="flex items-start gap-3 bg-indigo-50 border border-indigo-100 rounded-2xl p-5">
              <Loader2 className="w-5 h-5 text-indigo-500 animate-spin shrink-0 mt-0.5" />
              <div>
                <p className="text-indigo-800 text-sm font-bold">
                  {isBatch
                    ? `Reviewing paper ${doneCount + 1} of ${files.length}…`
                    : 'Generating blind peer review…'}
                </p>
                <p className="text-indigo-500 text-xs mt-1">
                  {isBatch
                    ? `Up to ${BATCH_CONCURRENCY} papers are reviewed at once. Each completed paper is saved immediately, and failed papers move to a repair lane without blocking the rest of the queue.`
                    : effectiveReviewMode === 'benchmark-ingestion'
                      ? 'This runs metadata extraction, two independent blind Gemini Pro review passes, and a blind Gemini Pro adjudicator. Comparator calibration is skipped for benchmark ingestion.'
                      : 'This runs metadata extraction, two independent blind Gemini Pro review passes, a blind Gemini Pro adjudicator, then benchmark comparator calibration. Please keep this window open.'}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-slate-100 flex justify-end gap-4">
          <button onClick={onClose} disabled={isSubmitting} className="px-6 py-3 rounded-2xl font-bold text-slate-500 hover:text-slate-700 disabled:opacity-40 transition-colors">
            Cancel
          </button>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={primaryButtonClosesModal ? onClose : handleSubmit}
            disabled={isSubmitting || (!batchCompleteMessage && !isFormValid)}
            className="bg-indigo-600 text-white px-8 py-3 rounded-2xl font-black shadow-xl shadow-indigo-100 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-3"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                {isBatch ? `${doneCount}/${files.length} done…` : reviewModeCopy[effectiveReviewMode].processing}
              </>
            ) : (
              <>
                {batchCompleteMessage ? <CheckCircle2 className="w-5 h-5" /> : <Send className="w-5 h-5" />}
                {primaryButtonClosesModal
                  ? 'OK'
                  : failedFiles.length > 0
                  ? `Retry ${remainingFiles.length} Failed/Pending`
                  : isBatch
                    ? `Submit ${files.length} Papers`
                    : 'Submit for AI Review'}
              </>
            )}
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}
