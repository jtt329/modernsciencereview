import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Upload, Brain, Globe, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';

interface HowItWorksModalProps {
  onClose: () => void;
}

const STEPS = [
  {
    icon: Upload,
    color: 'bg-indigo-50 text-indigo-600 border-indigo-100',
    title: 'Submit your paper',
    desc: 'Paste raw text, upload a PDF, or provide a URL to any publicly accessible paper. No formatting required.',
  },
  {
    icon: Brain,
    color: 'bg-violet-50 text-violet-600 border-violet-100',
    title: 'The system runs multiple blind reviews',
    desc: 'The manuscript is anonymized and reviewed several times independently. The system then compares those reviews, looks for agreement and disagreement, and creates one combined result.',
  },
  {
    icon: Globe,
    color: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    title: 'A public result is published',
    desc: 'The site shows a plain-language category, a score range, and a short verdict. The goal is to show both the judgment and how stable that judgment was, without relying on prestige or citation history.',
  },
];

export default function HowItWorksModal({ onClose }: HowItWorksModalProps) {
  const [showPrompt, setShowPrompt] = useState(false);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [promptLoading, setPromptLoading] = useState(false);

  useEffect(() => {
    if (showPrompt && prompt === null) {
      setPromptLoading(true);
      fetch('/api/papers/system-prompt', { credentials: 'include' })
        .then(r => r.json())
        .then(d => setPrompt(d.prompt))
        .catch(() => setPrompt('Failed to load system prompt.'))
        .finally(() => setPromptLoading(false));
    }
  }, [showPrompt]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-slate-50 overflow-y-auto"
    >
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 16 }}
        className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8"
      >
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-7 py-6 border-b border-slate-100">
            <div>
              <button
                onClick={onClose}
                className="inline-flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-indigo-600 transition-colors mb-4"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to homepage
              </button>
              <h2 className="text-3xl font-black text-slate-900">How It Works</h2>
              <p className="text-base text-slate-500 mt-1">Blind AI manuscript review, shown in a readable full-page view</p>
            </div>
          </div>

          <div className="px-7 py-8 space-y-8">
            <div className="grid lg:grid-cols-3 gap-5">
              {STEPS.map((step, i) => (
                <div key={i} className="bg-slate-50 border border-slate-200 rounded-3xl p-6">
                  <div className={`shrink-0 w-12 h-12 rounded-2xl border flex items-center justify-center ${step.color}`}>
                    <step.icon className="w-5 h-5" />
                  </div>
                  <div className="pt-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Step {i + 1}</span>
                    </div>
                    <h3 className="font-black text-slate-900 text-lg leading-snug">{step.title}</h3>
                    <p className="text-sm text-slate-500 mt-2 leading-relaxed">{step.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="border border-slate-200 rounded-2xl overflow-hidden">
              <button
                onClick={() => setShowPrompt(v => !v)}
                className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors"
              >
                <div className="text-left">
                  <span className="font-bold text-slate-800 text-sm">View the System Prompt</span>
                  <p className="text-xs text-slate-400 mt-0.5">The exact instructions the review system receives for every pass</p>
                </div>
                {showPrompt ? (
                  <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                )}
              </button>

              <AnimatePresence>
                {showPrompt && (
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: 'auto' }}
                    exit={{ height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="border-t border-slate-100 bg-slate-950 px-5 py-4 max-h-72 overflow-y-auto">
                      {promptLoading ? (
                        <div className="flex items-center gap-2 text-slate-400 text-sm py-2">
                          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                        </div>
                      ) : (
                        <pre className="text-slate-300 text-sm leading-relaxed whitespace-pre-wrap font-mono min-h-[32rem]">
                          {prompt}
                        </pre>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-5">
              <p className="text-xs font-black text-indigo-500 uppercase tracking-widest">Note</p>
              <p className="text-sm text-slate-600 mt-2 leading-relaxed">
                This page shows the prompt currently being served by the site backend. If the backend has not been updated yet, this text can still reflect the older live review prompt even if the homepage version badge changed.
              </p>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
