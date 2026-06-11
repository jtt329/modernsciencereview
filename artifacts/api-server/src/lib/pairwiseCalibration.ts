import { createHash } from "crypto";
import { ai as geminiAI } from "@workspace/integrations-gemini-ai";
import { PAIRWISE_CALIBRATION_V1_PROMPT } from "./prompts/pairwiseCalibrationV1";
import { GEMINI_CALIBRATION_MODEL, parseGeminiJsonResponse } from "./reviewEngineCompat";
import type { CalibrationPairOutcome, DimensionOutcome, PairwiseMargin } from "./calibrationFit";
import { logger } from "./logger";

// v2: pooled global anchor mapping. Pair judgments are version-independent
// (cache key is pair + promptHash), so v1 rows stay valid and recompute is
// free of model calls.
export const PAIRWISE_CALIBRATION_VERSION = "pairwise-bt-v2";
export const PAIRWISE_CALIBRATION_PROMPT_HASH = createHash("sha256")
  .update(PAIRWISE_CALIBRATION_V1_PROMPT)
  .digest("hex")
  .slice(0, 16);

const SMALL_COHORT_ALL_PAIRS_MAX = 8;
const NEAREST_NEIGHBOR_COUNT = 5;
const PAIR_CAP_PER_MEMBER = 6;
export const PAIRWISE_JUDGE_CONCURRENCY = 4;

export type PairwiseCalibrationMember = {
  reviewId: string;
  cohortId: string;
  // Free-text profile used only for nearest-neighbor pair planning.
  profileText: string;
  strippedReview: Record<string, unknown>;
  // Weaker-blinded or recognition-suspected reviews may serve as comparison
  // partners but their outcomes carry weight 0.5 and they never auto-anchor;
  // an explicit admin-pinned calibrationAnchor overrides that exclusion.
  downWeighted: boolean;
  computedScore: number;
  calibrationAnchor: boolean;
  // Admin pinned this anchor despite the automatic exclusions; recorded as
  // an anchorOverride ("admin-pinned") in the calibration run output.
  anchorOverride: boolean;
};

export type PlannedPair = {
  cohortId: string;
  // Canonical order: reviewIdA < reviewIdB.
  reviewIdA: string;
  reviewIdB: string;
  distance: number;
};

// Verdicts as presented to the model ("Paper A"/"Paper B"); canonical
// outcomes use lowercase "a"/"b" keyed to sorted review ids.
export type PresentationVerdict = "A" | "B" | "equal";

export type PairwiseJudgment = {
  inputStrength: PresentationVerdict;
  constructionStrength: PresentationVerdict;
  outputStrength: PresentationVerdict;
  overall: PresentationVerdict;
  margin: PairwiseMargin;
  rationale: string;
  confidence: number;
  // Which review id was shown as Paper A / Paper B in this call.
  paperAReviewId: string;
  paperBReviewId: string;
};

export type ReconciledPairOutcome = {
  reviewIdA: string;
  reviewIdB: string;
  overallWinnerReviewId: string | null;
  inputStrengthWinnerReviewId: string | null;
  constructionStrengthWinnerReviewId: string | null;
  outputStrengthWinnerReviewId: string | null;
  margin: PairwiseMargin;
  positionInconsistent: boolean;
  judgments: PairwiseJudgment[];
};

export function canonicalPairIds(idOne: string, idTwo: string): [string, string] {
  return idOne < idTwo ? [idOne, idTwo] : [idTwo, idOne];
}

// Explicit allow-list: numeric subscores, computed/calibrated scores,
// titles, magnitude labels, and recognition fields never reach the model.
export function strippedReviewForPairwise(ledger: Record<string, any>): Record<string, unknown> {
  return {
    paperType: ledger?.paperType ?? "",
    broadField: ledger?.broadField ?? "",
    specialtyField: ledger?.specialtyField ?? "",
    subfields: Array.isArray(ledger?.subfields) ? ledger.subfields : [],
    localCohort: ledger?.localCohort ?? "",
    contributionArchetype: ledger?.contributionArchetype ?? null,
    scopeProfile: ledger?.scopeProfile ?? null,
    centralClaim: ledger?.centralClaim ?? "",
    scientificReview: ledger?.scientificReview ?? "",
    subscoreRationale: ledger?.subscoreRationale ?? null,
    inputConstructionOutputAssessment: ledger?.inputConstructionOutputAssessment ?? null,
    technicalAssessment: ledger?.technicalAssessment ?? null,
    failureAnalysis: ledger?.failureAnalysis ?? null,
  };
}

function profileTokens(text: string) {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 2),
  );
}

