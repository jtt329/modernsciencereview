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
// "open" earns a conditional — genuine uncertainty (viable-but-unproven). The
// others never lift, because there is no honest "what if it were true":
//   "ruled_out"  — a premise falsified / ruled out (even if reasonable at
//                  publication).
//   "error"      — the work itself is WRONG: invalid/unphysical construction,
//                  algebraic or logical error, refuted/contradicted output, or
//                  an inappropriate/incorrect modeling choice. "wrong" is not
//                  "uncertain" — there is nothing to grant.
//   "confirmed"  — established/firm today (not a deduction at all).
//   "unknown"    — unclassified; treated as ineligible (conservative).
export type AssumptionStatus = "open" | "ruled_out" | "error" | "confirmed" | "unknown";

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
  if (/(confirmed|established|firm|proven|proved|verified|settled|accepted)/.test(s)) return "confirmed";
  if (/(open|speculative|unconfirmed|conjectur|plausible|tentative|untested|provisional|hypothes|unproven|unsettled|viable)/.test(s)) return "open";
  return "unknown";
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
export function computeAssumptionConditionals(args: {
  inPhysicsScore: number | null;
  subscores: Partial<Record<ScoreDimensionKey, number | null>>;
  raw: unknown;
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
    // ONLY an open (unconfirmed-but-not-contradicted) assumption earns a
    // conditional. Ruled-out / confirmed / unknown are recorded but never
    // lifted — lifting a ruled-out premise would hand the paper a misleadingly
    // high second score.
    if (status !== "open") {
      excluded.push({ dimension: dim, assumptionName: assumption, status });
      continue;
    }
    const liftRaw = num(item.conditionalLiftScore);
    const cur = base[dim];
    if (liftRaw == null || cur == null) continue;
    const to = Math.min(10, Math.max(cur, liftRaw));
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
// name. Extend as the corpus needs.
const NAMED_ASSUMPTION_PATTERNS: Array<[RegExp, string]> = [
  [/ads[\/\-\s]?cft|anti[-\s]?de[-\s]?sitter/, "the AdS/CFT correspondence"],
  [/\bstring[-\s]?theor/, "string theory"],
  [/\bm[-\s]?theory\b/, "M-theory"],
  [/\bholograph/, "the holographic principle"],
  [/\bloop[-\s]?quantum/, "loop quantum gravity"],
  [/\bsupergravit/, "supergravity"],
  [/\bsupersymmetr|\bsusy\b/, "supersymmetry"],
  [/\bd[-\s]?brane/, "the D-brane construction"],
  [/\bswampland/, "the swampland conjecture"],
  [/\beft\b|effective[-\s]field[-\s]theory/, "the effective-field-theory assumption"],
  [/\basymptotic[-\s]safety/, "asymptotic safety"],
  [/\bcausal[-\s]set/, "causal set theory"],
  [/\bentropic[-\s]gravity|emergent[-\s]gravity/, "emergent/entropic gravity"],
];

// "The work is wrong" — never a conditional. Checked first (dominates).
const PROSE_ERROR = /\b(invalid|unphysical|nonphysical|non-physical|algebraic error|algebra is|logical(?:ly)? (?:error|flaw|inconsistent)|refut|contradict|incorrect|erroneous|\bflaw|inconsisten|inappropriate (?:vacuum|choice|assumption)|unsound|fatal (?:error|flaw)|mathematically wrong|does not hold|ill-defined|nonsensical|sign error)\b/;
// A premise falsified / ruled out by current evidence.
const PROSE_RULED_OUT = /\b(ruled[-\s]?out|falsified|disproven|disproved|experimentally excluded|excluded by (?:experiment|data|observation)|debunked|overturned|known to be false|now known false)\b/;
// Genuine, viable uncertainty — the only case that lifts.
const PROSE_OPEN = /\b(untested|unproven|unconfirmed|not (?:yet )?(?:been )?(?:experimentally )?(?:confirmed|verified|established|tested)|no experimental (?:confirmation|evidence|support)|conjectur|speculativ|hypothe(?:tical|sis)|provisional|unverified|tentative|awaits? (?:experimental )?(?:confirmation|verification)|lacks experimental)\b/;

function namedAssumptionFrom(text: string): string | null {
  for (const [pattern, name] of NAMED_ASSUMPTION_PATTERNS) if (pattern.test(text)) return name;
  return null;
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
    const text = prose.toLowerCase();
    const named = namedAssumptionFrom(text);
    let status: AssumptionStatus;
    if (PROSE_ERROR.test(text)) status = "error";              // wrong dominates
    else if (PROSE_RULED_OUT.test(text)) status = "ruled_out";
    else if (PROSE_OPEN.test(text) || named) status = "open";
    else continue; // dock isn't a grantable assumption (scope/breadth/etc.)
    out[DIM_TO_SUBSCORE_KEY[dim]] = {
      assumptionName: named ?? (status === "open" ? "the unproven assumption it rests on" : "the limiting factor"),
      assumptionStatus: status,
      conditionalLiftScore: status === "open" ? 10 : cur, // open lifts to firm; others don't lift
    };
  }
  return out;
}
