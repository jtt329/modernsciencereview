import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronDown, ChevronUp, BarChart2, FileText, Clock, Cpu, RotateCcw, CheckCircle2, AlertCircle } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from 'recharts';

interface StoredReview {
  centralClaim?: string;
  establishedResults?: string;
  interpretiveClaims?: string;
  speculativeClaims?: string;
  economy?: string;
  scopeDepth?: string;
  unifyingPower?: string;
  strongestCaseForImportance?: string;
  strongestObjection?: string;
  decisiveCheck?: string;
  internalTechnicalTraction?: string;
  noveltyConfidence?: number | string;
  explanatoryTargetBreadth?: string;
  theorySpaceBreadth?: string;
  finalJudgment?: string;
  bestClassification?: string;
  overallIntrinsicScore?: number;
  intrinsicScientificMeritScore?: number;
  explanatoryTargetBreadthScore?: number;
  theorySpaceBreadthScore?: number;
  breadthOfImpactScore?: number;
  modelName?: string;
  summary?: string;
  overallEvaluation?: string;
}

interface SessionPaper {
  id: string;
  title: string;
  paperAuthors?: string;
  field?: string;
  modelName?: string;
  bestClassification?: string;
  overallScore?: number;
  intrinsicMeritScore?: number;
  explanatoryTargetBreadthScore?: number;
  theorySpaceBreadthScore?: number;
  breadthOfImpactScore?: number;
  reviewJson?: string | null;
}

interface Session {
  id: string;
  promptText: string;
  modelNames: string;
  paperCount: number;
  createdAt: string;
  papers: SessionPaper[];
}

interface Props {
  onClose: () => void;
}

const SCORE_COLOR = (score: number) =>
  score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : '#ef4444';

function cleanTitle(title: string) {
  return title.replace(/^(\[PDF\]|\[PDF Upload\])\s*/i, '');
}

function truncate(text: string, max = 30) {
  return text.length > max ? text.slice(0, max) + '…' : text;
}

const REVIEW_SECTIONS: { key: keyof StoredReview; label: string }[] = [
  { key: 'centralClaim', label: 'Central Claim' },
  { key: 'establishedResults', label: 'Established Results' },
  { key: 'interpretiveClaims', label: 'Interpretive Claims' },
  { key: 'speculativeClaims', label: 'Speculative Claims' },
  { key: 'economy', label: 'Economy' },
  { key: 'scopeDepth', label: 'Scope & Depth' },
  { key: 'unifyingPower', label: 'Unifying Power' },
  { key: 'explanatoryTargetBreadth', label: 'Explanatory Target Breadth' },
  { key: 'theorySpaceBreadth', label: 'Theory Space Breadth' },
  { key: 'strongestCaseForImportance', label: 'Strongest Case for Importance' },
  { key: 'strongestObjection', label: 'Strongest Objection' },
  { key: 'decisiveCheck', label: 'Decisive Check' },
  { key: 'internalTechnicalTraction', label: 'Internal Technical Traction' },
  { key: 'finalJudgment', label: 'Final Judgment' },
];

