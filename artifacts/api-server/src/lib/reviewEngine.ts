import OpenAI from "openai";
import { createHash } from "crypto";
import { ai as geminiAI } from "@workspace/integrations-gemini-ai";

export const GPT_MODEL = "gpt-5.4-pro";
export const GEMINI_MODEL = "gemini-3.1-pro-preview";
export const REVIEW_PASS_COUNT = 3;

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY environment variable is not set.");
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export type ReviewModel = "gpt" | "gemini";

type FrameworkLevel = "low" | "medium" | "high";
type ScoreStability = "high" | "medium" | "low";

const CLASSIFICATIONS = [
  "field-defining advance",
  "major specialty advance",
  "strong niche contribution",
  "useful clarification",
  "elegant repackaging",
  "not yet convincing",
] as const;

export interface IndividualReview {
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
  scoreBand: {
    low: number;
    median: number;
    high: number;
  };
  scoreConfidence: number;
  bestClassification: string;
  oneParagraphVerdict: string;
  finalJudgment: string;
}

export interface AggregateReview {
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
  finalScoreBand: {
    low: number;
    median: number;
    high: number;
  };
  finalScoreConfidence: number;
  publicOneParagraphVerdict: string;
  internalCalibrationNotes: string;
}

export interface ReviewRunResult {
  review: IndividualReview;
  thinkingText: string | null;
}

export interface AggregateRunResult {
  aggregate: AggregateReview;
  thinkingText: string | null;
}

export interface MultiPassReviewResult {
  modelName: string;
  systemPrompt: string;
  blindedContent: string;
  individualReviews: IndividualReview[];
  aggregate: AggregateReview;
  representativeReview: IndividualReview;
  thinkingText: string | null;
}

const INDIVIDUAL_REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "authorName",
    "comparisonCohort",
    "broadField",
    "specialtyField",
    "subfields",
    "paperType",
    "summary",
    "centralClaim",
    "coverageLedger",
    "establishedResults",
    "interpretiveClaims",
    "speculativeClaims",
    "correctness",
    "novelty",
    "noveltyConfidence",
    "internalTechnicalTraction",
    "economy",
    "explanatoryTargetBreadth",
    "theorySpaceBreadth",
    "scopeDepth",
    "unifyingPower",
    "frameworkConditionality",
    "strongestCaseForImportance",
    "strongestObjection",
    "decisiveCheck",
    "whatWouldRaiseScore",
    "whatWouldLowerScore",
    "intrinsicTechnicalScore",
    "explanatoryTargetBreadthScore",
    "theorySpaceBreadthScore",
    "breadthOfImpactScore",
    "specialtyRelativeScore",
    "broadFieldRelativeScore",
    "crossFieldConsequenceScore",
    "scoreBand",
    "scoreConfidence",
    "bestClassification",
    "oneParagraphVerdict",
    "finalJudgment",
  ],
  properties: {
    title: { type: "string" },
    authorName: { type: "string" },
    comparisonCohort: { type: "string" },
    broadField: { type: "string" },
    specialtyField: { type: "string" },
    subfields: { type: "array", items: { type: "string" } },
    paperType: { type: "string" },
    summary: { type: "string" },
    centralClaim: { type: "string" },
    coverageLedger: {
      type: "object",
      additionalProperties: false,
      required: [
        "directTargets",
        "importedInputs",
        "theorySpaceVariants",
        "mechanismSharingAssessment",
      ],
      properties: {
        directTargets: { type: "array", items: { type: "string" } },
        importedInputs: { type: "array", items: { type: "string" } },
        theorySpaceVariants: { type: "array", items: { type: "string" } },
        mechanismSharingAssessment: { type: "string" },
      },
    },
    establishedResults: { type: "array", items: { type: "string" } },
    interpretiveClaims: { type: "array", items: { type: "string" } },
    speculativeClaims: { type: "array", items: { type: "string" } },
    correctness: { type: "string" },
    novelty: { type: "string" },
    noveltyConfidence: { type: "number" },
    internalTechnicalTraction: { type: "string" },
    economy: { type: "string" },
    explanatoryTargetBreadth: { type: "string" },
    theorySpaceBreadth: { type: "string" },
    scopeDepth: { type: "string" },
    unifyingPower: { type: "string" },
    frameworkConditionality: {
      type: "object",
      additionalProperties: false,
      required: ["level", "explanation"],
      properties: {
        level: { type: "string", enum: ["low", "medium", "high"] },
        explanation: { type: "string" },
      },
    },
    strongestCaseForImportance: { type: "string" },
    strongestObjection: { type: "string" },
    decisiveCheck: { type: "string" },
    whatWouldRaiseScore: { type: "string" },
    whatWouldLowerScore: { type: "string" },
    intrinsicTechnicalScore: { type: "number" },
    explanatoryTargetBreadthScore: { type: "number" },
    theorySpaceBreadthScore: { type: "number" },
    breadthOfImpactScore: { type: "number" },
    specialtyRelativeScore: { type: "number" },
    broadFieldRelativeScore: { type: "number" },
    crossFieldConsequenceScore: { type: "number" },
    scoreBand: {
      type: "object",
      additionalProperties: false,
      required: ["low", "median", "high"],
      properties: {
        low: { type: "number" },
        median: { type: "number" },
        high: { type: "number" },
      },
    },
    scoreConfidence: { type: "number" },
    bestClassification: { type: "string" },
    oneParagraphVerdict: { type: "string" },
    finalJudgment: { type: "string" },
  },
} as const;

