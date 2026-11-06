// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const K = require('../static/js/core.js');

const mk = (hex, x, y, extra) => Object.assign({
  HexCode: hex, Culture: 'AAAAAA', LocalResources: [], GDP: 100, Position: { x, y }, Area: 10, Population: 1000, ClaimValue: 50,
}, extra);
const model = K.buildModel({
  tileFiles: [[{ HexCode: 'C00001', Provinces: [
    { HexCode: 'P00001', Area: 20, Population: 2000, Tiles: [mk('FF0000', 0, 3), mk('00FF00', 1, 3, { LocalResources: [{ Resource: 'Food', Yield: 2 }] })] },
    { HexCode: 'P00002', Area: 10, Population: 1000, Tiles: [mk('0000FF', 2, 3)] },
  ] }]],
  continentNames: [{ HexCode: 'C00001', Name: 'Land' }], provinceNames: [{ HexCode: 'P00001', Name: 'Alpha' }],
  cultures: [{ HexCode: 'AAAAAA', Dialect: 'D', Language: 'Tekk', SubGroup: 'Sub', Group: 'G', Family: 'F' }], limit: [100],
});
// Geometry with deliberately different shapes so frames can be told apart: display 14x4 (with an overlap strip), one world
// turn 10x4, old tile frame 8x4. 0 degrees sits at x=3, the equator at row 2.
const geo = K.makeGeometry({ width: 14, height: 4, loopWidth: 10, meridianX: 3, equatorY: 2,
  tileFrame: { width: 8, height: 4, meridianX: 4, equatorY: 2 } });
// tiles live in the old frame (y from the bottom): tile 1 at lon 0/lat 0, tile 2 at lon 90, tile 3 at lon -90/lat 45
const t1 = model.tiles[1], t2 = model.tiles[2], t3 = model.tiles[3];
t1.Position = { x: 4, y: 2 }; t2.Position = { x: 6, y: 2 }; t3.Position = { x: 2, y: 3 };
const world = new Uint8Array(10 * 4 * 4);                  // one world turn, 10x4, y from the top
const put = (x, y, r, g, b) => world.set([r, g, b, 255], (y * 10 + x) * 4);
put(3, 2, 255, 0, 0); put(5, 2, 0, 255, 0); put(0, 0, 0, 0, 255);

