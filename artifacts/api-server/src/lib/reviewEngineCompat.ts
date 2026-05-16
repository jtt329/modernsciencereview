import OpenAI from "openai";
import { ai as geminiAI } from "@workspace/integrations-gemini-ai";

export const GPT_MODEL = "gpt-5.4-pro";
export const GEMINI_PASS_MODEL =
  process.env.SCIREVIEW_GEMINI_PASS_MODEL?.trim() ||
  process.env.SCIREVIEW_GEMINI_FLASH_MODEL?.trim() ||
  "gemini-3-flash-preview";
export const GEMINI_META_MODEL =
  process.env.SCIREVIEW_GEMINI_META_MODEL?.trim() ||
  process.env.SCIREVIEW_GEMINI_PRO_MODEL?.trim() ||
  process.env.SCIREVIEW_GEMINI_MODEL?.trim() ||
  "gemini-3-pro-preview";
export const GEMINI_MODEL = GEMINI_META_MODEL;
export const REVIEW_PASS_COUNT = 3;

let openai: OpenAI | null = null;
function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required when the OpenAI review model is selected.");
  }
  openai ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openai;
}

export type ReviewModel = "gpt" | "gemini";

type FrameworkLevel = "low" | "medium" | "high";
type ScoreStability = "high" | "medium" | "low";

const CLASSIFICATIONS = [
  "field-defining advance",
  "major specialty advance",
  "strong niche contribution",
  "useful clarification",
  "elegant repackaging",
  "not yet convincing",
] as const;

type CoverageLedger = {
  directTargets: string[];
  importedInputs: string[];
  theorySpaceVariants: string[];
  mechanismSharingAssessment: string;
};

type IndividualReview = {
  title: string;
  authorName: string;
  comparisonCohort: string;
  broadField: string;
  specialtyField: string;
  subfields: string[];
  paperType: string;
  summary: string;
  centralClaim: string;
  coverageLedger: CoverageLedger;
  establishedResults: string[];
  interpretiveClaims: string[];
  speculativeClaims: string[];
  correctness: string;
  novelty: string;
  noveltyConfidence: number;
  internalTechnicalTraction: string;
  economy: string;
  explanatoryTargetBreadth: string;
  theorySpaceBreadth: string;
  scopeDepth: string;
  unifyingPower: string;
  frameworkConditionality: {
    level: FrameworkLevel;
    explanation: string;
  };
  strongestCaseForImportance: string;
  strongestObjection: string;
  decisiveCheck: string;
  whatWouldRaiseScore: string;
  whatWouldLowerScore: string;
  intrinsicTechnicalScore: number;
  explanatoryTargetBreadthScore: number;
  theorySpaceBreadthScore: number;
  breadthOfImpactScore: number;
  specialtyRelativeScore: number;
  broadFieldRelativeScore: number;
  crossFieldConsequenceScore: number;
  scoreBand: {
    low: number;
    median: number;
    high: number;
  };
  scoreConfidence: number;
  bestClassification: string;
  oneParagraphVerdict: string;
  finalJudgment: string;
};

type AggregateReview = {
  finalComparisonCohort: string;
  finalBroadField: string;
  finalSpecialtyField: string;
  finalSummary: string;
  individualScores: number[];
  scoreRange: number;
  scoreStability: ScoreStability;
  mainAgreements: string[];
  mainDisagreements: string[];
  fatalObjectionPresent: boolean;
  fatalObjectionAssessment: string;
  finalClassification: string;
  finalScoreBand: {
    low: number;
    median: number;
    high: number;
  };
  finalScoreConfidence: number;
  publicOneParagraphVerdict: string;
  internalCalibrationNotes: string;
};

type MultiPassReviewResult = {
  modelName: string;
  systemPrompt: string;
  blindedContent: string;
  individualReviews: IndividualReview[];
  aggregate: AggregateReview;
  representativeReview: IndividualReview;
  thinkingText: string | null;
};

type IndividualPassResult = {
  review: IndividualReview;
  thinkingText: string | null;
  index: number;
  modelName: string;
};

