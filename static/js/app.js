// app.js - wires the config, images and UI together. The logic lives in core.js.
(async function () {
  'use strict';
  const K = KCore;
  const $ = id => document.getElementById(id);

  // ── Theme ──────────────────────────────────────────────────────────────────
  const store = {
    get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };
  document.documentElement.setAttribute('data-theme', store.get('theme') || 'dark');
  $('btn-theme').onclick = () => {
    const t = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', t); store.set('theme', t);
  };

  // ── Orbit spinner (same as the language tree) ──────────────────────────────
  (function spinner() {
    const canvas = $('loader-canvas'), ctx = canvas.getContext('2d');
    const cx = 100, cy = 100, N = 9, a = 44, e = 0.72, PERIOD = 2400, bodyR = 11, dotR = 3.5;
    const b = a * Math.sqrt(1 - e * e), c = a * e;
    const kepler = M => { let E = M; for (let i = 0; i < 60; i++) { const d = (M - E + e * Math.sin(E)) / (1 - e * Math.cos(E)); E += d; if (Math.abs(d) < 1e-10) break; } return E; };
    const orbit = t => { const E = kepler(2 * Math.PI * (t % PERIOD) / PERIOD); return [a * Math.cos(E) - c, b * Math.sin(E)]; };
    function frame(ts) {
      if ($('loader').classList.contains('hidden')) return;
      const st = getComputedStyle(document.documentElement);
      ctx.clearRect(0, 0, 200, 200); ctx.save(); ctx.translate(cx, cy);
      const dots = [];
      for (let i = 0; i < N; i++) {
        const [lx, ly] = orbit(ts + i * PERIOD / N), ang = i * 2 * Math.PI / N;
        const x = lx * Math.cos(ang) - ly * Math.sin(ang), y = lx * Math.sin(ang) + ly * Math.cos(ang);
        dots.push({ x, y, d: Math.hypot(x, y) });
      }
      ctx.fillStyle = st.getPropertyValue('--text');
      dots.sort((p, q) => q.d - p.d).forEach(d => { if (d.d < bodyR - dotR * 0.6) return; ctx.beginPath(); ctx.arc(d.x, d.y, dotR, 0, 7); ctx.fill(); });
      ctx.fillStyle = st.getPropertyValue('--text-dim'); ctx.beginPath(); ctx.arc(0, 0, bodyR, 0, 7); ctx.fill();
      ctx.restore(); requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  })();

  const status = m => { $('loader-msg').textContent = m; };
  function fail(html) {
    const p = $('loader-msg'); p.className = 'err'; p.innerHTML = html;
  }
  let toastTimer;
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 4000);
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ── State ──────────────────────────────────────────────────────────────────
  let cfg, geo, model, hit, viewer, cities = [], cityLayer, gridLayer, highlight, wikiLayer;
  const sheetNotes = [];
  let state, lut, hctx, himg, buf32;
  let mode = 0, tapAction = 'add', lastClaimed = 0, wikiClaimed = null;
  let inspectIds = [];

  // ── Load config + images ───────────────────────────────────────────────────
  try {
    status('Reading config…');
    cfg = Sources.cfg;
    geo = K.makeGeometry(await Sources.getJson('config/geometry.json'));
    const man = await Sources.getJson('config/manifest.json');
    const content = p => Sources.getJson(p).then(j => j.Content);
    // Names come from the language sheet's API (same endpoint as the language tree). If a table can't be reached
    // the bundled copy in config/ is used instead, so the map still works offline.
    const viaSheet = async (call, fallbackPath, label) => {
      try { return await call(); }
      catch (e) {
        console.warn(`${label}: sheet unavailable (${e.message}); using bundled copy`);
        sheetNotes.push(label);
        return content(fallbackPath);
      }
    };
    const [tileFiles, continentNames, provinceNames, cultures, limit, cityList] = await Promise.all([
      Promise.all(man.tiles.map(f => content('config/' + f))),
      content('config/localisation/Continents.json'),
      viaSheet(() => Sheets.provinces(), 'config/localisation/Provinces.json', 'province names'),
      viaSheet(() => Sheets.cultures(), 'config/localisation/Cultures.json', 'cultures'),
      content('config/Limit.json'),
      Sheets.cities().catch(e => {                       // the city table may not exist yet: quietly use the bundled list
        console.info(`cities: sheet unavailable (${e.message}); using config/cities.json`);
        return content('config/cities.json').catch(() => []);
      }),
    ]);
    cities = cityList;
    model = K.buildModel({ tileFiles, continentNames, provinceNames, cultures, limit });
    if (model.warnings.length) console.warn('config warnings:', model.warnings);
  } catch (err) {
    fail('Couldn\'t load the config: ' + esc(err.message) + '<br><small>Serve the site over http(s) rather than opening index.html from disk.</small>');
    return;
  }

  try {
    status('Loading tile map…');
    hit = await buildHit();
  } catch (err) {
    const url = Sources.mapUrl('Tiles');
    fail(url
      ? 'Couldn\'t load the tile map (<code>' + esc(url) + '</code>).<br>' + esc(err.message) +
        '<br><small>Check the link in <code>static/js/maps.config.js</code>. The host must allow cross-origin image reads, as Dropbox does.</small>'
      : 'No tile map address set.<br><small>Paste the Dropbox link for <code>Tiles.png</code> into <code>urls.Tiles</code> in <code>static/js/maps.config.js</code>.</small>');
    return;
  }

  async function buildHit() {
    if (!Sources.mapUrl('Tiles')) throw new Error('urls.Tiles is empty');
    const img = await Sources.loadImage(Sources.mapUrl('Tiles'));
    const shape = img.naturalWidth / img.naturalHeight;
    if (Math.abs(shape - geo.W / geo.H) > 0.01 * (geo.W / geo.H)) {
      const old = Math.abs(shape - geo.tile.W / geo.tile.H) < 0.01 * shape;
      throw new Error(`the tile map is ${img.naturalWidth}x${img.naturalHeight} but config/geometry.json says ${geo.W}x${geo.H}` +
        (old ? ' - that is the OLD map shape. Tiles.png has to be re-made in the new frame so it lines up with the other layers.' : ''));
    }
    // Read the WHOLE image, overlap strip included, then merge the two copies of the strip (see foldHitMap): where one copy is
    // transparent the other still supplies the tile, so no tile is lost whichever side of the loop it is drawn on.
    let wFull = Math.min(img.naturalWidth, Math.round(geo.W * cfg.hitScale));
    let lastErr = new Error('no pixels');
    for (let attempt = 0; attempt < 4; attempt++, wFull = Math.round(wFull / 2)) {
      const h = Math.round(wFull * geo.H / geo.W);
      try {
        const cv = document.createElement('canvas'); cv.width = wFull; cv.height = h;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        ctx.imageSmoothingEnabled = false;
        let src = img;
        try { src = await createImageBitmap(img, { colorSpaceConversion: 'none' }); } catch (e) { /* draw the element instead */ }
        ctx.drawImage(src, 0, 0, wFull, h);
        const data = ctx.getImageData(0, 0, wFull, h).data;
        const full = K.buildHitMap(data, wFull, h, model);
        let seen = 0;
        for (let id = 1; id < model.tiles.length; id++) if (full.bb[id * 4 + 2] >= 0) seen++;
        if (seen < model.tiles.length * 0.5) throw new Error(`only ${seen} of ${model.tiles.length - 1} tiles found in the tile map - wrong image, or colours were altered`);
        return K.foldHitMap(full, Math.round(wFull * geo.P / geo.W));
      } catch (e) { lastErr = e; }   // canvas too big for this browser, or bad pixels: retry smaller
    }
    throw lastErr;
  }

  // ── Map layers ─────────────────────────────────────────────────────────────
  const world = $('world');
  const LAYERS = [
    { key: 'Language', label: 'Culture', icon: 'Culture', opacity: .43, group: 'data' },
    { key: 'Climate', label: 'Climate', icon: 'Climate', opacity: .43, group: 'data' },
    { key: 'Rivers', label: 'Rivers', icon: 'Rivers', opacity: .43, group: 'data' },
    { key: 'Grid', label: 'Grid', icon: 'Globe', vector: () => gridLayer },
    { key: 'Cities', label: 'Cities', icon: 'City', vector: () => cityLayer },
  ];
  // Four copies of the images, one per world turn (-1..2), placed P apart. The images are W wide, so neighbours overlap by the
  // strip that was built in for looping; transparency lets the two combine. The copy at -1 supplies the strip that belongs at the
  // very left. An image layer puts one <img> in each copy; the browser decodes the file once.
  const copies = [-1, 0, 1, 2].map(i => {
    const d = document.createElement('div'); d.className = 'copy';
    d.style.left = (i * geo.P) + 'px'; d.style.width = geo.P + 'px'; d.style.height = geo.H + 'px';
    world.appendChild(d); return d;
  });
  // `places` = rectangles inside one copy (default: the whole display frame). The browser decodes a file once however many <img> use it.
  function addImg(extra, places, parent) {
    places = places || [{ left: 0, top: 0, width: geo.W, height: geo.H }];       // any resolution stretches to the display frame
    const els = [];
    for (const c of (parent ? [parent] : copies)) {
      for (const p of places) {
        const im = document.createElement('img');
        im.className = 'layer'; im.hidden = true; im.decoding = 'async'; im.alt = '';
        Object.assign(im.style, { left: p.left + 'px', top: p.top + 'px', width: p.width + 'px', height: p.height + 'px' }, extra || {});
        if (parent) im.style.zIndex = '0';                      // base map: always underneath the layer copies, whatever order they were added in
        c.appendChild(im); els.push(im);
      }
    }
    return {
      get src() { return els[0].getAttribute('src') || ''; }, set src(u) { els.forEach(e => { e.src = u; }); },
      set hidden(b) { els.forEach(e => { e.hidden = b; }); }, set onerror(f) { els[0].onerror = f; },
    };
  }
  // The base map. If geometry.json has a `flatMap` block it is a picture in its own frame (the original 12288 wide one that starts
  // at the 180 degree line): read its size, work out where it sits and where it repeats, then place it. Otherwise it is
  // simply stretched over the display frame like the other layers.
  function showBaseMap() {
    const url = Sources.mapUrl('FlatMap');
    if (!url) { toast('urls.FlatMap is empty in static/js/maps.config.js'); return; }
    const fail = () => toast('Base map failed to load - check urls.FlatMap in static/js/maps.config.js');
    if (!geo.flat) { const b = addImg(); b.onerror = fail; b.hidden = false; b.src = url; return; }
    const probe = new Image();
    probe.onload = () => {
      const b = addImg(null, K.flatPlacements(geo, probe.naturalWidth, probe.naturalHeight, -geo.P, 3 * geo.P), world);
      b.onerror = fail; b.hidden = false; b.src = url;
    };
    probe.onerror = fail;
    probe.src = url;
  }
  showBaseMap();
  for (const L of LAYERS) { if (!L.vector) L.el = addImg({ opacity: L.opacity }); L.on = false; }

  const hc = document.createElement('canvas');
  hc.width = hit.w; hc.height = hit.h;                       // one world turn at hit resolution; drawn to screen by HighlightLayer
  hctx = hc.getContext('2d');
  himg = hctx.createImageData(hit.w, hit.h);
  buf32 = new Uint32Array(himg.data.buffer);
  state = new Uint8Array(model.tiles.length);
// Everything is monochrome white: claimed territory = a white wash with a thin outline round the whole claimed area; the inspect
  // selection = a stronger wash (tile) / lighter wash (rest of its province) with a thicker outline; hover = a faint wash.
  // Claims are only drawn in Claim mode: in Inspect mode they are hidden (the CLAIMED bits stay in `state`, so nothing is lost)
  // and come straight back when Claim mode is re-entered. Two lookup tables, swapped by setMode.
  const base = { hover: K.pack(255, 255, 255, 65), selected: K.pack(255, 255, 255, 185), province: K.pack(255, 255, 255, 115) };
  const lutClaim = K.makeLut(Object.assign({ claimed: K.pack(255, 255, 255, 100), claimedHover: K.pack(255, 255, 255, 135) }, base));
  const lutInspect = K.makeLut(Object.assign({ claimed: 0, claimedHover: base.hover }, base));
  lut = lutInspect;
  const LINE = K.pack(255, 255, 255, 255), CLAIM_PX = 2, SELECT_PX = 4;

  function flush(ids) {
    if (highlight) highlight.schedule();
    if (!ids) { hctx.putImageData(himg, 0, 0); return; }
    let x0 = hit.w, y0 = hit.h, x1 = -1, y1 = -1;
    for (const id of ids) {
      const b = id * 4; if (hit.bb[b + 2] < 0) continue;
      x0 = Math.min(x0, hit.bb[b]); y0 = Math.min(y0, hit.bb[b + 1]); x1 = Math.max(x1, hit.bb[b + 2]); y1 = Math.max(y1, hit.bb[b + 3]);
    }
    if (x1 >= 0) hctx.putImageData(himg, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
  }
  const outlines = ids => {
    if (mode === 1) K.paintOutline(hit, buf32, state, ids, LINE, CLAIM_PX, K.CLAIMED);
    K.paintOutline(hit, buf32, state, ids, LINE, SELECT_PX);
  };
  // Outlines run along tile edges, so changing a tile also changes the outline of any claimed/selected tile touching it:
  // those are repainted with it. (A big change, e.g. Claim All, just repaints everything.)
  function repaint(ids) {
    if (ids.length > 40) { repaintAll(); return; }
    const set = new Set(ids), pad = Math.max(CLAIM_PX, SELECT_PX) + 1, bb = hit.bb;
    for (let j = 1; j < state.length; j++) {
      if (set.has(j) || !(state[j] & (K.CLAIMED | K.SELECTED | K.PROVINCE)) || bb[j * 4 + 2] < 0) continue;
      for (const i of ids) {
        const a = i * 4, c = j * 4;
        if (bb[a + 2] < 0) continue;
        if (bb[c] <= bb[a + 2] + pad && bb[c + 2] >= bb[a] - pad && bb[c + 1] <= bb[a + 3] + pad && bb[c + 3] >= bb[a + 1] - pad) { set.add(j); break; }
      }
    }
    const all = [...set];
    K.paintTiles(hit, buf32, state, lut, all); outlines(all); flush(all);
  }
  function repaintAll() {
    K.paintAll(hit, buf32, state, lut);
    const marked = []; for (let i = 1; i < state.length; i++) if (state[i] & (K.CLAIMED | K.SELECTED | K.PROVINCE)) marked.push(i);
    outlines(marked); flush();
  }

  const layerBox = $('layers');
  // Key (legend) images, bottom right: one per active Culture / Climate layer, and one in Claim mode. Their links are
  // urls.KeyLanguage / urls.KeyClimate / urls.KeyClaim in maps.config.js, next to the maps. Unset = nothing shown.
  const keyBox = $('keys'), keyEls = {};
  function updateKeys() {
    const want = LAYERS.filter(L => L.on && L.key !== 'Rivers' && !L.vector).map(L => 'Key' + L.key);
    if (mode === 1) want.push('KeyClaim');
    for (const k of want) {
      if (keyEls[k] || !Sources.mapUrl(k)) continue;
      const im = document.createElement('img'); im.className = 'key-img'; im.alt = k.slice(3) + ' key';
      im.onerror = () => { im.remove(); keyEls[k] = null; updateKeys(); };
      im.src = Sources.mapUrl(k); keyEls[k] = im; keyBox.appendChild(im);
    }
    let any = false;
    for (const k in keyEls) if (keyEls[k]) { const on = want.includes(k); keyEls[k].hidden = !on; any = any || on; }
    keyBox.hidden = !any;
  }
  function setLayer(L, on) {
    if (L.vector) { L.on = on; L.vector().setVisible(on); L.btn.setAttribute('aria-pressed', on); updateKeys(); return; }
    if (on && !Sources.mapUrl(L.key)) { toast(`${L.label} layer has no address - set urls.${L.key} in static/js/maps.config.js`); return; }
    L.on = on;
    if (on && !L.el.src) { L.el.onerror = () => toast(`${L.label} layer failed to load - check urls.${L.key} in static/js/maps.config.js`); L.el.src = Sources.mapUrl(L.key); }
    L.el.hidden = !on; L.btn.setAttribute('aria-pressed', on); updateKeys();
  }
  for (const L of LAYERS) {
    const b = document.createElement('button'); b.className = 'lb'; b.setAttribute('aria-pressed', 'false'); b.title = L.label + ' layer';
    const i = document.createElement('img'); i.className = 'icon'; i.alt = ''; i.src = Sources.iconUrl(L.icon); i.onerror = () => i.remove(); b.appendChild(i);
    const s = document.createElement('span'); s.textContent = L.label; b.appendChild(s);
    b.onclick = () => {
      const on = !L.on;
      if (on && L.group) LAYERS.filter(o => o.group === L.group && o !== L).forEach(o => setLayer(o, false));
      setLayer(L, on);
    };
    L.btn = b; layerBox.appendChild(b);
  }
  // icons elsewhere
  for (const [id, key] of [['logo', 'Logo'], ['ic-Erase', 'Erase'], ['ic-Save', 'Save']]) {
    const el = $(id); el.onerror = () => { el.hidden = true; }; el.src = Sources.iconUrl(key); el.hidden = false;
  }

  viewer = new Viewer($('viewport'), world, geo, onMapClick);
  highlight = new HighlightLayer(viewer, hc);
  wikiLayer = new FrameLayer(viewer, 'wiki-canvas', 2);
  gridLayer = new GridLayer(viewer);
  cityLayer = new CityLayer(viewer);
  cityLayer.setData(cities);
  $('btn-fit').onclick = () => viewer.fit();

  // Hover: a faint highlight on the tile under the mouse. Only that tile's own pixels are repainted, and only when the tile changes.
  let hoverId = 0;
  viewer.onHover = (x, y) => {
    const id = x == null ? 0 : K.tileAtImage(hit, geo.P, geo.H, x, y);
    if (id === hoverId) return;
    const old = hoverId; hoverId = id;
    if (old) state[old] &= ~K.HOVER;
    if (id) state[id] |= K.HOVER;
    repaint([old, id].filter(Boolean));
  };

  // ── Rows helper ────────────────────────────────────────────────────────────
  function rows(box, pairs) {
    box.textContent = '';
    box.className = 'rows';
    for (const [k, v] of pairs) {
      const dt = document.createElement('dt'); dt.textContent = k;
      const dd = document.createElement('dd'); dd.textContent = v; if (String(v).includes('\n')) dd.className = 'stack';
      box.append(dt, dd);
    }
  }
  const N = K.fmt;

  // ── Inspect ────────────────────────────────────────────────────────────────
  function inspect(id, province) {
    const dirty = inspectIds.slice();
    for (const i of inspectIds) state[i] &= ~(K.SELECTED | K.PROVINCE);
    inspectIds = [id];
    const t = model.tiles[id], p = model.provinces[t.provId];
    if (province) for (const i of p.tileIds) { state[i] |= K.PROVINCE; inspectIds.push(i); }
    state[id] |= K.SELECTED;
    repaint(dirty.concat(inspectIds));

    const cul = K.findCulture(model, t.Culture);
    const lat = t.Coordinates.y, lon = t.Coordinates.x;
    rows($('tile-rows'), [
      ['Tile', t.HexCode], ['Continent', model.continents[t.contId].name],
      ['Area', N(t.Area) + ' km²'],
      ['Position', Math.abs(lat).toFixed(3) + '° ' + (lat >= 0 ? 'N' : 'S') + ', ' + Math.abs(lon).toFixed(3) + '° ' + (lon >= 0 ? 'E' : 'W')],
      ['Terrain', t.Terrain], ['Altitude', N(t.Altitude) + ' m'], ['Population', N(t.Population)],
      ['Culture', cul.Dialect ? cul.Dialect + ' (' + cul.Language + ')' : (cul.Language || cul.SubGroup || 'Undefined')], ['GDP', N(t.GDP) + 'r'],
      ['Resources', t.LocalResources.length ? t.LocalResources.map(r => r.Resource + ' (' + r.Yield + ')').join('\n') : 'None'],
      ['Claim value', N(t.ClaimValue)],
    ]);
    // Panels show only what's relevant: a plain click = tile only; Shift+click = tile AND its province.
    $('inspect-help').hidden = true;
    $('tile-panel').hidden = false;
    if (province) {
      const by = K.cultureBreakdown(model, p.tileIds, 'SubGroup');
      const pop = p.tileIds.reduce((s, i) => s + model.tiles[i].Population, 0);
      const cultures = [...by].sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' (' + (pop ? N(v / pop * 100, 1) : '0.0') + '%)').join('\n');
      $('prov-title').textContent = 'Province';
      rows($('prov-rows'), [['Name', p.name], ['Tiles', p.tileIds.length], ['Area', N(p.area) + ' km²'], ['Population', N(p.population)],
        ['Continent', p.contHex && model.continents[p.contId].name], ['Cultures', cultures]]);
    }
    $('prov-panel').hidden = !province;
  }

  // ── Claim ──────────────────────────────────────────────────────────────────
  const preventBox = $('prevent');
  function claimIds(ids, add) {
    const touched = [];
    for (const id of ids) {
      if (add) {
        if (state[id] & K.CLAIMED) continue;
        if (preventBox.checked && wikiClaimed && wikiClaimed[id]) continue;
        state[id] |= K.CLAIMED; lastClaimed = id;
      } else {
        if (!(state[id] & K.CLAIMED)) continue;
        state[id] &= ~K.CLAIMED;
      }
      touched.push(id);
    }
    return touched;
  }
  function updateClaimUI() {
    const tot = K.claimTotals(model, state), limit = model.claimLimit, f = tot.claimValue / limit;
    $('claim-fill').style.width = Math.min(100, f * 100) + '%';
    document.querySelector('.bar').classList.toggle('full', f > 1);
    $('claim-pct').textContent = N(f * 100, 1) + '%  ·  ' + N(tot.claimValue) + ' / ' + N(limit);
    const pairs = [['Tiles', N(tot.count)], ['Area', N(tot.area) + ' km²'], ['Population', N(tot.population)], ['GDP', N(tot.gdp) + 'r']];
    for (const [r, y] of tot.resources) pairs.push([r, N(y)]);
    rows($('claim-rows'), pairs);
  }
  function claim(id, add, province) {
    const ids = province ? model.provinces[model.tiles[id].provId].tileIds : [id];
    const touched = claimIds(ids, add);
    if (!touched.length && add && preventBox.checked && wikiClaimed && ids.every(i => wikiClaimed[i])) toast('Already claimed on the wiki (Prevent contest is on)');
    repaint(touched); updateClaimUI();
  }

  function onMapClick(x, y, ev) {
    const id = K.tileAtImage(hit, geo.P, geo.H, x, y);          // x wraps: clicking any copy of the world hits the same tile
    if (!id) return;
    if (mode === 0) { if (ev.button === 0) inspect(id, ev.shift); }
    else claim(id, ev.button === 2 ? false : tapAction === 'add', ev.shift);
  }

  function setMode(m) {
    mode = m;
    $('mode-inspect').classList.toggle('active', m === 0);
    $('mode-claim').classList.toggle('active', m === 1);
    $('claim-panel').hidden = m !== 1; updateKeys();
    lut = m === 1 ? lutClaim : lutInspect;
    $('inspect-help').hidden = m !== 0 || inspectIds.length > 0;      // the hint only shows while nothing is selected
    if (m === 1) {
      for (const i of inspectIds) state[i] &= ~(K.SELECTED | K.PROVINCE);
      const old = inspectIds; inspectIds = []; repaint(old);
      $('tile-panel').hidden = $('prov-panel').hidden = true;      // Claim mode shows neither tile nor province info
      if (cfg.claimedMapUrl) wikiLayer.show(Sources.direct(cfg.claimedMapUrl), toast);
      updateClaimUI();
    } else wikiLayer.setVisible(false);
    repaintAll();                                              // show / hide the claimed highlight for the new mode
  }
  $('mode-inspect').onclick = () => setMode(0);
  $('mode-claim').onclick = () => setMode(1);
  document.querySelectorAll('#tap-action button').forEach(b => b.onclick = () => {
    tapAction = b.dataset.a;
    document.querySelectorAll('#tap-action button').forEach(o => o.classList.toggle('active', o === b));
  });

  $('btn-all').onclick = () => {
    const ids = []; for (let i = 1; i < model.tiles.length; i++) ids.push(i);
    claimIds(ids, true); repaintAll(); updateClaimUI();
  };
  $('btn-clear').onclick = () => {
    for (let i = 1; i < state.length; i++) state[i] &= ~K.CLAIMED;
    lastClaimed = 0; repaintAll(); updateClaimUI();
  };

  // ── Export / import ────────────────────────────────────────────────────────
  function download(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  $('btn-export').onclick = () => {
    const ids = K.claimedIds(state);
    if (!ids.length) { toast('Nothing claimed yet'); return; }
    const name = $('claim-name').value.trim();
    const safe = (name || 'Claim').replace(/[^\w\-]+/g, '_');
    const cap = (state[lastClaimed] & K.CLAIMED) ? lastClaimed : ids[0];
    const text = K.wikiText(model, state, { name, capital: model.provinces[model.tiles[cap].provId].name });
    download(new Blob([text], { type: 'text/plain' }), safe + '.txt');
    const cv = document.createElement('canvas'); cv.width = hit.w; cv.height = hit.h;
    const cx = cv.getContext('2d'), img = cx.createImageData(hit.w, hit.h), b32 = new Uint32Array(img.data.buffer);
    const red = K.pack(255, 0, 0, 255), idx = hit.idx;
    for (let o = 0; o < idx.length; o++) if (idx[o] && (state[idx[o]] & K.CLAIMED)) b32[o] = red;
    cx.putImageData(img, 0, 0);
    cv.toBlob(b => { setTimeout(() => download(b, safe + '_Territory.png'), 300); toast(`Saved ${safe}.txt and ${safe}_Territory.png`); }, 'image/png');
  };
  $('btn-import').onclick = () => $('file-import').click();
  $('file-import').onchange = async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    const url = URL.createObjectURL(f);
    try {
      const img = await Sources.loadImage(url);
      const w = Math.min(img.naturalWidth, 6144), h = Math.round(w * img.naturalHeight / img.naturalWidth);
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const cx = cv.getContext('2d', { willReadFrequently: true }); cx.imageSmoothingEnabled = false; cx.drawImage(img, 0, 0, w, h);
      const ids = K.territoryFromImage(model, geo, cx.getImageData(0, 0, w, h).data, w, h);
      for (let i = 1; i < state.length; i++) state[i] &= ~K.CLAIMED;
      if (ids.length > model.tiles.length * 0.98) toast('That image is red everywhere - it has probably lost its transparency');
      claimIds(ids, true); repaintAll(); updateClaimUI();
      toast(`Imported ${N(ids.length)} tiles`);
    } catch (err) { toast('Import failed: ' + err.message); }
    URL.revokeObjectURL(url);
  };

  // ── Wiki claim map (for "Prevent contest") ─────────────────────────────────
  (async function loadWiki() {
    const note = $('prevent-note');
    if (!cfg.claimedMapUrl) { preventBox.disabled = true; note.textContent = '(no claim map configured)'; return; }
    try {
      const img = await Sources.loadImage(Sources.direct(cfg.claimedMapUrl));
      const w = Math.min(img.naturalWidth, 6144), h = Math.round(w * img.naturalHeight / img.naturalWidth), cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const cx = cv.getContext('2d', { willReadFrequently: true }); cx.imageSmoothingEnabled = false; cx.drawImage(img, 0, 0, w, h);
      const d = cx.getImageData(0, 0, w, h).data, frame = K.frameOfImage(geo, w, h);
      // Prevent contest: the first painted pixel of each tile decides, and only the contest colour (cfg.contestColour, 7F0000) counts
      const hexc = (cfg.contestColour || '7F0000').replace('#', ''), rgb = [0, 2, 4].map(i => parseInt(hexc.substr(i, 2), 16));
      wikiClaimed = K.contestedTiles(model, geo, hit, d, w, h, frame, rgb);
    } catch (e) {
      preventBox.disabled = true; note.textContent = '(claim map unreadable - needs CORS)';
    }
  })();

  // ── Go ─────────────────────────────────────────────────────────────────────
  setMode(0);
  $('loader').classList.add('hidden');
  if (sheetNotes.length) toast(`Couldn't reach the language sheet for ${sheetNotes.join(' and ')} - using the bundled copy`);
})();
