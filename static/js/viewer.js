// viewer.js - pan / zoom for the big map, looping horizontally.
//
// The world is P pixels wide (one full turn of longitude). #world holds three copies of it side by side; the
// horizontal offset is wrapped by one world width whenever you pan past it, so the left edge of the view always sits
// inside the first copy and there is never an edge to hit. Each copy is clipped to exactly P columns, so the
// overlap strip built into the images is never drawn twice (translucent layers would otherwise double up).
class Viewer {
  constructor(vp, world, geo, onClick) {
    Object.assign(this, { vp, world, geo, onClick, k: 1, tx: 0, ty: 0, minK: 0.05, maxK: 1.5 });
    world.style.width = (3 * geo.P) + 'px';
    world.style.height = geo.H + 'px';
    this.pointers = new Map();
    this.keys = new Set();
    this.listeners = [];                                       // overlay layers redraw when the view changes
    vp.addEventListener('pointerdown', e => this.down(e));
    vp.addEventListener('pointermove', e => this.move(e));
    vp.addEventListener('pointerup', e => this.up(e));
    vp.addEventListener('pointercancel', e => this.pointers.delete(e.pointerId));
    vp.addEventListener('pointerleave', () => { this.hoverEvent = null; if (this.onHover) this.onHover(null); });
    vp.addEventListener('contextmenu', e => e.preventDefault());
    vp.addEventListener('wheel', e => {
      e.preventDefault();
      this.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    }, { passive: false });
    addEventListener('resize', () => { this.limits(); this.clamp(); this.apply(); });
    addEventListener('keydown', e => { if (!/INPUT|TEXTAREA/.test(document.activeElement.tagName)) this.keys.add(e.key.toLowerCase()); });
    addEventListener('keyup', e => this.keys.delete(e.key.toLowerCase()));
    this.fit();
    requestAnimationFrame(t => this.tick(t));
  }

  // Zoomed out as far as: the whole height visible, and never more than two world turns across (three copies cover that).
  limits() {
    const r = this.vp.getBoundingClientRect();
    this.minK = Math.max(r.height / this.geo.H, r.width / (2 * this.geo.P));
    this.k = Math.min(this.maxK, Math.max(this.minK, this.k));
  }
  fit() {
    this.limits();
    this.k = this.minK;
    const r = this.vp.getBoundingClientRect();
    this.tx = r.width / 2 - this.geo.mx * this.k;            // start centred on 0 degrees longitude
    this.clamp(); this.apply();
  }
  clamp() {
    const r = this.vp.getBoundingClientRect(), h = this.geo.H * this.k, pk = this.geo.P * this.k;
    this.ty = h <= r.height ? (r.height - h) / 2 : Math.min(0, Math.max(r.height - h, this.ty));
    this.tx = -((((-this.tx) % pk) + pk) % pk);               // wrap: the view's left edge is always inside copy 0
  }
  apply() {
    this.world.style.transform = `translate(${this.tx}px,${this.ty}px) scale(${this.k})`;
    for (const l of this.listeners) l.schedule();
  }
  zoomAt(cx, cy, f) {
    const r = this.vp.getBoundingClientRect(), px = cx - r.left, py = cy - r.top;
    const nk = Math.min(this.maxK, Math.max(this.minK, this.k * f));
    this.tx = px - (px - this.tx) * nk / this.k;
    this.ty = py - (py - this.ty) * nk / this.k;
    this.k = nk;
    this.clamp(); this.apply();
  }

  // The part of the unwrapped world on screen, in map pixels, and which world turns (copies) it touches.
  view() {
    const r = this.vp.getBoundingClientRect(), left = -this.tx / this.k, right = (r.width - this.tx) / this.k;
    return { r, left, right, top: -this.ty / this.k, bottom: (r.height - this.ty) / this.k,
             first: Math.floor(left / this.geo.P), last: Math.floor(right / this.geo.P) };
  }
  // map pixels under a screen position; x is unwrapped (take it modulo P)
  toMap(cx, cy) {
    const r = this.vp.getBoundingClientRect();
    return { x: (cx - r.left - this.tx) / this.k, y: (cy - r.top - this.ty) / this.k };
  }

  down(e) {
    this.vp.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, button: e.button, moved: false });
    this.pinched = this.pointers.size > 1 || this.pinched;
  }
  move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) { this.hover(e); return; }                           // no button down: just hovering
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const before = Math.hypot(a.x - b.x, a.y - b.y);
      p.x = e.clientX; p.y = e.clientY;
      const after = Math.hypot(a.x - b.x, a.y - b.y);
      if (before > 0) this.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, after / before);
      this.pinched = true;
      return;
    }
    if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 5) p.moved = true;
    p.x = e.clientX; p.y = e.clientY;
    if (p.moved && (p.button === 0 || p.button === 1)) {
      this.tx += dx; this.ty += dy; this.clamp(); this.apply();
      this.vp.classList.add('panning');
    }
  }
  // Hover: at most one lookup per animation frame, however fast the mouse moves. onHover(x, y) gets map pixels (x unwrapped).
  hover(e) {
    if (!this.onHover || e.pointerType === 'touch') return;
    this.hoverEvent = e;
    if (this.hoverQueued) return;
    this.hoverQueued = true;
    requestAnimationFrame(() => {
      this.hoverQueued = false;
      const ev = this.hoverEvent;
      if (ev) { const m = this.toMap(ev.clientX, ev.clientY); this.onHover(m.x, m.y); }
    });
  }
  up(e) {
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    this.vp.classList.remove('panning');
    if (this.pointers.size === 0) {
      const wasPinch = this.pinched; this.pinched = false;
      if (p && !p.moved && !wasPinch && p.button !== 1) {
        const m = this.toMap(e.clientX, e.clientY);
        this.onClick(m.x, m.y, { button: p.button, shift: e.shiftKey });
      }
    }
  }
  tick(t) {
    const dt = Math.min(50, t - (this.last || t)); this.last = t;
    let dx = 0, dy = 0;
    if (this.keys.has('a') || this.keys.has('arrowleft')) dx += 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) dx -= 1;
    if (this.keys.has('w') || this.keys.has('arrowup')) dy += 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) dy -= 1;
    if (dx || dy) { this.tx += dx * dt * 0.8; this.ty += dy * dt * 0.8; this.clamp(); this.apply(); }
    requestAnimationFrame(t2 => this.tick(t2));
  }
}
