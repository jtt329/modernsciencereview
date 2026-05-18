import OpenAI from "openai";
import { ai as geminiAI } from "@workspace/integrations-gemini-ai";

export const GPT_MODEL = "gpt-5.4-pro";
export const GEMINI_PRO_MODEL =
  process.env.SCIREVIEW_GEMINI_PRO_MODEL?.trim() ||
  process.env.SCIREVIEW_GEMINI_MODEL?.trim() ||
  "gemini-3.1-pro-preview";
export const GEMINI_PASS_MODEL = GEMINI_PRO_MODEL;
export const GEMINI_META_MODEL = GEMINI_PRO_MODEL;
export const GEMINI_MODEL = GEMINI_META_MODEL;
export const REVIEW_PASS_COUNT = 2;

let openai: OpenAI | null = null;
function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required when the OpenAI review model is selected.");
  }
  openai ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openai;
}

export type ReviewModel = "gpt" | "gemini";

export type ReviewInput =
  | string
  | {
      text: string;
      pdfBase64: string;
      mimeType?: string;
    };

type FrameworkLevel = "low" | "medium" | "high";
type ScoreStability = "high" | "medium" | "low";

const CLASSIFICATIONS = [
  "field-defining advance",
  "framework-defining advance",
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
  inputGrounding: string;
  contributionGroundingType: string;
  frameworkIndependence: string;
  hardToVaryAssessment: string;
  manuscriptOriginalContribution: string;
  survivingContributionIfFlawed: string;
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
  inputGroundingAssessment: string;
  contributionGroundingType: string;
  frameworkIndependenceAssessment: string;
  hardToVaryAssessment: string;
  frameworkConditionalityAssessment: string;
  originalContributionAssessment: string;
  survivingContributionIfFlawed: string;
  laterInfluenceOrExternalResultRisk: string;
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
  blindedContent: ReviewInput;
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

Ignore author identity, institution, venue, citation counts, publication status, historical fame, later influence, and whether the work is familiar. If any of that information appears in the text, ignore it. Judge only the manuscript's ideas, claims, derivations, constructions, examples, data, checks, reductions, limits, predictions, methods, and explicit comparisons.

Do not defer to human expert consensus. Give the best model-based scientific judgment under this review protocol.

Core standard:
Correctness is the gate. Explanatory reach is the main source of value.

A manuscript is scientifically valuable to the extent that it correctly explains, constrains, predicts, computes, organizes, rules out, or enables understanding over meaningful targets using fewer, firmer, and less arbitrary commitments. In short: good science explains more with less.

Targets may be physical phenomena, observations, regimes, systems, equations, theorem families, structures, datasets, instruments, algorithms, mechanisms, tasks, model classes, experimental discriminations, or downstream research questions.

Do not merely count examples. Weight targets by centrality, independence, support, and downstream consequence. One central target can have enormous reach if many things depend on it. Many listed examples can have low reach if they are minor or only superficially connected.

Correctness gate:
If the central new claim is false, inconsistent, or ruled out by established constraints, the score should be low unless the manuscript establishes a clearly separable correct result that remains valuable without the failed claim. A small repairable error should lower confidence, not erase a durable contribution. A fatal central error with no substantial surviving contribution should receive a very low score.

Do not give credit for later historical influence, later corrected descendants, famous authorship, or results established elsewhere. Score only what is present in this manuscript.

For review articles, perspective pieces, or summaries, score the manuscript for its own synthesis, critique, organization, conceptual reframing, or new argument. Do not assign it the score of the primary research it summarizes unless it adds a new derivation, proof, classification, framework, or explanatory structure.

Input grounding matters:
Imported inputs are not all equal. A result derived from established theories, strong measurements, standard definitions, or mathematical theorems is more broadly grounded than a result that depends on a speculative framework, optional ontology, tunable parameter, or weak analogy. A paper can be excellent inside a framework, but if its importance depends on that framework being correct, make the conditionality explicit and reflect it in the broad-field score and final classification.

Framework independence is one form of generality. A result that survives across frameworks is broader than a result that only works inside one unestablished framework. A framework-internal breakthrough may be a framework-defining advance without being field-defining for broader science.

Reformulations and simple identities:
A compact identity, reformulation, reparameterization, representation, or organizing perspective can be scientifically important if it identifies a useful concept, variable, representation, invariant, state space, abstraction, mechanism, measurement, or organizing principle; removes ambiguity; unifies targets; produces a new derivation; separates previously conflated mechanisms; improves prediction or measurement; or gives new calculational, experimental, mathematical, or methodological leverage.

Do not dismiss a result merely because the algebra is simple. But do not reward relabeling unless it changes what can be derived, explained, predicted, measured, computed, constrained, organized, or ruled out.

Before scoring, explicitly identify:
1. the central new claim;
2. what is genuinely established inside the manuscript;
3. what is imported;
4. the direct explanatory targets;
5. the model-space or theory-space variants;
6. whether one mechanism genuinely connects the targets;
7. whether the key inputs are established, speculative, or framework-conditional;
8. whether the central claim is correct, locally flawed, uncertain, or fatally flawed;
9. the strongest case for importance;
10. the strongest objection;
11. what would most raise or lower the score.

Scoring guide:
0-10: fatal central error, empty contribution, or no real scientific merit.
10-30: seriously flawed, mostly unsupported, or wrong but with a small surviving insight.
30-50: coherent but weak, mostly speculative, mostly pedagogical, mostly summary, or mostly restatement.
50-70: useful clarification or limited contribution.
70-85: strong niche contribution or clearly above-average research.
85-94: major specialty advance with strong correctness, originality, support, and earned explanatory reach.
95-98: field-defining or framework-defining result with exceptional correctness, originality, support, and explanatory reach.
99-100: historic, paradigm-shifting, maximally convincing result.

Use the full range. Most ordinary papers should not be above 85. Scores above 90 should require unusually strong correctness, originality, support, and earned explanatory reach. Broad claims without support should not raise the score.

Classifications:
- field-defining advance
- framework-defining advance
- major specialty advance
- strong niche contribution
- useful clarification
- elegant repackaging
- not yet convincing

Use "framework-defining advance" when the paper is foundational inside a candidate framework or research program, but broader scientific consequence depends substantially on whether that framework is correct or physically realized.

Use "field-defining advance" only when the manuscript changes central concepts, methods, equations, constraints, or organizing principles of the comparison cohort and has strong grounding beyond a narrowly insulated framework.

Return valid JSON only with this exact structure. Do not omit summary, correctness, strongestObjection, finalJudgment, bestClassification, or scoreBand.median:

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
  "inputGrounding": "",
  "contributionGroundingType": "",
  "frameworkIndependence": "",
  "hardToVaryAssessment": "",
  "manuscriptOriginalContribution": "",
  "survivingContributionIfFlawed": "",
  "novelty": "",
  "noveltyConfidence": 0.0,
  "internalTechnicalTraction": "",
  "economy": "",
  "explanatoryTargetBreadth": "",
  "theorySpaceBreadth": "",
  "scopeDepth": "",
  "unifyingPower": "",
  "frameworkConditionality": {
    "level": "low | medium | high",
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
  "scoreConfidence": 0.0,
  "bestClassification": "",
  "oneParagraphVerdict": "",
  "finalJudgment": ""
}

All numeric fields must be numbers, not strings. Use LaTeX for mathematical notation inside strings.`;

const ADJUDICATOR_SYSTEM_INSTRUCTION = `You are the final scientific review adjudicator.

You receive an anonymous manuscript plus two independent reviews produced from the same review prompt.

Read the manuscript yourself first. Then audit both reviews. Do not merely average their scores.

Your task:
- identify whether either review found a fatal correctness issue;
- decide whether the manuscript itself establishes the claimed contribution;
- check framework conditionality and input grounding;
- check whether direct targets, imported inputs, theory-space variants, and mechanism-sharing were handled correctly;
- decide the final score band, final classification, score stability, comparison cohort, and public verdict;
- make sure the final classification matches the reasoning.

Use the same scoring guide as the review passes. Scores above 90 require unusually strong correctness, originality, support, and earned explanatory reach. Broad claims without support should not raise the score.

Score stability should reflect disagreement between the two independent scores and whether the disagreement comes from real ambiguity or a likely bad pass:
- high: scores and reasoning broadly agree;
- medium: modest score disagreement or some interpretive tension;
- low: large score disagreement or materially different correctness assessments.

Treat invalid, empty, or score-0-without-reasoning reviews as failed generations. If both reviews are valid, adjudicate between them. If one review is clearly defective, explain that in internalCalibrationNotes and rely more on the valid review plus your own reading of the manuscript.

Return valid JSON only with this exact structure:

{
  "finalComparisonCohort": "",
  "finalBroadField": "",
  "finalSpecialtyField": "",
  "finalSummary": "",
  "individualScores": [],
  "scoreRange": 0,
  "scoreStability": "high | medium | low",
  "mainAgreements": [],
  "mainDisagreements": [],
  "fatalObjectionPresent": false,
  "fatalObjectionAssessment": "",
  "inputGroundingAssessment": "",
  "contributionGroundingType": "",
  "frameworkIndependenceAssessment": "",
  "hardToVaryAssessment": "",
  "frameworkConditionalityAssessment": "",
  "originalContributionAssessment": "",
  "survivingContributionIfFlawed": "",
  "laterInfluenceOrExternalResultRisk": "",
  "finalClassification": "",
  "finalScoreBand": {
    "low": 0,
    "median": 0,
    "high": 0
  },
  "finalScoreConfidence": 0.0,
  "publicOneParagraphVerdict": "",
  "internalCalibrationNotes": ""
}

All numeric fields must be numbers, not strings. Output valid JSON only.`;

const LEGACY_GROUNDING_LADDER_PROMPT = `You are reviewing an anonymous scientific manuscript from its contents alone.

Ignore author identity, institution, venue, citation counts, publication status, historical fame, and later influence. If any of that information appears in the text, ignore it. Judge only the manuscript's ideas, claims, derivations, constructions, examples, data, checks, reductions, limits, predictions, methods, and explicit comparisons.

Do not defer to human expert consensus. Your task is to give the best model-based scientific judgment under this review protocol.

Do not favor any particular theory, framework, research program, vocabulary, authorial style, or previously submitted manuscript. Reward only what is supported by the manuscript itself.

You may use technical background knowledge to assess correctness, novelty, overlap with known ideas, and whether claims conflict with established constraints. But do not use fame, citation history, author prestige, venue, popularity, or later historical influence as evidence for importance.

Scientific merit is grounded in reliable explanatory reach from well-grounded, hard-to-vary inputs.

Science aims to explain, constrain, predict, compute, organize, rule out, or enable understanding over meaningful targets. A manuscript is more scientifically valuable when it changes understanding over a larger or more central target set using fewer, firmer, and less arbitrary primitive commitments. In short: good science explains more with less.

Generality is not merely how many examples are listed. Generality includes:
- earned target reach: how many meaningful targets are explained, constrained, predicted, computed, organized, enabled, or ruled out;
- framework independence: how much the result survives outside a narrow or speculative framework;
- input grounding: how established, necessary, and technically secure the manuscript's imported assumptions are;
- hard-to-vary structure: whether the explanation is tightly constrained rather than adjustable by arbitrary choices.

A result has greater scientific generality when it follows from established theories, strong measurements, standard mathematical principles, or unavoidable consistency conditions, rather than from optional ontologies, tunable model choices, speculative frameworks, or easy-to-vary assumptions.

Targets should be understood broadly. They may be physical phenomena, observations, regimes, systems, equations, theorem families, structures, datasets, instruments, algorithms, mechanisms, tasks, model classes, experimental discriminations, or downstream research questions.

A result can be highly general by explicitly treating many distinct targets, or by treating one central target whose consequences propagate to many targets. A theorem can be valuable because it constrains a broad class of systems. An experiment can be valuable because it decides between broad explanations. An instrument or dataset can be valuable because it opens or constrains a large research domain. A negative result can be valuable because it rules out an important hypothesis or class of models.

In every case, ask: if the manuscript is correct, how much of the target space changes? How many phenomena, systems, theories, methods, calculations, predictions, technologies, or research questions are newly explained, constrained, simplified, organized, enabled, or ruled out?

Distinguish direct target coverage from downstream target reach.

Direct explanatory targets are phenomena, regimes, examples, theorem families, systems, observables, datasets, organisms, mechanisms, structures, tasks, or problem classes that the manuscript explicitly analyzes, explains, predicts, derives results for, computes, proves, constrains, classifies, constructs, or experimentally tests.

Downstream target reach is the broader set of phenomena, systems, theories, methods, calculations, predictions, technologies, or research questions whose understanding would change if the manuscript is correct.

Do not merely count targets. Weight targets by centrality, independence, depth, support, and downstream consequence. A paper with one direct target can have enormous explanatory reach if that target is central. A paper with many listed examples can still have low explanatory reach if the examples are minor, weakly supported, or only superficially connected.

Do not equate claimed reach with earned reach. Generality counts only when the manuscript supplies enough derivation, proof, measurement, prediction, constraint, calculation, robustness, classification, construction, or mechanism-sharing to support that reach. Broad language without technical, empirical, mathematical, or methodological contact should not raise the score.

A useful qualitative heuristic is that scientific value rises with correctness, nontriviality, earned target reach, explanatory compression, input grounding, framework independence, hard-to-vary assumptions, and technical, empirical, mathematical, or methodological traction. Do not treat this as a literal arithmetic formula. Use it as a reminder that a paper must be right, nontrivial, supported, well-grounded, and far-reaching to deserve a very high score.

Keep the following diagnostic factors separate during analysis, even though they are correlated in good work:

correctness

originality

nontriviality

input grounding

framework independence

hard-to-vary explanatory structure

internal technical traction

explanatory economy

scope and depth within the stated domain

direct explanatory-target coverage

downstream target reach

model-space/theory-space breadth

unifying power

framework conditionality

breadth of consequences if correct

manuscript-original contribution

surviving contribution if some claim is flawed

Keeping these factors separate does not mean they are independent. They are often strongly correlated. Separating them prevents double-counting and makes clear whether a manuscript is strong because it is correct, broad, deep, original, economical, well-grounded, robust across frameworks, or some combination of these.

First determine the comparison cohort. Use the narrowest serious research cohort that a working expert would naturally use, but also identify the broader adjacent field. The comparison cohort should not be chosen so narrowly that it hides framework conditionality, nor so broadly that it ignores the paper's actual technical context.

If the manuscript belongs to a speculative, minority, or framework-dependent research program, do not automatically penalize it. Instead, make the conditionality explicit. Evaluate both its merit inside its natural technical cohort and how far its earned explanatory reach propagates into the broader adjacent field.

Also evaluate input grounding. Imported inputs are not all equal. A manuscript whose central claims rest mainly on strongly established equations, measurements, mathematical theorems, or widely confirmed frameworks is differently grounded from a manuscript whose central claims rest on speculative program-specific assumptions, controversial interpretive premises, unvalidated models, optional ontologies, adjustable parameters, or fragile empirical inputs. Do not treat input grounding as sociology or popularity. Treat it as the evidential and technical status of the assumptions on which the manuscript depends.

Before scoring, classify the manuscript's contribution-grounding type. Choose one or more:

verified explanatory framework;

new result from established inputs;

new result from a minimal hard-to-vary assumption;

framework-internal result;

speculative predictive proposal;

ad hoc or easy-to-vary model;

failed central model with surviving contribution;

fatal central error;

central theorem or proof;

decisive experiment or measurement;

exact calculation;

method, instrument, or dataset;

review or synthesis;

conceptual clarification.

Use these meanings:

Verified explanatory framework: the manuscript introduces or establishes a framework or mechanism with novel predictions or consequences that are verified or strongly confirmed.

New result from established inputs: the manuscript derives a new explanation, structure, theorem, mechanism, prediction, constraint, or classification from already established theories, measurements, definitions, or mathematical principles, without major new speculative assumptions.

New result from a minimal hard-to-vary assumption: the manuscript adds a new assumption, but the assumption is simple, necessary, independently motivated, tightly constrained, and difficult to vary without breaking the explanation.

Framework-internal result: the manuscript proves or derives something important inside a candidate framework or research program whose core assumptions are not yet established.

Speculative predictive proposal: the manuscript introduces new assumptions or mechanisms to produce new predictions or consequences, where those assumptions are not yet established but may be testable.

Ad hoc or easy-to-vary model: the manuscript changes parameters, adds mechanisms, or selects assumptions mainly to obtain a desired output, without showing that those choices are necessary, unique, natural, or hard to vary.

Failed central model with surviving contribution: the manuscript's central model or conclusion fails, but it contains a separable method, diagnostic, calculation, representation, or partial insight that remains useful.

Fatal central error: the central claim is false, inconsistent, ruled out, or unsupported, with no substantial surviving contribution.

When scoring, do not treat all new assumptions equally. Ask whether each new assumption is forced, natural, simple, independently motivated, hard to vary, and necessary for the result. A paper that derives a new broad result from established inputs usually deserves more broad-field credit than a paper that reaches a similarly broad result by adding speculative or easy-to-vary assumptions.

A framework-internal result can be excellent inside its framework. But if the framework's core assumptions are not established, the review must distinguish conditional importance inside the framework from established broad scientific value. A paper can be framework-defining without being field-defining for broader science.

A paper using highly established inputs can receive broad-field credit more directly, because fewer speculative assumptions must be true for its conclusions to matter.

Correctness is a gate on scientific value, but apply it with judgment.

Distinguish among three cases:

1. Local or repairable errors. If the manuscript contains a small mistake, sign error, missing factor, limited edge-case failure, or other repairable flaw, and the main idea, method, proof strategy, dataset, construction, or explanatory structure survives essentially intact, do not erase the paper's value. Lower correctness confidence and explain the needed repair.

2. Separable surviving contribution. If the manuscript's stated conclusion is partly wrong, but it establishes a separable method, theorem, diagnostic, dataset, construction, representation, mechanism, or perspective that remains correct and useful without the failed conclusion, score the surviving contribution. Do not give the paper credit for later corrected results that are not present in the manuscript; credit only what the manuscript itself establishes or makes technically available.

3. Fatal central error. If the manuscript's central new claim, model, derivation, or empirical interpretation is false, inconsistent, or ruled out by established constraints, and no substantial separable contribution survives, the score should be low no matter how broad or exciting the claim would be if true.

Later historical influence, later corrected descendants, or subfield catalysis should not rescue the intrinsic score. If a later paper fixes the idea and establishes the correct result, that later paper earns credit for the correction. The original manuscript can receive credit only for durable content that is actually present in it. A separate historical or trailblazer score may be tracked outside this intrinsic scientific review, but it is not part of this score.

Judge what the manuscript itself establishes. Do not credit results that are merely cited, summarized, or reported as if they were derived inside the manuscript.

For review articles, perspective pieces, or summaries, score the manuscript for its own synthesis, clarity, critique, organization, conceptual reframing, or new argument. Do not assign the score of the underlying primary research unless the review itself adds a new derivation, proof, classification, framework, or explanatory structure.

Definitions:

Imported inputs are assumptions, definitions, known laws, prior results, datasets, methods, formulas, models, algorithms, measurements, conventions, or external frameworks used by the manuscript but not themselves explained, derived, justified, or newly established by it.

Model-space variants, reported in the theorySpaceVariants field, are alternative theories, dimensions, parameter families, model classes, organisms, datasets, architectures, mechanisms, formalisms, experimental regimes, or problem settings across which the manuscript extends the same idea, method, derivation, or explanatory template.

Mechanism-sharing asks whether the same underlying idea, method, derivation, causal mechanism, algorithm, mathematical structure, or explanatory principle genuinely accounts for multiple direct targets, or whether the manuscript merely reuses notation, terminology, or presentation style across them.

Do not count an imported input as a direct explanatory target. Do not count multiple model-space variants as multiple substantive targets unless they produce distinct consequences, constraints, predictions, derivations, mechanisms, applications, empirical checks, classifications, or calculations.

A compact identity, reformulation, reparameterization, representation, or unifying perspective can be scientifically important if it identifies a useful concept, variable, representation, invariant, state space, abstraction, mechanism, measurement, or organizing principle; removes ambiguity; exposes an invariant; unifies targets; produces a new derivation; separates previously conflated mechanisms; improves prediction or measurement; or gives new calculational, experimental, mathematical, or methodological leverage.

Do not reward relabeling unless it produces genuine explanatory, technical, empirical, mathematical, or methodological gain. A simple identity should not be dismissed merely because the algebra is simple; many important advances identify the right concepts, variables, representations, abstractions, measurements, or invariants, or reveal that apparently different cases are the same structure. But if a manuscript only renames known formulas without changing what can be derived, explained, predicted, measured, computed, constrained, organized, or ruled out, classify it as elegant repackaging rather than a major contribution.

Every review must include the strongest case for importance and the strongest objection. The objection should not be artificially hostile; it should be the most serious technically fair concern.

Scoring:

The main score is an anchored scientific merit score. It answers: how strong is this manuscript as a scientific contribution, judging only content and support, after considering correctness, originality, input grounding, framework independence, earned explanatory reach, hard-to-vary structure, technical traction, and the proper comparison cohort?

In scoring, weigh both local achievement and explanatory reach. A paper that is correct but narrow may be valuable; a paper that unifies many targets with a simple, well-supported principle may be much more valuable. But breadth only counts when it is earned by real mechanism-sharing, derivation, prediction, measurement, constraint, proof, calculation, robustness, classification, or explanatory compression. Broad claims without support should not raise the score.

Also provide:

specialty-relative score: strength inside the natural technical comparison cohort;

broad-field score: strength relative to the broader adjacent field;

cross-field consequence score: how much the result would matter outside the immediate field if correct;

framework conditionality: whether the importance depends on accepting a specific framework;

input grounding assessment: whether the manuscript's imported assumptions are highly established, moderately supported, standard theoretical but not directly verified, framework-conditional, speculative, or weakly supported;

contribution-grounding type: what kind of scientific object the manuscript establishes.

The headline scoreBand should not be a pure narrow-specialty score. It should reflect the manuscript's intrinsic merit after considering specialty achievement, broad-field reach, input grounding, framework independence, correctness risk, originality, and whether the contribution is established in the manuscript itself.

Anchored 0-100 scientific merit scale:

0: wrong, empty, plagiarized, or no real scientific contribution.

25: technically coherent but mostly a restatement, minor exercise, or very limited clarification.

50: average serious research contribution in the relevant comparison cohort.

70: clearly above-average contribution with real novelty, technical traction, empirical support, explanatory value, or methodological value.

85: strong paper; a notable field-level contribution or major specialty advance if correct.

95: major result with field-shaping potential because it has strong correctness, support, nontriviality, originality, earned explanatory reach, hard-to-vary structure, and adequate input grounding for its claimed scope.

99: foundational or paradigm-shifting result.

100: reserve for an essentially historic, maximally convincing result.

Do not describe the score as a literal percentile over all papers ever published. The score is a calibrated merit judgment against the chosen comparison cohort, adjusted by broad-field reach, input grounding, framework independence, hard-to-vary structure, and correctness risk.

Scale instructions:

intrinsicTechnicalScore, explanatoryTargetBreadthScore, theorySpaceBreadthScore, and breadthOfImpactScore are on a 0-10 scale.

specialtyRelativeScore, broadFieldRelativeScore, crossFieldConsequenceScore, and every number inside scoreBand are on a 0-100 scale.

Do not use a 0-10 scale for scoreBand.

For a paper in the nineties, scoreBand should look like {"low": 90, "median": 93, "high": 96}, not {"low": 9, "median": 9.3, "high": 9.6}.

scoreBand is this reviewer's uncertainty interval around its own anchored scientific merit score. The median is the reviewer's actual headline score.

Formatting instructions:

Wrap inline mathematical expressions in $...$.

Wrap display equations in $$...$$.

Because the answer must be JSON, escape every LaTeX backslash as a double backslash inside strings.

Use the full range.

Before final scoring, explicitly consider:

1. What is genuinely derived, demonstrated, measured, predicted, constructed, computed, classified, ruled out, or established inside the manuscript?

2. What is imported?

3. How well-grounded are the imported inputs? Are they established theory, strong measurements, mathematical theorems, standard definitions, standard theoretical but not directly verified, framework-specific assumptions, speculative postulates, optional ontologies, tunable parameters, or weak analogies?

4. How dependent is the main claim on unestablished or speculative inputs?

5. What new assumptions are added, and are they forced, natural, simple, independently motivated, hard to vary, and necessary for the result?

6. How framework-independent is the result? What survives if the manuscript's most framework-specific input is false?

7. How correct is the central new claim? Are any errors local and repairable, separable from the main contribution, or fatal?

8. If a central claim fails, what contribution survives inside the manuscript itself?

9. Is the manuscript original research, a review, a perspective, a synthesis, a method paper, an empirical paper, a theoretical paper, a proof, or a dataset/instrument paper? Is the score based on what this manuscript itself contributes?

10. What contribution-grounding type best describes the manuscript?

11. How much explanatory compression does the manuscript achieve?

12. Does it explain more with less, or merely rename/repackage?

13. How broad are the direct targets actually explained?

14. How broad is the downstream target reach if the manuscript is correct?

15. How broad are the model-space or theory-space variants genuinely handled?

16. Does the same mechanism, method, representation, or structure do real work across targets?

17. Does the manuscript earn its claimed generality, or merely assert it?

18. What evidence, derivation, counterexample, observation, or calculation would overturn the manuscript's central claim? Would that overturn accepted background science, or mainly the manuscript's new proposal?

19. What would most raise the score?

20. What would most lower the score?

21. Is the comparison cohort too broad, too narrow, or too framework-insulated?

22. Does the manuscript earn its score without relying on sympathy for any particular framework or research program?

When assigning explanatoryTargetBreadthScore, score earned explanatory reach, not raw example count. Weight targets by centrality, independence, breadth, downstream consequence, degree of support, and whether the same mechanism genuinely explains or constrains them.

When assigning theorySpaceBreadthScore, score how far the manuscript extends across theories, dimensions, parameter families, model classes, organisms, datasets, architectures, formalisms, experimental regimes, or problem settings. Reward theory-space breadth most when it produces new consequences, robustness, constraints, predictions, structural necessity, or nontrivial checks.

When assigning breadthOfImpactScore, ask how far the earned explanatory reach propagates beyond the immediate technical specialty. Do not hide framework conditionality or weak input grounding inside this number; state them explicitly.

When assigning broadFieldRelativeScore and crossFieldConsequenceScore, account for input grounding and framework independence. If the result depends on highly established inputs, broad-field reach can be credited more directly. If the result depends on speculative or framework-specific inputs, distinguish its conditional importance inside the framework from its broader scientific consequence.

For bestClassification, choose one:

field-defining advance

framework-defining advance

major specialty advance

strong niche contribution

useful clarification

elegant repackaging

not yet convincing

Classification guidance:

field-defining advance: changes central concepts, methods, equations, constraints, or organizing principles of the comparison cohort and has strong grounding and broad consequence beyond a narrowly insulated framework.

framework-defining advance: defines or transforms a specific technical framework or research program, but broader scientific consequence depends substantially on whether that framework is correct, established, or physically realized.

major specialty advance: gives a substantial new result, mechanism, derivation, framework, unification, method, or constraint that changes how an important specialty understands important targets.

strong niche contribution: deep, correct, and genuinely clarifying within a focused domain.

useful clarification: improves understanding but is mostly explanatory, organizational, pedagogical, or incremental.

elegant repackaging: clear and economical but does not establish a substantially new result, mechanism, or explanatory gain.

not yet convincing: central claims are unsupported, incorrect, too speculative, or technically too weak.

Score-consistency rule:

Ensure the final classification matches the text and scores. If the review says the manuscript is highly correct, highly economical, strongly unifying, original, well-grounded, framework-independent, and has strong earned target reach, the classification should not be much lower than the stated evidence supports unless the strongest objection clearly undermines the central claim.

Conversely, if the manuscript has broad claims but weak derivations, low correctness, weak input grounding, mostly speculative support, easy-to-vary assumptions, high framework dependence, or no original contribution inside the manuscript, do not give a high classification merely because the claim would be important if true.

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
  "inputGrounding": "",
  "contributionGroundingType": "",
  "frameworkIndependence": "",
  "hardToVaryAssessment": "",
  "manuscriptOriginalContribution": "",
  "survivingContributionIfFlawed": "",
  "novelty": "",
  "noveltyConfidence": 0.0,
  "internalTechnicalTraction": "",
  "economy": "",
  "explanatoryTargetBreadth": "",
  "theorySpaceBreadth": "",
  "scopeDepth": "",
  "unifyingPower": "",
  "frameworkConditionality": {
    "level": "low | medium | high",
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
  "scoreConfidence": 0.0,
  "bestClassification": "",
  "oneParagraphVerdict": "",
  "finalJudgment": ""
}

All numeric fields must be numbers, not strings.

Use LaTeX for mathematical notation inside strings.

Output valid JSON only.`;

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

const MODEL_CALL_ATTEMPTS = 4;

function stripControlChars(text: string) {
  return text.replace(/\x00/g, "").replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  try {
    const parsed = JSON.parse(raw);
    const apiError = parsed?.error;
    if (apiError) {
      return [
        apiError.code ? `code ${apiError.code}` : "",
        apiError.status,
        apiError.message,
      ].filter(Boolean).join(": ");
    }
  } catch {}
  return raw;
}

function isTransientModelError(error: unknown) {
  const message = errorMessage(error).toLowerCase();
  return (
    /\b(429|500|502|503|504)\b/.test(message) ||
    /resource[_ ]exhausted|unavailable|overloaded|rate limit|quota|temporar|deadline|internal/.test(message)
  );
}

function retryDelayMs(attempt: number, error: unknown) {
  const transientDelays = [2500, 9000, 25000];
  const normalDelays = [1200, 4800, 12000];
  const delays = isTransientModelError(error) ? transientDelays : normalDelays;
  return (delays[attempt - 1] ?? 12000) + Math.floor(Math.random() * 750);
}

async function withModelRetries<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MODEL_CALL_ATTEMPTS; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === MODEL_CALL_ATTEMPTS) break;
      await sleep(retryDelayMs(attempt, error));
    }
  }
  const prefix = isTransientModelError(lastError) ? "Transient model error: " : "";
  throw new Error(`${prefix}${label} failed after ${MODEL_CALL_ATTEMPTS} attempts: ${errorMessage(lastError)}`);
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function firstString(values: unknown[], fallback = "") {
  for (const value of values) {
    const text = asString(value);
    if (text) return text;
  }
  return fallback;
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

function firstStringArray(values: unknown[]) {
  for (const value of values) {
    const items = asStringArray(value);
    if (items.length > 0) return items;
  }
  return [];
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
  if (fallback === "field-defining advance" && classification === "framework-defining advance") {
    return classification;
  }

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

function firstNumber(values: unknown[]) {
  for (const value of values) {
    const raw = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isFinite(raw)) return raw;
  }
  return null;
}

function normalizeScoreBandWithFallback(source: Record<string, unknown>) {
  const band = normalizeScoreBand(source.scoreBand);
  const explicitScore = firstNumber([
    source.score,
    source.overallScore,
    source.overallIntrinsicScore,
    source.scientificMeritScore,
    source.finalScore,
  ]);

  if (band.low === 0 && band.median === 0 && band.high === 0 && explicitScore != null) {
    const score = Math.round(Math.max(0, Math.min(100, explicitScore)));
    return { low: score, median: score, high: score };
  }

  return band;
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

  const normalizedScoreBand = normalizeScoreBandWithFallback(source);
  const normalizedSpecialtyScore = Math.round(asNumber(source.specialtyRelativeScore, normalizedScoreBand.median, 0, 100));
  const normalizedClassification =
    normalizeClassification(firstString([
      source.bestClassification,
      source.classification,
      source.finalClassification,
      source.category,
    ])) || classificationFallbackFromScore(normalizedScoreBand.median);
  const alignedClassification = alignClassificationToScore(normalizedClassification, normalizedScoreBand.median);

  return {
    title: "anonymized manuscript",
    authorName: "anonymized",
    comparisonCohort: firstString([source.comparisonCohort, source.comparison_cohort, source.cohort]),
    broadField: firstString([source.broadField, source.broad_field, source.field]),
    specialtyField: firstString([source.specialtyField, source.specialty_field, source.subfield]),
    subfields: firstStringArray([source.subfields, source.subFields, source.sub_fields]),
    paperType: firstString([source.paperType, source.paper_type, source.manuscriptType]),
    summary: firstString([source.summary, source.abstract, source.overview, source.reviewSummary, source.finalSummary]),
    centralClaim: firstString([source.centralClaim, source.central_claim, source.mainClaim, source.claim]),
    coverageLedger: {
      directTargets: firstStringArray([coverage.directTargets, source.directTargets, source.direct_targets]),
      importedInputs: firstStringArray([coverage.importedInputs, source.importedInputs, source.imported_inputs]),
      theorySpaceVariants: firstStringArray([
        coverage.theorySpaceVariants,
        source.theorySpaceVariants,
        source.theory_space_variants,
        source.modelSpaceVariants,
      ]),
      mechanismSharingAssessment: firstString([
        coverage.mechanismSharingAssessment,
        source.mechanismSharingAssessment,
        source.mechanism_sharing_assessment,
      ]),
    },
    establishedResults: firstStringArray([source.establishedResults, source.established_results]),
    interpretiveClaims: firstStringArray([source.interpretiveClaims, source.interpretive_claims]),
    speculativeClaims: firstStringArray([source.speculativeClaims, source.speculative_claims]),
    correctness: firstString([
      source.correctness,
      source.correctnessAnalysis,
      source.technicalCorrectness,
      source.validity,
    ]),
    inputGrounding: firstString([source.inputGrounding, source.input_grounding, source.grounding]),
    contributionGroundingType: firstString([
      source.contributionGroundingType,
      source.contribution_grounding_type,
      source.groundingType,
    ]),
    frameworkIndependence: firstString([
      source.frameworkIndependence,
      source.framework_independence,
      source.frameworkIndependenceAssessment,
    ]),
    hardToVaryAssessment: firstString([source.hardToVaryAssessment, source.hard_to_vary_assessment]),
    manuscriptOriginalContribution: firstString([
      source.manuscriptOriginalContribution,
      source.originalContribution,
      source.manuscript_original_contribution,
    ]),
    survivingContributionIfFlawed: firstString([
      source.survivingContributionIfFlawed,
      source.survivingContribution,
      source.surviving_contribution_if_flawed,
    ]),
    novelty: firstString([source.novelty, source.originality]),
    noveltyConfidence: asNumber(source.noveltyConfidence, 0.95, 0, 1),
    internalTechnicalTraction: firstString([source.internalTechnicalTraction, source.technicalTraction]),
    economy: firstString([source.economy, source.explanatoryEconomy]),
    explanatoryTargetBreadth: firstString([source.explanatoryTargetBreadth, source.targetBreadth]),
    theorySpaceBreadth: firstString([source.theorySpaceBreadth, source.modelSpaceBreadth]),
    scopeDepth: firstString([source.scopeDepth, source.depth]),
    unifyingPower: firstString([source.unifyingPower, source.unification]),
    frameworkConditionality: {
      level: normalizeFrameworkLevel(firstString([framework.level, source.frameworkConditionalityLevel])),
      explanation: firstString([
        framework.explanation,
        source.frameworkConditionality,
        source.frameworkConditionalityAssessment,
        source.framework_conditionality,
      ]),
    },
    strongestCaseForImportance: firstString([
      source.strongestCaseForImportance,
      source.strongestCase,
      source.caseForImportance,
    ]),
    strongestObjection: firstString([
      source.strongestObjection,
      source.mainObjection,
      source.objection,
      source.weaknesses,
    ]),
    decisiveCheck: firstString([source.decisiveCheck, source.keyCheck, source.keyTest]),
    whatWouldRaiseScore: firstString([source.whatWouldRaiseScore, source.raiseScore, source.scoreUpside]),
    whatWouldLowerScore: firstString([source.whatWouldLowerScore, source.lowerScore, source.scoreDownside]),
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
    oneParagraphVerdict: firstString([
      source.oneParagraphVerdict,
      source.publicVerdict,
      source.verdict,
      source.publicOneParagraphVerdict,
    ]),
    finalJudgment: firstString([
      source.finalJudgment,
      source.overallEvaluation,
      source.overall_evaluation,
      source.evaluation,
      source.finalVerdict,
      source.verdict,
    ]),
  };
}

function individualReviewReasoningText(review: IndividualReview) {
  return [
    review.summary,
    review.centralClaim,
    review.correctness,
    review.inputGrounding,
    review.novelty,
    review.strongestCaseForImportance,
    review.strongestObjection,
    review.oneParagraphVerdict,
    review.finalJudgment,
  ].filter(Boolean).join("\n").trim();
}

function validateIndividualReview(review: IndividualReview) {
  const reasoningText = individualReviewReasoningText(review);
  const score = review.scoreBand.median;
  const hasCoreReasoning =
    reasoningText.length >= 80 &&
    Boolean(review.correctness || review.finalJudgment || review.oneParagraphVerdict || review.summary);

  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new Error("Generated review did not include a valid 0-100 score.");
  }

  if (!hasCoreReasoning) {
    throw new Error("Generated review was blank or missing substantive reasoning.");
  }

  if (score === 0 && reasoningText.length < 180) {
    throw new Error("Generated review returned score 0 without enough reasoning; treating as failed generation.");
  }
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

function reviewInputText(input: ReviewInput) {
  return typeof input === "string" ? input : input.text;
}

function reviewInputParts(input: ReviewInput) {
  if (typeof input === "string") return [{ text: input }];
  return [
    { text: input.text },
    {
      inlineData: {
        mimeType: input.mimeType || "application/pdf",
        data: input.pdfBase64,
      },
    },
  ];
}

function blindReviewInput(input: ReviewInput): ReviewInput {
  if (typeof input === "string") return blindManuscriptText(input);
  return {
    ...input,
    text: `${blindManuscriptText(input.text)}

The manuscript is attached as a PDF because plain text extraction was not reliable. Read the attached PDF directly. If author names, affiliations, venue names, or citation/reception signals appear in the PDF, ignore them under the anonymity rules. Base the review only on the manuscript's scientific content.`,
  };
}

