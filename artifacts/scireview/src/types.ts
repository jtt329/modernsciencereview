export interface PaperDateMetadata {
  displayedTitle?: string;
  displayedAuthors?: string[];
  arxivId?: string;
  doi?: string;
  journalName?: string;
  journalPublicationDate?: string;
  arxivFirstSubmissionDate?: string;
  manuscriptDatePrintedOnPdf?: string;
  originalPublicationDateBestGuess?: string;
  dateSource?: string;
  dateConfidence?: number;
  dateNotes?: string;
}

export interface Paper {
  id: string;
  title: string;
  content: string;
  authorId: string;
  authorName: string;       // submitter's display name
  paperAuthors?: string;    // actual authors extracted from the paper
  dateMetadata?: PaperDateMetadata | null;
  createdAt: number;
  status: 'draft' | 'published';
  aiReviewId?: string;
  likesCount: number;
  viewCount: number;
  commentCount: number;
  field: string;
  subfields?: string[];
  score?: number;
  modelName?: string;
  reviewSummary?: string | null;
  reviewCentralClaim?: string | null;
  reviewFinalJudgment?: string | null;
}

export interface AIReview {
  id: string;
  paperId: string;
  // Legacy fields
  summary: string;
  correctness: string;
  novelty: string;
  overallEvaluation: string;
  score: number;
  relatedWork: string;
  // Structured fields
  centralClaim?: string;
  establishedResults?: string;
  interpretiveClaims?: string;
  speculativeClaims?: string;
  economy?: string;
  explanatoryTargetBreadth?: string;
  theorySpaceBreadth?: string;
  scopeDepth?: string;
  unifyingPower?: string;
  strongestCaseForImportance?: string;
  strongestObjection?: string;
  decisiveCheck?: string;
  assessmentSensitivity?: string;
  internalTechnicalTraction?: string;
  noveltyConfidence?: number;
  intrinsicScientificMeritScore?: number;
  explanatoryTargetBreadthScore?: number;
  theorySpaceBreadthScore?: number;
  breadthOfImpactScore?: number;
  inputStrengthScore?: number;
  constructionStrengthScore?: number;
  outputStrengthScore?: number;
  outputReachScore?: number;
  generalizationBreadthScore?: number;
  diagnosticBaselineScore?: number;
  diagnosticBaselineDelta?: number;
  scoreAdjustmentReason?: string;
  scoringAnomaly?: string;
  inputConstructionOutputLedger?: {
    primitiveInputs?: string[];
    introducedConstructions?: string[];
    outputs?: Array<{
      output?: string;
      dependsOnInputs?: string[];
      dependsOnConstructions?: string[];
      externalContextIfAny?: string;
      support?: string;
      validity?: string;
      centrality?: 'low' | 'medium' | 'high' | string;
    }>;
    whyOutputsMatter?: string;
    assessment?: string;
    externalEmbeddingsAndChecks?: string[];
    directOutputs?: string[];
    downstreamReach?: string;
  };
  centralOutputDependency?: {
    centralOutput?: string;
    requiredPrimitiveInputs?: string[];
    requiredIntroducedConstructions?: string[];
    dependencyAssessment?: string;
    constructionFragility?: string;
    outputValidity?: string;
    dependsOnPrimitiveInputs?: string[];
    dependsOnIntroducedConstructions?: string[];
    weakestDependency?: string;
    assessment?: string;
  };
  outputValidityAssessment?: string | {
    knownResultRecoveries?: string[];
    novelPredictionsOrConstraints?: string[];
    failedOutputsOrConstraints?: string[];
    assessment?: string;
  };
  outputValidity?: string;
  constructionAssessment?: string;
  overallIntrinsicScore?: number;
  bestClassification?: string;
  finalJudgment?: string;
  // Coverage ledger (new prompt)
  coverageLedgerJson?: string;
  individualReviewsJson?: string;
  aggregateMetaJson?: string;
  comparisonCohort?: string;
  broadField?: string;
  specialtyField?: string;
  frameworkConditionalityLevel?: string;
  frameworkConditionalityExplanation?: string;
  specialtyRelativeScore?: number;
  broadFieldRelativeScore?: number;
  crossFieldConsequenceScore?: number;
  scoreBandLow?: number;
  scoreBandMedian?: number;
  scoreBandHigh?: number;
  scoreConfidence?: number;
  scoreStability?: string;
  publicVerdict?: string;
  passCount?: number;
  // Model reasoning/thinking (Gemini only)
  thinkingText?: string | null;
  // Metadata
  createdAt: number;
  likesCount: number;
  modelName: string;
  systemPrompt: string;
}

export interface Comment {
  id: string;
  targetId: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: number;
}

export interface Like {
  id: string;
  targetId: string;
  userId: string;
  createdAt: number;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  photoURL?: string;
  createdAt: number;
}
