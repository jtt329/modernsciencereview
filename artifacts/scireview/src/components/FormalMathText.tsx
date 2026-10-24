import React, { useMemo } from 'react';
import katex from 'katex';
import { formalMathSegments } from '../lib/formalMath';

/** Render scientific display text; the saved source/package is never edited. */
export default function FormalMathText({ text, verbatim = false }: { text: string; verbatim?: boolean }) {
  const rendered = useMemo(() => formalMathSegments(text, verbatim).map((segment, index) => {
    if (segment.kind === 'code') return <code key={index}>{segment.text}</code>;
    if (segment.kind !== 'math') return <React.Fragment key={index}>{segment.text}</React.Fragment>;
    try {
      const html = katex.renderToString(segment.text, { displayMode: segment.display, throwOnError: true, trust: false, strict: 'ignore', maxExpand: 1000, maxSize: 20, output: 'htmlAndMathml' });
      return <span key={index} className={segment.display ? 'fl-math-display' : 'fl-math-inline'} dangerouslySetInnerHTML={{ __html: html }} />;
    } catch {
      return <span key={index} className="fl-math-fallback">{segment.source || segment.text}</span>;
    }
  }), [text, verbatim]);
  return <span className="fl-math-text">{rendered}</span>;
}
