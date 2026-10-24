import { createInterface } from 'node:readline';
import { readQuota } from './lib/codex-quota.mjs';
import { createQuotaCache } from './lib/cache.mjs';
import { createMcpHandler, loadPanel } from './lib/mcp.mjs';
import { desktopAction } from './lib/desktop.mjs';

const handle = createMcpHandler({ getQuota: createQuotaCache(readQuota), html: await loadPanel(), desktopAction });
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
function send(message) { process.stdout.write(JSON.stringify(message) + '\n'); }
input.on('line', async line => {
  let request;
  try { request = JSON.parse(line); } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  // MCP notifications never have responses.
  if (request?.id === undefined) return;
  if (line.length > 65536) {
    send({ jsonrpc: '2.0', id: request.id, error: { code: -32600, message: 'Request too large' } });
    return;
  }
  try {
    const result = await handle(request);
    send(result.error
      ? { jsonrpc: '2.0', id: request.id, error: result.error }
      : { jsonrpc: '2.0', id: request.id, result });
  } catch {
    send({ jsonrpc: '2.0', id: request.id, error: { code: -32603, message: 'Local quota service unavailable' } });
  }
});
process.stdout.on('error', () => process.exit(0));
