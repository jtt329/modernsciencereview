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

Do not use prestige, familiarity, citations, publication history, institutional status, author identity, or historical influence as evidence for or against the paper. If you suspect you recognize the work, do not let that raise or lower any score except insofar as you can state a purely technical overlap or difference in idea-content.

Judge only the manuscript's ideas, claims, derivations, constructions, examples, data, checks, reductions, limits, and explicit comparisons.

Your task is to assess the manuscript's intrinsic scientific merit with calibrated reasoning. Keep the following separate rather than collapsing them too early:
- correctness
- originality
- internal technical traction
- explanatory economy
- scope and depth within the stated domain
- unifying power
- explanatory-target breadth
- theory-space breadth
- breadth of consequences if correct

Internal technical traction means:
- for theoretical work: explicit derivations, worked examples, recovery of known limits, nontrivial consistency checks, sharp consequences, parameter constraints, boundary cases, reductions, or falsifiable implications contained in the manuscript itself
- for empirical work: evidence quality, identification strategy, robustness, ablations, uncertainty handling, reproducibility, and whether the data actually bear on the central claim
- for mathematical or formal work: proofs, definitions with real consequences, nontrivial examples, counterexamples, reductions, classifications, equivalences, invariants, algorithms, complexity results, or unification of previously separate structures

Strongly weight:
- technical correctness and internal coherence
- originality
- explanatory economy and simplicity, but only when it compresses genuine structure
- unifying power
- scope and depth within the stated domain
- conceptual clarity
- internal technical traction
- likely lasting value if the main claims are correct

Core principle for scientific value:

The central scientific value of a framework lies in how economically it explains, unifies, predicts, computes, or constrains meaningful targets.

In empirical sciences, these targets are often physical phenomena, observations, regimes, systems, or expected observables. In mathematical, computational, and formal fields, they may be theorem families, structures, examples, invariants, problem classes, algorithms, tasks, complexity regimes, or failure modes.

In judging breadth and importance, distinguish between two orthogonal kinds of generality:

(a) explanatory-target breadth: one mechanism, idea, derivation, or framework accounts for more genuinely distinct targets;

(b) theory-space breadth: the same formal template extends across more alternative theories, dimensions, parameter families, axiomatic settings, architectures, or mathematical formalisms.

Both kinds of breadth can be valuable, but they are not interchangeable.

A useful shorthand is:
- theory-space breadth often gives different ways to describe one kind of thing;
- explanatory-target breadth gives one way to describe different things.

Do not automatically treat theory-space breadth as deeper or more important than explanatory-target breadth.

As a default scientific standard, give primary weight to the economy with which a framework accounts for meaningful distinct targets. A framework that explains or unifies a wider range of central targets with fewer primitive commitments can be more scientifically valuable than one that mainly reproduces the same limited target class across many alternative formalisms.

In weighing breadth and impact, give more credit to frameworks that:
- explain more distinct targets with one mechanism;
- connect cases previously treated separately;
- reveal why a structure works in central cases;
- sharpen predictions, constraints, classifications, or calculations;
- reduce the number of primitive assumptions;
- remove ad hoc bookkeeping or arbitrary choices;
- and achieve this with greater simplicity, clarity, or necessity.

Reward theory-space breadth when it produces genuinely new consequences, stronger constraints, deeper robustness, new testable predictions, nontrivial invariance, or real structural necessity. But do not reward theory-space breadth merely for multiplying formal variants of the same narrow target class.

Prefer explanations that account for a wider range of meaningful targets in the simplest adequate way.

Simplicity is valuable only when it is adequate to the target. Do not reward an oversimplified framework that hides important structure, drops essential cases, or makes unsupported claims. But do reward simple identities, reformulations, or organizing principles when they reveal genuine structure, remove ambiguity, unify cases, or make a previously obscure mechanism transparent.

Coverage-ledger requirement:

Before assigning breadth, unifying-power, novelty, or overall scores, construct a coverage ledger from the manuscript.

In that ledger, distinguish:

1. Direct explanatory targets:
   phenomena, regimes, examples, theorem families, tasks, problem classes, structures, or observables that the manuscript explicitly treats and derives results for.

2. Imported inputs:
   formulas, entropy functionals, assumptions, analogies, known laws, standard definitions, or results borrowed from another domain but not themselves explained by the manuscript.

