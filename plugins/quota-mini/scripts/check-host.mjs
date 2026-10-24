import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { findCodex } from '../lib/codex-quota.mjs';

// Development-only host discovery. No chats or model turns are created.
const child = spawn(await findCodex(), ['app-server', '--listen', 'stdio://'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
const diagnostics = [];
const stderr = createInterface({ input: child.stderr });
stderr.on('line', line => {
  if (/quota-mini/i.test(line)) diagnostics.push(line.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 500));
});
const lines = createInterface({ input: child.stdout });
const pending = new Map();
let nextId = 0;
lines.on('line', line => {
  let response;
  try { response = JSON.parse(line); } catch { return; }
  const item = pending.get(response.id);
  if (item) {
    clearTimeout(item.timer); pending.delete(response.id);
    response.error ? item.reject(response.error) : item.resolve(response.result);
  } else if (response.id !== undefined && response.method) {
    child.stdin.write(JSON.stringify({ id: response.id, error: { code: -32601, message: 'Read-only development check' } }) + '\n');
  }
});
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject({ code: 'timeout' }); }, 20000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
}
try {
  await call('initialize', { clientInfo: { name: 'quota_mini_install_check', version: '0.1.0' }, capabilities: { experimentalApi: true } });
  child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
  const report = {};
  try {
    const data = await call('plugin/read', { marketplacePath: resolve('.agents/plugins/marketplace.json'), pluginName: 'quota-mini' });
    const plugin = data.plugin ?? data;
    report.plugin = { name: plugin.summary?.name, enabled: plugin.summary?.enabled, mcpServers: plugin.mcpServers };
  } catch (error) { report.pluginReadError = { code: error.code, message: error.message }; }
  try {
    const data = await call('mcpServerStatus/list', { serverName: 'quota-mini', detail: 'full', limit: 100 });
    const servers = data.data ?? data.servers ?? [];
    report.servers = servers.filter(server => /quota/i.test(server.name ?? server.serverName ?? '')).map(server => ({
      name: server.name ?? server.serverName,
      authStatus: server.authStatus,
      tools: Object.keys(server.tools ?? {}),
      quotaToolMetadata: (Object.values(server.tools ?? {}).find(tool => tool.name === 'open_quota_panel') ?? {})._meta,
    }));
    report.serverResponseKeys = Object.keys(data);
  } catch (error) { report.mcpDiscoveryError = { code: error.code, message: error.message }; }
  report.diagnostics = diagnostics;
  console.log(JSON.stringify(report, null, 2));
} finally {
  for (const item of pending.values()) clearTimeout(item.timer);
  lines.close(); stderr.close(); child.stdin.end(); child.kill();
}
