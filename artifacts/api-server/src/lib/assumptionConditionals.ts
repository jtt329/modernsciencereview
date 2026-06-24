// Named-assumption conditionals — pure core.
//
// The second score(s) a paper would reach IF the specific unproven assumptions
// its sub-10 dimensions rest on were granted, presented as a cumulative chain
// keyed on the named assumptions:
//
//   "If [A] holds → X" ; "If [A] and [B] hold → Y" ; contingent on [A] + [B]
//
// Source of the per-dimension tags: the model would not reliably emit them as a
// structured field (4 attempts), but the review DOES reliably state the
// assumption in its subscoreRationale prose ("untested framework", "conjecture",
// invalid/refuted, etc.). So the tags are DERIVED from that prose
// (deriveAssumptionConditionalsRawFromRationale) — no dependency on structured
// emission, and it works on existing reviews. computeAssumptionConditionals then
// applies the same status gate (only "open" lifts; "error"/"ruled_out"/
// "confirmed" never do) and builds the chain.
//
// Anti-anchoring: the lift is a 0-10 dimension rung; every 0-100 conditional
// TOTAL is computed here, anchored to the stored "in physics" score.
//
// Pure (no db, no network), offline-testable.

export type ScoreDimensionKey = "input" | "construction" | "output";

const DIMENSIONS: ScoreDimensionKey[] = ["input", "construction", "output"];
const DIM_TO_SUBSCORE_KEY: Record<ScoreDimensionKey, string> = {
  input: "inputStrengthScore",
  construction: "constructionStrengthScore",
  output: "outputStrengthScore",
};

export type AssumptionConditional = {
  assumptions: string[]; // the named assumptions granted at this step (cumulative)
  score: number;         // the recomputed total if those assumptions hold
};

// Epistemic status of a docked cause, judged with CURRENT knowledge. ONLY
// "open" earns a conditional — an unresolved question about NATURE (an
// unconfirmed physical framework or a genuine open conjecture). The others
// never lift:
//   "approximation" — a deliberate, known-to-be-approximate modeling choice
//                  (semiclassical, leading-order, random-pure-state idealization,
//                  mean-field, probe limit, neglecting backreaction, ...). Not an
//                  open question about nature — there is no "what if it were
//                  exactly true" that changes the science.
//   "ruled_out"  — a premise falsified / ruled out (even if reasonable at
//                  publication).
//   "error"      — the work itself is WRONG: invalid/unphysical construction,
//                  algebraic or logical error, refuted/contradicted output, or
//                  an inappropriate/incorrect modeling choice. There is nothing
//                  to grant.
//   "confirmed"  — established/firm today (not a deduction at all).
//   "unknown"    — unclassified; treated as ineligible (conservative).
export type AssumptionStatus = "open" | "approximation" | "ruled_out" | "error" | "confirmed" | "unknown";

export type ExcludedAssumption = {
  dimension: ScoreDimensionKey;
  assumptionName: string;
  status: AssumptionStatus;
};

export type AssumptionConditionalsResult = {
  applicable: boolean;          // ≥1 dimension has an OPEN, grantable assumption
  inPhysicsScore: number | null;
  conditionals: AssumptionConditional[];
  contingentOn: string[];       // the distinct OPEN assumptions, in order
  excluded: ExcludedAssumption[]; // named assumptions NOT eligible (ruled-out / confirmed / unknown)
};

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Normalize the model's status string. Defaults to "unknown" (NOT eligible) so
// a missing/ambiguous status never produces a conditional — earning a lift
// requires an explicit "open". "wrong" causes (errors, invalidity, refutation,
// incorrect modeling) map to "error"; falsified premises to "ruled_out"; both
// are ineligible. Order matters: the ineligible buckets are checked first so a
// word like "unproven" never lets an error/refuted cause slip into "open".
export function normalizeAssumptionStatus(value: unknown): AssumptionStatus {
  const s = typeof value === "string" ? value.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
  if (!s) return "unknown";
  // "The work is wrong" — never a conditional.
  if (/(error|invalid|unphysical|nonphysical|algebra|logic|refuted|contradict|incorrect|wrong|flaw|erroneous|mistaken|fallac|inconsistent|nonsensical|unsound|incoherent|inappropriate)/.test(s)) return "error";
  // A premise falsified / ruled out by current evidence.
  if (/(ruled_out|ruledout|falsified|disproven|disproved|excluded|overturned|known_false|debunked)/.test(s)) return "ruled_out";
  // A deliberate modeling approximation — never a conditional.
  if (/(approximat|semiclassical|leading_order|perturbativ|mean_field|idealiz|probe_limit|test_particle|random_pure_state|haar|quasi_static|adiabatic|backreaction|saddle)/.test(s)) return "approximation";
  if (/(confirmed|established|firm|proven|proved|verified|settled|accepted)/.test(s)) return "confirmed";
  if (/(open|speculative|unconfirmed|conjectur|plausible|tentative|untested|provisional|hypothes|unproven|unsettled|viable)/.test(s)) return "open";
  return "unknown";
}

