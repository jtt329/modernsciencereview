import OpenAI from "openai";
import { createHash } from "crypto";
import { ai as geminiAI } from "@workspace/integrations-gemini-ai";

export const GPT_MODEL = "gpt-5.4-pro";
export const GEMINI_MODEL = process.env.SCIREVIEW_GEMINI_MODEL?.trim() || "gemini-3.1-pro-preview";
export const REVIEW_PASS_COUNT = 3;

let openai: OpenAI | null = null;
function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required when the OpenAI review model is selected.");
  }
  openai ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openai;
}

export type ReviewModel = "gpt" | "gemini";

type FrameworkLevel = "low" | "medium" | "high";
type ScoreStability = "high" | "medium" | "low";
type ScoreBand = { low: number; median: number; high: number };

type IndividualReview = {
  title: string;
  authorName: string;
  comparisonCohort: string;
  broadField: string;
  specialtyField: string;
  subfields: string[];
  paperType: string;
  summary: string;
  centralClaim: string;
  coverageLedger: {
    directTargets: string[];
    importedInputs: string[];
    theorySpaceVariants: string[];
    mechanismSharingAssessment: string;
  };
  establishedResults: string[];
  interpretiveClaims: string[];
  speculativeClaims: string[];
  correctness: string;
  novelty: string;
  noveltyConfidence: number;
  internalTechnicalTraction: string;
  economy: string;
  explanatoryTargetBreadth: string;
  theorySpaceBreadth: string;
  scopeDepth: string;
  unifyingPower: string;
  frameworkConditionality: {
    level: FrameworkLevel;
    explanation: string;
  };
  strongestCaseForImportance: string;
  strongestObjection: string;
  decisiveCheck: string;
  whatWouldRaiseScore: string;
  whatWouldLowerScore: string;
  intrinsicTechnicalScore: number;
  explanatoryTargetBreadthScore: number;
  theorySpaceBreadthScore: number;
  breadthOfImpactScore: number;
  specialtyRelativeScore: number;
  broadFieldRelativeScore: number;
  crossFieldConsequenceScore: number;
  scoreBand: ScoreBand;
  scoreConfidence: number;
  bestClassification: string;
  oneParagraphVerdict: string;
  finalJudgment: string;
};

type AggregateReview = {
  finalComparisonCohort: string;
  finalBroadField: string;
  finalSpecialtyField: string;
  finalSummary: string;
  individualScores: number[];
  scoreRange: number;
  scoreStability: ScoreStability;
  mainAgreements: string[];
  mainDisagreements: string[];
  fatalObjectionPresent: boolean;
  fatalObjectionAssessment: string;
  finalClassification: string;
  finalScoreBand: ScoreBand;
  finalScoreConfidence: number;
  publicOneParagraphVerdict: string;
  internalCalibrationNotes: string;
};

export type MultiPassReviewResult = {
  modelName: string;
  systemPrompt: string;
  blindedContent: string;
  individualReviews: IndividualReview[];
  aggregate: AggregateReview;
  representativeReview: IndividualReview;
  thinkingText: string | null;
};

const CLASSIFICATIONS = [
  "field-defining advance",
  "major specialty advance",
  "strong niche contribution",
  "useful clarification",
  "elegant repackaging",
  "not yet convincing",
] as const;

