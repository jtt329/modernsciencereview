import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@workspace/auth-web';
import { ArrowLeft, ArrowRight, BookOpen, Check, CheckCircle2, ChevronDown, Download, ExternalLink, FileText, FlaskConical, Layers3, Loader2, LockKeyhole, RotateCcw, ShieldCheck, Sparkles } from 'lucide-react';
import LatexText from './LatexText';
import type { Expr, FormalInput, FormalPackage, FormalSubmission, VerificationReport } from '../../../api-server/src/formal/contract';
import './FormalLabPage.css';

type Catalog = { inputs: FormalInput[]; example: FormalPackage; exampleDigest: string; capabilities: { checker: string; scope: string[] } };
type Step = 0 | 1 | 2 | 3 | 4;
const STEPS = [{ title: 'Choose inputs', short: 'Inputs', icon: Layers3 }, { title: 'Formalize the claim', short: 'Formalize', icon: Sparkles }, { title: 'Author approval', short: 'Approve', icon: ShieldCheck }, { title: 'Verify', short: 'Verify', icon: CheckCircle2 }, { title: 'Build the explanation', short: 'Explain', icon: BookOpen }];
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const statusLabel = (status: string) => ({ checked: 'Symbolically checked', contradicted: 'Contradicted', unsupported: 'Unsupported', inconclusive: 'Inconclusive', partial: 'Partially checked', failed: 'Check failed' }[status] || status);
const shortDigest = (digest?: string) => digest ? `${digest.slice(0, 12)}…${digest.slice(-8)}` : 'Not saved yet';

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/formal-lab${path}`, { credentials: 'include', ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  const data = await response.json().catch(() => ({ error: 'The server returned an unreadable response.' }));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data as T;
}

function symbolLatex(name: string): string {
  const known: Record<string, string> = { pi: '\\pi', Pi: '\\Pi', kappa: '\\kappa', rho: '\\rho', theta: '\\theta', epsilon: '\\epsilon', delta: '\\delta', hbar: '\\hbar' };
  if (known[name]) return known[name];
  if (/^[A-Za-z]$/.test(name)) return name;
  const match = name.match(/^([A-Za-z]+)_(.+)$/);
  if (match) return `${known[match[1]] || (match[1].length === 1 ? match[1] : `\\mathrm{${match[1].replace(/[^A-Za-z0-9]/g, '')}}`)}_{\\mathrm{${match[2].replace(/[^A-Za-z0-9]/g, '')}}}`;
  return `\\mathrm{${name.replace(/[^A-Za-z0-9]/g, '')}}`;
}

function expressionLatex(expr: Expr, depth = 0): string {
  if (!expr || depth > 24) return '\\text{expression}';
  const next = (value: Expr) => expressionLatex(value, depth + 1);
  switch (expr.op) {
    case 'symbol': return symbolLatex(expr.name);
    case 'integer': return String(expr.value);
    case 'rational': return `\\frac{${expr.numerator}}{${expr.denominator}}`;
    case 'add': return expr.args.map(next).join(' + ');
    case 'mul': return expr.args.map(e => e.op === 'add' ? `\\left(${next(e)}\\right)` : next(e)).join(' \\, ');
    case 'div': return `\\frac{${next(expr.numerator)}}{${next(expr.denominator)}}`;
    case 'pow': return `{\\left(${next(expr.base)}\\right)}^{${expr.exponent}}`;
    case 'diff': return `\\frac{\\partial}{\\partial ${symbolLatex(expr.variable)}}\\left(${next(expr.expr)}\\right)`;
    case 'substitute': return `\\left.${next(expr.expr)}\\right|_{${Object.entries(expr.values).map(([symbol, value]) => `${symbolLatex(symbol)}=${next(value)}`).join(',\\;')}}`;
    default: return '\\text{unsupported expression}';
  }
}

function Equation({ lhs, rhs }: { lhs: Expr; rhs?: Expr }) {
  return <div className="fl-equation"><LatexText>{`$$${expressionLatex(lhs)}${rhs ? ` = ${expressionLatex(rhs)}` : ''}$$`}</LatexText></div>;
}

function DateStamp({ value }: { value: string }) {
  const date = new Date(value);
  return <time dateTime={value}>{Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time>;
}

function SourceLink({ url, children }: { url?: string; children: React.ReactNode }) {
  if (!url || (!/^https?:\/\//i.test(url) && !/^\/(?!\/)/.test(url))) return <span>{children}</span>;
  return <a href={url} target="_blank" rel="noopener noreferrer">{children}<ExternalLink size={13} aria-hidden="true" /></a>;
}

function PacketPreview({ packet, compact = false }: { packet: FormalPackage; compact?: boolean }) {
  return <div className="fl-packet">
    <section><h3>The claim in plain language</h3><p><LatexText>{packet.mainClaim}</LatexText></p></section>
    <section><h3>Declared assumptions</h3><ol className="fl-assumptions">{packet.assumptions.map((assumption, index) => <li key={index}><LatexText>{assumption}</LatexText></li>)}</ol></section>
    <section><h3>Definitions</h3><div className="fl-definition-list">{packet.definitions.map((definition, index) => <div key={`${definition.symbol}-${index}`}><Equation lhs={{ op: 'symbol', name: definition.symbol }} rhs={definition.expression} /><p><LatexText>{definition.description}</LatexText></p></div>)}</div></section>
    <section><div className="fl-section-heading"><h3>Claims the checker will receive</h3><span className="fl-counter">{packet.claims.length} claims</span></div><div className="fl-claims">{packet.claims.map((claim, index) => <article className="fl-claim" id={`formal-claim-${claim.id}`} key={claim.id}><div className="fl-claim-heading"><span className="fl-claim-number">{String(index + 1).padStart(2, '0')}</span><h4>{claim.title}</h4></div><Equation lhs={claim.lhs} rhs={claim.rhs} />{!compact && <p><LatexText>{claim.explanation}</LatexText></p>}</article>)}</div></section>
    {!compact && <details className="fl-details"><summary>Symbols, domains and dimensions <ChevronDown size={16} /></summary><div className="fl-table-scroll"><table><thead><tr><th>Symbol</th><th>Meaning</th><th>Domain</th><th>Dimensions (M, L, T)</th></tr></thead><tbody>{packet.symbols.map(symbol => <tr key={symbol.name}><td><LatexText>{`$${symbolLatex(symbol.name)}$`}</LatexText></td><td>{symbol.label}</td><td>{symbol.domain}</td><td><code>[{symbol.dimensions.join(', ')}]</code></td></tr>)}</tbody></table></div></details>}
    <section className="fl-scope-note"><h3>What this package leaves open</h3><ul>{packet.limitations.map((limitation, index) => <li key={index}><LatexText>{limitation}</LatexText></li>)}</ul></section>
  </div>;
}

function Report({ packet, report, demo }: { packet: FormalPackage; report: VerificationReport; demo: boolean }) {
  const byId = new Map(report.claims.map(claim => [claim.id, claim]));
  const checked = report.claims.filter(claim => claim.status === 'checked').length;
  const supported = packet.consequences.filter(item => item.claimIds.length > 0 && item.claimIds.every(id => byId.get(id)?.status === 'checked'));
  const withheld = packet.consequences.length - supported.length;
  const exportReport = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ package: packet, verification: report, demonstration: demo }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'formal-lab-verification.json'; link.click(); URL.revokeObjectURL(url);
  };
  return <div className="fl-report">
    <div className={`fl-report-banner ${report.status === 'checked' ? 'fl-report-checked' : 'fl-report-partial'}`}><div className="fl-report-icon"><ShieldCheck size={27} /></div><div><div className="fl-eyebrow">{demo ? 'PUBLIC DEMONSTRATION · NO AUTHOR APPROVAL' : 'APPROVED PACKAGE · CHECKER REPORT'}</div><h2>{checked} of {report.claims.length} claims symbolically checked</h2><p>These results are conditional on the inputs, definitions and domains in this package.</p></div></div>
    <div className="fl-report-meta"><span>{report.checker} · {report.engine}</span><span>Checked <DateStamp value={report.checkedAt} /></span><button className="fl-text-button" onClick={exportReport}><Download size={14} /> Download evidence</button></div>
    <section className="fl-explanation"><div className="fl-eyebrow">EXPLANATION FROM CHECKED CLAIMS</div><h2>What follows from the chosen inputs?</h2><p className="fl-explanation-intro">The selected potential and the stated assumptions are the starting point. The prose below is a proposed interpretation; the checker validates the displayed equations, not the wording. The physical status of the starting inputs remains a separate question.</p>{supported.length ? supported.map((item, index) => <article key={index}><h3>{item.title}</h3><p><LatexText>{item.text}</LatexText></p><div className="fl-evidence-links">Supported by {item.claimIds.map(id => <a key={id} href={`#formal-result-${id}`}>{byId.get(id)?.title || id}<ArrowRight size={12} /></a>)}</div></article>) : <p>No explanatory consequence in this package is supported by a complete set of checked claims yet.</p>}{withheld > 0 && <p className="fl-muted">{withheld} proposed {withheld === 1 ? 'consequence is' : 'consequences are'} awaiting a complete set of checks.</p>}<div className="fl-explanation-source"><FileText size={17} /><div><span>Source manuscript</span><SourceLink url={packet.source.url}>{packet.source.title}</SourceLink><small>{packet.source.version}</small></div></div></section>
    <section><div className="fl-section-heading"><h3>The verification record</h3><span className="fl-counter">Exact symbolic checks</span></div><div className="fl-result-list">{report.claims.map(result => { const claim = packet.claims.find(item => item.id === result.id); return <article className="fl-result" key={result.id} id={`formal-result-${result.id}`}><div className="fl-result-heading"><h4>{result.title}</h4><span className={`fl-status fl-status-${result.status}`}>{result.status === 'checked' && <Check size={13} />}{statusLabel(result.status)}</span></div>{claim && <Equation lhs={claim.lhs} rhs={claim.rhs} />}<p>{result.message}</p><div className="fl-result-facts"><span>Dimensions: <strong>{result.dimensions}</strong></span><span>Residual: <code>{result.residual || '—'}</code></span></div>{result.domainRestrictions.length > 0 && <div className="fl-domain"><strong>Required domain</strong><ul>{result.domainRestrictions.map((condition, index) => <li key={index}>{condition}</li>)}</ul></div>}</article>; })}</div></section>
    <section id="formal-input-references"><h3>Declared inputs and references</h3><div className="fl-reference-list">{packet.selectedInputs.map(input => <article key={input.id} id={`formal-input-${input.id}`}><div className="fl-reference-heading"><SourceLink url={input.sourceUrl}>{input.title}</SourceLink><code>{input.version}</code></div><p><LatexText>{input.statement}</LatexText></p></article>)}</div></section>
    <section className="fl-scope-note"><h3>The boundary of this result</h3><ul>{[...new Set([...packet.limitations, ...report.limitations])].map((limitation, index) => <li key={index}><LatexText>{limitation}</LatexText></li>)}</ul></section>
    <details className="fl-details"><summary>Package identity and reproducibility <ChevronDown size={16} /></summary><p>The report is attached to this exact package digest. Changing the source, inputs, assumptions or claims requires another approval and check.</p><code className="fl-full-digest">SHA-256 {report.packageDigest}</code>{packet.source.sha256 && <p className="fl-muted">Source PDF SHA-256 <code className="fl-full-digest">{packet.source.sha256}</code></p>}<p className="fl-muted">This Formal Lab report is separate from the existing paper reviews and scientific explanation.</p></details>
  </div>;
}

