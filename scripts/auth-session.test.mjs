import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(path.join(root, 'artifacts/api-server/package.json'));
const { build } = require('esbuild');
const express = require('express');
const cookieParser = require('cookie-parser');
const dir = await mkdtemp(path.join(tmpdir(), 'auth-session-tests-'));
const key = Symbol.for('msr.auth-session.tests');
const state = { sessions: new Map(), users: new Map(), grants: [], refreshes: 0, updates: 0 };
globalThis[key] = state;

const fakeDb = String.raw`
const state = globalThis[Symbol.for('msr.auth-session.tests')];
export const sessionsTable = { kind: 'sessions', sid: 'sid' };
export const usersTable = { kind: 'users', id: 'id' };
export const db = {
  insert(table) { return { values(value) {
    if (table.kind === 'sessions') {
      state.sessions.set(value.sid, structuredClone(value));
      return Promise.resolve();
    }
    return { onConflictDoUpdate() { return { async returning() {
      state.users.set(value.id, structuredClone(value));
      return [value];
    } }; } };
  } }; },
  select() { return { from() { return { async where(condition) {
    const row = state.sessions.get(condition.value); return row ? [row] : [];
  } }; } }; },
  delete() { return { async where(condition) { state.sessions.delete(condition.value); } }; },
  update() { state.updates++; throw Error('Session requests must not renew the fixed lifetime'); },
};`;
const fakeOidc = String.raw`
const state = globalThis[Symbol.for('msr.auth-session.tests')];
export async function discovery() { return { issuer: 'test-only' }; }
export function ClientSecretPost() { return { method: 'client_secret_post' }; }
export function randomState() { return 'test-state'; }
export function randomNonce() { return 'test-nonce'; }
export function randomPKCECodeVerifier() { return 'test-verifier'; }
export async function calculatePKCECodeChallenge(verifier) { return 'challenge-for-' + verifier; }
export function buildAuthorizationUrl(_config, params) {
  state.authorizationParams = params;
  return new URL('https://identity.invalid/authorize');
}
export async function authorizationCodeGrant(_config, url, checks) {
  state.grants.push({ code: url.searchParams.get('code'), checks: structuredClone(checks) });
  // Simulate the provider/library rejecting a bad state, nonce or PKCE verifier.
  // The test verifies the application forwards all checks to that boundary.
  if (url.searchParams.get('state') !== checks.expectedState ||
      checks.expectedNonce !== 'test-nonce' ||
      checks.pkceCodeVerifier !== 'test-verifier' || !checks.idTokenExpected) {
    throw Error('OIDC validation failed');
  }
  return {
    claims() { return state.claims; },
    get access_token() { throw Error('Provider access token must not be retained'); },
    get refresh_token() { throw Error('Provider refresh token must not be retained'); },
    expiresIn() { throw Error('Provider expiration must not drive the site session'); },
  };
}
export async function refreshTokenGrant() { state.refreshes++; throw Error('No provider refresh after login'); }
export function buildEndSessionUrl() { return new URL('https://identity.invalid/logout'); }
`;
await build({
  stdin: { contents: "export * from './lib/auth.ts'; export {authMiddleware} from './middlewares/authMiddleware.ts'; export {default as authRouter} from './routes/auth.ts';", resolveDir: path.join(root, 'artifacts/api-server/src'), loader: 'ts' },
  outfile: path.join(dir, 'auth.mjs'), platform: 'node', bundle: true, format: 'esm', logLevel: 'silent',
  banner: { js: "import {createRequire} from 'node:module'; const require = createRequire(import.meta.url);" },
  define: {
    'process.env.OIDC_CLIENT_ID': JSON.stringify('test-client'),
    'process.env.OIDC_CLIENT_SECRET': JSON.stringify('test-client-secret'),
    'process.env.ISSUER_URL': JSON.stringify('https://identity.invalid'),
    'process.env.PUBLIC_WEB_ORIGIN': JSON.stringify('https://site.invalid'),
    'process.env.OIDC_SCOPES': JSON.stringify('openid email profile'),
    'process.env.OIDC_PROMPT': JSON.stringify('select_account'),
  },
  plugins: [{ name: 'isolated-auth-boundaries', setup(b) {
    const mocks = { '@workspace/db': fakeDb, 'openid-client': fakeOidc, 'drizzle-orm': 'export function eq(column,value) { return {column,value}; }', 'logger': 'export const logger = {error(){},info(){}};' };
    b.onResolve({ filter: /^(@workspace\/db|openid-client|drizzle-orm)$/ }, args => ({ path: args.path, namespace: 'mock' }));
    b.onResolve({ filter: /\/lib\/logger$/ }, () => ({ path: 'logger', namespace: 'mock' }));
    b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'ts' }));
  } }],
});
const { createSession, getSession, SESSION_TTL, authMiddleware, authRouter } = await import(pathToFileURL(path.join(dir, 'auth.mjs')).href);
const app = express();
app.use(express.json(), cookieParser());
app.use((req, _res, next) => { req.log = { error() {} }; next(); });
app.use(authMiddleware);
app.use('/api', authRouter);
const server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
const base = 'http://127.0.0.1:' + server.address().port;
after(async () => { await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); delete globalThis[key]; });

