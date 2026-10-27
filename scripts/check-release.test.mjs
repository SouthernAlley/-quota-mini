import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPublished, checkSource } from './check-release.mjs';

function fixture() {
  const zipName = 'quota-mini-0.2.5-source.zip';
  const zip = Buffer.from('fixture source archive');
  const hash = b => createHash('sha256').update(b).digest('hex');
  const files = { [zipName]: zip, 'SHA256SUMS.txt': Buffer.from(`${hash(zip)}  ${zipName}\n`) };
  const commit = 'e39961409bdd87f63572bf1a6d5aedcd8af5dc56';
  const release = { tag_name: 'v0.2.5', name: 'Quota Mini 0.2.5 (Preview)', draft: false, prerelease: true, target_commitish: commit,
    assets: Object.entries(files).map(([name, bytes]) => ({ name, state: 'uploaded', size: bytes.length, digest: `sha256:${hash(bytes)}` })) };
  return { release, files, commit, pinned: { commit, assets: Object.fromEntries(Object.entries(files).map(([n, b]) => [n, hash(b)])) } };
}
test('published release metadata and downloaded digests agree', () => {
  const f = fixture(); checkPublished(f.release, '0.2.5', f.commit, f.files, f.pinned);
});
for (const [name, mutate] of [
  ['moved published tag', f => { f.pinned.commit = '0'.repeat(40); }],
  ['changed ZIP bytes', f => { f.files['quota-mini-0.2.5-source.zip'] = Buffer.from('tampered'); }],
  ['missing asset', f => { f.release.assets.pop(); }],
  ['changed pinned digest', f => { f.pinned.assets['SHA256SUMS.txt'] = '0'.repeat(64); }],
  ['wrong target commit', f => { f.release.target_commitish = 'main'; }],
  ['unpublished draft', f => { f.release.draft = true; }],
]) test(`rejects ${name}`, () => {
  const f = fixture(); mutate(f); assert.throws(() => checkPublished(f.release, '0.2.5', f.commit, f.files, f.pinned));
});

// Windows checkout can use CRLF. Exercise a full source fixture, then break real release invariants.
test('source consistency accepts CRLF and rejects version, market and license drift', t => {
  const source = fileURLToPath(new URL('../', import.meta.url));
  const root = mkdtempSync(join(tmpdir(), 'quota-mini-source-check-'));
  t.after(() => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(root.startsWith(join(tmpdir(), 'quota-mini-source-check-')));
    rmSync(root, { recursive: true, force: true });
  });
  const files = ['plugins/quota-mini/package.json', 'plugins/quota-mini/.codex-plugin/plugin.json',
    '.agents/plugins/marketplace.json', 'plugins/quota-mini/scripts/configure-local.mjs',
    'plugins/quota-mini/lib/mcp.mjs', 'plugins/quota-mini/lib/codex-quota.mjs',
    'plugins/quota-mini/ui/panel.js', 'README.md', 'RELEASE_NOTES.md', 'LICENSE', 'plugins/quota-mini/LICENSE'];
  for (const file of files) {
    const dest = join(root, file); mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, readFileSync(join(source, file), 'utf8').replace(/\r?\n/g, '\r\n'));
  }
  const version = JSON.parse(readFileSync(join(root, 'plugins/quota-mini/package.json'), 'utf8')).version;
  assert.equal(checkSource(root), version);
  for (const [path, mutate] of [
    ['plugins/quota-mini/.codex-plugin/plugin.json', s => { const p = JSON.parse(s); p.version = '999.0.0'; return JSON.stringify(p); }],
    ['.agents/plugins/marketplace.json', s => s.replace('quota-mini-preview', 'wrong-market')],
    ['plugins/quota-mini/LICENSE', s => s + 'changed'],
  ]) {
    const dest = join(root, path); const original = readFileSync(dest, 'utf8');
    writeFileSync(dest, mutate(original)); assert.throws(() => checkSource(root));
    writeFileSync(dest, original);
  }
});
