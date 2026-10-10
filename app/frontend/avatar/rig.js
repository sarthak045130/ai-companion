/* Animation layer: expressions, idle life, lip-sync and gestures for a built character. */
'use strict';
(function (root) {
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const env = (p) => sstep(0, 0.16, p) * (1 - sstep(0.84, 1, p));

  /* face parameters: browY (raise), browTilt (+ = angry, - = sad), curve (-1 frown .. 1 smile), mw (mouth width),
     open (mouth opening), eye (eye openness), head rotations, gaze */
  const BASE = { browY: 0, browAsym: 0, browTilt: 0, curve: 0.12, mw: 1, open: 0, eye: 1, headX: 0, headY: 0, headZ: 0, lookX: 0, lookY: 0 };
  const EXPR = {
    neutral: {},
    happy: { browY: 0.3, browTilt: -0.1, curve: 0.9, mw: 1.15, eye: 0.88 },
    laugh: { browY: 0.45, curve: 1, mw: 1.3, open: 0.5, eye: 0.55, headX: -0.05 },
    sad: { browY: -0.1, browTilt: -0.95, curve: -0.75, mw: 0.85, eye: 0.8, headX: 0.13 },
    concerned: { browY: 0.2, browTilt: -0.6, curve: -0.25, mw: 0.9, headZ: 0.08 },
    surprised: { browY: 1, curve: 0, mw: 0.7, open: 0.6, eye: 1.25 },
    angry: { browY: -0.45, browTilt: 1, curve: -0.35, mw: 0.95, eye: 0.82 },
    thinking: { browY: 0.25, browAsym: 0.5, browTilt: 0.15, curve: -0.05, mw: 0.78, lookX: -0.6, lookY: 0.6, headZ: 0.1, headY: 0.14 },
    curious: { browY: 0.55, browAsym: 0.3, curve: 0.2, mw: 0.95, headZ: 0.12 },
  };
  const RATE = { open: 22, default: 9 };

  /* Gesture library: each returns partial overrides; arms are `aR_*` (screen right) and `aL_*`. */
  const GEST = {
    wave:    { dur: 2.6, f: (p, t) => ({ aR_sz: 2.7, aR_sx: -0.12, aR_elx: -0.3, aR_elz: Math.sin(t * 12) * 0.6, headZ: 0.07 }) },
    nod:     { dur: 1.2, f: (p) => ({ headX: 0.22 * Math.sin(p * Math.PI * 4) }) },
    shake:   { dur: 1.3, f: (p) => ({ headY: 0.34 * Math.sin(p * Math.PI * 6) }) },
    shrug:   { dur: 1.7, f: () => ({ aR_sz: 0.55, aL_sz: 0.55, aR_elx: -0.95, aL_elx: -0.95, headZ: 0.1, browY: 0.5 }) },
    think:   { dur: 3.2, f: (p, t) => ({ aR_sx: -1.15, aR_sz: -0.65, aR_elx: -2.1, headZ: 0.1, headY: 0.1, lookX: -0.4, lookY: 0.5 }) },
    cheer:   { dur: 1.9, f: (p, t) => ({ aR_sz: 2.7, aL_sz: 2.7, aR_elz: Math.sin(t * 9) * 0.35, aL_elz: Math.sin(t * 9 + 1) * 0.35, headX: -0.08 }) },
    explain: { dur: 1.5, f: (p, t) => ({ aR_sx: -0.5 - 0.15 * Math.sin(t * 5), aR_elx: -0.95, aR_sz: 0.2, aL_sx: -0.4 - 0.15 * Math.sin(t * 5 + 1.5), aL_elx: -0.85, aL_sz: 0.2 }) },
    bow:     { dur: 1.8, f: () => ({ headX: 0.35 }) },
  };

  function visemeFor(ch) {
    if (!ch) return { o: 0, w: 1 };
    const c = ch.toLowerCase();
    if ('a'.includes(c)) return { o: 0.85, w: 1.05 };
    if ('e' === c) return { o: 0.55, w: 1.15 };
    if ('i' === c) return { o: 0.4, w: 1.25 };
    if ('o' === c) return { o: 0.7, w: 0.68 };
    if ('u' === c) return { o: 0.45, w: 0.6 };
    if ('mbp'.includes(c)) return { o: 0, w: 1 };
    if ('fv'.includes(c)) return { o: 0.12, w: 1 };
    if (c === ' ') return { o: 0.12, w: 1 };
    if (',;:'.includes(c)) return { o: 0.04, w: 1 };
    if ('.!?…\n'.includes(c)) return { o: 0, w: 1 };
    if (/[0-9]/.test(c)) return { o: 0.4, w: 1 };
    return { o: 0.24, w: 1 };
  }

  class Avatar {
    constructor(P) {
      this.P = P; this.t = 0;
      this.cur = Object.assign({}, BASE);
      this.arms = { aR_sx: 0, aR_sz: 0.1, aR_elx: -0.12, aR_elz: 0, aL_sx: 0, aL_sz: 0.1, aL_elx: -0.12, aL_elz: 0 };
      this.out = Object.assign({}, this.cur, this.arms);
      this.mode = 'idle'; this.hold = null; this.mirror = null;
      this.gests = []; this.speech = null;
      this.blink = { next: 1.5, t: -1 };
      this.gaze = { x: 0, y: 0, nx: 0, ny: 0, next: 1 };
      this.nextBeat = 3; this.laughT = 0; this.vis = { o: 0, w: 1 };
    }
    /* ----- public controls ----- */
    setMode(m) { this.mode = m; }
    setExpression(name, amt = 1, seconds = 2.5) { this.hold = { expr: name, amt, until: this.t + seconds }; }
    setMirror(name, amt) { this.mirror = name ? { expr: name, amt: amt || 0.5 } : null; }
    gesture(name) {
      const g = GEST[name]; if (!g) return;
      this.gests = this.gests.filter((x) => x.name !== name);
      this.gests.push({ name, t0: this.t, dur: g.dur, f: g.f });
    }
    get busy() { return this.gests.length > 0; }
    speak(text, cps) {
      const cues = (root.Emotion ? root.Emotion.analyze(text) : []);
      this.speech = { text, t0: this.t, cps: cps || 15, cues, ci: -1, cur: { expr: 'happy', amt: 0.22 } };
    }
    stopSpeak() { this.speech = null; }
    /* no audio available: still react with the face and hands */
    reactSilently(text) {
      const cues = root.Emotion ? root.Emotion.analyze(text) : [];
      const c = cues.find((q) => q.expr !== 'happy' || q.amt > 0.3) || cues[0];
      if (c) { this.setExpression(c.expr, c.amt, 3.5); if (c.gesture) this.gesture(c.gesture); }
    }
    get speaking() { return !!this.speech; }

    /* ----- per-frame ----- */
    update(dt) {
      dt = Math.min(dt, 0.1); this.t += dt;
      const t = this.t, tgt = Object.assign({}, BASE);

      /* 1. which expression */
      let name = 'neutral', amt = 1;
      const sp = this.speech;
      let charPos = 0;
      if (sp) {
        charPos = (t - sp.t0) * sp.cps;
        while (sp.ci + 1 < sp.cues.length && sp.cues[sp.ci + 1].start <= charPos) {
          const c = sp.cues[++sp.ci];
          sp.cur = { expr: c.expr, amt: c.amt };
          if (c.gesture) this.gesture(c.gesture);
        }
        name = sp.cur.expr; amt = sp.cur.amt;
        if (charPos > sp.text.length + sp.cps * 0.6) this.speech = null;
      } else if (this.hold && t < this.hold.until) { name = this.hold.expr; amt = this.hold.amt; }
      else if (this.mode === 'thinking') { name = 'thinking'; amt = 1; }
      else if (this.mode === 'listening') { if (this.mirror) { name = this.mirror.expr; amt = this.mirror.amt; } else { name = 'curious'; amt = 0.45; } }
      else if (this.mirror) { name = this.mirror.expr; amt = this.mirror.amt; }
      const ex = EXPR[name] || {};
      for (const k of Object.keys(ex)) tgt[k] = lerp(BASE[k], ex[k], amt);

      /* 2. mouth from speech */
      if (this.speech) {
        const ch = sp.text[Math.floor(charPos)];
        const v = visemeFor(ch);
        const wob = 0.82 + 0.18 * Math.sin(t * 19);
        tgt.open = Math.max(tgt.open, v.o * wob);
        tgt.mw *= v.w;
      }
      if (name === 'laugh') tgt.open = Math.max(tgt.open * (0.6 + 0.4 * Math.abs(Math.sin(t * 9))), 0.1);

      /* 3. idle life */
      const breath = Math.sin(t * 1.5);
      tgt.headY += Math.sin(t * 0.45) * 0.05; tgt.headX += Math.sin(t * 0.33) * 0.02; tgt.headZ += Math.sin(t * 0.27) * 0.02;
      if (this.speech) { tgt.headX += Math.sin(t * 2.3) * 0.03; tgt.headY += Math.sin(t * 1.7) * 0.05; }
      if (this.mode === 'listening' && !this.speech) tgt.headX += Math.max(0, Math.sin(t * 1.2)) * 0.06;
      if (t > this.blink.next) { this.blink.t = 0; this.blink.next = t + 2 + Math.random() * 3.5; }
      let blinkK = 1;
      if (this.blink.t >= 0) { this.blink.t += dt; const p = this.blink.t / 0.16; blinkK = p < 1 ? 1 - Math.sin(p * Math.PI) : 1; if (p >= 1) this.blink.t = -1; }
      const g = this.gaze;
      if (t > g.next) { g.nx = (Math.random() - 0.5) * 0.35; g.ny = (Math.random() - 0.5) * 0.2; g.next = t + 1 + Math.random() * 2.2; }
      g.x = lerp(g.x, g.nx, 1 - Math.exp(-dt * 8)); g.y = lerp(g.y, g.ny, 1 - Math.exp(-dt * 8));
      tgt.lookX += g.x; tgt.lookY += g.y;
      /* talking hands every few seconds even without a text cue */
      if (this.speech && t > this.nextBeat && !this.busy) { this.gesture('explain'); this.nextBeat = t + 3.5 + Math.random() * 3; }

      /* 4. smooth */
      const c = this.cur;
      for (const k of Object.keys(tgt)) { const r = k === 'open' ? RATE.open : RATE.default; c[k] = lerp(c[k], tgt[k], 1 - Math.exp(-dt * r)); }

      /* 5. gestures on top (arms rest, then blended overrides) */
      const out = Object.assign({}, c);
      const armTgt = { aR_sx: 0, aR_sz: 0.1, aR_elx: -0.12, aR_elz: 0, aL_sx: 0, aL_sz: 0.1, aL_elx: -0.12, aL_elz: 0 };
      armTgt.aR_sx += Math.sin(t * 1.5) * 0.015; armTgt.aL_sx += Math.sin(t * 1.5 + 1) * 0.015;
      const over = {}; let wTot = 0;
      this.gests = this.gests.filter((gs) => t - gs.t0 < gs.dur);
      for (const gs of this.gests) {
        const p = (t - gs.t0) / gs.dur, w = env(p), part = gs.f(p, t - gs.t0);
        for (const k of Object.keys(part)) {
          if (k.startsWith('a')) { over[k] = over[k] || { v: 0, w: 0 }; over[k].v += part[k] * w; over[k].w += w; }
          else out[k] = lerp(out[k], (k === 'headX' || k === 'headY' || k === 'headZ') ? out[k] + part[k] * 1 : part[k], w);
        }
        wTot += w;
      }
      for (const k of Object.keys(armTgt)) {
        let v = armTgt[k];
        if (over[k] && over[k].w > 0) { const w = Math.min(1, over[k].w); v = lerp(v, over[k].v / over[k].w, w); }
        this.arms[k] = lerp(this.arms[k], v, 1 - Math.exp(-dt * (over[k] ? 14 : 5)));
        out[k] = this.arms[k];
      }
      out.blinkK = blinkK; out.breath = breath;
      this.out = out;
      this.apply(out);
    }

    apply(o) {
      const P = this.P, robot = !!P.def.robot;
      P.body.pos[1] = o.breath * 0.007;
      P.body.rot[1] = o.lookX * 0.1 + o.headY * 0.25;
      P.neck.rot[0] = o.headX; P.neck.rot[1] = o.headY; P.neck.rot[2] = o.headZ;
      /* eyes */
      for (const g of P.eyes) {
        const open = clamp(o.eye * o.blinkK, 0.05, 1.4);
        g.scl[1] = open; g.scl[0] = 1 + (o.eye - 1) * 0.25;
        if (!robot) {
          const pu = g.children[1];
          pu.pos[0] = o.lookX * 0.035; pu.pos[1] = o.lookY * 0.035 / Math.max(open, 0.3);
        }
      }
      /* brows */
      for (const b of P.brows) {
        const s = b.side, asym = s > 0 ? o.browAsym : -o.browAsym * 0.2;
        b.pos[1] = b.baseY + (o.browY + asym) * 0.045 - Math.max(0, 1 - o.blinkK) * 0.004;
        b.rot[2] = s * o.browTilt * 0.5;
        b.pos[2] = b.baseZ + 0.002;
      }
      /* mouth */
      const hw = (robot ? 0.13 : (P.mouthHW || 0.1)) * o.mw, my = P.mouthY, curve = clamp(o.curve, -1, 1), open = clamp(o.open, 0, 1);
      for (let i = 0; i < P.beads.length; i++) {
        const u = i / 4 - 1, x = u * hw, y = my + curve * 0.05 * u * u - curve * 0.012;
        const b = P.beads[i]; b.pos[0] = x; b.pos[1] = y; b.pos[2] = P.surfZ(x, y) + 0.004;
        b.scl[0] = 0.024; b.scl[1] = robot ? 0.016 : 0.018;
      }
      const ry = 0.004 + open * 0.05, rx = hw * 0.92 * (1 - 0.15 * open);
      const mo = P.mouthOpen, vis = open > 0.03;
      mo.visible = vis;
      mo.scl[0] = rx; mo.scl[1] = ry; mo.pos[0] = 0; mo.pos[1] = my - curve * 0.012 - ry * 0.85; mo.pos[2] = P.surfZ(0, mo.pos[1]) - 0.012;
      if (P.def.headShape === 'box') { mo.scl[2] = 0.02; mo.pos[2] = P.surfZ(0, 0) - 0.002; }
      P.tongue.visible = vis && open > 0.35 && !robot;
      P.tongue.scl[0] = rx * 0.5; P.tongue.scl[1] = ry * 0.4; P.tongue.pos[1] = mo.pos[1] - ry * 0.55; P.tongue.pos[2] = P.surfZ(0, mo.pos[1]) - 0.006;
      if (P.beard) { P.beard.rot[2] = o.open * 0.04; P.beard.scl[1] = 0.7 + o.open * 0.05; }
      if (P.antenna) P.antenna.emis = 0.5 + 0.5 * Math.sin(this.t * 3);
      if (P.chestLight) P.chestLight.emis = 0.6 + 0.4 * Math.sin(this.t * 2);
      /* arms */
      for (const [a, k] of [[P.armR, 'aR'], [P.armL, 'aL']]) {
        a.sh.rot[0] = o[k + '_sx']; a.sh.rot[2] = o[k + '_sz'] * a.side;
        a.el.rot[0] = o[k + '_elx']; a.el.rot[2] = o[k + '_elz'] * a.side;
      }
    }
  }

  root.Rig = { Avatar, EXPR, GEST };
})(window);
