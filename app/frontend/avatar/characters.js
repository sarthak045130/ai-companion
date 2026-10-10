/* Character builder. Every character is made from simple shapes, so they run anywhere with no model files.
   To add your own: copy one entry in DEFS and change colours / accessories. */
'use strict';
(function (root) {
  const { Node } = GL3D;
  const N = (o) => new Node(o);

  /* id, label, blurb and a 2D-fallback colour set, then a build() that adds accessories */
  const DEFS = [
    {
      id: 'nova', label: 'Nova', blurb: 'Warm and easygoing, in a hoodie',
      anime: true, skin: '#f6d3bd', outfit: '#4a5de0', accent: '#f2bb4f', lip: '#d97a7a', iris: '#7a5cff', bg: ['#1c2547', '#0d1020'],
      hair: '#2a2140', hairStyle: 'long', torso: 'frustum',
      extras(P) {
        P.body.add(N({ mesh: 'sphere', pos: [0, 1.05, -0.12], scl: [0.46, 0.22, 0.3], color: '#3a49b8' })); // hood
        P.body.add(N({ mesh: 'sphere', pos: [0, 0.6, 0.265], scl: [0.34, 0.03, 0.02], color: '#f2bb4f', emis: 0.3 }));
      },
    },
    {
      id: 'mio', label: 'Mio', blurb: 'Bubbly and playful, school uniform',
      anime: true, skin: '#f8d8c4', outfit: '#243a6b', accent: '#d8434f', lip: '#e0707a', iris: '#ff6fa8', bg: ['#4a2250', '#120a1a'],
      hair: '#f08fb8', hairStyle: 'twintail', torso: 'frustum',
      extras(P) {
        P.body.add(N({ mesh: 'sphere', pos: [0, 0.93, 0.04], scl: [0.46, 0.08, 0.3], color: '#f4f6fb' }));   // sailor collar
        P.body.add(N({ mesh: 'box', pos: [0, 0.66, 0.27], rot: [0, 0, 0.0], scl: [0.16, 0.34, 0.02], color: '#f4f6fb' }));
        P.body.add(N({ mesh: 'sphere', pos: [0, 0.8, 0.285], scl: [0.09, 0.06, 0.03], color: '#d8434f' }));   // ribbon
      },
    },
    {
      id: 'aiko', label: 'Aiko', blurb: 'Calm and thoughtful, cosy sweater',
      anime: true, skin: '#f3cdb0', outfit: '#e6d8bf', accent: '#a97c50', lip: '#cf6f6a', iris: '#3f7f6a', bg: ['#3a2c22', '#120d0a'],
      hair: '#1b1722', hairStyle: 'bob', torso: 'frustum',
      extras(P) {
        P.body.add(N({ mesh: 'cyl', pos: [0, 1.0, 0], scl: [0.34, 0.12, 0.3], color: '#d8c7a8' }));   // turtleneck
        P.body.add(N({ mesh: 'sphere', pos: [0, 0.75, 0.27], scl: [0.34, 0.02, 0.02], color: '#cdbb9a' }));
      },
    },
    {
      id: 'luna', label: 'Luna', blurb: 'Dreamy and gentle, silver hair',
      anime: true, skin: '#fbe3d3', outfit: '#8a78d6', accent: '#e8e3ff', lip: '#d98a9a', iris: '#59b8ff', bg: ['#2a2560', '#0a0a1c'],
      hair: '#e6e8f7', hairStyle: 'long', torso: 'frustum',
      extras(P) {
        P.body.add(N({ mesh: 'sphere', pos: [0, 0.9, 0.22], scl: [0.3, 0.1, 0.12], color: '#e8e3ff' }));     // collar
        P.body.add(N({ mesh: 'sphere', pos: [0, 0.82, 0.3], scl: [0.07, 0.07, 0.03], color: '#59b8ff', emis: 0.6 })); // brooch
      },
    },
    {
      id: 'hana', label: 'Hana', blurb: 'Energetic and sunny, ponytail',
      anime: true, skin: '#efc3a2', outfit: '#3f8f6b', accent: '#ffd45a', lip: '#d4685f', iris: '#c0702a', bg: ['#1f4a3a', '#08130e'],
      hair: '#b4562c', hairStyle: 'ponytail', torso: 'frustum',
      extras(P) {
        P.body.add(N({ mesh: 'box', pos: [0, 0.62, 0.275], scl: [0.05, 0.9, 0.02], color: '#2a6b4c' }));       // jacket zip
        P.body.add(N({ mesh: 'sphere', pos: [0, 0.97, 0.12], scl: [0.34, 0.07, 0.2], color: '#ffd45a' }));       // scarf
      },
    },
    {
      id: 'yuki', label: 'Yuki', blurb: 'Quiet and cool, dry little jokes',
      anime: true, skin: '#fbe8dc', outfit: '#dfe8f4', accent: '#5aa6e8', lip: '#d88a98', iris: '#4fc3e8', bg: ['#1c3350', '#08111c'],
      hair: '#a9d4f2', hairStyle: 'pixie', torso: 'frustum',
      extras(P) {
        P.body.add(N({ mesh: 'sphere', pos: [0, 0.96, 0.1], scl: [0.34, 0.1, 0.22], color: '#5aa6e8' }));      // scarf
        P.body.add(N({ mesh: 'box', pos: [0, 0.6, 0.275], scl: [0.05, 0.85, 0.02], color: '#9fb8d4' }));
      },
    },
    {
      id: 'rin', label: 'Rin', blurb: 'Fiery and proud, secretly sweet',
      anime: true, skin: '#f6d0b8', outfit: '#22232b', accent: '#e23b4a', lip: '#d4626a', iris: '#ff8a3a', bg: ['#4a1d22', '#12080a'],
      hair: '#c4202f', hairStyle: 'halfup', torso: 'frustum',
      extras(P) {
        P.body.add(N({ mesh: 'sphere', pos: [0, 0.93, 0.05], scl: [0.46, 0.08, 0.3], color: '#f4f4f6' }));       // shirt collar
        P.body.add(N({ mesh: 'box', pos: [0, 0.7, 0.275], scl: [0.09, 0.4, 0.02], color: '#e23b4a' }));         // tie
      },
    },
    {
      id: 'sora', label: 'Sora', blurb: 'Sporty and upbeat, always moving',
      anime: true, skin: '#eebb96', outfit: '#f2f6f8', accent: '#18b6b0', lip: '#cf6a60', iris: '#18a39c', bg: ['#10424a', '#061214'],
      hair: '#18b6b0', hairStyle: 'ponytail', torso: 'frustum',
      extras(P) {
        P.body.add(N({ mesh: 'box', pos: [-0.26, 0.55, 0.255], scl: [0.05, 1.0, 0.03], color: '#18b6b0' }));  // track stripes
        P.body.add(N({ mesh: 'box', pos: [0.26, 0.55, 0.255], scl: [0.05, 1.0, 0.03], color: '#18b6b0' }));
        P.head.add(N({ mesh: 'cyl', pos: [0, 0.27, 0.02], scl: [0.94, 0.07, 0.9], color: '#f2f6f8' }));      // headband
      },
    },
    {
      id: 'kaede', label: 'Kaede', blurb: 'Bookish and kind, loves facts',
      anime: true, skin: '#f4d2ba', outfit: '#6f7f4a', accent: '#b88d52', lip: '#cf7570', iris: '#8a5a2c', bg: ['#2f3a22', '#0b0f08'],
      hair: '#6a4430', hairStyle: 'sidebraid', torso: 'frustum',
      extras(P) {
        const z = P.surfZ(0.16, 0) + 0.025;
        for (const sd of [-1, 1]) {
          const x = 0.16 * sd;
          P.head.add(N({ mesh: 'box', pos: [x, 0.105, z], scl: [0.21, 0.016, 0.014], color: '#2a2020' }));
          P.head.add(N({ mesh: 'box', pos: [x, -0.105, z], scl: [0.21, 0.016, 0.014], color: '#2a2020' }));
          P.head.add(N({ mesh: 'box', pos: [x - 0.1, 0, z], scl: [0.016, 0.21, 0.014], color: '#2a2020' }));
          P.head.add(N({ mesh: 'box', pos: [x + 0.1, 0, z], scl: [0.016, 0.21, 0.014], color: '#2a2020' }));
        }
        P.head.add(N({ mesh: 'box', pos: [0, 0.03, z], scl: [0.07, 0.014, 0.014], color: '#2a2020' }));
        P.body.add(N({ mesh: 'box', pos: [0, 0.6, 0.275], scl: [0.04, 0.9, 0.02], color: '#4d5a32' }));
      },
    },
    {
      id: 'mei', label: 'Mei', blurb: 'Polite cafe maid, loves tea',
      anime: true, skin: '#f7d6c2', outfit: '#25232b', accent: '#ffffff', lip: '#e0808a', iris: '#d8809a', bg: ['#4a3550', '#120d16'],
      hair: '#e8cfa8', hairStyle: 'bun', torso: 'frustum',
      extras(P) {
        P.body.add(N({ mesh: 'frustum', pos: [0, 0.3, 0.02], scl: [0.7, 1.15, 0.58], color: '#fbfbfd' }));        // apron
        P.body.add(N({ mesh: 'sphere', pos: [0, 0.93, 0.04], scl: [0.46, 0.08, 0.3], color: '#fbfbfd' }));
        P.body.add(N({ mesh: 'sphere', pos: [0, 0.9, 0.27], scl: [0.08, 0.05, 0.03], color: '#d8809a' }));
        P.head.add(N({ mesh: 'cyl', pos: [0, 0.36, 0.1], rot: [0.3, 0, 0], scl: [0.55, 0.05, 0.22], color: '#fbfbfd' })); // frill headband
      },
    },
    {
      id: 'sayo', label: 'Sayo', blurb: 'Graceful shrine maiden, serene',
      anime: true, skin: '#fbe0ce', outfit: '#f6f3ee', accent: '#d03a3a', lip: '#c9606a', iris: '#6a3f6a', bg: ['#3a1c24', '#0f0709'],
      hair: '#16121c', hairStyle: 'hime', torso: 'frustum',
      extras(P) {
        P.body.add(N({ mesh: 'frustum', pos: [0, -0.02, 0.01], scl: [1.0, 0.95, 0.6], color: '#cf3a3a' }));       // red hakama
        P.body.add(N({ mesh: 'sphere', pos: [0, 0.9, 0.2], scl: [0.3, 0.07, 0.12], color: '#cf3a3a' }));          // collar trim
        for (const sd of [-1, 1]) P.head.add(N({ mesh: 'sphere', pos: [0.35 * sd, 0.18, 0.1], scl: [0.04, 0.04, 0.04], color: '#e0b44a' }));
      },
    },
    {
      id: 'neko', label: 'Neko', blurb: 'Cat-eared and cheeky, curious',
      anime: true, skin: '#f8d8c4', outfit: '#f2a03a', accent: '#6a4aa8', lip: '#e07878', iris: '#8ad04a', bg: ['#3a2a58', '#0e0a18'],
      hair: '#b8a0e8', hairStyle: 'bob', torso: 'frustum',
      extras(P) {
        for (const sd of [-1, 1]) {
          P.head.add(N({ mesh: 'cone', pos: [0.26 * sd, 0.5, -0.02], rot: [0, 0, -0.35 * sd], scl: [0.22, 0.3, 0.12], color: '#b8a0e8' }));
          P.head.add(N({ mesh: 'cone', pos: [0.26 * sd, 0.49, 0.0], rot: [0, 0, -0.35 * sd], scl: [0.12, 0.2, 0.06], color: '#f2a0b8' }));
        }
        P.body.add(N({ mesh: 'sphere', pos: [0, 1.04, -0.1], scl: [0.4, 0.2, 0.28], color: '#d98a2a' }));       // hood
        P.body.add(N({ mesh: 'sphere', pos: [0, 0.4, 0.27], scl: [0.28, 0.1, 0.02], color: '#d98a2a' }));        // pocket
      },
    },
    {
      id: 'ayame', label: 'Ayame', blurb: 'Elegant in a kimono, softly spoken',
      anime: true, skin: '#fbe2d0', outfit: '#2a3f78', accent: '#e8708a', lip: '#c85a68', iris: '#5a3a2a', bg: ['#2a3a60', '#090d18'],
      hair: '#1f1620', hairStyle: 'bun', torso: 'frustum',
      extras(P) {
        P.body.add(N({ mesh: 'box', pos: [0, 0.36, 0.0], scl: [1.0, 0.3, 0.6], color: '#e8708a' }));              // obi sash
        P.body.add(N({ mesh: 'sphere', pos: [0, 0.97, 0.12], scl: [0.26, 0.09, 0.16], color: '#f6eee6' }));      // inner collar
        P.head.add(N({ mesh: 'cyl', pos: [0.12, 0.6, -0.08], rot: [0, 0, 1.2], scl: [0.025, 0.4, 0.025], color: '#e0b44a', spec: 0.6 })); // hairpin
        P.head.add(N({ mesh: 'sphere', pos: [-0.12, 0.56, -0.02], scl: [0.07, 0.07, 0.05], color: '#e8708a' }));
      },
    },
    {
      id: 'elara', label: 'Elara', blurb: 'Gentle forest elf, loves nature',
      anime: true, skin: '#f5dcc6', outfit: '#d9d2a8', accent: '#5aa05a', lip: '#d27a80', iris: '#4ac08a', bg: ['#1c3a2a', '#07120c'],
      hair: '#bfe3b8', hairStyle: 'long', torso: 'frustum',
      extras(P) {
        for (const sd of [-1, 1]) P.head.add(N({ mesh: 'cone', pos: [0.54 * sd, 0.05, -0.04], rot: [0, 0, -1.2 * sd], scl: [0.1, 0.34, 0.07], color: '#f5dcc6' })); // pointed ears
        P.body.add(N({ mesh: 'sphere', pos: [0, 0.92, 0.1], scl: [0.46, 0.08, 0.26], color: '#5aa05a' }));       // leaf mantle
        P.body.add(N({ mesh: 'sphere', pos: [0, 0.8, 0.28], scl: [0.06, 0.08, 0.03], color: '#e8e060', emis: 0.5 }));
        P.head.add(N({ mesh: 'sphere', pos: [0, 0.27, 0.3], scl: [0.04, 0.04, 0.03], color: '#e8e060', emis: 0.6 }));  // circlet gem
      },
    },
    {
      id: 'kira', label: 'Kira', blurb: 'Neon idol energy, music lover',
      anime: true, skin: '#f6d2c0', outfit: '#1a1c28', accent: '#2ee6d6', lip: '#e0508a', iris: '#2ee6d6', bg: ['#10244a', '#05060f'],
      hair: '#2ee6d6', hairStyle: 'twintail', torso: 'frustum',
      extras(P) {
        P.head.add(N({ mesh: 'cyl', pos: [0, 0.3, -0.02], rot: [0, 0, 0], scl: [0.97, 0.05, 0.92], color: '#2a2d3e' }));   // headphone band
        for (const sd of [-1, 1]) {
          P.head.add(N({ mesh: 'cyl', pos: [0.47 * sd, 0.0, 0.0], rot: [0, 0, Math.PI / 2], scl: [0.26, 0.1, 0.26], color: '#2a2d3e' }));
          P.head.add(N({ mesh: 'cyl', pos: [0.52 * sd, 0.0, 0.0], rot: [0, 0, Math.PI / 2], scl: [0.16, 0.03, 0.16], color: '#2ee6d6', emis: 0.8 }));
        }
        P.body.add(N({ mesh: 'box', pos: [-0.28, 0.58, 0.275], scl: [0.04, 0.8, 0.02], color: '#2ee6d6', emis: 0.7 }));
        P.body.add(N({ mesh: 'box', pos: [0.28, 0.58, 0.275], scl: [0.04, 0.8, 0.02], color: '#e0508a', emis: 0.7 }));
      },
    },
  ];

  function build(def) {
    const P = { def, frame: def.frame || { y: 1.0, z: 4.6 }, root: N({ name: 'root' }) };
    const body = P.body = N({ name: 'body' }); P.root.add(body);
    const skin = def.skin, outfit = def.outfit;

    /* torso */
    if (def.torso === 'box') body.add(N({ mesh: 'box', pos: [0, 0.35, 0], scl: [0.86, 1.4, 0.5], color: outfit, spec: 0.5 }));
    else if (def.torso === 'flare') body.add(N({ mesh: 'flare', pos: [0, -0.1, 0], scl: [1.45, 2.2, 0.85], color: outfit }));
    else body.add(N({ mesh: 'frustum', pos: [0, 0.3, 0], scl: [0.98, 1.5, 0.56], color: outfit, spec: def.outfitSpec || 0 }));
    if (def.torso !== 'box') body.add(N({ mesh: 'sphere', pos: [0, 0.88, 0], scl: [0.52, 0.2, 0.28], color: outfit, spec: def.outfitSpec || 0 }));
    body.add(N({ mesh: 'cyl', pos: [0, 1.1, 0], scl: [0.15, 0.22, 0.15], color: def.robot ? '#6b7488' : skin }));

    /* head on a neck pivot */
    const neck = P.neck = N({ pos: [0, 1.1, 0] }); body.add(neck);
    const boxHead = def.headShape === 'box';
    const hs = boxHead ? [0.86, 0.74, 0.7] : [0.44, 0.47, 0.43];
    const head = P.head = N({ pos: [0, 0.47, 0] }); neck.add(head);
    head.add(N({ mesh: boxHead ? 'box' : 'sphere', scl: hs, color: skin, spec: def.robot ? 0.6 : 0.08 }));
    const surfZ = (x, y) => boxHead ? hs[2] / 2 + 0.012 : hs[2] * Math.sqrt(Math.max(0.02, 1 - (x / hs[0]) ** 2 - (y / hs[1]) ** 2)) + 0.004;
    P.surfZ = surfZ;

    P.mouthHW = def.anime ? 0.075 : 0.1;
    if (!def.robot) {
      for (const s of [-1, 1]) head.add(N({ mesh: 'sphere', pos: [0.43 * s, -0.02, -0.02], scl: [0.06, 0.1, 0.07], color: skin }));
      head.add(N({ mesh: 'sphere', pos: [0, -0.06, surfZ(0, -0.06) + (def.anime ? 0.008 : 0.03)], scl: def.anime ? [0.018, 0.016, 0.014] : [0.05, 0.06, 0.06], color: shade(skin, 0.94) })); // nose
      /* hair */
      if (def.hairStyle !== 'none' && def.hair) {
        const hc = def.hair;
        head.add(N({ mesh: 'sphere', pos: [0, 0.1, -0.08], scl: [0.47, 0.46, 0.47], color: hc, spec: 0.25 }));
        for (const sd of [-1, 1]) head.add(N({ mesh: 'sphere', pos: [0.13 * sd, 0.31, 0.26], rot: [0, 0, -0.45 * sd], scl: [0.17, 0.085, 0.15], color: hc, spec: 0.25 }));   // bangs
        head.add(N({ mesh: 'sphere', pos: [0, 0.33, 0.27], scl: [0.12, 0.07, 0.12], color: hc, spec: 0.25 }));
        for (const sd of [-1, 1]) head.add(N({ mesh: 'sphere', pos: [0.4 * sd, 0.0, 0.12], scl: [0.06, 0.2, 0.1], color: hc, spec: 0.25 })); // side locks
        const st = def.hairStyle;
        if (st === 'long') head.add(N({ mesh: 'sphere', pos: [0, -0.28, -0.2], scl: [0.46, 0.62, 0.3], color: hc, spec: 0.25 }));
        if (st === 'bob') head.add(N({ mesh: 'sphere', pos: [0, -0.08, -0.07], scl: [0.5, 0.36, 0.46], color: hc, spec: 0.25 }));
        if (st === 'twintail') for (const sd of [-1, 1]) {
          head.add(N({ mesh: 'sphere', pos: [0.5 * sd, -0.12, -0.08], rot: [0, 0, 0.12 * sd], scl: [0.11, 0.46, 0.11], color: hc, spec: 0.25 }));
          head.add(N({ mesh: 'sphere', pos: [0.44 * sd, 0.2, -0.06], scl: [0.06, 0.06, 0.06], color: def.accent }));
        }
        if (st === 'pixie') head.add(N({ mesh: 'sphere', pos: [0, 0.02, -0.04], scl: [0.48, 0.4, 0.46], color: hc, spec: 0.25 }));
        if (st === 'bun') {
          head.add(N({ mesh: 'sphere', pos: [0, 0.6, -0.08], scl: [0.17, 0.17, 0.17], color: hc, spec: 0.25 }));
          head.add(N({ mesh: 'sphere', pos: [0, -0.02, -0.14], scl: [0.46, 0.4, 0.34], color: hc, spec: 0.25 }));
        }
        if (st === 'sidebraid') {
          head.add(N({ mesh: 'sphere', pos: [0, -0.08, -0.12], scl: [0.47, 0.42, 0.36], color: hc, spec: 0.25 }));
          for (let i = 0; i < 5; i++) head.add(N({ mesh: 'sphere', pos: [-0.3 + (i % 2) * 0.02, -0.28 - i * 0.14, 0.2 - i * 0.02], scl: [0.075, 0.09, 0.075], color: hc, spec: 0.25 }));
          head.add(N({ mesh: 'sphere', pos: [-0.3, -0.98, 0.1], scl: [0.06, 0.05, 0.06], color: def.accent }));
        }
        if (st === 'halfup') {
          head.add(N({ mesh: 'sphere', pos: [0, -0.28, -0.2], scl: [0.46, 0.62, 0.3], color: hc, spec: 0.25 }));
          head.add(N({ mesh: 'sphere', pos: [0, 0.5, -0.12], scl: [0.12, 0.1, 0.12], color: hc, spec: 0.25 }));
          head.add(N({ mesh: 'sphere', pos: [0, 0.46, -0.04], scl: [0.15, 0.04, 0.05], color: def.accent }));
        }
        if (st === 'hime') {
          head.add(N({ mesh: 'sphere', pos: [0, -0.4, -0.18], scl: [0.47, 0.8, 0.3], color: hc, spec: 0.25 }));
          for (const sd of [-1, 1]) head.add(N({ mesh: 'sphere', pos: [0.4 * sd, -0.2, 0.14], scl: [0.07, 0.34, 0.09], color: hc, spec: 0.25 }));
        }
        if (st === 'ponytail') {
          head.add(N({ mesh: 'sphere', pos: [0.34, 0.12, -0.34], rot: [0, 0, -0.35], scl: [0.1, 0.48, 0.1], color: hc, spec: 0.25 }));
          head.add(N({ mesh: 'sphere', pos: [0.27, 0.36, -0.3], scl: [0.06, 0.06, 0.06], color: def.accent }));
        }
      }
      /* blush */
      for (const sd of [-1, 1]) head.add(N({ mesh: 'sphere', pos: [0.27 * sd, -0.07, surfZ(0.27 * sd, -0.07) - 0.004], scl: [0.06, 0.03, 0.012], color: '#f2a0a0' }));
    }

    /* eyes */
    const ex = boxHead ? 0.16 : 0.16, ey = boxHead ? 0.06 : (def.anime ? 0.0 : 0.05);
    P.eyes = []; P.pupils = [];
    for (const s of [-1, 1]) {
      const g = N({ pos: [ex * s, ey, surfZ(ex * s, ey) - 0.012] }); head.add(g);
      const base = boxHead ? [0.075, 0.06, 0.02] : (def.anime ? [0.098, 0.125, 0.05] : [0.082, 0.092, 0.05]);
      const white = N({ mesh: boxHead ? 'box' : 'sphere', scl: base, color: def.robot ? '#5ff3ff' : '#fdfdfd', emis: def.robot ? 1 : 0 });
      const pupil = N({ mesh: 'sphere', pos: [0, 0, 0.026], scl: def.anime ? [0.07, 0.098, 0.03] : [0.044, 0.056, 0.03], color: def.robot ? '#bffbff' : def.iris, emis: def.robot ? 1 : 0 });
      const glint = N({ mesh: 'sphere', pos: def.anime ? [0.02, 0.03, 0.02] : [0.012, 0.014, 0.018], scl: def.anime ? [0.022, 0.026, 0.01] : [0.012, 0.014, 0.01], color: '#ffffff', emis: 1 });
      if (def.anime) pupil.add(N({ mesh: 'sphere', pos: [-0.02, -0.035, 0.015], scl: [0.01, 0.01, 0.008], color: '#ffffff', emis: 1 }));
      pupil.add(glint);
      g.add(white); g.add(pupil);
      g.base = base; g.side = s;
      P.eyes.push(g); P.pupils.push(pupil);
      pupil.visible = !def.robot;
    }
    /* brows */
    P.brows = [];
    for (const s of [-1, 1]) {
      const by = ey + 0.13;
      const b = N({ mesh: 'box', pos: [ex * s, by, surfZ(ex * s, by) + 0.002], scl: [0.105, 0.022, 0.02], color: def.robot ? '#5ff3ff' : (def.hair || '#3a2a20'), emis: def.robot ? 1 : 0 });
      head.add(b); b.baseY = by; b.baseZ = b.pos[2]; b.side = s; P.brows.push(b);
    }
    /* mouth: a chain of beads that bends from frown to smile, plus an opening */
    const my = boxHead ? -0.2 : (def.anime ? -0.2 : -0.17);
    P.mouthY = my;
    const lipColor = def.robot ? '#5ff3ff' : def.lip;
    P.mouthOpen = N({ mesh: boxHead ? 'box' : 'sphere', pos: [0, my, surfZ(0, my) - 0.01], scl: [0.08, 0.01, 0.03], color: def.robot ? '#5ff3ff' : '#3a0f14', emis: def.robot ? 0.9 : 0 });
    P.tongue = N({ mesh: 'sphere', pos: [0, my - 0.02, surfZ(0, my) - 0.005], scl: [0.04, 0.02, 0.02], color: '#d8707a' });
    head.add(P.mouthOpen); head.add(P.tongue);
    P.beads = [];
    for (let i = 0; i < 9; i++) {
      const b = N({ mesh: 'sphere', scl: [0.017, 0.017, 0.012], color: lipColor, emis: def.robot ? 1 : 0 });
      head.add(b); P.beads.push(b);
    }

    /* arms: shoulder -> elbow -> hand */
    const sleeve = def.robot ? '#8e98ad' : outfit;
    const forearm = def.robot ? '#aeb6c8' : (def.id === 'detective' || def.id === 'wizard' ? outfit : skin);
    const arm = (side) => {
      const sh = N({ pos: [0.5 * side, 0.9, 0] });
      sh.add(N({ mesh: 'sphere', scl: [0.115, 0.115, 0.115], color: sleeve, spec: def.outfitSpec || 0 }));
      sh.add(N({ mesh: 'sphere', pos: [0, -0.25, 0], scl: [0.092, 0.285, 0.092], color: sleeve, spec: def.outfitSpec || 0 }));
      const el = N({ pos: [0, -0.5, 0] }); sh.add(el);
      el.add(N({ mesh: 'sphere', scl: [0.082, 0.082, 0.082], color: sleeve }));
      el.add(N({ mesh: 'sphere', pos: [0, -0.22, 0], scl: [0.08, 0.25, 0.08], color: forearm, spec: def.robot ? 0.5 : 0 }));
      const hand = N({ pos: [0, -0.47, 0] }); el.add(hand);
      hand.add(N({ mesh: 'sphere', scl: [0.088, 0.1, 0.07], color: def.robot ? '#6b7488' : skin }));
      hand.add(N({ mesh: 'sphere', pos: [0.07 * side, 0.02, 0.025], scl: [0.03, 0.05, 0.03], color: def.robot ? '#6b7488' : skin })); // thumb
      body.add(sh);
      return { sh, el, hand, side };
    };
    P.armR = arm(1); P.armL = arm(-1);
    if (def.extras) def.extras(P);
    return P;
  }

  function shade(hexc, k) {
    const c = GL3D.hex(hexc); return [c[0] * k, c[1] * k, c[2] * k];
  }

  root.Characters = { DEFS, build, byId: (id) => DEFS.find((d) => d.id === id) || DEFS[0] };
})(window);