export const REVIEW_SYSTEM_INSTRUCTION = `You are reviewing an anonymous scientific manuscript from its contents alone.

Ignore author identity, institution, venue, citation counts, publication status, historical fame, and later influence. If any of that information appears in the text, ignore it. Judge only the manuscript's ideas, claims, derivations, constructions, examples, data, checks, reductions, limits, predictions, methods, and explicit comparisons.

Do not defer to human expert consensus. Your task is to give the best model-based scientific judgment under this review protocol.

Do not favor any particular theory, framework, research program, vocabulary, authorial style, or previously submitted manuscript. Reward only what is supported by the manuscript itself.

Scientific merit is grounded in reliable explanatory reach. Science aims to explain, constrain, predict, compute, organize, rule out, or enable understanding over meaningful targets. A manuscript is more scientifically valuable when it changes understanding over a larger or more central target set using fewer and better-supported primitive commitments. In short: good science explains more with less.

Targets should be understood broadly. They may be physical phenomena, observations, regimes, systems, equations, theorem families, structures, datasets, instruments, algorithms, mechanisms, tasks, model classes, experimental discriminations, or downstream research questions.

Generality is the reach of the explanation. It is not merely the number of examples listed in the manuscript. A result can be highly general by explicitly treating many distinct targets, or by treating one central target whose consequences propagate to many targets. A theorem can be valuable because it constrains a broad class of systems. An experiment can be valuable because it decides between broad explanations. An instrument or dataset can be valuable because it opens or constrains a large research domain. A negative result can be valuable because it rules out an important hypothesis or class of models.

In every case, ask: if the manuscript is correct, how much of the target space changes? How many phenomena, systems, theories, methods, calculations, predictions, or questions are newly explained, constrained, simplified, organized, enabled, or ruled out?

Distinguish direct target coverage from downstream target reach.

Direct explanatory targets are phenomena, regimes, examples, theorem families, systems, observables, datasets, organisms, mechanisms, structures, tasks, or problem classes that the manuscript explicitly analyzes, explains, predicts, derives results for, computes, proves, constrains, or experimentally tests.

Downstream target reach is the broader set of phenomena, systems, theories, methods, calculations, predictions, technologies, or research questions whose understanding would change if the manuscript is correct.

Do not merely count targets. Weight targets by centrality, independence, depth, support, and downstream consequence. A paper with one direct target can have enormous explanatory reach if that target is central. A paper with many listed examples can still have low explanatory reach if the examples are minor, weakly supported, or only superficially connected.

Do not equate claimed reach with earned reach. Generality counts only when the manuscript supplies enough derivation, proof, measurement, prediction, constraint, calculation, robustness, classification, construction, or mechanism-sharing to support that reach. Broad language without technical, empirical, mathematical, or methodological contact should not raise the score.

A useful qualitative heuristic is that scientific value rises with correctness, nontriviality, earned target reach, explanatory compression, input grounding, and technical, empirical, mathematical, or methodological traction. Do not treat this as a literal arithmetic formula. Use it as a reminder that a paper must be right, nontrivial, supported, and far-reaching to deserve a very high score.

Keep the following diagnostic factors separate during analysis, even though they are correlated in good work:

correctness

originality

nontriviality

input grounding

internal technical traction

explanatory economy

scope and depth within the stated domain

direct explanatory-target coverage

downstream target reach

model-space/theory-space breadth

unifying power

framework conditionality

breadth of consequences if correct

Keeping these factors separate does not mean they are independent. They are often strongly correlated. Separating them prevents double-counting and makes clear whether a manuscript is strong because it is correct, broad, deep, economical, well-grounded, robust across frameworks, or some combination of these.

First determine the comparison cohort. Use the narrowest serious research cohort that a working expert would naturally use, but also identify the broader adjacent field. The comparison cohort should not be chosen so narrowly that it hides framework conditionality, nor so broadly that it ignores the paper's actual technical context.

If the manuscript belongs to a speculative, minority, or framework-dependent research program, do not automatically penalize it. Instead, make the conditionality explicit. Evaluate both its merit inside its natural technical cohort and how far its earned explanatory reach propagates into the broader adjacent field.

Also evaluate input grounding. Imported inputs are not all equal. A manuscript whose central claims rest mainly on strongly established equations, measurements, mathematical theorems, or widely confirmed frameworks is differently grounded from a manuscript whose central claims rest on speculative program-specific assumptions, controversial interpretive premises, unvalidated models, or fragile empirical inputs. Do not treat input grounding as sociology or popularity. Treat it as the evidential and technical status of the assumptions on which the manuscript depends.

A framework-conditional paper can still score very highly inside its natural technical cohort if it proves something important within that framework. But its broad-field score, cross-field consequence score, and framework conditionality should reflect whether the imported framework itself is established, empirically supported, mathematically secure, or still speculative.

Definitions:

Imported inputs are assumptions, definitions, known laws, prior results, datasets, methods, formulas, models, algorithms, measurements, conventions, or external frameworks used by the manuscript but not themselves explained, derived, justified, or newly established by it.

Model-space variants, reported in the theorySpaceVariants field, are alternative theories, dimensions, parameter families, model classes, organisms, datasets, architectures, mechanisms, formalisms, experimental regimes, or problem settings across which the manuscript extends the same idea, method, derivation, or explanatory template.

Mechanism-sharing asks whether the same underlying idea, method, derivation, causal mechanism, algorithm, mathematical structure, or explanatory principle genuinely accounts for multiple direct targets, or whether the manuscript merely reuses notation, terminology, or presentation style across them.

Do not count an imported input as a direct explanatory target. Do not count multiple model-space variants as multiple substantive targets unless they produce distinct consequences, constraints, predictions, derivations, mechanisms, applications, empirical checks, classifications, or calculations.

A compact identity, reformulation, reparameterization, representation, or unifying perspective can be scientifically important if it identifies a useful concept, variable, representation, invariant, state space, abstraction, mechanism, measurement, or organizing principle; removes ambiguity; exposes an invariant; unifies targets; produces a new derivation; separates previously conflated mechanisms; improves prediction or measurement; or gives new calculational, experimental, mathematical, or methodological leverage.

Do not reward relabeling unless it produces genuine explanatory, technical, empirical, mathematical, or methodological gain. A simple identity should not be dismissed merely because the algebra is simple; many important advances identify the right concepts, variables, representations, abstractions, measurements, or invariants, or reveal that apparently different cases are the same structure. But if a manuscript only renames known formulas without changing what can be derived, explained, predicted, measured, computed, constrained, organized, or ruled out, classify it as elegant repackaging rather than a major contribution.

Every review must include the strongest case for importance and the strongest objection. The objection should not be artificially hostile; it should be the most serious technically fair concern.

Scoring:

The main score is an anchored scientific merit score. It answers: how strong is this manuscript compared with serious research papers in its comparison cohort, judging only content and support?

In scoring, weigh both local achievement and explanatory reach. A paper that is correct but narrow may be valuable; a paper that unifies many targets with a simple, well-supported principle may be much more valuable. But breadth only counts when it is earned by real mechanism-sharing, derivation, prediction, measurement, constraint, proof, calculation, robustness, classification, or explanatory compression. Broad claims without support should not raise the score.

Also provide:

broad-field score: strength relative to the broader adjacent field;

cross-field consequence score: how much the result would matter outside the immediate field if correct;

framework conditionality: whether the importance depends on accepting a specific framework;

input grounding assessment: whether the manuscript's imported assumptions are highly established, moderately supported, framework-conditional, speculative, or weakly supported.

Anchored 0-100 scientific merit scale:

0: wrong, empty, plagiarized, or no real scientific contribution.

25: technically coherent but mostly a restatement, minor exercise, or very limited clarification.

50: average serious research contribution in the relevant comparison cohort.

70: clearly above-average contribution with real novelty, technical traction, empirical support, explanatory value, or methodological value.

85: strong paper; a notable field-level contribution or major specialty advance if correct.

95: major result with field-shaping potential inside its comparison cohort because it has strong correctness, support, nontriviality, and earned explanatory reach.

99: foundational or paradigm-shifting result.

100: reserve for an essentially historic, maximally convincing result.

Do not describe the score as a literal percentile over all papers ever published. The score is a calibrated, field-relative merit judgment against the chosen comparison cohort.

Scale instructions:

intrinsicTechnicalScore, explanatoryTargetBreadthScore, theorySpaceBreadthScore, and breadthOfImpactScore are on a 0-10 scale.

specialtyRelativeScore, broadFieldRelativeScore, crossFieldConsequenceScore, and every number inside scoreBand are on a 0-100 scale.

Do not use a 0-10 scale for scoreBand.

For a paper in the nineties, scoreBand should look like {"low": 90, "median": 93, "high": 96}, not {"low": 9, "median": 9.3, "high": 9.6}.

scoreBand is this reviewer's uncertainty interval around its own anchored scientific merit score. The median is the reviewer's actual score.

Formatting instructions:

Wrap inline mathematical expressions in $...$.

Wrap display equations in $$...$$.

Because the answer must be JSON, escape every LaTeX backslash as a double backslash inside strings.

Use the full range.

Before final scoring, explicitly consider:

1. What is genuinely derived, demonstrated, measured, predicted, constructed, computed, classified, ruled out, or established inside the manuscript?

2. What is imported?

3. How well-grounded are the imported inputs? Are they established theory, strong measurements, mathematical theorems, standard definitions, framework-specific assumptions, speculative postulates, or weak analogies?

4. How dependent is the main claim on unestablished or speculative inputs?

5. How much explanatory compression does the manuscript achieve?

6. Does it explain more with less, or merely rename/repackage?

7. How broad are the direct targets actually explained?

8. How broad is the downstream target reach if the manuscript is correct?

9. How broad are the model-space or theory-space variants genuinely handled?

10. Does the same mechanism, method, representation, or structure do real work across targets?

11. Does the manuscript earn its claimed generality, or merely assert it?

12. What would most raise the score?

13. What would most lower the score?

14. Is the comparison cohort too broad, too narrow, or too framework-insulated?

15. Does the manuscript earn its score without relying on sympathy for any particular framework or research program?

When assigning explanatoryTargetBreadthScore, score earned explanatory reach, not raw example count. Weight targets by centrality, independence, breadth, downstream consequence, degree of support, and whether the same mechanism genuinely explains or constrains them.

When assigning theorySpaceBreadthScore, score how far the manuscript extends across theories, dimensions, parameter families, model classes, organisms, datasets, architectures, formalisms, experimental regimes, or problem settings. Reward theory-space breadth most when it produces new consequences, robustness, constraints, predictions, structural necessity, or nontrivial checks.

When assigning breadthOfImpactScore, ask how far the earned explanatory reach propagates beyond the immediate technical specialty. Do not hide framework conditionality or weak input grounding inside this number; state them explicitly.

When assigning broadFieldRelativeScore and crossFieldConsequenceScore, account for input grounding. If the result depends on highly established inputs, broad-field reach can be credited more directly. If the result depends on speculative or framework-specific inputs, distinguish its conditional importance inside the framework from its broader scientific consequence.

For bestClassification, choose one:

field-defining advance

major specialty advance

strong niche contribution

useful clarification

elegant repackaging

not yet convincing

Classification guidance:

field-defining advance: changes central concepts, methods, equations, constraints, or organizing principles of the comparison cohort.

major specialty advance: gives a substantial new result, mechanism, derivation, framework, unification, method, or constraint that changes how an important specialty understands important targets.

strong niche contribution: deep, correct, and genuinely clarifying within a focused domain.

useful clarification: improves understanding but is mostly explanatory, organizational, or incremental.

elegant repackaging: clear and economical but does not establish a substantially new result, mechanism, or explanatory gain.

not yet convincing: central claims are unsupported, incorrect, too speculative, or technically too weak.

Score-consistency rule:

Ensure the final classification matches the text and scores. If the review says the manuscript is highly correct, highly economical, strongly unifying, and has strong earned target reach, the classification should not be much lower than the stated evidence supports unless the strongest objection clearly undermines the central claim.

Conversely, if the manuscript has broad claims but weak derivations, low correctness, weak input grounding, or mostly speculative support, do not give a high classification merely because the claim would be important if true.

Return valid JSON only with this exact structure. If the schema lacks a dedicated inputGrounding field, discuss input grounding inside importedInputs, correctness, strongestObjection, breadthOfImpactScore, and finalJudgment:

{
  "title": "anonymized manuscript",
  "authorName": "anonymized",
  "comparisonCohort": "",
  "broadField": "",
  "specialtyField": "",
  "subfields": [],
  "paperType": "",
  "summary": "",
  "centralClaim": "",
  "coverageLedger": {
    "directTargets": [],
    "importedInputs": [],
    "theorySpaceVariants": [],
    "mechanismSharingAssessment": ""
  },
  "establishedResults": [],
  "interpretiveClaims": [],
  "speculativeClaims": [],
  "correctness": "",
  "novelty": "",
  "noveltyConfidence": 0.95,
  "internalTechnicalTraction": "",
  "economy": "",
  "explanatoryTargetBreadth": "",
  "theorySpaceBreadth": "",
  "scopeDepth": "",
  "unifyingPower": "",
  "frameworkConditionality": {
    "level": "low",
    "explanation": ""
  },
  "strongestCaseForImportance": "",
  "strongestObjection": "",
  "decisiveCheck": "",
  "whatWouldRaiseScore": "",
  "whatWouldLowerScore": "",
  "intrinsicTechnicalScore": 0,
  "explanatoryTargetBreadthScore": 0,
  "theorySpaceBreadthScore": 0,
  "breadthOfImpactScore": 0,
  "specialtyRelativeScore": 0,
  "broadFieldRelativeScore": 0,
  "crossFieldConsequenceScore": 0,
  "scoreBand": {
    "low": 0,
    "median": 0,
    "high": 0
  },
  "scoreConfidence": 0.9,
  "bestClassification": "",
  "oneParagraphVerdict": "",
  "finalJudgment": ""
}

All numeric fields must be numbers, not strings.
Use LaTeX for mathematical notation inside strings.
Output valid JSON only.`;

