import React, { useEffect, useState } from 'react';
import { useAuth } from '@workspace/auth-web';
import { Download, ExternalLink, FileText, Loader2 } from 'lucide-react';
import FormalSiteHeader from './FormalSiteHeader';
import MathText from './FormalMathText';
import { OutputReport } from './FormalLabPage';
import { createSavedReviewSnapshot } from './formalSavedReview';
import type { SavedFormalReviewSnapshot } from './formalSavedReview';
import { SavedFormalReviewProvider } from './FormalSavedReviewContext';
import './SavedFormalReviewPage.css';

type Tab = 'review' | 'verification' | 'source';
const prefix = '/boundary-mechanics-paper/';
function locationSourceLine(): string | undefined { return /^#source-line-(p\d+-l\d+)$/.exec(window.location.hash)?.[1]; }
function locationTab(): Tab { const tab = new URLSearchParams(window.location.search).get('tab'); return tab === 'verification' || tab === 'source' ? tab : 'review'; }

/** The normal review reader, backed by the exact publicly shared saved evidence. */
export default function SavedFormalReviewPage() {
  const { user, isLoading } = useAuth();
  const [snapshot, setSnapshot] = useState<SavedFormalReviewSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [tab, setTabState] = useState<Tab>(locationTab);
  const [highlight, setHighlight] = useState<string | undefined>(locationSourceLine);
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    setError(null);
    void fetch(prefix + 'evidence.json', { credentials: 'omit', cache: 'no-cache', signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error('The saved review could not be loaded.'); return response.json(); })
      .then(value => createSavedReviewSnapshot(value, { evidenceUrl: prefix + 'evidence.json', paperUrl: prefix + 'paper.pdf', standaloneUrl: prefix + 'export.html', originalEvidenceUrl: prefix + 'original-evidence.json', expectedSourceSha256: '3f093f45e6b91a04030fc5fc862aeb20df30363373d806d2a8cb7c0e0246304f', expectedPackageDigest: 'd57cd0e9c2bcf64a7096d1fbb85ce06062531b149ed7f262054ed161eaf4bf47' }))
      .then(value => { if (active) setSnapshot(value); })
      .catch(reason => { if (active && reason.name !== 'AbortError') setError(reason instanceof Error ? reason.message : 'The saved review could not be loaded.'); });
    return () => { active = false; controller.abort(); };
  }, [attempt]);
  useEffect(() => { const onLocation = () => { setTabState(locationTab()); setHighlight(locationSourceLine()); }; window.addEventListener('popstate', onLocation); window.addEventListener('hashchange', onLocation); return () => { window.removeEventListener('popstate', onLocation); window.removeEventListener('hashchange', onLocation); }; }, []);
  useEffect(() => { if (!snapshot) return; const previous = document.title; document.title = `${snapshot.submission.title} · Seven-page review · ModernScience.Review`; return () => { document.title = previous; }; }, [snapshot]);
  const setTab = (next: Tab) => { setTabState(next); const url = new URL(window.location.href); url.searchParams.set('tab', next); url.hash = ''; if (url.pathname + url.search !== window.location.pathname + window.location.search) window.history.pushState({}, '', url.pathname + url.search); };
  const openSource = (ids: string[]) => { if (!ids.length) return; setHighlight(ids[0]); setTab('source'); window.history.replaceState({}, '', window.location.pathname + window.location.search + '#source-line-' + ids[0]); };
  const signIn = () => { window.location.href = `/api/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`; };
  return <div className="fl fl-paper-page fl-reader-page fl-saved-review-page">
    <FormalSiteHeader signedIn={user ? user.firstName || user.email || 'Signed in' : undefined} loading={isLoading} signIn={signIn} />
    <main>
      {!snapshot && !error && <section className="fl-panel fl-saved-loading" role="status"><Loader2 className="fl-spin" size={22} /><h1>Loading the seven-page review</h1><p>The saved review, mathematical evidence and numbered source are loading.</p></section>}
      {error && <section className="fl-panel fl-alert fl-alert-error" role="alert"><h1>The saved review could not be displayed</h1><p>{error}</p><button className="fl-button fl-button-primary" onClick={() => setAttempt(value => value + 1)}>Try loading again</button><a href={prefix + 'export.html'}>Read the standalone report</a><a href={prefix + 'evidence.json'}>Download the evidence JSON</a></section>}
      {snapshot && <SavedFormalReviewProvider snapshot={snapshot}>
        <header className="fl-paper-heading"><div className="fl-eyebrow">PUBLIC SAVED REVIEW · SEVEN-PAGE MANUSCRIPT · 28 OCTOBER 2026</div><h1><MathText text={snapshot.submission.title} /></h1><p className="fl-paper-authors">{snapshot.submission.currentRevision.package.authors}</p>
          <div className="fl-saved-artifacts"><a href={snapshot.paperUrl} target="_blank" rel="noopener noreferrer"><FileText size={14} />Read the paper PDF</a><a href={snapshot.evidenceUrl} download="boundary-mechanics-seven-page-evidence.json"><Download size={14} />Download full evidence</a><a href={prefix + 'gpt-handoff.txt'}>GPT handoff notes<ExternalLink size={12} /></a></div>
          <details className="fl-saved-record-note"><summary>About this saved review</summary><p>The author shared this completed review publicly. Its mathematical checks apply to the displayed proposed formulation and declared inputs. The original review record and its approval status are preserved.</p><p>This page reads the saved evidence. Author editing and new analysis are available through the paper submission workflow.</p><a href={snapshot.standaloneUrl}>Standalone report</a><span> · </span><a href={prefix + 'review-summary.txt'}>Text summary</a></details>
        </header>
        <div className="fl-workflow"><div className="fl-workspace fl-workspace-report"><div className="fl-panel" id="formal-stage-panel"><h2 className="fl-sr-only">Explore the results</h2><OutputReport submission={snapshot.submission} tab={tab} setTab={setTab} source={snapshot.submission.sourceDocument || null} job={null} highlight={highlight} onOpen={openSource} /></div></div></div>
      </SavedFormalReviewProvider>}
    </main>
  </div>;
}
