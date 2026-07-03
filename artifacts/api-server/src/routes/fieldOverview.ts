// Field-overview (wiki) API — FIELD_MAP_and_importance_phase1.md §7.
// Serves the overview pages/sections/references, the per-paper realized overview location
// (renderer-computed prominence), the persisted B.2.1 review + evidence packets, the ingestion
// queue, and the ADMIN monitoring surface: publish (draft->published), rollback, edit history.
// There is NO per-edit approval endpoint by design (§10.1) — editing is autonomous; admin is
// monitoring + rollback + the single publish switch.
import { Router } from "express";
import {
  db, papersTable,
  fieldPagesTable, fieldPageVersionsTable, pageSectionsTable, pageReferencesTable,
  pageSpansTable, proposedOverviewEditsTable, ingestionQueueTable, reviewVersionsTable,
} from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { computeProminence, publishOverview, rollbackPage, canonicalPaperSlug } from "../lib/overviewEditor";
import { logger } from "../lib/logger";

// Enrich references with the canonical paper slug + title (the model never writes slugs — §10.2a).
async function enrichReferences(refs: any[]) {
  const paperIds = Array.from(new Set(refs.map((r) => r.paperId).filter(Boolean)));
  const papers = paperIds.length ? await db.select({ id: papersTable.id, title: papersTable.title }).from(papersTable).where(inArray(papersTable.id, paperIds)) : [];
  const byId = new Map(papers.map((p) => [p.id, p]));
  return refs.map((r) => ({
    id: r.id, anchorText: r.anchorText, anchorStartOffset: r.anchorStartOffset, anchorEndOffset: r.anchorEndOffset,
    paperId: r.paperId, reviewVersionId: r.reviewVersionId, claimIds: r.claimIds,
    claimStatus: r.claimStatus, provenance: r.provenance,
    paperTitle: r.paperId ? byId.get(r.paperId)?.title ?? null : null,
    paperSlug: r.paperId ? canonicalPaperSlug(r.paperId, byId.get(r.paperId)?.title) : null,
  }));
}

const router = Router();
const ADMIN_EMAIL = process.env.VITE_ADMIN_EMAIL || process.env.ADMIN_EMAIL || "";
function requireAdmin(req: any, res: any): boolean {
  if (!req.isAuthenticated?.()) { res.status(401).json({ error: "Unauthorized" }); return false; }
  if (!ADMIN_EMAIL || req.user?.email !== ADMIN_EMAIL) { res.status(403).json({ error: "Forbidden" }); return false; }
  return true;
}

async function latestVersion(pageId: string, visibility?: "draft" | "published") {
  const where = visibility
    ? and(eq(fieldPageVersionsTable.pageId, pageId), eq(fieldPageVersionsTable.visibility, visibility))
    : eq(fieldPageVersionsTable.pageId, pageId);
  const rows = await db.select().from(fieldPageVersionsTable).where(where)
    .orderBy(desc(fieldPageVersionsTable.createdAt)).limit(1);
  return rows[0] ?? null;
}

// GET /api/overviews/:slug  — the overview tree (published by default; ?draft=1 admin-only)
router.get("/overviews/:slug", async (req, res) => {
  const wantDraft = req.query.draft === "1";
  if (wantDraft && !requireAdmin(req, res)) return;
  try {
    const root = (await db.select().from(fieldPagesTable).where(eq(fieldPagesTable.slug, req.params.slug)).limit(1))[0];
    if (!root) { res.status(404).json({ error: "overview not found" }); return; }
    const all = await db.select().from(fieldPagesTable);
    const pages = all.filter((p) => p.id === root.id || p.parentPageId === root.id);
    const out = [] as any[];
    for (const p of pages) {
      const version = await latestVersion(p.id, wantDraft ? undefined : "published");
      if (!version) continue; // unpublished page hidden from public
      const sections = await db.select().from(pageSectionsTable).where(eq(pageSectionsTable.versionId, version.id)).orderBy(pageSectionsTable.order);
      const refs = await db.select().from(pageReferencesTable).where(eq(pageReferencesTable.pageId, p.id));
      const spans = await db.select().from(pageSpansTable).where(eq(pageSpansTable.versionId, version.id));
      out.push({
        id: p.id, slug: p.slug, title: p.title, parentPageId: p.parentPageId, scopeStatement: p.scopeStatement,
        version: { id: version.id, visibility: version.visibility, summaryOneLine: version.summaryOneLine, summaryShort: version.summaryShort, markdownFull: version.markdownFull },
        sections, references: await enrichReferences(refs),
        spans: spans.map((s) => ({ id: s.id, text: s.text, startOffset: s.startOffset, endOffset: s.endOffset, supportStatus: s.supportStatus, referenceId: s.referenceId })),
      });
    }
    res.json({ overviewSlug: root.slug, isDraft: wantDraft, pages: out });
  } catch (err) { logger.error({ err }, "overview fetch failed"); res.status(500).json({ error: "overview fetch failed" }); }
});

