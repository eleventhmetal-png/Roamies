// Reply depth (Quick, Conversation, Work) and reasoning: the prompt each mode adds, the "---" split between a Work
// reply's spoken summary and its full answer, and the reasoning levels each model offers. Run: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DetailSplit, MODES, modeOf, modeStyle, thinkingChoices, thinkingFor } from '../modes.mjs';
import { SpeechText } from '../speech.mjs';

// The modes, and an unknown one is Quick.
assert.deepEqual(MODES.map((m) => m.id), ['quick', 'conversation', 'work']);
assert.equal(modeOf('nope').id, 'quick');
assert.ok(modeOf('work').maxTurns > modeOf('quick').maxTurns, 'Work may take more steps');

// Quick keeps the styles as they are; the others add their own shape.
assert.equal(modeStyle('quick'), null);
assert.match(modeStyle('conversation'), /follow-up question/);
assert.match(modeStyle('work'), /a line with only "---"/);
assert.match(modeStyle('work', { voice: true }), /what you say out loud/);
assert.match(modeStyle('work'), /what you write out loud/);
assert.match(modeStyle('work'), /no length limit/i);

// sidekick.mjs swaps the Quick length limit out of its styles for the other modes: the sentences it replaces are
// really in them (a reworded style would otherwise keep "one to three sentences" in Work mode, silently).
{
  const side = readFileSync(fileURLToPath(new URL('../sidekick.mjs', import.meta.url)), 'utf8').replace(/\r\n/g, '\n'); // Windows checks out CRLF
  const quote = (name) => /'((?:[^'\\]|\\.)*)'/.exec(side.slice(side.indexOf(`const ${name} = `)))[1].replace(/\\'/g, "'");
  const text = side.slice(side.indexOf('const TEXT_STYLE = `'), side.indexOf('`;', side.indexOf('const TEXT_STYLE = `')));
  const voice = side.slice(side.indexOf('const VOICE_STYLE = `'), side.indexOf('`;', side.indexOf('const VOICE_STYLE = `')));
  assert.ok(text.includes(quote('QUICK_TEXT')), 'the bubble style has the Quick length line');
  assert.ok(voice.includes(quote('QUICK_VOICE')), 'the voice style has the Quick length line');
  assert.match(side, /maxTurns: modeOf\(config\.mode\)\.maxTurns/, "the agent's step limit follows the mode");
}

// The split: everything before the "---" line is shown (bubble, voice), everything after only in the window.
const run = (chunks) => {
  const s = new DetailSplit(); let shown = '', detail = '';
  for (const c of chunks) { const r = s.push(c); shown += r.shown; detail += r.detail; }
  const f = s.flush(); shown += f.shown; detail += f.detail;
  return { shown, detail, detailed: s.detailed };
};
const full = 'Plan B is the best value.\n---\n## Comparison\n| a | b |\n';
assert.deepEqual(run([full]), { shown: 'Plan B is the best value.\n', detail: '## Comparison\n| a | b |\n', detailed: true });
// Streamed a character at a time, the rule split across chunks: the same.
assert.deepEqual(run([...full]), { shown: 'Plan B is the best value.\n', detail: '## Comparison\n| a | b |\n', detailed: true });
assert.deepEqual(run(['Sum.\n-', '-', '-\nDetail']), { shown: 'Sum.\n', detail: 'Detail', detailed: true });
// Lists, a "--" and "----" are not that line, or are: only a line of three or more dashes and nothing else.
assert.deepEqual(run(['Points:\n- one\n- two\n']), { shown: 'Points:\n- one\n- two\n', detail: '', detailed: false });
assert.deepEqual(run(['a -- b\n--\n']), { shown: 'a -- b\n--\n', detail: '', detailed: false });
assert.equal(run(['x\n----\ny']).detail, 'y');
// A reply that ends on the rule, with nothing after it, just loses the rule; one with no rule is all shown.
assert.deepEqual(run(['Done.\n---']), { shown: 'Done.\n', detail: '', detailed: false });
assert.deepEqual(run(['Short answer, no detail.']), { shown: 'Short answer, no detail.', detail: '', detailed: false });

