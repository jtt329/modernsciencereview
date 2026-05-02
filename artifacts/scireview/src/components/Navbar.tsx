import React from 'react';
import { motion } from 'framer-motion';
import { LogIn, LogOut, PlusCircle, User, BarChart2, Trash2, Wand2 } from 'lucide-react';

interface NavbarProps {
  user: any;
  isAdmin: boolean;
  onLogin: () => void;
  onLogout: () => void;
  onNewPaper: () => void;
  onHowItWorks: () => void;
  onDeleteAll: () => void;
  onPromptAnalysis: () => void;
  onNewPrompt: () => void;
}

export default function Navbar({ user, isAdmin, onLogin, onLogout, onNewPaper, onHowItWorks, onDeleteAll, onPromptAnalysis, onNewPrompt }: NavbarProps) {
  return (
    <nav className="sticky top-0 z-50 bg-gradient-to-r from-indigo-950 to-slate-900 border-b border-white/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
          <div className="cursor-pointer" onClick={() => window.location.href = '/'}>
            <span className="text-2xl font-black tracking-tight leading-none text-white">ModernScience<span className="text-indigo-400">.</span>Review</span>
          </div>

          <div className="flex items-center gap-3">
            {user ? (
              <>
                {isAdmin && (
                  <>
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={onNewPrompt}
                      title="Re-Review All Papers with a New Prompt"
                      className="flex items-center gap-2 bg-white/10 border border-white/20 text-violet-300 px-3 py-2 rounded-full font-medium text-sm hover:bg-white/15 transition-colors"
                    >
                      <Wand2 className="w-4 h-4" />
                      <span className="hidden sm:inline">New Prompt</span>
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={onPromptAnalysis}
                      title="View Prompt Analysis"
                      className="flex items-center gap-2 bg-white/10 border border-white/20 text-indigo-300 px-3 py-2 rounded-full font-medium text-sm hover:bg-white/15 transition-colors"
                    >
                      <BarChart2 className="w-4 h-4" />
                      <span className="hidden sm:inline">Analysis</span>
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={onDeleteAll}
                      title="Snapshot & Delete All Papers"
                      className="flex items-center gap-2 bg-white/10 border border-white/20 text-rose-300 px-3 py-2 rounded-full font-medium text-sm hover:bg-white/15 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span className="hidden sm:inline">Delete All</span>
                    </motion.button>
                  </>
                )}
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={onHowItWorks}
                  className="flex items-center gap-2 bg-white/10 border border-white/20 text-white px-4 py-2 rounded-full font-medium text-sm hover:bg-white/15 transition-colors"
                >
                  How It Works
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={onNewPaper}
                  className="flex items-center gap-2 bg-indigo-500 text-white px-4 py-2 rounded-full font-medium text-sm shadow-sm hover:bg-indigo-400 transition-colors"
                >
                  <PlusCircle className="w-4 h-4" />
                  Submit Paper
                </motion.button>
                <div className="flex items-center gap-3 pl-3 border-l border-white/20">
                  <div className="flex flex-col items-end">
                    <span className="text-sm font-medium text-white">{user.displayName}</span>
                    <button onClick={onLogout} className="text-xs text-slate-400 hover:text-indigo-300 flex items-center gap-1">
                      <LogOut className="w-3 h-3" /> Sign Out
                    </button>
                  </div>
                  {user.photoURL ? (
                    <img src={user.photoURL} alt={user.displayName} className="w-8 h-8 rounded-full border border-white/20" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center border border-white/20">
                      <User className="w-4 h-4 text-slate-300" />
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={onHowItWorks}
                  className="flex items-center gap-2 bg-white/10 border border-white/20 text-white px-4 py-2 rounded-full font-medium text-sm hover:bg-white/15 transition-colors"
                >
                  How It Works
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={onLogin}
                  className="flex items-center gap-2 bg-indigo-500 text-white px-4 py-2 rounded-full font-medium text-sm shadow-sm hover:bg-indigo-400 transition-colors"
                >
                  <LogIn className="w-4 h-4" />
                  Sign In
                </motion.button>
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
