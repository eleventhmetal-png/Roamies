// How deep a reply goes: Quick (a few spoken sentences, as Roamies always was), Conversation (natural back and
// forth, follow-up questions) or Work (research, analysis, drafting and multi-step tasks, at any length). And how
// hard the model thinks first: off, or one of the reasoning levels this model supports.
// Work replies open with a short summary, then a line of "---", then the full answer: the summary is what's said
// and shown in the bubble, the whole reply is in the conversation window (DetailSplit; speech.mjs stops at the line).
import { getModel, getSupportedThinkingLevels } from '@kenkaiiii/gg-core';
import { DETAIL_RULE } from './speech.mjs';

export const MODES = [
  { id: 'quick', label: 'Quick', hint: 'Short spoken replies, a few sentences.', maxTurns: 24 },
  { id: 'conversation', label: 'Conversation', hint: 'Natural back and forth, with follow-up questions.', maxTurns: 24 },
  { id: 'work', label: 'Work', hint: 'Research, analysis, drafting and multi-step tasks, at any length.', maxTurns: 60 },
];
export const modeOf = (id) => MODES.find((m) => m.id === id) ?? MODES[0];

/**
 * What a reply in this mode looks like, for the system prompt. `voice`: replies are spoken. Quick returns null:
 * the caller keeps its own bubble and voice styles, unchanged.
 */
export function modeStyle(id, { voice = false } = {}) {
  const mode = modeOf(id).id;
  if (mode === 'quick') return null;
  const out = voice ? 'say' : 'write';
  if (mode === 'conversation') {
    return `Conversation mode: they want to talk things through, not just get a quick answer. Reply the way a thoughtful friend would in conversation: usually two to six sentences, more when the topic needs it, in plain words${voice ? ' for the ear' : ''}. Share a view, give the reasoning behind it, and when it helps, end with one natural follow-up question that moves the discussion on (not every time, and never a list of questions). Keep the rules for lists, drafts, code and drawings below, but don't cut an answer short just to keep it brief.\n`;
  }
  return `Work mode: they want real work done (research, analysis, drafting, planning, multi-step tasks), not a quick answer. Take the steps it needs: use your tools as much as the job calls for, check what you find, and plan longer tasks with plan_steps so they can follow along. There is no length limit.
Shape every reply like this: first one or two sentences that state the answer or the outcome itself (the conclusion, not what you're about to do), which is what you ${out} out loud and what shows by you on screen; then a line with only "---"; then the complete answer for the conversation window, in full markdown: headings, "- " lists, numbered steps, tables, code blocks with their language, and links as [name](url) to the sources you used. Put everything they'd want to read, copy or keep below the line. Write markdown only, never HTML tags. The short-reply rules above (a few sentences, a card of 3 to 6 points) apply only to the summary, never to what's below the line. A reply with nothing more to add after the summary needs no line.
`;
}

/**
 * Splits a streaming reply into what's said and shown by the companion (the summary) and what only the
 * conversation window gets (the full answer). push(text) → { shown, detail }; newTurn() when the model starts a new
 * turn after a tool; flush() at the end of the reply.
 * The split is at a line of just "---". With `auto` (Work mode), a model that skips that line is split anyway: a
 * table, heading, list, code block or quote starts the detail (those are for reading, not hearing), and so does a
 * new paragraph once this turn has said more than `limit` characters.
 */
const BLOCK = /^\s*(?:\||#{1,6}\s|```|~~~|[-*+•]\s|\d{1,2}[.)]\s|>)/;
export class DetailSplit {
  constructor({ auto = false, limit = 700 } = {}) {
    Object.assign(this, { auto, limit, held: '', past: false, lineStart: true });
    this.newTurn();
  }
  newTurn() { this.paras = 0; this.blank = false; this.len = 0; }
  push(text) {
    if (this.past) return { shown: '', detail: text };
    let s = this.held + text, shown = '';
    this.held = '';
    while (s) {
      if (this.lineStart) {
        const nl = s.indexOf('\n');
        const head = nl < 0 ? s : s.slice(0, nl);
        // Could still turn into the rule ("-", "--", "---  ") or a block ("|", "1", "#"): wait for more of the line.
        if (nl < 0 && (/^\s*-*\s*$/.test(head) || (this.auto && head.trim().length < 3))) { this.held = s; break; }
        if (DETAIL_RULE.test(head.trim()) && nl >= 0) { this.past = true; return { shown, detail: s.slice(nl + 1) }; }
        if (this.auto && head.trim() && (BLOCK.test(head) || (this.blank && this.paras > 0 && this.len > this.limit))) { this.past = true; return { shown, detail: s }; }
        if (!head.trim()) { if (nl < 0) { this.held = s; break; } if (!this.blank && this.len) this.paras++; this.blank = true; }
        else this.blank = false;
        this.lineStart = false;
      }
      const nl = s.indexOf('\n');
      if (nl < 0) { shown += s; this.len += s.length; s = ''; break; }
      shown += s.slice(0, nl + 1); this.len += nl + 1; s = s.slice(nl + 1); this.lineStart = true;
    }
    return { shown, detail: '' };
  }
  /** The end of the reply: a rule with nothing after it is just a rule (dropped); anything else held is shown. */
  flush() {
    const h = this.held; this.held = '';
    if (this.past || DETAIL_RULE.test(h.trim())) return { shown: '', detail: '' };
    return { shown: h, detail: '' };
  }
  get detailed() { return this.past; }
}

const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
export const THINKING_LABELS = { off: 'Off', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max', ultra: 'Ultra' };

/**
 * The reasoning choices this model offers: 'off' and the levels it supports (none when it doesn't think). gg-core
 * lists only "high" for some models (Gemini Flash) that Roamies has always run at low, deliberately (brain.mjs):
 * low stays a choice for those, so the default isn't silently raised.
 */
export function thinkingChoices(provider, model) {
  if (!model || getModel(model)?.supportsThinking === false) return ['off'];
  const levels = (getSupportedThinkingLevels(provider, model) ?? []).filter((l) => LEVELS.includes(l));
  if (levels.length && LEVELS.indexOf(levels[0]) > LEVELS.indexOf('low')) levels.unshift('low');
  return ['off', ...levels];
}

/**
 * The level to send for `want` on this model: undefined for off (or a model that can't think), `want` when it's
 * supported, else the nearest supported level at or below it, else the lowest it has.
 */
export function thinkingFor(want, choices) {
  const levels = choices.filter((c) => c !== 'off');
  if (!want || want === 'off' || !levels.length) return undefined;
  if (levels.includes(want)) return want;
  const at = LEVELS.indexOf(want);
  const below = levels.filter((l) => LEVELS.indexOf(l) <= at);
  // Nothing at or below it: send it as asked rather than raise it (the model's own default handles the rest).
  return below.length ? below[below.length - 1] : want;
}