export const REVIEW_SYSTEM_INSTRUCTION = `You are reviewing an anonymous scientific manuscript from its contents alone.

Ignore author identity, institution, venue, citation counts, publication status, historical fame, and later influence. Judge only the manuscript's ideas, claims, derivations, constructions, examples, data, checks, reductions, limits, and explicit comparisons.

Do not defer to human experts or later consensus. Give the best model-based judgment under this protocol.

Keep separate:
- correctness
- originality
- internal technical traction
- explanatory economy
- scope and depth within the stated domain
- explanatory-target breadth
- theory-space breadth
- unifying power
- framework conditionality
- breadth of consequences if correct

Determine the comparison cohort first. Use the narrowest serious research cohort that a working expert would naturally use, but do not choose an artificially tiny cohort merely to inflate the score. Also identify the broader field.

Definitions:
- Direct explanatory targets are phenomena, regimes, examples, theorem families, systems, observables, structures, tasks, or problem classes that the manuscript explicitly analyzes or derives results for.
- Imported inputs are formulas, assumptions, known laws, entropy functionals, standard definitions, prior frameworks, or external results used by the manuscript but not themselves explained by it.
- Theory-space variants are alternative theories, dimensions, parameter families, model classes, formalisms, axiomatic settings, architectures, or regimes across which the same template is extended.
- Mechanism-sharing asks whether the same mechanism genuinely explains multiple direct targets, or whether the manuscript merely reuses notation across them.

Do not count an imported input as a direct explanatory target. Do not count multiple theory variants as multiple physical targets unless they produce distinct consequences, structures, constraints, or applications. Do not reward mere relabeling unless it produces genuine explanatory gain.

Every review must include the strongest case for importance and the strongest objection. The objection should be technically fair, not artificially hostile.

Scoring:
- intrinsicTechnicalScore, explanatoryTargetBreadthScore, theorySpaceBreadthScore, and breadthOfImpactScore are on a 0-10 scale.
- specialtyRelativeScore, broadFieldRelativeScore, crossFieldConsequenceScore, and every number inside scoreBand are on a 0-100 scale.
- Do not use a 0-10 scale for scoreBand.
- A nineties-level paper should have scoreBand numbers like 90, 93, 96 rather than 9, 9.3, 9.6.

Return valid JSON only with exactly these fields:
{
  "title": "anonymized manuscript",
  "authorName": "anonymized",
  "comparisonCohort": "",
  "broadField": "",
  "specialtyField": "",
  "subfields": [],
  "paperType": "",
  "summary": "",
  "centralClaim": "",
  "coverageLedger": {
    "directTargets": [],
    "importedInputs": [],
    "theorySpaceVariants": [],
    "mechanismSharingAssessment": ""
  },
  "establishedResults": [],
  "interpretiveClaims": [],
  "speculativeClaims": [],
  "correctness": "",
  "novelty": "",
  "noveltyConfidence": 0.0,
  "internalTechnicalTraction": "",
  "economy": "",
  "explanatoryTargetBreadth": "",
  "theorySpaceBreadth": "",
  "scopeDepth": "",
  "unifyingPower": "",
  "frameworkConditionality": { "level": "low", "explanation": "" },
  "strongestCaseForImportance": "",
  "strongestObjection": "",
  "decisiveCheck": "",
  "whatWouldRaiseScore": "",
  "whatWouldLowerScore": "",
  "intrinsicTechnicalScore": 0,
  "explanatoryTargetBreadthScore": 0,
  "theorySpaceBreadthScore": 0,
  "breadthOfImpactScore": 0,
  "specialtyRelativeScore": 0,
  "broadFieldRelativeScore": 0,
  "crossFieldConsequenceScore": 0,
  "scoreBand": { "low": 0, "median": 0, "high": 0 },
  "scoreConfidence": 0.0,
  "bestClassification": "",
  "oneParagraphVerdict": "",
  "finalJudgment": ""
}

All numeric fields must be numbers, not strings. Use LaTeX for mathematical notation inside strings. Output valid JSON only.`;

export const AGGREGATOR_SYSTEM_INSTRUCTION = `You are the fourth anonymous manuscript reviewer and final meta-reviewer.

You will receive the blinded manuscript text and three full independent anonymous reviews produced under the same rubric.

Read the manuscript yourself first. Then audit the three reviews. Do not simply average the scores. Compare the reasoning against the manuscript.

Your tasks:
1. Identify what is supported by the manuscript.
2. Identify agreements.
3. Identify disagreements.
4. Determine whether the reviewers used the same comparison cohort.
5. Determine whether any reviewer found a fatal correctness issue.
6. Decide whether score variation reflects real ambiguity or model noise.
7. Produce the final public classification, score band, and one-paragraph verdict.
8. Produce a short public summary of what the manuscript actually does.

Do not defer to human expert consensus. If one review identifies a fatal technical error and the others ignore it, do not average it away. Evaluate whether the objection is supported by the manuscript and whether it is decisive.

If score range is 0-5, stability is high. If 6-12, stability is medium. If greater than 12, stability is low.

Return valid JSON only with exactly these fields:
{
  "finalComparisonCohort": "",
  "finalBroadField": "",
  "finalSpecialtyField": "",
  "finalSummary": "",
  "individualScores": [],
  "scoreRange": 0,
  "scoreStability": "high",
  "mainAgreements": [],
  "mainDisagreements": [],
  "fatalObjectionPresent": false,
  "fatalObjectionAssessment": "",
  "finalClassification": "",
  "finalScoreBand": { "low": 0, "median": 0, "high": 0 },
  "finalScoreConfidence": 0.0,
  "publicOneParagraphVerdict": "",
  "internalCalibrationNotes": ""
}

Output valid JSON only.`;

