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
  attributionChecksTable, pageLinksTable, divergenceFlagsTable,
} from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { computeProminence, publishOverview, rollbackPage, canonicalPaperSlug, runPostReviewOverviewHook, getContributionTransclusion, liveProvenanceForVersion, pagesInScope } from "../lib/overviewEditor";
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
    const all = await db.select().from(fieldPagesTable);
    const pages = await pagesInScope(db as any, req.params.slug);
    if (pages.length === 0) { res.status(404).json({ error: "overview not found" }); return; }
    const out = [] as any[];
    for (const p of pages) {
      const version = await latestVersion(p.id, wantDraft ? undefined : "published");
      if (!version) continue; // unpublished page hidden from public
      const sections = await db.select().from(pageSectionsTable).where(eq(pageSectionsTable.versionId, version.id)).orderBy(pageSectionsTable.order);
      // Block substrate: provenance by block membership with ABSOLUTE offsets computed against
      // the render cache (falls back to frozen per-version rows for unmigrated pages).
      const prov = await liveProvenanceForVersion(db as any, version.id);
      const refs = prov.refs as any[];
      const spans = prov.spans as any[];
      // Inter-page links: NAVIGATION only — the link graph drives nothing.
      const links = [] as any[];
      for (const l of prov.links as any[]) {
        const target = all.find((pg) => pg.id === l.toPageId);
        if (!target) continue;
        // Hover preview card = the target page's maintained one-line summary (multi-resolution
        // layer working for free; the term-level [+] is retired in favor of plain links).
        const tv = (await db.select().from(fieldPageVersionsTable).where(eq(fieldPageVersionsTable.pageId, target.id)).orderBy(desc(fieldPageVersionsTable.versionNumber)).limit(1))[0];
        links.push({ id: l.id, phrase: l.phrase, startOffset: l.anchorStartOffset, endOffset: l.anchorEndOffset, toPageSlug: target.slug, toPageTitle: target.title, toPageSummary: tv?.summaryOneLine || target.scopeStatement || "" });
      }
      out.push({
        id: p.id, slug: p.slug, title: p.title, parentPageId: p.parentPageId, scopeStatement: p.scopeStatement,
        version: { id: version.id, visibility: version.visibility, summaryOneLine: version.summaryOneLine, summaryShort: version.summaryShort, markdownFull: version.markdownFull },
        sections, references: await enrichReferences(refs),
        spans: spans.map((s) => ({ id: s.id, text: s.text, startOffset: s.startOffset, endOffset: s.endOffset, supportStatus: s.supportStatus, referenceId: s.referenceId })),
        links,
      });
    }
    res.json({ overviewSlug: req.params.slug, isDraft: wantDraft, pages: out });
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
    // provisional (brief P2): the prominence heuristic reads offsets, not real structure — label
    // it so no display asserts it as measured position; keep off public pages until structural.
    res.json({ paperId: req.params.paperId, overviewSlug, computedProminence: prominence, location, provisional: true, provisionalNote: "prominence is an offset heuristic, not structural — display as provisional only" });
  } catch (err) { logger.error({ err }, "overview-location failed"); res.status(500).json({ error: "overview-location failed" }); }
});

// GET /api/papers/:paperId/review-version — persisted B.2.1 review (claims, contribution
// passage). SAFETY BOUNDARY (brief P0.2): the internal correctness verdict, the raw adjudicated
// JSON, and evidence packets (which contain unverified fatal-flaw ALLEGATIONS) are stripped for
// non-admin callers at the API — the frontend hiding them is not enforcement. correctnessPublic
// is served only when it is not "hidden" (i.e. spot-check has cleared it); until then the public
// shape carries no correctness field at all. "Unverified fatal never leaves the internal record."
function isAdminRequest(req: any): boolean {
  return !!(req.isAuthenticated?.() && ADMIN_EMAIL && req.user?.email === ADMIN_EMAIL);
}
router.get("/papers/:paperId/review-version", async (req, res) => {
  try {
    const rv = (await db.select().from(reviewVersionsTable).where(eq(reviewVersionsTable.paperId, req.params.paperId)).orderBy(desc(reviewVersionsTable.createdAt)).limit(1))[0];
    if (!rv) { res.status(404).json({ error: "no review version" }); return; }
    if (isAdminRequest(req)) { res.json(rv); return; }
    const {
      correctnessInternal: _internal, adjudicatedJson: _adjudicated, evidencePackets: _packets,
      correctnessPublic, ...publicFields
    } = rv;
    res.json({
      ...publicFields,
      ...(correctnessPublic && correctnessPublic !== "hidden" ? { correctnessPublic } : {}),
    });
  } catch (err) { logger.error({ err }, "review-version failed"); res.status(500).json({ error: "review-version failed" }); }
});

