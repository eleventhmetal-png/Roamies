# This custom build

This repository, [eleventhmetal-png/Roamies](https://github.com/eleventhmetal-png/Roamies), is a custom build of
[Roamies](https://github.com/KenKaiii/Roamies) by Ken Kai (the "upstream"). Its identity is in one file,
`showcase/tauri/sidecar/build.json`. The app reads it to show **custom** beside its version in the panel, adds a
**This build** section to About, and sends downloads, issues and diagnostics to this repo.

What it adds to upstream:

- **No paid fallback from Ollama.** Upstream 0.1.35 has Ollama as a provider on the Model page and VoiceStudio as a
  voice; this build first had its own versions and now uses upstream's. On top of them, with an Ollama model
  picked, Roamies never switches to a cloud model by itself: not when Ollama is closed or not connected yet, not when
  you sign in to or remove another account, and not when you remove Ollama (it waits for you to pick). VoiceStudio,
  like upstream's, never falls back to Fish Audio. `migrate.mjs` carries this build's older settings over
  (`voiceProvider` → `tts`; the Ollama "brain" → the local provider).
- **Reply depth and reasoning** (Model page → Replies, and the conversation window): Quick (a few spoken
  sentences), Conversation (natural back and forth, with follow-up questions) or Work (research, analysis, drafting
  and multi-step tasks at any length). In Work mode, a short summary is spoken and shown by her, and the full
  answer goes to the conversation window. Reasoning is Off or one of the levels the current model supports.
- **Conversation window** (Home → Conversation, Open Conversation… in the tray menu, or `roamies --convo`): the whole
  conversation with copyable answers, links, tables and code; Stop; the steps of a longer task; History to search,
  read and resume past conversations.
- **Always visible** (Behavior page): she stays on screen when idle, at the spot she was last dragged to, remembered
  between launches. Hiding her with the shortcut or Esc wins until you show her again. It never keeps the mic on.
- **Its own updates** (below).

## Branches

| Branch | What it holds |
| --- | --- |
| `main` | Upstream as it is. Only ever fast-forwarded from `upstream/main`, never committed to directly. |
| `custom` | The custom build: upstream plus everything above. Releases are tagged from here. |
| `voice-provider-voicestudio` | The VoiceStudio and Ollama work as first written; also the head of an open pull request to upstream (#28). Kept for reference: since 0.1.35 upstream has its own versions. |
| feature branches | One per upgrade, branched from `custom` and merged back through a pull request. `custom` requires the Linux, macOS and Windows checks to pass, and pull requests can merge themselves once they do (auto-merge). |

## Updates come only from this build

The in-app updater (`plugins.updater` in `showcase/tauri/src-tauri/tauri.conf.json`) is set up so that an upstream
release can't replace this build:

1. **Feed:** it checks only this repo's `latest.json`: the newest release here, then the copy on this repo's
   `updates` branch.
2. **Key:** it installs only updates signed with this build's own key. Upstream signs with a different key, so its
   updates fail the signature check even if its `latest.json` were served from here.

`test/build.test.mjs` (part of `npm test` and CI) fails if a merge brings back upstream's feed or key, or commits a
private key.

On Linux, copies installed from a .deb or .rpm can't update themselves. For those, "Get Roamies x.y.z" opens this
repo's releases page.

**Still possible by hand:** this build keeps upstream's bundle id (`com.kenkai.roamies`) so that macOS permissions,
the saved Fish Audio key, settings and memory carry over. If you install an upstream DMG or installer yourself, it
replaces this build like any other install. Only install releases from this repo.

### The signing key

- The private key is `~/.tauri/roamies-custom.key` on the machine that made it, with an empty password. It is
  never committed. Back it up somewhere safe, such as a password manager. Without it, copies already installed can't
  take another update; they'd need a reinstall with a new key.
- `./build.sh` (release mode) finds it there when `TAURI_SIGNING_PRIVATE_KEY` isn't set.
- For release builds on GitHub Actions, add two repository secrets under Settings → Secrets and variables → Actions:
  - `TAURI_SIGNING_PRIVATE_KEY`: the contents of `~/.tauri/roamies-custom.key`
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: leave it empty
- The public half lives in `tauri.conf.json` as `plugins.updater.pubkey`. Change it only together with the key.

## Releasing

`.github/workflows/release.yml` and `update-feed.yml` publish to whichever repo they run in, so they work here
unchanged. To release:

1. On `custom`, set the version in `showcase/tauri/src-tauri/tauri.conf.json` (and `Cargo.toml`). It must be
   higher than this build's previous release; upstream's numbers don't matter to the updater.
2. Tag the release and push the tag, for example `git tag v0.1.35 && git push origin v0.1.35`. This makes a draft
   release; publishing it runs `update-feed.yml`.

The macOS leg needs Apple Developer ID secrets (`APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`,
`KEYCHAIN_PASSWORD`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`). This repo doesn't have them yet, so that leg
fails. Until it does, build on a Mac with `./build.sh` (it uses a Developer ID in the keychain, or ad-hoc signing)
and attach the `.app.tar.gz`, its `.sig` and a `latest.json` to the release by hand.

## Receiving upstream improvements

Upstream changes arrive by a merge you review. Nothing arrives by itself.

```bash
git fetch upstream
git switch main && git merge --ff-only upstream/main && git push origin main
git switch custom && git merge main
```

When the merge conflicts:

- **Where upstream has its own version of something this build added** (as with Ollama and VoiceStudio in 0.1.35):
  take upstream's, and re-apply only this build's rules on top, as small tested patches.

- **`tauri.conf.json`:** keep this build's `plugins.updater` (endpoints and `pubkey`). Take upstream's other
  changes.
- **`linux.rs`:** keep this repo in `open_releases_page`.
- **`.github/workflows/ci.yml`:** keep `custom` in the `push` and `pull_request` branches, so this build's
  branches are checked.
- **`sidekick.mjs` / `panel.js`:** keep both sides. Upstream's features and this build's brain, voice and build
  lines live side by side.
- **Upstream's version bump:** this build sets its own version when it releases.

Then check the result and push it:

```bash
cd showcase/tauri/sidecar && npm ci && npm test
cd .. && ./build.sh dev
git push origin custom
```

`npm test` includes `build.test.mjs`, so a merge that undid the update settings fails here, before any release.
To see what's new upstream before merging, run `git log --oneline main..upstream/main`.