const AGGREGATE_REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "finalComparisonCohort",
    "finalBroadField",
    "finalSpecialtyField",
    "finalSummary",
    "individualScores",
    "scoreRange",
    "scoreStability",
    "mainAgreements",
    "mainDisagreements",
    "fatalObjectionPresent",
    "fatalObjectionAssessment",
    "finalClassification",
    "finalScoreBand",
    "finalScoreConfidence",
    "publicOneParagraphVerdict",
    "internalCalibrationNotes",
  ],
  properties: {
    finalComparisonCohort: { type: "string" },
    finalBroadField: { type: "string" },
    finalSpecialtyField: { type: "string" },
    finalSummary: { type: "string" },
    individualScores: { type: "array", items: { type: "number" } },
    scoreRange: { type: "number" },
    scoreStability: { type: "string", enum: ["high", "medium", "low"] },
    mainAgreements: { type: "array", items: { type: "string" } },
    mainDisagreements: { type: "array", items: { type: "string" } },
    fatalObjectionPresent: { type: "boolean" },
    fatalObjectionAssessment: { type: "string" },
    finalClassification: { type: "string" },
    finalScoreBand: {
      type: "object",
      additionalProperties: false,
      required: ["low", "median", "high"],
      properties: {
        low: { type: "number" },
        median: { type: "number" },
        high: { type: "number" },
      },
    },
    finalScoreConfidence: { type: "number" },
    publicOneParagraphVerdict: { type: "string" },
    internalCalibrationNotes: { type: "string" },
  },
} as const;