// Extra deterministic guard for the two ways a non-grantable "condition" can
// sneak past a model status label:
//   1) the assumption name itself says the premise is wrong / ruled out;
//   2) the premise is a mere/weak/soap-bubble analogy. Conditionals are for
//      unresolved physical frameworks or conjectures, not "what if this failed
//      analogy were true" counterfactuals.
const ASSUMPTION_NAME_ERROR = /\b(?:does not hold|do not hold|fails?|failed|invalid|unphysical|nonphysical|non-physical|incorrect|wrong|refut(?:ed|es|ing)?|contradict(?:ed|s|ing)?|inconsistent|unsound|incoherent|false|not valid|not justified|breaks down|break down)\b/i;
const ASSUMPTION_NAME_RULED_OUT = /\b(?:ruled[-\s]?out|falsified|disproven|disproved|excluded by (?:experiment|data|observation)|known (?:to be )?false|overturned)\b/i;
const NON_GRANTABLE_ANALOGY = /\b(?:soap[-\s]?bubble|bubble analogy|weak analogy|mere analogy|heuristic analogy|analogy)\b/i;

function nonGrantableAssumptionStatusFromText(text: string): AssumptionStatus | null {
  const s = text.trim();
  if (!s) return null;
  if (ASSUMPTION_NAME_ERROR.test(s)) return "error";
  if (ASSUMPTION_NAME_RULED_OUT.test(s)) return "ruled_out";
  if (NON_GRANTABLE_ANALOGY.test(s)) return "unknown";
  return null;
}

function formulaTotal(subscores: Record<ScoreDimensionKey, number | null>): number | null {
  const vals = DIMENSIONS.map((k) => subscores[k]).filter((v): v is number => typeof v === "number");
  if (vals.length === 0) return null;
  return Math.round(10 * (vals.reduce((a, b) => a + b, 0) / vals.length));
}

// Build the cumulative conditional chain from the review's emitted per-dimension
// assumption tags. `raw` is the review's assumptionConditionals object:
//   { inputStrengthScore?: { assumptionName, assumptionStatus, conditionalLiftScore }, ... }.
// A dimension contributes a conditional only when it names a non-empty assumption
// whose status is OPEN and whose lift score genuinely exceeds the current
// subscore; ruled-out / confirmed / unknown assumptions are recorded in
// `excluded` but never lifted.
// A not-physically-realizable output referent cannot reach full realizable
// credit even if its open assumption is granted, so its conditional ("if-true")
// OUTPUT lift is capped one firmness tier below top (8) — keeping the if-true
// total strictly below 100 (e.g. RT caps ~93; #22 must not reach 100).
export const REALIZABILITY_OUTPUT_LIFT_CEILING = 8;

