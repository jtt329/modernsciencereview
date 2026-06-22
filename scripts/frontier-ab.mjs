#!/usr/bin/env node
// Frontier-model A/B harness (out-of-benchmark, local; no production touch).
//
// Runs the ACTIVE v19.0.7 review pipeline (2 blind passes + adjudicator + the
// code conditional-derivation) on the Top-55 PDFs through a SELECTABLE model, so
// candidates (GPT-5.5, GLM-5.2, …) can be compared to Gemini on the SAME
// prompt/schema/scoring. Captures per paper: score, conditional (+ realizability
// cap), firmnessRung population, and the rationale prose (subscoreRationale +
// scientific review + central claim). Also tallies token usage and an estimated
// $ per model (to size the 54-run). Writes Top-55/ab_<model>.json.
//
//   MODEL=gemini node --env-file=.env scripts/frontier-ab.mjs
//   MODEL=gpt    node --env-file=.env scripts/frontier-ab.mjs   (GPT_MODEL default gpt-5.5)
//   MODEL=glm    node --env-file=.env scripts/frontier-ab.mjs   (OpenRouter z-ai/glm-5.2)
//   PAPERS=22,30 ... (subset)
//
// Keys (gitignored .env): OPENAI_API_KEY (gpt), AI_INTEGRATIONS_GEMINI_API_KEY +
// AI_INTEGRATIONS_GEMINI_BASE_URL (gemini), OPENROUTER_API_KEY (glm). Run with
// NODE_ENV=production so the bundled logger does not load pino-pretty.
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const ROOT = "/Users/jttyler/Projects/modernsciencereview";
const MODEL = (process.env.MODEL || "gemini").toLowerCase();
const enginePath = join(ROOT, "artifacts/api-server/src/lib/reviewEngineCompat.ts");
const condPath = join(ROOT, "artifacts/api-server/src/lib/assumptionConditionals.ts");

