import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, CheckCircle2, Award, Heart, Info, X, Target, BookOpen, Shield, AlertTriangle, Microscope, TrendingUp, GitBranch, ListChecks, BrainCircuit } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { format } from 'date-fns';
import { AIReview } from '../types';
import ReviewChat from './ReviewChat';
import { normalizeMathMarkdown } from '../lib/mathMarkdown';

interface ReviewCardProps {
  review: AIReview;
  onLike: (id: string, e: React.MouseEvent) => void;
  isLiked: boolean;
  isAdmin?: boolean;
}

const Markdown = ({ children }: { children: string }) => (
  <div className="prose prose-invert prose-sm prose-p:my-0 prose-li:my-0 max-w-none text-slate-300 leading-relaxed">
    <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
      {normalizeMathMarkdown(children)}
    </ReactMarkdown>
  </div>
);

const Section = ({ icon, label, color, children }: { icon: React.ReactNode; label: string; color: string; children: React.ReactNode }) => (
  <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-2">
    <h3 className={`text-xs font-black uppercase tracking-widest flex items-center gap-2 ${color}`}>
      {icon} {label}
    </h3>
    {children}
  </div>
);

const asArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
    : [];

const listMarkdown = (items: unknown): string =>
  asArray(items).map((item) => `- ${item}`).join('\n');

const hasText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const asObject = (value: unknown): Record<string, any> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : null;

const validSubscore = (value: unknown, isValid = true): number | null => {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!isValid || !Number.isFinite(numeric) || numeric < 0 || numeric > 10) return null;
  return Math.round(numeric);
};

const asLedgerOutputs = (ledger: any): Array<{
  output: string;
  dependsOnInputs: string[];
  dependsOnConstructions: string[];
  externalContextIfAny: string;
  support: string;
  validity: string;
  centrality: string;
}> => {
  const outputs = Array.isArray(ledger?.outputs) ? ledger.outputs : [];
  const normalized = outputs.map((item: any) => {
    if (typeof item === 'string') {
      return {
        output: item.trim(),
        dependsOnInputs: [],
        dependsOnConstructions: [],
        externalContextIfAny: '',
        support: '',
        validity: '',
        centrality: 'medium',
      };
    }
    return {
      output: String(item?.output ?? item?.directOutput ?? item?.result ?? '').trim(),
      dependsOnInputs: asArray(item?.dependsOnInputs ?? item?.requiredPrimitiveInputs),
      dependsOnConstructions: asArray(item?.dependsOnConstructions ?? item?.requiredIntroducedConstructions),
      externalContextIfAny: String(item?.externalContextIfAny ?? item?.externalContext ?? '').trim(),
      support: String(item?.support ?? item?.evidence ?? '').trim(),
      validity: String(item?.validity ?? item?.outputValidity ?? '').trim(),
      centrality: String(item?.centrality ?? 'medium').trim(),
    };
  }).filter((item: any) => item.output);

  if (normalized.length > 0) return normalized;
  const legacyDirectOutputs = asArray(ledger?.directOutputs);
  const legacyExternalChecks = asArray(ledger?.externalEmbeddingsAndChecks);
  const legacyOutputs = legacyDirectOutputs.length > 0 ? legacyDirectOutputs : legacyExternalChecks;

  return legacyOutputs.map((output) => ({
    output,
    dependsOnInputs: [],
    dependsOnConstructions: [],
    externalContextIfAny: legacyExternalChecks.includes(output) ? output : '',
    support: '',
    validity: '',
    centrality: 'medium',
  }));
};