export function computeAssumptionConditionals(args: {
  inPhysicsScore: number | null;
  subscores: Partial<Record<ScoreDimensionKey, number | null>>;
  raw: unknown;
  // When false, the output's referent is not physically realizable (the model's
  // §5 flag); the OUTPUT lift is capped so the if-true chain stays < 100.
  outputReferentRealizable?: boolean;
}): AssumptionConditionalsResult {
  const base: Record<ScoreDimensionKey, number | null> = {
    input: num(args.subscores.input),
    construction: num(args.subscores.construction),
    output: num(args.subscores.output),
  };
  const rawObj = args.raw && typeof args.raw === "object" && !Array.isArray(args.raw)
    ? args.raw as Record<string, any>
    : {};

  type Lift = { dim: ScoreDimensionKey; assumption: string; to: number };
  const lifts: Lift[] = [];
  const excluded: ExcludedAssumption[] = [];
  for (const dim of DIMENSIONS) {
    const item = rawObj[DIM_TO_SUBSCORE_KEY[dim]];
    if (!item || typeof item !== "object") continue;
    const assumption = typeof item.assumptionName === "string" ? item.assumptionName.trim() : "";
    if (!assumption) continue;
    const status = normalizeAssumptionStatus(item.assumptionStatus);
    const nonGrantableStatus = status === "open" ? nonGrantableAssumptionStatusFromText(assumption) : null;
    // ONLY an open (unconfirmed-but-not-contradicted) assumption earns a
    // conditional. Ruled-out / confirmed / unknown are recorded but never
    // lifted — lifting a ruled-out premise would hand the paper a misleadingly
    // high second score.
    if (status !== "open" || nonGrantableStatus) {
      excluded.push({ dimension: dim, assumptionName: assumption, status: nonGrantableStatus ?? status });
      continue;
    }
    const liftRaw = num(item.conditionalLiftScore);
    const cur = base[dim];
    if (liftRaw == null || cur == null) continue;
    let to = Math.min(10, Math.max(cur, liftRaw));
    // Realizability cap (#2): cap the OUTPUT lift when the referent is not
    // physically realizable, so granting the assumption can't push the if-true
    // total to 100 for an idealized-setting result.
    if (dim === "output" && args.outputReferentRealizable === false) {
      to = Math.min(to, REALIZABILITY_OUTPUT_LIFT_CEILING);
    }
    if (to <= cur) continue; // names an assumption but it doesn't lift the score
    lifts.push({ dim, assumption, to });
  }

  if (lifts.length === 0) {
    return { applicable: false, inPhysicsScore: args.inPhysicsScore, conditionals: [], contingentOn: [], excluded };
  }

  // Distinct assumptions in first-appearance (I→C→O) order; granting one lifts
  // every dimension that named it.
  const distinct: string[] = [];
  for (const lift of lifts) if (!distinct.includes(lift.assumption)) distinct.push(lift.assumption);

  const curTotal = formulaTotal(base);
  const conditionals: AssumptionConditional[] = [];
  for (let k = 1; k <= distinct.length; k += 1) {
    const granted = new Set(distinct.slice(0, k));
    const adj: Record<ScoreDimensionKey, number | null> = { ...base };
    for (const lift of lifts) {
      if (!granted.has(lift.assumption)) continue;
      const existing = adj[lift.dim];
      adj[lift.dim] = existing == null ? lift.to : Math.max(existing, lift.to);
    }
    const adjTotal = formulaTotal(adj);
    const delta = curTotal != null && adjTotal != null ? adjTotal - curTotal : 0;
    const score = args.inPhysicsScore != null
      ? Math.min(100, Math.max(args.inPhysicsScore, args.inPhysicsScore + delta))
      : (adjTotal ?? 0);
    conditionals.push({ assumptions: distinct.slice(0, k), score });
  }

  return { applicable: true, inPhysicsScore: args.inPhysicsScore, conditionals, contingentOn: distinct, excluded };
}

// --- Prose derivation (the working source) -----------------------------------
//
// The review's subscoreRationale reliably names the cause of each deduction in
// words. We classify that prose per below-10 dimension into the same shape the
// model was supposed to emit { assumptionName, assumptionStatus,
// conditionalLiftScore }, which then feeds computeAssumptionConditionals. This
// is deterministic and conservative: a "wrong" (error) or "ruled_out" cause is
// NEVER lifted, and a dimension only yields an OPEN conditional when the prose
// clearly indicates an unproven-but-viable assumption (named framework /
// conjecture / untested). Anything else yields no entry.

