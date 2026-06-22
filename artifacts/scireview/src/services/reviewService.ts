export type ReviewModel = 'gpt' | 'gemini' | 'glm';
export type ReviewMode = 'benchmark-ingestion' | 'normal-review';

export interface ReviewSource {
  type: 'text' | 'pdf' | 'url';
  data: string;
  model?: ReviewModel;
  reviewMode?: ReviewMode;
  fileName?: string;
  pdfUrl?: string;
  displayPdf?: boolean;
  forceFreshReview?: boolean;
  reuseExistingReview?: boolean;
  pdfVisibleFallback?: boolean;
  batchRunId?: string;
  queueItemId?: string;
  attemptId?: string;
  requestId?: string;
  frontendSiteVersion?: string;
  frontendPageLoadedAt?: string;
  clientRequestStartedAt?: string;
  apiRuntimeVersion?: unknown;
  apiRuntimeAtBatchStart?: unknown;
  apiRuntimeProcessStartedAt?: string;
  apiRuntimeRestartDetectedAt?: string;
  apiRuntimePreviousProcessStartedAt?: string;
  apiRuntimeCurrentProcessStartedAt?: string;
}
