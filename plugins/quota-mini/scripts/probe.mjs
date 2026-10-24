import { readQuota } from '../lib/codex-quota.mjs';

try {
  console.log(JSON.stringify(await readQuota(), null, 2));
} catch (error) {
  console.log(JSON.stringify({ status: 'error', code: error.code ?? 'unknown', message: error.message }));
  process.exitCode = 1;
}