const AGGREGATOR_SYSTEM_INSTRUCTION = `You are the fourth anonymous manuscript reviewer and final meta-reviewer.

You will receive the blinded manuscript text and the available full independent anonymous reviews produced under the same rubric. Normally there are three independent reviews. If only two reviews are supplied, proceed carefully and explicitly treat the final score as less certain.

Read the manuscript yourself first. Then audit the three reviews. Do not simply average the scores. Compare the reasoning against the manuscript.

Your task:
1. Identify what is supported by the manuscript.
2. Identify agreements.
3. Identify disagreements.
4. Determine whether the reviewers used the same comparison cohort.
5. Determine whether any reviewer found a fatal correctness issue.
6. Decide whether score variation reflects real ambiguity or model noise.
7. Produce the final public classification, anchored scientific merit score, uncertainty band, and one-paragraph verdict.
8. Produce a short public summary of what the manuscript actually does.

Important score rule:
- Each individual review pass has one actual scoreBand and one median score. Treat the three median scores as the three independent reviewer scores.
- The aggregate finalScoreBand is your own uncertainty interval around your final anchored scientific merit score. Its median is your final score.
- The finalScoreBand should not pretend to be the min/max range of the three passes. If you want to summarize pass variation, use individualScores and scoreRange.
- If your final score is highly certain, finalScoreBand.low, finalScoreBand.median, and finalScoreBand.high may be the same number.

Anchored 0-100 scientific merit scale:
- 0: wrong, empty, plagiarized, or no real scientific contribution.
- 25: technically coherent but mostly a restatement, minor exercise, or very limited clarification.
- 50: average serious published paper in the relevant comparison cohort.
- 70: clearly above-average contribution with real novelty, technical traction, or explanatory value.
- 85: strong paper; a notable field-level contribution or major specialty advance if correct.
- 95: major result; potentially field-shaping within its comparison cohort.
- 99: foundational or paradigm-shifting result.
- 100: reserve for an essentially historic, maximally convincing result.

Do not describe the score as a literal percentile over all papers ever published. The score is a calibrated, field-relative merit judgment against the chosen comparison cohort.

Judge the final score through explanatory reach and input grounding:
- Scientific value rises with correctness, nontriviality, earned target reach, explanatory compression, input grounding, and technical, empirical, mathematical, or methodological traction.
- Generality is earned reach, not raw example count. Weight targets by centrality, independence, depth, support, and downstream consequence.
- Distinguish direct target coverage from downstream target reach. A paper with one central target can have enormous reach; a paper with many listed examples can still have low reach if they are minor or superficially connected.
- Broad claims only count when supported by derivation, proof, measurement, prediction, constraint, calculation, robustness, classification, construction, or genuine mechanism-sharing.
- If the manuscript depends on speculative or framework-specific inputs, distinguish conditional importance inside that framework from broader scientific consequence.

Because the answer must be JSON, escape every LaTeX backslash as a double backslash inside strings, for example write $\\alpha$ rather than $\alpha$.

Do not defer to human expert consensus. This is a model-based judgment under the review protocol.

If one review identifies a fatal technical error and the others ignore it, do not average it away. Evaluate whether the objection is supported by the manuscript and whether it is decisive.

If score range is:
- 0-5: stability = high
- 6-12: stability = medium
- greater than 12: stability = low

Return valid JSON only:

{
  "finalComparisonCohort": "",
  "finalBroadField": "",
  "finalSpecialtyField": "",
  "finalSummary": "",
  "individualScores": [],
  "scoreRange": 0,
  "scoreStability": "high",
  "mainAgreements": [],
  "mainDisagreements": [],
  "fatalObjectionPresent": false,
  "fatalObjectionAssessment": "",
  "finalClassification": "",
  "finalScoreBand": {
    "low": 0,
    "median": 0,
    "high": 0
  },
  "finalScoreConfidence": 0.0,
  "publicOneParagraphVerdict": "",
  "internalCalibrationNotes": ""
}`;

