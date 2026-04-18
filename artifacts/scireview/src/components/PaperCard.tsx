import React from 'react';
import { motion } from 'framer-motion';
import { Heart, MessageSquare, Clock, Users, ChevronRight, Upload, Check } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
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

  return (
    <motion.div
      whileHover={{ y: isSelectable ? 0 : -4 }}
      transition={{ duration: 0.2 }}
      className={`bg-white rounded-2xl border shadow-sm hover:shadow-md transition-all cursor-pointer overflow-hidden group relative ${
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
        <div className="flex items-start gap-2 mb-4">
          <div className="w-8 h-8 rounded-full bg-indigo-50 flex items-center justify-center border border-indigo-100 shrink-0 mt-0.5">
            <Users className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="min-w-0">
            <span className="text-sm font-bold text-slate-900 leading-snug block">{displayAuthors}</span>
            {paper.paperAuthors && (
              <div className="flex items-center gap-1 text-[10px] text-slate-400 font-medium mt-0.5">
                <Upload className="w-2.5 h-2.5" />
                Submitted by {paper.authorName}
              </div>
            )}
            <div className="flex items-center gap-1 text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">
              <Clock className="w-3 h-3" />
              {formatDistanceToNow(paper.createdAt)} ago
            </div>
          </div>
        </div>

        <h3 className={`text-xl font-bold text-slate-900 mb-2 transition-colors line-clamp-2 ${isSelectable ? '' : 'group-hover:text-indigo-600'}`}>
          {paper.title}
        </h3>

        <div className="flex flex-wrap gap-1.5 mb-4">
          <span className="px-2 py-0.5 bg-indigo-50 text-indigo-600 text-[10px] font-black uppercase tracking-wider rounded-md border border-indigo-100">
            {paper.field}
          </span>
          {paper.subfields?.map(s => (
            <span key={s} className="px-2 py-0.5 bg-slate-50 text-slate-500 text-[10px] font-bold uppercase tracking-wider rounded-md border border-slate-100">
              {s}
            </span>
          ))}
          {paper.score && (
            <div className="flex flex-col items-end ml-auto">
              <span className="px-2 py-0.5 bg-emerald-50 text-emerald-600 text-[10px] font-black uppercase tracking-wider rounded-md border border-emerald-100">
                Score: {paper.score}
              </span>
              {paper.modelName && (
                <span className="text-[8px] text-slate-400 font-bold uppercase tracking-tight mt-1">
                  via {paper.modelName}
                </span>
              )}
            </div>
          )}
        </div>

        <p className="text-slate-600 text-sm line-clamp-3 mb-6 leading-relaxed">
          {paper.content.substring(0, 200)}...
        </p>

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
            <div className="text-indigo-600 font-bold text-sm flex items-center gap-1 group-hover:translate-x-1 transition-transform">
              Read Paper <ChevronRight className="w-4 h-4" />
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
