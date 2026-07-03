#!/usr/bin/env node
// Phase-1 field-map DRY-RUN harness — validates the B.2.1 fieldMapImpact output
// (FIELD_MAP_and_importance_phase1.md §6.1/§6.2/§7.4/§7.5) in the harness ONLY.
// No data model, no site, no DB. Renders page images (Phase-0 pipeline), runs B.2.1
// (2 image-grounded passes + adjudicator) with a SEED concept map injected, and reports
// each paper's proposed concept attachments + claims so we can sanity-check that
// attachments are claim-justified (§7.4), not magnitude-driven, and that concept
// governance (§6.2) holds — BEFORE building the schema around them.
//
//   NODE_ENV=production AI_INTEGRATIONS_GEMINI_BASE_URL=https://generativelanguage.googleapis.com \
//     node --env-file=.env scripts/phase1-fieldmap.mjs
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { renderBlindPages } from "./lib/renderBlindPages.mjs";

const ROOT = "/Users/jttyler/Projects/modernsciencereview";
const DIR = "/Users/jttyler/Desktop/Top 55";
const OUT = join(DIR, "phase1_fieldmap");
const enginePath = join(ROOT, "artifacts/api-server/src/lib/reviewEngineCompat.ts");
const b21Path = join(ROOT, "artifacts/api-server/src/lib/prompts/explanatoryUpdateB21.ts");
const DPI = parseInt(process.env.DPI || "150", 10);
const RUNS = Math.max(1, parseInt(process.env.RUNS || "1", 10));
const TEMPERATURE = process.env.TEMPERATURE ? parseFloat(process.env.TEMPERATURE) : 0.2;

// The 5 dry-run papers (JT's pick), with per-paper reviewContext.
const PAPERS = [
  { key: "3",  id: "03_Hawking", file: "03_Hawking_Particle_creation.pdf", mode: "historical_benchmark", reviewEpoch: "mid 1970s" },
  { key: "ck", id: "CaiKim", file: "11_Cai__Kim__First_Law_of_Thermodynamics_and_Friedmann_Equations_of_FRW_Universe.pdf", mode: "historical_benchmark", reviewEpoch: "mid 2000s" },
  { key: "10", id: "10_Frodden", file: "12_Frodden_Ghosh__Perez__A_Local_First_Law_for_Black_Hole_Thermodynamics.pdf", mode: "historical_benchmark", reviewEpoch: "early 2010s" },
  { key: "7",  id: "07_Ong", file: "46_Ong__A_Maximum_Force_Perspective_on_Black_Hole_Thermodynamics.pdf", mode: "historical_benchmark", reviewEpoch: "late 2010s" },
  { key: "8",  id: "08_Verlinde", file: "43_Verlinde__On_the_Origin_of_Gravity_and_the_Laws_of_Newton.pdf", mode: "historical_benchmark", reviewEpoch: "early 2010s" },
];

