// Pairwise calibration scale fit. Pure app code: no model calls, no I/O.
// RANKING comes from the model's pairwise judgments (order-independent);
// SCALING happens here, anchored to admin-frozen computedScores.
// Determinism: same inputs always produce the same outputs — iteration
// orders are sorted, iteration counts fixed, and no randomness is used.

export type PairwiseMargin = "slight" | "clear" | "decisive";
export type DimensionOutcome = "a" | "b" | "equal";

export type CalibrationPairOutcome = {
  aId: string;
  bId: string;
  overall: DimensionOutcome;
  margin: PairwiseMargin;
  inputStrength: DimensionOutcome;
  constructionStrength: DimensionOutcome;
  outputStrength: DimensionOutcome;
  positionInconsistent: boolean;
  // 0.5 when either side is weaker-blinded or recognition-suspected, else 1.
  weightFactor: number;
};

export type CalibrationAnchor = {
  reviewId: string;
  frozenComputedScore: number;
  // Admin pinned this anchor despite weaker blinding or suspected
  // recognition; the fit records it in anchorOverrides.
  adminPinnedOverride?: boolean;
};

export type CalibrationAnchorOverride = {
  reviewId: string;
  reason: "admin-pinned";
};

export type CalibrationCohortInput = {
  cohortId: string;
  members: string[];
  anchors: CalibrationAnchor[];
  // Intrinsic computedScores; used only for the fallback scale (virtual
  // anchor / single-anchor slope), never modified.
  computedScores: Record<string, number>;
  outcomes: CalibrationPairOutcome[];
};

export type DimensionWinRates = {
  inputStrength: number | null;
  constructionStrength: number | null;
  outputStrength: number | null;
  overall: number | null;
};

export type CohortFitResult = {
  cohortId: string;
  unanchored: boolean;
  // Strongest first; ties broken by review id for determinism.
  ranking: string[];
  strengths: Record<string, number>;
  calibratedScores: Record<string, number>;
  dimensionWinRates: Record<string, DimensionWinRates>;
  comparisonCounts: Record<string, number>;
  anchorOverrides: CalibrationAnchorOverride[];
};

export const CALIBRATION_MODE_PAIRWISE_BT_V1 = "pairwise-bt-v1";

export const MARGIN_WEIGHTS: Record<PairwiseMargin, number> = {
  slight: 1,
  clear: 2,
  decisive: 3,
};

// Davidson-style smoothing: a tiny symmetric pseudo-win per observed pair
// keeps strengths finite when a paper wins or loses every comparison.
const BT_PSEUDO_COUNT = 0.1;
const BT_MAX_ITERATIONS = 500;
const BT_CONVERGENCE = 1e-12;
const BRIDGE_RECONCILE_PASSES = 10;

function pairKey(a: string, b: string) {
  return a < b ? `${a}\0${b}` : `${b}\0${a}`;
}

export function outcomeWeight(outcome: CalibrationPairOutcome) {
  return MARGIN_WEIGHTS[outcome.margin] * outcome.weightFactor;
}