3. Theory-space variants:
   alternative theories, dimensions, parameter families, gravity models, axiomatic settings, architectures, mathematical formalisms, or model classes over which the same template is extended.

4. Mechanism-sharing:
   whether the same mechanism genuinely explains multiple direct targets, or whether the manuscript merely applies similar notation to them.

Do not count an imported input as a direct explanatory target. For example, using a black-hole entropy formula as input in a cosmological derivation does not by itself count as directly explaining black-hole mechanics.

Do not count multiple theory variants as multiple phenomena unless they produce distinct physical targets, observables, constraints, predictions, structures, or problem classes.

When scoring explanatory-target breadth, count only direct targets treated in the manuscript.

When scoring theory-space breadth, count extensions across theories, dimensions, formalisms, parameter families, model classes, or axiomatic settings.

When scoring unifying power, reward the manuscript only when the same mechanism actually connects distinct targets, not merely when the same notation is reused.

When a manuscript imports a known formula from another domain, credit it for using that formula if the use is technically effective, but do not credit it as explaining that source domain unless the manuscript actually analyzes that source domain as a target.

Rules:
- Ignore author identity, affiliation, institution, venue, citation counts, publication status, popularity, historical fame, career stage, and stylistic conformity entirely.
- Never reward a paper for being famous, influential, highly cited, institutionally backed, or later validated by the field.
- Never penalize a paper for being unfamiliar, outsider-authored, unconventional, or imperfectly polished.
- Never treat absence of contradiction as proof of correctness.
- Never treat new notation, relabeling, or reformulation as originality unless it yields a real gain in derivation, clarification, unification, constraint, prediction, computation, or explanatory depth.
- Do not reward grand claims that are weakly supported.
- You may use technical background knowledge about standard literature to judge novelty and overlap, but not prestige or citation history.
- If novelty is uncertain, say so explicitly and lower novelty confidence rather than bluffing.
- Judge breadth of impact conditionally: if the main claims are correct, how widely would they matter?
- Base all scores entirely on the manuscript's idea-content and evidential support, never on sociology.

A simple identity or reformulation should not be dismissed merely because the algebra is simple. Many scientifically important advances identify the right primitive variables or reveal that seemingly different cases are the same structure.

However, do not reward a reformulation as a major contribution unless it provides at least one real gain:
- unifies direct targets previously treated separately;
- removes an ambiguity or arbitrary convention;
- exposes a physically, mathematically, or computationally privileged variable;
- yields a new derivation or consistency check;
- separates mechanisms that were previously conflated;
- makes a new calculation easier or more transparent;
- produces a new prediction, constraint, classification, or test.

If the manuscript's contribution is mainly a reformulation, judge how much genuine structure the reformulation reveals, not whether the algebra is difficult.

Score-consistency rule:

Ensure the final classification matches the text and scores. If the review says the manuscript is highly correct, highly economical, strongly unifying, and has strong target breadth, the classification should not be much lower than the stated evidence supports unless the strongest objection clearly undermines the central claim.

Conversely, if the manuscript has broad claims but weak derivations, low correctness, or mostly speculative support, do not give a high classification merely because the claim would be important if true.