// Seed CURRENT CONCEPT MAP for the horizon-thermodynamics overview (§5: ~10-15 foundational
// concepts). Injected as the live map would be; lets concept governance (§6.2 attach-vs-create)
// actually be exercised. Deliberately does NOT pre-include Ong's "maximum force" or Verlinde's
// "entropic gravity" as their own nodes, so we can see whether B.2.1 correctly proposes
// create_concept WITH justification vs. over-attaching / over-creating.
const SEED_CONCEPTS = [
  { slug: "horizons", title: "Horizons (general)", scopeStatement: "Causal/geometric horizons as the organizing surface of the field: event, apparent, trapping, and cosmological horizons." },
  { slug: "black-hole-horizons", title: "Black-hole horizons", parent: "horizons", scopeStatement: "Event/Killing horizons of stationary and dynamical black holes." },
  { slug: "cosmological-apparent-horizons", title: "Cosmological & apparent horizons", parent: "horizons", scopeStatement: "FRW apparent/trapping horizons and de Sitter cosmological horizons." },
  { slug: "laws-of-black-hole-mechanics", title: "Laws of black-hole mechanics", scopeStatement: "The zeroth/first/second/third laws relating mass, area, surface gravity, angular momentum, charge." },
  { slug: "black-hole-entropy", title: "Black-hole entropy", scopeStatement: "Area-proportional entropy of horizons (Bekenstein-Hawking) and its generalizations." },
  { slug: "hawking-radiation", title: "Hawking radiation", scopeStatement: "Particle creation by black holes and the horizon temperature from semiclassical/QFT-in-curved-spacetime arguments." },
  { slug: "wald-noether-entropy", title: "Entropy as Noether charge", scopeStatement: "Wald's identification of black-hole entropy with a Noether charge for diffeomorphism-invariant gravity, incl. higher-curvature." },
  { slug: "local-first-law", title: "Local/quasilocal first law", scopeStatement: "Local-observer and quasilocal formulations of the first law of horizon thermodynamics." },
  { slug: "einstein-equation-of-state", title: "Gravity as thermodynamics (equation of state)", scopeStatement: "Deriving gravitational field equations from horizon thermodynamics (Clausius relation / entropy)." },
  { slug: "cosmological-horizon-thermodynamics", title: "Cosmological horizon thermodynamics", parent: "cosmological-apparent-horizons", scopeStatement: "Thermodynamics on FRW apparent horizons, incl. deriving Friedmann dynamics from the first law." },
  { slug: "holographic-entanglement-entropy", title: "Holographic entanglement entropy", scopeStatement: "Geometric (minimal-surface) computation of entanglement entropy via holographic duality." },
];

// ---- Outer: render every paper's blind pages (cached), write run manifest ----
mkdirSync(OUT, { recursive: true });
const runManifest = [];
console.log(`[fieldmap] rendering ${PAPERS.length} papers @ ${DPI}dpi ...`);
for (const p of PAPERS) {
  const pagesDir = join(DIR, "phase0", "pages", p.id); // reuse phase0 render cache when present
  const m = renderBlindPages(join(DIR, p.file), pagesDir, { dpi: DPI });
  console.log(`  ${p.id}: ${m.rendered}/${m.pageCount} pages${m.fromCache ? " (cached)" : ""}`);
  runManifest.push({ ...p, textPath: m.textPath, pages: m.pages.map((pg) => ({ n: pg.n, path: join(pagesDir, pg.file) })) });
}
const runManifestPath = join(OUT, "_run_manifest.json");
writeFileSync(runManifestPath, JSON.stringify(runManifest, null, 2));

