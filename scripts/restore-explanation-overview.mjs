import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import process from "node:process";
import pg from "pg";

const { Pool } = pg;

const SOURCE_PATH = process.env.OVERVIEW_SOURCE_PATH
  ?? "/Users/jttyler/Desktop/Top 55/phase1_overview/overview_draft_live.md";
const DRY_RUN = process.env.DRY_RUN === "1";
const EXPECTED_PAPERS = Number(process.env.EXPECTED_PAPER_COUNT ?? 70);
const EXPECTED_REVIEWS = Number(process.env.EXPECTED_REVIEW_COUNT ?? 70);
const DATABASE_URL = process.env.SEED_DATABASE_URL ?? process.env.DATABASE_URL;

const PAGE_METADATA = [
  {
    slug: "horizon-thermodynamics",
    title: "Horizon Thermodynamics",
    parentSlug: null,
    summaryOneLine: "Why horizons are thermodynamic objects — the deep link between gravity, thermodynamics, information, and spacetime.",
    scopeStatement: "The overarching explanatory structure: that causal horizons behave as thermodynamic systems (temperature, entropy, a first law), revealing a deep link between gravity, quantum theory, information, and spacetime. This root page frames why the structure matters and links the subpages.",
  },
  {
    slug: "black-hole-mechanics",
    title: "The laws of black-hole mechanics",
    parentSlug: "horizon-thermodynamics",
    scopeStatement: "The zeroth/first/second/third laws relating mass, horizon area, surface gravity, angular momentum and charge — the mechanical skeleton later read as thermodynamics.",
  },
  {
    slug: "hawking-radiation",
    title: "Hawking radiation",
    parentSlug: "horizon-thermodynamics",
    scopeStatement: "Particle creation by black holes and the horizon temperature; the step that made horizon thermodynamics physically real rather than analogy.",
  },
  {
    slug: "black-hole-entropy",
    title: "Black-hole entropy",
    parentSlug: "horizon-thermodynamics",
    scopeStatement: "Area-proportional entropy of horizons and its generalizations; what the entropy counts.",
  },
  {
    slug: "cosmological-horizons",
    title: "Cosmological & FRW apparent horizons",
    parentSlug: "horizon-thermodynamics",
    scopeStatement: "Thermodynamics of de Sitter and FRW apparent/trapping horizons, including deriving cosmological dynamics from a horizon first law.",
  },
  {
    slug: "local-quasilocal-horizons",
    title: "Local & quasilocal horizon thermodynamics",
    parentSlug: "horizon-thermodynamics",
    scopeStatement: "Local-observer and quasilocal formulations of the first law; making horizon thermodynamics a statement about local physics.",
  },
  {
    slug: "gravity-as-thermodynamics",
    title: "Gravity as thermodynamics",
    parentSlug: "horizon-thermodynamics",
    scopeStatement: "Deriving gravitational field equations themselves from horizon thermodynamics (equation-of-state / entropic arguments).",
  },
  {
    slug: "holography",
    title: "Holography & entanglement entropy",
    parentSlug: "horizon-thermodynamics",
    scopeStatement: "Holographic bounds and the geometric computation of entanglement entropy connecting horizons to information.",
  },
  {
    slug: "horizon-thermodynamics-disputed-and-failed-claims",
    title: "Disputed & failed claims",
    parentSlug: "horizon-thermodynamics",
    scopeStatement: "Claims that are contested or fatally flawed — routed here so the main account stays sound. Correctness is a separate axis from magnitude.",
  },
];

const expectedSlugs = new Set(PAGE_METADATA.map((page) => page.slug));

function slugify(value) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function cleanBlock(raw, title) {
  const lines = raw.split("\n");
  while (lines.length && !lines[0].trim()) lines.shift();
  if (lines[0]?.trim() === `## ${title}`) lines.shift();
  return lines
    .filter((line) => !/^_Provenance:.*_$/.test(line.trim()))
    .filter((line) => line.trim() !== "---")
    .join("\n")
    .trim();
}