// GET /api/papers/:paperId/contribution — the paper page's "Contribution to the Explanatory
// Structure" section as a LIVE TRANSCLUSION of its applied edit regions (slice 3, spec §2.1).
router.get("/papers/:paperId/contribution", async (req, res) => {
  try {
    const t = await getContributionTransclusion(db as any, req.params.paperId);
    res.json({ paperId: req.params.paperId, ...t });
  } catch (err) { logger.error({ err }, "contribution transclusion failed"); res.status(500).json({ error: "contribution failed" }); }
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

// POST /api/admin/papers/:paperId/run-overview-editor — manual trigger of the post-review
// hook (P1.6). Same flag gate + fail-closed correctness mapping as the pipeline call site.
router.post("/admin/papers/:paperId/run-overview-editor", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try { res.json(await runPostReviewOverviewHook(db as any, req.params.paperId)); }
  catch (err) { logger.error({ err }, "run-overview-editor failed"); res.status(500).json({ error: "run-overview-editor failed" }); }
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

// --- Public change view (slice 5.3): what changed, when, triggered by which paper ---
// Visible change is the quality mechanism and the product's proof of life.
router.get("/overviews/:slug/changes", async (req, res) => {
  try {
    const edits = (await db.select().from(proposedOverviewEditsTable)
      .where(eq(proposedOverviewEditsTable.overviewSlug, req.params.slug))
      .orderBy(desc(proposedOverviewEditsTable.createdAt)).limit(50))
      .filter((e) => e.status === "draft_applied" || e.status === "published");
    const paperIds = Array.from(new Set(edits.map((e) => e.paperId).filter(Boolean))) as string[];
    const papers = paperIds.length ? await db.select({ id: papersTable.id, title: papersTable.title }).from(papersTable).where(inArray(papersTable.id, paperIds)) : [];
    const byId = new Map(papers.map((p) => [p.id, p.title]));
    res.json({
      overviewSlug: req.params.slug,
      changes: edits.map((e) => ({
        at: e.createdAt, action: e.action, pageSlug: e.targetPageSlug,
        paperId: e.paperId, paperTitle: e.paperId ? byId.get(e.paperId) ?? null : null,
        paperSlug: e.paperId ? canonicalPaperSlug(e.paperId, byId.get(e.paperId)) : null,
      })),
    });
  } catch (err) { logger.error({ err }, "changes view failed"); res.status(500).json({ error: "changes failed" }); }
});

// --- Divergence flags (slice 5.4) — monitoring list; nothing consumes these ---------
router.get("/admin/divergence-flags", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const items = await db.select().from(divergenceFlagsTable).orderBy(desc(divergenceFlagsTable.createdAt));
  res.json({ items });
});

// --- Mis-sourcing spot-check queue (P2 — a WATCH, never a gate) --------------------
router.get("/admin/attribution-checks", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const status = String(req.query.status || "queued");
  const items = await db.select().from(attributionChecksTable).where(eq(attributionChecksTable.status, status as any)).orderBy(desc(attributionChecksTable.createdAt));
  res.json({ items });
});
router.patch("/admin/attribution-checks/:id", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { status, note } = req.body ?? {};
  if (!["cleared", "confirmed_missourced", "queued"].includes(status)) { res.status(400).json({ error: "status must be cleared | confirmed_missourced | queued" }); return; }
  const [item] = await db.update(attributionChecksTable).set({ status, ...(note ? { note } : {}) }).where(eq(attributionChecksTable.id, req.params.id)).returning();
  res.json(item);
});

// --- Publish diff view (P2): what changed per page since its last published version ---
// The publish switch stays single and autonomous-friendly; this gives the human flipping it
// something to look at. Minimal line diff — monitoring, not approval.
router.get("/admin/overviews/:slug/publish-diff", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const scope = await pagesInScope(db as any, req.params.slug);
    if (scope.length === 0) { res.status(404).json({ error: "overview not found" }); return; }
    const pages = [] as any[];
    for (const p of scope) {
      const versions = await db.select().from(fieldPageVersionsTable).where(eq(fieldPageVersionsTable.pageId, p.id)).orderBy(desc(fieldPageVersionsTable.versionNumber));
      const latest = versions[0];
      const lastPublished = versions.find((v) => v.visibility === "published");
      if (!latest) continue;
      const oldLines = (lastPublished?.markdownFull ?? "").split("\n");
      const newLines = latest.markdownFull.split("\n");
      const oldSet = new Set(oldLines);
      const newSet = new Set(newLines);
      const added = newLines.filter((l) => l.trim() && !oldSet.has(l));
      const removed = oldLines.filter((l) => l.trim() && !newSet.has(l));
      if (added.length || removed.length || !lastPublished) {
        pages.push({
          slug: p.slug, title: p.title,
          latestVersion: { id: latest.id, versionNumber: latest.versionNumber, visibility: latest.visibility },
          lastPublishedVersion: lastPublished ? { id: lastPublished.id, versionNumber: lastPublished.versionNumber } : null,
          added, removed,
        });
      }
    }
    res.json({ overviewSlug: req.params.slug, changedPages: pages });
  } catch (err) { logger.error({ err }, "publish-diff failed"); res.status(500).json({ error: "publish-diff failed" }); }
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