export function buildPdfFallbackText(hints: MetadataHints) {
  return [
    "Plain-text extraction from this PDF was not reliable, so the manuscript PDF is attached for Gemini-native reading.",
    hints.fileName ? `Filename hint: ${hints.fileName}` : "",
    hints.pdfTitle ? `Embedded PDF title hint: ${hints.pdfTitle}` : "",
    hints.pdfAuthor ? `Embedded PDF author hint: ${hints.pdfAuthor}` : "",
  ].filter(Boolean).join("\n");
}

async function callGpt(prompt: string, input: ReviewInput) {
  if (typeof input !== "string") {
    throw new Error("OpenAI review currently requires extractable PDF text. Try Gemini Pro x2 + Adjudicator for this PDF.");
  }
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
  input: ReviewInput,
  geminiModel = GEMINI_META_MODEL,
  options?: { maxOutputTokens?: number; includeThoughts?: boolean },
) {
  const includeThoughts = options?.includeThoughts ?? false;
  return withModelRetries(geminiModel, async () => {
    const response = await geminiAI.models.generateContent({
      model: geminiModel,
      contents: [{ role: "user", parts: reviewInputParts(input) }],
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

async function runModel(prompt: string, input: ReviewInput, model: ReviewModel, geminiModel = GEMINI_META_MODEL) {
  return model === "gemini" ? callGemini(prompt, input, geminiModel) : callGpt(prompt, input);
}

async function runIndividualPass(
  prompt: string,
  input: ReviewInput,
  _model: ReviewModel,
  index: number,
): Promise<IndividualPassResult> {
  const { parsed, thinkingText } = await callGemini(
    prompt,
    input,
    GEMINI_PASS_MODEL,
    { maxOutputTokens: 16384, includeThoughts: false },
  );
  const review = normalizeIndividualReview(parsed);
  validateIndividualReview(review);
  return {
    review,
    thinkingText,
    index,
    modelName: GEMINI_PASS_MODEL,
  };
}

function pickRepresentativeReview(reviews: IndividualReview[], medianScore: number) {
  return [...reviews].sort((a, b) => {
    const aDelta = Math.abs(a.scoreBand.median - medianScore);
    const bDelta = Math.abs(b.scoreBand.median - medianScore);
    return aDelta - bDelta;
  })[0];
}

function medianScore(scores: number[]) {
  const sorted = [...scores].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[midpoint];
  return Math.round((sorted[midpoint - 1] + sorted[midpoint]) / 2);
}

function normalizeAggregateReview(input: unknown, fallbackScores: number[], fallbackReview: IndividualReview): AggregateReview {
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const individualScores = Array.isArray(source.individualScores)
    ? (source.individualScores as unknown[]).map((item) => Math.round(asNumber(item, 0, 0, 100))).filter((item) => Number.isFinite(item))
    : fallbackScores;
  const usableScores = individualScores.length > 0 ? individualScores : fallbackScores;
  const defaultLow = Math.min(...usableScores);
  const defaultHigh = Math.max(...usableScores);
  const defaultMedian = medianScore(usableScores);
  const parsedBand = normalizeScoreBand(source.finalScoreBand);
  const finalScoreBand = parsedBand.low === 0 && parsedBand.median === 0 && parsedBand.high === 0
    ? { low: defaultLow, median: defaultMedian, high: defaultHigh }
    : parsedBand;
  const scoreRange = Math.round(asNumber(source.scoreRange, finalScoreBand.high - finalScoreBand.low, 0, 100));
  const scoreStabilityCandidate = asString(source.scoreStability).toLowerCase();
  const scoreStability: ScoreStability =
    scoreStabilityCandidate === "high" || scoreStabilityCandidate === "medium" || scoreStabilityCandidate === "low"
      ? scoreStabilityCandidate
      : rangeToStability(scoreRange);
  const classification =
    normalizeClassification(source.finalClassification) ||
    fallbackReview.bestClassification ||
    classificationFallbackFromScore(finalScoreBand.median);

  return {
    finalComparisonCohort: asString(source.finalComparisonCohort, fallbackReview.comparisonCohort),
    finalBroadField: asString(source.finalBroadField, fallbackReview.broadField),
    finalSpecialtyField: asString(source.finalSpecialtyField, fallbackReview.specialtyField),
    finalSummary: asString(source.finalSummary, fallbackReview.summary),
    individualScores: usableScores,
    scoreRange,
    scoreStability,
    mainAgreements: asStringArray(source.mainAgreements),
    mainDisagreements: asStringArray(source.mainDisagreements),
    fatalObjectionPresent: asBoolean(source.fatalObjectionPresent),
    fatalObjectionAssessment: asString(source.fatalObjectionAssessment),
    inputGroundingAssessment: asString(source.inputGroundingAssessment, fallbackReview.inputGrounding),
    contributionGroundingType: asString(source.contributionGroundingType, fallbackReview.contributionGroundingType),
    frameworkIndependenceAssessment: asString(source.frameworkIndependenceAssessment, fallbackReview.frameworkIndependence),
    hardToVaryAssessment: asString(source.hardToVaryAssessment, fallbackReview.hardToVaryAssessment),
    frameworkConditionalityAssessment: asString(source.frameworkConditionalityAssessment, fallbackReview.frameworkConditionality.explanation),
    originalContributionAssessment: asString(source.originalContributionAssessment, fallbackReview.manuscriptOriginalContribution),
    survivingContributionIfFlawed: asString(source.survivingContributionIfFlawed, fallbackReview.survivingContributionIfFlawed),
    laterInfluenceOrExternalResultRisk: asString(source.laterInfluenceOrExternalResultRisk),
    finalClassification: alignClassificationToScore(classification, finalScoreBand.median),
    finalScoreBand,
    finalScoreConfidence: asNumber(source.finalScoreConfidence, fallbackReview.scoreConfidence, 0, 1),
    publicOneParagraphVerdict: asString(source.publicOneParagraphVerdict, fallbackReview.oneParagraphVerdict || fallbackReview.finalJudgment),
    internalCalibrationNotes: asString(source.internalCalibrationNotes, "Gemini Pro adjudicator reviewed the manuscript and both independent Gemini Pro passes."),
  };
}

function buildAdjudicatorInput(blindedContent: ReviewInput, reviews: IndividualReview[]): ReviewInput {
  const text = JSON.stringify({
    blindedManuscript: reviewInputText(blindedContent),
    independentReviewPasses: reviews.map((review, index) => ({
      passNumber: index + 1,
      score: review.scoreBand.median,
      scoreBand: review.scoreBand,
      classification: review.bestClassification,
      comparisonCohort: review.comparisonCohort,
      broadField: review.broadField,
      specialtyField: review.specialtyField,
      centralClaim: review.centralClaim,
      coverageLedger: review.coverageLedger,
      correctness: review.correctness,
      inputGrounding: review.inputGrounding,
      frameworkConditionality: review.frameworkConditionality,
      strongestCaseForImportance: review.strongestCaseForImportance,
      strongestObjection: review.strongestObjection,
      decisiveCheck: review.decisiveCheck,
      oneParagraphVerdict: review.oneParagraphVerdict,
      finalJudgment: review.finalJudgment,
    })),
  }, null, 2);

  if (typeof blindedContent === "string") return text;
  return { ...blindedContent, text };
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
  paperContent: ReviewInput,
  _model: ReviewModel,
  promptOverride?: string,
): Promise<MultiPassReviewResult> {
  const systemPrompt = promptOverride?.trim() || REVIEW_SYSTEM_INSTRUCTION;
  const blindedContent = blindReviewInput(paperContent);
  const thinkingChunks: string[] = [];

  const passResults: IndividualPassResult[] = [];
  const passFailures: { reason: unknown; index: number }[] = [];
  const maxPassAttempts = REVIEW_PASS_COUNT + 1;

  for (let attempt = 0; passResults.length < REVIEW_PASS_COUNT && attempt < maxPassAttempts; attempt += 1) {
    const index = passResults.length;
    try {
      passResults.push(await runIndividualPass(systemPrompt, blindedContent, "gemini", index));
    } catch (reason) {
      passFailures.push({ reason, index: attempt });
      if (passResults.length === 0 && isTransientModelError(reason)) {
        break;
      }
    }

    if (passResults.length < REVIEW_PASS_COUNT) {
      await sleep(1500 + Math.floor(Math.random() * 600));
    }
  }

  if (passResults.length < REVIEW_PASS_COUNT) {
    const details = passFailures.map(({ reason, index }) => `attempt ${index + 1}: ${errorMessage(reason)}`).join("; ");
    throw new Error(`Review failed: only ${passResults.length} of ${REVIEW_PASS_COUNT} valid independent passes completed after ${maxPassAttempts} attempts. ${details}`);
  }

  const individualReviews = passResults.map((result) => result.review);
  for (const result of passResults) {
    if (result.thinkingText) {
      thinkingChunks.push(`Pass ${result.index + 1} (${result.modelName})\n${result.thinkingText}`);
    }
  }
  for (const { reason, index } of passFailures) {
    thinkingChunks.push(`Discarded failed pass attempt ${index + 1}\n${errorMessage(reason)}`);
  }

  const fallbackScores = individualReviews.map((review) => review.scoreBand.median);
  const fallbackRepresentativeReview = pickRepresentativeReview(individualReviews, medianScore(fallbackScores));
  const { parsed: aggregateParsed, thinkingText: adjudicatorThinking } = await callGemini(
    ADJUDICATOR_SYSTEM_INSTRUCTION,
    buildAdjudicatorInput(blindedContent, individualReviews),
    GEMINI_META_MODEL,
    { maxOutputTokens: 16384, includeThoughts: false },
  );
  const aggregate = normalizeAggregateReview(aggregateParsed, fallbackScores, fallbackRepresentativeReview);
  const representativeReview = pickRepresentativeReview(individualReviews, aggregate.finalScoreBand.median);
  if (adjudicatorThinking) {
    thinkingChunks.push(`Adjudicator (${GEMINI_META_MODEL})\n${adjudicatorThinking}`);
  }
  thinkingChunks.push(aggregate.internalCalibrationNotes);

  return {
    modelName: `${GEMINI_PRO_MODEL} x2 + adjudicator`,
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
      inputGrounding: representativeReview.inputGrounding,
      contributionGroundingType: representativeReview.contributionGroundingType,
      frameworkIndependence: representativeReview.frameworkIndependence,
      hardToVaryAssessment: representativeReview.hardToVaryAssessment,
      manuscriptOriginalContribution: representativeReview.manuscriptOriginalContribution,
      survivingContributionIfFlawed: representativeReview.survivingContributionIfFlawed,
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
  paperContent: ReviewInput,
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
