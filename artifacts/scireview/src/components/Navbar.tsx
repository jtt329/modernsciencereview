import React from 'react';
import { motion } from 'framer-motion';
import { LogIn, LogOut, PlusCircle, User, BarChart2, Trash2, Download, FileSearch } from 'lucide-react';
import { SITE_VERSION } from '../lib/version';

interface NavbarProps {
  user: any;
  isAdmin: boolean;
  onLogin: () => void;
  onLogout: () => void;
  onNewPaper: () => void;
  onHowItWorks: () => void;
  onDeleteAll: () => void;
  onPromptAnalysis: () => void;
  onDownloadAll: () => void;
  onDownloadAudit: () => void;
}

export default function Navbar({ user, isAdmin, onLogin, onLogout, onNewPaper, onHowItWorks, onDeleteAll, onPromptAnalysis, onDownloadAll, onDownloadAudit }: NavbarProps) {
  return (
    <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
          <div className="cursor-pointer flex items-center gap-3" onClick={() => window.location.href = '/'}>
            <span className="text-2xl font-black tracking-tight leading-none">ModernScience<span className="text-indigo-500">.</span>Review</span>
            <span className="px-2.5 py-1 rounded-full bg-slate-100 border border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-500">
              {SITE_VERSION}
            </span>
          </div>

          <div className="flex items-center gap-3">
            {user ? (
              <>
                {isAdmin && (
                  <>
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={onPromptAnalysis}
                      title="View Prompt Analysis"
                      className="flex items-center gap-2 bg-indigo-50 border border-indigo-200 text-indigo-700 px-3 py-2 rounded-full font-medium text-sm shadow-sm hover:bg-indigo-100 transition-colors"
                    >
                      <BarChart2 className="w-4 h-4" />
                      <span className="hidden sm:inline">Analysis</span>
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={onDownloadAll}
                      title="Download All Reviews as JSON"
                      className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-700 px-3 py-2 rounded-full font-medium text-sm shadow-sm hover:bg-emerald-100 transition-colors"
                    >
                      <Download className="w-4 h-4" />
                      <span className="hidden sm:inline">Export</span>
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={onDownloadAudit}
                      title="Download Pass Audit JSON"
                      className="flex items-center gap-2 bg-cyan-50 border border-cyan-200 text-cyan-700 px-3 py-2 rounded-full font-medium text-sm shadow-sm hover:bg-cyan-100 transition-colors"
                    >
                      <FileSearch className="w-4 h-4" />
                      <span className="hidden sm:inline">Audit</span>
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={onDeleteAll}
                      title="Snapshot & Delete All Papers"
                      className="flex items-center gap-2 bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 rounded-full font-medium text-sm shadow-sm hover:bg-rose-100 transition-colors"
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
                  className="flex items-center gap-2 bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-full font-medium text-sm shadow-sm hover:bg-slate-50 transition-colors"
                >
                  How It Works
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={onNewPaper}
                  className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-full font-medium text-sm shadow-sm hover:bg-indigo-700 transition-colors"
                >
                  <PlusCircle className="w-4 h-4" />
                  Submit Paper
                </motion.button>
                <div className="flex items-center gap-3 pl-3 border-l border-slate-200">
                  <div className="flex flex-col items-end">
                    <span className="text-sm font-medium text-slate-900">{user.displayName}</span>
                    <button onClick={onLogout} className="text-xs text-slate-500 hover:text-indigo-600 flex items-center gap-1">
                      <LogOut className="w-3 h-3" /> Sign Out
                    </button>
                  </div>
                  {user.photoURL ? (
                    <img src={user.photoURL} alt={user.displayName} className="w-8 h-8 rounded-full border border-slate-200" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center border border-slate-200">
                      <User className="w-4 h-4 text-slate-400" />
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
                  className="flex items-center gap-2 bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-full font-medium text-sm shadow-sm hover:bg-slate-50 transition-colors"
                >
                  How It Works
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={onLogin}
                  className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-full font-medium text-sm shadow-sm hover:bg-indigo-700 transition-colors"
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
