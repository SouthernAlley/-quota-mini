import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function checkSource(root) {
  const read = path => readFileSync(join(root, path), 'utf8');
  const pkg = JSON.parse(read('plugins/quota-mini/package.json'));
  const manifest = JSON.parse(read('plugins/quota-mini/.codex-plugin/plugin.json'));
  const market = JSON.parse(read('.agents/plugins/marketplace.json'));
  const version = pkg.version;
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.version, version, 'Plugin manifest version differs');
  assert.equal(manifest.name, 'quota-mini');
  assert.equal(manifest.mcpServers, './.mcp.json');
  assert.equal(pkg.license, 'MIT');
  assert.equal(market.name, 'quota-mini-preview');
  assert.equal(market.plugins.length, 1);
  assert.equal(market.plugins[0].name, manifest.name);
  assert.equal(market.plugins[0].source.path, './plugins/quota-mini');
  assert.ok(read('plugins/quota-mini/scripts/configure-local.mjs').includes("'quota-mini-preview', 'quota-mini', manifest.version"), 'Configuration marketplace differs');
  for (const [path, pattern] of [
    ['plugins/quota-mini/lib/mcp.mjs', /serverInfo:\s*\{[^}]*version:\s*'([^']+)'/],
    ['plugins/quota-mini/lib/codex-quota.mjs', /clientInfo:\s*\{[^}]*version:\s*'([^']+)'/],
    ['plugins/quota-mini/ui/panel.js', /appInfo:\s*\{[^}]*version:\s*'([^']+)'/],
  ]) assert.equal(read(path).match(pattern)?.[1], version, `Product version differs in ${path}`);
  assert.ok(read('README.md').includes(`**${version} Preview**`), 'README product version differs');
  assert.ok(read('RELEASE_NOTES.md').startsWith(`# Quota Mini ${version} — Preview`), 'Release notes product version differs');
  assert.equal(read('LICENSE'), read('plugins/quota-mini/LICENSE'), 'License copies differ');
  assert.ok(read('LICENSE').startsWith('MIT License\n'));
  assert.ok(read('LICENSE').includes('Copyright (c) 2026 SouthernAlley'));
  return version;
}

export function checkPublished(release, version, commit, files, pinned = {}) {
  assert.equal(release.tag_name, `v${version}`, 'Release tag differs');
  assert.equal(release.name, `Quota Mini ${version} (Preview)`);
  assert.equal(release.draft, false);
  assert.equal(release.prerelease, true);
  assert.equal(release.target_commitish, commit, 'Release commit differs from tag');
  if (pinned.commit) assert.equal(commit, pinned.commit, 'Previously published tag moved');
  const archiveName = `quota-mini-${version}-source.zip`;
  const names = [archiveName, 'SHA256SUMS.txt'];
  assert.deepEqual(release.assets.map(a => a.name).sort(), names.slice().sort(), 'Release assets differ');
  const hashes = {};
  for (const name of names) {
    const asset = release.assets.find(a => a.name === name);
    const bytes = files[name];
    assert.ok(Buffer.isBuffer(bytes), `Missing downloaded asset: ${name}`);
    assert.equal(asset.state, 'uploaded');
    assert.equal(asset.size, bytes.length, `Asset size differs: ${name}`);
    const hash = createHash('sha256').update(bytes).digest('hex');
    assert.equal(asset.digest, `sha256:${hash}`, `Asset digest differs: ${name}`);
    if (pinned.assets?.[name]) assert.equal(hash, pinned.assets[name], `Previously published asset changed: ${name}`);
    hashes[name] = hash;
  }
  const line = files['SHA256SUMS.txt'].toString('utf8').trim();
  assert.equal(line, `${hashes[archiveName]}  ${archiveName}`, 'Checksum file differs from ZIP');
  return hashes;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
  const version = checkSource(root);
  if (process.argv[2] === 'existing') {
    const directory = resolve(process.argv[3]);
    const release = JSON.parse(readFileSync(join(directory, 'release.json'), 'utf8'));
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    const commit = git('rev-parse', `refs/tags/v${version}^{commit}`);
    // Documentation and CI can advance main. Published plugin code must remain unchanged until a version bump.
    git('diff', '--exit-code', commit, 'HEAD', '--', 'plugins/quota-mini', '.agents/plugins/marketplace.json', 'LICENSE');
    const notes = git('show', `${commit}:RELEASE_NOTES.md`);
    assert.equal((release.body ?? '').trim(), notes, 'Published notes differ from release commit');
    const names = [`quota-mini-${version}-source.zip`, 'SHA256SUMS.txt'];
    const files = Object.fromEntries(names.map(name => [name, readFileSync(join(directory, name))]));
    const registry = JSON.parse(readFileSync(join(root, 'scripts/published-releases.json'), 'utf8'));
    checkPublished(release, version, commit, files, registry[version]);
    console.log(JSON.stringify({ version, releaseCommit: commit, assets: 'verified' }));
  } else {
    assert.equal(process.argv[2] ?? 'source', 'source');
    console.log(JSON.stringify({ version, sourceConsistency: 'verified' }));
  }
}