// Standard MM algorithm for Bradley-Terry (Hunter 2004). Returns strengths
// normalized to geometric mean 1.
export function fitBradleyTerry(
  members: string[],
  outcomes: CalibrationPairOutcome[],
): Record<string, number> {
  const ids = [...new Set(members)].sort();
  const index = new Map(ids.map((id, i) => [id, i]));
  const n = ids.length;
  if (n === 0) return {};
  if (n === 1) return { [ids[0]]: 1 };

  // wins[i][j] = weighted wins of i over j; equal splits the weight.
  const wins: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const seenPairs = new Set<string>();
  for (const outcome of outcomes) {
    const i = index.get(outcome.aId);
    const j = index.get(outcome.bId);
    if (i == null || j == null || i === j) continue;
    const w = outcomeWeight(outcome);
    if (outcome.overall === "a") wins[i][j] += w;
    else if (outcome.overall === "b") wins[j][i] += w;
    else {
      wins[i][j] += w / 2;
      wins[j][i] += w / 2;
    }
    seenPairs.add(pairKey(outcome.aId, outcome.bId));
  }
  for (const key of seenPairs) {
    const [a, b] = key.split("\0");
    const i = index.get(a)!;
    const j = index.get(b)!;
    wins[i][j] += BT_PSEUDO_COUNT;
    wins[j][i] += BT_PSEUDO_COUNT;
  }

  let p = new Array(n).fill(1);
  for (let iteration = 0; iteration < BT_MAX_ITERATIONS; iteration += 1) {
    const next = new Array(n).fill(0);
    let maxDelta = 0;
    for (let i = 0; i < n; i += 1) {
      let totalWins = 0;
      let denominator = 0;
      for (let j = 0; j < n; j += 1) {
        if (i === j) continue;
        const comparisons = wins[i][j] + wins[j][i];
        if (comparisons === 0) continue;
        totalWins += wins[i][j];
        denominator += comparisons / (p[i] + p[j]);
      }
      next[i] = denominator > 0 ? totalWins / denominator : p[i];
    }
    // Normalize to geometric mean 1 for a stable, comparable scale.
    const logSum = next.reduce((sum, value) => sum + Math.log(Math.max(value, 1e-12)), 0);
    const scale = Math.exp(logSum / n);
    for (let i = 0; i < n; i += 1) {
      next[i] = Math.max(next[i] / scale, 1e-12);
      maxDelta = Math.max(maxDelta, Math.abs(next[i] - p[i]));
    }
    p = next;
    if (maxDelta < BT_CONVERGENCE) break;
  }

  const strengths: Record<string, number> = {};
  ids.forEach((id, i) => { strengths[id] = p[i]; });
  return strengths;
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, value));
}

// Maps BT log-strengths onto 0-100.
// - 2+ anchors: monotone piecewise-linear interpolation through the anchor
//   points (log-strength, frozenComputedScore); outside the anchor range the
//   nearest segment's slope continues; anchor scores are pooled monotone
//   first so the mapping can never invert the BT order.
// - 1 anchor: shift-only — the scale's slope is taken from the cohort's own
//   intrinsic score spread over its log-strength spread, and the anchor pins
//   the absolute level.
// - 0 anchors: same as 1 anchor with a virtual anchor at the cohort median
//   log-strength / median computedScore; the cohort is flagged unanchored.
export function mapStrengthsToScores(input: {
  members: string[];
  strengths: Record<string, number>;
  anchors: CalibrationAnchor[];
  computedScores: Record<string, number>;
}): { scores: Record<string, number>; unanchored: boolean } {
  const members = [...new Set(input.members)].sort();
  const logStrength = new Map(members.map((id) => [id, Math.log(Math.max(input.strengths[id] ?? 1, 1e-12))]));
  const anchors = input.anchors
    .filter((anchor) => logStrength.has(anchor.reviewId))
    .map((anchor) => ({
      x: logStrength.get(anchor.reviewId)!,
      y: clampScore(anchor.frozenComputedScore),
      reviewId: anchor.reviewId,
    }))
    .sort((a, b) => a.x - b.x || (a.reviewId < b.reviewId ? -1 : 1));

  const scores: Record<string, number> = {};
  if (anchors.length >= 2) {
    // Pool-adjacent-violators: anchor scores must be non-decreasing in
    // strength, otherwise interpolation would break BT order.
    const pooled = anchors.map((a) => ({ ...a }));
    for (let i = 1; i < pooled.length; i += 1) {
      if (pooled[i].y < pooled[i - 1].y) {
        const merged = (pooled[i].y + pooled[i - 1].y) / 2;
        pooled[i].y = merged;
        pooled[i - 1].y = merged;
        for (let back = i - 1; back > 0 && pooled[back].y < pooled[back - 1].y; back -= 1) {
          const value = (pooled[back].y + pooled[back - 1].y) / 2;
          pooled[back].y = value;
          pooled[back - 1].y = value;
        }
      }
    }
    const first = pooled[0];
    const last = pooled[pooled.length - 1];
    const segmentSlope = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      b.x - a.x > 1e-12 ? (b.y - a.y) / (b.x - a.x) : 0;
    for (const id of members) {
      const x = logStrength.get(id)!;
      let y: number;
      if (x <= first.x) {
        y = first.y + segmentSlope(first, pooled[1]) * (x - first.x);
      } else if (x >= last.x) {
        y = last.y + segmentSlope(pooled[pooled.length - 2], last) * (x - last.x);
      } else {
        let segment = 0;
        while (segment < pooled.length - 2 && pooled[segment + 1].x < x) segment += 1;
        const a = pooled[segment];
        const b = pooled[segment + 1];
        y = b.x - a.x > 1e-12 ? a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y) : (a.y + b.y) / 2;
      }
      scores[id] = clampScore(y);
    }
    return { scores, unanchored: false };
  }

  const xValues = members.map((id) => logStrength.get(id)!);
  const intrinsic = members.map((id) => input.computedScores[id] ?? 0);
  const xSpread = Math.max(...xValues) - Math.min(...xValues);
  const scoreSpread = Math.max(...intrinsic) - Math.min(...intrinsic);
  const slope = xSpread > 1e-12 ? scoreSpread / xSpread : 0;
  const anchor = anchors.length === 1
    ? anchors[0]
    : { x: median(xValues), y: clampScore(median(intrinsic)), reviewId: "" };
  for (const id of members) {
    scores[id] = clampScore(anchor.y + slope * (logStrength.get(id)! - anchor.x));
  }
  return { scores, unanchored: anchors.length === 0 };
}

