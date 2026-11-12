// The conversation window: the whole conversation with the companion, beside her on the desktop. It shows what's
// said as it streams (the same reply the bubble gets, plus a Work reply's full answer below its "---" line), the
// steps of a longer task, reply depth and reasoning, and saved conversations to search, read and resume.
// The sidecar owns everything: it sends state ({kind:'state'}), the saved messages ({kind:'messages'}) and the live
// reply ({kind:'agent'}); this page sends back what's asked ({type:'convo_*'}) and the menu's own actions.
// Model text becomes DOM through markdown.js, as elements and textContent only, never HTML. Links open through the
// sidecar, which checks them like every other link. Opened in a plain browser it shows a preview with sample data.
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const TAURI = window.__TAURI__?.core?.invoke;
  const invoke = TAURI ?? preview();
  const send = (msg) => invoke('sidecar_send', { msg }).catch(() => {});
  const act = (id) => send({ type: 'menu', id });

  let state = null, items = [], viewing = null, raf = 0;
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  // ---------- markdown → DOM ----------
  const spans = (parent, list) => {
    for (const sp of list) {
      if (sp.t === 'text') parent.append(sp.s);
      else if (sp.t === 'code') parent.append(mk('code', '', sp.s));
      else if (sp.t === 'a') { const a = mk('a'); a.href = sp.href; a.title = sp.href; spans(a, sp.c); parent.append(a); }
      else { const e = mk(sp.t === 'b' ? 'b' : sp.t === 'i' ? 'em' : 's'); spans(e, sp.c); parent.append(e); }
    }
  };
  const list = (blk) => {
    const e = mk(blk.t);
    if (blk.t === 'ol' && blk.start !== 1) e.start = blk.start;
    for (const it of blk.items) { const li = mk('li'); spans(li, it.c); if (it.sub) li.append(list(it.sub)); e.append(li); }
    return e;
  };
  const block = (blk) => {
    switch (blk.t) {
      case 'p': { const p = mk('p'); spans(p, blk.c); return p; }
      case 'h': { const h = mk('h4'); spans(h, blk.c); return h; }
      case 'ul': case 'ol': return list(blk);
      case 'quote': { const q = mk('blockquote'); for (const b of blk.c) q.append(block(b)); return q; }
      case 'code': { const pre = mk('pre'), c = mk('code', '', blk.s); pre.append(c); return pre; }
      case 'hr': return mk('hr');
      case 'src': { const p = mk('p', 'src'); p.append('Sources: '); spans(p, blk.c); return p; }
      case 'table': {
        const w = mk('div', 'table'), t = mk('table'), thead = mk('thead'), tb = mk('tbody'), hr = mk('tr');
        for (const c of blk.head) { const th = mk('th'); th.scope = 'col'; spans(th, c); hr.append(th); }
        thead.append(hr);
        for (const r of blk.rows) { const tr = mk('tr'); for (const c of r) { const td = mk('td'); spans(td, c); tr.append(td); } tb.append(tr); }
        t.append(thead, tb); w.append(t);
        return w;
      }
      default: return mk('div');
    }
  };
  const md = (text, caret) => {
    const box = mk('div', 'body');
    const blocks = window.Roamie?.md ? window.Roamie.md.blocks(text) : [{ t: 'p', c: [{ t: 'text', s: text }] }];
    box.append(...blocks.map(block));
    if (caret) {
      const c = mk('span', 'caret'); c.setAttribute('aria-hidden', 'true');
      let host = box.lastElementChild ?? box;
      while (host.lastElementChild && /^(UL|OL|LI|BLOCKQUOTE|PRE|DIV|TABLE|TBODY|TR)$/.test(host.tagName)) host = host.lastElementChild;
      host.append(c);
    }
    return box;
  };

  // ---------- copying ----------
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch {}
    const t = mk('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.append(t); t.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch {}
    t.remove();
    return ok;
  }

  // ---------- the log ----------
  const log = $('log');
  const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  function draw() {
    raf = 0;
    const stick = nearBottom();
    const out = [];
    if (!items.length) out.push(mk('p', 'empty', viewing ? 'This conversation is empty.' : `Ask ${state?.name ?? 'me'} anything. Talking, typing by the cursor and typing here are all the same conversation.`));
    for (const m of items) {
      if (m.role === 'user') {
        const row = mk('div', 'msg user'), b = mk('div', 'bubble', m.text + (m.image ? '\n(with a picture of the screen)' : ''));
        row.append(b); out.push(row);
      } else if (m.role === 'assistant') {
        const row = mk('div', 'msg assistant');
        row.append(md(m.text ?? '', m.streaming && !m.detail));
        if (m.detail) { const d = md(m.detail, m.streaming); d.classList.add('detail'); row.append(d); }
        if (!m.streaming && (m.text || m.detail)) {
          const tools = mk('div', 'tools');
          const c = mk('button', 'link', 'Copy'); c.type = 'button';
          c.setAttribute('aria-label', 'Copy this answer');
          c.addEventListener('click', async () => { const ok = await copy([m.text, m.detail].filter(Boolean).join('\n\n')); c.textContent = ok ? 'Copied' : "Couldn't copy"; setTimeout(() => { c.textContent = 'Copy'; }, 1600); });
          tools.append(c); row.append(tools);
        }
        out.push(row);
      } else if (m.role === 'tool') {
        out.push(mk('div', `msg tool${m.running ? ' running' : ''}${m.error ? ' failed' : ''}`, m.text));
      } else out.push(mk('div', `msg note${m.bad ? ' bad' : ''}`, m.text));
    }
    log.replaceChildren(...out);
    if (stick) log.scrollTop = log.scrollHeight;
  }
  const redraw = () => { if (!raf) raf = requestAnimationFrame(draw); };
  // Links open in the browser through the sidecar (it checks them first); never inside this window.
  log.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    e.preventDefault();
    if (/^(https?:|mailto:)/i.test(a.getAttribute('href') ?? '')) send({ type: 'open_link', url: a.getAttribute('href') });
  });

  // The live reply: text streams into the newest answer; a tool line splits it, so the next text starts a new one.
  const lastLive = () => { const m = items[items.length - 1]; return m?.role === 'assistant' && m.streaming ? m : null; };
  const toolText = (anim) => (anim ? `${anim.label ? anim.label[0].toUpperCase() + anim.label.slice(1) : 'Working'}${anim.detail ? ` ${anim.detail}` : ''}` : null);
  function onAgent(e) {
    if (viewing) return;
    if (e.type === 'text') { let m = lastLive(); if (!m) { m = { role: 'assistant', text: '', streaming: true }; items.push(m); } m.text += e.text; }
    else if (e.type === 'detail') { let m = lastLive(); if (!m) { m = { role: 'assistant', text: '', streaming: true }; items.push(m); } m.detail = (m.detail ?? '') + e.text; }
    else if (e.type === 'tool') {
      const t = toolText(e.anim);
      for (const m of items) if (m.streaming) m.streaming = false;
      if (t) items.push({ role: 'tool', id: e.id, text: t, running: true });
    } else if (e.type === 'tool_end') { const m = items.find((x) => x.role === 'tool' && x.id === e.id); if (m) { m.running = false; m.error = !!e.isError; } }
    else if (e.type === 'trail') { steps(e.steps, e.head); return; }
    else if (e.type === 'done') for (const m of items) { m.streaming = false; m.running = false; }
    else if (e.type === 'error') { for (const m of items) { m.streaming = false; m.running = false; } items.push({ role: 'note', bad: true, text: e.message ?? 'Something went wrong.' }); }
    else return;
    redraw();
  }

  // ---------- progress ----------
  function steps(list = [], head = '') {
    const ol = $('steps');
    ol.replaceChildren(...list.map((s) => { const li = mk('li', s.state || '', s.text + (s.why ? ` (${s.why})` : '')); return li; }));
    if (head) ol.setAttribute('aria-label', head);
    progress();
  }
  function progress() {
    const busy = !!state?.busy && !viewing;
    $('progress').hidden = !busy && !$('steps').children.length;
    $('doing').hidden = !busy;
    $('doing').textContent = state?.doing ? state.doing[0].toUpperCase() + state.doing.slice(1) : 'Thinking…';
  }

  // ---------- controls ----------
  function controls() {
    const s = state;
    $('who').textContent = `Conversation with ${s.name}`;
    $('model').textContent = s.model ? `${s.model.name} · ${s.model.provider}${s.voice ? ' · spoken replies on' : ''}` : 'No model yet: pick one on the Model page';
    const modes = $('modes');
    modes.replaceChildren(...s.modes.map((x) => {
      const on = x.id === s.mode;
      const b = mk('button', 'px chord'); b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1;
      b.title = x.hint;
      b.append(mk('span', 'px cap', x.label));
      b.addEventListener('click', () => { if (!on) act(`mode:${x.id}`); });
      return b;
    }));
    $('mode-hint').textContent = s.modes.find((x) => x.id === s.mode)?.hint ?? '';
    const sel = $('thinking');
    const value = s.thinkingChoices.some((c) => c.id === s.thinking) ? s.thinking : s.thinkingUsed;
    sel.replaceChildren(...s.thinkingChoices.map((c) => { const o = mk('option', '', c.label); o.value = c.id; o.selected = c.id === value; return o; }));
    sel.disabled = s.thinkingChoices.length < 2;
    sel.title = s.thinkingChoices.length < 2 ? "This model doesn't take a reasoning level" : 'How hard the model thinks before it answers';
    const sendB = $('send');
    // While she answers the button is Stop, unless something's typed: then it sends (queued after this reply).
    const stops = s.busy && !viewing && !input.value.trim();
    sendB.textContent = stops ? 'Stop' : 'Send';
    sendB.className = `px btn ${stops ? 'ghost' : 'primary'}`;
    sendB.setAttribute('aria-label', stops ? 'Stop the answer' : 'Send');
    $('viewing').hidden = !viewing;
    $('new-btn').disabled = !!s.busy;
    if (s.steps) steps(s.steps);
    progress();
  }
  // Arrow keys move between the depth choices, like the panel's.
  $('modes').addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key) || !state) return;
    const i = state.modes.findIndex((x) => x.id === state.mode);
    const next = state.modes[(i + (e.key === 'ArrowRight' ? 1 : state.modes.length - 1)) % state.modes.length];
    act(`mode:${next.id}`);
    e.preventDefault();
  });
  $('thinking').addEventListener('change', (e) => act(`thinking:${e.target.value}`));
  $('new-btn').addEventListener('click', () => act('new'));

  const input = $('input');
  const grow = () => { input.style.height = 'auto'; input.style.height = `${Math.min(180, input.scrollHeight)}px`; };
  input.addEventListener('input', () => { grow(); if (state) controls(); });
  // Enter always sends, even while she's answering (it's queued after the current reply); only the button stops.
  const sendText = () => {
    const text = input.value.trim();
    if (!text) return input.focus();
    send({ type: 'convo_send', text });
    input.value = ''; grow();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendText(); } });
  $('compose').addEventListener('submit', (e) => { e.preventDefault(); sendText(); });
  $('send').addEventListener('click', () => (state?.busy && !viewing && !input.value.trim() ? act('stop') : sendText()));
  $('resume-btn').addEventListener('click', () => viewing && send({ type: 'convo_resume', id: viewing }));
  $('back-btn').addEventListener('click', () => send({ type: 'convo_back' }));

  // ---------- history ----------
  const hist = $('history'), search = $('search');
  let searchTimer = 0;
  const openHistory = (on) => {
    hist.hidden = !on; $('history-btn').setAttribute('aria-expanded', String(on));
    if (on) { send({ type: 'convo_history', q: search.value }); search.focus(); } else $('history-btn').focus();
  };
  $('history-btn').addEventListener('click', () => openHistory(hist.hidden));
  $('history-close').addEventListener('click', () => openHistory(false));
  hist.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); openHistory(false); } });
  search.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => send({ type: 'convo_history', q: search.value }), 220); });
  const when = (ms) => new Date(ms).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  function history(m) {
    if (m.q !== search.value) return; // an older search's answer
    const ul = $('h-list');
    if (!m.items.length) { ul.replaceChildren(mk('li', 'h-empty', m.q ? `Nothing saved mentions “${m.q}”.` : 'No saved conversations yet.')); return; }
    ul.replaceChildren(...m.items.map((it) => {
      const li = mk('li', it.id === state?.session ? 'current' : '');
      const b = mk('button'); b.type = 'button';
      b.append(mk('span', 'h-title', it.kind === 'intro' ? `Get to Know Me: ${it.title}` : it.title));
      b.append(mk('span', 'h-meta', `${when(it.at)} · ${it.count} message${it.count === 1 ? '' : 's'}${it.id === state?.session ? ' · current' : ''}`));
      if (it.snippet) b.append(mk('span', 'h-snip', it.snippet));
      b.addEventListener('click', () => { send({ type: 'convo_view', id: it.id }); openHistory(false); });
      li.append(b);
      return li;
    }));
  }

  // ---------- from the sidecar ----------
  let noteTimer = 0;
  const note = (text, bad = false) => { const n = $('note'); n.textContent = text; n.className = `note${bad ? ' bad' : ''}`; n.hidden = false; clearTimeout(noteTimer); noteTimer = setTimeout(() => { n.hidden = true; }, 5000); };
  window.__convo = (m) => {
    if (m.kind === 'state') { state = m.state; viewing = m.state.viewing; controls(); }
    else if (m.kind === 'messages') { items = m.messages.map((x) => ({ ...x })); viewing = m.viewing ? m.session : null; if (state) controls(); draw(); log.scrollTop = log.scrollHeight; }
    else if (m.kind === 'user') { if (!viewing) { items.push({ role: 'user', text: m.text, image: m.image }); $('steps').replaceChildren(); redraw(); } }
    else if (m.kind === 'agent') onAgent(m.e);
    else if (m.kind === 'history') history(m);
    else if (m.kind === 'note') note(m.text, m.bad);
  };
  window.__convoShown = () => send({ type: 'convo_open' });
  send({ type: 'convo_open' });
  input.focus();

  // ---------- browser preview ----------
  function preview() {
    document.title = 'Roamies Conversation (preview with sample data)';
    const q = new URLSearchParams(location.search);
    const s = {
      mode: q.get('mode') ?? 'work', modes: [
        { id: 'quick', label: 'Quick', hint: 'Short spoken replies, a few sentences.' },
        { id: 'conversation', label: 'Conversation', hint: 'Natural back and forth, with follow-up questions.' },
        { id: 'work', label: 'Work', hint: 'Research, analysis, drafting and multi-step tasks, at any length.' }],
      thinking: 'medium', thinkingUsed: 'medium',
      thinkingChoices: ['off', 'low', 'medium', 'high', 'xhigh', 'max'].map((id) => ({ id, label: { off: 'Off', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' }[id] })),
      busy: q.has('busy'), model: { name: 'GPT-6 Luna', provider: 'OpenAI' }, voice: true, name: 'Roamie', session: 's1', viewing: null,
      steps: q.has('busy') ? [{ text: 'Find the three plans', state: 'ok' }, { text: 'Compare prices', state: 'now' }, { text: 'Write the summary', state: '' }] : [], doing: q.has('busy') ? 'reading pricing pages' : null,
    };
    const messages = q.has('empty') ? [] : [
      { role: 'user', text: 'Compare the three hosting plans we looked at and draft a note to the team.' },
      { role: 'tool', text: 'Searched the web: hosting plans 2026 pricing' },
      { role: 'tool', text: 'Read a web page: https://example.com/pricing' },
      { role: 'assistant', text: 'Plan B is the best value for us: it covers our traffic for half the price of Plan C.', detail: '#### Comparison\n\n| Plan | Price | Bandwidth | Support |\n| --- | --- | --- | --- |\n| A | $12/mo | 100 GB | Email |\n| B | $29/mo | 1 TB | Chat |\n| C | $58/mo | 2 TB | Phone |\n\n#### Draft\n\n> Hi team, I suggest we move to Plan B. It covers our traffic with room to spare.\n\n```bash\ncurl -s https://example.com/api/plans | jq \'.[] | .name\'\n```\n\nSources: [Example pricing](https://example.com/pricing)' },
    ];
    setTimeout(() => { window.__convo({ kind: 'state', state: s }); window.__convo({ kind: 'messages', session: 's1', messages }); }, 0);
    return async (cmd, args) => {
      const m = args?.msg ?? {};
      console.log('[preview] would send', JSON.stringify(m));
      if (m.type === 'menu' && m.id?.startsWith('mode:')) { s.mode = m.id.slice(5); setTimeout(() => window.__convo({ kind: 'state', state: s }), 50); }
      if (m.type === 'menu' && m.id?.startsWith('thinking:')) { s.thinking = m.id.slice(9); setTimeout(() => window.__convo({ kind: 'state', state: s }), 50); }
      if (m.type === 'convo_history') setTimeout(() => window.__convo({ kind: 'history', q: m.q, items: [
        { id: 's1', title: 'Compare the three hosting plans we looked at and draft a note', at: Date.now() - 3e5, count: 1, kind: 'chat' },
        { id: 's0', title: 'What time is it in Tokyo?', at: Date.now() - 864e5, count: 3, kind: 'chat', snippet: m.q ? `…it's 3 PM in ${m.q}…` : undefined },
      ].filter((x) => !m.q || x.snippet) }), 80);
      if (m.type === 'convo_view' && m.id === 's0') setTimeout(() => { s.viewing = 's0'; window.__convo({ kind: 'messages', session: 's0', viewing: true, messages: [{ role: 'user', text: 'What time is it in Tokyo?' }, { role: 'assistant', text: "It's about 3 PM in Tokyo." }] }); window.__convo({ kind: 'state', state: s }); }, 80);
      if (m.type === 'convo_back' || m.type === 'convo_resume') setTimeout(() => { s.viewing = null; window.__convo({ kind: 'state', state: s }); window.__convo({ kind: 'messages', session: 's1', messages }); }, 80);
      if (m.type === 'convo_send') setTimeout(() => {
        window.__convo({ kind: 'user', text: m.text });
        const words = 'Here is a short summary of what I found.'.split(' ');
        let i = 0; const t = setInterval(() => { window.__convo({ kind: 'agent', e: { type: 'text', text: (i ? ' ' : '') + words[i] } }); if (++i >= words.length) { clearInterval(t); window.__convo({ kind: 'agent', e: { type: 'detail', text: '- One\n- Two\n' } }); window.__convo({ kind: 'agent', e: { type: 'done' } }); } }, 60);
      }, 50);
      return null;
    };
  }
})();
