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
  const preview = paper.reviewCentralClaim || paper.reviewSummary || paper.content.substring(0, 500);

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

      <div className="p-6">
        {/* Author + date row */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-full bg-indigo-50 flex items-center justify-center border border-indigo-100 shrink-0">
              <Users className="w-3.5 h-3.5 text-indigo-600" />
            </div>
            <span className="text-sm font-bold text-slate-700 truncate">{displayAuthors}</span>
          </div>
          <span className="text-xs text-slate-400 font-medium shrink-0 ml-3">
            {format(paper.createdAt, 'MMM d, yyyy')}
          </span>
        </div>

        {/* Title */}
        <h3 className={`text-lg font-bold text-slate-900 mb-3 leading-snug transition-colors ${isSelectable ? '' : 'group-hover/card:text-indigo-600'}`}>
          {paper.title}
        </h3>

        {/* Tags */}
        <div className="flex flex-wrap items-start gap-1.5 mb-4">
          <span className="px-2 py-0.5 bg-indigo-50 text-indigo-600 text-[10px] font-black uppercase tracking-wider rounded-md border border-indigo-100">
            {paper.field}
          </span>
          {paper.subfields?.slice(0, 3).map(s => (
            <span key={s} className="px-2 py-0.5 bg-slate-50 text-slate-500 text-[10px] font-bold uppercase tracking-wider rounded-md border border-slate-100">
              {s}
            </span>
          ))}
          {paper.score != null && (
            <div className="ml-auto flex flex-col items-end gap-0.5">
              <div className="relative group/score">
                <div className={`flex flex-col items-center px-3 py-1.5 rounded-xl border cursor-default ${
                  paper.score >= 80 ? 'bg-emerald-50 border-emerald-200 text-emerald-700' :
                  paper.score >= 60 ? 'bg-amber-50 border-amber-200 text-amber-700' :
                  'bg-rose-50 border-rose-200 text-rose-700'
                }`}>
                  <span className="text-[9px] font-black uppercase tracking-widest opacity-60">Score</span>
                  <span className="text-xl font-black leading-tight">{paper.score}</span>
                </div>
                <div className="absolute bottom-full right-0 mb-2 w-64 p-3 bg-slate-900 text-white text-xs rounded-xl shadow-2xl opacity-0 group-hover/score:opacity-100 pointer-events-none transition-opacity duration-150 z-30 leading-relaxed">
                  An intrinsic value score (1–100) assigned by the AI review, based entirely on scientific merit, novelty, and breadth of impact — never on author identity, institution, or prestige. Scores roughly correspond to percentile rank within the field.
                </div>
              </div>
              {paper.modelName && (
                <span className="text-[9px] font-semibold text-slate-400 tracking-wide">
                  {paper.modelName.startsWith('gemini') ? 'Gemini 3.1 Pro' : paper.modelName.startsWith('gpt') ? 'GPT-5.4 Pro' : paper.modelName}
                </span>
              )}
            </div>
          )}
        </div>

        {/* AI summary preview */}
        <p className="text-slate-600 text-sm line-clamp-4 mb-5 leading-relaxed">
          {preview}
        </p>

        {/* Footer */}
        <div className="flex items-center justify-between pt-4 border-t border-slate-100">
          <div className="flex items-center gap-4">
            <button
              onClick={(e) => { e.stopPropagation(); onLike(paper.id, e); }}
              className={`flex items-center gap-1.5 text-sm font-medium transition-colors ${isLiked ? 'text-rose-500' : 'text-slate-500 hover:text-rose-500'}`}
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
            <div className="text-indigo-600 font-bold text-sm flex items-center gap-1 group-hover/card:translate-x-1 transition-transform">
              Read Review <ChevronRight className="w-4 h-4" />
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
