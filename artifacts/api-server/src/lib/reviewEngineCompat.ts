import OpenAI from "openai";
import { createHash, randomUUID } from "crypto";
import { ai as geminiAI } from "@workspace/integrations-gemini-ai";
import {
  DATE_METADATA_EXTRACTION_V15_PROMPT,
} from "./prompts/benchmarkCalibratedV15";
import {
  BENCHMARK_CALIBRATED_V17_FULL_PROMPT,
  BLIND_INTRINSIC_ADJUDICATOR_V17_PROMPT,
  BLIND_REVIEW_PASS_V17_PROMPT,
} from "./prompts/diagnosticOnlyV17";
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
type CalibrationMode = "none" | "target_only" | "backfill_cluster" | "affected_neighborhood";
type DiagnosticSubscoreKey =
  | "inputStrengthScore"
  | "constructionStrengthScore"
  | "outputStrengthScore";
type DiagnosticSubscoreValidity = Record<DiagnosticSubscoreKey, boolean>;
type DiagnosticSubscoreRationale = Record<DiagnosticSubscoreKey, string>;

const CLASSIFICATIONS = [
  "transformative advance",
  "major advance",
  "significant contribution",
  "strong contribution",
  "substantial contribution",
  "moderate contribution",
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

type ScopeProfile = {
  scopeLevel: string;
  scopeExplanation: string;
  frameworkDependence: {
    level: FrameworkLevel;
    explanation: string;
  };
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

type SurvivingCorrectContribution = {
  contribution: string;
  kind: "method" | "derivation" | "calculation" | "relation" | "output" | "interpretation" | "other";
  valueLevel: "none" | "limited" | "moderate" | "high";
  scoreRelevance: string;
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
  failedConstructionsExcludedFromScore: string[];
  failedOutputsExcludedFromScore: string[];
  survivingCorrectContributions: SurvivingCorrectContribution[];
  survivingContributionScoreBasis: string;
  scoreBasisAfterExcludingFailures: string;
  overallCorrectnessSummary: string;
  calibrationAdjustments: string;
  subscoreConsistencyWarning: string;
  subscoreSaturationWarning: boolean;
  diagnosticBaselineScore: number;
  diagnosticBaselineDelta: number;
  scoreAdjustmentReason: string;
  scoringAnomaly: string;
};

type ReviewFailureAnalysis = {
  failedClaimsExcludedFromScore: string[];
  failedConstructionsExcludedFromScore: string[];
  failedOutputsExcludedFromScore: string[];
  survivingCorrectContributions: SurvivingCorrectContribution[];
  scoreBasisAfterExcludingFailures: string;
  overallCorrectnessSummary: string;
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

type DiagnosticScoreKey =
  | "inputStrengthScore"
  | "constructionStrengthScore"
  | "outputStrengthScore";

type DiagnosticChange = {
  dimension: DiagnosticScoreKey;
  from: number;
  to: number;
  rationale: string;
};

type DiagnosticComparatorCalibration = {
  comparatorCalibrationStatus: ComparatorCalibrationStatus;
  calibrationMode: CalibrationMode;
  calibrationVersion: string;
  comparatorRunId: string | null;
  comparatorModel: string | null;
  comparatorPromptHash: string | null;
  comparatorIds: string[];
  comparatorRetrievalMethod: string;
  targetOnly: boolean;
  existingPapersModified: boolean;
  modifiedPaperIds: string[];
  comparatorContextIncluded: boolean;
  calibrationContextIncluded: boolean;
  calibratedInputStrengthScore: number | null;
  calibratedConstructionStrengthScore: number | null;
  calibratedOutputStrengthScore: number | null;
  rawCalibratedScore: number | null;
  calibratedScore: number | null;
  calibrationRationale: string;
  diagnosticChanges: DiagnosticChange[];
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
  inputConstructionOutputAssessment?: unknown;
  scopeProfile?: unknown;
  organicCohortProfile?: unknown;
  inputStrengthScore?: number | null;
  constructionStrengthScore?: number | null;
  outputStrengthScore?: number | null;
  rawDiagnosticScore?: number | null;
  computedScore?: number | null;
  calibratedInputStrengthScore?: number | null;
  calibratedConstructionStrengthScore?: number | null;
  calibratedOutputStrengthScore?: number | null;
  rawCalibratedScore?: number | null;
  calibratedScore?: number | null;
  failureMode?: string | null;
  centralOutputDependency?: CentralOutputDependency | null;
  outputValidityAssessment?: OutputValidityAssessment | null;
  frameworkConditionality?: FrameworkLevel | string | null;
  frameworkDependence?: unknown;
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
  scopeProfile: ScopeProfile;
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
  diagnosticAssessmentConfidence: number;
  adjudicationRationale: string;
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
  scopeProfile: ScopeProfile;
  inputConstructionOutputLedger: InputConstructionOutputLedger;
  centralOutputDependency: CentralOutputDependency;
  outputValidityAssessment: OutputValidityAssessment;
  nearestComparators: NearestComparator[];
  externalComparatorSuggestions: ExternalComparatorSuggestion[];
  publicComparatorSummary: string;
  adminComparatorNotes: string;
  comparatorProfile: ComparatorProfile;
  comparatorCalibration: ComparatorCalibration;
  diagnosticComparatorCalibration?: DiagnosticComparatorCalibration | null;
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
  failedConstructionsExcludedFromScore: string[];
  failedOutputsExcludedFromScore: string[];
  survivingCorrectContributions: SurvivingCorrectContribution[];
  survivingContributionScoreBasis: string;
  scoreBasisAfterExcludingFailures: string;
  overallCorrectnessSummary: string;
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
  diagnosticAssessmentConfidence: number;
  adjudicationRationale: string;
  publicOneParagraphVerdict: string;
  internalCalibrationNotes: string;
};

type MultiPassReviewResult = {
  reviewRunId: string;
  modelName: string;
  pipelineMode: ReviewPipelineMode;
  systemPrompt: string;
  blindedContent: ReviewInput;
  individualReviews: IndividualReview[];
  aggregate: AggregateReview;
  representativeReview: IndividualReview;
  thinkingText: string | null;
  passAudit: ReviewRunAuditEntry[];
};

type IndividualPassResult = {
  review: IndividualReview;
  thinkingText: string | null;
  index: number;
  modelName: string;
  audit: ReviewRunAuditEntry;
};

type ReviewRunAuditEntry = {
  reviewRunId: string;
  paperId: string | null;
  promptVersion: string;
  promptHash: string;
  role: "blind_pass_1" | "blind_pass_2" | "blind_pass_replacement" | "adjudicator" | "comparator_calibration";
  passNumber: number | null;
  model: string;
  requestId: string | null;
  cacheUsed: boolean;
  previousReviewUsed: boolean;
  comparatorContextIncluded: boolean;
  adjudicatorContextIncluded: boolean;
  calibrationContextIncluded: boolean;
  calibrationMode?: CalibrationMode;
  calibrationVersion?: string | null;
  targetOnly?: boolean;
  existingPapersModified?: boolean;
  modifiedPaperIds?: string[];
  textHash: string;
  pdfHash: string | null;
  inputTokenCount: number | null;
  outputTokenCount: number | null;
  inputStrengthScore: number | null;
  constructionStrengthScore: number | null;
  outputStrengthScore: number | null;
  rawDiagnosticScore: number | null;
  computedScore: number | null;
  score: number | null;
  classification: string | null;
};



export const REVIEW_PROMPT_VERSION = "v17.0-diagnostic-only-computed-scoring";
const REVIEW_OBJECT_VERSION = "v17-diagnostic-only";
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



export const REVIEW_SYSTEM_INSTRUCTION = withLatexMarkdownFormatting(BLIND_REVIEW_PASS_V17_PROMPT);
export const REVIEW_FULL_PROMPT_SYSTEM = withLatexMarkdownFormatting(BENCHMARK_CALIBRATED_V17_FULL_PROMPT);
export const REVIEW_PROMPT_NAME = "v17.0 diagnostic-only computed scoring";
export const REVIEW_PROMPT_HASH = createHash("sha256")
  .update(REVIEW_SYSTEM_INSTRUCTION)
  .digest("hex")
  .slice(0, 16);
const BLIND_INTRINSIC_ADJUDICATOR_PROMPT = withLatexMarkdownFormatting(BLIND_INTRINSIC_ADJUDICATOR_V17_PROMPT);
const DIAGNOSTIC_COMPARATOR_CALIBRATION_PROMPT = withLatexMarkdownFormatting(`
You are the separate post-intrinsic comparator calibrator for Modern Science Review.

You do not perform the blind review. You do not adjudicate the blind passes. You receive a target paper's completed intrinsic canonical review profile and the nearest reviewed comparator profiles.

There are two calibration modes:

1. target_only
This mode is used when a new paper is uploaded after a benchmark exists. You may adjust only the target paper's diagnostic scores. Do not modify, reinterpret, or rescore the comparator papers. The benchmark remains fixed while scoring the target paper.

2. backfill_cluster or affected_neighborhood
This mode is an explicit admin backfill job. It may update the current paper being processed as part of a cluster or neighborhood recalibration version. Existing comparator papers may be separately processed by the same admin job, but each call returns calibration only for the target paper in that call.

Your task is only to check whether the target's three diagnostic scores are calibrated consistently against nearby reviewed papers:
- inputStrengthScore
- constructionStrengthScore
- outputStrengthScore

Compare the target against the provided comparators. Consider:
- whether input scores are consistent for similarly firm or weak inputs;
- whether construction scores are consistent for similarly forced, fragile, reusable, or ad hoc constructions;
- whether output scores are consistent for similarly central, valid, invalid, broad, narrow, or framework-dependent outputs;
- whether framework dependence is treated consistently;
- whether failed outputs and surviving correct contributions are treated consistently.

A prior paper may receive modest calibrated credit when it contains a correct equation, relation, transformation, method, or calculation that a later nearby paper shows to be structurally meaningful. Credit only the correct relation actually present in the prior paper. Do not credit the prior paper for the later paper's construction, framework, unification, or outputs.

This can raise Output Strength or Construction Strength modestly if justified, but should not transform a weak intrinsic paper into a major contribution unless the prior paper itself already established major correct structure.

You may adjust only those three diagnostic scores. Use 0.5-point increments on the 0-10 scale, including 0. Do not treat 1 as a minimum score. Do not output a free final score. Do not output a direct score adjustment. The application computes any public 0-100 score from the calibrated diagnostics.

Return exactly this JSON object:
{
  "calibratedInputStrengthScore": number,
  "calibratedConstructionStrengthScore": number,
  "calibratedOutputStrengthScore": number,
  "calibrationRationale": string,
  "diagnosticChanges": [
    {
      "dimension": "inputStrengthScore | constructionStrengthScore | outputStrengthScore",
      "from": number,
      "to": number,
      "rationale": string
    }
  ]
}
`);
const DIAGNOSTIC_COMPARATOR_CALIBRATION_PROMPT_HASH = createHash("sha256")
  .update(DIAGNOSTIC_COMPARATOR_CALIBRATION_PROMPT)
  .digest("hex")
  .slice(0, 16);

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
const scopeProfileJsonSchema = {
  type: "object",
  required: ["scopeLevel", "scopeExplanation", "frameworkDependence"],
  properties: {
    scopeLevel: jsonString,
    scopeExplanation: jsonString,
    frameworkDependence: frameworkConditionalityJsonSchema,
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
    "comparisonCohort",
    "localCohort",
    "broadField",
    "specialtyField",
    "subfields",
    "paperType",
    "centralClaim",
    "scientificReview",
    "contributionArchetype",
    "scopeProfile",
    "inputConstructionOutputAssessment",
    "technicalAssessment",
    "failureAnalysis",
    "organicCohortProfile",
    "inputStrengthScore",
    "constructionStrengthScore",
    "outputStrengthScore",
    "subscoreRationale",
    "diagnosticAssessmentConfidence",
    "adjudicationRationale",
  ],
  additionalProperties: false,
  properties: {
    comparisonCohort: jsonString,
    localCohort: jsonString,
    broadField: jsonString,
    specialtyField: jsonString,
    subfields: jsonStringArray,
    paperType: jsonString,
    centralClaim: jsonString,
    scientificReview: jsonString,
    contributionArchetype: contributionArchetypeJsonSchema,
    scopeProfile: scopeProfileJsonSchema,
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
        whatWouldRaiseSubscores: jsonString,
        whatWouldLowerSubscores: jsonString,
      },
    },
    failureAnalysis: {
      type: "object",
      additionalProperties: false,
      properties: {
        failedClaimsExcludedFromScore: jsonStringArray,
        failedConstructionsExcludedFromScore: jsonStringArray,
        failedOutputsExcludedFromScore: jsonStringArray,
        survivingCorrectContributions: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              contribution: jsonString,
              kind: jsonString,
              valueLevel: jsonString,
              scoreRelevance: jsonString,
            },
          },
        },
        scoreBasisAfterExcludingFailures: jsonString,
        overallCorrectnessSummary: jsonString,
      },
    },
    inputStrengthScore: jsonNumber,
    constructionStrengthScore: jsonNumber,
    outputStrengthScore: jsonNumber,
    subscoreRationale: {
      type: "object",
      additionalProperties: true,
      properties: {
        inputStrengthScore: jsonString,
        constructionStrengthScore: jsonString,
        outputStrengthScore: jsonString,
      },
    },
    diagnosticAssessmentConfidence: jsonNumber,
    adjudicationRationale: jsonString,
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
    metadataQaWarnings: jsonStringArray,
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

