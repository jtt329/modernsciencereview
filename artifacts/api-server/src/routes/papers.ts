import { Router } from "express";
import { db, papersTable, reviewsTable, commentsTable, likesTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import OpenAI from "openai";
import { ai as geminiAI } from "@workspace/integrations-gemini-ai";
import { logger } from "../lib/logger";
import {
  REVIEW_SYSTEM_INSTRUCTION as LATEST_REVIEW_SYSTEM_INSTRUCTION,
  extractMetadata as extractLatestMetadata,
  generateCompatReview,
  type ReviewModel,
} from "../lib/reviewEngineCompat";

let openai: OpenAI | null = null;
function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required for OpenAI-powered chat replies.");
  }
  openai ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openai;
}

const GPT_MODEL = "gpt-5.4-pro";
const GEMINI_MODEL = process.env.SCIREVIEW_GEMINI_MODEL?.trim() || "gemini-3.1-pro-preview";

const ADMIN_EMAIL = process.env.VITE_ADMIN_EMAIL || process.env.ADMIN_EMAIL || "";

const router = Router();

// GET /api/papers/system-prompt — return the review system prompt
router.get("/papers/system-prompt", (_req, res) => {
  res.json({ prompt: LATEST_REVIEW_SYSTEM_INSTRUCTION });
});

// GET /api/papers/export — download all reviews as structured JSON (model output only)
router.get("/papers/export", async (_req, res) => {
  try {
    const papers = await db.select().from(papersTable).orderBy(desc(papersTable.createdAt));
    const reviews = await db.select().from(reviewsTable);
    const reviewMap = new Map(reviews.map(r => [r.paperId, r]));

    const exported = papers.map(p => {
      const r = reviewMap.get(p.id);
      return {
        paper: {
          id: p.id,
          title: p.title,
          paperAuthors: p.paperAuthors,
          field: p.field,
          subfields: p.subfields,
          createdAt: p.createdAt,
          pdfUrl: p.pdfUrl,
        },
        review: r ? {
          modelName: r.modelName,
          overallIntrinsicScore: r.overallIntrinsicScore,
          intrinsicScientificMeritScore: r.intrinsicScientificMeritScore,
          explanatoryTargetBreadthScore: r.explanatoryTargetBreadthScore,
          theorySpaceBreadthScore: r.theorySpaceBreadthScore,
          breadthOfImpactScore: r.breadthOfImpactScore,
          bestClassification: r.bestClassification,
          centralClaim: r.centralClaim,
          summary: r.summary,
          correctness: r.correctness,
          novelty: r.novelty,
          noveltyConfidence: r.noveltyConfidence,
          internalTechnicalTraction: r.internalTechnicalTraction,
          economy: r.economy,
          scopeDepth: r.scopeDepth,
          unifyingPower: r.unifyingPower,
          explanatoryTargetBreadth: r.explanatoryTargetBreadth,
          theorySpaceBreadth: r.theorySpaceBreadth,
          establishedResults: r.establishedResults,
          interpretiveClaims: r.interpretiveClaims,
          speculativeClaims: r.speculativeClaims,
          strongestCaseForImportance: r.strongestCaseForImportance,
          strongestObjection: r.strongestObjection,
          decisiveCheck: r.decisiveCheck,
          finalJudgment: r.finalJudgment,
          relatedWork: r.relatedWork,
          coverageLedger: r.coverageLedgerJson ? JSON.parse(r.coverageLedgerJson) : null,
          createdAt: r.createdAt,
        } : null,
      };
    });

    res.json({ exportedAt: new Date().toISOString(), systemPrompt: LATEST_REVIEW_SYSTEM_INSTRUCTION, count: exported.length, papers: exported });
  } catch (err: any) {
    logger.error({ err }, "Error exporting papers");
    res.status(500).json({ error: err.message });
  }
});

// GET /api/papers — list all papers
router.get("/papers", async (req, res) => {
  try {
    const papers = await db.select().from(papersTable).orderBy(desc(papersTable.createdAt));
    const reviews = await db.select({
      paperId: reviewsTable.paperId,
      summary: reviewsTable.summary,
      centralClaim: reviewsTable.centralClaim,
      finalJudgment: reviewsTable.finalJudgment,
    }).from(reviewsTable);
    const reviewMap = new Map(reviews.map(r => [r.paperId, r]));
    const papersWithSummary = papers.map(p => ({
      ...p,
      reviewSummary: reviewMap.get(p.id)?.summary || null,
      reviewCentralClaim: reviewMap.get(p.id)?.centralClaim || null,
      reviewFinalJudgment: reviewMap.get(p.id)?.finalJudgment || null,
    }));
    res.json({ papers: papersWithSummary });
  } catch (err: any) {
    logger.error({ err }, "Error listing papers");
    res.status(500).json({ error: err.message });
  }
});

