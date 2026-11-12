// The conversation window's history: saved conversations as readable messages, the list, and search (folded turns
// included). Read-only: the files are the same afterwards. Run: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { display, listConversations, loadConversation, replyParts, toolLine, userText } from '../chatlog.mjs';

// What was asked, without the app's time stamp or the area-snap line.
assert.equal(userText('[Thu, 12 Nov 2026, 1:23:45 AM CST] what is on my calendar?'), 'what is on my calendar?');
assert.equal(userText([{ type: 'text', text: '[Thu, 12 Nov 2026, 1:23 AM CST] what is this?\n(Attached: the area of the screen I selected.)' }, { type: 'image', mediaType: 'image/png', data: 'x' }]), 'what is this?');
// A reply without emote tags or voice cues, and a Work reply split at its line.
assert.deepEqual(replyParts('[hype] [excited] We did it! [chuckling] Ha.'), { text: 'We did it! Ha.', detail: '' });
assert.deepEqual(replyParts('Plan B wins.\n---\n## Table\n| a |'), { text: 'Plan B wins.', detail: '## Table\n| a |' });
assert.equal(toolLine('fetch_url', { url: 'https://example.com/x' }), 'Read a web page: https://example.com/x');
assert.equal(toolLine('some_new_tool', {}), 'Used some new tool');

const msgs = [
  { role: 'user', content: '[Summary of the earlier conversation, written by the app…] stuff' },
  { role: 'user', content: '[Thu, 12 Nov 2026, 1:00 AM CST] compare the plans' },
  { role: 'assistant', content: [{ type: 'text', text: 'On it.' }, { type: 'tool_call', id: 't1', name: 'web_search', args: { query: 'hosting plans' } }] },
  { role: 'tool', content: [{ type: 'tool_result', toolCallId: 't1', content: 'results…' }] },
  { role: 'assistant', content: [{ type: 'text', text: '[wave] Plan B is best.\n---\n| Plan | Price |\n| --- | --- |\n| B | $29 |' }] },
  { role: 'user', content: '(System, not Ben: these commitments are due now.)' },
  { role: 'assistant', content: 'Reminder: call the dentist.' },
  { role: 'assistant', content: 'And bring the forms.' },
];
assert.deepEqual(display(msgs), [
  { role: 'note', text: 'Earlier messages were summarized to save space.' },
  { role: 'user', text: 'compare the plans' },
  { role: 'assistant', text: 'On it.' },
  { role: 'tool', name: 'web_search', text: 'Searched the web: hosting plans' },
  { role: 'assistant', text: 'Plan B is best.', detail: '| Plan | Price |\n| --- | --- |\n| B | $29 |' },
  { role: 'assistant', text: 'Reminder: call the dentist.\n\nAnd bring the forms.' },
], 'app-written requests and tool results are left out; a tool call is one line; one reply reads as one message');

// Saved conversations on disk: listed newest first, searched (folded turns too), opened whole.
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'roamies-chatlog-'));
try {
  const save = (id, messages, extra = {}) => fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify({ version: 1, id, startedAt: 0, lastActiveAt: Date.parse('2026-11-10T10:00:00Z') + Number(id.slice(9, 15)), messages, ...extra }));
  await save('20261110-090000-aaaaaa', [{ role: 'user', content: '[x stamp here] what time is it in Tokyo?' }, { role: 'assistant', content: "It's 3 PM in Tokyo." }]);
  await save('20261111-090000-bbbbbb', [{ role: 'user', content: '[x stamp here] draft the launch email' }, { role: 'assistant', content: 'Here it is.\n---\n> Subject: Roamies 1.0 is out' }]);
  await save('20261112-090000-cccccc', [{ role: 'user', content: '[x stamp here] who are you?' }], { kind: 'intro' });
  await fs.writeFile(path.join(dir, '20261111-090000-bbbbbb.folded.jsonl'), `${JSON.stringify({ at: 1, role: 'user', content: '[x stamp here] earlier we talked about Lisbon' })}\n`);
  await fs.writeFile(path.join(dir, 'notes.txt'), 'not a session');
  const before = await fs.readdir(dir);

  const all = await listConversations(dir);
  assert.deepEqual(all.map((c) => c.id), ['20261112-090000-cccccc', '20261111-090000-bbbbbb', '20261110-090000-aaaaaa'], 'newest first, only session files');
  assert.equal(all[1].title, 'earlier we talked about Lisbon', 'a folded turn is the start of its conversation');
  assert.equal(all[0].kind, 'intro');
  assert.deepEqual((await listConversations(dir, { q: 'tokyo' })).map((c) => c.id), ['20261110-090000-aaaaaa'], 'search is case-insensitive');
  assert.match((await listConversations(dir, { q: 'tokyo' }))[0].snippet, /Tokyo/);
  assert.deepEqual((await listConversations(dir, { q: 'subject: roamies' })).map((c) => c.id), ['20261111-090000-bbbbbb'], 'the full answer below the line is searched');
  assert.deepEqual((await listConversations(dir, { q: 'lisbon' })).map((c) => c.id), ['20261111-090000-bbbbbb'], 'folded turns are searched');
  assert.deepEqual(await listConversations(dir, { q: 'nothing like this' }), []);

  const c = await loadConversation(dir, '20261111-090000-bbbbbb');
  assert.deepEqual(c.messages.map((m) => m.role), ['user', 'user', 'assistant']);
  assert.equal(c.messages[2].detail, '> Subject: Roamies 1.0 is out');
  assert.equal(await loadConversation(dir, '../../etc/passwd'), null, 'only real session ids are read');
  assert.equal(await loadConversation(dir, '20991231-000000-zzzzzz'), null);
  assert.deepEqual(await fs.readdir(dir), before, 'nothing was written');
  assert.deepEqual(await listConversations(path.join(dir, 'missing')), [], 'no sessions folder yet: an empty list');
} finally {
  await fs.rm(dir, { recursive: true, force: true });
}
// The window only reads: opening it or going back mid-reply must not save or fold the conversation under the reply.
{
  const { readFileSync } = await import('node:fs');
  const side = readFileSync(new URL('../sidekick.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n'); // Windows checks out CRLF
  const fn = side.slice(side.indexOf('function convoMessages()'), side.indexOf('\n}\n', side.indexOf('function convoMessages()')));
  assert.ok(fn.length > 0 && !/syncSession|saveSession|applyPendingFold/.test(fn), 'convoMessages never saves or folds');
}
console.log('chatlog tests passed');
