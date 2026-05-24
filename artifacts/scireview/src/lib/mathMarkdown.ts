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

export function normalizeMathMarkdown(text: string) {
  return String(text ?? "")
    .replace(/\\+begin\{(equation\*?|align\*?|gather\*?|multline\*?)\}([\s\S]*?)\\+end\{\1\}/g, normalizeDisplayEnvironment)
    .replace(/\\+\[([\s\S]*?)\\+\]/g, (_match, math) => `$$${normalizeMathBody(math)}$$`)
    .replace(/\\+\(([\s\S]*?)\\+\)/g, (_match, math) => `$${normalizeMathBody(math)}$`)
    .replace(/\$\$([\s\S]*?)\$\$/g, (_match, math) => `$$${normalizeMathBody(math)}$$`)
    .replace(/\$([^$\n]+?)\$/g, (_match, math) => `$${normalizeMathBody(math)}$`);
}
