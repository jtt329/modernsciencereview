import OpenAI from "openai";
import { ai as geminiAI } from "@workspace/integrations-gemini-ai";
import {
  BENCHMARK_CALIBRATED_V15_FULL_PROMPT,
  BENCHMARK_COMPARATOR_CALIBRATION_V15_PROMPT,
  BLIND_INTRINSIC_ADJUDICATOR_V15_PROMPT,
  BLIND_REVIEW_PASS_V15_PROMPT,
  DATE_METADATA_EXTRACTION_V15_PROMPT,
} from "./prompts/benchmarkCalibratedV15";
import { logger } from "./logger";

export const GPT_MODEL = "gpt-5.4-pro";
export const GEMINI_REVIEW_MODEL =
  process.env.SCIREVIEW_GEMINI_REVIEW_MODEL?.trim() ||
  "gemini-3.5-flash";
export const GEMINI_PRO_MODEL =
  process.env.SCIREVIEW_GEMINI_PRO_MODEL?.trim() ||
  "gemini-3.1-pro-preview";
export const GEMINI_METADATA_MODEL =
  process.env.SCIREVIEW_GEMINI_METADATA_MODEL?.trim() ||
  GEMINI_REVIEW_MODEL;
export const GEMINI_PASS_MODEL = GEMINI_PRO_MODEL;
export const GEMINI_META_MODEL = GEMINI_PRO_MODEL;
export const GEMINI_CALIBRATION_MODEL = GEMINI_PRO_MODEL;
export const GEMINI_MODEL = GEMINI_META_MODEL;
export const GEMINI_PIPELINE_LABEL = `${GEMINI_PASS_MODEL} x2 + ${GEMINI_META_MODEL} blind adjudicator`;
export const REVIEW_PASS_COUNT = 2;
export type ReviewPipelineMode = "benchmark-ingestion" | "normal-review";
export const DEFAULT_REVIEW_PIPELINE_MODE: ReviewPipelineMode = "benchmark-ingestion";
export const REVIEW_PIPELINE_MODE = DEFAULT_REVIEW_PIPELINE_MODE;
export const BENCHMARK_SET_VERSION = process.env.SCIREVIEW_BENCHMARK_SET_VERSION?.trim() || "physics-horizon-v1";

export function normalizeReviewPipelineMode(value: unknown): ReviewPipelineMode {
  return value === "normal-review" ? "normal-review" : "benchmark-ingestion";
}

export function reviewPipelineLabel(mode: ReviewPipelineMode = DEFAULT_REVIEW_PIPELINE_MODE) {
  return mode === "normal-review"
    ? `${GEMINI_PIPELINE_LABEL} + ${GEMINI_CALIBRATION_MODEL} comparator calibration`
    : `${GEMINI_PIPELINE_LABEL} + benchmark ingestion`;
}

export function expectedReviewModelName(mode: ReviewPipelineMode = DEFAULT_REVIEW_PIPELINE_MODE) {
  return `${reviewPipelineLabel(mode)} · ${REVIEW_PROMPT_VERSION}`;
}

let openai: OpenAI | null = null;
function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required when the OpenAI review model is selected.");
  }
  openai ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openai;
}

export type ReviewModel = "gpt" | "gemini";

export type ReviewInput =
  | string
  | {
      text: string;
      pdfBase64: string;
      mimeType?: string;
    };

type FrameworkLevel = "low" | "medium" | "high";
type ScoreStability = "high" | "medium" | "low";
type AdjudicatorStatus = "success" | "failed_fallback" | "not_run";
type ComparatorCalibrationStatus =
  | "applied"
  | "unavailable"
  | "not_available"
  | "not_run"
  | "weak"
  | "insufficient_comparators"
  | "not_run_benchmark_ingestion"
  | "failed";
type DiagnosticSubscoreKey =
  | "inputStrengthScore"
  | "constructionStrengthScore"
  | "outputStrengthScore";
type DiagnosticSubscoreValidity = Record<DiagnosticSubscoreKey, boolean>;
type DiagnosticSubscoreRationale = Record<DiagnosticSubscoreKey, string>;

const CLASSIFICATIONS = [
  "field-defining advance",
  "major specialty advance",
  "specialty advance",
  "strong niche contribution",
  "niche contribution",
  "minor contribution",
  "limited contribution",
  "not yet convincing",
] as const;

type CoverageLedger = {
  directTargets: string[];
  importedInputs: string[];
  theorySpaceVariants: string[];
  mechanismSharingAssessment: string;
};

type InputConstructionOutputLedger = {
  primitiveInputs: PrimitiveInputItem[];
  introducedConstructions: IntroducedConstructionItem[];
  outputs: LedgerOutputItem[];
  inputOverallAssessment: string;
  constructionOverallAssessment: string;
  outputOverallAssessment: string;
  whyOutputsMatter: string;
  // Legacy fields retained for older saved reviews and comparator context.
  externalEmbeddingsAndChecks: string[];
  centralOutputDependency: CentralOutputDependency;
  outputValidityAssessment: OutputValidityAssessment;
  directOutputs: string[];
  downstreamReach: string;
  assessment: string;
};

type PrimitiveInputItem = {
  input: string;
  role: string;
  groundingQuality: "weak" | "moderate" | "strong" | "";
  grounding: string;
  fundamentalityLevel: FrameworkLevel | "";
  fundamentality: string;
  frameworkDependenceLevel: FrameworkLevel | "";
  frameworkDependence: string;
  assessment: string;
};

type IntroducedConstructionItem = {
  construction: string;
  role: string;
  inputsUsed: string[];
  validityLevel: "invalid" | "conditional" | "valid" | "strong" | "";
  validity: string;
  hardToVaryLevel: FrameworkLevel | "";
  hardToVary: string;
  fragilityLevel: FrameworkLevel | "";
  fragilityOrLimits: string;
  assessment: string;
};

type LedgerOutputItem = {
  output: string;
  dependsOnInputs: string[];
  dependsOnConstructions: string[];
  inputsUsed: string[];
  constructionsUsed: string[];
  externalContextIfAny: string;
  support: string;
  validityLevel: "invalid" | "conditional" | "valid" | "strong" | "";
  validity: string;
  centrality: "low" | "medium" | "high";
  assessment: string;
};

type CentralOutputDependency = {
  centralOutput: string;
  requiredPrimitiveInputs: string[];
  requiredIntroducedConstructions: string[];
  dependencyAssessment: string;
  constructionFragility: string;
  outputValidity: string;
  // v11 compatibility aliases for existing saved reviews.
  dependsOnPrimitiveInputs: string[];
  dependsOnIntroducedConstructions: string[];
  weakestDependency: string;
  assessment: string;
};

type OutputValidityAssessment = {
  knownResultRecoveries: string[];
  novelPredictionsOrConstraints: string[];
  failedOutputsOrConstraints: string[];
  assessment: string;
};

type ScoreBand = {
  low: number;
  median: number;
  high: number;
};

type ContributionArchetype = {
  primary: string;
  secondary: string;
};

type NearestComparator = {
  comparatorId?: string;
  paperTitle: string;
  relationship: "similar" | "stronger" | "weaker" | "direct" | "upstream" | "downstream" | "adjacent" | "lower_or_limited" | "external_suggestion";
  whyComparable: string;
  keyDifference: string;
  relativeAssessment: "stronger" | "weaker" | "similar" | "unclear";
  relativeScoreJudgment?: "current_paper_stronger" | "current_paper_weaker" | "similar_quality" | "unclear";
  scoreGapJustification?: string;
  sitePaperId?: string;
};

type ContributionInventoryItem = {
  claimOrContribution: string;
  status: "correct" | "likely_correct" | "uncertain" | "flawed" | "false";
  contributionWeight: "low" | "medium" | "high" | "field_shaping";
  separability: "inseparable" | "separable" | "independent";
  survivalStatus: "survives" | "partially_survives" | "fails";
  notes: string;
};

type AdjudicationDetails = {
  adjudicatorStatus: AdjudicatorStatus;
  individualScores: number[];
  scoreRange: number;
  scoreStability: ScoreStability;
  mainAgreements: string[];
  mainDisagreements: string[];
  fatalObjectionPresent: boolean;
  fatalObjectionAssessment: string;
  fatalToSpecificClaimOnly: boolean;
  paperFatalError: boolean;
  contributionInventory: ContributionInventoryItem[];
  survivingHighValueContributions: string[];
  failedClaimsExcludedFromScore: string[];
  survivingContributionScoreBasis: string;
  calibrationAdjustments: string;
  subscoreConsistencyWarning: string;
  subscoreSaturationWarning: boolean;
  diagnosticBaselineScore: number;
  diagnosticBaselineDelta: number;
  scoreAdjustmentReason: string;
  scoringAnomaly: string;
};

type ReviewFailureAnalysis = {
  failureMode: string;
  fatalObjectionPresent: boolean;
  paperFatalError: boolean;
  fatalToSpecificClaimOnly: boolean;
  survivingHighValueContributions: string[];
  failedClaimsExcludedFromScore: string[];
  survivingContributionScoreBasis: string;
};

type ComparatorProfile = {
  localCohort: string;
  primaryCohort: string;
  adjacentBroadCohort: string;
  contributionArchetype: ContributionArchetype;
  primitiveInputs: string[];
  introducedConstructions: string[];
  outputs: string[];
  // Legacy fields retained for older saved reviews and comparator context.
  externalEmbeddingsAndChecks: string[];
  centralOutputDependency: CentralOutputDependency;
  outputValidityAssessment: OutputValidityAssessment;
  directOutputs: string[];
  downstreamReach: string;
  frameworkConditionality: FrameworkLevel;
  scoreBand: ScoreBand;
  classification: string;
  clusterFeatureTags: string[];
  comparatorSearchSummary: string;
};

type ComparatorCalibration = {
  comparatorCalibrationStatus: ComparatorCalibrationStatus;
  benchmarkSetVersion: string;
  intrinsicScoreBand: ScoreBand;
  calibrationAdjustment: number;
  finalPublicScoreBand: ScoreBand;
  finalClassification: string;
  calibrationRationale: string;
  scoreGapAssessment: string;
  scoreCappingReason: string;
  explanatoryDeltaAssessment: {
    whatIsNewBeyondComparators: string;
    inputsComparison: string;
    constructionComparison: string;
    outputsComparison: string;
    generalizationComparison: string;
    outputValidityComparison: string;
    downstreamReachComparison: string;
    frameworkConditionalityComparison: string;
    scoreGapAssessment: string;
  };
  comparatorsNeedingRecalibration: string[];
  confidence: number;
};

type ExternalComparatorSuggestion = {
  title: string;
  reasonToAdd: string;
  whyRelevant: string;
  adminOnly: boolean;
};

export type ReviewComparatorContextItem = {
  comparatorId?: string;
  sitePaperId: string;
  title: string;
  field: string | null;
  subfields: string[];
  score: number | null;
  classification: string | null;
  localCohort?: string | null;
  comparisonCohort: string | null;
  canonicalClusterLabel?: string | null;
  clusterVersion?: string | null;
  clusterFeatureTags?: string[];
  contributionArchetype?: ContributionArchetype;
  centralClaim?: string | null;
  summary?: string | null;
  inputConstructionOutputLedger?: InputConstructionOutputLedger | null;
  centralOutputDependency?: CentralOutputDependency | null;
  outputValidityAssessment?: OutputValidityAssessment | null;
  frameworkConditionality?: FrameworkLevel | string | null;
  comparatorSearchSummary?: string | null;
  benchmarkSetVersion?: string | null;
  comparatorCalibrationStatus?: string | null;
  calibratedScoreBand?: ScoreBand | null;
  explanatoryDeltaAssessment?: unknown;
};

export type ComparatorContextSelector = (
  profile: ComparatorProfile,
  aggregate: AggregateReview,
) => Promise<ReviewComparatorContextItem[]> | ReviewComparatorContextItem[];

type IndividualReview = {
  title: string;
  authorName: string;
  comparisonCohort: string;
  localCohort: string;
  broadField: string;
  specialtyField: string;
  subfields: string[];
  paperType: string;
  contributionArchetype: ContributionArchetype;
  organicCohortProfile: ComparatorProfile;
  summary: string;
  centralClaim: string;
  scientificReview: string;
  inputConstructionOutputLedger: InputConstructionOutputLedger;
  centralOutputDependency: CentralOutputDependency;
  outputValidityAssessment: OutputValidityAssessment;
  nearestComparators: NearestComparator[];
  coverageLedger: CoverageLedger;
  establishedResults: string[];
  interpretiveClaims: string[];
  speculativeClaims: string[];
  correctness: string;
  inputGrounding: string;
  inputFundamentality: string;
  constructionAssessment: string;
  outputValidity: string;
  contributionGroundingType: string;
  frameworkIndependence: string;
  hardToVaryAssessment: string;
  manuscriptOriginalContribution: string;
  survivingContributionIfFlawed: string;
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
  assessmentSensitivity: string;
  whatWouldRaiseScore: string;
  whatWouldLowerScore: string;
  inputStrengthScore: number;
  constructionStrengthScore: number;
  outputStrengthScore: number;
  outputReachScore: number;
  generalizationBreadthScore: number;
  subscoreRationale: DiagnosticSubscoreRationale;
  intrinsicTechnicalScore: number;
  explanatoryTargetBreadthScore: number;
  theorySpaceBreadthScore: number;
  breadthOfImpactScore: number;
  subscoreValidity: DiagnosticSubscoreValidity;
  scoreCappingReason: string;
  scoreAdjustmentReason: string;
  specialtyRelativeScore: number;
  broadFieldRelativeScore: number;
  crossFieldConsequenceScore: number;
  scoreBand: ScoreBand;
  scoreConfidence: number;
  bestClassification: string;
  oneParagraphVerdict: string;
  finalJudgment: string;
  failureAnalysis: ReviewFailureAnalysis;
};

type AggregateReview = {
  finalComparisonCohort: string;
  finalLocalCohort: string;
  finalBroadField: string;
  finalSpecialtyField: string;
  finalSummary: string;
  finalCentralClaim: string;
  scientificReview: string;
  contributionArchetype: ContributionArchetype;
  inputConstructionOutputLedger: InputConstructionOutputLedger;
  centralOutputDependency: CentralOutputDependency;
  outputValidityAssessment: OutputValidityAssessment;
  nearestComparators: NearestComparator[];
  externalComparatorSuggestions: ExternalComparatorSuggestion[];
  publicComparatorSummary: string;
  adminComparatorNotes: string;
  comparatorProfile: ComparatorProfile;
  comparatorCalibration: ComparatorCalibration;
  blindIntrinsicScoreBand: ScoreBand;
  adjudication: AdjudicationDetails;
  adjudicatorStatus: AdjudicatorStatus;
  individualScores: number[];
  scoreRange: number;
  scoreStability: ScoreStability;
  mainAgreements: string[];
  mainDisagreements: string[];
  fatalObjectionPresent: boolean;
  fatalObjectionAssessment: string;
  fatalToSpecificClaimOnly: boolean;
  paperFatalError: boolean;
  contributionInventory: ContributionInventoryItem[];
  survivingHighValueContributions: string[];
  failedClaimsExcludedFromScore: string[];
  survivingContributionScoreBasis: string;
  inputGroundingAssessment: string;
  inputFundamentalityAssessment: string;
  constructionAssessment: string;
  outputValidity: string;
  contributionGroundingType: string;
  frameworkIndependenceAssessment: string;
  hardToVaryAssessment: string;
  frameworkConditionalityAssessment: string;
  originalContributionAssessment: string;
  survivingContributionIfFlawed: string;
  laterInfluenceOrExternalResultRisk: string;
  correctnessAssessment: string;
  strongestCaseForImportance: string;
  strongestObjection: string;
  decisiveCheck: string;
  assessmentSensitivity: string;
  whatWouldRaiseScore: string;
  whatWouldLowerScore: string;
  establishedResults: string[];
  interpretiveClaims: string[];
  speculativeClaims: string[];
  novelty: string;
  noveltyConfidence: number;
  internalTechnicalTraction: string;
  economy: string;
  explanatoryTargetBreadth: string;
  theorySpaceBreadth: string;
  scopeDepth: string;
  unifyingPower: string;
  inputStrengthScore: number;
  constructionStrengthScore: number;
  outputStrengthScore: number;
  outputReachScore: number;
  generalizationBreadthScore: number;
  subscoreRationale: DiagnosticSubscoreRationale;
  intrinsicTechnicalScore: number;
  explanatoryTargetBreadthScore: number;
  theorySpaceBreadthScore: number;
  breadthOfImpactScore: number;
  subscoreValidity: DiagnosticSubscoreValidity;
  subscoreConsistencyWarning: string;
  subscoreSaturationWarning: boolean;
  scoreCappingReason: string;
  scoreAdjustmentReason: string;
  diagnosticBaselineScore: number;
  diagnosticBaselineDelta: number;
  scoringAnomaly: string;
  specialtyRelativeScore: number;
  broadFieldRelativeScore: number;
  crossFieldConsequenceScore: number;
  finalClassification: string;
  finalScoreBand: ScoreBand;
  finalScoreConfidence: number;
  publicOneParagraphVerdict: string;
  internalCalibrationNotes: string;
};

type MultiPassReviewResult = {
  modelName: string;
  pipelineMode: ReviewPipelineMode;
  systemPrompt: string;
  blindedContent: ReviewInput;
  individualReviews: IndividualReview[];
  aggregate: AggregateReview;
  representativeReview: IndividualReview;
  thinkingText: string | null;
};

type IndividualPassResult = {
  review: IndividualReview;
  thinkingText: string | null;
  index: number;
  modelName: string;
};



export const REVIEW_PROMPT_VERSION = "v16.7-correctly-established-contribution";
const REVIEW_OBJECT_VERSION = "v16.7-canonical";
const LATEX_MARKDOWN_FORMATTING_INSTRUCTION = `Formatting instructions for mathematical notation:
- Wrap every inline mathematical expression in $...$.
- Wrap every display equation in $$...$$.
- Do not leave TeX or equation-like expressions bare in prose. For example, write "$S = A/(4G)$", not "S = A/(4G)".
- Because the answer must be JSON, escape every LaTeX backslash as a double backslash inside strings.`;

function withLatexMarkdownFormatting(prompt: string) {
  return prompt.includes("Wrap every inline mathematical expression in $...$")
    ? prompt
    : `${prompt.trim()}\n\n${LATEX_MARKDOWN_FORMATTING_INSTRUCTION}`;
}



export const REVIEW_SYSTEM_INSTRUCTION = withLatexMarkdownFormatting(BLIND_REVIEW_PASS_V15_PROMPT);
export const REVIEW_FULL_PROMPT_SYSTEM = withLatexMarkdownFormatting(BENCHMARK_CALIBRATED_V15_FULL_PROMPT);
const BLIND_INTRINSIC_ADJUDICATOR_PROMPT = withLatexMarkdownFormatting(BLIND_INTRINSIC_ADJUDICATOR_V15_PROMPT);
const BENCHMARK_COMPARATOR_CALIBRATION_PROMPT = withLatexMarkdownFormatting(BENCHMARK_COMPARATOR_CALIBRATION_V15_PROMPT);

const METADATA_PROMPT = `${DATE_METADATA_EXTRACTION_V15_PROMPT}

Extract the exact manuscript title and paper authors from the scientific paper provided.
You may receive the original PDF plus JSON containing filename hints, embedded PDF metadata, heuristic guesses, and extracted text. Prefer the title and author block printed in the manuscript itself, especially the first page/header. Use embedded PDF metadata or the filename only as fallback hints, because they are often abbreviated, stale, or machine-generated.

Rules:
- Return the full paper title, not the journal name, arXiv id, DOI, running header, abstract sentence, section heading, or filename code.
- If the title spans multiple visual or extracted-text lines, join the lines into one complete title in the correct order.
- Return paper authors only: personal names as written, comma-separated, preserving author order. Omit affiliations, departments, emails, dates, ORCID ids, footnote symbols, and addresses.
- If the author line uses superscripts, bullets, footnotes, or line breaks, strip the markers and preserve all author names.
- Do not invent authors that are not visible in the manuscript. If only some names are visible, return the visible names.
- If title or authors are genuinely not recoverable, use "Unknown Title" or "Unknown Authors".

Return a JSON object with exactly these fields:
- rawExtractedTitle: string
- cleanedTitle: string
- titleConfidence: number
- titleCleaningNotes: string
- displayedTitle: string
- displayedAuthors: string[]
- rawExtractedAuthors: string
- authorsConfidence: number
- authorsExtractionNotes: string
- arxivId: string
- reportCodes: string[]
- doi: string
- journalName: string
- journalPublicationDate: string
- arxivFirstSubmissionDate: string
- manuscriptDatePrintedOnPdf: string
- originalPublicationDateBestGuess: string
- dateSource: string
- dateConfidence: number
- dateNotes: string
Output valid JSON only.`;

const jsonString = { type: "string" };
const jsonNumber = { type: "number" };
const jsonBoolean = { type: "boolean" };
const jsonStringArray = { type: "array", items: jsonString };
const frameworkConditionalityJsonSchema = {
  type: "object",
  properties: {
    level: jsonString,
    explanation: jsonString,
  },
};
const contributionArchetypeJsonSchema = {
  type: "object",
  properties: {
    primary: jsonString,
    secondary: jsonString,
  },
};
const ledgerOutputItemJsonSchema = {
  type: "object",
  required: ["output", "inputsUsed", "constructionsUsed", "externalContextIfAny", "support", "validityLevel", "validity", "centrality", "assessment"],
  properties: {
    output: jsonString,
    inputsUsed: jsonStringArray,
    constructionsUsed: jsonStringArray,
    externalContextIfAny: jsonString,
    support: jsonString,
    validityLevel: jsonString,
    validity: jsonString,
    centrality: jsonString,
    assessment: jsonString,
  },
};
const primitiveInputItemJsonSchema = {
  type: "object",
  required: ["input", "role", "groundingQuality", "grounding", "fundamentalityLevel", "fundamentality", "frameworkDependenceLevel", "frameworkDependence", "assessment"],
  properties: {
    input: jsonString,
    role: jsonString,
    groundingQuality: jsonString,
    grounding: jsonString,
    fundamentalityLevel: jsonString,
    fundamentality: jsonString,
    frameworkDependenceLevel: jsonString,
    frameworkDependence: jsonString,
    assessment: jsonString,
  },
};
const introducedConstructionItemJsonSchema = {
  type: "object",
  required: ["construction", "role", "inputsUsed", "validityLevel", "validity", "hardToVaryLevel", "hardToVary", "fragilityLevel", "fragilityOrLimits", "assessment"],
  properties: {
    construction: jsonString,
    role: jsonString,
    inputsUsed: jsonStringArray,
    validityLevel: jsonString,
    validity: jsonString,
    hardToVaryLevel: jsonString,
    hardToVary: jsonString,
    fragilityLevel: jsonString,
    fragilityOrLimits: jsonString,
    assessment: jsonString,
  },
};
const inputConstructionOutputAssessmentJsonSchema = {
  type: "object",
  required: ["input", "construction", "output"],
  properties: {
    input: {
      type: "object",
      required: ["overallAssessment", "primitiveInputs"],
      properties: {
        overallAssessment: jsonString,
        assessment: jsonString,
        primitiveInputs: { type: "array", items: primitiveInputItemJsonSchema },
      },
    },
    construction: {
      type: "object",
      required: ["overallAssessment", "introducedConstructions"],
      properties: {
        overallAssessment: jsonString,
        assessment: jsonString,
        introducedConstructions: { type: "array", items: introducedConstructionItemJsonSchema },
      },
    },
    output: {
      type: "object",
      required: ["overallAssessment", "whyOutputsMatter", "outputs"],
      properties: {
        overallAssessment: jsonString,
        assessment: jsonString,
        whyOutputsMatter: jsonString,
        outputs: { type: "array", items: ledgerOutputItemJsonSchema },
      },
    },
  },
};
const comparatorProfileJsonSchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    localCohort: jsonString,
    primaryCohort: jsonString,
    adjacentBroadCohort: jsonString,
    clusterFeatureTags: jsonStringArray,
    comparatorSearchSummary: jsonString,
  },
};
const individualReviewJsonSchema = {
  type: "object",
  required: [
    "centralClaim",
    "scientificReview",
    "intrinsicScore",
    "bestClassification",
    "inputConstructionOutputAssessment",
    "technicalAssessment",
    "failureAnalysis",
    "assessmentSensitivity",
    "inputStrengthScore",
    "constructionStrengthScore",
    "outputStrengthScore",
  ],
  additionalProperties: true,
  properties: {
    title: jsonString,
    authorName: jsonString,
    comparisonCohort: jsonString,
    localCohort: jsonString,
    broadField: jsonString,
    specialtyField: jsonString,
    subfields: jsonStringArray,
    paperType: jsonString,
    centralClaim: jsonString,
    scientificReview: jsonString,
    contributionArchetype: contributionArchetypeJsonSchema,
    inputConstructionOutputAssessment: inputConstructionOutputAssessmentJsonSchema,
    organicCohortProfile: comparatorProfileJsonSchema,
    technicalAssessment: {
      type: "object",
      additionalProperties: true,
      properties: {
        correctness: jsonString,
        frameworkDependence: {
          type: "object",
          additionalProperties: true,
          properties: {
            level: jsonString,
            explanation: jsonString,
            scoreImpact: jsonString,
          },
        },
        hardToVaryAssessment: jsonString,
        strongestCaseForImportance: jsonString,
        strongestObjection: jsonString,
        assessmentSensitivity: jsonString,
        whatWouldRaiseScore: jsonString,
        whatWouldLowerScore: jsonString,
      },
    },
    failureAnalysis: {
      type: "object",
      additionalProperties: true,
      properties: {
        failureMode: jsonString,
        fatalObjectionPresent: jsonBoolean,
        paperFatalError: jsonBoolean,
        fatalToSpecificClaimOnly: jsonBoolean,
        survivingHighValueContributions: jsonStringArray,
        failedClaimsExcludedFromScore: jsonStringArray,
        survivingContributionScoreBasis: jsonString,
      },
    },
    assessmentSensitivity: jsonString,
    whatWouldRaiseScore: jsonString,
    whatWouldLowerScore: jsonString,
    inputStrengthScore: jsonNumber,
    constructionStrengthScore: jsonNumber,
    outputStrengthScore: jsonNumber,
    intrinsicScore: jsonNumber,
    subscoreRationale: {
      type: "object",
      additionalProperties: true,
      properties: {
        inputStrengthScore: jsonString,
        constructionStrengthScore: jsonString,
        outputStrengthScore: jsonString,
      },
    },
    scoreConfidence: jsonNumber,
    scoreCappingReason: jsonString,
    scoreAdjustmentReason: jsonString,
    bestClassification: jsonString,
  },
};
const metadataJsonSchema = {
  type: "object",
  required: [
    "rawExtractedTitle",
    "cleanedTitle",
    "titleConfidence",
    "titleCleaningNotes",
    "displayedTitle",
    "displayedAuthors",
    "rawExtractedAuthors",
    "authorsConfidence",
    "authorsExtractionNotes",
    "arxivId",
    "reportCodes",
    "doi",
    "journalName",
    "journalPublicationDate",
    "arxivFirstSubmissionDate",
    "manuscriptDatePrintedOnPdf",
    "originalPublicationDateBestGuess",
    "dateSource",
    "dateConfidence",
    "dateNotes",
  ],
  properties: {
    rawExtractedTitle: jsonString,
    cleanedTitle: jsonString,
    titleConfidence: jsonNumber,
    titleCleaningNotes: jsonString,
    displayedTitle: jsonString,
    displayedAuthors: jsonStringArray,
    rawExtractedAuthors: jsonString,
    authorsConfidence: jsonNumber,
    authorsExtractionNotes: jsonString,
    arxivId: jsonString,
    reportCodes: jsonStringArray,
    doi: jsonString,
    journalName: jsonString,
    journalPublicationDate: jsonString,
    arxivFirstSubmissionDate: jsonString,
    manuscriptDatePrintedOnPdf: jsonString,
    originalPublicationDateBestGuess: jsonString,
    dateSource: jsonString,
    dateConfidence: jsonNumber,
    dateNotes: jsonString,
  },
};

function positiveIntEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

const MODEL_CALL_ATTEMPTS = positiveIntEnv("SCIREVIEW_MODEL_CALL_ATTEMPTS", 2);
const PASS_GENERATION_ATTEMPTS = positiveIntEnv("SCIREVIEW_PASS_GENERATION_ATTEMPTS", 1);
const REPLACEMENT_PASS_ATTEMPTS = positiveIntEnv("SCIREVIEW_REPLACEMENT_PASS_ATTEMPTS", 1);
const ADJUDICATOR_GENERATION_ATTEMPTS = positiveIntEnv("SCIREVIEW_ADJUDICATOR_GENERATION_ATTEMPTS", 2);

export function reviewRuntimeInfo() {
  return {
    promptVersion: REVIEW_PROMPT_VERSION,
    defaultReviewMode: DEFAULT_REVIEW_PIPELINE_MODE,
    benchmarkSetVersion: BENCHMARK_SET_VERSION,
    pipelineLabel: reviewPipelineLabel(),
    models: {
      metadata: GEMINI_METADATA_MODEL,
      reviewPass: GEMINI_PASS_MODEL,
      adjudicator: GEMINI_META_MODEL,
      calibration: GEMINI_CALIBRATION_MODEL,
    },
    retryPolicy: {
      modelCallAttempts: MODEL_CALL_ATTEMPTS,
      passGenerationAttempts: PASS_GENERATION_ATTEMPTS,
      replacementPassAttempts: REPLACEMENT_PASS_ATTEMPTS,
      adjudicatorGenerationAttempts: ADJUDICATOR_GENERATION_ATTEMPTS,
      saveFallbackWhenAtLeastOnePassSucceeds: true,
    },
    quotaHandling: {
      dailyModelQuota: "fail-fast",
      stopsBatchQueue: true,
    },
    build: {
      railwayGitCommitSha: process.env.RAILWAY_GIT_COMMIT_SHA || null,
    },
  };
}

function stripControlChars(text: string) {
  return text.replace(/\x00/g, "").replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  try {
    const parsed = JSON.parse(raw);
    const apiError = parsed?.error;
    if (apiError) {
      return [
        apiError.code ? `code ${apiError.code}` : "",
        apiError.status,
        apiError.message,
      ].filter(Boolean).join(": ");
    }
  } catch {}
  return raw;
}

function errorDetailsForLog(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: (error as Error & { cause?: unknown }).cause,
      raw: Object.getOwnPropertyNames(error).reduce<Record<string, unknown>>((details, key) => {
        details[key] = (error as unknown as Record<string, unknown>)[key];
        return details;
      }, {}),
    };
  }
  if (error && typeof error === "object") return error;
  return { message: String(error) };
}

function isTransientModelError(error: unknown) {
  if (isDailyModelQuotaError(error)) return false;
  const message = errorMessage(error).toLowerCase();
  return (
    /\b(429|500|502|503|504)\b/.test(message) ||
    /resource[_ ]exhausted|unavailable|overloaded|rate limit|quota|temporar|deadline|internal/.test(message)
  );
}

function isDailyModelQuotaError(error: unknown) {
  const message = errorMessage(error).toLowerCase();
  return (
    /resource[_ ]exhausted|quota|rate limit/.test(message) &&
    /generate_requests_per_model_per_day|per_model_per_day|please retry in|exceeded your current quota/.test(message)
  );
}

function dailyQuotaErrorMessage(error: unknown) {
  const message = errorMessage(error);
  const retryMatch = message.match(/please retry in\s*([^.;]+)/i);
  const retryText = retryMatch?.[1]?.trim();
  const retrySuffix = retryText ? ` Google says to retry in ${retryText}.` : "";
  return `Gemini Pro daily request quota reached.${retrySuffix} No more papers were processed because every additional Pro request would fail until the quota resets or is raised.`;
}

function isSchemaRejectedError(error: unknown) {
  return /response[_ ]?(json[_ ]?)?schema|schema.*unsupported|unsupported.*schema|invalid.*schema|unknown name.*schema|invalid_argument/i.test(errorMessage(error));
}

function retryDelayMs(attempt: number, error: unknown) {
  const transientDelays = [3000, 12000, 30000, 60000];
  const normalDelays = [1200, 4800, 12000, 24000];
  const delays = isTransientModelError(error) ? transientDelays : normalDelays;
  return (delays[attempt - 1] ?? 12000) + Math.floor(Math.random() * 750);
}

function passAttemptDelayMs(attempt: number, error: unknown) {
  if (isTransientModelError(error)) {
    const transientDelays = [10000, 20000];
    return (transientDelays[attempt] ?? 120000) + Math.floor(Math.random() * 1000);
  }
  return 1500 + Math.floor(Math.random() * 600);
}

async function withModelRetries<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MODEL_CALL_ATTEMPTS; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (isDailyModelQuotaError(error)) {
        throw new Error(dailyQuotaErrorMessage(error));
      }
      if (attempt === MODEL_CALL_ATTEMPTS) break;
      await sleep(retryDelayMs(attempt, error));
    }
  }
  const prefix = isTransientModelError(lastError) ? "Transient model error: " : "";
  throw new Error(`${prefix}${label} failed after ${MODEL_CALL_ATTEMPTS} attempts: ${errorMessage(lastError)}`);
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function firstString(values: unknown[], fallback = "") {
  for (const value of values) {
    const text = asString(value);
    if (text) return text;
  }
  return fallback;
}

function mergeDistinctText(values: unknown[]) {
  const chunks: string[] = [];
  for (const value of values) {
    const text = asString(value);
    if (!text) continue;
    const normalized = text.replace(/\s+/g, " ").toLowerCase();
    const duplicate = chunks.some((chunk) => {
      const existing = chunk.replace(/\s+/g, " ").toLowerCase();
      return existing.includes(normalized) || normalized.includes(existing);
    });
    if (!duplicate) chunks.push(text);
  }
  return chunks.join(" ");
}

function asNumber(value: unknown, fallback = 0, min?: number, max?: number) {
  const raw = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  const safe = Number.isFinite(raw) ? raw : fallback;
  const minSafe = min != null ? Math.max(min, safe) : safe;
  return max != null ? Math.min(max, minSafe) : minSafe;
}

function asOptionalNumber(value: unknown, min?: number, max?: number) {
  const raw = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(raw)) return null;
  const minSafe = min != null ? Math.max(min, raw) : raw;
  return max != null ? Math.min(max, minSafe) : minSafe;
}

function normalizeDiagnosticSubscore(value: unknown, fallback?: number) {
  const explicit = asOptionalNumber(value, 0, 10);
  if (explicit != null) return Math.round(explicit);
  return Math.round(Math.max(0, Math.min(10, fallback ?? 0)));
}

function firstNumberField(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = asOptionalNumber(source[key], 0, 10);
    if (value != null) return value;
  }
  return null;
}

function normalizeSubscoreRationale(value: unknown): DiagnosticSubscoreRationale {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    inputStrengthScore: firstString([source.inputStrengthScore]),
    constructionStrengthScore: firstString([source.constructionStrengthScore]),
    outputStrengthScore: firstString([source.outputStrengthScore]),
  };
}

function diagnosticSubscoreValidity(source: Record<string, unknown>): DiagnosticSubscoreValidity {
  return {
    inputStrengthScore: firstNumberField(source, ["inputStrengthScore"]) != null,
    constructionStrengthScore: firstNumberField(source, ["constructionStrengthScore"]) != null,
    outputStrengthScore: firstNumberField(source, ["outputStrengthScore"]) != null,
  };
}

function allDiagnosticSubscoresValid(validity: DiagnosticSubscoreValidity) {
  return Object.values(validity).every(Boolean);
}

function diagnosticSubscoreValues(source: Pick<
  IndividualReview | AggregateReview,
  "inputStrengthScore" | "constructionStrengthScore" | "outputStrengthScore"
>) {
  return [
    source.inputStrengthScore,
    source.constructionStrengthScore,
    source.outputStrengthScore,
  ];
}

function computeSubscoreSaturationWarning(
  scores: number[],
  validity: DiagnosticSubscoreValidity,
) {
  return allDiagnosticSubscoresValid(validity) && scores.every((score) => score === 10);
}

function diagnosticBaselineScore(scores: number[]) {
  if (scores.length === 0) return 0;
  const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  return Math.round(Math.max(0, Math.min(100, average * 10)));
}

function hasExplicitScoreAdjustmentReason(text: string) {
  if (!text.trim()) return false;
  if (/\b(later influence|field influence|opened a field|opened the field|historically influential|citation|famous|later work|subsequent work|became important)\b/i.test(text)) {
    return false;
  }
  return text.trim().length >= 40;
}

function ledgerValidityTextIndicatesInvalid(text: string) {
  const value = text.toLowerCase();
  if (!value.trim()) return false;
  if (/\b(not|no|without|does not|doesn't|isn't|not clearly)\b.{0,24}\b(invalid|false|wrong|fails|contradicted|ruled out|unviable)\b/.test(value)) {
    return false;
  }
  return /\b(invalid|false|wrong|fails|failed|unsupported|contradicted|ruled out|unviable|not viable|does not follow|doesn't follow)\b/.test(value);
}

function hasInvalidHighCentralityOutput(outputs: LedgerOutputItem[]) {
  return outputs.some((output) =>
    output.centrality === "high" &&
    ledgerValidityTextIndicatesInvalid(`${output.validity}\n${output.support}`),
  );
}

function computeSubscoreConsistencyWarning(options: {
  finalMedian: number;
  scores: number[];
  validity: DiagnosticSubscoreValidity;
  scoreCappingReason?: string;
  scoreAdjustmentReason?: string;
  ledgerOutputs?: LedgerOutputItem[];
}) {
  if (!allDiagnosticSubscoresValid(options.validity)) {
    return "One or more diagnostic subscores were missing or invalid; display N/A and inspect/rerun if needed.";
  }

  const adjustmentText = firstString([
    options.scoreCappingReason,
    options.scoreAdjustmentReason,
  ]);
  const hasCap = hasExplicitScoreAdjustmentReason(adjustmentText);
  const baseline = diagnosticBaselineScore(options.scores);
  const delta = Math.round(options.finalMedian - baseline);

  if (Math.abs(delta) > 8 && !hasCap) {
    return `Final score ${options.finalMedian} differs from diagnostic baseline ${baseline} by ${delta > 0 ? "+" : ""}${delta} without an explicit scoreCappingReason or scoreAdjustmentReason.`;
  }

  if (
    options.ledgerOutputs &&
    hasInvalidHighCentralityOutput(options.ledgerOutputs) &&
    options.scores[2] > 7
  ) {
    return "A high-centrality output is marked invalid or unsupported, but outputStrengthScore is above 7.";
  }

  if (
    options.scores[1] <= 6 &&
    options.scores[2] <= 7 &&
    options.finalMedian > 75 &&
    !hasCap
  ) {
    return "constructionStrengthScore <= 6 and outputStrengthScore <= 7 normally cap the final score at 75 unless a surviving-contribution rationale justifies the higher score.";
  }

  const allHigh = options.scores.every((score) => score >= 9);
  if (options.finalMedian <= 85 && allHigh && !hasCap) {
    return "Final score is 85 or below while all diagnostic subscores are 9 or 10; scoreCappingReason is required.";
  }

  if (options.finalMedian >= 90 && options.scores.some((score) => score <= 6) && !hasCap) {
    return "Final score is 90 or above while a diagnostic subscore is 6 or below; scoreCappingReason should explain the tension.";
  }

  return "";
}

function asBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => asString(item)).filter(Boolean);
}

function firstStringArray(values: unknown[]) {
  for (const value of values) {
    const items = asStringArray(value);
    if (items.length > 0) return items;
  }
  return [];
}

function itemText(value: unknown, keys: string[]) {
  if (typeof value === "string") return value.trim();
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return firstString(keys.map((key) => source[key]));
}

function primitiveInputLabels(items: PrimitiveInputItem[] | string[] | null | undefined) {
  return (items ?? []).map((item) => itemText(item, ["input", "name", "description", "role"])).filter(Boolean);
}

function introducedConstructionLabels(items: IntroducedConstructionItem[] | string[] | null | undefined) {
  return (items ?? []).map((item) => itemText(item, ["construction", "name", "description", "role"])).filter(Boolean);
}

function normalizeQualityLevel(value: unknown): PrimitiveInputItem["groundingQuality"] {
  const candidate = asString(value).toLowerCase().trim();
  if (candidate === "weak" || candidate === "moderate" || candidate === "strong") return candidate;
  return "";
}

function normalizeOptionalFrameworkLevel(value: unknown): FrameworkLevel | "" {
  const candidate = asString(value).toLowerCase().trim();
  if (candidate === "low" || candidate === "medium" || candidate === "high") return candidate;
  return "";
}

function normalizeValidityLevel(value: unknown): LedgerOutputItem["validityLevel"] {
  const candidate = asString(value).toLowerCase().trim();
  if (candidate === "invalid" || candidate === "conditional" || candidate === "valid" || candidate === "strong") return candidate;
  return "";
}

function normalizePrimitiveInputs(values: unknown[], fallback: PrimitiveInputItem[] = []): PrimitiveInputItem[] {
  for (const value of values) {
    if (!Array.isArray(value)) continue;
    const items = value
      .map((item) => {
        if (typeof item === "string") {
          const input = item.trim();
          if (!input) return null;
          return {
            input,
            role: "",
            groundingQuality: "",
            grounding: "",
            fundamentalityLevel: "",
            fundamentality: "",
            frameworkDependenceLevel: "",
            frameworkDependence: "",
            assessment: "",
          } satisfies PrimitiveInputItem;
        }
        const source = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
        const input = firstString([source.input, source.name, source.description, source.primitiveInput]);
        if (!input) return null;
        return {
          input,
          role: firstString([source.role, source.function, source.use]),
          groundingQuality: normalizeQualityLevel(source.groundingQuality),
          grounding: firstString([source.grounding, source.inputGrounding]),
          fundamentalityLevel: normalizeOptionalFrameworkLevel(source.fundamentalityLevel),
          fundamentality: firstString([source.fundamentality, source.inputFundamentality]),
          frameworkDependenceLevel: normalizeOptionalFrameworkLevel(source.frameworkDependenceLevel),
          frameworkDependence: firstString([source.frameworkDependence, source.frameworkConditionality]),
          assessment: firstString([source.assessment, source.notes]),
        } satisfies PrimitiveInputItem;
      })
      .filter(Boolean) as PrimitiveInputItem[];
    if (items.length > 0) return items;
  }
  return fallback;
}

function normalizeIntroducedConstructions(values: unknown[], fallback: IntroducedConstructionItem[] = []): IntroducedConstructionItem[] {
  for (const value of values) {
    if (!Array.isArray(value)) continue;
    const items = value
      .map((item) => {
        if (typeof item === "string") {
          const construction = item.trim();
          if (!construction) return null;
          return {
            construction,
            role: "",
            inputsUsed: [],
            validityLevel: "",
            validity: "",
            hardToVaryLevel: "",
            hardToVary: "",
            fragilityLevel: "",
            fragilityOrLimits: "",
            assessment: "",
          } satisfies IntroducedConstructionItem;
        }
        const source = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
        const construction = firstString([source.construction, source.name, source.description, source.introducedConstruction]);
        if (!construction) return null;
        return {
          construction,
          role: firstString([source.role, source.function, source.use]),
          inputsUsed: firstStringArray([source.inputsUsed, source.dependsOnInputs, source.requiredPrimitiveInputs]),
          validityLevel: normalizeValidityLevel(source.validityLevel),
          validity: firstString([source.validity, source.correctness]),
          hardToVaryLevel: normalizeOptionalFrameworkLevel(source.hardToVaryLevel),
          hardToVary: firstString([source.hardToVary, source.hardToVaryCharacter, source.hard_to_vary]),
          fragilityLevel: normalizeOptionalFrameworkLevel(source.fragilityLevel),
          fragilityOrLimits: firstString([source.fragilityOrLimits, source.fragility, source.limits]),
          assessment: firstString([source.assessment, source.notes]),
        } satisfies IntroducedConstructionItem;
      })
      .filter(Boolean) as IntroducedConstructionItem[];
    if (items.length > 0) return items;
  }
  return fallback;
}

function normalizeContributionArchetype(value: unknown, fallback?: ContributionArchetype): ContributionArchetype {
  if (typeof value === "string") {
    return {
      primary: value.trim() || fallback?.primary || "",
      secondary: fallback?.secondary ?? "",
    };
  }
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    primary: firstString([source.primary, source.main, source.type, source.contributionArchetype], fallback?.primary ?? ""),
    secondary: firstString([source.secondary, source.secondaryType], fallback?.secondary ?? ""),
  };
}

function normalizeCentralOutputDependency(value: unknown, fallback?: CentralOutputDependency): CentralOutputDependency {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const requiredPrimitiveInputs = firstStringArray([
    source.requiredPrimitiveInputs,
    source.dependsOnPrimitiveInputs,
    source.primitiveInputDependencies,
    source.primitiveInputs,
    fallback?.requiredPrimitiveInputs,
    fallback?.dependsOnPrimitiveInputs,
  ]);
  const requiredIntroducedConstructions = firstStringArray([
    source.requiredIntroducedConstructions,
    source.dependsOnIntroducedConstructions,
    source.introducedConstructionDependencies,
    source.introducedConstructions,
    fallback?.requiredIntroducedConstructions,
    fallback?.dependsOnIntroducedConstructions,
  ]);
  const dependencyAssessment = firstString([
    source.dependencyAssessment,
    source.assessment,
    source.centralOutputDependencyAssessment,
  ], fallback?.dependencyAssessment || fallback?.assessment || "");
  const constructionFragility = firstString([
    source.constructionFragility,
    source.weakestDependency,
    source.weakestLink,
    source.fragileDependency,
  ], fallback?.constructionFragility || fallback?.weakestDependency || "");
  return {
    centralOutput: firstString([source.centralOutput, source.output, source.mainOutput], fallback?.centralOutput ?? ""),
    requiredPrimitiveInputs,
    requiredIntroducedConstructions,
    dependencyAssessment,
    constructionFragility,
    outputValidity: firstString([
      source.outputValidity,
      source.outputValidityAssessment,
      source.outputValiditySummary,
    ], fallback?.outputValidity ?? ""),
    dependsOnPrimitiveInputs: requiredPrimitiveInputs,
    dependsOnIntroducedConstructions: requiredIntroducedConstructions,
    weakestDependency: constructionFragility,
    assessment: dependencyAssessment,
  };
}

function normalizeOutputValidityAssessment(value: unknown, fallback?: OutputValidityAssessment): OutputValidityAssessment {
  if (typeof value === "string") {
    return {
      knownResultRecoveries: fallback?.knownResultRecoveries ?? [],
      novelPredictionsOrConstraints: fallback?.novelPredictionsOrConstraints ?? [],
      failedOutputsOrConstraints: fallback?.failedOutputsOrConstraints ?? [],
      assessment: value.trim() || fallback?.assessment || "",
    };
  }
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    knownResultRecoveries: firstStringArray([
      source.knownResultRecoveries,
      source.recoveries,
      source.knownRecoveries,
      fallback?.knownResultRecoveries,
    ]),
    novelPredictionsOrConstraints: firstStringArray([
      source.novelPredictionsOrConstraints,
      source.predictions,
      source.constraints,
      source.newPredictionsOrConstraints,
      fallback?.novelPredictionsOrConstraints,
    ]),
    failedOutputsOrConstraints: firstStringArray([
      source.failedOutputsOrConstraints,
      source.failedOutputs,
      source.conflicts,
      source.failedConstraints,
      fallback?.failedOutputsOrConstraints,
    ]),
    assessment: firstString([source.assessment, source.validityAssessment, source.outputValidityAssessment], fallback?.assessment ?? ""),
  };
}

function normalizeLedgerOutputCentrality(value: unknown): LedgerOutputItem["centrality"] {
  const candidate = asString(value).toLowerCase();
  if (candidate === "low" || candidate === "medium" || candidate === "high") return candidate;
  return "medium";
}

function synthesizeOutputAssessment(source: Record<string, unknown>, support: string, validity: string) {
  const explicitAssessment = firstString([source.assessment, source.outputAssessment, source.analysis, source.notes]);
  if (explicitAssessment) return explicitAssessment;
  return mergeDistinctText([validity, support]);
}

function normalizeLedgerOutputs(
  value: unknown,
  options: {
    legacyDirectOutputs?: unknown;
    legacyExternalContext?: unknown;
    centralOutputDependency?: CentralOutputDependency;
    outputValidityAssessment?: OutputValidityAssessment;
  } = {},
): LedgerOutputItem[] {
  if (Array.isArray(value)) {
    const outputs = value
      .map((item) => {
        if (typeof item === "string") {
          const output = item.trim();
          if (!output) return null;
          return {
            output,
            dependsOnInputs: [],
            dependsOnConstructions: [],
            inputsUsed: [],
            constructionsUsed: [],
            externalContextIfAny: "",
            support: "",
            validityLevel: "",
            validity: "",
            centrality: "medium",
            assessment: "",
          } satisfies LedgerOutputItem;
        }
        const source = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
        const output = firstString([source.output, source.directOutput, source.result, source.claim, source.description]);
        if (!output) return null;
        const inputsUsed = firstStringArray([source.inputsUsed, source.dependsOnInputs, source.requiredPrimitiveInputs, source.primitiveInputs]);
        const constructionsUsed = firstStringArray([source.constructionsUsed, source.dependsOnConstructions, source.requiredIntroducedConstructions, source.introducedConstructions]);
        const support = firstString([source.support, source.evidence, source.derivationSupport]);
        const validity = firstString([source.validity, source.outputValidity, source.validityAssessment]);
        return {
          output,
          dependsOnInputs: inputsUsed,
          dependsOnConstructions: constructionsUsed,
          inputsUsed,
          constructionsUsed,
          externalContextIfAny: firstString([source.externalContextIfAny, source.externalContext, source.context]),
          support,
          validityLevel: normalizeValidityLevel(source.validityLevel),
          validity,
          centrality: normalizeLedgerOutputCentrality(source.centrality),
          assessment: synthesizeOutputAssessment(source, support, validity),
        } satisfies LedgerOutputItem;
      })
      .filter(Boolean) as LedgerOutputItem[];
    if (outputs.length > 0) return outputs;
  }

  const legacyOutputs = firstStringArray([options.legacyDirectOutputs]);
  const legacyContexts = firstStringArray([options.legacyExternalContext]);
  if (legacyOutputs.length > 0) {
    return legacyOutputs.map((output, index) => ({
      output,
      dependsOnInputs: [],
      dependsOnConstructions: [],
      inputsUsed: [],
      constructionsUsed: [],
      externalContextIfAny: legacyContexts[index] ?? "",
      support: "",
      validityLevel: "",
      validity: "",
      centrality: "medium",
      assessment: "",
    }));
  }

  const centralOutput = options.centralOutputDependency?.centralOutput;
  if (centralOutput) {
    return [{
      output: centralOutput,
      dependsOnInputs: options.centralOutputDependency?.dependsOnPrimitiveInputs ?? [],
      dependsOnConstructions: options.centralOutputDependency?.dependsOnIntroducedConstructions ?? [],
      inputsUsed: options.centralOutputDependency?.dependsOnPrimitiveInputs ?? [],
      constructionsUsed: options.centralOutputDependency?.dependsOnIntroducedConstructions ?? [],
      externalContextIfAny: "",
      support: options.centralOutputDependency?.dependencyAssessment ?? "",
      validityLevel: "",
      validity: options.centralOutputDependency?.outputValidity || options.outputValidityAssessment?.assessment || "",
      centrality: "high",
      assessment: mergeDistinctText([
        options.centralOutputDependency?.outputValidity,
        options.centralOutputDependency?.dependencyAssessment,
        options.outputValidityAssessment?.assessment,
      ]),
    }];
  }

  return [];
}

function normalizeComparatorRelationship(value: unknown): NearestComparator["relationship"] {
  const candidate = asString(value).toLowerCase().replace(/[\s-]+/g, "_");
  if (
    candidate === "similar" ||
    candidate === "stronger" ||
    candidate === "weaker" ||
    candidate === "direct" ||
    candidate === "upstream" ||
    candidate === "downstream" ||
    candidate === "adjacent" ||
    candidate === "lower_or_limited" ||
    candidate === "external_suggestion"
  ) {
    return candidate;
  }
  return "adjacent";
}