// Calibrated scores must preserve BT ranking order (ties allowed). Clamping
// can flatten the extremes, which is an allowed tie; anything else is
// corrected by a monotone sweep.
export function enforceMonotonicity(
  members: string[],
  strengths: Record<string, number>,
  scores: Record<string, number>,
): Record<string, number> {
  const ordered = [...members].sort((a, b) =>
    (strengths[a] ?? 0) - (strengths[b] ?? 0) || (a < b ? -1 : 1));
  const result: Record<string, number> = { ...scores };
  let runningMax = -Infinity;
  for (const id of ordered) {
    runningMax = Math.max(runningMax, result[id] ?? 0);
    result[id] = runningMax;
  }
  return result;
}

function rate(wins: number, equals: number, total: number) {
  return total > 0 ? (wins + equals / 2) / total : null;
}

export function computeDimensionWinRates(
  members: string[],
  outcomes: CalibrationPairOutcome[],
): Record<string, DimensionWinRates> {
  const dimensions = ["inputStrength", "constructionStrength", "outputStrength", "overall"] as const;
  const counters = new Map(members.map((id) => [
    id,
    Object.fromEntries(dimensions.map((d) => [d, { wins: 0, equals: 0, total: 0 }])) as
      Record<(typeof dimensions)[number], { wins: number; equals: number; total: number }>,
  ]));
  for (const outcome of outcomes) {
    const a = counters.get(outcome.aId);
    const b = counters.get(outcome.bId);
    if (!a || !b) continue;
    for (const dimension of dimensions) {
      const verdict = outcome[dimension];
      a[dimension].total += 1;
      b[dimension].total += 1;
      if (verdict === "a") a[dimension].wins += 1;
      else if (verdict === "b") b[dimension].wins += 1;
      else {
        a[dimension].equals += 1;
        b[dimension].equals += 1;
      }
    }
  }
  const result: Record<string, DimensionWinRates> = {};
  for (const [id, counts] of counters) {
    result[id] = {
      inputStrength: rate(counts.inputStrength.wins, counts.inputStrength.equals, counts.inputStrength.total),
      constructionStrength: rate(counts.constructionStrength.wins, counts.constructionStrength.equals, counts.constructionStrength.total),
      outputStrength: rate(counts.outputStrength.wins, counts.outputStrength.equals, counts.outputStrength.total),
      overall: rate(counts.overall.wins, counts.overall.equals, counts.overall.total),
    };
  }
  return result;
}

