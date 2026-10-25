import type { FormalPackage, IngestedSource, FormalOutputs } from './contract';
import type {CanonicalAssessment} from './canonicalContract';
import type {LiteratureAssessment} from './literatureContract';
import type { AmendedSource, ReviewProposal, ReviewTarget, SourceEdit } from './reviewContract';
import { canonicalJson, FormalError, validatePackage } from './package';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const fail = (message: string): never => { throw new FormalError(message); };
function record(value: unknown, fields: string[], label: string): asserts value is Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
  if (Object.keys(value as object).some(key => !fields.includes(key))) fail(`${label} contains unsupported fields.`);
}
function text(value: unknown, label: string, max = 4000): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\u0000')) fail(`${label} must be nonempty text up to ${max} characters.`);
}
function list(value: unknown, max: number, label: string): asserts value is any[] {
  if (!Array.isArray(value) || value.length > max) fail(`${label} must contain at most ${max} items.`);
}
function jsonData(value: unknown, budget = { nodes: 0 }, depth = 0): void {
  if (++budget.nodes > 20000 || depth > 36) fail('The proposed change exceeds the supported complexity.');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (!value || typeof value !== 'object') fail('Proposed changes must contain JSON data only.');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null) fail('Proposed changes must contain plain JSON data.');
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (forbidden.has(key)) fail('A proposed change contains a prohibited object key.');
    jsonData(entry, budget, depth + 1);
  }
}
function sourceIdentity(pkg: FormalPackage, source: IngestedSource): void {
  if (!source || !uuid.test(source.id) || !/^[a-f0-9]{64}$/.test(source.sha256)) fail('Invalid numbered source identity.');
  if (pkg.analysis?.sourceId !== source.id || pkg.source.sha256 !== source.sha256 || pkg.source.url !== source.fileUrl || source.fileUrl !== `/api/formal-lab/sources/${source.id}/file`) fail('This formulation does not match the exact numbered source.');
  const lineIds = new Set<string>();
  if (!source.lines.length || source.lines.length > 900) fail('Invalid numbered source lines.');
  for (const line of source.lines) {
    if (!/^p[0-9]+-l[0-9]+$/.test(line.id) || lineIds.has(line.id) || typeof line.text !== 'string' || line.text.length > 4000) fail('Invalid or duplicate numbered source line.');
    lineIds.add(line.id);
  }
  const referenced = new Set<string>();
  for (const item of pkg.analysis!.coverage) for (const id of item.sourceLineIds) {
    if (!lineIds.has(id)) fail('Coverage references a line outside this numbered source.');
    referenced.add(id);
  }
  for (const item of [...pkg.analysis!.inputReferences, ...pkg.analysis!.claimReferences]) for (const id of item.sourceLineIds) if (!lineIds.has(id)) fail('A reference names a line outside this numbered source.');
  if (referenced.size !== lineIds.size) fail('Every numbered source line must remain represented in coverage.');
}
export function validateReviewTarget(pkg: FormalPackage, source: IngestedSource, value: unknown, context?: { outputs?: FormalOutputs;canonicalAssessment?:CanonicalAssessment;literatureAssessment?:LiteratureAssessment }): ReviewTarget {
  sourceIdentity(pkg, source);
  record(value, ['kind', 'id'], 'Comment target'); text(value.id, 'Comment target ID', 120);
  const indexed = (prefix: string, items: unknown[]) => { const match = value.id.match(new RegExp(`^${prefix}-(0|[1-9][0-9]*)$`)); return !!match && Number(match[1]) < items.length; };
  const valid = value.kind === 'main-claim' ? value.id === 'main-claim'
    : value.kind === 'input' ? pkg.selectedInputs.some(item => item.id === value.id)
    : value.kind === 'claim' ? pkg.claims.some(item => item.id === value.id)
    : value.kind === 'coverage' ? pkg.analysis!.coverage.some(item => item.id === value.id)
    : value.kind === 'assumption' ? indexed('assumption', pkg.assumptions)
    : value.kind === 'warning' ? indexed('warning', pkg.analysis!.extractionWarnings)
    : value.kind === 'definition' ? pkg.definitions.some(item => item.symbol === value.id || `definition-${item.symbol}` === value.id)
    : value.kind === 'source-line' ? source.lines.some(item => item.id === value.id)
    : value.kind === 'review-section' ? !!context?.outputs && ['summary','explanatoryContribution','correctness','physicalJustification','priorWork','strengths','openQuestions','recommendation'].includes(value.id)
    : value.kind === 'explanation-section' ? !!context?.outputs?.explanation.some(item => item.id === value.id)
    : value.kind === 'field-contribution' ? !!context?.outputs?.contributions.some(item => item.id === value.id)
    : value.kind === 'canonical-finding' ? !!context?.canonicalAssessment?.findings.some(item => item.id === value.id)
    : value.kind === 'literature-section' ? !!context?.literatureAssessment?.sections.some(item => item.id === value.id) : false;
  if (!valid) fail('The comment target is not part of this revision.');
  return structuredClone(value) as ReviewTarget;
}
const allowedPath = /^(?:\/mainClaim|\/(?:assumptions|limitations)\/(?:0|[1-9][0-9]*)|\/selectedInputs\/(?:0|[1-9][0-9]*)\/(?:version|title|statement|sourceUrl)|\/symbols\/(?:0|[1-9][0-9]*)\/(?:label|domain|dimensions)|\/definitions\/(?:0|[1-9][0-9]*)\/(?:expression|description)|\/claims\/(?:0|[1-9][0-9]*)\/(?:title|lhs|rhs|explanation)|\/consequences\/(?:0|[1-9][0-9]*)\/(?:title|text|claimIds)|\/analysis\/coverage\/(?:0|[1-9][0-9]*)\/(?:statement|role|sourceLineIds|claimIds|inputIds|reason)|\/analysis\/inputReferences\/(?:0|[1-9][0-9]*)\/(?:sourceLineIds|basis|justification)|\/analysis\/claimReferences\/(?:0|[1-9][0-9]*)\/sourceLineIds|\/analysis\/extractionWarnings\/(?:0|[1-9][0-9]*))$/;
function location(pkg: FormalPackage, path: string): { object: Record<string, unknown>; key: string } {
  if (!allowedPath.test(path)) fail('This proposal attempts to change a protected or unsupported field.');
  const parts = path.slice(1).split('/'); let current: any = pkg;
  for (const part of parts.slice(0, -1)) {
    if (!current || typeof current !== 'object' || !Object.hasOwn(current, part) || forbidden.has(part)) fail('The proposed field does not exist in this revision.');
    current = current[part];
  }
  const key = parts.at(-1)!;
  if (!current || typeof current !== 'object' || !Object.hasOwn(current, key) || forbidden.has(key)) fail('The proposed field does not exist in this revision.');
  return { object: current, key };
}
export function validateSourceEdits(source: IngestedSource, value: unknown): SourceEdit[] {
  list(value, 40, 'Source edits'); const ids = new Set<string>();
  for (const edit of value) {
    record(edit, ['lineId', 'before', 'after', 'reason'], 'Source edit'); text(edit.lineId, 'Source line ID', 100); text(edit.before, 'Original source line'); text(edit.after, 'Amended source line'); text(edit.reason, 'Reason for source amendment', 2000);
    if (ids.has(edit.lineId)) fail('A source line may be amended only once in one proposal.');
    ids.add(edit.lineId);
    const original = source.lines.find(line => line.id === edit.lineId);
    if (!original || original.text !== edit.before) throw new FormalError('A proposed source line no longer matches the original text. Reload this revision.', 409);
    if (edit.before === edit.after) fail('A source amendment must change its line.');
  }
  return structuredClone(value) as SourceEdit[];
}
export function validateReviewProposal(pkg: FormalPackage, source: IngestedSource, value: unknown): ReviewProposal {
  jsonData(value); sourceIdentity(pkg, source);
  record(value, ['summary', 'changes', 'sourceEdits', 'affectedClaimIds', 'consistencyNotes'], 'Review proposal');
  text(value.summary, 'Proposal summary', 4000); list(value.changes, 60, 'Proposed changes'); list(value.affectedClaimIds, 120, 'Affected claims'); list(value.consistencyNotes, 30, 'Consistency notes');
  if (value.affectedClaimIds.some(id => typeof id !== 'string' || !pkg.claims.some(claim => claim.id === id))) fail('Affected claims must name existing claim candidates.');
  if (new Set(value.affectedClaimIds).size !== value.affectedClaimIds.length) fail('Affected claim IDs must be unique.');
  for (const note of value.consistencyNotes) text(note, 'Consistency note', 3000);
  validateSourceEdits(source, value.sourceEdits);
  if (!value.changes.length && !value.sourceEdits.length) fail('A proposal needs an actual formulation or source change.');
  const candidate = structuredClone(pkg); const paths = new Set<string>();
  for (const change of value.changes) {
    record(change, ['path', 'before', 'after'], 'Proposed replacement'); text(change.path, 'Replacement path', 200);
    if (!Object.hasOwn(change, 'before') || !Object.hasOwn(change, 'after')) fail('A replacement needs exact before and after values.');
    if (paths.has(change.path)) fail('A field may be replaced only once in one proposal.'); paths.add(change.path);
    const entry = location(candidate, change.path);
    if (canonicalJson(entry.object[entry.key]) !== canonicalJson(change.before)) throw new FormalError('A proposed value no longer matches this revision. Reload before applying it.', 409);
    if (canonicalJson(change.before) === canonicalJson(change.after)) fail('A proposed replacement must change its value.');
    entry.object[entry.key] = structuredClone(change.after);
  }
  const validated = validatePackage(candidate); sourceIdentity(validated, source);
  return structuredClone(value) as ReviewProposal;
}
export function applyReviewProposal(pkg: FormalPackage, source: IngestedSource, value: unknown): { package: FormalPackage; sourceEdits: SourceEdit[]; affectedClaimIds: string[]; requiresReverification: true } {
  const proposal = validateReviewProposal(pkg, source, value); const next = structuredClone(pkg);
  for (const change of proposal.changes) { const entry = location(next, change.path); entry.object[entry.key] = structuredClone(change.after); }
  return { package: validatePackage(next), sourceEdits: proposal.sourceEdits, affectedClaimIds: next.claims.map(claim => claim.id), requiresReverification: true };
}
/** Only a server-created child of the exact prior source can replace source identity. */
export function adoptAmendedSource(pkg: FormalPackage, original: IngestedSource, amended: AmendedSource): FormalPackage {
  sourceIdentity(pkg, original);
  if (!amended.amendment || amended.amendment.kind !== 'amended-transcription' || amended.amendment.parentSourceId !== original.id || amended.amendment.parentSha256 !== original.sha256 || amended.id === original.id || amended.mimeType !== 'text/plain') fail('An amended transcription must descend from this exact source.');
  const edits = validateSourceEdits(original, amended.amendment.edits); const byId = new Map(edits.map(edit => [edit.lineId, edit.after]));
  if (amended.lines.length !== original.lines.length || amended.lines.some((line, index) => line.id !== original.lines[index].id || line.page !== original.lines[index].page || line.line !== original.lines[index].line || line.text !== (byId.get(line.id) ?? original.lines[index].text))) fail('An amended transcription must preserve numbered source identities and approved changes.');
  const next = structuredClone(pkg); next.analysis!.sourceId = amended.id; next.source.sha256 = amended.sha256; next.source.url = amended.fileUrl;
  const joined = amended.lines.map(line => line.text).join('\n'); next.source.excerpt = joined.length <= 45000 ? joined : amended.lines.map(line => line.text).join('');
  next.source.version = `Amended transcription ${amended.createdAt}`;
  const validated = validatePackage(next); sourceIdentity(validated, amended); return validated;
}
