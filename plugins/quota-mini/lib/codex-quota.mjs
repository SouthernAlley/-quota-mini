import { spawn } from 'node:child_process';
import { access, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

export class QuotaError extends Error {
  constructor(code, message) { super(message); this.name = 'QuotaError'; this.code = code; }
}

export async function findCodex(env = process.env) {
  if (env.QUOTA_CODEX_BIN) {
    await access(env.QUOTA_CODEX_BIN);
    return env.QUOTA_CODEX_BIN;
  }
  if (process.platform === 'win32' && env.LOCALAPPDATA) {
    const root = join(env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin');
    const folders = await readdir(root, { withFileTypes: true }).catch(() => []);
    const candidates = await Promise.all(folders.filter(x => x.isDirectory()).map(async x => {
      const path = join(root, x.name, 'codex.exe');
      const info = await stat(path).catch(() => null);
      return info?.isFile() ? { path, modified: info.mtimeMs } : null;
    }));
    const newest = candidates.filter(Boolean).sort((a, b) => b.modified - a.modified)[0];
    if (newest) return newest.path;
  }
  return process.platform === 'win32' ? 'codex.exe' : 'codex';
}

function normalizeWindow(window) {
  if (!window || typeof window.usedPercent !== 'number' || !Number.isFinite(window.usedPercent)) return null;
  const minutes = window.windowDurationMins;
  const reset = window.resetsAt;
  return {
    remainingPercent: Math.max(0, Math.min(100, Math.round((100 - window.usedPercent) * 10) / 10)),
    windowMinutes: typeof minutes === 'number' && Number.isFinite(minutes) && minutes > 0 ? minutes : null,
    resetsAt: typeof reset === 'number' && reset > 0 && Number.isFinite(new Date(reset * 1000).getTime()) ? reset : null,
  };
}

export function normalizeQuota(result, now = Date.now()) {
  const pools = result?.rateLimitsByLimitId;
  const fallback = result?.rateLimits;
  // Old single-bucket responses can omit an ID. Once a multi-bucket response
  // identifies other products, an unlabelled fallback is no longer trustworthy.
  const legacySingleBucket = !pools || (typeof pools === 'object' && !Array.isArray(pools) && Object.keys(pools).length === 0);
  const limit = pools?.codex ?? ((fallback?.limitId === 'codex' || (fallback?.limitId == null && legacySingleBucket)) ? fallback : null);
  if (limit?.limitId != null && limit.limitId !== 'codex') throw new QuotaError('unavailable', '这个账户暂未返回可显示的 Work / Codex 额度。');
  if (!limit) throw new QuotaError('unavailable', '暂时无法读取订阅额度，请确认桌面版已登录。');
  const windows = [normalizeWindow(limit.primary), normalizeWindow(limit.secondary)].filter(Boolean);
  if (!windows.length) throw new QuotaError('unavailable', '这个账户暂未返回可显示的订阅额度。');
  // Match by duration, rather than assuming the server's first window is five hours.
  const short = windows.find(x => x.windowMinutes === 300) ?? windows.find(x => x.windowMinutes !== 10080) ?? null;
  const weekly = windows.find(x => x.windowMinutes === 10080) ?? null;
  return { status: 'ok', short, weekly, updatedAt: new Date(now).toISOString() };
}

export async function readQuota({ executable, timeoutMs = 18000, env = process.env } = {}) {
  const command = executable ?? await findCodex(env);
  return new Promise((resolve, reject) => {
    let complete = false;
    let initialized = false;
    let child;
    let lines;
    const finish = (error, result) => {
      if (complete) return;
      complete = true;
      clearTimeout(timer);
      lines?.close();
      child?.stdin.end();
      child?.kill();
      if (error) reject(error); else resolve(result);
    };
    const timer = setTimeout(() => finish(new QuotaError('timeout', '读取超时，稍后会自动重试。')), timeoutMs);
    try {
      child = spawn(command, ['app-server', '--listen', 'stdio://', '--disable', 'plugins', '--disable', 'apps'], {
        windowsHide: true, shell: false, env, stdio: ['pipe', 'pipe', 'ignore'],
      });
      child.on('error', () => finish(new QuotaError('runtime', '找不到桌面版附带的额度读取组件。')));
      child.on('exit', () => finish(new QuotaError('unavailable', '额度读取组件已退出，稍后会自动重试。')));
      child.stdin.on('error', () => finish(new QuotaError('unavailable', '暂时无法连接额度读取组件。')));
      const send = value => { if (!complete) child.stdin.write(JSON.stringify(value) + '\n'); };
      lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
      lines.on('line', line => {
        if (complete || line.length > 1024 * 1024) return;
        let message;
        try { message = JSON.parse(line); } catch { return; }
        if (message.id === 0) {
          if (message.error) return finish(new QuotaError('initialization', '额度读取组件初始化失败。'));
          initialized = true;
          send({ method: 'initialized', params: {} });
          send({ id: 1, method: 'account/rateLimits/read' });
        } else if (initialized && message.id === 1) {
          if (message.error) return finish(new QuotaError('unavailable', '无法读取额度，请确认桌面版已登录且网络正常。'));
          try { finish(null, normalizeQuota(message.result)); } catch (error) { finish(error); }
        } else if (message.id !== undefined && message.method) {
          // This client never grants approval, logs in, launches a task, or accepts an auth token.
          send({ id: message.id, error: { code: -32601, message: 'Unsupported by read-only quota client' } });
        }
      });
      send({ id: 0, method: 'initialize', params: {
        clientInfo: { name: 'quota_mini_local', title: '额度小窗', version: '0.2.5' },
      } });
    } catch {
      finish(new QuotaError('runtime', '无法启动额度读取组件。'));
    }
  });
}