export function fitCohort(input: CalibrationCohortInput): CohortFitResult {
  const members = [...new Set(input.members)].sort();
  const strengths = fitBradleyTerry(members, input.outcomes);
  const { scores, unanchored } = mapStrengthsToScores({
    members,
    strengths,
    anchors: input.anchors,
    computedScores: input.computedScores,
  });
  const monotone = enforceMonotonicity(members, strengths, scores);
  const comparisonCounts: Record<string, number> = Object.fromEntries(members.map((id) => [id, 0]));
  for (const outcome of input.outcomes) {
    if (outcome.aId in comparisonCounts) comparisonCounts[outcome.aId] += 1;
    if (outcome.bId in comparisonCounts) comparisonCounts[outcome.bId] += 1;
  }
  return {
    cohortId: input.cohortId,
    unanchored,
    ranking: [...members].sort((a, b) =>
      (strengths[b] ?? 0) - (strengths[a] ?? 0) || (a < b ? -1 : 1)),
    strengths,
    calibratedScores: monotone,
    dimensionWinRates: computeDimensionWinRates(members, input.outcomes),
    comparisonCounts,
    anchorOverrides: input.anchors
      .filter((anchor) => anchor.adminPinnedOverride === true && members.includes(anchor.reviewId))
      .map((anchor) => ({ reviewId: anchor.reviewId, reason: "admin-pinned" as const }))
      .sort((a, b) => (a.reviewId < b.reviewId ? -1 : 1)),
  };
}

// After per-cohort fits, unanchored cohorts are shifted so bridge papers'
// calibrated scores agree across cohorts in least squares. With a single
// uniform shift per cohort, the least-squares shift against currently
// fixed/other cohorts is the mean disagreement over its bridge papers.
// Anchored cohorts never shift. A few deterministic passes converge this.
export function reconcileBridges(fits: CohortFitResult[]): CohortFitResult[] {
  const ordered = [...fits].sort((a, b) => (a.cohortId < b.cohortId ? -1 : 1));
  const membership = new Map<string, string[]>();
  for (const fit of ordered) {
    for (const id of Object.keys(fit.calibratedScores)) {
      membership.set(id, [...(membership.get(id) ?? []), fit.cohortId]);
    }
  }
  const bridgeIds = [...membership.entries()].filter(([, cohorts]) => cohorts.length > 1).map(([id]) => id);
  if (bridgeIds.length === 0) return ordered;

  const scoresByCohort = new Map(ordered.map((fit) => [fit.cohortId, { ...fit.calibratedScores }]));
  for (let pass = 0; pass < BRIDGE_RECONCILE_PASSES; pass += 1) {
    for (const fit of ordered) {
      if (!fit.unanchored) continue;
      const own = scoresByCohort.get(fit.cohortId)!;
      const disagreements: number[] = [];
      for (const id of bridgeIds) {
        if (!(id in own)) continue;
        const others = (membership.get(id) ?? []).filter((cohortId) => cohortId !== fit.cohortId);
        for (const otherCohortId of others) {
          const other = scoresByCohort.get(otherCohortId);
          if (other && id in other) disagreements.push(other[id] - own[id]);
        }
      }
      if (disagreements.length === 0) continue;
      const shift = disagreements.reduce((sum, value) => sum + value, 0) / disagreements.length;
      for (const id of Object.keys(own)) own[id] = clampScore(own[id] + shift);
    }
  }

  return ordered.map((fit) => ({
    ...fit,
    calibratedScores: enforceMonotonicity(
      Object.keys(fit.calibratedScores),
      fit.strengths,
      scoresByCohort.get(fit.cohortId)!,
    ),
  }));
}

// Full calibration: per-cohort BT fits, bridge reconciliation, then one
// rounded calibratedScore per review (mean across cohorts for bridges).
export function calibrateCohorts(inputs: CalibrationCohortInput[]): {
  fits: CohortFitResult[];
  finalScores: Record<string, number>;
} {
  const fits = reconcileBridges(inputs
    .map(fitCohort)
    .sort((a, b) => (a.cohortId < b.cohortId ? -1 : 1)));
  const accumulator = new Map<string, number[]>();
  for (const fit of fits) {
    for (const [id, score] of Object.entries(fit.calibratedScores)) {
      accumulator.set(id, [...(accumulator.get(id) ?? []), score]);
    }
  }
  const finalScores: Record<string, number> = {};
  for (const [id, values] of accumulator) {
    finalScores[id] = Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  }
  return { fits, finalScores };
}