function roundToNearestHalf(value: number) {
  return Math.round(Math.max(0, Math.min(10, value)) * 2) / 2;
}

function normalizeDiagnosticSubscore(value: unknown, fallback?: number) {
  const explicit = asOptionalNumber(value, 0, 10);
  if (explicit != null) return roundToNearestHalf(explicit);
  return roundToNearestHalf(fallback ?? 0);
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
  return Math.round(rawDiagnosticScore(scores));
}

function rawDiagnosticScore(scores: number[]) {
  if (scores.length === 0) return 0;
  const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  return Math.max(0, Math.min(100, average * 10));
}

function scoreBandFromComputedScore(score: number): ScoreBand {
  const safeScore = Math.round(Math.max(0, Math.min(100, score)));
  return { low: safeScore, median: safeScore, high: safeScore };
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

function normalizeScopeProfile(value: unknown, fallback?: ScopeProfile): ScopeProfile {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const frameworkDependence = source.frameworkDependence && typeof source.frameworkDependence === "object"
    ? (source.frameworkDependence as Record<string, unknown>)
    : {};
  return {
    scopeLevel: firstString([source.scopeLevel, source.level], fallback?.scopeLevel ?? ""),
    scopeExplanation: firstString([source.scopeExplanation, source.explanation, source.assessment], fallback?.scopeExplanation ?? ""),
    frameworkDependence: {
      level: normalizeFrameworkLevel(frameworkDependence.level ?? source.frameworkDependenceLevel ?? fallback?.frameworkDependence.level),
      explanation: firstString([
        frameworkDependence.explanation,
        source.frameworkDependenceExplanation,
        source.frameworkDependence,
      ], fallback?.frameworkDependence.explanation ?? ""),
    },
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

function normalizeSurvivingCorrectContributions(value: unknown): SurvivingCorrectContribution[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const source = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const contribution = firstString([source.contribution, source.claimOrContribution, source.claim, source.description]);
      if (!contribution) return null;
      const rawKind = asString(source.kind).toLowerCase().replace(/[\s-]+/g, "_");
      const kind: SurvivingCorrectContribution["kind"] =
        rawKind === "method" ||
        rawKind === "derivation" ||
        rawKind === "calculation" ||
        rawKind === "relation" ||
        rawKind === "output" ||
        rawKind === "interpretation" ||
        rawKind === "other"
          ? rawKind
          : "other";
      const rawValue = asString(source.valueLevel ?? source.value).toLowerCase().replace(/[\s-]+/g, "_");
      const valueLevel: SurvivingCorrectContribution["valueLevel"] =
        rawValue === "none" ||
        rawValue === "limited" ||
        rawValue === "moderate" ||
        rawValue === "high"
          ? rawValue
          : "limited";
      return {
        contribution,
        kind,
        valueLevel,
        scoreRelevance: firstString([source.scoreRelevance, source.relevance, source.rationale, source.notes]),
      } satisfies SurvivingCorrectContribution;
    })
    .filter(Boolean) as SurvivingCorrectContribution[];
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

function defaultDiagnosticComparatorCalibration(
  status: ComparatorCalibrationStatus,
  rationale: string,
  comparatorIds: string[] = [],
  calibrationMode: CalibrationMode = "none",
  modifiedPaperIds: string[] = [],
): DiagnosticComparatorCalibration {
  const existingPapersModified = calibrationMode === "backfill_cluster" || calibrationMode === "affected_neighborhood";
  return {
    comparatorCalibrationStatus: status,
    calibrationMode,
    calibrationVersion: calibrationMode === "none" ? "" : BENCHMARK_SET_VERSION,
    comparatorRunId: null,
    comparatorModel: null,
    comparatorPromptHash: null,
    comparatorIds,
    comparatorRetrievalMethod: "canonical-profile-token-overlap-k8",
    targetOnly: calibrationMode === "target_only",
    existingPapersModified,
    modifiedPaperIds: existingPapersModified ? modifiedPaperIds : [],
    comparatorContextIncluded: comparatorIds.length > 0,
    calibrationContextIncluded: false,
    calibratedInputStrengthScore: null,
    calibratedConstructionStrengthScore: null,
    calibratedOutputStrengthScore: null,
    rawCalibratedScore: null,
    calibratedScore: null,
    calibrationRationale: rationale,
    diagnosticChanges: [],
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
  if (score >= 95) return "transformative advance";
  if (score >= 90) return "major advance";
  if (score >= 80) return "significant contribution";
  if (score >= 70) return "strong contribution";
  if (score >= 60) return "substantial contribution";
  if (score >= 50) return "moderate contribution";
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
    "field-defining advance": "transformative advance",
    "framework-defining advance": "major advance",
    "major specialty advance": "major advance",
    "specialty advance": "significant contribution",
    "strong niche contribution": "strong contribution",
    "niche contribution": "substantial contribution",
    "minor contribution": "moderate contribution",
    "useful clarification": "moderate contribution",
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
  const scopeProfile = normalizeScopeProfile(source.scopeProfile);
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
  const diagnosticScores = [inputStrengthScore, constructionStrengthScore, outputStrengthScore];
  const rawComputedScore = rawDiagnosticScore(diagnosticScores);
  const computedScore = diagnosticBaselineScore(diagnosticScores);
  const computedScoreBand = scoreBandFromComputedScore(computedScore);
  const computedClassification = classificationFallbackFromScore(computedScore);

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
    scopeProfile,
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
    whatWouldRaiseScore: firstString([technicalAssessment.whatWouldRaiseSubscores, technicalAssessment.whatWouldRaiseScore, source.whatWouldRaiseSubscores, source.whatWouldRaiseScore, source.raiseScore, source.scoreUpside]),
    whatWouldLowerScore: firstString([technicalAssessment.whatWouldLowerSubscores, technicalAssessment.whatWouldLowerScore, source.whatWouldLowerSubscores, source.whatWouldLowerScore, source.lowerScore, source.scoreDownside]),
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
    scoreCappingReason: "",
    scoreAdjustmentReason: "",
    specialtyRelativeScore: computedScore,
    broadFieldRelativeScore: computedScore,
    crossFieldConsequenceScore: computedScore,
    scoreBand: computedScoreBand,
    scoreConfidence: asNumber(source.diagnosticAssessmentConfidence, 0.9, 0, 1),
    diagnosticAssessmentConfidence: asNumber(source.diagnosticAssessmentConfidence, 0.9, 0, 1),
    adjudicationRationale: asString(source.adjudicationRationale),
    bestClassification: computedClassification,
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
      failedClaimsExcludedFromScore: firstStringArray([
        failureAnalysis.failedClaimsExcludedFromScore,
        source.failedClaimsExcludedFromScore,
      ]),
      failedConstructionsExcludedFromScore: firstStringArray([
        failureAnalysis.failedConstructionsExcludedFromScore,
        source.failedConstructionsExcludedFromScore,
      ]),
      failedOutputsExcludedFromScore: firstStringArray([
        failureAnalysis.failedOutputsExcludedFromScore,
        source.failedOutputsExcludedFromScore,
      ]),
      survivingCorrectContributions: normalizeSurvivingCorrectContributions(failureAnalysis.survivingCorrectContributions),
      scoreBasisAfterExcludingFailures: firstString([
        failureAnalysis.scoreBasisAfterExcludingFailures,
        source.scoreBasisAfterExcludingFailures,
      ]),
      overallCorrectnessSummary: firstString([
        failureAnalysis.overallCorrectnessSummary,
        source.overallCorrectnessSummary,
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
  metadataQaWarnings?: string[];
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

function inferArxivFirstSubmissionMonth(arxivId?: string) {
  const normalizedId = normalizeArxivId(arxivId);
  if (!normalizedId) return "";
  const oldStyle = normalizedId.match(/^[a-z-]+(?:\.[A-Z]{2})?\/(\d{2})(\d{2})\d{3}$/i);
  const modern = normalizedId.match(/^(\d{2})(\d{2})\.\d{4,5}$/);
  const match = oldStyle || modern;
  if (!match) return "";
  const yy = Number(match[1]);
  const mm = Number(match[2]);
  if (!Number.isFinite(yy) || !Number.isFinite(mm) || mm < 1 || mm > 12) return "";
  const year = yy >= 91 ? 1900 + yy : 2000 + yy;
  return `${year}-${String(mm).padStart(2, "0")}`;
}

const KNOWN_ARXIV_AUTHOR_OVERRIDES: Record<string, string[]> = {
  "astro-ph/0306438": ["Sean M. Carroll", "Vikram Duvvuri", "Mark Trodden", "Michael S. Turner"],
  "hep-th/0501055": ["Rong-Gen Cai", "Sang Pyo Kim"],
  "1110.4055": ["Ernesto Frodden", "Amit Ghosh", "Alejandro Perez"],
};

function knownArxivAuthors(arxivId?: string) {
  const normalizedId = normalizeArxivId(arxivId).toLowerCase();
  return normalizedId ? (KNOWN_ARXIV_AUTHOR_OVERRIDES[normalizedId] ?? []) : [];
}

type BenchmarkMetadataOverride = {
  title: string;
  authors: string[];
  arxivId?: string;
  doi?: string;
  journalName?: string;
  journalPublicationDate?: string;
  dateNotes?: string;
};

const BENCHMARK_METADATA_OVERRIDES: Array<{
  id: string;
  match: RegExp;
  override: BenchmarkMetadataOverride;
}> = [
  {
    id: "four-laws-black-hole-mechanics",
    match: /\b(?:four\s+laws\s+of\s+black\s+hole\s+mechanics|bf01645742|bardeen[\s\S]{0,80}carter[\s\S]{0,80}hawking)\b/i,
    override: {
      title: "The Four Laws of Black Hole Mechanics",
      authors: ["J. M. Bardeen", "B. Carter", "S. W. Hawking"],
      doi: "10.1007/BF01645742",
      journalName: "Communications in Mathematical Physics",
      journalPublicationDate: "1973",
      dateNotes: "Benchmark metadata override for the canonical Four Laws paper.",
    },
  },
  {
    id: "frodden-ghosh-perez-local-first-law",
    match: /\b(?:1110\.4055|local\s+first\s+law\s+for\s+black\s+hole\s+thermodynamics|frodden[\s\S]{0,80}ghosh[\s\S]{0,80}perez)\b/i,
    override: {
      title: "A Local First Law for Black Hole Thermodynamics",
      authors: ["Ernesto Frodden", "Amit Ghosh", "Alejandro Perez"],
      arxivId: "1110.4055",
      journalName: "Physical Review D",
      dateNotes: "Benchmark metadata override for the Frodden-Ghosh-Perez paper.",
    },
  },
  {
    id: "hawking-particle-creation-black-holes",
    match: /\b(?:particle\s+creation\s+by\s+black\s+holes|bf02345020|commun\.?\s*math\.?\s*phys\.?\s*43[\s,]+199[-–]{1,2}220\s*\(?1975\)?)\b/i,
    override: {
      title: "Particle Creation by Black Holes",
      authors: ["S. W. Hawking"],
      doi: "10.1007/BF02345020",
      journalName: "Communications in Mathematical Physics",
      journalPublicationDate: "1975",
      dateNotes: "Benchmark metadata override for Hawking's canonical black-hole radiation paper.",
    },
  },
];

function benchmarkMetadataOverrideForText(value?: string): BenchmarkMetadataOverride | null {
  const haystack = stripControlChars(value || "").replace(/\s+/g, " ");
  if (!haystack) return null;
  return BENCHMARK_METADATA_OVERRIDES.find((entry) => entry.match.test(haystack))?.override ?? null;
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
    .replace(/^\s*(?:©|\(c\)|copyright)\s*(?:by\s+)?(?:springer(?:-verlag)?|elsevier|world\s+scientific|american\s+physical\s+society|aps|iop|wiley|cambridge\s+university\s+press|oxford\s+university\s+press)?\s*(?:[,.:;-]?\s*\d{4})?\s*/i, " ")
    .replace(/^\s*(?:by\s+)?(?:springer(?:-verlag)?|elsevier|world\s+scientific|american\s+physical\s+society|aps|iop|wiley)\s*(?:[,.:;-]?\s*\d{4})?\s*/i, " ")
    .replace(/\b(?:preprint|report)\s+no\.?\s*[:#]?\s*/gi, " ")
    .replace(/^\s*page\s+\d+\s+of\s+\d+\s*/i, " ")
    .replace(/\b(?:commun\.?\s*math\.?\s*phys\.?|physical\s+review|phys\.?\s*rev\.?|class\.?\s*quantum\s*grav\.?)\s+\d+[^A-Za-z]+(?:\d+[-–]\d+)?\s*\(?\d{4}\)?/gi, " ")
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
    .replace(/^\s*(?:©|\(c\)|copyright)\s*(?:by\s+)?(?:[A-Za-z.-]+(?:\s+[A-Za-z.-]+){0,3})?\s*\d{4}\s*/i, "")
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

function reviewInputAuditHashes(input: ReviewInput) {
  const text = reviewInputText(input);
  const pdfBase64 = typeof input === "string" ? "" : input.pdfBase64;
  return {
    textHash: createHash("sha256").update(text).digest("hex"),
    pdfHash: pdfBase64 ? createHash("sha256").update(pdfBase64).digest("hex") : null,
  };
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
    const usage = (response as any).usageMetadata ?? null;
    return {
      parsed: extractJson(content),
      thinkingText,
      requestId: (response as any).responseId ?? (response as any).id ?? null,
      usage: {
        inputTokenCount: typeof usage?.promptTokenCount === "number" ? usage.promptTokenCount : null,
        outputTokenCount: typeof usage?.candidatesTokenCount === "number" ? usage.candidatesTokenCount : null,
      },
    };
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
  reviewRunId: string,
  inputAuditHashes: { textHash: string; pdfHash: string | null },
): Promise<IndividualPassResult> {
  const { parsed, thinkingText, requestId, usage } = await callGemini(
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
    audit: {
      reviewRunId,
      paperId: null,
      promptVersion: REVIEW_PROMPT_VERSION,
      promptHash: REVIEW_PROMPT_HASH,
      role: index < REVIEW_PASS_COUNT ? `blind_pass_${index + 1}` as "blind_pass_1" | "blind_pass_2" : "blind_pass_replacement",
      passNumber: index + 1,
      model: GEMINI_PASS_MODEL,
      requestId,
      cacheUsed: false,
      previousReviewUsed: false,
      comparatorContextIncluded: false,
      adjudicatorContextIncluded: false,
      calibrationContextIncluded: false,
      textHash: inputAuditHashes.textHash,
      pdfHash: inputAuditHashes.pdfHash,
      inputTokenCount: usage.inputTokenCount,
      outputTokenCount: usage.outputTokenCount,
      inputStrengthScore: review.inputStrengthScore,
      constructionStrengthScore: review.constructionStrengthScore,
      outputStrengthScore: review.outputStrengthScore,
      rawDiagnosticScore: rawDiagnosticScore(diagnosticSubscoreValues(review)),
      computedScore: review.scoreBand.median,
      score: review.scoreBand.median,
      classification: review.bestClassification || null,
    },
  };
}

async function runPassWithGenerationRetries(
  prompt: string,
  input: ReviewInput,
  index: number,
  reviewRunId: string,
  inputAuditHashes: { textHash: string; pdfHash: string | null },
): Promise<IndividualPassResult> {
  let lastError: unknown;
  for (let attempt = 0; attempt < PASS_GENERATION_ATTEMPTS; attempt += 1) {
    try {
      return await runIndividualPass(prompt, input, "gemini", index, reviewRunId, inputAuditHashes);
    } catch (reason) {
      lastError = reason;
      if (attempt < PASS_GENERATION_ATTEMPTS - 1) {
        await sleep(passAttemptDelayMs(attempt, reason));
      }
    }
  }
  throw new Error(`pass ${index + 1} failed after ${PASS_GENERATION_ATTEMPTS} generation attempts: ${errorMessage(lastError)}`);
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
  const aggregateScopeProfile = normalizeScopeProfile(source.scopeProfile ?? root.scopeProfile, fallbackReview.scopeProfile);
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
  const legacySurvivingHighValueContributions = firstStringArray([
    aggregateFailureAnalysis.survivingHighValueContributions,
    root.survivingHighValueContributions,
    source.survivingHighValueContributions,
    adjudicationSource.survivingHighValueContributions,
  ]);
  const survivingCorrectContributions = [
    ...normalizeSurvivingCorrectContributions(aggregateFailureAnalysis.survivingCorrectContributions),
    ...legacySurvivingHighValueContributions.map((contribution) => ({
      contribution,
      kind: "other" as const,
      valueLevel: "high" as const,
      scoreRelevance: "",
    })),
  ].filter((item, index, array) =>
    item.contribution &&
    array.findIndex((candidate) => candidate.contribution === item.contribution) === index,
  );
  const inventorySurvivors = survivingInventoryContributions(contributionInventory).map((item) => item.claimOrContribution);
  const failedClaimsExcludedFromScore = firstStringArray([
    aggregateFailureAnalysis.failedClaimsExcludedFromAssessment,
    aggregateFailureAnalysis.failedClaimsExcludedFromScore,
    root.failedClaimsExcludedFromAssessment,
    root.failedClaimsExcludedFromScore,
    source.failedClaimsExcludedFromAssessment,
    source.failedClaimsExcludedFromScore,
    adjudicationSource.failedClaimsExcludedFromAssessment,
    adjudicationSource.failedClaimsExcludedFromScore,
  ]);
  const failedConstructionsExcludedFromScore = firstStringArray([
    aggregateFailureAnalysis.failedConstructionsExcludedFromScore,
    root.failedConstructionsExcludedFromScore,
    source.failedConstructionsExcludedFromScore,
    adjudicationSource.failedConstructionsExcludedFromScore,
  ]);
  const failedOutputsExcludedFromScore = firstStringArray([
    aggregateFailureAnalysis.failedOutputsExcludedFromScore,
    root.failedOutputsExcludedFromScore,
    source.failedOutputsExcludedFromScore,
    adjudicationSource.failedOutputsExcludedFromScore,
  ]);
  const scoreBasisAfterExcludingFailures = firstString([
    aggregateFailureAnalysis.scoreBasisAfterExcludingFailures,
    aggregateFailureAnalysis.survivingContributionAssessmentBasis,
    aggregateFailureAnalysis.survivingContributionScoreBasis,
    root.scoreBasisAfterExcludingFailures,
    root.survivingContributionAssessmentBasis,
    root.survivingContributionScoreBasis,
    source.scoreBasisAfterExcludingFailures,
    source.survivingContributionAssessmentBasis,
    source.survivingContributionScoreBasis,
    adjudicationSource.scoreBasisAfterExcludingFailures,
    adjudicationSource.survivingContributionAssessmentBasis,
    adjudicationSource.survivingContributionScoreBasis,
  ]);
  const overallCorrectnessSummary = firstString([
    aggregateFailureAnalysis.overallCorrectnessSummary,
    root.overallCorrectnessSummary,
    source.overallCorrectnessSummary,
    adjudicationSource.overallCorrectnessSummary,
    aggregateTechnicalAssessment.correctness,
  ]);
  const subscoreSaturationWarning =
    asBoolean(adjudicationSource.subscoreSaturationWarning) ||
    computeSubscoreSaturationWarning(diagnosticSubscoreValues(aggregateSubscores), aggregateSubscoreValidity);
  const allSurvivingCorrectContributionTexts = [
    ...survivingCorrectContributions.map((item) => item.contribution),
    ...inventorySurvivors,
  ]
    .filter((item, index, array) => item && array.indexOf(item) === index);

  const adjudicationRepairNotes: string[] = [];
  const aggregateDiagnosticScores = diagnosticSubscoreValues(aggregateSubscores);
  const rawFinalDiagnosticScore = rawDiagnosticScore(aggregateDiagnosticScores);
  const baselineScore = Math.round(rawFinalDiagnosticScore);
  finalScoreBand = scoreBandFromComputedScore(baselineScore);
  const baselineDelta = 0;
  scoreCappingReason = "";
  scoreAdjustmentReason = "";

  const adjustedFinalClassification = classificationFallbackFromScore(baselineScore);

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
    scoreBasisAfterExcludingFailures,
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
    scopeProfile: aggregateScopeProfile,
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
    diagnosticComparatorCalibration: defaultDiagnosticComparatorCalibration("not_run", "No comparator calibration pass has run yet."),
    blindIntrinsicScoreBand: finalScoreBand,
    adjudication: {
      adjudicatorStatus: "success",
      individualScores: usableScores,
      scoreRange,
      scoreStability,
      mainAgreements: firstStringArray([adjudicationSource.mainAgreements, source.mainAgreements]),
      mainDisagreements: firstStringArray([adjudicationSource.mainDisagreements, source.mainDisagreements]),
      fatalObjectionPresent: false,
      fatalObjectionAssessment: "",
      fatalToSpecificClaimOnly: false,
      paperFatalError: false,
      contributionInventory,
      survivingHighValueContributions: allSurvivingCorrectContributionTexts,
      failedClaimsExcludedFromScore,
      failedConstructionsExcludedFromScore,
      failedOutputsExcludedFromScore,
      survivingCorrectContributions,
      survivingContributionScoreBasis: scoreBasisAfterExcludingFailures,
      scoreBasisAfterExcludingFailures,
      overallCorrectnessSummary,
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
    fatalObjectionPresent: false,
    fatalObjectionAssessment: "",
    fatalToSpecificClaimOnly: false,
    paperFatalError: false,
    contributionInventory,
    survivingHighValueContributions: allSurvivingCorrectContributionTexts,
    failedClaimsExcludedFromScore,
    failedConstructionsExcludedFromScore,
    failedOutputsExcludedFromScore,
    survivingCorrectContributions,
    survivingContributionScoreBasis: scoreBasisAfterExcludingFailures,
    scoreBasisAfterExcludingFailures,
    overallCorrectnessSummary,
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
    whatWouldRaiseScore: asString(source.whatWouldRaiseSubscores ?? aggregateTechnicalAssessment.whatWouldRaiseSubscores ?? source.whatWouldRaiseScore ?? aggregateTechnicalAssessment.whatWouldRaiseScore, fallbackReview.whatWouldRaiseScore),
    whatWouldLowerScore: asString(source.whatWouldLowerSubscores ?? aggregateTechnicalAssessment.whatWouldLowerSubscores ?? source.whatWouldLowerScore ?? aggregateTechnicalAssessment.whatWouldLowerScore, fallbackReview.whatWouldLowerScore),
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
    finalScoreConfidence: asNumber(source.diagnosticAssessmentConfidence ?? source.finalScoreConfidence ?? source.scoreConfidence, fallbackReview.scoreConfidence, 0, 1),
    diagnosticAssessmentConfidence: asNumber(source.diagnosticAssessmentConfidence ?? source.finalScoreConfidence ?? source.scoreConfidence, fallbackReview.scoreConfidence, 0, 1),
    adjudicationRationale: asString(source.adjudicationRationale ?? root.adjudicationRationale),
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
    failedClaimsExcludedFromScore: aggregate.failedClaimsExcludedFromScore,
    failedConstructionsExcludedFromScore: aggregate.failedConstructionsExcludedFromScore,
    failedOutputsExcludedFromScore: aggregate.failedOutputsExcludedFromScore,
    survivingCorrectContributions: aggregate.survivingCorrectContributions,
    scoreBasisAfterExcludingFailures: aggregate.scoreBasisAfterExcludingFailures,
    overallCorrectnessSummary: aggregate.overallCorrectnessSummary,
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
    scopeProfile: review.scopeProfile,
    inputStrengthScore: review.inputStrengthScore,
    constructionStrengthScore: review.constructionStrengthScore,
    outputStrengthScore: review.outputStrengthScore,
    subscoreRationale: review.subscoreRationale,
    inputConstructionOutputAssessment: v16IcoAssessmentOnly(review.inputConstructionOutputLedger),
    technicalAssessment: v16TechnicalAssessmentFromIndividual(review),
    failureAnalysis: review.failureAnalysis,
    organicCohortProfile: v16OrganicCohortProfileOnly(review.organicCohortProfile),
    rawDiagnosticScore: rawDiagnosticScore(diagnosticSubscoreValues(review)),
    computedScore: review.scoreBand.median,
    intrinsicScore: review.scoreBand.median,
    publicMagnitudeLabel: review.bestClassification,
    diagnosticAssessmentConfidence: review.diagnosticAssessmentConfidence,
    adjudicationRationale: review.adjudicationRationale,
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
    scopeProfile: aggregate.scopeProfile,
    inputStrengthScore: aggregate.inputStrengthScore,
    constructionStrengthScore: aggregate.constructionStrengthScore,
    outputStrengthScore: aggregate.outputStrengthScore,
    subscoreRationale: aggregate.subscoreRationale,
    inputConstructionOutputAssessment: v16IcoAssessmentOnly(aggregate.inputConstructionOutputLedger),
    technicalAssessment: v16TechnicalAssessmentFromAggregate(aggregate),
    failureAnalysis: v16FailureAnalysisFromAggregate(aggregate),
    organicCohortProfile: v16OrganicCohortProfileOnly(aggregate.comparatorProfile),
    rawDiagnosticScore: rawDiagnosticScore(diagnosticSubscoreValues(aggregate)),
    computedScore: aggregate.finalScoreBand.median,
    intrinsicScore: aggregate.finalScoreBand.median,
    publicMagnitudeLabel: aggregate.finalClassification,
    diagnosticAssessmentConfidence: aggregate.diagnosticAssessmentConfidence,
    adjudicationRationale: aggregate.adjudicationRationale,
    bestClassification: aggregate.finalClassification,
  };
}

function compactIndividualReviewForAdjudicator(review: IndividualReview, index: number) {
  const canonical = v16CanonicalReviewFromIndividual(review, index);
  return {
    passNumber: index + 1,
    passScore: canonical.computedScore,
    rawDiagnosticScore: canonical.rawDiagnosticScore,
    publicMagnitudeLabel: review.bestClassification,
    comparisonCohort: review.comparisonCohort,
    localCohort: review.localCohort,
    broadField: review.broadField,
    specialtyField: review.specialtyField,
    contributionArchetype: review.contributionArchetype,
    scopeProfile: review.scopeProfile,
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
  };
}

function compactIndividualReviewForStorage(review: IndividualReview, index: number) {
  return {
    ...compactIndividualReviewForAdjudicator(review, index),
    score: review.scoreBand.median,
    intrinsicScore: review.scoreBand.median,
    computedScore: review.scoreBand.median,
    bestClassification: review.bestClassification,
    classification: review.bestClassification,
    scoreConfidence: review.scoreConfidence,
    diagnosticAssessmentConfidence: review.diagnosticAssessmentConfidence,
    adjudicationRationale: review.adjudicationRationale,
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
    contributionInventory: aggregate.contributionInventory,
    failedClaimsExcludedFromScore: aggregate.failedClaimsExcludedFromScore,
    failedConstructionsExcludedFromScore: aggregate.failedConstructionsExcludedFromScore,
    failedOutputsExcludedFromScore: aggregate.failedOutputsExcludedFromScore,
    survivingCorrectContributions: aggregate.survivingCorrectContributions,
    scoreBasisAfterExcludingFailures: aggregate.scoreBasisAfterExcludingFailures,
    overallCorrectnessSummary: aggregate.overallCorrectnessSummary,
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
      failedClaimsExcludedFromScore: aggregate.failedClaimsExcludedFromScore,
      failedConstructionsExcludedFromScore: aggregate.failedConstructionsExcludedFromScore,
      failedOutputsExcludedFromScore: aggregate.failedOutputsExcludedFromScore,
      survivingCorrectContributions: aggregate.survivingCorrectContributions,
      scoreBasisAfterExcludingFailures: aggregate.scoreBasisAfterExcludingFailures,
      overallCorrectnessSummary: aggregate.overallCorrectnessSummary,
    },
    nearestComparators: aggregate.nearestComparators,
    externalComparatorSuggestions: aggregate.externalComparatorSuggestions,
    publicComparatorSummary: aggregate.publicComparatorSummary,
    adminComparatorNotes: aggregate.adminComparatorNotes,
    comparatorProfile: v15ComparatorProfileOnly(aggregate.comparatorProfile),
    comparatorCalibration: v15ComparatorCalibrationForStorage(aggregate.comparatorCalibration),
    diagnosticComparatorCalibration: aggregate.diagnosticComparatorCalibration ?? null,
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
  blindedContent: ReviewInput,
  reviews: IndividualReview[],
): ReviewInput {
  const compactPasses = reviews.map(compactIndividualReviewForAdjudicator);
  const text = JSON.stringify({
    adjudicatorInputNote:
      "Use the blinded manuscript and both independent v17 diagnostic-only blind passes. Resolve final Input Strength, Construction Strength, and Output Strength. Do not output a final 0-100 score, score band, score label, score cap, or score adjustment.",
    blindedManuscriptText: reviewInputText(blindedContent).slice(0, 60000),
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

function canonicalDiagnosticProfileFromAggregate(aggregate: AggregateReview) {
  return {
    comparisonCohort: aggregate.finalComparisonCohort,
    localCohort: aggregate.finalLocalCohort,
    broadField: aggregate.finalBroadField,
    specialtyField: aggregate.finalSpecialtyField,
    centralClaim: aggregate.finalCentralClaim,
    scientificReview: aggregate.scientificReview,
    contributionArchetype: aggregate.contributionArchetype,
    scopeProfile: aggregate.scopeProfile,
    inputConstructionOutputAssessment: v16IcoAssessmentOnly(aggregate.inputConstructionOutputLedger),
    technicalAssessment: v16TechnicalAssessmentFromAggregate(aggregate),
    failureAnalysis: v16FailureAnalysisFromAggregate(aggregate),
    organicCohortProfile: v16OrganicCohortProfileOnly(aggregate.comparatorProfile),
    inputStrengthScore: aggregate.inputStrengthScore,
    constructionStrengthScore: aggregate.constructionStrengthScore,
    outputStrengthScore: aggregate.outputStrengthScore,
    rawDiagnosticScore: rawDiagnosticScore(diagnosticSubscoreValues(aggregate)),
    computedScore: aggregate.blindIntrinsicScoreBand.median,
    bestClassification: aggregate.finalClassification,
  };
}

function canonicalDiagnosticProfileFromUnknown(input: unknown) {
  const source = input && typeof input === "object" ? (input as Record<string, any>) : {};
  const inputScore = normalizeDiagnosticSubscore(source.inputStrengthScore ?? source.finalInputStrengthScore);
  const constructionScore = normalizeDiagnosticSubscore(source.constructionStrengthScore ?? source.finalConstructionStrengthScore);
  const outputScore = normalizeDiagnosticSubscore(source.outputStrengthScore ?? source.finalOutputStrengthScore);
  return {
    comparisonCohort: source.comparisonCohort ?? source.finalComparisonCohort ?? null,
    localCohort: source.localCohort ?? source.finalLocalCohort ?? null,
    broadField: source.broadField ?? source.finalBroadField ?? null,
    specialtyField: source.specialtyField ?? source.finalSpecialtyField ?? null,
    subfields: Array.isArray(source.subfields) ? source.subfields : [],
    centralClaim: source.centralClaim ?? source.finalCentralClaim ?? null,
    scientificReview: source.scientificReview ?? null,
    contributionArchetype: source.contributionArchetype ?? null,
    scopeProfile: source.scopeProfile ?? null,
    inputConstructionOutputAssessment: source.inputConstructionOutputAssessment ?? source.inputConstructionOutputLedger ?? null,
    technicalAssessment: source.technicalAssessment ?? null,
    failureAnalysis: source.failureAnalysis ?? null,
    organicCohortProfile: source.organicCohortProfile ?? source.comparatorProfile ?? null,
    inputStrengthScore: inputScore,
    constructionStrengthScore: constructionScore,
    outputStrengthScore: outputScore,
    rawDiagnosticScore: rawDiagnosticScore([inputScore, constructionScore, outputScore]),
    computedScore: Math.round(rawDiagnosticScore([inputScore, constructionScore, outputScore])),
    bestClassification: source.bestClassification ?? source.publicMagnitudeLabel ?? null,
  };
}

function compactComparatorProfileForCalibration(candidate: ReviewComparatorContextItem, index: number) {
  const scores = [
    normalizeDiagnosticSubscore(candidate.inputStrengthScore),
    normalizeDiagnosticSubscore(candidate.constructionStrengthScore),
    normalizeDiagnosticSubscore(candidate.outputStrengthScore),
  ];
  return {
    comparatorId: candidate.comparatorId || `C${index + 1}`,
    paperId: candidate.sitePaperId,
    title: candidate.title,
    field: candidate.field,
    subfields: candidate.subfields,
    comparisonCohort: candidate.comparisonCohort,
    localCohort: candidate.localCohort,
    classification: candidate.classification,
    score: candidate.score,
    intrinsicScore: candidate.computedScore ?? candidate.score,
    inputStrengthScore: scores[0],
    constructionStrengthScore: scores[1],
    outputStrengthScore: scores[2],
    rawDiagnosticScore: candidate.rawDiagnosticScore ?? rawDiagnosticScore(scores),
    calibratedInputStrengthScore: candidate.calibratedInputStrengthScore ?? null,
    calibratedConstructionStrengthScore: candidate.calibratedConstructionStrengthScore ?? null,
    calibratedOutputStrengthScore: candidate.calibratedOutputStrengthScore ?? null,
    calibratedScore: candidate.calibratedScore ?? null,
    centralClaim: candidate.centralClaim,
    summary: candidate.summary,
    contributionArchetype: candidate.contributionArchetype,
    scopeProfile: candidate.scopeProfile,
    inputConstructionOutputAssessment: candidate.inputConstructionOutputAssessment ?? candidate.inputConstructionOutputLedger,
    frameworkDependence: candidate.frameworkDependence ?? candidate.frameworkConditionality,
    failureMode: candidate.failureMode,
    organicCohortProfile: candidate.organicCohortProfile,
    comparatorSearchSummary: candidate.comparatorSearchSummary,
  };
}

function buildDiagnosticComparatorCalibrationInput(
  targetProfile: Record<string, unknown>,
  comparatorContext: ReviewComparatorContextItem[],
  calibrationMode: CalibrationMode,
): string {
  return JSON.stringify({
    calibrationStage: "post_intrinsic_diagnostic_only",
    calibrationMode,
    targetOnly: calibrationMode === "target_only",
    existingPapersModified: calibrationMode === "backfill_cluster" || calibrationMode === "affected_neighborhood",
    instruction: calibrationMode === "target_only"
      ? "Compare the target intrinsic diagnostic profile to the nearest fixed comparator profiles. Adjust only the target paper's inputStrengthScore, constructionStrengthScore, and outputStrengthScore if needed. Do not modify, reinterpret, or rescore the comparator papers. Do not output a final score or additive adjustment."
      : "Compare the target intrinsic diagnostic profile to the nearest comparator profiles as part of an explicit admin backfill or affected-neighborhood calibration job. Return calibrated diagnostics only for this target paper call; other papers must be processed by their own calls. Do not output a final score or additive adjustment.",
    targetPaper: targetProfile,
    nearestComparators: comparatorContext.map(compactComparatorProfileForCalibration),
  }, null, 2);
}

function normalizeDiagnosticChanges(value: unknown, before: Record<DiagnosticScoreKey, number>, after: Record<DiagnosticScoreKey, number>) {
  const allowed = new Set<DiagnosticScoreKey>(["inputStrengthScore", "constructionStrengthScore", "outputStrengthScore"]);
  const parsed = Array.isArray(value)
    ? value.map((item) => {
        const source = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
        const dimension = asString(source.dimension) as DiagnosticScoreKey;
        if (!allowed.has(dimension)) return null;
        return {
          dimension,
          from: normalizeDiagnosticSubscore(source.from, before[dimension]),
          to: normalizeDiagnosticSubscore(source.to, after[dimension]),
          rationale: asString(source.rationale),
        } satisfies DiagnosticChange;
      }).filter(Boolean) as DiagnosticChange[]
    : [];
  if (parsed.length > 0) return parsed;
  return (Array.from(allowed) as DiagnosticScoreKey[])
    .filter((dimension) => before[dimension] !== after[dimension])
    .map((dimension) => ({
      dimension,
      from: before[dimension],
      to: after[dimension],
      rationale: "Comparator calibration adjusted this diagnostic score for consistency with nearest reviewed papers.",
    }));
}

function normalizeDiagnosticComparatorCalibrationResult(
  input: unknown,
  targetScores: Record<DiagnosticScoreKey, number>,
  comparatorContext: ReviewComparatorContextItem[],
  comparatorRunId: string,
  calibrationMode: CalibrationMode,
  modifiedPaperIds: string[] = [],
): DiagnosticComparatorCalibration {
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const existingPapersModified = calibrationMode === "backfill_cluster" || calibrationMode === "affected_neighborhood";
  const calibratedScores: Record<DiagnosticScoreKey, number> = {
    inputStrengthScore: normalizeDiagnosticSubscore(source.calibratedInputStrengthScore, targetScores.inputStrengthScore),
    constructionStrengthScore: normalizeDiagnosticSubscore(source.calibratedConstructionStrengthScore, targetScores.constructionStrengthScore),
    outputStrengthScore: normalizeDiagnosticSubscore(source.calibratedOutputStrengthScore, targetScores.outputStrengthScore),
  };
  const rawCalibrated = rawDiagnosticScore([
    calibratedScores.inputStrengthScore,
    calibratedScores.constructionStrengthScore,
    calibratedScores.outputStrengthScore,
  ]);
  return {
    comparatorCalibrationStatus: "applied",
    calibrationMode,
    calibrationVersion: BENCHMARK_SET_VERSION,
    comparatorRunId,
    comparatorModel: GEMINI_CALIBRATION_MODEL,
    comparatorPromptHash: DIAGNOSTIC_COMPARATOR_CALIBRATION_PROMPT_HASH,
    comparatorIds: comparatorContext.map((candidate, index) => candidate.comparatorId || `C${index + 1}`),
    comparatorRetrievalMethod: "canonical-profile-token-overlap-k8",
    targetOnly: calibrationMode === "target_only",
    existingPapersModified,
    modifiedPaperIds: existingPapersModified ? modifiedPaperIds : [],
    comparatorContextIncluded: true,
    calibrationContextIncluded: true,
    calibratedInputStrengthScore: calibratedScores.inputStrengthScore,
    calibratedConstructionStrengthScore: calibratedScores.constructionStrengthScore,
    calibratedOutputStrengthScore: calibratedScores.outputStrengthScore,
    rawCalibratedScore: rawCalibrated,
    calibratedScore: Math.round(rawCalibrated),
    calibrationRationale: asString(source.calibrationRationale, "Comparator calibration completed."),
    diagnosticChanges: normalizeDiagnosticChanges(source.diagnosticChanges, targetScores, calibratedScores),
  };
}

async function runDiagnosticComparatorCalibration(
  targetProfile: Record<string, unknown>,
  comparatorContext: ReviewComparatorContextItem[],
  inputAuditHashes?: { textHash: string; pdfHash: string | null },
  calibrationMode: CalibrationMode = "target_only",
  modifiedPaperIds: string[] = [],
): Promise<{ calibration: DiagnosticComparatorCalibration; audit: ReviewRunAuditEntry; thinkingText: string | null }> {
  const targetScores: Record<DiagnosticScoreKey, number> = {
    inputStrengthScore: normalizeDiagnosticSubscore(targetProfile.inputStrengthScore),
    constructionStrengthScore: normalizeDiagnosticSubscore(targetProfile.constructionStrengthScore),
    outputStrengthScore: normalizeDiagnosticSubscore(targetProfile.outputStrengthScore),
  };
  const comparatorRunId = randomUUID();
  const { parsed, thinkingText, requestId, usage } = await callGemini(
    DIAGNOSTIC_COMPARATOR_CALIBRATION_PROMPT,
    buildDiagnosticComparatorCalibrationInput(targetProfile, comparatorContext, calibrationMode),
    GEMINI_CALIBRATION_MODEL,
    {
      maxOutputTokens: 8192,
      includeThoughts: false,
      temperature: 0.1,
    },
  );
  const calibration = normalizeDiagnosticComparatorCalibrationResult(parsed, targetScores, comparatorContext, comparatorRunId, calibrationMode, modifiedPaperIds);
  const audit: ReviewRunAuditEntry = {
    reviewRunId: comparatorRunId,
    paperId: null,
    promptVersion: REVIEW_PROMPT_VERSION,
    promptHash: DIAGNOSTIC_COMPARATOR_CALIBRATION_PROMPT_HASH,
    role: "comparator_calibration",
    passNumber: null,
    model: GEMINI_CALIBRATION_MODEL,
    requestId,
    cacheUsed: false,
    previousReviewUsed: false,
    comparatorContextIncluded: true,
    adjudicatorContextIncluded: false,
    calibrationContextIncluded: true,
    calibrationMode,
    calibrationVersion: BENCHMARK_SET_VERSION,
    targetOnly: calibration.targetOnly,
    existingPapersModified: calibration.existingPapersModified,
    modifiedPaperIds: calibration.modifiedPaperIds,
    textHash: inputAuditHashes?.textHash ?? "",
    pdfHash: inputAuditHashes?.pdfHash ?? null,
    inputTokenCount: usage.inputTokenCount,
    outputTokenCount: usage.outputTokenCount,
    inputStrengthScore: calibration.calibratedInputStrengthScore,
    constructionStrengthScore: calibration.calibratedConstructionStrengthScore,
    outputStrengthScore: calibration.calibratedOutputStrengthScore,
    rawDiagnosticScore: calibration.rawCalibratedScore,
    computedScore: calibration.calibratedScore,
    score: calibration.calibratedScore,
    classification: null,
  };
  return { calibration, audit, thinkingText };
}

function applyDiagnosticComparatorCalibration(
  aggregate: AggregateReview,
  calibration: DiagnosticComparatorCalibration,
): AggregateReview {
  if (calibration.comparatorCalibrationStatus !== "applied" || calibration.calibratedScore == null) {
    return { ...aggregate, diagnosticComparatorCalibration: calibration };
  }
  const finalScoreBand = scoreBandFromComputedScore(calibration.calibratedScore);
  return {
    ...aggregate,
    diagnosticComparatorCalibration: calibration,
    finalScoreBand,
    finalClassification: alignClassificationToScore(aggregate.finalClassification, finalScoreBand.median),
    finalScoreConfidence: aggregate.finalScoreConfidence,
    internalCalibrationNotes: [
      aggregate.internalCalibrationNotes,
      calibration.calibrationRationale,
    ].filter(Boolean).join("\n\n"),
  };
}

export async function recalibrateCanonicalReviewWithComparators(
  canonicalReview: unknown,
  comparatorContext: ReviewComparatorContextItem[],
  calibrationMode: CalibrationMode = "backfill_cluster",
  modifiedPaperIds: string[] = [],
) {
  if (comparatorContext.length < 3) {
    return {
      calibration: defaultDiagnosticComparatorCalibration(
        "insufficient_comparators",
        "Comparator backfill did not find enough nearest reviewed comparators.",
        comparatorContext.map((candidate, index) => candidate.comparatorId || `C${index + 1}`),
        calibrationMode,
        modifiedPaperIds,
      ),
      thinkingText: null,
    };
  }
  const targetProfile = canonicalDiagnosticProfileFromUnknown(canonicalReview);
  const { calibration, thinkingText } = await runDiagnosticComparatorCalibration(
    targetProfile,
    comparatorContext,
    undefined,
    calibrationMode,
    modifiedPaperIds,
  );
  return {
    calibration,
    thinkingText: thinkingText ? `Comparator calibration (${GEMINI_CALIBRATION_MODEL})\n${thinkingText}` : null,
  };
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
    metadataQaWarnings: [],
  };
}

function titleStartsWithPublisherJunk(value: string) {
  return /^(?:©|\(c\)|copyright|springer(?:-verlag)?|elsevier|world scientific|american physical society|aps|iop|wiley)\b/i.test(value.trim());
}

function titleLooksAuthorAppended(value: string) {
  return /\s+(?:by\s+)?(?:[A-Z]\.\s*){1,3}[A-Z][A-Za-z.'-]+(?:\s*[†‡§*])?$/u.test(value.trim());
}

function metadataQaWarnings(metadata: PaperDateMetadata) {
  const warnings: string[] = [];
  if (metadata.titleConfidence < 0.7) warnings.push("titleConfidence below 0.7");
  if (titleStartsWithPublisherJunk(metadata.displayedTitle)) warnings.push("displayedTitle starts with copyright or publisher text");
  if (titleLooksAuthorAppended(metadata.displayedTitle)) warnings.push("displayedTitle may contain an appended author name");
  const override = benchmarkMetadataOverrideForText([
    metadata.displayedTitle,
    metadata.cleanedTitle,
    metadata.rawExtractedTitle,
    metadata.arxivId,
    metadata.doi,
    metadata.displayedAuthors.join(", "),
  ].join("\n"));
  if (override && override.authors.length > 1 && metadata.displayedAuthors.length < override.authors.length) {
    warnings.push("known multi-author canonical paper returned an incomplete author list");
  }
  return uniqueCleanStrings(warnings);
}

function withMetadataQaWarnings(metadata: PaperDateMetadata): PaperDateMetadata {
  return {
    ...metadata,
    metadataQaWarnings: metadataQaWarnings(metadata),
  };
}

function applyBenchmarkMetadataOverride(metadata: PaperDateMetadata, extraText = ""): PaperDateMetadata {
  const override = benchmarkMetadataOverrideForText([
    extraText,
    metadata.displayedTitle,
    metadata.cleanedTitle,
    metadata.rawExtractedTitle,
    metadata.rawExtractedAuthors,
    metadata.displayedAuthors.join(", "),
    metadata.arxivId,
    metadata.doi,
  ].join("\n"));
  if (!override) return withMetadataQaWarnings(metadata);
  const dateNotes = uniqueCleanStrings([
    metadata.dateNotes,
    override.dateNotes,
  ]).join(" ");
  return withMetadataQaWarnings({
    ...metadata,
    rawExtractedTitle: metadata.rawExtractedTitle || override.title,
    cleanedTitle: override.title,
    titleConfidence: Math.max(metadata.titleConfidence, 0.98),
    titleCleaningNotes: uniqueCleanStrings([
      metadata.titleCleaningNotes,
      "Known benchmark metadata override normalized the displayed title.",
    ]).join(" "),
    displayedTitle: override.title,
    displayedAuthors: override.authors,
    rawExtractedAuthors: override.authors.join(", "),
    authorsConfidence: Math.max(metadata.authorsConfidence, 0.98),
    authorsExtractionNotes: uniqueCleanStrings([
      metadata.authorsExtractionNotes,
      "Known benchmark metadata override supplied the canonical author list.",
    ]).join(" "),
    arxivId: override.arxivId || metadata.arxivId,
    doi: override.doi || metadata.doi,
    journalName: override.journalName || metadata.journalName,
    journalPublicationDate: override.journalPublicationDate || metadata.journalPublicationDate,
    dateNotes,
  });
}

function normalizeExtractedDateMetadata(
  source: Record<string, unknown>,
  display: { displayedTitle: string; displayedAuthors: string[] },
): PaperDateMetadata {
  const metadata = defaultDateMetadata(display.displayedTitle, display.displayedAuthors);
  const arxivId = asString(source.arxivId, metadata.arxivId);
  const inferredArxivDate = inferArxivFirstSubmissionMonth(arxivId);
  const arxivFirstSubmissionDate = asString(source.arxivFirstSubmissionDate, metadata.arxivFirstSubmissionDate) || inferredArxivDate;
  const originalPublicationDateBestGuess =
    asString(source.originalPublicationDateBestGuess, metadata.originalPublicationDateBestGuess) ||
    asString(source.journalPublicationDate) ||
    arxivFirstSubmissionDate;
  const dateSource = asString(source.dateSource, "") ||
    (inferredArxivDate ? "arXiv identifier" : metadata.dateSource);
  const arxivDateConfidence = arxivFirstSubmissionDate && arxivId
    ? (/^\d{4}-\d{2}-\d{2}/.test(arxivFirstSubmissionDate) ? 0.95 : 0.9)
    : inferredArxivDate ? 0.9 : 0;
  const dateConfidence = Math.max(
    asNumber(source.dateConfidence, metadata.dateConfidence, 0, 1),
    arxivDateConfidence,
  );
  const dateNotes = uniqueCleanStrings([
    asString(source.dateNotes, metadata.dateNotes),
    inferredArxivDate ? `Inferred first submission month ${inferredArxivDate} from arXiv identifier ${arxivId}.` : "",
  ]).join(" ");
  return withMetadataQaWarnings({
    rawExtractedTitle: asString(source.rawExtractedTitle, metadata.rawExtractedTitle),
    cleanedTitle: asString(source.cleanedTitle, source.displayedTitle ? asString(source.displayedTitle) : metadata.cleanedTitle) || metadata.cleanedTitle,
    titleConfidence: asNumber(source.titleConfidence, metadata.titleConfidence, 0, 1),
    titleCleaningNotes: asString(source.titleCleaningNotes, metadata.titleCleaningNotes),
    displayedTitle: firstString([source.cleanedTitle, source.displayedTitle, source.rawExtractedTitle], metadata.displayedTitle) || metadata.displayedTitle,
    displayedAuthors: firstStringArray([source.displayedAuthors, metadata.displayedAuthors]),
    rawExtractedAuthors: asString(source.rawExtractedAuthors, metadata.rawExtractedAuthors),
    authorsConfidence: asNumber(source.authorsConfidence, metadata.authorsConfidence, 0, 1),
    authorsExtractionNotes: asString(source.authorsExtractionNotes, metadata.authorsExtractionNotes),
    arxivId,
    reportCodes: firstStringArray([source.reportCodes, metadata.reportCodes]),
    doi: asString(source.doi, metadata.doi),
    journalName: asString(source.journalName, metadata.journalName),
    journalPublicationDate: asString(source.journalPublicationDate, metadata.journalPublicationDate),
    arxivFirstSubmissionDate,
    manuscriptDatePrintedOnPdf: asString(source.manuscriptDatePrintedOnPdf, metadata.manuscriptDatePrintedOnPdf),
    originalPublicationDateBestGuess,
    dateSource,
    dateConfidence,
    dateNotes,
    metadataQaWarnings: firstStringArray([source.metadataQaWarnings]),
  });
}

export function normalizePaperDisplayMetadata<T extends {
  title?: string | null;
  paperAuthors?: string | null;
  dateMetadata?: unknown;
}>(paper: T): T {
  const existingMetadata = paper.dateMetadata && typeof paper.dateMetadata === "object"
    ? paper.dateMetadata as Record<string, unknown>
    : {};
  const initialTitle = asString(existingMetadata.displayedTitle, asString(paper.title, ""));
  const cleanedTitle = cleanDisplayTitle(initialTitle);
  const displayedAuthors = firstStringArray([existingMetadata.displayedAuthors]);
  const authorList = displayedAuthors.length > 0
    ? displayedAuthors
    : splitAuthorNames(asString(paper.paperAuthors, ""));
  const metadata = applyBenchmarkMetadataOverride(
    withMetadataQaWarnings({
      ...defaultDateMetadata(cleanedTitle.title !== "Unknown Title" ? cleanedTitle.title : initialTitle, authorList),
      ...existingMetadata,
      rawExtractedTitle: asString(existingMetadata.rawExtractedTitle, initialTitle),
      cleanedTitle: cleanedTitle.title !== "Unknown Title" ? cleanedTitle.title : asString(existingMetadata.cleanedTitle, initialTitle),
      displayedTitle: cleanedTitle.title !== "Unknown Title" ? cleanedTitle.title : initialTitle,
      titleCleaningNotes: uniqueCleanStrings([
        asString(existingMetadata.titleCleaningNotes),
        cleanedTitle.notes,
      ]).join(" "),
      reportCodes: uniqueCleanStrings([
        ...firstStringArray([existingMetadata.reportCodes]),
        ...cleanedTitle.reportCodes,
      ]),
      displayedAuthors: authorList,
      rawExtractedAuthors: asString(existingMetadata.rawExtractedAuthors, asString(paper.paperAuthors, "")),
    }),
    [
      paper.title,
      paper.paperAuthors,
      asString(existingMetadata.rawExtractedTitle),
      asString(existingMetadata.cleanedTitle),
      asString(existingMetadata.arxivId),
      asString(existingMetadata.doi),
    ].join("\n"),
  );
  return {
    ...paper,
    title: metadata.displayedTitle || paper.title,
    paperAuthors: metadata.displayedAuthors.length > 0
      ? metadata.displayedAuthors.join(", ")
      : paper.paperAuthors,
    dateMetadata: metadata,
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
    const benchmarkOverride = benchmarkMetadataOverrideForText([
      metadataInput,
      rawParsedTitle,
      bestTitle,
      bestAuthors,
      detectedArxivId,
      arxivMetadata?.arxivId,
      arxivMetadata?.title,
      arxivMetadata?.authors?.join(", "),
      asString(parsedMetadata.doi),
      arxivMetadata?.doi,
    ].join("\n"));
    const normalizedSource = {
      ...parsedMetadata,
      rawExtractedTitle: rawParsedTitle,
      cleanedTitle: benchmarkOverride?.title ?? bestTitle,
      displayedTitle: benchmarkOverride?.title ?? bestTitle,
      titleCleaningNotes: titleCleanupNotes || asString(parsedMetadata.titleCleaningNotes),
      titleConfidence: benchmarkOverride ? Math.max(parsedTitleConfidence, 0.98) : shouldPreferArxivTitle ? Math.max(parsedTitleConfidence, 0.95) : parsedTitleConfidence,
      arxivId: normalizeArxivId(benchmarkOverride?.arxivId || asString(parsedMetadata.arxivId) || parsedTitleCleanup.arxivId || fallbackTitleCleanup.arxivId || arxivMetadata?.arxivId || detectedArxivId),
      reportCodes: uniqueCleanStrings([
        ...firstStringArray([parsedMetadata.reportCodes]),
        ...parsedTitleCleanup.reportCodes,
        ...fallbackTitleCleanup.reportCodes,
      ]),
      doi: benchmarkOverride?.doi || asString(parsedMetadata.doi) || arxivMetadata?.doi || "",
      journalName: benchmarkOverride?.journalName || asString(parsedMetadata.journalName) || arxivMetadata?.journalRef || "",
      journalPublicationDate: benchmarkOverride?.journalPublicationDate || asString(parsedMetadata.journalPublicationDate),
      arxivFirstSubmissionDate: asString(parsedMetadata.arxivFirstSubmissionDate) || arxivMetadata?.published || "",
      originalPublicationDateBestGuess: asString(parsedMetadata.originalPublicationDateBestGuess) || asString(parsedMetadata.journalPublicationDate) || arxivMetadata?.published || "",
      dateSource: asString(parsedMetadata.dateSource) || (arxivMetadata?.published ? "arxiv metadata" : ""),
      rawExtractedAuthors: benchmarkOverride?.authors.join(", ") || asString(parsedMetadata.rawExtractedAuthors, authors),
      authorsConfidence: benchmarkOverride ? Math.max(asNumber(parsedMetadata.authorsConfidence, 0, 0, 1), 0.98) : usedArxivAuthors ? Math.max(asNumber(parsedMetadata.authorsConfidence, 0, 0, 1), 0.95) : asNumber(parsedMetadata.authorsConfidence, 0, 0, 1),
      authorsExtractionNotes: uniqueCleanStrings([
        asString(parsedMetadata.authorsExtractionNotes),
        usedFallbackMultiAuthorBlock ? "Deterministic fallback replaced a one-author parse with a multi-author title-page block." : "",
        usedArxivAuthors ? (knownArxivAuthorList.length > 0 ? "Known arXiv metadata override supplied the complete author list." : "arXiv metadata supplied the complete author list.") : "",
        benchmarkOverride ? "Known benchmark metadata override supplied canonical authors." : "",
      ]).join(" "),
      displayedAuthors: benchmarkOverride?.authors ?? (bestAuthorList.length > 0 ? bestAuthorList : splitAuthorNames(bestAuthors)),
    };
    const normalizedMetadata = applyBenchmarkMetadataOverride(
      normalizeExtractedDateMetadata(normalizedSource, {
        displayedTitle: benchmarkOverride?.title ?? bestTitle,
        displayedAuthors: benchmarkOverride?.authors ?? (bestAuthorList.length > 0 ? bestAuthorList : splitAuthorNames(bestAuthors)),
      }),
      metadataInput,
    );
    return {
      title: normalizedMetadata.displayedTitle,
      authors: normalizedMetadata.displayedAuthors.join(", ") || bestAuthors,
      dateMetadata: normalizedMetadata,
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
    const benchmarkOverride = benchmarkMetadataOverrideForText([
      metadataInput,
      fallbackTitle,
      fallbackAuthors,
      detectedArxivId,
      arxivMetadata?.arxivId,
      arxivMetadata?.title,
      arxivMetadata?.authors?.join(", "),
    ].join("\n"));
    const fallbackMetadata = applyBenchmarkMetadataOverride({
      ...defaultDateMetadata(benchmarkOverride?.title ?? fallbackTitle, benchmarkOverride?.authors ?? fallbackAuthorList),
      rawExtractedTitle: fallback.title,
      cleanedTitle: benchmarkOverride?.title ?? fallbackTitle,
      displayedTitle: benchmarkOverride?.title ?? fallbackTitle,
      arxivId: normalizeArxivId(benchmarkOverride?.arxivId || arxivMetadata?.arxivId || fallbackTitleCleanup.arxivId || detectedArxivId),
      reportCodes: fallbackTitleCleanup.reportCodes,
      doi: benchmarkOverride?.doi || arxivMetadata?.doi || "",
      journalName: benchmarkOverride?.journalName || arxivMetadata?.journalRef || "",
      journalPublicationDate: benchmarkOverride?.journalPublicationDate || "",
      arxivFirstSubmissionDate: arxivMetadata?.published || "",
      originalPublicationDateBestGuess: benchmarkOverride?.journalPublicationDate || arxivMetadata?.published || "",
      dateSource: arxivMetadata?.published ? "arxiv metadata" : benchmarkOverride ? "benchmark metadata override" : "unknown",
      dateConfidence: arxivMetadata?.published ? 0.95 : benchmarkOverride?.journalPublicationDate ? 0.9 : 0,
      dateNotes: uniqueCleanStrings([
        arxivMetadata?.published ? "arXiv metadata was used after model metadata extraction failed." : "Date metadata was not confidently extracted.",
        benchmarkOverride?.dateNotes,
      ]).join(" "),
      titleCleaningNotes: benchmarkOverride?.title ? "Known benchmark metadata override was used after model metadata extraction failed." : arxivMetadata?.title ? "arXiv metadata was used after model metadata extraction failed." : fallbackTitleCleanup.notes || "Fallback metadata was used.",
      displayedAuthors: benchmarkOverride?.authors ?? fallbackAuthorList,
      rawExtractedAuthors: benchmarkOverride?.authors.join(", ") || fallbackAuthors,
      authorsConfidence: benchmarkOverride ? 0.98 : fallbackAuthorList.length > 0 && fallbackAuthorList[0] !== "Unknown Authors" ? 0.95 : 0.4,
      authorsExtractionNotes: benchmarkOverride
        ? "Known benchmark metadata override was used after model metadata extraction failed."
        : knownArxivAuthorList.length > 0
          ? "Known arXiv metadata override was used after model metadata extraction failed."
          : arxivMetadata?.authors?.length ? "arXiv metadata was used after model metadata extraction failed." : "Fallback metadata was used.",
    }, metadataInput);
    return {
      title: fallbackMetadata.displayedTitle,
      authors: fallbackMetadata.displayedAuthors.join(", ") || fallbackAuthors,
      dateMetadata: fallbackMetadata,
    };
  }
}

async function generateMultiPassReview(
  paperContent: ReviewInput,
  _model: ReviewModel,
  promptOverride?: string,
  options: { selectComparatorContext?: ComparatorContextSelector; reviewMode?: ReviewPipelineMode } = {},
): Promise<MultiPassReviewResult> {
  const reviewRunId = randomUUID();
  const reviewMode = options.reviewMode ?? DEFAULT_REVIEW_PIPELINE_MODE;
  const systemPrompt = withLatexMarkdownFormatting(promptOverride?.trim() || REVIEW_SYSTEM_INSTRUCTION);
  const blindedContent = blindReviewInput(paperContent);
  const inputAuditHashes = reviewInputAuditHashes(blindedContent);
  const thinkingChunks: string[] = [];

  const passResults: IndividualPassResult[] = [];
  const passFailures: { reason: unknown; index: number }[] = [];

  const initialPasses = await Promise.allSettled(
    Array.from({ length: REVIEW_PASS_COUNT }, (_unused, index) =>
      runPassWithGenerationRetries(systemPrompt, blindedContent, index, reviewRunId, inputAuditHashes),
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
      passResults.push(await runPassWithGenerationRetries(systemPrompt, blindedContent, extraIndex, reviewRunId, inputAuditHashes));
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
  const blindPassHashes = new Set(passResults.map((result) => result.audit.promptHash));
  if (blindPassHashes.size > 1 || (blindPassHashes.size === 1 && !blindPassHashes.has(REVIEW_PROMPT_HASH))) {
    throw new Error("Review run invalid: blind pass prompt hashes differ from the active prompt hash.");
  }
  for (const result of passResults) {
    logger.info({
      reviewRunId,
      promptVersion: result.audit.promptVersion,
      promptHash: result.audit.promptHash,
      passNumber: result.audit.passNumber,
      role: result.audit.role,
      model: result.audit.model,
      requestId: result.audit.requestId,
      cacheUsed: result.audit.cacheUsed,
      previousReviewUsed: result.audit.previousReviewUsed,
      comparatorContextIncluded: result.audit.comparatorContextIncluded,
      adjudicatorContextIncluded: result.audit.adjudicatorContextIncluded,
      calibrationContextIncluded: result.audit.calibrationContextIncluded,
      textHash: result.audit.textHash,
      pdfHash: result.audit.pdfHash,
      inputTokenCount: result.audit.inputTokenCount,
      outputTokenCount: result.audit.outputTokenCount,
      score: result.audit.score,
      classification: result.audit.classification,
    }, "Blind review pass completed");
  }
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
  let adjudicatorAudit: ReviewRunAuditEntry | null = null;
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
            : `\n\nThe previous adjudication was rejected by validation: ${errorMessage(adjudicatorFailure)}\nReturn a valid v17 diagnostic-only adjudication. Do not output intrinsicScore, scoreBand, bestClassification, scoreConfidence, scoreCappingReason, or scoreAdjustmentReason. Resolve only inputStrengthScore, constructionStrengthScore, outputStrengthScore, and the supporting canonical review fields.`;
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
          adjudicatorAudit = {
            reviewRunId,
            paperId: null,
            promptVersion: REVIEW_PROMPT_VERSION,
            promptHash: REVIEW_PROMPT_HASH,
            role: "adjudicator",
            passNumber: null,
            model: GEMINI_META_MODEL,
            requestId: adjudicatorResult.requestId,
            cacheUsed: false,
            previousReviewUsed: false,
            comparatorContextIncluded: false,
            adjudicatorContextIncluded: true,
            calibrationContextIncluded: false,
            textHash: inputAuditHashes.textHash,
            pdfHash: inputAuditHashes.pdfHash,
            inputTokenCount: adjudicatorResult.usage.inputTokenCount,
            outputTokenCount: adjudicatorResult.usage.outputTokenCount,
            inputStrengthScore: null,
            constructionStrengthScore: null,
            outputStrengthScore: null,
            rawDiagnosticScore: null,
            computedScore: null,
            score: null,
            classification: null,
          };
          adjudicatorThinking = adjudicatorResult.thinkingText;
          aggregate = normalizeAggregateReview(adjudicatorResult.parsed, fallbackScores, fallbackRepresentativeReview);
          validateAggregateReview(aggregate);
          adjudicatorAudit.inputStrengthScore = aggregate.inputStrengthScore;
          adjudicatorAudit.constructionStrengthScore = aggregate.constructionStrengthScore;
          adjudicatorAudit.outputStrengthScore = aggregate.outputStrengthScore;
          adjudicatorAudit.rawDiagnosticScore = rawDiagnosticScore(diagnosticSubscoreValues(aggregate));
          adjudicatorAudit.computedScore = aggregate.finalScoreBand.median;
          adjudicatorAudit.score = aggregate.finalScoreBand.median;
          adjudicatorAudit.classification = aggregate.finalClassification || null;
          logger.info(adjudicatorAudit, "Blind adjudicator completed");
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
  let aggregateReview: AggregateReview = aggregate;
  const comparatorAuditEntries: ReviewRunAuditEntry[] = [];
  const comparatorContext = reviewMode === "normal-review" && options.selectComparatorContext
    ? await options.selectComparatorContext(aggregateReview.comparatorProfile, aggregateReview)
    : [];
  if (reviewMode === "benchmark-ingestion") {
    aggregateReview = {
      ...aggregateReview,
      comparatorCalibration: defaultComparatorCalibration(
        aggregateReview.blindIntrinsicScoreBand,
        aggregateReview.finalClassification,
        "Benchmark ingestion mode stores the blind intrinsic profile only. Comparator calibration is run later by benchmark backfill.",
        "not_run_benchmark_ingestion",
      ),
      diagnosticComparatorCalibration: defaultDiagnosticComparatorCalibration(
        "not_run_benchmark_ingestion",
        "Benchmark ingestion mode stores the blind intrinsic profile only. Comparator calibration is run later by benchmark backfill.",
        [],
        "none",
      ),
      finalScoreBand: aggregateReview.blindIntrinsicScoreBand,
      adminComparatorNotes: "Benchmark ingestion mode: comparator calibration not run.",
    };
  } else if (comparatorContext.length < 3) {
    aggregateReview = {
      ...aggregateReview,
      comparatorCalibration: defaultComparatorCalibration(
        aggregateReview.blindIntrinsicScoreBand,
        aggregateReview.finalClassification,
        "Not enough sufficiently close benchmark comparators were available; public score falls back to the intrinsic score.",
        "insufficient_comparators",
      ),
      diagnosticComparatorCalibration: defaultDiagnosticComparatorCalibration(
        "insufficient_comparators",
        "Not enough sufficiently close benchmark comparators were available; public score falls back to the intrinsic score.",
        comparatorContext.map((candidate, index) => candidate.comparatorId || `C${index + 1}`),
        "target_only",
      ),
      finalScoreBand: aggregateReview.blindIntrinsicScoreBand,
      adminComparatorNotes: "Comparator calibration unavailable: fewer than 3 close benchmark comparators found.",
    };
  } else {
    try {
      const targetProfile = canonicalDiagnosticProfileFromAggregate(aggregateReview);
      const { calibration, audit, thinkingText: calibrationThinking } = await runDiagnosticComparatorCalibration(
        targetProfile,
        comparatorContext,
        inputAuditHashes,
        "target_only",
      );
      comparatorAuditEntries.push(audit);
      aggregateReview = applyDiagnosticComparatorCalibration(aggregateReview, calibration);
      aggregateReview = {
        ...aggregateReview,
        comparatorCalibration: defaultComparatorCalibration(
          aggregateReview.blindIntrinsicScoreBand,
          aggregateReview.finalClassification,
          calibration.calibrationRationale,
          "applied",
        ),
        nearestComparators: comparatorContext.map((candidate, index) => ({
          comparatorId: candidate.comparatorId || `C${index + 1}`,
          paperTitle: candidate.title,
          relationship: "similar",
          whyComparable: candidate.comparatorSearchSummary || "Selected by canonical review-profile similarity.",
          keyDifference: "",
          relativeAssessment: "similar",
          relativeScoreJudgment: "similar_quality",
          scoreGapJustification: "",
          sitePaperId: candidate.sitePaperId,
        })),
        publicComparatorSummary: calibration.calibrationRationale,
        adminComparatorNotes: "Diagnostic-only comparator calibration ran after intrinsic adjudication.",
      };
      if (calibrationThinking) {
        thinkingChunks.push(`Comparator calibration (${GEMINI_CALIBRATION_MODEL})\n${calibrationThinking}`);
      }
    } catch (reason) {
      aggregateReview = {
        ...aggregateReview,
        comparatorCalibration: defaultComparatorCalibration(
          aggregateReview.blindIntrinsicScoreBand,
          aggregateReview.finalClassification,
          `Comparator calibration failed; public score falls back to the blind intrinsic score. ${errorMessage(reason)}`,
          "failed",
        ),
        diagnosticComparatorCalibration: defaultDiagnosticComparatorCalibration(
          "failed",
          `Comparator calibration failed; public score falls back to the intrinsic score. ${errorMessage(reason)}`,
          comparatorContext.map((candidate, index) => candidate.comparatorId || `C${index + 1}`),
          "target_only",
        ),
        adminComparatorNotes: `Comparator calibration failed: ${errorMessage(reason)}`,
      };
      thinkingChunks.push(`Comparator calibration failed\n${errorMessage(reason)}`);
    }
  }
  const representativeReview = pickRepresentativeReview(individualReviews, aggregateReview.finalScoreBand.median);
  if (adjudicatorThinking) {
    thinkingChunks.push(`Adjudicator (${GEMINI_META_MODEL})\n${adjudicatorThinking}`);
  }
  thinkingChunks.push(aggregateReview.internalCalibrationNotes);

  return {
    reviewRunId,
    modelName: expectedReviewModelName(reviewMode),
    pipelineMode: reviewMode,
    systemPrompt,
    blindedContent,
    individualReviews,
    aggregate: aggregateReview,
    representativeReview,
    thinkingText: thinkingChunks.length > 0 ? thinkingChunks.join("\n\n---\n\n") : null,
    passAudit: [
      ...passResults.map((result) => result.audit),
      ...(adjudicatorAudit ? [adjudicatorAudit] : []),
      ...comparatorAuditEntries,
    ],
  };
}

export async function recalibrateStoredAggregateWithComparators(
  aggregateInput: unknown,
  comparatorContext: ReviewComparatorContextItem[],
  calibrationMode: CalibrationMode = "backfill_cluster",
  modifiedPaperIds: string[] = [],
) {
  const aggregate = aggregateInput && typeof aggregateInput === "object"
    ? (aggregateInput as AggregateReview)
    : null;
  if (!aggregate?.comparatorProfile || !aggregate?.blindIntrinsicScoreBand) {
    const fallback = await recalibrateCanonicalReviewWithComparators(aggregateInput, comparatorContext, calibrationMode, modifiedPaperIds);
    return {
      aggregate: {
        ...(aggregateInput && typeof aggregateInput === "object" ? aggregateInput as Record<string, unknown> : {}),
        diagnosticComparatorCalibration: fallback.calibration,
      },
      thinkingText: fallback.thinkingText,
    };
  }

  if (comparatorContext.length < 3) {
    const diagnosticComparatorCalibration = defaultDiagnosticComparatorCalibration(
      "insufficient_comparators",
      "Comparator backfill did not find enough nearest reviewed comparators; score remains intrinsic.",
      comparatorContext.map((candidate, index) => candidate.comparatorId || `C${index + 1}`),
      calibrationMode,
      modifiedPaperIds,
    );
    const updatedAggregate: AggregateReview = {
      ...aggregate,
      comparatorCalibration: defaultComparatorCalibration(
        aggregate.blindIntrinsicScoreBand,
        aggregate.finalClassification,
        diagnosticComparatorCalibration.calibrationRationale,
        "insufficient_comparators",
      ),
      diagnosticComparatorCalibration,
      finalScoreBand: aggregate.blindIntrinsicScoreBand,
      adminComparatorNotes: "Comparator backfill unavailable: fewer than 3 close benchmark comparators found.",
    };
    return { aggregate: updatedAggregate, thinkingText: null };
  }

  const { calibration, thinkingText } = await runDiagnosticComparatorCalibration(
    canonicalDiagnosticProfileFromAggregate(aggregate),
    comparatorContext,
    undefined,
    calibrationMode,
    modifiedPaperIds,
  );
  const updatedAggregate: AggregateReview = {
    ...applyDiagnosticComparatorCalibration(aggregate, calibration),
    comparatorCalibration: defaultComparatorCalibration(
      aggregate.blindIntrinsicScoreBand,
      aggregate.finalClassification,
      calibration.calibrationRationale,
      "applied",
    ),
    nearestComparators: comparatorContext.map((candidate, index) => ({
      comparatorId: candidate.comparatorId || `C${index + 1}`,
      paperTitle: candidate.title,
      relationship: "similar",
      whyComparable: candidate.comparatorSearchSummary || "Selected by canonical review-profile similarity.",
      keyDifference: "",
      relativeAssessment: "similar",
      relativeScoreJudgment: "similar_quality",
      scoreGapJustification: "",
      sitePaperId: candidate.sitePaperId,
    })),
    publicComparatorSummary: calibration.calibrationRationale,
    adminComparatorNotes: "Diagnostic-only comparator backfill ran after intrinsic adjudication.",
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
  const diagnosticCalibration = aggregate.diagnosticComparatorCalibration ??
    defaultDiagnosticComparatorCalibration("not_run", "No comparator calibration pass has run yet.");
  const comparatorCalibrationStatus = diagnosticCalibration.comparatorCalibrationStatus;
  const comparatorCalibrationApplied =
    result.pipelineMode !== "benchmark-ingestion" &&
    comparatorCalibrationStatus === "applied" &&
    typeof diagnosticCalibration.calibratedScore === "number";
  const publicScore = comparatorCalibrationApplied
    ? diagnosticCalibration.calibratedScore as number
    : canonicalReview.intrinsicScore;
  const canonicalCoverageLedger = {
    reviewObjectVersion: REVIEW_OBJECT_VERSION,
    schemaVersion: "v17.0",
    reviewRunId: result.reviewRunId,
    promptVersion: REVIEW_PROMPT_VERSION,
    promptName: REVIEW_PROMPT_NAME,
    promptHash: REVIEW_PROMPT_HASH,
    generatedAt,
    modelName: result.modelName,
    passModel: GEMINI_PASS_MODEL,
    adjudicatorModel: GEMINI_META_MODEL,
    passCount: REVIEW_PASS_COUNT,
    validPassCount: result.individualReviews.length,
    pipelineMode: result.pipelineMode,
    clusterVersion: "v17-diagnostic-only",
    benchmarkSetCandidate: result.pipelineMode === "benchmark-ingestion",
    benchmarkSetVersion: result.pipelineMode === "benchmark-ingestion"
      ? BENCHMARK_SET_VERSION
      : BENCHMARK_SET_VERSION,
    comparatorCalibrationStatus,
    calibrationMode: diagnosticCalibration.calibrationMode,
    calibrationVersion: diagnosticCalibration.calibrationVersion,
    comparatorRunId: diagnosticCalibration.comparatorRunId,
    comparatorModel: diagnosticCalibration.comparatorModel,
    comparatorPromptHash: diagnosticCalibration.comparatorPromptHash,
    comparatorIds: diagnosticCalibration.comparatorIds,
    comparatorRetrievalMethod: diagnosticCalibration.comparatorRetrievalMethod,
    targetOnly: diagnosticCalibration.targetOnly,
    existingPapersModified: diagnosticCalibration.existingPapersModified,
    modifiedPaperIds: diagnosticCalibration.modifiedPaperIds,
    comparatorContextIncluded: diagnosticCalibration.comparatorContextIncluded,
    calibrationContextIncluded: diagnosticCalibration.calibrationContextIncluded,
    calibratedInputStrengthScore: diagnosticCalibration.calibratedInputStrengthScore,
    calibratedConstructionStrengthScore: diagnosticCalibration.calibratedConstructionStrengthScore,
    calibratedOutputStrengthScore: diagnosticCalibration.calibratedOutputStrengthScore,
    rawCalibratedScore: diagnosticCalibration.rawCalibratedScore,
    calibratedScore: diagnosticCalibration.calibratedScore,
    diagnosticChanges: diagnosticCalibration.diagnosticChanges,
    calibrationRationale: diagnosticCalibration.calibrationRationale,
    extractionMethod,
    pdfVisibleFallbackUsed,
    blindingStrength,
    usesFlashForScientificScoring: /flash/i.test(`${GEMINI_PASS_MODEL} ${GEMINI_META_MODEL}`),
    usesProOnlyForScientificScoring: !/flash/i.test(`${GEMINI_PASS_MODEL} ${GEMINI_META_MODEL}`),
    intrinsicInputStrengthScore: canonicalReview.inputStrengthScore,
    intrinsicConstructionStrengthScore: canonicalReview.constructionStrengthScore,
    intrinsicOutputStrengthScore: canonicalReview.outputStrengthScore,
    intrinsicScore: canonicalReview.intrinsicScore,
    ...canonicalReview,
    finalScore: publicScore,
    diagnosticScoreFormula: "10 * average(inputStrengthScore, constructionStrengthScore, outputStrengthScore)",
    rawDiagnosticScore: rawDiagnosticScore(diagnosticSubscoreValues(aggregate)),
    computedScore: canonicalReview.intrinsicScore,
    rawFinalDiagnosticScore: rawDiagnosticScore(diagnosticSubscoreValues(aggregate)),
    publicMagnitudeLabel: aggregate.finalClassification,
    finalInputStrengthScore: aggregate.inputStrengthScore,
    finalConstructionStrengthScore: aggregate.constructionStrengthScore,
    finalOutputStrengthScore: aggregate.outputStrengthScore,
    blindPassScores: aggregate.individualScores,
    blindPassSpread: aggregate.scoreRange,
    passDisagreement: aggregate.scoreRange,
    scoreStability: aggregate.scoreStability,
    adjudicatorStatus: aggregate.adjudicatorStatus,
    diagnosticBaselineScore: aggregate.diagnosticBaselineScore,
    diagnosticBaselineDelta: aggregate.diagnosticBaselineDelta,
    scoringAnomaly: aggregate.scoringAnomaly,
    blindPassReviews: storedIndividualReviews,
    passAudit: result.passAudit,
    submissionSourceHash: null,
  };
  return {
    summary: "",
    correctness: "",
    novelty: "",
    overallEvaluation: "",
    score: publicScore,
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
    overallIntrinsicScore: publicScore,
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
