// Why the update feed wasn't there. The updater says the same thing ("Could not fetch a valid release JSON") whether
// this build's repo has no release yet, its newest release has no latest.json, or the internet is down. GitHub's API
// tells them apart, so a build with nothing released yet isn't told to check its internet.

/** The updater's error when no endpoint gave it a feed. */
export const NO_FEED = /valid release JSON/i;

const api = (path) => `https://api.github.com/repos/${path}`;

/**
 * 'no_release': the repo is there and has no published release (so nothing newer exists).
 * 'no_feed': it has a release, but no latest.json the updater can read on it.
 * null: GitHub couldn't say (offline, rate-limited, the repo missing or private): keep the original error.
 */
export async function whyNoFeed(repo, { fetch: get = fetch, timeoutMs = 8000 } = {}) {
  const opts = { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Roamies-updater' }, signal: AbortSignal.timeout(timeoutMs) };
  try {
    const latest = await get(api(`${repo}/releases/latest`), opts);
    if (latest.status === 200) {
      const r = await latest.json().catch(() => null);
      return Array.isArray(r?.assets) && r.assets.some((a) => a?.name === 'latest.json') ? null : 'no_feed';
    }
    if (latest.status !== 404) return null;
    // 404 is also what a missing or private repo answers: only a repo that's really there means "no release yet".
    const repoRes = await get(api(repo), opts);
    return repoRes.status === 200 ? 'no_release' : null;
  } catch {
    return null;
  }
}
