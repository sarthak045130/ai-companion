/* Video-call mode. Sits on top of the existing chat: it reads the chat's DOM (new replies, "speaking" state, recording state)
   and drives the chat's own composer / mic / voice controls, so none of the original app code had to change. */
'use strict';
(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const TOKEN = (document.querySelector('meta[name="companion-token"]') || {}).content || '';
  const KEY = 'companion.avatar.character';

  const ICON = {
    video: '<path d="M4 7h10a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V9a2 2 0 012-2z"/><path d="M16 11l5-3v8l-5-3"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/>',
    send: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    phone: '<path d="M4 14c4.5-4 11.5-4 16 0l-2 3-3.5-1.5V13c-2-.7-3-.7-5 0v2.5L6 17z"/>',
    camOff: '<path d="M4 7h10a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V9a2 2 0 012-2z"/><path d="M16 11l5-3v8l-5-3M3 3l18 18"/>',
  };
  const svg = (n) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[n]}</svg>`;

  const S = {
    open: false, charId: localStorage.getItem(KEY) || 'nova', renderer: null, face2d: null, use2d: false, avatar: null,
    raf: 0, last: 0, perception: null, camOn: false, prevTts: null, mo: null, mo2: null, states: new WeakMap(),
    cps: 16, lastGreet: 0, lastExprMessage: '', lastExprMessageAt: 0, toastT: 0, thumbs: null, cam: { want: true, greet: true },
  };
  let root;

  /* ------------------------------------------------------------ build UI */
  function buildUI() {
    const btn = document.createElement('button');
    btn.id = 'call-btn'; btn.className = 'icon-btn'; btn.type = 'button';
    btn.title = 'Video call with a character'; btn.setAttribute('aria-label', 'Start a video call');
    btn.innerHTML = svg('video');
    const actions = $('.header-actions'); if (actions) actions.prepend(btn);
    btn.addEventListener('click', openSetup);

    root = document.createElement('div'); root.id = 'call-root'; root.hidden = true;
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Video call');
    root.innerHTML = `
      <div class="call-setup" id="call-setup">
        <h2>Video call</h2>
        <p>Pick who you want to talk to. They talk back with a face, hands and a voice.</p>
        <div class="char-grid" id="char-grid"></div>
        <div class="call-opts">
          <label><input type="checkbox" id="opt-cam" checked><span>Use my camera. They notice when you wave and read your expression (the picture never leaves this computer).</span></label>
          <label><input type="checkbox" id="opt-greet" checked><span>When I wave, say hi back in the chat too</span></label>
        </div>
        <div class="call-setup-actions"><button class="btn" id="call-cancel" type="button">Cancel</button><button class="btn primary" id="call-start" type="button">Start call</button></div>
        <p class="fineprint">The character is an AI. It speaks through your computer's voice.</p>
      </div>
      <div class="call-live" id="call-live" hidden>
        <canvas id="avatar-canvas"></canvas>
        <div class="call-top"><div class="call-title"><b id="call-name"></b><span id="call-status">Connected</span></div><div class="call-chars" id="call-chars"></div></div>
        <div class="call-toast" id="call-toast" role="status"></div>
        <div class="call-self" id="call-self" hidden><video id="self-video" playsinline muted></video><span class="self-badge" id="self-badge">camera on</span></div>
        <div class="call-caption" id="call-caption" aria-live="polite"></div>
        <div class="call-controls">
          <button class="call-ctl" id="call-mic" type="button" aria-label="Talk (click to start, click again to send)" title="Talk">${svg('mic')}</button>
          <form class="call-say" id="call-say" autocomplete="off"><input id="call-text" type="text" placeholder="Type to say something" aria-label="Type a message"><button class="call-ctl" type="submit" aria-label="Send" title="Send">${svg('send')}</button></form>
          <button class="call-ctl" id="call-cam" type="button" aria-label="Camera" title="Camera on/off">${svg('video')}</button>
          <button class="call-ctl hang" id="call-hang" type="button" aria-label="End call" title="End call">${svg('phone')}</button>
        </div>
      </div>`;
    document.body.append(root);

    $('#call-cancel').addEventListener('click', closeAll);
    $('#call-start').addEventListener('click', startCall);
    $('#call-hang').addEventListener('click', endCall);
    $('#call-mic').addEventListener('click', () => { const m = $('#mic'); if (m) m.click(); });
    $('#call-cam').addEventListener('click', toggleCamera);
    $('#call-say').addEventListener('submit', (e) => { e.preventDefault(); const i = $('#call-text'); const t = i.value.trim(); if (t) { sendAsUser(t); i.value = ''; } });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.open) { e.preventDefault(); if (!$('#call-live').hidden) endCall(); else closeAll(); } });
  }

  /* ----------------------------------------------------------- setup screen */
  function openSetup() {
    if (S.open) return;
    S.charId = Characters.byId(S.charId).id;
    S.open = true; root.hidden = false; $('#call-setup').hidden = false; $('#call-live').hidden = true;
    const grid = $('#char-grid'); grid.replaceChildren();
    const thumbs = getThumbs();
    for (const d of Characters.DEFS) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'char-card'; b.dataset.id = d.id;
      b.setAttribute('aria-pressed', String(d.id === S.charId));
      const th = thumbs && thumbs[d.id];
      b.innerHTML = (th ? `<img class="thumb" alt="" src="${th}">` : `<div class="thumb"></div>`) + `<b></b><small></small>`;
      b.querySelector('.thumb').style.setProperty('--grad', `radial-gradient(120% 90% at 50% 25%, ${d.bg[0]}, ${d.bg[1]})`);
      if (th) b.querySelector('.thumb').style.background = `radial-gradient(120% 90% at 50% 25%, ${d.bg[0]}, ${d.bg[1]})`;
      b.querySelector('b').textContent = d.label; b.querySelector('small').textContent = d.blurb;
      b.addEventListener('click', () => { S.charId = d.id; grid.querySelectorAll('.char-card').forEach((c) => c.setAttribute('aria-pressed', String(c === b))); });
      grid.append(b);
    }
    $('#opt-cam').checked = S.cam.want; $('#opt-greet').checked = S.cam.greet;
    $('#call-start').focus({ preventScroll: true });
  }
  function getThumbs() {
    if (S.thumbs !== null) return S.thumbs;
    S.thumbs = false;
    try {
      const c = document.createElement('canvas'); c.width = 240; c.height = 300;
      const r = new GL3D.Renderer(c), out = {};
      for (const d of Characters.DEFS) {
        const P = Characters.build(d), av = new Rig.Avatar(P);
        av.setExpression('happy', 0.6, 99); for (let i = 0; i < 40; i++) av.update(1 / 30);
        r.cam.pos = [0, P.frame.y + 0.5, P.frame.z * 0.58]; r.cam.target = [0, P.frame.y + 0.5, 0];
        r.render(P.root, true); out[d.id] = c.toDataURL('image/png');
      }
      const ext = r.gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext();
      S.thumbs = out;
    } catch (e) { S.thumbs = false; }
    return S.thumbs;
  }
  function closeAll() { S.open = false; root.hidden = true; }

  /* -------------------------------------------------------------- the call */
  async function startCall() {
    S.cam.want = $('#opt-cam').checked; S.cam.greet = $('#opt-greet').checked;
    localStorage.setItem(KEY, S.charId);
    $('#call-setup').hidden = true; $('#call-live').hidden = false;
    setupRenderer(); buildAvatar(S.charId); buildPills();
    S.last = performance.now(); cancelAnimationFrame(S.raf); S.raf = requestAnimationFrame(frame);
    await readSpeechRate(); ensureVoice(); watchChat();
    if (S.cam.want) startCamera(); else updateCamUI();
    setTimeout(() => { if (S.avatar && S.open) { S.avatar.gesture('wave'); S.avatar.setExpression('happy', 0.9, 3); } }, 500);
    status('Connected');
  }

  function setupRenderer() {
    const canvas = $('#avatar-canvas');
    const fresh = canvas.cloneNode(false); canvas.replaceWith(fresh);      // new canvas = clean context
    S.renderer = null; S.face2d = null; S.use2d = false;
    try {
      S.renderer = new GL3D.Renderer(fresh);
      fresh.addEventListener('webglcontextlost', (e) => { e.preventDefault(); fallbackTo2D(); });
    } catch (e) { S.use2d = true; S.face2d = new Face2D(fresh, Characters.byId(S.charId)); toast('3D isn’t available here, using the 2D look.'); }
  }
  function fallbackTo2D() {
    const old = $('#avatar-canvas'), fresh = old.cloneNode(false); old.replaceWith(fresh);
    S.use2d = true; S.renderer = null; S.face2d = new Face2D(fresh, Characters.byId(S.charId)); toast('3D stopped working, switched to the 2D look.');
  }
  function buildAvatar(id) {
    const def = Characters.byId(id); S.charId = def.id;
    const P = Characters.build(def); S.avatar = new Rig.Avatar(P);
    const live = $('#call-live'); live.style.setProperty('--bg1', def.bg[0]); live.style.setProperty('--bg2', def.bg[1]);
    $('#call-name').textContent = def.label;
    if (S.face2d) S.face2d.setDef(def);
  }
  function buildPills() {
    const box = $('#call-chars'); box.replaceChildren();
    for (const d of Characters.DEFS) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = d.label; b.setAttribute('aria-pressed', String(d.id === S.charId));
      b.addEventListener('click', () => { buildAvatar(d.id); localStorage.setItem(KEY, d.id); buildPills(); S.avatar.gesture('wave'); S.avatar.setExpression('happy', 0.8, 2.5); });
      box.append(b);
    }
  }
  function frame(ts) {
    S.raf = requestAnimationFrame(frame);
    const dt = (ts - S.last) / 1000; S.last = ts;
    if (!S.avatar || document.hidden) return;
    S.avatar.update(dt);
    if (S.use2d) { if (S.face2d) S.face2d.render(S.avatar.out); return; }
    const r = S.renderer, P = S.avatar.P, canvas = r.canvas, asp = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    const k = (asp < 0.95 ? 0.95 / asp : 1) * 1.14;
    r.cam.pos = [0, P.frame.y, P.frame.z * k * 1.18]; r.cam.target = [0, P.frame.y - 0.02, 0];
    try { r.render(P.root); } catch (e) { fallbackTo2D(); }
  }

  async function endCall() {
    cancelAnimationFrame(S.raf); S.raf = 0;
    stopCamera();
    if (S.mo) S.mo.disconnect(); if (S.mo2) S.mo2.disconnect(); S.mo = S.mo2 = null;
    const stop = $('#stop-speaking'); if (stop && !stop.hidden) stop.click();
    if (S.prevTts === false) { const t = $('#speak-toggle'); if (t && t.getAttribute('aria-pressed') === 'true') t.click(); }
    S.prevTts = null; S.avatar = null; S.renderer = null; S.face2d = null;
    $('#call-caption').textContent = ''; closeAll();
  }

  /* ----------------------------------------------------- talking to the chat */
  function sendAsUser(text) {
    const input = $('#input'), form = $('#composer'); if (!input || !form) return;
    input.value = text; input.dispatchEvent(new Event('input', { bubbles: true }));
    if (form.requestSubmit) form.requestSubmit(); else form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    const m = Emotion.mood(text);
    if (S.avatar && m && m !== 'thinking') S.avatar.setExpression(m === 'laugh' ? 'happy' : (m === 'happy' ? 'happy' : 'concerned'), 0.5, 2);
  }
  async function readSpeechRate() {
    try {
      const r = await fetch('/api/settings', { headers: { 'X-Companion-Token': TOKEN } });
      const d = await r.json(); const wpm = d.settings && d.settings.voice && d.settings.voice.tts_rate;
      if (wpm) S.cps = Math.max(8, wpm * 5.7 / 60);
    } catch (e) { /* keep default */ }
  }
  function ensureVoice() {
    const t = $('#speak-toggle'); if (!t) return;
    const on = t.getAttribute('aria-pressed') === 'true';
    S.prevTts = on; if (!on) t.click();               // a call needs the voice on; it's switched back afterwards
  }

  /* watch the chat: new reply -> thinking face; "speaking" -> lip-sync; recording -> listening */
  function watchChat() {
    const msgs = $('#messages'); if (!msgs) return;
    for (const el of msgs.querySelectorAll('.msg.assistant')) S.states.set(el, { done: true, spoke: false, silentT: 0 });
    let queued = false;
    const q = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; sync(); }); };
    S.mo = new MutationObserver(q);
    S.mo.observe(msgs, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'], characterData: true });
    const rec = $('#recording-bar');
    S.mo2 = new MutationObserver(q);
    if (rec) S.mo2.observe(rec, { attributes: true, attributeFilter: ['hidden'] });
    const stop = $('#stop-speaking'); if (stop) S.mo2.observe(stop, { attributes: true, attributeFilter: ['hidden'] });
    sync();
  }
  function sync() {
    const av = S.avatar; if (!av) return;
    const rec = $('#recording-bar'), recording = rec && !rec.hidden;
    $('#call-mic').classList.toggle('rec', !!recording);
    const bots = document.querySelectorAll('#messages .msg.assistant'), el = bots[bots.length - 1];
    let thinking = false;
    if (el) {
      const live = el.classList.contains('live'), speaking = el.classList.contains('speaking');
      const text = ((el.querySelector('.msg-body') || {}).textContent || '').trim();
      let st = S.states.get(el);
      if (!st) { st = { done: !live, spoke: false, silentT: 0 }; S.states.set(el, st); }
      if (live) { thinking = true; if (text && !el.querySelector('.typing')) caption(text); }
      if (!live && !st.done) {
        st.done = true; caption(text);
        st.silentT = setTimeout(() => { const s2 = S.states.get(el); if (S.avatar && s2 && !s2.spoke && !el.classList.contains('speaking')) S.avatar.reactSilently(text); }, 1800);
      }
      if (speaking && !st.spoke) { st.spoke = true; clearTimeout(st.silentT); caption(text); av.speak(text, S.cps); }
      if (!speaking && st.spoke) { st.spoke = false; av.stopSpeak(); }
    }
    av.setMode(recording ? 'listening' : (thinking ? 'thinking' : 'idle'));
    status(recording ? 'Listening…' : thinking ? 'Thinking…' : (av.speaking ? 'Speaking' : 'Connected'));
  }
  function caption(text) {
    const t = text.replace(/\s+/g, ' ').trim();
    $('#call-caption').textContent = t.length > 230 ? '…' + t.slice(-226) : t;
  }
  function status(s) { const e = $('#call-status'); if (e) e.textContent = s + (S.camOn ? ' · camera on' : ''); }

  /* ------------------------------------------------------------- camera */
  async function startCamera() {
    if (S.camOn) return;
    S.perception = new Perception.Perception({
      onWave: (src) => onWave(src),
      onExpression: (label) => onUserExpression(label),
      onGesture: (g) => onHandGesture(g),
      onLevel: (lv) => { $('#self-badge').textContent = lv === 2 ? 'face + hands' : 'wave detection'; },
    });
    try {
      $('#call-self').hidden = false;
      await S.perception.start($('#self-video'));
      S.camOn = true;
    } catch (e) {
      S.perception = null; S.camOn = false; $('#call-self').hidden = true;
      toast('Couldn’t open the camera, so the call continues without it. ' + (e && e.message ? e.message : ''), 6000);
    }
    updateCamUI(); status('Connected');
  }
  function stopCamera() {
    if (S.perception) S.perception.stop(); S.perception = null; S.camOn = false;
    const s = $('#call-self'); if (s) s.hidden = true; updateCamUI();
  }
  function toggleCamera() { if (S.camOn) { stopCamera(); S.cam.want = false; } else { S.cam.want = true; startCamera(); } }
  function updateCamUI() { const b = $('#call-cam'); if (!b) return; b.classList.toggle('on', S.camOn); b.innerHTML = svg(S.camOn ? 'video' : 'camOff'); }

  function onWave(src) {
    const av = S.avatar; if (!av) return;
    av.gesture('wave'); av.setExpression('happy', 0.95, 3.5);
    toast('👋 I saw you wave!');
    const bots = document.querySelectorAll('#messages .msg.assistant'), el = bots[bots.length - 1];
    const busy = el && (el.classList.contains('live') || el.classList.contains('speaking'));
    const now = Date.now();
    if (S.cam.greet && !busy && now - S.lastGreet > 30000) { S.lastGreet = now; sendAsUser('👋 *waves hello*'); }
  }
  const MIRROR = { happy: ['happy', 0.55, '😊 smiling'], sad: ['concerned', 0.65, '😢 looks sad'], surprised: ['surprised', 0.5, '😮 surprised'], angry: ['concerned', 0.4, '😠 frowning'], neutral: [null, 0, '😐 neutral'], none: [null, 0, 'camera on'] };
  function onUserExpression(label) {
    const m = MIRROR[label] || MIRROR.neutral; if (S.avatar) S.avatar.setMirror(m[0], m[1]);
    const b = $('#self-badge'); if (b) b.textContent = m[2];
    const now = Date.now();
    if (['happy', 'sad', 'surprised', 'angry'].includes(label) && label !== S.lastExprMessage && now - S.lastExprMessageAt > 15000) {
      S.lastExprMessage = label; S.lastExprMessageAt = now; sendAsUser(`(my expression looks ${label})`);
    }
  }
  function onHandGesture(g) {
    if (!S.avatar) return;
    if (g === 'thumbsup') { S.avatar.gesture('nod'); S.avatar.setExpression('happy', 1, 2.5); toast('👍 Thanks!'); }
    else if (g === 'peace') { S.avatar.setExpression('happy', 1, 2.5); S.avatar.gesture('cheer'); toast('✌️ Peace!'); }
  }
  function toast(msg, ms) {
    const t = $('#call-toast'); if (!t) return;
    t.textContent = msg; t.classList.add('show'); clearTimeout(S.toastT); S.toastT = setTimeout(() => t.classList.remove('show'), ms || 2200);
  }

  /* hooks for tests / power users */
  window.__call = { S, onWave, onUserExpression, onHandGesture, sync };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildUI); else buildUI();
})();