export const REVIEW_SYSTEM_INSTRUCTION = `You are reviewing an anonymous scientific manuscript from its contents alone.

Ignore author identity, institution, venue, citation counts, publication status, historical fame, and later influence. If any of that information appears in the text, ignore it. Judge only the manuscript's ideas, claims, derivations, constructions, examples, data, checks, reductions, limits, and explicit comparisons.

Do not defer to human expert consensus. Your task is to give the best model-based scientific judgment under this review protocol.

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

First determine the comparison cohort. Use the narrowest serious research cohort that a working expert would naturally use, but do not choose an artificially tiny cohort merely to inflate the score. Also identify the broader field.

Definitions:

Direct explanatory targets are phenomena, regimes, examples, theorem families, systems, observables, structures, tasks, or problem classes that the manuscript explicitly analyzes or derives results for.

Imported inputs are formulas, assumptions, known laws, entropy functionals, standard definitions, prior frameworks, or external results used by the manuscript but not themselves explained by it.

Theory-space variants are alternative theories, dimensions, parameter families, model classes, formalisms, axiomatic settings, architectures, or regimes across which the same template is extended.

Mechanism-sharing asks whether the same mechanism genuinely explains multiple direct targets, or whether the manuscript merely reuses notation across them.

Do not count an imported input as a direct explanatory target. Do not count multiple theory variants as multiple physical targets unless they produce distinct consequences, structures, constraints, or applications.

A simple identity or reformulation can be scientifically important if it reveals a privileged variable, removes ambiguity, unifies targets, produces a new derivation, separates previously conflated mechanisms, or gives new calculational leverage. But do not reward relabeling unless it produces genuine explanatory gain.

Every review must include the strongest case for importance and the strongest objection. The objection should not be artificially hostile; it should be the most serious technically fair concern.

Scoring:

The main score is field-relative. It answers: how strong is this manuscript compared with serious research papers in its comparison cohort, judging only content and support?

Also provide:
- broad-field score: strength relative to the broader field;
- cross-field consequence score: how much the result would matter outside the immediate field if correct;
- framework conditionality: whether the importance depends on accepting a specific framework.

Use the full range.

Classification options:
- field-defining advance
- major specialty advance
- strong niche contribution
- useful clarification
- elegant repackaging
- not yet convincing

Classification guidance:
- field-defining advance: changes central concepts, methods, or organizing principles of the comparison cohort.
- major specialty advance: provides a substantial new result, mechanism, derivation, framework, or unification that changes how an important specialty understands its targets.
- strong niche contribution: deep, correct, and genuinely clarifying within a focused domain.
- useful clarification: improves understanding but is mostly explanatory, organizational, or incremental.
- elegant repackaging: clear and economical but does not establish a substantially new result, mechanism, or explanatory gain.
- not yet convincing: central claims are unsupported, incorrect, or too speculative.

Before final scoring, explicitly consider:
1. What is genuinely derived or established inside the manuscript?
2. What is imported?
3. What would a fair skeptical reviewer say is merely relabeling?
4. What would most raise the score?
5. What would most lower the score?
6. Is the comparison cohort too broad or too narrow?

Return valid JSON only with this exact structure:

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
  "frameworkConditionality": {
    "level": "low",
    "explanation": ""
  },
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
  "scoreBand": {
    "low": 0,
    "median": 0,
    "high": 0
  },
  "scoreConfidence": 0.0,
  "bestClassification": "",
  "oneParagraphVerdict": "",
  "finalJudgment": ""
}

All numeric fields must be numbers, not strings.
Use LaTeX for mathematical notation inside strings.
Output valid JSON only.`;

export const AGGREGATOR_SYSTEM_INSTRUCTION = `You are aggregating three independent anonymous manuscript reviews produced under the same rubric.

Do not simply average the scores. Compare the reasoning.

Your task:
1. Identify agreements.
2. Identify disagreements.
3. Determine whether the reviewers used the same comparison cohort.
4. Determine whether any reviewer found a fatal correctness issue.
5. Decide whether score variation reflects real ambiguity or model noise.
6. Produce the final public classification, score band, and one-paragraph verdict.
7. Produce a short public summary of what the manuscript actually does.

Do not defer to human expert consensus. This is a model-based judgment under the review protocol.

If one review identifies a fatal technical error and the others ignore it, do not average it away. Evaluate whether the objection is decisive.

If score range is:
- 0–5: stability = high
- 6–12: stability = medium
- greater than 12: stability = low

Return valid JSON only:

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
  "finalScoreBand": {
    "low": 0,
    "median": 0,
    "high": 0
  },
  "finalScoreConfidence": 0.0,
  "publicOneParagraphVerdict": "",
  "internalCalibrationNotes": ""
}`;

