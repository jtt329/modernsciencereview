import { readFile } from "node:fs/promises";
import process from "node:process";
import pg from "pg";

const { Pool } = pg;

const DATABASE_URL = process.env.SEED_DATABASE_URL ?? process.env.DATABASE_URL;
const DRY_RUN = process.env.DRY_RUN === "1";
const EXPECTED_PAPERS = Number(process.env.EXPECTED_PAPER_COUNT ?? 70);
const EXPECTED_REVIEWS = Number(process.env.EXPECTED_REVIEW_COUNT ?? 70);
const SCHEMA_PATH = new URL("./local/schema.sql", import.meta.url);

const ADDITIVE_TABLES = new Set([
  "conversations",
  "attribution_checks",
  "block_expansions",
  "consistency_findings",
  "divergence_flags",
  "field_page_versions",
  "field_pages",
  "ingestion_queue",
  "page_blocks",
  "page_links",
  "page_references",
  "page_sections",
  "page_spans",
  "page_version_blocks",
  "proposed_overview_edits",
  "review_versions",
  "messages",
]);

function splitStatements(sql) {
  return sql
    .split(/;\s*(?:\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) => `${statement};`);
}

function statementTarget(statement) {
  const createTable = statement.match(/^CREATE TABLE\s+"([^"]+)"/i);
  if (createTable) return { kind: "table", table: createTable[1] };

  const alterTable = statement.match(/^ALTER TABLE\s+"([^"]+)"/i);
  if (alterTable) return { kind: "alter", table: alterTable[1] };

  const createIndex = statement.match(/^CREATE(?: UNIQUE)? INDEX\s+"[^"]+"\s+ON\s+"([^"]+)"/i);
  if (createIndex) return { kind: "index", table: createIndex[1] };

  return null;
}

function makeIdempotent(statement, kind) {
  if (kind === "table") return statement.replace(/^CREATE TABLE/i, "CREATE TABLE IF NOT EXISTS");
  if (kind === "index") {
    return statement.replace(/^CREATE UNIQUE INDEX/i, "CREATE UNIQUE INDEX IF NOT EXISTS")
      .replace(/^CREATE INDEX/i, "CREATE INDEX IF NOT EXISTS");
  }
  return statement;
}

async function countRows(client, table) {
  const result = await client.query(`SELECT COUNT(*)::int AS count FROM ${table}`);
  return result.rows[0].count;
}

function assertCorpusCounts(label, papers, reviews) {
  if (papers !== EXPECTED_PAPERS || reviews !== EXPECTED_REVIEWS) {
    throw new Error(`${label}: expected papers/reviews ${EXPECTED_PAPERS}/${EXPECTED_REVIEWS}, found ${papers}/${reviews}`);
  }
}

async function existingTables(client) {
  const result = await client.query(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [[...ADDITIVE_TABLES]],
  );
  return new Set(result.rows.map((row) => row.table_name));
}

async function main() {
  const canonicalSql = await readFile(SCHEMA_PATH, "utf8");
  const selected = splitStatements(canonicalSql)
    .map((statement) => ({ statement, target: statementTarget(statement) }))
    .filter(({ target }) => target && ADDITIVE_TABLES.has(target.table));

  const selectedCreates = new Set(
    selected.filter(({ target }) => target.kind === "table").map(({ target }) => target.table),
  );
  const missingDefinitions = [...ADDITIVE_TABLES].filter((table) => !selectedCreates.has(table));
  if (missingDefinitions.length) {
    throw new Error(`Canonical schema is missing CREATE TABLE definitions for: ${missingDefinitions.join(", ")}`);
  }

  if (DRY_RUN) {
    const statementCounts = selected.reduce((counts, { target }) => {
      counts[target.kind] = (counts[target.kind] ?? 0) + 1;
      return counts;
    }, {});
    console.log(JSON.stringify({
      status: "dry_run",
      statementCounts,
      targetTables: [...selectedCreates].sort(),
    }, null, 2));
    return;
  }

  if (!DATABASE_URL) throw new Error("SEED_DATABASE_URL or DATABASE_URL is required");

  const pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [2026101402]);

    const before = {
      papers: await countRows(client, "papers"),
      reviews: await countRows(client, "reviews"),
    };
    assertCorpusCounts("Before schema addition", before.papers, before.reviews);

    const alreadyPresent = await existingTables(client);
    if (alreadyPresent.size > 0 && alreadyPresent.size < ADDITIVE_TABLES.size) {
      throw new Error(`Partial explanation schema detected; refusing automatic migration. Present: ${[...alreadyPresent].sort().join(", ")}`);
    }

    if (alreadyPresent.size === 0) {
      for (const { statement, target } of selected) {
        await client.query(makeIdempotent(statement, target.kind));
      }
    }

    const afterTables = await existingTables(client);
    const missingAfter = [...ADDITIVE_TABLES].filter((table) => !afterTables.has(table));
    if (missingAfter.length) throw new Error(`Schema addition incomplete; missing: ${missingAfter.join(", ")}`);

    const after = {
      papers: await countRows(client, "papers"),
      reviews: await countRows(client, "reviews"),
    };
    assertCorpusCounts("After schema addition", after.papers, after.reviews);

    await client.query("COMMIT");
    console.log(JSON.stringify({
      status: alreadyPresent.size === ADDITIVE_TABLES.size ? "already_present" : "applied",
      addedTables: [...ADDITIVE_TABLES].sort(),
      papers: after.papers,
      reviews: after.reviews,
    }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