export default function FormalLabPage() {
  const { user, isLoading: authLoading } = useAuth();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [packet, setPacket] = useState<FormalPackage | null>(null);
  const [submission, setSubmission] = useState<FormalSubmission | null>(null);
  const [submissions, setSubmissions] = useState<FormalSubmission[]>([]);
  const [step, setStep] = useState<Step>(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [approvedIntent, setApprovedIntent] = useState(false);
  const [jsonDraft, setJsonDraft] = useState('');
  const [demoReport, setDemoReport] = useState<VerificationReport | null>(null);
  const [showDemo, setShowDemo] = useState(false);
  const workflow = useRef<HTMLDivElement>(null);
  const stageHeading = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef<Step>(0);
  const busyRef = useRef(false);
  const advancedDirty = Boolean(packet && jsonDraft !== JSON.stringify(packet, null, 2));
  const dirty = Boolean(submission && packet && JSON.stringify(packet) !== JSON.stringify(submission.currentRevision.package));
  const report = showDemo ? demoReport : submission?.currentRevision.verification;
  const activeReportPacket = showDemo ? catalog?.example : submission?.currentRevision.package;
  const approved = Boolean(submission?.currentRevision.approvedAt) && !dirty && !advancedDirty;
  const inputIds = useMemo(() => new Set(packet?.selectedInputs.map(input => input.id) || []), [packet?.selectedInputs]);

  useEffect(() => {
    let active = true;
    request<Catalog>('/catalog').then(data => { if (active) { setCatalog(data); let initial = clone(data.example); try { const pending = sessionStorage.getItem('formal-lab-pending-draft'); if (pending) { const parsed = JSON.parse(pending); if (parsed?.schemaVersion === 'formal-lab-v1' && parsed.source && Array.isArray(parsed.claims) && Array.isArray(parsed.symbols) && Array.isArray(parsed.selectedInputs) && Array.isArray(parsed.assumptions) && Array.isArray(parsed.definitions) && Array.isArray(parsed.limitations) && Array.isArray(parsed.consequences)) initial = parsed; sessionStorage.removeItem('formal-lab-pending-draft'); } } catch { /* The prepared example remains available if browser storage is unavailable. */ } setPacket(initial); setJsonDraft(JSON.stringify(initial, null, 2)); } }).catch(err => { if (active) setError(err instanceof Error ? err.message : 'Unable to load the Formal Lab.'); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!user) { setSubmissions([]); return; }
    let active = true;
    request<{ submissions: FormalSubmission[] }>('/submissions').then(data => { if (active) setSubmissions(data.submissions); }).catch(err => { if (active) setNotice(`Saved drafts are unavailable: ${err instanceof Error ? err.message : 'please try again'}`); });
    return () => { active = false; };
  }, [user?.id]);

  useEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    workflow.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    stageHeading.current?.focus({ preventScroll: true });
  }, [step]);

  const go = (next: Step) => { if (busyRef.current) return; setStep(next); setError(null); setNotice(null); setShowDemo(false); };
  const edit = (patch: Partial<FormalPackage>) => { if (!packet || busyRef.current) return; const next = { ...packet, ...patch }; setPacket(next); setJsonDraft(JSON.stringify(next, null, 2)); setApprovedIntent(false); setShowDemo(false); };
  const editSource = (key: keyof FormalPackage['source'], value: string) => { if (!packet) return; edit({ source: { ...packet.source, [key]: value, sha256: undefined } }); };
  const takeSubmission = (next: FormalSubmission) => { setSubmission(next); setPacket(clone(next.currentRevision.package)); setJsonDraft(JSON.stringify(next.currentRevision.package, null, 2)); setApprovedIntent(false); setShowDemo(false); setSubmissions(items => [next, ...items.filter(item => item.id !== next.id)]); };
  const run = async (label: string, action: () => Promise<void>) => { if (busyRef.current) return; busyRef.current = true; setBusy(label); setError(null); setNotice(null); try { await action(); } catch (err) { setError(err instanceof Error ? err.message : 'This action could not be completed.'); } finally { busyRef.current = false; setBusy(null); } };
  const signIn = () => { try { if (packet) sessionStorage.setItem('formal-lab-pending-draft', advancedDirty ? jsonDraft : JSON.stringify(packet)); } catch { /* Sign-in can continue when browser storage is unavailable. */ } window.location.href = '/api/login?returnTo=%2Fformal-lab'; };
  const requireAuthor = () => { if (!user) throw new Error('Sign in to save your draft, request AI formalization, and approve a package. The example can be inspected without signing in.'); };
  const savePacket = async (value: FormalPackage): Promise<FormalSubmission> => {
    requireAuthor();
    const next = !submission ? await request<FormalSubmission>('/submissions', { package: value }) : JSON.stringify(value) !== JSON.stringify(submission.currentRevision.package) ? await request<FormalSubmission>(`/submissions/${encodeURIComponent(submission.id)}/revisions`, { package: value, baseDigest: submission.currentRevision.digest }) : submission;
    takeSubmission(next); return next;
  };
  const currentPacket = (): FormalPackage => { if (!packet) throw new Error('The submission package is still loading.'); if (!advancedDirty) return packet; try { return JSON.parse(jsonDraft); } catch { throw new Error('The advanced package contains invalid JSON. Correct it before continuing.'); } };
  const savePrepared = () => run('Saving draft', async () => { if (!packet) return; await savePacket(currentPacket()); setNotice('Draft saved. Review the exact package before approving it.'); setStep(2); });
  const formalize = () => run('AI is formalizing the claim', async () => { if (!packet) return; requireAuthor(); const value = currentPacket(); if (!value.mainClaim.trim() || !value.source.excerpt.trim()) throw new Error('Add the main claim and source excerpt first.'); const saved = await savePacket(value); const next = await request<FormalSubmission>(`/submissions/${encodeURIComponent(saved.id)}/formalize`, { source: value.source, title: value.title, authors: value.authors, mainClaim: value.mainClaim, selectedInputIds: value.selectedInputs.map(input => input.id) }); takeSubmission(next); setNotice('The AI proposal is ready. Review its assumptions and exact claims before approving.'); setStep(2); });
  const approve = () => run('Recording your approval', async () => { requireAuthor(); if (!submission || dirty || advancedDirty || !approvedIntent) throw new Error('Save and review this revision, then confirm that it represents your claim.'); const next = await request<FormalSubmission>(`/submissions/${encodeURIComponent(submission.id)}/approve`, { digest: submission.currentRevision.digest, confirmed: true }); takeSubmission(next); setStep(3); setNotice('Approval recorded for this exact revision. The independent checker can now run.'); });
  const verify = () => run('Running the independent checker', async () => { requireAuthor(); if (!submission || !approved) throw new Error('Approve the saved package before requesting verification.'); const next = await request<FormalSubmission>(`/submissions/${encodeURIComponent(submission.id)}/verify`, { digest: submission.currentRevision.digest }); takeSubmission(next); setStep(4); });
  const showExample = () => run('Checking the prepared example', async () => { const result = await request<VerificationReport>('/example/report'); setDemoReport(result); setShowDemo(true); setStep(4); workflow.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  const resetExample = () => { if (!catalog) return; setPacket(clone(catalog.example)); setJsonDraft(JSON.stringify(catalog.example, null, 2)); setSubmission(null); setApprovedIntent(false); setShowDemo(false); setStep(0); setError(null); setNotice(null); workflow.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const saveJson = () => run('Saving a new revision', async () => { let next: FormalPackage; try { next = JSON.parse(jsonDraft); } catch { throw new Error('The advanced package contains invalid JSON. Correct it before saving.'); } await savePacket(next); setNotice('A new revision has been saved. Approval and verification apply only to its new digest.'); });

  return <div className="fl">
    <header className="fl-header"><div className="fl-header-inner"><a href="/" className="fl-brand" aria-label="Modern Science Review home">ModernScience<span>.</span>Review</a><a href="/formal-lab" className="fl-lab-wordmark"><FlaskConical size={14} /> Formal Lab <span>Prototype</span></a><div className="fl-header-actions"><a href="/" className="fl-home-link"><ArrowLeft size={14} /> Main site</a>{!authLoading && (user ? <span className="fl-account">{user.firstName || user.email || 'Signed in'}</span> : <button className="fl-button fl-button-small fl-button-ghost" onClick={signIn}>Sign in</button>)}</div></div></header>
    <main>
      <section className="fl-hero"><div className="fl-hero-copy"><div className="fl-eyebrow"><span className="fl-live-dot" /> A SEPARATE EXPERIMENT IN SCIENTIFIC REVIEW</div><h1>Make the assumptions visible.<br /><span>Check the mathematics.</span></h1><p>Choose the inputs. Let AI draft a precise claim. Approve what it means. Then have an independent symbolic checker test what follows.</p><div className="fl-hero-actions"><button className="fl-button fl-button-primary" onClick={resetExample} disabled={!catalog || Boolean(busy)}>Try the one-page example <ArrowRight size={16} /></button><button className="fl-button fl-button-ghost" onClick={showExample} disabled={!catalog || Boolean(busy)}><BookOpen size={16} /> See example results</button></div><p className="fl-hero-footnote">A focused pilot, separate from the existing paper reviews and explanation.</p></div><div className="fl-pilot-card"><div className="fl-pilot-top"><span className="fl-pilot-icon"><FileText size={21} /></span><span className="fl-small-caps">FIRST TEST CASE</span></div><h2>Horizon boundary mechanics</h2><p>J. T. Tyler’s one-page summary, with a prepared submission you can inspect before any author approval.</p><div className="fl-pilot-bottom"><span><strong>{catalog?.example.claims.length ?? '—'}</strong> mathematical claims</span><span className="fl-draft-label">Unapproved draft</span></div></div></section>
      <div className="fl-workflow" ref={workflow} id="formal-workflow"><nav className="fl-steps" aria-label="Submission stages">{STEPS.map((item, index) => { const Icon = item.icon; return <button key={item.title} className={`fl-step ${step === index ? 'fl-step-active' : ''}`} aria-current={step === index ? 'step' : undefined} aria-controls="formal-stage-panel" onClick={() => go(index as Step)} disabled={Boolean(busy)}><span className="fl-step-circle"><Icon size={16} /></span><span className="fl-step-label"><small>0{index + 1}</small><strong>{item.short}</strong></span></button>; })}</nav>
      {error && <div className="fl-alert fl-alert-error" role="alert"><strong>We couldn’t complete that action.</strong><span>{error}</span>{!user && catalog && <button className="fl-text-button" onClick={signIn}>Sign in to continue <ArrowRight size={14} /></button>}</div>}
      {notice && <div className="fl-alert fl-alert-info" role="status">{notice}</div>}
      {busy && <div className="fl-busy" role="status"><Loader2 className="fl-spin" size={17} /> {busy}…</div>}
      {!packet || !catalog ? <div className="fl-panel fl-loading">{!error ? <><Loader2 className="fl-spin" size={24} /><p>Loading the submission workspace…</p></> : <p>The workspace is temporarily unavailable. Please reload to try again.</p>}</div> : <div className={`fl-workspace ${step === 4 && report ? 'fl-workspace-report' : ''}`}>
        <div className="fl-panel" id="formal-stage-panel" aria-busy={Boolean(busy)}>
          <div className="fl-stage-heading"><div className="fl-eyebrow">STAGE 0{step + 1} OF 05</div><h2 ref={stageHeading} tabIndex={-1}>{STEPS[step].title}</h2><p>{['Specify the source, the starting assumptions, and the result you want checked.', 'AI turns the prose into declared assumptions, definitions and exact mathematical claims.', 'Review the full package. Your approval attaches to its exact, immutable revision.', 'The checker runs independently of the AI on the package you approved.', 'Build a conditional explanation with links to the claims that actually passed.'][step]}</p></div>
          {step === 0 && <>
            <section><div className="fl-section-heading"><h3>The source</h3><SourceLink url={packet.source.url}>Open source PDF</SourceLink></div><div className="fl-source-note"><FileText size={18} /><div><strong>Start small: the one-page summary</strong><span>The prepared example is transcribed from the PDF. You can inspect and edit the selected excerpt below.</span></div></div><div className="fl-form-grid"><label className="fl-field fl-field-wide">Submission title<input value={packet.title} onChange={event => edit({ title: event.target.value })} maxLength={300} /></label><label className="fl-field">Author(s)<input value={packet.authors} onChange={event => edit({ authors: event.target.value })} maxLength={300} /></label><label className="fl-field">Source version<input value={packet.source.version} onChange={event => editSource('version', event.target.value)} maxLength={200} /></label><label className="fl-field fl-field-wide">Manuscript title<input value={packet.source.title} onChange={event => editSource('title', event.target.value)} maxLength={300} /></label><label className="fl-field fl-field-wide">Source URL<input type="url" value={packet.source.url} onChange={event => editSource('url', event.target.value)} /></label><label className="fl-field fl-field-wide">Main claim in your own words<textarea rows={4} value={packet.mainClaim} onChange={event => edit({ mainClaim: event.target.value })} maxLength={6000} /><small>State what follows from the chosen inputs, and what is being claimed about its physical interpretation.</small></label><label className="fl-field fl-field-wide">Selected source text<textarea rows={8} value={packet.source.excerpt} onChange={event => editSource('excerpt', event.target.value)} maxLength={16000} /><small>This text and your selected inputs are sent to the AI only when you choose “Ask AI to formalize.”</small></label></div></section>
            <section><div className="fl-section-heading"><h3>Choose the starting inputs</h3><span className="fl-counter">{packet.selectedInputs.length} selected</span></div><p className="fl-section-intro">These are declared premises. The checker verifies consequences of them; selecting an input does not establish it as physical fact.</p><div className="fl-inputs">{catalog.inputs.map(input => <label className={`fl-input-card ${inputIds.has(input.id) ? 'fl-input-selected' : ''}`} key={input.id}><input type="checkbox" checked={inputIds.has(input.id)} onChange={event => edit({ selectedInputs: event.target.checked ? [...packet.selectedInputs, input] : packet.selectedInputs.filter(item => item.id !== input.id) })} /><div><div className="fl-input-title"><strong>{input.title}</strong><code>{input.version}</code></div><p><LatexText>{input.statement}</LatexText></p>{input.sourceUrl && <SourceLink url={input.sourceUrl}>Input reference</SourceLink>}</div></label>)}</div></section>
            <div className="fl-stage-actions"><span>Nothing is approved at this stage.</span><button className="fl-button fl-button-primary" onClick={() => go(1)} disabled={Boolean(busy)}>Continue to formalization <ArrowRight size={16} /></button></div>
          </>}
          {step === 1 && <>
            <div className="fl-proposal-banner"><Sparkles size={23} /><div><h3>{submission?.currentRevision.origin === 'ai' ? 'AI proposal' : 'A prepared proposal to begin with'}</h3><p>{submission?.currentRevision.origin === 'ai' ? 'This proposal has not been endorsed by the checker. Review every assumption and claim.' : 'The one-page example already has a readable mathematical package. Inspect it as prepared, or ask AI to create a new proposal from your source text.'}</p></div></div>
            <div className="fl-ai-action"><div><strong>AI drafts; the checker decides.</strong><p>The AI can propose identities within this prototype’s bounded mathematical language. It cannot mark its own claims as verified.</p></div><button className="fl-button fl-button-primary" onClick={user ? formalize : signIn} disabled={Boolean(busy)}><Sparkles size={16} /> {user ? 'Ask AI to formalize' : 'Sign in to formalize'}</button></div>
            <PacketPreview packet={packet} compact />
            <div className="fl-stage-actions"><button className="fl-text-button" onClick={() => go(0)}><ArrowLeft size={14} /> Edit inputs and source</button><button className="fl-button fl-button-primary" onClick={user ? savePrepared : signIn} disabled={Boolean(busy)}>{user ? 'Save package for review' : 'Sign in to save this package'} <ArrowRight size={16} /></button></div>
          </>}
          {step === 2 && <>
            {(dirty || advancedDirty) && <div className="fl-inline-note">Your edits have not been saved. Save a new revision before approving.</div>}
            <div className="fl-revision-strip"><div><span>Package identity</span><strong>{submission ? `Revision ${submission.currentRevision.revision}` : 'Prepared example · unsaved'}</strong></div><code title={submission?.currentRevision.digest}>{shortDigest(submission?.currentRevision.digest)}</code><span className={`fl-status ${approved ? 'fl-status-checked' : 'fl-status-draft'}`}>{approved ? 'Approved' : 'Awaiting approval'}</span></div>
            <PacketPreview packet={packet} />
            <details className="fl-details fl-advanced"><summary>Advanced: inspect or edit the exact package <ChevronDown size={16} /></summary><p>Edits create a new revision. The server validates the mathematical language, and the new package requires its own approval.</p><label className="fl-field">Formal package JSON<textarea className="fl-json-editor" value={jsonDraft} onChange={event => { setJsonDraft(event.target.value); setApprovedIntent(false); }} disabled={Boolean(busy)} spellCheck={false} rows={18} /></label><button className="fl-button fl-button-ghost" onClick={user ? saveJson : signIn} disabled={Boolean(busy)}>Save as a new revision</button></details>
            <div className="fl-approval"><div className="fl-approval-title"><ShieldCheck size={21} /><h3>Approve the meaning before checking it</h3></div>{approved ? <p className="fl-approved-message"><CheckCircle2 size={17} /> Approved <DateStamp value={submission!.currentRevision.approvedAt!} />. Any substantive edit will require a new approval.</p> : <><label className="fl-approval-checkbox"><input type="checkbox" checked={approvedIntent} onChange={event => setApprovedIntent(event.target.checked)} disabled={!submission || dirty || advancedDirty || Boolean(busy)} /><span>I have reviewed the inputs, assumptions, definitions and claims above. This exact package accurately represents the claim I want checked.</span></label><p>Your approval records the saved package’s SHA-256 digest. It does not approve any future AI changes.</p></>}<div className="fl-approval-actions">{!submission || dirty || advancedDirty ? <button className="fl-button fl-button-primary" onClick={user ? savePrepared : signIn} disabled={Boolean(busy)}>{user ? 'Save this revision first' : 'Sign in to save this revision'}</button> : approved ? <button className="fl-button fl-button-primary" onClick={() => go(3)}>Continue to verification <ArrowRight size={16} /></button> : <button className="fl-button fl-button-primary" onClick={approve} disabled={!approvedIntent || Boolean(busy)}>Approve this exact package <Check size={16} /></button>}</div></div>
          </>}
          {step === 3 && <>
            <div className="fl-checker-card"><div className="fl-checker-icon"><ShieldCheck size={35} /></div><div className="fl-eyebrow">INDEPENDENT, REPRODUCIBLE CHECKING</div><h3>{catalog.capabilities.checker}</h3><p>The server sends the approved mathematical package to a fixed symbolic checker. It compares both sides, checks dimensions and records the required domains.</p><div className="fl-checker-scopes">{catalog.capabilities.scope.map(scope => <span key={scope}><Check size={13} /> {scope}</span>)}</div></div>
            <div className="fl-verification-readiness"><div><span>Saved revision</span><strong>{submission ? `Revision ${submission.currentRevision.revision}` : 'Not saved yet'}</strong></div><div><span>Author approval</span><strong>{approved ? 'Recorded for this digest' : 'Required'}</strong></div><div><span>Package digest</span><code>{shortDigest(submission?.currentRevision.digest)}</code></div></div>
            {(dirty || advancedDirty) && <p className="fl-inline-note">Your local changes differ from the saved package. Save and approve a new revision first.</p>}
            {!approved && <div className="fl-empty-action"><LockKeyhole size={18} /><p>Save and explicitly approve your package before running an author submission.</p><button className="fl-button fl-button-ghost" onClick={() => go(2)}>Review and approve <ArrowRight size={14} /></button></div>}
            <div className="fl-stage-actions"><button className="fl-text-button" onClick={showExample} disabled={Boolean(busy)}>Run the public example instead</button><button className="fl-button fl-button-primary" onClick={verify} disabled={!approved || Boolean(busy)}><ShieldCheck size={16} /> {submission?.currentRevision.verification ? 'Run verification again' : 'Run verification'}</button></div>
          </>}
          {step === 4 && (report && activeReportPacket ? <Report packet={activeReportPacket} report={report} demo={showDemo} /> : <div className="fl-explanation-empty"><BookOpen size={37} /><h3>An explanation with a visible chain of support</h3><p>After verification, each explanation links to the checked claims it depends on, the chosen inputs, and the source manuscript.</p><p>Try the prepared example to see the complete output. It remains a demonstration, without author approval.</p><div className="fl-empty-buttons"><button className="fl-button fl-button-primary" onClick={showExample} disabled={Boolean(busy)}>See the example report <ArrowRight size={16} /></button>{submission && <button className="fl-button fl-button-ghost" onClick={() => go(3)}>Verify your submission</button>}</div></div>)}
        </div>
        <aside className="fl-sidebar"><div className="fl-sidebar-card"><div className="fl-eyebrow">YOUR WORKSPACE</div><h3>{submission ? 'Saved author draft' : 'Prepared example'}</h3><p className="fl-sidebar-title">{packet.title}</p><dl><div><dt>Claims</dt><dd>{packet.claims.length}</dd></div><div><dt>Inputs</dt><dd>{packet.selectedInputs.length}</dd></div><div><dt>Approval</dt><dd>{approved ? 'Recorded' : 'Awaiting author'}</dd></div><div><dt>Verification</dt><dd>{submission?.currentRevision.verification && !dirty && !advancedDirty ? statusLabel(submission.currentRevision.verification.status) : 'Not run'}</dd></div></dl>{submission && <div className="fl-digest-caption"><span>Current package</span><code title={submission.currentRevision.digest}>{shortDigest(submission.currentRevision.digest)}</code></div>}<button className="fl-text-button" onClick={resetExample} disabled={Boolean(busy)}><RotateCcw size={13} /> Start from the example</button></div>
          {!user && <div className="fl-sidebar-card fl-signin-card"><LockKeyhole size={20} /><h3>Inspect freely. Approve as yourself.</h3><p>Sign in to save a draft, ask AI to formalize it, and record your own approval.</p><button className="fl-button fl-button-ghost" onClick={signIn}>Sign in to work on a draft <ArrowRight size={14} /></button></div>}
          {user && submissions.length > 0 && <div className="fl-sidebar-card"><h3>Your saved submissions</h3><div className="fl-saved-list">{submissions.map(item => <button key={item.id} className={item.id === submission?.id ? 'fl-saved-active' : ''} onClick={() => run('Opening saved submission', async () => { const next = await request<FormalSubmission>(`/submissions/${encodeURIComponent(item.id)}`); takeSubmission(next); setStep(next.currentRevision.verification ? 4 : next.currentRevision.approvedAt ? 3 : 2); })} disabled={Boolean(busy)}><strong>{item.title}</strong><span>Revision {item.currentRevision.revision} · {item.currentRevision.approvedAt ? 'approved' : 'draft'}</span></button>)}</div></div>}
          <div className="fl-sidebar-note"><FlaskConical size={19} /><h3>Small enough to learn from</h3><p>This first version checks exact algebra and derivatives under declared assumptions. A successful check establishes the stated mathematical relationship within that scope.</p><a href="https://docs.sympy.org/latest/index.html" target="_blank" rel="noopener noreferrer">About the symbolic engine <ExternalLink size={12} /></a></div>
        </aside>
      </div>}
      </div>
      <footer className="fl-footer"><span><FlaskConical size={14} /> Formal Lab · Prototype</span><p>Inputs → precise claims → author approval → independent checks → linked explanation.</p><a href="/">Return to the main site <ArrowRight size={13} /></a></footer>
    </main>
  </div>;
}