function firstParagraph(markdown) {
  return markdown
    .split(/\n\s*\n/)
    .map((part) => part.replace(/^#{1,6}\s+/, "").trim())
    .find((part) => part && !part.startsWith("- "))
    ?? "";
}

function parseSections(markdown, pageTitle) {
  const headings = [...markdown.matchAll(/^###\s+(.+)$/gm)];
  const sections = [];
  const overviewEnd = headings[0]?.index ?? markdown.length;
  const overview = markdown.slice(0, overviewEnd).trim();
  sections.push({
    slug: "overview",
    title: pageTitle,
    markdown: overview,
    oneLine: firstParagraph(overview),
  });

  headings.forEach((heading, index) => {
    const title = heading[1].trim();
    const start = heading.index + heading[0].length;
    const end = headings[index + 1]?.index ?? markdown.length;
    const body = markdown.slice(start, end).trim();
    sections.push({ slug: slugify(title), title, markdown: body, oneLine: firstParagraph(body) });
  });
  return sections;
}

function parseOverview(source) {
  const matches = [...source.matchAll(/^#\s+(.+?)\s+\(`\/fields\/([^`]+)`\)\s*$/gm)];
  const parsed = matches.map((match, index) => {
    const sourceTitle = match[1].trim();
    const slug = match[2].trim();
    const start = match.index + match[0].length;
    const end = matches[index + 1]?.index ?? source.length;
    const metadata = PAGE_METADATA.find((page) => page.slug === slug);
    if (!metadata) throw new Error(`Unexpected overview page slug: ${slug}`);
    const markdownFull = cleanBlock(source.slice(start, end), sourceTitle);
    if (!markdownFull) throw new Error(`Overview page ${slug} has no content`);
    const summaryShort = firstParagraph(markdownFull);
    return {
      ...metadata,
      summaryOneLine: metadata.summaryOneLine ?? summaryShort,
      summaryShort,
      markdownFull,
      sections: parseSections(markdownFull, metadata.title),
    };
  });

  const found = new Set(parsed.map((page) => page.slug));
  const missing = [...expectedSlugs].filter((slug) => !found.has(slug));
  const extra = [...found].filter((slug) => !expectedSlugs.has(slug));
  if (parsed.length !== PAGE_METADATA.length || missing.length || extra.length) {
    throw new Error(`Overview source mismatch (found=${parsed.length}, missing=${missing.join(",") || "none"}, extra=${extra.join(",") || "none"})`);
  }
  return parsed;
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

async function insertSections(client, page, pageId, versionId) {
  for (const [order, section] of page.sections.entries()) {
    await client.query(
      `INSERT INTO page_sections
        (id, page_id, version_id, slug, title, "order", one_line, short_explanation, markdown, anchor_ids)
       SELECT $1::varchar, $2::varchar, $3::varchar, $4::varchar, $5::text,
              $6::integer, $7::text, $8::text, $9::text, $10::jsonb
       WHERE NOT EXISTS (
         SELECT 1 FROM page_sections
          WHERE version_id = $3::varchar AND slug = $4::varchar
       )`,
      [randomUUID(), pageId, versionId, section.slug, section.title, order, section.oneLine, section.oneLine, section.markdown, "[]"],
    );
  }
}

async function restorePages(pages) {
  if (!DATABASE_URL) throw new Error("SEED_DATABASE_URL or DATABASE_URL is required");
  const pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [2026101401]);
    const before = {
      papers: await countRows(client, "papers"),
      reviews: await countRows(client, "reviews"),
    };
    assertCorpusCounts("Before restore", before.papers, before.reviews);

    const pageIds = new Map();
    for (const page of pages) {
      const result = await client.query(
        `INSERT INTO field_pages (id, slug, title, parent_page_id, scope_statement, summary, created_at, updated_at)
         VALUES ($1, $2, $3, NULL, $4, $5, NOW(), NOW())
         ON CONFLICT (slug) DO UPDATE SET
           title = EXCLUDED.title,
           scope_statement = EXCLUDED.scope_statement,
           summary = EXCLUDED.summary,
           updated_at = NOW()
         RETURNING id`,
        [randomUUID(), page.slug, page.title, page.scopeStatement, page.summaryShort],
      );
      pageIds.set(page.slug, result.rows[0].id);
    }

    for (const page of pages) {
      const pageId = pageIds.get(page.slug);
      const parentId = page.parentSlug ? pageIds.get(page.parentSlug) : null;
      if (page.parentSlug && !parentId) throw new Error(`Missing parent page ${page.parentSlug}`);
      await client.query(
        `UPDATE field_pages SET parent_page_id = $2, updated_at = NOW() WHERE id = $1`,
        [pageId, parentId],
      );

      const latest = await client.query(
        `SELECT id, version_number, summary_one_line, summary_short, markdown_full
           FROM field_page_versions
          WHERE page_id = $1 AND visibility = 'published'
          ORDER BY version_number DESC, created_at DESC
          LIMIT 1`,
        [pageId],
      );
      const existing = latest.rows[0];
      const unchanged = existing
        && existing.summary_one_line === page.summaryOneLine
        && existing.summary_short === page.summaryShort
        && existing.markdown_full === page.markdownFull;

      let versionId = existing?.id;
      if (!unchanged) {
        const nextVersion = await client.query(
          `SELECT COALESCE(MAX(version_number), 0)::int + 1 AS value
             FROM field_page_versions WHERE page_id = $1`,
          [pageId],
        );
        versionId = randomUUID();
        const sourceHash = createHash("sha256").update(page.markdownFull).digest("hex");
        await client.query(
          `INSERT INTO field_page_versions
            (id, page_id, version_number, summary_one_line, summary_short, markdown_full, visibility, change_log, created_by_user_id, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'published', $7::jsonb, NULL, NOW())`,
          [
            versionId,
            pageId,
            nextVersion.rows[0].value,
            page.summaryOneLine,
            page.summaryShort,
            page.markdownFull,
            JSON.stringify([{ at: new Date().toISOString(), action: "restored explanation overview", note: `source sha256:${sourceHash}` }]),
          ],
        );
      }

      await insertSections(client, page, pageId, versionId);
      await client.query(
        `UPDATE field_pages
            SET current_version_id = $2, title = $3, scope_statement = $4, summary = $5, updated_at = NOW()
          WHERE id = $1`,
        [pageId, versionId, page.title, page.scopeStatement, page.summaryShort],
      );
    }

    const after = {
      papers: await countRows(client, "papers"),
      reviews: await countRows(client, "reviews"),
    };
    assertCorpusCounts("Before commit", after.papers, after.reviews);
    if (after.papers !== before.papers || after.reviews !== before.reviews) {
      throw new Error(`Corpus counts changed during restore: ${before.papers}/${before.reviews} -> ${after.papers}/${after.reviews}`);
    }
    await client.query("COMMIT");
    console.log(`Restored ${pages.length} explanation pages; papers/reviews remain ${after.papers}/${after.reviews}.`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

const source = await readFile(SOURCE_PATH, "utf8");
const pages = parseOverview(source);
console.log(`Validated ${pages.length} explanation pages from ${SOURCE_PATH}.`);
if (DRY_RUN) {
  for (const page of pages) console.log(`${page.slug}: ${page.sections.length} section(s)`);
} else {
  await restorePages(pages);
}
