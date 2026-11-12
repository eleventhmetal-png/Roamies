// This is a custom build of Roamies (build.json): it updates only from its own repo's releases, signed with its own
// key, so an update from the original Roamies can never replace it. Run: npm test
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const BUILD = JSON.parse(read('../build.json'));
const conf = JSON.parse(read('../../src-tauri/tauri.conf.json'));
// The original Roamies' update key (its releases are signed with the matching private key).
const UPSTREAM_PUBKEY = 'dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEQ0MEI0NTJGMEY1NkNGNUYKUldSZnoxWVBMMFVMMUlXK2ROU3YyaDJVZy9scW56d081dEZwelE0SFBQeFVSVXRVYnZyY3BSd0cK';

// A minisign public key, as tauri.conf.json holds it: base64 of a comment line and base64("Ed" + key id + key).
const keyId = (pub) => {
  const lines = Buffer.from(pub, 'base64').toString('utf8').trim().split('\n');
  const raw = Buffer.from(lines[1], 'base64');
  assert.equal(raw.length, 42, 'a minisign public key is 42 bytes');
  assert.equal(raw.subarray(0, 2).toString(), 'Ed', 'an Ed25519 minisign key');
  return raw.subarray(2, 10).toString('hex');
};

// The build's identity.
assert.match(BUILD.repo, /^[\w.-]+\/[\w.-]+$/, 'build.json names its repo as owner/name');
assert.notEqual(BUILD.repo.toLowerCase(), BUILD.upstream.toLowerCase(), 'the custom build is not the original repo');
assert.ok(BUILD.name && BUILD.name.length <= 40, 'a short name for the build');

// The updater reads only this build's feed: its release, and the copy on its updates branch.
const ends = conf.plugins.updater.endpoints;
assert.deepEqual(ends, [
  `https://github.com/${BUILD.repo}/releases/latest/download/latest.json`,
  `https://raw.githubusercontent.com/${BUILD.repo}/updates/latest.json`,
], 'the update feed is this build\'s own');
for (const u of ends) assert.ok(!u.toLowerCase().includes(BUILD.upstream.toLowerCase()), `no feed from the original Roamies: ${u}`);

// And trusts only this build's key: a release signed by the original Roamies fails the signature check.
const pub = conf.plugins.updater.pubkey;
assert.notEqual(pub, UPSTREAM_PUBKEY, 'not the original Roamies\' update key');
assert.notEqual(keyId(pub), keyId(UPSTREAM_PUBKEY), 'a different signing key id');

// Everything else that points people at downloads or issues uses this build's repo.
const side = read('../sidekick.mjs');
assert.match(side, /const UPDATE_REPO = BUILD\.repo;/, 'the sidecar takes its repo from build.json');
assert.ok(!/github\.com\/KenKaiii\/Roamies\/(issues|releases)/.test(side), 'issues and downloads go to this build');
const linux = read('../../src-tauri/src/linux.rs');
assert.match(linux, new RegExp(`"https://github\\.com/${BUILD.repo.replace(/[.]/g, '\\.')}/releases/latest"`), "Linux's download page is this build's");

// The signing key never goes in the repo: only its public half is here.
// (The phrase is built here so this file doesn't match itself.)
const SECRET = `${['encrypted', 'secret', 'key'].join(' ')}|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY`;
let tracked = '';
try { tracked = execFileSync('git', ['grep', '-l', '-I', '-E', SECRET], { cwd: fileURLToPath(new URL('../../../..', import.meta.url)), encoding: 'utf8' }); }
catch (e) { if (e.status !== 1) throw e; } // 1: nothing found
assert.equal(tracked.trim(), '', 'no private key is committed');

console.log('build tests passed');