function normalizeRelativeAssessment(value: unknown): NearestComparator["relativeAssessment"] {
  const candidate = asString(value).toLowerCase().replace(/\s+/g, "_");
  if (candidate === "current_paper_stronger") return "stronger";
  if (candidate === "current_paper_weaker") return "weaker";
  if (candidate === "target_stronger") return "stronger";
  if (candidate === "target_weaker") return "weaker";
  if (candidate === "similar_quality") return "similar";
  if (candidate === "stronger" || candidate === "weaker" || candidate === "similar" || candidate === "unclear") {
    return candidate;
  }
  return "unclear";
}

function normalizeRelativeScoreJudgment(value: unknown): NearestComparator["relativeScoreJudgment"] {
  const candidate = asString(value).toLowerCase();
  if (
    candidate === "current_paper_stronger" ||
    candidate === "current_paper_weaker" ||
    candidate === "similar_quality" ||
    candidate === "unclear"
  ) {
    return candidate;
  }
  return undefined;
}

function normalizeContributionInventory(value: unknown): ContributionInventoryItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const source = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const claimOrContribution = firstString([source.claimOrContribution, source.claim, source.contribution, source.description]);
      if (!claimOrContribution) return null;
      const rawStatus = asString(source.status).toLowerCase().replace(/[\s-]+/g, "_");
      const status: ContributionInventoryItem["status"] =
        rawStatus === "correct" ||
        rawStatus === "likely_correct" ||
        rawStatus === "uncertain" ||
        rawStatus === "flawed" ||
        rawStatus === "false"
          ? rawStatus
          : "uncertain";
      const rawWeight = asString(source.contributionWeight ?? source.weight).toLowerCase().replace(/[\s-]+/g, "_");
      const contributionWeight: ContributionInventoryItem["contributionWeight"] =
        rawWeight === "low" ||
        rawWeight === "medium" ||
        rawWeight === "high" ||
        rawWeight === "field_shaping"
          ? rawWeight
          : "medium";
      const rawSeparability = asString(source.separability).toLowerCase();
      const separability: ContributionInventoryItem["separability"] =
        rawSeparability === "inseparable" ||
        rawSeparability === "separable" ||
        rawSeparability === "independent"
          ? rawSeparability
          : "separable";
      const rawSurvival = asString(source.survivalStatus ?? source.survival).toLowerCase().replace(/[\s-]+/g, "_");
      const survivalStatus: ContributionInventoryItem["survivalStatus"] =
        rawSurvival === "survives" ||
        rawSurvival === "partially_survives" ||
        rawSurvival === "fails"
          ? rawSurvival
          : "partially_survives";
      return {
        claimOrContribution,
        status,
        contributionWeight,
        separability,
        survivalStatus,
        notes: firstString([source.notes, source.explanation, source.rationale]),
      } satisfies ContributionInventoryItem;
    })
    .filter(Boolean) as ContributionInventoryItem[];
}

function survivingInventoryContributions(inventory: ContributionInventoryItem[]) {
  return inventory.filter((item) =>
    (item.contributionWeight === "high" || item.contributionWeight === "field_shaping") &&
    (item.separability === "separable" || item.separability === "independent") &&
    (item.survivalStatus === "survives" || item.survivalStatus === "partially_survives") &&
    (item.status === "correct" || item.status === "likely_correct" || item.status === "uncertain"),
  );
}

function scoreCappingFatalLanguage(text: string) {
  return /\b(fatal central objection|fatal[- ]error|paper[- ]fatal|no substantial separable contribution|no substantial contribution surviving|no separable contribution surviving|no high[- ]value contribution survives)\b/i.test(text);
}

function saysObjectionNotPaperFatal(text: string) {
  return /\b(not fatal|not paper[- ]fatal|not fatal to the paper|not fatal to the manuscript|does not destroy|survives|surviving|separable contribution|independent contribution)\b/i.test(text);
}

function normalizeNearestComparators(value: unknown, fallback: NearestComparator[] = []): NearestComparator[] {
  if (!Array.isArray(value)) return fallback;
  const comparators = value
    .map((item) => {
      const source = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const paperTitle = firstString([source.paperTitle, source.displayTitle, source.title, source.name]);
      const comparatorId = firstString([source.comparatorId, source.paperId, source.id]);
      if (!paperTitle && !comparatorId) return null;
      const relativeScoreJudgment = normalizeRelativeScoreJudgment(source.relativeScoreJudgment ?? source.relativeAssessment ?? source.relativePosition);
      return {
        comparatorId: comparatorId || undefined,
        paperTitle: paperTitle || comparatorId,
        relationship: normalizeComparatorRelationship(source.relationship),
        whyComparable: firstString([source.whyComparable, source.why_comparable, source.reason]),
        keyDifference: firstString([source.keyDifference, source.key_difference, source.difference]),
        relativeAssessment: normalizeRelativeAssessment(relativeScoreJudgment ?? source.relativeAssessment ?? source.relativePosition),
        relativeScoreJudgment,
        scoreGapJustification: firstString([source.scoreGapJustification, source.score_gap_justification]),
        sitePaperId: firstString([source.sitePaperId, source.paperId]) || undefined,
      } satisfies NearestComparator;
    })
    .filter(Boolean) as NearestComparator[];
  return comparators.length > 0 ? comparators : fallback;
}

function normalizeComparatorProfile(value: unknown, fallbackReview: IndividualReview): ComparatorProfile {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const scoreBand = normalizeScoreBand(source.scoreBand);
  const localCohort = firstString([source.localCohort, source.primaryCohort, source.comparisonCohort], fallbackReview.localCohort || fallbackReview.comparisonCohort);
  return {
    localCohort,
    primaryCohort: firstString([source.primaryCohort, source.comparisonCohort, source.localCohort], localCohort),
    adjacentBroadCohort: firstString([source.adjacentBroadCohort, source.broadField], fallbackReview.broadField),
    contributionArchetype: normalizeContributionArchetype(source.contributionArchetype, fallbackReview.contributionArchetype),
    primitiveInputs: firstStringArray([source.primitiveInputs, primitiveInputLabels(fallbackReview.inputConstructionOutputLedger.primitiveInputs)]),
    introducedConstructions: firstStringArray([source.introducedConstructions, introducedConstructionLabels(fallbackReview.inputConstructionOutputLedger.introducedConstructions)]),
    outputs: firstStringArray([
      source.outputs,
      fallbackReview.inputConstructionOutputLedger.outputs.map((item) => item.output),
      fallbackReview.inputConstructionOutputLedger.directOutputs,
    ]),
    externalEmbeddingsAndChecks: firstStringArray([source.externalEmbeddingsAndChecks, fallbackReview.inputConstructionOutputLedger.externalEmbeddingsAndChecks]),
    centralOutputDependency: normalizeCentralOutputDependency(source.centralOutputDependency, fallbackReview.centralOutputDependency),
    outputValidityAssessment: normalizeOutputValidityAssessment(source.outputValidityAssessment, fallbackReview.outputValidityAssessment),
    directOutputs: firstStringArray([source.directOutputs, fallbackReview.inputConstructionOutputLedger.directOutputs]),
    downstreamReach: asString(source.downstreamReach, fallbackReview.inputConstructionOutputLedger.downstreamReach),
    frameworkConditionality: normalizeFrameworkLevel(source.frameworkConditionality ?? fallbackReview.frameworkConditionality.level),
    scoreBand: scoreBand.median > 0 ? scoreBand : fallbackReview.scoreBand,
    classification: normalizeClassification(source.classification) || fallbackReview.bestClassification,
    clusterFeatureTags: firstStringArray([source.clusterFeatureTags, source.featureTags, fallbackReview.subfields]),
    comparatorSearchSummary: asString(source.comparatorSearchSummary, fallbackReview.summary),
  };
}

function defaultComparatorCalibration(
  intrinsicBand: ScoreBand,
  classification: string,
  rationale: string,
  status: ComparatorCalibrationStatus = "unavailable",
): ComparatorCalibration {
  return {
    comparatorCalibrationStatus: status,
    benchmarkSetVersion: BENCHMARK_SET_VERSION,
    intrinsicScoreBand: intrinsicBand,
    calibrationAdjustment: 0,
    finalPublicScoreBand: intrinsicBand,
    finalClassification: classification,
    calibrationRationale: rationale,
    scoreGapAssessment: "No comparator calibration adjustment was applied.",
    scoreCappingReason: "",
    explanatoryDeltaAssessment: {
      whatIsNewBeyondComparators: "",
      inputsComparison: "",
      constructionComparison: "",
      outputsComparison: "",
      generalizationComparison: "",
      outputValidityComparison: "",
      downstreamReachComparison: "",
      frameworkConditionalityComparison: "",
      scoreGapAssessment: "No comparator calibration adjustment was applied.",
    },
    comparatorsNeedingRecalibration: [],
    confidence: 0.5,
  };
}

function normalizeExternalComparatorSuggestions(value: unknown): ExternalComparatorSuggestion[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const source = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const title = firstString([source.title, source.paperTitle]);
      if (!title) return null;
      return {
        title,
        reasonToAdd: firstString([source.reasonToAdd, source.relationshipType, source.expectedUseInCalibration]),
        whyRelevant: firstString([source.whyRelevant, source.whyAdd, source.expectedContributionArchetype]),
        adminOnly: asBoolean(source.adminOnly, true),
      } satisfies ExternalComparatorSuggestion;
    })
    .filter(Boolean) as ExternalComparatorSuggestion[];
}

function normalizeCalibrationStatus(value: unknown, fallback: ComparatorCalibrationStatus = "unavailable"): ComparatorCalibrationStatus {
  const candidate = asString(value).toLowerCase();
  if (
    candidate === "applied" ||
    candidate === "unavailable" ||
    candidate === "not_available" ||
    candidate === "not_run" ||
    candidate === "weak" ||
    candidate === "insufficient_comparators" ||
    candidate === "not_run_benchmark_ingestion" ||
    candidate === "failed"
  ) {
    return candidate;
  }
  return fallback;
}

function normalizeExplanatoryDeltaAssessment(value: unknown): ComparatorCalibration["explanatoryDeltaAssessment"] {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    whatIsNewBeyondComparators: firstString([source.whatIsNewBeyondComparators, source.newBeyondComparators]),
    inputsComparison: firstString([source.inputsComparison, source.inputComparison]),
    constructionComparison: firstString([source.constructionComparison, source.constructionsComparison]),
    outputsComparison: firstString([source.outputsComparison, source.outputComparison]),
    generalizationComparison: firstString([source.generalizationComparison, source.generalizationBreadthComparison]),
    outputValidityComparison: firstString([source.outputValidityComparison, source.validityComparison]),
    downstreamReachComparison: firstString([source.downstreamReachComparison, source.downstreamComparison]),
    frameworkConditionalityComparison: firstString([source.frameworkConditionalityComparison, source.frameworkComparison]),
    scoreGapAssessment: firstString([source.scoreGapAssessment, source.score_gap_assessment]),
  };
}

function normalizeComparatorCalibrationResult(
  input: unknown,
  aggregate: AggregateReview,
  comparatorContext: ReviewComparatorContextItem[],
) {
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const calibrationSource = source.comparatorCalibration && typeof source.comparatorCalibration === "object"
    ? (source.comparatorCalibration as Record<string, unknown>)
    : source;
  const intrinsicScoreBand = normalizeScoreBand(calibrationSource.intrinsicScoreBand);
  const explicitFinalScore = firstNumber([
    calibrationSource.finalCalibratedScore,
    source.finalCalibratedScore,
    calibrationSource.finalPublicScore,
    source.finalPublicScore,
  ]);
  const finalPublicScoreBand = normalizeScoreBand(
    calibrationSource.finalPublicScoreBand ??
      (explicitFinalScore != null
        ? { low: explicitFinalScore, median: explicitFinalScore, high: explicitFinalScore }
        : undefined),
  );
  const intrinsicBand = intrinsicScoreBand.median > 0 ? intrinsicScoreBand : aggregate.blindIntrinsicScoreBand;
  const finalBand = finalPublicScoreBand.median > 0 ? finalPublicScoreBand : intrinsicBand;
  const candidateById = new Map<string, ReviewComparatorContextItem>();
  comparatorContext.forEach((candidate, index) => {
    candidateById.set(candidate.comparatorId || `C${index + 1}`, candidate);
    candidateById.set(candidate.sitePaperId, candidate);
  });
  const rawNearest = normalizeNearestComparators(source.nearestComparators ?? calibrationSource.nearestComparators);
  const nearestComparators = rawNearest
    .map((comparator) => {
      const candidate = comparator.comparatorId ? candidateById.get(comparator.comparatorId) : undefined;
      return {
        ...comparator,
        paperTitle: candidate?.title || comparator.paperTitle,
        sitePaperId: candidate?.sitePaperId || comparator.sitePaperId,
      };
    })
    .filter((comparator) => comparator.sitePaperId);
  const finalClassification =
    normalizeClassification(calibrationSource.finalClassification) ||
    aggregate.finalClassification ||
    classificationFallbackFromScore(finalBand.median);
  const explanatoryDeltaAssessment = normalizeExplanatoryDeltaAssessment(source.explanatoryDeltaAssessment ?? calibrationSource.explanatoryDeltaAssessment);
  const status = normalizeCalibrationStatus(
    source.comparatorCalibrationStatus ?? calibrationSource.comparatorCalibrationStatus,
    nearestComparators.length > 0 ? "applied" : "insufficient_comparators",
  );

  return {
    comparatorCalibration: {
      comparatorCalibrationStatus: status,
      benchmarkSetVersion: firstString([source.benchmarkSetVersion, calibrationSource.benchmarkSetVersion], BENCHMARK_SET_VERSION),
      intrinsicScoreBand: intrinsicBand,
      calibrationAdjustment: Math.round(asNumber(calibrationSource.calibrationAdjustment, finalBand.median - intrinsicBand.median, -10, 10)),
      finalPublicScoreBand: finalBand,
      finalClassification,
      calibrationRationale: asString(calibrationSource.calibrationRationale, "Comparator calibration completed without a detailed rationale."),
      scoreGapAssessment: firstString([calibrationSource.scoreGapAssessment, explanatoryDeltaAssessment.scoreGapAssessment]),
      scoreCappingReason: asString(calibrationSource.scoreCappingReason),
      explanatoryDeltaAssessment,
      comparatorsNeedingRecalibration: firstStringArray([source.comparatorsNeedingRecalibration, calibrationSource.comparatorsNeedingRecalibration]),
      confidence: asNumber(calibrationSource.confidence, 0.5, 0, 1),
    } satisfies ComparatorCalibration,
    nearestComparators,
    externalComparatorSuggestions: normalizeExternalComparatorSuggestions(source.externalComparatorSuggestions),
    publicComparatorSummary: asString(source.publicComparatorSummary),
    adminComparatorNotes: asString(source.adminComparatorNotes),
  };
}

function classificationFallbackFromScore(score: number) {
  if (score >= 95) return "field-defining advance";
  if (score >= 90) return "major specialty advance";
  if (score >= 85) return "specialty advance";
  if (score >= 75) return "strong niche contribution";
  if (score >= 65) return "niche contribution";
  if (score >= 50) return "minor contribution";
  if (score >= 25) return "limited contribution";
  return "not yet convincing";
}

function classificationRank(label: string) {
  return CLASSIFICATIONS.indexOf(label as (typeof CLASSIFICATIONS)[number]);
}

function alignClassificationToScore(classification: string, score: number) {
  if (score < 20) return "not yet convincing";

  const fallback = classificationFallbackFromScore(score);
  const currentRank = classificationRank(classification);

  if (currentRank === -1) return fallback;
  return currentRank === classificationRank(fallback) ? classification : fallback;
}

function describesStrongFrameworkIndependence(text: string) {
  return /\b(framework[- ]independent|independent consequence|survives outside|beyond the framework|model[- ]independent|empirical test|direct observational|experimentally testable|broad consequence)\b/i.test(text);
}

function describesSubstantialSurvivingContribution(text: string) {
  if (!text.trim()) return false;
  if (/\b(no|none|little|minimal|not|without)\b.{0,40}\b(substantial|separable|surviving|durable|independent)\b/i.test(text)) {
    return false;
  }
  return /\b(substantial|separable|surviving|durable|independent|method|theorem|diagnostic|dataset|representation|construction|partial insight)\b/i.test(text);
}

function applyClassificationConsistency(
  classification: string,
  score: number,
  details: {
    frameworkLevel?: FrameworkLevel;
    frameworkIndependence?: string;
    frameworkConditionality?: string;
    survivingContribution?: string;
    paperType?: string;
    manuscriptOriginalContribution?: string;
  },
) {
  if (score < 20 && !describesSubstantialSurvivingContribution(details.survivingContribution || "")) {
    return "not yet convincing";
  }

  if (
    classification === "field-defining advance" &&
    score >= 95 &&
    details.frameworkLevel === "high"
  ) {
    return "major specialty advance";
  }

  if (
    classification === "field-defining advance" &&
    /\b(review|perspective|survey|synthesis)\b/i.test(details.paperType || "") &&
    !/\b(new|original|deriv|proof|classification|framework|explanatory structure|construction)\b/i.test(details.manuscriptOriginalContribution || "")
  ) {
    return "major specialty advance";
  }

  return classification;
}

function normalizeClassification(value: unknown) {
  const candidate = asString(value).toLowerCase().replace(/\s+/g, " ").trim();
  const aliases: Record<string, string> = {
    "framework-defining advance": "major specialty advance",
    "useful clarification": "minor contribution",
    "elegant repackaging": "limited contribution",
  };
  if (aliases[candidate]) return aliases[candidate];
  const normalized = CLASSIFICATIONS.find((label) => label.toLowerCase() === candidate);
  return normalized ?? "";
}

function normalizeFrameworkLevel(value: unknown): FrameworkLevel {
  const candidate = asString(value).toLowerCase();
  if (candidate === "low" || candidate === "medium" || candidate === "high") return candidate;
  return "medium";
}

function normalizeScoreBand(value: unknown) {
  const obj = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  let low = asNumber(obj.low, 0, 0, 100);
  let median = asNumber(obj.median, low, 0, 100);
  let high = asNumber(obj.high, median, 0, 100);

  if (high <= 10 && median <= 10 && low <= 10) {
    low *= 10;
    median *= 10;
    high *= 10;
  }

  const sorted = [low, median, high].sort((a, b) => a - b).map((item) => Math.round(item));
  return { low: sorted[0], median: sorted[1], high: sorted[2] };
}

function firstNumber(values: unknown[]) {
  for (const value of values) {
    const raw = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isFinite(raw)) return raw;
  }
  return null;
}

function normalizeScoreBandWithFallback(source: Record<string, unknown>) {
  const band = normalizeScoreBand(source.scoreBand);
  const explicitScore = firstNumber([
    source.intrinsicScore,
    source.score,
    source.overallScore,
    source.overallIntrinsicScore,
    source.scientificMeritScore,
    source.finalScore,
  ]);

  if (band.low === 0 && band.median === 0 && band.high === 0 && explicitScore != null) {
    const score = Math.round(Math.max(0, Math.min(100, explicitScore)));
    return { low: score, median: score, high: score };
  }

  return band;
}

function rangeToStability(range: number): ScoreStability {
  if (range <= 5) return "high";
  if (range <= 10) return "medium";
  return "low";
}

function extractJson(raw: string): unknown {
  const trimmed = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const parseWithRepair = (value: string) => {
    try {
      return JSON.parse(value);
    } catch (err) {
      try {
        return JSON.parse(repairInvalidJsonEscapes(value));
      } catch {
        throw err;
      }
    }
  };

  try {
    return parseWithRepair(trimmed);
  } catch {}

  const jsonObject = extractFirstJsonObject(trimmed);
  if (jsonObject) {
    return parseWithRepair(jsonObject);
  }

  throw new Error("Could not parse model response as JSON.");
}

function extractFirstJsonObject(value: string) {
  const start = value.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < value.length; i += 1) {
    const char = value[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return value.slice(start, i + 1);
    }
  }

  return null;
}

function repairInvalidJsonEscapes(value: string) {
  let repaired = "";
  let inString = false;
  let escaped = false;
  const validEscapes = new Set(['"', "\\", "/", "b", "f", "n", "r", "t", "u"]);
  const isHex = (char: string | undefined) => !!char && /^[0-9a-fA-F]$/.test(char);

  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];

    if (!inString) {
      repaired += char;
      if (char === '"') inString = true;
      continue;
    }

    if (escaped) {
      if (char === "u" && !(isHex(value[i + 1]) && isHex(value[i + 2]) && isHex(value[i + 3]) && isHex(value[i + 4]))) {
        repaired += "\\\\u";
        escaped = false;
        continue;
      }
      if (!validEscapes.has(char)) repaired += "\\";
      repaired += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === "\n") {
      repaired += "\\n";
      continue;
    }
    if (char === "\r") {
      repaired += "\\r";
      continue;
    }
    if (char === "\t") {
      repaired += "\\t";
      continue;
    }

    repaired += char;
    if (char === '"') inString = false;
  }

  if (escaped) repaired += "\\\\";
  return repaired;
}