Return a JSON object with these exact fields:
- title: string
- authorName: string
- summary: string
- centralClaim: string
- coverageLedger: object
- directTargets: array of strings
- importedInputs: array of strings
- theorySpaceVariants: array of strings
- mechanismSharingAssessment: string
- establishedResults: string
- interpretiveClaims: string
- speculativeClaims: string
- correctness: string
- novelty: string
- noveltyConfidence: number
- internalTechnicalTraction: string
- economy: string
- explanatoryTargetBreadth: string
- theorySpaceBreadth: string
- scopeDepth: string
- unifyingPower: string
- strongestCaseForImportance: string
- strongestObjection: string
- decisiveCheck: string
- intrinsicScientificMeritScore: number
- explanatoryTargetBreadthScore: number
- theorySpaceBreadthScore: number
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
- coverageLedger: summarize the direct targets, imported inputs, theory-space variants, and whether the same mechanism genuinely connects the direct targets
- directTargets: list only targets explicitly treated and analyzed in the manuscript
- importedInputs: list important formulas, assumptions, known results, or principles borrowed from other domains but not themselves explained
- theorySpaceVariants: list theory families, dimensions, formalisms, parameter regimes, model classes, or axiomatic settings covered
- mechanismSharingAssessment: explain whether the same mechanism connects the direct targets, or whether the manuscript mainly reuses notation or imports formulas
- establishedResults: include only what is directly derived, proved, computed, checked, or empirically supported in the manuscript
- interpretiveClaims: include plausible readings that are not logically forced by the results
- speculativeClaims: include extensions, conjectures, or claims needing more proof or evidence
- correctness: say what seems solid, what seems incomplete, and what remains uncertain from the manuscript alone
- novelty: assess novelty on technical grounds only; if relying partly on remembered literature rather than explicit comparison in the manuscript, say so
- noveltyConfidence: number from 0 to 1
- internalTechnicalTraction: explain whether the manuscript gives real technical grip or mainly suggestive framing
- economy: reward compression only when it reveals genuine structure with conceptual, explanatory, predictive, computational, or classificatory payoff
- explanatoryTargetBreadth: evaluate how many distinct meaningful targets are explained, unified, predicted, computed, or constrained by the manuscript's central idea
- theorySpaceBreadth: evaluate how far the manuscript extends across theories, dimensions, parameter families, axiomatic settings, architectures, or formal variants
- scopeDepth: judge depth within the stated domain, not just breadth
- unifyingPower: distinguish real unification from merely putting known formulas into one notation
- strongestCaseForImportance: steelman the paper
- strongestObjection: give the best skeptical reading
- decisiveCheck: name the single theorem, derivation, experiment, calculation, counterexample, comparison, dataset, or application that would most strongly change the verdict
- relatedWork: mention only technically relevant prior work or standard background; do not mention prestige, fame, citations, or venue status
- finalJudgment: give a concise plain-language bottom line

Scoring:
- intrinsicScientificMeritScore: 0–10, based entirely on technical correctness, originality, depth, clarity, and support within the manuscript
- explanatoryTargetBreadthScore: 0–10, judging how many distinct meaningful targets are accounted for by one mechanism or idea, weighted by centrality and support
- theorySpaceBreadthScore: 0–10, judging extension across theories, dimensions, parameter families, axiomatic settings, architectures, or formal settings
- breadthOfImpactScore: 0–10, integrated breadth score conditional on the main claims being correct; weigh explanatory-target breadth and theory-space breadth separately before combining them
- overallIntrinsicScore: 1–100, a field-relative percentile. Rank this paper against all published papers in its field: 99 means top 1% of papers ever published in this field; 50 means median; 1 means bottom 1%. Base this solely on the manuscript's idea-content and support, never on prestige, venue, or publication status.

When assigning explanatoryTargetBreadthScore:
- count only direct targets from the coverage ledger;
- do not count imported inputs as targets;
- weight targets by centrality, distinctness, support, and whether the same mechanism genuinely explains them;
- do not inflate the score by counting many minor variants of the same target as separate phenomena.

When assigning theorySpaceBreadthScore:
- count extensions across theories, dimensions, formalisms, parameter families, axiomatic systems, architectures, or model classes;
- reward such breadth most when the extension produces new consequences, robustness, constraints, or structural necessity;
- do not let theory-space breadth automatically dominate the integrated breadth score.

When assigning breadthOfImpactScore:
- weigh explanatory-target breadth and theory-space breadth separately before integrating them;
- do not let theory-space breadth dominate by default;
- do not let explanatory-target breadth dominate when the targets are weakly supported, peripheral, or only superficially connected;
- give the highest breadth scores to work that explains many central targets with one simple and well-supported mechanism, or that reveals deep necessity across both target-space and theory-space.

Calibration for 0–10 sub-scores:
- 0–2: deeply flawed or nearly empty
- 3–4: suggestive but weak or substantially unconvincing
- 5–6: competent incremental work or useful but limited clarification
- 7: strong specialized contribution
- 8: major specialty advance
- 9: rare, exceptional work with both depth and strong support
- 10: truly outstanding, potentially field-shaping if correct

Calibration for overallIntrinsicScore (field-relative percentile):
- 95–99: all-time top papers in the field; a working researcher in this area would immediately recognize this as exceptional
- 85–94: top 5–15%; strong, original, and consequential within the field
- 70–84: top 15–30%; solid contribution above the median, likely publishable in a strong venue
- 50–69: median range; competent and useful but limited in originality or scope
- 30–49: below median; some value but substantially incomplete, weak, or incremental
- 10–29: weak; unlikely to advance the field in its current form
- 1–9: deeply flawed or nearly empty

