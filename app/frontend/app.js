/* Companion UI. Vanilla JS, no external dependencies, talks to the local backend only. */
'use strict';
(function () {
  const TOKEN = document.querySelector('meta[name="companion-token"]').content;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---------------------------------------------------------------- icons */
  const ICONS = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    memory: '<path d="M6 4h12v16.5l-6-3.8-6 3.8z"/>',
    settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/>',
    send: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>',
    speaker: '<path d="M4 10v4h4l5 4V6L8 10z"/><path d="M16.5 9a4 4 0 010 6M19 6.5a8 8 0 010 11"/>',
    speakerOff: '<path d="M4 10v4h4l5 4V6L8 10z"/><path d="M17 9.5l4 5M21 9.5l-4 5"/>',
    trash: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
    edit: '<path d="M4 20l4-1 11-11-3-3L5 16z"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 012-2h9"/>',
  };
  const svg = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
  const setIcon = (el, name) => { el.innerHTML = svg(name); };

  /* ------------------------------------------------------------ DOM helper */
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  const iconBtn = (name, label, onclick, cls) =>
    h('button', { class: 'icon-btn ' + (cls || ''), type: 'button', 'aria-label': label, title: label, html: svg(name), onclick });

  /* ------------------------------------------------------------------- api */
  async function api(path, opts) {
    const o = opts || {};
    const res = await fetch(path, {
      method: o.method || 'GET',
      headers: Object.assign({ 'X-Companion-Token': TOKEN }, o.body ? { 'Content-Type': 'application/json' } : {}),
      body: o.body ? JSON.stringify(o.body) : undefined,
      signal: o.signal,
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.code = data && data.code;
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /* ----------------------------------------------------------------- state */
  const state = {
    settings: null, defaults: null, status: null,
    convs: [], convId: null, messages: [],
    streaming: false, abort: null,
    mic: 'idle', speakingEl: null,
    view: 'chat', stick: true,
    memCache: null,
  };

  /* ---------------------------------------------------------------- format */
  const pad = (n) => String(n).padStart(2, '0');
  function fmtClock(ts) { const d = new Date(ts * 1000); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function fmtWhen(ts) {
    const d = new Date(ts * 1000), now = new Date();
    if (sameDay(d, now)) return fmtClock(ts);
    return d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ', ' + fmtClock(ts);
  }
  function groupOf(ts) {
    const d = new Date(ts * 1000), now = new Date();
    if (sameDay(d, now)) return 'Today';
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (sameDay(d, y)) return 'Yesterday';
    return (now - d) / 86400000 < 7 ? 'Previous 7 days' : 'Earlier';
  }
  const nowSec = () => Date.now() / 1000;

  /* ----------------------------------------------------------------- toast */
  function toast(message, kind, ms) {
    const el = h('div', { class: 'toast ' + (kind || ''), role: kind === 'error' ? 'alert' : 'status', text: message });
    $('#toasts').append(el);
    setTimeout(() => el.remove(), ms || 4200);
  }

  /* ----------------------------------------------------------------- modal */
  function openModal(opts) {
    const prevFocus = document.activeElement;
    const overlay = h('div', { class: 'overlay' });
    const modal = h('div', { class: 'modal' + (opts.small ? ' small' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title });
    const api_ = { close() { overlay.remove(); document.removeEventListener('keydown', onKey, true); if (prevFocus && prevFocus.focus) prevFocus.focus(); if (opts.onClose) opts.onClose(); }, modal };
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); api_.close(); } }
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) api_.close(); });
    modal.append(h('div', { class: 'modal-head' }, h('h2', { text: opts.title }), iconBtn('x', 'Close', () => api_.close())));
    opts.build(modal, api_);
    overlay.append(modal);
    $('#modal-root').append(overlay);
    const first = modal.querySelector('input, select, textarea, button.btn');
    if (first) first.focus();
    return api_;
  }

  function confirmDialog(o) {
    return new Promise((resolve) => {
      let answered = false;
      const done = (v) => { if (!answered) { answered = true; resolve(v); } };
      openModal({
        title: o.title, small: true, onClose: () => done(false),
        build(modal, m) {
          modal.append(h('div', { class: 'modal-body single' },
            h('p', { text: o.body, style: 'margin:0' }),
            h('div', { class: 'modal-actions' },
              h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => m.close() }),
              h('button', { class: 'btn ' + (o.danger ? 'danger' : 'primary'), type: 'button', text: o.confirmText || 'Confirm', onclick: () => { done(true); m.close(); } }))));
        },
      });
    });
  }

  /* ------------------------------------------------------------ appearance */
  function applyAppearance() {
    const a = state.settings.appearance;
    let theme = a.theme;
    if (theme === 'system') theme = window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.setProperty('--fs', a.font_size + 'px');
    const speakOn = !!state.settings.voice.tts_enabled;
    const t = $('#speak-toggle');
    setIcon(t, speakOn ? 'speaker' : 'speakerOff');
    t.classList.toggle('on', speakOn);
    t.setAttribute('aria-pressed', String(speakOn));
    t.title = speakOn ? 'Replies are read aloud (click to turn off)' : 'Read replies aloud';
  }

  /* ---------------------------------------------------------------- status */
  async function refreshStatus() {
    try { state.status = await api('/api/status'); } catch (e) { state.status = null; }
    renderStatus();
  }

  function setBanner(kind, message, actions) {
    const b = $('#banner');
    if (!message) { b.hidden = true; b.replaceChildren(); return; }
    b.className = 'banner' + (kind === 'error' ? ' error' : '');
    b.hidden = false;
    b.replaceChildren(h('p', { html: message }), ...(actions || []).map((a) => h('button', { class: 'btn', type: 'button', text: a.label, onclick: a.run })));
  }

  function renderStatus() {
    const s = state.status;
    const dot = $('#status-dot'), text = $('#status-text');
    if (!s) {
      dot.className = 'dot off'; text.textContent = 'Backend not responding';
      setBanner('error', 'The app’s backend isn’t responding. Quit and reopen the app.');
      return;
    }
    $('#companion-name').textContent = s.companion_name;
    document.title = s.companion_name;
    $('#model-badge').textContent = s.model;
    updateMemCount(s.memory_count);
    const esc = Render.esc;
    if (!s.ollama.ok) {
      dot.className = 'dot off'; text.textContent = 'Ollama is offline';
      setBanner('error', 'Ollama isn’t running. Open the Ollama app, or run <code>ollama serve</code> in Terminal. Chat works again as soon as it’s up.',
        [{ label: 'Check again', run: refreshStatus }]);
    } else if (s.model_installed === false) {
      dot.className = 'dot warn'; text.textContent = 'Model not installed';
      setBanner('warn', `The model <code>${esc(s.model)}</code> isn’t installed. Choose one you have in Settings, or run <code>ollama pull ${esc(s.model)}</code>.`,
        [{ label: 'Choose model', run: () => openSettings('ai') }]);
    } else if (s.personality_error || s.settings_error) {
      dot.className = 'dot on'; text.textContent = 'Online · everything stays on this computer';
      setBanner('warn', esc(s.personality_error || s.settings_error));
    } else {
      dot.className = 'dot on'; text.textContent = 'Online · everything stays on this computer';
      setBanner(null, '');
    }
  }

  function updateMemCount(n) { $('#mem-count').textContent = n ? String(n) : ''; }

  /* --------------------------------------------------------- conversations */
  async function loadConversations() {
    const q = $('#conv-search').value.trim();
    const d = await api('/api/conversations' + (q ? '?q=' + encodeURIComponent(q) : ''));
    state.convs = d.conversations;
    renderConvList();
  }

  function upsertConv(conv) {
    state.convs = [conv, ...state.convs.filter((c) => c.id !== conv.id)];
    renderConvList();
  }

  function renderConvList() {
    const list = $('#conv-list');
    list.replaceChildren();
    if (!state.convs.length) {
      list.append(h('p', { class: 'empty-list', text: $('#conv-search').value ? 'No chats match your search.' : 'Your chats will appear here.' }));
      return;
    }
    let lastGroup = '';
    for (const c of state.convs) {
      const g = groupOf(c.updated_at);
      if (g !== lastGroup) { list.append(h('div', { class: 'group-label', text: g })); lastGroup = g; }
      const title = h('span', { class: 'conv-title', text: c.title });
      const item = h('div', { class: 'conv-item' + (c.id === state.convId ? ' active' : ''), role: 'button', tabindex: '0', 'data-id': c.id },
        h('div', { class: 'conv-main' }, title, h('span', { class: 'conv-time', text: fmtWhen(c.updated_at) })),
        h('div', { class: 'conv-actions' },
          iconBtn('edit', 'Rename chat', (e) => { e.stopPropagation(); beginRename(c, item, title); }, 'sm'),
          iconBtn('trash', 'Delete chat', (e) => { e.stopPropagation(); deleteConversation(c); }, 'sm')));
      item.addEventListener('click', () => openConversation(c.id));
      item.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === item) openConversation(c.id); });
      title.addEventListener('dblclick', (e) => { e.stopPropagation(); beginRename(c, item, title); });
      list.append(item);
    }
  }

  function beginRename(conv, item, titleEl) {
    const input = h('input', { class: 'conv-rename', value: conv.title, 'aria-label': 'Chat name', maxlength: '120' });
    let finished = false;
    const finish = async (save) => {
      if (finished) return; finished = true;
      const value = input.value.trim();
      if (save && value && value !== conv.title) {
        try { const d = await api('/api/conversations/' + conv.id, { method: 'PATCH', body: { title: value } }); conv.title = d.conversation.title; }
        catch (e) { toast(e.message, 'error'); }
      }
      renderConvList();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') { e.stopPropagation(); finish(false); } });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('click', (e) => e.stopPropagation());
    titleEl.replaceWith(input);
    input.focus(); input.select();
  }

  async function deleteConversation(conv) {
    const ok = await confirmDialog({ title: 'Delete this chat?', body: `“${conv.title}” and its messages will be deleted. Memories saved from it are kept.`, confirmText: 'Delete chat', danger: true });
    if (!ok) return;
    try { await api('/api/conversations/' + conv.id, { method: 'DELETE' }); } catch (e) { toast(e.message, 'error'); return; }
    state.convs = state.convs.filter((c) => c.id !== conv.id);
    if (state.convId === conv.id) { state.convs.length ? await openConversation(state.convs[0].id) : newChat(); }
    renderConvList();
  }

  async function openConversation(id) {
    if (state.streaming) return;
    try {
      const d = await api('/api/conversations/' + id);
      state.convId = d.conversation.id;
      state.messages = d.messages;
    } catch (e) { toast(e.message, 'error'); return; }
    await stopSpeaking();
    setView('chat');
    renderThread();
    renderConvList();
  }

  function newChat() {
    if (state.streaming) return;
    state.convId = null; state.messages = [];
    setView('chat');
    renderThread();
    renderConvList();
    $('#input').focus();
  }

  /* ------------------------------------------------------------------ view */
  function setView(view) {
    state.view = view;
    $('#view-chat').hidden = view !== 'chat';
    $('#view-memories').hidden = view !== 'memories';
    $('#open-memories').classList.toggle('active', view === 'memories');
  }

  /* ---------------------------------------------------------------- thread */
  function renderThread() {
    const box = $('#messages');
    box.replaceChildren();
    if (!state.messages.length) { box.append(emptyState()); return; }
    const thread = h('div', { class: 'thread' });
    for (const m of state.messages) thread.append(buildMessage(m).el);
    box.append(thread);
    scrollToBottom(true);
  }

  function emptyState() {
    const name = (state.status && state.status.companion_name) || 'your companion';
    const n = state.status ? state.status.memory_count : 0;
    return h('div', { class: 'empty-chat' },
      h('span', { class: 'dot on' }),
      h('h2', { text: `Say something to ${name}` }),
      h('p', { text: 'Type below, or tap the microphone to talk.' }),
      n ? h('p', {}, `${name} remembers ${n} ${n === 1 ? 'thing' : 'things'} about you. `, h('button', { class: 'link-btn', type: 'button', text: 'See memories', onclick: openMemories })) : null);
  }

  function setBody(body, role, content) {
    if (role === 'assistant') body.innerHTML = Render.render(content); else body.textContent = content;
  }

  function buildMessage(msg) {
    const body = h('div', { class: 'msg-body' });
    setBody(body, msg.role, msg.content || '');
    const el = h('div', { class: 'msg ' + msg.role }, body);
    const ref = { el, body, msg, memories: null };
    fillMeta(ref);
    return ref;
  }

  function fillMeta(ref) {
    const { el, msg } = ref;
    const old = el.querySelector('.msg-meta'); if (old) old.remove();
    const oldList = el.querySelector('.mem-list'); if (oldList) oldList.remove();
    const meta = h('div', { class: 'msg-meta' }, h('span', { text: fmtClock(msg.created_at) }));
    if (msg.role === 'assistant' && msg.content) {
      meta.append(
        iconBtn('speaker', 'Read aloud', () => speak(msg.content, el), 'sm'),
        iconBtn('copy', 'Copy reply', async () => { try { await navigator.clipboard.writeText(msg.content); toast('Copied'); } catch (e) { toast('Couldn’t copy', 'error'); } }, 'sm'));
      const used = ref.memories || (msg.meta && msg.meta.memories_used) || [];
      if (used.length) {
        const label = `${used.length} ${used.length === 1 ? 'memory' : 'memories'} used`;
        const btn = h('button', { class: 'mem-used', type: 'button', text: label, 'aria-expanded': 'false' });
        btn.addEventListener('click', async () => {
          const open = btn.getAttribute('aria-expanded') === 'true';
          btn.setAttribute('aria-expanded', String(!open));
          const existing = el.querySelector('.mem-list');
          if (existing) { existing.remove(); return; }
          const texts = await memoryTexts(used);
          meta.after(h('div', { class: 'mem-list' }, texts.length ? texts.map((t) => h('div', { text: t })) : h('div', { text: 'Those memories have since been deleted.' })));
        });
        meta.append(btn);
      }
    }
    el.append(meta);
  }

  async function memoryTexts(used) {
    if (used.length && typeof used[0] === 'object') return used.map((m) => m.text);
    try {
      const d = await api('/api/memories?include_inactive=1&limit=1000');
      const map = new Map(d.memories.map((m) => [m.id, m.text]));
      return used.map((id) => map.get(id)).filter(Boolean);
    } catch (e) { return []; }
  }

  const box = () => $('#messages');
  function scrollToBottom(force) {
    const b = box();
    if (force || state.stick) b.scrollTop = b.scrollHeight;
  }

  /* ------------------------------------------------------------------ chat */
  async function readSSE(res, onEvent) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const block = buf.slice(0, idx); buf = buf.slice(idx + 2);
        const data = block.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n');
        if (data) { try { onEvent(JSON.parse(data)); } catch (e) { /* ignore malformed event */ } }
      }
    }
  }

  function setStreaming(on) {
    state.streaming = on;
    const send = $('#send');
    setIcon(send, on ? 'stop' : 'send');
    send.setAttribute('aria-label', on ? 'Stop generating' : 'Send message');
    updateSend();
  }
  function updateSend() {
    $('#send').disabled = !state.streaming && !$('#input').value.trim();
  }

  async function send(raw) {
    const text = (raw || '').trim();
    if (!text || state.streaming || state.mic === 'transcribing') return;
    if (state.view !== 'chat') setView('chat');
    await stopSpeaking();
    setStreaming(true);
    $('#input').value = ''; autosize();

    if (!state.messages.length) box().replaceChildren(h('div', { class: 'thread' }));
    const thread = box().querySelector('.thread');
    const userRef = buildMessage({ role: 'user', content: text, created_at: nowSec() });
    const botRef = buildMessage({ role: 'assistant', content: '', created_at: nowSec() });
    botRef.el.classList.add('live');
    botRef.body.replaceChildren(h('span', { class: 'typing', role: 'status', 'aria-label': 'Typing' }, h('i'), h('i'), h('i')));
    botRef.el.querySelector('.msg-meta').remove();
    thread.append(userRef.el, botRef.el);
    state.stick = true; scrollToBottom(true);

    state.abort = new AbortController();
    const sinceTs = nowSec() - 2;
    let reply = '', gotToken = false, finished = false, rafPending = false, failed = false;
    const paint = () => { rafPending = false; botRef.body.innerHTML = Render.render(reply); scrollToBottom(); };

    try {
      const res = await fetch('/api/chat', {
        method: 'POST', signal: state.abort.signal,
        headers: { 'X-Companion-Token': TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: state.convId, message: text }),
      });
      if (!res.ok) {
        let d = {}; try { d = await res.json(); } catch (e) { /* none */ }
        const err = new Error(d.error || `Request failed (${res.status})`); err.code = d.code; throw err;
      }
      await readSSE(res, (ev) => {
        if (ev.type === 'start') {
          state.convId = ev.conversation.id;
          userRef.msg = ev.user_message;
          upsertConv(ev.conversation);
        } else if (ev.type === 'memories') {
          botRef.memories = ev.items;
        } else if (ev.type === 'token') {
          reply += ev.text; gotToken = true;
          if (!rafPending) { rafPending = true; requestAnimationFrame(paint); }
        } else if (ev.type === 'done') {
          finished = true;
          botRef.msg = ev.message;
          botRef.el.classList.remove('live');
          botRef.body.innerHTML = Render.render(ev.message.content);
          fillMeta(botRef);
          state.messages.push(userRef.msg, ev.message);
          upsertConv(ev.conversation);
          scrollToBottom();
          if (state.settings.voice.tts_enabled) speak(ev.message.content, botRef.el);
          watchMemory(sinceTs);
        } else if (ev.type === 'error') {
          failed = true;
          showChatError(botRef, ev, text, reply);
        }
      });
      if (!finished && !failed) { failed = true; showChatError(botRef, { message: 'The connection ended before the reply finished.', code: 'cut_off' }, text, reply); }
    } catch (e) {
      if (e.name === 'AbortError') {
        botRef.el.classList.remove('live');
        if (gotToken) {
          botRef.body.innerHTML = Render.render(reply);
          botRef.msg = { role: 'assistant', content: reply, created_at: nowSec(), meta: {} };
          fillMeta(botRef);
          botRef.el.querySelector('.msg-meta').append(h('span', { text: 'Stopped' }));
          state.messages.push(userRef.msg, botRef.msg);
        } else { botRef.el.remove(); state.messages.push(userRef.msg); }
        loadConversations().catch(() => {});
      } else {
        showChatError(botRef, { message: e.message, code: e.code }, text, reply);
      }
    } finally {
      setStreaming(false);
      state.abort = null;
      refreshStatus();
    }
  }

  function showChatError(ref, ev, originalText, partial) {
    ref.el.classList.remove('live');
    if (partial) { ref.body.innerHTML = Render.render(partial); }
    else ref.body.replaceChildren();
    const actions = [];
    if (ev.code === 'model_missing') actions.push(h('button', { class: 'btn', type: 'button', text: 'Choose model', onclick: () => openSettings('ai') }));
    if (ev.code === 'ollama_unavailable') actions.push(h('button', { class: 'btn', type: 'button', text: 'Check again', onclick: refreshStatus }));
    ref.body.append(h('div', { class: 'msg-error', role: 'alert' }, h('span', { text: ev.message }), ...actions));
    const input = $('#input');
    if (!input.value) { input.value = originalText; autosize(); updateSend(); }
  }

  async function watchMemory(since) {
    let cursor = since;
    for (let i = 0; i < 30; i++) {
      await sleep(1200);
      let d;
      try { d = await api('/api/memories/events?since=' + cursor); } catch (e) { return; }
      for (const ev of d.events) {
        cursor = Math.max(cursor, ev.ts);
        if (ev.action === 'added') toast('Remembered: ' + ev.text, 'memory', 6000);
        else if (ev.action === 'superseded') toast('Updated memory: ' + ev.text, 'memory', 6000);
      }
      updateMemCount(d.count);
      if (d.pending === 0) return;
    }
  }

  /* ----------------------------------------------------------------- voice */
  async function speak(text, el) {
    try {
      await api('/api/voice/speak', { method: 'POST', body: { text } });
      clearSpeakingUI();
      state.speakingEl = el || null;
      if (el) el.classList.add('speaking');
      $('#stop-speaking').hidden = false;
      state.speakTimer = setInterval(async () => {
        try { const s = await api('/api/voice/status'); if (!s.tts.speaking) clearSpeakingUI(); } catch (e) { clearSpeakingUI(); }
      }, 700);
    } catch (e) { toast(e.message, 'error'); }
  }
  function clearSpeakingUI() {
    clearInterval(state.speakTimer);
    if (state.speakingEl) state.speakingEl.classList.remove('speaking');
    state.speakingEl = null;
    $('#stop-speaking').hidden = true;
  }
  async function stopSpeaking() {
    clearSpeakingUI();
    try { await api('/api/voice/stop', { method: 'POST' }); } catch (e) { /* ignore */ }
  }

  const rec = { timer: null, started: 0, polling: false };
  function micUI() {
    const mic = $('#mic'), cancel = $('#mic-cancel'), bar = $('#recording-bar');
    const recording = state.mic === 'recording', busy = state.mic === 'transcribing';
    setIcon(mic, recording ? 'stop' : 'mic');
    mic.classList.toggle('recording', recording);
    mic.classList.toggle('busy', busy);
    mic.setAttribute('aria-label', recording ? 'Stop and send' : 'Speak your message');
    cancel.hidden = !recording;
    bar.hidden = !(recording || busy);
    if (busy) $('#rec-label').textContent = 'Transcribing…';
  }
  async function toggleMic() {
    if (state.mic === 'transcribing' || state.streaming) return;
    if (state.mic === 'recording') return finishRecording();
    try { await api('/api/voice/record/start', { method: 'POST' }); }
    catch (e) { toast(e.message, 'error', 10000); return; }
    clearSpeakingUI();
    state.mic = 'recording'; rec.started = Date.now(); micUI();
    rec.timer = setInterval(async () => {
      const s = Math.floor((Date.now() - rec.started) / 1000);
      $('#rec-label').textContent = `Listening… ${Math.floor(s / 60)}:${pad(s % 60)}`;
      if (rec.polling) return;
      rec.polling = true;
      try { const d = await api('/api/voice/level'); $('#rec-level').style.width = Math.min(100, 4 + d.level * 500) + '%'; } catch (e) { /* ignore */ }
      rec.polling = false;
    }, 200);
  }
  async function finishRecording() {
    clearInterval(rec.timer);
    state.mic = 'transcribing'; micUI();
    try {
      const d = await api('/api/voice/record/stop', { method: 'POST' });
      state.mic = 'idle'; micUI();
      if (state.settings.voice.auto_send_voice) await send(d.text);
      else { const i = $('#input'); i.value = (i.value ? i.value + ' ' : '') + d.text; autosize(); updateSend(); i.focus(); }
    } catch (e) {
      state.mic = 'idle'; micUI();
      toast(e.message, 'error', 10000);
    }
  }
  async function cancelRecording() {
    clearInterval(rec.timer);
    try { await api('/api/voice/record/cancel', { method: 'POST' }); } catch (e) { /* ignore */ }
    state.mic = 'idle'; micUI();
  }

  /* -------------------------------------------------------------- composer */
  function autosize() {
    const i = $('#input');
    i.style.height = 'auto';
    i.style.height = Math.min(i.scrollHeight, 180) + 'px';
  }

  /* -------------------------------------------------------------- memories */
  const mem = { q: '', category: '', order: 'updated', showReplaced: false, adding: false, editing: null, list: [], categories: [], count: 0, timer: null };
  const CATEGORY_LABEL = { fact: 'Fact', preference: 'Preference', event: 'Event', person: 'Person', relationship: 'Relationship', story: 'Story', topic: 'Topic', joke: 'Inside joke', statement: 'Statement', goal: 'Goal' };

  async function openMemories() {
    if (state.streaming) return;
    setView('memories');
    buildMemoryShell();
    await loadMemories();
  }

  async function loadMemories() {
    const p = new URLSearchParams({ order: mem.order, limit: '1000' });
    if (mem.q) p.set('q', mem.q);
    if (mem.category) p.set('category', mem.category);
    if (mem.showReplaced) p.set('include_inactive', '1');
    try {
      const d = await api('/api/memories?' + p);
      mem.list = d.memories; mem.categories = d.categories; mem.count = d.count;
      updateMemCount(d.count);
    } catch (e) { toast(e.message, 'error'); }
    const catSel = $('#mem-cat');
    if (catSel && catSel.options.length <= 1) mem.categories.forEach((c) => catSel.append(h('option', { value: c, text: CATEGORY_LABEL[c] || c })));
    renderMemoryRows();
  }

  function buildMemoryShell() {
    const view = $('#view-memories');
    const search = h('input', { type: 'search', placeholder: 'Search memories', 'aria-label': 'Search memories', value: mem.q, autocomplete: 'off' });
    search.addEventListener('input', () => { clearTimeout(mem.timer); mem.timer = setTimeout(() => { mem.q = search.value.trim(); loadMemories(); }, 180); });
    const cat = h('select', { id: 'mem-cat', 'aria-label': 'Filter by category' }, h('option', { value: '', text: 'All categories' }));
    cat.addEventListener('change', () => { mem.category = cat.value; loadMemories(); });
    const order = h('select', { 'aria-label': 'Sort memories' },
      h('option', { value: 'updated', text: 'Recently changed' }), h('option', { value: 'created', text: 'Newest first' }), h('option', { value: 'importance', text: 'Most important' }));
    order.value = mem.order;
    order.addEventListener('change', () => { mem.order = order.value; loadMemories(); });
    const replaced = h('input', { type: 'checkbox', id: 'mem-replaced', checked: mem.showReplaced });
    replaced.addEventListener('change', () => { mem.showReplaced = replaced.checked; loadMemories(); });
    view.replaceChildren(h('div', { class: 'mem-wrap' },
      h('div', { class: 'mem-head' },
        h('h2', { text: 'What I remember' }),
        h('div', { class: 'row-tools' },
          h('button', { class: 'btn', type: 'button', text: 'Add memory', onclick: () => { mem.adding = !mem.adding; renderMemoryRows(); } }),
          h('button', { class: 'btn', type: 'button', text: 'Back to chat', onclick: () => setView('chat') }))),
      h('p', { class: 'mem-sub', text: 'Memories your companion has saved from your chats. Edit or delete anything — it only uses what’s listed here.' }),
      h('div', { class: 'mem-tools' }, h('label', { class: 'search' }, h('span', { html: svg('search') }), search), cat, order),
      h('label', { class: 'row-tools', style: 'margin:4px 0 8px;color:var(--text-dim);font-size:.9em' }, replaced, 'Show memories that were replaced by newer ones'),
      h('div', { id: 'mem-add-slot' }),
      h('div', { id: 'mem-rows' }),
      h('div', { class: 'modal-actions', style: 'justify-content:flex-start' },
        h('button', { class: 'btn danger', type: 'button', text: 'Delete all memories', onclick: clearAllMemories }))));
  }

  function pips(importance) {
    const n = Math.max(1, Math.round(importance * 5));
    const wrap = h('span', { class: 'pips', role: 'img', 'aria-label': `Importance ${n} of 5`, title: `Importance ${Math.round(importance * 100)}%` });
    for (let i = 0; i < 5; i++) wrap.append(h('i', { class: i < n ? 'f' : '' }));
    return wrap;
  }

  function catSelect(value) {
    const s = h('select', { 'aria-label': 'Category' });
    for (const c of mem.categories) s.append(h('option', { value: c, text: CATEGORY_LABEL[c] || c, selected: c === value }));
    return s;
  }

  function renderMemoryRows() {
    const slot = $('#mem-add-slot'), rows = $('#mem-rows');
    if (!rows) return;
    slot.replaceChildren();
    if (mem.adding) {
      const text = h('textarea', { placeholder: 'e.g. User prefers tea over coffee.', 'aria-label': 'Memory text', maxlength: '500' });
      const cat = catSelect('fact');
      const imp = h('input', { type: 'range', min: '0', max: '1', step: '0.1', value: '0.7', 'aria-label': 'Importance' });
      slot.append(h('div', { class: 'mem-add' }, text,
        h('div', { class: 'row-tools' }, cat, h('span', { text: 'Importance', style: 'color:var(--text-dim)' }), imp,
          h('button', { class: 'btn primary', type: 'button', text: 'Save memory', onclick: async () => {
            try { await api('/api/memories', { method: 'POST', body: { text: text.value, category: cat.value, importance: Number(imp.value) } }); mem.adding = false; await loadMemories(); toast('Memory saved'); }
            catch (e) { toast(e.message, 'error'); } } }),
          h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => { mem.adding = false; renderMemoryRows(); } }))));
      text.focus();
    }
    rows.replaceChildren();
    if (!mem.list.length) {
      rows.append(h('p', { class: 'empty-list', text: mem.q || mem.category ? 'No memories match.' : 'Nothing saved yet. As you chat, anything worth keeping shows up here — or add one yourself.' }));
      return;
    }
    for (const m of mem.list) rows.append(mem.editing === m.id ? memEditRow(m) : memRow(m));
  }

  function memRow(m) {
    const meta = h('div', { class: 'mem-meta' },
      h('span', { text: CATEGORY_LABEL[m.category] || m.category }),
      pips(m.importance),
      h('span', { text: 'Saved ' + fmtWhen(m.created_at) }),
      m.origin === 'manual' ? h('span', { text: 'Added by you' }) : null,
      m.access_count ? h('span', { text: `Used ${m.access_count} ${m.access_count === 1 ? 'time' : 'times'}` }) : null,
      !m.active ? h('span', { text: 'Replaced by a newer memory' }) : null);
    return h('div', { class: `mem-row cat-${m.category}` + (m.active ? '' : ' replaced') },
      h('span', { class: 'mem-mark' }),
      h('div', {}, h('div', { class: 'mem-text', text: m.text }), meta),
      m.active ? h('div', { class: 'mem-actions' },
        iconBtn('edit', 'Edit memory', () => { mem.editing = m.id; renderMemoryRows(); }, 'sm'),
        iconBtn('trash', 'Delete memory', () => deleteMemory(m), 'sm')) : h('div'));
  }

  function memEditRow(m) {
    const text = h('textarea', { rows: '2', maxlength: '500', 'aria-label': 'Memory text' }); text.value = m.text;
    const cat = catSelect(m.category);
    const imp = h('input', { type: 'range', min: '0', max: '1', step: '0.1', value: String(m.importance), 'aria-label': 'Importance' });
    return h('div', { class: `mem-row cat-${m.category}` }, h('span', { class: 'mem-mark' }),
      h('div', { class: 'mem-edit' }, text,
        h('div', { class: 'row-tools' }, cat, h('span', { text: 'Importance', style: 'color:var(--text-dim)' }), imp,
          h('button', { class: 'btn primary', type: 'button', text: 'Save', onclick: async () => {
            try { await api('/api/memories/' + m.id, { method: 'PATCH', body: { text: text.value, category: cat.value, importance: Number(imp.value) } }); mem.editing = null; await loadMemories(); }
            catch (e) { toast(e.message, 'error'); } } }),
          h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => { mem.editing = null; renderMemoryRows(); } }))),
      h('div'));
  }

  async function deleteMemory(m) {
    const ok = await confirmDialog({ title: 'Delete this memory?', body: `“${m.text}” will be forgotten.`, confirmText: 'Delete memory', danger: true });
    if (!ok) return;
    try { await api('/api/memories/' + m.id, { method: 'DELETE' }); await loadMemories(); } catch (e) { toast(e.message, 'error'); }
  }

  async function clearAllMemories() {
    const ok = await confirmDialog({ title: 'Delete all memories?', body: 'Your companion will forget everything it has saved about you. Chats are not affected. This can’t be undone.', confirmText: 'Delete all', danger: true });
    if (!ok) return;
    try { const d = await api('/api/memories?confirm=yes', { method: 'DELETE' }); toast(`Deleted ${d.deleted} memories`); if (state.view === 'memories') await loadMemories(); else updateMemCount(0); }
    catch (e) { toast(e.message, 'error'); }
  }

  /* -------------------------------------------------------------- settings */
  const pending = {};
  function saveSetting(section, key, value) {
    state.settings[section][key] = value;
    const id = section + '.' + key;
    clearTimeout(pending[id]);
    pending[id] = setTimeout(async () => {
      try {
        const d = await api('/api/settings', { method: 'PUT', body: { [section]: { [key]: value } } });
        state.settings = d.settings;
        applyAppearance();
        const s = $('#saved-note'); if (s) s.textContent = 'All changes saved';
        if (section === 'ai' || section === 'memory') refreshStatus();
      } catch (e) { toast(e.message, 'error'); }
    }, 250);
  }

  const S = () => state.settings;
  function field(label, hint, control, forId) {
    return h('div', { class: 'field' }, h('label', { for: forId, text: label }), hint ? h('p', { class: 'hint', text: hint }) : null, control);
  }
  let uid = 0;
  const nextId = () => 'f' + (++uid);

  function toggleField(label, hint, section, key) {
    const id = nextId();
    const input = h('input', { type: 'checkbox', id, checked: S()[section][key] });
    input.addEventListener('change', () => saveSetting(section, key, input.checked));
    return field(label, hint, h('div', { class: 'inline' }, h('label', { class: 'switch' }, input, h('span')), h('span', { text: '' })), id);
  }
  function rangeField(label, hint, section, key, min, max, step, fmt) {
    const id = nextId();
    const out = h('output', { for: id });
    const input = h('input', { type: 'range', id, min, max, step, value: S()[section][key] });
    const show = () => { out.textContent = fmt ? fmt(Number(input.value)) : input.value; };
    show();
    input.addEventListener('input', () => { show(); saveSetting(section, key, Number(input.value)); });
    return field(label, hint, h('div', { class: 'inline' }, input, out), id);
  }
  function numberField(label, hint, section, key, min, max, step) {
    const id = nextId();
    const input = h('input', { type: 'number', id, min, max, step, value: S()[section][key] });
    input.addEventListener('change', () => saveSetting(section, key, Number(input.value)));
    return field(label, hint, input, id);
  }
  function textField(label, hint, section, key, listId) {
    const id = nextId();
    const input = h('input', { type: 'text', id, value: S()[section][key], list: listId, autocomplete: 'off', spellcheck: 'false' });
    input.addEventListener('change', () => saveSetting(section, key, input.value.trim()));
    return field(label, hint, input, id);
  }
  function textareaField(label, hint, section, key) {
    const id = nextId();
    const input = h('textarea', { id }); input.value = S()[section][key];
    input.addEventListener('change', () => saveSetting(section, key, input.value));
    return field(label, hint, input, id);
  }
  function selectField(label, hint, section, key, options) {
    const id = nextId();
    const input = h('select', { id }, options.map(([v, t]) => h('option', { value: v, text: t, selected: String(S()[section][key] ?? '') === String(v) })));
    input.addEventListener('change', () => saveSetting(section, key, input.value === '' && key === 'input_device' ? null : input.value));
    return field(label, hint, input, id);
  }

  async function aiTab(panel) {
    const listId = nextId();
    const dl = h('datalist', { id: listId });
    panel.append(
      textField('Model', 'Any model installed in Ollama, e.g. qwen3:8b, llama3.2, gemma3.', 'ai', 'model', listId), dl,
      rangeField('Temperature', 'Lower is steadier, higher is more creative.', 'ai', 'temperature', 0, 2, 0.05, (v) => v.toFixed(2)),
      rangeField('Top-p', 'Limits how many word choices the model considers.', 'ai', 'top_p', 0, 1, 0.05, (v) => v.toFixed(2)),
      numberField('Context length', 'How much conversation the model can see, in tokens. Larger uses more memory.', 'ai', 'context_length', 512, 131072, 512),
      numberField('Maximum reply length', 'Tokens per reply.', 'ai', 'max_tokens', 16, 32768, 64),
      textareaField('Extra instructions', 'Added to the system prompt after the personality. Optional.', 'ai', 'system_prompt_extra'),
      textField('Ollama address', 'Change only if Ollama runs on another port or computer you trust.', 'ai', 'base_url'));
    try {
      const d = await api('/api/models');
      d.models.forEach((m) => dl.append(h('option', { value: m.name })));
      if (!d.models.length) panel.prepend(h('p', { class: 'hint', text: 'Ollama has no models yet. Install one with: ollama pull qwen3:8b' }));
    } catch (e) { panel.prepend(h('p', { class: 'hint', text: e.message })); }
  }

  const LIST_FIELDS = [['traits', 'Personality traits', 'Comma separated'], ['interests', 'Interests', 'Comma separated'], ['dislikes', 'Dislikes', 'Comma separated'],
    ['vocabulary', 'Favorite words', 'Comma separated'], ['common_phrases', 'Common phrases', 'Comma separated'], ['boundaries', 'Boundaries', 'One per line']];
  const TEXT_FIELDS = [['speaking_style', 'Speaking style'], ['humor', 'Humor'], ['emotional_tendencies', 'Emotional tendencies'], ['relationship', 'Relationship with you']];

  async function personalityTab(panel) {
    let d;
    try { d = await api('/api/personality'); } catch (e) { panel.append(h('p', { text: e.message })); return; }
    const p = d.personality, inputs = {};
    const nameId = nextId();
    inputs.name = h('input', { type: 'text', id: nameId, value: p.name, maxlength: '60' });
    panel.append(field('Name', 'What your companion is called.', inputs.name, nameId));
    for (const [key, label, hint] of TEXT_FIELDS) {
      const id = nextId(); inputs[key] = h('textarea', { id }); inputs[key].value = p[key] || '';
      panel.append(field(label, null, inputs[key], id));
    }
    for (const [key, label, hint] of LIST_FIELDS) {
      const id = nextId(); inputs[key] = h('textarea', { id }); inputs[key].value = (p[key] || []).join(key === 'boundaries' ? '\n' : ', ');
      panel.append(field(label, hint, inputs[key], id));
    }
    const collect = () => {
      const out = { name: inputs.name.value };
      for (const [key] of TEXT_FIELDS) out[key] = inputs[key].value;
      for (const [key] of LIST_FIELDS) out[key] = inputs[key].value.split(key === 'boundaries' ? '\n' : ',').map((s) => s.trim()).filter(Boolean);
      return out;
    };
    panel.append(h('p', { class: 'hint', text: 'This is stored in personality/personality.json. You can also edit that file directly and press “Reload from file”.' }),
      h('div', { class: 'modal-actions' },
        h('button', { class: 'btn', type: 'button', text: 'Reload from file', onclick: async () => {
          try { await api('/api/personality/reload', { method: 'POST' }); toast('Reloaded personality'); await refreshStatus(); const t = $('.tab.active'); if (t) t.click(); } catch (e) { toast(e.message, 'error'); } } }),
        h('button', { class: 'btn primary', type: 'button', text: 'Save personality', onclick: async () => {
          try { await api('/api/personality', { method: 'PUT', body: { personality: collect() } }); toast('Personality saved'); await refreshStatus(); } catch (e) { toast(e.message, 'error'); } } })));
  }

  function memoryTab(panel) {
    panel.append(
      toggleField('Remember things automatically', 'After each reply, your companion decides whether anything is worth keeping.', 'memory', 'enabled'),
      numberField('Memories used per reply', 'The most relevant ones are added to each reply. 0 turns recall off.', 'memory', 'retrieval_limit', 0, 20, 1),
      rangeField('Importance threshold', 'Only save things rated at least this important. Higher saves less.', 'memory', 'importance_threshold', 0, 1, 0.05, (v) => v.toFixed(2)),
      rangeField('Relevance needed for recall', 'How closely a memory must match what you said to be used.', 'memory', 'min_similarity', 0, 1, 0.05, (v) => v.toFixed(2)),
      toggleField('Use Ollama for meaning-based search', 'Needs an embedding model. Without it, recall falls back to simpler word matching.', 'memory', 'use_ollama_embeddings'),
      textField('Embedding model', 'Install with: ollama pull nomic-embed-text', 'memory', 'embedding_model'),
      textField('Model for saving memories', 'Leave empty to use the chat model.', 'memory', 'extraction_model'),
      h('div', { class: 'field' }, h('span', { class: 'label', text: 'Your memories' }),
        h('div', { class: 'row-tools' },
          h('button', { class: 'btn', type: 'button', text: 'Open memory manager', onclick: () => { document.querySelector('.overlay .modal-head button').click(); openMemories(); } }),
          h('button', { class: 'btn danger', type: 'button', text: 'Delete all memories', onclick: clearAllMemories }))));
  }

  async function voiceTab(panel) {
    const v = (state.status && state.status.voice) || {};
    const notes = [];
    if (!v.tts_available) notes.push('No text-to-speech engine was found, so replies can’t be read aloud.');
    if (!v.stt_microphone_available) notes.push(v.stt_reason || 'Microphone support isn’t installed.');
    else if (!v.stt_transcription_available) notes.push('Speech recognition isn’t installed. Run: pip install faster-whisper');
    if (notes.length) panel.append(h('p', { class: 'hint', text: notes.join(' ') }));

    let voices = [], devices = [];
    try { voices = (await api('/api/voice/voices')).voices; } catch (e) { /* none */ }
    try { devices = (await api('/api/voice/devices')).devices; } catch (e) { /* none */ }
    panel.append(
      toggleField('Read replies aloud', 'Text chat always works without voice.', 'voice', 'tts_enabled'),
      selectField('Voice', 'Installed system voices. More are in System Settings → Accessibility → Spoken Content.', 'voice', 'tts_voice',
        [['', 'System default'], ...voices.map((x) => [x.name, `${x.name} (${x.lang})`])]),
      rangeField('Speaking speed', 'Words per minute.', 'voice', 'tts_rate', 80, 400, 5, (n) => n + ' wpm'),
      h('div', { class: 'field' }, h('span', { class: 'label', text: 'Try it' }), h('div', { class: 'row-tools' },
        h('button', { class: 'btn', type: 'button', text: 'Play sample', onclick: async () => {
          const name = (state.status && state.status.companion_name) || 'your companion';
          await new Promise((r) => setTimeout(r, 320));
          speak(`Hi, I’m ${name}. This is how I sound.`, null);
        } }), h('button', { class: 'btn', type: 'button', text: 'Stop', onclick: stopSpeaking }))),
      selectField('Microphone', 'Used when you tap the mic button.', 'voice', 'input_device', [['', 'System default'], ...devices.map((d) => [String(d.index), d.name])]),
      selectField('Speech recognition model', 'Runs on this computer. Larger is more accurate but slower. The first use downloads the model once.', 'voice', 'stt_model',
        [['tiny', 'tiny (fastest)'], ['base', 'base (balanced)'], ['small', 'small (more accurate)'], ['medium', 'medium (slowest)']]),
      selectField('Spoken language', 'Auto-detect works well; pick one if it keeps guessing wrong.', 'voice', 'stt_language',
        [['auto', 'Auto-detect'], ['en', 'English'], ['hi', 'Hindi'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['ja', 'Japanese'], ['pt', 'Portuguese']]),
      toggleField('Send voice messages right away', 'When off, the transcript is placed in the message box so you can edit it first.', 'voice', 'auto_send_voice'));
  }

  function appearanceTab(panel) {
    panel.append(
      selectField('Theme', null, 'appearance', 'theme', [['dark', 'Dark'], ['light', 'Light'], ['system', 'Match system']]),
      rangeField('Text size', null, 'appearance', 'font_size', 12, 22, 1, (n) => n + ' px'));
  }

  const TABS = [['ai', 'AI model', aiTab], ['personality', 'Personality', personalityTab], ['memory', 'Memory', memoryTab], ['voice', 'Voice', voiceTab], ['appearance', 'Appearance', appearanceTab]];

  function openSettings(initial) {
    openModal({
      title: 'Settings',
      build(modal) {
        const panel = h('div', { class: 'tab-panel', role: 'tabpanel' });
        const tabs = h('div', { class: 'modal-tabs', role: 'tablist' });
        const select = async (key) => {
          tabs.querySelectorAll('.tab').forEach((t) => { const on = t.dataset.key === key; t.classList.toggle('active', on); t.setAttribute('aria-selected', String(on)); });
          panel.replaceChildren();
          await TABS.find((t) => t[0] === key)[2](panel);
        };
        for (const [key, label] of TABS) tabs.append(h('button', { class: 'tab', type: 'button', role: 'tab', 'data-key': key, text: label, onclick: () => select(key) }));
        modal.append(h('div', { class: 'modal-body' }, tabs, panel), h('div', { class: 'modal-foot' }, h('span', { id: 'saved-note', text: 'Changes save automatically' }), h('span', { text: 'Stored only on this computer' })));
        select(initial || 'ai');
      },
    });
  }

  /* ------------------------------------------------------------------ init */
  function bind() {
    document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = svg(el.dataset.icon); });
    setIcon($('#mic'), 'mic'); setIcon($('#mic-cancel'), 'x'); setIcon($('#send'), 'send'); setIcon($('#stop-speaking'), 'stop');
    $('#stop-speaking').title = 'Stop speaking';

    $('#new-chat').addEventListener('click', newChat);
    $('#open-memories').addEventListener('click', () => (state.view === 'memories' ? setView('chat') : openMemories()));
    $('#open-settings').addEventListener('click', () => openSettings('ai'));
    $('#stop-speaking').addEventListener('click', stopSpeaking);
    $('#speak-toggle').addEventListener('click', () => {
      const on = !S().voice.tts_enabled;
      saveSetting('voice', 'tts_enabled', on); applyAppearance();
      if (!on) stopSpeaking();
      else if (state.status && !state.status.voice.tts_available) toast('No text-to-speech engine was found on this computer.', 'error');
    });
    $('#mic').addEventListener('click', toggleMic);
    $('#mic-cancel').addEventListener('click', cancelRecording);

    let searchTimer;
    $('#conv-search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => loadConversations().catch((e) => toast(e.message, 'error')), 200); });

    const input = $('#input');
    input.addEventListener('input', () => { autosize(); updateSend(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!state.streaming) send(input.value); }
    });
    $('#composer').addEventListener('submit', (e) => {
      e.preventDefault();
      if (state.streaming) { if (state.abort) state.abort.abort(); return; }
      send(input.value);
    });

    box().addEventListener('scroll', () => { const b = box(); state.stick = b.scrollHeight - b.scrollTop - b.clientHeight < 90; });
    box().addEventListener('click', (e) => {
      const a = e.target.closest('a[data-external]');
      if (!a) return;
      e.preventDefault();
      api('/api/open-url', { method: 'POST', body: { url: a.getAttribute('href') } }).catch((err) => toast(err.message, 'error'));
    });

    document.addEventListener('keydown', (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'n') { e.preventDefault(); newChat(); }
      else if (mod && e.key === ',') { e.preventDefault(); openSettings('ai'); }
      else if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#conv-search').focus(); }
      else if (e.key === 'Escape' && state.mic === 'recording') cancelRecording();
    });
    if (window.matchMedia) matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (state.settings.appearance.theme === 'system') applyAppearance(); });
  }

  async function init() {
    bind();
    try {
      const d = await api('/api/settings');
      state.settings = d.settings; state.defaults = d.defaults;
    } catch (e) {
      setBanner('error', 'Couldn’t reach the app’s backend: ' + Render.esc(e.message));
      return;
    }
    applyAppearance();
    micUI(); setStreaming(false);
    await Promise.all([refreshStatus(), loadConversations().catch(() => {})]);
    if (state.convs.length) await openConversation(state.convs[0].id); else newChat();
    setInterval(refreshStatus, 8000);
  }

  window.addEventListener('DOMContentLoaded', init);
})();
