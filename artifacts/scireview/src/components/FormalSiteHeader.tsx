import React, { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, LogOut, UploadCloud } from 'lucide-react';
import './FormalSiteHeader.css';
export interface FormalSiteHeaderProps { signedIn?: string; loading?: boolean; signIn?: () => void; uploadHref?: string; onUpload?: () => void; uploadDisabled?: boolean; }
/** Shared navigation for the library, paper reader, upload and compiled explanations. */
export default function FormalSiteHeader({ signedIn, loading = false, signIn, uploadHref = '/formal-lab/submit', onUpload, uploadDisabled = false }: FormalSiteHeaderProps) {
  const login = signIn || (() => { window.location.href = `/api/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`; });
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null), accountButton = useRef<HTMLButtonElement>(null), logoutLink = useRef<HTMLAnchorElement>(null);
  const accountMenuId = useId();
  useEffect(() => { if (!signedIn) setAccountOpen(false); }, [signedIn]);
  useEffect(() => {
    if (!accountOpen) return;
    logoutLink.current?.focus();
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !accountRef.current?.contains(event.target)) setAccountOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [accountOpen]);

  const params = new URLSearchParams(window.location.search);
  const library = (window.location.pathname === '/' || /^\/formal-lab\/?$/.test(window.location.pathname)) && !['submission', 'job', 'prepared'].some(key => params.has(key));
  return <header className="fl-header fl-site-header"><div className="fl-header-inner">
    <a href="/" className="fl-brand" aria-label="ModernScience.Review home">ModernScience<span>.</span>Review</a>
    <nav className="fl-site-navigation" aria-label="Main navigation"><a href="/" aria-current={library && params.get('view') !== 'subjects' ? 'page' : undefined}>Explore papers</a><a href="/?view=subjects" aria-current={library && params.get('view') === 'subjects' ? 'page' : undefined}>Compiled explanations</a></nav>
    <div className="fl-header-actions">{!loading && (signedIn ? <div className="fl-account-menu" ref={accountRef} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setAccountOpen(false); }} onKeyDown={event => { if (event.key === 'Escape' && accountOpen) { event.preventDefault(); setAccountOpen(false); accountButton.current?.focus(); } }}><button type="button" className="fl-account-button" ref={accountButton} aria-label={`Account menu for ${signedIn}`} aria-haspopup="menu" aria-expanded={accountOpen} aria-controls={accountMenuId} onClick={() => setAccountOpen(open => !open)} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setAccountOpen(true); } }}><span className="fl-account" title={signedIn}>{signedIn}</span><ChevronDown size={11} aria-hidden="true" /></button>{accountOpen && <div className="fl-account-dropdown" id={accountMenuId} role="menu" aria-label="Account"><p role="presentation">Signed in as <strong>{signedIn}</strong></p><a href="/api/logout" role="menuitem" ref={logoutLink}><LogOut size={14} aria-hidden="true" />Sign out</a></div>}</div> : <button type="button" className="fl-site-sign-in" onClick={login}>Sign in</button>)}{onUpload ? <button type="button" className="fl-header-upload" onClick={onUpload} disabled={uploadDisabled}><UploadCloud size={15} />Upload paper</button> : <a className="fl-header-upload" href={uploadHref}><UploadCloud size={15} />Upload paper</a>}</div>
  </div></header>;
}
