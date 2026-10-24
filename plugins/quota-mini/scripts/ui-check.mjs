import assert from 'node:assert/strict';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { loadPanel } from '../lib/mcp.mjs';

const runtimeRoot = dirname(dirname(process.execPath));
const playwrightPath = process.env.QUOTA_PLAYWRIGHT_PATH ?? join(runtimeRoot, 'node_modules', 'playwright', 'index.mjs');
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const browser = await chromium.launch({
  executablePath: process.env.QUOTA_BROWSER_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
});
const snapshot = {
  status: 'ok', short: { remainingPercent: 75.5, windowMinutes: 300, resetsAt: Date.now() / 1000 + 7200 },
  weekly: { remainingPercent: 90, windowMinutes: 10080, resetsAt: Date.now() / 1000 + 5 * 86400 },
  updatedAt: new Date().toISOString(),
};
const outputDir = resolve('reviews/quota-mini-checks');
await mkdir(outputDir, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 480, height: 390 }, deviceScaleFactor: 2 });
  await page.route('**/*', route => route.abort());
  await page.setContent('<html><body style="margin:0;padding:30px;background:#f2f4f3"><iframe id="app" title="额度小窗预览" style="width:380px;height:300px;border:0"></iframe></body></html>');
  await page.evaluate(({ html, snapshot }) => {
    const frame = document.getElementById('app');
    window.testHost = { snapshot, reads: 0, modes: [], rejectMode: false, rejectRead: false, unconfirmedMode: false, calls: [] };
    window.addEventListener('message', event => {
      if (event.source !== frame.contentWindow || event.data?.jsonrpc !== '2.0') return;
      const { method, id, params } = event.data;
      window.testHost.calls.push({ method, params });
      if (id === undefined) return;
      let result = {};
      let error;
      if (method === 'ui/initialize') {
        result = { protocolVersion: '2026-01-26', hostInfo: { name: 'test-host', version: '1.0.0' }, hostCapabilities: { serverTools: {} }, hostContext: { theme: 'light', availableDisplayModes: ['inline', 'pip', 'fullscreen'], displayMode: 'inline' } };
      } else if (method === 'tools/call' && params.name === 'read_quota') {
        window.testHost.reads++;
        if (window.testHost.rejectRead) error = { code: -32603, message: 'Authorization: Bearer SECRET' };
        else result = { structuredContent: window.testHost.snapshot, content: [] };
      } else if (method === 'tools/call' && params.name === 'open_desktop_quota') {
        result = { structuredContent: { desktopWindow: 'opened' }, content: [] };
      } else if (method === 'ui/request-display-mode') {
        window.testHost.modes.push(params.mode);
        if (window.testHost.rejectMode) error = { code: -32601, message: 'Unsupported' };
        else result = window.testHost.unconfirmedMode ? {} : { mode: params.mode };
      } else { error = { code: -32601, message: 'Unexpected request' }; }
      frame.contentWindow.postMessage({ jsonrpc: '2.0', id, ...(error ? { error } : { result }) }, '*');
    });
    frame.srcdoc = html;
  }, { html: await loadPanel(), snapshot });
  const frame = page.frameLocator('#app');
  await frame.locator('#short-value').filter({ hasText: '75.5%' }).waitFor();
  assert.equal(await frame.locator('#week-value').textContent(), '90%');
  assert.equal(await frame.locator('#short-label').textContent(), '5 小时');
  assert.equal(await frame.locator('#notice').isVisible(), false);
  await frame.getByRole('button', { name: '刷新额度', exact: true }).click();
  await page.waitForFunction(() => window.testHost.reads === 2);
  await frame.getByRole('button', { name: '桌面全局悬浮', exact: true }).click();
  await frame.locator('#notice').filter({ hasText: '桌面悬浮窗已打开' }).waitFor();
  assert.ok(await page.evaluate(() => window.testHost.calls.some(call => call.method === 'tools/call' && call.params?.name === 'open_desktop_quota' && Object.keys(call.params.arguments).length === 0)));
  await frame.getByRole('button', { name: '悬浮显示', exact: true }).click();
  await frame.getByRole('button', { name: '收回到对话内', exact: true }).waitFor();
  assert.equal(await frame.locator('body').getAttribute('data-mode'), 'pip');
  await frame.getByRole('button', { name: '收回到对话内', exact: true }).click();
  await frame.getByRole('button', { name: '悬浮显示', exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.testHost.modes), ['pip', 'inline']);
  await frame.locator('.card').screenshot({ path: join(outputDir, 'preview.png') });

  await page.evaluate(() => {
    window.testHost.rejectMode = true;
  });
  await frame.getByRole('button', { name: '悬浮显示', exact: true }).click();
  await frame.locator('#notice').filter({ hasText: '切换未成功' }).waitFor();
  assert.equal(await frame.locator('body').getAttribute('data-mode'), 'inline');

  // A successful RPC without a confirmed mode must not make a fake PiP UI.
  await page.evaluate(() => { window.testHost.rejectMode = false; window.testHost.unconfirmedMode = true; });
  await frame.getByRole('button', { name: '悬浮显示', exact: true }).click();
  await frame.locator('#notice').filter({ hasText: '切换未成功' }).waitFor();
  assert.equal(await frame.locator('body').getAttribute('data-mode'), 'inline');

  // Generic compatibility functions do not imply that the desktop host supports PiP.
  await frame.locator('body').evaluate(() => { window.openai = { requestDisplayMode: async () => ({ mode: 'pip' }) }; });
  await page.evaluate(() => document.getElementById('app').contentWindow.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { availableDisplayModes: ['inline', 'fullscreen'] } }, '*'));
  await frame.locator('#float').waitFor({ state: 'hidden' });
  const beforeHiddenClick = await page.evaluate(() => window.testHost.modes.length);
  await frame.locator('#float').evaluate(button => button.click());
  assert.equal(await page.evaluate(() => window.testHost.modes.length), beforeHiddenClick);

  // On hosts that do advertise PiP, fall back when only the compatibility API implements it.
  await page.evaluate(() => { window.testHost.rejectMode = true; document.getElementById('app').contentWindow.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { availableDisplayModes: ['inline', 'pip', 'fullscreen'] } }, '*'); });
  await frame.getByRole('button', { name: '悬浮显示', exact: true }).click();
  await frame.getByRole('button', { name: '收回到对话内', exact: true }).waitFor();
  assert.equal(await frame.locator('body').getAttribute('data-mode'), 'pip');
  await frame.locator('body').evaluate(() => { window.openai = { requestDisplayMode: async ({ mode }) => ({ mode }) }; });
  await frame.getByRole('button', { name: '收回到对话内', exact: true }).click();
  await frame.getByRole('button', { name: '悬浮显示', exact: true }).waitFor();
  await page.evaluate(() => document.getElementById('app').contentWindow.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { availableDisplayModes: ['inline', 'fullscreen'] } }, '*'));
  await frame.locator('#float').waitFor({ state: 'hidden' });
  await frame.getByRole('button', { name: '刷新额度', exact: true }).click();
  await frame.locator('#notice').waitFor({ state: 'hidden' });
  await frame.locator('.card').screenshot({ path: join(outputDir, 'preview.png') });
  await page.evaluate(() => {
    window.testHost.snapshot = { ...window.testHost.snapshot, status: 'stale', message: '读取超时，稍后会自动重试。' };
  });
  await frame.getByRole('button', { name: '刷新额度', exact: true }).click();
  await frame.locator('#notice').filter({ hasText: '读取超时' }).waitFor();
  assert.match(await frame.locator('#updated').textContent(), /上次成功/);
  assert.equal(await frame.locator('#short-value').textContent(), '75.5%');

  // Messages originating inside the iframe cannot impersonate the parent host.
  await frame.locator('body').evaluate(() => window.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: { status: 'ok', short: { remainingPercent: 1 } } } }, '*'));
  assert.equal(await frame.locator('#short-value').textContent(), '75.5%');

  await page.evaluate(() => { window.testHost.rejectRead = true; });
  await frame.getByRole('button', { name: '刷新额度', exact: true }).click();
  await frame.locator('#notice').filter({ hasText: '暂时无法更新' }).waitFor();
  assert.doesNotMatch(await frame.locator('body').textContent(), /SECRET|Bearer/);

  await page.evaluate(() => {
    window.testHost.rejectRead = false;
    window.testHost.snapshot = { status: 'error', message: '请先登录桌面版。' };
    document.getElementById('app').style.width = '240px';
  });
  await frame.getByRole('button', { name: '刷新额度', exact: true }).click();
  await frame.locator('#short-value').filter({ hasText: '—' }).waitFor();
  assert.equal(await frame.locator('#week-value').textContent(), '—');
  assert.equal(await frame.locator('body').evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  await page.evaluate(() => document.getElementById('app').contentWindow.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { theme: 'dark' } }, '*'));
  await frame.locator('body[data-theme="dark"]').waitFor();
  console.log(JSON.stringify({ uiChecks: 'passed', checks: ['initialization', 'two quota rows', 'manual refresh', 'desktop window tool bridge', 'PiP contract', 'PiP decline', 'unconfirmed mode rejection', 'unsupported PiP hidden despite compatibility API', 'compatibility fallback on an advertising host', 'stale state', 'foreign message rejection', 'secret redaction', 'missing quotas', 'narrow layout', 'dark theme'], screenshot: join(outputDir, 'preview.png'), host: 'simulated MCP Apps host; not the desktop app' }, null, 2));
} finally { await browser.close(); }
