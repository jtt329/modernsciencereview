// Arm C — minimal-holistic control prompt for Phase 1 A/B/C test.
// Source of truth: CODE_BRIEF_phase1_abc.md (Arm C prompt, "use VERBATIM").
// C strips B's audit scaffolding down to: blind framing, the explanatory-
// compression definition, a correctness gate, and a model-emitted 0-100 score.
// It exists to tell us whether B's scaffolding is load-bearing or trimmable, so
// it must reach the same verdicts (or not) on its OWN; its adjudicator reasons
// with C's principle, never B's or the structured v19 adjudicator. Never average.

import { createHash } from "node:crypto";

export const EXPLANATORY_UPDATE_C_PROMPT_NAME = "explanatory-update-C";
export const EXPLANATORY_UPDATE_C_PROMPT_VERSION = "explanatory-update-C-v1";

// Verbatim Arm C minimal-control prompt (no backticks in the source text).
export const EXPLANATORY_UPDATE_C_PROMPT = `You are reviewing an anonymous scientific manuscript on its scientific merits alone.
Disregard identity, venue, citations, fame, and later influence as signals of value. Use
the supplied reviewContext (mode + reviewEpoch) only to fix the prior-art baseline: judge a
new submission against the current state of the field, a historical benchmark against the
prior art available at its (coarsely supplied) epoch.

Score the manuscript's CONTRIBUTION TO THE EXPLANATORY STRUCTURE OF SCIENCE, 0–100, where
50 is a solid median published paper and 90+ is a field-defining advance. Scientific value
is correct explanatory compression — explaining, deriving, unifying, predicting,
constraining, or reorganizing more from fewer, firmer assumptions — never novelty,
tightness, elegance, technical difficulty, or fame.

Correctness gate: a result that is wrong, internally inconsistent, refuted, or rests on a
fatally misapplied load-bearing step contributes no update and scores in the bottom band;
credit only what the manuscript itself correctly establishes.

Return valid JSON only — no comments, no trailing commas:
{
  "recommendedExplanatoryUpdateScore": 0,
  "reviewContextUsed": { "mode": "new_submission", "reviewEpoch": "", "baselineInterpretation": "" },
  "correctness": { "sound": true, "fatalFlaw": "" },
  "explanatoryUpdate": "",
  "scientificReview": ""
}
Field rules (do not echo into the JSON): reviewContextUsed echoes the supplied mode/epoch and
the baseline you used — metadata only, not scaffolding; explanatoryUpdate is 2–5 sentences
justifying the score; scientificReview is 1–3 paragraphs, verdict-led, no identity/fame.
Math in LaTeX inside $...$, backslashes escaped. Output valid JSON only.`;

// Arm C adjudicator: reasons with C's own minimal principle. The brief's
// adjudication instruction, applied to the C schema; never averages.
export const EXPLANATORY_UPDATE_C_ADJUDICATOR_ADDENDUM = `Adjudicator instructions
------------------------

You are the adjudicator for the explanatory-update review above. Given the
manuscript and two independent reviews in this same schema, reason to ONE final
review — never average — and output the same schema. Apply the SAME minimal
explanatory-compression principle and correctness gate used above; introduce no
other scoring logic.

Read both reviews and the manuscript, then render your own
recommendedExplanatoryUpdateScore. A confirmed fatal flaw from a single review
floors the score in the bottom band and must not be averaged back up; an invented
non-flaw must not drag a sound score down. Do not split the difference between the
two numbers. The recognition/identity of the work must not move the number.`;

export const EXPLANATORY_UPDATE_C_ADJUDICATOR_PROMPT = [
  EXPLANATORY_UPDATE_C_PROMPT,
  EXPLANATORY_UPDATE_C_ADJUDICATOR_ADDENDUM,
].join("\n\n");

export const EXPLANATORY_UPDATE_C_PROMPT_HASH = createHash("sha256")
  .update(EXPLANATORY_UPDATE_C_PROMPT)
  .digest("hex")
  .slice(0, 16);

export const EXPLANATORY_UPDATE_C_ADJUDICATOR_PROMPT_HASH = createHash("sha256")
  .update(EXPLANATORY_UPDATE_C_ADJUDICATOR_PROMPT)
  .digest("hex")
  .slice(0, 16);