Use the full range. Do not cluster scores. Most papers should fall between 30 and 85. Scores above 90 should be rare.

For bestClassification, choose one:
- field-defining advance
- major specialty advance
- strong niche contribution
- useful clarification
- elegant repackaging
- not yet convincing

Classification guidance:
- "field-defining advance" requires exceptional correctness, depth, originality, and broad consequence if correct.
- "major specialty advance" requires a substantial new result, mechanism, derivation, unification, or framework that changes how a specialty understands important targets.
- "strong niche contribution" applies when the work is deep, coherent, and genuinely clarifying within a focused domain.
- "useful clarification" applies when the work improves understanding but is mostly explanatory, organizational, or incremental.
- "elegant repackaging" applies when the work is clear and economical but does not establish a substantially new result, mechanism, or explanatory gain.
- "not yet convincing" applies when the central claims are unsupported, incorrect, or too speculative.

Before finalizing, check for these common scoring errors:
- Do not call imported formulas from one domain direct coverage of that domain.
- Do not count theory variants as separate phenomena unless they produce distinct targets.
- Do not dismiss simple identities when they reveal a genuinely privileged structure or unify cases.
- Do not reward simple relabeling when it does not reveal structure or produce new understanding.
- Do not let the final classification contradict the stated strengths and weaknesses.

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

async function generateReviewGPT(paperContent: string, prompt: string = REVIEW_SYSTEM_INSTRUCTION): Promise<{ review: any; thinkingText: string | null }> {
  const response = await openai.responses.create({
    model: GPT_MODEL,
    instructions: prompt,
    input: paperContent,
    max_output_tokens: 32768,
  });
  const content = response.output_text;
  if (!content) throw new Error("No response from GPT model");
  return { review: extractJson(content), thinkingText: null };
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

async function generateReviewGemini(paperContent: string, prompt: string = REVIEW_SYSTEM_INSTRUCTION): Promise<{ review: any; thinkingText: string | null }> {
  const response = await geminiAI.models.generateContent({
    model: GEMINI_MODEL,
    contents: [{ role: "user", parts: [{ text: paperContent }] }],
    config: {
      systemInstruction: prompt,
      responseMimeType: "application/json",
      maxOutputTokens: 32768,
      thinkingConfig: { includeThoughts: true, thinkingLevel: 'HIGH' },
    } as any,
  });

  // Extract thinking from thought parts (separate from the JSON response)
  const parts: any[] = (response as any).candidates?.[0]?.content?.parts ?? [];
  const thinkingParts = parts.filter((p: any) => p.thought === true);
  const thinkingText = thinkingParts.length > 0
    ? thinkingParts.map((p: any) => p.text ?? "").join("\n\n").trim()
    : null;

  const content = response.text;
  if (!content) throw new Error("No response from Gemini model");
  return { review: extractJson(content), thinkingText };
}

// GET /api/papers/system-prompt — return the review system prompt
router.get("/papers/system-prompt", (_req, res) => {
  res.json({ prompt: REVIEW_SYSTEM_INSTRUCTION });
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

    const useGemini = req.body.model === "gemini";
    const modelName = useGemini ? GEMINI_MODEL : GPT_MODEL;

    // Step 1: extract real title and authors (before anonymous review)
    const metadata = await extractMetadata(paperContent);

    // Step 2: blind review
    const { review: r, thinkingText } = useGemini
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
      displayPdf: submittedDisplayPdf ? 1 : 0,
    }).returning();

    const noveltyConf = r.noveltyConfidence != null ? String(r.noveltyConfidence) : null;

    // Build coverage ledger JSON from new prompt fields
    const coverageLedgerJson = (r.coverageLedger || r.directTargets || r.importedInputs || r.theorySpaceVariants || r.mechanismSharingAssessment)
      ? JSON.stringify({
          coverageLedger: r.coverageLedger ?? null,
          directTargets: r.directTargets ?? [],
          importedInputs: r.importedInputs ?? [],
          theorySpaceVariants: r.theorySpaceVariants ?? [],
          mechanismSharingAssessment: r.mechanismSharingAssessment ?? null,
        })
      : null;

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
      const completion = await openai.chat.completions.create({
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
