// Settings this custom build saved before it took in upstream 0.1.35, carried over to upstream's names, and the
// rule that came with its Ollama brain: with Ollama picked, Roamies never switches to a cloud (paid) model by itself.
// - voiceProvider ('fish' | 'voicestudio', briefly 'vibevoice') → tts. tts defaults to Fish Audio, a paid service:
//   without this, VoiceStudio users would have moved to it silently.
// - brain: 'ollama' with ollamaModel → provider 'local' with that model (the ids are gg-core's, the same on both
//   sides: local/ollama/<name>); brain: 'cloud' while provider was left on 'local' → the cloud pick it kept.

export const RETIRED_KEYS = ['voiceProvider', 'vibeVoice', 'brain', 'ollamaModel', 'cloud'];
const VOICES = ['fish', 'gemini', 'voicestudio'];

/** The settings to apply over a saved config (the raw file, before defaults): {} when there's nothing to move. */
export function customSettings(saved) {
  const out = {};
  if (!saved || typeof saved !== 'object') return out;
  if (typeof saved.voiceProvider === 'string' && !('tts' in saved)) {
    const v = saved.voiceProvider === 'vibevoice' ? 'voicestudio' : saved.voiceProvider;
    if (VOICES.includes(v)) out.tts = v;
  }
  if (saved.brain === 'ollama') {
    out.provider = 'local';
    out.model = typeof saved.ollamaModel === 'string' && saved.ollamaModel.startsWith('local/') ? saved.ollamaModel
      : typeof saved.model === 'string' && saved.model.startsWith('local/') ? saved.model : null;
  } else if (saved.brain === 'cloud' && saved.provider === 'local') {
    out.provider = saved.cloud?.provider ?? null;
    out.model = saved.cloud?.model ?? null;
  }
  return out;
}

/** Ollama is the pick: keep it, model or not, rather than choose a cloud model. */
export const keepsLocal = (config) => config?.provider === 'local';
