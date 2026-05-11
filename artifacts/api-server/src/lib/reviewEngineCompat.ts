import OpenAI from "openai";
import { ai as geminiAI } from "@workspace/integrations-gemini-ai";

export const GPT_MODEL = "gpt-5.4-pro";
export const GEMINI_MODEL = "gemini-3.1-pro-preview";
export const REVIEW_PASS_COUNT = 3;

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY environment variable is not set.");
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

export const REVIEW_SYSTEM_INSTRUCTION = `You are reviewing an anonymous scientific manuscript from its contents alone.

Ignore author identity, institution, venue, citation counts, publication status, historical fame, and later influence. If any of that information appears in the text, ignore it. Judge only the manuscript's ideas, claims, derivations, constructions, examples, data, checks, reductions, limits, and explicit comparisons.

Do not defer to human expert consensus. Your task is to give the best model-based scientific judgment under this review protocol.

Keep separate:
- correctness
- originality
- internal technical traction
- explanatory economy
- scope and depth within the stated domain
- explanatory-target breadth
- theory-space breadth
- unifying power
- framework conditionality
- breadth of consequences if correct

First determine the comparison cohort. Use the narrowest serious research cohort that a working expert would naturally use, but do not choose an artificially tiny cohort merely to inflate the score. Also identify the broader field.

Definitions:

Direct explanatory targets are phenomena, regimes, examples, theorem families, systems, observables, structures, tasks, or problem classes that the manuscript explicitly analyzes or derives results for.

Imported inputs are formulas, assumptions, known laws, entropy functionals, standard definitions, prior frameworks, or external results used by the manuscript but not themselves explained by it.

Theory-space variants are alternative theories, dimensions, parameter families, model classes, formalisms, axiomatic settings, architectures, or regimes across which the same template is extended.

Mechanism-sharing asks whether the same mechanism genuinely explains multiple direct targets, or whether the manuscript merely reuses notation across them.

Do not count an imported input as a direct explanatory target. Do not count multiple theory variants as multiple physical targets unless they produce distinct consequences, structures, constraints, or applications.

A simple identity or reformulation can be scientifically important if it reveals a privileged variable, removes ambiguity, unifies targets, produces a new derivation, separates previously conflated mechanisms, or gives new calculational leverage. But do not reward relabeling unless it produces genuine explanatory gain.

Every review must include the strongest case for importance and the strongest objection. The objection should not be artificially hostile; it should be the most serious technically fair concern.

Scoring:

The main score is field-relative. It answers: how strong is this manuscript compared with serious research papers in its comparison cohort, judging only content and support?

Also provide:
- broad-field score: strength relative to the broader field;
- cross-field consequence score: how much the result would matter outside the immediate field if correct;
- framework conditionality: whether the importance depends on accepting a specific framework.

Scale instructions:
- intrinsicTechnicalScore, explanatoryTargetBreadthScore, theorySpaceBreadthScore, and breadthOfImpactScore are on a 0-10 scale.
- specialtyRelativeScore, broadFieldRelativeScore, crossFieldConsequenceScore, and every number inside scoreBand are on a 0-100 scale.
- Do not use a 0-10 scale for scoreBand.
- For a paper in the nineties, scoreBand should look like {"low": 90, "median": 93, "high": 96}, not {"low": 9, "median": 9.3, "high": 9.6}.

Formatting instructions:
- Wrap inline mathematical expressions in $...$.
- Wrap display equations in $$...$$.
- Do not leave equations as plain text if you can express them in LaTeX.

Use the full range.

Classification options:
- field-defining advance
- major specialty advance
- strong niche contribution
- useful clarification
- elegant repackaging
- not yet convincing

Classification guidance:
- field-defining advance: changes central concepts, methods, or organizing principles of the comparison cohort.
- major specialty advance: provides a substantial new result, mechanism, derivation, framework, or unification that changes how an important specialty understands its targets.
- strong niche contribution: deep, correct, and genuinely clarifying within a focused domain.
- useful clarification: improves understanding but is mostly explanatory, organizational, or incremental.
- elegant repackaging: clear and economical but does not establish a substantially new result, mechanism, or explanatory gain.
- not yet convincing: central claims are unsupported, incorrect, or too speculative.

Before final scoring, explicitly consider:
1. What is genuinely derived or established inside the manuscript?
2. What is imported?
3. What would a fair skeptical reviewer say is merely relabeling?
4. What would most raise the score?
5. What would most lower the score?
6. Is the comparison cohort too broad or too narrow?

Return valid JSON only with this exact structure:

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

You will receive the blinded manuscript text and three full independent anonymous reviews produced under the same rubric.

Read the manuscript yourself first. Then audit the three reviews. Do not simply average the scores. Compare the reasoning against the manuscript.

Your task:
1. Identify what is supported by the manuscript.
2. Identify agreements.
3. Identify disagreements.
4. Determine whether the reviewers used the same comparison cohort.
5. Determine whether any reviewer found a fatal correctness issue.
6. Decide whether score variation reflects real ambiguity or model noise.
7. Produce the final public classification, score band, and one-paragraph verdict.
8. Produce a short public summary of what the manuscript actually does.

Important score rule:
- Each individual review pass has one actual score band and one median score.
- The aggregate review combines the passes into one final score band.
- Do not invent sub-ranges for a single pass beyond that pass's own scoreBand.

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
Return a JSON object with exactly two fields:
- title: string (the paper title, or "Unknown Title" if not found)
- authors: string (comma-separated list of author names as written, or "Unknown Authors" if not found)
Output valid JSON only.`;

