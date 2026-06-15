// Transient-error retry for model calls. This is an EXECUTION concern, not a
// scoring/calibration one: a multi-minute pass makes dozens of Gemini calls
// and will routinely hit transient blips — 503 UNAVAILABLE ("high demand"),
// 429 rate-limit / RESOURCE_EXHAUSTED, request timeouts, dropped sockets. One
// such blip must not sink the whole job, so each call retries with
// exponential backoff + jitter and only surfaces the error after several
// attempts. Deterministic failures (400/INVALID_ARGUMENT, safety blocks) are
// NOT transient and fail fast — retrying them would only waste time.
//
// Pure and offline-testable: no network, no app state.

const TRANSIENT_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

const TRANSIENT_NEEDLES = [
  "unavailable", "overloaded", "high demand", "try again", "temporarily",
  "rate limit", "rate-limit", "ratelimit", "resource_exhausted", "quota",
  "deadline", "timeout", "timed out", "etimedout", "econnreset", "econnrefused",
  "enotfound", "epipe", "eai_again", "socket hang up", "network",
  "fetch failed", "connection", "503", "429", "500", "502", "504",
];

// True when an error is worth retrying (server-side transient or network),
// false for deterministic client errors (bad request, schema, safety).
export function isTransientModelError(err: unknown): boolean {
  if (!err) return false;
  const anyErr = err as any;
  const status = Number(
    anyErr?.status ?? anyErr?.statusCode ?? anyErr?.code ??
    anyErr?.response?.status ?? anyErr?.cause?.status ?? NaN,
  );
  if (Number.isFinite(status)) {
    if (TRANSIENT_STATUS.has(status)) return true;
    // A finite, non-transient numeric status (e.g. 400/403) is deterministic.
    if (status >= 400 && status < 500 && status !== 408 && status !== 409 && status !== 425 && status !== 429) {
      return false;
    }
  }
  const msg = `${anyErr?.message ?? ""} ${anyErr?.cause?.message ?? ""} ${typeof anyErr === "string" ? anyErr : ""}`.toLowerCase();
  // Don't retry explicit client-side rejections that happen to contain a
  // transient-looking word.
  if (msg.includes("invalid_argument") || msg.includes("permission_denied") || msg.includes("not_found") || msg.includes("safety")) {
    return false;
  }
  return TRANSIENT_NEEDLES.some((needle) => msg.includes(needle));
}

export type RetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  // Free-text label for logs/telemetry (e.g. which call site is retrying).
  label?: string;
  // Hook for logging each retry (attempt is 1-based, the one that just failed).
  onRetry?: (info: { attempt: number; maxAttempts: number; delayMs: number; error: unknown }) => void;
  // Injectable for deterministic offline tests; defaults to real setTimeout.
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Runs fn, retrying transient failures with exponential backoff + jitter.
// Re-throws immediately on a non-transient error or once attempts are
// exhausted, so the caller (and the job) only fails on a persistent problem.
export async function withModelRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 5);
  const baseDelayMs = Math.max(0, opts.baseDelayMs ?? 750);
  const maxDelayMs = Math.max(baseDelayMs, opts.maxDelayMs ?? 30_000);
  const sleep = opts.sleep ?? defaultSleep;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt >= maxAttempts || !isTransientModelError(err)) throw err;
      const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const delayMs = backoff + Math.floor(Math.random() * Math.min(1000, backoff || 1000));
      opts.onRetry?.({ attempt, maxAttempts, delayMs, error: err });
      await sleep(delayMs);
    }
  }
  throw lastError;
}