const METADATA_PROMPT = `Extract the title and authors from the scientific paper text provided. Return valid JSON only with exactly two fields: title and authors. If not found, use Unknown Title and Unknown Authors.`;

function stripControlChars(text: string): string {
  return text.replace(/\x00/g, "").replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ");
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function asNumber(value: unknown, fallback = 0, min?: number, max?: number): number {
  const raw = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  const safe = Number.isFinite(raw) ? raw : fallback;
  const lower = min != null ? Math.max(min, safe) : safe;
  return max != null ? Math.min(max, lower) : lower;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => asString(item)).filter(Boolean);
}

function normalizeClassification(value: unknown): string {
  const candidate = asString(value);
  return CLASSIFICATIONS.includes(candidate as (typeof CLASSIFICATIONS)[number]) ? candidate : "strong niche contribution";
}

function normalizeFrameworkLevel(value: unknown): FrameworkLevel {
  const candidate = asString(value).toLowerCase();
  if (candidate === "low" || candidate === "medium" || candidate === "high") return candidate;
  return "medium";
}

function normalizeScoreBand(value: unknown): ScoreBand {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  let low = asNumber(source.low, 0, 0, 100);
  let median = asNumber(source.median, low, 0, 100);
  let high = asNumber(source.high, median, 0, 100);

  if (high <= 10 && median <= 10) {
    low *= 10;
    median *= 10;
    high *= 10;
  }

  const sorted = [low, median, high].sort((a, b) => a - b);
  return {
    low: Math.round(sorted[0]),
    median: Math.round(sorted[1]),
    high: Math.round(sorted[2]),
  };
}

function toMarkdownList(items: string[]): string {
  return items.filter(Boolean).map((item) => `- ${item}`).join("\n");
}

function extractJson(raw: string): unknown {
  const trimmed = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {}

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
  }

  throw new Error("Could not parse model response as JSON.");
}

function scoresRangeToStability(range: number): ScoreStability {
  if (range <= 5) return "high";
  if (range <= 12) return "medium";
  return "low";
}

function normalizeIndividualReview(input: unknown): IndividualReview {
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const ledger = source.coverageLedger && typeof source.coverageLedger === "object" ? (source.coverageLedger as Record<string, unknown>) : {};
  const framework = source.frameworkConditionality && typeof source.frameworkConditionality === "object" ? (source.frameworkConditionality as Record<string, unknown>) : {};
  const scoreBand = normalizeScoreBand(source.scoreBand);
  const specialtyRelativeScore = Math.round(asNumber(source.specialtyRelativeScore, scoreBand.median, 0, 100));

  return {
    title: "anonymized manuscript",
    authorName: "anonymized",
    comparisonCohort: asString(source.comparisonCohort),
    broadField: asString(source.broadField),
    specialtyField: asString(source.specialtyField),
    subfields: asStringArray(source.subfields),
    paperType: asString(source.paperType),
    summary: asString(source.summary),
    centralClaim: asString(source.centralClaim),
    coverageLedger: {
      directTargets: asStringArray(ledger.directTargets),
      importedInputs: asStringArray(ledger.importedInputs),
      theorySpaceVariants: asStringArray(ledger.theorySpaceVariants),
      mechanismSharingAssessment: asString(ledger.mechanismSharingAssessment),
    },
    establishedResults: asStringArray(source.establishedResults),
    interpretiveClaims: asStringArray(source.interpretiveClaims),
    speculativeClaims: asStringArray(source.speculativeClaims),
    correctness: asString(source.correctness),
    novelty: asString(source.novelty),
    noveltyConfidence: asNumber(source.noveltyConfidence, 0.5, 0, 1),
    internalTechnicalTraction: asString(source.internalTechnicalTraction),
    economy: asString(source.economy),
    explanatoryTargetBreadth: asString(source.explanatoryTargetBreadth),
    theorySpaceBreadth: asString(source.theorySpaceBreadth),
    scopeDepth: asString(source.scopeDepth),
    unifyingPower: asString(source.unifyingPower),
    frameworkConditionality: {
      level: normalizeFrameworkLevel(framework.level),
      explanation: asString(framework.explanation),
    },
    strongestCaseForImportance: asString(source.strongestCaseForImportance),
    strongestObjection: asString(source.strongestObjection),
    decisiveCheck: asString(source.decisiveCheck),
    whatWouldRaiseScore: asString(source.whatWouldRaiseScore),
    whatWouldLowerScore: asString(source.whatWouldLowerScore),
    intrinsicTechnicalScore: Math.round(asNumber(source.intrinsicTechnicalScore, 0, 0, 10)),
    explanatoryTargetBreadthScore: Math.round(asNumber(source.explanatoryTargetBreadthScore, 0, 0, 10)),
    theorySpaceBreadthScore: Math.round(asNumber(source.theorySpaceBreadthScore, 0, 0, 10)),
    breadthOfImpactScore: Math.round(asNumber(source.breadthOfImpactScore, 0, 0, 10)),
    specialtyRelativeScore,
    broadFieldRelativeScore: Math.round(asNumber(source.broadFieldRelativeScore, specialtyRelativeScore, 0, 100)),
    crossFieldConsequenceScore: Math.round(asNumber(source.crossFieldConsequenceScore, specialtyRelativeScore, 0, 100)),
    scoreBand,
    scoreConfidence: asNumber(source.scoreConfidence, 0.5, 0, 1),
    bestClassification: normalizeClassification(source.bestClassification),
    oneParagraphVerdict: asString(source.oneParagraphVerdict),
    finalJudgment: asString(source.finalJudgment),
  };
}

