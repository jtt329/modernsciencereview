// Adaptive / sequential blind sampling (brief #3, v1). Pure core (no db, no
// network), offline-testable, and SHARED by the production review orchestration
// so the decision logic lives in one place. The model emits per-pass subscores;
// code decides escalation. Anti-anchoring: code computes the spread, the model
// never sees a 0-100 number.
//
// Reconciliation philosophy (brief #3): the adjudicator NEVER averages. Extra
// passes buy the adjudicator MORE independent reasoning to weigh — they are not
// pooled into a mean or median. So this module no longer pins/medians agreed
// dimensions; it only decides whether to draw one more pass and reports the
// spread as uncertainty.
//
//  (a) Adaptive sampling v1 — run the 2 blind passes; if they disagree beyond
//      tolerance, draw EXACTLY ONE more (3 total) and stop. No climb to 5: a
//      persistent outlier would always max it out. Trigger: final-score gap > 5
//      OR any per-dimension subscore gap > 1.5. Firm papers stop at 2.
//  (b) Spread — the per-pass score spread + the trigger, surfaced as visible
//      uncertainty and recorded in metadata.

export type PassSubscores = {
  input: number | null;
  construction: number | null;
  output: number | null;
};

export const DISAGREEMENT_SCORE_GAP = 5; // final-score (0-100) gap that triggers escalation
export const DISAGREEMENT_SUBSCORE_GAP = 1.5; // per-dimension (0-10) gap that triggers escalation
export const MIN_BLIND_PASSES = 2;
// Adaptive sampling v1: cap at 3. Disagreeing passes draw exactly one more, then
// stop. Tunable later; deliberately NOT climbing to 5 (a stubborn outlier would
// always force the maximum).
export const MAX_BLIND_PASSES = 3;

const DIMS = ["input", "construction", "output"] as const;
export type DimKey = (typeof DIMS)[number];

function nums(xs: Array<number | null | undefined>): number[] {
  return xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
}
// Final score from subscores via the canonical computed-ICO formula.
export function passTotal(p: PassSubscores): number | null {
  const v = nums([p.input, p.construction, p.output]);
  return v.length ? Math.round((10 * v.reduce((a, b) => a + b, 0)) / v.length) : null;
}

// Do the drawn passes disagree beyond tolerance? final-score gap > 5 OR any
// per-dimension subscore gap > 1.5.
export function passesDisagree(passes: PassSubscores[]): {
  disagree: boolean;
  scoreGap: number;
  maxDimGap: number;
  perDimGap: Record<DimKey, number>;
} {
  const totals = nums(passes.map(passTotal));
  const scoreGap = totals.length >= 2 ? Math.max(...totals) - Math.min(...totals) : 0;
  const perDimGap = {} as Record<DimKey, number>;
  let maxDimGap = 0;
  for (const d of DIMS) {
    const vals = nums(passes.map((p) => p[d]));
    const gap = vals.length >= 2 ? Math.max(...vals) - Math.min(...vals) : 0;
    perDimGap[d] = Math.round(gap * 100) / 100;
    if (gap > maxDimGap) maxDimGap = gap;
  }
  const disagree = scoreGap > DISAGREEMENT_SCORE_GAP || maxDimGap > DISAGREEMENT_SUBSCORE_GAP;
  return { disagree, scoreGap, maxDimGap: Math.round(maxDimGap * 100) / 100, perDimGap };
}

// Should another blind pass be drawn before adjudicating? Always draw up to the
// floor (2); beyond that, draw only while the passes disagree, capped at 3 (so
// in practice exactly one extra pass for a contested paper).
export function shouldDrawAnotherPass(passes: PassSubscores[]): boolean {
  if (passes.length >= MAX_BLIND_PASSES) return false;
  if (passes.length < MIN_BLIND_PASSES) return true;
  return passesDisagree(passes).disagree;
}

// Why escalation did / didn't fire, in plain words, for the metadata record.
export function samplingTrigger(passes: PassSubscores[]): string {
  const d = passesDisagree(passes);
  if (passes.length < MIN_BLIND_PASSES) return "below blind-pass floor";
  const reasons: string[] = [];
  if (d.scoreGap > DISAGREEMENT_SCORE_GAP) reasons.push(`final-score spread ${d.scoreGap} > ${DISAGREEMENT_SCORE_GAP}`);
  for (const dim of DIMS) {
    if (d.perDimGap[dim] > DISAGREEMENT_SUBSCORE_GAP) {
      reasons.push(`${dim} spread ${d.perDimGap[dim]} > ${DISAGREEMENT_SUBSCORE_GAP}`);
    }
  }
  return reasons.length ? reasons.join("; ") : "passes agreed within tolerance";
}

// Pass spread + trigger for the uncertainty display and metadata record.
export function passSpread(passes: PassSubscores[]): {
  passCount: number;
  scoreSpread: number;
  maxDimGap: number;
  perDimGap: Record<DimKey, number>;
  contested: boolean;
  escalated: boolean;
  trigger: string;
} {
  const d = passesDisagree(passes);
  return {
    passCount: passes.length,
    scoreSpread: d.scoreGap,
    maxDimGap: d.maxDimGap,
    perDimGap: d.perDimGap,
    contested: d.disagree,
    escalated: passes.length > MIN_BLIND_PASSES,
    trigger: samplingTrigger(passes),
  };
}
