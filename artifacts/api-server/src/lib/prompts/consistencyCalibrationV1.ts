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

// Per-cluster deduction-consistency judgment prompt (consistency-v2).
//
// Each cluster is a set of EXISTING below-10 deductions (one per I/C/O
// dimension of some review) that an embedding pre-cluster grouped as likely
// sharing one underlying cause. The model (a) confirms the cluster genuinely
// shares ONE cause in a COMPARABLE load-bearing role, and (b) flags only the
// outliers — deductions whose points materially diverge from comparable-role
// peers without justification. A legitimate weight difference (same cause, but
// the result leans on it more/less) is NOT flagged. For each flagged outlier it
// emits the rubric-prescribed dimension subscore (0-10, half-point) the cause +
// role warrant — never the group average. The model emits subscores/rungs only;
// code computes points (anti-anchoring preserved).

export const DEDUCTION_CONSISTENCY_V2_PROMPT = String.raw`DEDUCTION CONSISTENCY AUDIT — v2
================================================================================

You are shown a CLUSTER of point-deductions taken from different anonymous
manuscript reviews. Each item is one dimension (input, construction, or
output) that scored below 10, with the stated CAUSE of its deduction and its
current 0-10 subscore. An automated pre-cluster guessed these share one
underlying cause; your job is to verify and, only where warranted, flag
inconsistencies.

Decide two things:

1. sameCauseAndRole — true ONLY if these deductions genuinely rest on the SAME
   underlying cause (e.g. all "rests on the entropy-area relation," or all
   "leading-order approximation") AND that cause plays a COMPARABLE
   load-bearing role across them. If the pre-cluster mixed distinct causes, or
   the cause is load-bearing in one and incidental in another, return false and
   no flags.

2. flags — when sameCauseAndRole is true, flag ONLY the outliers: deductions
   whose subscore (hence point deduction) materially diverges from the
   comparable-role peers WITHOUT justification. The same cause in the same role
   should cost about the same. An outlier can diverge in EITHER direction — it
   may be too HARSH (subscore too low / deduction too large) or too LENIENT
   (subscore too high / deduction too small) relative to its comparable-role
   peers. Flag both kinds. A LEGITIMATE weight difference — the result genuinely
   hangs on the assumption in one paper and barely leans on it in another — is
   the prompt's weighted-bottleneck judgment and is NOT an inconsistency; do not
   flag it.

For each flagged outlier, give the dimension subscore the rubric prescribes for
that cause + role (a 0-10 value, half-points allowed) so its deduction matches
its comparable-role peers. The prescribed value may be ABOVE or BELOW the
outlier's current subscore: RAISE an over-penalized outlier and LOWER an
under-penalized one, whichever way the rung definitions warrant. This is rubric
ALIGNMENT, not a one-way penalty. NEVER move it to the group average; pick the
value the rung definitions warrant. Leave every non-outlier untouched.

Anti-anchoring: emit subscores/rungs and your reasoning only. Do NOT emit any
0-100 score, points, or magnitude label — points are computed downstream.

Return valid JSON only with this structure:

{
  "sameCauseAndRole": true,
  "flags": [
    {
      "reviewId": "",
      "dimension": "input | construction | output",
      "prescribedSubscore": 0,
      "reason": ""
    }
  ]
}

If the cluster is not one cause in a comparable role, return
{ "sameCauseAndRole": false, "flags": [] }. Output valid JSON only.`;