test('model ids and names', () => {
  assert.equal(model.tiles.length, 4);
  assert.equal(model.provinces[0].name, 'Alpha');
  assert.equal(model.provinces[1].name, 'P00002');           // falls back to hex when unnamed
  assert.equal(model.claimLimit, 100);
});
test('geometry: degrees <-> pixels', () => {
  assert.equal(geo.lonToX(0), 3); assert.equal(geo.latToY(0), 2); assert.equal(geo.xToLon(3), 0);
  assert.equal(geo.xToLon(3 + 10), 360);                     // one loop width is a full turn
  assert.equal(geo.wrapX(-1), 9); assert.equal(geo.wrapX(11), 1);
});
test('old tile positions convert through lat/lon', () => {
  assert.deepEqual(K.tilePoint(geo, t1), { x: 3, y: 2 });
  assert.deepEqual(K.tilePoint(geo, t2), { x: 3 + 90 * 10 / 360, y: 2 });
  const p3 = K.tilePoint(geo, t3);
  assert.ok(Math.abs(p3.x - 0.5) < 1e-9 && Math.abs(p3.y - 0.75) < 1e-9);
});
test('hit map, and clicks loop round the world', () => {
  const hit = K.buildHitMap(world, 10, 4, model);
  assert.equal(K.tileAtImage(hit, 10, 4, 3.5, 2.5), 1);
  assert.equal(K.tileAtImage(hit, 10, 4, 13.5, 2.5), 1);     // one world turn to the right
  assert.equal(K.tileAtImage(hit, 10, 4, -6.5, 2.5), 1);     // one to the left
  assert.equal(K.tileAtImage(hit, 10, 4, 5.5, 2.5), 2);
  assert.equal(K.tileAtImage(hit, 10, 4, 9.5, 3.5), 0);
  assert.equal(K.tileAtImage(hit, 10, 4, 3.5, 9), 0);        // off the top/bottom is nothing, not wrapped
});
test('claim totals and resources', () => {
  const st = new Uint8Array(4); st[1] |= K.CLAIMED; st[2] |= K.CLAIMED;
  const t = K.claimTotals(model, st);
  assert.equal(t.population, 2000); assert.equal(t.claimValue, 100); assert.equal(t.resources.get('Food'), 2);
  assert.deepEqual([...t.resources.keys()], K.RESOURCES);
});
test('wiki export', () => {
  const st = new Uint8Array(4); st[1] |= K.CLAIMED; st[2] |= K.CLAIMED;
  const txt = K.wikiText(model, st, { name: 'X', capital: 'Alpha' });
  assert.match(txt, /\| denonym = Xian/); assert.match(txt, /\| languages = Tekk<br\/>/);
  assert.match(txt, /\| ethnicity = 100\.0% Sub<br\/>/); assert.match(txt, /Claim Value: 100\/100/);
});
test('images are recognised by shape', () => {
  assert.equal(K.frameOfImage(geo, 14, 4), 'full'); assert.equal(K.frameOfImage(geo, 1400, 400), 'full');
  assert.equal(K.frameOfImage(geo, 10, 4), 'world'); assert.equal(K.frameOfImage(geo, 8, 4), 'legacy');
});
test('overlap strip: a tile painted only in the right-hand copy of the strip is still found', () => {
  // full-frame image 14 wide (loop 10): tile 1 sits at x=3, so its other copy is x=13
  assert.deepEqual(K.samplePoints(geo, model.tiles[1], 'full', 14, 4).map(p => p.x), [3, 13]);
  assert.equal(K.samplePoints(geo, model.tiles[1], 'world', 10, 4).length, 1);
  const right = new Uint8Array(14 * 4 * 4); right.set([255, 0, 0, 255], (2 * 14 + 13) * 4);
  assert.deepEqual(K.territoryFromImage(model, geo, right, 14, 4), [1]);
  const left = new Uint8Array(14 * 4 * 4); left.set([255, 0, 0, 255], (2 * 14 + 3) * 4);
  assert.deepEqual(K.territoryFromImage(model, geo, left, 14, 4), [1]);
});
test('prevent contest: go to the tile position, search outwards, first paint decides', () => {
  // tile 1 is a 4-pixel strip x 3..6 (position pixel (3,2) is a "lake" the wiki left unpainted); tile 3 (0000FF) is one pixel at (8,2)
  const tm = new Uint8Array(10 * 4 * 4);
  for (const x of [3, 4, 5, 6]) tm.set([255, 0, 0, 255], (2 * 10 + x) * 4);
  tm.set([0, 0, 255, 255], (2 * 10 + 8) * 4);
  const hit = K.buildHitMap(tm, 10, 4, model);
  const claimed = new Uint8Array(10 * 4 * 4);
  for (const x of [4, 5, 6]) claimed.set([127, 0, 0, 255], (2 * 10 + x) * 4);
  claimed.set([255, 0, 0, 255], (2 * 10 + 8) * 4);                              // wrong colour on tile 3
  const r = K.contestedTiles(model, geo, hit, claimed, 10, 4, 'world');
  assert.equal(r[1], 1); assert.equal(r[3], 0);
  assert.equal(K.contestedTiles(model, geo, hit, new Uint8Array(10 * 4 * 4), 10, 4, 'world')[1], 0);   // nothing painted
  // a claimed NEIGHBOUR must not make an unpainted tile look claimed
  const nb = new Uint8Array(10 * 4 * 4); nb.set([127, 0, 0, 255], (2 * 10 + 8) * 4);
  const rn = K.contestedTiles(model, geo, hit, nb, 10, 4, 'world'); assert.equal(rn[1], 0); assert.equal(rn[3], 1);
  // semi-transparent edge paint is not a claim
  const edge = new Uint8Array(10 * 4 * 4); edge.set([127, 0, 0, 90], (2 * 10 + 3) * 4);
  assert.equal(K.contestedTiles(model, geo, hit, edge, 10, 4, 'world')[1], 0);
  // full-frame image, paint only in the strip's right-hand copy (x + 10): tile 1 pixel x=4 -> x=14 is off the image, so use x=3 -> 13
  const right = new Uint8Array(14 * 4 * 4); right.set([127, 0, 0, 255], (2 * 14 + 13) * 4);
  assert.equal(K.contestedTiles(model, geo, hit, right, 14, 4, 'full')[1], 1);
});
test('selection outline and hover', () => {
  // 8x6 hit map: tile 1 is a 4x4 block at (2..5, 1..4), tile 2 a block beside it
  const w = 8, h = 6, idx = new Uint16Array(w * h), bb = new Int32Array(4 * 4).fill(-1);
  for (let y = 1; y <= 4; y++) for (let x = 2; x <= 5; x++) idx[y * w + x] = 1;
  bb.set([2, 1, 5, 4], 4);
  const hit = { w, h, idx, bb }, state = new Uint8Array(4), buf = new Uint32Array(w * h);
  const lut = K.makeLut({ claimed: 1, selected: 2, province: 3, hover: 4, claimedHover: 5 });
  assert.equal(lut[K.HOVER], 4); assert.equal(lut[K.CLAIMED], 1); assert.equal(lut[K.CLAIMED | K.HOVER], 5); assert.equal(lut[K.HOVER | K.PROVINCE], 3); assert.equal(lut[K.HOVER | K.SELECTED], 2);
  state[1] = K.SELECTED;
  K.paintTiles(hit, buf, state, lut, [1]); K.paintOutline(hit, buf, state, [1], 9, 1);
  assert.equal(buf[2 * w + 3], 2);                                   // interior keeps the fill
  assert.equal(buf[1 * w + 3], 9); assert.equal(buf[2 * w + 2], 9);  // edge pixels get the outline
  state[1] = K.HOVER; buf.fill(0);
  K.paintTiles(hit, buf, state, lut, [1]); K.paintOutline(hit, buf, state, [1], 9, 1);
  assert.equal(buf[1 * w + 3], 4);                                   // hover alone: faint fill, no outline
  // claimed outline uses the CLAIMED bit; two touching claimed tiles share no outline between them
  idx[1 * w + 6] = 2; idx[2 * w + 6] = 2; bb.set([6, 1, 6, 2], 8);
  state[1] = state[2] = K.CLAIMED; buf.fill(0);
  K.paintTiles(hit, buf, state, lut, [1, 2]); K.paintOutline(hit, buf, state, [1, 2], 9, 1, K.CLAIMED);
  assert.equal(buf[2 * w + 5], 1);                                   // tile 1 edge next to claimed tile 2: no outline
  assert.equal(buf[2 * w + 3], 1); assert.equal(buf[1 * w + 3], 9);  // interior vs. outer edge
});
test('territory import: world-turn image and old-frame image', () => {
  const img = new Uint8Array(10 * 4 * 4); img.set([255, 0, 0, 255], (2 * 10 + 3) * 4);          // tile 1's pixel
  img.set([255, 0, 0, 0], (2 * 10 + 5) * 4);                                                     // red but transparent: ignored
  assert.deepEqual(K.territoryFromImage(model, geo, img, 10, 4), [1]);
  const old = new Uint8Array(8 * 4 * 4); old.set([255, 0, 0, 255], (1 * 8 + 4) * 4);            // old frame: x=4, row (4-1-2)=1
  assert.deepEqual(K.territoryFromImage(model, geo, old, 8, 4), [1]);
});

