import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Upload, Brain, Globe, Loader2 } from 'lucide-react';

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
    title: 'The system runs multiple identity-blind reviews',
    desc: 'The manuscript is stripped of identifying information before review — an identity-blind protocol, not a guarantee of non-recognition: the model discloses when it nevertheless recognizes a work, recognition is flagged on the review, and recognition rates are published in the audit export. Each manuscript is reviewed several times independently and the system combines those reviews into one result.',
  },
  {
    icon: Globe,
    color: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    title: 'A public result is published',
    desc: 'The site shows a plain-language category, a score range, and a short verdict. The goal is to show both the judgment and how stable that judgment was, without relying on prestige or citation history.',
  },
];

export default function HowItWorksModal({ onClose }: HowItWorksModalProps) {
  const [prompt, setPrompt] = useState<string | null>(null);
  const [promptLoading, setPromptLoading] = useState(false);

  useEffect(() => {
    if (prompt !== null) return;
    setPromptLoading(true);
    fetch('/api/papers/system-prompt', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setPrompt(d.prompt))
      .catch(() => setPrompt('Failed to load system prompt.'))
      .finally(() => setPromptLoading(false));
  }, [prompt]);

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

            <div className="border border-slate-200 rounded-3xl overflow-hidden bg-white">
              <div className="px-6 py-5 border-b border-slate-100">
                <span className="font-black text-slate-900 text-xl">System Prompt</span>
                <p className="text-sm text-slate-500 mt-1">The exact instructions the review system receives for every review pass</p>
              </div>

              <div className="bg-slate-950 px-6 py-6">
                {promptLoading ? (
                  <div className="flex items-center gap-2 text-slate-400 text-sm py-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                  </div>
                ) : (
                  <pre className="text-slate-200 text-[15px] leading-8 whitespace-pre-wrap font-mono">
                    {prompt}
                  </pre>
                )}
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
