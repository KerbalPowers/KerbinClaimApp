// sheets.js - the Google Sheets (Apps Script) calls. fetchSheet and the #hash override are the ones from the
// language tree (static/js/sheets.js there); the table readers below turn rows into what this app needs.
const Sheets = (() => {
  const cfg = MAP_CONFIG.sheets;
  const PREFIX = 'https://script.google.com/macros/s/';
  const SUFFIX = '/exec';

  function deploymentIdFromHash() {
    const hash = window.location.hash.slice(1).trim();
    if (!hash) return null;
    if (hash.startsWith(PREFIX)) return hash;
    if (/^[A-Za-z0-9_-]{20,}$/.test(hash)) return PREFIX + hash + SUFFIX;
    return null;
  }
  const appsScriptUrl = () => deploymentIdFromHash() || cfg.url;

  async function fetchSheet(sheetName) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), cfg.timeoutMs || 20000);
    try {
      const url = `${appsScriptUrl()}?sheet=${encodeURIComponent(sheetName)}`;
      const res = await fetch(url, { redirect: 'follow', credentials: 'omit', signal: ctl.signal });
      if (!res.ok) throw new Error('Sheet fetch failed: ' + sheetName);
      const rows = await res.json();
      if (!Array.isArray(rows)) throw new Error(`Sheet "${sheetName}" returned ${rows && rows.error ? rows.error : 'no table'}`);
      return rows.map(r => { const o = {}; for (const k in r) o[k.trim()] = r[k]; return o; });   // tolerate padded headers
    } finally { clearTimeout(timer); }
  }

  const txt = v => (v == null ? '' : String(v).trim());
  const hex6 = v => { const m = txt(v).match(/([0-9a-f]{6})$/i); return m ? m[1].toUpperCase() : null; };

  // 'Public' -> one entry per row that carries a colour
  async function cultures() {
    const out = [];
    for (const r of await fetchSheet(cfg.cultures)) {
      const h = hex6(r.Hexcode || r.Hex);
      if (!h) continue;
      out.push({ HexCode: h, Family: txt(r.Family), Group: txt(r.Group), SubGroup: txt(r.SubGroup), Language: txt(r.Language), Dialect: txt(r.Dialect) });
    }
    if (!out.length) throw new Error('no culture rows');
    return out;
  }

  // 'Province Loc' -> Name + Hex (Name Value / Hex Value / Depreciated Names are ignored)
  async function provinces() {
    const out = [];
    for (const r of await fetchSheet(cfg.provinces)) {
      const h = hex6(r.Hex), n = txt(r.Name);
      if (h && n) out.push({ HexCode: h, Name: n });
    }
    if (!out.length) throw new Error('no province rows');
    return out;
  }

  // 'City Loc' -> Name, X, Y
  async function cities() {
    const out = [];
    for (const r of await fetchSheet(cfg.cities)) {
      const x = parseFloat(r.X), y = parseFloat(r.Y), n = txt(r.Name);
      if (n && isFinite(x) && isFinite(y)) out.push({ Name: n, X: x, Y: y });
    }
    if (!out.length) throw new Error('no city rows');
    return out;
  }

  return { cultures, provinces, cities, fetchSheet, appsScriptUrl };
})();