function normalizeAggregateReview(input: unknown, fallbackScores: number[], fallbackReview: IndividualReview): AggregateReview {
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const scores = Array.isArray(source.individualScores)
    ? (source.individualScores as unknown[]).map((value) => {
        const numeric = asNumber(value, 0, 0, 100);
        return numeric <= 10 ? Math.round(numeric * 10) : Math.round(numeric);
      })
    : fallbackScores;
  const usableScores = scores.length > 0 ? scores : fallbackScores;
  const band = normalizeScoreBand(source.finalScoreBand);
  const derivedBand = band.low === 0 && band.median === 0 && band.high === 0 && usableScores.length > 0
    ? {
        low: Math.min(...usableScores),
        median: Math.round(usableScores.reduce((sum, score) => sum + score, 0) / usableScores.length),
        high: Math.max(...usableScores),
      }
    : band;
  const range = Math.max(0, derivedBand.high - derivedBand.low);

  return {
    finalComparisonCohort: asString(source.finalComparisonCohort, fallbackReview.comparisonCohort),
    finalBroadField: asString(source.finalBroadField, fallbackReview.broadField),
    finalSpecialtyField: asString(source.finalSpecialtyField, fallbackReview.specialtyField),
    finalSummary: asString(source.finalSummary, fallbackReview.summary),
    individualScores: usableScores,
    scoreRange: Math.round(asNumber(source.scoreRange, range, 0, 100)),
    scoreStability: (() => {
      const candidate = asString(source.scoreStability).toLowerCase();
      if (candidate === "high" || candidate === "medium" || candidate === "low") return candidate as ScoreStability;
      return scoresRangeToStability(range);
    })(),
    mainAgreements: asStringArray(source.mainAgreements),
    mainDisagreements: asStringArray(source.mainDisagreements),
    fatalObjectionPresent: asBoolean(source.fatalObjectionPresent),
    fatalObjectionAssessment: asString(source.fatalObjectionAssessment),
    finalClassification: normalizeClassification(source.finalClassification || fallbackReview.bestClassification),
    finalScoreBand: derivedBand,
    finalScoreConfidence: asNumber(source.finalScoreConfidence, 0.5, 0, 1),
    publicOneParagraphVerdict: asString(source.publicOneParagraphVerdict, fallbackReview.oneParagraphVerdict || fallbackReview.finalJudgment),
    internalCalibrationNotes: asString(source.internalCalibrationNotes),
  };
}

function buildAggregateInput(blindedContent: string, reviews: IndividualReview[]): string {
  return JSON.stringify({
    blindedManuscript: blindedContent,
    reviewPasses: reviews.map((review, index) => ({
      passNumber: index + 1,
      review,
    })),
  }, null, 2);
}

async function callGpt(prompt: string, input: string, maxTokens = 8192): Promise<string> {
  const response = await getOpenAI().chat.completions.create({
    model: GPT_MODEL,
    max_completion_tokens: maxTokens,
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: input },
    ],
  });
  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("No response from GPT model.");
  return content;
}

