// The conversation window's view of saved conversations: each one as messages to read (what was said, which tools
// ran), the list of past conversations, and search across them. Read-only: it never changes a saved file.
// Turns folded into a summary to save context are kept beside their session (store.mjs archiveFolded); history
// shows them again, in order, so a long conversation reads whole.
import fs from 'node:fs/promises';
import path from 'node:path';
import { CUE, DETAIL_RULE } from './speech.mjs';
import { EMOTES } from './reply.mjs';
import { stripNote } from './intro.mjs';

const SESSION_FILE = /^(\d{8}-\d{6}-[a-z0-9]{6})\.json$/;
const STAMP = /^\[[^\]\n]{6,80}\]\s*/; // "[Thu, 12 Nov 2026, 1:23 AM CST] " before each request
const EMOTE = new RegExp(`\\[(?:${EMOTES.join('|')})\\]\\s*`, 'gi');
const SUMMARY = '[Summary of the earlier conversation';
const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.filter((p) => p?.type === 'text').map((p) => p.text).join('\n') : '');

/** What they typed or said, without the time stamp, the app's notes and the area-snap line. */
export function userText(content) {
  let t = stripNote(textOf(content)).replace(STAMP, '');
  t = t.replace(/\n\((?:Attached: the area of the screen[^\n]*|[^\n]*quiz[^\n]*)\)\s*$/i, '');
  return t.trim();
}

/** A reply as shown: no emote tags or voice cues. Work replies split at their "---" line into summary and detail. */
export function replyParts(text) {
  const clean = String(text ?? '').replace(EMOTE, '').replace(new RegExp(`${CUE.source}[ \\t]*`, 'gi'), '').replace(/[ \t]+\n/g, '\n').trim();
  const lines = clean.split('\n');
  const at = lines.findIndex((l) => DETAIL_RULE.test(l.trim()));
  if (at < 0) return { text: clean, detail: '' };
  return { text: lines.slice(0, at).join('\n').trim(), detail: lines.slice(at + 1).join('\n').trim() };
}

/**
 * Messages as the window shows them: [{ role: 'user' | 'assistant' | 'tool' | 'note', text, detail?, name?, error? }].
 * App-written requests ("(System, …)") and tool results are left out; a tool call is one short line.
 */
export function display(messages) {
  const out = [];
  for (const m of messages ?? []) {
    if (m?.role === 'user') {
      const raw = textOf(m.content);
      if (raw.startsWith(SUMMARY)) { out.push({ role: 'note', text: 'Earlier messages were summarized to save space.' }); continue; }
      const t = userText(m.content);
      if (!t || t.startsWith('(System')) continue;
      out.push({ role: 'user', text: t, ...(Array.isArray(m.content) && m.content.some((p) => p?.type === 'image') ? { image: true } : {}) });
    } else if (m?.role === 'assistant') {
      const parts = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content ?? [];
      for (const p of parts) {
        if (p?.type === 'text' && p.text?.trim()) {
          const r = replyParts(p.text);
          if (!r.text && !r.detail) continue;
          const last = out[out.length - 1];
          // One reply can arrive as several text parts around tool calls: they read as one message.
          if (last?.role === 'assistant' && !last.detail && !r.detail && last.joinable) last.text = `${last.text}\n\n${r.text}`.trim();
          else out.push({ role: 'assistant', text: r.text, ...(r.detail ? { detail: r.detail } : {}), joinable: true });
        } else if (p?.type === 'tool_call') {
          out.push({ role: 'tool', name: p.name, text: toolLine(p.name, p.args) });
          const last = out.findLast((x) => x.role === 'assistant'); if (last) last.joinable = false;
        }
      }
    }
  }
  return out.map(({ joinable, ...m }) => m);
}

// A tool call in a few words.
const TOOL_WORDS = {
  web_search: 'Searched the web', fetch_url: 'Read a web page', see_photo: 'Looked at a picture', take_screenshot: 'Looked at the screen',
  read_window: 'Read a window', act_in_app: 'Worked in an app', run_command: 'Ran a command', search_files: 'Searched files', read_file: 'Read a file',
  write_file: 'Wrote a file', list_windows: 'Listed windows', draw: 'Drew on the screen', plan_steps: 'Planned the steps',
  remember_commitment: 'Saved a reminder', update_commitment: 'Updated a reminder',
};
export function toolLine(name, args = {}) {
  const what = args?.url ?? args?.path ?? args?.query ?? args?.app ?? '';
  const base = TOOL_WORDS[name] ?? `Used ${String(name).replace(/_/g, ' ')}`;
  return what && typeof what === 'string' ? `${base}: ${what.slice(0, 120)}` : base;
}

async function readSession(dir, id) {
  try { return JSON.parse(await fs.readFile(path.join(dir, `${id}.json`), 'utf8')); } catch { return null; }
}
async function readFolded(dir, id) {
  try {
    return (await fs.readFile(path.join(dir, `${id}.folded.jsonl`), 'utf8')).split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

/** One saved conversation, whole: its folded turns first, then what's in the session now. Null if it's gone. */
export async function loadConversation(dir, id) {
  if (!/^\d{8}-\d{6}-[a-z0-9]{6}$/.test(String(id))) return null;
  const s = await readSession(dir, id);
  if (!s || !Array.isArray(s.messages)) return null;
  const folded = await readFolded(dir, id);
  return { session: s, messages: display([...folded, ...s.messages]) };
}

const startOf = (id) => {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(id);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : 0;
};

/**
 * Saved conversations, most recently used first: [{ id, title, at, count, kind, snippet? }]. With `q`, only those whose words
 * (asked or answered, folded turns too) contain it, with a snippet around the first match.
 */
export async function listConversations(dir, { q = '', limit = 60 } = {}) {
  let names = [];
  try { names = (await fs.readdir(dir)).map((n) => SESSION_FILE.exec(n)?.[1]).filter(Boolean).sort().reverse(); } catch { return []; }
  const needle = String(q).trim().toLowerCase();
  const out = [];
  for (const id of names) {
    const c = await loadConversation(dir, id);
    if (!c) continue;
    const msgs = c.messages.filter((m) => m.role === 'user' || m.role === 'assistant');
    if (!msgs.length) continue;
    const first = msgs.find((m) => m.role === 'user')?.text ?? msgs[0].text;
    const item = { id, title: first.replace(/\s+/g, ' ').slice(0, 90), at: c.session.lastActiveAt ?? startOf(id), count: msgs.filter((m) => m.role === 'user').length, kind: c.session.kind ?? 'chat' };
    if (needle) {
      const hit = msgs.map((m) => `${m.text}\n${m.detail ?? ''}`).find((t) => t.toLowerCase().includes(needle));
      if (!hit) continue;
      const flat = hit.replace(/\s+/g, ' ');
      const fi = flat.toLowerCase().indexOf(needle);
      item.snippet = `${fi > 40 ? '…' : ''}${flat.slice(Math.max(0, fi - 40), fi + needle.length + 60)}${fi + needle.length + 60 < flat.length ? '…' : ''}`;
    }
    out.push(item);
  }
  // Most recently used first: a resumed conversation sits at the top, not where it started.
  return out.sort((a, b) => b.at - a.at).slice(0, limit);
}