const entry = `
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { ai as geminiAI } from "@workspace/integrations-gemini-ai";
import { blindManuscriptText, parseGeminiJsonResponse, GEMINI_PASS_MODEL } from ${JSON.stringify(enginePath)};
import {
  EXPLANATORY_UPDATE_B21_PROMPT, EXPLANATORY_UPDATE_B21_ADJUDICATOR_PROMPT,
  EXPLANATORY_UPDATE_B21_PROMPT_NAME, EXPLANATORY_UPDATE_B21_PROMPT_VERSION,
  EXPLANATORY_UPDATE_B21_PROMPT_HASH, EXPLANATORY_UPDATE_B21_ADJUDICATOR_PROMPT_HASH,
} from ${JSON.stringify(b21Path)};

const OUT = ${JSON.stringify(OUT)};
const RUN_MANIFEST = ${JSON.stringify(runManifestPath)};
const SEED_CONCEPTS = ${JSON.stringify(SEED_CONCEPTS)};
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

const conceptMapText = "CURRENT CONCEPT MAP (overview slug: horizon-thermodynamics). Attach to these existing nodes; create a new node only under the governance rule.\\n" +
  SEED_CONCEPTS.map((c) => "- " + c.slug + (c.parent ? " (child of " + c.parent + ")" : "") + ": " + c.title + " -- " + c.scopeStatement).join("\\n");

(async () => {
  mkdirSync(OUT + "/records", { recursive: true });
  const manifest = JSON.parse(readFileSync(RUN_MANIFEST, "utf8"));
  const summary = { model: MODEL, temperature: TEMPERATURE, dpi: ${DPI}, generatedAt: new Date().toISOString(), seedConcepts: SEED_CONCEPTS.map((c) => c.slug), results: [], parseFailures: [], flags: [] };
  console.log("[fieldmap] model=" + MODEL + " runs=" + RUNS + " papers=" + manifest.length);

  for (const paper of manifest) {
    const ctx = { mode: paper.mode, reviewEpoch: paper.reviewEpoch };
    const imageParts = paper.pages.map((pg) => imgPart(pg.path));
    const advisoryBlind = blindManuscriptText(readFileSync(paper.textPath, "utf8")).slice(0, 30000);
    const passText = [
      "reviewContext (supplied by the application): " + JSON.stringify(ctx), "",
      conceptMapText, "",
      "The manuscript is provided as the rendered PAGE IMAGES below (AUTHORITATIVE). A secondary, possibly-lossy advisory text layer follows; read load-bearing expressions from the images.",
      "", "[advisory text layer -- secondary]", advisoryBlind, "", "Produce your review, including claims and fieldMapImpact."].join("\\n");
    console.log("\\n### " + paper.id + " [" + paper.mode + "/" + paper.reviewEpoch + "] " + paper.pages.length + "pp");

    for (let run = 1; run <= RUNS; run += 1) {
      const tag = "B21_" + paper.id + "_run" + run;
      try {
        const parse = (r, where) => { try { const { value, repaired } = extractJson(r.text); if (repaired) summary.parseFailures.push({ tag, where, repaired: true }); return value; }
          catch (e) { summary.parseFailures.push({ tag, where, err: String(e?.message ?? e) }); return { __parseError: String(e?.message ?? e), raw: r.text }; } };
        const [r1, r2] = await Promise.all([
          callMM(EXPLANATORY_UPDATE_B21_PROMPT, passText, imageParts),
          callMM(EXPLANATORY_UPDATE_B21_PROMPT, passText, imageParts),
        ]);
        const p1 = parse(r1, "pass1"), p2 = parse(r2, "pass2");
        const adjInput = JSON.stringify({
          adjudicatorInputNote: "Use the authoritative page images, the reviewContext, the CURRENT CONCEPT MAP, and the two independent reviews. Resolve disputes; never average. Output the same schema INCLUDING claims and fieldMapImpact.",
          reviewContext: ctx, currentConceptMap: SEED_CONCEPTS, independentReviewPasses: [p1, p2],
        }, null, 2);
        const rAdj = await callMM(EXPLANATORY_UPDATE_B21_ADJUDICATOR_PROMPT, adjInput + "\\n\\nThe authoritative page images follow.", imageParts);
        const adj = parse(rAdj, "adjudicator");

        const fmi = adj?.fieldMapImpact || {};
        const claims = Array.isArray(adj?.claims) ? adj.claims : [];
        const claimIds = new Set(claims.map((c) => c && c.id));
        const attaches = Array.isArray(fmi.attachToConcepts) ? fmi.attachToConcepts : [];
        const seedSlugs = new Set(SEED_CONCEPTS.map((c) => c.slug));
        // Anti-circularity / governance checks (§7.4, §6.2)
        for (const a of attaches) {
          const ids = Array.isArray(a.supportedClaimIds) ? a.supportedClaimIds : [];
          if (["attach", "create_concept"].includes(a.action) && ids.length === 0)
            summary.flags.push({ tag, kind: "ANTI-CIRCULARITY: attach with no supportedClaimIds", concept: a.conceptSlug });
          if (ids.some((id) => !claimIds.has(id)))
            summary.flags.push({ tag, kind: "dangling supportedClaimId", concept: a.conceptSlug, ids });
          if (a.action === "create_concept") {
            const j = a.createConceptJustification || {};
            if (!j.whyNoExistingHosts || !j.scopeStatement)
              summary.flags.push({ tag, kind: "GOVERNANCE: create_concept missing justification", concept: a.proposedTitleIfNew || a.conceptSlug });
          }
          if (a.action === "attach" && a.conceptSlug && !seedSlugs.has(a.conceptSlug))
            summary.flags.push({ tag, kind: "attach to non-seed slug (treated as implicit create)", concept: a.conceptSlug });
        }

        const record = {
          paper: paper.id, run, score: num(adj?.recommendedExplanatoryUpdateScore), scope: adj?.scopeOfUpdate,
          correctness: adj?.correctnessAssessment?.internalStatusProposed, claims, fieldMapImpact: fmi,
          runMetadata: { arm: "B2.1", promptName: EXPLANATORY_UPDATE_B21_PROMPT_NAME, promptVersion: EXPLANATORY_UPDATE_B21_PROMPT_VERSION, promptHash: EXPLANATORY_UPDATE_B21_PROMPT_HASH, adjudicatorPromptHash: EXPLANATORY_UPDATE_B21_ADJUDICATOR_PROMPT_HASH, model: "gemini", modelVersion: MODEL, temperature: TEMPERATURE, ingestion: "multimodal-page-images", reviewContext: ctx },
          adjudicated: adj,
        };
        writeFileSync(OUT + "/records/" + tag + ".json", JSON.stringify(record, null, 2));
        summary.results.push({ paper: paper.id, run, score: record.score, scope: record.scope, correctness: record.correctness,
          claimCount: claims.length, attachments: attaches.map((a) => ({ concept: a.conceptSlug, action: a.action, role: a.role, localImportance: a.localImportance, claims: a.supportedClaimIds })),
          doesOverviewChange: fmi.doesOverviewChange, importanceFromMap: fmi.importanceFromMap?.currentStructuralPosition });
        console.log("  [run" + run + "] score=" + record.score + " scope=" + record.scope + " correctness=" + record.correctness + " | " + claims.length + " claims");
        for (const a of attaches) console.log("     -> " + a.action + " " + a.conceptSlug + " [" + a.role + "/" + a.localImportance + "] claims=" + JSON.stringify(a.supportedClaimIds));
        console.log("     overviewChange=" + fmi.doesOverviewChange + " mapPos=" + (fmi.importanceFromMap?.currentStructuralPosition));
      } catch (e) {
        console.log("  [run" + run + "] ERROR " + (e?.message ?? e));
        summary.results.push({ paper: paper.id, run, error: String(e?.message ?? e) });
      }
    }
  }
  writeFileSync(OUT + "/summary_fieldmap.json", JSON.stringify(summary, null, 2));
  console.log("\\n[fieldmap] usage: " + usage.calls + " calls, " + usage.in + " in + " + usage.out + " out. flags: " + summary.flags.length + ". parseFailures: " + summary.parseFailures.length);
  if (summary.flags.length) for (const f of summary.flags) console.log("  FLAG " + f.tag + ": " + f.kind + " (" + (f.concept || "") + ")");
  console.log("[fieldmap] DONE");
})();
`;

const { build } = await import(pathToFileURL(join(ROOT, "artifacts/api-server/node_modules/esbuild/lib/main.js")).href);
const dir = mkdtempSync(join(tmpdir(), "fieldmap-"));
const entryFile = join(dir, "entry.ts");
const outFile = join(dir, "bundle.cjs");
writeFileSync(entryFile, entry);
await build({ entryPoints: [entryFile], outfile: outFile, bundle: true, platform: "node", format: "cjs", nodePaths: [join(ROOT, "artifacts/api-server/node_modules"), join(ROOT, "node_modules")], logLevel: "warning" });
await import(pathToFileURL(outFile).href);
