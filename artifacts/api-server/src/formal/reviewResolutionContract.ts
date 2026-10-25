import type { ReviewTarget } from './reviewContract';
/** Acceptance records an assessment interpretation, never a new scientific proof. */
export type ReviewResolutionDisposition = 'reviewer-error' | 'clarified-by-source' | 'outside-checker-scope' | 'manuscript-change-needed';
export interface ReviewResolutionEvidence {
  sourceLineIds: string[];
  claimIds: string[];
  canonicalFindingIds: string[];
  literatureSectionIds: string[];
}
export type ReviewCorrectionValue = string | string[];
export interface ReviewAssessmentCorrection {
  kind: 'review-section' | 'explanation-section' | 'assessment-section' | 'assessment-issue';
  id: string;
  before: ReviewCorrectionValue;
  after: ReviewCorrectionValue;
}
/** AI supplies these fields; fingerprints are computed by the server. */
export interface ReviewResolutionDraft {
  target: ReviewTarget;
  disposition: ReviewResolutionDisposition;
  summary: string;
  reason: string;
  evidence: ReviewResolutionEvidence;
  correction: ReviewAssessmentCorrection | null;
}
export interface ReviewResolutionProposal extends ReviewResolutionDraft {
  targetFingerprint: string;
  beforeFingerprint: string;
  baseAssessmentDigest: string;
  assessmentEvidenceFingerprint: string | null;
}
export interface ReviewResolutionRecord {
  id: string; submissionId: string; revisionId: string; packageDigest: string;
  discussionId: string; messageId: string; model: string;
  status: 'proposed' | 'accepted'; createdAt: string; acceptedAt: string | null;
  proposal: ReviewResolutionProposal;
}
/** Public-safe accepted content: no raw author comment or private thread IDs. */
export interface AcceptedReviewResolution extends ReviewResolutionDraft {
  id: string; acceptedAt: string; model: string;
  verificationUnchanged: true;
}
export interface ReviewResolutionOverlay {
  version: 'review-resolution-overlay-v1'; submissionId: string; revisionId: string; packageDigest: string;
  assessmentDigest: string;
  accepted: AcceptedReviewResolution[];
  reviewCorrections: { resolutionId: string; sectionId: string; before: ReviewCorrectionValue; after: ReviewCorrectionValue }[];
  assessmentCorrections: {resolutionId:string;kind:'assessment-section'|'assessment-issue';sectionId:string;before:string;after:string}[];
  explanationCorrections: { resolutionId: string; sectionId: string; before: string; after: string }[];
}
export interface ReviewResolutionCollection {
  proposals: ReviewResolutionRecord[];
  accepted: ReviewResolutionRecord[];
  overlay: ReviewResolutionOverlay;
}