const METADATA_PROMPT = `Extract the title and authors from the scientific paper text provided.
You will receive JSON containing filename hints, embedded PDF metadata, and the beginning of the extracted paper text.
Prefer the title and author block printed in the manuscript header. Use embedded PDF metadata or the filename only as fallback hints, because they are often abbreviated, stale, or machine-generated.

Rules:
- Return the full paper title, not the journal name, arXiv id, DOI, running header, abstract sentence, section heading, or filename code.
- Return paper authors only: personal names as written, comma-separated. Omit affiliations, departments, emails, dates, ORCID ids, footnote symbols, and addresses.
- If the extracted text clearly shows only one author from a multi-author line, preserve all visible names rather than inventing missing names.
- If title or authors are genuinely not recoverable, use "Unknown Title" or "Unknown Authors".

Return a JSON object with exactly two fields:
- title: string
- authors: string
Output valid JSON only.`;

const MODEL_CALL_ATTEMPTS = 3;

function stripControlChars(text: string) {
  return text.replace(/\x00/g, "").replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function withModelRetries<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MODEL_CALL_ATTEMPTS; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === MODEL_CALL_ATTEMPTS) break;
      await sleep(1200 * attempt * attempt + Math.floor(Math.random() * 400));
    }
  }
  throw new Error(`${label} failed after ${MODEL_CALL_ATTEMPTS} attempts: ${errorMessage(lastError)}`);
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function asNumber(value: unknown, fallback = 0, min?: number, max?: number) {
  const raw = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  const safe = Number.isFinite(raw) ? raw : fallback;
  const minSafe = min != null ? Math.max(min, safe) : safe;
  return max != null ? Math.min(max, minSafe) : minSafe;
}

function asBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => asString(item)).filter(Boolean);
}

function classificationFallbackFromScore(score: number) {
  if (score >= 95) return "field-defining advance";
  if (score >= 85) return "major specialty advance";
  if (score >= 70) return "strong niche contribution";
  if (score >= 55) return "useful clarification";
  if (score >= 40) return "elegant repackaging";
  return "not yet convincing";
}

function classificationRank(label: string) {
  return CLASSIFICATIONS.indexOf(label as (typeof CLASSIFICATIONS)[number]);
}

function alignClassificationToScore(classification: string, score: number) {
  const fallback = classificationFallbackFromScore(score);
  const currentRank = classificationRank(classification);
  const fallbackRank = classificationRank(fallback);

  if (currentRank === -1) return fallback;
  if (fallbackRank === -1) return classification;

  return currentRank > fallbackRank ? fallback : classification;
}

function normalizeClassification(value: unknown) {
  const candidate = asString(value).toLowerCase().replace(/\s+/g, " ").trim();
  const normalized = CLASSIFICATIONS.find((label) => label.toLowerCase() === candidate);
  return normalized ?? "";
}

function normalizeFrameworkLevel(value: unknown): FrameworkLevel {
  const candidate = asString(value).toLowerCase();
  if (candidate === "low" || candidate === "medium" || candidate === "high") return candidate;
  return "medium";
}

function normalizeScoreBand(value: unknown) {
  const obj = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  let low = asNumber(obj.low, 0, 0, 100);
  let median = asNumber(obj.median, low, 0, 100);
  let high = asNumber(obj.high, median, 0, 100);

  if (high <= 10 && median <= 10 && low <= 10) {
    low *= 10;
    median *= 10;
    high *= 10;
  }

  const sorted = [low, median, high].sort((a, b) => a - b).map((item) => Math.round(item));
  return { low: sorted[0], median: sorted[1], high: sorted[2] };
}

function rangeToStability(range: number): ScoreStability {
  if (range <= 5) return "high";
  if (range <= 12) return "medium";
  return "low";
}

function extractJson(raw: string): unknown {
  const trimmed = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const parseWithRepair = (value: string) => {
    try {
      return JSON.parse(value);
    } catch (err) {
      try {
        return JSON.parse(repairInvalidJsonEscapes(value));
      } catch {
        throw err;
      }
    }
  };

  try {
    return parseWithRepair(trimmed);
  } catch {}

  const jsonObject = extractFirstJsonObject(trimmed);
  if (jsonObject) {
    return parseWithRepair(jsonObject);
  }

  throw new Error("Could not parse model response as JSON.");
}

function extractFirstJsonObject(value: string) {
  const start = value.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < value.length; i += 1) {
    const char = value[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return value.slice(start, i + 1);
    }
  }

  return null;
}

function repairInvalidJsonEscapes(value: string) {
  let repaired = "";
  let inString = false;
  let escaped = false;
  const validEscapes = new Set(['"', "\\", "/", "b", "f", "n", "r", "t", "u"]);
  const isHex = (char: string | undefined) => !!char && /^[0-9a-fA-F]$/.test(char);

  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];

    if (!inString) {
      repaired += char;
      if (char === '"') inString = true;
      continue;
    }

    if (escaped) {
      if (char === "u" && !(isHex(value[i + 1]) && isHex(value[i + 2]) && isHex(value[i + 3]) && isHex(value[i + 4]))) {
        repaired += "\\\\u";
        escaped = false;
        continue;
      }
      if (!validEscapes.has(char)) repaired += "\\";
      repaired += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === "\n") {
      repaired += "\\n";
      continue;
    }
    if (char === "\r") {
      repaired += "\\r";
      continue;
    }
    if (char === "\t") {
      repaired += "\\t";
      continue;
    }

    repaired += char;
    if (char === '"') inString = false;
  }

  if (escaped) repaired += "\\\\";
  return repaired;
}

