#!/usr/bin/env node
import { createHash } from "node:crypto";
import pg from "pg";

const { Pool } = pg;

const WRITE = process.argv.includes("--write");
const BATCH_SIZE = Math.max(1, Number(process.env.PRUNE_REVIEW_ATTEMPT_BATCH_SIZE ?? 250) || 250);
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

function redactedStringSummary(value) {
  if (typeof value !== "string") return value;
  return {
    redacted: true,
    charCount: value.length,
    sha256: createHash("sha256").update(value).digest("hex"),
  };
}

function summarizeSourceSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return {
    ...value,
    data: redactedStringSummary(value.data),
    manualText: redactedStringSummary(value.manualText),
    rawText: redactedStringSummary(value.rawText),
    text: redactedStringSummary(value.text),
  };
}

function redactPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { payload, changed: false };
  const next = { ...payload };
  let changed = false;
  if (next.sourceSnapshot) {
    next.sourceSnapshot = summarizeSourceSnapshot(next.sourceSnapshot);
    next.sourceSnapshotRedacted = true;
    changed = true;
  }
  if (next.source) {
    next.source = summarizeSourceSnapshot(next.source);
    changed = true;
  }
  for (const key of ["data", "manualText", "rawText", "text"]) {
    if (typeof next[key] === "string") {
      next[key] = redactedStringSummary(next[key]);
      changed = true;
    }
  }
  if (changed) {
    next.sourceSnapshotRetentionNote =
      "Review attempt source payload was redacted after terminal status to avoid retaining uploaded PDF/text bodies in Postgres.";
  }
  return { payload: next, changed };
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 10_000,
});

try {
  const { rows } = await pool.query(
    `
      select id, debug_payload
      from review_attempts
      where debug_payload ? 'sourceSnapshot'
        and coalesce(debug_payload->>'sourceSnapshotRedacted', 'false') != 'true'
        and coalesce(debug_payload->>'jobStatus', '') not in ('queued', 'running')
      order by created_at desc
      limit $1
    `,
    [BATCH_SIZE],
  );

  let changed = 0;
  for (const row of rows) {
    const redacted = redactPayload(row.debug_payload);
    if (!redacted.changed) continue;
    changed += 1;
    if (WRITE) {
      await pool.query(
        "update review_attempts set debug_payload = $2::jsonb where id = $1",
        [row.id, JSON.stringify(redacted.payload)],
      );
    }
  }

  console.log(JSON.stringify({
    mode: WRITE ? "write" : "dry_run",
    scanned: rows.length,
    wouldRedact: changed,
    batchSize: BATCH_SIZE,
    note: WRITE
      ? "Updated terminal review_attempts debug_payload source snapshots."
      : "Dry run only. Re-run with --write after confirming the count.",
  }, null, 2));
} finally {
  await pool.end();
}
