import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const child = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
const pending = new Map();
let nextId = 0;
const lines = createInterface({ input: child.stdout });
lines.on('line', line => {
  const message = JSON.parse(line);
  const item = pending.get(message.id);
  if (item) { clearTimeout(item.timer); pending.delete(message.id); message.error ? item.reject(message.error) : item.resolve(message.result); }
});
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('MCP timeout')); }, 24000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
try {
  const init = await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'quota-mini-verifier', version: '0.1.0' } });
  assert.equal(init.serverInfo.name, 'quota-mini');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const list = await call('tools/list');
  assert.equal(list.tools.length, 4);
  const resource = await call('resources/read', { uri: list.tools[0]._meta.ui.resourceUri });
  assert.ok(resource.contents[0].text.includes('ui/initialize'));
  const report = { protocol: init.protocolVersion, tools: list.tools.map(tool => ({ name: tool.name, readOnly: tool.annotations.readOnlyHint })), uiBytes: Buffer.byteLength(resource.contents[0].text) };
  if (process.argv.includes('--live')) {
    const result = await call('tools/call', { name: 'open_quota_panel', arguments: {} });
    assert.equal(result.structuredContent.status, 'ok');
    report.liveQuota = result.structuredContent;
  }
  if (process.argv.includes('--desktop')) {
    const first = await call('tools/call', { name: 'open_desktop_quota', arguments: {} });
    assert.equal(first.isError, undefined);
    assert.equal(first.structuredContent.desktopWindow, 'opened');
    const second = await call('tools/call', { name: 'open_desktop_quota', arguments: {} });
    assert.equal(second.structuredContent.desktopWindow, 'already-open');
    report.desktopWindow = { first: first.structuredContent.desktopWindow, second: second.structuredContent.desktopWindow };
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  for (const item of pending.values()) clearTimeout(item.timer);
  lines.close(); child.stdin.end(); child.kill();
}
