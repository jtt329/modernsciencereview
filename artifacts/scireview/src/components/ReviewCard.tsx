import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, CheckCircle2, Zap, Award, Heart, MessageSquare, Info, X, Target, BookOpen, FlaskConical, Layers, Shield, AlertTriangle, Microscope, TrendingUp, GitBranch, Globe, ListChecks, BrainCircuit } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { format } from 'date-fns';
import { AIReview } from '../types';
import ReviewChat from './ReviewChat';

interface ReviewCardProps {
  review: AIReview;
  onLike: (id: string, e: React.MouseEvent) => void;
  isLiked: boolean;
}

const Markdown = ({ children }: { children: string }) => (
  <div className="prose prose-invert prose-sm prose-p:my-0 prose-li:my-0 max-w-none text-slate-300 leading-relaxed">
    <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
      {children}
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


export default function ReviewCard({ review, onLike, isLiked }: ReviewCardProps) {
  const [showPrompt, setShowPrompt] = useState(false);
  const [showThinking, setShowThinking] = useState(false);
  const [activeTab, setActiveTab] = useState<'combined' | number>('combined');

  const toMarkdownList = (items?: string[]) => items && items.length > 0 ? items.map((item) => `- ${item}`).join('\n') : '';
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
  const coverageLedger = parsedCoverage?.coverageLedger ?? parsedCoverage ?? null;
  const directTargets = parsedCoverage?.directTargets ?? coverageLedger?.directTargets ?? [];
  const importedInputs = parsedCoverage?.importedInputs ?? coverageLedger?.importedInputs ?? [];
  const theorySpaceVariants = parsedCoverage?.theorySpaceVariants ?? coverageLedger?.theorySpaceVariants ?? [];
  const mechanismSharingAssessment = parsedCoverage?.mechanismSharingAssessment ?? coverageLedger?.mechanismSharingAssessment ?? '';
  const inputConstructionOutputLedger = parsedCoverage?.inputConstructionOutputLedger ?? null;
  const inputFundamentality = parsedCoverage?.inputFundamentality ?? '';
  const storedAggregate = storedAggregateFromField ?? parsedCoverage?.aggregate ?? null;
  const storedIndividualReviews = storedIndividualReviewsFromField.length > 0
    ? storedIndividualReviewsFromField
    : Array.isArray(parsedCoverage?.individualReviews)
      ? parsedCoverage.individualReviews
      : [];
  const aggregateScoreBand = storedAggregate?.finalScoreBand ?? null;
  const publicVerdict = review.publicVerdict || storedAggregate?.publicOneParagraphVerdict || parsedCoverage?.publicVerdict || review.finalJudgment || review.overallEvaluation;
  const comparisonCohort = review.comparisonCohort || parsedCoverage?.finalComparisonCohort || review.specialtyField || review.broadField;
  const aggregateVerdict = storedAggregate?.publicOneParagraphVerdict ?? publicVerdict;
  const aggregateClassification = storedAggregate?.finalClassification ?? review.bestClassification;
  const scoreStability = storedAggregate?.scoreStability || (review as any).scoreStability || parsedCoverage?.scoreStability || null;
  const selectedPass = activeTab === 'combined' ? null : storedIndividualReviews[activeTab] ?? null;
  const passScoreBands = storedIndividualReviews.map((pass: any) =>
    normalizeDisplayedBand(
      pass.scoreBand?.low,
      pass.scoreBand?.median,
      pass.scoreBand?.high,
      pass.bestClassification,
    )
  );
  const passMedianScores = passScoreBands.map((band) => band.median);
  const combinedBand = normalizeDisplayedBand(
    aggregateScoreBand?.low ?? review.scoreBandLow ?? review.overallIntrinsicScore ?? review.score,
    aggregateScoreBand?.median ?? review.scoreBandMedian ?? review.overallIntrinsicScore ?? review.score,
    aggregateScoreBand?.high ?? review.scoreBandHigh ?? review.overallIntrinsicScore ?? review.score,
    aggregateClassification ?? review.bestClassification,
  );
  const activeBand = selectedPass
    ? normalizeDisplayedBand(
        selectedPass.scoreBand?.low,
        selectedPass.scoreBand?.median,
        selectedPass.scoreBand?.high,
        selectedPass.bestClassification,
      )
    : combinedBand;
  const displayScore = activeBand.median;
  const scorePillLabel = `${displayScore}/100`;
  const currentClassification = selectedPass?.bestClassification ?? aggregateClassification ?? review.bestClassification ?? 'Unclassified';
  const currentComparisonCohort = selectedPass?.comparisonCohort || selectedPass?.broadField || comparisonCohort;
  const currentVerdict = selectedPass?.oneParagraphVerdict || selectedPass?.finalJudgment || aggregateVerdict;
  const currentFinalJudgment = selectedPass?.finalJudgment || currentVerdict || review.finalJudgment || review.overallEvaluation;
  const currentSummary = selectedPass?.summary || review.summary;
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
  const currentInputConstructionOutputAssessment = currentInputConstructionOutputLedger?.assessment ?? '';
  const currentInputFundamentality = selectedPass?.inputFundamentality || inputFundamentality;
  const currentEstablishedResults = selectedPass ? toMarkdownList(selectedPass.establishedResults) : review.establishedResults;
  const currentInterpretiveClaims = selectedPass ? toMarkdownList(selectedPass.interpretiveClaims) : review.interpretiveClaims;
  const currentSpeculativeClaims = selectedPass ? toMarkdownList(selectedPass.speculativeClaims) : review.speculativeClaims;
  const currentCorrectness = selectedPass?.correctness || review.correctness;
  const currentNovelty = selectedPass?.novelty || review.novelty;
  const currentNoveltyConfidence = selectedPass?.noveltyConfidence ?? review.noveltyConfidence;
  const currentInternalTechnicalTraction = selectedPass?.internalTechnicalTraction || review.internalTechnicalTraction;
  const currentEconomy = selectedPass?.economy || review.economy;
  const currentScopeDepth = selectedPass?.scopeDepth || review.scopeDepth;
  const currentUnifyingPower = selectedPass?.unifyingPower || review.unifyingPower;
  const currentExplanatoryTargetBreadth = selectedPass?.explanatoryTargetBreadth || review.explanatoryTargetBreadth;
  const currentTheorySpaceBreadth = selectedPass?.theorySpaceBreadth || review.theorySpaceBreadth;
  const currentStrongestCase = selectedPass?.strongestCaseForImportance || review.strongestCaseForImportance;
  const currentStrongestObjection = selectedPass?.strongestObjection || review.strongestObjection;
  const currentDecisiveCheck = selectedPass?.decisiveCheck || review.decisiveCheck;
  const submittedAtLabel = Number.isFinite(review.createdAt)
    ? format(new Date(review.createdAt), 'MMM d, yyyy h:mm:ss a')
    : null;
  const currentIntrinsicScore = selectedPass?.intrinsicTechnicalScore ?? review.intrinsicScientificMeritScore;
  const currentTargetBreadthScore = selectedPass?.explanatoryTargetBreadthScore ?? review.explanatoryTargetBreadthScore;
  const currentTheoryBreadthScore = selectedPass?.theorySpaceBreadthScore ?? review.theorySpaceBreadthScore;
  const currentImpactScore = selectedPass?.breadthOfImpactScore ?? review.breadthOfImpactScore;

  const scoreColor = displayScore >= 80 ? 'text-emerald-600 bg-emerald-50 border-emerald-200' :
    displayScore >= 60 ? 'text-amber-600 bg-amber-50 border-amber-200' :
    'text-rose-600 bg-rose-50 border-rose-200';

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
                {review.modelName && (
                  <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">{review.modelName}</p>
                )}
              </div>
            </div>
            <div className="relative group">
              <div className={`px-5 py-3 rounded-2xl font-black text-2xl border cursor-default ${scoreColor}`}>
                {scorePillLabel}
              </div>
              <div className="absolute bottom-full right-0 mb-2 w-64 p-3 bg-slate-900 text-white text-xs rounded-xl shadow-2xl opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150 z-30 leading-relaxed">
                {selectedPass
                  ? 'This is the anchored scientific merit score assigned by this individual independent review pass.'
                  : 'This is the final anchored scientific merit score assigned by the Gemini adjudicator after reading the paper and auditing the two independent passes. It is calibrated against the chosen comparison cohort, not a literal percentile over all papers.'}
              </div>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-3">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
              <p className="text-[10px] font-black text-indigo-300 uppercase tracking-widest">Classification</p>
              <p className="text-sm font-bold text-white mt-1 capitalize">{currentClassification}</p>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
              <p className="text-[10px] font-black text-teal-300 uppercase tracking-widest">Comparison Cohort</p>
              <p className="text-sm font-bold text-white mt-1">{currentComparisonCohort || 'Not specified'}</p>
            </div>
            {!selectedPass && scoreStability && (
              <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
                <p className="text-[10px] font-black text-fuchsia-300 uppercase tracking-widest">Stability</p>
                <p className="text-sm font-bold text-white mt-1 capitalize">{scoreStability}</p>
              </div>
            )}
          </div>

          {storedIndividualReviews.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setActiveTab('combined')}
                className={`px-4 py-2 rounded-xl text-sm font-bold transition-colors ${
                  activeTab === 'combined'
                    ? 'bg-indigo-500 text-white'
                    : 'bg-white/10 text-slate-200 hover:bg-white/20'
                }`}
              >
                Final · {combinedBand.median}
              </button>
              {storedIndividualReviews.map((_: any, index: number) => (
                <button
                  key={index}
                  onClick={() => setActiveTab(index)}
                  className={`px-4 py-2 rounded-xl text-sm font-bold transition-colors ${
                    activeTab === index
                      ? 'bg-fuchsia-500 text-white'
                      : 'bg-white/10 text-slate-200 hover:bg-white/20'
                  }`}
                >
                  Pass {index + 1} · {Number.isFinite(passMedianScores[index]) ? passMedianScores[index] : '—'}
                </button>
              ))}
            </div>
          )}

          {currentVerdict && (
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-3">
              <h3 className="text-xs font-black text-emerald-300 uppercase tracking-widest flex items-center gap-2">
                <Award className="w-4 h-4" /> {selectedPass ? 'Pass Verdict' : 'Verdict'}
              </h3>
              <Markdown>{currentVerdict}</Markdown>
            </div>
          )}

          {/* Sub-scores (new format only) */}
          {isNewFormat && (currentIntrinsicScore != null || currentTargetBreadthScore != null || currentTheoryBreadthScore != null || currentImpactScore != null) && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {currentIntrinsicScore != null && (
                <div className="bg-white/5 border border-white/10 rounded-2xl p-4 text-center">
                  <div className="text-3xl font-black text-indigo-300">{currentIntrinsicScore}<span className="text-base font-bold text-indigo-400/60">/10</span></div>
                  <div className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mt-1">Intrinsic Merit</div>
                </div>
              )}
              {currentTargetBreadthScore != null && (
                <div className="bg-white/5 border border-white/10 rounded-2xl p-4 text-center">
                  <div className="text-3xl font-black text-sky-300">{currentTargetBreadthScore}<span className="text-base font-bold text-sky-400/60">/10</span></div>
                  <div className="text-[10px] font-bold text-sky-400 uppercase tracking-widest mt-1">Target Breadth</div>
                </div>
              )}
              {currentTheoryBreadthScore != null && (
                <div className="bg-white/5 border border-white/10 rounded-2xl p-4 text-center">
                  <div className="text-3xl font-black text-violet-300">{currentTheoryBreadthScore}<span className="text-base font-bold text-violet-400/60">/10</span></div>
                  <div className="text-[10px] font-bold text-violet-400 uppercase tracking-widest mt-1">Theory Breadth</div>
                </div>
              )}
              {currentImpactScore != null && (
                <div className="bg-white/5 border border-white/10 rounded-2xl p-4 text-center">
                  <div className="text-3xl font-black text-purple-300">{currentImpactScore}<span className="text-base font-bold text-purple-400/60">/10</span></div>
                  <div className="text-[10px] font-bold text-purple-400 uppercase tracking-widest mt-1">Breadth of Impact</div>
                </div>
              )}
            </div>
          )}

          {/* Summary */}
          <div className="space-y-2">
            <h3 className="text-xs font-black text-indigo-400 uppercase tracking-widest flex items-center gap-2">
              <BookOpen className="w-4 h-4" /> Review Summary
            </h3>
            <Markdown>{currentSummary}</Markdown>
          </div>

          {/* Central Claim */}
          {currentCentralClaim && (
            <Section icon={<Target className="w-4 h-4" />} label="Central Claim" color="text-sky-400">
              <Markdown>{currentCentralClaim}</Markdown>
            </Section>
          )}

          {/* Input-Construction-Output Ledger */}
          {currentInputConstructionOutputLedger && (() => {
            const hasContent =
              currentPrimitiveInputs.length ||
              currentIntroducedConstructions.length ||
              currentExternalEmbeddingsAndChecks.length ||
              currentDirectOutputs.length ||
              currentDownstreamReach ||
              currentInputConstructionOutputAssessment ||
              currentInputFundamentality;
            if (!hasContent) return null;
            return (
              <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-4">
                <h3 className="text-xs font-black text-cyan-300 uppercase tracking-widest flex items-center gap-2">
                  <BrainCircuit className="w-4 h-4" /> Input-Construction-Output Ledger
                </h3>
                <div className="grid md:grid-cols-2 gap-4">
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
                  {currentExternalEmbeddingsAndChecks.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[10px] font-black text-amber-300 uppercase tracking-widest">External Embeddings/Checks</p>
                      <ul className="space-y-1">
                        {currentExternalEmbeddingsAndChecks.map((item: string, i: number) => (
                          <li key={i} className="text-xs text-slate-300 flex gap-2"><span className="text-amber-400 shrink-0">▸</span><div className="min-w-0 flex-1"><Markdown>{item}</Markdown></div></li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {currentDirectOutputs.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[10px] font-black text-emerald-300 uppercase tracking-widest">Direct Outputs</p>
                      <ul className="space-y-1">
                        {currentDirectOutputs.map((item: string, i: number) => (
                          <li key={i} className="text-xs text-slate-300 flex gap-2"><span className="text-emerald-400 shrink-0">▸</span><div className="min-w-0 flex-1"><Markdown>{item}</Markdown></div></li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
                {currentInputFundamentality && (
                  <div className="border-t border-white/10 pt-3">
                    <p className="text-[10px] font-black text-cyan-300 uppercase tracking-widest mb-1">Input Fundamentality</p>
                    <Markdown>{currentInputFundamentality}</Markdown>
                  </div>
                )}
                {currentDownstreamReach && (
                  <div className="border-t border-white/10 pt-3">
                    <p className="text-[10px] font-black text-teal-300 uppercase tracking-widest mb-1">Downstream Reach</p>
                    <Markdown>{currentDownstreamReach}</Markdown>
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

          {/* Coverage Ledger (new prompt) */}
          {(review.coverageLedgerJson || selectedPass?.coverageLedger) && (() => {
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

          {(currentExplanatoryTargetBreadth || currentTheorySpaceBreadth) && (
            <div className="grid md:grid-cols-2 gap-4">
              {currentExplanatoryTargetBreadth && (
                <Section icon={<Globe className="w-4 h-4" />} label="Explanatory-Target Breadth" color="text-sky-400">
                  <Markdown>{currentExplanatoryTargetBreadth}</Markdown>
                </Section>
              )}
              {currentTheorySpaceBreadth && (
                <Section icon={<GitBranch className="w-4 h-4" />} label="Theory-Space Breadth" color="text-violet-400">
                  <Markdown>{currentTheorySpaceBreadth}</Markdown>
                </Section>
              )}
            </div>
          )}

          {(currentEstablishedResults || currentInterpretiveClaims || currentSpeculativeClaims) && (
            <div className="space-y-3">
              <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Evidence Breakdown</h3>
              <div className="grid md:grid-cols-3 gap-4">
                {currentEstablishedResults && (
                  <Section icon={<CheckCircle2 className="w-4 h-4" />} label="Established" color="text-emerald-400">
                    <Markdown>{currentEstablishedResults}</Markdown>
                  </Section>
                )}
                {currentInterpretiveClaims && (
                  <Section icon={<Layers className="w-4 h-4" />} label="Interpretive" color="text-amber-400">
                    <Markdown>{currentInterpretiveClaims}</Markdown>
                  </Section>
                )}
                {currentSpeculativeClaims && (
                  <Section icon={<FlaskConical className="w-4 h-4" />} label="Speculative" color="text-orange-400">
                    <Markdown>{currentSpeculativeClaims}</Markdown>
                  </Section>
                )}
              </div>
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-4">
            <Section icon={<CheckCircle2 className="w-4 h-4" />} label="Correctness" color="text-emerald-400">
              <Markdown>{currentCorrectness}</Markdown>
            </Section>
            <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-black text-amber-400 uppercase tracking-widest flex items-center gap-2">
                  <Zap className="w-4 h-4" /> Novelty
                </h3>
                {currentNoveltyConfidence != null && (
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Confidence {Math.round(Number(currentNoveltyConfidence) * 100)}%
                  </span>
                )}
              </div>
              <Markdown>{currentNovelty}</Markdown>
            </div>
          </div>

          {currentInternalTechnicalTraction && (
            <Section icon={<Microscope className="w-4 h-4" />} label="Internal Technical Traction" color="text-teal-400">
              <Markdown>{currentInternalTechnicalTraction}</Markdown>
            </Section>
          )}

          {(currentEconomy || currentScopeDepth || currentUnifyingPower) && (
            <div className="grid md:grid-cols-3 gap-4">
              {currentEconomy && (
                <Section icon={<TrendingUp className="w-4 h-4" />} label="Explanatory Economy" color="text-cyan-400">
                  <Markdown>{currentEconomy}</Markdown>
                </Section>
              )}
              {currentScopeDepth && (
                <Section icon={<Microscope className="w-4 h-4" />} label="Scope & Depth" color="text-violet-400">
                  <Markdown>{currentScopeDepth}</Markdown>
                </Section>
              )}
              {currentUnifyingPower && (
                <Section icon={<Layers className="w-4 h-4" />} label="Unifying Power" color="text-fuchsia-400">
                  <Markdown>{currentUnifyingPower}</Markdown>
                </Section>
              )}
            </div>
          )}

          {(currentStrongestCase || currentStrongestObjection) && (
            <div className="grid md:grid-cols-2 gap-4">
              {currentStrongestCase && (
                <Section icon={<Shield className="w-4 h-4" />} label="Strongest Case For" color="text-green-400">
                  <Markdown>{currentStrongestCase}</Markdown>
                </Section>
              )}
              {currentStrongestObjection && (
                <Section icon={<AlertTriangle className="w-4 h-4" />} label="Strongest Objection" color="text-rose-400">
                  <Markdown>{currentStrongestObjection}</Markdown>
                </Section>
              )}
            </div>
          )}

          {currentDecisiveCheck && (
            <Section icon={<Microscope className="w-4 h-4" />} label="Decisive Check" color="text-yellow-400">
              <Markdown>{currentDecisiveCheck}</Markdown>
            </Section>
          )}

          {currentFinalJudgment && (
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-3">
              <h3 className="text-xs font-black text-indigo-400 uppercase tracking-widest flex items-center gap-2">
                <Award className="w-4 h-4" /> Final Judgment
              </h3>
              <Markdown>{currentFinalJudgment}</Markdown>
              {submittedAtLabel && (
                <p className="pt-3 border-t border-white/10 text-[11px] font-bold uppercase tracking-widest text-slate-400">
                  Submitted {submittedAtLabel}
                </p>
              )}
            </div>
          )}

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