// Curated named assumptions for the physics corpus: lowercase test -> display
// name. These are unconfirmed physical FRAMEWORKS and named OPEN CONJECTURES —
// unresolved questions about nature whose resolution would change the science.
// A match here is a framework/open-conjecture cue (status "open"). Extend as
// the corpus needs.
const NAMED_ASSUMPTION_PATTERNS: Array<[RegExp, string]> = [
  [/ads[\/\-\s]?cft|anti[-\s]?de[-\s]?sitter/, "the AdS/CFT correspondence"],
  [/\bstring[-\s]?theor/, "string theory"],
  [/\bm[-\s]?theory\b/, "M-theory"],
  [/\bholograph/, "the holographic principle"],
  [/\bloop[-\s]?quantum|\bspin[-\s]?network|\bspin[-\s]?foam|\barea[-\s]?spectrum/, "loop quantum gravity"],
  [/\bsupergravit/, "supergravity"],
  [/\bsupersymmetr|\bsusy\b/, "supersymmetry"],
  [/\bextra[-\s]dimension/, "extra dimensions"],
  [/\bd[-\s]?brane/, "the D-brane construction"],
  [/\bswampland/, "the swampland conjecture"],
  [/\basymptotic[-\s]safety/, "asymptotic safety"],
  [/\bcausal[-\s]set/, "causal set theory"],
  [/\bentropic[-\s]gravity|emergent[-\s]gravity/, "emergent/entropic gravity"],
  // Named open conjectures (questions about nature, not modeling choices).
  [/\bcosmic[-\s]censorship/, "cosmic censorship"],
  [/\basymptotic[-\s]predictability/, "asymptotic predictability"],
];

// --- Point-deduction display (anti-anchoring-safe) ---------------------------
// Per-ICO "why not 10": for each I/C/O dimension below 10, the public
// "<dim> <subscore> · −<points> · <cause>" line. The dimension subscore IS the
// rung→points contribution (0-10), so the deduction is simply 10 − subscore —
// read from the same table, no model number. We carry BOTH the assigned subscore
// (the "7.5") and the points off 10 (the "−2.5") so the display can show the
// per-category breakdown rather than a single "why not 100" roll-up. cause is
// the stored rationale (the same text the conditional classifier reads). Same
// rung always yields the same deduction (consistent by construction).
export type PointDeduction = {
  dimension: ScoreDimensionKey;
  subscore: number; // the assigned 0-10 rung→points contribution (the "7.5")
  points: number;   // 10 − subscore (the "−2.5")
  cause: string;
};

export function computePointDeductions(
  subscores: Partial<Record<ScoreDimensionKey, number | null>>,
  rationale: Record<string, any> | null | undefined,
): PointDeduction[] {
  const rat = rationale && typeof rationale === "object" ? rationale : {};
  const out: PointDeduction[] = [];
  for (const dim of DIMENSIONS) {
    const cur = num((subscores as any)[dim]);
    if (cur == null || cur >= 10) continue;
    const causeRaw = rat[DIM_TO_SUBSCORE_KEY[dim]];
    out.push({
      dimension: dim,
      subscore: Math.round(cur * 10) / 10,      // the assigned rung (0-10), one decimal
      points: Math.round((10 - cur) * 10) / 10, // top (10) − assigned, one decimal
      cause: typeof causeRaw === "string" ? causeRaw.trim() : "",
    });
  }
  return out;
}

