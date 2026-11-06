// core.js - everything that isn't DOM: data model, pixel hit-map, claim maths, wiki export.
// Works in the browser (window.KCore) and in Node (require) so it can be unit-tested.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RESOURCES = ['Food', 'Hydrates', 'Common Ore', 'Rare Ore', 'Nuclear Ore'];
  // state bit flags per tile
  const CLAIMED = 1, SELECTED = 2, PROVINCE = 4, HOVER = 8;

  const hexKey = h => parseInt(h, 16);

  // ── Model ───────────────────────────────────────────────────────────────────
  // raw: { tileFiles: [{Content:[continent,...]},...], continentNames, provinceNames, cultures, limit }
  // Tiles get 1-based ids so 0 can mean "no tile" in the hit map.
  function buildModel(raw) {
    const nameMap = arr => new Map((arr || []).map(n => [n.HexCode, n.Name]));
    const model = {
      tiles: [null], provinces: [], continents: [],
      tileByKey: new Map(), provByHex: new Map(),
      contNames: nameMap(raw.continentNames), provNames: nameMap(raw.provinceNames),
      cultures: new Map((raw.cultures || []).map(c => [c.HexCode, c])),
      claimLimit: (raw.limit && raw.limit[0]) || 750000,
      warnings: [],
    };
    for (const file of raw.tileFiles) {
      for (const c of file) {
        const cont = { id: model.continents.length, hex: c.HexCode, name: model.contNames.get(c.HexCode) || c.HexCode };
        model.continents.push(cont);
        for (const p of c.Provinces) {
          const prov = {
            id: model.provinces.length, hex: p.HexCode, contId: cont.id, contHex: c.HexCode,
            name: model.provNames.get(p.HexCode) || p.HexCode, area: p.Area || 0, population: p.Population || 0, tileIds: [],
          };
          if (model.provByHex.has(p.HexCode)) model.warnings.push('duplicate province ' + p.HexCode);
          model.provByHex.set(p.HexCode, prov);
          model.provinces.push(prov);
          for (const t of p.Tiles) {
            const key = hexKey(t.HexCode);
            if (model.tileByKey.has(key)) { model.warnings.push('duplicate tile ' + t.HexCode); continue; }
            const tile = Object.assign({}, t, { id: model.tiles.length, key, provId: prov.id, contId: cont.id });
            model.tiles.push(tile);
            model.tileByKey.set(key, tile.id);
            prov.tileIds.push(tile.id);
          }
        }
      }
    }
    return model;
  }

  function findCulture(model, hex) {
    return model.cultures.get(hex) ||
      { HexCode: hex, Dialect: 'Undefined', Language: 'Undefined', SubGroup: 'Undefined', Group: 'Undefined', Family: 'Undefined' };
  }

  // ── Map geometry ────────────────────────────────────────────────────────────
  // g = config/geometry.json. The display frame is the new 13900x6000 map; P (loopWidth) pixels are one full turn
  // of longitude, so x and x+P are the same place. tileFrame is the old frame the tile JSON positions live in.
  function makeGeometry(g) {
    const tf = g.tileFrame;
    const geo = {
      W: g.width, H: g.height, P: g.loopWidth, mx: g.meridianX, eq: g.equatorY,
      ppd: g.loopWidth / 360,                                  // pixels per degree, both directions
      tile: { W: tf.width, H: tf.height, mx: tf.meridianX, eq: tf.equatorY, ppd: tf.width / 360 },
    };
    // The flat (base) map can be in its own frame: e.g. the original 12288 wide image whose left edge is the 180 degree line.
    // Its size is read from the file itself; only where it starts (and optionally its equator row) is configured.
    geo.flat = g.flatMap ? { leftLon: g.flatMap.leftLongitude == null ? -180 : g.flatMap.leftLongitude, eq: g.flatMap.equatorY == null ? null : g.flatMap.equatorY, dx: g.flatMap.offsetX || 0 } : null;
    geo.wrapX = x => ((x % geo.P) + geo.P) % geo.P;
    geo.lonToX = lon => geo.mx + lon * geo.ppd;
    geo.latToY = lat => geo.eq - lat * geo.ppd;
    geo.xToLon = x => (x - geo.mx) / geo.ppd;
    geo.yToLat = y => (geo.eq - y) / geo.ppd;
    return geo;
  }

  // Where a w x h flat-map image goes, as rectangles in map pixels: one for every place its repeats touch [from, to).
  // The image's own size sets its scale (pixels per degree), so a downsized copy still lines up. f.dx nudges it sideways.
  function flatPlacements(geo, w, h, from, to) {
    from = from == null ? 0 : from; to = to == null ? geo.P : to;
    const f = geo.flat, s = geo.ppd / (w / 360);
    const ox = geo.lonToX(f.leftLon) + (f.dx || 0), oy = geo.eq - (f.eq == null ? h / 2 : f.eq) * s, iw = w * s, ih = h * s, out = [];
    for (let m = -6; m <= 6; m++) {
      const left = ox + m * geo.P;
      if (left < to && left + iw > from) out.push({ left, top: oy, width: iw, height: ih });
    }
    return out;
  }

  // A tile's position (old frame, y from the bottom) -> display image pixel (x in [0,P), y from the top).
  function tilePoint(geo, tile) {
    const t = geo.tile, lon = (tile.Position.x - t.mx) / t.ppd, lat = (tile.Position.y - t.eq) / t.ppd;
    return { x: geo.wrapX(geo.lonToX(lon)), y: geo.latToY(lat) };
  }

  // Which frame is an image in? Judged by shape: the full display frame (W x H, with the overlap strip), one world turn
  // (P x H, what Export writes), or the old tile frame (12288x6144).
  function frameOfImage(geo, w, h) {
    const a = w / h, c = {
      full: geo.W / geo.H, world: geo.P / geo.H, legacy: geo.tile.W / geo.tile.H,
    };
    let best = 'world', d = Infinity;
    for (const k in c) { const e = Math.abs(a - c[k]); if (e < d) { d = e; best = k; } }
    return best;
  }

  // Where a tile sits in a w x h image of the given frame (pixel coordinates, y from the top)
  function samplePoint(geo, tile, frame, w, h) {
    if (frame === 'legacy') {
      return { x: Math.min(w - 1, Math.max(0, Math.floor(tile.Position.x / geo.tile.W * w))),
               y: Math.min(h - 1, Math.max(0, Math.floor((geo.tile.H - 1 - tile.Position.y) / geo.tile.H * h))) };
    }
    const p = tilePoint(geo, tile), across = frame === 'full' ? geo.W : geo.P;
    return { x: Math.min(w - 1, Math.max(0, Math.floor(p.x / across * w))), y: Math.min(h - 1, Math.max(0, Math.floor(p.y / geo.H * h))) };
  }

  // Every place a tile can be read from in an image. In the full frame a tile inside the overlap strip exists in TWO copies, P apart,
  // and either copy may be the one that is painted - so both are returned (the left one first). Other frames have just one.
  function samplePoints(geo, tile, frame, w, h) {
    const p = samplePoint(geo, tile, frame, w, h);
    if (frame === 'full') {
      const x2 = p.x + Math.round(geo.P / geo.W * w);
      if (x2 < w) return [p, { x: x2, y: p.y }];
    }
    return [p];
  }

  // Which tiles are already claimed on the wiki map ("Prevent contest"). Same idea as the map generator's position finding:
  // go to the tile's position, and if there is nothing there search OUTWARDS ring by ring until paint is found. Only the tile's own
  // pixels are looked at (the hit map says which they are), so a lake or a claimed neighbour can't decide the answer. The first
  // painted pixel found decides: the tile is claimed only if it is the contest colour (7F0000). Painted = opaque enough to be
  // a real fill, not an anti-aliased edge. In the full frame an empty pixel in the overlap strip is also looked up in the strip's
  // other copy. Returns a Uint8Array by tile id.
  function contestedTiles(model, geo, hit, rgba, w, h, frame, rgb, maxRadius) {
    rgb = rgb || [127, 0, 0]; maxRadius = maxRadius || 120;
    const n = model.tiles.length, out = new Uint8Array(n);
    const across = frame === 'full' ? geo.W : geo.P;                 // legacy and world images are one turn wide
    const sx = w * geo.P / across / hit.w, sy = h / hit.h;
    const shift = frame === 'full' ? Math.round(geo.P / geo.W * w) : 0;
    // offset of the painted pixel under hit pixel (x, y), or -1 when the wiki map is not painted there
    const paint = (x, y) => {
      const cx = Math.min(w - 1, Math.floor((x + 0.5) * sx)), cy = Math.min(h - 1, Math.floor((y + 0.5) * sy));
      let o = (cy * w + cx) * 4;
      if (rgba[o + 3] < 200 && shift && cx + shift < w) o += shift * 4;
      return rgba[o + 3] >= 200 ? o : -1;
    };
    for (let id = 1; id < n; id++) {
      const b = id * 4, x0 = hit.bb[b], y0 = hit.bb[b + 1], x1 = hit.bb[b + 2], y1 = hit.bb[b + 3];
      if (x1 < 0) continue;
      const p = tilePoint(geo, model.tiles[id]);
      const px = Math.min(x1, Math.max(x0, Math.floor(p.x / geo.P * hit.w))), py = Math.min(y1, Math.max(y0, Math.floor(p.y / geo.H * hit.h)));
      const R = Math.min(maxRadius, Math.max(px - x0, x1 - px, py - y0, y1 - py));
      let found = -1;
      for (let r = 0; r <= R && found < 0; r++) {
        // the square ring of radius r around (px, py), clipped to the tile's bounding box
        for (let y = Math.max(y0, py - r); y <= Math.min(y1, py + r) && found < 0; y++) {
          const edge = y === py - r || y === py + r, step = edge || r === 0 ? 1 : 2 * r, row = y * hit.w;
          for (let x = px - r; x <= px + r; x += step) {
            if (x < x0 || x > x1 || hit.idx[row + x] !== id) continue;
            const o = paint(x, y);
            if (o >= 0) { found = o; break; }
          }
        }
      }
      if (found >= 0) out[id] = rgba[found] === rgb[0] && rgba[found + 1] === rgb[1] && rgba[found + 2] === rgb[2] ? 1 : 0;
    }
    return out;
  }

  // ── Hit map ─────────────────────────────────────────────────────────────────
  // rgba: RGBA bytes of the tile map (top row first), w x h. Returns the per-pixel tile id plus a
  // bounding box per tile, so repainting one tile only touches its own box.
  function buildHitMap(rgba, w, h, model) {
    const n = model.tiles.length;
    const idx = new Uint16Array(w * h);
    const bb = new Int32Array(n * 4);
    for (let i = 0; i < n; i++) { bb[i * 4] = w; bb[i * 4 + 1] = h; bb[i * 4 + 2] = -1; bb[i * 4 + 3] = -1; }
    let lastKey = -1, lastId = 0, p = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++, p++) {
        const o = p * 4;
        if (rgba[o + 3] === 0) continue;
        const key = (rgba[o] << 16) | (rgba[o + 1] << 8) | rgba[o + 2];
        if (key !== lastKey) { lastKey = key; lastId = model.tileByKey.get(key) || 0; }
        if (!lastId) continue;
        idx[p] = lastId;
        const b = lastId * 4;
        if (x < bb[b]) bb[b] = x;
        if (y < bb[b + 1]) bb[b + 1] = y;
        if (x > bb[b + 2]) bb[b + 2] = x;
        if (y > bb[b + 3]) bb[b + 3] = y;
      }
    }
    return { w, h, idx, bb };
  }

  // The images carry an overlap strip (the first W-P columns are repeated at the end). Each copy of the strip may be
  // transparent where the other has the content, so the two are MERGED: a pixel in one world turn takes the tile from
  // the left strip, or from the right strip when the left one is empty there. Returns a map one world turn wide.
  function foldHitMap(full, worldW) {
    const { w, h, idx } = full;
    if (worldW >= w) return full;
    const n = full.bb.length / 4, out = new Uint16Array(worldW * h), bb = new Int32Array(n * 4);
    for (let i = 0; i < n; i++) { bb[i * 4] = worldW; bb[i * 4 + 1] = h; bb[i * 4 + 2] = -1; bb[i * 4 + 3] = -1; }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < worldW; x++) {
        let id = idx[y * w + x];
        if (!id && x + worldW < w) id = idx[y * w + x + worldW];
        if (!id) continue;
        out[y * worldW + x] = id;
        const b = id * 4;
        if (x < bb[b]) bb[b] = x;
        if (y < bb[b + 1]) bb[b + 1] = y;
        if (x > bb[b + 2]) bb[b + 2] = x;
        if (y > bb[b + 3]) bb[b + 3] = y;
      }
    }
    return { w: worldW, h, idx: out, bb };
  }

  // tile id at a point given in display-frame pixels (x right, y down). x is taken modulo the loop width.
  function tileAtImage(hit, mapW, mapH, x, y) {
    x = ((x % mapW) + mapW) % mapW;
    if (y < 0 || y >= mapH) return 0;
    const hx = Math.min(hit.w - 1, Math.floor(x / mapW * hit.w));
    const hy = Math.min(hit.h - 1, Math.floor(y / mapH * hit.h));
    return hit.idx[hy * hit.w + hx];
  }

  // 0xAABBGGRR from r,g,b,a (canvas ImageData is little-endian RGBA)
  const pack = (r, g, b, a) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;

  // colour per (state & 15); priority selected > province > hover > claimed
  function makeLut(colours) {
    const lut = new Uint32Array(16);
    for (let s = 1; s < 16; s++) lut[s] = (s & SELECTED) ? colours.selected : (s & PROVINCE) ? colours.province : (s & HOVER) ? colours.hover : colours.claimed;
    return lut;
  }

  function paintTiles(hit, buf32, state, lut, ids) {
    const { w, idx, bb } = hit;
    for (const id of ids) {
      const b = id * 4, x0 = bb[b], y0 = bb[b + 1], x1 = bb[b + 2], y1 = bb[b + 3];
      if (x1 < 0) continue;
      const c = lut[state[id] & 15];
      for (let y = y0; y <= y1; y++) {
        for (let o = y * w + x0, e = y * w + x1; o <= e; o++) if (idx[o] === id) buf32[o] = c;
      }
    }
  }

  // Outline of the selection: pixels of selected / province tiles lying within `t` pixels of anything that is not part of the
  // selection (another tile, sea, or the top/bottom of the map). Wraps horizontally. Drawn over the fill painted by paintTiles.
  function paintOutline(hit, buf32, state, ids, colour, t) {
    const { w, h, idx, bb } = hit, SEL = SELECTED | PROVINCE;
    const inSel = o => { const i = idx[o]; return i !== 0 && (state[i] & SEL) !== 0; };
    for (const id of ids) {
      if (!(state[id] & SEL)) continue;
      const b = id * 4, x0 = bb[b], y0 = bb[b + 1], x1 = bb[b + 2], y1 = bb[b + 3];
      if (x1 < 0) continue;
      for (let y = y0; y <= y1; y++) {
        const row = y * w;
        for (let x = x0; x <= x1; x++) {
          if (idx[row + x] !== id) continue;
          const xl = (x - t + w) % w, xr = (x + t) % w, yu = y - t, yd = y + t;
          if (!inSel(row + xl) || !inSel(row + xr) || yu < 0 || yd >= h || !inSel(yu * w + x) || !inSel(yd * w + x)) buf32[row + x] = colour;
        }
      }
    }
  }

  function paintAll(hit, buf32, state, lut) {
    const idx = hit.idx;
    for (let o = 0; o < idx.length; o++) { const id = idx[o]; buf32[o] = id ? lut[state[id] & 15] : 0; }
  }

  // ── Claim maths (ClickDetect.TileClaim / AddResource) ───────────────────────
  function claimTotals(model, state) {
    const res = new Map(RESOURCES.map(r => [r, 0]));
    let area = 0, population = 0, gdp = 0, claimValue = 0, count = 0;
    for (let id = 1; id < model.tiles.length; id++) {
      if (!(state[id] & CLAIMED)) continue;
      const t = model.tiles[id];
      area += t.Area; population += t.Population; gdp += t.GDP; claimValue += t.ClaimValue; count++;
      for (const r of t.LocalResources) res.set(r.Resource, (res.get(r.Resource) || 0) + r.Yield);
    }
    return { area, population, gdp, claimValue, count, resources: res };
  }

  // population per Culture field ('SubGroup' | 'Language' | ...) over a set of tile ids
  function cultureBreakdown(model, ids, field) {
    const m = new Map();
    for (const id of ids) {
      const t = model.tiles[id];
      const k = findCulture(model, t.Culture)[field];
      m.set(k, (m.get(k) || 0) + t.Population);
    }
    return m;
  }

  function claimedIds(state) {
    const out = [];
    for (let id = 1; id < state.length; id++) if (state[id] & CLAIMED) out.push(id);
    return out;
  }

  // ── Import of a territory PNG ──────────────────────────────────────────────
  // Any resolution, and any of the three frames (see frameOfImage): each tile is sampled where it sits in that image.
  // A tile counts as claimed when the pixel is visible and red.
  function territoryFromImage(model, geo, rgba, w, h) {
    const frame = frameOfImage(geo, w, h), ids = [];
    for (let id = 1; id < model.tiles.length; id++) {
      // either copy of the overlap strip may carry the paint
      if (samplePoints(geo, model.tiles[id], frame, w, h).some(p => { const o = (p.y * w + p.x) * 4; return rgba[o] > 0 && rgba[o + 3] > 0; })) ids.push(id);
    }
    return ids;
  }

  // ── Formatting / wiki export (ClickDetect.SaveClaimData) ───────────────────
  function fmt(n, digits) {
    return Number(n).toLocaleString('en-US', { minimumFractionDigits: digits || 0, maximumFractionDigits: digits || 0 });
  }

  function wikiText(model, state, o) {
    const ids = claimedIds(state);
    const tot = claimTotals(model, state);
    const name = o.name || '';
    const pop = tot.population;
    const speaking = cultureBreakdown(model, ids, 'Language');
    const cultural = cultureBreakdown(model, ids, 'SubGroup');
    let languages = '';
    for (const [k, v] of speaking) if (pop > 0 && v / pop > 0.25) languages += k + '<br/>';
    if (languages === '') languages = 'None';
    let ethnicity = '';
    for (const [k, v] of cultural) ethnicity += (pop > 0 ? fmt(v / pop * 100, 1) : '0.0') + '% ' + k + '<br/>';
    const L = [];
    L.push('{{Nation', '| nation = ' + name, '| localized_name = ', '| full_name = ' + name,
      '| flag = ' + name + '_flag.png', '| flagdesc = Flag of ' + name, '| motto = [Unknown]',
      '| anthem = [Unknown]', '| anthem_MP3 = [Unknown.mp3]', '| map = ' + name + '_Globe.png',
      '| mapdesc = Map of ' + name, '| denonym = ' + name + 'ian', '| capital = ' + (o.capital || ''),
      '| languages = ' + languages, '| currency = ' + name + 'ian Fund', '| government = [Unknown]',
      '| ethnicity = ' + ethnicity, '| population = ' + fmt(pop), '| area = ' + fmt(tot.area),
      '| predecessor = ', '| successor = ', '}}', '');
    L.push('Population Density: ' + fmt(tot.area > 0 ? pop / tot.area : 0, 2) + '/km^2');
    L.push('GDP (Nominal): ' + fmt(tot.gdp) + 'r', '');
    L.push('Resources', 'Population (' + pop + ')');
    for (const [r, y] of tot.resources) L.push(r + ' (' + y + ')');
    L.push('', 'Claim Value: ' + fmt(tot.claimValue) + '/' + fmt(model.claimLimit));
    return L.join('\n') + '\n';
  }

  return {
    RESOURCES, CLAIMED, SELECTED, PROVINCE, HOVER, paintOutline,
    makeGeometry, flatPlacements, tilePoint, frameOfImage, samplePoint, samplePoints, contestedTiles, buildModel, findCulture, buildHitMap, foldHitMap, tileAtImage, pack, makeLut, paintTiles, paintAll,
    claimTotals, cultureBreakdown, claimedIds, territoryFromImage, fmt, wikiText,
  };
});