test('flat map: original 12288 picture starting at the 180 degree line, placed in the new frame and looped', () => {
  const g = K.makeGeometry({ width: 13900, height: 6000, loopWidth: 12288, meridianX: 2111, equatorY: 3000,
    flatMap: { leftLongitude: -180, equatorY: null }, tileFrame: { width: 12288, height: 6144, meridianX: 6144, equatorY: 3072 } });
  // -180 degrees is 2111 - 6144 = -4033; the 72 extra rows top and bottom hang outside the 6000 tall copy
  assert.deepEqual(K.flatPlacements(g, 12288, 6144), [
    { left: -4033, top: -72, width: 12288, height: 6144 },
    { left: 8255, top: -72, width: 12288, height: 6144 }]);
  // together they tile columns 0..P of a copy: the first ends exactly where the second begins, and the first starts before 0
  const [a, b] = K.flatPlacements(g, 12288, 6144);
  assert.equal(a.left + a.width, b.left);
  assert.ok(a.left <= 0 && b.left + b.width >= 12288);
  // a half-size copy of the same picture lines up identically (its own size sets the scale)
  const h = K.flatPlacements(g, 6144, 3072);
  assert.deepEqual(h.map(r => [r.left, r.top, r.width, r.height]), [[-4033, -72, 12288, 6144], [8255, -72, 12288, 6144]]);
});

