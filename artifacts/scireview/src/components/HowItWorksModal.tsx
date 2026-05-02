import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Upload, Brain, Globe, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';

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
    title: 'Gemini 3.1 Pro reviews it',
    desc: 'The AI reads the full manuscript with extended thinking enabled. It evaluates the central claim, methodology, novelty, and scientific merit — completely blind to author identity, institution, and citation counts.',
  },
  {
    icon: Globe,
    color: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    title: 'Review is published instantly',
    desc: 'A scored, structured review appears on the public feed within seconds. The score reflects intrinsic scientific merit only — no prestige, no h-index, no journal bias.',
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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.97 }}
        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
        className="bg-white rounded-3xl shadow-2xl w-full max-w-xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-7 pt-7 pb-5 border-b border-slate-100">
          <div>
            <h2 className="text-2xl font-black text-slate-900">How It Works</h2>
            <p className="text-sm text-slate-500 mt-0.5">Blind AI peer review in three steps</p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4 text-slate-600" />
          </button>
        </div>

        <div className="px-7 py-6 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* Steps */}
          {STEPS.map((step, i) => (
            <div key={i} className="flex gap-4">
              <div className={`shrink-0 w-10 h-10 rounded-xl border flex items-center justify-center ${step.color}`}>
                <step.icon className="w-4.5 h-4.5 w-5 h-5" />
              </div>
              <div className="pt-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Step {i + 1}</span>
                </div>
                <h3 className="font-bold text-slate-900 text-base leading-snug">{step.title}</h3>
                <p className="text-sm text-slate-500 mt-1 leading-relaxed">{step.desc}</p>
              </div>
            </div>
          ))}

          {/* Blind review callout */}
          <div className="bg-indigo-50 border border-indigo-100 rounded-2xl px-5 py-4">
            <p className="text-sm text-indigo-800 font-medium leading-relaxed">
              <span className="font-black">Why blind?</span> Traditional peer review is riddled with prestige bias. Here, the AI never sees the author's name, institution, or citation count — only the science.
            </p>
          </div>

          {/* System prompt toggle */}
          <div className="border border-slate-200 rounded-2xl overflow-hidden">
            <button
              onClick={() => setShowPrompt(v => !v)}
              className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors"
            >
              <div className="text-left">
                <span className="font-bold text-slate-800 text-sm">View the System Prompt</span>
                <p className="text-xs text-slate-400 mt-0.5">The exact instructions Gemini receives for every review</p>
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
                      <pre className="text-slate-300 text-xs leading-relaxed whitespace-pre-wrap font-mono">
                        {prompt}
                      </pre>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
