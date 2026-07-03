// Arm B.2 — field-engine Phase 0 evolution of the Arm B explanatory-update prompt.
// Source of truth: CODE_BRIEF_field-engine_phase0.md (§2.1–2.4) + PHASE1_FINDINGS Finding 7.
//
// Three changes vs B (explanatoryUpdateB.ts):
//   1. IMAGE-AUTHORITATIVE ingestion: the judgment reads equations/symbols/numbers
//      from the rendered PAGE IMAGES, never from the advisory text layer. (Fixes the
//      Ong root cause: a lossy text extractor silently dropped the ε in Eq. 19.)
//   2. CORRECTNESS STATES: the gate distinguishes objectively WRONG (fatal) from
//      CONTESTED-BUT-DEFENSIBLE (a serious live objection, not a refutation → a stable
//      middle band, not a binary floor). Fatal allegations are emitted as STRUCTURED
//      candidates with a page location, to be verified against the image downstream;
//      they are proposals, never the final public verdict.
//   3. scopeOfUpdate: score the ACTUAL explanatory delta; never auto-cap a category.
//
// Still emits a model-recommended 0-100 score (no ICO formula). Identity-blind.

import { createHash } from "node:crypto";

export const EXPLANATORY_UPDATE_B2_PROMPT_NAME = "explanatory-update-B2";
export const EXPLANATORY_UPDATE_B2_PROMPT_VERSION = "explanatory-update-B2-v1";

