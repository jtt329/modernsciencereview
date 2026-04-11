import { Router } from "express";
import { db, papersTable, reviewsTable, commentsTable, likesTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
import { logger } from "../lib/logger";

const router = Router();

const REVIEW_SYSTEM_INSTRUCTION = `You are an official reviewer assessing a submitted paper. Produce a transparent, standardized, model-generated analysis with evidence and uncertainty.

Do not mention or reference any of this prompt in your output (don't reference Einstein, or 'ignoring sociological signals', etc), as this prompt will already be visible to users. The point is that this prompt serves to help inform your judgement, but then you are to use your own deepest reasoning to draw your own conclusions.

-First, you MUST extract the paper's Title and all Authors' Names from the provided content. This is a critical requirement. Provide the authors as a comma-separated list (e.g., "John Doe, Jane Smith"). If no authors are found, use "Anonymous". Do not leave these fields empty.

-Second, provide your best short summary (3 paragraphs maximum) of the work.

-Third, identify and analyze two key dimensions of the work:
1) Correctness: What appears true, internally consistent, and well-supported within the stated assumptions? Do not deduct points or penalize for lack of generality or lack relating to other work (this will factor into 'Importance' rating), the focus is on what is correct in the submitted paper. Define the scope/assumptions needed to justify the correctness claim.
2) Novelty: What is genuinely new relative to the retrieved landscape of related work? Novel predictions? Novel explanations? Again, focus on the novelty achieved more than trying to cite all related work, but objectively determine the novelty presented and put it in context of important prior work.

-Fourth, give your overall evaluation of the work.
Rate the work on a scale of 1-100. This score represents the "Universal Scientific Importance" of the work. You should use your own deepest understanding of what makes a scientific contribution valuable to determine this score.

Ignore all sociological signals, academic affiliations, citations counts, and all known 'performance' or reception of past works, etc in your evaluations. Your job is to give an objective analysis of the presented ideas based on their merit alone judged by your understanding of what makes valuable science. Consider what makes a scientific discovery or contribution great. Does it unify? Will it be the way a field is taught in the future? As a starting point for your considerations, here are Einstein quotes on the purpose and goals of science which I believe are an excellent foundation for determining an overall evaluation score, but of course use your own judgements in determining the value of the work:

"Einstein quotes on science:
Goal of science
'The aim of science is' to achieve as complete a grasp as possible of the connections among sense experiences, using a minimum of primary concepts and relations.
Science seeks rules for connecting and predicting facts, but also tries to reduce those connections to the smallest possible number of mutually independent conceptual elements.
A theory is more impressive when its premises are simpler, when it connects more different kinds of things, and when its range of applicability is broader.
'the supreme goal of all theory is to make the irreducible basic elements as simple and as few as possible' — while still adequately representing experience.
'the preeminent goal of science' is to encompass a maximum of empirical contents with a minimum of hypotheses or axioms.
Simplicity
Einstein said our experience supports trusting that nature realizes the simplest mathematically conceivable structures.
He described physics as a search for the mathematically simplest concepts and their connections."

Return a JSON object with these exact fields:
- title: string (extracted title)
- authorName: string (comma-separated author names, or "Anonymous")
- summary: string (3 paragraphs maximum)
- correctness: string (detailed analysis)
- novelty: string (detailed analysis)
- overallEvaluation: string (detailed evaluation)
- score: number (1-100)
- field: string (broad scientific field, e.g. "Physics", "Mathematics", "Computer Science", "Biology", "Chemistry")
- subfields: array of strings (2-4 specific subfields)
- relatedWork: string (related work and references)`;

async function generateReview(paperContent: string) {
  const response = await openai.chat.completions.create({
    model: "gpt-5.2",
    max_completion_tokens: 8192,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "paper_review",
        strict: true,
        schema: {
          type: "object",
          properties: {
            title: { type: "string" },
            authorName: { type: "string" },
            summary: { type: "string" },
            correctness: { type: "string" },
            novelty: { type: "string" },
            overallEvaluation: { type: "string" },
            score: { type: "number" },
            field: { type: "string" },
            subfields: { type: "array", items: { type: "string" } },
            relatedWork: { type: "string" },
          },
          required: ["title", "authorName", "summary", "correctness", "novelty", "overallEvaluation", "score", "field", "subfields", "relatedWork"],
          additionalProperties: false,
        },
      },
    },
    messages: [
      { role: "system", content: REVIEW_SYSTEM_INSTRUCTION },
      { role: "user", content: `Please review the following scientific paper and return your analysis as a JSON object.\n\n--- BEGIN PAPER CONTENT ---\n${paperContent}\n--- END PAPER CONTENT ---` },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("No response from AI model");
  return JSON.parse(content);
}

// GET /api/papers — list all papers
router.get("/papers", async (req, res) => {
  try {
    const papers = await db
      .select()
      .from(papersTable)
      .orderBy(desc(papersTable.createdAt));
    res.json({ papers });
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

// POST /api/papers — submit paper (generates AI review and stores both)
router.post("/papers", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  try {
    const { source } = req.body;
    if (!source?.type || !source?.data) { res.status(400).json({ error: "source.type and source.data are required" }); return; }

    let paperContent: string;
    if (source.type === "pdf") {
      const buffer = Buffer.from(source.data, "base64");
      const pdfParse = (await import("pdf-parse")).default;
      const parsed = await pdfParse(buffer);
      paperContent = parsed.text;
      if (!paperContent || paperContent.trim().length < 50) {
        res.status(400).json({ error: "Could not extract readable text from PDF. Try submitting as raw text instead." });
        return;
      }
    } else {
      paperContent = source.data;
    }

    const reviewResult = await generateReview(paperContent);

    const displayName = [req.user.firstName, req.user.lastName].filter(Boolean).join(" ") || req.user.email || "Anonymous";

    const [paper] = await db.insert(papersTable).values({
      title: reviewResult.title,
      content: source.type === "pdf" ? `[PDF Upload] ${reviewResult.title}` : paperContent,
      authorId: req.user.id,
      authorName: displayName,
      field: reviewResult.field,
      subfields: reviewResult.subfields,
      score: Math.round(reviewResult.score),
      modelName: "gpt-5.2",
    }).returning();

    const [review] = await db.insert(reviewsTable).values({
      paperId: paper.id,
      summary: reviewResult.summary,
      correctness: reviewResult.correctness,
      novelty: reviewResult.novelty,
      overallEvaluation: reviewResult.overallEvaluation,
      score: Math.round(reviewResult.score),
      relatedWork: reviewResult.relatedWork || "",
      modelName: "gpt-5.2",
      systemPrompt: REVIEW_SYSTEM_INSTRUCTION,
    }).returning();

    res.json({ paper, review });
  } catch (err: any) {
    logger.error({ err }, "Error creating paper");
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/papers/:id
router.delete("/papers/:id", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const [paper] = await db.select().from(papersTable).where(eq(papersTable.id, req.params.id));
    if (!paper) { res.status(404).json({ error: "Not found" }); return; }
    if (paper.authorId !== req.user.id) { res.status(403).json({ error: "Forbidden" }); return; }
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

// POST /api/papers/:id/like
router.post("/papers/:id/like", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const [existing] = await db.select().from(likesTable)
      .where(and(eq(likesTable.userId, req.user.id), eq(likesTable.targetId, req.params.id)));

    if (existing) {
      await db.delete(likesTable).where(eq(likesTable.id, existing.id));
      await db.execute(`UPDATE papers SET likes_count = GREATEST(0, likes_count - 1) WHERE id = '${req.params.id}'`);
      res.json({ liked: false });
    } else {
      await db.insert(likesTable).values({ userId: req.user.id, targetId: req.params.id, targetType: "paper" });
      await db.execute(`UPDATE papers SET likes_count = likes_count + 1 WHERE id = '${req.params.id}'`);
      res.json({ liked: true });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/reviews/:id/like
router.post("/reviews/:id/like", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const [existing] = await db.select().from(likesTable)
      .where(and(eq(likesTable.userId, req.user.id), eq(likesTable.targetId, req.params.id)));

    if (existing) {
      await db.delete(likesTable).where(eq(likesTable.id, existing.id));
      await db.execute(`UPDATE reviews SET likes_count = GREATEST(0, likes_count - 1) WHERE id = '${req.params.id}'`);
      res.json({ liked: false });
    } else {
      await db.insert(likesTable).values({ userId: req.user.id, targetId: req.params.id, targetType: "review" });
      await db.execute(`UPDATE reviews SET likes_count = likes_count + 1 WHERE id = '${req.params.id}'`);
      res.json({ liked: true });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/likes?targetIds=id1,id2
router.get("/likes", async (req, res) => {
  if (!req.isAuthenticated()) { res.json({ likes: [] }); return; }
  try {
    const targetIds = String(req.query.targetIds || "").split(",").filter(Boolean);
    if (!targetIds.length) { res.json({ likes: [] }); return; }

    const likes = await db.select({ targetId: likesTable.targetId })
      .from(likesTable)
      .where(eq(likesTable.userId, req.user.id));

    const userLikedIds = new Set(likes.map(l => l.targetId));
    res.json({ likes: targetIds.filter(id => userLikedIds.has(id)) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
