import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { checkPublished } from './check-release.mjs';

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
