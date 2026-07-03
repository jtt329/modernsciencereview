#!/usr/bin/env node
// Field-engine Phase 0 harness — multimodal ingestion + image-grounded fatal-flaw
// verification + four/three-state correctness. Source: CODE_BRIEF_field-engine_phase0.md.
// Validated in the harness ONLY; no data-model/site/DB changes (§0, §6).
//
// Pipeline per paper-run (§2.5):
//   1. render PDF -> identity-blind page images (+ advisory text)   [outer, mupdf]
//   2. build identity-blind packet (images authoritative, identities stripped)
//   3-4. B.2 pass 1 + pass 2 (image-grounded)
//   5. B.2 adjudicator (arm's own logic; resolves disputes; never averages)
//   6. per alleged fatal flaw -> image-grounded verification pass -> evidence packet
//   7. assign internal correctness (4-state) -> public (3-state); never publish
//      fatal_alleged_unverified as flawed; re-adjudicate score if an allegation is overturned
//   8. scopeOfUpdate; provisional band (internal scalar kept only for sort)
//
//   NODE_ENV=production AI_INTEGRATIONS_GEMINI_BASE_URL=https://generativelanguage.googleapis.com \
//     PAPERS=all ARMS=B2 RUNS=2 node --env-file=.env scripts/phase0-fieldengine.mjs
//   PAPERS=7 (single), DPI=150, REDACT_TOP=0.16 are overridable.
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { renderBlindPages } from "./lib/renderBlindPages.mjs";

const ROOT = "/Users/jttyler/Projects/modernsciencereview";
const DIR = "/Users/jttyler/Desktop/Top 55";
const OUT = join(DIR, "phase0");
const enginePath = join(ROOT, "artifacts/api-server/src/lib/reviewEngineCompat.ts");
const b2Path = join(ROOT, "artifacts/api-server/src/lib/prompts/explanatoryUpdateB2.ts");
const DPI = parseInt(process.env.DPI || "150", 10);
const REDACT_TOP = process.env.REDACT_TOP ? parseFloat(process.env.REDACT_TOP) : 0.16;
const RUNS = Math.max(1, parseInt(process.env.RUNS || "2", 10));
const TEMPERATURE = process.env.TEMPERATURE ? parseFloat(process.env.TEMPERATURE) : 0.2;

// Sensitive set (§2.6) keyed by phase-1 row number, with per-paper reviewContext.
const ALL = {
  "1":  { id: "01_Carroll", file: "54_Carrol - limits on modifying em.pdf", mode: "historical_benchmark", reviewEpoch: "~1990" },
  "2":  { id: "02_Four_Laws", file: "01_Hawking_4_Laws.pdf", mode: "historical_benchmark", reviewEpoch: "early 1970s" },
  "3":  { id: "03_Hawking", file: "03_Hawking_Particle_creation.pdf", mode: "historical_benchmark", reviewEpoch: "mid 1970s" },
  "4":  { id: "04_Wald", file: "07_Wald__Black_Hole_Entropy_is_Noether_Charge.pdf", mode: "historical_benchmark", reviewEpoch: "early 1990s" },
  "5":  { id: "05_Campos", file: "50_Campos__Charged_Rotating_Black_Hole_and_the_First_Law.pdf", mode: "new_submission", reviewEpoch: "current" },
  "6":  { id: "06_viXra", file: "vixra_2606.0093_Causal_Horizons_Maximal_Acceleration.pdf", mode: "new_submission", reviewEpoch: "current" },
  "7":  { id: "07_Ong", file: "46_Ong__A_Maximum_Force_Perspective_on_Black_Hole_Thermodynamics.pdf", mode: "historical_benchmark", reviewEpoch: "late 2010s" },
  "8":  { id: "08_Verlinde", file: "43_Verlinde__On_the_Origin_of_Gravity_and_the_Laws_of_Newton.pdf", mode: "historical_benchmark", reviewEpoch: "early 2010s" },
  "9":  { id: "09_Ryu_Takayanagi", file: "25_Ryu__Takayanagi__Holographic_Derivation_of_Entanglement_Entropy_from_AdSCFT.pdf", mode: "historical_benchmark", reviewEpoch: "mid 2000s" },
  "10": { id: "10_Frodden", file: "12_Frodden_Ghosh__Perez__A_Local_First_Law_for_Black_Hole_Thermodynamics.pdf", mode: "historical_benchmark", reviewEpoch: "early 2010s" },
  "11": { id: "11_Gibbons_Hawking", file: "04_gibbons_Cosmological_horizons.pdf", mode: "historical_benchmark", reviewEpoch: "late 1970s" },
};
const wantPapers = (process.env.PAPERS && process.env.PAPERS !== "all")
  ? process.env.PAPERS.split(",").map((s) => s.trim()).filter(Boolean)
  : Object.keys(ALL);

