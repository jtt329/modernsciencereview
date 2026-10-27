/** Typography for AI assessment prose only. Stored reports and exports stay exact. */
export function assessmentDisplayText(value: string): string {
  const replace = (text: string) => text.replace(/\bnoveltyFindings\b/g, 'claim-specific literature comparisons');
  const protectedSpan = /\$\$[\s\S]*?\$\$|\$[^$\n]+\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|```[\s\S]*?```|`[^`\n]*`|https?:\/\/[^\s<>]+/g;
  let out = '', index = 0;
  for (const match of value.matchAll(protectedSpan)) { out += replace(value.slice(index, match.index)); out += match[0] === '`noveltyFindings`' ? 'claim-specific literature comparisons' : match[0]; index = match.index! + match[0].length; }
  return out + replace(value.slice(index));
}