const METADATA_PROMPT = `Extract the title and authors from the scientific paper text provided.
Return a JSON object with exactly two fields:
- title: string (the paper title, or "Unknown Title" if not found)
- authors: string (comma-separated list of author names as written, or "Unknown Authors" if not found)
Output valid JSON only.`;

function stripControlChars(text: string): string {
  return text.replace(/\x00/g, "").replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ");
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function asNumber(value: unknown, fallback = 0, min?: number, max?: number): number {
  const raw = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  const safe = Number.isFinite(raw) ? raw : fallback;
  const lowerBounded = min != null ? Math.max(min, safe) : safe;
  return max != null ? Math.min(max, lowerBounded) : lowerBounded;
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
  return CLASSIFICATIONS.includes(candidate as (typeof CLASSIFICATIONS)[number])
    ? candidate
    : "strong niche contribution";
}

function normalizeFrameworkLevel(value: unknown): FrameworkLevel {
  const candidate = asString(value).toLowerCase();
  if (candidate === "high" || candidate === "medium" || candidate === "low") return candidate;
  return "medium";
}

function normalizeScoreBand(value: unknown): { low: number; median: number; high: number } {
  const obj = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const rawLow = asNumber(obj.low, 0, 0, 100);
  const rawMedian = asNumber(obj.median, rawLow, 0, 100);
  const rawHigh = asNumber(obj.high, rawMedian, 0, 100);
  const sorted = [rawLow, rawMedian, rawHigh].sort((a, b) => a - b);
  return { low: Math.round(sorted[0]), median: Math.round(sorted[1]), high: Math.round(sorted[2]) };
}

function toMarkdownList(items: string[]): string {
  return items.filter(Boolean).map((item) => `- ${item}`).join("\n");
}

function extractJson(raw: string): unknown {
  const trimmed = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try { return JSON.parse(trimmed); } catch {}
  const lastBrace = trimmed.lastIndexOf("}");
  if (lastBrace !== -1) {
    try { return JSON.parse(trimmed.slice(0, lastBrace + 1)); } catch {}
  }
  throw new Error("Could not parse model response as JSON.");
}

function normalizeIndividualReview(input: unknown): IndividualReview {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const coverageLedger = source.coverageLedger && typeof source.coverageLedger === "object"
    ? source.coverageLedger as Record<string, unknown>
    : {};
  const frameworkConditionality = source.frameworkConditionality && typeof source.frameworkConditionality === "object"
    ? source.frameworkConditionality as Record<string, unknown>
    : {};

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
      directTargets: asStringArray(coverageLedger.directTargets),
      importedInputs: asStringArray(coverageLedger.importedInputs),
      theorySpaceVariants: asStringArray(coverageLedger.theorySpaceVariants),
      mechanismSharingAssessment: asString(coverageLedger.mechanismSharingAssessment),
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
      level: normalizeFrameworkLevel(frameworkConditionality.level),
      explanation: asString(frameworkConditionality.explanation),
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
    specialtyRelativeScore: Math.round(asNumber(source.specialtyRelativeScore, 0, 0, 100)),
    broadFieldRelativeScore: Math.round(asNumber(source.broadFieldRelativeScore, 0, 0, 100)),
    crossFieldConsequenceScore: Math.round(asNumber(source.crossFieldConsequenceScore, 0, 0, 100)),
    scoreBand: normalizeScoreBand(source.scoreBand),
    scoreConfidence: asNumber(source.scoreConfidence, 0.5, 0, 1),
    bestClassification: normalizeClassification(source.bestClassification),
    oneParagraphVerdict: asString(source.oneParagraphVerdict),
    finalJudgment: asString(source.finalJudgment),
  };
}

