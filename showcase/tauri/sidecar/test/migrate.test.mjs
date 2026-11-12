// Settings carried over from this custom build before upstream 0.1.35, and the no-paid-fallback rule for Ollama
// in the merged sidekick.mjs. Run: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RETIRED_KEYS, customSettings, keepsLocal } from '../migrate.mjs';

// The voice provider: VoiceStudio stays VoiceStudio (tts defaults to Fish Audio, which is paid).
assert.deepEqual(customSettings({ voiceProvider: 'voicestudio' }), { tts: 'voicestudio' });
assert.deepEqual(customSettings({ voiceProvider: 'fish' }), { tts: 'fish' });
assert.deepEqual(customSettings({ voiceProvider: 'vibevoice' }), { tts: 'voicestudio' }, 'the early local test build');
assert.deepEqual(customSettings({ voiceProvider: 'voicestudio', tts: 'gemini' }), {}, 'a tts already saved wins');
assert.deepEqual(customSettings({ voiceProvider: 'nonsense' }), {});

// The Ollama brain becomes upstream's local provider, with the same model.
assert.deepEqual(customSettings({ brain: 'ollama', provider: 'local', model: 'local/ollama/qwen3.5:9b', ollamaModel: 'local/ollama/qwen3.5:9b', cloud: { provider: 'openai', model: 'gpt-6-luna' } }),
  { provider: 'local', model: 'local/ollama/qwen3.5:9b' });
assert.deepEqual(customSettings({ brain: 'ollama', ollamaModel: null }), { provider: 'local', model: null }, 'Ollama picked, no model yet: still Ollama');
assert.deepEqual(customSettings({ brain: 'cloud', provider: 'local', cloud: { provider: 'openai', model: 'gpt-6-luna' } }), { provider: 'openai', model: 'gpt-6-luna' });
assert.deepEqual(customSettings({ brain: 'cloud', provider: 'openai', model: 'gpt-6-luna' }), {}, 'a cloud pick is left alone');
assert.deepEqual(customSettings({ provider: 'anthropic', model: 'claude-haiku-5-5' }), {}, 'an upstream config is left alone');
assert.deepEqual(customSettings(null), {});
for (const k of ['voiceProvider', 'brain', 'ollamaModel', 'cloud']) assert.ok(RETIRED_KEYS.includes(k), `${k} is removed once moved`);
assert.equal(keepsLocal({ provider: 'local' }), true);
assert.equal(keepsLocal({ provider: 'openai' }), false);

// The merged sidekick.mjs: with Ollama picked, nothing picks a cloud model on its own.
{
  const side = readFileSync(fileURLToPath(new URL('../sidekick.mjs', import.meta.url)), 'utf8');
  const ensure = side.slice(side.indexOf('function ensureModel()'), side.indexOf('\n}\n', side.indexOf('function ensureModel()')));
  const localAt = ensure.indexOf('if (keepsLocal(config)) return'), cloudAt = ensure.indexOf("['anthropic', 'openai', 'gemini'");
  assert.ok(localAt > 0 && cloudAt > localAt, 'ensureModel returns for Ollama before it looks for a cloud provider');
  assert.match(side, /if \(!keepsLocal\(config\) && \(!config\.provider \|\| !signedIn\.get\(config\.provider\)\)\) \{ config\.provider = null; ensureModel\(\); \}/, 'signing in elsewhere leaves Ollama picked');
  assert.match(side, /if \(provider === 'local' && config\.provider === 'local'\) \{ config\.model = null; saveConfig\(\); \}/, 'removing Ollama while it answers picks nothing paid');
  assert.match(side, /else if \(!keepsLocal\(config\) && \(config\.provider === provider \|\| !signedIn\.get\(config\.provider\)\)\)/, 'removing another account leaves Ollama picked');
  assert.match(side, /config = \{ \.\.\.config, \.\.\.customSettings\(saved\) \}/, 'old settings are carried over at launch');
}
console.log('migrate tests passed');
