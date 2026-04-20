import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Wand2, Loader2, CheckCircle2, AlertCircle, ChevronDown } from 'lucide-react';

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, '') || '';

interface Job {
  total: number;
  done: number;
  skipped: number;
  status: 'running' | 'done' | 'error';
  error?: string;
}

interface Props {
  onClose: () => void;
  onComplete: () => void;
}

export default function NewPromptModal({ onClose, onComplete }: Props) {
  const [promptText, setPromptText] = useState('');
  const [model, setModel] = useState<'gpt' | 'gemini'>('gpt');
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  useEffect(() => {
    if (!jobId) return;
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`${BASE}/api/admin/re-review/${jobId}`, { credentials: 'include' });
        if (!r.ok) return;
        const data: Job = await r.json();
        setJob(data);
        if (data.status === 'done' || data.status === 'error') {
          if (pollRef.current) clearInterval(pollRef.current);
          if (data.status === 'done') {
            onComplete();
          }
        }
      } catch { /* ignore poll errors */ }
    }, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [jobId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!promptText.trim()) { setError('Please paste in a prompt.'); return; }
    setError(null);
    setSubmitting(true);
    try {
      const r = await fetch(`${BASE}/api/admin/re-review`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promptText: promptText.trim(), model }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Failed to start re-review');
      setJobId(data.jobId);
      setJob({ total: data.total, done: 0, skipped: 0, status: 'running' });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const pct = job ? Math.round((job.done / Math.max(job.total, 1)) * 100) : 0;
  const isRunning = job?.status === 'running';
  const isDone = job?.status === 'done';
  const isError = job?.status === 'error';

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
        onClick={e => { if (e.target === e.currentTarget && !isRunning) onClose(); }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 16 }}
          className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <div className="bg-violet-100 p-2.5 rounded-xl">
                <Wand2 className="w-5 h-5 text-violet-600" />
              </div>
              <div>
                <h2 className="text-lg font-black text-slate-900">Re-Review with New Prompt</h2>
                <p className="text-xs text-slate-500 font-medium mt-0.5">
                  Snapshots current reviews → Analysis, then re-runs all papers with your new prompt
                </p>
              </div>
            </div>
            {!isRunning && (
              <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors p-1">
                <X className="w-5 h-5" />
              </button>
            )}
          </div>

          {/* Body */}
          <div className="p-6 space-y-5">
            {!job && (
              <form onSubmit={handleSubmit} className="space-y-5">
                {/* Model selector */}
                <div className="space-y-1.5">
                  <label className="text-xs font-black text-slate-700 uppercase tracking-wide">Model</label>
                  <div className="relative">
                    <select
                      value={model}
                      onChange={e => setModel(e.target.value as 'gpt' | 'gemini')}
                      className="w-full appearance-none bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent pr-9"
                    >
                      <option value="gpt">GPT-5.4 Pro</option>
                      <option value="gemini">Gemini 3.1 Pro Preview</option>
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  </div>
                </div>

                {/* Prompt textarea */}
                <div className="space-y-1.5">
                  <label className="text-xs font-black text-slate-700 uppercase tracking-wide">
                    New System Prompt
                  </label>
                  <textarea
                    value={promptText}
                    onChange={e => setPromptText(e.target.value)}
                    placeholder="Paste your new system prompt here…"
                    rows={14}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent resize-none leading-relaxed"
                  />
                  <p className="text-xs text-slate-400 font-medium">
                    {promptText.trim().length.toLocaleString()} characters
                  </p>
                </div>

                {error && (
                  <div className="flex items-start gap-2 text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-sm font-medium">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting || !promptText.trim()}
                  className="w-full flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white font-black py-3 rounded-2xl transition-colors text-sm"
                >
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                  {submitting ? 'Starting…' : 'Run Re-Review'}
                </button>
              </form>
            )}

            {/* Progress state */}
            {job && (
              <div className="space-y-5">
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-sm font-bold text-slate-700">
                    <span>
                      {isDone ? 'Re-review complete' : isError ? 'Job failed' : `Re-reviewing papers…`}
                    </span>
                    <span className="tabular-nums">
                      {job.done} / {job.total}
                      {job.skipped > 0 && <span className="text-slate-400 font-medium ml-2">({job.skipped} skipped)</span>}
                    </span>
                  </div>

                  {/* Progress bar */}
                  <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
                    <motion.div
                      className={`h-3 rounded-full ${isDone ? 'bg-emerald-500' : isError ? 'bg-rose-500' : 'bg-violet-500'}`}
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.4 }}
                    />
                  </div>

                  {isRunning && (
                    <p className="text-xs text-slate-500 font-medium flex items-center gap-1.5">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Each paper takes ~20–40 seconds. You can leave this open or close the tab — reviews save automatically.
                    </p>
                  )}
                </div>

                {isDone && (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-5 py-4 space-y-2">
                    <div className="flex items-center gap-2 text-emerald-700 font-black text-sm">
                      <CheckCircle2 className="w-4 h-4" />
                      All done! {job.done - job.skipped} paper{job.done - job.skipped !== 1 ? 's' : ''} re-reviewed.
                    </div>
                    {job.skipped > 0 && (
                      <p className="text-xs text-emerald-600 font-medium">
                        {job.skipped} paper{job.skipped !== 1 ? 's were' : ' was'} skipped (PDF content not available for re-review).
                      </p>
                    )}
                    <p className="text-xs text-emerald-600 font-medium">
                      Previous reviews were saved to Analysis. Homepage has been refreshed with new reviews.
                    </p>
                    <button
                      onClick={onClose}
                      className="mt-1 w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black py-2.5 rounded-xl text-sm transition-colors"
                    >
                      Close
                    </button>
                  </div>
                )}

                {isError && (
                  <div className="bg-rose-50 border border-rose-200 rounded-2xl px-5 py-4 space-y-2">
                    <div className="flex items-center gap-2 text-rose-700 font-black text-sm">
                      <AlertCircle className="w-4 h-4" />
                      Job failed
                    </div>
                    <p className="text-xs text-rose-600 font-medium">{job.error}</p>
                    <button onClick={onClose} className="mt-1 w-full bg-rose-600 hover:bg-rose-700 text-white font-black py-2.5 rounded-xl text-sm transition-colors">
                      Close
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