function normalizeAggregateReview(input: unknown, fallbackScores: number[]): AggregateReview {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const individualScores = Array.isArray(source.individualScores)
    ? (source.individualScores as unknown[]).map((item) => Math.round(asNumber(item, 0, 0, 100)))
    : fallbackScores;
  const scores = individualScores.length > 0 ? individualScores : fallbackScores;
  const normalizedBand = normalizeScoreBand(source.finalScoreBand);
  const band = normalizedBand.low === 0 && normalizedBand.median === 0 && normalizedBand.high === 0 && scores.length > 0
    ? {
        low: Math.min(...scores),
        median: Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length),
        high: Math.max(...scores),
      }
    : normalizedBand;
  return {
    finalComparisonCohort: asString(source.finalComparisonCohort),
    finalBroadField: asString(source.finalBroadField),
    finalSpecialtyField: asString(source.finalSpecialtyField),
    finalSummary: asString(source.finalSummary),
    individualScores: scores,
    scoreRange: Math.round(asNumber(source.scoreRange, Math.max(...scores) - Math.min(...scores), 0, 100)),
    scoreStability: (() => {
      const candidate = asString(source.scoreStability).toLowerCase();
      return candidate === "high" || candidate === "medium" || candidate === "low"
        ? candidate
        : scores.length > 1
          ? scoresRangeToStability(Math.max(...scores) - Math.min(...scores))
          : "high";
    })(),
    mainAgreements: asStringArray(source.mainAgreements),
    mainDisagreements: asStringArray(source.mainDisagreements),
    fatalObjectionPresent: asBoolean(source.fatalObjectionPresent),
    fatalObjectionAssessment: asString(source.fatalObjectionAssessment),
    finalClassification: normalizeClassification(source.finalClassification),
    finalScoreBand: band,
    finalScoreConfidence: asNumber(source.finalScoreConfidence, 0.5, 0, 1),
    publicOneParagraphVerdict: asString(source.publicOneParagraphVerdict),
    internalCalibrationNotes: asString(source.internalCalibrationNotes),
  };
}

function scoresRangeToStability(range: number): ScoreStability {
  if (range <= 5) return "high";
  if (range <= 12) return "medium";
  return "low";
}

function buildIndependentReviewPrompt(basePrompt: string, passNumber: number): string {
  return `${basePrompt}\n\nThis is independent review pass ${passNumber} of ${REVIEW_PASS_COUNT}. Review from scratch. Do not assume access to any previous review.`;
}

function buildAggregateInput(reviews: IndividualReview[]): string {
  return JSON.stringify(
    {
      reviewPasses: reviews.map((review, index) => ({
        passNumber: index + 1,
        comparisonCohort: review.comparisonCohort,
        broadField: review.broadField,
        specialtyField: review.specialtyField,
        centralClaim: review.centralClaim,
        summary: review.summary,
        correctness: review.correctness,
        novelty: review.novelty,
        strongestCaseForImportance: review.strongestCaseForImportance,
        strongestObjection: review.strongestObjection,
        decisiveCheck: review.decisiveCheck,
        scoreBand: review.scoreBand,
        specialtyRelativeScore: review.specialtyRelativeScore,
        bestClassification: review.bestClassification,
        oneParagraphVerdict: review.oneParagraphVerdict,
      })),
    },
    null,
    2,
  );
}

async function callGptWithSchema(prompt: string, input: string, schemaName: string, schema: object): Promise<unknown> {
  const response = await openai.chat.completions.create({
    model: GPT_MODEL,
    max_completion_tokens: 8192,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: schemaName,
        strict: true,
        schema,
      },
    } as any,
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: input },
    ],
  });
  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("No response from GPT model.");
  return JSON.parse(content);
}

async function callGemini(prompt: string, input: string): Promise<{ parsed: unknown; thinkingText: string | null }> {
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
  const thinkingParts = parts.filter((part: any) => part.thought === true);
  const thinkingText = thinkingParts.length > 0
    ? thinkingParts.map((part: any) => part.text ?? "").join("\n\n").trim()
    : null;
  const content = response.text;
  if (!content) throw new Error("No response from Gemini model.");
  return { parsed: extractJson(content), thinkingText };
}

