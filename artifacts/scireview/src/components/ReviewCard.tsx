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
    ? value.map((item) => {
        if (typeof item === 'string') return item.trim();
        if (!item || typeof item !== 'object') return '';
        const source = item as Record<string, unknown>;
        return String(source.input ?? source.construction ?? source.output ?? source.name ?? source.description ?? '').trim();
      }).filter(Boolean)
    : [];

const listMarkdown = (items: unknown): string =>
  asArray(items).map((item) => `- ${item}`).join('\n');

type PrimitiveInputDetail = {
  input: string;
  role: string;
  groundingQuality: string;
  grounding: string;
  fundamentalityLevel: string;
  fundamentality: string;
  frameworkDependenceLevel: string;
  frameworkDependence: string;
  assessment: string;
};

type IntroducedConstructionDetail = {
  construction: string;
  role: string;
  inputsUsed: string[];
  validityLevel: string;
  validity: string;
  hardToVaryLevel: string;
  hardToVary: string;
  fragilityLevel: string;
  fragilityOrLimits: string;
  assessment: string;
};

const asObjectArray = (value: unknown): any[] => Array.isArray(value) ? value : [];

const firstText = (...values: unknown[]): string => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
};

const asPrimitiveInputDetails = (ledger: any): PrimitiveInputDetail[] => {
  const source = ledger?.input?.primitiveInputs ?? ledger?.primitiveInputs;
  return asObjectArray(source)
    .map((item) => {
      if (typeof item === 'string') {
        const input = item.trim();
        return input ? { input, role: '', groundingQuality: '', grounding: '', fundamentalityLevel: '', fundamentality: '', frameworkDependenceLevel: '', frameworkDependence: '', assessment: '' } : null;
      }
      if (!item || typeof item !== 'object') return null;
      const input = firstText(item.input, item.name, item.description, item.primitiveInput);
      if (!input) return null;
      return {
        input,
        role: firstText(item.role, item.function, item.use),
        groundingQuality: firstText(item.groundingQuality),
        grounding: firstText(item.grounding, item.inputGrounding),
        fundamentalityLevel: firstText(item.fundamentalityLevel),
        fundamentality: firstText(item.fundamentality, item.inputFundamentality),
        frameworkDependenceLevel: firstText(item.frameworkDependenceLevel),
        frameworkDependence: firstText(item.frameworkDependence, item.frameworkConditionality),
        assessment: firstText(item.assessment, item.notes),
      };
    })
    .filter(Boolean) as PrimitiveInputDetail[];
};

const asIntroducedConstructionDetails = (ledger: any): IntroducedConstructionDetail[] => {
  const source = ledger?.construction?.introducedConstructions ?? ledger?.introducedConstructions;
  return asObjectArray(source)
    .map((item) => {
      if (typeof item === 'string') {
        const construction = item.trim();
        return construction ? { construction, role: '', inputsUsed: [], validityLevel: '', validity: '', hardToVaryLevel: '', hardToVary: '', fragilityLevel: '', fragilityOrLimits: '', assessment: '' } : null;
      }
      if (!item || typeof item !== 'object') return null;
      const construction = firstText(item.construction, item.name, item.description, item.introducedConstruction);
      if (!construction) return null;
      return {
        construction,
        role: firstText(item.role, item.function, item.use),
        inputsUsed: asArray(item.inputsUsed ?? item.dependsOnInputs ?? item.requiredPrimitiveInputs),
        validityLevel: firstText(item.validityLevel),
        validity: firstText(item.validity, item.correctness),
        hardToVaryLevel: firstText(item.hardToVaryLevel),
        hardToVary: firstText(item.hardToVary, item.hardToVaryCharacter),
        fragilityLevel: firstText(item.fragilityLevel),
        fragilityOrLimits: firstText(item.fragilityOrLimits, item.fragility, item.limits),
        assessment: firstText(item.assessment, item.notes),
      };
    })
    .filter(Boolean) as IntroducedConstructionDetail[];
};

const hasText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const normalizeComparableText = (value: string): string =>
  value.trim().replace(/\s+/g, ' ').toLowerCase();

const mergeUniqueText = (...values: unknown[]): string => {
  const chunks: string[] = [];
  values.forEach((value) => {
    if (!hasText(value)) return;
    const candidate = value.trim();
    const normalizedCandidate = normalizeComparableText(candidate);
    const isDuplicate = chunks.some((chunk) => {
      const normalizedChunk = normalizeComparableText(chunk);
      return normalizedChunk.includes(normalizedCandidate) || normalizedCandidate.includes(normalizedChunk);
    });
    if (!isDuplicate) chunks.push(candidate);
  });
  return chunks.join('\n\n');
};

const addsNewInformation = (candidate: string, existing: string): boolean => {
  if (!hasText(candidate)) return false;
  if (!hasText(existing)) return true;
  const normalizedCandidate = normalizeComparableText(candidate);
  const normalizedExisting = normalizeComparableText(existing);
  return !normalizedExisting.includes(normalizedCandidate);
};

const formatAssessmentMarkdown = (value: string): string => {
  const text = value.trim();
  if (!text) return '';
  const chunks = text.split(/\n{2,}/).map((chunk) => chunk.trim()).filter(Boolean);
  if (chunks.length > 1) {
    return chunks.map((chunk) => `- ${chunk.replace(/\n+/g, ' ')}`).join('\n');
  }
  return text.replace(/\n{3,}/g, '\n\n');
};

const numericScores = (value: unknown): number[] =>
  Array.isArray(value)
    ? value
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item))
        .map((item) => Math.round(item))
    : [];

const normalizeStoredPass = (pass: any) => {
  if (!pass || typeof pass !== 'object') return null;
  const score = Number(pass.score ?? pass.scoreBand?.median ?? pass.finalScore ?? pass.overallIntrinsicScore);
  return {
    ...pass,
    score: Number.isFinite(score) ? Math.round(score <= 10 && score > 0 ? score * 10 : score) : pass.score,
    bestClassification: pass.bestClassification ?? pass.classification ?? pass.finalClassification ?? '',
  };
};

const storedPassesFrom = (...values: unknown[]): any[] => {
  for (const value of values) {
    if (!Array.isArray(value)) continue;
    const passes = value.map(normalizeStoredPass).filter(Boolean) as any[];
    if (passes.length > 0) return passes;
  }
  return [];
};

const getBlindPassScores = (options: {
  review: AIReview;
  parsedCoverage: any;
  aggregateAdjudication: any;
  storedIndividualReviews: any[];
}): number[] => {
  const { review, parsedCoverage, aggregateAdjudication, storedIndividualReviews } = options;
  const fallbackPaths = [
    (review as any).blindPassScores,
    (review as any).reviewPassComparison?.individualScores,
    (review as any).adjudication?.individualScores,
    parsedCoverage?.reviewPassComparison?.individualScores,
    aggregateAdjudication?.individualScores,
    parsedCoverage?.adjudication?.individualScores,
    parsedCoverage?.blindPassScores,
    parsedCoverage?.blindPassReviews?.map((item: any) => item?.score ?? item?.scoreBand?.median),
    parsedCoverage?.coverageLedger?.reviewPassComparison?.individualScores,
    parsedCoverage?.coverageLedger?.adjudication?.individualScores,
    parsedCoverage?.coverageLedger?.blindPassScores,
    parsedCoverage?.coverageLedger?.blindPassReviews?.map((item: any) => item?.score ?? item?.scoreBand?.median),
  ];
  for (const path of fallbackPaths) {
    const scores = numericScores(path);
    if (scores.length > 0) return scores;
  }
  const reviewScores = storedIndividualReviews
    .map((item) => Number(item?.score ?? item?.scoreBand?.median))
    .filter((item) => Number.isFinite(item))
    .map((item) => Math.round(item <= 10 && item > 0 ? item * 10 : item));
  return reviewScores;
};

const firstSentence = (value: unknown): string => {
  if (!hasText(value)) return '';
  const text = value.trim().replace(/\s+/g, ' ');
  const sentence = text.match(/^.*?(?:[.!?](?=\s|$)|$)/)?.[0]?.trim() ?? text;
  return sentence.length > 220 ? `${sentence.slice(0, 217).trim()}...` : sentence;
};

