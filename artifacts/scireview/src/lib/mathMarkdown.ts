function normalizeMathBody(value: string) {
  return String(value ?? "")
    .trim()
    .replace(/\\\\(?=[A-Za-z])/g, "\\")
    .replace(/\\\\(?=[()[\]{}_^])/g, "\\");
}

function normalizeDisplayEnvironment(_match: string, env: string, body: string) {
  const math = normalizeMathBody(body);
  if (/^equation\*?$/.test(env)) return `$$${math}$$`;
  return `$$\\begin{aligned}${math}\\end{aligned}$$`;
}

const protectedMathOrCodePattern = /(```[\s\S]*?```|`[^`]*`|\$\$[\s\S]*?\$\$|\$[^$\n]+?\$)/g;
const latexCommandPattern = String.raw`\\[A-Za-z]+(?:\*)?(?:\{[^{}\n]*\}){0,3}(?:[_^](?:\{[^{}\n]*\}|[A-Za-z0-9]))*`;
const mathSymbolPattern = String.raw`[πΠδΔθΘλΛμµρσΣφΦψΨωΩαβγηκντχ∂∇∞≤≥≈≃≠∝→←⇒±×·]`;
const latexEquationUnitPattern = String.raw`(?:${latexCommandPattern}|[A-Za-zΑ-Ωα-ω]{1,3}(?:[_^](?:\{[^{}\n]*\}|[A-Za-z0-9]))?|[0-9]+(?:\.[0-9]+)?|[{}()[\]+\-*/.,]|${mathSymbolPattern})`;
const latexEquationLeftSidePattern = String.raw`${latexCommandPattern}(?:\s*${latexEquationUnitPattern}){0,24}`;
const latexEquationRightSidePattern = String.raw`${latexEquationUnitPattern}(?:\s*${latexEquationUnitPattern}){0,24}`;
const mathRelationPattern = String.raw`(?:=|≈|≃|≠|≤|≥|∝|→|←|⇒)`;
const bareLatexEquationPattern = new RegExp(
  String.raw`(^|[\s([{;:])(${latexEquationLeftSidePattern}\s*${mathRelationPattern}\s*${latexEquationRightSidePattern})(?=$|[\s.,;:)\]}])`,
  "g",
);
const bareLatexExpressionPattern = new RegExp(
  String.raw`(^|[\s([{;:])((?=[^\n$` + "`" + String.raw`]*[()+\-*/])${latexCommandPattern}(?:\s*(?:${latexCommandPattern}|[A-Za-zΑ-Ωα-ω0-9_{}^()+\-*/.]|${mathSymbolPattern})){1,40})(?=$|[\s.,;:)\]}])`,
  "g",
);
const barePlainEquationPattern = /(^|[\s([{;:])([A-Za-zΑ-Ωα-ω][A-Za-zΑ-Ωα-ω0-9_{}^]*(?:\s*[+\-*/]\s*[A-Za-zΑ-Ωα-ω0-9_{}^()]+){0,4}\s*(?:=|≈|≃|≠|≤|≥|∝|→|←|⇒)\s*[A-Za-zΑ-Ωα-ω0-9_{}^().πΠ+\-*/]+(?:\s*[+\-*/]\s*[A-Za-zΑ-Ωα-ω0-9_{}^().πΠ+\-*/]+){0,8})(?=$|[\s.,;:)\]}])/g;
const bareLatexAtomPattern = new RegExp(latexCommandPattern, "g");

function protectMathAndCode(text: string, transform: (segment: string) => string) {
  return text
    .split(protectedMathOrCodePattern)
    .map((segment) => {
      protectedMathOrCodePattern.lastIndex = 0;
      const isProtected = protectedMathOrCodePattern.test(segment);
      protectedMathOrCodePattern.lastIndex = 0;
      if (!segment || isProtected) {
        return segment;
      }
      return transform(segment);
    })
    .join("");
}

function shouldWrapMathCandidate(candidate: string) {
  const value = candidate.trim();
  if (!value || value.length < 3 || value.length > 180) return false;
  if (/https?:\/\//i.test(value)) return false;
  if (/[{}][^{}]*[{}][^{}]*[{}][^{}]*[{}][^{}]*[{}][^{}]*[{}]/.test(value)) return false;
  return (
    /\\[A-Za-z]+/.test(value) ||
    new RegExp(mathRelationPattern).test(value) ||
    /[πΠδΔθΘλΛμµρσΣφΦψΨωΩαβγηκντχ∂∇∞≤≥≈≃≠∝→←⇒±×·]/.test(value)
  );
}

function wrapInlineMath(prefix: string, candidate: string) {
  const proseBoundary = /\s+\b(?:and|or|where|with|while|but|because|is|are|was|were)\b[\s\S]*$/i.exec(candidate);
  let value = (proseBoundary ? candidate.slice(0, proseBoundary.index) : candidate).trim();
  let suffix = proseBoundary ? candidate.slice(proseBoundary.index) : "";
  const trailingPunctuation = /([,;:]|\.(?=\D*$))+$/.exec(value);
  if (trailingPunctuation) {
    value = value.slice(0, trailingPunctuation.index).trimEnd();
    suffix = `${trailingPunctuation[0]}${suffix}`;
  }
  return shouldWrapMathCandidate(value) ? `${prefix}$${normalizeMathBody(value)}$${suffix}` : `${prefix}${candidate}`;
}

function wrapBareMathInPlainText(text: string) {
  return text
    .split("\n")
    .map((line) => {
      if (!line.trim() || /^\s*\|/.test(line)) return line;
      const withLatexEquations = line.replace(bareLatexEquationPattern, (_match, prefix, candidate) =>
        wrapInlineMath(prefix, candidate),
      );
      const withPlainEquations = protectMathAndCode(withLatexEquations, (segment) =>
        segment.replace(barePlainEquationPattern, (_match, prefix, candidate) =>
          wrapInlineMath(prefix, candidate),
        ),
      );
      const withLatexExpressions = protectMathAndCode(withPlainEquations, (segment) =>
        segment.replace(bareLatexExpressionPattern, (_match, prefix, candidate) =>
          wrapInlineMath(prefix, candidate),
        ),
      );
      return protectMathAndCode(withLatexExpressions, (segment) =>
        segment.replace(bareLatexAtomPattern, (candidate) =>
          shouldWrapMathCandidate(candidate) ? `$${normalizeMathBody(candidate)}$` : candidate,
        ),
      );
    })
    .join("\n");
}

export function normalizeMathMarkdown(text: string) {
  const normalized = String(text ?? "")
    .replace(/\\+begin\{(equation\*?|align\*?|gather\*?|multline\*?)\}([\s\S]*?)\\+end\{\1\}/g, normalizeDisplayEnvironment)
    .replace(/\\+\[([\s\S]*?)\\+\]/g, (_match, math) => `$$${normalizeMathBody(math)}$$`)
    .replace(/\\+\(([\s\S]*?)\\+\)/g, (_match, math) => `$${normalizeMathBody(math)}$`)
    .replace(/\$\$([\s\S]*?)\$\$/g, (_match, math) => `$$${normalizeMathBody(math)}$$`)
    .replace(/\$([^$\n]+?)\$/g, (_match, math) => `$${normalizeMathBody(math)}$`);
  return protectMathAndCode(normalized, wrapBareMathInPlainText);
}
