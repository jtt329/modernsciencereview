import React, { createContext, useContext } from 'react';
import type { FormalSubmission } from '../../../api-server/src/formal/contract';
import { savedReviewMatchesSubmission } from './formalSavedReview';
import type { SavedFormalReviewSnapshot } from './formalSavedReview';

const SavedFormalReviewContext = createContext<SavedFormalReviewSnapshot | null>(null);
export function SavedFormalReviewProvider({ snapshot, children }: { snapshot: SavedFormalReviewSnapshot; children: React.ReactNode }) {
  return <SavedFormalReviewContext.Provider value={snapshot}>{children}</SavedFormalReviewContext.Provider>;
}
export function useSavedFormalReview(submission?: FormalSubmission | null): SavedFormalReviewSnapshot | null {
  const snapshot = useContext(SavedFormalReviewContext);
  if (!snapshot || submission === null || (submission && !savedReviewMatchesSubmission(snapshot, submission))) return null;
  return snapshot;
}