const scoreToneClass = (value: number | null, scale: 10 | 100 = 10) => {
  if (value == null) return 'text-slate-100 border-white/15';
  const normalized = scale === 10 ? value * 10 : value;
  if (normalized >= 85) return 'text-emerald-100 border-emerald-300/25 bg-emerald-400/10';
  if (normalized >= 65) return 'text-amber-100 border-amber-300/25 bg-amber-400/10';
  return 'text-rose-100 border-rose-300/25 bg-rose-400/10';
};

const groundingTone = (value: unknown): 'green' | 'yellow' | 'red' | 'neutral' => {
  const text = hasText(value) ? value.toLowerCase() : '';
  if (!text) return 'neutral';
  if (/\b(speculative|weak|unsupported|arbitrary|unmotivated)\b/.test(text)) return 'red';
  if (/\b(framework[- ]conditional|conditional|debated|model[- ]dependent|assumption|conjecture)\b/.test(text)) return 'yellow';
  if (/\b(established|strong|theorem|standard|measured|empirical|universal principle|firm|accepted|mathematical)\b/.test(text)) return 'green';
  return 'neutral';
};

const levelTone = (value: unknown, reverse = false): 'green' | 'yellow' | 'red' | 'neutral' => {
  const text = hasText(value) ? value.toLowerCase() : '';
  if (/\bhigh\b/.test(text)) return reverse ? 'red' : 'green';
  if (/\bmedium|moderate\b/.test(text)) return 'yellow';
  if (/\blow\b/.test(text)) return reverse ? 'green' : 'red';
  return 'neutral';
};

const hardToVaryTone = (value: unknown): 'green' | 'yellow' | 'red' | 'neutral' => {
  const text = hasText(value) ? value.toLowerCase() : '';
  if (!text) return 'neutral';
  if (/\b(ad hoc|easy[- ]to[- ]vary|tunable|arbitrary|fragile)\b/.test(text)) return 'red';
  if (/\b(partial|somewhat|limited|tuned|moderate)\b/.test(text)) return 'yellow';
  if (/\b(hard[- ]to[- ]vary|hard to vary|forced|natural|rigid|necessary|minimal|constrained)\b/.test(text)) return 'green';
  return 'neutral';
};

const fragilityTone = (value: unknown): 'green' | 'yellow' | 'red' | 'neutral' => {
  const text = hasText(value) ? value.toLowerCase() : '';
  if (!text) return 'neutral';
  if (/\b(no|none|low|minimal|minor|not)\b.{0,24}\b(fragility|limit|fragile|issue|problem)\b/.test(text) || /\bnone\b|\blow\b|\bminimal\b/.test(text)) return 'green';
  if (/\b(severe|fatal|invalid|breaks|contradict|major)\b/.test(text)) return 'red';
  if (/\b(moderate|limited|conditional|fragile|limitation|constraint)\b/.test(text)) return 'yellow';
  return 'neutral';
};

const labelToneTextClass = (tone: 'green' | 'yellow' | 'red' | 'neutral') => {
  switch (tone) {
    case 'green':
      return 'text-emerald-300';
    case 'yellow':
      return 'text-amber-300';
    case 'red':
      return 'text-rose-300';
    default:
      return 'text-slate-300';
  }
};

const InlineMarkdown = ({ children }: { children: string }) => (
  <span className="inline [&_p]:m-0 [&_p]:inline">
    <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
      {normalizeMathMarkdown(children)}
    </ReactMarkdown>
  </span>
);

const qualityLine = (label: string, value: string, tone: 'green' | 'yellow' | 'red' | 'neutral') => (
  <div className="text-xs leading-relaxed text-slate-300">
    <span className={`font-black uppercase tracking-widest ${labelToneTextClass(tone)}`}>{label}:</span>{' '}
    <InlineMarkdown>{value}</InlineMarkdown>
  </div>
);

type IcoTabId = 'input' | 'construction' | 'output';

const ICO_TAB_THEME = {
  activeCard: 'border-indigo-200/35 bg-indigo-300/[0.10] shadow-lg shadow-indigo-950/20',
  inactiveCard: 'border-indigo-300/10 bg-indigo-950/25 opacity-80 hover:border-indigo-200/25 hover:bg-indigo-900/35 hover:opacity-100',
  panel: 'border-indigo-200/20 bg-indigo-300/[0.07]',
};

const validityTone = (value: unknown): { label: string; className: string; tone: 'green' | 'yellow' | 'red' | 'neutral' } => {
  const text = hasText(value) ? value.toLowerCase() : '';
  if (/\binvalid\b|\bwrong\b|\bfails?\b|\bunsupported\b|\bcontradict/i.test(text)) {
    return { label: 'Invalid', tone: 'red', className: 'text-rose-100 bg-rose-400/15 border-rose-300/25' };
  }
  if (/\bconditional\b|\bpartial\b|\bdepends\b|\buncertain\b|\bfragile\b|\blimited\b/i.test(text)) {
    return { label: 'Conditional', tone: 'yellow', className: 'text-amber-100 bg-amber-400/15 border-amber-300/25' };
  }
  if (/\bstrong\b|\brobust\b|\bwell supported\b|\bsecure\b/i.test(text)) {
    return { label: 'Strong', tone: 'green', className: 'text-emerald-100 bg-emerald-400/15 border-emerald-300/25' };
  }
  if (/\bcorrect\b|\bvalid\b|\bderived\b|\bsupported\b/i.test(text)) {
    return { label: 'Correct', tone: 'green', className: 'text-emerald-100 bg-emerald-400/15 border-emerald-300/25' };
  }
  return { label: 'Validity', tone: 'neutral', className: 'text-slate-100 bg-slate-400/10 border-white/15' };
};

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
  validityLevel: string;
  validity: string;
  centrality: string;
  assessment: string;
}> => {
  const outputLedger = ledger?.output && typeof ledger.output === 'object' ? ledger.output : ledger;
  const outputs = Array.isArray(outputLedger?.outputs) ? outputLedger.outputs : [];
  const normalized = outputs.map((item: any) => {
    if (typeof item === 'string') {
      return {
        output: item.trim(),
        dependsOnInputs: [],
        dependsOnConstructions: [],
        externalContextIfAny: '',
        support: '',
        validityLevel: '',
        validity: '',
        centrality: 'medium',
        assessment: '',
      };
    }
    const support = String(item?.support ?? item?.evidence ?? '').trim();
    const validity = String(item?.validity ?? item?.outputValidity ?? '').trim();
    return {
      output: String(item?.output ?? item?.directOutput ?? item?.result ?? '').trim(),
      dependsOnInputs: asArray(item?.inputsUsed ?? item?.dependsOnInputs ?? item?.requiredPrimitiveInputs),
      dependsOnConstructions: asArray(item?.constructionsUsed ?? item?.dependsOnConstructions ?? item?.requiredIntroducedConstructions),
      externalContextIfAny: String(item?.externalContextIfAny ?? item?.externalContext ?? '').trim(),
      support,
      validityLevel: String(item?.validityLevel ?? '').trim(),
      validity,
      centrality: String(item?.centrality ?? 'medium').trim(),
      assessment: mergeUniqueText(item?.assessment, validity, support),
    };
  }).filter((item: any) => item.output);

  if (normalized.length > 0) return normalized;
  return [];
};