// "The work is wrong" — never a conditional. Checked first (dominates).
const PROSE_ERROR = /\b(invalid|unphysical|nonphysical|non-physical|algebraic error|algebra is|logical(?:ly)? (?:error|flaw|inconsistent)|refut|contradict|incorrect|erroneous|\bflaw|inconsisten|inappropriate (?:vacuum|choice|assumption|modeling)|unsound|fatal (?:error|flaw)|mathematically wrong|does not hold|ill-defined|nonsensical|sign error)\b/;
// A premise falsified / ruled out by current evidence.
const PROSE_RULED_OUT = /\b(ruled[-\s]?out|falsified|disproven|disproved|experimentally excluded|excluded by (?:experiment|data|observation)|debunked|overturned|known to be false|now known false)\b/;
// A generic open conjecture cue (no specific framework named, but the result
// is explicitly contingent on something conjectured/unproven-but-mathematical).
const PROSE_OPEN_CONJECTURE = /\b(conjectur|unproven (?:duality|correspondence|conjecture)|unproven mathematical|contingent on the (?:conjecture|hypothesis))\b/;
// A deliberate, known-to-be-approximate MODELING choice — NOT an open question
// about nature. Never lifts (recorded as "approximation").
const PROSE_APPROXIMATION = /\b(approximat|semiclassical|semi-classical|leading[-\s]order|next[-\s]to[-\s]leading|perturbativ|to first order|first[-\s]order|one[-\s]loop|tree[-\s]level|saddle[-\s]point|large[-\s]?n\b|mean[-\s]field|probe (?:limit|approximation)|test[-\s]particle|test particle|random pure state|haar[-\s]?random|thermal[-\s]equilibrium|near[-\s]horizon (?:expansion|approximation)|asymptotic expansion|quasi[-\s]?static|adiabatic|neglect(?:s|ing)? (?:the )?backreaction|without backreaction|no backreaction|modell?ed as|treated as|idealiz)\b/;
// Generic, viable uncertainty (open question) with no framework named — lifts,
// but ONLY after approximation has been ruled out.
const PROSE_OPEN_GENERIC = /\b(untested|unproven|unconfirmed|not (?:yet )?(?:been )?(?:experimentally )?(?:confirmed|verified|established|tested)|no experimental (?:confirmation|evidence|support)|speculativ|hypothe(?:tical|sis)|provisional|unverified|tentative|awaits? (?:experimental )?(?:confirmation|verification)|lacks experimental)\b/;

function namedAssumptionFrom(text: string): string | null {
  for (const [pattern, name] of NAMED_ASSUMPTION_PATTERNS) if (pattern.test(text)) return name;
  return null;
}

// Classify one dimension's rationale prose. Precedence:
//   error -> ruled_out -> framework/open-conjecture (LIFT) -> approximation ->
//   generic-open (LIFT) -> none.
// A framework/conjecture cue beats an approximation cue (a genuine framework
// lift is never suppressed by an approximation phrase in the same prose); but
// an approximation cue beats generic-open language, so a deliberate
// idealization (random pure state, semiclassical, ...) does NOT lift.
function classifyProseCause(text: string): { status: AssumptionStatus; named: string | null } | null {
  if (PROSE_ERROR.test(text)) return { status: "error", named: null };
  if (PROSE_RULED_OUT.test(text)) return { status: "ruled_out", named: null };
  const named = namedAssumptionFrom(text);
  if (named || PROSE_OPEN_CONJECTURE.test(text)) return { status: "open", named };
  if (PROSE_APPROXIMATION.test(text)) return { status: "approximation", named: null };
  if (PROSE_OPEN_GENERIC.test(text)) return { status: "open", named: null };
  return null; // scope / breadth / no recognized cue
}

export function deriveAssumptionConditionalsRawFromRationale(
  rationale: Record<string, any> | null | undefined,
  subscores: Partial<Record<ScoreDimensionKey, number | null>>,
): Record<string, { assumptionName: string; assumptionStatus: AssumptionStatus; conditionalLiftScore: number }> {
  const out: Record<string, { assumptionName: string; assumptionStatus: AssumptionStatus; conditionalLiftScore: number }> = {};
  const rat = rationale && typeof rationale === "object" ? rationale : {};
  for (const dim of DIMENSIONS) {
    const cur = num((subscores as any)[dim]);
    if (cur == null || cur >= 10) continue; // already top / no usable subscore
    const proseRaw = rat[DIM_TO_SUBSCORE_KEY[dim]];
    const prose = typeof proseRaw === "string" ? proseRaw : "";
    if (!prose.trim()) continue;
    const cause = classifyProseCause(prose.toLowerCase());
    if (!cause) continue; // dock isn't a grantable assumption (scope/breadth/etc.)
    out[DIM_TO_SUBSCORE_KEY[dim]] = {
      assumptionName: cause.named ?? (cause.status === "open" ? "the unproven assumption it rests on" : "the limiting factor"),
      assumptionStatus: cause.status,
      conditionalLiftScore: cause.status === "open" ? 10 : cur, // only "open" lifts to firm
    };
  }
  return out;
}

