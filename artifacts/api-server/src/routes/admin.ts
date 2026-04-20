import { Router } from "express";
import { db, papersTable, reviewsTable, reviewSessionsTable, sessionPapersTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { logger } from "../lib/logger";

const router = Router();

const ADMIN_EMAIL = process.env.VITE_ADMIN_EMAIL || process.env.ADMIN_EMAIL || "";

function requireAdmin(req: any, res: any): boolean {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return false; }
  if (!ADMIN_EMAIL || req.user.email !== ADMIN_EMAIL) { res.status(403).json({ error: "Forbidden" }); return false; }
  return true;
}

// POST /api/admin/snapshot-and-delete
// Captures all current papers + their review scores into a session, then deletes all papers.
router.post("/admin/snapshot-and-delete", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const papers = await db.select().from(papersTable).orderBy(desc(papersTable.createdAt));
    if (papers.length === 0) {
      res.json({ sessionId: null, paperCount: 0, message: "No papers to snapshot." });
      return;
    }

    const reviews = await db.select().from(reviewsTable);
    const reviewByPaper = new Map(reviews.map(r => [r.paperId, r]));

    const promptTexts = [...new Set(reviews.map(r => r.systemPrompt).filter(Boolean))];
    const promptText = promptTexts[0] ?? "";
    const modelNames = [...new Set(papers.map(p => p.modelName).filter(Boolean))].join(", ");

    const [session] = await db.insert(reviewSessionsTable).values({
      promptText,
      modelNames,
      paperCount: papers.length,
    }).returning();

    const sessionPaperRows = papers.map(p => {
      const rv = reviewByPaper.get(p.id);
      return {
        sessionId: session.id,
        title: p.title,
        paperAuthors: p.paperAuthors ?? null,
        field: p.field ?? null,
        modelName: p.modelName ?? null,
        bestClassification: rv?.bestClassification ?? null,
        overallScore: rv?.overallIntrinsicScore != null ? Number(rv.overallIntrinsicScore) : (p.score ?? null),
        intrinsicMeritScore: rv?.intrinsicScientificMeritScore != null ? Number(rv.intrinsicScientificMeritScore) : null,
        explanatoryTargetBreadthScore: rv?.explanatoryTargetBreadthScore != null ? Number(rv.explanatoryTargetBreadthScore) : null,
        theorySpaceBreadthScore: rv?.theorySpaceBreadthScore != null ? Number(rv.theorySpaceBreadthScore) : null,
        breadthOfImpactScore: rv?.breadthOfImpactScore != null ? Number(rv.breadthOfImpactScore) : null,
      };
    });

    await db.insert(sessionPapersTable).values(sessionPaperRows);

    // Delete all papers (cascades to reviews, comments, likes)
    await db.delete(papersTable);

    logger.info({ sessionId: session.id, paperCount: papers.length }, "Admin snapshot-and-delete complete");
    res.json({ sessionId: session.id, paperCount: papers.length });
  } catch (err: any) {
    logger.error({ err }, "snapshot-and-delete failed");
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/snapshots
// Returns all saved sessions with their papers.
router.get("/admin/snapshots", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const sessions = await db.select().from(reviewSessionsTable).orderBy(desc(reviewSessionsTable.createdAt));
    const papers = await db.select().from(sessionPapersTable);

    const papersBySession = new Map<string, typeof papers>();
    for (const p of papers) {
      if (!papersBySession.has(p.sessionId)) papersBySession.set(p.sessionId, []);
      papersBySession.get(p.sessionId)!.push(p);
    }

    const result = sessions.map(s => ({
      ...s,
      papers: papersBySession.get(s.id) ?? [],
    }));

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
