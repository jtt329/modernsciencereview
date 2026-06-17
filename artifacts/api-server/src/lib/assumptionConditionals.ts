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

export type AssumptionConditionalsResult = {
  applicable: boolean;          // ≥1 dimension has a grantable named assumption
  inPhysicsScore: number | null;
  conditionals: AssumptionConditional[];
  contingentOn: string[];       // the distinct named assumptions, in order
};

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formulaTotal(subscores: Record<ScoreDimensionKey, number | null>): number | null {
  const vals = DIMENSIONS.map((k) => subscores[k]).filter((v): v is number => typeof v === "number");
  if (vals.length === 0) return null;
  return Math.round(10 * (vals.reduce((a, b) => a + b, 0) / vals.length));
}

// Build the cumulative conditional chain from the review's emitted per-dimension
// assumption tags. `raw` is the review's assumptionConditionals object:
//   { inputStrengthScore?: { assumptionName, conditionalLiftScore }, ... }.
// A dimension contributes only when it names a non-empty assumption whose lift
// score genuinely exceeds the dimension's current subscore.
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
  for (const dim of DIMENSIONS) {
    const item = rawObj[DIM_TO_SUBSCORE_KEY[dim]];
    if (!item || typeof item !== "object") continue;
    const assumption = typeof item.assumptionName === "string" ? item.assumptionName.trim() : "";
    const liftRaw = num(item.conditionalLiftScore);
    const cur = base[dim];
    if (!assumption || liftRaw == null || cur == null) continue;
    const to = Math.min(10, Math.max(cur, liftRaw));
    if (to <= cur) continue; // names an assumption but it doesn't lift the score
    lifts.push({ dim, assumption, to });
  }

  if (lifts.length === 0) {
    return { applicable: false, inPhysicsScore: args.inPhysicsScore, conditionals: [], contingentOn: [] };
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

  return { applicable: true, inPhysicsScore: args.inPhysicsScore, conditionals, contingentOn: distinct };
}
