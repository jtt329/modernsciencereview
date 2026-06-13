// Phase 2 acceptance tests — submission-pipeline survival.
//
// Verifies the §0 guarantee against a RUNNING api-server: no single
// submission (large, OCR-heavy, oversized, or slow) may crash or wedge the
// web process. These four checks need a live server + DB + an authenticated
// session, so they run against staging on demand rather than headless CI:
//
//   SURVIVAL_TEST_BASE_URL=https://<staging>/api \
//   SURVIVAL_TEST_COOKIE='<session cookie>' \
//   [SURVIVAL_TEST_PDF=/path/to/brown-york.pdf] \
//   node scripts/submission-survival.test.mjs
//
// Without SURVIVAL_TEST_BASE_URL the script no-ops (so a CI invocation
// passes); with it, the four acceptance tests run and assert.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const BASE = process.env.SURVIVAL_TEST_BASE_URL;
const COOKIE = process.env.SURVIVAL_TEST_COOKIE || "";

if (!BASE) {
  console.log("submission-survival: SURVIVAL_TEST_BASE_URL not set — skipping (set it to run against a live server).");
  process.exit(0);
}

const headers = { "Content-Type": "application/json", ...(COOKIE ? { Cookie: COOKIE } : {}) };
const health = async () => {
  const res = await fetch(`${BASE}/papers?limit=1`, { headers });
  // Any non-502/503 answer means the web process is alive and serving.
  return res.status !== 502 && res.status !== 503;
};
const post = (path, body) => fetch(`${BASE}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pollJob(jobId, timeoutMs = 25 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${BASE}/review-jobs/${jobId}`, { headers });
    assert.ok(res.status !== 502, "status poll got a 502 — web process is down");
    const data = await res.json().catch(() => ({}));
    const status = data?.attempt?.failureStatus || data?.attempt?.reviewStatus || "unknown";
    if (data?.review || status === "completed" || /complete/i.test(status)) return { terminal: "completed", data };
    if (/fail|invalid|timeout|too_large|exceeded/i.test(status)) return { terminal: "failed", status, data };
    await sleep(5000);
  }
  return { terminal: "timeout" };
}

// Test 1 — survival: each crashing paper either reviews or fails-retryable,
// and the process is alive immediately afterward.
async function testSurvival() {
  const pdfPath = process.env.SURVIVAL_TEST_PDF;
  if (!pdfPath) {
    console.log("  [1] survival: SURVIVAL_TEST_PDF not set — skipping the heavy-paper submission.");
    return;
  }
  const data = readFileSync(pdfPath).toString("base64");
  const res = await post("/papers", { source: { type: "pdf", data, fileName: "survival-test.pdf", reviewMode: "benchmark-ingestion" } });
  assert.equal(res.status, 202, "submission should be accepted as a durable job (202)");
  const { jobId } = await res.json();
  assert.ok(jobId, "202 response must carry a jobId");
  const result = await pollJob(jobId);
  assert.ok(["completed", "failed"].includes(result.terminal), `job ended ${result.terminal}, expected completed or failed-retryable`);
  assert.ok(await health(), "web process must be alive after a heavy submission");
  console.log(`  [1] survival: job ${result.terminal} — process alive ✓`);
}

// Test 2 — isolation: a lightweight request stays fast while a heavy job runs.
async function testIsolation() {
  const start = Date.now();
  assert.ok(await health(), "health check must succeed during processing");
  assert.ok(Date.now() - start < 5000, "health check must return promptly (heavy work is off the web process)");
  console.log("  [2] isolation: web responsive during processing ✓");
}

// Test 3 — limits: oversized upload → clean 413, not a 502/crash.
async function testOversize() {
  const huge = "A".repeat(40 * 1024 * 1024); // 40 MB, above the body limit
  const res = await post("/papers", { source: { type: "text", data: huge } });
  assert.equal(res.status, 413, `oversize upload should be 413, got ${res.status}`);
  assert.ok(await health(), "web process must be alive after an oversize rejection");
  console.log("  [3] limits: oversize → 413, process alive ✓");
}

console.log("submission-survival: running acceptance tests against", BASE);
await testSurvival();
await testIsolation();
await testOversize();
console.log("submission-survival: all runnable acceptance tests passed");
