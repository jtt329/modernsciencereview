import type { CoverageResult, FieldContribution, FormalOutputs, FormalPackage, IngestedSource, VerificationReport } from '../../../api-server/src/formal/contract';
export type StatementSelection = 'all' | 'checked' | 'unresolved';
export type EvidenceSelection = 'equations' | 'all' | 'checked' | 'inputs' | 'unresolved';
export const unresolvedStatuses = new Set(['contradicted', 'partial', 'unsupported', 'not-assessed']);
export function selectedStatements(items: CoverageResult[], selection: StatementSelection): CoverageResult[] { return selection === 'all' ? items : items.filter(item => selection === 'checked' ? item.status === 'checked' : unresolvedStatuses.has(item.status)); }
export function resultCounts(pkg: FormalPackage, report: VerificationReport | null, coverage: CoverageResult[]) { return { equations: report?.claims.length || 0, checkedEquations: report?.claims.filter(item => item.status === 'checked').length || 0, total: coverage.length, checked: selectedStatements(coverage, 'checked').length, inputs: pkg.selectedInputs.length, unresolved: selectedStatements(coverage, 'unresolved').length }; }
export type ResultIssue = { id: string; kind: 'claim' | 'coverage' | 'warning' | 'source-warning' | 'output-warning'; itemId: string; status: string; text: string; label?: string };
/** These are tool limitations/open items, never an invented verdict that the paper is wrong. */
export function resultIssues(pkg: FormalPackage, report: VerificationReport | null, coverage: CoverageResult[], source: IngestedSource | null, warnings: string[] = []): ResultIssue[] {
  return [
    ...(report?.claims.filter(item => item.status !== 'checked').map(item => ({ id: `issue-claim-${item.id}`, kind: 'claim' as const, itemId: item.id, status: item.status, text: `${item.title}: ${item.message}` })) || []),
    ...selectedStatements(coverage, 'unresolved').map(item => ({ id: `issue-coverage-${item.id}`, kind: 'coverage' as const, itemId: item.id, status: item.status, text: item.statement, label: coverageStatusLabel(item) })),
    ...(pkg.analysis?.extractionWarnings.map((text, index) => ({ id: `issue-warning-${index}`, kind: 'warning' as const, itemId: `warning-${index}`, status: 'Needs inspection', text })) || []),
    ...(source?.warnings.map((text, index) => ({ id: `issue-source-warning-${index}`, kind: 'source-warning' as const, itemId: `source-warning-${index}`, status: 'Extraction note', text })) || []),
    ...warnings.map((text, index) => ({ id: `issue-output-warning-${index}`, kind: 'output-warning' as const, itemId: `output-warning-${index}`, status: 'Output note', text })),
  ];
}
export const revisionIdFromSearch = (search: string): string | null => { const id = new URLSearchParams(search).get('revision'); return id && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id) ? id : null; };

export function coverageStatusLabel(item: Pick<CoverageResult, 'status' | 'role'>): string | undefined {
  if (item.status !== 'unsupported') return undefined;
  if (item.role === 'mathematical') return 'Not fully checked';
  if (item.role === 'empirical') return 'Not empirically assessed';
  return undefined;
}
/** Explain publication eligibility without turning an unassessed claim into a paper error. */
export function fieldDispositionLabel(item: FieldContribution, outputs: FormalOutputs | null | undefined, report: VerificationReport | null | undefined, coverage: CoverageResult[] = outputs?.coverage || []): string | undefined {
  if (item.disposition !== 'unsupported') return undefined;
  const coverageId = item.sectionId.startsWith('coverage-') ? item.sectionId.slice('coverage-'.length) : item.id.startsWith('coverage-contribution-') ? item.id.slice('coverage-contribution-'.length) : undefined;
  const sourceItem = coverageId ? coverage.find(candidate => candidate.id === coverageId) : undefined;
  if (sourceItem && ['metadata', 'scope', 'citation'].includes(sourceItem.role)) return 'Context, not a new result';
  if (sourceItem?.status === 'adopted-input') return 'Adopted premise';
  if (sourceItem?.role === 'definition' || sourceItem?.status === 'definition') return 'Definition';
  const section = outputs?.explanation.find(candidate => candidate.id === item.sectionId);
  const checkedIds = new Set(report?.claims.filter(claim => claim.status === 'checked').map(claim => claim.id) || []);
  if (section?.status === 'unverified-context' && section.claimIds.some(id => checkedIds.has(id))) return 'Not included as a whole';
  return 'Not eligible as checked evidence';
}

/** A private evidence export may finish only in the same mounted account/revision view. */
export function createEvidenceExportScope() {
  let key: string | null = null, generation = 0;
  return {
    update(next: string) { if (key !== next) { key = next; generation++; } },
    clear() { key = null; generation++; },
    begin() { const expectedKey = key, expectedGeneration = ++generation; return () => expectedKey !== null && key === expectedKey && generation === expectedGeneration; },
  };
}
export const evidenceExportIdentity = (viewerId: string | null, submissionId: string, revisionId: string, digest: string) => JSON.stringify([viewerId, submissionId, revisionId, digest]);
