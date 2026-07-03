#!/usr/bin/env node
// Phase 1 A/B/C harness (explanatory-update scoring) — out-of-benchmark, local.
// Source of truth: CODE_BRIEF_phase1_abc.md.
//
// Runs Arm B (explanatory-update) and Arm C (minimal control) through the REAL
// production model path: ONE reliable Gemini extraction per paper, SHARED
// identically across arms and verified to be real text (not binary/garbage —
// the failure that made the prior comparison inconclusive), then 2 independent
// blind passes + 1 arm-specific blind adjudicator -> one adjudicated review per
// arm-run. The adjudicator reasons with THAT arm's own principle (never the
// structured v19 adjudicator). The published number is the model-emitted
// recommendedExplanatoryUpdateScore (no ICO formula). Arm A is NOT re-run: its
// existing v19.1.0 reviews are the Phase-1 control.
//
//   node --env-file=.env scripts/phase1-abc.mjs                 # dry-run: paper 5 (Campos), arms B,C, 1 run
//   PAPERS=5 ARMS=B,C RUNS=1 node --env-file=.env scripts/phase1-abc.mjs
//   PAPERS=1,2,3 ARMS=B,C RUNS=2 node ... (full stability set)
//
// Keys (gitignored .env): AI_INTEGRATIONS_GEMINI_API_KEY (+ optional base url).
// Outputs: Top 55/phase1/<arm>_<paper>_run<N>.json (adjudicated + raw passes)
// and Top 55/phase1/summary.json. Run with NODE_ENV=production so the bundled
// logger does not load pino-pretty.
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";

const ROOT = "/Users/jttyler/Projects/modernsciencereview";
const enginePath = join(ROOT, "artifacts/api-server/src/lib/reviewEngineCompat.ts");
const bPath = join(ROOT, "artifacts/api-server/src/lib/prompts/explanatoryUpdateB.ts");
const cPath = join(ROOT, "artifacts/api-server/src/lib/prompts/explanatoryUpdateC.ts");

const PAPERS = (process.env.PAPERS || "5").split(",").map((s) => s.trim()).filter(Boolean);
const ARMS = (process.env.ARMS || "B,C").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const RUNS = Math.max(1, parseInt(process.env.RUNS || "1", 10));
const TEMPERATURE = process.env.TEMPERATURE ? parseFloat(process.env.TEMPERATURE) : 0.2; // production callGemini default