// ---- Outer: render every paper's blind pages (cached), build run manifest ----
mkdirSync(OUT, { recursive: true });
const runManifest = [];
console.log(`[phase0] rendering ${wantPapers.length} papers @ ${DPI}dpi (redact top ${REDACT_TOP}) ...`);
for (const key of wantPapers) {
  const p = ALL[key];
  if (!p) { console.log(`  ! unknown paper ${key}`); continue; }
  const pagesDir = join(OUT, "pages", p.id);
  const m = renderBlindPages(join(DIR, p.file), pagesDir, { dpi: DPI, redactTopFrac: REDACT_TOP });
  console.log(`  ${p.id}: ${m.rendered}/${m.pageCount} pages${m.fromCache ? " (cached)" : ""}, blank=${m.blankPages}`);
  runManifest.push({
    key, id: p.id, mode: p.mode, reviewEpoch: p.reviewEpoch,
    pagesDir, textPath: m.textPath,
    pages: m.pages.map((pg) => ({ n: pg.n, path: join(pagesDir, pg.file) })),
    rendered: m.rendered, pageCount: m.pageCount, blankPages: m.blankPages,
  });
}
const runManifestPath = join(OUT, "_run_manifest.json");
writeFileSync(runManifestPath, JSON.stringify(runManifest, null, 2));

