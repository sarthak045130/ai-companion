/* Loads the video-call feature. The only line added to index.html is the tag that loads this file. */
'use strict';
(function () {
  const base = '/avatar/';
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = base + 'avatar.css'; document.head.append(css);
  for (const f of ['gl3d', 'emotion', 'characters', 'rig', 'face2d', 'perception', 'call']) {
    const s = document.createElement('script'); s.src = base + f + '.js'; s.async = false; document.head.append(s);
  }
})();
