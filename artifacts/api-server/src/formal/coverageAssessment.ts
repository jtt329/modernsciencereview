import type { FormalSubmission } from './contract';
import { buildCoverage } from './outputs';
/** A derived view, never an in-place edit of the approved package or old report. */
export function deriveCoverageAssessment(submission: FormalSubmission): FormalSubmission {
  const { currentRevision: revision, sourceDocument: source } = submission;
  if (!source || !revision.outputs || !revision.verification) return submission;
  const coverage = buildCoverage(revision.package, revision.verification, source);
  const previous = new Map(revision.outputs.coverage.map(item => [item.id, item]));
  const corrections = coverage.filter(item => {
    const old = previous.get(item.id); return old && (old.status !== item.status || JSON.stringify(old.claimIds) !== JSON.stringify(item.claimIds));
  }).map(item => ({ coverageId: item.id, previousStatus: previous.get(item.id)!.status, status: item.status, claimIds: item.claimIds, reason: item.reason }));
  if (!corrections.length) return submission;
  return { ...submission, coverageAssessment: { version: 'coverage-reconciliation-v1', packageDigest: revision.digest, computedAt: new Date().toISOString(), coverage, originalSummary: { ...revision.outputs.summary }, summary: { total: coverage.length, checked: coverage.filter(c => c.status === 'checked').length, conditionalInputs: revision.package.selectedInputs.length, unresolved: coverage.filter(c => ['contradicted', 'partial', 'unsupported', 'not-assessed'].includes(c.status)).length }, corrections } };
}
