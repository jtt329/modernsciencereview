import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Loader2 } from 'lucide-react';

interface SandboxViewerProps {
  onClose: () => void;
}

type SandboxRow = {
  id: string;
  paperId: string;
  paperTitle: string | null;
  label: string;
  promptHash: string;
  promptText: string;
  modelName: string | null;
  createdAt: string;
  inputStrengthScore: number | null;
  constructionStrengthScore: number | null;
  outputStrengthScore: number | null;
  computedScore: number | null;
  subscoreRationale: Record<string, string> | null;
  scientificReview: string | null;
  canonical: {
    promptVersion: string | null;
    inputStrengthScore: number | null;
    constructionStrengthScore: number | null;
    outputStrengthScore: number | null;
    computedScore: number | null;
  } | null;
};

// Admin-only sandbox viewer: sandbox_reviews grouped by prompt, each row
// side-by-side with the paper's canonical review. Sandbox rows never enter
// feeds, exports, clustering, or calibration — this page is read-only.
export default function SandboxViewer({ onClose }: SandboxViewerProps) {
  const [rows, setRows] = useState<SandboxRow[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/admin/sandbox-reviews')
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (response.ok && Array.isArray(data?.sandboxReviews)) setRows(data.sandboxReviews);
        else setError(data?.error ?? 'Could not load sandbox reviews (admin only).');
      })
      .catch(() => setError('Could not load sandbox reviews.'));
  }, []);

  // Group by prompt hash; display label = the most common label prefix
  // (text before ":") within the group.
  const groups = (rows ?? []).reduce((accumulator, row) => {
    const group = accumulator.get(row.promptHash) ?? [];
    group.push(row);
    accumulator.set(row.promptHash, group);
    return accumulator;
  }, new Map<string, SandboxRow[]>());
  const groupLabel = (groupRows: SandboxRow[]) => {
    const counts = new Map<string, number>();
    for (const row of groupRows) {
      const prefix = row.label.includes(':') ? row.label.split(':')[0] : row.label;
      counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unlabeled';
  };

  const delta = (sandbox: number | null, canonical: number | null | undefined) => {
    if (sandbox == null || canonical == null) return '';
    const diff = Number(sandbox) - Number(canonical);
    if (diff === 0) return ' (=)';
    return ` (${diff > 0 ? '+' : ''}${Math.round(diff * 10) / 10})`;
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-slate-50 overflow-y-auto"
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-6">
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm px-7 py-6">
          <button
            onClick={onClose}
            className="inline-flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-indigo-600 transition-colors mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to homepage
          </button>
          <h2 className="text-3xl font-black text-slate-900">Prompt Sandbox</h2>
          <p className="text-base text-slate-500 mt-1">
            Sandbox runs grouped by prompt. Read-only: these reviews never enter feeds, exports, clustering, or calibration.
          </p>
        </div>

        {error && <p className="text-sm text-rose-600">{error}</p>}
        {rows === null && !error && (
          <div className="flex items-center gap-2 text-slate-400 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        )}
        {rows !== null && rows.length === 0 && (
          <p className="text-sm text-slate-500">No sandbox reviews stored yet.</p>
        )}

        {[...groups.entries()].map(([promptHash, groupRows]) => (
          <div key={promptHash} className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100">
              <span className="font-black text-slate-900 text-lg">{groupLabel(groupRows)}</span>
              <span className="ml-3 text-xs font-mono text-slate-400">prompt {promptHash} · {groupRows.length} run{groupRows.length === 1 ? '' : 's'}</span>
            </div>
            <div className="px-6 py-4 space-y-3">
              <details className="border border-slate-200 rounded-2xl bg-slate-50 px-4 py-3">
                <summary className="cursor-pointer text-sm font-bold text-slate-700">Exact prompt text ({promptHash})</summary>
                <pre className="mt-2 max-h-72 overflow-y-auto text-xs text-slate-600 whitespace-pre-wrap font-mono">
                  {groupRows[0]?.promptText}
                </pre>
              </details>
              <table className="w-full text-sm text-slate-600">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-widest text-slate-400">
                    <th className="py-1 pr-3">Paper · run label</th>
                    <th className="py-1 pr-3">I</th>
                    <th className="py-1 pr-3">C</th>
                    <th className="py-1 pr-3">O</th>
                    <th className="py-1 pr-3">Score</th>
                    <th className="py-1">vs canonical</th>
                  </tr>
                </thead>
                <tbody>
                  {groupRows.map((row) => (
                    <React.Fragment key={row.id}>
                      <tr className="border-t border-slate-100 align-top">
                        <td className="py-2 pr-3">
                          <span className="font-bold text-slate-800">{row.paperTitle ?? row.paperId}</span>
                          <span className="block text-xs text-slate-400">{row.label}</span>
                        </td>
                        <td className="py-2 pr-3">{row.inputStrengthScore ?? '—'}{delta(row.inputStrengthScore, row.canonical?.inputStrengthScore)}</td>
                        <td className="py-2 pr-3">{row.constructionStrengthScore ?? '—'}{delta(row.constructionStrengthScore, row.canonical?.constructionStrengthScore)}</td>
                        <td className="py-2 pr-3">{row.outputStrengthScore ?? '—'}{delta(row.outputStrengthScore, row.canonical?.outputStrengthScore)}</td>
                        <td className="py-2 pr-3 font-bold text-slate-800">{row.computedScore ?? '—'}{delta(row.computedScore, row.canonical?.computedScore)}</td>
                        <td className="py-2 text-xs text-slate-400">
                          {row.canonical
                            ? `${row.canonical.computedScore ?? '—'} under ${row.canonical.promptVersion ?? 'active'}`
                            : 'no canonical review'}
                        </td>
                      </tr>
                      {(row.subscoreRationale || row.scientificReview) && (
                        <tr className="border-t border-slate-50">
                          <td colSpan={6} className="pb-3">
                            <details>
                              <summary className="cursor-pointer text-xs font-bold text-indigo-600">Rationales</summary>
                              <div className="mt-2 space-y-2 text-xs text-slate-600">
                                {(['inputStrengthScore', 'constructionStrengthScore', 'outputStrengthScore'] as const).map((key) =>
                                  row.subscoreRationale?.[key] ? (
                                    <p key={key}><span className="font-bold text-slate-700">{key.replace('StrengthScore', '')}: </span>{row.subscoreRationale[key]}</p>
                                  ) : null,
                                )}
                                {row.scientificReview && (
                                  <p><span className="font-bold text-slate-700">review: </span>{row.scientificReview}</p>
                                )}
                              </div>
                            </details>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}
