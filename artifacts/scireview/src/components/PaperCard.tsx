import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Heart, MessageSquare, Users, ChevronRight, Check, Share2 } from 'lucide-react';
import { format } from 'date-fns';
import { Paper } from '../types';
import LatexText from './LatexText';

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
  const [copied, setCopied] = useState(false);

  const handleShare = (e: React.MouseEvent) => {
    e.stopPropagation();
    const url = `${window.location.origin}/papers/${encodeURIComponent(paper.id)}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  const displayAuthors = paper.paperAuthors || paper.authorName;
  const centralClaim = paper.reviewCentralClaim;
  const finalJudgment = paper.reviewFinalJudgment;
  const fallbackPreview = paper.reviewSummary || paper.content.substring(0, 500);

  const scoreColorClass = paper.score != null
    ? paper.score >= 80 ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
    : paper.score >= 60 ? 'text-amber-700 bg-amber-50 border-amber-200'
    : 'text-rose-700 bg-rose-50 border-rose-200'
    : '';

  return (
    <motion.div
      whileHover={{ y: isSelectable ? 0 : -2 }}
      transition={{ duration: 0.2 }}
      className={`bg-white rounded-2xl border shadow-sm hover:shadow-md transition-all cursor-pointer overflow-hidden group/card relative ${
        isSelected ? 'border-rose-400 ring-2 ring-rose-300 shadow-rose-100' : 'border-slate-200'
      }`}
      onClick={() => isSelectable ? onSelect?.(paper.id, {} as React.MouseEvent) : onClick(paper.id)}
    >
      {isSelectable && (
        <button
          onClick={(e) => { e.stopPropagation(); onSelect?.(paper.id, e); }}
          className={`absolute top-3 right-3 z-10 w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all ${
            isSelected
              ? 'bg-rose-500 border-rose-500 text-white'
              : 'bg-white border-slate-300 hover:border-rose-400'
          }`}
        >
          {isSelected && <Check className="w-3.5 h-3.5" />}
        </button>
      )}

      <div className="p-5">
        {/* Author + date */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-6 h-6 rounded-full bg-indigo-50 flex items-center justify-center border border-indigo-100 shrink-0">
              <Users className="w-3 h-3 text-indigo-500" />
            </div>
            <span className="text-xs font-bold text-slate-600 truncate">{displayAuthors}</span>
          </div>
          <span className="text-[11px] text-slate-400 font-medium shrink-0 ml-3">
            {format(paper.createdAt, 'MMM d, yyyy')}
          </span>
        </div>

        {/* Title + tags (left) alongside score (right) */}
        <div className="flex gap-4 mb-3">
          <div className="flex-1 min-w-0">
            <h3 className={`text-base font-bold text-slate-900 leading-snug mb-2 transition-colors ${isSelectable ? '' : 'group-hover/card:text-indigo-600'}`}>
              {paper.title}
            </h3>
            <div className="flex flex-wrap items-start gap-1.5">
              <span className="px-2 py-0.5 bg-indigo-50 text-indigo-600 text-[10px] font-black uppercase tracking-wider rounded-md border border-indigo-100">
                {paper.field}
              </span>
              {paper.subfields?.slice(0, 3).map(s => (
                <span key={s} className="px-2 py-0.5 bg-slate-50 text-slate-500 text-[10px] font-bold uppercase tracking-wider rounded-md border border-slate-100">
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
                <div className="absolute top-full right-0 mt-2 w-64 p-3 bg-slate-900 text-white text-xs rounded-xl shadow-2xl opacity-0 group-hover/score:opacity-100 pointer-events-none transition-opacity duration-150 z-30 leading-relaxed">
                  Anchored scientific merit score: 0 means wrong or no real contribution, 50 means an average serious published paper in the comparison cohort, and 99 means foundational or paradigm-shifting.
                </div>
              </div>
              {paper.modelName && (
                <span className="text-[9px] font-semibold text-slate-400 tracking-wide">
                  {paper.modelName.startsWith('gemini') ? 'Gemini Flash + Pro' : paper.modelName.startsWith('gpt') ? 'GPT-5.4 Pro' : paper.modelName}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Full-width AI preview */}
        <div className="border-t border-slate-100 pt-3 mb-4 space-y-2.5">
          {centralClaim ? (
            <>
              <div>
                <span className="text-[9px] font-black uppercase tracking-widest text-indigo-400">Central Claim</span>
                <p className="text-slate-700 text-sm line-clamp-2 leading-relaxed mt-0.5">
                  <LatexText>{centralClaim}</LatexText>
                </p>
              </div>
              {finalJudgment && (
                <div>
                  <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Final Judgment</span>
                  <p className="text-slate-500 text-sm line-clamp-2 leading-relaxed mt-0.5">
                    <LatexText>{finalJudgment}</LatexText>
                  </p>
                </div>
              )}
            </>
          ) : (
            <p className="text-slate-600 text-sm line-clamp-4 leading-relaxed">
              <LatexText>{fallbackPreview}</LatexText>
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-100">
          <div className="flex items-center gap-4">
            <button
              onClick={(e) => { e.stopPropagation(); onLike(paper.id, e); }}
              className={`flex items-center gap-1.5 text-sm font-medium transition-colors ${isLiked ? 'text-rose-500' : 'text-slate-400 hover:text-rose-500'}`}
            >
              <Heart className={`w-4 h-4 ${isLiked ? 'fill-current' : ''}`} />
              {paper.likesCount}
            </button>
            <div className="flex items-center gap-1.5 text-sm font-medium text-slate-400">
              <MessageSquare className="w-4 h-4" />
              {paper.commentCount || 0}
            </div>
          </div>

          {!isSelectable && (
            <div className="flex items-center gap-3">
              <button
                onClick={handleShare}
                className={`flex items-center gap-1.5 text-sm font-medium transition-colors ${copied ? 'text-emerald-500' : 'text-slate-400 hover:text-indigo-500'}`}
                title="Copy link to this review"
              >
                {copied ? <Check className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
                {copied ? 'Copied!' : 'Share'}
              </button>
              <div className="text-indigo-600 font-bold text-sm flex items-center gap-1 group-hover/card:translate-x-1 transition-transform">
                Read Review <ChevronRight className="w-4 h-4" />
              </div>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
