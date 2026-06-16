// Score-reduction reasons + within-framework score (score-reduction-v2) — pure core.
//
// A DISPLAY/DERIVATION pass, not a scoring pass. For each existing review it
// reads the already-stored I/C/O subscore + rationale and:
//   (1) emits one short "held at N because …" sentence per dimension below 10
//       (the reason already exists in the rationale — extraction, not re-judging);
//   (2) TAGS each below-10 deduction { cause, frameworkDependent, frameworkName,
//       independentlyCapped } — again extraction from the stated cause;
//   (3) derives a second "within its framework" score: if you accept the
//       unproven framework the paper rests on, what would it score? Computed by
//       LIFTING only the framework-dependent dimensions and recomputing the
//       total — never a raw number from the model (anti-anchoring preserved).
//
// It never re-judges, never changes a stored score/rung, and never touches the
// review prompt or its hash — so it does not re-open the benchmark.
//
// Pure (no db, no network): ledger reading, dimension selection, response
// parsing, and the within-framework recompute are offline-testable; the single
// model call and durable-job wiring live in the route layer.

export const SCORE_REDUCTION_PASS_VERSION = "score-reduction-v2";

export type ScoreReductionDimensionKey = "input" | "construction" | "output";
export type ScoreReductionReasons = Partial<Record<ScoreReductionDimensionKey, string>>;
export type ScoreReductionDimension = {
  key: ScoreReductionDimensionKey;
  score: number;
  rationale: string;
};

// Per-dimension deduction tag, extracted from the stated cause.
export type ScoreReductionTag = {
  reason: string;            // "held at N because …"
  frameworkDependent: boolean; // docked (even partly) for resting on an unproven framework
  frameworkName: string;     // e.g. "string theory" / "loop quantum gravity" ("" if none)
  independentlyCapped: boolean; // a NON-framework cause also limits this dimension
};
export type ScoreReductionTags = Partial<Record<ScoreReductionDimensionKey, ScoreReductionTag>>;

export type WithinFrameworkLift = {
  dimension: ScoreReductionDimensionKey;
  frameworkName: string;
  from: number;
  to: number;
};
export type WithinFrameworkResult = {
  applicable: boolean;          // ≥1 framework-dependent deduction was lifted
  frameworkName: string;        // named framework(s), e.g. "string theory"
  inPhysicsScore: number | null;
  withinFrameworkScore: number | null;
  lifted: WithinFrameworkLift[];
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

// The stored rationale the tagging call draws on — and ONLY this. The
// diagnostic subscore rationale is the model's own stated cause for the
// dimension's score (e.g. "the referents are F4, constructs internal to
// untested frameworks → capped at 8.5"), which is exactly what we tag. We keep
// the payload lean (subscore rationale + dimension/score) so a thinking model
// can answer a small extraction task in seconds, not minutes — NOT the whole
// paper/element dump. Falls back to the dimension's single assessment line only
// when the subscore rationale is absent. No re-judging.
export function dimensionRationaleText(
  ledger: Record<string, any> | null | undefined,
  dim: ScoreReductionDimensionKey,
): string {
  const subRat = ledger?.subscoreRationale ?? ledger?.aggregate?.subscoreRationale ?? {};
  const primary = subRat?.[`${dim}StrengthScore`];
  if (typeof primary === "string" && primary.trim().length > 0) {
    return primary.trim().slice(0, 2000);
  }
  const ico = ledger?.inputConstructionOutputAssessment ?? ledger?.inputConstructionOutputLedger ?? {};
  const fallback = ico?.[dim]?.assessment;
  return typeof fallback === "string" ? fallback.trim().slice(0, 2000) : "";
}

// Dimensions scored BELOW 10 — those that need a "why not top" reason and are
// candidates for a framework lift. A dimension already at 10 (or with no usable
// stored subscore) is skipped.
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
// the reason + framework tags. Drops entries that carry neither a reason nor a
// framework tag.
export function parseScoreReductionTags(
  parsed: unknown,
  dims: ScoreReductionDimension[],
): ScoreReductionTags {
  const arr = asArray((parsed as any)?.reasons);
  const out: ScoreReductionTags = {};
  for (const dim of dims) {
    const match = arr.find((r) => r?.dimension === dim.key);
    if (!match) continue;
    const reason = typeof match.reason === "string" ? match.reason.trim() : "";
    const frameworkDependent = match.frameworkDependent === true;
    if (!reason && !frameworkDependent) continue;
    out[dim.key] = {
      reason,
      frameworkDependent,
      frameworkName: typeof match.frameworkName === "string" ? match.frameworkName.trim() : "",
      independentlyCapped: match.independentlyCapped === true,
    };
  }
  return out;
}

// Lenient JSON extraction for model responses: tolerates code fences, leading
// or trailing prose, and trailing commas. Returns null (not throw) when the
// text cannot be parsed, so the caller can retry that one item instead of
// failing the whole corpus.
export function tolerantJsonParse(text: string): any | null {
  if (typeof text !== "string") return null;
  const raw = text.trim();
  if (!raw) return null;
  const tryParse = (s: string): any | null => {
    try {
      const v = JSON.parse(s);
      return v != null && typeof v === "object" ? v : null;
    } catch {
      return null;
    }
  };
  const stripTrailingCommas = (s: string) => s.replace(/,(\s*[}\]])/g, "$1");
  const candidates: string[] = [raw];
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) candidates.push(fence[1].trim());
  const noFence = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  if (noFence !== raw) candidates.push(noFence);
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(raw.slice(first, last + 1));
  for (const candidate of candidates) {
    const parsed = tryParse(candidate) ?? tryParse(stripTrailingCommas(candidate));
    if (parsed != null) return parsed;
  }
  return null;
}

