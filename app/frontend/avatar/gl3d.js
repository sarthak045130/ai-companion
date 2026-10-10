/* Tiny dependency-free WebGL renderer for stylised 3D characters (no libraries, works offline). */
'use strict';
(function (root) {
  const M = {
    ident() { return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); },
    mul(a, b) {
      const o = new Float32Array(16);
      for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
        let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
        o[c * 4 + r] = s;
      }
      return o;
    },
    persp(fov, asp, n, f) {
      const t = 1 / Math.tan(fov / 2), o = new Float32Array(16);
      o[0] = t / asp; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = 2 * f * n / (n - f);
      return o;
    },
    lookAt(e, c, up) {
      let zx = e[0] - c[0], zy = e[1] - c[1], zz = e[2] - c[2];
      let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
      let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
      l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
      const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
      return new Float32Array([
        xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
        -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1,
      ]);
    },
    /* translate * Rz*Ry*Rx * scale */
    trs(p, r, s) {
      const cx = Math.cos(r[0]), sx = Math.sin(r[0]), cy = Math.cos(r[1]), sy = Math.sin(r[1]), cz = Math.cos(r[2]), sz = Math.sin(r[2]);
      const r00 = cz * cy, r01 = cz * sy * sx - sz * cx, r02 = cz * sy * cx + sz * sx;
      const r10 = sz * cy, r11 = sz * sy * sx + cz * cx, r12 = sz * sy * cx - cz * sx;
      const r20 = -sy, r21 = cy * sx, r22 = cy * cx;
      return new Float32Array([
        r00 * s[0], r10 * s[0], r20 * s[0], 0,
        r01 * s[1], r11 * s[1], r21 * s[1], 0,
        r02 * s[2], r12 * s[2], r22 * s[2], 0,
        p[0], p[1], p[2], 1,
      ]);
    },
    normalMat(m) {
      const a00 = m[0], a10 = m[1], a20 = m[2], a01 = m[4], a11 = m[5], a21 = m[6], a02 = m[8], a12 = m[9], a22 = m[10];
      const c00 = a11 * a22 - a12 * a21, c01 = -(a10 * a22 - a12 * a20), c02 = a10 * a21 - a11 * a20;
      const c10 = -(a01 * a22 - a02 * a21), c11 = a00 * a22 - a02 * a20, c12 = -(a00 * a21 - a01 * a20);
      const c20 = a01 * a12 - a02 * a11, c21 = -(a00 * a12 - a02 * a10), c22 = a00 * a11 - a01 * a10;
      const det = (a00 * c00 + a01 * c01 + a02 * c02) || 1;
      return new Float32Array([c00, c10, c20, c01, c11, c21, c02, c12, c22].map((v) => v / det));
    },
  };

  /* ---------- geometry ---------- */
  function sphereGeo(lat, lon) {
    const pos = [], idx = [];
    for (let i = 0; i <= lat; i++) {
      const th = (i / lat) * Math.PI, st = Math.sin(th), ct = Math.cos(th);
      for (let j = 0; j <= lon; j++) {
        const ph = (j / lon) * Math.PI * 2;
        const x = st * Math.cos(ph), y = ct, z = st * Math.sin(ph);
        pos.push(x, y, z, x, y, z);
      }
    }
    for (let i = 0; i < lat; i++) for (let j = 0; j < lon; j++) {
      const a = i * (lon + 1) + j, b = a + lon + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    return { v: pos, i: idx };
  }
  /* cylinder / cone along Y, height 1 centred on origin, radius rt at top and rb at bottom */
  function cylGeo(seg, rt, rb) {
    const pos = [], idx = [], slope = (rb - rt);
    for (let k = 0; k <= 1; k++) {
      const y = k ? -0.5 : 0.5, r = k ? rb : rt;
      for (let j = 0; j <= seg; j++) {
        const ph = (j / seg) * Math.PI * 2, c = Math.cos(ph), s = Math.sin(ph);
        const l = Math.hypot(1, slope);
        pos.push(c * r, y, s * r, c / l, slope / l, s / l);
      }
    }
    for (let j = 0; j < seg; j++) { const a = j, b = j + seg + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    for (let k = 0; k <= 1; k++) { // caps
      const y = k ? -0.5 : 0.5, r = k ? rb : rt, base = pos.length / 6;
      pos.push(0, y, 0, 0, k ? -1 : 1, 0);
      for (let j = 0; j <= seg; j++) { const ph = (j / seg) * Math.PI * 2; pos.push(Math.cos(ph) * r, y, Math.sin(ph) * r, 0, k ? -1 : 1, 0); }
      for (let j = 0; j < seg; j++) idx.push(...(k ? [base, base + 1 + j + 1, base + 1 + j] : [base, base + 1 + j, base + 1 + j + 1]));
    }
    return { v: pos, i: idx };
  }
  function boxGeo() {
    const pos = [], idx = [];
    const faces = [[0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]];
    for (const n of faces) {
      const ax = n[0] ? 0 : n[1] ? 1 : 2, u = (ax + 1) % 3, w = (ax + 2) % 3, base = pos.length / 6;
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const p = [0, 0, 0]; p[ax] = 0.5 * n[ax]; p[u] = 0.5 * a; p[w] = 0.5 * b;
        pos.push(p[0], p[1], p[2], n[0], n[1], n[2]);
      }
      const flip = (n[0] + n[1] + n[2]) > 0 ? ((ax === 1) ? 0 : 1) : ((ax === 1) ? 1 : 0);
      idx.push(...(flip ? [base, base + 1, base + 2, base, base + 2, base + 3] : [base, base + 2, base + 1, base, base + 3, base + 2]));
    }
    return { v: pos, i: idx };
  }

  const VS = `attribute vec3 aPos; attribute vec3 aNorm;
uniform mat4 uModel; uniform mat4 uVP; uniform mat3 uNormal;
varying vec3 vN; varying vec3 vP;
void main(){ vec4 w = uModel * vec4(aPos,1.0); vP = w.xyz; vN = uNormal * aNorm; gl_Position = uVP * w; }`;
  const FS = `precision mediump float;
varying vec3 vN; varying vec3 vP;
uniform vec3 uColor; uniform float uEmis; uniform float uSpec; uniform vec3 uCam;
void main(){
  vec3 n = normalize(vN);
  vec3 key = normalize(vec3(0.45, 0.8, 0.7));
  vec3 fill = normalize(vec3(-0.7, 0.2, 0.5));
  vec3 v = normalize(uCam - vP);
  float d = max(dot(n, key), 0.0);
  float toon = floor(d * 3.0) / 3.0;
  float shade = mix(d, toon, 0.45);
  float f = max(dot(n, fill), 0.0) * 0.3;
  vec3 col = uColor * (0.42 + 0.72 * shade + f);
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  col += rim * 0.16 * vec3(0.7, 0.8, 1.0);
  float sp = pow(max(dot(n, normalize(key + v)), 0.0), 36.0) * uSpec;
  col += sp;
  col = mix(col, uColor, uEmis);
  gl_FragColor = vec4(col, 1.0);
}`;

  function hex(c) {
    if (Array.isArray(c)) return c;
    const n = parseInt(c.replace('#', ''), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  class Node {
    constructor(o) {
      o = o || {};
      this.name = o.name || '';
      this.pos = o.pos ? o.pos.slice() : [0, 0, 0];
      this.rot = o.rot ? o.rot.slice() : [0, 0, 0];
      this.scl = o.scl ? o.scl.slice() : [1, 1, 1];
      this.mesh = o.mesh || null;           // 'sphere' | 'cyl' | 'cone' | 'box' | null
      this.color = hex(o.color || '#ffffff');
      this.emis = o.emis || 0;
      this.spec = o.spec || 0;
      this.visible = o.visible !== false;
      this.children = [];
      this.parent = null;
      this.world = M.ident();
    }
    add(...kids) { for (const k of kids) { k.parent = this; this.children.push(k); } return this; }
    setColor(c) { this.color = hex(c); return this; }
  }

  class Renderer {
    constructor(canvas) {
      const gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: false });
      if (!gl) throw new Error('WebGL is not available');
      this.canvas = canvas; this.gl = gl;
      const mk = (type, src) => {
        const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
      };
      const p = gl.createProgram();
      gl.attachShader(p, mk(gl.VERTEX_SHADER, VS)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      gl.useProgram(p);
      this.prog = p;
      this.loc = {};
      for (const n of ['uModel', 'uVP', 'uNormal', 'uColor', 'uEmis', 'uSpec', 'uCam']) this.loc[n] = gl.getUniformLocation(p, n);
      this.aPos = gl.getAttribLocation(p, 'aPos'); this.aNorm = gl.getAttribLocation(p, 'aNorm');
      gl.enableVertexAttribArray(this.aPos); gl.enableVertexAttribArray(this.aNorm);
      gl.enable(gl.DEPTH_TEST); /* no face culling: robust to winding, meshes are closed */
      this.meshes = {};
      const up = (name, g) => {
        const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(g.v), gl.STATIC_DRAW);
        const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(g.i), gl.STATIC_DRAW);
        this.meshes[name] = { vb, ib, n: g.i.length };
      };
      up('sphere', sphereGeo(16, 24)); up('cyl', cylGeo(24, 0.5, 0.5)); up('cone', cylGeo(24, 0.0, 0.5)); up('box', boxGeo());
      up('frustum', cylGeo(24, 0.5, 0.36)); up('flare', cylGeo(24, 0.3, 0.5));
      this.cam = { pos: [0, 1.0, 4.6], target: [0, 0.98, 0], fov: 32 * Math.PI / 180 };
    }
    resize() {
      const c = this.canvas, dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(2, Math.round(c.clientWidth * dpr)), h = Math.max(2, Math.round(c.clientHeight * dpr));
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    }
    updateWorld(n, parent) {
      n.world = M.mul(parent, M.trs(n.pos, n.rot, n.scl));
      for (const k of n.children) this.updateWorld(k, n.world);
    }
    draw(n, vp) {
      if (!n.visible) return;
      const gl = this.gl;
      if (n.mesh) {
        const m = this.meshes[n.mesh];
        gl.bindBuffer(gl.ARRAY_BUFFER, m.vb); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ib);
        gl.vertexAttribPointer(this.aPos, 3, gl.FLOAT, false, 24, 0);
        gl.vertexAttribPointer(this.aNorm, 3, gl.FLOAT, false, 24, 12);
        gl.uniformMatrix4fv(this.loc.uModel, false, n.world);
        gl.uniformMatrix3fv(this.loc.uNormal, false, M.normalMat(n.world));
        gl.uniform3fv(this.loc.uColor, n.color);
        gl.uniform1f(this.loc.uEmis, n.emis);
        gl.uniform1f(this.loc.uSpec, n.spec);
        gl.drawElements(gl.TRIANGLES, m.n, gl.UNSIGNED_SHORT, 0);
      }
      for (const k of n.children) this.draw(k, vp);
    }
    render(sceneRoot, keepSize) {
      if (!keepSize) this.resize();
      const gl = this.gl, c = this.canvas;
      gl.viewport(0, 0, c.width, c.height);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const cam = this.cam;
      const vp = M.mul(M.persp(cam.fov, c.width / c.height, 0.1, 50), M.lookAt(cam.pos, cam.target, [0, 1, 0]));
      gl.uniformMatrix4fv(this.loc.uVP, false, vp);
      gl.uniform3fv(this.loc.uCam, cam.pos);
      this.updateWorld(sceneRoot, M.ident());
      this.draw(sceneRoot, vp);
    }
  }

  root.GL3D = { Renderer, Node, M, hex };
})(window);