async function callGemini(prompt: string, input: string): Promise<{ text: string; thinkingText: string | null }> {
  const response = await geminiAI.models.generateContent({
    model: GEMINI_MODEL,
    contents: [{ role: "user", parts: [{ text: input }] }],
    config: {
      systemInstruction: prompt,
      responseMimeType: "application/json",
      maxOutputTokens: 32768,
      thinkingConfig: { includeThoughts: true, thinkingLevel: "HIGH" },
    } as any,
  });

  const parts: any[] = (response as any).candidates?.[0]?.content?.parts ?? [];
  const thinkingParts = parts.filter((part: any) => part.thought === true).map((part: any) => part.text ?? "").filter(Boolean);
  if (!response.text) throw new Error("No response from Gemini model.");
  return {
    text: response.text,
    thinkingText: thinkingParts.length > 0 ? thinkingParts.join("\n\n") : null,
  };
}

async function generateIndividualReview(paperContent: string, prompt: string, model: ReviewModel) {
  if (model === "gemini") {
    const response = await callGemini(prompt, paperContent);
    return { review: normalizeIndividualReview(extractJson(response.text)), thinkingText: response.thinkingText };
  }

  const text = await callGpt(prompt, paperContent);
  return { review: normalizeIndividualReview(extractJson(text)), thinkingText: null as string | null };
}

async function generateAggregateReview(blindedContent: string, reviews: IndividualReview[], model: ReviewModel) {
  const fallbackReview = reviews[0];
  const fallbackScores = reviews.map((review) => review.scoreBand.median);
  const input = buildAggregateInput(blindedContent, reviews);

  if (model === "gemini") {
    const response = await callGemini(AGGREGATOR_SYSTEM_INSTRUCTION, input);
    return { aggregate: normalizeAggregateReview(extractJson(response.text), fallbackScores, fallbackReview), thinkingText: response.thinkingText };
  }

  const text = await callGpt(AGGREGATOR_SYSTEM_INSTRUCTION, input, 4096);
  return { aggregate: normalizeAggregateReview(extractJson(text), fallbackScores, fallbackReview), thinkingText: null as string | null };
}

function pickRepresentativeReview(reviews: IndividualReview[], medianScore: number): IndividualReview {
  return [...reviews].sort((a, b) => Math.abs(a.scoreBand.median - medianScore) - Math.abs(b.scoreBand.median - medianScore))[0];
}

