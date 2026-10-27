import React from 'react';
import { UploadCloud } from 'lucide-react';
import './FormalSiteHeader.css';
export interface FormalSiteHeaderProps { signedIn?: string; loading?: boolean; signIn?: () => void; uploadHref?: string; onUpload?: () => void; uploadDisabled?: boolean; }
/** Shared navigation for the library, paper reader, upload and compiled explanations. */
export default function FormalSiteHeader({ signedIn, loading = false, signIn, uploadHref = '/formal-lab/submit', onUpload, uploadDisabled = false }: FormalSiteHeaderProps) {
  const login = signIn || (() => { window.location.href = `/api/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`; });
  const params = new URLSearchParams(window.location.search);
  const library = (window.location.pathname === '/' || /^\/formal-lab\/?$/.test(window.location.pathname)) && !['submission', 'job', 'prepared'].some(key => params.has(key));
  return <header className="fl-header fl-site-header"><div className="fl-header-inner">
    <a href="/" className="fl-brand" aria-label="ModernScience.Review home">ModernScience<span>.</span>Review</a>
    <nav className="fl-site-navigation" aria-label="Main navigation"><a href="/" aria-current={library && params.get('view') !== 'subjects' ? 'page' : undefined}>Explore papers</a><a href="/?view=subjects" aria-current={library && params.get('view') === 'subjects' ? 'page' : undefined}>Compiled explanations</a></nav>
    <div className="fl-header-actions">{!loading && (signedIn ? <span className="fl-account" title={signedIn}>{signedIn}</span> : <button type="button" className="fl-site-sign-in" onClick={login}>Sign in</button>)}{onUpload ? <button type="button" className="fl-header-upload" onClick={onUpload} disabled={uploadDisabled}><UploadCloud size={15} />Upload paper</button> : <a className="fl-header-upload" href={uploadHref}><UploadCloud size={15} />Upload paper</a>}</div>
  </div></header>;
}
