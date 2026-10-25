import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(path.join(root, 'artifacts/api-server/package.json'));
let temp, helpers;
before(async () => { temp = await mkdtemp(path.join(tmpdir(), 'formal-result-navigation-')); const outfile = path.join(temp, 'helpers.mjs'); await require('esbuild').build({ entryPoints: [path.join(root, 'artifacts/scireview/src/components/formalResultNavigation.ts')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' }); helpers = await import(pathToFileURL(outfile).href); });
after(async () => { if (temp) await rm(temp, { recursive: true, force: true }); });
const coverage = Array.from({ length: 145 }, (_, index) => ({ id: `u${index}`, statement: `Statement ${index}`, status: index < 55 ? 'checked' : index < 77 ? 'adopted-input' : index === 142 ? 'partial' : index === 143 ? 'unsupported' : index === 144 ? 'not-assessed' : 'context' }));
const pkg = { selectedInputs: Array.from({ length: 25 }, (_, index) => ({ id: `i${index}` })), analysis: { extractionWarnings: ['The scalar check does not reproduce the canonical derivation.'] } };
const report = { claims: Array.from({ length: 51 }, (_, index) => ({ id: `c${index}`, title: 'Equation', status: 'checked' })) };
test('clickable counts use exact included records, including 25 inputs rather than 22 adopted coverage statements', () => { assert.deepEqual(helpers.resultCounts(pkg, report, coverage), { equations: 51, checkedEquations: 51, total: 145, checked: 55, inputs: 25, unresolved: 3 }); assert.equal(coverage.filter(item => item.status === 'adopted-input').length, 22); });
test('checked and unresolved filters return exactly the IDs counted without changing evidence', () => { const before = JSON.stringify(coverage); assert.deepEqual(helpers.selectedStatements(coverage, 'checked').map(item => item.id), coverage.slice(0, 55).map(item => item.id)); assert.deepEqual(helpers.selectedStatements(coverage, 'unresolved').map(item => item.id), ['u142', 'u143', 'u144']); assert.equal(JSON.stringify(coverage), before); });
test('all statements remain accessible and contradictions are unresolved without becoming a new paper verdict', () => { const entries = [...coverage, { id: 'contradicted', status: 'contradicted' }]; assert.equal(helpers.selectedStatements(entries, 'all').length, 146); assert.equal(helpers.selectedStatements(entries, 'unresolved').at(-1).id, 'contradicted'); });
test('issue links retain exact claim, coverage and warning identities and honest original statuses', () => { const issues = helpers.resultIssues(pkg, { claims: [{ id: 'unproved', title: 'Canonical variation', status: 'unsupported', message: 'Outside this scalar tool.' }] }, coverage, { warnings: ['PDF extraction note'] }, ['Output note']); assert.deepEqual(issues.map(item => [item.kind, item.itemId, item.status]), [['claim', 'unproved', 'unsupported'], ['coverage', 'u142', 'partial'], ['coverage', 'u143', 'unsupported'], ['coverage', 'u144', 'not-assessed'], ['warning', 'warning-0', 'Needs inspection'], ['source-warning', 'source-warning-0', 'Extraction note'], ['output-warning', 'output-warning-0', 'Output note']]); });
test('historical revision URLs accept only complete UUIDs', () => { const id = '00000000-0000-4000-a000-000000000009'; assert.equal(helpers.revisionIdFromSearch(`?submission=x&revision=${id}`), id); for (const query of ['?revision=../secrets', '?revision=1', '?revision=', '?submission=x']) assert.equal(helpers.revisionIdFromSearch(query), null); });

test('field eligibility labels distinguish context, premises, definitions and mixed narrative without mutating dispositions', () => {
  const items = [{id:'meta',role:'metadata',status:'context'},{id:'premise',role:'physical-input',status:'adopted-input'},{id:'def',role:'definition',status:'definition'}];
  const outputs = {coverage:items,explanation:[{id:'mixed',status:'unverified-context',claimIds:['c01']} ]};
  const report = {claims:[{id:'c01',status:'checked'}]};
  const contribution = sectionId => ({id:`coverage-contribution-${sectionId}`,sectionId,disposition:'unsupported'});
  assert.equal(helpers.fieldDispositionLabel(contribution('coverage-meta'),outputs,report),'Context, not a new result');
  assert.equal(helpers.fieldDispositionLabel(contribution('coverage-premise'),outputs,report),'Adopted premise');
  assert.equal(helpers.fieldDispositionLabel(contribution('coverage-def'),outputs,report),'Definition');
  const mixed=contribution('mixed');assert.equal(helpers.fieldDispositionLabel(mixed,outputs,report),'Not included as a whole');assert.equal(mixed.disposition,'unsupported');
  assert.equal(helpers.fieldDispositionLabel(mixed,outputs,{claims:[]}),'Not eligible as checked evidence');
});
test('unsupported coverage display describes tool limits and leaves actual contradictions intact', () => { assert.equal(helpers.coverageStatusLabel({role:'mathematical',status:'unsupported'}),'Not fully checked');assert.equal(helpers.coverageStatusLabel({role:'empirical',status:'unsupported'}),'Not empirically assessed');assert.equal(helpers.coverageStatusLabel({role:'mathematical',status:'contradicted'}),undefined); });

test('private export tickets are invalidated by account, submission, revision, digest or unmount changes', () => {
  const identity = (owner='author-a', submission='submission-a', revision='revision-a', digest='digest-a') => helpers.evidenceExportIdentity(owner,submission,revision,digest);
  for (const changed of [identity('author-b'),identity('author-a','submission-b'),identity('author-a','submission-a','revision-b'),identity('author-a','submission-a','revision-a','digest-b')]) {
    const scope=helpers.createEvidenceExportScope();scope.update(identity());const isCurrent=scope.begin();assert.equal(isCurrent(),true);scope.update(changed);assert.equal(isCurrent(),false);
  }
  const scope=helpers.createEvidenceExportScope();scope.update(identity());const beforeUnmount=scope.begin();scope.clear();assert.equal(beforeUnmount(),false);scope.update(identity());const first=scope.begin(),second=scope.begin();assert.equal(first(),false);assert.equal(second(),true);
});
