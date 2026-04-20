import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronDown, ChevronUp, BarChart2, FileText, Clock, Cpu } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell
} from 'recharts';

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

const SUBSCORE_COLORS = ['#6366f1', '#0ea5e9', '#8b5cf6', '#a855f7'];

function truncate(text: string, max = 300) {
  return text.length > max ? text.slice(0, max) + '…' : text;
}

function cleanTitle(title: string) {
  return title.replace(/^(\[PDF\]|\[PDF Upload\])\s*/i, '');
}

function SessionCard({ session }: { session: Session }) {
  const [open, setOpen] = useState(true);
  const [showPrompt, setShowPrompt] = useState(false);

  const sortedPapers = [...session.papers].sort(
    (a, b) => (b.overallScore ?? 0) - (a.overallScore ?? 0)
  );

  const chartData = sortedPapers.map(p => ({
    name: truncate(cleanTitle(p.title), 30),
    fullTitle: cleanTitle(p.title),
    modelName: p.modelName || 'unknown model',
    Overall: p.overallScore ?? 0,
    'Intrinsic Merit': p.intrinsicMeritScore ?? 0,
    'Target Breadth': p.explanatoryTargetBreadthScore ?? 0,
    'Theory Breadth': p.theorySpaceBreadthScore ?? 0,
    'Breadth of Impact': p.breadthOfImpactScore ?? 0,
  }));

  const hasSubScores = chartData.some(
    d => d['Intrinsic Merit'] || d['Target Breadth'] || d['Theory Breadth'] || d['Breadth of Impact']
  );

  return (
    <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between p-5 bg-white hover:bg-slate-50 transition-colors text-left gap-4"
      >
        <div className="flex items-center gap-4 min-w-0">
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
        </div>
        {open ? <ChevronUp className="w-5 h-5 text-slate-400 shrink-0" /> : <ChevronDown className="w-5 h-5 text-slate-400 shrink-0" />}
      </button>

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
                  {/* 1. Sub-scores grouped bar chart */}
                  {hasSubScores && (
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Sub-Scores (/10) — sorted by overall</p>
                      <ResponsiveContainer width="100%" height={Math.max(140, chartData.length * 60)}>
                        <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 40, top: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                          <XAxis type="number" domain={[0, 10]} tick={{ fontSize: 11 }} />
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
                                  {payload.map((entry: any) => (
                                    <p key={entry.dataKey} className="text-xs" style={{ color: entry.fill }}>
                                      {entry.dataKey}: <span className="font-black">{entry.value}/10</span>
                                    </p>
                                  ))}
                                </div>
                              );
                            }}
                          />
                          <Legend wrapperStyle={{ fontSize: 11 }} />
                          {['Intrinsic Merit', 'Target Breadth', 'Theory Breadth', 'Breadth of Impact'].map((key, i) => (
                            <Bar key={key} dataKey={key} fill={SUBSCORE_COLORS[i]} radius={[0, 4, 4, 0]} barSize={8} />
                          ))}
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  {/* 2. Overall score bar chart (middle) */}
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

                  {/* 3. Table — sorted by overall score */}
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
                        {sortedPapers.map(p => (
                          <tr key={p.id} className="border-b border-slate-100 hover:bg-white transition-colors">
                            <td className="py-2 pr-4 max-w-[200px]">
                              <p className="font-bold text-slate-800 truncate">{cleanTitle(p.title)}</p>
                              {p.bestClassification && (
                                <p className="text-slate-400">{p.bestClassification}</p>
                              )}
                            </td>
                            <td className="py-2 pr-3 text-slate-500 whitespace-nowrap">{p.field || '—'}</td>
                            <td className="py-2 pr-3 text-slate-500 whitespace-nowrap">{p.modelName || '—'}</td>
                            <td className="py-2 pr-3 text-right font-black" style={{ color: SCORE_COLOR(p.overallScore ?? 0) }}>
                              {p.overallScore ?? '—'}
                            </td>
                            <td className="py-2 pr-3 text-right text-slate-600">{p.intrinsicMeritScore ?? '—'}</td>
                            <td className="py-2 pr-3 text-right text-slate-600">{p.explanatoryTargetBreadthScore ?? '—'}</td>
                            <td className="py-2 pr-3 text-right text-slate-600">{p.theorySpaceBreadthScore ?? '—'}</td>
                            <td className="py-2 text-right text-slate-600">{p.breadthOfImpactScore ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
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
