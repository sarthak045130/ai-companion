/* Camera understanding, all on this computer; frames are never uploaded or saved.
   Level 1 (always works): wave detection from motion in the picture.
   Level 2 (optional): real face-expression and hand-gesture reading with MediaPipe, if its files are in ./vendor/mediapipe
   (run scripts/fetch_vision_models.sh once to download them). */
'use strict';
(function (root) {
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  /* count direction reversals in a series, ignoring wiggles smaller than `amp` */
  function reversals(xs, amp) {
    let n = 0, dir = 0, ext = xs[0];
    for (let i = 1; i < xs.length; i++) {
      const x = xs[i];
      if (dir === 0) { if (x - ext > amp) { dir = 1; ext = x; } else if (ext - x > amp) { dir = -1; ext = x; } }
      else if (dir === 1) { if (x > ext) ext = x; else if (ext - x > amp) { n++; dir = -1; ext = x; } }
      else { if (x < ext) ext = x; else if (x - ext > amp) { n++; dir = 1; ext = x; } }
    }
    return n;
  }

  /* Motion-based wave detector. push() gets a small grayscale frame (Uint8ClampedArray, w*h). */
  class WaveDetector {
    constructor(opts) {
      this.o = Object.assign({ w: 64, h: 48, diff: 26, minArea: 0.012, maxArea: 0.3, window: 2.0, amp: 0.05, minRev: 3, cooldown: 5 }, opts || {});
      this.prev = null; this.hist = []; this.last = -1e9;
    }
    push(gray, t) {
      const { w, h, diff } = this.o;
      let hit = false;
      if (this.prev) {
        let n = 0, sx = 0, sy = 0, x0 = w, x1 = 0, y0 = h, y1 = 0;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (Math.abs(gray[i] - this.prev[i]) > diff) { n++; sx += x; sy += y; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        }
        const f = n / (w * h);
        this.hist.push({ t, f, cx: n ? sx / n / w : NaN, cy: n ? sy / n / h : NaN, sp: n ? (x1 - x0) / w : 0, spy: n ? (y1 - y0) / h : 0 });
        while (this.hist.length && t - this.hist[0].t > this.o.window) this.hist.shift();
        hit = this._check(t);
      }
      this.prev = Uint8ClampedArray.from(gray);
      return hit;
    }
    _check(t) {
      const H = this.hist;
      if (H.length < 8 || t - this.last < this.o.cooldown) return false;
      const ok = H.filter((s) => s.f >= this.o.minArea && s.f <= this.o.maxArea && !Number.isNaN(s.cx));
      if (ok.length < H.length * 0.6) return false;
      if (ok.some((s) => s.f > this.o.maxArea)) return false;
      const cxs = ok.map((s) => s.cx), cys = ok.map((s) => s.cy);
      const meanY = cys.reduce((a, b) => a + b, 0) / cys.length;
      if (meanY > 0.8) return false;
      const spreads = ok.map((s) => s.sp).sort((a, b) => a - b);
      if (spreads[Math.floor(spreads.length / 2)] > 0.5) return false;          // whole-body movement, not a hand
      const verticalSpreads = ok.map((s) => s.spy).sort((a, b) => a - b);
      if (verticalSpreads[Math.floor(verticalSpreads.length / 2)] > 0.32) return false; // reject face/head motion spanning much of the frame
      const rx = Math.max(...cxs) - Math.min(...cxs), ry = Math.max(...cys) - Math.min(...cys);
      if (rx < 0.1 || ry > rx * 1.3) return false;                            // must sweep sideways, not nod or twitch
      if (reversals(cxs, this.o.amp) >= this.o.minRev) { this.last = t; this.hist = []; return true; }
      return false;
    }
  }

  /* ---- MediaPipe helpers (pure functions, easy to test) ---- */
  function expressionFromBlendshapes(b) {
    const g = (k) => b[k] || 0, avg = (a, c) => (g(a) + g(c)) / 2;
    const smile = avg('mouthSmileLeft', 'mouthSmileRight'), frown = avg('mouthFrownLeft', 'mouthFrownRight');
    const browDown = avg('browDownLeft', 'browDownRight'), browUp = Math.max(g('browInnerUp'), avg('browOuterUpLeft', 'browOuterUpRight'));
    const wide = avg('eyeWideLeft', 'eyeWideRight'), jaw = g('jawOpen'), sneer = avg('noseSneerLeft', 'noseSneerRight');
    const press = avg('mouthPressLeft', 'mouthPressRight');
    if (jaw > 0.3 && (browUp > 0.35 || wide > 0.3)) return 'surprised';
    if (smile > 0.4) return 'happy';
    if (browDown > 0.45 && (sneer > 0.12 || frown > 0.12 || press > 0.25)) return 'angry';
    if (frown > 0.25 || (frown > 0.12 && g('browInnerUp') > 0.3)) return 'sad';
    return 'neutral';
  }
  const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  function classifyHand(lm) {                      // lm = 21 landmarks {x,y}
    const W = lm[0];
    const ext = (tip, pip) => d2(lm[tip], W) > d2(lm[pip], W) * 1.12;
    const idx = ext(8, 6), mid = ext(12, 10), rng = ext(16, 14), pnk = ext(20, 18);
    const thumb = d2(lm[4], lm[17]) > d2(lm[3], lm[17]) * 1.05 && d2(lm[4], lm[5]) > d2(lm[3], lm[5]);
    const n = [idx, mid, rng, pnk].filter(Boolean).length;
    if (n === 4) return 'open';
    if (thumb && n === 0 && lm[4].y < lm[0].y - 0.08 && lm[4].y < lm[3].y) return 'thumbsup';
    if (idx && mid && !rng && !pnk) return 'peace';
    if (n === 0) return 'fist';
    return 'other';
  }

  class Perception {
    constructor(cb) {
      this.cb = cb || {}; this.video = null; this.stream = null; this.timer = null;
      this.wave = new WaveDetector(); this.level = 1;
      this.canvas = document.createElement('canvas'); this.canvas.width = 64; this.canvas.height = 48;
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
      this.mp = null; this.faceVotes = []; this.wristHist = []; this.lastExpr = 'neutral'; this.lastHandAt = 0; this.busy = false;
    }
    async start(videoEl) {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('This window can’t use the camera (try ./scripts/run.sh --no-window to use your browser).');
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false });
      this.video = videoEl; videoEl.srcObject = this.stream; videoEl.muted = true; videoEl.playsInline = true;
      await videoEl.play();
      this.motionWarmupUntil = performance.now() / 1000 + 2;
      this._loadMediaPipe().then((ok) => { if (ok) { this.level = 2; this.cb.onLevel && this.cb.onLevel(2); } }).catch(() => {});
      this.cb.onLevel && this.cb.onLevel(1);
      this.timer = setInterval(() => this._tick(), 100);
    }
    stop() {
      clearInterval(this.timer); this.timer = null;
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
      if (this.video) this.video.srcObject = null;
      if (this.mp) { try { this.mp.face.close(); this.mp.hand.close(); } catch (e) { /* ignore */ } }
      this.mp = null;
    }
    async _loadMediaPipe() {
      const base = '/avatar/vendor/mediapipe/';
      const ready = await fetch(base + 'READY', { cache: 'no-store' }).catch(() => null);   // written by scripts/fetch_vision_models.sh
      if (!ready || !ready.ok) return false;
      const mod = await import(base + 'vision_bundle.mjs');
      const fileset = await mod.FilesetResolver.forVisionTasks(base + 'wasm');
      const mk = async (Cls, file, extra) => {
        try { return await Cls.createFromOptions(fileset, Object.assign({ baseOptions: { modelAssetPath: base + file, delegate: 'GPU' }, runningMode: 'VIDEO' }, extra)); }
        catch (e) { return await Cls.createFromOptions(fileset, Object.assign({ baseOptions: { modelAssetPath: base + file, delegate: 'CPU' }, runningMode: 'VIDEO' }, extra)); }
      };
      const face = await mk(mod.FaceLandmarker, 'face_landmarker.task', { outputFaceBlendshapes: true, numFaces: 1 });
      const hand = await mk(mod.HandLandmarker, 'hand_landmarker.task', { numHands: 1 });
      this.mp = { face, hand };
      return true;
    }
    _tick() {
      const v = this.video; if (!v || v.readyState < 2 || this.busy) return;
      this.busy = true;
      try {
        const now = performance.now() / 1000;
        if (this.mp) this._mediapipe(v, now);
        else this._motion(v, now);
      } catch (e) { /* keep running */ }
      this.busy = false;
    }
    _motion(v, now) {
      const c = this.ctx; c.drawImage(v, 0, 0, 64, 48);
      const px = c.getImageData(0, 0, 64, 48).data, gray = new Uint8ClampedArray(64 * 48);
      for (let i = 0; i < gray.length; i++) gray[i] = (px[i * 4] * 0.3 + px[i * 4 + 1] * 0.59 + px[i * 4 + 2] * 0.11);
      if (this.motionWarmupUntil && now < this.motionWarmupUntil) { this.wave.prev = Uint8ClampedArray.from(gray); return; }
      if (this.wave.push(gray, now)) this.cb.onWave && this.cb.onWave('motion');
    }
    _mediapipe(v, now) {
      const ts = performance.now();
      const fr = this.mp.face.detectForVideo(v, ts);
      if (fr && fr.faceBlendshapes && fr.faceBlendshapes[0]) {
        const m = {}; for (const c of fr.faceBlendshapes[0].categories) m[c.categoryName] = c.score;
        this.faceVotes.push(expressionFromBlendshapes(m)); if (this.faceVotes.length > 5) this.faceVotes.shift();
        const counts = {}; for (const e of this.faceVotes) counts[e] = (counts[e] || 0) + 1;
        const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
        if (counts[top] >= 3 && top !== this.lastExpr) { this.lastExpr = top; this.cb.onExpression && this.cb.onExpression(top); }
      } else if (this.lastExpr !== 'none' && this.faceVotes.length) { this.faceVotes = []; this.lastExpr = 'none'; this.cb.onExpression && this.cb.onExpression('none'); }
      const hr = this.mp.hand.detectForVideo(v, ts + 1);
      if (hr && hr.landmarks && hr.landmarks[0]) {
        const lm = hr.landmarks[0], g = classifyHand(lm);
        this.wristHist.push({ t: now, x: lm[0].x, open: g === 'open' });
        while (this.wristHist.length && now - this.wristHist[0].t > 1.8) this.wristHist.shift();
        const H = this.wristHist;
        if (H.length > 8 && H.filter((s) => s.open).length > H.length * 0.6 && now - this.lastHandAt > 5 && reversals(H.map((s) => s.x), 0.035) >= 3) {
          this.lastHandAt = now; this.wristHist = []; this.cb.onWave && this.cb.onWave('hand');
        } else if ((g === 'thumbsup' || g === 'peace') && now - this.lastHandAt > 4) {
          this.lastHandAt = now; this.cb.onGesture && this.cb.onGesture(g);
        }
      } else if (this.wristHist.length) this.wristHist.shift();
    }
  }

  root.Perception = { Perception, WaveDetector, reversals, expressionFromBlendshapes, classifyHand };
  if (typeof module !== 'undefined') module.exports = root.Perception;
})(typeof window !== 'undefined' ? window : globalThis);
