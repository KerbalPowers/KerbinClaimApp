// Run with: node --test tests/sources.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
global.location = { href: 'https://example.github.io/app/' };
global.MAP_CONFIG = { urls: {} };
eval(fs.readFileSync(__dirname + '/../static/js/sources.js', 'utf8').replace('const Sources', 'global.Sources'));

test('dropbox share links become direct links', () => {
  assert.equal(Sources.direct('https://www.dropbox.com/scl/fi/abc/Tiles.png?rlkey=K&dl=0'), 'https://dl.dropbox.com/scl/fi/abc/Tiles.png?rlkey=K');
  assert.equal(Sources.direct('https://dl.dropbox.com/scl/fi/abc/x.png?rlkey=K&st=S'), 'https://dl.dropbox.com/scl/fi/abc/x.png?rlkey=K&st=S');
});
test('common paste accidents are repaired', () => {
  const want = 'https://dl.dropbox.com/scl/fi/zlf/FlatMap.png?rlkey=lky';
  // a markdown link
  assert.equal(Sources.direct('dl://[www.dropbox.com/scl/fi/zlf/FlatMap.png?rlkey=lky](https://www.dropbox.com/scl/fi/zlf/FlatMap.png?rlkey=lky)'), want);
  assert.equal(Sources.direct('[FlatMap](https://www.dropbox.com/scl/fi/zlf/FlatMap.png?rlkey=lky)'), want);
  // a dl:// prefix, and a missing scheme
  assert.equal(Sources.direct('dl://dl.dropbox.com/scl/fi/zlf/FlatMap.png?rlkey=lky'), want);
  assert.equal(Sources.direct('www.dropbox.com/scl/fi/zlf/FlatMap.png?rlkey=lky&dl=0'), want);
});
test('blank stays blank, other hosts pass through', () => {
  assert.equal(Sources.direct(''), ''); assert.equal(Sources.direct(null), '');
  assert.equal(Sources.direct('https://example.org/a.png'), 'https://example.org/a.png');
  assert.equal(Sources.direct('http://localhost:8000/a.png'), 'http://localhost:8000/a.png');     // plain http is left alone
});
