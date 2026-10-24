import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(path.join(root, 'artifacts/api-server/package.json'));
let temp, pollFormalJob;
before(async () => {
  const { build } = require('esbuild');
  temp = await mkdtemp(path.join(tmpdir(), 'msr-formal-polling-'));
  const outfile = path.join(temp, 'polling.mjs');
  await build({ entryPoints: [path.join(root, 'artifacts/scireview/src/components/formalJobPolling.ts')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' });
  ({ pollFormalJob } = await import(pathToFileURL(outfile).href));
});
after(async () => { if (temp) await rm(temp, { recursive: true, force: true }); });

function manualClock() {
  let nextId = 0;
  const pending = new Map();
  return {
    schedule(callback, delay) { assert.equal(delay, 2000); const id = ++nextId; pending.set(id, callback); return id; },
    cancel(id) { pending.delete(id); },
    get pending() { return pending.size; },
    async next() { const item = pending.entries().next().value; assert(item, 'a next poll must be scheduled'); pending.delete(item[0]); await item[1](); },
  };
}
const running = { id: 'job-1', status: 'running', stage: 'formalize', updatedAt: '2026-10-23T01:00:00Z' };

test('unchanged job snapshots keep polling until the completed result arrives', async () => {
  const clock = manualClock();
  const complete = { ...running, status: 'complete', submissionId: 'submission-1' };
  const snapshots = [running, running, running, complete];
  const delivered = [];
  let reads = 0;
  pollFormalJob({ read: async () => snapshots[reads++], onValue: value => delivered.push(value), onError: error => { throw error; }, schedule: clock.schedule, cancel: clock.cancel });
  for (let index = 0; index < snapshots.length; index++) await clock.next();
  assert.equal(reads, 4);
  assert.deepEqual(delivered, snapshots);
  assert.equal(delivered.at(-1).submissionId, 'submission-1');
  assert.equal(clock.pending, 0, 'a terminal result must stop polling');
});

test('a transient read failure is reported and retried without editing server timestamps', async () => {
  const clock = manualClock();
  const errors = [], delivered = [];
  let reads = 0;
  pollFormalJob({ read: async () => { if (++reads === 1) throw new Error('temporary network failure'); return { ...running, status: 'complete' }; }, onValue: value => delivered.push(value), onError: error => errors.push(error.message), schedule: clock.schedule, cancel: clock.cancel });
  await clock.next();
  assert.deepEqual(errors, ['temporary network failure']);
  assert.equal(clock.pending, 1);
  await clock.next();
  assert.equal(delivered[0].updatedAt, running.updatedAt);
  assert.equal(delivered[0].status, 'complete');
  assert.equal(clock.pending, 0);
});

test('pending network reads never overlap and cleanup discards a late response', async () => {
  const clock = manualClock();
  let resolveRead;
  let reads = 0;
  const delivered = [], errors = [];
  const stop = pollFormalJob({ read: () => { reads++; return new Promise(resolve => { resolveRead = resolve; }); }, onValue: value => delivered.push(value), onError: error => errors.push(error), schedule: clock.schedule, cancel: clock.cancel });
  const inFlight = clock.next();
  assert.equal(reads, 1);
  assert.equal(clock.pending, 0, 'no second timer exists while a read is pending');
  stop();
  resolveRead(running);
  await inFlight;
  assert.deepEqual(delivered, []);
  assert.deepEqual(errors, []);
  assert.equal(clock.pending, 0);
});

test('cleanup removes a scheduled poll before it starts', () => {
  const clock = manualClock();
  let reads = 0;
  const stop = pollFormalJob({ read: async () => { reads++; return running; }, onValue: () => {}, onError: () => {}, schedule: clock.schedule, cancel: clock.cancel });
  assert.equal(clock.pending, 1);
  stop();
  assert.equal(clock.pending, 0);
  assert.equal(reads, 0);
});

test('failed server jobs are delivered once and stop polling', async () => {
  const clock = manualClock();
  const delivered = [];
  pollFormalJob({ read: async () => ({ ...running, status: 'failed', error: 'provider rejected the model' }), onValue: value => delivered.push(value), onError: error => { throw error; }, schedule: clock.schedule, cancel: clock.cancel });
  await clock.next();
  assert.equal(delivered[0].status, 'failed');
  assert.equal(clock.pending, 0);
});
