import { Router } from "express";
import { db, papersTable, reviewsTable, reviewSessionsTable, sessionPapersTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
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
      const reviewJson = rv ? JSON.stringify(rv) : null;
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
        reviewJson,
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

// POST /api/admin/snapshots/:sessionId/restore
// Re-inserts all papers from a saved session back into the live papers table.
router.post("/admin/snapshots/:sessionId/restore", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const adminUser = req.user;
  if (!adminUser) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const { sessionId } = req.params;
    const sessionPapers = await db.select().from(sessionPapersTable).where(eq(sessionPapersTable.sessionId, sessionId));
    if (sessionPapers.length === 0) {
      res.status(404).json({ error: "No papers found for this session." });
      return;
    }

    const [session] = await db.select().from(reviewSessionsTable).where(eq(reviewSessionsTable.id, sessionId));

    let restored = 0;
    for (const sp of sessionPapers) {
      const [paper] = await db.insert(papersTable).values({
        title: sp.title,
        content: `[RESTORED] ${sp.title}`,
        authorId: adminUser.id,
        authorName: sp.paperAuthors || "Restored",
        paperAuthors: sp.paperAuthors ?? null,
        field: sp.field ?? "Unknown",
        score: sp.overallScore ?? null,
        modelName: sp.modelName ?? null,
      }).returning();

      let rv: any = {};
      if (sp.reviewJson) {
        try { rv = JSON.parse(sp.reviewJson); } catch { /* use defaults */ }
      }
      await db.insert(reviewsTable).values({
        paperId: paper.id,
        summary: rv.summary ?? "",
        correctness: rv.correctness ?? "",
        novelty: rv.novelty ?? "",
        overallEvaluation: rv.overallEvaluation ?? rv.finalJudgment ?? "",
        score: rv.score ?? sp.overallScore ?? 0,
        relatedWork: rv.relatedWork ?? "",
        centralClaim: rv.centralClaim ?? null,
        establishedResults: rv.establishedResults ?? null,
        interpretiveClaims: rv.interpretiveClaims ?? null,
        speculativeClaims: rv.speculativeClaims ?? null,
        economy: rv.economy ?? null,
        explanatoryTargetBreadth: rv.explanatoryTargetBreadth ?? null,
        theorySpaceBreadth: rv.theorySpaceBreadth ?? null,
        scopeDepth: rv.scopeDepth ?? null,
        unifyingPower: rv.unifyingPower ?? null,
        strongestCaseForImportance: rv.strongestCaseForImportance ?? null,
        strongestObjection: rv.strongestObjection ?? null,
        decisiveCheck: rv.decisiveCheck ?? null,
        internalTechnicalTraction: rv.internalTechnicalTraction ?? null,
        noveltyConfidence: rv.noveltyConfidence != null ? String(rv.noveltyConfidence) : null,
        intrinsicScientificMeritScore: rv.intrinsicScientificMeritScore ?? sp.intrinsicMeritScore ?? null,
        explanatoryTargetBreadthScore: rv.explanatoryTargetBreadthScore ?? sp.explanatoryTargetBreadthScore ?? null,
        theorySpaceBreadthScore: rv.theorySpaceBreadthScore ?? sp.theorySpaceBreadthScore ?? null,
        breadthOfImpactScore: rv.breadthOfImpactScore ?? sp.breadthOfImpactScore ?? null,
        overallIntrinsicScore: rv.overallIntrinsicScore ?? sp.overallScore ?? null,
        bestClassification: rv.bestClassification ?? sp.bestClassification ?? null,
        finalJudgment: rv.finalJudgment ?? null,
        coverageLedgerJson: rv.coverageLedgerJson ?? null,
        thinkingText: rv.thinkingText ?? null,
        modelName: rv.modelName ?? sp.modelName ?? "unknown",
        systemPrompt: rv.systemPrompt ?? session?.promptText ?? "",
      });
      restored++;
    }

    logger.info({ sessionId, restored }, "Admin restore-batch complete");
    res.json({ restored });
  } catch (err: any) {
    logger.error({ err }, "restore-batch failed");
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