function stripControlChars(text: string) {
  return text.replace(/\x00/g, "").replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ");
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
  try {
    return JSON.parse(trimmed);
  } catch {}

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
  }

  throw new Error("Could not parse model response as JSON.");
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

function heuristicMetadata(paperContent: string) {
  const cleaned = stripControlChars(paperContent).replace(/\r\n/g, "\n");
  const lines = cleaned.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 40);
  const abstractIndex = lines.findIndex((line) => /^abstract\b/i.test(line));
  const headerLines = (abstractIndex > 0 ? lines.slice(0, abstractIndex) : lines).filter((line) =>
    !/^(arxiv:|doi:|submitted by\b|submitted to\b|keywords?\b|pacs\b|msc\b)/i.test(line) &&
    !/\b\d{1,2}\s+[A-Z][a-z]{2,8}\s+\d{4}\b/.test(line) &&
    !/^[A-Za-z-]+\/[A-Za-z.-]+\d+v\d+/i.test(line),
  );

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

  const titleCandidate = titleLines.length > 0 ? titleLines.join(" ").replace(/\s+/g, " ").trim() : "Unknown Title";

  const authorStartIndex = titleStartIndex === -1 ? -1 : titleStartIndex + titleLines.length;
  const authorLines: string[] = [];
  if (authorStartIndex !== -1) {
    for (const line of headerLines.slice(authorStartIndex, authorStartIndex + 4)) {
      if (looksLikeAffiliation(line) || /^abstract\b/i.test(line)) break;
      if (!looksLikeAuthorLine(line)) break;
      authorLines.push(line);
    }
  }

  const authorCandidate = authorLines.length > 0
    ? authorLines.join(", ").replace(/\s*,\s*/g, ", ").replace(/\s+/g, " ").trim()
    : "Unknown Authors";

  return {
    title: titleCandidate,
    authors: authorCandidate,
  };
}

async function callGpt(prompt: string, input: string) {
  const response = await openai.chat.completions.create({
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
}

async function callGemini(prompt: string, input: string) {
  const response = await geminiAI.models.generateContent({
    model: GEMINI_MODEL,
    contents: [{ role: "user", parts: [{ text: input }] }],
    config: {
      systemInstruction: prompt,
      responseMimeType: "application/json",
      maxOutputTokens: 32768,
      thinkingConfig: { includeThoughts: true, thinkingLevel: "HIGH" },
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
}

async function runModel(prompt: string, input: string, model: ReviewModel) {
  return model === "gemini" ? callGemini(prompt, input) : callGpt(prompt, input);
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

export async function extractMetadata(paperContent: string): Promise<{ title: string; authors: string }> {
  const fallback = heuristicMetadata(paperContent);
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
    /^(submitted by\b|abstract\b)/i.test(value);
  try {
    const response = await openai.chat.completions.create({
      model: GPT_MODEL,
      max_completion_tokens: 512,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: METADATA_PROMPT },
        { role: "user", content: stripControlChars(paperContent).substring(0, 6000) },
      ],
    });
    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("No metadata response");
    const parsed = extractJson(content) as Record<string, unknown>;
    const title = asString(parsed.title, fallback.title);
    const authors = asString(parsed.authors, fallback.authors);
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
  const individualReviews: IndividualReview[] = [];
  const thinkingChunks: string[] = [];

  for (let index = 0; index < REVIEW_PASS_COUNT; index += 1) {
    const { parsed, thinkingText } = await runModel(systemPrompt, blindedContent, model);
    individualReviews.push(normalizeIndividualReview(parsed));
    if (thinkingText) {
      thinkingChunks.push(`Pass ${index + 1}\n${thinkingText}`);
    }
  }

  const { parsed: aggregateParsed, thinkingText: aggregateThinking } = await runModel(
    AGGREGATOR_SYSTEM_INSTRUCTION,
    buildAggregateInput(blindedContent, individualReviews),
    model,
  );

  if (aggregateThinking) {
    thinkingChunks.push(`Aggregator\n${aggregateThinking}`);
  }

  const fallbackScores = individualReviews.map((review) => review.scoreBand.median);
  const aggregate = normalizeAggregateReview(aggregateParsed, fallbackScores);
  const representativeReview = pickRepresentativeReview(individualReviews, aggregate.finalScoreBand.median);

  return {
    modelName: model === "gemini" ? GEMINI_MODEL : GPT_MODEL,
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
