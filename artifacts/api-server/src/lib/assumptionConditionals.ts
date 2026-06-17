// Named-assumption conditionals — pure core.
//
// The second score(s) a paper would reach IF the specific unproven assumptions
// its sub-10 dimensions rest on were granted. The review itself now emits, per
// I/C/O dimension scored below 10, { assumptionName, conditionalLiftScore } —
// the EXACT named assumption (e.g. "the AdS/CFT duality conjecture", not a
// framework bucket) and the 0-10 dimension subscore that dimension would reach
// if it were granted. This module turns those tags into a cumulative chain of
// conditionals, keyed on the named assumptions:
//
//   "If [A] holds → X" ; "If [A] and [B] hold → Y" ; contingent on [A] + [B]
//
// Anti-anchoring: the model emits the named assumption + the per-dimension rung
// it lifts to (a 0-10 subscore, like the base subscores it already emits) —
// never a 0-100 number. Every conditional TOTAL here is computed, anchored to
// the stored "in physics" score so it lines up with the displayed number.
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