// --- Ledger derivation (the #22 fix) -----------------------------------------
//
// Source conditionals from the OPEN entries in the review's ICO input ledger —
// the premises the result is genuinely built from — NOT from narrative prose.
// A framework merely MENTIONED in the rationale (e.g. an output's idealized
// setting like "AdS") is not a ledger INPUT and therefore cannot become a
// conditional. If a paper has no open inputs/constructions, it gets NO
// conditional.
//
// "Open" is read from the structured ledger so it survives the v19.0.6
// plain-words-rungs change (which removes F1-F4/C1-C5 from prose) and does not
// depend on the gated firmnessRung field:
//   input:        firmnessRung F3/F4 (when present) OR frameworkDependenceLevel
//                 "high" OR groundingQuality "weak".
//   construction: validityLevel "conditional" (valid only if an assumption holds).
// This reads an object the model already emits every review — no new structured-
// emission field — so it avoids the emission fragility that forced the earlier
// pivot to prose.

function strField(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function shortName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}
function dedupeNames(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const key = n.toLowerCase();
    if (n && !seen.has(key)) { seen.add(key); out.push(n); }
  }
  return out;
}
function ledgerEntryText(it: Record<string, any>): string {
  const fields = [
    "foundationLabel", "input", "groundingQuality", "frameworkDependenceLevel",
    "construction", "role", "assessment", "validity", "validityLevel",
    "hardToVaryAssessment", "fragilityLimits", "support",
  ];
  return fields.map((field) => strField(it[field])).filter(Boolean).join(" ");
}
function ledgerIco(ledger: Record<string, any> | null | undefined): Record<string, any> {
  return (ledger?.inputConstructionOutputAssessment ?? ledger?.inputConstructionOutputLedger ?? ledger ?? {}) as Record<string, any>;
}
function openLedgerInputs(ledger: Record<string, any> | null | undefined): string[] {
  const ico = ledgerIco(ledger);
  const inputs = ico?.input?.primitiveInputs ?? (ledger as any)?.primitiveInputs ?? [];
  const names: string[] = [];
  for (const it of Array.isArray(inputs) ? inputs : []) {
    if (!it || typeof it !== "object") continue;
    const rung = strField((it as any).firmnessRung).toUpperCase();
    const framework = strField((it as any).frameworkDependenceLevel).toLowerCase();
    const grounding = strField((it as any).groundingQuality).toLowerCase();
    // The precise rung is AUTHORITATIVE when present (v19.0.7): open iff F3/F4.
    // The framework/grounding proxy is only a FALLBACK for elements whose rung is
    // absent/flaky — it must NOT override a closed (F1/F2) rung (otherwise a noisy
    // "weak grounding" on a firm input opens it, the Campos misfire).
    const hasRung = /F\s*[1-4]\b/.test(rung);
    const open = hasRung ? /F\s*[34]\b/.test(rung) : (framework === "high" || grounding === "weak");
    if (!open) continue;
    if (nonGrantableAssumptionStatusFromText(ledgerEntryText(it as Record<string, any>))) continue;
    const name = strField((it as any).foundationLabel) || strField((it as any).input);
    if (name) names.push(shortName(name));
  }
  return dedupeNames(names);
}
function openLedgerConstructions(ledger: Record<string, any> | null | undefined): string[] {
  const ico = ledgerIco(ledger);
  const cons = ico?.construction?.introducedConstructions ?? (ledger as any)?.introducedConstructions ?? [];
  const names: string[] = [];
  for (const it of Array.isArray(cons) ? cons : []) {
    if (!it || typeof it !== "object") continue;
    const validity = strField((it as any).validityLevel).toLowerCase();
    // A WRONG construction (validity "invalid") is an ERROR, not an open
    // assumption — granting it can never lift the score, even if its firmness
    // rung is F3/F4 (a conjectural rung on a refuted/invalid step). Only
    // viable-but-unconfirmed constructions are "open". (Without this, a wrong
    // paper like Campos whose invalid constructions are rated F4 would get a
    // spurious "if-true -> ~100" conditional.)
    if (validity === "invalid") continue;
    // Precise rung authoritative when present (open iff F3/F4); else the validity
    // proxy (valid only if an assumption holds) is the fallback.
    const rung = strField((it as any).firmnessRung).toUpperCase();
    const hasRung = /F\s*[1-4]\b/.test(rung);
    const open = hasRung ? /F\s*[34]\b/.test(rung) : (validity === "conditional");
    if (!open) continue;
    if (nonGrantableAssumptionStatusFromText(ledgerEntryText(it as Record<string, any>))) continue;
    const name = strField((it as any).construction);
    if (name) names.push(shortName(name));
  }
  return dedupeNames(names);
}