export function blindManuscriptText(paperContent: string): string {
  const cleaned = stripControlChars(paperContent).replace(/\r\n/g, "\n");
  const lines = cleaned.split("\n");
  const abstractIndex = lines.findIndex((line) => /^\s*abstract\b/i.test(line));
  const startIndex = abstractIndex > 0 && abstractIndex < 80 ? abstractIndex : 0;
  let bodyLines = lines.slice(startIndex);
  const tailCutIndex = bodyLines.findIndex((line) => /^\s*(references|bibliography|acknowledg?ments?|works cited)\b/i.test(line));
  if (tailCutIndex !== -1) bodyLines = bodyLines.slice(0, tailCutIndex);

  return bodyLines
    .map((line, index) => {
      if (index < 20) {
        if (/@/.test(line)) return "";
        if (/\b(university|institute|department|laboratory|college|school)\b/i.test(line)) return "";
        if (/^\s*(authors?|affiliations?)\b/i.test(line)) return "";
      }
      return line;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function computeContentFingerprint(paperContent: string): string {
  const normalized = stripControlChars(paperContent).toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha256").update(normalized).digest("hex");
}

export async function extractMetadata(paperContent: string): Promise<{ title: string; authors: string }> {
  try {
    const text = await callGpt(METADATA_PROMPT, paperContent.substring(0, 4000), 512);
    const parsed = extractJson(text) as Record<string, unknown>;
    return {
      title: asString(parsed.title, "Unknown Title"),
      authors: asString(parsed.authors, "Unknown Authors"),
    };
  } catch {
    const lines = stripControlChars(paperContent).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return {
      title: lines[0] || "Unknown Title",
      authors: lines[1] || "Unknown Authors",
    };
  }
}

export async function generateMultiPassReview(
  paperContent: string,
  model: ReviewModel,
  promptOverride?: string,
): Promise<MultiPassReviewResult> {
  const systemPrompt = promptOverride?.trim() || REVIEW_SYSTEM_INSTRUCTION;
  const blindedContent = blindManuscriptText(paperContent);
  const individualReviews: IndividualReview[] = [];
  const thinkingChunks: string[] = [];

  for (let index = 0; index < REVIEW_PASS_COUNT; index += 1) {
    const { review, thinkingText } = await generateIndividualReview(blindedContent, systemPrompt, model);
    individualReviews.push(review);
    if (thinkingText) thinkingChunks.push(`Pass ${index + 1}\n${thinkingText}`);
  }

  const { aggregate, thinkingText } = await generateAggregateReview(blindedContent, individualReviews, model);
  if (thinkingText) thinkingChunks.push(`Aggregator\n${thinkingText}`);

  const representativeReview = pickRepresentativeReview(individualReviews, aggregate.finalScoreBand.median);

  return {
    modelName: model === "gemini" ? GEMINI_MODEL : GPT_MODEL,
    systemPrompt,
    blindedContent,
    individualReviews,
    aggregate,
    representativeReview,
    thinkingText: thinkingChunks.length > 0 ? thinkingChunks.join("\n\n---\n\n") : null,
  };
}

export function buildStoredReviewValues(result: MultiPassReviewResult) {
  const { representativeReview, aggregate } = result;
  return {
    summary: aggregate.finalSummary || representativeReview.summary || representativeReview.oneParagraphVerdict,
    correctness: representativeReview.correctness,
    novelty: representativeReview.novelty,
    overallEvaluation: aggregate.publicOneParagraphVerdict || representativeReview.finalJudgment,
    score: aggregate.finalScoreBand.median,
    relatedWork: "",
    centralClaim: representativeReview.centralClaim || null,
    establishedResults: toMarkdownList(representativeReview.establishedResults) || null,
    interpretiveClaims: toMarkdownList(representativeReview.interpretiveClaims) || null,
    speculativeClaims: toMarkdownList(representativeReview.speculativeClaims) || null,
    economy: representativeReview.economy || null,
    explanatoryTargetBreadth: representativeReview.explanatoryTargetBreadth || null,
    theorySpaceBreadth: representativeReview.theorySpaceBreadth || null,
    scopeDepth: representativeReview.scopeDepth || null,
    unifyingPower: representativeReview.unifyingPower || null,
    strongestCaseForImportance: representativeReview.strongestCaseForImportance || null,
    strongestObjection: representativeReview.strongestObjection || null,
    decisiveCheck: representativeReview.decisiveCheck || null,
    internalTechnicalTraction: representativeReview.internalTechnicalTraction || null,
    noveltyConfidence: String(representativeReview.noveltyConfidence),
    intrinsicScientificMeritScore: representativeReview.intrinsicTechnicalScore,
    explanatoryTargetBreadthScore: representativeReview.explanatoryTargetBreadthScore,
    theorySpaceBreadthScore: representativeReview.theorySpaceBreadthScore,
    breadthOfImpactScore: representativeReview.breadthOfImpactScore,
    overallIntrinsicScore: aggregate.finalScoreBand.median,
    bestClassification: aggregate.finalClassification || representativeReview.bestClassification,
    finalJudgment: aggregate.publicOneParagraphVerdict || representativeReview.finalJudgment,
    coverageLedgerJson: JSON.stringify(representativeReview.coverageLedger),
    thinkingText: result.thinkingText,
    comparisonCohort: aggregate.finalComparisonCohort || representativeReview.comparisonCohort || null,
    broadField: aggregate.finalBroadField || representativeReview.broadField || null,
    specialtyField: aggregate.finalSpecialtyField || representativeReview.specialtyField || null,
    frameworkConditionalityLevel: representativeReview.frameworkConditionality.level,
    frameworkConditionalityExplanation: representativeReview.frameworkConditionality.explanation || null,
    specialtyRelativeScore: representativeReview.specialtyRelativeScore,
    broadFieldRelativeScore: representativeReview.broadFieldRelativeScore,
    crossFieldConsequenceScore: representativeReview.crossFieldConsequenceScore,
    scoreBandLow: aggregate.finalScoreBand.low,
    scoreBandMedian: aggregate.finalScoreBand.median,
    scoreBandHigh: aggregate.finalScoreBand.high,
    scoreConfidence: String(aggregate.finalScoreConfidence),
    scoreStability: aggregate.scoreStability,
    publicVerdict: aggregate.publicOneParagraphVerdict || representativeReview.oneParagraphVerdict || null,
    individualReviewsJson: JSON.stringify(result.individualReviews),
    aggregateMetaJson: JSON.stringify(aggregate),
    passCount: REVIEW_PASS_COUNT,
    modelName: result.modelName,
    systemPrompt: result.systemPrompt,
  };
}
