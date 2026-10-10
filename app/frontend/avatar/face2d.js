/* 2D fallback: used automatically if WebGL isn't available. Draws the same character from the same animation values. */
'use strict';
(function (root) {
  const css = (c) => (typeof c === 'string' ? c : `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`);

  class Face2D {
    constructor(canvas, def) { this.canvas = canvas; this.def = def; this.ctx = canvas.getContext('2d'); }
    setDef(def) { this.def = def; }
    render(o) {
      const c = this.canvas, dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(2, Math.round(c.clientWidth * dpr)), h = Math.max(2, Math.round(c.clientHeight * dpr));
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      const x = this.ctx, d = this.def, robot = !!d.robot;
      x.clearRect(0, 0, w, h);
      const R = Math.min(h * 0.2, w * 0.2), cx = w / 2, cy = h * 0.4;
      /* body */
      x.fillStyle = d.outfit; x.beginPath();
      x.moveTo(cx - R * 1.7, h); x.lineTo(cx - R * 1.45, cy + R * 1.5); x.quadraticCurveTo(cx, cy + R * 1.15, cx + R * 1.45, cy + R * 1.5); x.lineTo(cx + R * 1.7, h); x.closePath(); x.fill();
      /* arms (waving arm rises with aR_sz) */
      x.lineCap = 'round'; x.lineWidth = R * 0.34;
      for (const [k, side] of [['aR', 1], ['aL', -1]]) {
        const sz = o[k + '_sz'] || 0.1, sx0 = cx + side * R * 1.45, sy0 = cy + R * 1.7;
        const a = sz * side, L = R * 1.5;
        const ex = sx0 + Math.sin(a) * L, ey = sy0 - Math.cos(a) * L * -1;
        const e2x = ex + Math.sin(a + (o[k + '_elz'] || 0) * side) * L * 0.9, e2y = ey - Math.cos(a + (o[k + '_elz'] || 0) * side) * L * 0.9 * -1;
        x.strokeStyle = d.outfit; x.beginPath(); x.moveTo(sx0, sy0); x.lineTo(ex, ey); x.stroke();
        x.strokeStyle = robot ? '#aeb6c8' : d.skin; x.beginPath(); x.moveTo(ex, ey); x.lineTo(e2x, e2y); x.stroke();
      }
      /* head, tilted a little */
      x.save(); x.translate(cx + o.headY * R * 0.5, cy); x.rotate(o.headZ + o.headY * 0.1);
      x.fillStyle = d.skin;
      if (robot) { x.fillRect(-R * 1.05, -R * 0.95, R * 2.1, R * 1.9); x.fillStyle = '#161c2c'; x.fillRect(-R * 0.85, -R * 0.55, R * 1.7, R * 1.1); }
      else { x.beginPath(); x.ellipse(0, 0, R, R * 1.08, 0, 0, Math.PI * 2); x.fill(); }
      if (d.hair && !robot && d.hairStyle !== 'none') { x.fillStyle = d.hair; x.beginPath(); x.ellipse(0, -R * 0.45, R * 1.04, R * 0.72, 0, Math.PI, 0); x.fill(); }
      if (d.id === 'wizard') { x.fillStyle = '#3f3394'; x.beginPath(); x.moveTo(-R * 1.2, -R * 0.75); x.lineTo(0, -R * 2.3); x.lineTo(R * 1.2, -R * 0.75); x.closePath(); x.fill();
        x.fillStyle = '#ecedf5'; x.beginPath(); x.moveTo(-R * 0.7, R * 0.5); x.quadraticCurveTo(0, R * 2.1, R * 0.7, R * 0.5); x.fill(); }
      if (d.id === 'detective') { x.fillStyle = '#8a7a5c'; x.beginPath(); x.ellipse(0, -R * 0.75, R * 1.05, R * 0.45, 0, Math.PI, 0); x.fill(); x.fillRect(-R * 0.6, -R * 0.78, R * 1.4, R * 0.12); }
      if (d.id === 'knight') { x.fillStyle = '#aab4c4'; x.beginPath(); x.ellipse(0, -R * 0.3, R * 1.08, R * 0.95, 0, Math.PI, 0); x.fill(); }
      /* eyes */
      const ey = -R * 0.05, ex = R * 0.38, eo = Math.max(0.06, (o.eye || 1) * (o.blinkK == null ? 1 : o.blinkK));
      for (const s of [-1, 1]) {
        x.fillStyle = robot ? '#5ff3ff' : '#fff'; x.beginPath(); x.ellipse(s * ex, ey, R * 0.18, R * 0.2 * Math.min(eo, 1.3), 0, 0, Math.PI * 2); x.fill();
        if (!robot) { x.fillStyle = d.iris; x.beginPath(); x.arc(s * ex + (o.lookX || 0) * R * 0.07, ey + (o.lookY || 0) * -R * 0.07, R * 0.09, 0, Math.PI * 2); x.fill(); }
        /* brows */
        x.strokeStyle = robot ? '#5ff3ff' : (d.hair || '#3a2a20'); x.lineWidth = R * 0.06; x.lineCap = 'round';
        const by = ey - R * 0.34 - (o.browY || 0) * R * 0.1 - (s > 0 ? (o.browAsym || 0) * R * 0.06 : 0), t = (o.browTilt || 0) * R * 0.12;
        x.beginPath(); x.moveTo(s * ex - R * 0.2, by + s * t); x.lineTo(s * ex + R * 0.2, by - s * t); x.stroke();
      }
      /* mouth */
      const my = R * 0.5, hw = R * 0.42 * (o.mw || 1), curve = o.curve || 0, open = o.open || 0;
      if (open > 0.04) { x.fillStyle = robot ? '#5ff3ff' : '#3a0f14'; x.beginPath(); x.ellipse(0, my + open * R * 0.1, hw * 0.85, R * (0.03 + open * 0.2), 0, 0, Math.PI * 2); x.fill(); }
      x.strokeStyle = robot ? '#5ff3ff' : d.lip; x.lineWidth = R * 0.07; x.beginPath();
      x.moveTo(-hw, my - curve * R * 0.12); x.quadraticCurveTo(0, my + curve * R * 0.3, hw, my - curve * R * 0.12); x.stroke();
      x.restore();
    }
  }
  root.Face2D = Face2D;
})(window);