// GET /api/papers/:id — get paper with review
router.get("/papers/:id", async (req, res) => {
  try {
    const [paper] = await db.select().from(papersTable).where(eq(papersTable.id, req.params.id));
    if (!paper) { res.status(404).json({ error: "Paper not found" }); return; }

    const [review] = await db.select().from(reviewsTable).where(eq(reviewsTable.paperId, paper.id));
    res.json({ paper, review: review || null });
  } catch (err: any) {
    logger.error({ err }, "Error getting paper");
    res.status(500).json({ error: err.message });
  }
});

// POST /api/papers — submit paper (extracts metadata, generates AI review, stores all)
router.post("/papers", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  try {
    const { source } = req.body;
    if (!source?.type || !source?.data) { res.status(400).json({ error: "source.type and source.data are required" }); return; }

    let paperContent: string;
    let submittedPdfUrl: string | null = source.pdfUrl?.trim() || null;
    const submittedDisplayPdf: boolean = !!(source.displayPdf && submittedPdfUrl);

    if (source.type === "pdf") {
      const buffer = Buffer.from(source.data, "base64");
      const pdfParse = (await import("pdf-parse")).default;
      const parsed = await pdfParse(buffer);
      paperContent = parsed.text;
      if (!paperContent || paperContent.trim().length < 50) {
        res.status(400).json({ error: "Could not extract readable text from PDF. Try submitting as raw text instead." });
        return;
      }
    } else if (source.type === "url") {
      const url = source.data?.trim();
      if (!url) { res.status(400).json({ error: "A valid URL is required." }); return; }
      try { new URL(url); } catch { res.status(400).json({ error: "Invalid URL." }); return; }
      const fetchResp = await fetch(url);
      if (!fetchResp.ok) {
        res.status(400).json({ error: `Could not fetch PDF from URL (${fetchResp.status}). Make sure it is a direct link to a publicly accessible PDF.` });
        return;
      }
      const arrayBuf = await fetchResp.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      const pdfParse = (await import("pdf-parse")).default;
      const parsed = await pdfParse(buffer);
      paperContent = parsed.text;
      if (!paperContent || paperContent.trim().length < 50) {
        res.status(400).json({ error: "Could not extract readable text from the linked PDF." });
        return;
      }
      submittedPdfUrl = url;
    } else {
      paperContent = source.data;
    }
    // Strip null bytes and non-printable control characters that break JSON serialisation
    paperContent = paperContent.replace(/\x00/g, "").replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ");

    const selectedModel: ReviewModel = req.body.model === "gemini" ? "gemini" : "gpt";

    // Step 1: extract real title and authors (before anonymous review)
    const metadata = await extractLatestMetadata(paperContent);

    // Step 2: run the new three-pass blind review flow
    const { reviewValues, metadata: reviewMetadata } = await generateCompatReview(paperContent, selectedModel);

    const submitterName = [req.user.firstName, req.user.lastName].filter(Boolean).join(" ") || req.user.email || "Anonymous";

    const [paper] = await db.insert(papersTable).values({
      title: metadata.title,
      content: (source.type === "pdf" || source.type === "url") ? `[PDF] ${metadata.title}` : paperContent,
      authorId: req.user.id,
      authorName: submitterName,
      paperAuthors: metadata.authors,
      field: reviewMetadata.field,
      subfields: reviewMetadata.subfields,
      score: reviewValues.score,
      modelName: reviewMetadata.modelName,
      pdfUrl: submittedPdfUrl,
      displayPdf: submittedDisplayPdf ? 1 : 0,
    }).returning();

    const [review] = await db.insert(reviewsTable).values({
      paperId: paper.id,
      ...reviewValues,
    }).returning();

    res.json({ paper, review });
  } catch (err: any) {
    logger.error({ err }, "Error creating paper");
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/papers/:id — owner or admin can delete
router.delete("/papers/:id", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const [paper] = await db.select().from(papersTable).where(eq(papersTable.id, req.params.id));
    if (!paper) { res.status(404).json({ error: "Not found" }); return; }
    const isAdmin = ADMIN_EMAIL && req.user.email === ADMIN_EMAIL;
    if (!isAdmin && paper.authorId !== req.user.id) { res.status(403).json({ error: "Forbidden" }); return; }
    await db.delete(papersTable).where(eq(papersTable.id, req.params.id));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/papers/:id/view
router.patch("/papers/:id/view", async (req, res) => {
  try {
    await db.execute(`UPDATE papers SET view_count = view_count + 1 WHERE id = '${req.params.id}'`);
    res.json({ success: true });
  } catch {
    res.json({ success: false });
  }
});

// GET /api/papers/:id/comments
router.get("/papers/:id/comments", async (req, res) => {
  try {
    const comments = await db
      .select()
      .from(commentsTable)
      .where(eq(commentsTable.paperId, req.params.id))
      .orderBy(commentsTable.createdAt);
    res.json({ comments });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/papers/:id/comments
router.post("/papers/:id/comments", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const { content } = req.body;
    if (!content?.trim()) { res.status(400).json({ error: "content is required" }); return; }

    const displayName = [req.user.firstName, req.user.lastName].filter(Boolean).join(" ") || req.user.email || "Anonymous";

    const [comment] = await db.insert(commentsTable).values({
      paperId: req.params.id,
      authorId: req.user.id,
      authorName: displayName,
      content: content.trim(),
    }).returning();

    await db.execute(`UPDATE papers SET comment_count = comment_count + 1 WHERE id = '${req.params.id}'`);
    res.json({ comment });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Helper: format a review into readable text for chat context
function buildReviewContext(review: any, paper: any): string {
  const parts: string[] = [];
  if (paper?.title) parts.push(`PAPER TITLE: ${paper.title}`);
  if (review.centralClaim) parts.push(`CENTRAL CLAIM:\n${review.centralClaim}`);
  if (review.establishedResults) parts.push(`ESTABLISHED RESULTS:\n${review.establishedResults}`);
  if (review.interpretiveClaims) parts.push(`INTERPRETIVE CLAIMS:\n${review.interpretiveClaims}`);
  if (review.speculativeClaims) parts.push(`SPECULATIVE CLAIMS:\n${review.speculativeClaims}`);
  if (review.economy) parts.push(`EXPLANATORY ECONOMY:\n${review.economy}`);
  if (review.explanatoryTargetBreadth) parts.push(`EXPLANATORY TARGET BREADTH:\n${review.explanatoryTargetBreadth}`);
  if (review.theorySpaceBreadth) parts.push(`THEORY SPACE BREADTH:\n${review.theorySpaceBreadth}`);
  if (review.scopeDepth) parts.push(`SCOPE AND DEPTH:\n${review.scopeDepth}`);
  if (review.unifyingPower) parts.push(`UNIFYING POWER:\n${review.unifyingPower}`);
  if (review.strongestCaseForImportance) parts.push(`STRONGEST CASE FOR IMPORTANCE:\n${review.strongestCaseForImportance}`);
  if (review.strongestObjection) parts.push(`STRONGEST OBJECTION:\n${review.strongestObjection}`);
  if (review.decisiveCheck) parts.push(`DECISIVE CHECK:\n${review.decisiveCheck}`);
  if (review.internalTechnicalTraction) parts.push(`INTERNAL TECHNICAL TRACTION:\n${review.internalTechnicalTraction}`);
  if (review.finalJudgment) parts.push(`FINAL JUDGMENT:\n${review.finalJudgment}`);
  const scores: string[] = [];
  if (review.intrinsicScientificMeritScore != null) scores.push(`  Intrinsic Scientific Merit: ${review.intrinsicScientificMeritScore}/100`);
  if (review.explanatoryTargetBreadthScore != null) scores.push(`  Explanatory Target Breadth: ${review.explanatoryTargetBreadthScore}/100`);
  if (review.theorySpaceBreadthScore != null) scores.push(`  Theory Space Breadth: ${review.theorySpaceBreadthScore}/100`);
  if (review.breadthOfImpactScore != null) scores.push(`  Breadth of Impact: ${review.breadthOfImpactScore}/100`);
  if (review.overallIntrinsicScore != null) scores.push(`  OVERALL INTRINSIC SCORE: ${review.overallIntrinsicScore}/100`);
  if (scores.length > 0) parts.push(`SCORES:\n${scores.join('\n')}`);
  // Legacy fields
  if (!review.centralClaim) {
    if (review.summary) parts.push(`SUMMARY:\n${review.summary}`);
    if (review.correctness) parts.push(`CORRECTNESS:\n${review.correctness}`);
    if (review.novelty) parts.push(`NOVELTY:\n${review.novelty}`);
    if (review.overallEvaluation) parts.push(`OVERALL EVALUATION:\n${review.overallEvaluation}`);
  }
  return parts.join('\n\n');
}

// POST /api/reviews/:reviewId/chat
router.post("/reviews/:reviewId/chat", async (req, res) => {
  try {
    const { reviewId } = req.params;
    const { messages } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: "messages array required" }); return;
    }

    const [review] = await db.select().from(reviewsTable).where(eq(reviewsTable.id, reviewId));
    if (!review) { res.status(404).json({ error: "Review not found" }); return; }

    const [paper] = await db.select().from(papersTable).where(eq(papersTable.id, review.paperId));

    const reviewContext = buildReviewContext(review, paper);

    const systemMessage = `You are a scientific manuscript reviewer who produced a detailed review and is now discussing it with a reader.

You evaluated this manuscript using the following framework:
---
${review.systemPrompt}
---

Here is the complete review you produced:
---
${reviewContext}
---${review.thinkingText ? `\n\nHere was your internal reasoning during this review:\n---\n${review.thinkingText}\n---` : ''}

You are now in a conversational mode. Help the user understand your review by:
- Explaining any part of your analysis in more depth
- Clarifying why you scored specific dimensions the way you did
- Discussing the paper's strengths and weaknesses in more detail
- Being honest about uncertainty and the limits of your assessment
- Speculating about implications or related work when asked

Maintain the same anonymous evaluation perspective: you assessed this manuscript without knowing author identity, institution, publication history, or historical significance.

Be concise, intellectually honest, and use markdown where helpful.`;

    const isGemini = (review.modelName ?? "").includes("gemini");

    if (isGemini) {
      const response = await (geminiAI.models.generateContent as any)({
        model: review.modelName || GEMINI_MODEL,
        config: { systemInstruction: systemMessage },
        contents: messages.map((m: any) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
      });
      res.json({ reply: response.text ?? "" });
    } else {
      const completion = await getOpenAI().chat.completions.create({
        model: review.modelName || GPT_MODEL,
        messages: [
          { role: 'system', content: systemMessage },
          ...messages.map((m: any) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        ],
      });
      res.json({ reply: completion.choices[0]?.message?.content ?? "" });
    }
  } catch (err: any) {
    logger.error({ err }, "Chat error");
    res.status(500).json({ error: err.message });
  }
});

// GET /api/likes
router.get("/likes", async (req, res) => {
  if (!req.isAuthenticated()) { res.json({ likes: [] }); return; }
  try {
    const likes = await db.select().from(likesTable).where(eq(likesTable.userId, req.user.id));
    res.json({ likes });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/likes
router.post("/likes", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const { targetId, targetType } = req.body;
    if (!targetId || !targetType) { res.status(400).json({ error: "targetId and targetType required" }); return; }

    const existing = await db.select().from(likesTable).where(
      and(eq(likesTable.userId, req.user.id), eq(likesTable.targetId, targetId))
    );

    if (existing.length > 0) {
      await db.delete(likesTable).where(
        and(eq(likesTable.userId, req.user.id), eq(likesTable.targetId, targetId))
      );
      if (targetType === "review") {
        await db.execute(`UPDATE reviews SET likes_count = GREATEST(likes_count - 1, 0) WHERE id = '${targetId}'`);
      } else if (targetType === "paper") {
        await db.execute(`UPDATE papers SET likes_count = GREATEST(likes_count - 1, 0) WHERE id = '${targetId}'`);
      }
      res.json({ liked: false });
    } else {
      await db.insert(likesTable).values({ userId: req.user.id, targetId, targetType });
      if (targetType === "review") {
        await db.execute(`UPDATE reviews SET likes_count = likes_count + 1 WHERE id = '${targetId}'`);
      } else if (targetType === "paper") {
        await db.execute(`UPDATE papers SET likes_count = likes_count + 1 WHERE id = '${targetId}'`);
      }
      res.json({ liked: true });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
