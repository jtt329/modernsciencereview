import type { FormalJob, FormalOutputs, FormalPackage, FormalSubmission, IngestedSource, VerificationReport } from '../../../api-server/src/formal/contract';
import type { ScientificAssessment } from '../../../api-server/src/formal/assessmentContract';
import type { CanonicalAssessment } from '../../../api-server/src/formal/canonicalContract';
import type { LiteratureAssessment } from '../../../api-server/src/formal/literatureContract';

export interface SavedReviewEditorialAmendment {
  version: 'review-editorial-amendment-v1';
  kind: 'wording-clarification';
  id: string;
  createdAt: string;
  attribution: string;
  sourceSha256: string;
  packageDigest: string;
  assessmentFingerprint: string;
  field: 'scientificAssessment.novelty.fieldContribution';
  originalText: string;
  replacementText: string;
  reason: string;
  newModelRun: false;
  scientificEvidenceUnchanged: true;
}

export interface SavedFormalReviewSnapshot {
  readonly submission: FormalSubmission;
  readonly assessment: ScientificAssessment;
  readonly canonical: CanonicalAssessment;
  readonly literature: LiteratureAssessment;
  readonly evidenceUrl: string;
  readonly paperUrl: string;
  readonly standaloneUrl: string;
  readonly independentQA: unknown;
  readonly events: FormalJob['events'];
  readonly createdAt: string;
  readonly editorialAmendments: readonly SavedReviewEditorialAmendment[];
  readonly originalEvidenceUrl: string | null;
}
export interface SavedFormalReviewOptions {
  evidenceUrl: string;
  paperUrl: string;
  standaloneUrl: string;
  originalEvidenceUrl?: string;
  expectedSourceSha256?: string;
  expectedPackageDigest?: string;
}

type RecordValue = Record<string, unknown>;
const fail = (part: string): never => { throw new Error(`The saved review is incomplete or belongs to different evidence (${part}).`); };
function record(value: unknown, part: string): RecordValue { return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : fail(part); }
function text(value: unknown, part: string): string { return typeof value === 'string' && value.trim() ? value : fail(part); }
function array(value: unknown, part: string): unknown[] { return Array.isArray(value) ? value : fail(part); }
function same(value: unknown, expected: unknown, part: string) { if (value !== expected) fail(part); }
function timestamp(value: unknown, part: string): string { const result = text(value, part); if (!Number.isFinite(Date.parse(result))) fail(part); return result; }
function hash(value: unknown, part: string): string { const result = text(value, part); return /^[a-f0-9]{64}$/.test(result) ? result : fail(part); }
function artifactUrl(value: string, part: string): string {
  if (typeof value !== 'string' || !/^\/(?!\/)/.test(value) || /[\\\s\u0000-\u001f]/.test(value)) fail(part);
  const url = new URL(value, 'https://saved-review.invalid');
  if (url.origin !== 'https://saved-review.invalid' || /\\/.test(decodeURIComponent(url.pathname))) fail(part);
  return value;
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}

