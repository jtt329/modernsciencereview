import { Router } from "express";
import { db, papersTable, reviewsTable, commentsTable, likesTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import OpenAI from "openai";
import { ai as geminiAI } from "@workspace/integrations-gemini-ai";
import { logger } from "../lib/logger";

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY environment variable is not set.");
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const GPT_MODEL = "gpt-5.4-pro";
const GEMINI_MODEL = "gemini-3.1-pro-preview";

const ADMIN_EMAIL = process.env.VITE_ADMIN_EMAIL || process.env.ADMIN_EMAIL || "";

const router = Router();

const REVIEW_SYSTEM_INSTRUCTION = `You are reviewing a scientific manuscript from its contents alone.

Important: evaluate the manuscript as if author identity, institution, venue, citation counts, publication status, historical fame, and later influence are all unknown and irrelevant. If any of that information appears in the text, ignore it completely.

Do not use prestige, familiarity, citations, publication history, or historical influence as evidence for or against the paper. If you suspect you recognize the work, do not let that raise or lower any score except insofar as you can state a purely technical overlap or difference in idea-content.

Judge only the manuscript's ideas, claims, derivations, constructions, examples, data, checks, reductions, limits, and explicit comparisons.

Your task is to assess the manuscript's intrinsic scientific merit with calibrated reasoning. Keep the following separate rather than collapsing them too early:
- correctness
- originality
- internal technical traction
- explanatory economy
- scope and depth within the stated domain
- unifying power
- breadth of consequences if correct

Internal technical traction means:
- for theoretical work: explicit derivations, worked examples, recovery of known limits, nontrivial consistency checks, sharp consequences, parameter constraints, boundary cases, reductions, or falsifiable implications contained in the manuscript itself
- for empirical work: evidence quality, identification strategy, robustness, ablations, uncertainty handling, reproducibility, and whether the data actually bear on the central claim

Strongly weight:
- technical correctness and internal coherence
- originality
- explanatory economy and simplicity, but only when it compresses genuine structure
- unifying power
- scope and depth within the stated domain
- conceptual clarity
- internal technical traction
- likely lasting value if the main claims are correct

Additional principle for breadth and importance:

The central scientific value of a framework lies in how economically it explains, unifies, or predicts distinct phenomena. In judging breadth and importance, distinguish between:

(a) phenomenon-space breadth: how many genuinely distinct phenomena, observables, regimes, or physically realizable predictions are accounted for by one mechanism;

(b) theory-space breadth: how widely the same formal template extends across alternative theories, parameter families, dimensions, or mathematical settings.

Treat these as different kinds of breadth, not interchangeable ones.

As a default scientific standard, give primary weight to the economy with which a framework accounts for meaningful phenomena. A framework that explains or unifies a wider range of distinct and central phenomena with fewer primitive commitments can be more scientifically valuable than one that mainly reproduces the same limited class of phenomena across many alternative formalisms.

In weighing breadth and impact, give more credit to frameworks that:
- explain more distinct phenomena with one mechanism,
- connect phenomena that were previously treated separately,
- sharpen predictions about phenomena that are empirically relevant, physically realizable, or theoretically central,
- and do so with fewer assumptions, less ad hoc structure, or greater explanatory clarity.

Reward theory-space breadth when it produces genuinely new observable consequences, stronger constraints, deeper robustness, or real structural unification. But do not assume that covering more theories is intrinsically more important than explaining more distinct phenomena.

Weight predicted phenomena by their physical plausibility, empirical relevance, and centrality within the domain. Prefer explanations that account for a wider range of meaningful phenomena in the simplest adequate way, rather than frameworks that mainly multiply descriptions of the same narrow phenomenon class.

Rules:
- Ignore author identity, affiliation, institution, venue, citation counts, publication status, popularity, historical fame, career stage, and stylistic conformity entirely.
- Never reward a paper for being famous, influential, highly cited, institutionally backed, or later validated by the field.
- Never penalize a paper for being unfamiliar, outsider-authored, unconventional, or imperfectly polished.
- Never treat absence of contradiction as proof of correctness.
- Never treat new notation, relabeling, or reformulation as originality unless it yields a real gain in derivation, clarification, unification, constraint, or explanatory depth.
- Do not reward grand claims that are weakly supported.
- You may use technical background knowledge about standard literature to judge novelty and overlap, but not prestige or citation history. If novelty is uncertain, say so explicitly and lower novelty confidence rather than bluffing.
- Judge breadth of impact conditionally: if the main claims are correct, how widely would they matter?
- Base all scores entirely on the manuscript's idea-content and evidential support, never on sociology.

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
- noveltyConfidence: number
- internalTechnicalTraction: string
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

For this review, always set:
- title = "anonymized manuscript"
- authorName = "anonymized"

Field instructions:
- summary: describe what the paper actually does, not what it hopes to do
- centralClaim: state the strongest main claim supported by the manuscript, not a stronger one
- establishedResults: include only what is directly derived, proved, computed, or empirically supported in the manuscript
- interpretiveClaims: include plausible readings that are not logically forced by the results
- speculativeClaims: include extensions, conjectures, or claims needing more proof or evidence
- correctness: say what seems solid, what seems incomplete, and what remains uncertain from the manuscript alone
- novelty: assess novelty on technical grounds only; only consider ideas or results that are presented for the first time in the paper under review
- noveltyConfidence: number from 0 to 1
- internalTechnicalTraction: explain whether the manuscript gives real technical grip or mainly suggestive framing
- economy: reward compression only when it reveals genuine structure with conceptual, explanatory, or predictive payoff
- scopeDepth: judge depth within the stated domain, not just breadth
- unifyingPower: distinguish real unification from merely putting known formulas into one notation
- strongestCaseForImportance: steelman the paper
- strongestObjection: give the best skeptical reading
- decisiveCheck: name the single theorem, derivation, experiment, calculation, counterexample, comparison, or dataset that would most strongly change the verdict
- relatedWork: mention only technically relevant prior work or standard background; do not mention prestige, fame, citations, or venue status
- finalJudgment: give a concise plain-language bottom line

Scoring:
- intrinsicScientificMeritScore: 0–10, based entirely on technical correctness, originality, depth, clarity, and support within the manuscript
- breadthOfImpactScore: 0–10, conditional on the main claims being correct
- overallIntrinsicScore: 1–100, integrated judgment based entirely on the manuscript's idea-content and support

Calibration:
- 0–2: deeply flawed or nearly empty
- 3–4: suggestive but weak or substantially unconvincing
- 5–6: competent incremental work or useful but limited clarification
- 7: strong specialized contribution
- 8: major specialty advance
- 9: rare, exceptional work with both depth and strong support
- 10: truly outstanding, potentially field-shaping if correct

For bestClassification, choose one:
- field-defining advance
- major specialty advance
- strong niche contribution
- useful clarification
- elegant repackaging
- not yet convincing

Output valid JSON only.

The manuscript text begins after this line.`;

const METADATA_PROMPT = `Extract the title and authors from the scientific paper text provided.
Return a JSON object with exactly two fields:
- title: string (the paper title, or "Unknown Title" if not found)
- authors: string (comma-separated list of author names as written, or "Unknown Authors" if not found)
Output valid JSON only.`;

// Quick metadata extraction — GPT always used here (fast, cheap, no need for Gemini)
async function extractMetadata(paperContent: string): Promise<{ title: string; authors: string }> {
  try {
    const response = await openai.responses.create({
      model: GPT_MODEL,
      instructions: METADATA_PROMPT,
      input: paperContent.substring(0, 4000),
      max_output_tokens: 256,
    });
    const raw = response.output_text?.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim() ?? "{}";
    const parsed = JSON.parse(raw);
    return { title: parsed.title || "Unknown Title", authors: parsed.authors || "Unknown Authors" };
  } catch {
    return { title: "Unknown Title", authors: "Unknown Authors" };
  }
}

async function generateReviewGPT(paperContent: string) {
  const response = await openai.responses.create({
    model: GPT_MODEL,
    instructions: REVIEW_SYSTEM_INSTRUCTION,
    input: paperContent,
    max_output_tokens: 8192,
  });
  const content = response.output_text;
  if (!content) throw new Error("No response from GPT model");
  const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  return JSON.parse(cleaned);
}

function extractJson(raw: string): unknown {
  // Strip markdown code fences
  let s = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  // Try a direct parse first
  try { return JSON.parse(s); } catch (_) { /* fall through */ }
  // If truncated, find the last complete top-level value by walking backwards
  // to the last closing brace and appending enough closing braces/brackets
  const lastBrace = s.lastIndexOf("}");
  if (lastBrace !== -1) {
    const candidate = s.slice(0, lastBrace + 1);
    try { return JSON.parse(candidate); } catch (_) { /* fall through */ }
  }
  throw new Error("Could not parse model response as JSON. The model output may have been truncated — try a shorter paper or different model.");
}

async function generateReviewGemini(paperContent: string) {
  const response = await geminiAI.models.generateContent({
    model: GEMINI_MODEL,
    contents: [{ role: "user", parts: [{ text: paperContent }] }],
    config: {
      systemInstruction: REVIEW_SYSTEM_INSTRUCTION,
      responseMimeType: "application/json",
      maxOutputTokens: 32768,
    },
  });
  const content = response.text;
  if (!content) throw new Error("No response from Gemini model");
  return extractJson(content);
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

// POST /api/papers — submit paper (extracts metadata, generates AI review, stores all)
router.post("/papers", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  try {
    const { source } = req.body;
    if (!source?.type || !source?.data) { res.status(400).json({ error: "source.type and source.data are required" }); return; }

    let paperContent: string;
    let submittedPdfUrl: string | null = null;

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

    const useGemini = req.body.model === "gemini";
    const modelName = useGemini ? GEMINI_MODEL : GPT_MODEL;

    // Step 1: extract real title and authors (before anonymous review)
    const metadata = await extractMetadata(paperContent);

    // Step 2: blind review
    const r = useGemini
      ? await generateReviewGemini(paperContent)
      : await generateReviewGPT(paperContent);

    const submitterName = [req.user.firstName, req.user.lastName].filter(Boolean).join(" ") || req.user.email || "Anonymous";

    const [paper] = await db.insert(papersTable).values({
      title: metadata.title,
      content: (source.type === "pdf" || source.type === "url") ? `[PDF] ${metadata.title}` : paperContent,
      authorId: req.user.id,
      authorName: submitterName,
      paperAuthors: metadata.authors,
      field: r.field,
      subfields: r.subfields,
      score: Math.round(r.overallIntrinsicScore ?? 0),
      modelName,
      pdfUrl: submittedPdfUrl,
    }).returning();

    const noveltyConf = r.noveltyConfidence != null ? String(r.noveltyConfidence) : null;

    const [review] = await db.insert(reviewsTable).values({
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
      scopeDepth: r.scopeDepth ?? null,
      unifyingPower: r.unifyingPower ?? null,
      strongestCaseForImportance: r.strongestCaseForImportance ?? null,
      strongestObjection: r.strongestObjection ?? null,
      decisiveCheck: r.decisiveCheck ?? null,
      internalTechnicalTraction: r.internalTechnicalTraction ?? null,
      noveltyConfidence: noveltyConf,
      intrinsicScientificMeritScore: r.intrinsicScientificMeritScore != null ? Math.round(r.intrinsicScientificMeritScore) : null,
      breadthOfImpactScore: r.breadthOfImpactScore != null ? Math.round(r.breadthOfImpactScore) : null,
      overallIntrinsicScore: r.overallIntrinsicScore != null ? Math.round(r.overallIntrinsicScore) : null,
      bestClassification: r.bestClassification ?? null,
      finalJudgment: r.finalJudgment ?? null,
      modelName: modelName,
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
