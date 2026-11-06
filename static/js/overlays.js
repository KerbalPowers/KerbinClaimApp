// overlays.js - layers drawn on a canvas the size of the screen, from data rather than from images.
// Each one is redrawn (once per frame at most) when the view changes, and draws one copy of its content for every
// world turn that is on screen, which is what makes them loop with the map.

class ScreenLayer {
  constructor(viewer, id, z) {
    this.v = viewer; this.geo = viewer.geo;
    this.visible = false; this.pending = false;
    const c = this.canvas = document.createElement('canvas');
    c.id = id; c.className = 'screen-layer'; c.style.zIndex = z;
    viewer.vp.parentNode.insertBefore(c, viewer.vp.nextSibling);
    viewer.listeners.push(this);
    c.hidden = true;
  }
  setVisible(on) { this.visible = on; this.canvas.hidden = !on; if (on) this.schedule(); else this.clear(); }
  clear() { const c = this.canvas; c.getContext('2d').setTransform(1, 0, 0, 1, 0, 0); c.getContext('2d').clearRect(0, 0, c.width, c.height); }
  schedule() {
    if (!this.visible || this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => { this.pending = false; if (this.visible) this.draw(); });
  }
  // size the canvas to the viewport, clear it, and return what drawing needs
  prepare() {
    const v = this.v, view = v.view(), dpr = window.devicePixelRatio || 1, c = this.canvas, ctx = c.getContext('2d');
    const w = Math.round(view.r.width * dpr), h = Math.round(view.r.height * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, view.r.width, view.r.height);
    return { ctx, view, k: v.k, tx: v.tx, ty: v.ty, geo: this.geo };
  }
}

// ── Latitude / longitude graticule (replaces the LatLong raster) ─────────────
class GridLayer extends ScreenLayer {
  constructor(viewer) { super(viewer, 'grid-canvas', 4); }

  draw() {
    const { ctx, view, k, tx, ty, geo } = this.prepare(), r = view.r;
    const perDeg = geo.ppd * k;                                      // screen pixels per degree
    const steps = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 45, 90];
    const step = steps.find(s => s * perDeg >= 70) || 90;
    const top = Math.max(0, ty), bottom = Math.min(r.height, ty + geo.H * k);
    ctx.lineJoin = 'round';

    const label = (text, x, y, align) => {
      ctx.font = '11px Arial, Helvetica, sans-serif'; ctx.textAlign = align; ctx.textBaseline = 'middle';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.strokeText(text, x, y);
      ctx.fillStyle = '#fff'; ctx.fillText(text, x, y);
    };
    const style = (deg, special) => {
      if (special) { ctx.strokeStyle = 'rgba(255,190,70,.95)'; ctx.lineWidth = 1.5; }
      else if (Math.abs(deg % 30) < 1e-9) { ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1; }
      else { ctx.strokeStyle = 'rgba(255,255,255,.38)'; ctx.lineWidth = 1; }
    };
    const fmt = n => (Number.isInteger(n) ? String(n) : String(+n.toFixed(2)));

    // meridians: loop, so just keep going past +/-180 and fold the label back
    const lonA = Math.ceil(geo.xToLon(view.left) / step) * step, lonB = geo.xToLon(view.right);
    for (let lon = lonA; lon <= lonB + 1e-9; lon += step) {
      const x = Math.round(tx + geo.lonToX(lon) * k) + 0.5;
      const folded = ((lon + 180) % 360 + 360) % 360 - 180;           // -180 <= folded < 180
      style(folded, folded === 0);
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
      const a = Math.abs(folded === -180 ? 180 : folded);
      label(fmt(a) + '°' + (folded === 0 || a === 180 ? '' : folded > 0 ? 'E' : 'W'), x + 3, top + 9, 'left');
    }
    // parallels
    const latA = Math.ceil(geo.yToLat(geo.H) / step) * step, latB = geo.yToLat(0);
    for (let lat = latA; lat <= latB + 1e-9; lat += step) {
      const y = Math.round(ty + geo.latToY(lat) * k) + 0.5;
      if (y < 0 || y > r.height) continue;
      style(lat, Math.abs(lat) < 1e-9);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(r.width, y); ctx.stroke();
      label(fmt(Math.abs(lat)) + '°' + (lat === 0 ? '' : lat > 0 ? 'N' : 'S'), 4, y - 7, 'left');
    }
  }
}