function normalizeIndividualReview(input: unknown): IndividualReview {
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const coverage = source.coverageLedger && typeof source.coverageLedger === "object"
    ? (source.coverageLedger as Record<string, unknown>)
    : {};
  const inputConstructionOutputLedger = source.inputConstructionOutputLedger && typeof source.inputConstructionOutputLedger === "object"
    ? (source.inputConstructionOutputLedger as Record<string, unknown>)
    : {};
  const inputConstructionOutputAssessment = source.inputConstructionOutputAssessment && typeof source.inputConstructionOutputAssessment === "object"
    ? (source.inputConstructionOutputAssessment as Record<string, unknown>)
    : {};
  const icoInput = inputConstructionOutputAssessment.input && typeof inputConstructionOutputAssessment.input === "object"
    ? (inputConstructionOutputAssessment.input as Record<string, unknown>)
    : {};
  const icoConstruction = inputConstructionOutputAssessment.construction && typeof inputConstructionOutputAssessment.construction === "object"
    ? (inputConstructionOutputAssessment.construction as Record<string, unknown>)
    : {};
  const icoOutput = inputConstructionOutputAssessment.output && typeof inputConstructionOutputAssessment.output === "object"
    ? (inputConstructionOutputAssessment.output as Record<string, unknown>)
    : {};
  const icoInputOverallAssessment = firstString([
    icoInput.overallAssessment,
    icoInput.assessment,
    inputConstructionOutputLedger.inputOverallAssessment,
  ]);
  const icoConstructionOverallAssessment = firstString([
    icoConstruction.overallAssessment,
    icoConstruction.assessment,
    inputConstructionOutputLedger.constructionOverallAssessment,
  ]);
  const icoOutputOverallAssessment = firstString([
    icoOutput.overallAssessment,
    icoOutput.assessment,
    inputConstructionOutputLedger.outputOverallAssessment,
    inputConstructionOutputLedger.assessment,
  ]);
  const technicalAssessment = source.technicalAssessment && typeof source.technicalAssessment === "object"
    ? (source.technicalAssessment as Record<string, unknown>)
    : {};
  const technicalFrameworkDependence = technicalAssessment.frameworkDependence && typeof technicalAssessment.frameworkDependence === "object"
    ? (technicalAssessment.frameworkDependence as Record<string, unknown>)
    : {};
  const organicCohortProfile = source.organicCohortProfile && typeof source.organicCohortProfile === "object"
    ? (source.organicCohortProfile as Record<string, unknown>)
    : {};
  const failureAnalysis = source.failureAnalysis && typeof source.failureAnalysis === "object"
    ? (source.failureAnalysis as Record<string, unknown>)
    : {};
  const normalizedOutputValidityAssessment = normalizeOutputValidityAssessment(source.outputValidityAssessment ?? source.outputValidity);
  const legacyDirectOutputs = firstStringArray([
    inputConstructionOutputLedger.directOutputs,
    source.directOutputs,
    source.direct_outputs,
  ]);
  const legacyExternalEmbeddingsAndChecks = firstStringArray([
    inputConstructionOutputLedger.externalEmbeddingsAndChecks,
    source.externalEmbeddingsAndChecks,
    source.external_embeddings_and_checks,
    source.externalChecks,
  ]);
  const preliminaryCentralOutputDependency = normalizeCentralOutputDependency(source.centralOutputDependency);
  const normalizedLedgerOutputs = normalizeLedgerOutputs(icoOutput.outputs ?? inputConstructionOutputLedger.outputs ?? source.outputs, {
    legacyDirectOutputs,
    legacyExternalContext: legacyExternalEmbeddingsAndChecks,
    centralOutputDependency: preliminaryCentralOutputDependency,
    outputValidityAssessment: normalizedOutputValidityAssessment,
  });
  const normalizedCentralOutputDependency = normalizeCentralOutputDependency(
    source.centralOutputDependency ?? {
      centralOutput: normalizedLedgerOutputs[0]?.output ?? "",
      requiredPrimitiveInputs: normalizedLedgerOutputs[0]?.dependsOnInputs ?? [],
      requiredIntroducedConstructions: normalizedLedgerOutputs[0]?.dependsOnConstructions ?? [],
      dependencyAssessment: normalizedLedgerOutputs[0]?.support ?? "",
      constructionFragility: "",
      outputValidity: normalizedLedgerOutputs[0]?.validity ?? asString(source.outputValidity),
      assessment: normalizedLedgerOutputs[0]?.support ?? "",
    },
  );
  const contributionArchetype = normalizeContributionArchetype(source.contributionArchetype);
  const framework = source.frameworkConditionality && typeof source.frameworkConditionality === "object"
    ? (source.frameworkConditionality as Record<string, unknown>)
    : {};

  const normalizedScoreBand = normalizeScoreBandWithFallback(source);
  const normalizedSpecialtyScore = Math.round(asNumber(source.specialtyRelativeScore, normalizedScoreBand.median, 0, 100));
  const normalizedClassification =
    normalizeClassification(firstString([
      source.bestClassification,
      source.classification,
      source.finalClassification,
      source.category,
    ])) || classificationFallbackFromScore(normalizedScoreBand.median);
  const alignedClassification = alignClassificationToScore(normalizedClassification, normalizedScoreBand.median);
  const normalizedFrameworkLevel = normalizeFrameworkLevel(firstString([technicalFrameworkDependence.level, framework.level, source.frameworkConditionalityLevel]));
  const frameworkConditionalityExplanation = firstString([
    technicalFrameworkDependence.explanation,
    technicalFrameworkDependence.scoreImpact,
    framework.explanation,
    source.frameworkConditionality,
    source.frameworkConditionalityAssessment,
    source.framework_conditionality,
  ]);
  const normalizedFrameworkIndependence = firstString([
    source.frameworkDependence,
    source.frameworkIndependence,
    source.framework_independence,
    source.frameworkIndependenceAssessment,
  ]);
  const subscoreValidity = diagnosticSubscoreValidity(source);
  const normalizedPaperType = firstString([source.paperType, source.paper_type, source.manuscriptType]);
  const normalizedOriginalContribution = firstString([
    source.manuscriptOriginalContribution,
    source.originalContribution,
    source.manuscript_original_contribution,
  ]);
  const normalizedSurvivingContribution = firstString([
    source.survivingContributionIfFlawed,
    source.survivingContribution,
    source.surviving_contribution_if_flawed,
  ]);
  const inputStrengthScore = normalizeDiagnosticSubscore(firstNumberField(source, ["inputStrengthScore", "intrinsicTechnicalScore"]));
  const constructionStrengthScore = normalizeDiagnosticSubscore(firstNumberField(source, ["constructionStrengthScore", "explanatoryTargetBreadthScore"]));
  const outputStrengthScore = normalizeDiagnosticSubscore(firstNumberField(source, [
    "outputStrengthScore",
    "outputReachScore",
    "theorySpaceBreadthScore",
    "generalizationBreadthScore",
    "breadthOfImpactScore",
  ]));
  const outputReachScore = normalizeDiagnosticSubscore(firstNumberField(source, ["outputReachScore", "theorySpaceBreadthScore"]), outputStrengthScore);
  const generalizationBreadthScore = normalizeDiagnosticSubscore(firstNumberField(source, ["generalizationBreadthScore", "breadthOfImpactScore"]), outputStrengthScore);

  return {
    title: "anonymized manuscript",
    authorName: "anonymized",
    comparisonCohort: firstString([source.comparisonCohort, source.comparison_cohort, source.cohort]),
    localCohort: firstString([source.localCohort, organicCohortProfile.localCohort, source.comparisonCohort, source.comparison_cohort, source.cohort]),
    broadField: firstString([source.broadField, source.broad_field, source.field]),
    specialtyField: firstString([source.specialtyField, source.specialty_field, source.subfield]),
    subfields: firstStringArray([source.subfields, source.subFields, source.sub_fields]),
    paperType: normalizedPaperType,
    contributionArchetype,
    organicCohortProfile: {
      localCohort: firstString([organicCohortProfile.localCohort, source.localCohort, source.comparisonCohort]),
      primaryCohort: firstString([organicCohortProfile.primaryCohort, organicCohortProfile.localCohort, source.localCohort, source.comparisonCohort]),
      adjacentBroadCohort: firstString([organicCohortProfile.adjacentBroadCohort, source.broadField, source.field]),
      contributionArchetype,
      primitiveInputs: firstStringArray([organicCohortProfile.primitiveInputs]),
      introducedConstructions: firstStringArray([organicCohortProfile.introducedConstructions]),
      outputs: firstStringArray([organicCohortProfile.outputs]),
      externalEmbeddingsAndChecks: [],
      centralOutputDependency: normalizeCentralOutputDependency(null),
      outputValidityAssessment: normalizeOutputValidityAssessment(null),
      directOutputs: [],
      downstreamReach: "",
      frameworkConditionality: normalizedFrameworkLevel,
      scoreBand: { low: 0, median: 0, high: 0 },
      classification: "",
      clusterFeatureTags: firstStringArray([organicCohortProfile.clusterFeatureTags, source.clusterFeatureTags]),
      comparatorSearchSummary: firstString([organicCohortProfile.comparatorSearchSummary, source.comparatorSearchSummary]),
    },
    summary: firstString([
      source.scientificReview,
      source.publicScientificReview,
      source.publicReview,
      source.summary,
      source.abstract,
      source.overview,
      source.reviewSummary,
      source.finalSummary,
    ]),
    centralClaim: firstString([source.centralClaim, source.central_claim, source.mainClaim, source.claim]),
    scientificReview: firstString([
      source.scientificReview,
      source.publicScientificReview,
      source.publicReview,
      source.publicOneParagraphVerdict,
      source.oneParagraphVerdict,
      source.finalJudgment,
      source.summary,
    ]),
    inputConstructionOutputLedger: {
      primitiveInputs: normalizePrimitiveInputs([
        icoInput.primitiveInputs,
        inputConstructionOutputLedger.primitiveInputs,
        source.primitiveInputs,
        source.primitive_inputs,
      ]),
      introducedConstructions: normalizeIntroducedConstructions([
        icoConstruction.introducedConstructions,
        inputConstructionOutputLedger.introducedConstructions,
        source.introducedConstructions,
        source.introduced_constructions,
      ]),
      outputs: normalizedLedgerOutputs,
      inputOverallAssessment: icoInputOverallAssessment,
      constructionOverallAssessment: icoConstructionOverallAssessment,
      outputOverallAssessment: icoOutputOverallAssessment,
      whyOutputsMatter: firstString([
        icoOutput.whyOutputsMatter,
        inputConstructionOutputLedger.whyOutputsMatter,
        inputConstructionOutputLedger.downstreamReach,
        source.whyOutputsMatter,
        source.downstreamReach,
        source.downstream_reach,
      ]),
      externalEmbeddingsAndChecks: legacyExternalEmbeddingsAndChecks,
      directOutputs: legacyDirectOutputs.length > 0 ? legacyDirectOutputs : normalizedLedgerOutputs.map((item) => item.output),
      downstreamReach: firstString([
        inputConstructionOutputLedger.downstreamReach,
        inputConstructionOutputLedger.whyOutputsMatter,
        source.downstreamReach,
        source.whyOutputsMatter,
        source.downstream_reach,
      ]),
      assessment: firstString([
        inputConstructionOutputLedger.assessment,
        inputConstructionOutputAssessment.assessment,
        [icoInputOverallAssessment, icoConstructionOverallAssessment, icoOutputOverallAssessment].filter(Boolean).join("\n\n"),
        source.inputConstructionOutputAssessment,
        source.input_construction_output_assessment,
      ]),
      centralOutputDependency: normalizedCentralOutputDependency,
      outputValidityAssessment: normalizedOutputValidityAssessment,
    },
    centralOutputDependency: normalizedCentralOutputDependency,
    outputValidityAssessment: normalizedOutputValidityAssessment,
    nearestComparators: normalizeNearestComparators(source.nearestComparators),
    coverageLedger: {
      directTargets: firstStringArray([coverage.directTargets, source.directTargets, source.direct_targets]),
      importedInputs: firstStringArray([coverage.importedInputs, source.importedInputs, source.imported_inputs]),
      theorySpaceVariants: firstStringArray([
        coverage.theorySpaceVariants,
        source.theorySpaceVariants,
        source.theory_space_variants,
        source.modelSpaceVariants,
      ]),
      mechanismSharingAssessment: firstString([
        coverage.mechanismSharingAssessment,
        source.mechanismSharingAssessment,
        source.mechanism_sharing_assessment,
      ]),
    },
    establishedResults: firstStringArray([source.establishedResults, source.established_results]),
    interpretiveClaims: firstStringArray([source.interpretiveClaims, source.interpretive_claims]),
    speculativeClaims: firstStringArray([source.speculativeClaims, source.speculative_claims]),
    correctness: firstString([
      technicalAssessment.correctness,
      source.correctness,
      source.correctnessAnalysis,
      source.technicalCorrectness,
      source.validity,
    ]),
    inputGrounding: firstString([source.inputGrounding, icoInputOverallAssessment, source.input_grounding, source.grounding]),
    inputFundamentality: firstString([
      source.inputFundamentality,
      source.input_fundamentality,
      source.inputFundamentalityAssessment,
    ]),
    constructionAssessment: firstString([
      icoConstructionOverallAssessment,
      source.constructionAssessment,
      source.construction_assessment,
      source.constructionStrengthAssessment,
    ]),
    outputValidity: firstString([
      source.outputValidity,
      normalizedOutputValidityAssessment.assessment,
      normalizedCentralOutputDependency.outputValidity,
    ]),
    contributionGroundingType: firstString([
      source.contributionGroundingType,
      source.contribution_grounding_type,
      source.groundingType,
    ]),
    frameworkIndependence: normalizedFrameworkIndependence,
    hardToVaryAssessment: firstString([technicalAssessment.hardToVaryAssessment, source.hardToVaryAssessment, source.hard_to_vary_assessment]),
    manuscriptOriginalContribution: normalizedOriginalContribution,
    survivingContributionIfFlawed: normalizedSurvivingContribution,
    novelty: firstString([source.novelty, source.originality]),
    noveltyConfidence: asNumber(source.noveltyConfidence, 0.95, 0, 1),
    internalTechnicalTraction: firstString([source.internalTechnicalTraction, source.technicalTraction]),
    economy: firstString([source.economy, source.explanatoryEconomy]),
    explanatoryTargetBreadth: firstString([source.explanatoryTargetBreadth, source.targetBreadth]),
    theorySpaceBreadth: firstString([source.theorySpaceBreadth, source.modelSpaceBreadth]),
    scopeDepth: firstString([source.scopeDepth, source.depth]),
    unifyingPower: firstString([source.unifyingPower, source.unification]),
    frameworkConditionality: {
      level: normalizedFrameworkLevel,
      explanation: frameworkConditionalityExplanation,
    },
    strongestCaseForImportance: firstString([
      technicalAssessment.strongestCaseForImportance,
      source.strongestCaseForImportance,
      source.strongestCase,
      source.caseForImportance,
    ]),
    strongestObjection: firstString([
      technicalAssessment.strongestObjection,
      source.strongestObjection,
      source.mainObjection,
      source.objection,
      source.weaknesses,
    ]),
    decisiveCheck: firstString([source.decisiveCheck, source.keyCheck, source.keyTest]),
    assessmentSensitivity: firstString([
      technicalAssessment.assessmentSensitivity,
      source.assessmentSensitivity,
      source.assessment_sensitivity,
      source.whatWouldChangeAssessment,
      source.decisiveCheck,
    ]),
    whatWouldRaiseScore: firstString([technicalAssessment.whatWouldRaiseScore, source.whatWouldRaiseScore, source.raiseScore, source.scoreUpside]),
    whatWouldLowerScore: firstString([technicalAssessment.whatWouldLowerScore, source.whatWouldLowerScore, source.lowerScore, source.scoreDownside]),
    inputStrengthScore,
    constructionStrengthScore,
    outputStrengthScore,
    outputReachScore,
    generalizationBreadthScore,
    subscoreRationale: normalizeSubscoreRationale(source.subscoreRationale),
    intrinsicTechnicalScore: normalizeDiagnosticSubscore(source.intrinsicTechnicalScore, inputStrengthScore),
    explanatoryTargetBreadthScore: normalizeDiagnosticSubscore(source.explanatoryTargetBreadthScore, constructionStrengthScore),
    theorySpaceBreadthScore: normalizeDiagnosticSubscore(source.theorySpaceBreadthScore, outputReachScore),
    breadthOfImpactScore: normalizeDiagnosticSubscore(source.breadthOfImpactScore, generalizationBreadthScore),
    subscoreValidity,
    scoreCappingReason: firstString([source.scoreCappingReason, source.score_capping_reason]),
    scoreAdjustmentReason: firstString([source.scoreAdjustmentReason, source.score_adjustment_reason, source.scoreAdjustmentRationale]),
    specialtyRelativeScore: normalizedSpecialtyScore,
    broadFieldRelativeScore: Math.round(asNumber(source.broadFieldRelativeScore, 0, 0, 100)),
    crossFieldConsequenceScore: Math.round(asNumber(source.crossFieldConsequenceScore, 0, 0, 100)),
    scoreBand: normalizedScoreBand,
    scoreConfidence: asNumber(source.scoreConfidence, 0.9, 0, 1),
    bestClassification: applyClassificationConsistency(alignedClassification, normalizedScoreBand.median, {
      frameworkLevel: normalizedFrameworkLevel,
      frameworkIndependence: normalizedFrameworkIndependence,
      frameworkConditionality: frameworkConditionalityExplanation,
      survivingContribution: normalizedSurvivingContribution,
      paperType: normalizedPaperType,
      manuscriptOriginalContribution: normalizedOriginalContribution,
    }),
    oneParagraphVerdict: firstString([
      source.oneParagraphVerdict,
      source.publicVerdict,
      source.verdict,
      source.publicOneParagraphVerdict,
    ]),
    finalJudgment: firstString([
      source.finalJudgment,
      source.overallEvaluation,
      source.overall_evaluation,
      source.evaluation,
      source.finalVerdict,
      source.verdict,
    ]),
    failureAnalysis: {
      failureMode: firstString([failureAnalysis.failureMode, source.failureMode]),
      fatalObjectionPresent: asBoolean(failureAnalysis.fatalObjectionPresent ?? source.fatalObjectionPresent),
      paperFatalError: asBoolean(failureAnalysis.paperFatalError ?? source.paperFatalError),
      fatalToSpecificClaimOnly: asBoolean(failureAnalysis.fatalToSpecificClaimOnly ?? source.fatalToSpecificClaimOnly),
      survivingHighValueContributions: firstStringArray([
        failureAnalysis.survivingHighValueContributions,
        source.survivingHighValueContributions,
      ]),
      failedClaimsExcludedFromScore: firstStringArray([
        failureAnalysis.failedClaimsExcludedFromScore,
        source.failedClaimsExcludedFromScore,
      ]),
      survivingContributionScoreBasis: firstString([
        failureAnalysis.survivingContributionScoreBasis,
        source.survivingContributionScoreBasis,
        source.survivingContributionIfFlawed,
      ]),
    },
  };
}

function individualReviewReasoningText(review: IndividualReview) {
  return [
    review.summary,
    review.centralClaim,
    review.scientificReview,
    review.inputConstructionOutputLedger.outputs.map((item) => [
      item.output,
      item.support,
      item.validity,
      item.externalContextIfAny,
    ].filter(Boolean).join("\n")).join("\n"),
    review.inputConstructionOutputLedger.whyOutputsMatter,
    review.inputConstructionOutputLedger.assessment,
    review.inputConstructionOutputLedger.downstreamReach,
    review.centralOutputDependency.centralOutput,
    review.centralOutputDependency.dependencyAssessment,
    review.centralOutputDependency.constructionFragility,
    review.centralOutputDependency.outputValidity,
    review.centralOutputDependency.assessment,
    review.outputValidityAssessment.assessment,
    review.correctness,
    review.inputGrounding,
    review.inputFundamentality,
    review.constructionAssessment,
    review.outputValidity,
    review.novelty,
    review.strongestCaseForImportance,
    review.strongestObjection,
    review.assessmentSensitivity,
    review.oneParagraphVerdict,
    review.finalJudgment,
  ].filter(Boolean).join("\n").trim();
}

function validateIndividualReview(review: IndividualReview) {
  const reasoningText = individualReviewReasoningText(review);
  const score = review.scoreBand.median;
  const hasCoreReasoning =
    reasoningText.length >= 80 &&
    Boolean(review.scientificReview || review.correctness || review.finalJudgment || review.oneParagraphVerdict || review.summary);

  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new Error("Generated review did not include a valid 0-100 score.");
  }

  if (!hasCoreReasoning) {
    throw new Error("Generated review was blank or missing substantive reasoning.");
  }

  if (!review.scientificReview.trim()) {
    throw new Error("Generated review was missing a scientific review.");
  }

  if (!review.centralClaim.trim()) {
    throw new Error("Generated review was missing a central claim.");
  }

  if (
    review.inputConstructionOutputLedger.primitiveInputs.length === 0 ||
    review.inputConstructionOutputLedger.introducedConstructions.length === 0 ||
    review.inputConstructionOutputLedger.outputs.length === 0 ||
    !review.inputConstructionOutputLedger.assessment.trim()
  ) {
    throw new Error("Generated review was missing input-construction-output ledger accounting.");
  }

  const hasOutputValidity = review.inputConstructionOutputLedger.outputs.some((output) =>
    output.assessment.trim() || output.validity.trim() || output.support.trim(),
  );
  if (!hasOutputValidity) {
    throw new Error("Generated review was missing output-level assessment/validity/support.");
  }

  if (!review.assessmentSensitivity.trim()) {
    throw new Error("Generated review was missing assessment sensitivity.");
  }

  if (score === 0 && reasoningText.length < 180) {
    throw new Error("Generated review returned score 0 without enough reasoning; treating as failed generation.");
  }

  if (!allDiagnosticSubscoresValid(review.subscoreValidity)) {
    throw new Error("Generated review was missing one or more required diagnostic subscores.");
  }
}

function toMarkdownList(items: string[]) {
  return items.filter(Boolean).map((item) => `- ${item}`).join("\n");
}

