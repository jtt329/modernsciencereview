// Era-bias measurement for pairwise calibration judgments.
//
// Using stored calibration_pairs plus paper publication dates, reports the
// NEWER paper's win rate as a function of publication-year gap, controlling
// for intrinsic score difference — the direct measurement of era bias.
// Runnable before and after the epoch-relative clause ships (it only reads
// stored judgments; no prompts, no model calls).
//
// Usage: DATABASE_URL=postgres://... node scripts/era-bias-check.mjs

import { join } from "node:path";
import { pathToFileURL } from "node:url";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required (point it at the staging or production database).");
  process.exit(1);
}

const pgModuleUrl = pathToFileURL(join(process.cwd(), "lib/db/node_modules/pg/lib/index.js")).href;
const { default: pg } = await import(pgModuleUrl);
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  const pairs = (await client.query(
    "SELECT review_id_a, review_id_b, overall_winner_review_id, margin, position_inconsistent FROM calibration_pairs",
  )).rows;
  const reviews = (await client.query(
    "SELECT id, paper_id, coverage_ledger_json FROM reviews",
  )).rows;
  const papers = (await client.query(
    "SELECT id, title, date_metadata FROM papers",
  )).rows;

  const paperById = new Map(papers.map((paper) => [paper.id, paper]));
  const reviewInfo = new Map();
  for (const review of reviews) {
    let ledger = null;
    try { ledger = JSON.parse(review.coverage_ledger_json ?? "null"); } catch { /* ignore */ }
    const paper = paperById.get(review.paper_id);
    const metadata = paper?.date_metadata ?? {};
    const dateText = metadata.originalPublicationDateBestGuess || metadata.journalPublicationDate || metadata.arxivFirstSubmissionDate || "";
    const year = Number.isFinite(Date.parse(dateText)) ? new Date(dateText).getUTCFullYear() : null;
    const intrinsic = Number(ledger?.computedScore ?? ledger?.intrinsicScore ?? NaN);
    reviewInfo.set(review.id, {
      title: paper?.title ?? review.id,
      year,
      intrinsic: Number.isFinite(intrinsic) ? intrinsic : null,
    });
  }

  const gapBucketOf = (gap) => (gap <= 5 ? "0-5y" : gap <= 15 ? "6-15y" : gap <= 30 ? "16-30y" : ">30y");
  // Control: intrinsic score difference (newer minus older).
  const diffBucketOf = (diff) =>
    diff <= -10 ? "newer -10 or worse" : diff < -3 ? "newer -3..-10" : diff <= 3 ? "similar (±3)" : diff < 10 ? "newer +3..+10" : "newer +10 or better";

  const cells = new Map();
  let usable = 0;
  let skipped = 0;
  for (const pair of pairs) {
    const a = reviewInfo.get(pair.review_id_a);
    const b = reviewInfo.get(pair.review_id_b);
    if (!a || !b || a.year == null || b.year == null || a.intrinsic == null || b.intrinsic == null) {
      skipped += 1;
      continue;
    }
    const [older, newer] = a.year <= b.year ? [a, b] : [b, a];
    const newerId = a.year <= b.year ? pair.review_id_b : pair.review_id_a;
    const gap = newer.year - older.year;
    const newerWin = pair.overall_winner_review_id == null ? 0.5 : pair.overall_winner_review_id === newerId ? 1 : 0;
    const key = `${gapBucketOf(gap)}\0${diffBucketOf(newer.intrinsic - older.intrinsic)}`;
    const cell = cells.get(key) ?? { n: 0, wins: 0, inconsistent: 0 };
    cell.n += 1;
    cell.wins += newerWin;
    cell.inconsistent += pair.position_inconsistent === 1 ? 1 : 0;
    cells.set(key, cell);
    usable += 1;
  }

  console.log(`era-bias-check: ${usable} usable pairs, ${skipped} skipped (missing dates or intrinsic scores)\n`);
  console.log("Newer-paper win rate by publication-year gap, controlling for intrinsic score difference");
  console.log("(unbiased judging => win rate tracks the intrinsic-difference column, flat across gap rows)\n");
  const gapOrder = ["0-5y", "6-15y", "16-30y", ">30y"];
  const diffOrder = ["newer -10 or worse", "newer -3..-10", "similar (±3)", "newer +3..+10", "newer +10 or better"];
  const header = ["year gap \\ intrinsic diff", ...diffOrder];
  const rows = gapOrder.map((gapBucket) => [
    gapBucket,
    ...diffOrder.map((diffBucket) => {
      const cell = cells.get(`${gapBucket}\0${diffBucket}`);
      return cell ? `${Math.round((cell.wins / cell.n) * 100)}% (n=${cell.n})` : "—";
    }),
  ]);
  const widths = header.map((_, column) => Math.max(header[column].length, ...rows.map((row) => row[column].length)));
  const renderRow = (row) => row.map((value, column) => value.padEnd(widths[column])).join("  ");
  console.log(renderRow(header));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of rows) console.log(renderRow(row));
} finally {
  await client.end();
}
