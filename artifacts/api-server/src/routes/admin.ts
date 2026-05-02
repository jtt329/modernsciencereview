import { Router } from "express";
import { db, papersTable, reviewsTable, reviewSessionsTable, sessionPapersTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import OpenAI from "openai";
import { ai as geminiAI } from "@workspace/integrations-gemini-ai";
import { randomUUID } from "crypto";

const router = Router();

const ADMIN_EMAIL = process.env.VITE_ADMIN_EMAIL || process.env.ADMIN_EMAIL || "";
const GPT_MODEL = "gpt-5.4-pro";
const GEMINI_MODEL = "gemini-3.1-pro-preview";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

function extractJson(raw: string): unknown {
  let s = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try { return JSON.parse(s); } catch { /* fall through */ }
  const lastBrace = s.lastIndexOf("}");
  if (lastBrace !== -1) {
    try { return JSON.parse(s.slice(0, lastBrace + 1)); } catch { /* fall through */ }
  }
  throw new Error("Could not parse model response as JSON");
}

async function runReviewWithPrompt(content: string, prompt: string, model: "gpt" | "gemini"): Promise<{ review: any; thinkingText: string | null }> {
  if (model === "gemini") {
    const response = await geminiAI.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: "user", parts: [{ text: content }] }],
      config: {
        systemInstruction: prompt,
        responseMimeType: "application/json",
        maxOutputTokens: 32768,
        thinkingConfig: { includeThoughts: true, thinkingLevel: 'HIGH' },
      } as any,
    });
    if (!response.text) throw new Error("No response from Gemini");

    const parts: any[] = (response as any).candidates?.[0]?.content?.parts ?? [];
    const thinkingParts = parts.filter((p: any) => p.thought === true);
    const thinkingText = thinkingParts.length > 0
      ? thinkingParts.map((p: any) => p.text ?? "").join("\n\n").trim()
      : null;

    return { review: extractJson(response.text), thinkingText };
  } else {
    const response = await openai.responses.create({
      model: GPT_MODEL,
      instructions: prompt,
      input: content,
      max_output_tokens: 32768,
    });
    if (!response.output_text) throw new Error("No response from GPT");
    return { review: extractJson(response.output_text), thinkingText: null };
  }
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
      const reviewJson = rv ? JSON.stringify({
        centralClaim: rv.centralClaim,
        establishedResults: rv.establishedResults,
        interpretiveClaims: rv.interpretiveClaims,
        speculativeClaims: rv.speculativeClaims,
        economy: rv.economy,
        scopeDepth: rv.scopeDepth,
        unifyingPower: rv.unifyingPower,
        strongestCaseForImportance: rv.strongestCaseForImportance,
        strongestObjection: rv.strongestObjection,
        decisiveCheck: rv.decisiveCheck,
        internalTechnicalTraction: rv.internalTechnicalTraction,
        noveltyConfidence: rv.noveltyConfidence,
        explanatoryTargetBreadth: rv.explanatoryTargetBreadth,
        theorySpaceBreadth: rv.theorySpaceBreadth,
        finalJudgment: rv.finalJudgment,
        bestClassification: rv.bestClassification,
        overallIntrinsicScore: rv.overallIntrinsicScore,
        intrinsicScientificMeritScore: rv.intrinsicScientificMeritScore,
        explanatoryTargetBreadthScore: rv.explanatoryTargetBreadthScore,
        theorySpaceBreadthScore: rv.theorySpaceBreadthScore,
        breadthOfImpactScore: rv.breadthOfImpactScore,
        modelName: rv.modelName,
        summary: rv.summary,
        overallEvaluation: rv.overallEvaluation,
      }) : null;
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
    const useModel: "gpt" | "gemini" = model === "gemini" ? "gemini" : "gpt";
    const modelName = useModel === "gemini" ? GEMINI_MODEL : GPT_MODEL;

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
      const reviewJson = rv ? JSON.stringify({
        centralClaim: rv.centralClaim,
        establishedResults: rv.establishedResults,
        interpretiveClaims: rv.interpretiveClaims,
        speculativeClaims: rv.speculativeClaims,
        economy: rv.economy,
        scopeDepth: rv.scopeDepth,
        unifyingPower: rv.unifyingPower,
        strongestCaseForImportance: rv.strongestCaseForImportance,
        strongestObjection: rv.strongestObjection,
        decisiveCheck: rv.decisiveCheck,
        internalTechnicalTraction: rv.internalTechnicalTraction,
        noveltyConfidence: rv.noveltyConfidence,
        explanatoryTargetBreadth: rv.explanatoryTargetBreadth,
        theorySpaceBreadth: rv.theorySpaceBreadth,
        finalJudgment: rv.finalJudgment,
        bestClassification: rv.bestClassification,
        overallIntrinsicScore: rv.overallIntrinsicScore,
        intrinsicScientificMeritScore: rv.intrinsicScientificMeritScore,
        explanatoryTargetBreadthScore: rv.explanatoryTargetBreadthScore,
        theorySpaceBreadthScore: rv.theorySpaceBreadthScore,
        breadthOfImpactScore: rv.breadthOfImpactScore,
        modelName: rv.modelName,
        summary: rv.summary,
        overallEvaluation: rv.overallEvaluation,
      }) : null;
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

          const { review: r, thinkingText } = await runReviewWithPrompt(content, promptText.trim(), useModel);

          const coverageLedgerJson = (r.coverageLedger || r.directTargets || r.importedInputs || r.theorySpaceVariants || r.mechanismSharingAssessment)
            ? JSON.stringify({
                coverageLedger: r.coverageLedger ?? null,
                directTargets: r.directTargets ?? [],
                importedInputs: r.importedInputs ?? [],
                theorySpaceVariants: r.theorySpaceVariants ?? [],
                mechanismSharingAssessment: r.mechanismSharingAssessment ?? null,
              })
            : null;

          const noveltyConf = r.noveltyConfidence != null ? String(r.noveltyConfidence) : null;

          await db.insert(reviewsTable).values({
            paperId: paper.id,
            summary: r.summary ?? "",
            correctness: r.correctness ?? "",
            novelty: r.novelty ?? "",
            overallEvaluation: r.finalJudgment ?? "",
            score: Math.round(r.overallIntrinsicScore ?? 0),
            relatedWork: r.relatedWork ?? "",
            centralClaim: r.centralClaim ?? null,
            establishedResults: r.establishedResults ?? null,
            interpretiveClaims: r.interpretiveClaims ?? null,
            speculativeClaims: r.speculativeClaims ?? null,
            economy: r.economy ?? null,
            explanatoryTargetBreadth: r.explanatoryTargetBreadth ?? null,
            theorySpaceBreadth: r.theorySpaceBreadth ?? null,
            scopeDepth: r.scopeDepth ?? null,
            unifyingPower: r.unifyingPower ?? null,
            strongestCaseForImportance: r.strongestCaseForImportance ?? null,
            strongestObjection: r.strongestObjection ?? null,
            decisiveCheck: r.decisiveCheck ?? null,
            internalTechnicalTraction: r.internalTechnicalTraction ?? null,
            noveltyConfidence: noveltyConf,
            intrinsicScientificMeritScore: r.intrinsicScientificMeritScore != null ? Math.round(r.intrinsicScientificMeritScore) : null,
            explanatoryTargetBreadthScore: r.explanatoryTargetBreadthScore != null ? Math.round(r.explanatoryTargetBreadthScore) : null,
            theorySpaceBreadthScore: r.theorySpaceBreadthScore != null ? Math.round(r.theorySpaceBreadthScore) : null,
            breadthOfImpactScore: r.breadthOfImpactScore != null ? Math.round(r.breadthOfImpactScore) : null,
            overallIntrinsicScore: r.overallIntrinsicScore != null ? Math.round(r.overallIntrinsicScore) : null,
            bestClassification: r.bestClassification ?? null,
            finalJudgment: r.finalJudgment ?? null,
            coverageLedgerJson,
            thinkingText: thinkingText ?? null,
            modelName: modelName,
            systemPrompt: promptText.trim(),
          });

          // Update paper score + model
          await db
            .update(papersTable)
            .set({
              score: r.overallIntrinsicScore != null ? Math.round(r.overallIntrinsicScore) : paper.score,
              modelName: modelName,
              field: r.field ?? paper.field,
              subfields: r.subfields ?? paper.subfields,
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
        score: sp.overallScore ?? 0,
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
        intrinsicScientificMeritScore: sp.intrinsicMeritScore ?? null,
        explanatoryTargetBreadthScore: sp.explanatoryTargetBreadthScore ?? null,
        theorySpaceBreadthScore: sp.theorySpaceBreadthScore ?? null,
        breadthOfImpactScore: sp.breadthOfImpactScore ?? null,
        overallIntrinsicScore: sp.overallScore ?? null,
        bestClassification: sp.bestClassification ?? null,
        finalJudgment: rv.finalJudgment ?? null,
        modelName: sp.modelName ?? "unknown",
        systemPrompt: session?.promptText ?? "",
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

// TEMPORARY: one-time data seed endpoint — remove after migration
router.post("/admin/seed", async (req, res) => {
  const SEED_SECRET = process.env.SEED_SECRET;
  if (!SEED_SECRET || req.headers["x-seed-secret"] !== SEED_SECRET) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  try {
    const { users, papers, reviews } = req.body as { users: any[]; papers: any[]; reviews: any[] };

    const { sql } = await import("drizzle-orm");
    const { Pool } = await import("pg") as any;
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });

    // Insert users
    for (const u of users ?? []) {
      await pool.query(
        `INSERT INTO users (id, email, first_name, last_name, profile_image_url, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
        [u.id, u.email, u.first_name, u.last_name, u.profile_image_url, u.created_at, u.updated_at]
      );
    }

    // Insert papers
    for (const p of papers ?? []) {
      await pool.query(
        `INSERT INTO papers (id, title, content, author_id, author_name, paper_authors, field, subfields, score, model_name, pdf_url, display_pdf, likes_count, view_count, comment_count, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT (id) DO NOTHING`,
        [p.id, p.title, p.content, p.author_id, p.author_name, p.paper_authors, p.field, p.subfields, p.score, p.model_name, p.pdf_url, p.display_pdf, p.likes_count, p.view_count, p.comment_count, p.created_at]
      );
    }

    // Insert reviews
    for (const r of reviews ?? []) {
      await pool.query(
        `INSERT INTO reviews (id, paper_id, summary, correctness, novelty, overall_evaluation, score, related_work, central_claim, established_results, interpretive_claims, speculative_claims, economy, scope_depth, unifying_power, strongest_case_for_importance, strongest_objection, decisive_check, internal_technical_traction, novelty_confidence, explanatory_target_breadth, theory_space_breadth, intrinsic_scientific_merit_score, explanatory_target_breadth_score, theory_space_breadth_score, breadth_of_impact_score, overall_intrinsic_score, best_classification, final_judgment, coverage_ledger_json, thinking_text, model_name, system_prompt, likes_count, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35) ON CONFLICT (id) DO NOTHING`,
        [r.id, r.paper_id, r.summary, r.correctness, r.novelty, r.overall_evaluation, r.score, r.related_work, r.central_claim, r.established_results, r.interpretive_claims, r.speculative_claims, r.economy, r.scope_depth, r.unifying_power, r.strongest_case_for_importance, r.strongest_objection, r.decisive_check, r.internal_technical_traction, r.novelty_confidence, r.explanatory_target_breadth, r.theory_space_breadth, r.intrinsic_scientific_merit_score, r.explanatory_target_breadth_score, r.theory_space_breadth_score, r.breadth_of_impact_score, r.overall_intrinsic_score, r.best_classification, r.final_judgment, r.coverage_ledger_json, r.thinking_text, r.model_name, r.system_prompt, r.likes_count, r.created_at]
      );
    }

    await pool.end();
    res.json({ ok: true, users: (users ?? []).length, papers: (papers ?? []).length, reviews: (reviews ?? []).length });
  } catch (err: any) {
    logger.error({ err }, "Seed error");
    res.status(500).json({ error: err.message });
  }
});

export default router;