function blindManuscriptText(paperContent: string) {
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

type MetadataHints = {
  fileName?: string;
  pdfTitle?: string;
  pdfAuthor?: string;
  pdfBase64?: string;
  mimeType?: string;
};

export type PaperDateMetadata = {
  rawExtractedTitle: string;
  cleanedTitle: string;
  titleConfidence: number;
  titleCleaningNotes: string;
  displayedTitle: string;
  displayedAuthors: string[];
  rawExtractedAuthors: string;
  authorsConfidence: number;
  authorsExtractionNotes: string;
  arxivId: string;
  reportCodes: string[];
  doi: string;
  journalName: string;
  journalPublicationDate: string;
  arxivFirstSubmissionDate: string;
  manuscriptDatePrintedOnPdf: string;
  originalPublicationDateBestGuess: string;
  dateSource: string;
  dateConfidence: number;
  dateNotes: string;
};

export type ExtractedPaperMetadata = {
  title: string;
  authors: string;
  dateMetadata: PaperDateMetadata;
};

function cleanMetadataText(value?: string) {
  return stripControlChars(value || "")
    .replace(/\.[Pp][Dd][Ff]$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ARXIV_ID_REGEX = /\b(?:arxiv:\s*)?(?:(?:[a-z-]+(?:\.[A-Z]{2})?\/\d{7})|(?:\d{4}\.\d{4,5}))(?:v\d+)?\b/gi;
const LEADING_REPORT_CODE_REGEX = /^\s*(?:[A-Z]{2,}(?:-[A-Z0-9]+)+(?:\/\d+)*(?:-\d+)?|[A-Z]{2,}-[A-Z]{2,}-\d{2,}(?:\/\d+)*(?:-\d+)?)\s*/;
const REPORT_CODE_SCAN_REGEX = /\b[A-Z]{2,}(?:-[A-Z0-9]+)+(?:\/\d+)*(?:-\d+)?\b/g;
const TITLE_STOP_WORDS = new Set(["a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with"]);

function uniqueCleanStrings(values: Array<string | undefined | null>) {
  return Array.from(new Set(values.map((value) =>
    stripControlChars(value || "").replace(/\s+/g, " ").trim()
  ).filter(Boolean)));
}

function decodeXmlEntities(value: string) {
  const entityMap: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    apos: "'",
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, code) => {
    const lower = code.toLowerCase();
    if (entityMap[lower]) return entityMap[lower];
    if (lower.startsWith("#x")) {
      const parsed = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : entity;
    }
    if (lower.startsWith("#")) {
      const parsed = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : entity;
    }
    return entity;
  });
}

function normalizeArxivId(value?: string) {
  const cleaned = stripControlChars(value || "")
    .replace(/^https?:\/\/arxiv\.org\/(?:abs|pdf)\//i, "")
    .replace(/^arxiv:\s*/i, "")
    .replace(/\.pdf$/i, "")
    .trim();
  const match = cleaned.match(/(?:(?:[a-z-]+(?:\.[A-Z]{2})?\/\d{7})|(?:\d{4}\.\d{4,5}))(?:v\d+)?/i);
  return match?.[0]?.replace(/v\d+$/i, "") || "";
}

const KNOWN_ARXIV_AUTHOR_OVERRIDES: Record<string, string[]> = {
  "astro-ph/0306438": ["Sean M. Carroll", "Vikram Duvvuri", "Mark Trodden", "Michael S. Turner"],
  "hep-th/0501055": ["Rong-Gen Cai", "Sang Pyo Kim"],
};

function knownArxivAuthors(arxivId?: string) {
  const normalizedId = normalizeArxivId(arxivId).toLowerCase();
  return normalizedId ? (KNOWN_ARXIV_AUTHOR_OVERRIDES[normalizedId] ?? []) : [];
}

function firstArxivIdFromText(value?: string) {
  const match = stripControlChars(value || "").match(ARXIV_ID_REGEX);
  return normalizeArxivId(match?.[0] || "");
}

type ArxivMetadata = {
  arxivId: string;
  title: string;
  authors: string[];
  published: string;
  doi: string;
  journalRef: string;
};

function xmlTagText(source: string, tagName: string) {
  const match = source.match(new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)</${tagName}>`, "i"));
  return decodeXmlEntities(match?.[1] || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchArxivMetadata(arxivId?: string): Promise<ArxivMetadata | null> {
  const normalizedId = normalizeArxivId(arxivId);
  if (!normalizedId) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(normalizedId)}`, {
      signal: controller.signal,
      headers: {
        "User-Agent": "ModernScienceReview/1.0 (metadata extraction)",
      },
    });
    if (!response.ok) return null;
    const xml = await response.text();
    const entry = xml.match(/<entry>([\s\S]*?)<\/entry>/i)?.[1] || "";
    if (!entry) return null;
    const authors = Array.from(entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>\s*<\/author>/gi))
      .map((match) => decodeXmlEntities(match[1]).replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const title = cleanDisplayTitle(xmlTagText(entry, "title")).title;
    return {
      arxivId: normalizedId,
      title: title && title !== "Unknown Title" ? title : "",
      authors,
      published: xmlTagText(entry, "published"),
      doi: xmlTagText(entry, "arxiv:doi") || xmlTagText(entry, "doi"),
      journalRef: xmlTagText(entry, "arxiv:journal_ref") || xmlTagText(entry, "journal_ref"),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function looksLikeJournalCitation(value?: string) {
  const cleaned = cleanMetadataText(value);
  if (!cleaned) return false;
  const hasJournal =
    /\b(?:commun\.?\s*math\.?\s*phys\.?|communications?\s+in\s+mathematical\s+physics|phys\.?\s*rev\.?|physical\s+review|class\.?\s*quantum\s*grav\.?|classical\s+and\s+quantum\s+gravity|nucl\.?\s*phys\.?|nuclear\s+physics|j\.?\s*math\.?\s*phys\.?|journal\s+of\s+mathematical\s+physics|gen\.?\s*rel\.?\s*grav\.?)\b/i.test(cleaned);
  return hasJournal && (/\b\d+\s*,\s*\d/.test(cleaned) || /\(\s*\d{4}\s*\)/.test(cleaned) || /\b\d{4}\b/.test(cleaned));
}

function titleCaseMetadataTitle(value: string) {
  const words = value.split(/\s+/).filter(Boolean);
  return words.map((word, index) => {
    if (/^ads$/i.test(word)) return "AdS";
    if (/^ds$/i.test(word)) return "dS";
    if (/^(?:FRW|FLRW|QFT|QMBH|CFT|GR|LQG|QCD|QED)$/i.test(word)) return word.toUpperCase();
    if (/[\d$\\/[{}\]]/.test(word)) return word;
    const leading = word.match(/^[('"“‘]*/)?.[0] || "";
    const trailing = word.match(/[)'”’.,:;!?]*$/)?.[0] || "";
    const core = word.slice(leading.length, word.length - trailing.length);
    if (!core) return word;
    const lower = core.toLowerCase();
    const followsTitleBreak = index > 0 && /[:.!?]$/.test(words[index - 1]);
    if (index > 0 && !followsTitleBreak && TITLE_STOP_WORDS.has(lower)) return `${leading}${lower}${trailing}`;
    const titledCore = lower
      .split("-")
      .map((part) => part ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : part)
      .join("-");
    return `${leading}${titledCore}${trailing}`;
  }).join(" ");
}

function cleanDisplayTitle(value?: string) {
  const raw = stripControlChars(value || "")
    .replace(/\.[Pp][Dd][Ff]$/, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const arxivIds = uniqueCleanStrings(raw.match(ARXIV_ID_REGEX) || []);
  const reportCodes = uniqueCleanStrings(raw.match(REPORT_CODE_SCAN_REGEX) || []);
  if (!raw || looksLikeJournalCitation(raw)) {
    return {
      title: "Unknown Title",
      arxivId: arxivIds[0] || "",
      reportCodes,
      notes: raw ? "Rejected journal citation as title." : "No title text found.",
    };
  }

  let cleaned = raw
    .replace(ARXIV_ID_REGEX, " ")
    .replace(/\b(?:preprint|report)\s+no\.?\s*[:#]?\s*/gi, " ")
    .replace(/[†‡§*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const strippedReports: string[] = [...reportCodes];
  let previous = "";
  while (previous !== cleaned) {
    previous = cleaned;
    const match = cleaned.match(LEADING_REPORT_CODE_REGEX);
    if (match?.[0]) {
      strippedReports.push(stripControlChars(match[0]).replace(/\s+/g, " ").trim());
      cleaned = cleaned.slice(match[0].length).trim();
    }
  }

  cleaned = cleaned
    .replace(/^\s*(?:title|paper|article)\s*[:.-]\s*/i, "")
    .replace(/\s+(?:by\s+)?[A-Z]\.\s*[A-Z][A-Za-z.'-]+(?:\s*[†‡§*])?$/u, "")
    .replace(/\s+(?:[A-Z][A-Za-z.'-]+\s*,\s*)?[A-Z]\.\s*[A-Z][A-Za-z.'-]+(?:\s*[†‡§*])?$/u, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned || looksLikeJournalCitation(cleaned) || cleaned.length < 8) {
    return {
      title: "Unknown Title",
      arxivId: arxivIds[0] || "",
      reportCodes: uniqueCleanStrings(strippedReports),
      notes: "Title cleanup rejected non-title text.",
    };
  }

  const title = titleCaseMetadataTitle(cleaned);
  const changed = title !== raw;
  return {
    title,
    arxivId: arxivIds[0] || "",
    reportCodes: uniqueCleanStrings(strippedReports),
    notes: changed ? "Deterministic cleanup stripped identifiers, citations, or title-page markers." : "",
  };
}

function isOnlyReportCodeLine(value: string) {
  const stripped = value.replace(ARXIV_ID_REGEX, " ").replace(REPORT_CODE_SCAN_REGEX, " ").replace(/\s+/g, " ").trim();
  return !stripped || /^[(){}\[\].,;:|/-]+$/.test(stripped);
}

function splitAuthorNames(value: string) {
  return stripControlChars(value || "")
    .replace(/\.[Pp][Dd][Ff]$/, "")
    .replace(/\^\{[^}]+\}/g, " ")
    .replace(/_/g, " ")
    .replace(/[†‡§*¹²³⁴⁵⁶⁷⁸⁹⁰]/g, " ")
    .replace(/(?<=[A-Za-z])\d+(?=\b|[,;])/g, " ")
    .replace(/\([^)]*(?:email|@|university|institute|department|laboratory|college|school|faculty|centre|center|address|affiliation)[^)]*\)/gi, " ")
    .replace(/\bet\s+al\.?/gi, " ")
    .replace(/\b\d+\b/g, " ")
    .replace(/\s+/g, " ")
    .split(/\s*(?:;|&|\band\b|,(?=\s*(?:[A-Z]\.?|[A-Z][A-Za-z.'-]+)(?:\s|$)))\s*/i)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) =>
      Boolean(part) &&
      !/@/.test(part) &&
      !/\b(university|institute|department|laboratory|college|school|faculty|centre|center|press|journal|received|accepted|abstract)\b/i.test(part) &&
      /[A-Za-z]{2}/.test(part)
    )
    .slice(0, 30);
}

function isUsefulTitleHint(value?: string) {
  const cleaned = cleanDisplayTitle(value).title;
  if (cleaned.length < 8 || cleaned.length > 220) return false;
  if (looksLikeJournalCitation(cleaned)) return false;
  if (/^(untitled|unknown|arxiv|paper|document)$/i.test(cleaned)) return false;
  if (/^[a-z]+[0-9]{2,}$/i.test(cleaned)) return false;
  if (/^\d{4}\.\d{4,5}(v\d+)?$/i.test(cleaned)) return false;
  if (!/[A-Za-z]{4}/.test(cleaned)) return false;
  return true;
}

function isUsefulAuthorHint(value?: string) {
  const cleaned = cleanMetadataText(value);
  if (cleaned.length < 3 || cleaned.length > 300) return false;
  if (/^(unknown|anonymous|admin|root|user|owner)$/i.test(cleaned)) return false;
  if (/@|\b(university|institute|department|laboratory|college|school|press|journal)\b/i.test(cleaned)) return false;
  if (!/[A-Za-z]{2}/.test(cleaned)) return false;
  return true;
}

function manuscriptHeaderText(paperContent: string) {
  const cleaned = stripControlChars(paperContent).replace(/\r\n/g, "\n");
  const lines = cleaned.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 80);
  const abstractIndex = lines.findIndex((line) => /^abstract\b/i.test(line));
  return (abstractIndex > 0 ? lines.slice(0, abstractIndex) : lines.slice(0, 40)).filter((line) =>
    !/^(arxiv:|doi:|submitted by\b|submitted to\b|keywords?\b|pacs\b|msc\b)/i.test(line) &&
    !looksLikeJournalCitation(line) &&
    !/^\s*(?:[a-z-]+\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?\s*$/i.test(line) &&
    !isOnlyReportCodeLine(line) &&
    !/\b\d{1,2}\s+[A-Z][a-z]{2,8}\s+\d{4}\b/.test(line) &&
    !/^[A-Za-z-]+\/[A-Za-z.-]+\d+v\d+/i.test(line),
  );
}

function heuristicMetadata(paperContent: string, hints: MetadataHints = {}) {
  const headerLines = manuscriptHeaderText(paperContent);

  const looksLikeAffiliation = (line: string) =>
    /@|\b(university|institute|department|laboratory|college|school|faculty|centre|center)\b/i.test(line);

  const looksLikeTitleContinuation = (previousLine: string, nextLine: string) => {
    if (!previousLine || !nextLine) return false;
    const prev = previousLine.trim();
    const next = nextLine.trim();
    return (
      /\b(of|and|for|in|on|with|from|to|the|a|an)$/i.test(prev) ||
      /^[a-z(]/.test(next)
    );
  };

  const looksLikeAuthorLine = (line: string) => {
    const sanitized = line
      .replace(/\^\{[^}]+\}/g, " ")
      .replace(/[†‡§*¹²³⁴⁵⁶⁷⁸⁹⁰]/g, " ")
      .replace(/(?<=[A-Za-z])\d+(?=\b|[,;])/g, " ")
      .replace(/\b\d+\b/g, " ")
      .replace(/\([^)]*(?:university|institute|department|laboratory|college|school|faculty|centre|center|email|@|address|affiliation)[^)]*\)/gi, " ")
      .replace(/\bet\s+al\.?/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (looksLikeAffiliation(sanitized) || /^abstract\b/i.test(sanitized)) return false;
    if (sanitized.length < 3 || sanitized.length > 220) return false;
    if (!/[A-Za-z]/.test(sanitized)) return false;
    const normalized = sanitized.replace(/\band\b/gi, ",").replace(/\s+/g, " ").trim();
    const parts = normalized.split(",").map((part) => part.trim()).filter(Boolean);
    if (parts.length === 0 || parts.length > 10) return false;
    const hasInitial = /\b[A-Z]\./.test(sanitized);

    return parts.every((part) => {
      const tokens = part.split(/\s+/).filter(Boolean);
      if (tokens.length < 1 || tokens.length > 6) return false;
      const allNameStyle = tokens.every((token) => /^[A-Z][A-Za-z.'-]*$|^[A-Z]\.?$/.test(token));
      const nameLike = tokens.filter((token) => /^[A-Z][A-Za-z.'-]*$|^[A-Z]\.?$/.test(token)).length;
      if (hasInitial) return nameLike >= Math.max(1, Math.ceil(tokens.length * 0.6));
      return allNameStyle && nameLike === tokens.length;
    });
  };

  const titleStartIndex = headerLines.findIndex((line) =>
    line.length >= 8 &&
    line.length <= 220 &&
    !looksLikeAffiliation(line) &&
    !looksLikeAuthorLine(line) &&
    !/^abstract\b/i.test(line),
  );

  const titleLines: string[] = [];
  if (titleStartIndex !== -1) {
    for (const line of headerLines.slice(titleStartIndex)) {
      const previousLine = titleLines[titleLines.length - 1] || "";
      if ((looksLikeAuthorLine(line) && !looksLikeTitleContinuation(previousLine, line)) || looksLikeAffiliation(line) || /^abstract\b/i.test(line)) break;
      if (line.length < 3 || line.length > 220) break;
      titleLines.push(line);
      if (titleLines.join(" ").length >= 220) break;
    }
  }

  const headerTitle = titleLines.length > 0 ? cleanDisplayTitle(titleLines.join(" ")).title : "";
  const titleCandidate =
    (isUsefulTitleHint(headerTitle) ? headerTitle : "") ||
    (isUsefulTitleHint(hints.pdfTitle) ? cleanDisplayTitle(hints.pdfTitle).title : "") ||
    (isUsefulTitleHint(hints.fileName) ? cleanDisplayTitle(hints.fileName).title : "") ||
    "Unknown Title";

  const authorStartIndex = titleStartIndex === -1 ? -1 : titleStartIndex + titleLines.length;
  const authorLines: string[] = [];
  if (authorStartIndex !== -1) {
    let skippedNonAuthorLines = 0;
    for (const line of headerLines.slice(authorStartIndex, authorStartIndex + 10)) {
      if (looksLikeAffiliation(line) || /^abstract\b/i.test(line)) break;
      if (!looksLikeAuthorLine(line)) {
        skippedNonAuthorLines += 1;
        if (authorLines.length > 0 || skippedNonAuthorLines > 1) break;
        continue;
      }
      authorLines.push(line);
    }
  }

  const headerAuthors = authorLines.length > 0
    ? authorLines.join(", ").replace(/\s*,\s*/g, ", ").replace(/\s+/g, " ").trim()
    : "";
  const authorCandidate =
    headerAuthors ||
    (isUsefulAuthorHint(hints.pdfAuthor) ? cleanMetadataText(hints.pdfAuthor) : "") ||
    "Unknown Authors";

  return {
    title: titleCandidate,
    authors: authorCandidate,
  };
}

function reviewInputText(input: ReviewInput) {
  return typeof input === "string" ? input : input.text;
}

function reviewExtractionMethod(input: ReviewInput) {
  return typeof input === "string" ? "text-extraction" : "gemini-native-pdf-fallback";
}

function reviewInputParts(input: ReviewInput) {
  if (typeof input === "string") return [{ text: input }];
  return [
    { text: input.text },
    {
      inlineData: {
        mimeType: input.mimeType || "application/pdf",
        data: input.pdfBase64,
      },
    },
  ];
}

function blindReviewInput(input: ReviewInput): ReviewInput {
  if (typeof input === "string") return blindManuscriptText(input);
  return {
    ...input,
    text: `${blindManuscriptText(input.text)}

The manuscript is attached as a PDF because plain text extraction was not reliable. Read the attached PDF directly. If author names, affiliations, venue names, or citation/reception signals appear in the PDF, ignore them under the anonymity rules. Base the review only on the manuscript's scientific content.`,
  };
}

export function buildPdfFallbackText(hints: MetadataHints) {
  return [
    "Plain-text extraction from this PDF was not reliable, so the manuscript PDF is attached for Gemini-native reading.",
    hints.fileName ? `Filename hint: ${hints.fileName}` : "",
    hints.pdfTitle ? `Embedded PDF title hint: ${hints.pdfTitle}` : "",
    hints.pdfAuthor ? `Embedded PDF author hint: ${hints.pdfAuthor}` : "",
  ].filter(Boolean).join("\n");
}

async function callGpt(prompt: string, input: ReviewInput) {
  if (typeof input !== "string") {
    throw new Error("OpenAI review currently requires extractable PDF text. Try the Gemini review pipeline for this PDF.");
  }
  return withModelRetries(GPT_MODEL, async () => {
    const response = await getOpenAI().chat.completions.create({
      model: GPT_MODEL,
      max_completion_tokens: 8192,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: input },
      ],
    });
    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("No response from GPT model.");
    return { parsed: extractJson(content), thinkingText: null as string | null };
  });
}

async function callGemini(
  prompt: string,
  input: ReviewInput,
  geminiModel = GEMINI_META_MODEL,
  options?: { maxOutputTokens?: number; includeThoughts?: boolean; responseJsonSchema?: unknown; temperature?: number },
) {
  const includeThoughts = options?.includeThoughts ?? false;
  const request = async (useResponseSchema: boolean) => {
    const response = await geminiAI.models.generateContent({
      model: geminiModel,
      contents: [{ role: "user", parts: reviewInputParts(input) }],
      config: {
        systemInstruction: prompt,
        responseMimeType: "application/json",
        ...(useResponseSchema && options?.responseJsonSchema ? { responseJsonSchema: options.responseJsonSchema } : {}),
        temperature: options?.temperature ?? 0.2,
        maxOutputTokens: options?.maxOutputTokens ?? 32768,
        ...(includeThoughts ? { thinkingConfig: { includeThoughts: true, thinkingLevel: "HIGH" } } : {}),
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
  };

  try {
    return await withModelRetries(geminiModel, () => request(true));
  } catch (error) {
    if (options?.responseJsonSchema && isSchemaRejectedError(error)) {
      return withModelRetries(`${geminiModel} without response schema`, () => request(false));
    }
    throw error;
  }
}

async function runModel(prompt: string, input: ReviewInput, model: ReviewModel, geminiModel = GEMINI_META_MODEL) {
  return model === "gemini" ? callGemini(prompt, input, geminiModel) : callGpt(prompt, input);
}

async function runIndividualPass(
  prompt: string,
  input: ReviewInput,
  _model: ReviewModel,
  index: number,
): Promise<IndividualPassResult> {
  const { parsed, thinkingText } = await callGemini(
    prompt,
    input,
    GEMINI_PASS_MODEL,
    {
      maxOutputTokens: 16384,
      includeThoughts: false,
      responseJsonSchema: individualReviewJsonSchema,
      temperature: 0.15,
    },
  );
  const review = normalizeIndividualReview(parsed);
  validateIndividualReview(review);
  return {
    review,
    thinkingText,
    index,
    modelName: GEMINI_PASS_MODEL,
  };
}

async function runPassWithGenerationRetries(
  prompt: string,
  input: ReviewInput,
  index: number,
): Promise<IndividualPassResult> {
  let lastError: unknown;
  for (let attempt = 0; attempt < PASS_GENERATION_ATTEMPTS; attempt += 1) {
    try {
      return await runIndividualPass(prompt, input, "gemini", index);
    } catch (reason) {
      lastError = reason;
      if (attempt < PASS_GENERATION_ATTEMPTS - 1) {
        await sleep(passAttemptDelayMs(attempt, reason));
      }
    }
  }
  throw new Error(`pass ${index + 1} failed after ${PASS_GENERATION_ATTEMPTS} generation attempts: ${errorMessage(lastError)}`);
}

function buildReplacementPassPrompt(basePrompt: string, failures: { reason: unknown; index: number }[]) {
  const recentFailures = failures
    .slice(-4)
    .map(({ reason, index }) => `attempt ${index + 1}: ${errorMessage(reason)}`)
    .join("\n");

  return `${basePrompt}

RECOVERY INSTRUCTION FOR THIS REPLACEMENT PASS:
Earlier independent pass attempts for this same manuscript failed validation or API parsing and were discarded:
${recentFailures || "No detailed failure message was available."}

Return only one valid JSON object matching the requested schema. Keep the review concise enough to fit in the response budget, but include the required scientific reasoning fields. Do not emit Markdown fences, prose outside JSON, trailing commentary, blank fields for the main review, or a score of 0 unless the reasoning explicitly establishes a paper-fatal failure with no substantial separable contribution surviving.`;
}

function pickRepresentativeReview(reviews: IndividualReview[], medianScore: number) {
  return [...reviews].sort((a, b) => {
    const aDelta = Math.abs(a.scoreBand.median - medianScore);
    const bDelta = Math.abs(b.scoreBand.median - medianScore);
    return aDelta - bDelta;
  })[0];
}

function medianScore(scores: number[]) {
  const sorted = [...scores].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[midpoint];
  return Math.round((sorted[midpoint - 1] + sorted[midpoint]) / 2);
}

function normalizeAggregateReview(input: unknown, fallbackScores: number[], fallbackReview: IndividualReview): AggregateReview {
  const root = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const source = root.finalIntrinsicReview && typeof root.finalIntrinsicReview === "object"
    ? (root.finalIntrinsicReview as Record<string, unknown>)
    : root;
  const adjudicationSource = root.reviewPassComparison && typeof root.reviewPassComparison === "object"
    ? (root.reviewPassComparison as Record<string, unknown>)
    : root.adjudication && typeof root.adjudication === "object"
      ? (root.adjudication as Record<string, unknown>)
      : root;
  const comparatorProfileSource = root.comparatorProfile && typeof root.comparatorProfile === "object"
    ? (root.comparatorProfile as Record<string, unknown>)
    : source.comparatorProfile && typeof source.comparatorProfile === "object"
      ? (source.comparatorProfile as Record<string, unknown>)
      : {};
  const aggregateIcoAssessment = source.inputConstructionOutputAssessment && typeof source.inputConstructionOutputAssessment === "object"
    ? (source.inputConstructionOutputAssessment as Record<string, unknown>)
    : {};
  const aggregateIcoInput = aggregateIcoAssessment.input && typeof aggregateIcoAssessment.input === "object"
    ? (aggregateIcoAssessment.input as Record<string, unknown>)
    : {};
  const aggregateIcoConstruction = aggregateIcoAssessment.construction && typeof aggregateIcoAssessment.construction === "object"
    ? (aggregateIcoAssessment.construction as Record<string, unknown>)
    : {};
  const aggregateIcoOutput = aggregateIcoAssessment.output && typeof aggregateIcoAssessment.output === "object"
    ? (aggregateIcoAssessment.output as Record<string, unknown>)
    : {};
  const aggregateTechnicalAssessment = source.technicalAssessment && typeof source.technicalAssessment === "object"
    ? (source.technicalAssessment as Record<string, unknown>)
    : {};
  const aggregateTechnicalFrameworkDependence = aggregateTechnicalAssessment.frameworkDependence && typeof aggregateTechnicalAssessment.frameworkDependence === "object"
    ? (aggregateTechnicalAssessment.frameworkDependence as Record<string, unknown>)
    : {};
  const aggregateFailureAnalysis = source.failureAnalysis && typeof source.failureAnalysis === "object"
    ? (source.failureAnalysis as Record<string, unknown>)
    : root.failureAnalysis && typeof root.failureAnalysis === "object"
      ? (root.failureAnalysis as Record<string, unknown>)
      : {};
  const aggregateLedger = source.inputConstructionOutputLedger && typeof source.inputConstructionOutputLedger === "object"
    ? (source.inputConstructionOutputLedger as Record<string, unknown>)
    : {};
  const aggregateIcoInputOverallAssessment = firstString([
    aggregateIcoInput.overallAssessment,
    aggregateIcoInput.assessment,
    aggregateLedger.inputOverallAssessment,
    fallbackReview.inputConstructionOutputLedger.inputOverallAssessment,
  ]);
  const aggregateIcoConstructionOverallAssessment = firstString([
    aggregateIcoConstruction.overallAssessment,
    aggregateIcoConstruction.assessment,
    aggregateLedger.constructionOverallAssessment,
    fallbackReview.inputConstructionOutputLedger.constructionOverallAssessment,
  ]);
  const aggregateIcoOutputOverallAssessment = firstString([
    aggregateIcoOutput.overallAssessment,
    aggregateIcoOutput.assessment,
    aggregateLedger.outputOverallAssessment,
    aggregateLedger.assessment,
    fallbackReview.inputConstructionOutputLedger.outputOverallAssessment,
    fallbackReview.inputConstructionOutputLedger.assessment,
  ]);
  const aggregateFramework = source.frameworkConditionality && typeof source.frameworkConditionality === "object"
    ? (source.frameworkConditionality as Record<string, unknown>)
    : {};
  const aggregateOutputValidityAssessment = normalizeOutputValidityAssessment(
    source.outputValidityAssessment ?? root.outputValidityAssessment ?? source.outputValidity ?? root.outputValidity,
    fallbackReview.outputValidityAssessment,
  );
  const aggregateLegacyDirectOutputs = firstStringArray([
    aggregateLedger.directOutputs,
    source.directOutputs,
    fallbackReview.inputConstructionOutputLedger.directOutputs,
  ]);
  const aggregateLegacyExternalEmbeddingsAndChecks = firstStringArray([
    aggregateLedger.externalEmbeddingsAndChecks,
    source.externalEmbeddingsAndChecks,
    fallbackReview.inputConstructionOutputLedger.externalEmbeddingsAndChecks,
  ]);
  const preliminaryAggregateCentralOutputDependency = normalizeCentralOutputDependency(
    source.centralOutputDependency ?? root.centralOutputDependency,
    fallbackReview.centralOutputDependency,
  );
  const aggregateLedgerOutputs = normalizeLedgerOutputs(aggregateIcoOutput.outputs ?? aggregateLedger.outputs ?? source.outputs, {
    legacyDirectOutputs: aggregateLegacyDirectOutputs,
    legacyExternalContext: aggregateLegacyExternalEmbeddingsAndChecks,
    centralOutputDependency: preliminaryAggregateCentralOutputDependency,
    outputValidityAssessment: aggregateOutputValidityAssessment,
  });
  const aggregateCentralOutputDependency = normalizeCentralOutputDependency(
    source.centralOutputDependency ?? root.centralOutputDependency ?? {
      centralOutput: aggregateLedgerOutputs[0]?.output ?? "",
      requiredPrimitiveInputs: aggregateLedgerOutputs[0]?.dependsOnInputs ?? [],
      requiredIntroducedConstructions: aggregateLedgerOutputs[0]?.dependsOnConstructions ?? [],
      dependencyAssessment: aggregateLedgerOutputs[0]?.support ?? "",
      constructionFragility: "",
      outputValidity: aggregateLedgerOutputs[0]?.validity ?? asString(source.outputValidity ?? root.outputValidity),
      assessment: aggregateLedgerOutputs[0]?.support ?? "",
    },
    fallbackReview.centralOutputDependency,
  );
  const individualScoreSource = Array.isArray(adjudicationSource.individualScores)
    ? adjudicationSource.individualScores
    : Array.isArray(root.individualScores)
      ? root.individualScores
      : source.individualScores;
  const individualScores = Array.isArray(individualScoreSource)
    ? (individualScoreSource as unknown[]).map((item) => Math.round(asNumber(item, 0, 0, 100))).filter((item) => Number.isFinite(item))
    : fallbackScores;
  const usableScores = individualScores.length > 0
    ? individualScores
    : fallbackScores.length > 0
      ? fallbackScores
      : [fallbackReview.scoreBand.median];
  const defaultLow = Math.min(...usableScores);
  const defaultHigh = Math.max(...usableScores);
  const defaultMedian = medianScore(usableScores);
  const explicitAggregateScore = firstNumber([
    root.intrinsicScore,
    source.intrinsicScore,
    root.adjudicatorRating,
    source.adjudicatorRating,
    root.finalCalibratedScore,
    source.finalCalibratedScore,
    root.finalScore,
    source.finalScore,
  ]);
  const parsedBand = normalizeScoreBand(
    source.blindIntrinsicScoreBand ??
      source.finalScoreBand ??
      source.intrinsicScoreBand ??
      root.intrinsicScoreBand ??
      source.scoreBand ??
      (explicitAggregateScore != null
        ? { low: explicitAggregateScore, median: explicitAggregateScore, high: explicitAggregateScore }
        : undefined),
  );
  let finalScoreBand = parsedBand.low === 0 && parsedBand.median === 0 && parsedBand.high === 0
    ? { low: defaultLow, median: defaultMedian, high: defaultHigh }
    : parsedBand;
  const validPassDisagreement = fallbackScores.length >= 2
    ? Math.max(...fallbackScores) - Math.min(...fallbackScores)
    : null;
  const scoreRange = validPassDisagreement ?? Math.round(asNumber(
    adjudicationSource.passDisagreement ?? adjudicationSource.scoreRange ?? root.passDisagreement ?? source.scoreRange,
    finalScoreBand.high - finalScoreBand.low,
    0,
    100,
  ));
  const scoreStability: ScoreStability = rangeToStability(scoreRange);
  const classification =
    normalizeClassification(root.bestClassification) ||
    normalizeClassification(root.finalClassification) ||
    normalizeClassification(source.finalClassification) ||
    normalizeClassification(source.bestClassification) ||
    fallbackReview.bestClassification ||
    classificationFallbackFromScore(finalScoreBand.median);
  const finalClassification = applyClassificationConsistency(
    alignClassificationToScore(classification, finalScoreBand.median),
    finalScoreBand.median,
    {
      frameworkLevel: fallbackReview.frameworkConditionality.level,
      frameworkIndependence: asString(source.frameworkIndependenceAssessment, fallbackReview.frameworkIndependence),
      frameworkConditionality: asString(source.frameworkConditionalityAssessment, fallbackReview.frameworkConditionality.explanation),
      survivingContribution: asString(source.survivingContributionIfFlawed, fallbackReview.survivingContributionIfFlawed),
      paperType: fallbackReview.paperType,
      manuscriptOriginalContribution: asString(source.originalContributionAssessment, fallbackReview.manuscriptOriginalContribution),
    },
  );
  const aggregateSubscoreSource = { ...root, ...source };
  const aggregateSubscoreValidity = diagnosticSubscoreValidity(aggregateSubscoreSource);
  const aggregateSubscores = {
    inputStrengthScore: normalizeDiagnosticSubscore(
      firstNumberField(aggregateSubscoreSource, ["inputStrengthScore", "intrinsicTechnicalScore"]),
      fallbackReview.inputStrengthScore,
    ),
    constructionStrengthScore: normalizeDiagnosticSubscore(
      firstNumberField(aggregateSubscoreSource, ["constructionStrengthScore", "explanatoryTargetBreadthScore"]),
      fallbackReview.constructionStrengthScore,
    ),
    outputStrengthScore: normalizeDiagnosticSubscore(
      firstNumberField(aggregateSubscoreSource, [
        "outputStrengthScore",
        "outputReachScore",
        "theorySpaceBreadthScore",
        "generalizationBreadthScore",
        "breadthOfImpactScore",
      ]),
      fallbackReview.outputStrengthScore,
    ),
    outputReachScore: normalizeDiagnosticSubscore(
      firstNumberField(aggregateSubscoreSource, ["outputReachScore", "theorySpaceBreadthScore"]),
      fallbackReview.outputStrengthScore,
    ),
    generalizationBreadthScore: normalizeDiagnosticSubscore(
      firstNumberField(aggregateSubscoreSource, ["generalizationBreadthScore", "breadthOfImpactScore"]),
      fallbackReview.outputStrengthScore,
    ),
  };
  const aggregateLegacySubscores = {
    intrinsicTechnicalScore: normalizeDiagnosticSubscore(source.intrinsicTechnicalScore, aggregateSubscores.inputStrengthScore),
    explanatoryTargetBreadthScore: normalizeDiagnosticSubscore(source.explanatoryTargetBreadthScore, aggregateSubscores.constructionStrengthScore),
    theorySpaceBreadthScore: normalizeDiagnosticSubscore(source.theorySpaceBreadthScore, aggregateSubscores.outputStrengthScore),
    breadthOfImpactScore: normalizeDiagnosticSubscore(source.breadthOfImpactScore, aggregateSubscores.outputStrengthScore),
  };
  const aggregateSubscoreRationale = normalizeSubscoreRationale(source.subscoreRationale ?? root.subscoreRationale);
  let scoreCappingReason = firstString([root.scoreCappingReason, source.scoreCappingReason, source.score_capping_reason]);
  let scoreAdjustmentReason = firstString([
    root.scoreAdjustmentReason,
    source.scoreAdjustmentReason,
    source.score_adjustment_reason,
    root.scoreAdjustmentRationale,
    source.scoreAdjustmentRationale,
  ]);
  const contributionInventory = normalizeContributionInventory(
    root.contributionInventory ?? source.contributionInventory ?? aggregateFailureAnalysis.contributionInventory ?? adjudicationSource.contributionInventory,
  );
  const survivingHighValueContributions = firstStringArray([
    aggregateFailureAnalysis.survivingHighValueContributions,
    root.survivingHighValueContributions,
    source.survivingHighValueContributions,
    adjudicationSource.survivingHighValueContributions,
  ]);
  const inventorySurvivors = survivingInventoryContributions(contributionInventory).map((item) => item.claimOrContribution);
  const failedClaimsExcludedFromScore = firstStringArray([
    aggregateFailureAnalysis.failedClaimsExcludedFromScore,
    root.failedClaimsExcludedFromScore,
    source.failedClaimsExcludedFromScore,
    adjudicationSource.failedClaimsExcludedFromScore,
  ]);
  const survivingContributionScoreBasis = firstString([
    aggregateFailureAnalysis.survivingContributionScoreBasis,
    root.survivingContributionScoreBasis,
    source.survivingContributionScoreBasis,
    adjudicationSource.survivingContributionScoreBasis,
  ]);
  const subscoreSaturationWarning =
    asBoolean(adjudicationSource.subscoreSaturationWarning) ||
    computeSubscoreSaturationWarning(diagnosticSubscoreValues(aggregateSubscores), aggregateSubscoreValidity);
  let fatalObjectionPresent = asBoolean(
    adjudicationSource.fatalObjectionPresent ?? aggregateFailureAnalysis.fatalObjectionPresent ?? root.fatalObjectionPresent ?? source.fatalObjectionPresent,
  );
  const fatalToSpecificClaimOnly = asBoolean(
    adjudicationSource.fatalToSpecificClaimOnly ?? aggregateFailureAnalysis.fatalToSpecificClaimOnly ?? root.fatalToSpecificClaimOnly ?? source.fatalToSpecificClaimOnly,
  );
  let paperFatalError = asBoolean(
    adjudicationSource.paperFatalError ?? aggregateFailureAnalysis.paperFatalError ?? root.paperFatalError ?? source.paperFatalError,
  );
  const fatalObjectionAssessment = asString(
    adjudicationSource.fatalObjectionAssessment ?? root.fatalObjectionAssessment ?? source.fatalObjectionAssessment,
  );
  const survivingContribution = asString(source.survivingContributionIfFlawed, fallbackReview.survivingContributionIfFlawed);
  const allSurvivingHighValueContributions = [...survivingHighValueContributions, ...inventorySurvivors]
    .filter((item, index, array) => item && array.indexOf(item) === index);
  const hasSubstantialSurvivingContribution =
    allSurvivingHighValueContributions.length > 0 ||
    describesSubstantialSurvivingContribution(survivingContribution) ||
    describesSubstantialSurvivingContribution(survivingContributionScoreBasis);

  const fatalCapText = scoreCappingFatalLanguage(scoreCappingReason);
  const adjudicationRepairNotes: string[] = [];
  const diagnosticAverage =
    diagnosticSubscoreValues(aggregateSubscores).reduce((sum, value) => sum + value, 0) /
    diagnosticSubscoreValues(aggregateSubscores).length;
  const baselineScore = diagnosticBaselineScore(diagnosticSubscoreValues(aggregateSubscores));
  const baselineDelta = Math.round(finalScoreBand.median - baselineScore);

  if (!fatalObjectionPresent && fatalCapText) {
    if (paperFatalError && !hasSubstantialSurvivingContribution) {
      fatalObjectionPresent = true;
      adjudicationRepairNotes.push(
        "Repaired inconsistent adjudication flags: scoreCappingReason and paperFatalError indicated a paper-fatal cap, but fatalObjectionPresent was false.",
      );
    } else {
      scoreCappingReason = "";
      adjudicationRepairNotes.push(
        "Removed contradictory paper-fatal score-capping language because fatalObjectionPresent was false and the review did not establish a paper-fatal error.",
      );
    }
  }

  if (saysObjectionNotPaperFatal(fatalObjectionAssessment) && finalScoreBand.median < 30 && scoreCappingFatalLanguage(scoreCappingReason)) {
    scoreCappingReason = "";
    paperFatalError = false;
    adjudicationRepairNotes.push(
      "Removed paper-fatal cap language because fatalObjectionAssessment says the objection is not paper-fatal.",
    );
  }

  if (usableScores.length >= 2 && usableScores.every((score) => score > 90) && diagnosticAverage > 9 && !fatalObjectionPresent && finalScoreBand.median < 50) {
    throw new Error("Contradictory adjudication: high blind pass scores and high diagnostics were collapsed below 50 without a fatal objection.");
  }

  if (hasSubstantialSurvivingContribution && scoreCappingFatalLanguage(scoreCappingReason)) {
    scoreCappingReason = "";
    paperFatalError = false;
    adjudicationRepairNotes.push(
      "Removed paper-fatal cap language because the adjudication identified substantial surviving high-value contributions.",
    );
  }

  if (paperFatalError && hasSubstantialSurvivingContribution) {
    throw new Error("Contradictory adjudication: paperFatalError is true even though high-value separable contributions survive.");
  }

  let adjustedFinalClassification = finalClassification;
  const fatalCapAllowed = paperFatalError || (fatalObjectionPresent && !hasSubstantialSurvivingContribution);
  if (fatalCapAllowed && finalScoreBand.median > 15) {
    finalScoreBand = {
      low: Math.min(finalScoreBand.low, 15),
      median: Math.min(finalScoreBand.median, 15),
      high: Math.min(finalScoreBand.high, 15),
    };
    adjustedFinalClassification = "not yet convincing";
    scoreCappingReason = scoreCappingReason || `Paper-fatal error with no substantial separable contribution surviving. ${fatalObjectionAssessment}`.trim();
  }

  const subscoreConsistencyWarning =
    firstString([adjudicationSource.subscoreConsistencyWarning, source.subscoreConsistencyWarning]) ||
    computeSubscoreConsistencyWarning({
      finalMedian: finalScoreBand.median,
      scores: diagnosticSubscoreValues(aggregateSubscores),
      validity: aggregateSubscoreValidity,
      scoreCappingReason,
      scoreAdjustmentReason,
      ledgerOutputs: aggregateLedgerOutputs,
    });
  const scoreAdjustmentText = firstString([
    scoreCappingReason,
    scoreAdjustmentReason,
    survivingContributionScoreBasis,
    asString(source.internalCalibrationNotes ?? adjudicationSource.calibrationAdjustments),
  ]);
  const scoringAnomaly = Math.abs(baselineDelta) > 12 && !hasExplicitScoreAdjustmentReason(scoreAdjustmentText)
    ? `Final score ${finalScoreBand.median} differs from diagnostic baseline ${baselineScore} by ${baselineDelta > 0 ? "+" : ""}${baselineDelta} without a valid explicit adjustment rationale.`
    : "";
  if (!scoreAdjustmentReason && Math.abs(baselineDelta) > 8 && hasExplicitScoreAdjustmentReason(scoreAdjustmentText)) {
    scoreAdjustmentReason = scoreAdjustmentText;
  }

  return {
    finalComparisonCohort: asString(source.finalComparisonCohort ?? source.comparisonCohort, fallbackReview.comparisonCohort),
    finalLocalCohort: asString(
      source.finalLocalCohort ?? source.localCohort ?? root.localCohort,
      fallbackReview.localCohort || fallbackReview.comparisonCohort,
    ),
    finalBroadField: asString(source.finalBroadField ?? source.broadField, fallbackReview.broadField),
    finalSpecialtyField: asString(source.finalSpecialtyField ?? source.specialtyField, fallbackReview.specialtyField),
    finalSummary: firstString([
      source.scientificReview,
      source.publicScientificReview,
      source.publicReview,
      source.finalSummary,
      source.summary,
      fallbackReview.scientificReview,
      fallbackReview.summary,
    ]),
    finalCentralClaim: asString(source.centralClaim, fallbackReview.centralClaim),
    scientificReview: firstString([
      root.scientificReview,
      source.scientificReview,
      source.publicScientificReview,
      root.publicOneParagraphVerdict,
      source.publicOneParagraphVerdict,
      source.oneParagraphVerdict,
      source.finalJudgment,
      fallbackReview.scientificReview,
      fallbackReview.oneParagraphVerdict,
      fallbackReview.finalJudgment,
      source.summary,
    ]),
    contributionArchetype: normalizeContributionArchetype(source.contributionArchetype, fallbackReview.contributionArchetype),
    inputConstructionOutputLedger: {
      primitiveInputs: normalizePrimitiveInputs([
        aggregateIcoInput.primitiveInputs,
        aggregateLedger.primitiveInputs,
        source.primitiveInputs,
        fallbackReview.inputConstructionOutputLedger.primitiveInputs,
      ]),
      introducedConstructions: normalizeIntroducedConstructions([
        aggregateIcoConstruction.introducedConstructions,
        aggregateLedger.introducedConstructions,
        source.introducedConstructions,
        fallbackReview.inputConstructionOutputLedger.introducedConstructions,
      ]),
      outputs: aggregateLedgerOutputs,
      inputOverallAssessment: aggregateIcoInputOverallAssessment,
      constructionOverallAssessment: aggregateIcoConstructionOverallAssessment,
      outputOverallAssessment: aggregateIcoOutputOverallAssessment,
      whyOutputsMatter: firstString([
        aggregateIcoOutput.whyOutputsMatter,
        aggregateLedger.whyOutputsMatter,
        aggregateLedger.downstreamReach,
        source.whyOutputsMatter,
        source.downstreamReach,
        fallbackReview.inputConstructionOutputLedger.whyOutputsMatter,
        fallbackReview.inputConstructionOutputLedger.downstreamReach,
      ]),
      externalEmbeddingsAndChecks: aggregateLegacyExternalEmbeddingsAndChecks,
      directOutputs: aggregateLegacyDirectOutputs.length > 0 ? aggregateLegacyDirectOutputs : aggregateLedgerOutputs.map((item) => item.output),
      downstreamReach: firstString([
        aggregateLedger.downstreamReach,
        aggregateLedger.whyOutputsMatter,
        source.downstreamReach,
        source.whyOutputsMatter,
        fallbackReview.inputConstructionOutputLedger.downstreamReach,
        fallbackReview.inputConstructionOutputLedger.whyOutputsMatter,
      ]),
      assessment: firstString([
        aggregateLedger.assessment,
        aggregateIcoAssessment.assessment,
        [aggregateIcoInputOverallAssessment, aggregateIcoConstructionOverallAssessment, aggregateIcoOutputOverallAssessment].filter(Boolean).join("\n\n"),
        source.inputConstructionOutputAssessment,
        fallbackReview.inputConstructionOutputLedger.assessment,
      ]),
      centralOutputDependency: aggregateCentralOutputDependency,
      outputValidityAssessment: aggregateOutputValidityAssessment,
    },
    centralOutputDependency: aggregateCentralOutputDependency,
    outputValidityAssessment: aggregateOutputValidityAssessment,
    nearestComparators: [],
    externalComparatorSuggestions: [],
    publicComparatorSummary: "",
    adminComparatorNotes: "",
    comparatorProfile: normalizeComparatorProfile(comparatorProfileSource, fallbackReview),
    comparatorCalibration: defaultComparatorCalibration(finalScoreBand, adjustedFinalClassification, "No comparator calibration pass has run yet."),
    blindIntrinsicScoreBand: finalScoreBand,
    adjudication: {
      adjudicatorStatus: "success",
      individualScores: usableScores,
      scoreRange,
      scoreStability,
      mainAgreements: firstStringArray([adjudicationSource.mainAgreements, source.mainAgreements]),
      mainDisagreements: firstStringArray([adjudicationSource.mainDisagreements, source.mainDisagreements]),
      fatalObjectionPresent,
      fatalObjectionAssessment,
      fatalToSpecificClaimOnly,
      paperFatalError,
      contributionInventory,
      survivingHighValueContributions: allSurvivingHighValueContributions,
      failedClaimsExcludedFromScore,
      survivingContributionScoreBasis,
      calibrationAdjustments: asString(source.internalCalibrationNotes),
      subscoreConsistencyWarning,
      subscoreSaturationWarning,
      diagnosticBaselineScore: baselineScore,
      diagnosticBaselineDelta: baselineDelta,
      scoreAdjustmentReason,
      scoringAnomaly,
    },
    adjudicatorStatus: "success",
    individualScores: usableScores,
    scoreRange,
    scoreStability,
    mainAgreements: firstStringArray([adjudicationSource.mainAgreements, source.mainAgreements]),
    mainDisagreements: firstStringArray([adjudicationSource.mainDisagreements, source.mainDisagreements]),
    fatalObjectionPresent,
    fatalObjectionAssessment,
    fatalToSpecificClaimOnly,
    paperFatalError,
    contributionInventory,
    survivingHighValueContributions: allSurvivingHighValueContributions,
    failedClaimsExcludedFromScore,
    survivingContributionScoreBasis,
    inputGroundingAssessment: asString(source.inputGroundingAssessment ?? source.inputGrounding ?? aggregateIcoInput.assessment, fallbackReview.inputGrounding),
    inputFundamentalityAssessment: asString(source.inputFundamentalityAssessment ?? source.inputFundamentality ?? aggregateIcoInput.assessment, fallbackReview.inputFundamentality),
    constructionAssessment: asString(source.constructionAssessment ?? aggregateIcoConstruction.assessment, fallbackReview.constructionAssessment),
    outputValidity: firstString([
      source.outputValidity,
      root.outputValidity,
      aggregateOutputValidityAssessment.assessment,
      aggregateCentralOutputDependency.outputValidity,
      fallbackReview.outputValidity,
    ]),
    contributionGroundingType: asString(source.contributionGroundingType, fallbackReview.contributionGroundingType),
    frameworkIndependenceAssessment: asString(source.frameworkIndependenceAssessment ?? source.frameworkIndependence ?? aggregateTechnicalFrameworkDependence.explanation, fallbackReview.frameworkIndependence),
    hardToVaryAssessment: asString(source.hardToVaryAssessment ?? aggregateTechnicalAssessment.hardToVaryAssessment, fallbackReview.hardToVaryAssessment),
    frameworkConditionalityAssessment: asString(source.frameworkConditionalityAssessment ?? aggregateTechnicalFrameworkDependence.explanation ?? aggregateFramework.explanation, fallbackReview.frameworkConditionality.explanation),
    originalContributionAssessment: asString(source.originalContributionAssessment ?? source.manuscriptOriginalContribution, fallbackReview.manuscriptOriginalContribution),
    survivingContributionIfFlawed: asString(source.survivingContributionIfFlawed, fallbackReview.survivingContributionIfFlawed),
    laterInfluenceOrExternalResultRisk: asString(source.laterInfluenceOrExternalResultRisk),
    correctnessAssessment: asString(source.correctness ?? aggregateTechnicalAssessment.correctness, fallbackReview.correctness),
    strongestCaseForImportance: asString(source.strongestCaseForImportance ?? aggregateTechnicalAssessment.strongestCaseForImportance, fallbackReview.strongestCaseForImportance),
    strongestObjection: asString(source.strongestObjection ?? aggregateTechnicalAssessment.strongestObjection, fallbackReview.strongestObjection),
    decisiveCheck: asString(source.decisiveCheck, fallbackReview.decisiveCheck),
    assessmentSensitivity: firstString([
      source.assessmentSensitivity,
      aggregateTechnicalAssessment.assessmentSensitivity,
      root.assessmentSensitivity,
      source.whatWouldChangeAssessment,
      fallbackReview.assessmentSensitivity,
      source.decisiveCheck,
    ]),
    whatWouldRaiseScore: asString(source.whatWouldRaiseScore ?? aggregateTechnicalAssessment.whatWouldRaiseScore, fallbackReview.whatWouldRaiseScore),
    whatWouldLowerScore: asString(source.whatWouldLowerScore ?? aggregateTechnicalAssessment.whatWouldLowerScore, fallbackReview.whatWouldLowerScore),
    establishedResults: firstStringArray([source.establishedResults, fallbackReview.establishedResults]),
    interpretiveClaims: firstStringArray([source.interpretiveClaims, fallbackReview.interpretiveClaims]),
    speculativeClaims: firstStringArray([source.speculativeClaims, fallbackReview.speculativeClaims]),
    novelty: asString(source.novelty, fallbackReview.novelty),
    noveltyConfidence: asNumber(source.noveltyConfidence, fallbackReview.noveltyConfidence, 0, 1),
    internalTechnicalTraction: asString(source.internalTechnicalTraction, fallbackReview.internalTechnicalTraction),
    economy: asString(source.economy, fallbackReview.economy),
    explanatoryTargetBreadth: asString(source.explanatoryTargetBreadth, fallbackReview.explanatoryTargetBreadth),
    theorySpaceBreadth: asString(source.theorySpaceBreadth, fallbackReview.theorySpaceBreadth),
    scopeDepth: asString(source.scopeDepth, fallbackReview.scopeDepth),
    unifyingPower: asString(source.unifyingPower, fallbackReview.unifyingPower),
    ...aggregateSubscores,
    subscoreRationale: aggregateSubscoreRationale,
    ...aggregateLegacySubscores,
    subscoreValidity: aggregateSubscoreValidity,
    subscoreConsistencyWarning,
    subscoreSaturationWarning,
    scoreCappingReason,
    scoreAdjustmentReason,
    diagnosticBaselineScore: baselineScore,
    diagnosticBaselineDelta: baselineDelta,
    scoringAnomaly,
    specialtyRelativeScore: Math.round(asNumber(source.specialtyRelativeScore, fallbackReview.specialtyRelativeScore, 0, 100)),
    broadFieldRelativeScore: Math.round(asNumber(source.broadFieldRelativeScore, fallbackReview.broadFieldRelativeScore, 0, 100)),
    crossFieldConsequenceScore: Math.round(asNumber(source.crossFieldConsequenceScore, fallbackReview.crossFieldConsequenceScore, 0, 100)),
    finalClassification: adjustedFinalClassification,
    finalScoreBand,
    finalScoreConfidence: asNumber(source.finalScoreConfidence ?? source.scoreConfidence, fallbackReview.scoreConfidence, 0, 1),
    publicOneParagraphVerdict: firstString([
      root.scientificReview,
      source.scientificReview,
      source.publicScientificReview,
      source.publicOneParagraphVerdict,
      source.oneParagraphVerdict,
      source.finalJudgment,
      fallbackReview.scientificReview,
      fallbackReview.oneParagraphVerdict,
      fallbackReview.finalJudgment,
    ]),
    internalCalibrationNotes: [
      asString(source.internalCalibrationNotes ?? adjudicationSource.calibrationAdjustments, `${GEMINI_META_MODEL} adjudicator reviewed the manuscript and both independent ${GEMINI_PASS_MODEL} passes.`),
      ...adjudicationRepairNotes,
    ].filter(Boolean).join("\n\n"),
  };
}

function validateAggregateReview(review: AggregateReview) {
  if (
    review.inputConstructionOutputLedger.primitiveInputs.length === 0 ||
    review.inputConstructionOutputLedger.introducedConstructions.length === 0 ||
    review.inputConstructionOutputLedger.outputs.length === 0 ||
    !review.inputConstructionOutputLedger.assessment.trim()
  ) {
    throw new Error("Adjudication was missing input-construction-output ledger accounting.");
  }

  const hasOutputValidity = review.inputConstructionOutputLedger.outputs.some((output) =>
    output.assessment.trim() || output.validity.trim() || output.support.trim(),
  );
  if (!hasOutputValidity) {
    throw new Error("Adjudication was missing output-level assessment/validity/support.");
  }

  if (!review.assessmentSensitivity.trim()) {
    throw new Error("Adjudication was missing assessment sensitivity.");
  }

  if (!allDiagnosticSubscoresValid(review.subscoreValidity)) {
    throw new Error("Adjudication was missing one or more required diagnostic subscores.");
  }

  if (/scoreCappingReason is required/i.test(review.subscoreConsistencyWarning)) {
    throw new Error("Adjudication had high diagnostic subscores but a low final score without a score-capping reason.");
  }

  if (/diagnostic baseline|constructionStrengthScore <= 6|high-centrality output/i.test(review.subscoreConsistencyWarning)) {
    throw new Error(review.subscoreConsistencyWarning);
  }

  if (review.scoringAnomaly.trim()) {
    throw new Error(review.scoringAnomaly);
  }
}

function v15LedgerOnly(ledger: InputConstructionOutputLedger | null | undefined) {
  return {
    primitiveInputs: ledger?.primitiveInputs ?? [],
    introducedConstructions: ledger?.introducedConstructions ?? [],
    outputs: (ledger?.outputs ?? []).map((item) => ({
      output: item.output,
      inputsUsed: item.inputsUsed ?? item.dependsOnInputs,
      constructionsUsed: item.constructionsUsed ?? item.dependsOnConstructions,
      dependsOnInputs: item.dependsOnInputs,
      dependsOnConstructions: item.dependsOnConstructions,
      externalContextIfAny: item.externalContextIfAny,
      support: item.support,
      validityLevel: item.validityLevel,
      validity: item.validity,
      centrality: item.centrality,
      assessment: item.assessment,
    })),
    inputOverallAssessment: ledger?.inputOverallAssessment ?? "",
    constructionOverallAssessment: ledger?.constructionOverallAssessment ?? "",
    outputOverallAssessment: ledger?.outputOverallAssessment ?? "",
    whyOutputsMatter: ledger?.whyOutputsMatter ?? "",
    assessment: ledger?.assessment ?? "",
  };
}

function v16IcoAssessmentOnly(ledger: InputConstructionOutputLedger | null | undefined) {
  const inputOverallAssessment = ledger?.inputOverallAssessment ?? "";
  const constructionOverallAssessment = ledger?.constructionOverallAssessment ?? "";
  const outputOverallAssessment = ledger?.outputOverallAssessment || ledger?.assessment || "";
  return {
    input: {
      overallAssessment: inputOverallAssessment,
      assessment: inputOverallAssessment,
      primitiveInputs: ledger?.primitiveInputs ?? [],
    },
    construction: {
      overallAssessment: constructionOverallAssessment,
      assessment: constructionOverallAssessment,
      introducedConstructions: ledger?.introducedConstructions ?? [],
    },
    output: {
      overallAssessment: outputOverallAssessment,
      assessment: outputOverallAssessment,
      whyOutputsMatter: ledger?.whyOutputsMatter ?? "",
      outputs: (ledger?.outputs ?? []).map((item) => ({
        output: item.output,
        inputsUsed: item.inputsUsed ?? item.dependsOnInputs,
        constructionsUsed: item.constructionsUsed ?? item.dependsOnConstructions,
        externalContextIfAny: item.externalContextIfAny,
        support: item.support,
        validityLevel: item.validityLevel,
        validity: item.validity,
        centrality: item.centrality,
        assessment: item.assessment,
      })),
    },
  };
}

function v15ComparatorProfileOnly(profile: ComparatorProfile | null | undefined) {
  return {
    localCohort: profile?.localCohort ?? "",
    adjacentBroadCohort: profile?.adjacentBroadCohort ?? "",
    contributionArchetype: profile?.contributionArchetype ?? { primary: "", secondary: "" },
    primitiveInputs: profile?.primitiveInputs ?? [],
    introducedConstructions: profile?.introducedConstructions ?? [],
    outputs: profile?.outputs ?? [],
    frameworkConditionality: profile?.frameworkConditionality ?? "medium",
    clusterFeatureTags: profile?.clusterFeatureTags ?? [],
    comparatorSearchSummary: profile?.comparatorSearchSummary ?? "",
  };
}

function v16OrganicCohortProfileOnly(profile: ComparatorProfile | null | undefined) {
  return {
    localCohort: profile?.localCohort ?? "",
    primaryCohort: profile?.primaryCohort ?? profile?.localCohort ?? "",
    adjacentBroadCohort: profile?.adjacentBroadCohort ?? "",
    contributionArchetype: profile?.contributionArchetype ?? { primary: "", secondary: "" },
    primitiveInputs: profile?.primitiveInputs ?? [],
    introducedConstructions: profile?.introducedConstructions ?? [],
    outputs: profile?.outputs ?? [],
    frameworkConditionality: profile?.frameworkConditionality ?? "medium",
    clusterFeatureTags: profile?.clusterFeatureTags ?? [],
    comparatorSearchSummary: profile?.comparatorSearchSummary ?? "",
  };
}

function v16TechnicalAssessmentFromIndividual(review: IndividualReview) {
  return {
    correctness: review.correctness,
    frameworkDependence: {
      level: review.frameworkConditionality.level,
      explanation: review.frameworkConditionality.explanation,
    },
    hardToVaryAssessment: review.hardToVaryAssessment,
    strongestCaseForImportance: review.strongestCaseForImportance,
    strongestObjection: review.strongestObjection,
    assessmentSensitivity: review.assessmentSensitivity,
    whatWouldRaiseScore: review.whatWouldRaiseScore,
    whatWouldLowerScore: review.whatWouldLowerScore,
  };
}

function v16TechnicalAssessmentFromAggregate(aggregate: AggregateReview) {
  return {
    correctness: aggregate.correctnessAssessment,
    frameworkDependence: {
      level: aggregate.comparatorProfile.frameworkConditionality,
      explanation: aggregate.frameworkConditionalityAssessment,
    },
    hardToVaryAssessment: aggregate.hardToVaryAssessment,
    strongestCaseForImportance: aggregate.strongestCaseForImportance,
    strongestObjection: aggregate.strongestObjection,
    assessmentSensitivity: aggregate.assessmentSensitivity,
    whatWouldRaiseScore: aggregate.whatWouldRaiseScore,
    whatWouldLowerScore: aggregate.whatWouldLowerScore,
  };
}

function v16FailureAnalysisFromAggregate(aggregate: AggregateReview) {
  return {
    fatalObjectionPresent: aggregate.fatalObjectionPresent,
    fatalObjectionAssessment: aggregate.fatalObjectionAssessment,
    fatalToSpecificClaimOnly: aggregate.fatalToSpecificClaimOnly,
    paperFatalError: aggregate.paperFatalError,
    contributionInventory: aggregate.contributionInventory,
    survivingHighValueContributions: aggregate.survivingHighValueContributions,
    failedClaimsExcludedFromScore: aggregate.failedClaimsExcludedFromScore,
    survivingContributionScoreBasis: aggregate.survivingContributionScoreBasis,
  };
}

function v16CanonicalReviewFromIndividual(review: IndividualReview, index?: number) {
  return {
    ...(typeof index === "number" ? { passNumber: index + 1 } : {}),
    comparisonCohort: review.comparisonCohort,
    localCohort: review.localCohort,
    broadField: review.broadField,
    specialtyField: review.specialtyField,
    subfields: review.subfields,
    paperType: review.paperType,
    centralClaim: review.centralClaim,
    scientificReview: review.scientificReview,
    contributionArchetype: review.contributionArchetype,
    inputStrengthScore: review.inputStrengthScore,
    constructionStrengthScore: review.constructionStrengthScore,
    outputStrengthScore: review.outputStrengthScore,
    subscoreRationale: review.subscoreRationale,
    inputConstructionOutputAssessment: v16IcoAssessmentOnly(review.inputConstructionOutputLedger),
    technicalAssessment: v16TechnicalAssessmentFromIndividual(review),
    failureAnalysis: review.failureAnalysis,
    organicCohortProfile: v16OrganicCohortProfileOnly(review.organicCohortProfile),
    intrinsicScore: review.scoreBand.median,
    scoreConfidence: review.scoreConfidence,
    scoreCappingReason: review.scoreCappingReason,
    scoreAdjustmentReason: review.scoreAdjustmentReason,
    bestClassification: review.bestClassification,
  };
}

function v16CanonicalReviewFromAggregate(aggregate: AggregateReview, representativeReview: IndividualReview) {
  return {
    comparisonCohort: aggregate.finalComparisonCohort,
    localCohort: aggregate.finalLocalCohort,
    broadField: aggregate.finalBroadField,
    specialtyField: aggregate.finalSpecialtyField,
    subfields: representativeReview.subfields,
    paperType: representativeReview.paperType,
    centralClaim: aggregate.finalCentralClaim,
    scientificReview: aggregate.scientificReview,
    contributionArchetype: aggregate.contributionArchetype,
    inputStrengthScore: aggregate.inputStrengthScore,
    constructionStrengthScore: aggregate.constructionStrengthScore,
    outputStrengthScore: aggregate.outputStrengthScore,
    subscoreRationale: aggregate.subscoreRationale,
    inputConstructionOutputAssessment: v16IcoAssessmentOnly(aggregate.inputConstructionOutputLedger),
    technicalAssessment: v16TechnicalAssessmentFromAggregate(aggregate),
    failureAnalysis: v16FailureAnalysisFromAggregate(aggregate),
    organicCohortProfile: v16OrganicCohortProfileOnly(aggregate.comparatorProfile),
    intrinsicScore: aggregate.finalScoreBand.median,
    scoreConfidence: aggregate.finalScoreConfidence,
    scoreCappingReason: aggregate.scoreCappingReason,
    scoreAdjustmentReason: aggregate.scoreAdjustmentReason,
    bestClassification: aggregate.finalClassification,
  };
}

function compactIndividualReviewForAdjudicator(review: IndividualReview, index: number) {
  const canonical = v16CanonicalReviewFromIndividual(review, index);
  return {
    passNumber: index + 1,
    score: canonical.intrinsicScore,
    intrinsicScore: canonical.intrinsicScore,
    bestClassification: review.bestClassification,
    classification: review.bestClassification,
    comparisonCohort: review.comparisonCohort,
    localCohort: review.localCohort,
    broadField: review.broadField,
    specialtyField: review.specialtyField,
    contributionArchetype: review.contributionArchetype,
    centralClaim: review.centralClaim,
    scientificReview: review.scientificReview,
    inputConstructionOutputAssessment: canonical.inputConstructionOutputAssessment,
    organicCohortProfile: canonical.organicCohortProfile,
    technicalAssessment: canonical.technicalAssessment,
    failureAnalysis: canonical.failureAnalysis,
    inputStrengthScore: review.inputStrengthScore,
    constructionStrengthScore: review.constructionStrengthScore,
    outputStrengthScore: review.outputStrengthScore,
    subscoreRationale: review.subscoreRationale,
    subscoreValidity: review.subscoreValidity,
    scoreCappingReason: review.scoreCappingReason,
    scoreAdjustmentReason: review.scoreAdjustmentReason,
  };
}

function compactIndividualReviewForStorage(review: IndividualReview, index: number) {
  return {
    ...compactIndividualReviewForAdjudicator(review, index),
    scoreConfidence: review.scoreConfidence,
  };
}

export function v15ComparatorCalibrationForStorage(calibration: ComparatorCalibration) {
  return {
    comparatorCalibrationStatus: calibration.comparatorCalibrationStatus,
    benchmarkSetVersion: calibration.benchmarkSetVersion,
    intrinsicScoreBand: calibration.intrinsicScoreBand,
    calibrationAdjustment: calibration.calibrationAdjustment,
    finalPublicScoreBand: calibration.finalPublicScoreBand,
    finalClassification: calibration.finalClassification,
    calibrationRationale: calibration.calibrationRationale,
    scoreGapAssessment: calibration.scoreGapAssessment,
    scoreCappingReason: calibration.scoreCappingReason,
    explanatoryDeltaAssessment: {
      whatIsNewBeyondComparators: calibration.explanatoryDeltaAssessment.whatIsNewBeyondComparators,
      inputsComparison: calibration.explanatoryDeltaAssessment.inputsComparison,
      constructionComparison: calibration.explanatoryDeltaAssessment.constructionComparison,
      outputsComparison: calibration.explanatoryDeltaAssessment.outputsComparison,
      outputValidityComparison: calibration.explanatoryDeltaAssessment.outputValidityComparison,
      frameworkConditionalityComparison: calibration.explanatoryDeltaAssessment.frameworkConditionalityComparison,
      scoreGapAssessment: calibration.explanatoryDeltaAssessment.scoreGapAssessment,
    },
    comparatorsNeedingRecalibration: calibration.comparatorsNeedingRecalibration,
    confidence: calibration.confidence,
  };
}

function v15AdjudicationForStorage(aggregate: AggregateReview) {
  return {
    adjudicatorStatus: aggregate.adjudicatorStatus,
    individualScores: aggregate.individualScores,
    scoreRange: aggregate.scoreRange,
    scoreStability: aggregate.scoreStability,
    mainAgreements: aggregate.mainAgreements,
    mainDisagreements: aggregate.mainDisagreements,
    fatalObjectionPresent: aggregate.fatalObjectionPresent,
    fatalObjectionAssessment: aggregate.fatalObjectionAssessment,
    fatalToSpecificClaimOnly: aggregate.fatalToSpecificClaimOnly,
    paperFatalError: aggregate.paperFatalError,
    contributionInventory: aggregate.contributionInventory,
    survivingHighValueContributions: aggregate.survivingHighValueContributions,
    failedClaimsExcludedFromScore: aggregate.failedClaimsExcludedFromScore,
    survivingContributionScoreBasis: aggregate.survivingContributionScoreBasis,
    calibrationAdjustments: aggregate.adjudication.calibrationAdjustments,
    subscoreConsistencyWarning: aggregate.subscoreConsistencyWarning,
    subscoreSaturationWarning: aggregate.subscoreSaturationWarning,
    diagnosticBaselineScore: aggregate.diagnosticBaselineScore,
    diagnosticBaselineDelta: aggregate.diagnosticBaselineDelta,
    scoreAdjustmentReason: aggregate.scoreAdjustmentReason,
    scoringAnomaly: aggregate.scoringAnomaly,
  };
}

export function compactAggregateForStorage(aggregate: AggregateReview) {
  return {
    finalComparisonCohort: aggregate.finalComparisonCohort,
    finalLocalCohort: aggregate.finalLocalCohort,
    finalBroadField: aggregate.finalBroadField,
    finalSpecialtyField: aggregate.finalSpecialtyField,
    finalSummary: aggregate.finalSummary,
    finalCentralClaim: aggregate.finalCentralClaim,
    scientificReview: aggregate.scientificReview,
    contributionArchetype: aggregate.contributionArchetype,
    inputConstructionOutputAssessment: v16IcoAssessmentOnly(aggregate.inputConstructionOutputLedger),
    technicalAssessment: {
      correctness: aggregate.correctnessAssessment,
      frameworkDependence: {
        level: aggregate.comparatorProfile.frameworkConditionality,
        explanation: aggregate.frameworkConditionalityAssessment,
      },
      hardToVaryAssessment: aggregate.hardToVaryAssessment,
      strongestCase: aggregate.strongestCaseForImportance,
      strongestObjection: aggregate.strongestObjection,
      assessmentSensitivity: aggregate.assessmentSensitivity,
      whatWouldRaiseScore: aggregate.whatWouldRaiseScore,
      whatWouldLowerScore: aggregate.whatWouldLowerScore,
    },
    failureAnalysis: {
      fatalObjectionPresent: aggregate.fatalObjectionPresent,
      fatalObjectionAssessment: aggregate.fatalObjectionAssessment,
      fatalToSpecificClaimOnly: aggregate.fatalToSpecificClaimOnly,
      paperFatalError: aggregate.paperFatalError,
      contributionInventory: aggregate.contributionInventory,
      survivingHighValueContributions: aggregate.survivingHighValueContributions,
      failedClaimsExcludedFromScore: aggregate.failedClaimsExcludedFromScore,
      survivingContributionScoreBasis: aggregate.survivingContributionScoreBasis,
    },
    nearestComparators: aggregate.nearestComparators,
    externalComparatorSuggestions: aggregate.externalComparatorSuggestions,
    publicComparatorSummary: aggregate.publicComparatorSummary,
    adminComparatorNotes: aggregate.adminComparatorNotes,
    comparatorProfile: v15ComparatorProfileOnly(aggregate.comparatorProfile),
    comparatorCalibration: v15ComparatorCalibrationForStorage(aggregate.comparatorCalibration),
    blindIntrinsicScoreBand: aggregate.blindIntrinsicScoreBand,
    adjudicatorStatus: aggregate.adjudicatorStatus,
    adjudication: v15AdjudicationForStorage(aggregate),
    individualScores: aggregate.individualScores,
    scoreRange: aggregate.scoreRange,
    scoreStability: aggregate.scoreStability,
    contributionGroundingType: aggregate.contributionGroundingType,
    originalContributionAssessment: aggregate.originalContributionAssessment,
    survivingContributionIfFlawed: aggregate.survivingContributionIfFlawed,
    laterInfluenceOrExternalResultRisk: aggregate.laterInfluenceOrExternalResultRisk,
    novelty: aggregate.novelty,
    noveltyConfidence: aggregate.noveltyConfidence,
    internalTechnicalTraction: aggregate.internalTechnicalTraction,
    economy: aggregate.economy,
    unifyingPower: aggregate.unifyingPower,
    inputStrengthScore: aggregate.inputStrengthScore,
    constructionStrengthScore: aggregate.constructionStrengthScore,
    outputStrengthScore: aggregate.outputStrengthScore,
    subscoreRationale: aggregate.subscoreRationale,
    subscoreValidity: aggregate.subscoreValidity,
    subscoreConsistencyWarning: aggregate.subscoreConsistencyWarning,
    subscoreSaturationWarning: aggregate.subscoreSaturationWarning,
    scoreCappingReason: aggregate.scoreCappingReason,
    scoreAdjustmentReason: aggregate.scoreAdjustmentReason,
    diagnosticBaselineScore: aggregate.diagnosticBaselineScore,
    diagnosticBaselineDelta: aggregate.diagnosticBaselineDelta,
    scoringAnomaly: aggregate.scoringAnomaly,
    finalClassification: aggregate.finalClassification,
    finalScoreBand: aggregate.finalScoreBand,
    finalScoreConfidence: aggregate.finalScoreConfidence,
    internalCalibrationNotes: aggregate.internalCalibrationNotes,
  };
}

function buildAdjudicatorInput(
  _blindedContent: ReviewInput,
  reviews: IndividualReview[],
): ReviewInput {
  const compactPasses = reviews.map(compactIndividualReviewForAdjudicator);
  const text = JSON.stringify({
    adjudicatorInputNote:
      "Raw manuscript text is intentionally omitted from the adjudicator payload. Use the blinded pass scientific reviews, v16.7 canonical input-construction-output assessments, diagnostic scores, objections, per-output assessments, and single intrinsic scores below.",
    manuscriptSummaryAndLedger: compactPasses.map((review) => ({
      passNumber: review.passNumber,
      centralClaim: review.centralClaim,
      scientificReview: review.scientificReview,
      contributionArchetype: review.contributionArchetype,
      inputConstructionOutputAssessment: review.inputConstructionOutputAssessment,
      organicCohortProfile: review.organicCohortProfile,
    })),
    independentReviewPasses: compactPasses,
  }, null, 2);

  return text;
}

function buildComparatorCalibrationInput(
  aggregate: AggregateReview,
  comparatorContext: ReviewComparatorContextItem[],
): string {
  const candidateComparatorProfiles = comparatorContext.map((candidate, index) => ({
    comparatorId: candidate.comparatorId || `C${index + 1}`,
    paperId: candidate.sitePaperId,
    displayTitle: candidate.title,
    field: candidate.field,
    subfields: candidate.subfields,
    score: candidate.score,
    calibratedScoreBand: candidate.calibratedScoreBand,
    benchmarkSetVersion: candidate.benchmarkSetVersion,
    comparatorCalibrationStatus: candidate.comparatorCalibrationStatus,
    classification: candidate.classification,
    comparisonCohort: candidate.comparisonCohort,
    contributionArchetype: candidate.contributionArchetype,
    centralClaim: candidate.centralClaim,
    summary: candidate.summary,
    inputConstructionOutputLedger: v15LedgerOnly(candidate.inputConstructionOutputLedger),
    frameworkConditionality: candidate.frameworkConditionality,
    comparatorSearchSummary: candidate.comparatorSearchSummary,
    explanatoryDeltaAssessment: candidate.explanatoryDeltaAssessment,
  }));

  return JSON.stringify({
    finalBlindIntrinsicReview: {
      comparisonCohort: aggregate.finalComparisonCohort,
      localCohort: aggregate.finalLocalCohort,
      broadField: aggregate.finalBroadField,
      specialtyField: aggregate.finalSpecialtyField,
      summary: aggregate.finalSummary,
      centralClaim: aggregate.finalCentralClaim,
      scientificReview: aggregate.scientificReview,
      contributionArchetype: aggregate.contributionArchetype,
      inputConstructionOutputLedger: v15LedgerOnly(aggregate.inputConstructionOutputLedger),
      correctness: aggregate.correctnessAssessment,
      inputGrounding: aggregate.inputGroundingAssessment,
      inputFundamentality: aggregate.inputFundamentalityAssessment,
      constructionAssessment: aggregate.constructionAssessment,
      frameworkIndependence: aggregate.frameworkIndependenceAssessment,
      hardToVaryAssessment: aggregate.hardToVaryAssessment,
      frameworkConditionality: aggregate.frameworkConditionalityAssessment,
      manuscriptOriginalContribution: aggregate.originalContributionAssessment,
      survivingContributionIfFlawed: aggregate.survivingContributionIfFlawed,
      survivingHighValueContributions: aggregate.survivingHighValueContributions,
      failedClaimsExcludedFromScore: aggregate.failedClaimsExcludedFromScore,
      survivingContributionScoreBasis: aggregate.survivingContributionScoreBasis,
      strongestCaseForImportance: aggregate.strongestCaseForImportance,
      strongestObjection: aggregate.strongestObjection,
      assessmentSensitivity: aggregate.assessmentSensitivity,
      inputStrengthScore: aggregate.inputStrengthScore,
      constructionStrengthScore: aggregate.constructionStrengthScore,
      outputStrengthScore: aggregate.outputStrengthScore,
      subscoreRationale: aggregate.subscoreRationale,
      scoreCappingReason: aggregate.scoreCappingReason,
      scoreAdjustmentReason: aggregate.scoreAdjustmentReason,
      diagnosticBaselineScore: aggregate.diagnosticBaselineScore,
      diagnosticBaselineDelta: aggregate.diagnosticBaselineDelta,
      intrinsicScore: aggregate.blindIntrinsicScoreBand.median,
      scoreConfidence: aggregate.finalScoreConfidence,
      bestClassification: aggregate.finalClassification,
      oneParagraphVerdict: aggregate.publicOneParagraphVerdict,
      finalJudgment: aggregate.publicOneParagraphVerdict,
    },
    comparatorProfile: v15ComparatorProfileOnly(aggregate.comparatorProfile),
    candidateComparatorProfiles,
  }, null, 2);
}

function defaultDateMetadata(displayedTitle: string, displayedAuthors: string[]): PaperDateMetadata {
  return {
    rawExtractedTitle: displayedTitle,
    cleanedTitle: displayedTitle,
    titleConfidence: displayedTitle && displayedTitle !== "Unknown Title" ? 0.4 : 0,
    titleCleaningNotes: "Fallback metadata was used.",
    displayedTitle,
    displayedAuthors,
    rawExtractedAuthors: displayedAuthors.join(", "),
    authorsConfidence: displayedAuthors.length > 0 && displayedAuthors[0] !== "Unknown Authors" ? 0.4 : 0,
    authorsExtractionNotes: "Fallback metadata was used.",
    arxivId: "",
    reportCodes: [],
    doi: "",
    journalName: "",
    journalPublicationDate: "",
    arxivFirstSubmissionDate: "",
    manuscriptDatePrintedOnPdf: "",
    originalPublicationDateBestGuess: "",
    dateSource: "unknown",
    dateConfidence: 0,
    dateNotes: "Date metadata was not confidently extracted.",
  };
}

function normalizeExtractedDateMetadata(
  source: Record<string, unknown>,
  display: { displayedTitle: string; displayedAuthors: string[] },
): PaperDateMetadata {
  const metadata = defaultDateMetadata(display.displayedTitle, display.displayedAuthors);
  return {
    rawExtractedTitle: asString(source.rawExtractedTitle, metadata.rawExtractedTitle),
    cleanedTitle: asString(source.cleanedTitle, source.displayedTitle ? asString(source.displayedTitle) : metadata.cleanedTitle) || metadata.cleanedTitle,
    titleConfidence: asNumber(source.titleConfidence, metadata.titleConfidence, 0, 1),
    titleCleaningNotes: asString(source.titleCleaningNotes, metadata.titleCleaningNotes),
    displayedTitle: firstString([source.cleanedTitle, source.displayedTitle, source.rawExtractedTitle], metadata.displayedTitle) || metadata.displayedTitle,
    displayedAuthors: firstStringArray([source.displayedAuthors, metadata.displayedAuthors]),
    rawExtractedAuthors: asString(source.rawExtractedAuthors, metadata.rawExtractedAuthors),
    authorsConfidence: asNumber(source.authorsConfidence, metadata.authorsConfidence, 0, 1),
    authorsExtractionNotes: asString(source.authorsExtractionNotes, metadata.authorsExtractionNotes),
    arxivId: asString(source.arxivId, metadata.arxivId),
    reportCodes: firstStringArray([source.reportCodes, metadata.reportCodes]),
    doi: asString(source.doi, metadata.doi),
    journalName: asString(source.journalName, metadata.journalName),
    journalPublicationDate: asString(source.journalPublicationDate, metadata.journalPublicationDate),
    arxivFirstSubmissionDate: asString(source.arxivFirstSubmissionDate, metadata.arxivFirstSubmissionDate),
    manuscriptDatePrintedOnPdf: asString(source.manuscriptDatePrintedOnPdf, metadata.manuscriptDatePrintedOnPdf),
    originalPublicationDateBestGuess: asString(source.originalPublicationDateBestGuess, metadata.originalPublicationDateBestGuess),
    dateSource: asString(source.dateSource, metadata.dateSource) || metadata.dateSource,
    dateConfidence: asNumber(source.dateConfidence, metadata.dateConfidence, 0, 1),
    dateNotes: asString(source.dateNotes, metadata.dateNotes),
  };
}

export async function extractMetadata(paperContent: string, hints: MetadataHints = {}): Promise<ExtractedPaperMetadata> {
  const fallback = heuristicMetadata(paperContent, hints);
  const headerText = manuscriptHeaderText(paperContent).join("\n");
  const metadataInput = JSON.stringify({
    fileNameHint: cleanMetadataText(hints.fileName),
    embeddedPdfTitleHint: cleanMetadataText(hints.pdfTitle),
    embeddedPdfAuthorHint: cleanMetadataText(hints.pdfAuthor),
    heuristicTitleFallback: fallback.title,
    heuristicAuthorsFallback: fallback.authors,
    manuscriptHeaderText: headerText.slice(0, 8000),
    extractedTextBeginning: stripControlChars(paperContent).slice(0, 16000),
  }, null, 2);
  const detectedArxivId = firstArxivIdFromText([
    hints.fileName,
    hints.pdfTitle,
    headerText,
    stripControlChars(paperContent).slice(0, 16000),
  ].filter(Boolean).join("\n"));
  const arxivMetadata = await fetchArxivMetadata(detectedArxivId);
  const knownArxivAuthorList = knownArxivAuthors(detectedArxivId);
  const looksTruncatedTitle = (value: string) =>
    /\b(of|and|for|in|on|with|from|to|the|a|an)$/i.test(value.trim());
  const isSuspiciousTitle = (value: string) =>
    !value ||
    value === "Unknown Title" ||
    looksLikeJournalCitation(value) ||
    /^(arxiv:|submitted by\b)/i.test(value) ||
    /^\s*(?:[a-z-]+\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?\s*$/i.test(value) ||
    isOnlyReportCodeLine(value) ||
    value.length < 8 ||
    looksTruncatedTitle(value);
  const isSuspiciousAuthors = (value: string) =>
    !value ||
    value === "Unknown Authors" ||
    /^(submitted by\b|abstract\b)/i.test(value) ||
    /@|\b(university|institute|department|laboratory|college|school|faculty|centre|center)\b/i.test(value) ||
    value.length > 500;
  try {
    const metadataReviewInput: ReviewInput = hints.pdfBase64
      ? {
          text: metadataInput,
          pdfBase64: hints.pdfBase64,
          mimeType: hints.mimeType || "application/pdf",
        }
      : metadataInput;
    const { parsed } = await callGemini(
      METADATA_PROMPT,
      metadataReviewInput,
      GEMINI_METADATA_MODEL,
      {
        maxOutputTokens: 768,
        includeThoughts: false,
        responseJsonSchema: metadataJsonSchema,
        temperature: 0,
      },
    );
    const parsedMetadata = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    const rawParsedTitle = firstString([
      parsedMetadata.cleanedTitle,
      parsedMetadata.displayedTitle,
      parsedMetadata.rawExtractedTitle,
      parsedMetadata.title,
    ], fallback.title);
    const parsedTitleCleanup = cleanDisplayTitle(rawParsedTitle);
    const fallbackTitleCleanup = cleanDisplayTitle(fallback.title);
    const parsedTitleConfidence = asNumber(parsedMetadata.titleConfidence, 0, 0, 1);
    const shouldPreferArxivTitle =
      Boolean(arxivMetadata?.title) &&
      (
        parsedTitleConfidence < 0.7 ||
        isSuspiciousTitle(parsedTitleCleanup.title) ||
        isSuspiciousTitle(fallbackTitleCleanup.title)
      );
    const bestTitle =
      shouldPreferArxivTitle
        ? arxivMetadata!.title
        : isSuspiciousTitle(parsedTitleCleanup.title)
        ? (isSuspiciousTitle(fallbackTitleCleanup.title) ? fallback.title : fallbackTitleCleanup.title)
        : parsedTitleCleanup.title;
    const displayedAuthors = firstStringArray([parsedMetadata.displayedAuthors]);
    const authors = displayedAuthors.length > 0
      ? displayedAuthors.join(", ")
      : asString(parsedMetadata.authors, fallback.authors);
    let bestAuthors = isSuspiciousAuthors(authors) ? fallback.authors : authors;
    let bestAuthorList = isSuspiciousAuthors(authors)
      ? splitAuthorNames(fallback.authors)
      : displayedAuthors.length > 0
        ? displayedAuthors
        : splitAuthorNames(bestAuthors);
    const fallbackAuthorList = splitAuthorNames(fallback.authors);
    const usedFallbackMultiAuthorBlock = bestAuthorList.length === 1 && fallbackAuthorList.length > 1;
    if (usedFallbackMultiAuthorBlock) {
      bestAuthorList = fallbackAuthorList;
      bestAuthors = fallbackAuthorList.join(", ");
    }
    const arxivAuthorList = knownArxivAuthorList.length > (arxivMetadata?.authors?.length ?? 0)
      ? knownArxivAuthorList
      : arxivMetadata?.authors ?? knownArxivAuthorList;
    const usedArxivAuthors =
      arxivAuthorList.length > 0 &&
      (
        bestAuthorList.length === 0 ||
        bestAuthorList[0] === "Unknown Authors" ||
        arxivAuthorList.length > bestAuthorList.length ||
        asNumber(parsedMetadata.authorsConfidence, 0, 0, 1) < 0.7
      );
    if (usedArxivAuthors) {
      bestAuthorList = arxivAuthorList;
      bestAuthors = arxivAuthorList.join(", ");
    }
    const titleCleanupNotes = uniqueCleanStrings([
      asString(parsedMetadata.titleCleaningNotes),
      parsedTitleCleanup.notes,
      isSuspiciousTitle(parsedTitleCleanup.title) ? fallbackTitleCleanup.notes : "",
      shouldPreferArxivTitle ? "arXiv metadata replaced low-confidence or suspicious title extraction." : "",
    ]).join(" ");
    const normalizedSource = {
      ...parsedMetadata,
      rawExtractedTitle: rawParsedTitle,
      cleanedTitle: bestTitle,
      displayedTitle: bestTitle,
      titleCleaningNotes: titleCleanupNotes || asString(parsedMetadata.titleCleaningNotes),
      titleConfidence: shouldPreferArxivTitle ? Math.max(parsedTitleConfidence, 0.95) : parsedTitleConfidence,
      arxivId: normalizeArxivId(asString(parsedMetadata.arxivId) || parsedTitleCleanup.arxivId || fallbackTitleCleanup.arxivId || arxivMetadata?.arxivId || detectedArxivId),
      reportCodes: uniqueCleanStrings([
        ...firstStringArray([parsedMetadata.reportCodes]),
        ...parsedTitleCleanup.reportCodes,
        ...fallbackTitleCleanup.reportCodes,
      ]),
      doi: asString(parsedMetadata.doi) || arxivMetadata?.doi || "",
      journalName: asString(parsedMetadata.journalName) || arxivMetadata?.journalRef || "",
      arxivFirstSubmissionDate: asString(parsedMetadata.arxivFirstSubmissionDate) || arxivMetadata?.published || "",
      originalPublicationDateBestGuess: asString(parsedMetadata.originalPublicationDateBestGuess) || asString(parsedMetadata.journalPublicationDate) || arxivMetadata?.published || "",
      dateSource: asString(parsedMetadata.dateSource) || (arxivMetadata?.published ? "arxiv metadata" : ""),
      rawExtractedAuthors: asString(parsedMetadata.rawExtractedAuthors, authors),
      authorsConfidence: usedArxivAuthors ? Math.max(asNumber(parsedMetadata.authorsConfidence, 0, 0, 1), 0.95) : asNumber(parsedMetadata.authorsConfidence, 0, 0, 1),
      authorsExtractionNotes: uniqueCleanStrings([
        asString(parsedMetadata.authorsExtractionNotes),
        usedFallbackMultiAuthorBlock ? "Deterministic fallback replaced a one-author parse with a multi-author title-page block." : "",
        usedArxivAuthors ? (knownArxivAuthorList.length > 0 ? "Known arXiv metadata override supplied the complete author list." : "arXiv metadata supplied the complete author list.") : "",
      ]).join(" "),
      displayedAuthors: bestAuthorList.length > 0 ? bestAuthorList : splitAuthorNames(bestAuthors),
    };
    return {
      title: bestTitle,
      authors: bestAuthors,
      dateMetadata: normalizeExtractedDateMetadata(normalizedSource, {
        displayedTitle: bestTitle,
        displayedAuthors: bestAuthorList.length > 0 ? bestAuthorList : splitAuthorNames(bestAuthors),
      }),
    };
  } catch {
    const fallbackTitleCleanup = cleanDisplayTitle(fallback.title);
    const fallbackTitle = arxivMetadata?.title || (isSuspiciousTitle(fallbackTitleCleanup.title) ? fallback.title : fallbackTitleCleanup.title);
    const fallbackAuthorList = knownArxivAuthorList.length > (arxivMetadata?.authors?.length ?? 0)
      ? knownArxivAuthorList
      : arxivMetadata?.authors?.length
        ? arxivMetadata.authors
        : splitAuthorNames(fallback.authors);
    const fallbackAuthors = fallbackAuthorList.length ? fallbackAuthorList.join(", ") : fallback.authors;
    return {
      title: fallbackTitle,
      authors: fallbackAuthors,
      dateMetadata: {
        ...defaultDateMetadata(fallbackTitle, fallbackAuthorList),
        rawExtractedTitle: fallback.title,
        cleanedTitle: fallbackTitle,
        displayedTitle: fallbackTitle,
        arxivId: normalizeArxivId(arxivMetadata?.arxivId || fallbackTitleCleanup.arxivId || detectedArxivId),
        reportCodes: fallbackTitleCleanup.reportCodes,
        doi: arxivMetadata?.doi || "",
        journalName: arxivMetadata?.journalRef || "",
        arxivFirstSubmissionDate: arxivMetadata?.published || "",
        originalPublicationDateBestGuess: arxivMetadata?.published || "",
        dateSource: arxivMetadata?.published ? "arxiv metadata" : "unknown",
        titleCleaningNotes: arxivMetadata?.title ? "arXiv metadata was used after model metadata extraction failed." : fallbackTitleCleanup.notes || "Fallback metadata was used.",
        displayedAuthors: fallbackAuthorList,
        rawExtractedAuthors: fallbackAuthors,
        authorsConfidence: fallbackAuthorList.length > 0 && fallbackAuthorList[0] !== "Unknown Authors" ? 0.95 : 0.4,
        authorsExtractionNotes: knownArxivAuthorList.length > 0
          ? "Known arXiv metadata override was used after model metadata extraction failed."
          : arxivMetadata?.authors?.length ? "arXiv metadata was used after model metadata extraction failed." : "Fallback metadata was used.",
      },
    };
  }
}

async function generateMultiPassReview(
  paperContent: ReviewInput,
  _model: ReviewModel,
  promptOverride?: string,
  options: { selectComparatorContext?: ComparatorContextSelector; reviewMode?: ReviewPipelineMode } = {},
): Promise<MultiPassReviewResult> {
  const reviewMode = options.reviewMode ?? DEFAULT_REVIEW_PIPELINE_MODE;
  const systemPrompt = withLatexMarkdownFormatting(promptOverride?.trim() || REVIEW_SYSTEM_INSTRUCTION);
  const blindedContent = blindReviewInput(paperContent);
  const thinkingChunks: string[] = [];

  const passResults: IndividualPassResult[] = [];
  const passFailures: { reason: unknown; index: number }[] = [];

  const initialPasses = await Promise.allSettled(
    Array.from({ length: REVIEW_PASS_COUNT }, (_unused, index) =>
      runPassWithGenerationRetries(systemPrompt, blindedContent, index),
    ),
  );

  for (let index = 0; index < initialPasses.length; index += 1) {
    const result = initialPasses[index];
    if (result.status === "fulfilled") {
      passResults.push(result.value);
    } else {
      passFailures.push({ reason: result.reason, index });
    }
  }
  const initialQuotaFailure = passFailures.find(({ reason }) => isDailyModelQuotaError(reason));
  if (initialQuotaFailure && passResults.length < REVIEW_PASS_COUNT) {
    throw new Error(dailyQuotaErrorMessage(initialQuotaFailure.reason));
  }

  let extraIndex = REVIEW_PASS_COUNT;
  const maxPassAttempts = REVIEW_PASS_COUNT + REPLACEMENT_PASS_ATTEMPTS;
  while (passResults.length < REVIEW_PASS_COUNT && extraIndex < maxPassAttempts) {
    try {
      passResults.push(await runPassWithGenerationRetries(buildReplacementPassPrompt(systemPrompt, passFailures), blindedContent, extraIndex));
    } catch (reason) {
      passFailures.push({ reason, index: extraIndex });
      if (isDailyModelQuotaError(reason)) {
        throw new Error(dailyQuotaErrorMessage(reason));
      }
    }
    extraIndex += 1;
  }

  const passFailureDetails = passFailures.map(({ reason, index }) => `attempt ${index + 1}: ${errorMessage(reason)}`).join("; ");
  if (passResults.length === 0) {
    throw new Error(`Review failed: 0 of ${REVIEW_PASS_COUNT} valid independent passes completed after ${maxPassAttempts} attempts. ${passFailureDetails}`);
  }

  const individualReviews = passResults.map((result) => result.review);
  for (const result of passResults) {
    if (result.thinkingText) {
      thinkingChunks.push(`Pass ${result.index + 1} (${result.modelName})\n${result.thinkingText}`);
    }
  }
  for (const { reason, index } of passFailures) {
    thinkingChunks.push(`Discarded failed pass attempt ${index + 1}\n${errorMessage(reason)}`);
  }

  const fallbackScores = individualReviews.map((review) => review.scoreBand.median);
  const fallbackRepresentativeReview = pickRepresentativeReview(individualReviews, medianScore(fallbackScores));
  let adjudicatorThinking: string | null = null;
  let aggregate: AggregateReview | null = null;
  let adjudicatorFailure: unknown = null;
  if (passResults.length < REVIEW_PASS_COUNT) {
    aggregate = normalizeAggregateReview({
      finalIntrinsicReview: fallbackRepresentativeReview,
      reviewPassComparison: {
        validPassCount: passResults.length,
        expectedPassCount: REVIEW_PASS_COUNT,
        individualScores: fallbackScores,
        scoreRange: 0,
        scoreStability: "low",
        mainAgreements: [],
        mainDisagreements: [
          `Only ${passResults.length} of ${REVIEW_PASS_COUNT} required blind passes completed; saved the valid paid pass instead of discarding the paper.`,
        ],
        fatalObjectionPresent: false,
        fatalObjectionAssessment: "",
      },
    }, fallbackScores, fallbackRepresentativeReview);
    aggregate = {
      ...aggregate,
      adjudicatorStatus: "not_run",
      adjudication: {
        ...aggregate.adjudication,
        adjudicatorStatus: "not_run",
      },
      internalCalibrationNotes: [
        aggregate.internalCalibrationNotes,
        `Incomplete blind-pass set: saved ${passResults.length}/${REVIEW_PASS_COUNT} valid pass(es) instead of throwing away paid work. Failed attempts: ${passFailureDetails}`,
      ].filter(Boolean).join("\n\n"),
    };
    thinkingChunks.push(`Incomplete blind-pass set; saved pass-based fallback\n${passFailureDetails}`);
  }

  if (!aggregate) {
    try {
      for (let attempt = 0; attempt < ADJUDICATOR_GENERATION_ATTEMPTS; attempt += 1) {
        try {
          const retryInstruction = attempt === 0
            ? ""
            : `\n\nThe previous adjudication was rejected by validation: ${errorMessage(adjudicatorFailure)}\nReturn a self-consistent adjudication. Anchor the final score to 10 x the average of inputStrengthScore, constructionStrengthScore, and outputStrengthScore. If the final score differs from that diagnostic baseline by more than 8 points, include a concrete scoreCappingReason or scoreAdjustmentReason based only on durable content in the manuscript. Do not use later influence, citation history, or "opened a field" language to raise the intrinsic score. Do not apply a paper-fatal cap unless paperFatalError is true, or fatalObjectionPresent is true and no high-value separable contribution survives.`;
          const adjudicatorResult = await callGemini(
            `${BLIND_INTRINSIC_ADJUDICATOR_PROMPT}${retryInstruction}`,
            buildAdjudicatorInput(blindedContent, individualReviews),
            GEMINI_META_MODEL,
            {
              maxOutputTokens: 16384,
              includeThoughts: false,
              temperature: 0.15,
            },
          );
          adjudicatorThinking = adjudicatorResult.thinkingText;
          aggregate = normalizeAggregateReview(adjudicatorResult.parsed, fallbackScores, fallbackRepresentativeReview);
          validateAggregateReview(aggregate);
          break;
        } catch (reason) {
          adjudicatorFailure = reason;
          logger.warn({
            err: reason,
            errorDetails: errorDetailsForLog(reason),
            errorMessage: errorMessage(reason),
            attempt: attempt + 1,
            model: GEMINI_META_MODEL,
            adjudicatorInputChars: reviewInputText(buildAdjudicatorInput(blindedContent, individualReviews)).length,
          }, "Blind adjudicator attempt failed");
          if (isDailyModelQuotaError(reason)) {
            throw new Error(dailyQuotaErrorMessage(reason));
          }
          if (attempt < ADJUDICATOR_GENERATION_ATTEMPTS - 1) {
            await sleep(passAttemptDelayMs(attempt, reason));
          }
        }
      }
      if (!aggregate) throw adjudicatorFailure ?? new Error("Blind adjudicator failed validation.");
    } catch (reason) {
      if (isDailyModelQuotaError(reason)) {
        throw new Error(dailyQuotaErrorMessage(reason));
      }
      aggregate = normalizeAggregateReview({
        finalIntrinsicReview: fallbackRepresentativeReview,
        reviewPassComparison: {
          validPassCount: passResults.length,
          individualScores: fallbackScores,
          scoreRange: Math.max(...fallbackScores) - Math.min(...fallbackScores),
          scoreStability: rangeToStability(Math.max(...fallbackScores) - Math.min(...fallbackScores)),
          mainAgreements: [],
          mainDisagreements: [],
          fatalObjectionPresent: false,
          fatalObjectionAssessment: "",
        },
      }, fallbackScores, fallbackRepresentativeReview);
      aggregate = {
        ...aggregate,
        adjudicatorStatus: "failed_fallback",
        adjudication: {
          ...aggregate.adjudication,
          adjudicatorStatus: "failed_fallback",
        },
        internalCalibrationNotes: [
          aggregate.internalCalibrationNotes,
          `Blind adjudicator failed; saved fallback from ${passResults.length} valid pass(es) instead of discarding paid work. ${errorMessage(reason)}`,
        ].filter(Boolean).join("\n\n"),
      };
      thinkingChunks.push(`Blind adjudicator failed; saved pass-based fallback\n${errorMessage(reason)}`);
    }
  }
  if (!aggregate) {
    throw new Error("Review failed: no aggregate adjudication could be produced.");
  }
  const comparatorContext = reviewMode === "normal-review" && options.selectComparatorContext
    ? await options.selectComparatorContext(aggregate.comparatorProfile, aggregate)
    : [];
  if (reviewMode === "benchmark-ingestion") {
    aggregate = {
      ...aggregate,
      comparatorCalibration: defaultComparatorCalibration(
        aggregate.blindIntrinsicScoreBand,
        aggregate.finalClassification,
        "Benchmark ingestion mode stores the blind intrinsic profile only. Comparator calibration is run later by benchmark backfill.",
        "not_run_benchmark_ingestion",
      ),
      finalScoreBand: aggregate.blindIntrinsicScoreBand,
      adminComparatorNotes: "Benchmark ingestion mode: comparator calibration not run.",
    };
  } else if (comparatorContext.length === 0) {
    aggregate = {
      ...aggregate,
      comparatorCalibration: defaultComparatorCalibration(
        aggregate.blindIntrinsicScoreBand,
        aggregate.finalClassification,
        "No sufficiently close benchmark comparators were available; public score falls back to the blind intrinsic score.",
        "unavailable",
      ),
      finalScoreBand: aggregate.blindIntrinsicScoreBand,
      adminComparatorNotes: "Comparator calibration unavailable: no close benchmark comparators found.",
    };
  } else {
    try {
      const { parsed: calibrationParsed, thinkingText: calibrationThinking } = await callGemini(
        BENCHMARK_COMPARATOR_CALIBRATION_PROMPT,
        buildComparatorCalibrationInput(aggregate, comparatorContext),
        GEMINI_CALIBRATION_MODEL,
        { maxOutputTokens: 8192, includeThoughts: false },
      );
      const calibration = normalizeComparatorCalibrationResult(calibrationParsed, aggregate, comparatorContext);
      aggregate = {
        ...aggregate,
        comparatorCalibration: calibration.comparatorCalibration,
        nearestComparators: calibration.nearestComparators,
        externalComparatorSuggestions: calibration.externalComparatorSuggestions,
        publicComparatorSummary: calibration.publicComparatorSummary,
        adminComparatorNotes: calibration.adminComparatorNotes,
        finalScoreBand: calibration.comparatorCalibration.finalPublicScoreBand,
        finalClassification: calibration.comparatorCalibration.finalClassification,
        finalScoreConfidence: calibration.comparatorCalibration.confidence,
        scoreCappingReason: calibration.comparatorCalibration.scoreCappingReason || aggregate.scoreCappingReason,
        internalCalibrationNotes: [
          aggregate.internalCalibrationNotes,
          calibration.comparatorCalibration.calibrationRationale,
          calibration.adminComparatorNotes,
        ].filter(Boolean).join("\n\n"),
      };
      if (calibrationThinking) {
        thinkingChunks.push(`Comparator calibration (${GEMINI_CALIBRATION_MODEL})\n${calibrationThinking}`);
      }
    } catch (reason) {
      aggregate = {
        ...aggregate,
        comparatorCalibration: defaultComparatorCalibration(
          aggregate.blindIntrinsicScoreBand,
          aggregate.finalClassification,
          `Comparator calibration failed; public score falls back to the blind intrinsic score. ${errorMessage(reason)}`,
          "failed",
        ),
        adminComparatorNotes: `Comparator calibration failed: ${errorMessage(reason)}`,
      };
      thinkingChunks.push(`Comparator calibration failed\n${errorMessage(reason)}`);
    }
  }
  const representativeReview = pickRepresentativeReview(individualReviews, aggregate.finalScoreBand.median);
  if (adjudicatorThinking) {
    thinkingChunks.push(`Adjudicator (${GEMINI_META_MODEL})\n${adjudicatorThinking}`);
  }
  thinkingChunks.push(aggregate.internalCalibrationNotes);

  return {
    modelName: expectedReviewModelName(reviewMode),
    pipelineMode: reviewMode,
    systemPrompt,
    blindedContent,
    individualReviews,
    aggregate,
    representativeReview,
    thinkingText: thinkingChunks.length > 0 ? thinkingChunks.join("\n\n---\n\n") : null,
  };
}

export async function recalibrateStoredAggregateWithComparators(
  aggregateInput: unknown,
  comparatorContext: ReviewComparatorContextItem[],
) {
  const aggregate = aggregateInput && typeof aggregateInput === "object"
    ? (aggregateInput as AggregateReview)
    : null;
  if (!aggregate?.comparatorProfile || !aggregate?.blindIntrinsicScoreBand) {
    throw new Error("Review aggregate is missing v9 comparator profile or blind intrinsic score band.");
  }

  if (comparatorContext.length === 0) {
    const updatedAggregate: AggregateReview = {
      ...aggregate,
      comparatorCalibration: defaultComparatorCalibration(
        aggregate.blindIntrinsicScoreBand,
        aggregate.finalClassification,
        "Comparator backfill could not find close benchmark comparators; score remains blind-intrinsic.",
        "unavailable",
      ),
      finalScoreBand: aggregate.blindIntrinsicScoreBand,
      adminComparatorNotes: "Comparator backfill unavailable: no close benchmark comparators found.",
    };
    return { aggregate: updatedAggregate, thinkingText: null };
  }

  const { parsed: calibrationParsed, thinkingText } = await callGemini(
    BENCHMARK_COMPARATOR_CALIBRATION_PROMPT,
    buildComparatorCalibrationInput(aggregate, comparatorContext),
    GEMINI_CALIBRATION_MODEL,
    { maxOutputTokens: 8192, includeThoughts: false },
  );
  const calibration = normalizeComparatorCalibrationResult(calibrationParsed, aggregate, comparatorContext);
  const updatedAggregate: AggregateReview = {
    ...aggregate,
    comparatorCalibration: calibration.comparatorCalibration,
    nearestComparators: calibration.nearestComparators,
    externalComparatorSuggestions: calibration.externalComparatorSuggestions,
    publicComparatorSummary: calibration.publicComparatorSummary,
    adminComparatorNotes: calibration.adminComparatorNotes,
    finalScoreBand: calibration.comparatorCalibration.finalPublicScoreBand,
    finalClassification: calibration.comparatorCalibration.finalClassification,
    finalScoreConfidence: calibration.comparatorCalibration.confidence,
    scoreCappingReason: calibration.comparatorCalibration.scoreCappingReason || aggregate.scoreCappingReason,
    internalCalibrationNotes: [
      aggregate.internalCalibrationNotes,
      calibration.comparatorCalibration.calibrationRationale,
      calibration.adminComparatorNotes,
    ].filter(Boolean).join("\n\n"),
  };

  return {
    aggregate: updatedAggregate,
    thinkingText: thinkingText
      ? `Comparator backfill (${GEMINI_CALIBRATION_MODEL})\n${thinkingText}`
      : null,
  };
}

function buildStoredReviewValues(result: MultiPassReviewResult) {
  const { representativeReview, aggregate } = result;
  const generatedAt = new Date().toISOString();
  const extractionMethod = reviewExtractionMethod(result.blindedContent);
  const pdfVisibleFallbackUsed = extractionMethod === "gemini-native-pdf-fallback";
  const blindingStrength = pdfVisibleFallbackUsed ? "weaker" : "strong";
  const firstComparisonCohort = result.individualReviews.find((review) => review.comparisonCohort)?.comparisonCohort || null;
  const firstBroadField = result.individualReviews.find((review) => review.broadField)?.broadField || null;
  const firstSpecialtyField = result.individualReviews.find((review) => review.specialtyField)?.specialtyField || null;
  const aggregateClassification = aggregate.finalClassification || representativeReview.bestClassification || classificationFallbackFromScore(aggregate.finalScoreBand.median);
  const comparisonCohort =
    aggregate.finalComparisonCohort ||
    representativeReview.comparisonCohort ||
    representativeReview.specialtyField ||
    representativeReview.broadField ||
    firstComparisonCohort ||
    firstSpecialtyField ||
    firstBroadField;
  const canonicalReview = v16CanonicalReviewFromAggregate(aggregate, representativeReview);
  const storedIndividualReviews = result.individualReviews.map(compactIndividualReviewForStorage);
  const comparatorCalibrationStatus = aggregate.comparatorCalibration.comparatorCalibrationStatus;
  const rawCalibrationAdjustment = Number(aggregate.comparatorCalibration.calibrationAdjustment ?? 0);
  const comparatorCalibrationApplied =
    result.pipelineMode !== "benchmark-ingestion" &&
    (comparatorCalibrationStatus === "applied" ||
      comparatorCalibrationStatus === "weak" ||
      (Number.isFinite(rawCalibrationAdjustment) && Math.abs(rawCalibrationAdjustment) > 0));
  const canonicalCoverageLedger = {
    reviewObjectVersion: REVIEW_OBJECT_VERSION,
    schemaVersion: "v16.7",
    promptVersion: REVIEW_PROMPT_VERSION,
    generatedAt,
    modelName: result.modelName,
    passModel: GEMINI_PASS_MODEL,
    adjudicatorModel: GEMINI_META_MODEL,
    passCount: REVIEW_PASS_COUNT,
    validPassCount: result.individualReviews.length,
    pipelineMode: result.pipelineMode,
    clusterVersion: "v16.7-canonical-ico",
    benchmarkSetCandidate: result.pipelineMode === "benchmark-ingestion",
    benchmarkSetVersion: result.pipelineMode === "benchmark-ingestion"
      ? BENCHMARK_SET_VERSION
      : aggregate.comparatorCalibration.benchmarkSetVersion,
    comparatorCalibrationStatus,
    ...(comparatorCalibrationApplied ? { calibrationAdjustment: rawCalibrationAdjustment } : {}),
    extractionMethod,
    pdfVisibleFallbackUsed,
    blindingStrength,
    usesFlashForScientificScoring: /flash/i.test(`${GEMINI_PASS_MODEL} ${GEMINI_META_MODEL}`),
    usesProOnlyForScientificScoring: !/flash/i.test(`${GEMINI_PASS_MODEL} ${GEMINI_META_MODEL}`),
    ...canonicalReview,
    finalScore: canonicalReview.intrinsicScore,
    blindPassScores: aggregate.individualScores,
    blindPassSpread: aggregate.scoreRange,
    passDisagreement: aggregate.scoreRange,
    scoreStability: aggregate.scoreStability,
    adjudicatorStatus: aggregate.adjudicatorStatus,
    diagnosticBaselineScore: aggregate.diagnosticBaselineScore,
    diagnosticBaselineDelta: aggregate.diagnosticBaselineDelta,
    scoringAnomaly: aggregate.scoringAnomaly,
    blindPassReviews: storedIndividualReviews,
    submissionSourceHash: null,
  };
  return {
    summary: "",
    correctness: "",
    novelty: "",
    overallEvaluation: "",
    score: aggregate.finalScoreBand.median,
    relatedWork: "",
    centralClaim: aggregate.finalCentralClaim || representativeReview.centralClaim || null,
    establishedResults: null,
    interpretiveClaims: null,
    speculativeClaims: null,
    economy: null,
    explanatoryTargetBreadth: null,
    theorySpaceBreadth: null,
    scopeDepth: null,
    unifyingPower: null,
    strongestCaseForImportance: null,
    strongestObjection: null,
    decisiveCheck: null,
    internalTechnicalTraction: null,
    noveltyConfidence: null,
    intrinsicScientificMeritScore: null,
    explanatoryTargetBreadthScore: null,
    theorySpaceBreadthScore: null,
    breadthOfImpactScore: null,
    overallIntrinsicScore: aggregate.finalScoreBand.median,
    bestClassification: aggregateClassification,
    finalJudgment: null,
    coverageLedgerJson: JSON.stringify(canonicalCoverageLedger),
    thinkingText: result.thinkingText,
    comparisonCohort,
    broadField: aggregate.finalBroadField || representativeReview.broadField || firstBroadField,
    specialtyField: aggregate.finalSpecialtyField || representativeReview.specialtyField || firstSpecialtyField,
    frameworkConditionalityLevel: null,
    frameworkConditionalityExplanation: null,
    specialtyRelativeScore: null,
    broadFieldRelativeScore: null,
    crossFieldConsequenceScore: null,
    scoreBandLow: null,
    scoreBandMedian: null,
    scoreBandHigh: null,
    scoreConfidence: String(aggregate.finalScoreConfidence),
    scoreStability: aggregate.scoreStability,
    publicVerdict: null,
    individualReviewsJson: JSON.stringify(storedIndividualReviews),
    aggregateMetaJson: JSON.stringify(canonicalReview),
    passCount: REVIEW_PASS_COUNT,
    modelName: result.modelName,
    systemPrompt: result.systemPrompt,
  };
}

export async function generateCompatReview(
  paperContent: ReviewInput,
  model: ReviewModel,
  promptOverride?: string,
  options: { selectComparatorContext?: ComparatorContextSelector; reviewMode?: ReviewPipelineMode } = {},
) {
  const result = await generateMultiPassReview(paperContent, model, promptOverride, options);
  const aggregate = result.aggregate;
  const representative = result.representativeReview;
  const reviewValues = buildStoredReviewValues(result);

  return {
    metadata: {
      field: aggregate.finalBroadField || representative.broadField || "Unknown",
      subfields: representative.subfields ?? [],
      modelName: result.modelName,
    },
    reviewValues,
  };
}
