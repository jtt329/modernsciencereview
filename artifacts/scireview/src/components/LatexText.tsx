import React, { useMemo } from 'react';
import katex from 'katex';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderLatex(text: string): string {
  if (!text) return '';
  text = String(text)
    .replace(/\\\[([\s\S]*?)\\\]/g, (_match, math) => `$$${math}$$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_match, math) => `$${math}$`);
  let result = '';
  let remaining = text;

  while (remaining.length > 0) {
    const displayIdx = remaining.indexOf('$$');
    const inlineIdx = remaining.indexOf('$');

    if (displayIdx === -1 && inlineIdx === -1) {
      result += escapeHtml(remaining);
      break;
    }

    if (displayIdx !== -1 && (inlineIdx === -1 || displayIdx <= inlineIdx)) {
      result += escapeHtml(remaining.slice(0, displayIdx));
      remaining = remaining.slice(displayIdx + 2);
      const end = remaining.indexOf('$$');
      if (end === -1) {
        result += '$$' + escapeHtml(remaining);
        break;
      }
      const math = remaining.slice(0, end);
      try {
        result += katex.renderToString(math, { displayMode: true, throwOnError: false });
      } catch {
        result += escapeHtml('$$' + math + '$$');
      }
      remaining = remaining.slice(end + 2);
    } else {
      result += escapeHtml(remaining.slice(0, inlineIdx));
      remaining = remaining.slice(inlineIdx + 1);
      const end = remaining.indexOf('$');
      if (end === -1) {
        result += '$' + escapeHtml(remaining);
        break;
      }
      const math = remaining.slice(0, end);
      try {
        result += katex.renderToString(math, { displayMode: false, throwOnError: false });
      } catch {
        result += escapeHtml('$' + math + '$');
      }
      remaining = remaining.slice(end + 1);
    }
  }

  return result;
}

interface LatexTextProps {
  children: string;
  className?: string;
}

export default function LatexText({ children, className }: LatexTextProps) {
  const html = useMemo(() => renderLatex(children), [children]);
  return (
    <span
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
