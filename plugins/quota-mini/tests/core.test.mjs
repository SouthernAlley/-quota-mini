import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQuota, QuotaError, readQuota } from '../lib/codex-quota.mjs';
import { createQuotaCache } from '../lib/cache.mjs';
import { createMcpHandler, loadPanel, UI_URI } from '../lib/mcp.mjs';

const window = (usedPercent, windowDurationMins, resetsAt = 1900000000) => ({ usedPercent, windowDurationMins, resetsAt });
const fixture = { rateLimitsByLimitId: { codex: { primary: window(24.5, 300), secondary: window(10, 10080) } } };

test('displays remaining, not used; selects the Codex pool and strips unknown private fields', () => {
  const input = structuredClone(fixture);
  input.accessToken = 'NEVER_RETURN_THIS';
  input.rateLimitsByLimitId.codex.email = 'private@example.test';
  input.rateLimits = { primary: window(99, 300) };
  const result = normalizeQuota(input, 1700000000000);
  assert.equal(result.short.remainingPercent, 75.5);
  assert.equal(result.weekly.remainingPercent, 90);
  assert.equal(result.updatedAt, '2023-11-14T22:13:20.000Z');
  assert.doesNotMatch(JSON.stringify(result), /NEVER_RETURN_THIS|private@example|email|accessToken/);
});

test('matches windows by duration, including reversed order and a missing short window', () => {
  const result = normalizeQuota({ rateLimits: { primary: window(2, 10080), secondary: window(35, 300) } });
  assert.equal(result.short.remainingPercent, 65);
  assert.equal(result.weekly.remainingPercent, 98);
  const weeklyOnly = normalizeQuota({ rateLimits: { primary: null, secondary: window(25, 10080) } });
  assert.equal(weeklyOnly.short, null);
  assert.equal(weeklyOnly.weekly.remainingPercent, 75);
});

test('never relabels another product or an ambiguous multi-pool fallback as Codex', () => {
  const primary = window(40, 300);
  assert.throws(() => normalizeQuota({ rateLimits: { limitId: 'other', primary } }), QuotaError);
  assert.throws(() => normalizeQuota({ rateLimitsByLimitId: { other: { primary } }, rateLimits: { primary } }), QuotaError);
  assert.throws(() => normalizeQuota({ rateLimitsByLimitId: { codex: { limitId: 'other', primary } } }), QuotaError);
});

test('preserves legacy single-pool responses and explicitly identified Codex fallbacks', () => {
  const primary = window(25, 15);
  assert.equal(normalizeQuota({ rateLimits: { primary } }).short.windowMinutes, 15);
  assert.equal(normalizeQuota({ rateLimitsByLimitId: {}, rateLimits: { primary } }).short.remainingPercent, 75);
  const result = normalizeQuota({ rateLimitsByLimitId: { other: { primary: window(90, 300) } }, rateLimits: { limitId: 'codex', primary } });
  assert.equal(result.short.remainingPercent, 75);
});

test('malformed reset timestamps cannot crash date formatting', () => {
  const result = normalizeQuota({ rateLimits: { primary: window(25, Infinity, 1e300) } });
  assert.equal(result.short.remainingPercent, 75);
  assert.equal(result.short.resetsAt, null);
  assert.equal(result.short.windowMinutes, null);
});

test('never invents 100% when limits are unavailable, and clamps out-of-range values', () => {
  assert.throws(() => normalizeQuota({}), QuotaError);
  assert.throws(() => normalizeQuota({ rateLimits: { primary: window(NaN, 300) } }), QuotaError);
  const result = normalizeQuota({ rateLimits: { primary: window(150, 300), secondary: window(-20, 10080) } });
  assert.equal(result.short.remainingPercent, 0);
  assert.equal(result.weekly.remainingPercent, 100);
});