export function deriveAssumptionConditionalsRawFromLedger(
  ledger: Record<string, any> | null | undefined,
  subscores: Partial<Record<ScoreDimensionKey, number | null>>,
): Record<string, { assumptionName: string; assumptionStatus: AssumptionStatus; conditionalLiftScore: number }> {
  const out: Record<string, { assumptionName: string; assumptionStatus: AssumptionStatus; conditionalLiftScore: number }> = {};
  const openInputs = openLedgerInputs(ledger);
  const openConstructions = openLedgerConstructions(ledger);
  const allOpen = dedupeNames([...openInputs, ...openConstructions]);
  if (allOpen.length === 0) return out; // no open premise -> no conditional (the #22 fix)
  const pick = (dim: ScoreDimensionKey): string => {
    if (dim === "construction") return openConstructions[0] ?? openInputs[0] ?? allOpen[0];
    if (dim === "output") return openInputs[1] ?? openInputs[0] ?? allOpen[0];
    return openInputs[0] ?? allOpen[0]; // input
  };
  for (const dim of DIMENSIONS) {
    const cur = num((subscores as any)[dim]);
    if (cur == null || cur >= 10) continue; // already top / no usable subscore
    const name = pick(dim);
    if (!name) continue;
    out[DIM_TO_SUBSCORE_KEY[dim]] = { assumptionName: name, assumptionStatus: "open", conditionalLiftScore: 10 };
  }
  return out;
}

// The model's §5 realizability flag, read from its stated prose (output
// subscore rationale + output ledger assessments). Default REALIZABLE (true);
// flips to false only when the output referent is explicitly not physically
// realizable, which caps the if-true chain below 100 (see
// REALIZABILITY_OUTPUT_LIFT_CEILING).
const PROSE_NON_REALIZABLE = /\bnot[ -](?:a |fully )?physically[ -]realizable|not[ -]realizable|nature does not realize|does not realize|idealized (?:setting|spacetime|referent|system|background)|purely mathematical (?:setting|construction|referent)|lower[- ]dimensional (?:toy|model|setting)|limited (?:physical )?realizability|low transfer\b/i;

export function outputReferentRealizableFromLedger(
  ledger: Record<string, any> | null | undefined,
  rationale: Record<string, any> | null | undefined,
): boolean {
  const rat = rationale && typeof rationale === "object" ? rationale : {};
  const ico = ledgerIco(ledger);
  const outs = ico?.output?.outputs ?? (ledger as any)?.outputs ?? [];
  const texts: string[] = [];
  const ratText = (rat as any)["outputStrengthScore"];
  if (typeof ratText === "string") texts.push(ratText);
  for (const o of Array.isArray(outs) ? outs : []) {
    if (o && typeof o === "object" && typeof (o as any).assessment === "string") texts.push((o as any).assessment);
  }
  return !texts.some((t) => PROSE_NON_REALIZABLE.test(t));
}
