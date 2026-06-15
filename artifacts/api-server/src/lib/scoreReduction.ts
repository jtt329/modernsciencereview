// Score-reduction reasons (score-reduction-v1) — pure core.
//
// A DISPLAY pass, not a scoring pass. For each existing review it reads the
// already-stored I/C/O subscore + rationale and emits one short plain-language
// sentence per dimension that is below the top (10), explaining why it is
// HELD at its score rather than at 10. It never re-judges, never changes a
// score/rung, and never touches the review prompt or its hash — so it does
// not re-open the benchmark. The reason already exists in the stored
// rationale; this makes it explicit.
//
// This module is pure (no db, no network): the ledger-reading, dimension
// selection, and response-parsing are offline-testable; the single model
// call and the durable-job wiring live in the route layer.

export const SCORE_REDUCTION_PASS_VERSION = "score-reduction-v1";

export type ScoreReductionDimensionKey = "input" | "construction" | "output";
export type ScoreReductionReasons = Partial<Record<ScoreReductionDimensionKey, string>>;
export type ScoreReductionDimension = {
  key: ScoreReductionDimensionKey;
  score: number;
  rationale: string;
};

const DIMENSIONS: ScoreReductionDimensionKey[] = ["input", "construction", "output"];

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// The stored I/C/O subscore for a dimension. The diagnostic aggregate holds
// `<dim>StrengthScore`, either at the ledger top level or under `aggregate`
// (and as a last resort on the review row) — same precedence the UI uses.
export function dimensionSubscore(
  ledger: Record<string, any> | null | undefined,
  review: Record<string, any> | null | undefined,
  dim: ScoreReductionDimensionKey,
): number | null {
  const key = `${dim}StrengthScore`;
  return num(ledger?.[key]) ?? num(ledger?.aggregate?.[key]) ?? num(review?.[key]);
}

// Compact rationale text already stored for a dimension: the diagnostic
// subscore rationale plus the dimension's element assessments. This is the
// ONLY material the explanation is allowed to draw on — no re-judging.
export function dimensionRationaleText(
  ledger: Record<string, any> | null | undefined,
  dim: ScoreReductionDimensionKey,
): string {
  const ico = ledger?.inputConstructionOutputAssessment ?? ledger?.inputConstructionOutputLedger ?? {};
  const subRat = ledger?.subscoreRationale ?? ledger?.aggregate?.subscoreRationale ?? {};
  const parts: unknown[] = [subRat?.[`${dim}StrengthScore`]];
  if (dim === "input") {
    parts.push(ico?.input?.assessment, ico?.input?.grounding, ico?.input?.fundamentality);
    for (const it of asArray(ico?.input?.primitiveInputs ?? ledger?.primitiveInputs)) {
      parts.push(it?.input, it?.assessment);
    }
  } else if (dim === "construction") {
    parts.push(ico?.construction?.assessment);
    for (const it of asArray(ico?.construction?.introducedConstructions ?? ledger?.introducedConstructions)) {
      parts.push(it?.construction, it?.assessment);
    }
  } else {
    parts.push(ico?.output?.whyOutputsMatter, ico?.output?.assessment);
    for (const it of asArray(ico?.output?.outputs ?? ledger?.outputs)) {
      parts.push(it?.output, it?.assessment);
    }
  }
  return parts
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    .join("\n")
    .slice(0, 6000);
}

// Dimensions scored BELOW 10 — those that need a "why not top" reason. A
// dimension already at 10 (or with no usable stored subscore) is skipped.
export function scoreReductionDimensions(
  ledger: Record<string, any> | null | undefined,
  review: Record<string, any> | null | undefined,
): ScoreReductionDimension[] {
  const dims: ScoreReductionDimension[] = [];
  for (const key of DIMENSIONS) {
    const score = dimensionSubscore(ledger, review, key);
    if (score == null || score >= 10) continue;
    dims.push({ key, score, rationale: dimensionRationaleText(ledger, key) });
  }
  return dims;
}

// Map a model JSON response onto only the dimensions we asked about, keeping
// just the non-empty reasons.
export function parseScoreReductionReasons(
  parsed: unknown,
  dims: ScoreReductionDimension[],
): ScoreReductionReasons {
  const reasons = asArray((parsed as any)?.reasons);
  const out: ScoreReductionReasons = {};
  for (const dim of dims) {
    const match = reasons.find((r) => r?.dimension === dim.key);
    const reason = typeof match?.reason === "string" ? match.reason.trim() : "";
    if (reason) out[dim.key] = reason;
  }
  return out;
}

// System prompt for the one-call-per-review explanation. Reads existing text
// only; rung-based ("held at N because …"), never subtractive.
export const SCORE_REDUCTION_SYSTEM_PROMPT = [
  "You explain, in ONE short sentence per scored dimension, WHY that dimension",
  "is held at its score rather than at the maximum (10), for a scientific-merit",
  "review that uses a rung-based (not subtractive) scale.",
  "",
  "Rules:",
  "- Use ONLY the provided storedRationale for each dimension. Do not introduce",
  "  new facts, numbers, or judgments, and do not re-score. You are surfacing the",
  "  reason that already exists in the review, not re-reviewing it.",
  "- Phrase as \"held at <score> because …\" and name the ceiling-limiting factor",
  "  (e.g. a controlled approximation, a conditional construction, an output not",
  "  yet experimentally confirmed). NEVER say \"points deducted\", \"docked\", or",
  "  \"minus N\" — scoring is rung-based, not subtractive.",
  "- One sentence, plain language, at most ~40 words, no markdown.",
  "- If the stored rationale names no specific ceiling-limiting factor, say so",
  "  briefly and honestly rather than inventing one.",
  "",
  "Return JSON: { \"reasons\": [ { \"dimension\": \"input|construction|output\",",
  "\"reason\": \"held at N because …\" } ] }.",
].join("\n");

export const scoreReductionJsonSchema = {
  type: "object",
  required: ["reasons"],
  additionalProperties: false,
  properties: {
    reasons: {
      type: "array",
      items: {
        type: "object",
        required: ["dimension", "reason"],
        additionalProperties: false,
        properties: {
          dimension: { type: "string", enum: ["input", "construction", "output"] },
          reason: { type: "string" },
        },
      },
    },
  },
} as const;
