import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { gzipSync } from "node:zlib";
import { PGlite } from "@electric-sql/pglite";

const SOURCE_DIR = process.env.PGLITE_DIR;
const OUTPUT_PATH = resolve(
  process.env.OUTPUT_PATH ?? new URL("./data/explanation-graph-archive.json.gz", import.meta.url).pathname,
);

const TABLES = [
  "papers",
  "review_versions",
  "field_pages",
  "field_page_versions",
  "page_sections",
  "page_blocks",
  "page_version_blocks",
  "page_references",
  "page_spans",
  "page_links",
  "proposed_overview_edits",
  "consistency_findings",
  "attribution_checks",
  "block_expansions",
  "divergence_flags",
  "ingestion_queue",
];

function jsonReplacer(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}

async function exportTable(db, table) {
  const result = await db.query(`SELECT * FROM ${table} ORDER BY 1`);
  return result.rows;
}

async function main() {
  if (!SOURCE_DIR) throw new Error("PGLITE_DIR is required");

  const db = new PGlite(SOURCE_DIR);
  try {
    const tables = {};
    for (const table of TABLES) {
      tables[table] = await exportTable(db, table);
    }

    const payload = {
      format: "modern-science-explanation-archive",
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      sourceLabel: "phase1 accept-c explanation graph",
      tables,
    };
    const json = Buffer.from(JSON.stringify(payload, jsonReplacer));
    const gzip = gzipSync(json, { level: 9 });

    await mkdir(dirname(OUTPUT_PATH), { recursive: true });
    await writeFile(OUTPUT_PATH, gzip);

    const counts = Object.fromEntries(TABLES.map((table) => [table, tables[table].length]));
    console.log(JSON.stringify({
      status: "exported",
      outputPath: OUTPUT_PATH,
      uncompressedBytes: json.length,
      compressedBytes: gzip.length,
      sha256: createHash("sha256").update(gzip).digest("hex"),
      counts,
    }, null, 2));
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
