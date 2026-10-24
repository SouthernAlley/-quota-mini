import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { readQuota } from '../lib/codex-quota.mjs';
import { createQuotaCache } from '../lib/cache.mjs';

const action = process.argv[2];
if (process.platform !== 'win32' || !['open', 'close'].includes(action)) process.exit(1);
const powershell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const child = spawn(powershell, [
  '-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-WindowStyle', 'Hidden',
  '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(new URL('./window.ps1', import.meta.url)), '-Action', action,
], { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'ignore'] });
const lines = createInterface({ input: child.stdout });
const getQuota = createQuotaCache(readQuota);
let interval;
let busy = false;
let acknowledged = false;
const timeout = setTimeout(() => { child.kill(); process.exit(1); }, 20000);
function acknowledge(status) {
  if (acknowledged) return;
  acknowledged = true;
  clearTimeout(timeout);
  if (process.send) process.send({ ok: true, status }, () => { if (process.connected) process.disconnect(); });
  else process.stdout.write(JSON.stringify({ status }) + '\n');
}
async function refresh() {
  if (busy || child.killed || !child.stdin.writable) return;
  busy = true;
  try {
    const snapshot = await getQuota();
    if (!child.killed && child.stdin.writable) child.stdin.write(JSON.stringify(snapshot) + '\n');
  } finally { busy = false; }
}
lines.on('line', line => {
  if (line.length > 8192) return;
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.type === 'ready') {
    acknowledge('opened');
    void refresh();
    interval = setInterval(refresh, 60000);
  } else if (message.type === 'already-open') acknowledge('already-open');
  else if (message.type === 'closed' && action === 'close') acknowledge('closed');
  else if (message.type === 'not-open') acknowledge('not-open');
  else if (message.type === 'refresh') void refresh();
});
child.stdin.on('error', () => {});
child.on('error', () => process.exit(1));
child.on('exit', () => {
  clearTimeout(timeout); clearInterval(interval); lines.close();
  // Closing the window must also stop its quota refresh process.
  process.exit(acknowledged ? 0 : 1);
});
process.on('SIGTERM', () => { child.kill(); process.exit(0); });
