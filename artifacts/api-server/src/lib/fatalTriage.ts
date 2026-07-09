// Phase 2a hardening (item 2): the fatal-verdict routing decision, as a PURE, testable function.
// The correctness/fatal layer is the foundation, so its routing is deterministic and regression-
// locked here rather than scattered through the harness.
//
// Policy (JT):
//   - A fatal verdict requires the verified error to BREAK THE PAPER'S CENTRAL contribution — not
//     a side derivation, an interpretive/observer/frame choice, or a subtlety the paper itself
//     already addresses. (The centrality gate lives in the verification prompt; its structured
//     output feeds this router.)
//   - Escalation when NOT certain: any alleged fatal that isn't a certain crank goes to a stronger
//     model asked one question — "does correcting this flaw eliminate the central result?" Only a
//     high-confidence "yes" routes to failed. Uncertainty defaults to honest MERIT (contested),
//     never to failed.
//   - Certain cranks — an image-verified arithmetic/algebra error in a CENTRAL step, high
//     confidence — are already certain and skip escalation.
//   - Infrastructure failure of the escalation call itself → fail-closed HOLD
//     (fatal_alleged_unverified: edits held until it resolves), never an auto-pass.

export type FatalCandidateVerification = {
  skepticVerdict?: "fatal_survives" | "not_fatal" | "uncertain_needs_human_or_author" | string;
  flawLocation?: "central_step" | "side_derivation" | "interpretive_or_frame_choice" | "self_addressed_by_authors" | string;
  flawType?: "arithmetic_or_algebra" | "conceptual_or_framework" | "interpretive_or_observer" | string;
  correctingEliminatesCentral?: boolean;
  authorsAddressThis?: boolean;
  confidence?: "high" | "medium" | "low" | string;
};

export type FatalEscalationResult = {
  verdict?: "eliminates_central" | "survives_correction" | "genuinely_uncertain" | string;
  confidence?: "high" | "medium" | "low" | string;
} | null;

export type FatalRoutedStatus = "fatal_verified" | "contested_defensible" | "fatal_alleged_unverified";

// A CERTAIN crank fatal: the flaw survived, is a pure arithmetic/algebra miscalculation, sits in a
// central step, correcting it eliminates the central result, the authors don't already neutralize
// it, and confidence is high. These (viXra 33-orders arithmetic; Campos discriminant algebra) are
// certain and skip escalation.
export function isCertainCrankFatal(v: FatalCandidateVerification): boolean {
  return v?.skepticVerdict === "fatal_survives"
    && v?.flawType === "arithmetic_or_algebra"
    && v?.flawLocation === "central_step"
    && v?.correctingEliminatesCentral === true
    && v?.authorsAddressThis !== true
    && v?.confidence === "high";
}

// A candidate warrants escalation when it alleges a surviving fatal that is NOT a certain crank
// (a conceptual/framework/interpretive/observer objection, a not-high-confidence call, or one the
// authors address), OR when the presence check itself is uncertain. not_fatal never escalates.
export function candidateNeedsEscalation(v: FatalCandidateVerification): boolean {
  if (!v || v.skepticVerdict === "not_fatal") return false;
  if (isCertainCrankFatal(v)) return false;
  return v.skepticVerdict === "fatal_survives" || v.skepticVerdict === "uncertain_needs_human_or_author";
}

export function anyCertainCrankFatal(cands: FatalCandidateVerification[]): boolean {
  return (cands ?? []).some(isCertainCrankFatal);
}
export function anyNeedsEscalation(cands: FatalCandidateVerification[]): boolean {
  return (cands ?? []).some(candidateNeedsEscalation);
}

// The routing decision. `escalation` is the stronger-model result (null if not run); set
// `escalationErrored` when escalation WAS required but its call failed (→ fail-closed hold).
export function routeFatalVerdict(args: {
  candidates: FatalCandidateVerification[];
  escalation?: FatalEscalationResult;
  escalationErrored?: boolean;
}): FatalRoutedStatus {
  const cands = args.candidates ?? [];
  // Certain crank → failed immediately, no escalation.
  if (anyCertainCrankFatal(cands)) return "fatal_verified";
  // Nothing survived the centrality gate and nothing is uncertain → honest merit (contested).
  if (!anyNeedsEscalation(cands)) return "contested_defensible";
  // Escalation was required.
  if (args.escalationErrored) return "fatal_alleged_unverified"; // infra failure → fail-closed HOLD
  const e = args.escalation;
  if (e && e.verdict === "eliminates_central" && e.confidence === "high") return "fatal_verified";
  return "contested_defensible"; // survives / uncertain / no high-confidence confirmation → merit
}

// Which candidate to escalate (the strongest surviving allegation): prefer a fatal_survives, else
// the first uncertain. Returns the index, or -1 if none needs escalation.
export function candidateToEscalate(cands: FatalCandidateVerification[]): number {
  const i = (cands ?? []).findIndex((c) => c.skepticVerdict === "fatal_survives" && !isCertainCrankFatal(c));
  if (i >= 0) return i;
  return (cands ?? []).findIndex((c) => c.skepticVerdict === "uncertain_needs_human_or_author");
}
