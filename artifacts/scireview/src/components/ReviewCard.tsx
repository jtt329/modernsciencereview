import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, CheckCircle2, Zap, Award, Heart, MessageSquare, Info, X, Target, BookOpen, FlaskConical, Layers, Shield, AlertTriangle, Microscope, TrendingUp, GitBranch, Globe } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { AIReview } from '../types';

interface ReviewCardProps {
  review: AIReview;
  onLike: (id: string, e: React.MouseEvent) => void;
  isLiked: boolean;
}

const Markdown = ({ children }: { children: string }) => (
  <div className="prose prose-invert prose-sm max-w-none text-slate-300 leading-relaxed">
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

const CLASSIFICATION_COLORS: Record<string, string> = {
  "field-defining advance": "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  "major specialty advance": "bg-indigo-500/20 text-indigo-300 border-indigo-500/40",
  "strong niche contribution": "bg-blue-500/20 text-blue-300 border-blue-500/40",
  "useful clarification": "bg-amber-500/20 text-amber-300 border-amber-500/40",
  "elegant repackaging": "bg-purple-500/20 text-purple-300 border-purple-500/40",
  "not yet convincing": "bg-rose-500/20 text-rose-300 border-rose-500/40",
};

export default function ReviewCard({ review, onLike, isLiked }: ReviewCardProps) {
  const [showPrompt, setShowPrompt] = useState(false);

  const isNewFormat = review.overallIntrinsicScore != null;
  const displayScore = review.overallIntrinsicScore ?? review.score;

  const scoreColor = displayScore >= 80 ? 'text-emerald-600 bg-emerald-50 border-emerald-200' :
    displayScore >= 60 ? 'text-amber-600 bg-amber-50 border-amber-200' :
    'text-rose-600 bg-rose-50 border-rose-200';

  const classificationStyle = review.bestClassification
    ? (CLASSIFICATION_COLORS[review.bestClassification] ?? "bg-slate-500/20 text-slate-300 border-slate-500/40")
    : "";

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
            <div className="flex items-center gap-3">
              {review.bestClassification && (
                <span className={`px-3 py-1.5 rounded-xl text-xs font-bold border uppercase tracking-wide ${classificationStyle}`}>
                  {review.bestClassification}
                </span>
              )}
              <div className={`px-5 py-3 rounded-2xl font-black text-2xl border ${scoreColor}`}>
                {displayScore}<span className="text-sm font-bold ml-1">/100</span>
              </div>
            </div>
          </div>

          {/* Sub-scores (new format only) */}
          {isNewFormat && (review.intrinsicScientificMeritScore != null || review.explanatoryTargetBreadthScore != null || review.theorySpaceBreadthScore != null || review.breadthOfImpactScore != null) && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {review.intrinsicScientificMeritScore != null && (
                <div className="bg-white/5 border border-white/10 rounded-2xl p-4 text-center">
                  <div className="text-3xl font-black text-indigo-300">{review.intrinsicScientificMeritScore}<span className="text-base font-bold text-indigo-400/60">/10</span></div>
                  <div className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mt-1">Intrinsic Merit</div>
                </div>
              )}
              {review.explanatoryTargetBreadthScore != null && (
                <div className="bg-white/5 border border-white/10 rounded-2xl p-4 text-center">
                  <div className="text-3xl font-black text-sky-300">{review.explanatoryTargetBreadthScore}<span className="text-base font-bold text-sky-400/60">/10</span></div>
                  <div className="text-[10px] font-bold text-sky-400 uppercase tracking-widest mt-1">Target Breadth</div>
                </div>
              )}
              {review.theorySpaceBreadthScore != null && (
                <div className="bg-white/5 border border-white/10 rounded-2xl p-4 text-center">
                  <div className="text-3xl font-black text-violet-300">{review.theorySpaceBreadthScore}<span className="text-base font-bold text-violet-400/60">/10</span></div>
                  <div className="text-[10px] font-bold text-violet-400 uppercase tracking-widest mt-1">Theory Breadth</div>
                </div>
              )}
              {review.breadthOfImpactScore != null && (
                <div className="bg-white/5 border border-white/10 rounded-2xl p-4 text-center">
                  <div className="text-3xl font-black text-purple-300">{review.breadthOfImpactScore}<span className="text-base font-bold text-purple-400/60">/10</span></div>
                  <div className="text-[10px] font-bold text-purple-400 uppercase tracking-widest mt-1">Breadth of Impact</div>
                </div>
              )}
            </div>
          )}

          {/* Summary */}
          <div className="space-y-2">
            <h3 className="text-xs font-black text-indigo-400 uppercase tracking-widest flex items-center gap-2">
              <BookOpen className="w-4 h-4" /> Summary
            </h3>
            <Markdown>{review.summary}</Markdown>
          </div>

          {/* Central Claim */}
          {review.centralClaim && (
            <Section icon={<Target className="w-4 h-4" />} label="Central Claim" color="text-sky-400">
              <Markdown>{review.centralClaim}</Markdown>
            </Section>
          )}

          {/* Established / Interpretive / Speculative */}
          {(review.establishedResults || review.interpretiveClaims || review.speculativeClaims) && (
            <div className="space-y-3">
              <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Evidence Breakdown</h3>
              <div className="grid md:grid-cols-3 gap-4">
                {review.establishedResults && (
                  <Section icon={<CheckCircle2 className="w-4 h-4" />} label="Established" color="text-emerald-400">
                    <Markdown>{review.establishedResults}</Markdown>
                  </Section>
                )}
                {review.interpretiveClaims && (
                  <Section icon={<Layers className="w-4 h-4" />} label="Interpretive" color="text-amber-400">
                    <Markdown>{review.interpretiveClaims}</Markdown>
                  </Section>
                )}
                {review.speculativeClaims && (
                  <Section icon={<FlaskConical className="w-4 h-4" />} label="Speculative" color="text-orange-400">
                    <Markdown>{review.speculativeClaims}</Markdown>
                  </Section>
                )}
              </div>
            </div>
          )}

          {/* Correctness & Novelty */}
          <div className="grid md:grid-cols-2 gap-4">
            <Section icon={<CheckCircle2 className="w-4 h-4" />} label="Correctness" color="text-emerald-400">
              <Markdown>{review.correctness}</Markdown>
            </Section>
            <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-black text-amber-400 uppercase tracking-widest flex items-center gap-2">
                  <Zap className="w-4 h-4" /> Novelty
                </h3>
                {review.noveltyConfidence != null && (
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Confidence {Math.round(Number(review.noveltyConfidence) * 100)}%
                  </span>
                )}
              </div>
              <Markdown>{review.novelty}</Markdown>
            </div>
          </div>

          {/* Internal Technical Traction */}
          {review.internalTechnicalTraction && (
            <Section icon={<Microscope className="w-4 h-4" />} label="Internal Technical Traction" color="text-teal-400">
              <Markdown>{review.internalTechnicalTraction}</Markdown>
            </Section>
          )}

          {/* Economy, Scope, Unifying Power */}
          {(review.economy || review.scopeDepth || review.unifyingPower) && (
            <div className="grid md:grid-cols-3 gap-4">
              {review.economy && (
                <Section icon={<TrendingUp className="w-4 h-4" />} label="Explanatory Economy" color="text-cyan-400">
                  <Markdown>{review.economy}</Markdown>
                </Section>
              )}
              {review.scopeDepth && (
                <Section icon={<Microscope className="w-4 h-4" />} label="Scope & Depth" color="text-violet-400">
                  <Markdown>{review.scopeDepth}</Markdown>
                </Section>
              )}
              {review.unifyingPower && (
                <Section icon={<Layers className="w-4 h-4" />} label="Unifying Power" color="text-fuchsia-400">
                  <Markdown>{review.unifyingPower}</Markdown>
                </Section>
              )}
            </div>
          )}

          {/* Explanatory-Target Breadth & Theory-Space Breadth */}
          {(review.explanatoryTargetBreadth || review.theorySpaceBreadth) && (
            <div className="grid md:grid-cols-2 gap-4">
              {review.explanatoryTargetBreadth && (
                <Section icon={<Globe className="w-4 h-4" />} label="Explanatory-Target Breadth" color="text-sky-400">
                  <Markdown>{review.explanatoryTargetBreadth}</Markdown>
                </Section>
              )}
              {review.theorySpaceBreadth && (
                <Section icon={<GitBranch className="w-4 h-4" />} label="Theory-Space Breadth" color="text-violet-400">
                  <Markdown>{review.theorySpaceBreadth}</Markdown>
                </Section>
              )}
            </div>
          )}

          {/* Strongest Case & Strongest Objection */}
          {(review.strongestCaseForImportance || review.strongestObjection) && (
            <div className="grid md:grid-cols-2 gap-4">
              {review.strongestCaseForImportance && (
                <Section icon={<Shield className="w-4 h-4" />} label="Strongest Case For" color="text-green-400">
                  <Markdown>{review.strongestCaseForImportance}</Markdown>
                </Section>
              )}
              {review.strongestObjection && (
                <Section icon={<AlertTriangle className="w-4 h-4" />} label="Strongest Objection" color="text-rose-400">
                  <Markdown>{review.strongestObjection}</Markdown>
                </Section>
              )}
            </div>
          )}

          {/* Decisive Check */}
          {review.decisiveCheck && (
            <Section icon={<Microscope className="w-4 h-4" />} label="Decisive Check" color="text-yellow-400">
              <Markdown>{review.decisiveCheck}</Markdown>
            </Section>
          )}

          {/* Overall Evaluation / Final Judgment */}
          {(review.finalJudgment || review.overallEvaluation) && (
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-3">
              <h3 className="text-xs font-black text-indigo-400 uppercase tracking-widest flex items-center gap-2">
                <Award className="w-4 h-4" /> Final Judgment
              </h3>
              <Markdown>{review.finalJudgment || review.overallEvaluation}</Markdown>
            </div>
          )}

          {/* Related Work */}
          {review.relatedWork && (
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-3">
              <h3 className="text-xs font-black text-purple-400 uppercase tracking-widest">Related Work</h3>
              <Markdown>{review.relatedWork}</Markdown>
            </div>
          )}

          {/* Footer actions */}
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
              <button
                onClick={() => setShowPrompt(true)}
                className="flex items-center gap-2 text-indigo-400 hover:text-indigo-300 text-xs font-bold uppercase tracking-wider transition-colors"
              >
                <Info className="w-4 h-4" />
                View System Prompt
              </button>
              <div className="flex items-center gap-2 text-sm font-bold text-slate-500">
                <MessageSquare className="w-5 h-5" />
                Comments
              </div>
            </div>
          </div>
        </div>
      </motion.div>

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
              className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-indigo-600 text-white">
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
              <div className="p-8 overflow-y-auto bg-slate-50">
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
