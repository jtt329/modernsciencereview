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

Scale instructions:
-  