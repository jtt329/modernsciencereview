import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, CheckCircle2, Zap, Award, Heart, MessageSquare, Info, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { AIReview } from '../types';

interface ReviewCardProps {
  review: AIReview;
  onLike: (id: string, e: React.MouseEvent) => void;
  isLiked: boolean;
}

export default function ReviewCard({ review, onLike, isLiked }: ReviewCardProps) {
  const [showPrompt, setShowPrompt] = useState(false);

  const scoreColor = review.score >= 80 ? 'text-emerald-600 bg-emerald-50 border-emerald-200' :
    review.score >= 60 ? 'text-amber-600 bg-amber-50 border-amber-200' :
    'text-rose-600 bg-rose-50 border-rose-200';

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-gradient-to-br from-indigo-950 to-slate-900 text-white rounded-3xl overflow-hidden shadow-2xl"
      >
        <div className="p-8 space-y-8">
          <div className="flex items-center justify-between">
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
            <div className={`px-5 py-3 rounded-2xl font-black text-2xl border ${scoreColor}`}>
              {review.score}<span className="text-sm font-bold ml-1">/100</span>
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-black text-indigo-400 uppercase tracking-widest flex items-center gap-2">
              <Award className="w-4 h-4" /> Summary
            </h3>
            <div className="prose prose-invert prose-sm max-w-none text-slate-300 leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                {review.summary}
              </ReactMarkdown>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-3">
              <h3 className="text-xs font-black text-emerald-400 uppercase tracking-widest flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" /> Correctness
              </h3>
              <div className="prose prose-invert prose-sm max-w-none text-slate-300 leading-relaxed">
                <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                  {review.correctness}
                </ReactMarkdown>
              </div>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-3">
              <h3 className="text-xs font-black text-amber-400 uppercase tracking-widest flex items-center gap-2">
                <Zap className="w-4 h-4" /> Novelty
              </h3>
              <div className="prose prose-invert prose-sm max-w-none text-slate-300 leading-relaxed">
                <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                  {review.novelty}
                </ReactMarkdown>
              </div>
            </div>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-3">
            <h3 className="text-xs font-black text-indigo-400 uppercase tracking-widest flex items-center gap-2">
              <Award className="w-4 h-4" /> Overall Evaluation
            </h3>
            <div className="prose prose-invert prose-sm max-w-none text-slate-300 leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                {review.overallEvaluation}
              </ReactMarkdown>
            </div>
          </div>

          {review.relatedWork && (
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-3">
              <h3 className="text-xs font-black text-purple-400 uppercase tracking-widest">Related Work</h3>
              <div className="prose prose-invert prose-sm max-w-none text-slate-300 leading-relaxed">
                <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                  {review.relatedWork}
                </ReactMarkdown>
              </div>
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
