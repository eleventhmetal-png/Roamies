// Why the update feed wasn't there: nothing released yet, a release without latest.json, or no answer. Run: npm test
import assert from 'node:assert/strict';
import { NO_FEED, whyNoFeed } from '../releases.mjs';
import { explain } from '../errors.mjs';

const res = (status, body = {}) => ({ status, json: async () => body });
const fake = (routes) => {
  const asked = [];
  const fetch = async (url, opts) => {
    asked.push(url);
    assert.equal(opts.headers['User-Agent'], 'Roamies-updater', 'a generic client name, nothing about the user');
    const r = routes[url.replace('https://api.github.com/repos/', '')];
    if (r instanceof Error) throw r;
    return r ?? res(500);
  };
  return { fetch, asked };
};

// The updater's own words when no endpoint answered with a feed (tauri-plugin-updater 2.x).
assert.ok(NO_FEED.test('Could not fetch a valid release JSON from the remote'));
assert.ok(!NO_FEED.test('error sending request for url'));

// A repo with no release yet: there's nothing newer, so it isn't an error.
{
  const f = fake({ 'me/app/releases/latest': res(404), 'me/app': res(200, { full_name: 'me/app' }) });
  assert.equal(await whyNoFeed('me/app', f), 'no_release');
  assert.deepEqual(f.asked, ['https://api.github.com/repos/me/app/releases/latest', 'https://api.github.com/repos/me/app']);
}
// A release without latest.json, and one with it (then the updater's error stands).
assert.equal(await whyNoFeed('me/app', fake({ 'me/app/releases/latest': res(200, { assets: [{ name: 'Roamies.dmg' }] }) })), 'no_feed');
assert.equal(await whyNoFeed('me/app', fake({ 'me/app/releases/latest': res(200, { assets: [{ name: 'latest.json' }] }) })), null);
// A missing or private repo also answers 404: not called "no release yet".
assert.equal(await whyNoFeed('me/gone', fake({ 'me/gone/releases/latest': res(404), 'me/gone': res(404) })), null);
// Offline, timed out or rate-limited: GitHub can't say, so the internet line stays.
assert.equal(await whyNoFeed('me/app', fake({ 'me/app/releases/latest': new TypeError('fetch failed') })), null);
assert.equal(await whyNoFeed('me/app', fake({ 'me/app/releases/latest': res(403) })), null);

// The lines shown.
assert.equal(explain('update', new Error("me/app's newest release has no update file (latest.json)")).text, 'The newest release has no update file yet.');
assert.match(explain('update', new Error('Could not fetch a valid release JSON from the remote')).text, /Check your internet/);

// The real thing: this build's repo, as GitHub answers now (skipped offline).
{
  const BUILD = (await import('../build.json', { with: { type: 'json' } })).default;
  const live = await whyNoFeed(BUILD.repo, { timeoutMs: 5000 });
  console.log(`  live: ${BUILD.repo} → ${live ?? 'no answer (offline?)'}`);
}
console.log('releases tests passed');