test('flat map trimmed to 6000 rows like the other layers: no vertical offset', () => {
  const g = K.makeGeometry({ width: 13900, height: 6000, loopWidth: 12288, meridianX: 2111, equatorY: 3000,
    flatMap: { leftLongitude: -180, equatorY: null }, tileFrame: { width: 12288, height: 6144, meridianX: 6144, equatorY: 3072 } });
  assert.deepEqual(K.flatPlacements(g, 12288, 6000).map(r => [r.left, r.top, r.width, r.height]), [[-4033, 0, 12288, 6000], [8255, 0, 12288, 6000]]);
});

test('overlap strips are merged: a tile present in only one copy of the strip is still found', () => {
  // full hit map 14 wide (world turn = 10, so the strip is 4): left strip = columns 0..3, right strip = columns 10..13
  const w = 14, h = 1, idx = new Uint16Array(w), bb = new Int32Array(4 * 4);
  idx[1] = 1;            // tile 1 in the LEFT strip only
  idx[12] = 2;           // tile 2 in the RIGHT strip only (the left copy at column 2 is empty)
  idx[3] = 3; idx[13] = 1;   // column 3: left strip says 3, right strip says 1 -> the left one wins
  idx[6] = 2;            // a plain tile outside the strip
  const f = K.foldHitMap({ w, h, idx, bb }, 10);
  assert.equal(f.w, 10);
  assert.equal(f.idx[1], 1); assert.equal(f.idx[2], 2); assert.equal(f.idx[3], 3); assert.equal(f.idx[6], 2);
  assert.equal(f.idx[0], 0);
  assert.deepEqual([f.bb[2 * 4], f.bb[2 * 4 + 2]], [2, 6]);          // bounding boxes follow the merged result
  assert.equal(K.foldHitMap({ w: 10, h, idx: new Uint16Array(10), bb }, 10).w, 10);   // no strip: unchanged
});
test('flat map nudge (offsetX) and placement over several world turns', () => {
  const g = K.makeGeometry({ width: 13900, height: 6000, loopWidth: 12288, meridianX: 2111, equatorY: 3000,
    flatMap: { leftLongitude: -180, equatorY: null, offsetX: -10 }, tileFrame: { width: 12288, height: 6144, meridianX: 6144, equatorY: 3072 } });
  assert.deepEqual(K.flatPlacements(g, 12288, 6000).map(r => r.left), [-4043, 8245]);
  const wide = K.flatPlacements(g, 12288, 6000, -12288, 3 * 12288).map(r => r.left);
  assert.deepEqual(wide, [-16331, -4043, 8245, 20533, 32821]);   // 5 images cover -P .. 3P with no gaps
  for (let i = 1; i < wide.length; i++) assert.equal(wide[i] - wide[i - 1], 12288);
});