test('coalesces concurrent reads and throttles duplicate refreshes', async () => {
  let reads = 0;
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const getQuota = createQuotaCache(async () => { reads++; await waiting; return normalizeQuota(fixture); });
  const first = getQuota();
  const second = getQuota();
  release();
  assert.deepEqual(await first, await second);
  assert.equal(reads, 1);
  await getQuota();
  assert.equal(reads, 1);
});

test('preserves the last good timestamp on failure and labels cached data as stale', async () => {
  let clock = 0;
  let calls = 0;
  const original = normalizeQuota(fixture, 1700000000000);
  const getQuota = createQuotaCache(async () => {
    calls++;
    if (calls === 1) return original;
    throw new QuotaError('timeout', '读取超时，稍后会自动重试。');
  }, { now: () => clock });
  await getQuota();
  clock = 31000;
  const result = await getQuota();
  assert.equal(result.status, 'stale');
  assert.equal(result.updatedAt, original.updatedAt);
  assert.equal(result.short.remainingPercent, 75.5);
  clock = 32000;
  assert.equal((await getQuota()).status, 'stale');
  assert.equal(calls, 2);
});

test('never forwards raw upstream error messages to the UI', async () => {
  const getQuota = createQuotaCache(async () => { throw new Error('Authorization: Bearer SECRET'); });
  const result = await getQuota();
  assert.equal(result.status, 'error');
  assert.doesNotMatch(JSON.stringify(result), /Bearer|SECRET/);
});

test('distinguishes quota reads from desktop window actions and exposes a non-network UI resource', async () => {
  const handler = createMcpHandler({ getQuota: async () => normalizeQuota(fixture), html: await loadPanel() });
  const call = (method, params) => handler({ jsonrpc: '2.0', id: 1, method, params });
  const list = await call('tools/list');
  assert.deepEqual(list.tools.map(x => x.name), ['open_quota_panel', 'read_quota', 'open_desktop_quota', 'close_desktop_quota']);
  assert.equal(list.tools[0]._meta['openai/ui'].preferredModelDisplayMode, 'inline');
  assert.ok(list.tools.slice(0, 2).every(x => x.annotations.readOnlyHint && !x.annotations.destructiveHint));
  assert.ok(list.tools.slice(2).every(x => x.annotations.readOnlyHint === false && !x.annotations.destructiveHint));
  const result = await call('tools/call', { name: 'open_quota_panel', arguments: {} });
  assert.equal(result.structuredContent.short.remainingPercent, 75.5);
  const resource = (await call('resources/read', { uri: UI_URI })).contents[0];
  assert.equal(resource.mimeType, 'text/html;profile=mcp-app');
  assert.deepEqual(resource._meta.ui.csp.connectDomains, []);
  assert.equal(resource._meta['openai/ui'].preferredDisplayMode, 'inline');
  assert.doesNotMatch(resource.text, /__QUOTA_CSS__|__QUOTA_JS__|<script\s+src=|fetch\(/);
  assert.match(resource.text, /ui\/initialize/);
});

test('rejects arbitrary commands, credentials, file paths, and mutating RPC methods', async () => {
  let reads = 0;
  const handler = createMcpHandler({ getQuota: async () => { reads++; return {}; }, html: '' });
  const call = (method, params) => handler({ jsonrpc: '2.0', id: 1, method, params });
  assert.equal((await call('tools/call', { name: 'read_quota', arguments: { command: 'anything' } })).error.code, -32602);
  assert.equal((await call('tools/call', { name: 'logout' })).error.code, -32602);
  assert.equal((await call('resources/read', { uri: 'file:///auth.json' })).error.code, -32602);
  assert.equal((await call('account/rateLimitResetCredit/consume')).error.code, -32601);
  assert.equal(reads, 0);
});

test('a missing reader runtime fails safely without an auth-file fallback', async () => {
  await assert.rejects(readQuota({ executable: 'quota-mini-nonexistent-runtime-777', timeoutMs: 2000 }), error => {
    assert.equal(error.code, 'runtime');
    assert.doesNotMatch(error.message, /auth\.json|token/i);
    return true;
  });
});