// ---- Bundled entry: the image-grounded judgment + verification pipeline ----
const entry = `
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { ai as geminiAI } from "@workspace/integrations-gemini-ai";
import { blindManuscriptText, parseGeminiJsonResponse, GEMINI_PASS_MODEL } from ${JSON.stringify(enginePath)};
import {
  EXPLANATORY_UPDATE_B2_PROMPT, EXPLANATORY_UPDATE_B2_ADJUDICATOR_PROMPT, FATAL_FLAW_VERIFICATION_PROMPT,
  EXPLANATORY_UPDATE_B2_PROMPT_NAME, EXPLANATORY_UPDATE_B2_PROMPT_VERSION,
  EXPLANATORY_UPDATE_B2_PROMPT_HASH, EXPLANATORY_UPDATE_B2_ADJUDICATOR_PROMPT_HASH, FATAL_FLAW_VERIFICATION_PROMPT_HASH,
} from ${JSON.stringify(b2Path)};

const OUT = ${JSON.stringify(OUT)};
const RUN_MANIFEST = ${JSON.stringify(runManifestPath)};
const RUNS = ${RUNS};
const TEMPERATURE = ${TEMPERATURE};
const MODEL = GEMINI_PASS_MODEL;
const usage = { in: 0, out: 0, calls: 0 };

function extractJson(text) {
  let t = String(text || "").trim();
  const fence = t.match(/^\\\`\\\`\\\`(?:json)?\\s*([\\s\\S]*?)\\s*\\\`\\\`\\\`$/i);
  if (fence) t = fence[1].trim();
  const f = t.indexOf("{"); if (f > 0) t = t.slice(f);
  try { return { value: parseGeminiJsonResponse(t), repaired: false }; } catch (_e) {}
  let depth = 0, inStr = false, esc = false;
  for (let i = 0; i < t.length; i += 1) { const c = t[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === "{") depth += 1; else if (c === "}") depth -= 1; }
  let r = t; if (esc) r += "\\\\"; if (inStr) r += '"'; if (depth > 0) r += "}".repeat(depth);
  return { value: parseGeminiJsonResponse(r), repaired: true };
}
const b64 = (p) => readFileSync(p).toString("base64");
const imgPart = (p) => ({ inlineData: { mimeType: "image/png", data: b64(p) } });
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

async function callMM(systemInstruction, textPart, imageParts) {
  let lastErr;
  for (let a = 0; a < 6; a += 1) {
    try {
      const resp = await geminiAI.models.generateContent({
        model: MODEL,
        contents: [{ role: "user", parts: [{ text: textPart }, ...imageParts] }],
        config: { systemInstruction, responseMimeType: "application/json", temperature: TEMPERATURE, maxOutputTokens: 65536 },
      });
      const u = resp.usageMetadata || {};
      usage.in += u.promptTokenCount || 0; usage.out += u.candidatesTokenCount || 0; usage.calls += 1;
      const finishReason = resp.candidates?.[0]?.finishReason ?? null;
      if (!resp.text) throw new Error("empty (finishReason " + finishReason + ")");
      return { text: resp.text, finishReason };
    } catch (e) { lastErr = e; const wait = Math.min(45000, 6000 * (a + 1)) + Math.floor(Math.random() * 3000); await new Promise((r) => setTimeout(r, wait)); }
  }
  throw lastErr;
}

// Public-status mapping — fatal_alleged_unverified must NEVER become public "flawed".
function publicStatus(internal) {
  if (internal === "sound") return "sound";
  if (internal === "contested_defensible") return "contested";
  if (internal === "fatal_verified") return "flawed";
  return "contested"; // fatal_alleged_unverified -> contested (route to human), never flawed
}
function band(internal, score) {
  if (internal === "fatal_verified") return "flawed";
  const s = num(score);
  if (s == null) return "unknown";
  if (s <= 39) return "minor"; if (s <= 64) return "solid"; if (s <= 84) return "important"; return "landmark";
}
// Choose page images to send to a verification pass for a candidate location.
function pagesForCandidate(cand, manifestPages, advisoryText) {
  const loc = cand?.locationInPaper || {};
  let pageNo = null;
  const pTxt = String(loc.page || "");
  const mp = pTxt.match(/\\d+/); if (mp) pageNo = parseInt(mp[0], 10);
  if (pageNo == null && loc.equation) {
    // locate the equation label in the advisory "[page N]" stream
    const eqNum = String(loc.equation).match(/\\d+/)?.[0];
    if (eqNum) { const re = new RegExp("\\\\[page (\\\\d+)\\\\][^]*?\\\\(" + eqNum + "\\\\)"); const m = advisoryText.match(re); if (m) pageNo = parseInt(m[1], 10); }
  }
  if (pageNo != null) {
    const want = new Set([pageNo - 1, pageNo, pageNo + 1]);
    const sel = manifestPages.filter((pg) => want.has(pg.n));
    if (sel.length) return { pages: sel, located: pageNo };
  }
  return { pages: manifestPages, located: null }; // unknown -> send all (correctness > cost)
}

(async () => {
  mkdirSync(OUT + "/records", { recursive: true });
  const manifest = JSON.parse(readFileSync(RUN_MANIFEST, "utf8"));
  const summary = { model: MODEL, temperature: TEMPERATURE, dpi: ${DPI}, generatedAt: new Date().toISOString(), results: [], parseFailures: [], renderInfo: [] };
  console.log("[phase0] model=" + MODEL + " temp=" + TEMPERATURE + " runs=" + RUNS + " papers=" + manifest.length);

  for (const paper of manifest) {
    const ctx = { mode: paper.mode, reviewEpoch: paper.reviewEpoch };
    summary.renderInfo.push({ id: paper.id, rendered: paper.rendered, pageCount: paper.pageCount, blankPages: paper.blankPages });
    const blank = paper.blankPages > Math.max(1, Math.floor(paper.rendered * 0.2));
    console.log("\\n### " + paper.id + " [" + paper.mode + "/" + paper.reviewEpoch + "] " + paper.rendered + "pp" + (blank ? " !! many blank pages" : ""));
    const imageParts = paper.pages.map((pg) => imgPart(pg.path));
    const advisoryRaw = readFileSync(paper.textPath, "utf8");
    const advisoryBlind = blindManuscriptText(advisoryRaw).slice(0, 30000);
    const ctxLine = "reviewContext (supplied by the application): " + JSON.stringify(ctx);
    const passText = [ctxLine, "",
      "The manuscript is provided as the rendered PAGE IMAGES below (AUTHORITATIVE). A secondary, possibly-lossy advisory text layer follows; do not rely on it for any equation. Read load-bearing expressions from the images.",
      "", "[advisory text layer — secondary]", advisoryBlind, "", "Now produce your review."].join("\\n");

    for (let run = 1; run <= RUNS; run += 1) {
      const tag = "B2_" + paper.id + "_run" + run;
      try {
        const [r1, r2] = await Promise.all([
          callMM(EXPLANATORY_UPDATE_B2_PROMPT, passText, imageParts),
          callMM(EXPLANATORY_UPDATE_B2_PROMPT, passText, imageParts),
        ]);
        const parse = (r, where) => { try { const { value, repaired } = extractJson(r.text); if (repaired) summary.parseFailures.push({ tag, where, repaired: true, finishReason: r.finishReason }); return value; }
          catch (e) { summary.parseFailures.push({ tag, where, err: String(e?.message ?? e), finishReason: r.finishReason }); return { __parseError: String(e?.message ?? e), raw: r.text }; } };
        const p1 = parse(r1, "pass1"), p2 = parse(r2, "pass2");

        const adjInput = JSON.stringify({
          adjudicatorInputNote: "Use the authoritative page images, the reviewContext, and the two independent reviews. Resolve correctness disputes by reading the disputed step from the image; never average. Output the same schema.",
          reviewContext: ctx, independentReviewPasses: [p1, p2],
        }, null, 2);
        const rAdj = await callMM(EXPLANATORY_UPDATE_B2_ADJUDICATOR_PROMPT, adjInput + "\\n\\nThe authoritative page images follow.", imageParts);
        let adj = parse(rAdj, "adjudicator");

        // ---- Correctness resolution + image-grounded verification (§2.3, §2.5 steps 6-7) ----
        const proposed = adj?.correctnessAssessment?.internalStatusProposed || "sound";
        let internalStatus = proposed, finalScore = num(adj?.recommendedExplanatoryUpdateScore);
        const verifications = [], evidencePackets = [];
        let reAdjudicated = false;

        if (proposed === "fatal_alleged") {
          const candidates = Array.isArray(adj?.correctnessAssessment?.fatalFlawCandidates) ? adj.correctnessAssessment.fatalFlawCandidates : [];
          for (const cand of candidates) {
            const { pages, located } = pagesForCandidate(cand, paper.pages, advisoryRaw);
            const vText = ["Alleged fatal flaw to verify (do NOT score the paper):",
              "claim: " + (cand.claim || ""), "allegation: " + (cand.modelAllegation || ""),
              "location: " + JSON.stringify(cand.locationInPaper || {}),
              "", "The relevant rendered page image(s) follow (authoritative)."].join("\\n");
            const rv = await callMM(FATAL_FLAW_VERIFICATION_PROMPT, vText, pages.map((pg) => imgPart(pg.path)));
            const v = parse(rv, "verify");
            const packet = {
              claim: cand.claim, locationInPaper: cand.locationInPaper, modelAllegation: cand.modelAllegation,
              verificationDerivation: v?.reDerivation || "", verbatimExpression: v?.verbatimExpression || "",
              possibleAuthorDefense: v?.possibleAuthorDefense || "", skepticVerdict: v?.skepticVerdict || "uncertain_needs_human_or_author",
              publicWording: v?.publicWording || "", pagesSentToVerifier: pages.map((p) => p.n), locatedPage: located,
            };
            verifications.push(packet);
          }
          const survives = verifications.some((v) => v.skepticVerdict === "fatal_survives");
          const anyUncertain = verifications.some((v) => v.skepticVerdict === "uncertain_needs_human_or_author");
          if (survives) {
            internalStatus = "fatal_verified";
            evidencePackets.push(...verifications.filter((v) => v.skepticVerdict === "fatal_survives"));
          } else {
            // No fatal survived → must NOT keep the floored score; re-adjudicate with verification evidence.
            internalStatus = anyUncertain ? "fatal_alleged_unverified" : "contested_defensible_or_sound_pending";
            const reInput = JSON.stringify({
              adjudicatorInputNote: "The fatal-flaw allegation(s) below were CHECKED against the page images by a verification pass and did NOT survive (none fatal). Do NOT floor the score on a refuted/uncertain allegation. Re-issue the final review and score the paper on its merits; if a real but contested objection remains, use contested_defensible, otherwise sound.",
              reviewContext: ctx, verificationResults: verifications, priorAdjudication: { score: finalScore, scope: adj?.scopeOfUpdate, correctnessAssessment: adj?.correctnessAssessment },
            }, null, 2);
            const rRe = await callMM(EXPLANATORY_UPDATE_B2_ADJUDICATOR_PROMPT, reInput + "\\n\\nThe authoritative page images follow.", imageParts);
            const re = parse(rRe, "re-adjudicator");
            reAdjudicated = true;
            adj = re && !re.__parseError ? re : adj;
            finalScore = num(adj?.recommendedExplanatoryUpdateScore);
            const reProposed = adj?.correctnessAssessment?.internalStatusProposed;
            // If still uncertain at the image, keep fatal_alleged_unverified (public never flawed); else trust re-adjudication.
            internalStatus = anyUncertain ? "fatal_alleged_unverified" : (reProposed === "fatal_alleged" ? "contested_defensible" : (reProposed || "sound"));
          }
        }

        const pub = publicStatus(internalStatus);
        const scope = adj?.scopeOfUpdate || null;
        const provisionalBand = band(internalStatus, finalScore);
        const runMetadata = {
          arm: "B2", promptName: EXPLANATORY_UPDATE_B2_PROMPT_NAME, promptVersion: EXPLANATORY_UPDATE_B2_PROMPT_VERSION,
          promptHash: EXPLANATORY_UPDATE_B2_PROMPT_HASH, adjudicatorPromptHash: EXPLANATORY_UPDATE_B2_ADJUDICATOR_PROMPT_HASH,
          verificationPromptHash: FATAL_FLAW_VERIFICATION_PROMPT_HASH, model: "gemini", modelVersion: MODEL, temperature: TEMPERATURE,
          ingestion: "multimodal-page-images", dpi: ${DPI}, pagesSent: paper.pages.length, corpusVersion: "top55-phase0",
          reviewContext: ctx, passId: tag + "-passes", adjudicationId: tag + "-adj",
        };
        const record = {
          paper: paper.id, paperKey: paper.key, run, finalScore, scopeOfUpdate: scope,
          internalCorrectness: internalStatus, publicCorrectness: pub, provisionalBand,
          reAdjudicated, verifications, evidencePackets, runMetadata,
          adjudicated: adj, passes: [p1, p2],
          passProposedStatus: [p1?.correctnessAssessment?.internalStatusProposed, p2?.correctnessAssessment?.internalStatusProposed],
        };
        writeFileSync(OUT + "/records/" + tag + ".json", JSON.stringify(record, null, 2));
        summary.results.push({
          paper: paper.id, paperKey: paper.key, run, finalScore, scope, internalCorrectness: internalStatus,
          publicCorrectness: pub, provisionalBand, reAdjudicated,
          passScores: [num(p1?.recommendedExplanatoryUpdateScore), num(p2?.recommendedExplanatoryUpdateScore)],
          passStatus: [p1?.correctnessAssessment?.internalStatusProposed, p2?.correctnessAssessment?.internalStatusProposed],
          verifications: verifications.map((v) => ({ verdict: v.skepticVerdict, located: v.locatedPage, claim: (v.claim || "").slice(0, 80) })),
        });
        const vstr = verifications.length ? " | verify: " + verifications.map((v) => v.skepticVerdict).join(",") : "";
        console.log("  [run" + run + "] " + provisionalBand + " score=" + finalScore + " scope=" + scope + " | internal=" + internalStatus + " public=" + pub + (reAdjudicated ? " (re-adj)" : "") + vstr);
      } catch (e) {
        console.log("  [run" + run + "] ERROR " + (e?.message ?? e));
        summary.results.push({ paper: paper.id, paperKey: paper.key, run, error: String(e?.message ?? e) });
      }
    }
  }
  writeFileSync(OUT + "/summary_phase0.json", JSON.stringify(summary, null, 2));
  console.log("\\n[phase0] usage: " + usage.calls + " calls, " + usage.in + " in + " + usage.out + " out tokens. parseFailures(incl. repaired): " + summary.parseFailures.length + ". wrote summary_phase0.json");
  console.log("[phase0] DONE");
})();
`;

const { build } = await import(pathToFileURL(join(ROOT, "artifacts/api-server/node_modules/esbuild/lib/main.js")).href);
const dir = mkdtempSync(join(tmpdir(), "phase0-"));
const entryFile = join(dir, "entry.ts");
const outFile = join(dir, "bundle.cjs");
writeFileSync(entryFile, entry);
await build({ entryPoints: [entryFile], outfile: outFile, bundle: true, platform: "node", format: "cjs", nodePaths: [join(ROOT, "artifacts/api-server/node_modules"), join(ROOT, "node_modules")], logLevel: "warning" });
await import(pathToFileURL(outFile).href);
