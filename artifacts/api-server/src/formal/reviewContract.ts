import type { IngestedSource } from './contract';

/** Review comments address one stable scientific item in an exact revision. */
export interface ReviewTarget {
  kind: 'main-claim' | 'input' | 'assumption' | 'definition' | 'claim' | 'warning' | 'coverage' | 'source-line' | 'review-section' | 'explanation-section' | 'field-contribution' | 'canonical-finding' | 'literature-section';
  id: string;
}
export type ReviewJson = null | boolean | number | string | ReviewJson[] | { [key: string]: ReviewJson };
/** Replacements only: no add/remove operations, identities, or server evidence. */
export interface ReviewChange { path: string; before: ReviewJson; after: ReviewJson; }
export interface SourceEdit { lineId: string; before: string; after: string; reason: string; }
export interface ReviewProposal {
  summary: string;
  changes: ReviewChange[];
  sourceEdits: SourceEdit[];
  affectedClaimIds: string[];
  consistencyNotes: string[];
}
export interface SourceAmendment {
  kind: 'amended-transcription';
  parentSourceId: string;
  parentSha256: string;
  rootSourceId: string;
  createdAt: string;
  reason: string;
  edits: SourceEdit[];
}
export type AmendedSource = IngestedSource & { amendment: SourceAmendment };