export default function ReviewCard({ review, onLike, isLiked, isAdmin = false }: ReviewCardProps) {
  const [showPrompt, setShowPrompt] = useState(false);
  const [showThinking, setShowThinking] = useState(false);
  const [activeTab, setActiveTab] = useState<'combined' | number>('combined');
  const [scoreDetail, setScoreDetail] = useState<'final' | 'adjudicator' | 'comparator' | number>('final');

  const normalizeDisplayedBand = (
    low: number | null | undefined,
    median: number | null | undefined,
    high: number | null | undefined,
    classification?: string | null,
  ) => {
    const safeLow = Number(low ?? median ?? high ?? 0);
    const safeMedian = Number(median ?? low ?? high ?? 0);
    const safeHigh = Number(high ?? median ?? low ?? 0);
    const maxValue = Math.max(safeLow, safeMedian, safeHigh);
    const likelyTenScale =
      maxValue > 0 &&
      maxValue <= 10 &&
      classification !== 'not yet convincing';

    if (likelyTenScale) {
      return {
        low: Math.round(safeLow * 10),
        median: Math.round(safeMedian * 10),
        high: Math.round(safeHigh * 10),
      };
    }

    return {
      low: Math.round(safeLow),
      median: Math.round(safeMedian),
      high: Math.round(safeHigh),
    };
  };

  const isNewFormat = review.overallIntrinsicScore != null;
  let parsedCoverage: any = null;
  if (review.coverageLedgerJson) {
    try {
      parsedCoverage = JSON.parse(review.coverageLedgerJson);
    } catch {
      parsedCoverage = null;
    }
  }
  let storedIndividualReviewsFromField: any[] = [];
  if (review.individualReviewsJson) {
    try {
      const parsed = JSON.parse(review.individualReviewsJson);
      storedIndividualReviewsFromField = Array.isArray(parsed) ? parsed : [];
    } catch {
      storedIndividualReviewsFromField = [];
    }
  }
  let storedAggregateFromField: any = null;
  if (review.aggregateMetaJson) {
    try {
      storedAggregateFromField = JSON.parse(review.aggregateMetaJson);
    } catch {
      storedAggregateFromField = null;
    }
  }
  const storedAggregate = storedAggregateFromField ?? parsedCoverage?.aggregate ?? null;
  const coverageLedger = parsedCoverage?.coverageLedger ?? parsedCoverage ?? null;
  const directTargets = parsedCoverage?.directTargets ?? coverageLedger?.directTargets ?? [];
  const importedInputs = parsedCoverage?.importedInputs ?? coverageLedger?.importedInputs ?? [];
  const theorySpaceVariants = parsedCoverage?.theorySpaceVariants ?? coverageLedger?.theorySpaceVariants ?? [];
  const mechanismSharingAssessment = parsedCoverage?.mechanismSharingAssessment ?? coverageLedger?.mechanismSharingAssessment ?? '';
  const inputConstructionOutputLedger = parsedCoverage?.inputConstructionOutputLedger ?? storedAggregate?.inputConstructionOutputLedger ?? null;
  const centralOutputDependency = parsedCoverage?.centralOutputDependency
    ?? storedAggregate?.centralOutputDependency
    ?? storedAggregate?.comparatorProfile?.centralOutputDependency
    ?? null;
  const outputValidityAssessment = parsedCoverage?.outputValidityAssessment
    ?? storedAggregate?.outputValidityAssessment
    ?? storedAggregate?.comparatorProfile?.outputValidityAssessment
    ?? null;
  const inputGrounding = parsedCoverage?.inputGrounding ?? storedAggregate?.inputGroundingAssessment ?? '';
  const inputFundamentality = parsedCoverage?.inputFundamentality ?? storedAggregate?.inputFundamentalityAssessment ?? '';
  const aggregateAdjudication = parsedCoverage?.adjudication ?? storedAggregate?.adjudication ?? null;
  const adjudicatorStatus =
    parsedCoverage?.adjudicatorStatus ??
    aggregateAdjudication?.adjudicatorStatus ??
    storedAggregate?.adjudicatorStatus ??
    'success';
  const adjudicatorFallbackActive = adjudicatorStatus === 'failed_fallback' || adjudicatorStatus === 'not_run';
  const aggregateContributionArchetype = parsedCoverage?.contributionArchetype ?? storedAggregate?.contributionArchetype ?? null;
  const aggregateNearestComparators = parsedCoverage?.nearestComparators ?? storedAggregate?.nearestComparators ?? [];
  const storedIndividualReviews = storedIndividualReviewsFromField.length > 0
    ? storedIndividualReviewsFromField
    : Array.isArray(parsedCoverage?.individualReviews)
      ? parsedCoverage.individualReviews
      : [];
  const aggregateScoreBand = storedAggregate?.finalScoreBand ?? null;
  const comparatorCalibration = parsedCoverage?.comparatorCalibration ?? storedAggregate?.comparatorCalibration ?? null;
  const blindIntrinsicScoreBand = parsedCoverage?.blindIntrinsicScoreBand
    ?? comparatorCalibration?.intrinsicScoreBand
    ?? storedAggregate?.blindIntrinsicScoreBand
    ?? null;
  const comparatorCalibratedFinalScoreBand = parsedCoverage?.comparatorCalibratedFinalScoreBand
    ?? comparatorCalibration?.finalPublicScoreBand
    ?? aggregateScoreBand
    ?? null;
  const calibrationAdjustment = typeof comparatorCalibration?.calibrationAdjustment === 'number'
    ? comparatorCalibration.calibrationAdjustment
    : null;
  const calibrationRationale = comparatorCalibration?.calibrationRationale ?? '';
  const scoreGapAssessment = comparatorCalibration?.scoreGapAssessment ?? '';
  const comparatorCalibrationStatus =
    parsedCoverage?.comparatorCalibrationStatus ??
    comparatorCalibration?.comparatorCalibrationStatus ??
    (calibrationAdjustment != null ? 'applied' : 'unavailable');
  const comparatorCalibrationApplied =
    comparatorCalibrationStatus === 'applied' ||
    comparatorCalibrationStatus === 'weak';
  const explanatoryDeltaAssessment =
    parsedCoverage?.explanatoryDeltaAssessment ??
    comparatorCalibration?.explanatoryDeltaAssessment ??
    null;
  const subscoreValidity = parsedCoverage?.subscoreValidity ?? storedAggregate?.subscoreValidity ?? {};
  const subscoreConsistencyWarning =
    parsedCoverage?.subscoreConsistencyWarning ??
    aggregateAdjudication?.subscoreConsistencyWarning ??
    storedAggregate?.subscoreConsistencyWarning ??
    '';
  const subscoreSaturationWarning =
    Boolean(parsedCoverage?.subscoreSaturationWarning) ||
    Boolean(aggregateAdjudication?.subscoreSaturationWarning) ||
    Boolean(storedAggregate?.subscoreSaturationWarning);
  const publicComparatorSummary = parsedCoverage?.publicComparatorSummary ?? storedAggregate?.publicComparatorSummary ?? '';
  const externalComparatorSuggestions = parsedCoverage?.externalComparatorSuggestions ?? storedAggregate?.externalComparatorSuggestions ?? [];
  const adminComparatorNotes = parsedCoverage?.adminComparatorNotes ?? storedAggregate?.adminComparatorNotes ?? '';
  const pdfVisibleFallbackUsed = Boolean(parsedCoverage?.pdfVisibleFallbackUsed);
  const blindingStrength = parsedCoverage?.blindingStrength ?? (pdfVisibleFallbackUsed ? 'weaker' : 'strong');
  const publicVerdict = review.publicVerdict || storedAggregate?.publicOneParagraphVerdict || parsedCoverage?.publicVerdict || review.finalJudgment || review.overallEvaluation;
  const comparisonCohort = review.comparisonCohort || parsedCoverage?.finalComparisonCohort || review.specialtyField || review.broadField;
  const localCohort =
    parsedCoverage?.finalLocalCohort ||
    parsedCoverage?.localCohort ||
    storedAggregate?.finalLocalCohort ||
    storedAggregate?.comparatorProfile?.localCohort ||
    comparisonCohort;
  const canonicalClusterLabel =
    parsedCoverage?.canonicalClusterLabel ||
    parsedCoverage?.benchmarkCluster?.canonicalClusterLabel ||
    storedAggregate?.canonicalClusterLabel ||
    '';
  const aggregateVerdict = storedAggregate?.publicOneParagraphVerdict ?? publicVerdict;
  const aggregateClassification = storedAggregate?.finalClassification ?? review.bestClassification;
  const storedScoreStability = aggregateAdjudication?.scoreStability || storedAggregate?.scoreStability || (review as any).scoreStability || parsedCoverage?.scoreStability || null;
  const selectedPass = activeTab === 'combined' ? null : storedIndividualReviews[activeTab] ?? null;
  const passScoreBands = storedIndividualReviews.map((pass: any) =>
    normalizeDisplayedBand(
      pass.scoreBand?.low,
      pass.scoreBand?.median,
      pass.scoreBand?.high,
      pass.bestClassification,
    )
  );
  const passMedianScoresByIndex = storedIndividualReviews
    .map((pass: any, index: number) => {
      const rawMedian = Number(pass?.scoreBand?.median);
      return Number.isFinite(rawMedian) ? passScoreBands[index]?.median : null;
    });
  const passMedianScores = passMedianScoresByIndex
    .filter((score: number | null): score is number => typeof score === 'number' && Number.isFinite(score));
  const combinedBand = normalizeDisplayedBand(
    comparatorCalibratedFinalScoreBand?.low ?? review.scoreBandLow ?? review.overallIntrinsicScore ?? review.score,
    comparatorCalibratedFinalScoreBand?.median ?? review.scoreBandMedian ?? review.overallIntrinsicScore ?? review.score,
    comparatorCalibratedFinalScoreBand?.high ?? review.scoreBandHigh ?? review.overallIntrinsicScore ?? review.score,
    aggregateClassification ?? review.bestClassification,
  );
  const blindBand = blindIntrinsicScoreBand
    ? normalizeDisplayedBand(
        blindIntrinsicScoreBand.low,
        blindIntrinsicScoreBand.median,
        blindIntrinsicScoreBand.high,
        aggregateClassification ?? review.bestClassification,
      )
    : null;
  const adjudicatorRating = blindBand?.median ?? combinedBand.median;
  const finalScore = combinedBand.median;
  const computedPassDisagreement = passMedianScores.length >= 2
    ? Math.max(...passMedianScores) - Math.min(...passMedianScores)
    : null;
  const computedStability = computedPassDisagreement == null
    ? 'insufficient data'
    : computedPassDisagreement <= 5
      ? 'high'
      : computedPassDisagreement <= 12
        ? 'medium'
        : 'low';
  const scoreStability = selectedPass ? storedScoreStability : computedStability;
  const adjustmentLabel = comparatorCalibrationApplied
    ? `${(calibrationAdjustment ?? 0) > 0 ? '+' : ''}${calibrationAdjustment ?? 0}`
    : 'not applied';
  const comparatorNotAppliedMessage =
    'Benchmark ingestion mode: comparator calibration will be run later during benchmark backfill.';
  const scorePathCaption = comparatorCalibrationApplied
    ? 'Comparator-calibrated anchored scientific merit score.'
    : 'Comparator calibration not applied yet. This review stores the blind intrinsic profile for later benchmark backfill.';
  const scoreCappingReason =
    parsedCoverage?.scoreCappingReason ??
    storedAggregate?.scoreCappingReason ??
    comparatorCalibration?.scoreCappingReason ??
    '';
  const failedClaimsExcludedFromScore = parsedCoverage?.failedClaimsExcludedFromScore
    ?? aggregateAdjudication?.failedClaimsExcludedFromScore
    ?? storedAggregate?.failedClaimsExcludedFromScore
    ?? [];
  const survivingHighValueContributions = parsedCoverage?.survivingHighValueContributions
    ?? aggregateAdjudication?.survivingHighValueContributions
    ?? storedAggregate?.survivingHighValueContributions
    ?? [];
  const survivingContributionScoreBasis = parsedCoverage?.survivingContributionScoreBasis
    ?? aggregateAdjudication?.survivingContributionScoreBasis
    ?? storedAggregate?.survivingContributionScoreBasis
    ?? '';
  const promptVersion = parsedCoverage?.promptVersion ?? storedAggregate?.promptVersion ?? '';
  const benchmarkSetVersion = parsedCoverage?.benchmarkSetVersion ?? comparatorCalibration?.benchmarkSetVersion ?? '';
  const extractionMethod = parsedCoverage?.extractionMethod ?? '';
  const currentClassification = selectedPass?.bestClassification ?? aggregateClassification ?? review.bestClassification ?? 'Unclassified';
  const currentLocalCohort = selectedPass?.localCohort || selectedPass?.comparisonCohort || selectedPass?.broadField || localCohort;
  const currentSummary = selectedPass?.summary || storedAggregate?.finalSummary || review.summary;
  const currentVerdict = selectedPass?.oneParagraphVerdict || selectedPass?.finalJudgment || aggregateVerdict;
  const currentCentralClaim = selectedPass?.centralClaim || review.centralClaim;
  const currentDirectTargets = selectedPass?.coverageLedger?.directTargets ?? directTargets;
  const currentImportedInputs = selectedPass?.coverageLedger?.importedInputs ?? importedInputs;
  const currentTheorySpaceVariants = selectedPass?.coverageLedger?.theorySpaceVariants ?? theorySpaceVariants;
  const currentMechanismSharingAssessment = selectedPass?.coverageLedger?.mechanismSharingAssessment ?? mechanismSharingAssessment;
  const currentInputConstructionOutputLedger = selectedPass?.inputConstructionOutputLedger ?? inputConstructionOutputLedger;
  const currentPrimitiveInputs = currentInputConstructionOutputLedger?.primitiveInputs ?? [];
  const currentIntroducedConstructions = currentInputConstructionOutputLedger?.introducedConstructions ?? [];
  const currentExternalEmbeddingsAndChecks = currentInputConstructionOutputLedger?.externalEmbeddingsAndChecks ?? [];
  const currentDirectOutputs = currentInputConstructionOutputLedger?.directOutputs ?? [];
  const currentDownstreamReach = currentInputConstructionOutputLedger?.downstreamReach ?? '';
  const currentLedgerOutputs = asLedgerOutputs(currentInputConstructionOutputLedger);
  const currentWhyOutputsMatter =
    currentInputConstructionOutputLedger?.whyOutputsMatter ??
    currentInputConstructionOutputLedger?.downstreamReach ??
    '';
  const currentInputConstructionOutputAssessment = currentInputConstructionOutputLedger?.assessment ?? '';
  const currentCentralOutputDependency = selectedPass?.centralOutputDependency ?? centralOutputDependency;
  const currentCentralOutput = currentCentralOutputDependency?.centralOutput ?? '';
  const currentCentralOutputPrimitiveDependencies = asArray(
    currentCentralOutputDependency?.requiredPrimitiveInputs ??
    currentCentralOutputDependency?.dependsOnPrimitiveInputs
  );
  const currentCentralOutputConstructionDependencies = asArray(
    currentCentralOutputDependency?.requiredIntroducedConstructions ??
    currentCentralOutputDependency?.dependsOnIntroducedConstructions
  );
  const currentWeakestDependency =
    currentCentralOutputDependency?.constructionFragility ??
    currentCentralOutputDependency?.weakestDependency ??
    '';
  const currentCentralOutputDependencyAssessment =
    currentCentralOutputDependency?.dependencyAssessment ??
    currentCentralOutputDependency?.assessment ??
    '';
  const currentCentralOutputValidity = currentCentralOutputDependency?.outputValidity ?? '';
  const currentOutputValidityAssessment = selectedPass?.outputValidityAssessment ?? outputValidityAssessment;
  const currentOutputValidityObject = asObject(currentOutputValidityAssessment);
  const currentKnownResultRecoveries = asArray(currentOutputValidityObject?.knownResultRecoveries);
  const currentNovelPredictionsOrConstraints = asArray(currentOutputValidityObject?.novelPredictionsOrConstraints);
  const currentFailedOutputsOrConstraints = asArray(currentOutputValidityObject?.failedOutputsOrConstraints);
  const currentOutputValidityText =
    selectedPass?.outputValidity ||
    parsedCoverage?.outputValidity ||
    storedAggregate?.outputValidity ||
    (typeof currentOutputValidityAssessment === 'string'
      ? currentOutputValidityAssessment
      : currentOutputValidityObject?.assessment ?? currentCentralOutputValidity);
  const hasIcoLedger = Boolean(
    currentPrimitiveInputs.length ||
    currentIntroducedConstructions.length ||
    currentLedgerOutputs.length ||
    currentExternalEmbeddingsAndChecks.length ||
    currentDirectOutputs.length ||
    currentWhyOutputsMatter ||
    currentDownstreamReach ||
    currentInputConstructionOutputAssessment
  );
  const currentInputGrounding = selectedPass?.inputGrounding || inputGrounding;
  const currentInputFundamentality = selectedPass?.inputFundamentality || inputFundamentality;
  const currentConstructionAssessment = selectedPass?.constructionAssessment
    || parsedCoverage?.constructionAssessment
    || storedAggregate?.constructionAssessment
    || '';
  const currentCorrectness = selectedPass?.correctness || review.correctness;
  const currentStrongestCase = selectedPass?.strongestCaseForImportance || review.strongestCaseForImportance;
  const currentStrongestObjection = selectedPass?.strongestObjection || review.strongestObjection;
  const currentAssessmentSensitivity =
    selectedPass?.assessmentSensitivity ||
    parsedCoverage?.assessmentSensitivity ||
    storedAggregate?.assessmentSensitivity ||
    review.assessmentSensitivity ||
    '';
  const currentFrameworkConditionality = selectedPass?.frameworkConditionality?.explanation
    || (review as any).frameworkConditionalityExplanation
    || storedAggregate?.frameworkConditionalityAssessment
    || parsedCoverage?.frameworkConditionalityAssessment
    || '';
  const currentFrameworkIndependence = selectedPass?.frameworkIndependence
    || parsedCoverage?.frameworkIndependence
    || storedAggregate?.frameworkIndependenceAssessment
    || '';
  const currentHardToVaryAssessment = selectedPass?.hardToVaryAssessment
    || parsedCoverage?.hardToVaryAssessment
    || storedAggregate?.hardToVaryAssessment
    || '';
  const currentOriginalContribution = selectedPass?.manuscriptOriginalContribution
    || parsedCoverage?.manuscriptOriginalContribution
    || storedAggregate?.originalContributionAssessment
    || '';
  const currentContributionArchetype = selectedPass?.contributionArchetype ?? aggregateContributionArchetype;
  const currentNearestComparators = selectedPass?.nearestComparators ?? aggregateNearestComparators ?? [];
  const currentEstablishedResults = listMarkdown(selectedPass?.establishedResults) || review.establishedResults || listMarkdown(storedAggregate?.establishedResults);
  const currentInterpretiveClaims = listMarkdown(selectedPass?.interpretiveClaims) || review.interpretiveClaims || listMarkdown(storedAggregate?.interpretiveClaims);
  const currentSpeculativeClaims = listMarkdown(selectedPass?.speculativeClaims) || review.speculativeClaims || listMarkdown(storedAggregate?.speculativeClaims);
  const currentWhatWouldRaiseScore = selectedPass?.whatWouldRaiseScore || parsedCoverage?.whatWouldRaiseScore || storedAggregate?.whatWouldRaiseScore || '';
  const currentWhatWouldLowerScore = selectedPass?.whatWouldLowerScore || parsedCoverage?.whatWouldLowerScore || storedAggregate?.whatWouldLowerScore || '';
  const hasOptionalDetails = [
    currentEstablishedResults,
    currentInterpretiveClaims,
    currentSpeculativeClaims,
    currentWhatWouldRaiseScore,
    currentWhatWouldLowerScore,
  ].some(hasText) || (
    isAdmin && (
      (Array.isArray(externalComparatorSuggestions) && externalComparatorSuggestions.length > 0) ||
      hasText(adminComparatorNotes)
    )
  );
  const submittedAtLabel = Number.isFinite(review.createdAt)
    ? format(new Date(review.createdAt), 'MMM d, yyyy h:mm:ss a')
    : null;
  const selectedSubscoreValidity = selectedPass?.subscoreValidity ?? subscoreValidity;
  const subscoreIsValid = (key: string, legacyKey: string) =>
    (selectedSubscoreValidity as any)?.[key] ?? (selectedSubscoreValidity as any)?.[legacyKey] ?? true;
  const currentInputStrengthScore = validSubscore(
    selectedPass?.inputStrengthScore ?? storedAggregate?.inputStrengthScore ?? parsedCoverage?.inputStrengthScore ?? review.inputStrengthScore ?? review.intrinsicScientificMeritScore,
    subscoreIsValid('inputStrengthScore', 'intrinsicTechnicalScore') !== false,
  );
  const currentConstructionStrengthScore = validSubscore(
    selectedPass?.constructionStrengthScore ?? storedAggregate?.constructionStrengthScore ?? parsedCoverage?.constructionStrengthScore ?? review.constructionStrengthScore ?? review.explanatoryTargetBreadthScore,
    subscoreIsValid('constructionStrengthScore', 'explanatoryTargetBreadthScore') !== false,
  );
  const currentOutputReachScore = validSubscore(
    selectedPass?.outputReachScore ?? storedAggregate?.outputReachScore ?? parsedCoverage?.outputReachScore ?? review.outputReachScore ?? review.theorySpaceBreadthScore,
    subscoreIsValid('outputReachScore', 'theorySpaceBreadthScore') !== false,
  );
  const currentOutputStrengthScore = validSubscore(
    selectedPass?.outputStrengthScore ?? storedAggregate?.outputStrengthScore ?? parsedCoverage?.outputStrengthScore ?? review.outputStrengthScore ?? currentOutputReachScore ?? review.theorySpaceBreadthScore,
    subscoreIsValid('outputStrengthScore', 'outputReachScore') !== false,
  );
  const passDisagreement = computedPassDisagreement;
  const rawModelPipeline = String(parsedCoverage?.modelName ?? review.modelName ?? '');
  const modelBase = /gemini-3\.1-pro/i.test(rawModelPipeline)
    ? 'Gemini 3.1 Pro Preview'
    : /gemini-3\.5-flash/i.test(rawModelPipeline)
      ? 'Gemini 3.5 Flash'
      : rawModelPipeline;
  const shortPromptVersion = promptVersion ? String(promptVersion).match(/^v\d+(?:\.\d+)?/)?.[0] ?? String(promptVersion) : '';
  const pipelineModeLabel = parsedCoverage?.pipelineMode === 'benchmark-ingestion'
    ? 'benchmark ingestion'
    : parsedCoverage?.pipelineMode === 'normal-review'
      ? 'normal review'
      : '';
  const versionAndMode = [shortPromptVersion, pipelineModeLabel].filter(Boolean).join(' ');
  const modelPromptLine = [modelBase, versionAndMode].filter(Boolean).join(' · ');
  const passBandLabels = passScoreBands
    .filter(Boolean)
    .map((band: { low: number; median: number; high: number }, index: number) => `P${index + 1}: ${band.low}-${band.median}-${band.high}`)
    .join('; ');
  const technicalAssessmentBoxes = [
    { label: 'Correctness', value: currentCorrectness, color: 'text-emerald-400', icon: <CheckCircle2 className="w-4 h-4" /> },
    { label: 'Input Grounding', value: currentInputGrounding, color: 'text-cyan-400', icon: <Shield className="w-4 h-4" /> },
    { label: 'Input Fundamentality', value: currentInputFundamentality, color: 'text-violet-400', icon: <BrainCircuit className="w-4 h-4" /> },
    { label: 'Construction Assessment', value: currentConstructionAssessment, color: 'text-indigo-300', icon: <GitBranch className="w-4 h-4" /> },
    { label: 'Output Validity', value: currentOutputValidityText, color: 'text-emerald-300', icon: <CheckCircle2 className="w-4 h-4" /> },
    { label: 'Framework Independence', value: currentFrameworkIndependence, color: 'text-sky-300', icon: <GitBranch className="w-4 h-4" /> },
    { label: 'Framework Conditionality', value: currentFrameworkConditionality, color: 'text-amber-400', icon: <GitBranch className="w-4 h-4" /> },
    { label: 'Hard-to-Vary Assessment', value: currentHardToVaryAssessment, color: 'text-orange-300', icon: <Shield className="w-4 h-4" /> },
    { label: 'Strongest Case', value: currentStrongestCase, color: 'text-green-400', icon: <TrendingUp className="w-4 h-4" /> },
    { label: 'Strongest Objection', value: currentStrongestObjection, color: 'text-rose-400', icon: <AlertTriangle className="w-4 h-4" /> },
    { label: 'Assessment Sensitivity', value: currentAssessmentSensitivity, color: 'text-yellow-400', icon: <Microscope className="w-4 h-4" /> },
  ];
  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-gradient-to-br from-indigo-950 to-slate-900 text-white rounded-3xl overflow-hidden shadow-2xl"
      >
        <div className="p-8 space-y-8">

          {/* Header */}
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <div className="bg-indigo-500/20 p-2.5 rounded-xl border border-indigo-500/30">
                <Sparkles className="w-6 h-6 text-indigo-400" />
              </div>
              <div>
                <h2 className="text-xl font-black tracking-tight">AI Scientific Review</h2>
                {modelPromptLine && (
                  <p className="text-[10px] font-black text-indigo-200 uppercase tracking-widest mt-1 break-words">
                    {modelPromptLine}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-5">
            <div className="space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <p className="text-[10px] font-black text-indigo-300 uppercase tracking-widest">Score Path</p>
                <p className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">Select a segment to change the review below</p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm font-black text-white" role="tablist" aria-label="Score path review views">
                <span className="text-slate-300">Blind Passes (</span>
                {passMedianScores.length > 0 ? (
                  <>
                    {passMedianScoresByIndex.map((score: number | null | undefined, index: number) => score == null ? null : (
                      <React.Fragment key={index}>
                        {index > 0 && <span className="text-slate-300">,</span>}
                        <button
                          role="tab"
                          aria-selected={scoreDetail === index}
                          onClick={() => {
                            setActiveTab(index);
                            setScoreDetail(index);
                          }}
                          className={`relative cursor-pointer rounded-lg border px-2 py-1 transition-all ${
                            scoreDetail === index
                              ? 'border-white bg-fuchsia-400/30 text-white ring-2 ring-white/70 shadow-[0_0_0_1px_rgba(255,255,255,0.35),0_10px_30px_rgba(255,255,255,0.12)]'
                              : 'border-white/20 bg-fuchsia-400/10 text-fuchsia-100 hover:border-white/60 hover:bg-fuchsia-400/20'
                          }`}
                        >
                          {score}
                        </button>
                      </React.Fragment>
                    ))}
                    {passMedianScores.length === 1 && <span className="text-slate-300">; only 1 valid pass</span>}
                  </>
                ) : (
                  <span className="text-slate-300">not stored</span>
                )}
                <span className="text-slate-300">)</span>
                <span className="text-white">-&gt;</span>
                <button
                  role="tab"
                  aria-selected={scoreDetail === 'adjudicator'}
                  onClick={() => {
                    setActiveTab('combined');
                    setScoreDetail('adjudicator');
                  }}
                  className={`relative cursor-pointer rounded-lg border px-2 py-1 transition-all ${
                    scoreDetail === 'adjudicator'
                      ? 'border-white bg-sky-400/30 text-white ring-2 ring-white/70 shadow-[0_0_0_1px_rgba(255,255,255,0.35),0_10px_30px_rgba(255,255,255,0.12)]'
                      : 'border-white/20 bg-sky-400/10 text-sky-100 hover:border-white/60 hover:bg-sky-400/20'
                  }`}
                >
                  Adjudicator Rating {adjudicatorRating}
                </button>
                <span className="text-white">-&gt;</span>
                <button
                  role="tab"
                  aria-selected={scoreDetail === 'comparator'}
                  onClick={() => {
                    setActiveTab('combined');
                    setScoreDetail('comparator');
                  }}
                  className={`relative cursor-pointer rounded-lg border px-2 py-1 transition-all ${
                    scoreDetail === 'comparator'
                      ? 'border-white bg-cyan-400/30 text-white ring-2 ring-white/70 shadow-[0_0_0_1px_rgba(255,255,255,0.35),0_10px_30px_rgba(255,255,255,0.12)]'
                      : 'border-white/20 bg-cyan-400/10 text-cyan-100 hover:border-white/60 hover:bg-cyan-400/20'
                  }`}
                >
                  Adjustment {adjustmentLabel}
                </button>
                <span className="text-white">-&gt;</span>
                <button
                  role="tab"
                  aria-selected={scoreDetail === 'final'}
                  onClick={() => {
                    setActiveTab('combined');
                    setScoreDetail('final');
                  }}
                  className={`relative cursor-pointer rounded-lg border px-2 py-1 transition-all ${
                    scoreDetail === 'final'
                      ? 'border-white bg-emerald-400/30 text-white ring-2 ring-white/70 shadow-[0_0_0_1px_rgba(255,255,255,0.35),0_10px_30px_rgba(255,255,255,0.12)]'
                      : 'border-white/20 bg-emerald-400/10 text-emerald-100 hover:border-white/60 hover:bg-emerald-400/20'
                  }`}
                >
                  Final Score {finalScore}
                </button>
              </div>
              <p className="text-xs text-slate-400">{scorePathCaption}</p>
            </div>

            <div className="border-t border-white/10 pt-4">
              <div className="grid gap-3 md:grid-cols-3">
              <div>
                <p className="text-[10px] font-black text-indigo-300 uppercase tracking-widest">Classification</p>
                <p className="text-sm font-bold text-white mt-1 capitalize">{currentClassification}</p>
              </div>
              <div>
                <p className="text-[10px] font-black text-teal-300 uppercase tracking-widest">Local Cohort</p>
                <p className="text-sm font-bold text-white mt-1">{currentLocalCohort || 'Not specified'}</p>
                {canonicalClusterLabel && (
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                    Cluster: {canonicalClusterLabel}
                  </p>
                )}
              </div>
              <div>
                <p className="text-[10px] font-black text-violet-300 uppercase tracking-widest">Stability</p>
                <p className="text-sm font-bold text-white mt-1 capitalize">
                  {scoreStability || 'Not stored'}
                  {passDisagreement != null && !selectedPass ? ` (${passDisagreement} point disagreement)` : ''}
                </p>
              </div>
              </div>
            </div>
          </div>

          <div
            className="relative rounded-3xl border border-white/45 bg-white/[0.03] p-4 space-y-8 shadow-[0_20px_70px_rgba(15,23,42,0.35)]"
            role="tabpanel"
          >
          {scoreDetail !== 'final' && (
            <div className="bg-slate-950/30 border border-white/10 rounded-2xl p-5 space-y-3">
              {typeof scoreDetail === 'number' && (
                <>
                  <h3 className="text-xs font-black text-fuchsia-300 uppercase tracking-widest">Blind Pass {scoreDetail + 1}</h3>
                  <p className="text-sm text-slate-300">
                    Showing the rendered details from independent blind review pass {scoreDetail + 1} below.
                  </p>
                </>
              )}
              {scoreDetail === 'adjudicator' && (
                <>
                  <h3 className="text-xs font-black text-sky-300 uppercase tracking-widest">Adjudicator Rating</h3>
                  <Markdown>{aggregateAdjudication?.mainDisagreements?.length
                    ? `The adjudicator rating is ${adjudicatorRating}. Main disagreements: ${aggregateAdjudication.mainDisagreements.join('; ')}`
                    : `The adjudicator rating is ${adjudicatorRating}. This is the blind intrinsic score before comparator calibration.`}</Markdown>
                </>
              )}
              {scoreDetail === 'comparator' && (
                <>
                  <h3 className="text-xs font-black text-cyan-300 uppercase tracking-widest">Comparator Adjustment</h3>
                  {comparatorCalibrationApplied ? (
                    <div className="space-y-3">
                      {calibrationRationale && <Markdown>{calibrationRationale}</Markdown>}
                      {scoreGapAssessment && <Markdown>{scoreGapAssessment}</Markdown>}
                      {Array.isArray(currentNearestComparators) && currentNearestComparators.length > 0 && (
                        <div className="grid gap-3">
                          {currentNearestComparators.map((comparator: any, index: number) => (
                            <div key={`${comparator.sitePaperId || comparator.paperTitle || comparator.title || index}-${index}`} className="bg-white/5 border border-white/10 rounded-xl p-3">
                              {comparator.sitePaperId ? (
                                <a
                                  href={`/papers/${encodeURIComponent(comparator.sitePaperId)}`}
                                  className="text-sm font-black text-white hover:text-cyan-200 transition-colors"
                                >
                                  {comparator.paperTitle || comparator.displayTitle || comparator.title || 'Comparator'}
                                </a>
                              ) : (
                                <p className="text-sm font-black text-white">{comparator.paperTitle || comparator.displayTitle || comparator.title || 'Comparator'}</p>
                              )}
                              {(comparator.whyComparable || comparator.keyDifference || comparator.scoreGapJustification) && (
                                <div className="mt-2 space-y-2">
                                  {comparator.whyComparable && <Markdown>{comparator.whyComparable}</Markdown>}
                                  {comparator.keyDifference && <Markdown>{comparator.keyDifference}</Markdown>}
                                  {comparator.scoreGapJustification && <Markdown>{comparator.scoreGapJustification}</Markdown>}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {!calibrationRationale && !scoreGapAssessment && (
                        <p className="text-sm text-slate-300">Comparator calibration ran and produced adjustment {adjustmentLabel}.</p>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-300">{comparatorNotAppliedMessage}</p>
                  )}
                </>
              )}
            </div>
          )}

          {isAdmin && !selectedPass && adjudicatorFallbackActive && (
            <div className="bg-rose-500/10 border border-rose-300/25 rounded-2xl p-4">
              <p className="text-xs font-black text-rose-200 uppercase tracking-widest">Admin Adjudicator Status</p>
              <p className="text-sm text-rose-50 mt-2">
                {adjudicatorStatus === 'not_run'
                  ? 'The blind adjudicator did not run because the required blind passes did not complete. This score is a fallback from the saved pass review(s), not a successful adjudication.'
                  : 'The blind adjudicator failed validation or API generation. This score is a fallback from the blind pass review(s), not a successful adjudication.'}
              </p>
            </div>
          )}

          {isAdmin && !selectedPass && (subscoreConsistencyWarning || subscoreSaturationWarning) && (
            <div className="bg-amber-400/10 border border-amber-300/20 rounded-2xl p-4">
              <p className="text-xs font-black text-amber-200 uppercase tracking-widest">Admin Score Validation</p>
              {subscoreSaturationWarning && <p className="text-sm text-amber-50 mt-2">All three diagnostic subscores are 10. Inspect this review for subscore saturation.</p>}
              {subscoreConsistencyWarning && <p className="text-sm text-amber-50 mt-2">{subscoreConsistencyWarning}</p>}
            </div>
          )}

          {/* Central Claim */}
          {currentCentralClaim && (
            <Section icon={<Target className="w-4 h-4" />} label="Central Claim" color="text-sky-400">
              <Markdown>{currentCentralClaim}</Markdown>
            </Section>
          )}

          {currentSummary && (
            <Section icon={<BookOpen className="w-4 h-4" />} label="Review Summary" color="text-indigo-300">
              <Markdown>{currentSummary}</Markdown>
            </Section>
          )}

          {currentVerdict && (
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-3">
              <h3 className="text-xs font-black text-emerald-300 uppercase tracking-widest flex items-center gap-2">
                <Award className="w-4 h-4" /> {selectedPass ? 'Pass Verdict' : 'Verdict'}
              </h3>
              <Markdown>{currentVerdict}</Markdown>
              {submittedAtLabel && (
                <p className="pt-3 border-t border-white/10 text-[11px] font-bold uppercase tracking-widest text-slate-400">
                  Submitted {submittedAtLabel}
                </p>
              )}
            </div>
          )}

          {currentContributionArchetype?.primary && (
            <Section icon={<GitBranch className="w-4 h-4" />} label="Contribution Archetype" color="text-fuchsia-300">
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                  <p className="text-[10px] font-black text-fuchsia-300 uppercase tracking-widest">Primary</p>
                  <p className="text-sm font-bold text-white mt-1">{currentContributionArchetype.primary}</p>
                </div>
                {currentContributionArchetype.secondary && (
                  <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                    <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest">Secondary</p>
                    <p className="text-sm font-bold text-white mt-1">{currentContributionArchetype.secondary}</p>
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* Sub-scores (new format only) */}
          {isNewFormat && (
            <div className="grid md:grid-cols-3 gap-3">
              {[
                { label: 'Input Strength', value: currentInputStrengthScore, color: 'text-indigo-300', subColor: 'text-indigo-400' },
                { label: 'Construction Strength', value: currentConstructionStrengthScore, color: 'text-sky-300', subColor: 'text-sky-400' },
                { label: 'Output Strength', value: currentOutputStrengthScore, color: 'text-violet-300', subColor: 'text-violet-400' },
              ].map((item) => (
                <div key={item.label} className="bg-white/5 border border-white/10 rounded-2xl p-4 text-center">
                  <div className={`text-3xl font-black ${item.color}`}>
                    {item.value == null ? 'N/A' : item.value}
                    {item.value != null && <span className={`text-base font-bold ${item.subColor} opacity-60`}>/10</span>}
                  </div>
                  <div className={`text-[10px] font-bold ${item.subColor} uppercase tracking-widest mt-1`}>{item.label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Input-Construction-Output Ledger */}
          {currentInputConstructionOutputLedger && (() => {
            const hasContent =
              currentPrimitiveInputs.length ||
              currentIntroducedConstructions.length ||
              currentLedgerOutputs.length ||
              currentWhyOutputsMatter ||
              currentInputConstructionOutputAssessment;
            if (!hasContent) return null;
            return (
              <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-4">
                <h3 className="text-xs font-black text-cyan-300 uppercase tracking-widest flex items-center gap-2">
                  <BrainCircuit className="w-4 h-4" /> Input-Construction-Output Ledger
                </h3>
                <div className="space-y-4">
                  {currentPrimitiveInputs.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[10px] font-black text-cyan-300 uppercase tracking-widest">Primitive Inputs</p>
                      <ul className="space-y-1">
                        {currentPrimitiveInputs.map((item: string, i: number) => (
                          <li key={i} className="text-xs text-slate-300 flex gap-2"><span className="text-cyan-400 shrink-0">▸</span><div className="min-w-0 flex-1"><Markdown>{item}</Markdown></div></li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {currentIntroducedConstructions.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[10px] font-black text-indigo-300 uppercase tracking-widest">Introduced Constructions</p>
                      <ul className="space-y-1">
                        {currentIntroducedConstructions.map((item: string, i: number) => (
                          <li key={i} className="text-xs text-slate-300 flex gap-2"><span className="text-indigo-400 shrink-0">▸</span><div className="min-w-0 flex-1"><Markdown>{item}</Markdown></div></li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {currentLedgerOutputs.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[10px] font-black text-emerald-300 uppercase tracking-widest">Outputs</p>
                      <div className="space-y-3">
                        {currentLedgerOutputs.map((item: any, i: number) => (
                          <div key={`${item.output}-${i}`} className="bg-slate-950/25 border border-white/10 rounded-xl p-3 space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-emerald-400 shrink-0">▸</span>
                              <div className="min-w-0 flex-1"><Markdown>{item.output}</Markdown></div>
                              {item.centrality && (
                                <span className="text-[9px] font-black uppercase tracking-widest text-emerald-100 bg-emerald-400/15 border border-emerald-300/20 rounded-full px-2 py-1">
                                  {item.centrality}
                                </span>
                              )}
                            </div>
                            {item.dependsOnInputs.length > 0 && (
                              <div>
                                <p className="text-[9px] font-black text-cyan-300 uppercase tracking-widest mb-1">Depends on Inputs</p>
                                <Markdown>{listMarkdown(item.dependsOnInputs)}</Markdown>
                              </div>
                            )}
                            {item.dependsOnConstructions.length > 0 && (
                              <div>
                                <p className="text-[9px] font-black text-indigo-300 uppercase tracking-widest mb-1">Depends on Constructions</p>
                                <Markdown>{listMarkdown(item.dependsOnConstructions)}</Markdown>
                              </div>
                            )}
                            {item.externalContextIfAny && (
                              <div>
                                <p className="text-[9px] font-black text-amber-300 uppercase tracking-widest mb-1">External Context</p>
                                <Markdown>{item.externalContextIfAny}</Markdown>
                              </div>
                            )}
                            {item.support && (
                              <div>
                                <p className="text-[9px] font-black text-sky-300 uppercase tracking-widest mb-1">Support</p>
                                <Markdown>{item.support}</Markdown>
                              </div>
                            )}
                            {item.validity && (
                              <div>
                                <p className="text-[9px] font-black text-emerald-300 uppercase tracking-widest mb-1">Validity</p>
                                <Markdown>{item.validity}</Markdown>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                {currentWhyOutputsMatter && (
                  <div className="border-t border-white/10 pt-3">
                    <p className="text-[10px] font-black text-teal-300 uppercase tracking-widest mb-1">Why the Outputs Matter</p>
                    <Markdown>{currentWhyOutputsMatter}</Markdown>
                  </div>
                )}
                {currentInputConstructionOutputAssessment && (
                  <div className="border-t border-white/10 pt-3">
                    <p className="text-[10px] font-black text-violet-300 uppercase tracking-widest mb-1">Assessment</p>
                    <Markdown>{currentInputConstructionOutputAssessment}</Markdown>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Legacy Coverage Ledger */}
          {!hasIcoLedger && (review.coverageLedgerJson || selectedPass?.coverageLedger) && (() => {
            const hasContent = currentDirectTargets?.length || currentImportedInputs?.length || currentTheorySpaceVariants?.length || currentMechanismSharingAssessment;
            if (!hasContent) return null;
            return (
              <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-4">
                <h3 className="text-xs font-black text-teal-400 uppercase tracking-widest flex items-center gap-2">
                  <ListChecks className="w-4 h-4" /> Coverage Ledger
                </h3>
                <div className="grid md:grid-cols-3 gap-4">
                  {currentDirectTargets?.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">Direct Targets</p>
                      <ul className="space-y-1">
                        {currentDirectTargets.map((t: string, i: number) => (
                          <li key={i} className="text-xs text-slate-300 flex gap-2"><span className="text-emerald-500 shrink-0">▸</span><div className="min-w-0 flex-1"><Markdown>{t}</Markdown></div></li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {currentImportedInputs?.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[10px] font-black text-amber-400 uppercase tracking-widest">Imported Inputs</p>
                      <ul className="space-y-1">
                        {currentImportedInputs.map((t: string, i: number) => (
                          <li key={i} className="text-xs text-slate-300 flex gap-2"><span className="text-amber-500 shrink-0">▸</span><div className="min-w-0 flex-1"><Markdown>{t}</Markdown></div></li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {currentTheorySpaceVariants?.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[10px] font-black text-violet-400 uppercase tracking-widest">Theory-Space Variants</p>
                      <ul className="space-y-1">
                        {currentTheorySpaceVariants.map((t: string, i: number) => (
                          <li key={i} className="text-xs text-slate-300 flex gap-2"><span className="text-violet-500 shrink-0">▸</span><div className="min-w-0 flex-1"><Markdown>{t}</Markdown></div></li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
                {currentMechanismSharingAssessment && (
                  <div className="border-t border-white/10 pt-3">
                    <p className="text-[10px] font-black text-teal-400 uppercase tracking-widest mb-1">Mechanism-Sharing Assessment</p>
                    <Markdown>{currentMechanismSharingAssessment}</Markdown>
                  </div>
                )}
              </div>
            );
          })()}

          <div className="space-y-4">
            <h3 className="text-xs font-black text-slate-300 uppercase tracking-widest flex items-center gap-2">
              <Microscope className="w-4 h-4" /> Technical Assessment
            </h3>
            <div className="grid md:grid-cols-2 gap-4">
              {technicalAssessmentBoxes.map((box) => (
                <div key={box.label} className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-2">
                  <h3 className={`text-xs font-black uppercase tracking-widest flex items-center gap-2 ${box.color}`}>
                    {box.icon} {box.label}
                  </h3>
                  {hasText(box.value) ? (
                    <Markdown>{box.value}</Markdown>
                  ) : (
                    <p className="text-sm text-slate-500">N/A</p>
                  )}
                </div>
              ))}
            </div>
          </div>

          <details className="bg-white/5 border border-white/10 rounded-2xl p-5 group">
            <summary className="cursor-pointer text-xs font-black text-slate-300 uppercase tracking-widest">
              Advanced Scoring Details
            </summary>
            <div className="mt-4 space-y-4">
              <div className="grid md:grid-cols-3 gap-3">
                <div className="bg-slate-950/30 border border-white/10 rounded-xl p-3">
                  <p className="text-[10px] font-black text-fuchsia-300 uppercase tracking-widest">Blind Pass Scores</p>
                  <p className="text-sm font-black text-white mt-1">{passMedianScores.length > 0 ? passMedianScores.join(', ') : 'Not stored'}</p>
                  {passBandLabels && <p className="text-[10px] font-bold text-slate-400 mt-1">{passBandLabels}</p>}
                </div>
                <div className="bg-slate-950/30 border border-white/10 rounded-xl p-3">
                  <p className="text-[10px] font-black text-amber-300 uppercase tracking-widest">Pass Disagreement</p>
                  <p className="text-sm font-black text-white mt-1">{computedPassDisagreement ?? 'Insufficient data'}</p>
                </div>
                <div className="bg-slate-950/30 border border-white/10 rounded-xl p-3">
                  <p className="text-[10px] font-black text-violet-300 uppercase tracking-widest">Derived Stability</p>
                  <p className="text-sm font-black text-white mt-1 capitalize">{computedStability}</p>
                </div>
                <div className="bg-slate-950/30 border border-white/10 rounded-xl p-3">
                  <p className="text-[10px] font-black text-sky-300 uppercase tracking-widest">Adjudicator Band</p>
                  <p className="text-sm font-black text-white mt-1">{blindBand ? `${blindBand.low}-${blindBand.median}-${blindBand.high}` : 'Not stored'}</p>
                </div>
                <div className="bg-slate-950/30 border border-white/10 rounded-xl p-3">
                  <p className="text-[10px] font-black text-emerald-300 uppercase tracking-widest">{comparatorCalibrationApplied ? 'Final Calibrated Band' : 'Final Blind Intrinsic Band'}</p>
                  <p className="text-sm font-black text-white mt-1">{combinedBand.low}-{combinedBand.median}-{combinedBand.high}</p>
                </div>
                <div className="bg-slate-950/30 border border-white/10 rounded-xl p-3">
                  <p className="text-[10px] font-black text-cyan-300 uppercase tracking-widest">Comparator Status</p>
                  <p className="text-sm font-black text-white mt-1 capitalize">{String(comparatorCalibrationStatus).replace(/_/g, ' ')}</p>
                </div>
                <div className={`bg-slate-950/30 border rounded-xl p-3 ${adjudicatorFallbackActive ? 'border-rose-300/30' : 'border-white/10'}`}>
                  <p className={`text-[10px] font-black uppercase tracking-widest ${adjudicatorFallbackActive ? 'text-rose-300' : 'text-emerald-300'}`}>Adjudicator Status</p>
                  <p className="text-sm font-black text-white mt-1 capitalize">{String(adjudicatorStatus).replace(/_/g, ' ')}</p>
                </div>
              </div>

              {(calibrationRationale || scoreGapAssessment || publicComparatorSummary || scoreCappingReason || asArray(failedClaimsExcludedFromScore).length > 0 || asArray(survivingHighValueContributions).length > 0 || hasText(survivingContributionScoreBasis)) && (
                <div className="space-y-3">
                  {asArray(failedClaimsExcludedFromScore).length > 0 && (
                    <Section icon={<AlertTriangle className="w-4 h-4" />} label="Failed Claim(s) Excluded From Score" color="text-rose-300">
                      <Markdown>{listMarkdown(failedClaimsExcludedFromScore)}</Markdown>
                    </Section>
                  )}
                  {asArray(survivingHighValueContributions).length > 0 && (
                    <Section icon={<CheckCircle2 className="w-4 h-4" />} label="Surviving High-Value Contribution(s)" color="text-emerald-300">
                      <Markdown>{listMarkdown(survivingHighValueContributions)}</Markdown>
                    </Section>
                  )}
                  {hasText(survivingContributionScoreBasis) && (
                    <Section icon={<Shield className="w-4 h-4" />} label="Surviving Contribution Score Basis" color="text-cyan-300">
                      <Markdown>{survivingContributionScoreBasis}</Markdown>
                    </Section>
                  )}
                  {scoreCappingReason && (
                    <Section icon={<AlertTriangle className="w-4 h-4" />} label="Score Capping Reason" color="text-amber-300">
                      <Markdown>{scoreCappingReason}</Markdown>
                    </Section>
                  )}
                  {calibrationRationale && (
                    <Section icon={<Shield className="w-4 h-4" />} label="Calibration Rationale" color="text-cyan-300">
                      <Markdown>{calibrationRationale}</Markdown>
                    </Section>
                  )}
                  {scoreGapAssessment && (
                    <Section icon={<TrendingUp className="w-4 h-4" />} label="Score Gap Assessment" color="text-violet-300">
                      <Markdown>{scoreGapAssessment}</Markdown>
                    </Section>
                  )}
                  {publicComparatorSummary && (
                    <Section icon={<GitBranch className="w-4 h-4" />} label="Comparator Summary" color="text-lime-300">
                      <Markdown>{publicComparatorSummary}</Markdown>
                    </Section>
                  )}
                </div>
              )}

              {explanatoryDeltaAssessment && typeof explanatoryDeltaAssessment === 'object' && Object.values(explanatoryDeltaAssessment).some(hasText) && (
                <Section icon={<GitBranch className="w-4 h-4" />} label="Explanatory Delta" color="text-lime-300">
                  <div className="space-y-2">
                    {[
                      explanatoryDeltaAssessment.whatIsNewBeyondComparators,
                      explanatoryDeltaAssessment.inputsComparison,
                      explanatoryDeltaAssessment.constructionComparison,
                      explanatoryDeltaAssessment.outputsComparison,
                      explanatoryDeltaAssessment.generalizationComparison,
                      explanatoryDeltaAssessment.outputValidityComparison,
                      explanatoryDeltaAssessment.downstreamReachComparison,
                      explanatoryDeltaAssessment.frameworkConditionalityComparison,
                    ].filter(hasText).map((item: string, index: number) => (
                      <Markdown key={index}>{item}</Markdown>
                    ))}
                  </div>
                </Section>
              )}

              <div className="grid md:grid-cols-2 gap-3">
                {promptVersion && (
                  <div className="bg-slate-950/30 border border-white/10 rounded-xl p-3">
                    <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest">Prompt Version</p>
                    <p className="text-sm text-white mt-1 break-words">{promptVersion}</p>
                  </div>
                )}
                {benchmarkSetVersion && (
                  <div className="bg-slate-950/30 border border-white/10 rounded-xl p-3">
                    <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest">Benchmark Set</p>
                    <p className="text-sm text-white mt-1 break-words">{benchmarkSetVersion}</p>
                  </div>
                )}
                {extractionMethod && (
                  <div className="bg-slate-950/30 border border-white/10 rounded-xl p-3">
                    <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest">Extraction Method</p>
                    <p className="text-sm text-white mt-1 break-words">{extractionMethod}</p>
                  </div>
                )}
                {pdfVisibleFallbackUsed && (
                  <div className="bg-amber-400/10 border border-amber-300/20 rounded-xl p-3">
                    <p className="text-[10px] font-black text-amber-200 uppercase tracking-widest">PDF Fallback</p>
                    <p className="text-sm text-amber-50 mt-1">
                      Plain text extraction was weak, so Gemini read the PDF directly. The review still ignores identity signals, but visible author/title information may be present in the source PDF.
                    </p>
                  </div>
                )}
              </div>

              {isAdmin && !selectedPass && storedIndividualReviews.length > 0 && (
                <Section icon={<ListChecks className="w-4 h-4" />} label="Individual Pass Details" color="text-violet-300">
                  <div className="space-y-3">
                    {storedIndividualReviews.map((pass: any, index: number) => {
                      const band = passScoreBands[index];
                      return (
                        <div key={index} className="bg-white/5 border border-white/10 rounded-xl p-3">
                          <p className="text-xs font-black text-white">Pass {index + 1} · {band?.median ?? '—'} · {pass.bestClassification || 'unclassified'}</p>
                          {(pass.oneParagraphVerdict || pass.finalJudgment || pass.summary) && (
                            <div className="mt-2">
                              <Markdown>{pass.oneParagraphVerdict || pass.finalJudgment || pass.summary}</Markdown>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </Section>
              )}
            </div>
          </details>

          {hasOptionalDetails && (
            <details className="bg-white/5 border border-white/10 rounded-2xl p-5 group">
              <summary className="cursor-pointer text-xs font-black text-slate-300 uppercase tracking-widest">
                Optional Details
              </summary>
              <div className="mt-4 space-y-4">
                {currentEstablishedResults && (
                  <Section icon={<CheckCircle2 className="w-4 h-4" />} label="Established Results" color="text-emerald-300">
                    <Markdown>{currentEstablishedResults}</Markdown>
                  </Section>
                )}
                {currentInterpretiveClaims && (
                  <Section icon={<BookOpen className="w-4 h-4" />} label="Interpretive Claims" color="text-sky-300">
                    <Markdown>{currentInterpretiveClaims}</Markdown>
                  </Section>
                )}
                {currentSpeculativeClaims && (
                  <Section icon={<AlertTriangle className="w-4 h-4" />} label="Speculative Claims" color="text-amber-300">
                    <Markdown>{currentSpeculativeClaims}</Markdown>
                  </Section>
                )}
                {currentWhatWouldRaiseScore && (
                  <Section icon={<TrendingUp className="w-4 h-4" />} label="What Would Raise Score" color="text-green-300">
                    <Markdown>{currentWhatWouldRaiseScore}</Markdown>
                  </Section>
                )}
                {currentWhatWouldLowerScore && (
                  <Section icon={<AlertTriangle className="w-4 h-4" />} label="What Would Lower Score" color="text-rose-300">
                    <Markdown>{currentWhatWouldLowerScore}</Markdown>
                  </Section>
                )}
                {isAdmin && Array.isArray(externalComparatorSuggestions) && externalComparatorSuggestions.length > 0 && (
                  <Section icon={<GitBranch className="w-4 h-4" />} label="External Comparator Suggestions" color="text-cyan-300">
                    <div className="space-y-3">
                      {externalComparatorSuggestions.map((suggestion: any, index: number) => (
                        <div key={`${suggestion.title || index}-${index}`} className="bg-white/5 border border-white/10 rounded-xl p-3">
                          <p className="text-xs font-black text-white">{suggestion.title || 'Suggested paper'}</p>
                          {suggestion.reasonToAdd && (
                            <p className="text-[10px] font-bold uppercase tracking-widest text-cyan-200 mt-1">{String(suggestion.reasonToAdd).replace(/_/g, ' ')}</p>
                          )}
                          {suggestion.whyRelevant && (
                            <div className="mt-2">
                              <Markdown>{suggestion.whyRelevant}</Markdown>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </Section>
                )}
                {isAdmin && adminComparatorNotes && (
                  <Section icon={<BrainCircuit className="w-4 h-4" />} label="Comparator Admin Notes" color="text-violet-300">
                    <Markdown>{adminComparatorNotes}</Markdown>
                  </Section>
                )}
              </div>
            </details>
          )}

          </div>

          {review.relatedWork && (
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-3">
              <h3 className="text-xs font-black text-purple-400 uppercase tracking-widest">Related Work</h3>
              <Markdown>{review.relatedWork}</Markdown>
            </div>
          )}

          <div className="flex items-center justify-between pt-4 border-t border-white/10">
            <button
              onClick={(e) => onLike(review.id, e)}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm transition-all ${
                isLiked ? 'bg-rose-500 text-white' : 'bg-white/10 text-white hover:bg-white/20'
              }`}
            >
              <Heart className={`w-4 h-4 ${isLiked ? 'fill-current' : ''}`} />
              {review.likesCount}
            </button>
            <div className="flex items-center gap-3">
              {review.thinkingText && (
                <button
                  onClick={() => setShowThinking(true)}
                  className="flex items-center gap-2 text-violet-400 hover:text-violet-300 text-xs font-bold uppercase tracking-wider transition-colors"
                >
                  <BrainCircuit className="w-4 h-4" />
                  View Thinking
                </button>
              )}
              <button
                onClick={() => setShowPrompt(true)}
                className="flex items-center gap-2 text-indigo-400 hover:text-indigo-300 text-xs font-bold uppercase tracking-wider transition-colors"
              >
                <Info className="w-4 h-4" />
                View System Prompt
              </button>
              <ReviewChat review={review} />
            </div>
          </div>
        </div>
      </motion.div>

      <AnimatePresence>
        {showThinking && review.thinkingText && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md"
            onClick={() => setShowThinking(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-white w-full max-w-3xl rounded-3xl shadow-2xl overflow-hidden flex flex-col"
              style={{ height: '85vh' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-violet-600 text-white">
                <div className="flex items-center gap-3">
                  <BrainCircuit className="w-6 h-6" />
                  <div>
                    <h3 className="text-xl font-black tracking-tight">Model Thinking</h3>
                    {review.modelName && <p className="text-[10px] font-bold text-violet-200 uppercase tracking-widest">Internal reasoning from {review.modelName}</p>}
                  </div>
                </div>
                <button onClick={() => setShowThinking(false)} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>
              <div className="p-8 overflow-y-auto bg-slate-50 flex-1 min-h-0">
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                  <pre className="text-sm text-slate-700 whitespace-pre-wrap font-sans leading-relaxed">
                    {review.thinkingText}
                  </pre>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showPrompt && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md"
            onClick={() => setShowPrompt(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden flex flex-col"
              style={{ height: '80vh' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-indigo-600 text-white flex-shrink-0">
                <div className="flex items-center gap-3">
                  <Info className="w-6 h-6" />
                  <div>
                    <h3 className="text-xl font-black tracking-tight">System Prompt</h3>
                    {review.modelName && <p className="text-[10px] font-bold text-indigo-200 uppercase tracking-widest">Used with {review.modelName}</p>}
                  </div>
                </div>
                <button onClick={() => setShowPrompt(false)} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>
              <div className="p-8 overflow-y-auto bg-slate-50 flex-1 min-h-0">
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                  <pre className="text-sm text-slate-700 whitespace-pre-wrap font-sans leading-relaxed">
                    {review.systemPrompt}
                  </pre>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
