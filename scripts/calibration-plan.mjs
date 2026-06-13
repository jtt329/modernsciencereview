// Calibration plan inspector (READ-ONLY).
//
// Resolves the 7 anchor + 3 bridge benchmark papers to their CURRENT
// v19.0.2 review IDs and prints a confirmable echo plus the exact endpoint
// sequence to run. It mutates nothing — re-pin/cluster/calibrate are left
// to the operator after confirming "same as last time", because the bridge
// target cohort depends on the post-re-cluster labels (a human call).
//
// Usage:
//   CAL_BASE_URL=https://<staging-web-domain>/api \
//   CAL_TOKEN='<admin sid>' \
//   node scripts/calibration-plan.mjs
//
// It reads GET /api/papers/export?debugAudit=true (admin) for current
// reviews, reports any anchor/bridge pins already present, and resolves the
// expected benchmark set by paper identity (not fuzzy title alone — arXiv
// id / DOI / canonical-title match).

const BASE = process.env.CAL_BASE_URL;
const TOKEN = process.env.CAL_TOKEN || "";
const COOKIE = process.env.CAL_COOKIE || "";

if (!BASE) { console.error("CAL_BASE_URL is required, e.g. https://<staging-web-domain>/api"); process.exit(1); }
if (!TOKEN && !COOKIE) { console.error("Provide CAL_TOKEN (admin Bearer sid) or CAL_COOKIE."); process.exit(1); }

const headers = { ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}), ...(COOKIE ? { Cookie: COOKIE } : {}) };

// The 7 anchors + 3 bridges from the last pairwise-bt-v2 run, identified by
// stable signals. The anchor's frozen score is the review's own intrinsic
// computedScore (the calibration reads it from the review), so only the
// pin flag is set; scores here are the expected values for the echo.
const EXPECTED_ANCHORS = [
  { key: "particle creation by black holes", expectScore: 100 },
  { key: "first law of thermodynamics and friedmann equations", expectScore: 88 },
  { key: "thermodynamics and/of horizons", altKey: "classical and quantum thermodynamics of horizons", expectScore: 95 },
  { key: "field-level cramer-rao", altKey: "primordial non-gaussianity", expectScore: 83 },
  { key: "thermodynamic behavior of field equations for f(r)", expectScore: 68 },
  { key: "effective pressure of the frw universe", expectScore: 30 },
  { key: "backreaction of hawking radiation", altKey: "mersini-houghton", expectScore: 7 },
];
const EXPECTED_BRIDGES = [
  { key: "thermodynamics of spacetime", altKey: "einstein equation of state", cohort: "cluster-1 (Jacobson)" },
  { key: "complementarity or firewalls", altKey: "almheiri", cohort: "cluster-1 (AMPS)" },
  { key: "holographic derivation of entanglement entropy", altKey: "ryu", cohort: "cluster-2 (RT)" },
];

const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

async function getExport() {
  const res = await fetch(`${BASE}/papers/export?debugAudit=true`, { headers });
  if (!res.ok) throw new Error(`export returned ${res.status} (admin session required)`);
  const data = await res.json();
  const rows = Array.isArray(data) ? data : Array.isArray(data?.papers) ? data.papers : [];
  return rows.map((row) => {
    const paper = row.paper ?? row;
    const review = row.review ?? row;
    return {
      paperId: paper.id,
      title: paper.title || review.displayedTitle || "",
      arxivId: paper.dateMetadata?.arxivId || "",
      doi: paper.dateMetadata?.doi || "",
      reviewId: review.reviewId || review.id || null,
      promptVersion: review.promptVersion || "",
      intrinsicScore: review.intrinsicScore ?? review.computedScore ?? review.score ?? null,
      calibrationAnchor: review.calibrationAnchor === true,
      bridgeCohortId: review.bridgeCohortId || null,
    };
  });
}

function resolve(entries, spec) {
  const keys = [spec.key, spec.altKey].filter(Boolean).map(norm);
  return entries.find((e) => keys.some((k) => norm(e.title).includes(k)));
}

const entries = await getExport();
const v19 = entries.filter((e) => String(e.promptVersion).startsWith("v19.0.2"));
console.log(`calibration-plan: ${entries.length} papers in export; ${v19.length} under v19.0.2\n`);

const currentlyPinnedAnchors = entries.filter((e) => e.calibrationAnchor);
const currentlyPinnedBridges = entries.filter((e) => e.bridgeCohortId);
console.log(`Pins currently in DB: ${currentlyPinnedAnchors.length} anchor(s), ${currentlyPinnedBridges.length} bridge(s)`);
if (currentlyPinnedAnchors.length) {
  for (const a of currentlyPinnedAnchors) console.log(`  [anchor now] ${a.title} — review ${a.reviewId} (${a.promptVersion})`);
}
console.log("");

let ok = true;
console.log("EXPECTED 7 ANCHORS → current v19 review:");
const anchorTargets = [];
for (const spec of EXPECTED_ANCHORS) {
  const match = resolve(v19, spec);
  if (!match) { ok = false; console.log(`  ✗ NOT FOUND: ${spec.key}`); continue; }
  anchorTargets.push(match);
  const flag = match.calibrationAnchor ? "already pinned" : "needs pin";
  console.log(`  • ${match.title}\n      review ${match.reviewId} · intrinsic ${match.intrinsicScore} (expect ~${spec.expectScore}) · ${flag}`);
}
console.log("\nEXPECTED 3 BRIDGES → current v19 review (cohort target depends on re-cluster output):");
const bridgeTargets = [];
for (const spec of EXPECTED_BRIDGES) {
  const match = resolve(v19, spec);
  if (!match) { ok = false; console.log(`  ✗ NOT FOUND: ${spec.key}`); continue; }
  bridgeTargets.push({ ...match, cohort: spec.cohort });
  console.log(`  • ${match.title}\n      review ${match.reviewId} · intended ${spec.cohort} · current bridgeCohortId ${match.bridgeCohortId ?? "none"}`);
}

console.log(`\nResolution: ${anchorTargets.length}/7 anchors, ${bridgeTargets.length}/3 bridges resolved.${ok ? "" : "  ⚠ Unresolved entries above — fix identity match before pinning."}`);
console.log("\n>>> Confirm the titles above are 'same as last time', then run, IN ORDER:");
console.log("  1) POST /api/papers/benchmark-clusters   (re-cluster; note the new cohort labels)");
console.log("  2) For each anchor review:  POST /api/admin/reviews/<reviewId>/calibration-flags  { calibrationAnchor: true }");
console.log("  3) For each bridge review:  POST /api/admin/reviews/<reviewId>/calibration-flags  { bridgeCohortId: '<post-cluster cohort label>' }");
console.log("  4) POST /api/papers/pairwise-calibration                       (run; check mappingStrainWarnings + calibrationHolds)");
console.log("  5) POST /api/papers/pairwise-calibration { dryRunAnchors: { anchors:[{reviewId,frozenComputedScore}, …] } }  (regenerate sensitivity, no-write)");
console.log("\nAnchor reviewIds for steps 2/5:");
for (const a of anchorTargets) console.log(`  ${a.reviewId}  ${a.intrinsicScore}  ${a.title}`);