const entry = `
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { ai as geminiAI } from "@workspace/integrations-gemini-ai";
import {
  extractManuscriptTextFromPdfForReview, blindManuscriptText,
  parseGeminiJsonResponse, GEMINI_PASS_MODEL, GEMINI_META_MODEL,
} from ${JSON.stringify(enginePath)};
import {
  EXPLANATORY_UPDATE_B_PROMPT, EXPLANATORY_UPDATE_B_ADJUDICATOR_PROMPT,
  EXPLANATORY_UPDATE_B_PROMPT_NAME, EXPLANATORY_UPDATE_B_PROMPT_VERSION,
  EXPLANATORY_UPDATE_B_PROMPT_HASH, EXPLANATORY_UPDATE_B_ADJUDICATOR_PROMPT_HASH,
} from ${JSON.stringify(bPath)};
import {
  EXPLANATORY_UPDATE_C_PROMPT, EXPLANATORY_UPDATE_C_ADJUDICATOR_PROMPT,
  EXPLANATORY_UPDATE_C_PROMPT_NAME, EXPLANATORY_UPDATE_C_PROMPT_VERSION,
  EXPLANATORY_UPDATE_C_PROMPT_HASH, EXPLANATORY_UPDATE_C_ADJUDICATOR_PROMPT_HASH,
} from ${JSON.stringify(cPath)};

const DIR = "/Users/jttyler/Desktop/Top 55";
const OUT = DIR + "/phase1";
const PAPERS_WANT = ${JSON.stringify(PAPERS)};
const ARMS = ${JSON.stringify(ARMS)};
const RUNS = ${RUNS};
const TEMPERATURE = ${TEMPERATURE};

// The 11 papers + per-paper reviewContext, keyed by the brief's row number.
const ALL = {
  "1":  { id: "01_Carroll_Field_Jackiw", file: "54_Carrol - limits on modifying em.pdf", mode: "historical_benchmark", reviewEpoch: "~1990" },
  "2":  { id: "02_Four_Laws_BCH",        file: "01_Hawking_4_Laws.pdf", mode: "historical_benchmark", reviewEpoch: "early 1970s" },
  "3":  { id: "03_Hawking_Particle",     file: "03_Hawking_Particle_creation.pdf", mode: "historical_benchmark", reviewEpoch: "mid 1970s" },
  "4":  { id: "04_Wald_Noether",         file: "07_Wald__Black_Hole_Entropy_is_Noether_Charge.pdf", mode: "historical_benchmark", reviewEpoch: "early 1990s" },
  "5":  { id: "05_Campos_crank",         file: "50_Campos__Charged_Rotating_Black_Hole_and_the_First_Law.pdf", mode: "new_submission", reviewEpoch: "current" },
  "6":  { id: "06_viXra_crank",          file: "vixra_2606.0093_Causal_Horizons_Maximal_Acceleration.pdf", mode: "new_submission", reviewEpoch: "current" },
  "7":  { id: "07_Ong_MaxForce",         file: "46_Ong__A_Maximum_Force_Perspective_on_Black_Hole_Thermodynamics.pdf", mode: "historical_benchmark", reviewEpoch: "late 2010s" },
  "8":  { id: "08_Verlinde_entropic",    file: "43_Verlinde__On_the_Origin_of_Gravity_and_the_Laws_of_Newton.pdf", mode: "historical_benchmark", reviewEpoch: "early 2010s" },
  "9":  { id: "09_Ryu_Takayanagi",       file: "25_Ryu__Takayanagi__Holographic_Derivation_of_Entanglement_Entropy_from_AdSCFT.pdf", mode: "historical_benchmark", reviewEpoch: "mid 2000s" },
  "10": { id: "10_Frodden_Ghosh_Perez",  file: "12_Frodden_Ghosh__Perez__A_Local_First_Law_for_Black_Hole_Thermodynamics.pdf", mode: "historical_benchmark", reviewEpoch: "early 2010s" },
  "11": { id: "11_Gibbons_Hawking",      file: "04_gibbons_Cosmological_horizons.pdf", mode: "historical_benchmark", reviewEpoch: "late 1970s" },
};

const ARM_CFG = {
  B: { pass: EXPLANATORY_UPDATE_B_PROMPT, adj: EXPLANATORY_UPDATE_B_ADJUDICATOR_PROMPT,
       name: EXPLANATORY_UPDATE_B_PROMPT_NAME, version: EXPLANATORY_UPDATE_B_PROMPT_VERSION,
       passHash: EXPLANATORY_UPDATE_B_PROMPT_HASH, adjHash: EXPLANATORY_UPDATE_B_ADJUDICATOR_PROMPT_HASH },
  C: { pass: EXPLANATORY_UPDATE_C_PROMPT, adj: EXPLANATORY_UPDATE_C_ADJUDICATOR_PROMPT,
       name: EXPLANATORY_UPDATE_C_PROMPT_NAME, version: EXPLANATORY_UPDATE_C_PROMPT_VERSION,
       passHash: EXPLANATORY_UPDATE_C_PROMPT_HASH, adjHash: EXPLANATORY_UPDATE_C_ADJUDICATOR_PROMPT_HASH },
};

const MODEL = GEMINI_PASS_MODEL; // gemini-3.1-pro-preview (production default)
const usage = { in: 0, out: 0, calls: 0 };

// Parse Gemini JSON using the SAME battle-tested production parser (LaTeX /
// escape / control-char repair), with an added truncation-repair fallback: if a
// thinking-heavy response is cut mid-output, close the open string and balance
// the braces, then re-parse. Returns { value, repaired } so truncation is
// flagged rather than silently scored.
function extractJson(text) {
  let t = String(text || "").trim();
  const fence = t.match(/^\\\`\\\`\\\`(?:json)?\\s*([\\s\\S]*?)\\s*\\\`\\\`\\\`$/i);
  if (fence) t = fence[1].trim();
  const f = t.indexOf("{");
  if (f > 0) t = t.slice(f);
  try { return { value: parseGeminiJsonResponse(t), repaired: false }; } catch (_e) {}
  // Truncation repair: walk tracking string/escape/depth, then close.
  let depth = 0, inStr = false, esc = false;
  for (let i = 0; i < t.length; i += 1) {
    const c = t[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === "{") depth += 1; else if (c === "}") depth -= 1;
  }
  let repaired = t;
  if (esc) repaired += "\\\\"; // dangling escape at cut point
  if (inStr) repaired += '"';
  if (depth > 0) repaired += "}".repeat(depth);
  return { value: parseGeminiJsonResponse(repaired), repaired: true };
}

// Verify extracted text is real, not binary/garbage (the silent failure the
// brief warns about). Returns { real, reason, printableRatio, words }.
function verifyRealText(text) {
  const t = String(text || "");
  if (t.trim().length < 800) return { real: false, reason: "too short (<800 chars)", chars: t.length };
  const printable = (t.match(/[\\x20-\\x7E\\s]/g) || []).length;
  const printableRatio = printable / t.length;
  const words = (t.match(/[A-Za-z]{3,}/g) || []).length;
  const real = printableRatio > 0.9 && words > 200;
  return {
    real,
    reason: real ? "ok" : \`printableRatio=\${printableRatio.toFixed(3)} words=\${words}\`,
    chars: t.length, printableRatio: Number(printableRatio.toFixed(4)), words,
  };
}

async function callGemini(systemInstruction, userText, model) {
  let lastErr;
  for (let a = 0; a < 3; a += 1) {
    try {
      const resp = await geminiAI.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: userText }] }],
        // Gemini 3 Pro is a thinking model; thinking shares the output budget, so
        // give generous headroom to avoid truncating the (unschema'd) B/C JSON.
        config: { systemInstruction, responseMimeType: "application/json", temperature: TEMPERATURE, maxOutputTokens: 65536 },
      });
      const u = resp.usageMetadata || {};
      usage.in += u.promptTokenCount || 0; usage.out += u.candidatesTokenCount || 0; usage.calls += 1;
      const finishReason = resp.candidates?.[0]?.finishReason ?? null;
      if (!resp.text) throw new Error("empty response (finishReason " + finishReason + ")");
      return { text: resp.text, finishReason };
    } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 3000 * (a + 1))); }
  }
  throw lastErr;
}

const NOTE = "Review the attached blinded manuscript on its scientific merits alone. Ignore any author names, affiliations, venue, or citation signals.";
function buildPassInput(ctx, blindedText) {
  return [
    "reviewContext (supplied by the application):",
    JSON.stringify({ mode: ctx.mode, reviewEpoch: ctx.reviewEpoch }),
    "",
    NOTE,
    "",
    "Blinded manuscript text:",
    "---",
    blindedText,
    "---",
  ].join("\\n");
}
function buildAdjInput(ctx, blindedText, pass1, pass2) {
  return JSON.stringify({
    adjudicatorInputNote: "Use the blinded manuscript, the reviewContext, and the two independent blind reviews in this same schema. Reason to ONE final review with this arm's own principle; never average. Output the same schema.",
    reviewContext: { mode: ctx.mode, reviewEpoch: ctx.reviewEpoch },
    blindedManuscriptText: blindedText.slice(0, 60000),
    independentReviewPasses: [pass1, pass2],
  }, null, 2);
}

function b64(file) { return readFileSync(\`\${DIR}/\${file}\`).toString("base64"); }
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

(async () => {
  mkdirSync(OUT, { recursive: true });
  console.log(\`[phase1-abc] model=\${MODEL} temp=\${TEMPERATURE} papers=\${PAPERS_WANT.join(",")} arms=\${ARMS.join(",")} runs=\${RUNS} · \${new Date().toISOString()}\`);
  const summary = { model: MODEL, temperature: TEMPERATURE, generatedAt: new Date().toISOString(), extraction: {}, results: [], parseFailures: [] };

  for (const key of PAPERS_WANT) {
    const paper = ALL[key];
    if (!paper) { console.log(\`  ! unknown paper key \${key}\`); continue; }
    const ctx = { mode: paper.mode, reviewEpoch: paper.reviewEpoch };

    // --- ONE reliable extraction, shared identically across arms ---
    console.log(\`\\n### Paper \${key} \${paper.id} [\${paper.mode}/\${paper.reviewEpoch}]\`);
    let blindedText, rawExtract;
    try {
      // Extract ONCE, reliably, and reuse identically across arms/runs (brief
      // requirement). A verified cached extract short-circuits the flaky flash
      // extraction model; delete the cache file to force a fresh extraction.
      const cachePath = \`\${OUT}/extract_\${key}_\${paper.id}.txt\`;
      let fromCache = false;
      if (existsSync(cachePath)) { rawExtract = readFileSync(cachePath, "utf8"); fromCache = true; }
      else {
        // Retry the flaky flash extraction model through transient 503s.
        let extErr;
        for (let a = 0; a < 5; a += 1) {
          try { const ext = await extractManuscriptTextFromPdfForReview({ pdfBase64: b64(paper.file) }); rawExtract = ext.manuscriptText || ""; extErr = null; break; }
          catch (e) { extErr = e; console.log(\`  [extract retry \${a + 1}] \${String(e?.message ?? e).slice(0, 90)}\`); await new Promise((r) => setTimeout(r, 8000 * (a + 1))); }
        }
        if (extErr) throw extErr;
      }
      const check = verifyRealText(rawExtract);
      summary.extraction[key] = { id: paper.id, fromCache, ...check };
      console.log(\`  extraction\${fromCache ? " (cached)" : ""}: \${check.chars} chars, printableRatio=\${check.printableRatio}, words=\${check.words} -> \${check.real ? "REAL ✓" : "SUSPECT ✗ (" + check.reason + ")"}\`);
      console.log(\`  sample: \${JSON.stringify(rawExtract.slice(0, 240))}\`);
      if (!check.real) { console.log("  !! extraction not verified real — SKIPPING scoring for this paper"); continue; }
      blindedText = blindManuscriptText(rawExtract);
      writeFileSync(\`\${OUT}/extract_\${key}_\${paper.id}.txt\`, rawExtract);
    } catch (e) {
      console.log(\`  !! extraction failed: \${e?.message ?? e}\`);
      summary.extraction[key] = { id: paper.id, real: false, reason: "extraction threw: " + (e?.message ?? e) };
      continue;
    }

    for (const arm of ARMS) {
      const cfg = ARM_CFG[arm];
      if (!cfg) { console.log(\`  ! unknown arm \${arm}\`); continue; }
      for (let run = 1; run <= RUNS; run += 1) {
        const tag = \`\${arm}_\${paper.id}_run\${run}\`;
        try {
          const [r1, r2] = await Promise.all([
            callGemini(cfg.pass, buildPassInput(ctx, blindedText), MODEL),
            callGemini(cfg.pass, buildPassInput(ctx, blindedText), MODEL),
          ]);
          const parsePass = (r, where) => {
            try { const { value, repaired } = extractJson(r.text); if (repaired) summary.parseFailures.push({ tag, where, repaired: true, finishReason: r.finishReason, note: "recovered via truncation-repair" }); return value; }
            catch (e) { summary.parseFailures.push({ tag, where, err: String(e?.message ?? e), finishReason: r.finishReason }); return { __parseError: String(e?.message ?? e), finishReason: r.finishReason, raw: r.text }; }
          };
          const p1 = parsePass(r1, "pass1"), p2 = parsePass(r2, "pass2");

          const rAdj = await callGemini(cfg.adj, buildAdjInput(ctx, blindedText, p1, p2), MODEL);
          const adj = parsePass(rAdj, "adjudicator");

          const score = num(adj?.recommendedExplanatoryUpdateScore);
          const runMetadata = {
            arm, promptVersion: cfg.version, promptName: cfg.name, promptHash: cfg.passHash, adjudicatorPromptHash: cfg.adjHash,
            model: "gemini", modelVersion: MODEL, temperature: TEMPERATURE,
            extractionVersion: "prod-gemini-pdf-extract", corpusVersion: "top55-phase1",
            reviewContext: ctx, passId: \`\${tag}-passes\`, adjudicationId: \`\${tag}-adj\`,
          };
          const record = {
            paper: paper.id, paperKey: key, arm, run, score, reviewContext: ctx, runMetadata,
            adjudicated: adj, passes: [p1, p2],
          };
          writeFileSync(\`\${OUT}/\${tag}.json\`, JSON.stringify(record, null, 2));
          summary.results.push({ paper: paper.id, paperKey: key, arm, run, score,
            recognized: adj?.recognition?.recognized ?? adj?.recognitionAssessment?.recognized ?? null,
            fatalFlaw: adj?.correctness?.fatalFlaw || "",
            p1Score: num(p1?.recommendedExplanatoryUpdateScore), p2Score: num(p2?.recommendedExplanatoryUpdateScore) });
          console.log(\`  [\${arm} run\${run}] passes \${num(p1?.recommendedExplanatoryUpdateScore)}/\${num(p2?.recommendedExplanatoryUpdateScore)} -> adjudicated \${score}\${adj?.correctness?.fatalFlaw ? "  fatalFlaw: " + String(adj.correctness.fatalFlaw).slice(0,80) : ""}\`);
        } catch (e) {
          console.log(\`  [\${arm} run\${run}] ERROR \${e?.message ?? e}\`);
          summary.results.push({ paper: paper.id, paperKey: key, arm, run, error: String(e?.message ?? e) });
        }
      }
    }
  }

  writeFileSync(\`\${OUT}/summary.json\`, JSON.stringify(summary, null, 2));
  console.log(\`\\n[phase1-abc] usage: \${usage.calls} calls, \${usage.in} in + \${usage.out} out tokens. parseFailures: \${summary.parseFailures.length}. wrote phase1/summary.json\`);
  console.log("[phase1-abc] DONE");
})();
`;

const { build } = await import(pathToFileURL(join(ROOT, "artifacts/api-server/node_modules/esbuild/lib/main.js")).href);
const dir = mkdtempSync(join(tmpdir(), "phase1-abc-"));
const entryFile = join(dir, "entry.ts");
const outFile = join(dir, "bundle.cjs");
writeFileSync(entryFile, entry);
await build({ entryPoints: [entryFile], outfile: outFile, bundle: true, platform: "node", format: "cjs", nodePaths: [join(ROOT, "artifacts/api-server/node_modules"), join(ROOT, "node_modules")], logLevel: "warning" });
await import(pathToFileURL(outFile).href);