/** View-only projection of a completed export. It never creates a production submission or author approval. */
export function createSavedReviewSnapshot(value: unknown, options: SavedFormalReviewOptions): SavedFormalReviewSnapshot {
  const evidenceUrl = artifactUrl(options.evidenceUrl, 'evidence URL');
  const paperUrl = artifactUrl(options.paperUrl, 'paper URL');
  const standaloneUrl = artifactUrl(options.standaloneUrl, 'standalone URL');
  const raw = record(value, 'export');
  same(raw.format, 'modernscience-complete-seven-page-review-v1', 'export format');
  const identity = record(raw.identity, 'identity');
  const sourceId = text(identity.sourceId, 'source ID');
  const sourceSha256 = hash(identity.sourceSha256, 'source hash');
  const digest = hash(identity.packageDigest, 'package digest');
  const fingerprint = hash(identity.assessmentFingerprint, 'assessment fingerprint');
  const model = text(identity.model, 'model');
  const createdAt = timestamp(identity.completedAt, 'completion date');
  if (options.expectedSourceSha256) same(sourceSha256, options.expectedSourceSha256, 'expected source hash');
  if (options.expectedPackageDigest) same(digest, options.expectedPackageDigest, 'expected package digest');
  for (const key of ['authorApprovalRecorded', 'publishConsent', 'publicationPerformed', 'productionDatabaseWrites', 'productionSourceUploadPerformed']) same(identity[key], false, `historical ${key}`);
  const bind = (part: unknown, label: string) => {
    const item = record(part, label);
    same(item.packageDigest, digest, `${label} digest`);
    same(item.sourceId, sourceId, `${label} source ID`);
    same(item.sourceSha256, sourceSha256, `${label} source hash`);
    return item;
  };
  const metadata = bind(raw.proposalMetadata, 'proposal metadata');
  same(metadata.model, model, 'proposal model');
  same(metadata.authorApprovalRecorded, false, 'proposal approval');
  same(metadata.publishConsent, false, 'proposal publication consent');
  same(metadata.productionDatabaseWrites, false, 'proposal database writes');
  const source = record(record(raw.source, 'source').numberedSnapshot, 'numbered source');
  same(source.id, sourceId, 'numbered source ID');
  same(source.sha256, sourceSha256, 'numbered source hash');
  const lines = array(source.lines, 'numbered source lines');
  if (!lines.length) fail('empty numbered source');
  const lineIds = new Set(lines.map(item => text(record(item, 'source line').id, 'source line ID')));
  if (lineIds.size !== lines.length) fail('duplicate source lines');
  const counts = record(identity.sourceCounts, 'source counts');
  same(counts.numberedLines, lines.length, 'source line count');
  same(counts.pages, source.pageCount, 'source page count');
  const packet = record(raw.proposedFormulation, 'proposed formulation');
  same(packet.schemaVersion, 'formal-lab-v1', 'package schema');
  text(packet.title, 'paper title'); text(packet.authors, 'paper authors');
  same(record(packet.source, 'package source').sha256, sourceSha256, 'package source hash');
  const analysis = record(packet.analysis, 'source analysis');
  same(analysis.sourceId, sourceId, 'analysis source ID');
  const coverage = array(analysis.coverage, 'source coverage');
  const coverageIds = new Set(coverage.map(item => text(record(item, 'coverage item').id, 'coverage ID')));
  if (!coverage.length || coverageIds.size !== coverage.length) fail('source coverage IDs');
  for (const item of coverage) for (const id of array(record(item, 'coverage item').sourceLineIds, 'coverage source links')) if (!lineIds.has(text(id, 'source link'))) fail('unknown coverage source link');
  const inputs = array(packet.selectedInputs, 'declared inputs');
  const claims = array(packet.claims, 'proposed scalar claims');
  const claimIds = new Set(claims.map(item => text(record(item, 'claim').id, 'claim ID')));
  if (!claims.length || claimIds.size !== claims.length) fail('scalar claim IDs');
  same(metadata.inputs, inputs.length, 'declared input count');
  same(metadata.claims, claims.length, 'scalar claim count');
  same(metadata.coverageUnits, coverage.length, 'coverage count');
  const verification = record(raw.mathematicalVerification, 'mathematical verification');
  same(verification.packageDigest, digest, 'verification digest');
  const checkedClaims = array(verification.claims, 'verification claims');
  if (checkedClaims.length !== claims.length || new Set(checkedClaims.map(item => record(item, 'checked claim').id)).size !== claims.length || checkedClaims.some(item => !claimIds.has(text(record(item, 'checked claim').id, 'checked claim ID')))) fail('verification claim binding');
  const outputs = record(raw.originalGeneratedOutputs, 'generated outputs');
  same(outputs.packageDigest, digest, 'outputs digest');
  array(outputs.explanation, 'explanation'); record(outputs.review, 'scientific output review'); array(outputs.contributions, 'field contributions');
  const outputCoverage = array(outputs.coverage, 'output source coverage');
  if (outputCoverage.length !== coverage.length || new Set(outputCoverage.map(item => record(item, 'output coverage').id)).size !== coverage.length || outputCoverage.some(item => !coverageIds.has(text(record(item, 'output coverage').id, 'output coverage ID')))) fail('output coverage binding');
  const assessment = bind(raw.scientificAssessment, 'scientific assessment');
  const canonical = bind(raw.canonicalAssessment, 'canonical assessment');
  const literature = bind(raw.literatureAssessment, 'literature assessment');
  same(assessment.version, 'scientific-assessment-v1', 'scientific assessment version');
  same(canonical.version, 'canonical-assessment-v1', 'canonical assessment version');
  same(literature.version, 'literature-assessment-v1', 'literature assessment version');
  same(assessment.evidenceFingerprint, fingerprint, 'scientific evidence fingerprint');
  record(assessment.overall, 'overall assessment'); record(assessment.metaSummary, 'review summary'); array(assessment.sections, 'assessment sections'); array(assessment.tabSummaries, 'tab summaries');
  array(canonical.checks, 'canonical checks'); array(canonical.findings, 'canonical findings'); array(literature.papers, 'literature records'); array(literature.sections, 'literature sections');
  bind(assessment.geometryEvidence, 'geometry evidence');
  bind(assessment.claimVerificationPlan, 'claim verification plan');
  bind(assessment.restrictedCanonicalDerivation, 'restricted canonical derivation');
  const core = record(record(assessment.rigor, 'rigor').core, 'core rigor');
  same(core.total, checkedClaims.length, 'rigor scalar total');
  same(core.checked, checkedClaims.filter(item => record(item, 'checked claim').status === 'checked').length, 'rigor checked count');
  const rigorSource = record(record(assessment.rigor, 'rigor').source, 'source rigor');
  same(rigorSource.lines, lines.length, 'rigor source lines');
  same(rigorSource.coverageUnits, coverage.length, 'rigor source coverage');
  const run = record(raw.runSummary, 'run summary');
  const completion = record(run.counts, 'completed stages');
  for (const key of ['canonicalCompleted', 'literatureCompleted', 'integratedAssessmentCompleted']) same(completion[key], true, key);
  const log = bind(raw.sourceAndProcessingLog, 'processing log');
  const events = array(log.events, 'processing events');
  for (const event of events) { const item = record(event, 'processing event'); timestamp(item.at, 'event date'); text(item.stage, 'event stage'); text(item.message, 'event message'); }
  if (!('independentQA' in raw)) fail('independent QA');

  // Editorial wording changes remain separately attributed; they cannot alter
  // checker results, premises, originality labels, readiness or the model history.
  const amendments = array(raw.editorialAmendments ?? [], 'editorial amendments');
  if (amendments.length > 1) fail('unsupported editorial amendment count');
  const editorialAmendments = amendments.map(value => {
    const item = record(value, 'editorial amendment');
    same(item.version, 'review-editorial-amendment-v1', 'editorial amendment version');
    same(item.kind, 'wording-clarification', 'editorial amendment kind');
    same(item.sourceSha256, sourceSha256, 'editorial source hash');
    same(item.packageDigest, digest, 'editorial package digest');
    same(item.assessmentFingerprint, fingerprint, 'editorial assessment fingerprint');
    same(item.field, 'scientificAssessment.novelty.fieldContribution', 'editorial field');
    same(item.originalText, record(assessment.novelty, 'novelty').fieldContribution, 'editorial original wording');
    same(item.newModelRun, false, 'editorial model run');
    same(item.scientificEvidenceUnchanged, true, 'editorial evidence scope');
    text(item.id, 'editorial ID'); timestamp(item.createdAt, 'editorial date');
    for (const key of ['attribution', 'originalText', 'replacementText', 'reason']) text(item[key], `editorial ${key}`);
    return structuredClone(item) as unknown as SavedReviewEditorialAmendment;
  });
  const originalEvidenceUrl = options.originalEvidenceUrl ? artifactUrl(options.originalEvidenceUrl, 'original evidence URL') : null;
  if (editorialAmendments.length && !originalEvidenceUrl) fail('editorial original evidence URL');

  // Keep original scientific records in the download. This view changes only
  // two PDF display links and an explicitly recorded contribution-wording field.
  const saved = structuredClone(raw);
  for (const amendment of editorialAmendments) record(record(saved.scientificAssessment, 'scientific assessment').novelty, 'novelty').fieldContribution = amendment.replacementText;
  const savedPacket = saved.proposedFormulation as unknown as FormalPackage;
  const savedSource = record(saved.source, 'source').numberedSnapshot as unknown as IngestedSource;
  savedPacket.source.url = paperUrl;
  savedSource.fileUrl = paperUrl;
  const submissionId = `saved-review:${sourceId}`;
  const submission: FormalSubmission = {
    id: submissionId, title: savedPacket.title, sourceDocument: savedSource,
    currentRevision: {
      id: `saved-review:${digest}`, submissionId, revision: 1, package: savedPacket, digest,
      createdAt: timestamp(identity.startedAt, 'review start'), origin: 'ai', model,
      approvedAt: null, publishConsent: false,
      verification: saved.mathematicalVerification as unknown as VerificationReport,
      outputs: saved.originalGeneratedOutputs as unknown as FormalOutputs,
    },
  };
  return freeze({ submission, assessment: saved.scientificAssessment as unknown as ScientificAssessment, canonical: saved.canonicalAssessment as unknown as CanonicalAssessment, literature: saved.literatureAssessment as unknown as LiteratureAssessment, evidenceUrl, paperUrl, standaloneUrl, independentQA: saved.independentQA, events: record(saved.sourceAndProcessingLog, 'processing log').events as FormalJob['events'], createdAt, editorialAmendments, originalEvidenceUrl });
}

/** A snapshot may never supply evidence to another source, revision or approved submission. */
export function savedReviewMatchesSubmission(snapshot: SavedFormalReviewSnapshot, submission: FormalSubmission): boolean {
  const expected = snapshot.submission;
  return submission.id === expected.id && submission.currentRevision.id === expected.currentRevision.id
    && submission.currentRevision.submissionId === expected.id
    && submission.currentRevision.digest === expected.currentRevision.digest
    && submission.sourceDocument?.id === expected.sourceDocument?.id
    && submission.sourceDocument?.sha256 === expected.sourceDocument?.sha256
    && submission.currentRevision.package.source.sha256 === expected.sourceDocument?.sha256
    && submission.currentRevision.package.analysis?.sourceId === expected.sourceDocument?.id
    && submission.currentRevision.approvedAt === null && submission.currentRevision.publishConsent === false;
}
