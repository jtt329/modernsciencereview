// Adaptive / sequential blind sampling + consensus pinning (brief #2). Pure core
// (no db, no network), offline-testable, and SHARED by the production review
// orchestration and the variance harness so both use the exact same decision
// logic. The model emits per-pass subscores; code decides escalation and the
// agreed-dimension consensus (anti-anchoring: code computes, model never sees a
// 0-100 number).
//
//  (a) Adaptive sampling — run the 2 blind passes; if they disagree beyond
//      tolerance, draw more (cap 5) before adjudicating. Trigger: final-score
//      gap > 5 OR any per-dimension subscore gap > 1.5. Firm papers stop at 2;
//      contested ones escalate.
//  (b) Consensus pinning — dimensions the passes agree on (gap <= tolerance) are
//      carried through as the pass MEDIAN; only contested dimensions are left to
//      the adjudicator to resolve.
//  (c) Spread — the per-pass score spread, surfaced as visible uncertainty.

export type PassSubscores = {
  input: number | null;
  construction: number | null;
  output: number | null;
};

export const DISAGREEMENT_SCORE_GAP = 5; // final-score (0-100) gap that triggers escalation
export const DISAGREEMENT_SUBSCORE_GAP = 1.5; // per-dimension (0-10) gap that triggers escalation
export const MIN_BLIND_PASSES = 2;
export const MAX_BLIND_PASSES = 5;

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
export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
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
// floor (2); beyond that, draw only while the passes disagree, capped at 5.
export function shouldDrawAnotherPass(passes: PassSubscores[]): boolean {
  if (passes.length >= MAX_BLIND_PASSES) return false;
  if (passes.length < MIN_BLIND_PASSES) return true;
  return passesDisagree(passes).disagree;
}

// Per-dimension consensus across all drawn passes. Agreed (gap <= tolerance) ->
// pin the median; contested -> leave for the adjudicator.
export type DimConsensus = { dimension: DimKey; agreed: boolean; median: number | null; gap: number };
export function dimensionConsensus(passes: PassSubscores[]): DimConsensus[] {
  return DIMS.map((d) => {
    const vals = nums(passes.map((p) => p[d]));
    if (!vals.length) return { dimension: d, agreed: false, median: null, gap: 0 };
    const gap = Math.max(...vals) - Math.min(...vals);
    return { dimension: d, agreed: gap <= DISAGREEMENT_SUBSCORE_GAP, median: median(vals), gap: Math.round(gap * 100) / 100 };
  });
}

// Merge: agreed dimensions are pinned to the pass MEDIAN; contested dimensions
// take the adjudicator's resolved value. Returns the final subscores plus which
// dimensions were code-pinned (so the adjudicator effectively resolves only the
// contested ones).
export function mergeConsensusWithAdjudicated(
  consensus: DimConsensus[],
  adjudicated: PassSubscores,
): { input: number | null; construction: number | null; output: number | null; pinnedDimensions: DimKey[] } {
  const out: Record<DimKey, number | null> = { input: null, construction: null, output: null };
  const pinned: DimKey[] = [];
  for (const c of consensus) {
    if (c.agreed && c.median != null) {
      out[c.dimension] = c.median;
      pinned.push(c.dimension);
    } else {
      out[c.dimension] = adjudicated[c.dimension] ?? c.median;
    }
  }
  return { input: out.input, construction: out.construction, output: out.output, pinnedDimensions: pinned };
}

// Pass spread for the uncertainty display.
export function passSpread(passes: PassSubscores[]): {
  passCount: number;
  scoreSpread: number;
  maxDimGap: number;
  contested: boolean;
} {
  const d = passesDisagree(passes);
  return { passCount: passes.length, scoreSpread: d.scoreGap, maxDimGap: d.maxDimGap, contested: d.disagree };
}
