// Minimal READ-ONLY field-overview page (FIELD_MAP_and_importance_phase1.md §6, item 9).
// Renders the draft overview pages/sections with source chips (-> paper reviews) and [+]
// progressive disclosure (one-line -> short -> full). No editing UI — browse + catch structure.
import React, { useEffect, useState } from 'react';
import LatexText from './LatexText';

type Ref = {
  id: string; anchorText: string | null; paperId: string | null;
  paperTitle: string | null; paperSlug: string | null; claimIds: string[];
  claimStatus: string | null; provenance: string;
};

// Soft, descriptive cue only — drives nothing. A light suffix; full status on hover.
// Unknown ≠ established (P2): a chip with no claim status renders NEUTRAL grey, never in the
// established style — the product ethos in one CSS class.
const CHIP_CUE: Record<string, { cue: string; cls: string }> = {
  established: { cue: '', cls: 'bg-blue-50 text-blue-700 border-blue-100' },
  contested: { cue: ' · contested', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  speculative: { cue: ' · speculative', cls: 'bg-violet-50 text-violet-700 border-violet-200' },
  failed: { cue: ' · failed', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  mixed: { cue: ' · mixed', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  unknown: { cue: '', cls: 'bg-slate-50 text-slate-500 border-slate-200' },
};
type Span = { id: string; text: string; startOffset: number | null; endOffset: number | null; supportStatus: string; referenceId: string | null };
type PageLink = { id: string; phrase: string; startOffset: number | null; endOffset: number | null; toPageSlug: string; toPageTitle: string; toPageSummary?: string };
type Page = {
  id: string; slug: string; title: string; parentPageId: string | null; scopeStatement: string;
  version: { summaryOneLine: string; summaryShort: string; markdownFull: string; visibility: string };
  sections: { id: string; slug: string; title: string }[];
  references: Ref[]; spans: Span[]; links: PageLink[];
};

const LEVELS = ['one-line', 'short', 'full'] as const;

type Change = { at: string; action: string; pageSlug: string | null; paperId: string | null; paperTitle: string | null };

// Sentence-anchored rendering (slice 5.1/5.2): split the page body at span offsets so each
// sourced sentence carries its chip INLINE (click-a-sentence-see-why) and unsourced
// explanatory prose is visibly distinct (dotted underline). Display only — spans/chips are
// provenance surfacing, never inputs to anything.
function SegmentedBody({ body, spans, references, links, onOpenPaper, onOpenPage }: {
  body: string; spans: Span[]; references: Ref[]; links: PageLink[]; onOpenPaper: (paperId: string) => void; onOpenPage: (slug: string) => void;
}) {
  // Overlays: provenance spans (chips) + inline vocabulary links (retired term-[+] — plain
  // links with the target's one-line summary as hover preview). Non-overlapping, spans win.
  type Overlay = { start: number; end: number; span?: Span; link?: PageLink };
  const overlays: Overlay[] = [];
  for (const s of spans || []) {
    if (s.startOffset != null && s.endOffset != null && s.endOffset <= body.length && body.slice(s.startOffset, s.endOffset) === s.text) {
      overlays.push({ start: s.startOffset, end: s.endOffset, span: s });
    }
  }
  for (const l of links || []) {
    if (l.startOffset != null && l.endOffset != null && l.endOffset <= body.length && body.slice(l.startOffset, l.endOffset) === l.phrase) {
      overlays.push({ start: l.startOffset, end: l.endOffset, link: l });
    }
  }
  overlays.sort((a, b) => a.start - b.start || (a.span ? -1 : 1));
  const chosen: Overlay[] = []; let cursor = 0;
  for (const o of overlays) { if (o.start >= cursor) { chosen.push(o); cursor = o.end; } }
  const refById = new Map(references.map((r) => [r.id, r]));
  const segs: { text: string; span?: Span; link?: PageLink }[] = []; let pos = 0;
  for (const o of chosen) {
    if (o.start > pos) segs.push({ text: body.slice(pos, o.start) });
    segs.push({ text: body.slice(o.start, o.end), span: o.span, link: o.link });
    pos = o.end;
  }
  if (pos < body.length) segs.push({ text: body.slice(pos) });
  return (
    <>
      {segs.map((seg, i) => {
        if (seg.link) {
          return (
            <button key={i} onClick={() => onOpenPage(seg.link!.toPageSlug)}
              className="text-blue-700 hover:underline decoration-blue-300 underline-offset-2"
              title={`${seg.link!.toPageTitle}${seg.link!.toPageSummary ? ` — ${seg.link!.toPageSummary}` : ''}`}>
              {seg.text}
            </button>
          );
        }
        if (!seg.span) return <span key={i}><LatexText>{seg.text}</LatexText></span>;
        const ref = seg.span.referenceId ? refById.get(seg.span.referenceId) : null;
        const isSourced = seg.span.supportStatus === 'sourced' && !!ref?.paperId;
        const cue = ref?.claimStatus ? (CHIP_CUE[ref.claimStatus] || CHIP_CUE.unknown) : CHIP_CUE.unknown;
        return (
          <span key={i} className={isSourced ? '' : 'border-b border-dotted border-slate-300'}
            title={isSourced ? undefined : `${seg.span.supportStatus.replace(/_/g, ' ')} — best-explanation prose awaiting a source`}>
            <LatexText>{seg.text}</LatexText>
            {isSourced && ref && (
              <button onClick={() => onOpenPaper(ref.paperId!)}
                className={`align-super text-[10px] px-1 ml-0.5 rounded-full border ${cue.cls}`}
                title={`${ref.paperTitle || 'source'} — cited claim: ${ref.claimStatus || 'unverified'}`}>
                ●{cue.cue}
              </button>
            )}
          </span>
        );
      })}
    </>
  );
}

export default function FieldOverviewPage({
  slug, isAdmin, onOpenPaper, onOpenPage, onBack,
}: { slug: string; isAdmin: boolean; onOpenPaper: (paperId: string) => void; onOpenPage: (slug: string) => void; onBack: () => void }) {
  const [pages, setPages] = useState<Page[] | null>(null);
  const [changes, setChanges] = useState<Change[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [level, setLevel] = useState<Record<string, number>>({});

  useEffect(() => {
    fetch(`/api/overviews/${encodeURIComponent(slug)}${isAdmin ? '?draft=1' : ''}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(e))))
      .then((d) => setPages(d.pages || []))
      .catch((e) => setErr(e?.error || 'failed to load overview'));
    fetch(`/api/overviews/${encodeURIComponent(slug)}/changes`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { changes: [] }))
      .then((d) => setChanges(d.changes || []))
      .catch(() => {});
  }, [slug, isAdmin]);

  if (err) return <div className="max-w-3xl mx-auto p-8 text-slate-600"><button onClick={onBack} className="text-sm text-blue-600 mb-4">← Back</button><p>Overview not available: {err}</p><p className="text-xs mt-2 text-slate-400">The schema must be pushed and the overview seeded in the connected database.</p></div>;
  if (!pages) return <div className="max-w-3xl mx-auto p-8 text-slate-500">Loading overview…</div>;

  const root = pages.find((p) => !p.parentPageId) ?? pages[0];
  const subpages = pages.filter((p) => p.id !== root?.id);

  const renderPage = (page: Page, isRoot: boolean) => {
    const lvl = level[page.slug] ?? (isRoot ? 2 : 0);
    const v = page.version || ({} as Page['version']);
    const body = lvl === 0 ? (v.summaryOneLine || page.scopeStatement)
      : lvl === 1 ? (v.summaryShort || v.markdownFull)
      : v.markdownFull;
    const sourced = page.spans.filter((s) => s.supportStatus === 'sourced').length;
    const unsourced = page.spans.length - sourced;
    return (
      <section key={page.id} className={`mb-8 ${isRoot ? '' : 'border-t border-slate-200 pt-6'}`}>
        <div className="flex items-baseline gap-2">
          <h2 className={`font-bold text-slate-900 ${isRoot ? 'text-3xl' : 'text-2xl'}`}>{page.title}</h2>
          <button
            onClick={() => setLevel((m) => ({ ...m, [page.slug]: Math.min(2, (m[page.slug] ?? (isRoot ? 2 : 0)) + 1) }))}
            className="text-xs px-1.5 py-0.5 rounded border border-slate-300 text-slate-500 hover:bg-slate-100"
            title={`expand (currently ${LEVELS[lvl]})`}
            disabled={lvl >= 2}
          >[+]</button>
          {lvl > 0 && (
            <button onClick={() => setLevel((m) => ({ ...m, [page.slug]: 0 }))} className="text-xs text-slate-400 hover:text-slate-600">[–]</button>
          )}
          {v.visibility === 'draft' && <span className="text-[10px] uppercase tracking-wide text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">draft</span>}
        </div>
        {page.scopeStatement && lvl > 0 && <p className="text-sm text-slate-400 italic mt-1">{page.scopeStatement}</p>}
        <div className="prose prose-slate max-w-none mt-3 text-slate-700 leading-relaxed">
          {lvl === 2 && body
            ? <SegmentedBody body={body} spans={page.spans || []} references={page.references || []} links={page.links || []} onOpenPaper={onOpenPaper} onOpenPage={onOpenPage} />
            : <LatexText>{body || '_(stub — no content yet)_'}</LatexText>}
        </div>
        {page.references.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2 items-center">
            <span className="text-xs text-slate-400">Sources:</span>
            {page.references.filter((r) => r.paperId).map((r) => {
              const cue = r.claimStatus ? (CHIP_CUE[r.claimStatus] || CHIP_CUE.unknown) : CHIP_CUE.unknown;
              const label = r.paperTitle ? (r.paperTitle.length > 42 ? r.paperTitle.slice(0, 42) + '…' : r.paperTitle) : 'source';
              return (
                <button key={r.id} onClick={() => onOpenPaper(r.paperId!)}
                  className={`text-xs px-2 py-0.5 rounded-full border hover:brightness-95 ${cue.cls}`}
                  title={`${r.anchorText || ''}  —  cited claim: ${r.claimStatus || 'unverified'}`}>
                  {label}<span className="opacity-70">{cue.cue}</span>
                </button>
              );
            })}
          </div>
        )}
        {page.links && page.links.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2 items-center">
            <span className="text-xs text-slate-400">Related pages:</span>
            {page.links.map((l) => (
              <button key={l.id} onClick={() => onOpenPage(l.toPageSlug)}
                className="text-xs px-2 py-0.5 rounded border border-slate-200 text-slate-600 hover:bg-slate-100"
                title={`"${l.phrase}" → ${l.toPageTitle}`}>
                {l.phrase.length > 36 ? l.phrase.slice(0, 36) + '…' : l.phrase} →
              </button>
            ))}
          </div>
        )}
        {page.spans.length > 0 && (
          <p className="text-[11px] text-slate-400 mt-2">Provenance: {sourced} sourced · {unsourced} unsourced-explanatory</p>
        )}
      </section>
    );
  };

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <button onClick={onBack} className="text-sm text-blue-600 mb-6">← Back to papers</button>
      <p className="text-xs uppercase tracking-widest text-slate-400 mb-1">Field overview {isAdmin ? '(draft)' : ''}</p>
      {root && renderPage(root, true)}
      {subpages.map((p) => renderPage(p, false))}
      {changes.length > 0 && (
        <section className="mt-10 border-t border-slate-200 pt-4">
          <h3 className="text-sm font-semibold text-slate-600 mb-2">Recent changes</h3>
          <ul className="space-y-1">
            {changes.slice(0, 15).map((c, i) => (
              <li key={i} className="text-xs text-slate-500">
                <span className="text-slate-400">{new Date(c.at).toLocaleDateString()}</span>
                {' — '}<span className="font-medium">{c.pageSlug || slug}</span> {c.action.replace(/_/g, ' ')}
                {c.paperId && c.paperTitle && (
                  <> triggered by <button onClick={() => onOpenPaper(c.paperId!)} className="text-blue-600 hover:underline">{c.paperTitle.length > 48 ? c.paperTitle.slice(0, 48) + '…' : c.paperTitle}</button></>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="text-xs text-slate-400 mt-6 border-t border-slate-200 pt-4">
        Read-only draft. Prominence is derived from structure; dotted-underlined sentences are best-explanation prose awaiting a source (citations accrete as papers are reviewed).
      </p>
    </div>
  );
}
