import React from 'react';
import { motion } from 'framer-motion';
import { BookOpen, LogIn, LogOut, PlusCircle, User } from 'lucide-react';

interface NavbarProps {
  user: any;
  onLogin: () => void;
  onLogout: () => void;
  onNewPaper: () => void;
  onBulkUpload: () => void;
  adminEmail?: string;
}

export default function Navbar({ user, onLogin, onLogout, onNewPaper, onBulkUpload, adminEmail }: NavbarProps) {
  const isAdmin = adminEmail && user?.email === adminEmail;

  return (
    <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => window.location.href = '/'}>
            <div className="bg-indigo-600 p-2 rounded-lg shadow-lg shadow-indigo-100">
              <BookOpen className="w-6 h-6 text-white" />
            </div>
            <div className="flex flex-col">
              <span className="text-xl font-black tracking-tight text-slate-900 leading-none">SciReview AI</span>
              <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest mt-1">Powered by GPT-4.5 Pro</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {user ? (
              <>
                {isAdmin && (
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={onBulkUpload}
                    className="flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-full font-medium text-sm shadow-sm hover:bg-slate-800 transition-colors"
                  >
                    <PlusCircle className="w-4 h-4" />
                    Bulk Upload
                  </motion.button>
                )}
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={onNewPaper}
                  className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-full font-medium text-sm shadow-sm hover:bg-indigo-700 transition-colors"
                >
                  <PlusCircle className="w-4 h-4" />
                  Submit Paper
                </motion.button>
                <div className="flex items-center gap-3 pl-4 border-l border-slate-200">
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
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={onLogin}
                className="flex items-center gap-2 bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-full font-medium text-sm shadow-sm hover:bg-slate-50 transition-colors"
              >
                <LogIn className="w-4 h-4" />
                Sign In with Google
              </motion.button>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
