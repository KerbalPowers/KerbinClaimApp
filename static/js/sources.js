// sources.js - turns the links in maps.config.js into images. The loader is the one from the
// language-tree project (map.js): a plain Image with crossOrigin='anonymous' pointed at a dl.dropbox.com
// link, so the pixels can be read back from a canvas.
const Sources = (() => {
  // Accepts a Dropbox share link as pasted from "Copy link" and returns the direct dl.dropbox.com form. It also copes with
  // the usual paste accidents: a markdown link  [text](https://...),  a "dl://" prefix, or no https:// at all.
  function direct(url) {
    let u = String(url == null ? '' : url).trim();
    if (!u) return '';
    const md = u.match(/\]\((https?:\/\/[^)\s]+)\)/);                 // [label](https://real-address)
    if (md) u = md[1];
    u = u.replace(/^[\[<(]+|[\]>)]+$/g, '');
    u = u.replace(/^(dl|dropbox):\/\//i, 'https://');              // dl://dl.dropbox.com/... -> https://...
    if (/^(www\.)?(dl\.)?dropbox(usercontent)?\.com\//i.test(u)) u = 'https://' + u;
    try {
      const x = new URL(u, location.href);
      if (/(^|\.)dropbox\.com$/.test(x.hostname)) {
        x.hostname = 'dl.dropbox.com';
        x.searchParams.delete('dl');
        return x.toString();
      }
    } catch (e) { /* not a full URL: leave as is */ }
    return u;
  }

  const cfg = MAP_CONFIG;
  const mapUrl = name => direct((cfg.urls || {})[name] || '');          // '' = not configured
  const iconUrl = name => `static/img/${name}.png`;                       // bundled with the app

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('could not load ' + url));
      img.src = url;
    });
  }

  async function getJson(path) {
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return JSON.parse((await res.text()).replace(/^\uFEFF/, ''));   // tolerate a BOM
  }

  return { direct, mapUrl, iconUrl, loadImage, getJson, cfg };
})();
