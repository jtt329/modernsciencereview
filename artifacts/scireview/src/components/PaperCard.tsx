import React from 'react';
import { motion } from 'framer-motion';
import { Heart, MessageSquare, Clock, User, ChevronRight } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Paper } from '../types';

interface PaperCardProps {
  paper: Paper;
  onClick: (id: string) => void;
  onLike: (id: string, e: React.MouseEvent) => void;
  isLiked: boolean;
}

export default function PaperCard({ paper, onClick, onLike, isLiked }: PaperCardProps) {
  return (
    <motion.div
      whileHover={{ y: -4 }}
      transition={{ duration: 0.2 }}
      className="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all cursor-pointer overflow-hidden group"
      onClick={() => onClick(paper.id)}
    >
      <div className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-full bg-indigo-50 flex items-center justify-center border border-indigo-100">
            <User className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-slate-900">{paper.authorName}</span>
            <div className="flex items-center gap-1 text-[10px] text-slate-500 uppercase tracking-wider font-bold">
              <Clock className="w-3 h-3" />
              {formatDistanceToNow(paper.createdAt)} ago
            </div>
          </div>
        </div>

        <h3 className="text-xl font-bold text-slate-900 mb-2 group-hover:text-indigo-600 transition-colors line-clamp-2">
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
              onClick={(e) => onLike(paper.id, e)}
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

          <div className="text-indigo-600 font-bold text-sm flex items-center gap-1 group-hover:translate-x-1 transition-transform">
            Read Paper <ChevronRight className="w-4 h-4" />
          </div>
        </div>
      </div>
    </motion.div>
  );
}