// Work mode (auto): a model that skips the "---" line is split anyway. Tables, lists, headings, code and quotes are
// for reading, so they start the detail; so does a new paragraph once the turn has said a lot. Prose stays.
{
  const runA = (chunks, o = {}) => {
    const s = new DetailSplit({ auto: true, ...o }); let shown = '', detail = '';
    for (const c of chunks) { const r = s.push(c); shown += r.shown; detail += r.detail; }
    shown += s.flush().shown;
    return { shown, detail };
  };
  // What qwen3.5:9b really sent in a live Work-mode test: a one-line summary, then the table with no "---".
  const real = "Tea and coffee both boost focus, but coffee is quicker while tea's L-theanine keeps you calm.\n\n| Aspect | Tea | Coffee |\n|--------|-----|--------|\n| Onset | 45-60 min | 30-45 min |\n";
  assert.deepEqual(runA([...real]), { shown: "Tea and coffee both boost focus, but coffee is quicker while tea's L-theanine keeps you calm.\n\n", detail: '| Aspect | Tea | Coffee |\n|--------|-----|--------|\n| Onset | 45-60 min | 30-45 min |\n' });
  assert.deepEqual(runA([...'Summary.\n- a\n- b\n']), { shown: 'Summary.\n', detail: '- a\n- b\n' }, 'a list right after the summary');
  assert.deepEqual(runA([...'## Report\nbody\n']), { shown: '', detail: '## Report\nbody\n' }, 'no summary at all: everything to the window');
  assert.deepEqual(runA([...'One.\n\nTwo is prose too.\n']), { shown: 'One.\n\nTwo is prose too.\n', detail: '' }, 'short prose stays');
  const long = `${'Word '.repeat(150)}end.\n\nThe rest of a long answer.\n`;
  assert.equal(runA([long]).detail, 'The rest of a long answer.\n', 'past the limit, the next paragraph is detail');
  // After a tool call the count starts again: the beat before it doesn't make the answer's first paragraph "later".
  const s = new DetailSplit({ auto: true });
  s.push(`${'Checking. '.repeat(80)}\n\n`); s.newTurn();
  assert.equal(s.push('The answer is short.\n\nAnd a second line.\n').shown, 'The answer is short.\n\nAnd a second line.\n');
  // Without auto (the other modes never split; a "---" alone is the only split) a table stays where it is.
  assert.equal(run([real]).detail, '');
}

// Speech stops at the line: the summary is said, the full answer never is.
{
  const said = [], sp = new SpeechText((t) => said.push(t));
  for (const c of [...'Plan B wins. It is cheaper.\n---\nThe full table follows here. It is long.\n']) sp.push(c);
  sp.flush();
  assert.deepEqual(said, ['Plan B wins.', 'It is cheaper.']);
}

// Reasoning: Off plus the levels this model supports; a level it lacks becomes the nearest one at or below it.
{
  const gpt = thinkingChoices('openai', 'gpt-6-luna');
  assert.deepEqual(gpt, ['off', 'low', 'medium', 'high', 'xhigh', 'max']);
  assert.equal(thinkingFor('medium', gpt), 'medium');
  assert.equal(thinkingFor('off', gpt), undefined, 'off sends no reasoning');
  const ds = thinkingChoices('deepseek', 'deepseek-v4-pro');
  assert.deepEqual(ds, ['off', 'low', 'high', 'max']);
  assert.equal(thinkingFor('medium', ds), 'low', 'no medium on DeepSeek: the level below');
  assert.equal(thinkingFor('xhigh', ds), 'high');
  // Gemini Flash lists only high, but Roamies has always run it at low (brain.mjs): low stays, nothing is raised.
  const gem = thinkingChoices('gemini', 'gemini-3.8-flash');
  assert.deepEqual(gem, ['off', 'low', 'high']);
  assert.equal(thinkingFor('low', gem), 'low', 'the default is not raised to high');
  assert.equal(thinkingFor('low', ['off', 'high']), 'low', 'nothing at or below: sent as asked, never raised');
  assert.deepEqual(thinkingChoices('local', 'local/ollama/never-registered'), ['off'], 'an unknown model is offered Off only');
  assert.equal(thinkingFor('high', ['off']), undefined);
}
console.log('modes tests passed');
