import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, Send, User, Clock } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Comment } from '../types';

interface CommentSectionProps {
  comments: Comment[];
  onAddComment: (content: string) => void;
  user: any;
}

export default function CommentSection({ comments, onAddComment, user }: CommentSectionProps) {
  const [newComment, setNewComment] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newComment.trim()) {
      onAddComment(newComment);
      setNewComment('');
    }
  };

  return (
    <div className="mt-12 pt-8 border-t border-slate-200">
      <div className="flex items-center gap-2 mb-8">
        <MessageSquare className="w-6 h-6 text-indigo-600" />
        <h3 className="text-2xl font-bold text-slate-900 tracking-tight">Discussion ({comments.length})</h3>
      </div>

      {user ? (
        <form onSubmit={handleSubmit} className="mb-10">
          <div className="flex gap-4">
            {user.photoURL ? (
              <img src={user.photoURL} alt={user.displayName} className="w-10 h-10 rounded-full border border-slate-200" referrerPolicy="no-referrer" />
            ) : (
              <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center border border-slate-200">
                <User className="w-5 h-5 text-slate-400" />
              </div>
            )}
            <div className="flex-1 relative">
              <textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Share your thoughts on this work..."
                className="w-full bg-white border border-slate-200 rounded-2xl p-4 pr-12 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all resize-none min-h-[100px] shadow-sm"
              />
              <button
                type="submit"
                disabled={!newComment.trim()}
                className="absolute bottom-4 right-4 bg-indigo-600 text-white p-2 rounded-xl shadow-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </form>
      ) : (
        <div className="bg-slate-100 rounded-2xl p-6 text-center mb-10 border border-slate-200 border-dashed">
          <p className="text-slate-600 font-medium">Please sign in to join the discussion.</p>
        </div>
      )}

      <div className="space-y-6">
        <AnimatePresence initial={false}>
          {comments.map((comment) => (
            <motion.div
              key={comment.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="flex gap-4 group"
            >
              <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center border border-slate-200 shrink-0">
                <User className="w-5 h-5 text-slate-400" />
              </div>
              <div className="flex-1 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm group-hover:border-indigo-200 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-slate-900 text-sm">{comment.authorName}</span>
                  <div className="flex items-center gap-1 text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                    <Clock className="w-3 h-3" />
                    {formatDistanceToNow(comment.createdAt)} ago
                  </div>
                </div>
                <p className="text-slate-700 text-sm leading-relaxed">{comment.content}</p>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        {comments.length === 0 && (
          <div className="text-center py-12">
            <p className="text-slate-400 font-medium italic">No comments yet. Be the first to start the conversation!</p>
          </div>
        )}
      </div>
    </div>
  );
}
