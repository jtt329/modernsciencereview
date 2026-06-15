// Per-group rubric-consistency judgment prompt (consistency-v1).
//
// The model is shown a batch of comparable ICO elements (same kind,
// substantively the same claim/result) drawn from different papers and
// decides whether they are scored consistently against the prompt's own
// rungs — F1-F4 firmness, C1-C5 centrality, rigor x forcedness for
// constructions. Where an element sits on the wrong rung, it re-adjudicates
// THAT element against the rung DEFINITIONS — never averaging toward the
// group. It returns rung/class verdicts only; it never emits a 0-100 score
// (anti-anchoring is preserved end to end).

export const CONSISTENCY_CALIBRATION_V1_PROMPT = String.raw`RUBRIC CONSISTENCY AUDIT — v1
================================================================================

You are auditing whether a batch of comparable scored elements from
different anonymous manuscript reviews apply the rubric's rungs
consistently. This is a consistency check against the rubric's own
definitions, not a re-ranking and not a comparison to anchor papers.

The reference is the rubric's ladders, identical to the absolute-scoring
rubric:
- Output referent firmness: F1 directly measured phenomena or data; F2
  established-theory regimes with strong indirect evidence; F3 plausible
  but unobserved constructs of established theory; F4 constructs internal
  to untested frameworks.
- Output centrality: C1 establishes a new law/mechanism/phenomenon/
  empirical fact; C2 derives known laws from fewer or firmer primitives or
  proves a new theorem; C3 unifies or systematizes known results; C4
  constrains/excludes alternatives, confirmations and null results; C5
  provides methods/datasets/instruments at the demonstrated capability.
- Construction firmness: RIGOR (proven theorem > checked derivation >
  consistent heuristic > conjecture) and FORCEDNESS (uniquely determined
  by the inputs > natural among few alternatives > chosen > tuned or ad
  hoc), recorded in validityLevel and hardToVaryLevel.

Rules:
- Comparison only NOMINATES candidates for re-adjudication. The rung
  DEFINITIONS are ground truth.
- Correct each misplaced element by re-applying the ladder to THAT element
  on its own merits. Do NOT move an element toward the group majority; a
  correct element that happens to be in the minority stays where the
  definitions put it.
- Ignore author identity, fame, and later influence. Judge from the
  element's stated content.
- Do NOT output any 0-100 score, score band, or magnitude label. Output
  only rung/class verdicts.

For every element in the batch, return its definition-prescribed rung(s).
For an element already on the correct rung, return the same rung (a no-op).
Only changed rungs become corrections.

Return valid JSON only with this structure:

{
  "verdicts": [
    {
      "reviewId": "",
      "kind": "input | construction | output",
      "index": 0,
      "firmness": "F1 | F2 | F3 | F4 | null",
      "centrality": "C1 | C2 | C3 | C4 | C5 | null",
      "validityLevel": "invalid | conditional | valid | strong | null",
      "hardToVaryLevel": "low | medium | high | null",
      "reason": ""
    }
  ]
}

Use null for rungs that do not apply to that element kind. reason states
which rung definition the element meets and why, in plain words. Output
valid JSON only.`;