async function generateIndividualReview(
  paperContent: string,
  prompt: string,
  model: ReviewModel,
): Promise<ReviewRunResult> {
  if (model === "gemini") {
    const { parsed, thinkingText } = await callGemini(prompt, paperContent);
    return { review: normalizeIndividualReview(parsed), thinkingText };
  }

  const parsed = await callGptWithSchema(prompt, paperContent, "individual_scientific_review", INDIVIDUAL_REVIEW_SCHEMA);
  return { review: normalizeIndividualReview(parsed), thinkingText: null };
}

async function generateAggregateReview(
  reviews: IndividualReview[],
  model: ReviewModel,
): Promise<AggregateRunResult> {
  const aggregateInput = buildAggregateInput(reviews);
  const fallbackScores = reviews.map((review) => review.scoreBand.median);

  if (model === "gemini") {
    const { parsed, thinkingText } = await callGemini(AGGREGATOR_SYSTEM_INSTRUCTION, aggregateInput);
    return { aggregate: normalizeAggregateReview(parsed, fallbackScores), thinkingText };
  }

  const parsed = await callGptWithSchema(
    AGGREGATOR_SYSTEM_INSTRUCTION,
    aggregateInput,
    "aggregate_scientific_review",
    AGGREGATE_REVIEW_SCHEMA,
  );
  return { aggregate: normalizeAggregateReview(parsed, fallbackScores), thinkingText: null };
}

function pickRepresentativeReview(reviews: IndividualReview[], medianScore: number): IndividualReview {
  return [...reviews].sort((a, b) => {
    const aDelta = Math.abs(a.scoreBand.median - medianScore);
    const bDelta = Math.abs(b.scoreBand.median - medianScore);
    return aDelta - bDelta;
  })[0];
}

export function blindManuscriptText(paperContent: string): string {
  const cleaned = stripControlChars(paperContent).replace(/\r\n/g, "\n");
  const lines = cleaned.split("\n");
  const abstractIndex = lines.findIndex((line) => /^\s*abstract\b/i.test(line));
  const startIndex = abstractIndex > 0 && abstractIndex < 80 ? abstractIndex : 0;
  let bodyLines = lines.slice(startIndex);

  const tailCutIndex = bodyLines.findIndex((line) =>
    /^\s*(references|bibliography|acknowledg?ments?|works cited)\b/i.test(line),
  );
  if (tailCutIndex !== -1) {
    bodyLines = bodyLines.slice(0, tailCutIndex);
  }

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
  const normalized = stripControlChars(paperContent)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha256").update(normalized).digest("hex");
}

export async function extractMetadata(paperContent: string): Promise<{ title: string; authors: string }> {
  try {
    const response = await openai.chat.completions.create({
      model: GPT_MODEL,
      max_completion_tokens: 512,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "paper_metadata",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["title", "authors"],
            properties: {
              title: { type: "string" },
              authors: { type: "string" },
            },
          },
        },
      } as any,
      messages: [
        { role: "system", content: METADATA_PROMPT },
        { role: "user", content: paperContent.substring(0, 4000) },
      ],
    });
    const raw = response.choices[0]?.message?.content;
    if (!raw) throw new Error("No metadata response");
    const parsed = JSON.parse(raw);
    return {
      title: asString(parsed.title, "Unknown Title"),
      authors: asString(parsed.authors, "Unknown Authors"),
    };
  } catch {
    return { title: "Unknown Title", authors: "Unknown Authors" };
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
    const { review, thinkingText } = await generateIndividualReview(
      blindedContent,
      buildIndependentReviewPrompt(systemPrompt, index + 1),
      model,
    );
    individualReviews.push(review);
    if (thinkingText) {
      thinkingChunks.push(`Pass ${index + 1}\n${thinkingText}`);
    }
  }

  const { aggregate, thinkingText: aggregateThinking } = await generateAggregateReview(individualReviews, model);
  if (aggregateThinking) {
    thinkingChunks.push(`Aggregator\n${aggregateThinking}`);
  }

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