function ReviewPanel({ reviewJson }: { reviewJson: string }) {
  let rv: StoredReview = {};
  try { rv = JSON.parse(reviewJson); } catch { return <p className="text-xs text-slate-400 italic">Could not parse review.</p>; }

  const scores = [
    { label: 'Overall', value: rv.overallIntrinsicScore, max: 100 },
    { label: 'Merit', value: rv.intrinsicScientificMeritScore, max: 10 },
    { label: 'Target', value: rv.explanatoryTargetBreadthScore, max: 10 },
    { label: 'Theory', value: rv.theorySpaceBreadthScore, max: 10 },
    { label: 'Impact', value: rv.breadthOfImpactScore, max: 10 },
  ].filter(s => s.value != null);

  return (
    <div className="space-y-4">
      {/* Model + classification */}
      <div className="flex flex-wrap items-center gap-2">
        {rv.modelName && (
          <span className="flex items-center gap-1 text-[11px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 px-2 py-1 rounded-lg">
            <Cpu className="w-3 h-3" /> {rv.modelName}
          </span>
        )}
        {rv.bestClassification && (
          <span className="text-[11px] font-bold text-slate-600 bg-slate-100 border border-slate-200 px-2 py-1 rounded-lg uppercase tracking-wide">
            {rv.bestClassification}
          </span>
        )}
      </div>

      {/* Score pills */}
      {scores.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {scores.map(s => (
            <div key={s.label} className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl px-3 py-1.5 shadow-sm">
              <span className="text-[11px] font-bold text-slate-500">{s.label}</span>
              <span className="text-sm font-black" style={{ color: SCORE_COLOR(s.max === 100 ? (s.value ?? 0) : (s.value ?? 0) * 10) }}>
                {s.value}/{s.max}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Novelty confidence */}
      {rv.noveltyConfidence != null && (
        <p className="text-xs text-slate-500">
          <span className="font-bold">Novelty confidence:</span> {rv.noveltyConfidence}
        </p>
      )}

      {/* Text sections */}
      <div className="space-y-3">
        {REVIEW_SECTIONS.map(({ key, label }) => {
          const val = rv[key];
          if (!val || typeof val !== 'string') return null;
          return (
            <div key={key} className="bg-slate-50 border border-slate-200 rounded-xl p-3">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</p>
              <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">{val}</p>
            </div>
          );
        })}

        {/* Legacy fields fallback */}
        {rv.summary && !rv.centralClaim && (
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Summary</p>
            <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">{rv.summary}</p>
          </div>
        )}
        {rv.overallEvaluation && !rv.finalJudgment && (
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Overall Evaluation</p>
            <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">{rv.overallEvaluation}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function PaperRow({ paper }: { paper: SessionPaper }) {
  const [expanded, setExpanded] = useState(false);
  const hasReview = !!paper.reviewJson;

  return (
    <>
      <tr
        className={`border-b border-slate-100 transition-colors ${hasReview ? 'cursor-pointer hover:bg-indigo-50/50' : ''}`}
        onClick={() => hasReview && setExpanded(v => !v)}
      >
        <td className="py-2 pr-4 max-w-[200px]">
          <div className="flex items-center gap-1.5">
            {hasReview && (
              expanded
                ? <ChevronUp className="w-3 h-3 text-indigo-400 shrink-0" />
                : <ChevronDown className="w-3 h-3 text-indigo-400 shrink-0" />
            )}
            <div className="min-w-0">
              <p className="font-bold text-slate-800 truncate">{cleanTitle(paper.title)}</p>
              {paper.bestClassification && (
                <p className="text-[10px] text-slate-400">{paper.bestClassification}</p>
              )}
            </div>
          </div>
        </td>
        <td className="py-2 pr-3 text-slate-500 whitespace-nowrap text-xs">{paper.field || '—'}</td>
        <td className="py-2 pr-3 text-slate-500 whitespace-nowrap text-xs">{paper.modelName || '—'}</td>
        <td className="py-2 pr-3 text-right font-black text-xs" style={{ color: SCORE_COLOR(paper.overallScore ?? 0) }}>
          {paper.overallScore ?? '—'}
        </td>
        <td className="py-2 pr-3 text-right text-slate-600 text-xs">{paper.intrinsicMeritScore ?? '—'}</td>
        <td className="py-2 pr-3 text-right text-slate-600 text-xs">{paper.explanatoryTargetBreadthScore ?? '—'}</td>
        <td className="py-2 pr-3 text-right text-slate-600 text-xs">{paper.theorySpaceBreadthScore ?? '—'}</td>
        <td className="py-2 text-right text-slate-600 text-xs">{paper.breadthOfImpactScore ?? '—'}</td>
      </tr>
      <AnimatePresence>
        {expanded && paper.reviewJson && (
          <tr>
            <td colSpan={8} className="p-0">
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="px-4 py-4 bg-indigo-50/30 border-b border-slate-100">
                  <ReviewPanel reviewJson={paper.reviewJson} />
                </div>
              </motion.div>
            </td>
          </tr>
        )}
      </AnimatePresence>
    </>
  );
}

function SessionCard({ session }: { session: Session }) {
  const [open, setOpen] = useState(true);
  const [showPrompt, setShowPrompt] = useState(false);
  const [restoreConfirm, setRestoreConfirm] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreResult, setRestoreResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const BASE = import.meta.env.BASE_URL?.replace(/\/$/, '') || '';

  async function handleRestore() {
    setRestoring(true);
    setRestoreResult(null);
    try {
      const r = await fetch(`${BASE}/api/admin/snapshots/${session.id}/restore`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Restore failed');
      setRestoreResult({ ok: true, msg: `${data.restored} paper${data.restored !== 1 ? 's' : ''} restored to the homepage.` });
    } catch (e: any) {
      setRestoreResult({ ok: false, msg: e.message });
    } finally {
      setRestoring(false);
      setRestoreConfirm(false);
    }
  }

  const sortedPapers = [...session.papers].sort(
    (a, b) => (b.overallScore ?? 0) - (a.overallScore ?? 0)
  );

  const chartData = sortedPapers.map(p => ({
    name: truncate(cleanTitle(p.title)),
    fullTitle: cleanTitle(p.title),
    modelName: p.modelName || 'unknown model',
    Overall: p.overallScore ?? 0,
  }));

  return (
    <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
      <div className="flex items-center gap-2 p-5 bg-white border-b border-slate-100">
        {/* Left: expand toggle */}
        <button
          onClick={() => setOpen(v => !v)}
          className="flex-1 flex items-center gap-4 min-w-0 text-left hover:opacity-80 transition-opacity"
        >
          <div className="bg-indigo-100 p-2.5 rounded-xl shrink-0">
            <BarChart2 className="w-5 h-5 text-indigo-600" />
          </div>
          <div className="min-w-0">
            <p className="font-black text-slate-900 text-sm">
              {session.paperCount} paper{session.paperCount !== 1 ? 's' : ''} · {session.modelNames || 'unknown model'}
            </p>
            <p className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5">
              <Clock className="w-3 h-3" />
              {new Date(session.createdAt).toLocaleString()}
            </p>
          </div>
          {open ? <ChevronUp className="w-5 h-5 text-slate-400 shrink-0" /> : <ChevronDown className="w-5 h-5 text-slate-400 shrink-0" />}
        </button>

        {/* Right: restore button */}
        {!restoreConfirm && !restoreResult && (
          <button
            onClick={() => setRestoreConfirm(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 transition-colors shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Restore Batch
          </button>
        )}
        {restoreConfirm && (
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs font-bold text-slate-600">Restore {session.paperCount} papers?</span>
            <button
              onClick={handleRestore}
              disabled={restoring}
              className="px-3 py-1.5 rounded-xl text-xs font-black text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 transition-colors"
            >
              {restoring ? 'Restoring…' : 'Yes, restore'}
            </button>
            <button
              onClick={() => setRestoreConfirm(false)}
              className="px-3 py-1.5 rounded-xl text-xs font-black text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
        {restoreResult && (
          <div className={`flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl shrink-0 ${restoreResult.ok ? 'text-emerald-700 bg-emerald-50' : 'text-rose-700 bg-rose-50'}`}>
            {restoreResult.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
            {restoreResult.msg}
          </div>
        )}
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-slate-100"
          >
            <div className="p-5 space-y-5 bg-slate-50/50">
              {/* Prompt preview */}
              <div className="space-y-2">
                <button
                  onClick={() => setShowPrompt(v => !v)}
                  className="flex items-center gap-2 text-xs font-black text-indigo-600 uppercase tracking-widest hover:text-indigo-800 transition-colors"
                >
                  <FileText className="w-3.5 h-3.5" />
                  {showPrompt ? 'Hide' : 'Show'} Prompt
                  {showPrompt ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
                <AnimatePresence>
                  {showPrompt && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                    >
                      <pre className="text-xs text-slate-600 bg-white border border-slate-200 rounded-xl p-4 whitespace-pre-wrap max-h-64 overflow-y-auto font-sans leading-relaxed">
                        {session.promptText || '(no prompt recorded)'}
                      </pre>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {chartData.length > 0 && (
                <>
                  {/* Overall score chart */}
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Overall Intrinsic Score (/100) — highest first</p>
                    <ResponsiveContainer width="100%" height={Math.max(120, chartData.length * 44)}>
                      <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 40, top: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                        <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} />
                        <YAxis type="category" dataKey="name" width={180} tick={{ fontSize: 11 }} />
                        <Tooltip
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const d = payload[0].payload;
                            return (
                              <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-lg max-w-xs">
                                <p className="text-xs font-bold text-slate-800 mb-1 leading-snug">{d.fullTitle}</p>
                                <p className="text-[11px] text-slate-500 mb-2 flex items-center gap-1">
                                  <Cpu className="w-3 h-3" /> {d.modelName}
                                </p>
                                <p className="text-sm font-black text-indigo-600">{d.Overall}/100 overall</p>
                              </div>
                            );
                          }}
                        />
                        <Bar dataKey="Overall" radius={[0, 6, 6, 0]}>
                          {chartData.map((d, i) => (
                            <Cell key={i} fill={SCORE_COLOR(d.Overall)} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Table with expandable review rows */}
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                      Papers — click a row to read the full review
                    </p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-slate-200">
                            <th className="text-left font-black text-slate-500 pb-2 pr-4">Title</th>
                            <th className="text-left font-black text-slate-500 pb-2 pr-3">Field</th>
                            <th className="text-left font-black text-slate-500 pb-2 pr-3">Model</th>
                            <th className="text-right font-black text-slate-500 pb-2 pr-3">Overall</th>
                            <th className="text-right font-black text-slate-500 pb-2 pr-3">Merit</th>
                            <th className="text-right font-black text-slate-500 pb-2 pr-3">Target</th>
                            <th className="text-right font-black text-slate-500 pb-2 pr-3">Theory</th>
                            <th className="text-right font-black text-slate-500 pb-2">Impact</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedPapers.map(p => <PaperRow key={p.id} paper={p} />)}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}

              {session.papers.length === 0 && (
                <p className="text-sm text-slate-400 italic">No paper data recorded for this session.</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function PromptAnalysis({ onClose }: Props) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const BASE = import.meta.env.BASE_URL?.replace(/\/$/, '') || '';

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${BASE}/api/admin/snapshots`, { credentials: 'include' });
        if (!r.ok) throw new Error(await r.text());
        setSessions(await r.json());
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-white w-full max-w-5xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-indigo-600 text-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-2 rounded-xl">
              <BarChart2 className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-black tracking-tight">Prompt Analysis</h2>
              <p className="text-xs font-bold text-indigo-200 uppercase tracking-widest">
                {sessions.length} session{sessions.length !== 1 ? 's' : ''} recorded
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {loading && (
            <div className="flex items-center justify-center py-16 text-slate-400">
              <Cpu className="w-6 h-6 animate-spin mr-3" /> Loading sessions…
            </div>
          )}
          {error && (
            <div className="text-rose-600 text-sm font-medium p-4 bg-rose-50 rounded-xl">{error}</div>
          )}
          {!loading && !error && sessions.length === 0 && (
            <div className="text-center py-16 text-slate-400">
              <BarChart2 className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p className="font-bold">No sessions yet.</p>
              <p className="text-sm mt-1">Use "Delete All" to snapshot and save the current papers.</p>
            </div>
          )}
          {sessions.map(s => <SessionCard key={s.id} session={s} />)}
        </div>
      </motion.div>
    </motion.div>
  );
}
