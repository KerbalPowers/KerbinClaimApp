// cities.js - the Cities layer, drawn from data instead of a raster.
// Each city is a point on the map (pixels in the display frame). Only the cities in view are drawn, at a constant
// on-screen size, once per world turn on screen (so it loops with the map). Labels that would overlap are skipped;
// the same cities win every frame, so nothing flickers.
class CityLayer extends ScreenLayer {
  constructor(viewer) {
    super(viewer, 'city-canvas', 5);
    this.shown = 0;
    this.xs = new Float32Array(0); this.ys = this.xs; this.names = []; this.rank = new Uint32Array(0);
    this.widths = new Map();
  }

  // list: [{Name, X, Y}] in display-frame pixels. X is folded into one world turn, so a city listed twice
  // (once in the overlap strip) is still one city.
  setData(list) {
    const P = this.geo.P, seen = new Set(), items = [];
    for (const c of list) {
      if (!isFinite(c.X) || !isFinite(c.Y)) continue;
      const x = this.geo.wrapX(c.X), key = Math.round(x) + ',' + Math.round(c.Y);
      if (seen.has(key)) continue;
      seen.add(key); items.push({ Name: c.Name || '', X: x, Y: c.Y });
    }
    items.sort((a, b) => a.X - b.X);
    const n = items.length;
    this.xs = new Float32Array(n); this.ys = new Float32Array(n); this.rank = new Uint32Array(n); this.names = new Array(n);
    items.forEach((c, i) => {
      this.xs[i] = c.X; this.ys[i] = c.Y; this.names[i] = c.Name;
      let h = 2166136261;                                   // fixed pseudo-random priority per city
      for (let j = 0; j < c.Name.length; j++) h = Math.imul(h ^ c.Name.charCodeAt(j), 16777619);
      this.rank[i] = (h ^ Math.imul(c.X | 0, 73856093) ^ Math.imul(c.Y | 0, 19349663)) >>> 0;
    });
    this.schedule();
  }
  get count() { return this.names.length; }

  lowerBound(x) {                                            // first index with xs[i] >= x
    let lo = 0, hi = this.xs.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (this.xs[m] < x) lo = m + 1; else hi = m; }
    return lo;
  }

  draw() {
    const { ctx, view, k, tx, ty, geo } = this.prepare(), r = view.r, P = geo.P;
    // cities inside the view (plus a margin so labels hanging over the edge still draw), for each world turn on screen
    const mx = 120 / k;
    const y0 = view.top - mx, y1 = view.bottom + mx;
    const vis = [];                                          // [index, world turn]
    for (let n = view.first; n <= view.last; n++) {
      const lo = view.left - mx - n * P, hi = view.right + mx - n * P;
      for (let i = this.lowerBound(lo); i < this.xs.length && this.xs[i] <= hi; i++) {
        if (this.ys[i] >= y0 && this.ys[i] <= y1) vis.push([i, n]);
      }
    }
    this.shown = vis.length;
    if (!vis.length) return;
    vis.sort((a, b) => this.rank[a[0]] - this.rank[b[0]] || a[1] - b[1]);

    const size = Math.max(3, Math.min(6, Math.round(2 + k * 5)));
    const showLabels = k >= 0.2;
    const fs = k >= 0.6 ? 12 : 11;
    ctx.font = `${fs}px Arial, Helvetica, sans-serif`;
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.lineJoin = 'round';
    const grid = new Map(), CELL = 64;                       // placed label boxes, bucketed to keep overlap tests cheap
    const hits = (x, y, w, h) => {
      for (let gx = Math.floor(x / CELL); gx <= Math.floor((x + w) / CELL); gx++) {
        for (let gy = Math.floor(y / CELL); gy <= Math.floor((y + h) / CELL); gy++) {
          const list = grid.get(gx * 100003 + gy);
          if (list) for (const b of list) if (x < b[0] + b[2] && x + w > b[0] && y < b[1] + b[3] && y + h > b[1]) return true;
        }
      }
      return false;
    };
    const place = (x, y, w, h) => {
      for (let gx = Math.floor(x / CELL); gx <= Math.floor((x + w) / CELL); gx++) {
        for (let gy = Math.floor(y / CELL); gy <= Math.floor((y + h) / CELL); gy++) {
          const key = gx * 100003 + gy; let l = grid.get(key); if (!l) grid.set(key, l = []); l.push([x, y, w, h]);
        }
      }
    };

    const labels = [];
    for (const [i, n] of vis) {
      const sx = tx + (this.xs[i] + n * P) * k, sy = ty + this.ys[i] * k;
      if (sx < -10 || sy < -10 || sx > r.width + 10 || sy > r.height + 10) continue;
      const half = size / 2;
      place(sx - half - 1, sy - half - 1, size + 2, size + 2);         // markers block labels too
      ctx.fillStyle = '#000'; ctx.fillRect(Math.round(sx - half) - 1, Math.round(sy - half) - 1, size + 2, size + 2);
      ctx.fillStyle = '#fff'; ctx.fillRect(Math.round(sx - half), Math.round(sy - half), size, size);
      if (showLabels && this.names[i]) labels.push([i, sx, sy]);
    }
    if (!showLabels) return;
    ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.fillStyle = '#fff';
    for (const [i, sx, sy] of labels) {
      const name = this.names[i];
      let w = this.widths.get(name + fs);
      if (w === undefined) { w = ctx.measureText(name).width; this.widths.set(name + fs, w); }
      const gap = size / 2 + 4;
      let bx = sx + gap;                                               // right of the point, else left
      if (hits(bx - 2, sy - fs / 2 - 1, w + 4, fs + 2)) {
        bx = sx - gap - w;
        if (hits(bx - 2, sy - fs / 2 - 1, w + 4, fs + 2)) continue;
      }
      place(bx - 2, sy - fs / 2 - 1, w + 4, fs + 2);
      ctx.strokeText(name, bx, sy + 0.5); ctx.fillText(name, bx, sy + 0.5);
    }
  }
}
