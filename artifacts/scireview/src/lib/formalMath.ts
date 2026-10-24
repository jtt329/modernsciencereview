import { normalizeMathMarkdown } from './mathMarkdown';

export type FormalMathSegment = { kind: 'text' | 'code' | 'math'; text: string; display?: boolean; source?: string };

const greek: Record<string, string> = {
  α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', ε: 'epsilon', ϵ: 'varepsilon', ζ: 'zeta', η: 'eta', θ: 'theta', ϑ: 'vartheta', ι: 'iota', κ: 'kappa', λ: 'lambda', μ: 'mu', µ: 'mu', ν: 'nu', ξ: 'xi', π: 'pi', ϖ: 'varpi', ρ: 'rho', ϱ: 'varrho', σ: 'sigma', ς: 'varsigma', τ: 'tau', υ: 'upsilon', φ: 'phi', ϕ: 'varphi', χ: 'chi', ψ: 'psi', ω: 'omega',
  Γ: 'Gamma', Δ: 'Delta', Θ: 'Theta', Λ: 'Lambda', Ξ: 'Xi', Π: 'Pi', Σ: 'Sigma', Υ: 'Upsilon', Φ: 'Phi', Ψ: 'Psi', Ω: 'Omega', ℏ: 'hbar',
};
const namedGreek = new Set([...Object.values(greek), 'hbar']);
const superscript: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁺': '+', '⁻': '-', '⁼': '=', '⁽': '(', '⁾': ')' };
const subscript: Record<string, string> = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9', '₊': '+', '₋': '-', '₌': '=', '₍': '(', '₎': ')' };
const greekChars = 'Α-Ωα-ωϑϕϵϱϖµℏ';
const scriptChars = '⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎';
const tokenPattern = new RegExp(String.raw`[_^](?:\{[^{}\n]+\}|\([^()\n]+\)|[A-Za-z0-9${greekChars}]+)|[A-Za-z${greekChars}][A-Za-z0-9${greekChars}]*(?:(?:[_^](?:\{[^{}\n]+\}|\([^()\n]+\)|[A-Za-z0-9${greekChars}]+))|[${scriptChars}]+)*|\d+(?:\.\d+)?|!=|<=|>=|==|[=<>≈≃≠≤≥∝→←⇒±+−*/·×∂∇]|[()[\]{},|^-]|\s+|[\s\S]`, 'gu');
const proseWords = new Set(['an', 'as', 'at', 'be', 'by', 'do', 'go', 'he', 'if', 'in', 'is', 'it', 'me', 'my', 'no', 'of', 'on', 'or', 'so', 'to', 'up', 'us', 'we']);
const acronyms = new Set(['AI', 'API', 'AST', 'FRW', 'PDF', 'PDE', 'ODE', 'QFT', 'GR', 'SI', 'URL', 'JSON', 'LHS', 'RHS', 'GPT', 'SHA', 'HTTP', 'HTTPS', 'TXT']);
const protectedPattern = /(```[\s\S]*?```|`[^`\n]*`|https?:\/\/[^\s<>]+|\b[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\b|\b[a-f0-9]{32,64}\b|\b[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+\b|\b(?:p\d+-l\d+|[ic]\d{2,3}|b[1-5]-[\w-]+)\b|\$\$[\s\S]*?\$\$|\$[^$\n]+\$|\\+\[[\s\S]*?\\+\]|\\+\([\s\S]*?\\+\)|\\+begin\{(equation\*?|align\*?|gather\*?|multline\*?)\}[\s\S]*?\\+end\{\2\})/g;

/** Typography only: never changes the source, formal AST, or approved digest. */
export function formalMathLatex(value: string, inferred = false): string {
  let result = value;
  if (inferred) {
    result = result.replace(/\^\(([^()]+)\)/g, '^{($1)}').replace(/_([A-Za-z][A-Za-z0-9]*|[Α-Ωα-ωϑϕϵϱϖµ]|[0-9]+)/g, (_all, sub: string) => `_{${sub.length > 1 && /^[A-Za-z]+$/.test(sub) && !namedGreek.has(sub) ? `\\mathrm{${sub}}` : sub}}`);
    result = result.replace(/\\[A-Za-z]+|\b[A-Za-z]+\b/g, word => namedGreek.has(word) ? `\\${word}{}` : word);
    result = result.replace(/!=/g, '\\ne ').replace(/<=/g, '\\le ').replace(/>=/g, '\\ge ').replace(/\*\*/g, '^').replace(/\*/g, '\\cdot ');
    result = result.replace(/\^(-?\d+(?:\.\d+)?|[A-Za-z]+|[Α-Ωα-ωϑϕϵϱϖµ])/g, '^{$1}');
  }
  return result
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾]+/g, run => `^{${[...run].map(char => superscript[char]).join('')}}`)
    .replace(/[₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎]+/g, run => `_{${[...run].map(char => subscript[char]).join('')}}`)
    .replace(/[α-ωΑ-Ωϑϕϵϱϖµℏ]/g, char => greek[char] ? `\\${greek[char]}{}` : char)
    .replace(/−/g, '-').replace(/·/g, '\\cdot ').replace(/×/g, '\\times ')
    .replace(/∂/g, '\\partial ').replace(/∇/g, '\\nabla ')
    .replace(/≠/g, '\\ne ').replace(/≤/g, '\\le ').replace(/≥/g, '\\ge ')
    .replace(/≈/g, '\\approx ').replace(/≃/g, '\\simeq ').replace(/∝/g, '\\propto ')
    .replace(/→/g, '\\to ').replace(/←/g, '\\leftarrow ').replace(/⇒/g, '\\Rightarrow ');
}
function mathToken(token: string): boolean {
  if (/^\d+(?:\.\d+)?$/.test(token)) return true;
  if (new RegExp(`[${greekChars}${scriptChars}_^]`, 'u').test(token)) return true;
  if (proseWords.has(token.toLowerCase())) return false;
  if (/^[A-Za-z]$/.test(token) || namedGreek.has(token)) return true;
  return !acronyms.has(token) && (/^[A-Z]{2,3}$/.test(token) || /^d[A-Za-z]$/.test(token) || /^[A-Z][a-z]$/.test(token) || /^[a-z][A-Z]$/.test(token));
}
function bareMath(text: string): FormalMathSegment[] {
  const tokens = Array.from(text.matchAll(tokenPattern), match => ({ text: match[0], start: match.index! }));
  const out: FormalMathSegment[] = [];
  let plainStart = 0;
  for (let i = 0; i < tokens.length; i++) {
    const first = tokens[i];
    if (!mathToken(first.text) && !/^[([{∂∇]$/.test(first.text)) continue;
    let j = i, end = i, atoms = 0, depth = 0;
    for (; j < tokens.length && tokens[j].start - first.start < 400; j++) {
      const t = tokens[j].text;
      if (/^\s+$/.test(t)) { if (t.includes('\n')) break; continue; }
      if (mathToken(t)) {
        // Leave English articles/pronouns in prose, including after a formula.
        const next = tokens.slice(j + 1).find(token => !/^\s+$/.test(token.text));
        if (/^[AaI]$/.test(t) && next && /^[A-Za-z]{2,}$/.test(next.text) && !mathToken(next.text) && !['and', 'or'].includes(next.text)) break;
        atoms++; end = j + 1; continue;
      }
      if (/^[([{]$/.test(t)) { depth++; continue; }
      if (/^[)\]}]$/.test(t)) { if (!depth) break; depth--; end = j + 1; continue; }
      if (/^(?:!=|<=|>=|==|[=<>≈≃≠≤≥∝→←⇒±+−*/·×∂∇,|^-])$/.test(t)) continue;
      break;
    }
    if (!atoms || depth !== 0 || end <= i) continue;
    const stop = tokens[end - 1].start + tokens[end - 1].text.length;
    const candidate = text.slice(first.start, stop);
    const meaningful = /[A-Za-zΑ-Ωα-ωϑϕϵϱϖµℏ]/.test(candidate);
    if (!meaningful) continue;
    if (first.start > plainStart) out.push({ kind: 'text', text: text.slice(plainStart, first.start) });
    out.push({ kind: 'math', text: formalMathLatex(candidate, true), source: candidate, display: false });
    plainStart = stop; i = end - 1;
  }
  if (plainStart < text.length) out.push({ kind: 'text', text: text.slice(plainStart) });
  return out;
}
function mathBody(segment: string): { body: string; display: boolean } | undefined {
  if (segment.startsWith('$$') && segment.endsWith('$$')) return { body: segment.slice(2, -2), display: true };
  if (segment.startsWith('$') && segment.endsWith('$')) return { body: segment.slice(1, -1), display: false };
  if (/^\\+[[(]/.test(segment) || /^\\+begin\{/.test(segment)) {
    const normalized = normalizeMathMarkdown(segment);
    if (normalized !== segment) return mathBody(normalized);
  }
  return undefined;
}
function segments(value: string, infer: boolean): FormalMathSegment[] {
  const out: FormalMathSegment[] = [];
  let start = 0;
  for (const match of value.matchAll(protectedPattern)) {
    // Mathematical subscripts belong to the surrounding expression, whereas
    // multiword checker identifiers stay literal.
    const parts = match[0].split('_');
    if (/^[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+$/.test(match[0]) && parts.length === 2 && (parts[0].length === 1 || namedGreek.has(parts[0]))) continue;
    if (match.index! > start) out.push(...plain(value.slice(start, match.index), infer));
    const token = match[0], math = mathBody(token);
    if (token.startsWith('`')) out.push({ kind: 'code', text: token.replace(/^`{1,3}|`{1,3}$/g, ''), source: token });
    else if (math && !/^\d[\d,.]*\s+(?:and|per|for|each)\b/.test(math.body)) out.push({ kind: 'math', text: formalMathLatex(math.body), display: math.display, source: token });
    else out.push({ kind: 'text', text: token });
    start = match.index! + token.length;
  }
  if (start < value.length) out.push(...plain(value.slice(start), infer));
  return out;
}
function plain(value: string, infer: boolean): FormalMathSegment[] {
  if (!infer) return [{ kind: 'text', text: value }];
  // Reuse the site's established support for un-delimited TeX commands, but
  // keep code, source identifiers and links outside that normalization.
  const normalized = value.includes('\\') ? normalizeMathMarkdown(value) : value;
  if (normalized !== value) {
    const out: FormalMathSegment[] = []; let start = 0;
    for (const match of normalized.matchAll(/\$\$[\s\S]*?\$\$|\$[^$\n]+\$/g)) {
      if (match.index! > start) out.push(...bareMath(normalized.slice(start, match.index)));
      const math = mathBody(match[0])!;
      out.push({ kind: 'math', text: formalMathLatex(math.body, true), display: math.display, source: match[0] });
      start = match.index! + match[0].length;
    }
    if (start < normalized.length) out.push(...bareMath(normalized.slice(start)));
    return out;
  }
  return bareMath(value);
}
export function formalMathSegments(text: string, verbatim = false): FormalMathSegment[] {
  return segments(String(text ?? ''), !verbatim);
}