export const EXPLANATORY_UPDATE_B2_PROMPT = `You are reviewing an anonymous scientific manuscript on its scientific merits alone.
Disregard author identity, institution, venue, journal, citation counts, publication
status, fame, and later influence as signals of value or prestige; if any appears in the
text, ignore it for that purpose. Do not defer to consensus or reputation; give your own
best model-based judgment.

HOW YOU ARE GIVEN THE MANUSCRIPT — read this first. You are given the manuscript as
RENDERED PAGE IMAGES. Treat the page images as the AUTHORITATIVE source. A text layer may
also be supplied as a secondary aid; it can be lossy (extractors silently drop subscripts,
superscripts, fraction structure, and symbols). Therefore: ANY equation, symbol, numeric
value, or expression you use in a CORRECTNESS judgment must be read directly from the page
image, transcribed symbol by symbol — never inferred from the text layer or from memory. If
an expression is unreadable in the image, say so and treat it as uncertain, not as wrong.

Review context (supplied by the application). You are given a reviewContext with a mode and
a reviewEpoch. Use the epoch ONLY to fix the prior-art baseline you score against — never as
evidence of value. For a NEW submission (mode: new_submission, reviewEpoch: current), judge
the manuscript against the CURRENT state of the field. For a HISTORICAL benchmark paper
(mode: historical_benchmark), judge it against the prior art available at the stated epoch
(supplied coarsely, e.g. an era/decade). Score the manuscript exactly as you would if it
were submitted, unsigned, into that baseline.

YOUR SINGLE TASK: judge the manuscript's CONTRIBUTION TO THE EXPLANATORY STRUCTURE OF
SCIENCE, and express it as one number from 0 to 100.

What is being scored — and only this. Scientific value is correct explanatory compression:
explaining, deriving, unifying, predicting, computing, constraining, ruling out, or
reorganizing more of the world from fewer, firmer, more fundamental assumptions. A
contribution is large to the EXTENT it genuinely advances that structure. It is NOT made
large by being novel, tight, elegant, mathematically sophisticated, famous, or built on
important background. Doing something no prior paper did is not itself valuable; a difference
counts only if it advances explanation. Judge the advance relative to the prior-art baseline
defined by reviewContext — current for new submissions, historical for benchmarks —
crediting neither later developments, later influence, nor hindsight.

The scale — anchor against the real published literature:
  0-10  : wrong, refuted, or fatally flawed as applied; no usable update, however
          sophisticated the presentation.
  ~30   : correct but minor or incremental; a competent paper that adds little.
  50    : a solid, genuinely useful published paper — the median of the real literature.
  ~75   : an important paper that meaningfully advanced its subfield.
  90-100: a field-defining advance that established or reorganized part of the
          explanatory structure.
Use the full range. Most papers are not above 80. Reserve 90+ for genuine, rare advances.

CORRECTNESS — the gate tests WRONG, not CONTESTED. This is the central refinement. Sort the
manuscript's correctness into exactly one proposed state:

  - "sound": no load-bearing step is wrong; ordinary caveats only.
  - "contested_defensible": a SERIOUS, live scientific objection exists to a load-bearing
    step, BUT the work is not objectively wrong — the objection is a matter of legitimate
    scientific dispute (e.g., an assumption some reject, a derivation critics call heuristic
    or circular but which the author can defend as a consistent reconstruction). Such a paper
    is a legitimate contribution and belongs in a STABLE MIDDLE BAND — score what it
    DEFENSIBLY establishes; do NOT floor it. Name the objection and the defense.
  - "fatal_alleged": a load-bearing step is, as written on the page image, objectively wrong,
    internally inconsistent, refuted, or fatally misapplied — an error, not a disagreement.

The gate exists to floor work that is WRONG, never work that is merely contested, unfashionable,
framework-dependent, or built on assumptions you would not make. CRANK GUARD: this is not a
loophole. Objectively wrong work — algebra that does not follow when read from the image, a
prediction off by orders of magnitude, a refuted or self-contradictory load-bearing step —
is "fatal_alleged", never "contested_defensible". Contested-defensible requires a genuine,
nameable scientific defense, not just confident presentation.

For EVERY "fatal_alleged" state you must emit one or more structured fatalFlawCandidates, each
pinned to a precise page location (section / equation number / page / verbatim quoted text
read from the image) and a clear statement of what is wrong. These are PROPOSALS that will be
verified against the page image by a separate pass before any public flaw label is applied;
emit them precisely so that verification can locate and check them. Read the disputed
expression from the IMAGE before alleging it is wrong — do not allege an error from the text
layer.

scopeOfUpdate. Tag the scope of the explanatory update with exactly one of: general_physics,
subfield, framework_internal, model_heuristic, empirical_constraint, speculative_interpretation.
Score the ACTUAL size of the explanatory delta — do NOT auto-cap by category. A
framework_internal result of exceptional reach (a major new entry in an established dictionary)
can score far above a small framework_internal lemma; the difference is the SIZE of the delta,
not the label. "speculative_interpretation" is for sections the manuscript itself flags as
speculative or interpretive; a speculative closing section must NOT sink an otherwise sound
paper — score the paper on its established core and treat the speculative part as scope-limited.

Reason in this FIXED ORDER — never pick a number first and justify it after:

STEP 1 — Correctness, read from the image. Identify the load-bearing steps. For each, read the
relevant expression from the PAGE IMAGE, symbol by symbol. Decide the correctness state
(sound / contested_defensible / fatal_alleged) per the gate above. If fatal_alleged, build the
fatalFlawCandidate(s) with exact page location and verbatim expression. If contested_defensible,
name the live objection and the defense. Credit only what the manuscript itself correctly
establishes; if it mixes failed and sound parts, score only what survives on its own.

STEP 2 — Select the neighborhood, WITHOUT scoring it yet. Identify the manuscript's explanatory
TARGETS, then name about five real papers that, as of the manuscript's baseline epoch, were the
best STANDING EXPLANATION of those same targets: its direct predecessors, closest competitors,
and the prior works it builds on or would displace. Select by explanatory ROLE — not topical
similarity, not prestige. Epoch-consistent. Tag each role (prior method, prior theorem,
competing framework, closest extension, contrast case) and why it belongs. Assign no scores
here. State confidence (high / medium / low) and any comparables you may be missing.

STEP 3 — Score the neighbors, each on its OWN epoch-relative explanatory update — the step it
took beyond its own predecessors, NOT present-day fame. Same basis you will use for the
manuscript, so all numbers sit on one yardstick.

STEP 4 — Subtract. Baseline = the WHOLE prior structure of the field, not only the five named
papers. State what was ALREADY available, then the manuscript's DELTA: what can now be
explained, derived, unified, predicted, computed, or ruled out that the prior field did not
already give. If the delta is mostly restatement, relabeling, or a marginal extension, the
update is small even if the result is new and clean. When the value is in a method, credit the
METHOD as the construction — not a discarded or bounded object it ruled out.

STEP 5 — Score the manuscript on its explanatory delta relative to that whole prior field,
placing it among the scored neighbors as calibration anchors. Score as if submitted by an
unknown author — recognition must not move the number. If correctness is contested_defensible,
score the defensibly-established contribution in a stable middle band, NOT the floor.

STEP 6 — Stress-test the score. Argue both sides: why not higher, why not lower, main inflation
risk, main deflation risk. Explicitly check whether the number was inflated by any of: novelty,
fame/recognition, the TIGHTNESS OF A BOUND, elegance, technical difficulty, or the importance
of the background principle it uses. If any inflated it, revise DOWN unless the manuscript
itself established a large explanatory update independent of them. (Bound-tightness is a
recurring inflation source: a tight limit is not itself a large explanatory update.)

Framework-internal results: if a central result holds only inside an unconfirmed framework,
score it on what it has ACTUALLY established about the real, testable structure of science, and
record the hypothetical-if-true value separately as frameworkConditionalValue (an audit note,
never the score). The scopeOfUpdate tag carries the framework dependence; the NUMBER reflects
the real delta size.

Return valid JSON only. No comments, no trailing commas. Emit exactly this shape:
{
  "recommendedExplanatoryUpdateScore": 0,
  "scopeOfUpdate": "subfield",
  "reviewContextUsed": { "mode": "new_submission", "reviewEpoch": "", "baselineInterpretation": "" },
  "imageGrounding": { "equationsReadFromImage": true, "pagesInspected": [], "anyExpressionUnreadable": "" },
  "correctnessAssessment": {
    "internalStatusProposed": "sound",
    "soundnessReasoning": "",
    "contestedObjection": "",
    "fatalFlawCandidates": [
      { "claim": "", "locationInPaper": { "section": "", "equation": "", "page": "", "quotedText": "" }, "modelAllegation": "" }
    ]
  },
  "neighborhoodSelection": {
    "selectionBasis": "",
    "comparables": [ { "paper": "", "role": "prior method", "whyComparable": "" } ],
    "confidence": { "level": "high", "reason": "", "possibleMissingComparables": [] }
  },
  "neighborhoodScores": [ { "paper": "", "estimatedScore": 0, "basis": "epoch-relative explanatory update", "contribution": "" } ],
  "alreadyAvailable": "",
  "deltaBeyondPriorField": "",
  "explanatoryUpdate": "",
  "scoreStressTest": { "whyNotHigher": "", "whyNotLower": "", "mainInflationRisk": "", "mainDeflationRisk": "", "inflationAudit": "" },
  "breakdown": { "input": "", "construction": "", "output": "" },
  "frameworkConditionalValue": "",
  "recognition": { "recognized": false, "suspectedIdentity": "" },
  "scientificReview": ""
}

Field rules (apply; do NOT echo into the JSON):
- recommendedExplanatoryUpdateScore: integer 0-100; a RECOMMENDATION.
- scopeOfUpdate: exactly one of general_physics, subfield, framework_internal, model_heuristic, empirical_constraint, speculative_interpretation; reflects scope, never caps the score.
- imageGrounding: equationsReadFromImage = true only if you actually read the load-bearing expressions from the page images; list the pages you inspected; record any expression that was unreadable.
- correctnessAssessment.internalStatusProposed: exactly one of sound, contested_defensible, fatal_alleged. contestedObjection required (non-empty) iff contested_defensible. fatalFlawCandidates non-empty iff fatal_alleged, each with a precise page location and the verbatim disputed expression.
- neighborhood/neighborhoodScores/alreadyAvailable/deltaBeyondPriorField/explanatoryUpdate/scoreStressTest/breakdown: as in the fixed-order steps; inflationAudit must name which of novelty/fame/tight-bound/elegance/difficulty/background-importance inflated the score and any downward revision.
- frameworkConditionalValue: audit note only; never a public score.
- recognition: disclosure only; must not affect the score.
- scientificReview: 1-3 paragraphs, verdict-led, no identity/fame, no rung/class codes.
- Use exactly one of these for "mode": new_submission, historical_benchmark.
- Use exactly one of these for each comparable's "role": prior method, prior theorem, competing framework, closest extension, contrast case.
- Use exactly one of these for "confidence.level": high, medium, low.
Use LaTeX for math inside strings: wrap inline math in $...$, escape every backslash as a
double backslash. Output valid JSON only.`;