const entry = `
import { readFileSync, writeFileSync } from "node:fs";
import {
  REVIEW_SYSTEM_INSTRUCTION, BLIND_INTRINSIC_ADJUDICATOR_PROMPT, individualReviewJsonSchema,
  buildAdjudicatorInput, normalizeIndividualReview, GEMINI_PASS_MODEL, GEMINI_META_MODEL,
  REVIEW_PROMPT_VERSION, REVIEW_PROMPT_HASH,
} from ${JSON.stringify(enginePath)};
import {
  deriveAssumptionConditionalsRawFromLedger, outputReferentRealizableFromLedger, computeAssumptionConditionals,
} from ${JSON.stringify(condPath)};

const MODEL = ${JSON.stringify(MODEL)};
const DIR = "/Users/jttyler/Desktop/Top 55";
const GLM_MODEL = process.env.GLM_MODEL || "z-ai/glm-5.2";
const GPT_MODEL = process.env.GPT_MODEL || "gpt-5.5-pro"; // highest reasoning tier
// ASSUMED per-million-token rates (input/output) — report exact tokens too so JT
// can recompute against the real billing dashboard.
const RATES = { gemini: [2.0, 12.0], gpt: [15.0, 120.0], glm: [0.6, 2.2] }; // gpt = ASSUMED gpt-5.5-pro tier; confirm vs the OpenAI dashboard
const ALL = {
  "22": { id: "22_Enthalpy_AdS", file: "22_Kastor_Ray__Traschen__Enthalpy_and_the_Mechanics_of_AdS_Black_Holes.pdf", expect: "no AdS/CFT conditional (AdS is the output setting)" },
  "25": { id: "25_RT", file: "25_Ryu__Takayanagi__Holographic_Derivation_of_Entanglement_Entropy_from_AdSCFT.pdf", expect: "conditional retained + capped <100 (AdS/CFT open input)" },
  "36": { id: "36_Maldacena", file: "36_Maldacena__The_Large_N_Limit_of_Superconformal_Field_Theories_and_Supergravity.pdf", expect: "conditional retained + capped <100 (string-theory open inputs)" },
  "30": { id: "30_Page", file: "30_Page__Information_in_Black_Hole_Radiation.pdf", expect: "conditional restored via open construction (typicality)" },
  "50": { id: "50_Campos", file: "50_Campos__Charged_Rotating_Black_Hole_and_the_First_Law.pdf", expect: "no conditional (wrong-paper control)" },
};
const want = (process.env.PAPERS || "22,25,36,30,50").split(",").map((s) => s.trim());
const PAPERS = want.map((k) => ALL[k]).filter(Boolean);
const usage = { in: 0, out: 0, reasoning: 0, calls: 0 };

function extractJson(text) {
  let t = String(text || "").trim();
  if (t.startsWith("\\\`\\\`\\\`")) t = t.replace(/^\\\`\\\`\\\`(?:json)?/i, "").replace(/\\\`\\\`\\\`\\s*$/, "").trim();
  const f = t.indexOf("{"), l = t.lastIndexOf("}");
  if (f >= 0 && l > f) t = t.slice(f, l + 1);
  return JSON.parse(t);
}
function b64(file) { return readFileSync(\`\${DIR}/\${file}\`).toString("base64"); }
const NOTE = "Review the attached manuscript PDF. Ignore author names, affiliations, venue, and citation signals; base the review only on the scientific content.";

let geminiAI = null;
async function callGemini(systemInstruction, file) {
  if (!geminiAI) ({ ai: geminiAI } = await import("@workspace/integrations-gemini-ai"));
  let lastErr;
  for (const useSchema of [true, false]) {
    for (let a = 0; a < 2; a += 1) {
      try {
        const resp = await geminiAI.models.generateContent({
          model: systemInstruction === BLIND_INTRINSIC_ADJUDICATOR_PROMPT ? GEMINI_META_MODEL : GEMINI_PASS_MODEL,
          contents: [{ role: "user", parts: typeof file === "string" ? [{ text: file }] : [{ text: NOTE }, { inlineData: { mimeType: "application/pdf", data: file } }] }],
          config: { systemInstruction, responseMimeType: "application/json", ...(useSchema ? { responseJsonSchema: individualReviewJsonSchema } : {}), temperature: 0.15, maxOutputTokens: 16384 },
        });
        const u = resp.usageMetadata || {}; usage.in += u.promptTokenCount || 0; usage.out += u.candidatesTokenCount || 0; usage.calls += 1;
        if (!resp.text) throw new Error("empty");
        return extractJson(resp.text);
      } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 2500 * (a + 1))); }
    }
  }
  throw lastErr;
}

let openaiClients = {};
function oa(kind) {
  if (!openaiClients[kind]) {
    const OpenAI = openaiClients.__ctor;
    if (kind === "gpt") {
      if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
      openaiClients.gpt = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    } else {
      if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not set");
      openaiClients.glm = new OpenAI({ apiKey: process.env.OPENROUTER_API_KEY, baseURL: "https://openrouter.ai/api/v1" });
    }
  }
  return openaiClients[kind];
}
async function callOpenAICompatible(kind, model, systemInstruction, file) {
  if (!openaiClients.__ctor) openaiClients.__ctor = (await import("openai")).default;
  const client = oa(kind);
  const userContent = typeof file === "string"
    ? file
    : [{ type: "text", text: NOTE }, { type: "file", file: { filename: "manuscript.pdf", file_data: "data:application/pdf;base64," + file } }];
  let lastErr;
  for (let a = 0; a < 3; a += 1) {
    try {
      const resp = await client.chat.completions.create({
        model,
        max_completion_tokens: 32768,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: systemInstruction }, { role: "user", content: userContent }],
        ...(kind === "glm" && typeof file !== "string" ? { plugins: [{ id: "file-parser", pdf: { engine: "pdf-text" } }] } : {}),
      });
      const u = resp.usage || {}; usage.in += u.prompt_tokens || 0; usage.out += u.completion_tokens || 0; usage.calls += 1;
      const c = resp.choices?.[0]?.message?.content;
      if (!c) throw new Error("empty");
      return extractJson(c);
    } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 3000 * (a + 1))); }
  }
  throw lastErr;
}
// GPT (incl. the pro reasoning tier) uses the Responses API — pro models are not
// available on chat/completions. Highest reasoning via reasoning.effort=high.
let openaiResp = null;
async function callGpt(systemInstruction, file) {
  if (!openaiResp) {
    const OpenAI = (await import("openai")).default;
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
    openaiResp = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  const content = typeof file === "string"
    ? [{ type: "input_text", text: file }]
    : [{ type: "input_text", text: NOTE }, { type: "input_file", filename: "manuscript.pdf", file_data: "data:application/pdf;base64," + file }];
  let lastErr;
  for (let a = 0; a < 5; a += 1) {
    try {
      const resp = await openaiResp.responses.create({
        model: GPT_MODEL,
        instructions: systemInstruction,
        input: [{ role: "user", content }],
        reasoning: { effort: "high" },
        max_output_tokens: 48000,
      });
      const u = resp.usage || {};
      usage.in += u.input_tokens || 0; usage.out += u.output_tokens || 0; usage.calls += 1;
      usage.reasoning += u.output_tokens_details?.reasoning_tokens || 0;
      const t = resp.output_text;
      if (!t) throw new Error("empty (status " + (resp.status || "?") + ", incomplete: " + (resp.incomplete_details?.reason || "?") + ")");
      return extractJson(t);
    } catch (e) {
      lastErr = e;
      // Respect the 429 retry-after ("try again after N seconds"); low-tier
      // accounts return long waits. Fall back to a growing backoff otherwise.
      const m = String(e?.message || "").match(/after ([\\d.]+)\\s*s/i);
      const waitS = m ? Math.ceil(parseFloat(m[1])) + 4 : 20 * (a + 1);
      console.log("  [gpt retry " + (a + 1) + "] " + String(e?.message || e).slice(0, 90) + " — waiting " + waitS + "s");
      await new Promise((r) => setTimeout(r, waitS * 1000));
    }
  }
  throw lastErr;
}
const callGlm = (sys, file) => callOpenAICompatible("glm", GLM_MODEL, sys, file);
const call = MODEL === "gemini" ? callGemini : MODEL === "gpt" ? callGpt : callGlm;

const subs = (r) => ({ input: Number(r?.inputStrengthScore), construction: Number(r?.constructionStrengthScore), output: Number(r?.outputStrengthScore) });
const total = (s) => { const v = [s.input, s.construction, s.output].filter((x) => Number.isFinite(x)); return v.length ? Math.round((10 * v.reduce((a, b) => a + b, 0)) / v.length) : null; };
function rungInfo(adj) {
  const ico = adj?.inputConstructionOutputAssessment ?? {};
  const ins = ico?.input?.primitiveInputs ?? [], cons = ico?.construction?.introducedConstructions ?? [];
  const filled = (arr) => (Array.isArray(arr) ? arr : []).filter((x) => String(x?.firmnessRung ?? "").trim()).length;
  return \`inputs \${filled(ins)}/\${(ins || []).length} cons \${filled(cons)}/\${(cons || []).length}\`;
}
const clip = (s, n) => (typeof s === "string" ? (s.length > n ? s.slice(0, n) + "…" : s) : "");

(async () => {
  const modelName = MODEL === "gpt" ? GPT_MODEL : MODEL === "glm" ? GLM_MODEL : "gemini-3.1-pro";
  console.log(\`[frontier-ab] MODEL=\${MODEL} (\${modelName}) · prompt \${REVIEW_PROMPT_VERSION} hash \${REVIEW_PROMPT_HASH} · \${new Date().toISOString()}\`);
  const results = [];
  for (const paper of PAPERS) {
    try {
      const file = b64(paper.file);
      // GPT pro runs sequentially (parallel pro calls trip the low-tier rate
      // limit); gemini/glm handle parallel passes fine.
      let p1, p2;
      if (MODEL === "gpt") { p1 = await call(REVIEW_SYSTEM_INSTRUCTION, file); p2 = await call(REVIEW_SYSTEM_INSTRUCTION, file); }
      else { [p1, p2] = await Promise.all([call(REVIEW_SYSTEM_INSTRUCTION, file), call(REVIEW_SYSTEM_INSTRUCTION, file)]); }
      const adj = await call(BLIND_INTRINSIC_ADJUDICATOR_PROMPT, buildAdjudicatorInput(NOTE, [normalizeIndividualReview(p1), normalizeIndividualReview(p2)]));
      const s = subs(adj), score = total(s);
      const cond = computeAssumptionConditionals({ inPhysicsScore: score, subscores: s, raw: deriveAssumptionConditionalsRawFromLedger(adj, s), outputReferentRealizable: outputReferentRealizableFromLedger(adj, adj.subscoreRationale) });
      const top = cond.conditionals.length ? Math.round(cond.conditionals[cond.conditionals.length - 1].score) : null;
      const sr = adj.subscoreRationale || {};
      const rec = {
        paper: paper.id, score, ico: s, conditional: cond.applicable ? { contingentOn: cond.contingentOn, lift: top, capped: top != null && top < 100 } : null,
        firmnessRung: rungInfo(adj),
        rationale: { input: clip(sr.inputStrengthScore, 700), construction: clip(sr.constructionStrengthScore, 700), output: clip(sr.outputStrengthScore, 700), scientificReview: clip(adj.scientificReview, 900), centralClaim: clip(adj.centralClaim, 400) },
      };
      results.push(rec);
      console.log(\`\\n=== \${paper.id} (score \${score}) — expect: \${paper.expect}\`);
      console.log(\`  conditional: \${cond.applicable ? "if {" + cond.contingentOn.join(" + ") + "} -> ~" + top + (rec.conditional.capped ? " (capped <100)" : "") : "NONE"}  | I/C/O \${s.input}/\${s.construction}/\${s.output} | rung[\${rec.firmnessRung}]\`);
    } catch (e) {
      results.push({ paper: paper.id, error: String(e?.message ?? e) });
      console.log(\`\\n=== \${paper.id}: ERROR \${e?.message ?? e}\`);
    }
  }
  const [ri, ro] = RATES[MODEL] || [0, 0];
  const dollars = (usage.in / 1e6) * ri + (usage.out / 1e6) * ro;
  const outFile = \`\${DIR}/ab_\${MODEL}.json\`;
  writeFileSync(outFile, JSON.stringify({ model: modelName, promptVersion: REVIEW_PROMPT_VERSION, promptHash: REVIEW_PROMPT_HASH, generatedAt: new Date().toISOString(), usage, estDollars: Math.round(dollars * 100) / 100, assumedRatePerM: { in: ri, out: ro }, results }, null, 2));
  console.log(\`\\n[frontier-ab] usage: \${usage.calls} calls, \${usage.in} in + \${usage.out} out tokens\${usage.reasoning ? " (of which " + usage.reasoning + " reasoning)" : ""}; est \\$\${dollars.toFixed(2)} (ASSUMED \\$\${ri}/\\$\${ro} per M). wrote ab_\${MODEL}.json\`);
  console.log("[frontier-ab] DONE");
})();
`;

const { build } = await import(pathToFileURL(join(ROOT, "artifacts/api-server/node_modules/esbuild/lib/main.js")).href);
const dir = mkdtempSync(join(tmpdir(), "frontier-ab-"));
const entryFile = join(dir, "entry.ts");
const outFile = join(dir, "bundle.cjs");
writeFileSync(entryFile, entry);
await build({ entryPoints: [entryFile], outfile: outFile, bundle: true, platform: "node", format: "cjs", nodePaths: [join(ROOT, "artifacts/api-server/node_modules"), join(ROOT, "node_modules")], logLevel: "warning" });
await import(pathToFileURL(outFile).href);
