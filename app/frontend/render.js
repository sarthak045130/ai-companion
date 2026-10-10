/* Small, safe Markdown renderer for chat messages. Everything is HTML-escaped first. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Render = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function inline(text) {
    const codes = [];
    text = text.replace(/`([^`\n]+)`/g, function (m, c) {
      codes.push(c);
      return '\u0000' + (codes.length - 1) + '\u0000';
    });
    text = text.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/(^|[^*\w])\*([^*\s][^*\n]*)\*(?!\w)/g, '$1<em>$2</em>');
    text = text.replace(/(^|[^_\w])_([^_\s][^_\n]*)_(?!\w)/g, '$1<em>$2</em>');
    text = text.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, function (m, label, url) {
      return '<a href="' + url + '" data-external="1">' + label + '</a>';
    });
    text = text.replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?])/g, function (m, pre, url) {
      return pre + '<a href="' + url + '" data-external="1">' + url + '</a>';
    });
    return text.replace(/\u0000(\d+)\u0000/g, function (m, i) {
      return '<code>' + codes[Number(i)] + '</code>';
    });
  }

  function render(markdown) {
    const lines = esc(String(markdown || '')).replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let para = [];
    let list = null; // {tag, items}
    let i = 0;

    function flushPara() {
      if (para.length) {
        out.push('<p>' + para.map(inline).join('<br>') + '</p>');
        para = [];
      }
    }
    function flushList() {
      if (list) {
        out.push('<' + list.tag + '>' + list.items.map(function (t) { return '<li>' + inline(t) + '</li>'; }).join('') + '</' + list.tag + '>');
        list = null;
      }
    }

    while (i < lines.length) {
      const line = lines[i];
      const fence = /^\s*```\s*([\w+-]*)\s*$/.exec(line);
      if (fence) {
        flushPara(); flushList();
        const code = [];
        i++;
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { code.push(lines[i]); i++; }
        i++; // closing fence (or end of a still-streaming block)
        out.push('<pre><code>' + code.join('\n') + '</code></pre>');
        continue;
      }
      let m;
      if ((m = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line))) {
        flushPara(); flushList();
        out.push('<p class="md-h">' + inline(m[2]) + '</p>');
      } else if ((m = /^\s*[-*+]\s+(.*)$/.exec(line))) {
        flushPara();
        if (!list || list.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] }; }
        list.items.push(m[1]);
      } else if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) {
        flushPara();
        if (!list || list.tag !== 'ol') { flushList(); list = { tag: 'ol', items: [] }; }
        list.items.push(m[1]);
      } else if ((m = /^&gt;\s?(.*)$/.exec(line))) {
        flushPara(); flushList();
        out.push('<blockquote>' + inline(m[1]) + '</blockquote>');
      } else if (/^\s*$/.test(line)) {
        flushPara(); flushList();
      } else {
        flushList();
        para.push(line);
      }
      i++;
    }
    flushPara(); flushList();
    return out.join('');
  }

  return { render: render, esc: esc };
});
