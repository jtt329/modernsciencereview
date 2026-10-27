import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import MathText from './FormalMathText';
import './FormalReviewDisclosure.css';
export interface ReviewContentsItem { id: string; title: string; }
/** Open the chosen section and every containing disclosure without a network request. */
export function openReviewTarget(id: string, updateHash = true) {
  const target = document.getElementById(id); if (!target) return false;
  let ancestor: HTMLElement | null = target;
  while (ancestor) { if (ancestor instanceof HTMLDetailsElement) ancestor.open = true; ancestor = ancestor.parentElement; }
  if (updateHash) { const url = new URL(window.location.href); url.hash = id; window.history.replaceState({}, '', url.pathname + url.search + url.hash); }
  window.requestAnimationFrame(() => { target.scrollIntoView({ behavior: 'smooth', block: 'start' }); const focus = target instanceof HTMLDetailsElement ? target.querySelector<HTMLElement>(':scope>summary') : target; if (focus && !focus.hasAttribute('tabindex') && !focus.matches('a,button,input,select,textarea,summary')) focus.tabIndex = -1; focus?.focus({ preventScroll: true }); });
  return true;
}
export function ReviewDisclosure({ id, title, preview, children, className = '', eyebrow, defaultOpen = false, previewLines = 4 }: { id: string; title: string; preview?: string | string[]; children: React.ReactNode; className?: string; eyebrow?: string; defaultOpen?: boolean; previewLines?: number }) {
  const detail = useRef<HTMLDetailsElement>(null), excerpt = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(defaultOpen), [overflow, setOverflow] = useState(false);
  const text = (Array.isArray(preview) ? preview : [preview || '']).filter(Boolean).join('\n\n');
  useEffect(() => { const element = excerpt.current; if (!element || open) return; const measure = () => setOverflow(element.scrollHeight > element.clientHeight + 2); measure(); const observer = new ResizeObserver(measure); observer.observe(element); void document.fonts?.ready.then(measure); return () => observer.disconnect(); }, [open, text]);
  const collapse = () => { if (detail.current) detail.current.open = false; detail.current?.querySelector<HTMLElement>(':scope>summary')?.focus({ preventScroll: true }); detail.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  return <section className="fl-review-disclosure-shell" style={{ '--fl-preview-lines': Math.max(1, Math.min(10, previewLines)) } as React.CSSProperties} data-expanded={open ? 'true' : 'false'}><details ref={detail} id={id} className={`fl-review-disclosure ${className}`} open={defaultOpen || undefined} onToggle={event => setOpen(event.currentTarget.open)}><summary aria-controls={`${id}-content`}><span>{eyebrow && <small>{eyebrow}</small>}<h3><MathText text={title} /></h3></span><span className="fl-review-disclosure-toggle"><span>{open ? 'Collapse' : 'Expand'}</span><ChevronDown size={15} /></span></summary><div id={`${id}-content`} className="fl-review-disclosure-content"><div>{children}</div><button type="button" className="fl-review-collapse" onClick={collapse} aria-label={`Collapse ${title}`}>Collapse section <ChevronDown size={13} /></button></div></details>{!open && text && <button type="button" className="fl-review-disclosure-preview" aria-expanded="false" aria-controls={`${id}-content`} aria-label={`Expand ${title}`} onClick={() => { if (detail.current) detail.current.open = true; }}><span className="fl-review-disclosure-excerpt" ref={excerpt} data-overflow={overflow ? 'true' : 'false'}><MathText text={text} /></span><span className="fl-review-preview-action">Read more <ChevronDown size={12} /></span></button>}</section>;
}
export function ReviewContents({ items }: { items: ReviewContentsItem[] }) {
  useEffect(() => {
    let observer: MutationObserver | undefined, deadline: number | undefined;
    const stop = () => { observer?.disconnect(); if (deadline) window.clearTimeout(deadline); };
    const reveal = () => {
      stop(); let id = ''; try { id = decodeURIComponent(window.location.hash.slice(1)); } catch { return; } if (!id) return;
      if (document.getElementById(id)) { openReviewTarget(id, false); return; }
      // Saved supplemental evidence can arrive after the main review. Observe only
      // the local DOM for a bounded time; never start analysis or poll a provider.
      observer = new MutationObserver(() => { if (document.getElementById(id)) { stop(); openReviewTarget(id, false); } });
      observer.observe(document.body, { childList: true, subtree: true }); deadline = window.setTimeout(stop, 6000);
    };
    const timer = window.setTimeout(reveal, 100); window.addEventListener('hashchange', reveal);
    return () => { window.clearTimeout(timer); stop(); window.removeEventListener('hashchange', reveal); };
  }, [items.map(item => item.id).join('|')]);
  return <details className="fl-review-contents"><summary><span>Contents</span><span>Jump to a review section <ChevronDown size={14} /></span></summary><nav aria-label="Scientific review contents"><ol>{items.map(item => <li key={item.id}><a href={`#${item.id}`} onClick={event => { event.preventDefault(); openReviewTarget(item.id); }}><MathText text={item.title} /></a></li>)}</ol></nav></details>;
}
