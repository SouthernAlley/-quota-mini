import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The installed Windows build does not expand a plugin-root placeholder in cwd.
// Generate explicit local paths, rather than involving a shell or changing the app.
const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(join(root, '.codex-plugin', 'plugin.json'), 'utf8'));
if (manifest.name !== 'quota-mini' || !/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error('Unexpected local plugin identity');
const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex');
const installed = join(codexHome, 'plugins', 'cache', 'quota-mini-preview', 'quota-mini', manifest.version);
const config = { mcpServers: { 'quota-mini': {
  command: process.execPath,
  args: [join(installed, 'server.mjs')],
  cwd: installed,
} } };
await writeFile(join(root, '.mcp.json'), JSON.stringify(config, null, 2) + '\n');
console.log(JSON.stringify({ configuredFor: installed, runtime: process.execPath }));