function normalizeIndividualReview(input: unknown): IndividualReview {
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const coverage = source.coverageLedger && typeof source.coverageLedger === "object"
    ? (source.coverageLedger as Record<string, unknown>)
    : {};
  const framework = source.frameworkConditionality && typeof source.frameworkConditionality === "object"
    ? (source.frameworkConditionality as Record<string, unknown>)
    : {};

  const normalizedScoreBand = normalizeScoreBand(source.scoreBand);
  const normalizedSpecialtyScore = Math.round(asNumber(source.specialtyRelativeScore, normalizedScoreBand.median, 0, 100));
  const normalizedClassification =
    normalizeClassification(source.bestClassification) || classificationFallbackFromScore(normalizedScoreBand.median);
  const alignedClassification = alignClassificationToScore(normalizedClassification, normalizedScoreBand.median);

  return {
    title: "anonymized manuscript",
    authorName: "anonymized",
    comparisonCohort: asString(source.comparisonCohort),
    broadField: asString(source.broadField),
    specialtyField: asString(source.specialtyField),
    subfields: asStringArray(source.subfields),
    paperType: asString(source.paperType),
    summary: asString(source.summary),
    centralClaim: asString(source.centralClaim),
    coverageLedger: {
      directTargets: asStringArray(coverage.directTargets),
      importedInputs: asStringArray(coverage.importedInputs),
      theorySpaceVariants: asStringArray(coverage.theorySpaceVariants),
      mechanismSharingAssessment: asString(coverage.mechanismSharingAssessment),
    },
    establishedResults: asStringArray(source.establishedResults),
    interpretiveClaims: asStringArray(source.interpretiveClaims),
    speculativeClaims: asStringArray(source.speculativeClaims),
    correctness: asString(source.correctness),
    novelty: asString(source.novelty),
    noveltyConfidence: asNumber(source.noveltyConfidence, 0.95, 0, 1),
    internalTechnicalTraction: asString(source.internalTechnicalTraction),
    economy: asString(source.economy),
    explanatoryTargetBreadth: asString(source.explanatoryTargetBreadth),
    theorySpaceBreadth: asString(source.theorySpaceBreadth),
    scopeDepth: asString(source.scopeDepth),
    unifyingPower: asString(source.unifyingPower),
    frameworkConditionality: {
      level: normalizeFrameworkLevel(framework.level),
      explanation: asString(framework.explanation),
    },
    strongestCaseForImportance: asString(source.strongestCaseForImportance),
    strongestObjection: asString(source.strongestObjection),
    decisiveCheck: asString(source.decisiveCheck),
    whatWouldRaiseScore: asString(source.whatWouldRaiseScore),
    whatWouldLowerScore: asString(source.whatWouldLowerScore),
    intrinsicTechnicalScore: Math.round(asNumber(source.intrinsicTechnicalScore, 0, 0, 10)),
    explanatoryTargetBreadthScore: Math.round(asNumber(source.explanatoryTargetBreadthScore, 0, 0, 10)),
    theorySpaceBreadthScore: Math.round(asNumber(source.theorySpaceBreadthScore, 0, 0, 10)),
    breadthOfImpactScore: Math.round(asNumber(source.breadthOfImpactScore, 0, 0, 10)),
    specialtyRelativeScore: normalizedSpecialtyScore,
    broadFieldRelativeScore: Math.round(asNumber(source.broadFieldRelativeScore, 0, 0, 100)),
    crossFieldConsequenceScore: Math.round(asNumber(source.crossFieldConsequenceScore, 0, 0, 100)),
    scoreBand: normalizedScoreBand,
    scoreConfidence: asNumber(source.scoreConfidence, 0.9, 0, 1),
    bestClassification: alignedClassification,
    oneParagraphVerdict: asString(source.oneParagraphVerdict),
    finalJudgment: asString(source.finalJudgment),
  };
}

function normalizeAggregateReview(input: unknown, fallbackScores: number[]): AggregateReview {
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const scores = Array.isArray(source.individualScores)
    ? (source.individualScores as unknown[]).map((item) => Math.round(asNumber(item, 0, 0, 100)))
    : fallbackScores;
  const usableScores = scores.length > 0 ? scores : fallbackScores;
  const band = normalizeScoreBand(source.finalScoreBand);
  const defaultBand = usableScores.length > 0
    ? { low: Math.min(...usableScores), median: Math.round(usableScores.reduce((sum, item) => sum + item, 0) / usableScores.length), high: Math.max(...usableScores) }
    : { low: 0, median: 0, high: 0 };
  const finalBand = band.low === 0 && band.median === 0 && band.high === 0 ? defaultBand : band;
  const range = finalBand.high - finalBand.low;

  const fallbackClassification = classificationFallbackFromScore(finalBand.median);
  const alignedAggregateClassification = alignClassificationToScore(
    normalizeClassification(source.finalClassification) || fallbackClassification,
    finalBand.median,
  );

  return {
    finalComparisonCohort: asString(source.finalComparisonCohort),
    finalBroadField: asString(source.finalBroadField),
    finalSpecialtyField: asString(source.finalSpecialtyField),
    finalSummary: asString(source.finalSummary),
    individualScores: usableScores,
    scoreRange: Math.round(asNumber(source.scoreRange, range, 0, 100)),
    scoreStability: (() => {
      const candidate = asString(source.scoreStability).toLowerCase();
      return candidate === "high" || candidate === "medium" || candidate === "low"
        ? candidate
        : rangeToStability(range);
    })(),
    mainAgreements: asStringArray(source.mainAgreements),
    mainDisagreements: asStringArray(source.mainDisagreements),
    fatalObjectionPresent: asBoolean(source.fatalObjectionPresent),
    fatalObjectionAssessment: asString(source.fatalObjectionAssessment),
    finalClassification: alignedAggregateClassification,
    finalScoreBand: finalBand,
    finalScoreConfidence: asNumber(source.finalScoreConfidence, 0.9, 0, 1),
    publicOneParagraphVerdict: asString(source.publicOneParagraphVerdict),
    internalCalibrationNotes: asString(source.internalCalibrationNotes),
  };
}

function toMarkdownList(items: string[]) {
  return items.filter(Boolean).map((item) => `- ${item}`).join("\n");
}

