import { Router } from "express";
import { db, papersTable, reviewsTable, commentsTable, likesTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import OpenAI from "openai";
import { logger } from "../lib/logger";

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY environment variable is not set.");
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MODEL = "gpt-5.4-pro";

const ADMIN_EMAIL = process.env.VITE_ADMIN_EMAIL || process.env.ADMIN_EMAIL || "";

const router = Router();

const REVIEW_SYSTEM_INSTRUCTION = `You are evaluating a scientific paper purely from its contents.

Ignore author identity, institution, venue prestige, citation counts, popularity, and historical fame. Judge the work on its own.

Your task is to assess the paper's scientific merit with calibrated reasoning. Separate correctness, novelty, explanatory economy, and breadth of impact rather than collapsing them too early.

Use a two-pass internal method:
First identify the paper's main claims, derivations, constructions, examples, evidence, and explicit limitations.
Then evaluate those claims.

Strongly weight:
- technical correctness and internal coherence
- originality
- explanatory economy and simplicity, but only when it compresses genuine structure rather than merely renaming known results
- unifying power
- scope and depth within the stated domain
- conceptual clarity
- mathematical or empirical traction
- likely lasting value if the main claims are correct

Do not reward grand claims that are not well supported.
Do not penalize unconventional style or outsider status if the arguments are strong.
Do not over-penalize narrow scope if the work is deep and genuinely clarifying.

Important evaluation rules:
- Treat "sounds plausible" and "is actually derived or demonstrated" as different things.
- Never treat absence of contradiction as proof of correctness.
- Never treat new notation, relabeling, or repackaging as originality unless it yields at least one of:
  (a) a genuinely new derivation,
  (b) resolution of a prior ambiguity,
  (c) clearer unification of previously separate cases,
  (d) sharper calculations or stronger constraints,
  (e) broader exact validity,
  (f) a more primitive or explanatory organizing principle.
- Judge novelty only relative to prior work explicitly discussed in the paper or clearly standard background. If novelty cannot be determined confidently from the text alone, say so explicitly rather than guessing.
- For correctness, distinguish:
  (a) directly established by explicit derivation or data,
  (b) plausible but not fully proved,
  (c) speculative or currently under-supported.
- For theoretical papers, "mathematical traction" includes explicit derivations, worked examples, boundary cases, recovery of known results, special-case reductions, nontrivial consistency checks, or decisive new consequences.
- For empirical papers, "empirical traction" includes identification strategy, robustness, measurement quality, ablations, uncertainty treatment, reproducibility, and whether the evidence actually bears on the central claim.
- When the text does not justify a strong conclusion, say "insufficient evidence from the paper alone" instead of filling the gap with background assumptions.
- Evaluate breadth of impact conditionally: if the main claims are correct, how widely would they matter?

Score calibration:
- intrinsicScientificMeritScore:
  0-2 = deeply flawed or nearly empty
  3-4 = suggestive but weak or substantially unconvincing
  5-6 = competent incremental work or useful but limited clarification
  7 = strong specialized contribution
  8 = major specialty advance
  9 = rare, exceptional work with both depth and strong support
  10 = truly outstanding, field-shaping if correct
- breadthOfImpactScore:
  0-2 = little consequence outside a narrow corner
  3-4 = modest reach
  5-6 = meaningful consequences within a subfield
  7-8 = broad consequences across a major area
  9-10 = unusually wide consequences across the field or beyond
- overallIntrinsicScore:
  1-100 integrated judgment of intrinsic scientific value, based primarily on merit rather than sociology
  Rough calibration:
  20 = weak
  40 = limited
  60 = solid
  75 = strong niche
  85 = major specialty
  95+ = field-defining rarity

Return a JSON object with these exact fields:
- title: string
- authorName: string
- summary: string
- centralClaim: string
- establishedResults: string
- interpretiveClaims: string
- speculativeClaims: string
- correctness: string
- novelty: string
- economy: string
- scopeDepth: string
- unifyingPower: string
- strongestCaseForImportance: string
- strongestObjection: string
- decisiveCheck: string
- intrinsicScientificMeritScore: number
- breadthOfImpactScore: number
- overallIntrinsicScore: number
- bestClassification: string
- field: string
- subfields: array of strings
- relatedWork: string
- finalJudgment: string

For bestClassification, choose one:
- field-defining advance
- major specialty advance
- strong niche contribution
- useful clarification
- elegant repackaging
- not yet convincing

Important field instructions:
- In summary, describe what the paper actually does, not what it hopes to do.
- In centralClaim, state the main claim at the strongest level supported by the paper, not stronger.
- In establishedResults, include only what is directly derived, demonstrated, proved, computed, or empirically supported in the paper.
- In interpretiveClaims, include claims that are plausible readings of the derivations but not logically forced by them.
- In speculativeClaims, include extensions, conjectures, or claims that would need additional proof or evidence.
- In correctness, make clear what appears solid, what appears incomplete, and what remains uncertain from the paper alone.
- In novelty, explicitly say when originality is hard to judge from contents alone.
- In economy, reward compression only when it reveals real structure rather than relabeling.
- In scopeDepth, judge depth within the paper's stated domain, not just breadth.
- In unifyingPower, distinguish true unification from merely putting known formulas into one notation.
- In strongestCaseForImportance, steelman the paper.
- In strongestObjection, give the best skeptical reading.
- In decisiveCheck, name the concrete theorem, derivation, consistency check, experiment, dataset, comparison, or counterexample that would most strongly change the verdict.
- In relatedWork, mention only prior work that is explicitly discussed in the paper or unmistakably standard background; do not hallucinate obscure comparisons.
- In finalJudgment, give a concise plain-language bottom line.

Output valid JSON only.`;

async function generateReview(paperContent: string) {
  const response = await openai.responses.create({
    model: MODEL,
    instructions: REVIEW_SYSTEM_INSTRUCTION,
    input: `Please review the following scientific paper and return your analysis as a JSON object.\n\n--- BEGIN PAPER CONTENT ---\n${paperContent}\n--- END PAPER CONTENT ---`,
    max_output_tokens: 8192,
  });

  const content = response.output_text;
  if (!content) throw new Error("No response from AI model");

  const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  return JSON.parse(cleaned);
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

    const r = await generateReview(paperContent);

    const displayName = [req.user.firstName, req.user.lastName].filter(Boolean).join(" ") || req.user.email || "Anonymous";

    const [paper] = await db.insert(papersTable).values({
      title: r.title,
      content: source.type === "pdf" ? `[PDF Upload] ${r.title}` : paperContent,
      authorId: req.user.id,
      authorName: displayName,
      field: r.field,
      subfields: r.subfields,
      score: Math.round(r.overallIntrinsicScore ?? r.score ?? 0),
      modelName: MODEL,
    }).returning();

    const [review] = await db.insert(reviewsTable).values({
      paperId: paper.id,
      // Legacy fields mapped from new prompt
      summary: r.summary ?? "",
      correctness: r.correctness ?? "",
      novelty: r.novelty ?? "",
      overallEvaluation: r.finalJudgment ?? "",
      score: Math.round(r.overallIntrinsicScore ?? r.score ?? 0),
      relatedWork: r.relatedWork ?? "",
      // New structured fields
      centralClaim: r.centralClaim ?? null,
      establishedResults: r.establishedResults ?? null,
      interpretiveClaims: r.interpretiveClaims ?? null,
      speculativeClaims: r.speculativeClaims ?? null,
      economy: r.economy ?? null,
      scopeDepth: r.scopeDepth ?? null,
      unifyingPower: r.unifyingPower ?? null,
      strongestCaseForImportance: r.strongestCaseForImportance ?? null,
      strongestObjection: r.strongestObjection ?? null,
      decisiveCheck: r.decisiveCheck ?? null,
      intrinsicScientificMeritScore: r.intrinsicScientificMeritScore != null ? Math.round(r.intrinsicScientificMeritScore) : null,
      breadthOfImpactScore: r.breadthOfImpactScore != null ? Math.round(r.breadthOfImpactScore) : null,
      overallIntrinsicScore: r.overallIntrinsicScore != null ? Math.round(r.overallIntrinsicScore) : null,
      bestClassification: r.bestClassification ?? null,
      finalJudgment: r.finalJudgment ?? null,
      modelName: MODEL,
      systemPrompt: REVIEW_SYSTEM_INSTRUCTION,
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
