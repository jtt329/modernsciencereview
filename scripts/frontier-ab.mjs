#!/usr/bin/env node
// Frontier-model A/B harness (out-of-benchmark, local; no production touch).
//
// Runs the ACTIVE v19.0.7 review pipeline (2 blind passes + adjudicator + the
// code conditional-derivation) on the Top-55 PDFs through a SELECTABLE model, so
// a candidate model (GLM-5.2, GPT, …) can be compared against Gemini on the
// SAME prompt + schema + scoring code. Reports per paper: score, conditional
// (with the realizability cap), and firmnessRung population.
//
//   MODEL=glm     node --env-file=.env scripts/frontier-ab.mjs      (default)
//   MODEL=gemini  node --env-file=.env scripts/frontier-ab.mjs
//   PAPERS=22,30  node ... scripts/frontier-ab.mjs                  (subset)
//
// Keys (gitignored .env, never chat): GLM via OpenRouter -> OPENROUTER_API_KEY
// (https://openrouter.ai/keys), model id GLM_MODEL (default "z-ai/glm-5.2").
// Gemini -> AI_INTEGRATIONS_GEMINI_API_KEY (+ AI_INTEGRATIONS_GEMINI_BASE_URL).
// Run with NODE_ENV=production so the bundled logger does not load pino-pretty.
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const ROOT = "/Users/jttyler/Projects/modernsciencereview";
const MODEL = (process.env.MODEL || "glm").toLowerCase();
const enginePath = join(ROOT, "artifacts/api-server/src/lib/reviewEngineCompat.ts");
const condPath = join(ROOT, "artifacts/api-server/src/lib/assumptionConditionals.ts");

