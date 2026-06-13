// Benchmark re-submission tool (async durable-job contract).
//
// Enqueues one or more PDFs through the hardened POST /api/papers
// (202 {jobId, statusUrl}), polls GET /api/review-jobs/:id until each job
// reaches a terminal state, and reports the stored review id or a clean
// failure reason. Submissions run in the worker, so the web process is not
// at risk; this tool just drives enqueue + poll.
//
// Auth: the API accepts the session id as a Bearer token (getSessionId
// checks Authorization: Bearer <sid> before the cookie), so no browser is
// needed once you have a session. The submitting account must be the admin
// (ADMIN_EMAIL) for reviewMode "benchmark-ingestion" to be honored.
//
// Usage:
//   BENCH_BASE_URL=https://<staging-web-domain>/api \
//   BENCH_TOKEN='<sid session token>' \
//   node scripts/benchmark-submit.mjs \
//     "$HOME/Desktop/Top 55/13_Brown__York__Quasilocal_Energy_and_Conserved_Charges_Derived_from_the_Gravitational_Action.pdf" \
//     "$HOME/Desktop/Top 55/15_kodama_flux.pdf" \
//     "$HOME/Desktop/Top 55/54_Carrol - limits on modifying em.pdf"
//
// With no file args it defaults to the three papers that previously crashed
// the server. Set BENCH_COOKIE instead of BENCH_TOKEN to authenticate by
// cookie. Set BENCH_REVIEW_MODE=normal-review to override the default
// benchmark-ingestion mode.

import { readFileSync, existsSync } from "node:fs";
import { basename as pathBasename } from "node:path";

const BASE = process.env.BENCH_BASE_URL;
const TOKEN = process.env.BENCH_TOKEN || "";
const COOKIE = process.env.BENCH_COOKIE || "";
const REVIEW_MODE = process.env.BENCH_REVIEW_MODE || "benchmark-ingestion";
const POLL_INTERVAL_MS = Number(process.env.BENCH_POLL_INTERVAL_MS) || 8000;
const POLL_TIMEOUT_MS = Number(process.env.BENCH_POLL_TIMEOUT_MS) || 30 * 60 * 1000;

const home = process.env.HOME || "";
const DEFAULT_FILES = [
  `${home}/Desktop/Top 55/13_Brown__York__Quasilocal_Energy_and_Conserved_Charges_Derived_from_the_Gravitational_Action.pdf`,
  `${home}/Desktop/Top 55/15_kodama_flux.pdf`,
  `${home}/Desktop/Top 55/54_Carrol - limits on modifying em.pdf`,
];

if (!BASE) {
  console.error("BENCH_BASE_URL is required, e.g. https://<staging-web-domain>/api");
  process.exit(1);
}
if (!TOKEN && !COOKIE) {
  console.error("Provide BENCH_TOKEN (Bearer session id) or BENCH_COOKIE for an authenticated admin session.");
  process.exit(1);
}

const files = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_FILES;
const headers = {
  "Content-Type": "application/json",
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
  ...(COOKIE ? { Cookie: COOKIE } : {}),
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function enqueue(filePath) {
  if (!existsSync(filePath)) throw new Error(`file not found: ${filePath}`);
  const data = readFileSync(filePath).toString("base64");
  const fileName = pathBasename(filePath);
  const res = await fetch(`${BASE}/papers`, {
    method: "POST",
    headers,
    body: JSON.stringify({ source: { type: "pdf", data, fileName, reviewMode: REVIEW_MODE } }),
  });
  if (res.status !== 202) {
    const body = await res.text().catch(() => "");
    throw new Error(`enqueue returned ${res.status} (expected 202): ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  const jobId = json.jobId || json.attempt?.attemptId;
  if (!jobId) throw new Error("202 response carried no jobId");
  return jobId;
}

async function poll(jobId) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await fetch(`${BASE}/review-jobs/${jobId}`, { headers });
    if (res.status === 502 || res.status === 503) {
      return { terminal: "server_down", detail: `status poll got HTTP ${res.status} — web process unavailable` };
    }
    const data = await res.json().catch(() => ({}));
    const attempt = data?.attempt ?? {};
    const status = attempt.failureStatus || attempt.reviewStatus || "unknown";
    if (data?.review?.id) return { terminal: "completed", reviewId: data.review.id, paperId: data?.paper?.id, status };
    if (/fail|invalid|timeout|too_large|exceeded|mismatch|auto_recovery_exceeded/i.test(status)) {
      return { terminal: "failed", status, error: attempt.errorMessage || status };
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return { terminal: "poll_timeout" };
}

console.log(`benchmark-submit: ${files.length} paper(s) → ${BASE} (mode: ${REVIEW_MODE})\n`);
const results = [];
for (const file of files) {
  const label = pathBasename(file);
  try {
    process.stdout.write(`• ${label}\n  enqueue… `);
    const jobId = await enqueue(file);
    console.log(`job ${jobId}`);
    process.stdout.write("  polling… ");
    const result = await poll(jobId);
    console.log(JSON.stringify(result));
    results.push({ file: label, jobId, ...result });
  } catch (err) {
    console.log(`ERROR: ${err.message}`);
    results.push({ file: label, terminal: "enqueue_error", error: err.message });
  }
}

const completed = results.filter((r) => r.terminal === "completed").length;
const serverDown = results.some((r) => r.terminal === "server_down");
console.log(`\nbenchmark-submit: ${completed}/${results.length} completed; web process ${serverDown ? "WENT DOWN (502/503)" : "stayed up"}.`);
if (serverDown) process.exit(2);
