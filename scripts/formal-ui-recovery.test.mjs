import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(path.join(root, 'artifacts/api-server/package.json'));
let temp, api;
before(async () => {
  const { build } = require('esbuild');
  temp = await mkdtemp(path.join(tmpdir(), 'msr-formal-recovery-'));
  const outfile = path.join(temp, 'recovery.mjs');
  await build({ entryPoints: [path.join(root, 'artifacts/scireview/src/components/formalIntakeRecovery.ts')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' });
  api = await import(pathToFileURL(outfile).href);
});
after(async () => { if (temp) await rm(temp, { recursive: true, force: true }); });
const sourceId = '00000000-0000-4000-a000-000000000001';
const oldSourceId = '00000000-0000-4000-a000-000000000002';
const jobId = '00000000-0000-4000-a000-000000000003';
const source = { id: sourceId, filename: 'one-page.pdf', lines: [], pageCount: 1 };
const failedJob = { id: jobId, kind: 'analyze', status: 'failed', sourceId, model: { id: 'sol', model: 'gpt-6.1-sol' }, error: 'timeout' };
function store() { const data = new Map(); return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key), data }; }

test('a failed analysis retains source and model across repeated reloads after active-job cleanup', async () => {
  const saved = store();
  api.retainIntake(saved, 'author-a', { sourceId, jobId, modelId: 'sol' });
  api.rememberActiveJob(saved, 'author-a', jobId);
  for (let reload = 0; reload < 2; reload++) {
    const calls = [];
    const recovered = await api.recoverFormalIntake({ reference: api.readRetainedIntake(saved, 'author-a'), activeJobId: api.readActiveJob(saved, 'author-a'), readJob: async id => { calls.push(['job', id]); return failedJob; }, readSource: async id => { calls.push(['source', id]); return source; }, isCurrent: () => true });
    assert.equal(recovered.source.id, sourceId);
    assert.equal(recovered.modelId, 'sol');
    assert.equal(recovered.job.status, 'failed');
    assert.deepEqual(calls, [['job', jobId], ['source', sourceId]]);
    api.clearActiveJob(saved, 'author-a');
    assert(api.readRetainedIntake(saved, 'author-a'), 'terminal job cleanup must not discard the source reference');
  }
});

test('retained sources and active jobs are scoped to the signed-in author', () => {
  const saved = store();
  api.retainIntake(saved, 'author-a', { sourceId, jobId, modelId: 'sol' });
  api.rememberActiveJob(saved, 'author-a', jobId);
  assert.equal(api.readRetainedIntake(saved, 'author-b'), null);
  assert.equal(api.readActiveJob(saved, 'author-b'), null);
  saved.data.set('formal-lab-retained-source:author-b', JSON.stringify({ userId: 'author-a', sourceId }));
  assert.equal(api.readRetainedIntake(saved, 'author-b'), null);
});

test('the authenticated job source and model take precedence over stale local references', async () => {
  const reads = [];
  const recovered = await api.recoverFormalIntake({ reference: { userId: 'author-a', sourceId: oldSourceId, modelId: 'argon', jobId }, activeJobId: null, readJob: async () => failedJob, readSource: async id => { reads.push(id); return source; }, isCurrent: () => true });
  assert.deepEqual(reads, [sourceId]);
  assert.equal(recovered.modelId, 'sol');
});

test('new file selection or account change cancels recovery before another source is read', async () => {
  let current = true, finishJob;
  let sourceReads = 0;
  const pending = api.recoverFormalIntake({ reference: null, activeJobId: jobId, readJob: () => new Promise(resolve => { finishJob = resolve; }), readSource: async () => { sourceReads++; return source; }, isCurrent: () => current });
  current = false;
  finishJob(failedJob);
  assert.equal(await pending, null);
  assert.equal(sourceReads, 0);
});

test('a source response arriving after unmount or a changed workspace is discarded', async () => {
  let current = true, finishSource;
  const pending = api.recoverFormalIntake({ reference: { userId: 'author-a', sourceId }, activeJobId: null, readJob: async () => { throw new Error('no job should be fetched'); }, readSource: () => new Promise(resolve => { finishSource = resolve; }), isCurrent: () => current });
  current = false;
  finishSource(source);
  assert.equal(await pending, null);
});

test('forbidden or missing sources return an explicit recovery error with no source', async () => {
  for (const status of [403, 404]) {
    const error = Object.assign(new Error('Source not found'), { status });
    const recovered = await api.recoverFormalIntake({ reference: { userId: 'author-a', sourceId }, activeJobId: null, readJob: async () => failedJob, readSource: async () => { throw error; }, isCurrent: () => true });
    assert.equal(recovered.source, null);
    assert.equal(recovered.sourceError.status, status);
  }
});

test('invalid identifiers cannot become restoration requests and a new selection clears the retained reference', async () => {
  const saved = store();
  api.retainIntake(saved, 'author-a', { sourceId: '../other-source', modelId: 'sol' });
  assert.equal(api.readRetainedIntake(saved, 'author-a'), null);
  saved.data.set('formal-lab-retained-source:author-a', JSON.stringify({ userId: 'author-a', sourceId, jobId: '../bad-job' }));
  assert.equal(api.readRetainedIntake(saved, 'author-a'), null);
  let reads = 0;
  const recovered = await api.recoverFormalIntake({ reference: null, activeJobId: '../bad-job', readJob: async () => { reads++; return failedJob; }, readSource: async () => { reads++; return source; }, isCurrent: () => true });
  assert.equal(reads, 0);
  assert.equal(recovered.source, null);
  api.retainIntake(saved, 'author-a', { sourceId });
  api.clearRetainedIntake(saved, 'author-a');
  assert.equal(api.readRetainedIntake(saved, 'author-a'), null);
});

test('recovery storage remains optional', () => {
  api.retainIntake(null, 'author-a', { sourceId });
  api.rememberActiveJob(null, 'author-a', jobId);
  api.clearRetainedIntake(null, 'author-a');
  api.clearActiveJob(null, 'author-a');
  assert.equal(api.readRetainedIntake(null, 'author-a'), null);
  assert.equal(api.readActiveJob(null, 'author-a'), null);
});


test('a valid private job URL restores the original source without browser storage', async () => {
  const explicitJob = api.queryFormalJobId(`?job=${jobId}`);
  assert.equal(explicitJob, jobId);
  const reads = [];
  const recovered = await api.recoverFormalIntake({ reference: null, activeJobId: explicitJob, readJob: async id => { reads.push(['job', id]); return failedJob; }, readSource: async id => { reads.push(['source', id]); return source; }, isCurrent: () => true });
  assert.equal(recovered.source.id, sourceId);
  assert.equal(recovered.modelId, 'sol');
  assert.deepEqual(reads, [['job', jobId], ['source', sourceId]]);
});

test('job recovery URL selection rejects path fragments and prefers an explicit valid job', async () => {
  assert.equal(api.queryFormalJobId('?job=../another-user'), null);
  assert.equal(api.queryFormalJobId('?job=%2Fapi%2Fother'), null);
  assert.equal(api.queryFormalJobId('?job='), null);
  assert.equal(api.queryFormalJobId('?submission=a'), null);
  const anotherJobId = '00000000-0000-4000-a000-000000000004';
  const selected = api.queryFormalJobId(`?job=${jobId}`) || anotherJobId;
  const recovered = await api.recoverFormalIntake({ reference: { userId: 'author-a', sourceId: oldSourceId, jobId: anotherJobId }, activeJobId: selected, readJob: async id => { assert.equal(id, jobId); return failedJob; }, readSource: async id => { assert.equal(id, sourceId); return source; }, isCurrent: () => true });
  assert.equal(recovered.job.id, jobId);
});
