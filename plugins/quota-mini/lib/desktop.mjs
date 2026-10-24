import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Fixed local component only: no caller-supplied paths, commands, or credentials.
export function desktopAction(action = 'open', { spawnProcess = spawn, platform = process.platform, timeoutMs = 22000 } = {}) {
  if (!['open', 'close'].includes(action)) return Promise.reject(new Error('Unknown desktop action'));
  if (platform !== 'win32') return Promise.reject(new Error('Desktop window requires Windows'));
  return new Promise((resolve, reject) => {
    let child;
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child?.connected) child.disconnect();
      child?.unref();
      if (error) { child?.kill(); reject(new Error('Desktop window could not start')); }
      else resolve(result);
    };
    const timer = setTimeout(() => finish(new Error('Timeout')), timeoutMs);
    try {
      child = spawnProcess(process.execPath, [fileURLToPath(new URL('../desktop/runner.mjs', import.meta.url)), action], {
        detached: true, windowsHide: true, shell: false, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      });
      child.on('error', () => finish(new Error('Launch failed')));
      child.on('exit', () => finish(new Error('Exited before acknowledgement')));
      child.on('message', message => {
        if (message?.ok !== true || !['opened', 'already-open', 'closed', 'not-open'].includes(message.status)) return;
        finish(null, { status: message.status });
      });
    } catch { finish(new Error('Launch failed')); }
  });
}