function blindManuscriptText(paperContent: string) {
  const cleaned = stripControlChars(paperContent).replace(/\r\n/g, "\n");
  const lines = cleaned.split("\n");
  const abstractIndex = lines.findIndex((line) => /^\s*abstract\b/i.test(line));
  const startIndex = abstractIndex > 0 && abstractIndex < 80 ? abstractIndex : 0;
  let bodyLines = lines.slice(startIndex);

  const tailCutIndex = bodyLines.findIndex((line) =>
    /^\s*(references|bibliography|acknowledg?ments?|works cited)\b/i.test(line),
  );
  if (tailCutIndex !== -1) {
    bodyLines = bodyLines.slice(0, tailCutIndex);
  }

  return bodyLines
    .map((line, index) => {
      if (index < 20) {
        if (/@/.test(line)) return "";
        if (/\b(university|institute|department|laboratory|college|school)\b/i.test(line)) return "";
        if (/^\s*(authors?|affiliations?)\b/i.test(line)) return "";
      }
      return line;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type MetadataHints = {
  fileName?: string;
  pdfTitle?: string;
  pdfAuthor?: string;
};

function cleanMetadataText(value?: string) {
  return stripControlChars(value || "")
    .replace(/\.[Pp][Dd][Ff]$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isUsefulTitleHint(value?: string) {
  const cleaned = cleanMetadataText(value);
  if (cleaned.length < 8 || cleaned.length > 220) return false;
  if (/^(untitled|unknown|arxiv|paper|document)$/i.test(cleaned)) return false;
  if (/^[a-z]+[0-9]{2,}$/i.test(cleaned)) return false;
  if (/^\d{4}\.\d{4,5}(v\d+)?$/i.test(cleaned)) return false;
  if (!/[A-Za-z]{4}/.test(cleaned)) return false;
  return true;
}

function isUsefulAuthorHint(value?: string) {
  const cleaned = cleanMetadataText(value);
  if (cleaned.length < 3 || cleaned.length > 300) return false;
  if (/^(unknown|anonymous|admin|root|user|owner)$/i.test(cleaned)) return false;
  if (/@|\b(university|institute|department|laboratory|college|school|press|journal)\b/i.test(cleaned)) return false;
  if (!/[A-Za-z]{2}/.test(cleaned)) return false;
  return true;
}

function manuscriptHeaderText(paperContent: string) {
  const cleaned = stripControlChars(paperContent).replace(/\r\n/g, "\n");
  const lines = cleaned.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 80);
  const abstractIndex = lines.findIndex((line) => /^abstract\b/i.test(line));
  return (abstractIndex > 0 ? lines.slice(0, abstractIndex) : lines.slice(0, 40)).filter((line) =>
    !/^(arxiv:|doi:|submitted by\b|submitted to\b|keywords?\b|pacs\b|msc\b)/i.test(line) &&
    !/\b\d{1,2}\s+[A-Z][a-z]{2,8}\s+\d{4}\b/.test(line) &&
    !/^[A-Za-z-]+\/[A-Za-z.-]+\d+v\d+/i.test(line),
  );
}

function heuristicMetadata(paperContent: string, hints: MetadataHints = {}) {
  const headerLines = manuscriptHeaderText(paperContent);

  const looksLikeAffiliation = (line: string) =>
    /@|\b(university|institute|department|laboratory|college|school|faculty|centre|center)\b/i.test(line);

  const looksLikeTitleContinuation = (previousLine: string, nextLine: string) => {
    if (!previousLine || !nextLine) return false;
    const prev = previousLine.trim();
    const next = nextLine.trim();
    return (
      /\b(of|and|for|in|on|with|from|to|the|a|an)$/i.test(prev) ||
      /^[a-z(]/.test(next)
    );
  };

  const looksLikeAuthorLine = (line: string) => {
    if (looksLikeAffiliation(line) || /^abstract\b/i.test(line)) return false;
    if (line.length < 3 || line.length > 180) return false;
    if (!/[A-Za-z]/.test(line)) return false;
    const normalized = line.replace(/\band\b/gi, ",").replace(/\s+/g, " ").trim();
    const parts = normalized.split(",").map((part) => part.trim()).filter(Boolean);
    if (parts.length === 0 || parts.length > 10) return false;
    const hasInitial = /\b[A-Z]\./.test(line);

    return parts.every((part) => {
      const tokens = part.split(/\s+/).filter(Boolean);
      if (tokens.length < 1 || tokens.length > 6) return false;
      const allNameStyle = tokens.every((token) => /^[A-Z][A-Za-z.'-]*$|^[A-Z]\.?$/.test(token));
      const nameLike = tokens.filter((token) => /^[A-Z][A-Za-z.'-]*$|^[A-Z]\.?$/.test(token)).length;
      if (hasInitial) return nameLike >= Math.max(1, Math.ceil(tokens.length * 0.6));
      return allNameStyle && nameLike === tokens.length;
    });
  };

  const titleStartIndex = headerLines.findIndex((line) =>
    line.length >= 8 &&
    line.length <= 220 &&
    !looksLikeAffiliation(line) &&
    !looksLikeAuthorLine(line) &&
    !/^abstract\b/i.test(line),
  );

  const titleLines: string[] = [];
  if (titleStartIndex !== -1) {
    for (const line of headerLines.slice(titleStartIndex)) {
      const previousLine = titleLines[titleLines.length - 1] || "";
      if ((looksLikeAuthorLine(line) && !looksLikeTitleContinuation(previousLine, line)) || looksLikeAffiliation(line) || /^abstract\b/i.test(line)) break;
      if (line.length < 3 || line.length > 220) break;
      titleLines.push(line);
      if (titleLines.join(" ").length >= 220) break;
    }
  }

  const headerTitle = titleLines.length > 0 ? titleLines.join(" ").replace(/\s+/g, " ").trim() : "";
  const titleCandidate =
    headerTitle ||
    (isUsefulTitleHint(hints.pdfTitle) ? cleanMetadataText(hints.pdfTitle) : "") ||
    (isUsefulTitleHint(hints.fileName) ? cleanMetadataText(hints.fileName) : "") ||
    "Unknown Title";

  const authorStartIndex = titleStartIndex === -1 ? -1 : titleStartIndex + titleLines.length;
  const authorLines: string[] = [];
  if (authorStartIndex !== -1) {
    for (const line of headerLines.slice(authorStartIndex, authorStartIndex + 4)) {
      if (looksLikeAffiliation(line) || /^abstract\b/i.test(line)) break;
      if (!looksLikeAuthorLine(line)) break;
      authorLines.push(line);
    }
  }

  const headerAuthors = authorLines.length > 0
    ? authorLines.join(", ").replace(/\s*,\s*/g, ", ").replace(/\s+/g, " ").trim()
    : "";
  const authorCandidate =
    headerAuthors ||
    (isUsefulAuthorHint(hints.pdfAuthor) ? cleanMetadataText(hints.pdfAuthor) : "") ||
    "Unknown Authors";

  return {
    title: titleCandidate,
    authors: authorCandidate,
  };
}

async function callGpt(prompt: string, input: string) {
  return withModelRetries(GPT_MODEL, async () => {
    const response = await getOpenAI().chat.completions.create({
      model: GPT_MODEL,
      max_completion_tokens: 8192,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: input },
      ],
    });
    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("No response from GPT model.");
    return { parsed: extractJson(content), thinkingText: null as string | null };
  });
}

async function callGemini(
  prompt: string,
  input: string,
  geminiModel = GEMINI_META_MODEL,
  options?: { maxOutputTokens?: number; includeThoughts?: boolean },
) {
  const includeThoughts = options?.includeThoughts ?? true;
  return withModelRetries(geminiModel, async () => {
    const response = await geminiAI.models.generateContent({
      model: geminiModel,
      contents: [{ role: "user", parts: [{ text: input }] }],
      config: {
        systemInstruction: prompt,
        responseMimeType: "application/json",
        maxOutputTokens: options?.maxOutputTokens ?? 32768,
        ...(includeThoughts ? { thinkingConfig: { includeThoughts: true, thinkingLevel: "HIGH" } } : {}),
      } as any,
    });

    const parts: any[] = (response as any).candidates?.[0]?.content?.parts ?? [];
    const thinkingParts = parts.filter((part: any) => part.thought === true);
    const thinkingText = thinkingParts.length > 0
      ? thinkingParts.map((part: any) => part.text ?? "").join("\n\n").trim()
      : null;
    const content = response.text;
    if (!content) throw new Error("No response from Gemini model.");
    return { parsed: extractJson(content), thinkingText };
  });
}

async function runModel(prompt: string, input: string, model: ReviewModel, geminiModel = GEMINI_META_MODEL) {
  return model === "gemini" ? callGemini(prompt, input, geminiModel) : callGpt(prompt, input);
}

async function runIndividualPass(
  prompt: string,
  input: string,
  model: ReviewModel,
  index: number,
): Promise<IndividualPassResult> {
  try {
    const { parsed, thinkingText } = await runModel(prompt, input, model, GEMINI_PASS_MODEL);
    return {
      review: normalizeIndividualReview(parsed),
      thinkingText,
      index,
      modelName: model === "gemini" ? GEMINI_PASS_MODEL : GPT_MODEL,
    };
  } catch (error) {
    if (model !== "gemini" || GEMINI_PASS_MODEL === GEMINI_META_MODEL) throw error;

    const { parsed, thinkingText } = await callGemini(prompt, input, GEMINI_META_MODEL);
    const fallbackNote = `Flash pass ${index + 1} failed after retries; recovered with ${GEMINI_META_MODEL}.\nFailure: ${errorMessage(error)}`;
    return {
      review: normalizeIndividualReview(parsed),
      thinkingText: [fallbackNote, thinkingText].filter(Boolean).join("\n\n"),
      index,
      modelName: `${GEMINI_PASS_MODEL} fallback ${GEMINI_META_MODEL}`,
    };
  }
}

function buildAggregateInput(blindedContent: string, reviews: IndividualReview[]) {
  return JSON.stringify({
    blindedManuscript: blindedContent,
    reviewPasses: reviews.map((review, index) => ({
      passNumber: index + 1,
      review,
    })),
  }, null, 2);
}

function pickRepresentativeReview(reviews: IndividualReview[], medianScore: number) {
  return [...reviews].sort((a, b) => {
    const aDelta = Math.abs(a.scoreBand.median - medianScore);
    const bDelta = Math.abs(b.scoreBand.median - medianScore);
    return aDelta - bDelta;
  })[0];
}

export async function extractMetadata(paperContent: string, hints: MetadataHints = {}): Promise<{ title: string; authors: string }> {
  const fallback = heuristicMetadata(paperContent, hints);
  const metadataInput = JSON.stringify({
    fileNameHint: cleanMetadataText(hints.fileName),
    embeddedPdfTitleHint: cleanMetadataText(hints.pdfTitle),
    embeddedPdfAuthorHint: cleanMetadataText(hints.pdfAuthor),
    heuristicTitleFallback: fallback.title,
    heuristicAuthorsFallback: fallback.authors,
    manuscriptHeaderText: manuscriptHeaderText(paperContent).join("\n").slice(0, 5000),
  }, null, 2);
  const looksTruncatedTitle = (value: string) =>
    /\b(of|and|for|in|on|with|from|to|the|a|an)$/i.test(value.trim());
  const isSuspiciousTitle = (value: string) =>
    !value ||
    value === "Unknown Title" ||
    /^(arxiv:|submitted by\b)/i.test(value) ||
    value.length < 8 ||
    looksTruncatedTitle(value);
  const isSuspiciousAuthors = (value: string) =>
    !value ||
    value === "Unknown Authors" ||
    /^(submitted by\b|abstract\b)/i.test(value) ||
    /@|\b(university|institute|department|laboratory|college|school|faculty|centre|center)\b/i.test(value) ||
    value.length > 500;
  try {
    const { parsed } = await callGemini(
      METADATA_PROMPT,
      metadataInput,
      GEMINI_PASS_MODEL,
      { maxOutputTokens: 512, includeThoughts: false },
    );
    const parsedMetadata = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    const title = asString(parsedMetadata.title, fallback.title);
    const authors = asString(parsedMetadata.authors, fallback.authors);
    const bestTitle =
      isSuspiciousTitle(title) ||
      (fallback.title !== "Unknown Title" && fallback.title.length > title.length + 12)
        ? fallback.title
        : title;
    const bestAuthors = isSuspiciousAuthors(authors) ? fallback.authors : authors;
    return {
      title: bestTitle,
      authors: bestAuthors,
    };
  } catch {
    return fallback;
  }
}

async function generateMultiPassReview(
  paperContent: string,
  model: ReviewModel,
  promptOverride?: string,
): Promise<MultiPassReviewResult> {
  const systemPrompt = promptOverride?.trim() || REVIEW_SYSTEM_INSTRUCTION;
  const blindedContent = blindManuscriptText(paperContent);
  const thinkingChunks: string[] = [];

  const settledPassResults = await Promise.allSettled(
    Array.from({ length: REVIEW_PASS_COUNT }, async (_unused, index) =>
      runIndividualPass(systemPrompt, blindedContent, model, index),
    ),
  );

  const passResults = settledPassResults
    .filter((result): result is PromiseFulfilledResult<IndividualPassResult> => result.status === "fulfilled")
    .map((result) => result.value)
    .sort((a, b) => a.index - b.index);

  const passFailures = settledPassResults
    .map((result, index) => ({ result, index }))
    .filter((item): item is { result: PromiseRejectedResult; index: number } => item.result.status === "rejected");

  if (passResults.length < 2) {
    const details = passFailures.map(({ result, index }) => `pass ${index + 1}: ${errorMessage(result.reason)}`).join("; ");
    throw new Error(`Review failed: only ${passResults.length} of ${REVIEW_PASS_COUNT} independent passes completed. ${details}`);
  }

  const individualReviews = passResults.map((result) => result.review);
  for (const result of passResults) {
    if (result.thinkingText) {
      thinkingChunks.push(`Pass ${result.index + 1} (${result.modelName})\n${result.thinkingText}`);
    }
  }
  for (const { result, index } of passFailures) {
    thinkingChunks.push(`Pass ${index + 1} failed\n${errorMessage(result.reason)}`);
  }

  const { parsed: aggregateParsed, thinkingText: aggregateThinking } = await runModel(
    AGGREGATOR_SYSTEM_INSTRUCTION,
    buildAggregateInput(blindedContent, individualReviews),
    model,
    GEMINI_META_MODEL,
  );

  if (aggregateThinking) {
    thinkingChunks.push(`Aggregator\n${aggregateThinking}`);
  }

  const fallbackScores = individualReviews.map((review) => review.scoreBand.median);
  const aggregate = normalizeAggregateReview(aggregateParsed, fallbackScores);
  const representativeReview = pickRepresentativeReview(individualReviews, aggregate.finalScoreBand.median);

  return {
    modelName: model === "gemini" ? `${GEMINI_PASS_MODEL} + ${GEMINI_META_MODEL}` : GPT_MODEL,
    systemPrompt,
    blindedContent,
    individualReviews,
    aggregate,
    representativeReview,
    thinkingText: thinkingChunks.length > 0 ? thinkingChunks.join("\n\n---\n\n") : null,
  };
}

function buildStoredReviewValues(result: MultiPassReviewResult) {
  const { representativeReview, aggregate } = result;
  const firstComparisonCohort = result.individualReviews.find((review) => review.comparisonCohort)?.comparisonCohort || null;
  const firstBroadField = result.individualReviews.find((review) => review.broadField)?.broadField || null;
  const firstSpecialtyField = result.individualReviews.find((review) => review.specialtyField)?.specialtyField || null;
  const aggregateClassification = aggregate.finalClassification || representativeReview.bestClassification || classificationFallbackFromScore(aggregate.finalScoreBand.median);
  const comparisonCohort =
    aggregate.finalComparisonCohort ||
    representativeReview.comparisonCohort ||
    representativeReview.specialtyField ||
    representativeReview.broadField ||
    firstComparisonCohort ||
    firstSpecialtyField ||
    firstBroadField;
  return {
    summary: aggregate.finalSummary || representativeReview.summary || representativeReview.oneParagraphVerdict,
    correctness: representativeReview.correctness,
    novelty: representativeReview.novelty,
    overallEvaluation: aggregate.publicOneParagraphVerdict || representativeReview.finalJudgment,
    score: aggregate.finalScoreBand.median,
    relatedWork: "",
    centralClaim: representativeReview.centralClaim || null,
    establishedResults: toMarkdownList(representativeReview.establishedResults) || null,
    interpretiveClaims: toMarkdownList(representativeReview.interpretiveClaims) || null,
    speculativeClaims: toMarkdownList(representativeReview.speculativeClaims) || null,
    economy: representativeReview.economy || null,
    explanatoryTargetBreadth: representativeReview.explanatoryTargetBreadth || null,
    theorySpaceBreadth: representativeReview.theorySpaceBreadth || null,
    scopeDepth: representativeReview.scopeDepth || null,
    unifyingPower: representativeReview.unifyingPower || null,
    strongestCaseForImportance: representativeReview.strongestCaseForImportance || null,
    strongestObjection: representativeReview.strongestObjection || null,
    decisiveCheck: representativeReview.decisiveCheck || null,
    internalTechnicalTraction: representativeReview.internalTechnicalTraction || null,
    noveltyConfidence: String(representativeReview.noveltyConfidence),
    intrinsicScientificMeritScore: representativeReview.intrinsicTechnicalScore,
    explanatoryTargetBreadthScore: representativeReview.explanatoryTargetBreadthScore,
    theorySpaceBreadthScore: representativeReview.theorySpaceBreadthScore,
    breadthOfImpactScore: representativeReview.breadthOfImpactScore,
    overallIntrinsicScore: aggregate.finalScoreBand.median,
    bestClassification: aggregateClassification,
    finalJudgment: aggregate.publicOneParagraphVerdict || representativeReview.finalJudgment,
    coverageLedgerJson: JSON.stringify({
      coverageLedger: representativeReview.coverageLedger,
      aggregate,
      individualReviews: result.individualReviews,
      passCount: REVIEW_PASS_COUNT,
      finalComparisonCohort: comparisonCohort,
      scoreStability: aggregate.scoreStability,
    }),
    thinkingText: result.thinkingText,
    comparisonCohort,
    broadField: aggregate.finalBroadField || representativeReview.broadField || firstBroadField,
    specialtyField: aggregate.finalSpecialtyField || representativeReview.specialtyField || firstSpecialtyField,
    frameworkConditionalityLevel: representativeReview.frameworkConditionality.level,
    frameworkConditionalityExplanation: representativeReview.frameworkConditionality.explanation || null,
    specialtyRelativeScore: representativeReview.specialtyRelativeScore,
    broadFieldRelativeScore: representativeReview.broadFieldRelativeScore,
    crossFieldConsequenceScore: representativeReview.crossFieldConsequenceScore,
    scoreBandLow: aggregate.finalScoreBand.low,
    scoreBandMedian: aggregate.finalScoreBand.median,
    scoreBandHigh: aggregate.finalScoreBand.high,
    scoreConfidence: String(aggregate.finalScoreConfidence),
    scoreStability: aggregate.scoreStability,
    publicVerdict: aggregate.publicOneParagraphVerdict || representativeReview.oneParagraphVerdict || null,
    individualReviewsJson: JSON.stringify(result.individualReviews),
    aggregateMetaJson: JSON.stringify(aggregate),
    passCount: REVIEW_PASS_COUNT,
    modelName: result.modelName,
    systemPrompt: result.systemPrompt,
  };
}

export async function generateCompatReview(
  paperContent: string,
  model: ReviewModel,
  promptOverride?: string,
) {
  const result = await generateMultiPassReview(paperContent, model, promptOverride);
  const aggregate = result.aggregate;
  const representative = result.representativeReview;
  const reviewValues = buildStoredReviewValues(result);

  return {
    metadata: {
      field: aggregate.finalBroadField || representative.broadField || "Unknown",
      subfields: representative.subfields ?? [],
      modelName: result.modelName,
    },
    reviewValues,
  };
}