// Parse a model response into tags, tolerantly. Returns null ONLY when the JSON
// itself could not be parsed (caller should retry that item); a parsed-but-
// empty result returns {} (a legitimate "no framework deductions" outcome).
export function tagsFromResponseText(
  text: string,
  dims: ScoreReductionDimension[],
): ScoreReductionTags | null {
  const parsed = tolerantJsonParse(text);
  if (parsed == null) return null;
  return parseScoreReductionTags(parsed, dims);
}

// The display strings ("held at N because …"), for the per-dimension UI line.
export function reasonsFromTags(tags: ScoreReductionTags): ScoreReductionReasons {
  const out: ScoreReductionReasons = {};
  for (const key of DIMENSIONS) {
    const reason = tags[key]?.reason;
    if (reason) out[key] = reason;
  }
  return out;
}

function formulaTotal(subscores: Record<ScoreReductionDimensionKey, number | null>): number | null {
  const vals = DIMENSIONS.map((k) => subscores[k]).filter((v): v is number => typeof v === "number");
  if (vals.length === 0) return null;
  return Math.round(10 * (vals.reduce((a, b) => a + b, 0) / vals.length));
}

// The "within its framework" score: lift only the framework-dependent
// dimensions and recompute the total. A purely framework-dependent dimension
// lifts to firm (10); a dimension that is ALSO independently capped (conjecture
// / approximation / scope) keeps its current value, because that independent
// cause is the binding ceiling even within the framework. The overall number
// is the recompute delta applied to the stored "in physics" score — never a raw
// number from the model.
export function computeWithinFrameworkScore(args: {
  inPhysicsScore: number | null;
  subscores: Partial<Record<ScoreReductionDimensionKey, number | null>>;
  tags: ScoreReductionTags;
}): WithinFrameworkResult {
  const cur: Record<ScoreReductionDimensionKey, number | null> = {
    input: num(args.subscores.input),
    construction: num(args.subscores.construction),
    output: num(args.subscores.output),
  };
  const adj: Record<ScoreReductionDimensionKey, number | null> = { ...cur };
  const lifted: WithinFrameworkLift[] = [];
  for (const key of DIMENSIONS) {
    const tag = args.tags[key];
    const score = cur[key];
    if (!tag || !tag.frameworkDependent || score == null || score >= 10) continue;
    const to = tag.independentlyCapped ? score : 10;
    if (to > score) {
      adj[key] = to;
      lifted.push({ dimension: key, frameworkName: tag.frameworkName, from: score, to });
    }
  }
  const applicable = lifted.length > 0;
  const curTotal = formulaTotal(cur);
  const adjTotal = formulaTotal(adj);
  const delta = curTotal != null && adjTotal != null ? adjTotal - curTotal : 0;
  const within = args.inPhysicsScore != null
    ? Math.min(100, Math.max(args.inPhysicsScore, args.inPhysicsScore + delta))
    : adjTotal;
  const names = [...new Set(lifted.map((l) => l.frameworkName).filter((n) => n.length > 0))];
  return {
    applicable,
    frameworkName: names.join(" + "),
    inPhysicsScore: args.inPhysicsScore,
    withinFrameworkScore: applicable ? within : args.inPhysicsScore,
    lifted,
  };
}

// System prompt for the one-call-per-review pass. Reads existing text only;
// rung-based ("held at N because …"), never subtractive; and TAGS each
// deduction so the within-framework score can be derived by code.
export const SCORE_REDUCTION_SYSTEM_PROMPT = [
  "You annotate, for one scientific-merit review, WHY each scored dimension is",
  "held below the maximum (10), using a rung-based (not subtractive) scale. You",
  "are surfacing reasons that ALREADY EXIST in the provided rationale — not",
  "re-reviewing, not re-scoring, and never inventing facts or numbers.",
  "",
  "For each dimension you are given, return:",
  "- reason: ONE plain sentence, \"held at <score> because …\", naming the",
  "  ceiling-limiting factor. At most ~40 words, no markdown. NEVER say \"points",
  "  deducted\", \"docked\", or \"minus N\" — scoring is rung-based, not subtractive.",
  "- frameworkDependent: true ONLY if the dimension is held down (even partly)",
  "  because the work RESTS ON AN UNPROVEN/UNTESTED THEORETICAL FRAMEWORK whose",
  "  validity is not established — e.g. string theory, loop quantum gravity,",
  "  emergent/entropic gravity, asymptotic safety, causal set theory. It is",
  "  NOT framework-dependent if the cause is merely that a result is a",
  "  conjecture, a leading-order/semiclassical APPROXIMATION, limited in scope,",
  "  or an ordinary modeling assumption — those stand regardless of any",
  "  framework. When unsure, answer false.",
  "- frameworkName: the named framework (e.g. \"string theory\", \"loop quantum",
  "  gravity\") when frameworkDependent is true; otherwise \"\".",
  "- independentlyCapped: true if a NON-framework cause ALSO limits this",
  "  dimension (it is also a conjecture, also an approximation, also",
  "  scope-limited). This marks deductions that would NOT fully lift even if the",
  "  framework were accepted.",
  "",
  "Return JSON: { \"reasons\": [ { \"dimension\": \"input|construction|output\",",
  "\"reason\": \"…\", \"frameworkDependent\": bool, \"frameworkName\": \"…\",",
  "\"independentlyCapped\": bool } ] }.",
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
        required: ["dimension", "reason", "frameworkDependent"],
        additionalProperties: false,
        properties: {
          dimension: { type: "string", enum: ["input", "construction", "output"] },
          reason: { type: "string" },
          frameworkDependent: { type: "boolean" },
          frameworkName: { type: "string" },
          independentlyCapped: { type: "boolean" },
        },
      },
    },
  },
} as const;