const user = { id: 'test-user', email: 'author@example.invalid', firstName: 'Test', lastName: 'Author', profileImageUrl: null };
function reset() {
  state.sessions.clear(); state.users.clear(); state.grants.length = 0; state.refreshes = 0; state.updates = 0;
  state.claims = { sub: user.id, email: user.email, given_name: user.firstName, family_name: user.lastName, exp: 1 };
  delete state.authorizationParams;
}
async function request(url, options = {}) { return fetch(base + url, { redirect: 'manual', ...options }); }
function cookieHeader(overrides = {}) {
  return Object.entries({ code_verifier: 'test-verifier', nonce: 'test-nonce', state: 'test-state', return_to: '/formal-lab', ...overrides }).map(([name, value]) => name + '=' + encodeURIComponent(value)).join('; ');
}
function onlySession() { assert.equal(state.sessions.size, 1); return [...state.sessions.values()][0]; }
function assertIdentity(row) { assert.deepEqual(row.sess, { user }); assert(!JSON.stringify(row.sess).includes('token')); }

test('session creation allowlists identity at both levels and fixes the seven-day lifetime', async () => {
  reset();
  const submitted = { user: { ...user, access_token: 'nested-provider-token', privileges: ['admin'] }, access_token: 'provider-token', refresh_token: 'provider-refresh', expires_at: 1, extra: true };
  const before = Date.now(); const sid = await createSession(submitted); const after = Date.now();
  assert.match(sid, /^[a-f0-9]{64}$/); assert.equal(SESSION_TTL, 7 * 24 * 60 * 60 * 1000);
  const row = onlySession(); assertIdentity(row);
  assert(row.expire.getTime() >= before + SESSION_TTL && row.expire.getTime() <= after + SESSION_TTL);
  assert.equal(submitted.refresh_token, 'provider-refresh', 'caller data is not mutated');
});

test('legacy provider credentials are never returned, refreshed or copied into identity', async () => {
  reset(); const sid = 'legacy-session'; const expiry = new Date(Date.now() + 123456);
  state.sessions.set(sid, { sid, expire: expiry, sess: { user: { ...user, refresh_token: 'nested-old-token' }, access_token: 'old-access', refresh_token: 'old-refresh', expires_at: 1 } });
  assert.deepEqual(await getSession(sid), { user });
  for (const headers of [{ Cookie: 'sid=' + sid }, { Authorization: 'Bearer ' + sid }]) {
    const response = await request('/api/auth/user', { headers }); assert.equal(response.status, 200); assert.deepEqual(await response.json(), { user });
  }
  assert.equal(state.sessions.get(sid).expire.getTime(), expiry.getTime()); assert.equal(state.updates, 0); assert.equal(state.refreshes, 0);
});

test('expired, deleted and malformed sessions fail closed and clear the browser cookie', async () => {
  reset();
  for (const [sid, row] of [['expired', { expire: new Date(0), sess: { user } }], ['malformed', { expire: new Date(Date.now() + SESSION_TTL), sess: { user: { id: '' }, refresh_token: 'old' } }]]) state.sessions.set(sid, { sid, ...row });
  for (const sid of ['expired', 'malformed', 'deleted']) {
    const response = await request('/api/auth/user', { headers: { Cookie: 'sid=' + sid } });
    assert.deepEqual(await response.json(), { user: null }); assert.match(response.headers.get('set-cookie'), /^sid=;/); assert(!state.sessions.has(sid));
  }
  await assert.rejects(() => createSession({ user: null }), /Invalid session identity/); assert.equal(state.sessions.size, 0);
});