// ── Claim / selection highlight ─────────────────────────────────────────────
// The colours live in one hit-resolution canvas covering one world turn (P x H). Each frame the visible part of it is
// drawn once per world turn on screen.
class HighlightLayer extends ScreenLayer {
  constructor(viewer, source) {
    super(viewer, 'highlight-canvas', 3);
    this.src = source;
    this.visible = true; this.canvas.hidden = false;
  }
  draw() {
    const { ctx, view, k, tx, ty, geo } = this.prepare();
    const s = this.src, P = geo.P, H = geo.H;
    ctx.imageSmoothingEnabled = false;
    const y0 = Math.max(0, Math.floor(view.top / H * s.height)), y1 = Math.min(s.height, Math.ceil(view.bottom / H * s.height));
    if (y1 <= y0) return;
    for (let n = view.first; n <= view.last; n++) {
      const a = Math.max(0, Math.floor((view.left - n * P) / P * s.width)), b = Math.min(s.width, Math.ceil((view.right - n * P) / P * s.width));
      if (b <= a) continue;
      ctx.drawImage(s, a, y0, b - a, y1 - y0,
        tx + (n * P + a / s.width * P) * k, ty + (y0 / s.height * H) * k, (b - a) / s.width * P * k, (y1 - y0) / s.height * H * k);
    }
  }
}

// ── An image in any of the known frames, placed on the display frame and looped ──
// Used for the wiki's claimed-territory map, which is a picture in the OLD frame (12288x6144, different meridian and
// trim). A full-frame image keeps its overlap strip, so neighbouring turns overlap and combine through transparency.
class FrameLayer extends ScreenLayer {
  constructor(viewer, id, z) {
    super(viewer, id, z);
    this.canvas.style.opacity = .34;
    this.img = null; this.url = '';
  }
  show(url, onError) {
    this.setVisible(true);
    if (this.url === url) { this.schedule(); return; }
    this.url = url;
    const im = new Image();                                  // plain load: showing a picture needs no CORS
    im.onload = () => { this.img = im; this.schedule(); };
    im.onerror = () => { this.url = ''; if (onError) onError("Couldn't load the claimed-territory map"); };
    im.src = url;
  }
  draw() {
    if (!this.img) return;
    const { ctx, view, k, tx, ty, geo } = this.prepare(), img = this.img, w = img.naturalWidth, h = img.naturalHeight;
    const frame = KCore.frameOfImage(geo, w, h);
    // image pixel -> display pixel:  x = ox + xi*s,  y = oy + yi*s
    let s, ox, oy;
    if (frame === 'legacy') { s = geo.ppd / geo.tile.ppd; ox = geo.mx - geo.tile.mx * s; oy = geo.eq - (geo.tile.H - geo.tile.eq) * s; }
    else { s = (frame === 'full' ? geo.W : geo.P) / w; ox = 0; oy = 0; }
    const iw = w * s, ih = h * s;
    ctx.imageSmoothingEnabled = false;
    for (let m = view.first - 2; m <= view.last + 1; m++) {
      const dx0 = ox + m * geo.P;
      const vx0 = Math.max(dx0, view.left), vx1 = Math.min(dx0 + iw, view.right);
      const vy0 = Math.max(oy, view.top), vy1 = Math.min(oy + ih, view.bottom);
      if (vx1 <= vx0 || vy1 <= vy0) continue;
      ctx.drawImage(img, (vx0 - dx0) / s, (vy0 - oy) / s, (vx1 - vx0) / s, (vy1 - vy0) / s,
        tx + vx0 * k, ty + vy0 * k, (vx1 - vx0) * k, (vy1 - vy0) * k);
    }
  }
}
