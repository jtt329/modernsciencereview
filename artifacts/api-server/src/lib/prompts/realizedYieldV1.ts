// Realized Yield v1: a separate, hindsight-permitted assessment axis.
// Explicitly UN-blind — this layer is where identity, dates, and the
// historical record belong; the blind intrinsic layer is unchanged and
// never mixes with this one.

export const REALIZED_YIELD_V1_PROMPT = String.raw`REALIZED YIELD ASSESSMENT — v1
================================================================================

You are assessing the realized yield of a known, identified scientific
paper. This assessment is explicitly un-blind: the paper's identity,
publication date, and the historical record are required inputs. Use
everything you know about what actually happened after publication.

Question: what confirmed knowledge, capabilities, measurements, or
established methods did this paper's constructions actually produce in
the historical record? The criterion is realized yield of confirmed
science, NOT citations, activity, volume of literature, or fame. A
program that generated discussion and publications without confirmed
results yields low. Popularity is not evidence and must not enter this
assessment, even as a denominator.

Procedure
---------

1. Seed from the paper's stored Input -> Construction -> Output ledger
   (provided): its central constructions and outputs.
2. For each central construction, trace what it became in the record and
   classify the TERMINAL FIRMNESS of the best results it is load-bearing
   in:
   F1. Directly measured physics or operational measurement channels.
   F2. Established, experimentally tested theory.
   F3. Plausible but unobserved constructs of tested theory.
   F4. Use confined to untested frameworks.
   Refuted/abandoned.
3. Weight each trace by LOAD-BEARINGNESS: essential to the confirmed
   result, versus incidental or merely co-cited. Causal-chain credit
   only: the construction must actually do work in the confirmed result.
4. Aggregate to a 0-100 realizedYieldScore with these worded anchors:
   100 = the construction became directly measured physics or the
   organizing principle of confirmed science; ~50 = central ideas were
   adopted into serious but still-untested programs; ~20 = survives as a
   niche tool; 0 = refuted or abandoned.
5. Provide a mandatory evidence list: specific measurements, instruments,
   or established results traceable to the paper's constructions.
   Adoption counts only as evidenced by use in confirmed results; volume
   of discussion inside untested frameworks earns F4-level credit and no
   more.

Date conditioning
-----------------

realizedYieldScore is ABSOLUTE and unscaled: confirmed yield to date. It
must be monotonically non-decreasing across re-assessments of the same
paper — confirmed science does not unconfirm; if a previous assessment
is provided, do not return a lower score unless a central claim was
actually refuted, and say so explicitly if you do.

Separately, give trajectoryAssessment: whether this paper's realized
yield is "ahead", "typical", or "behind" expectations for a paper of its
age and type. This is an explicit model judgment with a rationale, not a
formula; do not use citation-based or adoption-rate normalization.

Return valid JSON only with this structure:

{
  "realizedYieldScore": 0,
  "trajectoryAssessment": "ahead | typical | behind",
  "rationale": "",
  "evidence": [
    {
      "construction": "",
      "terminalFirmness": "F1 | F2 | F3 | F4 | refuted",
      "loadBearingness": "essential | supporting | incidental",
      "evidence": ""
    }
  ],
  "refutationNoted": false,
  "confidence": 0.0
}

All numeric fields must be numbers, not strings. realizedYieldScore is an
integer 0-100. confidence is 0-1. Output valid JSON only.`;