function pairDistance(a: PairwiseCalibrationMember, b: PairwiseCalibrationMember) {
  const tokensA = profileTokens(a.profileText);
  const tokensB = profileTokens(b.profileText);
  if (tokensA.size === 0 || tokensB.size === 0) return 1;
  let intersection = 0;
  for (const token of tokensA) if (tokensB.has(token)) intersection += 1;
  const union = tokensA.size + tokensB.size - intersection;
  return union > 0 ? 1 - intersection / union : 1;
}

// Cohorts of n <= 8 compare every unordered pair (<= 28 pairs). Larger
// cohorts use each member's 5 nearest neighbors by profile distance, with
// the total capped at 6n by keeping the closest pairs.
export function planCohortPairs(cohortId: string, members: PairwiseCalibrationMember[]): PlannedPair[] {
  const sorted = [...members].sort((a, b) => (a.reviewId < b.reviewId ? -1 : 1));
  const pairs = new Map<string, PlannedPair>();
  const addPair = (a: PairwiseCalibrationMember, b: PairwiseCalibrationMember) => {
    const [reviewIdA, reviewIdB] = canonicalPairIds(a.reviewId, b.reviewId);
    const key = `${reviewIdA}\0${reviewIdB}`;
    if (!pairs.has(key)) {
      pairs.set(key, { cohortId, reviewIdA, reviewIdB, distance: pairDistance(a, b) });
    }
  };

  if (sorted.length <= SMALL_COHORT_ALL_PAIRS_MAX) {
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) addPair(sorted[i], sorted[j]);
    }
    return [...pairs.values()].sort((a, b) => (a.reviewIdA + a.reviewIdB < b.reviewIdA + b.reviewIdB ? -1 : 1));
  }

  for (const member of sorted) {
    const neighbors = sorted
      .filter((candidate) => candidate.reviewId !== member.reviewId)
      .map((candidate) => ({ candidate, distance: pairDistance(member, candidate) }))
      .sort((a, b) => a.distance - b.distance || (a.candidate.reviewId < b.candidate.reviewId ? -1 : 1))
      .slice(0, NEAREST_NEIGHBOR_COUNT);
    for (const { candidate } of neighbors) addPair(member, candidate);
  }
  return [...pairs.values()]
    .sort((a, b) => a.distance - b.distance || (a.reviewIdA + a.reviewIdB < b.reviewIdA + b.reviewIdB ? -1 : 1))
    .slice(0, PAIR_CAP_PER_MEMBER * sorted.length);
}

const pairwiseJudgmentJsonSchema = {
  type: "object",
  required: ["inputStrength", "constructionStrength", "outputStrength", "overall", "margin", "rationale", "confidence"],
  additionalProperties: false,
  properties: {
    inputStrength: { type: "string", enum: ["A", "B", "equal"] },
    constructionStrength: { type: "string", enum: ["A", "B", "equal"] },
    outputStrength: { type: "string", enum: ["A", "B", "equal"] },
    overall: { type: "string", enum: ["A", "B", "equal"] },
    margin: { type: "string", enum: ["slight", "clear", "decisive"] },
    rationale: { type: "string" },
    confidence: { type: "number" },
  },
};

function normalizeVerdict(value: unknown): "A" | "B" | "equal" {
  return value === "A" || value === "B" ? value : "equal";
}

function normalizeMargin(value: unknown): PairwiseMargin {
  return value === "clear" || value === "decisive" ? value : "slight";
}

async function judgeOnce(
  paperAReviewId: string,
  paperBReviewId: string,
  paperA: Record<string, unknown>,
  paperB: Record<string, unknown>,
): Promise<PairwiseJudgment> {
  const response = await (geminiAI.models.generateContent as any)({
    model: GEMINI_CALIBRATION_MODEL,
    contents: [{
      role: "user",
      parts: [{
        text: JSON.stringify({
          comparisonNote: "Compare the two blind reviews below as Paper A and Paper B under the system instruction. Output the JSON object only.",
          paperA,
          paperB,
        }, null, 2),
      }],
    }],
    config: {
      systemInstruction: PAIRWISE_CALIBRATION_V1_PROMPT,
      responseMimeType: "application/json",
      responseJsonSchema: pairwiseJudgmentJsonSchema,
      temperature: 0.1,
      maxOutputTokens: 4096,
    },
  });
  const parsed = parseGeminiJsonResponse(response.text ?? "") as Record<string, unknown>;
  return {
    inputStrength: normalizeVerdict(parsed.inputStrength),
    constructionStrength: normalizeVerdict(parsed.constructionStrength),
    outputStrength: normalizeVerdict(parsed.outputStrength),
    overall: normalizeVerdict(parsed.overall),
    margin: normalizeMargin(parsed.margin),
    rationale: typeof parsed.rationale === "string" ? parsed.rationale : "",
    confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0,
    paperAReviewId,
    paperBReviewId,
  };
}

