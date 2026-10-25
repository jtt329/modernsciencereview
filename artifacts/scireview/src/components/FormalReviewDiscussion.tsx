import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Loader2, MessageSquare, Send, X } from 'lucide-react';
import type { FormalJob, FormalSubmission } from '../../../api-server/src/formal/contract';
import type { ReviewResolutionCollection, ReviewResolutionRecord } from '../../../api-server/src/formal/reviewResolutionContract';
import type { ReviewTarget } from '../../../api-server/src/formal/reviewContract';
import type { ReviewDiscussion as ReviewThread } from '../../../api-server/src/formal/discussions';
import MathText from './FormalMathText';
import { pollFormalJob } from './formalJobPolling';
import './FormalReviewDiscussion.css';

type DiscussionContextValue = { open: (target: ReviewTarget, label: string, trigger: HTMLElement) => void; threads: ReviewThread[]; disabled: boolean };
const DiscussionContext = createContext<DiscussionContextValue | null>(null);
const targetLabel: Record<ReviewTarget['kind'], string> = { 'main-claim': 'central claim', input: 'input', assumption: 'assumption', definition: 'definition', claim: 'mathematical claim', warning: 'issue to inspect', coverage: 'source statement', 'source-line': 'source line', 'review-section': 'scientific review section', 'explanation-section': 'explanation section', 'field-contribution': 'field contribution', 'canonical-finding': 'canonical finding', 'literature-section': 'literature review section', 'assessment-issue': 'assessment issue', 'assessment-section': 'assessment section' };
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/formal-lab${path}`, { credentials: 'include', ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  const result = await response.json().catch(() => ({ error: 'The discussion service returned an unreadable response.' }));
  if (!response.ok) throw new Error(result.error || `The discussion request failed (${response.status}).`);
  return result as T;
}
const sameTarget = (a: ReviewTarget, b: ReviewTarget) => a.kind === b.kind && a.id === b.id;
const dateLabel = (value: string) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
function ProposalValue({ value }: { value: unknown }) { return typeof value === 'string' ? <div className="fl-discussion-value"><MathText text={value} /></div> : <pre><code>{JSON.stringify(value, null, 2) ?? 'Not present'}</code></pre>; }

/** The same item control is available in the draft, checking report and source. */
export function ReviewDiscussionControl({ kind, id, label, compact = false }: { kind: ReviewTarget['kind']; id: string; label?: string; compact?: boolean }) {
  const context = useContext(DiscussionContext);
  if (!context) return null;
  const target = { kind, id } as ReviewTarget;
  const count = context.threads.filter(thread => sameTarget(thread.target, target)).reduce((sum, thread) => sum + thread.messages.length, 0);
  return <button type="button" className={`fl-discuss-control${compact ? ' fl-discuss-compact' : ''}`} disabled={context.disabled} onClick={event => context.open(target, label || targetLabel[kind], event.currentTarget)} aria-label={`Discuss ${label || targetLabel[kind]}`}><MessageSquare size={13} /><span>{compact ? 'Discuss' : 'Discuss or propose a correction'}</span>{count > 0 && <small>{count}</small>}</button>;
}

export default function FormalReviewDiscussion({ submission, enabled, disabled, onApplied, onBusyChange, onOpenSource, children }: { submission: FormalSubmission | null; enabled: boolean; disabled: boolean; onApplied: (submission: FormalSubmission) => void; onBusyChange: (busy: boolean) => void; onOpenSource?: (ids: string[]) => void; children: React.ReactNode }) {
  const [threads, setThreads] = useState<ReviewThread[]>([]);
  const [selected, setSelected] = useState<{ target: ReviewTarget; label: string } | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStage, setJobStage] = useState('Preparing a response');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const panel = useRef<HTMLElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const submissionRef = useRef(submission?.id);
  const digestRef = useRef(submission?.currentRevision.digest);
  const mounted = useRef(true);
  const mutationRef = useRef(false);
  submissionRef.current = submission?.id;
  digestRef.current = submission?.currentRevision.digest;
  const running = saving || Boolean(jobId);
  const path = submission ? `/submissions/${encodeURIComponent(submission.id)}` : '';
  const refresh = useCallback(async (id: string) => {
    const result = await api<{ threads: ReviewThread[] }>(`/submissions/${encodeURIComponent(id)}/discussions`);
    if (!mounted.current || submissionRef.current !== id) return [];
    setThreads(result.threads);
    const pending = result.threads.find(thread => (thread.status === 'pending' || thread.status === 'running') && thread.jobId);
    if (pending?.jobId) setJobId(pending.jobId);
    return result.threads;
  }, []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { onBusyChange(running); return () => onBusyChange(false); }, [running, onBusyChange]);
  useEffect(() => {
    setThreads([]); setSelected(null); setMessage(''); setError(null); setNotice(null); setJobId(null); setSaving(false); mutationRef.current = false;
    if (!enabled || !submission) return;
    let active = true; const id = submission.id; setLoading(true);
    refresh(id).catch(err => { if (active && mounted.current && submissionRef.current === id) setError(err instanceof Error ? err.message : 'Discussions could not be loaded.'); }).finally(() => { if (active && mounted.current && submissionRef.current === id) setLoading(false); });
    return () => { active = false; };
  }, [submission?.id, enabled, refresh]);
  const previousDigest = useRef(submission?.currentRevision.digest);
  useEffect(() => { const changed = previousDigest.current !== submission?.currentRevision.digest; previousDigest.current = submission?.currentRevision.digest; if (changed && enabled && submission) refresh(submission.id).catch(() => {}); }, [submission?.currentRevision.digest, enabled, refresh]);
  useEffect(() => {
    if (!jobId || !submission) return;
    const id = submission.id;
    return pollFormalJob({ read: () => api<FormalJob>(`/jobs/${encodeURIComponent(jobId)}`), onValue: value => {
      if (!mounted.current || submissionRef.current !== id) return;
      setJobStage(value.stage); setError(null);
      if (value.status === 'complete' || value.status === 'failed') {
        setJobId(null);
        if (value.status === 'failed') setError(value.error || 'The AI response stopped. Your comments and earlier results are saved.');
        refresh(id).catch(err => { if (mounted.current && submissionRef.current === id) setError(err instanceof Error ? err.message : 'The saved discussion could not be refreshed.'); });
      }
    }, onError: () => { if (mounted.current && submissionRef.current === id) setError('Progress could not be refreshed. The saved discussion will be checked again.'); } });
  }, [jobId, submission?.id, refresh]);
  const close = useCallback(() => { setSelected(null); window.setTimeout(() => trigger.current?.isConnected && trigger.current.focus(), 0); }, []);
  useEffect(() => {
    if (!selected) return;
    const previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const timer = window.setTimeout(() => composer.current?.focus(), 40);
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key !== 'Tab' || !panel.current) return;
      const nodes = [...panel.current.querySelectorAll<HTMLElement>('button:not(:disabled),textarea:not(:disabled),a[href],summary,[tabindex="0"]')].filter(node => node.offsetParent !== null);
      const first = nodes[0], last = nodes.at(-1); if (!first || !last) return;
      if (event.shiftKey && (document.activeElement === first || !panel.current.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !panel.current.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keyboard);
    return () => { window.clearTimeout(timer); document.removeEventListener('keydown', keyboard); document.body.style.overflow = previousOverflow; };
  }, [Boolean(selected), close]);
  const open = (target: ReviewTarget, label: string, element: HTMLElement) => { trigger.current = element; setSelected({ target, label }); setMessage(''); setError(null); setNotice(null); };
  const relevant = selected ? threads.filter(thread => sameTarget(thread.target, selected.target)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)) : [];
  const currentThread = relevant.filter(thread => thread.revisionDigest === submission?.currentRevision.digest && thread.status !== 'applied').at(-1);
  const send = async (event: React.FormEvent) => {
    event.preventDefault(); if (!enabled || !submission || !selected || !message.trim() || disabled || running || mutationRef.current) return;
    mutationRef.current = true; setSaving(true); setError(null); setNotice(null); const id = submission.id; const digest = submission.currentRevision.digest;
    try {
      const next = await api<FormalJob>(`${path}/discussions`, { digest, target: selected.target, message: message.trim(), ...(currentThread ? { threadId: currentThread.id } : {}) });
      if (!mounted.current || submissionRef.current !== id || digestRef.current !== digest) return;
      setMessage(''); setJobStage(next.stage); setJobId(next.id); await refresh(id);
    } catch (err) { if (mounted.current && submissionRef.current === id) setError(err instanceof Error ? err.message : 'The comment could not be submitted.'); void refresh(id).catch(() => {}); }
    finally { mutationRef.current = false; if (mounted.current && submissionRef.current === id) setSaving(false); }
  };
  const apply = async (thread: ReviewThread) => {
    if (!enabled || !submission || thread.revisionDigest !== submission.currentRevision.digest || disabled || running || mutationRef.current) return;
    mutationRef.current = true; setSaving(true); setError(null); setNotice(null); const id = submission.id;
    try {
      const next = await api<FormalSubmission>(`${path}/discussions/${encodeURIComponent(thread.id)}/apply`, { digest: submission.currentRevision.digest });
      if (!mounted.current || submissionRef.current !== id) return;
      onApplied(next); setNotice('Applied as a new, unapproved revision. Review the changes and approve it before verification.'); await refresh(id);
    } catch (err) { if (mounted.current && submissionRef.current === id) setError(err instanceof Error ? err.message : 'The proposed revision could not be applied.'); }
    finally { mutationRef.current = false; if (mounted.current && submissionRef.current === id) setSaving(false); }
  };
  const acceptResolution = async (resolution: ReviewResolutionRecord) => {
    if (!enabled || !submission || resolution.packageDigest !== submission.currentRevision.digest || disabled || running || mutationRef.current) return;
    mutationRef.current = true; setSaving(true); setError(null); setNotice(null); const id = submission.id, digest = submission.currentRevision.digest, revisionId = submission.currentRevision.id;
    try {
      const result = await api<ReviewResolutionCollection & { assessmentJob?: FormalJob | null; assessmentRefreshError?: string }>(`${path}/resolutions/${encodeURIComponent(resolution.id)}/accept`, { digest, beforeFingerprint: resolution.proposal.beforeFingerprint });
      if (!mounted.current || submissionRef.current !== id || digestRef.current !== digest) return;
      const accepted = result.accepted.find(item => item.id === resolution.id);
      if (accepted) setThreads(items => items.map(thread => thread.resolutionProposal?.id === resolution.id ? { ...thread, resolutionProposal: accepted } : thread));
      setNotice(result.assessmentRefreshError ? 'The assessment correction is saved. The current assessment can be refreshed from the results page.' : 'The assessment correction is saved. The paper, its approval and the mathematical results are unchanged; the current assessment is being refreshed.');
      window.dispatchEvent(new CustomEvent('formal-lab-assessment-changed', { detail: { submissionId: id, revisionId, digest } }));
    } catch (err) { if (mounted.current && submissionRef.current === id) setError(err instanceof Error ? err.message : 'The assessment correction could not be accepted.'); }
    finally { mutationRef.current = false; if (mounted.current && submissionRef.current === id) setSaving(false); }
  };
  const context: DiscussionContextValue | null = enabled && submission ? { open, threads, disabled: disabled || running } : null;
  return <DiscussionContext.Provider value={context}>{children}{enabled && selected && submission && <div className="fl fl-discussion-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}><section className="fl-discussion-panel" ref={panel} role="dialog" aria-modal="true" aria-labelledby="formal-discussion-title"><header><div><span className="fl-eyebrow">REVIEW THIS {targetLabel[selected.target.kind].toUpperCase()}</span><h2 id="formal-discussion-title" className="fl-discussion-target-title"><MathText text={selected.label} /></h2><p>Discuss the science or correct the AI’s interpretation. Assessment corrections and manuscript changes are separate decisions.</p></div><button type="button" onClick={close} aria-label="Close discussion" className="fl-discussion-close"><X size={20} /></button></header><div className="fl-discussion-body">
    {selected.label.length > 160 && <details className="fl-discussion-selected-item"><summary>Read the full selected item</summary><p><MathText text={selected.label} /></p></details>}
    {loading && <p className="fl-discussion-progress"><Loader2 size={15} className="fl-spin" />Loading saved discussion…</p>}
    {!loading && relevant.length === 0 && <div className="fl-discussion-intro"><MessageSquare size={22} /><p>Explain what seems wrong, provide a clearer formulation, or ask why this item was inferred. Include any assumptions the change depends on.</p>{selected.target.kind === 'source-line' && <p>A source correction creates a labelled author amendment; the original PDF stays available.</p>}</div>}
    {relevant.map(thread => { const current = thread.revisionDigest === submission.currentRevision.digest; const proposal = thread.proposal; const checked = thread.consistency?.report?.claims.filter(item => item.status === 'checked').length || 0; return <article className={`fl-discussion-thread${current ? '' : ' fl-discussion-earlier'}`} key={thread.id}><div className="fl-discussion-thread-meta"><span>{current ? 'Current revision' : 'Earlier revision · read only'}</span><span>{dateLabel(thread.createdAt)}</span></div>{thread.messages.map(item => <div key={item.id} className={`fl-discussion-message fl-discussion-message-${item.role}`}><div><strong>{item.role === 'author' ? 'You' : 'AI response'}</strong><span>{dateLabel(item.createdAt)}</span></div><div><MathText text={item.text} /></div>{item.model && <code className="fl-discussion-model">{item.model}</code>}</div>)}
      {proposal && <section className="fl-discussion-proposal"><h3>Proposed manuscript revision</h3><p><MathText text={proposal.summary} /></p>{proposal.changes.map((change, index) => <div className="fl-discussion-change" key={`${change.path}-${index}`}><code>{change.path}</code><div className="fl-discussion-comparison"><section><strong>Before</strong><ProposalValue value={change.before} /></section><section><strong>After</strong><ProposalValue value={change.after} /></section></div></div>)}{proposal.sourceEdits.map((change, index) => <div className="fl-discussion-change" key={`${change.lineId}-${index}`}><h4>Author amendment · <code>{change.lineId}</code></h4><div className="fl-discussion-comparison"><section><strong>Extracted line</strong><div className="fl-discussion-source"><MathText text={change.before} verbatim /></div></section><section><strong>Proposed correction</strong><div className="fl-discussion-source"><MathText text={change.after} verbatim /></div></section></div><p><MathText text={change.reason} /></p></div>)}{proposal.affectedClaimIds.length > 0 && <p className="fl-discussion-affected">Affected mathematical claims: {proposal.affectedClaimIds.map(id => <code key={id}>{id}</code>)}</p>}{proposal.consistencyNotes.length > 0 && <div className="fl-discussion-consistency"><strong>Consequences and consistency notes</strong><ul>{proposal.consistencyNotes.map((note, index) => <li key={index}><MathText text={note} /></li>)}</ul></div>}
        {thread.consistency && <div className={`fl-discussion-check fl-discussion-check-${thread.consistency.status}`}><strong>Preliminary consistency check · {thread.consistency.status}</strong><p><MathText text={thread.consistency.note} /></p>{thread.consistency.report && <details><summary>{checked} of {thread.consistency.report.claims.length} equations checked <ChevronDown size={13} /></summary><ul>{thread.consistency.report.claims.map(item => <li key={item.id}><strong><MathText text={item.title} /></strong><span>{item.status}</span><p><MathText text={item.message} /></p></li>)}</ul></details>}<small>These are proposal checks. Applying creates an unapproved revision; author approval and its verification remain separate.</small></div>}
        {thread.status === 'applied' ? <p className="fl-discussion-applied"><Check size={15} />Applied to a new revision</p> : current ? <button type="button" className="fl-button fl-button-primary" disabled={disabled || running || thread.status !== 'complete'} onClick={() => apply(thread)}>Apply proposed revision <Check size={14} /></button> : <p className="fl-discussion-stale">This proposal is for an earlier revision. Discuss the current item to request an updated proposal.</p>}
      </section>}{thread.resolutionProposal && <section className="fl-discussion-resolution"><div className="fl-eyebrow">ASSESSMENT CORRECTION · PAPER UNCHANGED</div><h3>{thread.resolutionProposal.proposal.disposition === 'manuscript-change-needed' ? 'Manuscript change remains necessary' : thread.resolutionProposal.proposal.disposition === 'reviewer-error' ? 'Correct the AI assessment' : 'Record the agreed clarification'}</h3><p><MathText text={thread.resolutionProposal.proposal.summary} /></p><p><MathText text={thread.resolutionProposal.proposal.reason} /></p>{thread.resolutionProposal.proposal.correction && <div className="fl-discussion-comparison"><section><strong>Current assessment wording</strong><ProposalValue value={thread.resolutionProposal.proposal.correction.before} /></section><section><strong>Proposed assessment wording</strong><ProposalValue value={thread.resolutionProposal.proposal.correction.after} /></section></div>}<div className="fl-line-refs">{thread.resolutionProposal.proposal.evidence.sourceLineIds.map(id => <button type="button" className="fl-line-ref" key={id} onClick={() => { onOpenSource?.([id]); close(); }} disabled={!onOpenSource}>{id}</button>)}</div><p className="fl-discussion-resolution-scope">This accepts an assessment correction or clarification. It does not change the manuscript, approve a new revision or turn an unchecked claim into a passed mathematical check. Accepted assessment text is shared if this revision is public; the conversation remains private.</p>{thread.resolutionProposal.status === 'accepted' ? <p className="fl-discussion-applied"><Check size={15} />Accepted in the assessment record</p> : current ? <button type="button" className="fl-button fl-button-primary" disabled={disabled || running || thread.status !== 'complete'} onClick={() => acceptResolution(thread.resolutionProposal!)}>{thread.resolutionProposal.proposal.disposition === 'manuscript-change-needed' ? 'Acknowledge the assessment' : 'Accept assessment correction'} <Check size={14} /></button> : <p className="fl-discussion-stale">This proposal belongs to an earlier revision. Open the current revision before accepting a correction.</p>}</section>}{thread.error && <p className="fl-discussion-error"><MathText text={thread.error} /></p>}</article>; })}
    {running && <p className="fl-discussion-progress" role="status"><Loader2 size={15} className="fl-spin" />{saving ? 'Saving your request' : jobStage}…</p>}{error && <p className="fl-discussion-error" role="alert"><MathText text={error} /></p>}{notice && <p className="fl-discussion-notice" role="status"><MathText text={notice} /></p>}
  </div><form className="fl-discussion-compose" onSubmit={send}><label htmlFor="formal-discussion-comment">Your question or proposed correction</label><textarea id="formal-discussion-comment" ref={composer} value={message} onChange={event => setMessage(event.target.value)} rows={4} maxLength={4000} disabled={disabled || running} placeholder="For this item, I mean… / Why was this assumption made?" /><div><small>Uses this revision’s recorded analysis model. Nothing is applied or approved automatically.</small><button className="fl-button fl-button-primary" type="submit" disabled={disabled || running || !message.trim()}><Send size={13} />Send comment</button></div></form></section></div>}</DiscussionContext.Provider>;
}