const entry = `
import { readFileSync } from "node:fs";
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
const ALL = {
  "22": { id: "22_Enthalpy_AdS", file: "22_Kastor_Ray__Traschen__Enthalpy_and_the_Mechanics_of_AdS_Black_Holes.pdf", expect: "no AdS/CFT conditional (AdS is the output setting)" },
  "25": { id: "25_RT", file: "25_Ryu__Takayanagi__Holographic_Derivation_of_Entanglement_Entropy_from_AdSCFT.pdf", expect: "conditional retained + capped <100 (AdS/CFT open input)" },
  "36": { id: "36_Maldacena", file: "36_Maldacena__The_Large_N_Limit_of_Superconformal_Field_Theories_and_Supergravity.pdf", expect: "conditional retained + capped <100 (string-theory open inputs)" },
  "30": { id: "30_Page", file: "30_Page__Information_in_Black_Hole_Radiation.pdf", expect: "conditional restored via open construction (typicality)" },
  "50": { id: "50_Campos", file: "50_Campos__Charged_Rotating_Black_Hole_and_the_First_Law.pdf", expect: "no conditional (wrong-paper control)" },
};
const want = (process.env.PAPERS || "22,25,36,30,50").split(",").map((s) => s.trim());
const PAPERS = want.map((k) => ALL[k]).filter(Boolean);

function extractJson(text) {
  let t = String(text || "").trim();
  if (t.startsWith("\\\`\\\`\\\`")) t = t.replace(/^\\\`\\\`\\\`(?:json)?/i, "").replace(/\\\`\\\`\\\`\\s*$/, "").trim();
  const f = t.indexOf("{"), l = t.lastIndexOf("}");
  if (f >= 0 && l > f) t = t.slice(f, l + 1);
  return JSON.parse(t);
}
function b64(file) { return readFileSync(\`\${DIR}/\${file}\`).toString("base64"); }
const NOTE = "Review the attached manuscript PDF. Ignore author names, affiliations, venue, and citation signals; base the review only on the scientific content.";

// --- Gemini (multimodal PDF) ---
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
        if (!resp.text) throw new Error("empty");
        return extractJson(resp.text);
      } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 2500 * (a + 1))); }
    }
  }
  throw lastErr;
}

// --- GLM via OpenRouter (OpenAI-compatible; OpenRouter parses the PDF file part) ---
let openrouter = null;
async function callGlm(systemInstruction, file) {
  if (!openrouter) {
    const OpenAI = (await import("openai")).default;
    if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not set (add it to the gitignored .env)");
    openrouter = new OpenAI({ apiKey: process.env.OPENROUTER_API_KEY, baseURL: "https://openrouter.ai/api/v1" });
  }
  const userContent = typeof file === "string"
    ? file
    : [{ type: "text", text: NOTE }, { type: "file", file: { filename: "manuscript.pdf", file_data: "data:application/pdf;base64," + file } }];
  let lastErr;
  for (let a = 0; a < 3; a += 1) {
    try {
      const resp = await openrouter.chat.completions.create({
        model: GLM_MODEL,
        temperature: 0.15,
        max_tokens: 16384,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: systemInstruction }, { role: "user", content: userContent }],
        ...(typeof file === "string" ? {} : { plugins: [{ id: "file-parser", pdf: { engine: "pdf-text" } }] }),
      });
      const c = resp.choices?.[0]?.message?.content;
      if (!c) throw new Error("empty");
      return extractJson(c);
    } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 3000 * (a + 1))); }
  }
  throw lastErr;
}

const call = MODEL === "gemini" ? callGemini : callGlm;
const subs = (r) => ({ input: Number(r?.inputStrengthScore), construction: Number(r?.constructionStrengthScore), output: Number(r?.outputStrengthScore) });
const total = (s) => { const v = [s.input, s.construction, s.output].filter((x) => Number.isFinite(x)); return v.length ? Math.round((10 * v.reduce((a, b) => a + b, 0)) / v.length) : null; };
function rungOK(adj) {
  const ico = adj?.inputConstructionOutputAssessment ?? {};
  const ins = ico?.input?.primitiveInputs ?? [], cons = ico?.construction?.introducedConstructions ?? [];
  const filled = (arr) => (Array.isArray(arr) ? arr : []).filter((x) => String(x?.firmnessRung ?? "").trim()).length;
  return \`inputs \${filled(ins)}/\${(ins || []).length} cons \${filled(cons)}/\${(cons || []).length}\`;
}

(async () => {
  console.log(\`[frontier-ab] MODEL=\${MODEL}\${MODEL === "glm" ? " (" + GLM_MODEL + ")" : ""} · prompt \${REVIEW_PROMPT_VERSION} hash \${REVIEW_PROMPT_HASH} · \${new Date().toISOString()}\`);
  for (const paper of PAPERS) {
    try {
      const file = b64(paper.file);
      const [p1, p2] = await Promise.all([call(REVIEW_SYSTEM_INSTRUCTION, file), call(REVIEW_SYSTEM_INSTRUCTION, file)]);
      const adjInput = buildAdjudicatorInput(NOTE, [normalizeIndividualReview(p1), normalizeIndividualReview(p2)]);
      const adj = await call(BLIND_INTRINSIC_ADJUDICATOR_PROMPT, adjInput);
      const s = subs(adj), score = total(s);
      const cond = computeAssumptionConditionals({
        inPhysicsScore: score, subscores: s,
        raw: deriveAssumptionConditionalsRawFromLedger(adj, s),
        outputReferentRealizable: outputReferentRealizableFromLedger(adj, adj.subscoreRationale),
      });
      const top = cond.conditionals.length ? Math.round(cond.conditionals[cond.conditionals.length - 1].score) : null;
      console.log(\`\\n=== \${paper.id} (score \${score}) — expect: \${paper.expect}\`);
      console.log(\`  conditional: \${cond.applicable ? "if {" + cond.contingentOn.join(" + ") + "} -> ~" + top + (top != null && top < 100 ? " (capped <100)" : "") : "NONE"}\`);
      console.log(\`  I/C/O = \${s.input}/\${s.construction}/\${s.output}  firmnessRung[\${rungOK(adj)}]\`);
    } catch (e) {
      console.log(\`\\n=== \${paper.id}: ERROR \${e?.message ?? e}\`);
    }
  }
  console.log("\\n[frontier-ab] DONE");
})();
`;

const { build } = await import(pathToFileURL(join(ROOT, "artifacts/api-server/node_modules/esbuild/lib/main.js")).href);
const dir = mkdtempSync(join(tmpdir(), "frontier-ab-"));
const entryFile = join(dir, "entry.ts");
const outFile = join(dir, "bundle.cjs");
writeFileSync(entryFile, entry);
await build({ entryPoints: [entryFile], outfile: outFile, bundle: true, platform: "node", format: "cjs", nodePaths: [join(ROOT, "artifacts/api-server/node_modules"), join(ROOT, "node_modules")], logLevel: "warning" });
await import(pathToFileURL(outFile).href);