test('browser login preserves PKCE, state, nonce and secure transient cookies', async () => {
  reset(); const response = await request('/api/login?returnTo=%2Fformal-lab');
  assert.equal(response.status, 302); assert.equal(state.authorizationParams.scope, 'openid email profile');
  assert.equal(state.authorizationParams.redirect_uri, 'https://site.invalid/api/callback');
  assert.equal(state.authorizationParams.state, 'test-state'); assert.equal(state.authorizationParams.nonce, 'test-nonce');
  assert.equal(state.authorizationParams.code_challenge, 'challenge-for-test-verifier'); assert.equal(state.authorizationParams.code_challenge_method, 'S256');
  const cookies = response.headers.getSetCookie(); assert.equal(cookies.length, 4);
  for (const cookie of cookies) { assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Lax/); }
});

test('browser callback stores only identity after the validated exchange and retains safe return and cookie behavior', async () => {
  reset(); const response = await request('/api/callback?code=test-code&state=test-state', { headers: { Cookie: cookieHeader() } });
  assert.equal(response.status, 302); assert.equal(response.headers.get('location'), '/formal-lab'); assertIdentity(onlySession());
  assert.deepEqual(state.grants[0].checks, { pkceCodeVerifier: 'test-verifier', expectedNonce: 'test-nonce', expectedState: 'test-state', idTokenExpected: true });
  const cookie = response.headers.getSetCookie().find(value => value.startsWith('sid='));
  assert.match(cookie, /Max-Age=604800/); assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Lax/);
});

test('browser callback cannot create a session when state, nonce, PKCE or ID claims validation fails', async () => {
  for (const [query, overrides] of [['state=wrong', {}], ['state=test-state', { nonce: 'wrong' }], ['state=test-state', { code_verifier: 'wrong' }], ['state=test-state', { state: '' }]]) {
    reset(); const response = await request('/api/callback?code=test-code&' + query, { headers: { Cookie: cookieHeader(overrides) } });
    assert.equal(response.status, 302); assert.equal(response.headers.get('location'), '/api/login'); assert.equal(state.sessions.size, 0);
  }
  reset(); state.claims = undefined;
  const response = await request('/api/callback?code=test-code&state=test-state', { headers: { Cookie: cookieHeader() } });
  assert.equal(response.headers.get('location'), '/api/login'); assert.equal(state.sessions.size, 0);
});

test('mobile exchange returns the site bearer token and never persists provider credentials', async () => {
  reset(); const response = await request('/api/mobile-auth/token-exchange', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'test-code', code_verifier: 'test-verifier', redirect_uri: 'https://mobile.invalid/callback', state: 'test-state', nonce: 'test-nonce' }) });
  assert.equal(response.status, 200); const result = await response.json(); assert.match(result.token, /^[a-f0-9]{64}$/); assert.equal(result.token, onlySession().sid); assertIdentity(onlySession());
  assert.deepEqual(state.grants[0].checks, { pkceCodeVerifier: 'test-verifier', expectedNonce: 'test-nonce', expectedState: 'test-state', idTokenExpected: true });
});

test('mobile exchange rejects invalid input and provider validation without creating a session', async () => {
  reset(); const badInput = await request('/api/mobile-auth/token-exchange', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(badInput.status, 400); assert.equal(state.grants.length, 0);
  const response = await request('/api/mobile-auth/token-exchange', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'test-code', code_verifier: 'wrong', redirect_uri: 'https://mobile.invalid/callback', state: 'test-state', nonce: 'test-nonce' }) });
  assert.equal(response.status, 500); assert.equal(state.sessions.size, 0);
});

test('browser and mobile logout invalidate the stored session', async () => {
  reset(); let sid = await createSession({ user });
  const browser = await request('/api/logout', { headers: { Cookie: 'sid=' + sid } });
  assert.equal(browser.status, 302); assert.equal(state.sessions.size, 0); assert.match(browser.headers.get('set-cookie'), /^sid=;/);
  sid = await createSession({ user });
  const mobile = await request('/api/mobile-auth/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + sid } });
  assert.equal(mobile.status, 200); assert.deepEqual(await mobile.json(), { success: true }); assert.equal(state.sessions.size, 0);
});