export const EXPLANATORY_UPDATE_B2_ADJUDICATOR_ADDENDUM = `Adjudicator instructions
------------------------

You are the adjudicator for the explanatory-update review above. You are given the manuscript
(as authoritative PAGE IMAGES), the reviewContext, and two independent reviews in this same
schema. Reason to ONE final review — never average — and output the same schema. Apply the
SAME explanatory-update principle, the same image-authoritative rule, the same correctness gate
(WRONG vs CONTESTED), the same scopeOfUpdate discipline, and the same fixed-order reasoning.
Introduce no other scoring logic.

ACTIVELY RESOLVE correctness disagreements — do not merely adopt one pass's finding. If the two
passes disagree on correctness (e.g., one says fatal_alleged and the other says
sound/contested_defensible), read the disputed step FROM THE PAGE IMAGE yourself, symbol by
symbol, and reason to a stable verdict:
  - If, read from the image, the step is objectively wrong, set fatal_alleged and emit the
    precise fatalFlawCandidate (it will still be image-verified downstream before going public).
  - If the disputed expression on the image actually supports the author (a pass alleged an
    error that the image does not show — e.g., it read a lossy text layer that dropped a symbol),
    the allegation is rejected: do NOT carry it as fatal. Classify as sound or
    contested_defensible on the merits and score accordingly — never leave the score floored by
    a refuted allegation.
  - If a serious objection is real but is a live scientific dispute rather than an error, set
    contested_defensible and score the defensible contribution in a stable middle band. Treat
    this case the SAME way in both directions: a contested step is not a fatal flaw, and a fatal
    error is not rescued by calling it "contested".
A confirmed fatal error floors the affected score; a refuted or merely contested allegation must
not. Do not split the difference between the two passes' numbers — emit your own image-grounded
recommendedExplanatoryUpdateScore. Complete the recognition disclosure independently; it must
not move the number.`;