function winnerReviewId(judgment: PairwiseJudgment, verdict: PresentationVerdict): string | null {
  if (verdict === "A") return judgment.paperAReviewId;
  if (verdict === "B") return judgment.paperBReviewId;
  return null;
}

const MARGIN_ORDER: PairwiseMargin[] = ["slight", "clear", "decisive"];

function weakerMargin(a: PairwiseMargin, b: PairwiseMargin): PairwiseMargin {
  return MARGIN_ORDER[Math.min(MARGIN_ORDER.indexOf(a), MARGIN_ORDER.indexOf(b))];
}

// Position-bias control: each pair is judged twice with A/B swapped. Two
// judgments that agree keep their (weaker) margin; disagreement on
// "overall" records the pair as equal with positionInconsistent=true.
// Per-dimension disagreements also fall back to equal.
export function reconcileSwappedJudgments(
  first: PairwiseJudgment,
  second: PairwiseJudgment,
): ReconciledPairOutcome {
  const [reviewIdA, reviewIdB] = canonicalPairIds(first.paperAReviewId, first.paperBReviewId);
  const dimensionWinner = (dimension: "inputStrength" | "constructionStrength" | "outputStrength" | "overall") => {
    const firstWinner = winnerReviewId(first, first[dimension]);
    const secondWinner = winnerReviewId(second, second[dimension]);
    return firstWinner === secondWinner ? firstWinner : null;
  };
  const firstOverall = winnerReviewId(first, first.overall);
  const secondOverall = winnerReviewId(second, second.overall);
  const overallAgrees = firstOverall === secondOverall;
  return {
    reviewIdA,
    reviewIdB,
    overallWinnerReviewId: overallAgrees ? firstOverall : null,
    inputStrengthWinnerReviewId: dimensionWinner("inputStrength"),
    constructionStrengthWinnerReviewId: dimensionWinner("constructionStrength"),
    outputStrengthWinnerReviewId: dimensionWinner("outputStrength"),
    margin: overallAgrees ? weakerMargin(first.margin, second.margin) : "slight",
    positionInconsistent: !overallAgrees,
    judgments: [first, second],
  };
}

export async function judgePair(
  pair: PlannedPair,
  membersById: Map<string, PairwiseCalibrationMember>,
): Promise<ReconciledPairOutcome> {
  const memberA = membersById.get(pair.reviewIdA);
  const memberB = membersById.get(pair.reviewIdB);
  if (!memberA || !memberB) {
    throw new Error(`pairwise calibration pair references unknown review ids ${pair.reviewIdA}/${pair.reviewIdB}`);
  }
  // Randomized initial assignment (stored with the judgment); the second
  // call always swaps it.
  const firstAFirst = Math.random() < 0.5;
  const [firstA, firstB] = firstAFirst ? [memberA, memberB] : [memberB, memberA];
  const first = await judgeOnce(firstA.reviewId, firstB.reviewId, firstA.strippedReview, firstB.strippedReview);
  const second = await judgeOnce(firstB.reviewId, firstA.reviewId, firstB.strippedReview, firstA.strippedReview);
  return reconcileSwappedJudgments(first, second);
}

export function outcomeFromStoredPair(stored: {
  reviewIdA: string;
  reviewIdB: string;
  overallWinnerReviewId: string | null;
  inputStrengthWinnerReviewId: string | null;
  constructionStrengthWinnerReviewId: string | null;
  outputStrengthWinnerReviewId: string | null;
  margin: string | null;
  positionInconsistent: boolean;
}, weightFactor: number): CalibrationPairOutcome {
  const verdict = (winner: string | null): DimensionOutcome =>
    winner === stored.reviewIdA ? "a" : winner === stored.reviewIdB ? "b" : "equal";
  return {
    aId: stored.reviewIdA,
    bId: stored.reviewIdB,
    overall: verdict(stored.overallWinnerReviewId),
    margin: stored.margin === "clear" || stored.margin === "decisive" ? stored.margin : "slight",
    inputStrength: verdict(stored.inputStrengthWinnerReviewId),
    constructionStrength: verdict(stored.constructionStrengthWinnerReviewId),
    outputStrength: verdict(stored.outputStrengthWinnerReviewId),
    positionInconsistent: stored.positionInconsistent,
    weightFactor,
  };
}

export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<{ item: T; result?: R; error?: unknown }[]> {
  const results: { item: T; result?: R; error?: unknown }[] = new Array(items.length);
  let nextIndex = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      const item = items[index];
      try {
        results[index] = { item, result: await worker(item) };
      } catch (error) {
        logger.warn({ err: error }, "Pairwise calibration pair judgment failed");
        results[index] = { item, error };
      }
    }
  });
  await Promise.all(lanes);
  return results;
}
