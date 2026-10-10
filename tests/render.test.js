// Run with: node tests/render.test.js
const assert = require('assert');
const { render } = require('../app/frontend/render.js');

// XSS: everything is escaped
assert.strictEqual(render('<script>alert(1)</script>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
assert.ok(!render('<img src=x onerror=alert(1)>').includes('<img'));
// javascript: links are never linked; only http(s)
assert.ok(!render('[x](javascript:alert(1))').includes('<a '));
assert.ok(render('[docs](https://example.com/a?b=1&c=2)').includes('href="https://example.com/a?b=1&amp;c=2"'));
assert.ok(render('see https://example.com.').includes('>https://example.com</a>.'));
// quotes in links cannot break out of the attribute
assert.ok(!/href="[^"]*"[^>]*onmouseover/.test(render('[x](https://a.com/"onmouseover="alert(1))')));
// inline formatting
assert.strictEqual(render('a **bold** and *it* and `c<d`'), '<p>a <strong>bold</strong> and <em>it</em> and <code>c&lt;d</code></p>');
assert.strictEqual(render('snake_case_name stays'), '<p>snake_case_name stays</p>');
assert.strictEqual(render('2 * 3 * 4'), '<p>2 * 3 * 4</p>');
// code blocks keep content literal (no markdown inside), incl. unterminated while streaming
assert.strictEqual(render('```js\nlet a = **x**;\n```'), '<pre><code>let a = **x**;</code></pre>');
assert.strictEqual(render('```\nstill typing <b>'), '<pre><code>still typing &lt;b&gt;</code></pre>');
// lists, headings, quotes, paragraphs
assert.strictEqual(render('- a\n- b'), '<ul><li>a</li><li>b</li></ul>');
assert.strictEqual(render('1. one\n2) two'), '<ol><li>one</li><li>two</li></ol>');
assert.strictEqual(render('# Title\ntext'), '<p class="md-h">Title</p><p>text</p>');
assert.strictEqual(render('> quoted'), '<blockquote>quoted</blockquote>');
assert.strictEqual(render('line1\nline2\n\npara2'), '<p>line1<br>line2</p><p>para2</p>');
assert.strictEqual(render(''), '');
console.log('render.test.js: all assertions passed');