export default function ReviewCard({ review, onLike, isLiked, isAdmin = false }: ReviewCardProps) {
  const [showPrompt, setShowPrompt] = useState(false);
  const [showThinking, setShowThinking] = useState(false);
  const [activeTab, setActiveTab] = useState<'combined' | number>('combined');
  const [activeIcoTab, setActiveIcoTab] = useState<IcoTabId>('input');

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
  const inputConstructionOutputLedger =
    parsedCoverage?.inputConstructionOutputAssessment ??
    parsedCoverage?.inputConstructionOutputLedger ??
    storedAggregate?.inputConstructionOutputAssessment ??
    storedAggregate?.inputConstructionOutputLedger ??
    null;
  const inputGrounding = parsedCoverage?.inputGrounding ?? storedAggregate?.inputGroundingAssessment ?? '';
  const inputFundamentality = parsedCoverage?.inputFundamentality ?? storedAggregate?.inputFundamentalityAssessment ?? '';
  const aggregateAdjudication = parsedCoverage?.adjudication ?? storedAggregate?.adjudication ?? null;
  const adjudicatorStatus =
    parsedCoverage?.adjudicatorStatus ??
    aggregateAdjudication?.adjudicatorStatus ??
    storedAggregate?.adjudicatorStatus ??
    'success';
  const adjudicatorFallbackActive = adjudicatorStatus === 'failed_fallback' || adjudicatorStatus === 'not_run';
  const storedIndividualReviews = storedPassesFrom(
    storedIndividualReviewsFromField,
    parsedCoverage?.blindPassReviews,
    parsedCoverage?.coverageLedger?.blindPassReviews,
    parsedCoverage?.individualReviews,
    parsedCoverage?.coverageLedger?.individualReviews,
  );
  const aggregateScoreBand = storedAggregate?.finalScoreBand ?? null;
  const comparatorCalibration = parsedCoverage?.comparatorCalibration ?? storedAggregate?.comparatorCalibration ?? null;
  const diagnosticComparatorCalibration =
    parsedCoverage?.diagnosticComparatorCalibration ??
    storedAggregate?.diagnosticComparatorCalibration ??
    null;
  const calibratedScore =
    typeof parsedCoverage?.calibratedScore === 'number'
      ? parsedCoverage.calibratedScore
      : typeof diagnosticComparatorCalibration?.calibratedScore === 'number'
        ? diagnosticComparatorCalibration.calibratedScore
        : null;
  const comparatorCalibratedFinalScoreBand = calibratedScore != null
    ? { low: calibratedScore, median: calibratedScore, high: calibratedScore }
    : parsedCoverage?.comparatorCalibratedFinalScoreBand
      ?? comparatorCalibration?.finalPublicScoreBand
      ?? aggregateScoreBand
      ?? null;
  const calibrationAdjustment = typeof comparatorCalibration?.calibrationAdjustment === 'number'
    ? comparatorCalibration.calibrationAdjustment
    : null;
  const calibrationRationale =
    parsedCoverage?.calibrationRationale ??
    diagnosticComparatorCalibration?.calibrationRationale ??
    comparatorCalibration?.calibrationRationale ??
    '';
  const diagnosticChanges =
    Array.isArray(parsedCoverage?.diagnosticChanges)
      ? parsedCoverage.diagnosticChanges
      : Array.isArray(diagnosticComparatorCalibration?.diagnosticChanges)
        ? diagnosticComparatorCalibration.diagnosticChanges
        : [];
  const scoreGapAssessment = comparatorCalibration?.scoreGapAssessment ?? '';
  const comparatorCalibrationStatus =
    parsedCoverage?.comparatorCalibrationStatus ??
    diagnosticComparatorCalibration?.comparatorCalibrationStatus ??
    comparatorCalibration?.comparatorCalibrationStatus ??
    (calibratedScore != null ? 'applied' : 'unavailable');
  const calibrationMode =
    parsedCoverage?.calibrationMode ??
    diagnosticComparatorCalibration?.calibrationMode ??
    (calibratedScore != null ? 'target_only' : 'none');
  const calibrationVersion =
    parsedCoverage?.calibrationVersion ??
    diagnosticComparatorCalibration?.calibrationVersion ??
    null;
  const comparatorCalibrationApplied =
    (comparatorCalibrationStatus === 'applied' ||
      comparatorCalibrationStatus === 'weak') &&
    calibratedScore != null;
  const explanatoryDeltaAssessment = comparatorCalibrationApplied
    ? parsedCoverage?.explanatoryDeltaAssessment ??
      comparatorCalibration?.explanatoryDeltaAssessment ??
      null
    : null;
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
  const storedScoreStability =
    (review as any).scoreStability ||
    (review as any).reviewPassComparison?.scoreStability ||
    (review as any).adjudication?.scoreStability ||
    parsedCoverage?.reviewPassComparison?.scoreStability ||
    parsedCoverage?.adjudication?.scoreStability ||
    parsedCoverage?.coverageLedger?.reviewPassComparison?.scoreStability ||
    parsedCoverage?.coverageLedger?.adjudication?.scoreStability ||
    aggregateAdjudication?.scoreStability ||
    storedAggregate?.scoreStability ||
    parsedCoverage?.scoreStability ||
    null;
  const selectedPass = activeTab === 'combined' ? null : storedIndividualReviews[activeTab] ?? null;
  const passScoreBands = storedIndividualReviews.map((pass: any) =>
    normalizeDisplayedBand(
      pass.scoreBand?.low ?? pass.intrinsicScore ?? pass.score,
      pass.scoreBand?.median ?? pass.intrinsicScore ?? pass.score,
      pass.scoreBand?.high ?? pass.intrinsicScore ?? pass.score,
      pass.bestClassification,
    )
  );
  const blindPassScores = getBlindPassScores({
    review,
    parsedCoverage,
    aggregateAdjudication,
    storedIndividualReviews,
  });
  const combinedBand = normalizeDisplayedBand(
    comparatorCalibratedFinalScoreBand?.low ?? parsedCoverage?.finalScore ?? parsedCoverage?.intrinsicScore ?? review.scoreBandLow ?? review.overallIntrinsicScore ?? review.score,
    comparatorCalibratedFinalScoreBand?.median ?? parsedCoverage?.finalScore ?? parsedCoverage?.intrinsicScore ?? review.scoreBandMedian ?? review.overallIntrinsicScore ?? review.score,
    comparatorCalibratedFinalScoreBand?.high ?? parsedCoverage?.finalScore ?? parsedCoverage?.intrinsicScore ?? review.scoreBandHigh ?? review.overallIntrinsicScore ?? review.score,
    aggregateClassification ?? review.bestClassification,
  );
  const finalScore = combinedBand.median;
  const selectedPassScore = selectedPass
    ? Math.round(Number(selectedPass.intrinsicScore ?? selectedPass.score ?? selectedPass.scoreBand?.median ?? finalScore))
    : finalScore;
  const displayedScore = Number.isFinite(selectedPassScore) ? selectedPassScore : finalScore;
  const displayedScoreLabel = selectedPass ? `Blind Pass ${(activeTab as number) + 1}` : 'Final Score';
  const computedPassDisagreement = blindPassScores.length >= 2
    ? Math.max(...blindPassScores) - Math.min(...blindPassScores)
    : null;
  const computedStability = computedPassDisagreement == null
    ? 'insufficient data'
    : computedPassDisagreement <= 5
      ? 'high'
      : computedPassDisagreement <= 10
        ? 'medium'
        : 'low';
  const scoreSpread = computedPassDisagreement;
  const scoreStability = selectedPass ? storedScoreStability : (storedScoreStability || computedStability);
  const spreadText = scoreSpread == null
    ? 'Insufficient data'
    : `${scoreSpread} ${scoreSpread === 1 ? 'point' : 'points'}`;
  const adjustmentLabel = comparatorCalibrationApplied
    ? 'diagnostics calibrated'
    : 'not applied';
  const scorePathCaption = comparatorCalibrationApplied
    ? 'Comparator-calibrated score computed from calibrated Input / Construction / Output diagnostics.'
    : 'Comparator calibration not yet run.';
  const showCalibrationAdjustment =
    comparatorCalibrationApplied ||
    (calibrationAdjustment != null && calibrationAdjustment !== 0);
  const scoreCappingReason =
    parsedCoverage?.scoreCappingReason ??
    storedAggregate?.scoreCappingReason ??
    comparatorCalibration?.scoreCappingReason ??
    '';
  const diagnosticBaselineDelta =
    parsedCoverage?.diagnosticBaselineDelta ??
    aggregateAdjudication?.diagnosticBaselineDelta ??
    storedAggregate?.diagnosticBaselineDelta ??
    null;
  const scoreAdjustmentReason =
    parsedCoverage?.scoreAdjustmentReason ??
    aggregateAdjudication?.scoreAdjustmentReason ??
    storedAggregate?.scoreAdjustmentReason ??
    '';
  const shouldShowScoreAdjustmentReason =
    hasText(scoreAdjustmentReason) ||
    (typeof diagnosticBaselineDelta === 'number' && Math.abs(diagnosticBaselineDelta) > 8);
  const canonicalFailureAnalysis =
    parsedCoverage?.failureAnalysis ??
    storedAggregate?.failureAnalysis ??
    {};
  const failedClaimsExcludedFromScore = canonicalFailureAnalysis?.failedClaimsExcludedFromScore
    ?? parsedCoverage?.failedClaimsExcludedFromScore
    ?? aggregateAdjudication?.failedClaimsExcludedFromScore
    ?? storedAggregate?.failedClaimsExcludedFromScore
    ?? [];
  const failedConstructionsExcludedFromScore = canonicalFailureAnalysis?.failedConstructionsExcludedFromScore
    ?? parsedCoverage?.failedConstructionsExcludedFromScore
    ?? aggregateAdjudication?.failedConstructionsExcludedFromScore
    ?? storedAggregate?.failedConstructionsExcludedFromScore
    ?? [];
  const failedOutputsExcludedFromScore = canonicalFailureAnalysis?.failedOutputsExcludedFromScore
    ?? parsedCoverage?.failedOutputsExcludedFromScore
    ?? aggregateAdjudication?.failedOutputsExcludedFromScore
    ?? storedAggregate?.failedOutputsExcludedFromScore
    ?? [];
  const rawSurvivingCorrectContributions = canonicalFailureAnalysis?.survivingCorrectContributions
    ?? parsedCoverage?.survivingCorrectContributions
    ?? aggregateAdjudication?.survivingCorrectContributions
    ?? storedAggregate?.survivingCorrectContributions
    ?? canonicalFailureAnalysis?.survivingHighValueContributions
    ?? parsedCoverage?.survivingHighValueContributions
    ?? aggregateAdjudication?.survivingHighValueContributions
    ?? storedAggregate?.survivingHighValueContributions
    ?? [];
  const survivingCorrectContributionLines = asArray(rawSurvivingCorrectContributions).map((item: any) => {
    if (typeof item === 'string') return item;
    const contribution = item?.contribution || item?.claimOrContribution || item?.description || '';
    const valueLevel = item?.valueLevel ? ` (${String(item.valueLevel).replace(/_/g, ' ')})` : '';
    const relevance = item?.scoreRelevance ? `: ${item.scoreRelevance}` : '';
    return `${contribution}${valueLevel}${relevance}`.trim();
  }).filter(Boolean);
  const scoreBasisAfterExcludingFailures = canonicalFailureAnalysis?.scoreBasisAfterExcludingFailures
    ?? parsedCoverage?.scoreBasisAfterExcludingFailures
    ?? aggregateAdjudication?.scoreBasisAfterExcludingFailures
    ?? storedAggregate?.scoreBasisAfterExcludingFailures
    ?? canonicalFailureAnalysis?.survivingContributionScoreBasis
    ?? parsedCoverage?.survivingContributionScoreBasis
    ?? aggregateAdjudication?.survivingContributionScoreBasis
    ?? storedAggregate?.survivingContributionScoreBasis
    ?? '';
  const overallCorrectnessSummary = canonicalFailureAnalysis?.overallCorrectnessSummary
    ?? parsedCoverage?.overallCorrectnessSummary
    ?? aggregateAdjudication?.overallCorrectnessSummary
    ?? storedAggregate?.overallCorrectnessSummary
    ?? '';
  const promptVersion = parsedCoverage?.promptVersion ?? storedAggregate?.promptVersion ?? '';
  const isV15Review = parsedCoverage?.schemaVersion === 'v15' || /^v15(?:\.|\b|-)/.test(String(promptVersion));
  const isCanonicalIcoReview = /^v16(?:\.|\b|-)/.test(String(parsedCoverage?.schemaVersion || '')) || /^v16(?:\.|\b|-)/.test(String(promptVersion));
  const benchmarkSetVersion = parsedCoverage?.benchmarkSetVersion ?? comparatorCalibration?.benchmarkSetVersion ?? '';
  const extractionMethod = parsedCoverage?.extractionMethod ?? '';
  const currentClassification = selectedPass?.bestClassification ?? aggregateClassification ?? review.bestClassification ?? 'Unclassified';
  const currentLocalCohort = selectedPass?.localCohort || selectedPass?.comparisonCohort || selectedPass?.broadField || localCohort;
  const currentSummary = selectedPass?.summary || storedAggregate?.finalSummary || review.summary;
  const currentVerdict = selectedPass?.oneParagraphVerdict || selectedPass?.finalJudgment || aggregateVerdict;
  const generatedScientificReview =
    selectedPass?.scientificReview ||
    storedAggregate?.scientificReview ||
    parsedCoverage?.scientificReview ||
    parsedCoverage?.finalIntrinsicReview?.scientificReview ||
    (review as any).scientificReview;
  const scientificReviewText = hasText(generatedScientificReview)
    ? generatedScientificReview
    : mergeUniqueText(currentVerdict, currentSummary);
  const currentCentralClaim = selectedPass?.centralClaim || review.centralClaim;
  const currentDirectTargets = selectedPass?.coverageLedger?.directTargets ?? directTargets;
  const currentImportedInputs = selectedPass?.coverageLedger?.importedInputs ?? importedInputs;
  const currentTheorySpaceVariants = selectedPass?.coverageLedger?.theorySpaceVariants ?? theorySpaceVariants;
  const currentMechanismSharingAssessment = selectedPass?.coverageLedger?.mechanismSharingAssessment ?? mechanismSharingAssessment;
  const currentInputConstructionOutputLedger =
    selectedPass?.inputConstructionOutputAssessment ??
    selectedPass?.inputConstructionOutputLedger ??
    inputConstructionOutputLedger;
  const currentPrimitiveInputDetails = asPrimitiveInputDetails(currentInputConstructionOutputLedger);
  const currentIntroducedConstructionDetails = asIntroducedConstructionDetails(currentInputConstructionOutputLedger);
  const currentPrimitiveInputs = currentPrimitiveInputDetails.map((item) => item.input);
  const currentIntroducedConstructions = currentIntroducedConstructionDetails.map((item) => item.construction);
  const currentLedgerOutputs = asLedgerOutputs(currentInputConstructionOutputLedger);
  const currentWhyOutputsMatter =
    currentInputConstructionOutputLedger?.output?.whyOutputsMatter ??
    currentInputConstructionOutputLedger?.whyOutputsMatter ??
    '';
  const currentInputConstructionOutputAssessment =
    currentInputConstructionOutputLedger?.output?.overallAssessment ??
    currentInputConstructionOutputLedger?.output?.assessment ??
    currentInputConstructionOutputLedger?.outputOverallAssessment ??
    currentInputConstructionOutputLedger?.assessment ??
    '';
  const hasIcoLedger = Boolean(
    currentPrimitiveInputs.length ||
    currentIntroducedConstructions.length ||
    currentLedgerOutputs.length ||
    currentWhyOutputsMatter ||
    currentInputConstructionOutputAssessment
  );
  const currentInputGrounding =
    selectedPass?.inputConstructionOutputAssessment?.input?.overallAssessment ||
    selectedPass?.inputConstructionOutputAssessment?.input?.assessment ||
    currentInputConstructionOutputLedger?.input?.overallAssessment ||
    currentInputConstructionOutputLedger?.input?.assessment ||
    currentInputConstructionOutputLedger?.inputOverallAssessment ||
    selectedPass?.inputGrounding ||
    inputGrounding;
  const currentInputFundamentality = selectedPass?.inputFundamentality || inputFundamentality;
  const currentConstructionAssessment =
    selectedPass?.inputConstructionOutputAssessment?.construction?.overallAssessment ||
    selectedPass?.inputConstructionOutputAssessment?.construction?.assessment ||
    currentInputConstructionOutputLedger?.construction?.overallAssessment ||
    currentInputConstructionOutputLedger?.construction?.assessment ||
    currentInputConstructionOutputLedger?.constructionOverallAssessment ||
    selectedPass?.constructionAssessment
    || parsedCoverage?.constructionAssessment
    || storedAggregate?.constructionAssessment
    || '';
  const selectedTechnicalAssessment = selectedPass?.technicalAssessment ?? {};
  const aggregateTechnicalAssessment = parsedCoverage?.technicalAssessment ?? storedAggregate?.technicalAssessment ?? {};
  const currentCorrectness = selectedTechnicalAssessment?.correctness || aggregateTechnicalAssessment?.correctness || selectedPass?.correctness || review.correctness;
  const currentStrongestCase =
    selectedTechnicalAssessment?.strongestCaseForImportance ||
    selectedTechnicalAssessment?.strongestCase ||
    aggregateTechnicalAssessment?.strongestCaseForImportance ||
    aggregateTechnicalAssessment?.strongestCase ||
    selectedPass?.strongestCaseForImportance ||
    review.strongestCaseForImportance;
  const currentStrongestObjection =
    selectedTechnicalAssessment?.strongestObjection ||
    aggregateTechnicalAssessment?.strongestObjection ||
    selectedPass?.strongestObjection ||
    review.strongestObjection;
  const currentAssessmentSensitivity =
    selectedTechnicalAssessment?.assessmentSensitivity ||
    aggregateTechnicalAssessment?.assessmentSensitivity ||
    selectedPass?.assessmentSensitivity ||
    parsedCoverage?.assessmentSensitivity ||
    storedAggregate?.assessmentSensitivity ||
    review.assessmentSensitivity ||
    '';
  const selectedFrameworkDependence = selectedTechnicalAssessment?.frameworkDependence ?? aggregateTechnicalAssessment?.frameworkDependence ?? selectedPass?.frameworkConditionality ?? {};
  const currentFrameworkConditionality = selectedFrameworkDependence?.explanation
    || (review as any).frameworkConditionalityExplanation
    || storedAggregate?.frameworkConditionalityAssessment
    || parsedCoverage?.frameworkConditionalityAssessment
    || '';
  const currentFrameworkIndependence = selectedPass?.frameworkIndependence
    || parsedCoverage?.frameworkIndependence
    || storedAggregate?.frameworkIndependenceAssessment
    || '';
  const currentHardToVaryAssessment = selectedTechnicalAssessment?.hardToVaryAssessment
    || aggregateTechnicalAssessment?.hardToVaryAssessment
    || selectedPass?.hardToVaryAssessment
    || parsedCoverage?.hardToVaryAssessment
    || storedAggregate?.hardToVaryAssessment
    || '';
  const currentEstablishedResults = isCanonicalIcoReview ? '' : listMarkdown(selectedPass?.establishedResults) || review.establishedResults || listMarkdown(storedAggregate?.establishedResults);
  const currentInterpretiveClaims = isCanonicalIcoReview ? '' : listMarkdown(selectedPass?.interpretiveClaims) || review.interpretiveClaims || listMarkdown(storedAggregate?.interpretiveClaims);
  const currentSpeculativeClaims = isCanonicalIcoReview ? '' : listMarkdown(selectedPass?.speculativeClaims) || review.speculativeClaims || listMarkdown(storedAggregate?.speculativeClaims);
  const currentWhatWouldRaiseScore = selectedTechnicalAssessment?.whatWouldRaiseScore || aggregateTechnicalAssessment?.whatWouldRaiseScore || selectedPass?.whatWouldRaiseScore || parsedCoverage?.whatWouldRaiseScore || storedAggregate?.whatWouldRaiseScore || '';
  const currentWhatWouldLowerScore = selectedTechnicalAssessment?.whatWouldLowerScore || aggregateTechnicalAssessment?.whatWouldLowerScore || selectedPass?.whatWouldLowerScore || parsedCoverage?.whatWouldLowerScore || storedAggregate?.whatWouldLowerScore || '';
  const hasOptionalDetails = [
    currentEstablishedResults,
    currentInterpretiveClaims,
    currentSpeculativeClaims,
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
  const currentSubscoreRationale =
    selectedPass?.subscoreRationale ??
    storedAggregate?.subscoreRationale ??
    parsedCoverage?.subscoreRationale ??
    {};
  const subscoreIsValid = (key: string, legacyKey: string) =>
    (selectedSubscoreValidity as any)?.[key] ?? (selectedSubscoreValidity as any)?.[legacyKey] ?? true;
  const currentInputStrengthScore = validSubscore(
    selectedPass?.inputStrengthScore ?? storedAggregate?.inputStrengthScore ?? parsedCoverage?.inputStrengthScore ?? review.inputStrengthScore ?? (isV15Review ? undefined : review.intrinsicScientificMeritScore),
    isV15Review || subscoreIsValid('inputStrengthScore', 'intrinsicTechnicalScore') !== false,
  );
  const currentConstructionStrengthScore = validSubscore(
    selectedPass?.constructionStrengthScore ?? storedAggregate?.constructionStrengthScore ?? parsedCoverage?.constructionStrengthScore ?? review.constructionStrengthScore ?? (isV15Review ? undefined : review.explanatoryTargetBreadthScore),
    isV15Review || subscoreIsValid('constructionStrengthScore', 'explanatoryTargetBreadthScore') !== false,
  );
  const currentOutputStrengthScore = validSubscore(
    selectedPass?.outputStrengthScore ?? storedAggregate?.outputStrengthScore ?? parsedCoverage?.outputStrengthScore ?? review.outputStrengthScore ?? (
      isV15Review
        ? undefined
        : selectedPass?.outputReachScore ?? storedAggregate?.outputReachScore ?? parsedCoverage?.outputReachScore ?? review.outputReachScore ?? review.theorySpaceBreadthScore
    ),
    isV15Review || subscoreIsValid('outputStrengthScore', 'outputReachScore') !== false,
  );
  const stabilityLabel = String(scoreStability || computedStability || 'insufficient data').replace(/_/g, ' ');
  const stabilityDisplay = scoreSpread == null
    ? 'Insufficient data'
    : `${stabilityLabel.charAt(0).toUpperCase()}${stabilityLabel.slice(1)} · ${spreadText} spread`;
  const frameworkDependenceLevel =
    selectedFrameworkDependence?.level ??
    storedAggregate?.frameworkConditionality?.level ??
    parsedCoverage?.frameworkConditionality?.level ??
    '';
  const frameworkDependenceText = mergeUniqueText(
    currentFrameworkConditionality,
    currentFrameworkIndependence,
  );
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
  const diagnosticCards = [
    {
      id: 'input' as const,
      label: 'Input Strength',
      value: currentInputStrengthScore,
      rationale: firstSentence(currentSubscoreRationale?.inputStrengthScore),
      color: currentInputStrengthScore == null ? 'text-slate-200' : currentInputStrengthScore >= 8 ? 'text-emerald-200' : currentInputStrengthScore >= 5 ? 'text-amber-200' : 'text-rose-200',
    },
    {
      id: 'construction' as const,
      label: 'Construction Strength',
      value: currentConstructionStrengthScore,
      rationale: firstSentence(currentSubscoreRationale?.constructionStrengthScore),
      color: currentConstructionStrengthScore == null ? 'text-slate-200' : currentConstructionStrengthScore >= 8 ? 'text-emerald-200' : currentConstructionStrengthScore >= 5 ? 'text-amber-200' : 'text-rose-200',
    },
    {
      id: 'output' as const,
      label: 'Output Strength',
      value: currentOutputStrengthScore,
      rationale: firstSentence(currentSubscoreRationale?.outputStrengthScore),
      color: currentOutputStrengthScore == null ? 'text-slate-200' : currentOutputStrengthScore >= 8 ? 'text-emerald-200' : currentOutputStrengthScore >= 5 ? 'text-amber-200' : 'text-rose-200',
    },
  ];
  const technicalAssessmentBoxes = [
    { label: 'Correctness', value: currentCorrectness, color: 'text-emerald-400', icon: <CheckCircle2 className="w-4 h-4" /> },
    {
      label: frameworkDependenceLevel ? `Framework Dependence: ${String(frameworkDependenceLevel).replace(/_/g, ' ')}` : 'Framework Dependence',
      value: frameworkDependenceText,
      color: levelTone(frameworkDependenceLevel, true) === 'green'
        ? 'text-emerald-400'
        : levelTone(frameworkDependenceLevel, true) === 'red'
          ? 'text-rose-400'
          : 'text-amber-400',
      icon: <GitBranch className="w-4 h-4" />,
    },
    { label: 'Hard-to-Vary Assessment', value: currentHardToVaryAssessment, color: 'text-orange-300', icon: <Shield className="w-4 h-4" /> },
    { label: 'Strongest Case', value: currentStrongestCase, color: 'text-green-400', icon: <TrendingUp className="w-4 h-4" /> },
    { label: 'Strongest Objection', value: currentStrongestObjection, color: 'text-rose-400', icon: <AlertTriangle className="w-4 h-4" /> },
    { label: 'Assessment Sensitivity', value: currentAssessmentSensitivity, color: 'text-yellow-400', icon: <Microscope className="w-4 h-4" /> },
    { label: 'What Would Raise Score', value: currentWhatWouldRaiseScore, color: 'text-green-300', icon: <TrendingUp className="w-4 h-4" /> },
    { label: 'What Would Lower Score', value: currentWhatWouldLowerScore, color: 'text-rose-300', icon: <AlertTriangle className="w-4 h-4" /> },
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
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div className="space-y-2">
                <p className="text-[10px] font-black text-indigo-300 uppercase tracking-widest">{displayedScoreLabel}</p>
                <div className="flex flex-wrap items-end gap-4">
                  <p className="text-6xl font-black text-emerald-200 leading-none">{displayedScore}</p>
                  <div className="pb-1">
                    <p className="text-lg font-black text-white capitalize">{currentClassification}</p>
                    <p className="text-xs text-slate-400">{currentLocalCohort || 'Comparison cohort not specified'}</p>
                    {canonicalClusterLabel && (
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">
                        Cluster: {canonicalClusterLabel}
                      </p>
                    )}
                  </div>
                </div>
              </div>
              {adjudicatorFallbackActive && (
                <div className="bg-rose-500/10 border border-rose-300/25 rounded-xl px-4 py-3 max-w-sm">
                  <p className="text-[10px] font-black text-rose-200 uppercase tracking-widest">Adjudicator failed</p>
                  <p className="text-sm text-rose-50 mt-1">Fallback from blind passes.</p>
                </div>
              )}
            </div>

            <div className="border-t border-white/10 pt-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest">Review Views</p>
                <p className="text-xs font-bold text-slate-300">Review Stability: {stabilityDisplay}</p>
              </div>
              <div className="flex flex-wrap gap-2 pt-1" role="tablist" aria-label="Review detail views">
                <button
                  role="tab"
                  aria-selected={activeTab === 'combined'}
                  onClick={() => setActiveTab('combined')}
                  className={`rounded-xl border px-4 py-2 text-xs font-black uppercase tracking-widest transition-all ${
                    activeTab === 'combined'
                      ? 'border-white bg-emerald-400/20 text-white ring-2 ring-white/50'
                      : 'border-white/15 bg-white/5 text-slate-300 hover:border-white/40 hover:text-white'
                  }`}
                >
                  Final Review
                </button>
                {blindPassScores.map((score: number, index: number) => {
                  const hasPassDetails = Boolean(storedIndividualReviews[index]);
                  return (
                    <button
                      key={`pass-tab-${index}`}
                      role="tab"
                      aria-selected={activeTab === index}
                      onClick={() => hasPassDetails && setActiveTab(index)}
                      disabled={!hasPassDetails}
                      title={hasPassDetails ? `Show blind pass ${index + 1}` : 'Blind pass review text was not stored for this paper.'}
                      className={`rounded-xl border px-4 py-2 text-xs font-black uppercase tracking-widest transition-all ${
                        activeTab === index
                          ? 'border-white bg-fuchsia-400/25 text-white ring-2 ring-white/50'
                          : hasPassDetails
                            ? 'border-white/15 bg-white/5 text-slate-300 hover:border-white/40 hover:text-white'
                            : 'cursor-not-allowed border-white/10 bg-white/[0.02] text-slate-600'
                      }`}
                    >
                      Blind Pass {index + 1}: {score}
                    </button>
                  );
                })}
              </div>
              {blindPassScores.length > 0 && storedIndividualReviews.length === 0 && (
                <p className="text-xs text-slate-500">Only blind pass scores were stored for this older review.</p>
              )}
              <div className="flex flex-wrap gap-3 text-xs text-slate-400">
                {!comparatorCalibrationApplied && <span>{scorePathCaption}</span>}
                {showCalibrationAdjustment && (
                  <span>{comparatorCalibrationApplied ? 'Comparator diagnostics calibrated' : `Calibration adjustment: ${adjustmentLabel}`}</span>
                )}
              </div>
            </div>
          </div>

          <div
            className="relative rounded-3xl border border-white/45 bg-white/[0.03] p-4 space-y-8 shadow-[0_20px_70px_rgba(15,23,42,0.35)]"
            role="tabpanel"
          >
          {selectedPass && (
            <div className="bg-slate-950/30 border border-white/10 rounded-2xl p-5 space-y-2">
              <h3 className="text-xs font-black text-fuchsia-300 uppercase tracking-widest">Blind Pass {(activeTab as number) + 1}</h3>
              <p className="text-sm text-slate-300">
                Showing the rendered details from independent blind review pass {(activeTab as number) + 1}.
              </p>
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

          {currentCentralClaim && (
            <Section icon={<Target className="w-4 h-4" />} label="Central Claim" color="text-sky-400">
              <Markdown>{currentCentralClaim}</Markdown>
            </Section>
          )}

          {scientificReviewText && (
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-3">
              <h3 className="text-xs font-black text-emerald-300 uppercase tracking-widest flex items-center gap-2">
                <Award className="w-4 h-4" /> {selectedPass ? 'Pass Review' : 'Scientific Review'}
              </h3>
              <Markdown>{scientificReviewText}</Markdown>
              {submittedAtLabel && (
                <p className="pt-3 border-t border-white/10 text-[11px] font-bold uppercase tracking-widest text-slate-400">
                  Submitted {submittedAtLabel}
                </p>
              )}
            </div>
          )}

          {hasIcoLedger && (
            <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-4">
              <h3 className="text-xs font-black text-indigo-300 uppercase tracking-widest flex items-center gap-2">
                <BrainCircuit className="w-4 h-4" /> Input → Construction → Output Assessment
              </h3>
              <div className="space-y-3">
                <div className="grid items-stretch gap-3 md:grid-cols-3">
                  {diagnosticCards.map((card) => {
                    const active = activeIcoTab === card.id;
                    return (
                      <button
                        key={card.label}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => setActiveIcoTab(card.id)}
                        className={`h-full rounded-2xl border p-4 text-left transition-all ${active ? ICO_TAB_THEME.activeCard : ICO_TAB_THEME.inactiveCard}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest">{card.label}</p>
                          <p className={`text-2xl font-black ${card.color}`}>
                            {card.value == null ? 'N/A' : card.value}
                            {card.value != null && <span className="text-sm font-bold text-slate-400">/10</span>}
                          </p>
                        </div>
                        {card.rationale && <div className="mt-3 text-xs leading-relaxed text-slate-300"><Markdown>{card.rationale}</Markdown></div>}
                      </button>
                    );
                  })}
                </div>
                <div className={`rounded-2xl border p-4 ${ICO_TAB_THEME.panel}`}>
                {activeIcoTab === 'input' && <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs font-black text-indigo-300 uppercase tracking-widest">Input Strength</p>
                    <p className={`rounded-xl border px-3 py-1 text-2xl font-black ${scoreToneClass(currentInputStrengthScore)}`}>
                      {currentInputStrengthScore == null ? 'N/A' : currentInputStrengthScore}
                      {currentInputStrengthScore != null && <span className="text-sm font-bold text-indigo-300/70">/10</span>}
                    </p>
                  </div>
                  {currentPrimitiveInputs.length > 0 && (
                    <div>
                      <p className="text-[10px] font-black text-indigo-300 uppercase tracking-widest mb-2">Primitive Inputs</p>
                      <div className="space-y-3">
                        {currentPrimitiveInputDetails.map((item, index) => {
                          return (
                            <div key={`${item.input}-${index}`} className="bg-indigo-300/[0.045] border border-indigo-300/15 rounded-xl p-4 space-y-3">
                              <div className="flex items-start gap-3">
                                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-indigo-300/30 bg-indigo-300/10 text-[10px] font-black text-indigo-100">
                                  {index + 1}
                                </span>
                                <div className="min-w-0 flex-1 space-y-1">
                                  <Markdown>{item.input}</Markdown>
                                  {item.role && <Markdown>{item.role}</Markdown>}
                                </div>
                              </div>
                              <div className="space-y-1">
                                {(item.grounding || item.groundingQuality) && qualityLine('Grounding', item.grounding || item.groundingQuality, groundingTone(item.groundingQuality || item.grounding))}
                                {(item.fundamentalityLevel || item.fundamentality) && qualityLine('Fundamentality', item.fundamentalityLevel || item.fundamentality, levelTone(item.fundamentalityLevel || item.fundamentality))}
                                {(item.frameworkDependenceLevel || item.frameworkDependence) && qualityLine('Framework Dependence', item.frameworkDependenceLevel || item.frameworkDependence, levelTone(item.frameworkDependenceLevel || item.frameworkDependence, true))}
                              </div>
                              {item.assessment && (
                                <div className="border-t border-white/10 pt-3">
                                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Assessment</p>
                                  <Markdown>{formatAssessmentMarkdown(item.assessment)}</Markdown>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>}

                {activeIcoTab === 'construction' && <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs font-black text-indigo-300 uppercase tracking-widest">Construction Strength</p>
                    <p className={`rounded-xl border px-3 py-1 text-2xl font-black ${scoreToneClass(currentConstructionStrengthScore)}`}>
                      {currentConstructionStrengthScore == null ? 'N/A' : currentConstructionStrengthScore}
                      {currentConstructionStrengthScore != null && <span className="text-sm font-bold text-indigo-300/70">/10</span>}
                    </p>
                  </div>
                  {currentIntroducedConstructions.length > 0 && (
                    <div>
                      <p className="text-[10px] font-black text-indigo-300 uppercase tracking-widest mb-2">Introduced Constructions</p>
                      <div className="grid gap-3 lg:grid-cols-2">
                        {currentIntroducedConstructionDetails.map((item, index) => {
                          return (
                            <div key={`${item.construction}-${index}`} className="bg-white/5 border border-indigo-300/15 rounded-xl p-4 space-y-3">
                              <div className="flex items-start gap-3">
                                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-indigo-300/30 bg-indigo-300/10 text-[10px] font-black text-indigo-100">
                                  {index + 1}
                                </span>
                                <div className="min-w-0 flex-1 space-y-1">
                                  <Markdown>{item.construction}</Markdown>
                                  {item.role && <Markdown>{item.role}</Markdown>}
                                </div>
                              </div>
                              <div className="space-y-1">
                                {(item.validity || item.validityLevel) && qualityLine('Validity', item.validity || item.validityLevel, validityTone(item.validityLevel || item.validity).tone)}
                                {(item.hardToVaryLevel || item.hardToVary) && qualityLine('Hard to Vary', item.hardToVaryLevel || item.hardToVary, hardToVaryTone(item.hardToVaryLevel || item.hardToVary))}
                                {(item.fragilityLevel || item.fragilityOrLimits) && qualityLine('Fragility / Limits', item.fragilityLevel || item.fragilityOrLimits, fragilityTone(item.fragilityLevel || item.fragilityOrLimits))}
                              </div>
                              {(item.inputsUsed.length > 0 || item.assessment) && (
                                <div className="space-y-3 border-t border-white/10 pt-3">
                                  {item.inputsUsed.length > 0 && <div><p className="text-[9px] font-black text-indigo-300 uppercase tracking-widest mb-1">Inputs Used</p><Markdown>{listMarkdown(item.inputsUsed)}</Markdown></div>}
                                  {item.assessment && <div><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Assessment</p><Markdown>{formatAssessmentMarkdown(item.assessment)}</Markdown></div>}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>}

                {activeIcoTab === 'output' && <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs font-black text-indigo-300 uppercase tracking-widest">Output Strength</p>
                    <p className={`rounded-xl border px-3 py-1 text-2xl font-black ${scoreToneClass(currentOutputStrengthScore)}`}>
                      {currentOutputStrengthScore == null ? 'N/A' : currentOutputStrengthScore}
                      {currentOutputStrengthScore != null && <span className="text-sm font-bold text-indigo-300/70">/10</span>}
                    </p>
                  </div>
                  {currentLedgerOutputs.length > 0 && (
                    <div className="space-y-3">
                      <p className="text-[10px] font-black text-indigo-300 uppercase tracking-widest">Outputs</p>
                      <div className="grid gap-3 lg:grid-cols-2">
                      {currentLedgerOutputs.map((item: any, i: number) => {
                        const outputAssessment = item.assessment;
                        const validityLabel = item.validityLevel || item.validity;
                        const tone = validityTone(validityLabel || outputAssessment || item.support);
                        const assessmentLabel = item.validityLevel || (tone.label === 'Validity' ? 'Review' : tone.label);
                        const assessmentBody = outputAssessment || item.validity || item.support;
                        const supportAddsDetail = addsNewInformation(item.support, outputAssessment);
                        const hasExpandedOutputDetails = item.dependsOnInputs.length > 0
                          || item.dependsOnConstructions.length > 0
                          || item.externalContextIfAny
                          || supportAddsDetail;
                        return (
                          <details key={`${item.output}-${i}`} className="group rounded-xl border border-indigo-300/15 bg-indigo-300/[0.045] p-4">
                            <summary className="cursor-pointer list-none space-y-2">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 flex flex-1 items-start gap-3">
                                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-indigo-300/30 bg-indigo-300/10 text-[10px] font-black text-indigo-100">
                                    {i + 1}
                                  </span>
                                  <div className="min-w-0 flex-1">
                                    <Markdown>{item.output}</Markdown>
                                  </div>
                                </div>
                                {item.centrality && (
                                  <span className="shrink-0 text-[9px] font-black uppercase tracking-widest text-indigo-100 bg-indigo-400/15 border border-indigo-300/20 rounded-full px-2 py-1">
                                    {item.centrality}
                                  </span>
                                )}
                              </div>
                              <div className="space-y-1">
                                {(assessmentLabel || assessmentBody) && (
                                  qualityLine('Assessment', assessmentLabel, tone.tone)
                                )}
                              </div>
                              {assessmentBody && (
                                <Markdown>{formatAssessmentMarkdown(assessmentBody)}</Markdown>
                              )}
                              {hasExpandedOutputDetails && (
                                <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500 group-open:hidden">
                                  Click for inputs, constructions, and support
                                </div>
                              )}
                            </summary>
                            {hasExpandedOutputDetails && <div className="mt-3 space-y-3 pt-2">
                              {item.dependsOnInputs.length > 0 && (
                                <div>
                                  <p className="mb-1 text-xs font-black uppercase tracking-widest text-indigo-300">Inputs Used</p>
                                  <Markdown>{listMarkdown(item.dependsOnInputs)}</Markdown>
                                </div>
                              )}
                              {item.dependsOnConstructions.length > 0 && (
                                <div>
                                  <p className="mb-1 text-xs font-black uppercase tracking-widest text-indigo-300">Constructions Used</p>
                                  <Markdown>{listMarkdown(item.dependsOnConstructions)}</Markdown>
                                </div>
                              )}
                              {item.externalContextIfAny && (
                                <div>
                                  <p className="mb-1 text-xs font-black uppercase tracking-widest text-sky-300">External Context</p>
                                  <Markdown>{item.externalContextIfAny}</Markdown>
                                </div>
                              )}
                              {supportAddsDetail && (
                                <div>
                                  <p className="mb-1 text-xs font-black uppercase tracking-widest text-slate-300">Support</p>
                                  <Markdown>{item.support}</Markdown>
                                </div>
                              )}
                            </div>}
                          </details>
                        );
                      })}
                      </div>
                    </div>
                  )}
                </div>}
                </div>
              </div>
            </div>
          )}

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
                  <p className="text-[10px] font-black text-emerald-300 uppercase tracking-widest">Final Score</p>
                  <p className="text-sm font-black text-white mt-1">{finalScore}</p>
                </div>
                {comparatorCalibrationApplied && (
                  <div className="bg-slate-950/30 border border-white/10 rounded-xl p-3">
                    <p className="text-[10px] font-black text-sky-300 uppercase tracking-widest">Intrinsic Score</p>
                    <p className="text-sm font-black text-white mt-1">{parsedCoverage?.intrinsicScore ?? parsedCoverage?.computedScore ?? review.overallIntrinsicScore ?? review.score}</p>
                  </div>
                )}
                <div className="bg-slate-950/30 border border-white/10 rounded-xl p-3">
                  <p className="text-[10px] font-black text-fuchsia-300 uppercase tracking-widest">Blind Pass Scores</p>
                  <p className="text-sm font-black text-white mt-1">{blindPassScores.length ? blindPassScores.join(', ') : 'Not stored'}</p>
                </div>
                <div className="bg-slate-950/30 border border-white/10 rounded-xl p-3">
                  <p className="text-[10px] font-black text-indigo-300 uppercase tracking-widest">Blind-Pass Spread</p>
                  <p className="text-sm font-black text-white mt-1">{spreadText}</p>
                </div>
                <div className="bg-slate-950/30 border border-white/10 rounded-xl p-3">
                  <p className="text-[10px] font-black text-cyan-300 uppercase tracking-widest">Comparator Status</p>
                  <p className="text-sm font-black text-white mt-1 capitalize">{String(comparatorCalibrationStatus).replace(/_/g, ' ')}</p>
                  {calibrationMode && calibrationMode !== 'none' && (
                    <p className="text-[11px] font-bold text-slate-300 mt-1">
                      {String(calibrationMode).replace(/_/g, ' ')}
                      {calibrationVersion ? ` · ${calibrationVersion}` : ''}
                    </p>
                  )}
                </div>
                {(isAdmin || adjudicatorFallbackActive) && (
                  <div className={`bg-slate-950/30 border rounded-xl p-3 ${adjudicatorFallbackActive ? 'border-rose-300/30' : 'border-white/10'}`}>
                    <p className={`text-[10px] font-black uppercase tracking-widest ${adjudicatorFallbackActive ? 'text-rose-300' : 'text-emerald-300'}`}>Adjudicator Status</p>
                    <p className="text-sm font-black text-white mt-1 capitalize">
                      {adjudicatorFallbackActive ? 'Failed - fallback from blind passes' : String(adjudicatorStatus).replace(/_/g, ' ')}
                    </p>
                  </div>
                )}
              </div>

              {(scoreCappingReason || shouldShowScoreAdjustmentReason || asArray(failedClaimsExcludedFromScore).length > 0 || asArray(failedConstructionsExcludedFromScore).length > 0 || asArray(failedOutputsExcludedFromScore).length > 0 || survivingCorrectContributionLines.length > 0 || hasText(scoreBasisAfterExcludingFailures) || hasText(overallCorrectnessSummary) || (comparatorCalibrationApplied && (calibrationRationale || scoreGapAssessment || publicComparatorSummary))) && (
                <div className="space-y-3">
                  {asArray(failedClaimsExcludedFromScore).length > 0 && (
                    <Section icon={<AlertTriangle className="w-4 h-4" />} label="Failed Claim(s) Excluded From Score" color="text-rose-300">
                      <Markdown>{listMarkdown(failedClaimsExcludedFromScore)}</Markdown>
                    </Section>
                  )}
                  {asArray(failedConstructionsExcludedFromScore).length > 0 && (
                    <Section icon={<AlertTriangle className="w-4 h-4" />} label="Failed Construction(s) Excluded From Score" color="text-rose-300">
                      <Markdown>{listMarkdown(failedConstructionsExcludedFromScore)}</Markdown>
                    </Section>
                  )}
                  {asArray(failedOutputsExcludedFromScore).length > 0 && (
                    <Section icon={<AlertTriangle className="w-4 h-4" />} label="Failed Output(s) Excluded From Score" color="text-rose-300">
                      <Markdown>{listMarkdown(failedOutputsExcludedFromScore)}</Markdown>
                    </Section>
                  )}
                  {survivingCorrectContributionLines.length > 0 && (
                    <Section icon={<CheckCircle2 className="w-4 h-4" />} label="Surviving Correct Contribution(s)" color="text-emerald-300">
                      <Markdown>{listMarkdown(survivingCorrectContributionLines)}</Markdown>
                    </Section>
                  )}
                  {hasText(scoreBasisAfterExcludingFailures) && (
                    <Section icon={<Shield className="w-4 h-4" />} label="Score Basis After Excluding Failures" color="text-cyan-300">
                      <Markdown>{scoreBasisAfterExcludingFailures}</Markdown>
                    </Section>
                  )}
                  {hasText(overallCorrectnessSummary) && (
                    <Section icon={<Shield className="w-4 h-4" />} label="Overall Correctness Summary" color="text-cyan-300">
                      <Markdown>{overallCorrectnessSummary}</Markdown>
                    </Section>
                  )}
                  {scoreCappingReason && (
                    <Section icon={<AlertTriangle className="w-4 h-4" />} label="Score Capping Reason" color="text-amber-300">
                      <Markdown>{scoreCappingReason}</Markdown>
                    </Section>
                  )}
                  {shouldShowScoreAdjustmentReason && (
                    <Section icon={<TrendingUp className="w-4 h-4" />} label="Score Adjustment Reason" color="text-sky-300">
                      <Markdown>
                        {hasText(scoreAdjustmentReason)
                          ? scoreAdjustmentReason
                          : 'Missing: the final score differs from the diagnostic baseline by more than 8 points.'}
                      </Markdown>
                    </Section>
                  )}
                  {comparatorCalibrationApplied && calibrationRationale && (
                    <Section icon={<Shield className="w-4 h-4" />} label="Calibration Rationale" color="text-cyan-300">
                      <Markdown>{calibrationRationale}</Markdown>
                    </Section>
                  )}
                  {comparatorCalibrationApplied && diagnosticChanges.length > 0 && (
                    <Section icon={<TrendingUp className="w-4 h-4" />} label="Diagnostic Changes" color="text-sky-300">
                      <Markdown>
                        {diagnosticChanges.map((change: any) => {
                          const label = String(change.dimension ?? '')
                            .replace('inputStrengthScore', 'Input Strength')
                            .replace('constructionStrengthScore', 'Construction Strength')
                            .replace('outputStrengthScore', 'Output Strength');
                          return `- ${label}: ${change.from} -> ${change.to}${change.rationale ? ` - ${change.rationale}` : ''}`;
                        }).join('\n')}
                      </Markdown>
                    </Section>
                  )}
                  {comparatorCalibrationApplied && scoreGapAssessment && (
                    <Section icon={<TrendingUp className="w-4 h-4" />} label="Score Gap Assessment" color="text-violet-300">
                      <Markdown>{scoreGapAssessment}</Markdown>
                    </Section>
                  )}
                  {comparatorCalibrationApplied && publicComparatorSummary && (
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
                      explanatoryDeltaAssessment.outputValidityComparison,
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
                          {(pass.scientificReview || pass.oneParagraphVerdict || pass.finalJudgment || pass.summary) && (
                            <div className="mt-2">
                              <Markdown>{pass.scientificReview || pass.oneParagraphVerdict || pass.finalJudgment || pass.summary}</Markdown>
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