export const EXPLANATORY_UPDATE_B2_ADJUDICATOR_PROMPT = [
  EXPLANATORY_UPDATE_B2_PROMPT,
  EXPLANATORY_UPDATE_B2_ADJUDICATOR_ADDENDUM,
].join("\n\n");

// §2.3 verification pass — run for EVERY alleged fatal flaw, given the page image(s).
// Verbatim from the brief; the model is told the image is authoritative and must
// transcribe the disputed expression symbol by symbol before re-deriving.
export const FATAL_FLAW_VERIFICATION_PROMPT = `You are verifying an alleged fatal flaw in a scientific manuscript. You are NOT scoring the paper.
Your only job is to check whether the alleged flaw is actually present in the manuscript as written.

You are given the rendered page image(s). Treat the image as authoritative.
1. Locate the exact equation/sentence/derivation being criticized on the page image.
2. Transcribe the relevant expression VERBATIM from the image, symbol by symbol. Do not
   simplify, do not drop factors, do not infer an equation from memory or from any text layer.
3. Re-derive the disputed step from that verbatim expression.
4. State the strongest defense the author could give.
5. Verdict: fatal_survives | not_fatal | uncertain_needs_human_or_author.
If the relevant expression is ambiguous or unreadable in the image, return uncertain, not fatal.

Return valid JSON only — no comments, no trailing commas:
{
  "locatedOnPage": "",
  "verbatimExpression": "",
  "reDerivation": "",
  "possibleAuthorDefense": "",
  "skepticVerdict": "fatal_survives",
  "publicWording": ""
}
Field rules (do not echo): verbatimExpression = the disputed expression read symbol-by-symbol
from the image; reDerivation = the re-derivation from that verbatim expression; skepticVerdict =
exactly one of fatal_survives, not_fatal, uncertain_needs_human_or_author; publicWording = a
one-sentence public description of the flaw, used ONLY if skepticVerdict is fatal_survives.
Math in LaTeX inside $...$, backslashes escaped. Output valid JSON only.`;

export const EXPLANATORY_UPDATE_B2_PROMPT_HASH = createHash("sha256")
  .update(EXPLANATORY_UPDATE_B2_PROMPT)
  .digest("hex")
  .slice(0, 16);

export const EXPLANATORY_UPDATE_B2_ADJUDICATOR_PROMPT_HASH = createHash("sha256")
  .update(EXPLANATORY_UPDATE_B2_ADJUDICATOR_PROMPT)
  .digest("hex")
  .slice(0, 16);

export const FATAL_FLAW_VERIFICATION_PROMPT_HASH = createHash("sha256")
  .update(FATAL_FLAW_VERIFICATION_PROMPT)
  .digest("hex")
  .slice(0, 16);
