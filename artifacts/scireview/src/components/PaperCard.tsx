import React from 'react';
import { motion } from 'framer-motion';
import { Heart, MessageSquare, Users, ChevronRight, Check } from 'lucide-react';
import { format } from 'date-fns';
import { Paper } from '../types';

interface PaperCardProps {
  paper: Paper;
  onClick: (id: string) => void;
  onLike: (id: string, e: React.MouseEvent) => void;
  isLiked: boolean;
  isSelectable?: boolean;
  isSelected?: boolean;
  onSelect?: (id: string, e: React.MouseEvent) => void;
}

export default function PaperCard({ paper, onClick, onLike, isLiked, isSelectable, isSelected, onSelect }: PaperCardProps) {
  const displayAuthors = paper.paperAuthors || paper.authorName;
  const centralClaim = paper.reviewCentralClaim;
  const finalJudgment = paper.reviewFinalJudgment;
  const fallbackPreview = paper.reviewSummary || paper.content.substring(0, 500);

  const scoreColorClass = paper.score != null
    ? paper.score >= 80 ? 'text-emerald-600 bg-emerald-50 border-emerald-200'
    : paper.score >= 60 ? 'text-amber-600 bg-amber-50 border-amber-200'
    : 'text-rose-600 bg-rose-50 border-rose-200'
    : '';

  return (
    <motion.div
      whileHover={{ y: isSelectable ? 0 : -2 }}
      transition={{ duration: 0.2 }}
      className={`bg-gradient-to-br from-indigo-950 to-slate-900 text-white rounded-2xl overflow-hidden shadow-lg hover:shadow-indigo-950/60 transition-all cursor-pointer group/card relative ${
        isSelected ? 'ring-2 ring-rose-400 shadow-rose-900/40' : ''
      }`}
      onClick={() => isSelectable ? onSelect?.(paper.id, {} as React.MouseEvent) : onClick(paper.id)}
    >
      {isSelectable && (
        <button
          onClick={(e) => { e.stopPropagation(); onSelect?.(paper.id, e); }}
          className={`absolute top-3 right-3 z-10 w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all ${
            isSelected
              ? 'bg-rose-500 border-rose-500 text-white'
              : 'bg-white/10 border-white/30 hover:border-rose-400'
          }`}
        >
          {isSelected && <Check className="w-3.5 h-3.5" />}
        </button>
      )}

      <div className="p-5">
        {/* Author + date */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-6 h-6 rounded-full bg-indigo-500/20 flex items-center justify-center border border-indigo-500/30 shrink-0">
              <Users className="w-3 h-3 text-indigo-400" />
            </div>
            <span className="text-xs font-bold text-indigo-300 truncate">{displayAuthors}</span>
          </div>
          <span className="text-[11px] text-slate-500 font-medium shrink-0 ml-3">
            {format(paper.createdAt, 'MMM d, yyyy')}
          </span>
        </div>

        {/* Title + tags (left) + score (right) side by side */}
        <div className="flex gap-4 mb-4">
          <div className="flex-1 min-w-0">
            <h3 className={`text-base font-black text-white leading-snug mb-2.5 transition-colors ${isSelectable ? '' : 'group-hover/card:text-indigo-300'}`}>
              {paper.title}
            </h3>
            <div className="flex flex-wrap items-start gap-1.5">
              <span className="px-2 py-0.5 bg-indigo-500/20 text-indigo-300 text-[10px] font-black uppercase tracking-wider rounded-md border border-indigo-500/30">
                {paper.field}
              </span>
              {paper.subfields?.slice(0, 3).map(s => (
                <span key={s} className="px-2 py-0.5 bg-white/5 text-slate-400 text-[10px] font-bold uppercase tracking-wider rounded-md border border-white/10">
                  {s}
                </span>
              ))}
            </div>
          </div>

          {/* Score + model */}
          {paper.score != null && (
            <div className="flex flex-col items-end gap-1 shrink-0">
              <div className="relative group/score">
                <div className={`flex items-baseline gap-1 px-3 py-2 rounded-xl border cursor-default font-black ${scoreColorClass}`}>
                  <span className="text-[9px] font-black uppercase tracking-widest opacity-60">Score</span>
                  <span className="text-xl leading-none">{paper.score}</span>
                </div>
                <div className="absolute top-full right-0 mt-2 w-64 p-3 bg-slate-950 border border-white/10 text-slate-300 text-xs rounded-xl shadow-2xl opacity-0 group-hover/score:opacity-100 pointer-events-none transition-opacity duration-150 z-30 leading-relaxed">
                  An intrinsic value score (1–100) assigned by the AI review, based entirely on scientific merit, novelty, and breadth of impact — never on author identity, institution, or prestige. Scores roughly correspond to percentile rank within the field.
                </div>
              </div>
              {paper.modelName && (
                <span className="text-[9px] font-semibold text-indigo-400/70 tracking-wide">
                  {paper.modelName.startsWith('gemini') ? 'Gemini 3.1 Pro' : paper.modelName.startsWith('gpt') ? 'GPT-5.4 Pro' : paper.modelName}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Full-width AI preview */}
        <div className="border-t border-white/10 pt-3.5 mb-4 space-y-2.5">
          {centralClaim ? (
            <>
              <div>
                <span className="text-[9px] font-black uppercase tracking-widest text-indigo-400">Central Claim</span>
                <p className="text-slate-200 text-sm line-clamp-2 leading-relaxed mt-0.5">{centralClaim}</p>
              </div>
              {finalJudgment && (
                <div>
                  <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">Final Judgment</span>
                  <p className="text-slate-400 text-sm line-clamp-2 leading-relaxed mt-0.5">{finalJudgment}</p>
                </div>
              )}
            </>
          ) : (
            <p className="text-slate-400 text-sm line-clamp-4 leading-relaxed">{fallbackPreview}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-white/10">
          <div className="flex items-center gap-4">
            <button
              onClick={(e) => { e.stopPropagation(); onLike(paper.id, e); }}
              className={`flex items-center gap-1.5 text-sm font-medium transition-colors ${isLiked ? 'text-rose-400' : 'text-slate-500 hover:text-rose-400'}`}
            >
              <Heart className={`w-4 h-4 ${isLiked ? 'fill-current' : ''}`} />
              {paper.likesCount}
            </button>
            <div className="flex items-center gap-1.5 text-sm font-medium text-slate-500">
              <MessageSquare className="w-4 h-4" />
              {paper.commentCount || 0}
            </div>
          </div>

          {!isSelectable && (
            <div className="text-indigo-400 font-bold text-sm flex items-center gap-1 group-hover/card:translate-x-1 transition-transform">
              Read Review <ChevronRight className="w-4 h-4" />
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
