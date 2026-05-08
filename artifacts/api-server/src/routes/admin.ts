import { Router } from "express";
import { db, papersTable, reviewsTable, reviewSessionsTable, sessionPapersTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { randomUUID } from "crypto";
import { extractMetadata, generateCompatReview, type ReviewModel } from "../lib/reviewEngineCompat";

const router = Router();

const ADMIN_EMAIL = process.env.VITE_ADMIN_EMAIL || process.env.ADMIN_EMAIL || "";

function requireAdmin(req: any, res: any): boolean {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return false; }
  if (!ADMIN_EMAIL || req.user.email !== ADMIN_EMAIL) { res.status(403).json({ error: "Forbidden" }); return false; }
  return true;
}

// In-memory job tracking for re-review runs
interface ReReviewJob {
  total: number;
  done: number;
  skipped: number;
  status: "running" | "done" | "error";
  error?: string;
}
const reReviewJobs = new Map<string, ReReviewJob>();

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

// POST /api/admin/re-review
// Snapshots current reviews → analysis, deletes reviews, then re-runs all with a new prompt.
// Returns a jobId that can be polled for progress.
router.post("/admin/re-review", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const { promptText, model } = req.body;
    if (!promptText?.trim()) { res.status(400).json({ error: "promptText is required" }); return; }
    const useModel: ReviewModel = model === "gemini" ? "gemini" : "gpt";

    const papers = await db.select().from(papersTable).orderBy(desc(papersTable.createdAt));
    if (papers.length === 0) { res.status(400).json({ error: "No papers on the homepage to re-review." }); return; }

    const reviews = await db.select().from(reviewsTable);
    const reviewByPaper = new Map(reviews.map(r => [r.paperId, r]));

    // Snapshot current state into analysis
    const oldModelNames = [...new Set(papers.map(p => p.modelName).filter(Boolean))].join(", ");
    const promptTexts = [...new Set(reviews.map(r => r.systemPrompt).filter(Boolean))];
    const oldPrompt = promptTexts[0] ?? "";

    const [session] = await db.insert(reviewSessionsTable).values({
      promptText: oldPrompt,
      modelNames: oldModelNames,
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

    // Delete all existing reviews (papers stay)
    await db.delete(reviewsTable);

    // Create job
    const jobId = randomUUID();
    const job: ReReviewJob = { total: papers.length, done: 0, skipped: 0, status: "running" };
    reReviewJobs.set(jobId, job);

    // Process in background
    (async () => {
      for (const paper of papers) {
        try {
          // Get content: prefer stored text, fallback to fetching PDF by URL
          let content = paper.content ?? "";
          const isPlaceholder = content.startsWith("[PDF]") || content.startsWith("[RESTORED]");

          if (isPlaceholder) {
            if (paper.pdfUrl) {
              try {
                const fetchResp = await fetch(paper.pdfUrl);
                if (!fetchResp.ok) throw new Error("fetch failed");
                const buf = Buffer.from(await fetchResp.arrayBuffer());
                const pdfParse = (await import("pdf-parse")).default;
                const parsed = await pdfParse(buf);
                content = parsed.text ?? "";
                content = content.replace(/\x00/g, "").replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ");
                if (content.trim().length < 50) throw new Error("too short");
              } catch {
                job.skipped++;
                job.done++;
                continue;
              }
            } else {
              job.skipped++;
              job.done++;
              continue;
            }
          }

          const metadata = await extractMetadata(content);
          const { reviewValues, metadata: reviewMetadata } = await generateCompatReview(content, useModel, promptText.trim());

          await db.insert(reviewsTable).values({
            paperId: paper.id,
            ...reviewValues,
          });

          // Update paper score + model
          await db
            .update(papersTable)
            .set({
              score: reviewValues.score ?? paper.score,
              modelName: reviewMetadata.modelName,
              field: reviewMetadata.field || paper.field,
              subfields: reviewMetadata.subfields ?? paper.subfields,
              title: metadata.title || paper.title,
              paperAuthors: metadata.authors || paper.paperAuthors,
            })
            .where(eq(papersTable.id, paper.id));

        } catch (err: any) {
          logger.error({ err, paperId: paper.id }, "Re-review failed for paper");
          job.skipped++;
        }
        job.done++;
      }
      job.status = "done";
      logger.info({ jobId, done: job.done, skipped: job.skipped }, "Re-review job complete");
      // Clean up job after 10 minutes
      setTimeout(() => reReviewJobs.delete(jobId), 10 * 60 * 1000);
    })().catch(err => {
      job.status = "error";
      job.error = err.message;
    });

    res.json({ jobId, total: papers.length });
  } catch (err: any) {
    logger.error({ err }, "re-review start failed");
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/re-review/:jobId — poll re-review job progress
router.get("/admin/re-review/:jobId", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const job = reReviewJobs.get(req.params.jobId);
  if (!job) { res.status(404).json({ error: "Job not found or expired" }); return; }
  res.json(job);
});

// POST /api/admin/snapshots/:sessionId/restore
// Re-inserts all papers from a saved session back into the live papers table.
router.post("/admin/snapshots/:sessionId/restore", async (req, res) => {
  if (!requireAdmin(req, res)) return;
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
        authorId: req.user.id,
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
        comparisonCohort: rv.comparisonCohort ?? null,
        broadField: rv.broadField ?? null,
        specialtyField: rv.specialtyField ?? null,
        frameworkConditionalityLevel: rv.frameworkConditionalityLevel ?? null,
        frameworkConditionalityExplanation: rv.frameworkConditionalityExplanation ?? null,
        specialtyRelativeScore: rv.specialtyRelativeScore ?? null,
        broadFieldRelativeScore: rv.broadFieldRelativeScore ?? null,
        crossFieldConsequenceScore: rv.crossFieldConsequenceScore ?? null,
        scoreBandLow: rv.scoreBandLow ?? null,
        scoreBandMedian: rv.scoreBandMedian ?? null,
        scoreBandHigh: rv.scoreBandHigh ?? null,
        scoreConfidence: rv.scoreConfidence != null ? String(rv.scoreConfidence) : null,
        scoreStability: rv.scoreStability ?? null,
        publicVerdict: rv.publicVerdict ?? null,
        individualReviewsJson: rv.individualReviewsJson ?? null,
        aggregateMetaJson: rv.aggregateMetaJson ?? null,
        passCount: rv.passCount ?? 1,
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