// GET /api/papers/:paperId/overview-location — renderer-computed prominence + where it lives
router.get("/papers/:paperId/overview-location", async (req, res) => {
  const overviewSlug = String(req.query.overview || "horizon-thermodynamics");
  try {
    const { prominence, locationSlug } = await computeProminence(db as any, overviewSlug, req.params.paperId);
    let location = null as any;
    if (locationSlug) {
      const page = (await db.select().from(fieldPagesTable).where(eq(fieldPagesTable.slug, locationSlug)).limit(1))[0];
      location = page ? { slug: page.slug, title: page.title } : null;
    }
    res.json({ paperId: req.params.paperId, overviewSlug, computedProminence: prominence, location });
  } catch (err) { logger.error({ err }, "overview-location failed"); res.status(500).json({ error: "overview-location failed" }); }
});

// GET /api/papers/:paperId/review-version — persisted B.2.1 review (evidence packets, claims,
// contribution passage). correctnessPublic is included but the FRONTEND hides it until spot-check.
router.get("/papers/:paperId/review-version", async (req, res) => {
  try {
    const rv = (await db.select().from(reviewVersionsTable).where(eq(reviewVersionsTable.paperId, req.params.paperId)).orderBy(desc(reviewVersionsTable.createdAt)).limit(1))[0];
    if (!rv) { res.status(404).json({ error: "no review version" }); return; }
    res.json(rv);
  } catch (err) { logger.error({ err }, "review-version failed"); res.status(500).json({ error: "review-version failed" }); }
});

// GET /api/papers/:paperId/overview-edits — the diffs this paper proposed (monitoring/paper page)
router.get("/papers/:paperId/overview-edits", async (req, res) => {
  try {
    const edits = await db.select().from(proposedOverviewEditsTable).where(eq(proposedOverviewEditsTable.paperId, req.params.paperId)).orderBy(desc(proposedOverviewEditsTable.createdAt));
    res.json({ paperId: req.params.paperId, edits });
  } catch (err) { res.status(500).json({ error: "overview-edits failed" }); }
});

// GET /api/overviews/:slug/edits — edit history / monitoring surface (admin)
router.get("/overviews/:slug/edits", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const edits = await db.select().from(proposedOverviewEditsTable).where(eq(proposedOverviewEditsTable.overviewSlug, req.params.slug)).orderBy(desc(proposedOverviewEditsTable.createdAt));
  res.json({ overviewSlug: req.params.slug, edits });
});

// POST /api/admin/overviews/:slug/publish — single draft->published switch (§10.1)
router.post("/admin/overviews/:slug/publish", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try { res.json(await publishOverview(db as any, req.params.slug)); }
  catch (err) { logger.error({ err }, "publish failed"); res.status(500).json({ error: "publish failed" }); }
});

// POST /api/admin/overviews/pages/:pageId/rollback  { toVersionId }
router.post("/admin/overviews/pages/:pageId/rollback", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const toVersionId = String(req.body?.toVersionId || "");
  if (!toVersionId) { res.status(400).json({ error: "toVersionId required" }); return; }
  try { const v = await rollbackPage(db as any, req.params.pageId, toVersionId); res.json({ restoredVersionId: v.id }); }
  catch (err) { logger.error({ err }, "rollback failed"); res.status(500).json({ error: "rollback failed" }); }
});

// GET /api/overviews/pages/:pageId/versions — version history (rollback targets)
router.get("/overviews/pages/:pageId/versions", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const versions = await db.select().from(fieldPageVersionsTable).where(eq(fieldPageVersionsTable.pageId, req.params.pageId)).orderBy(desc(fieldPageVersionsTable.createdAt));
  res.json({ pageId: req.params.pageId, versions: versions.map((v) => ({ id: v.id, visibility: v.visibility, createdAt: v.createdAt, changeLog: v.changeLog })) });
});

// --- Ingestion queue (referenced-but-unreviewed papers) ---------------------------
router.get("/ingestion-queue", async (_req, res) => {
  const items = await db.select().from(ingestionQueueTable).orderBy(desc(ingestionQueueTable.createdAt));
  res.json({ items });
});
router.post("/ingestion-queue", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { citation, title, arxivId, doi, requestedByReferenceId } = req.body ?? {};
  if (!citation) { res.status(400).json({ error: "citation required" }); return; }
  const [item] = await db.insert(ingestionQueueTable).values({ citation, title, arxivId, doi, requestedByReferenceId }).returning();
  res.json(item);
});
router.patch("/ingestion-queue/:id", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { status, resolvedPaperId, note } = req.body ?? {};
  const [item] = await db.update(ingestionQueueTable)
    .set({ ...(status ? { status } : {}), ...(resolvedPaperId ? { resolvedPaperId } : {}), ...(note ? { note } : {}), updatedAt: new Date() })
    .where(eq(ingestionQueueTable.id, req.params.id)).returning();
  res.json(item);
});

export default router;
