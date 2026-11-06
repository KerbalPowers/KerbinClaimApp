// maps.config.js - WHERE THINGS LIVE: the map images (Dropbox) and the Google Sheets API (culture / province / city names).
// Edit the values below; nothing else needs touching.
//
// Same idea as MAP_URL in the language tree: paste the Dropbox link for each image. Either form works:
//   the share link from Dropbox's "Copy link" button   https://www.dropbox.com/scl/fi/xxxx/Tiles.png?rlkey=...
//   or the direct form the language tree uses          https://dl.dropbox.com/scl/fi/xxxx/Tiles.png?rlkey=...&st=...
// (the first is converted to the second automatically). Any other https:// address also works.
//
// UI icons are NOT configured here: they ship with the app in static/img/.
const MAP_CONFIG = {
  // The size and layout of the images (13900x6000, where 0 degrees longitude sits, how far the map loops) is in
  // config/geometry.json, which the tools in tools/ read too.

  // Resolution used to detect which tile you clicked, as a fraction of one world turn (0.5 = half size).
  // Lower it if a phone struggles; the site also retries smaller on its own.
  hitScale: 1,

  urls: {
    // REQUIRED. Tiles.png - one flat colour per tile, in the NEW frame (same size and alignment as the other layers).
    // Must be a PNG with exact colours.
    Tiles:       'https://dl.dropbox.com/scl/fi/2jtfxvh0adiva08ki7kmy/County-Tiles.png?rlkey=udszw48u77n3ho5lndz2ny8yp',

    // Base map. Display only. This is the ORIGINAL 12288 wide picture, starting at the 180 degree line: it is placed and
    // looped by itself (see `flatMap` in config/geometry.json), so it does not need to match the 13900x6000 frame.
    FlatMap:     'https://dl.dropbox.com/scl/fi/zlfvnewbwyx69ds5ok3zx/FlatMap.png?rlkey=lkyfbadq9geylrdpsabxbcgkf',

    // Optional overlays. Each is only downloaded when its button is switched on.
    // (Cities and the latitude/longitude Grid are not images any more: they are drawn from data, see overlays.js.)
    Language:    'https://dl.dropbox.com/scl/fi/rbmzw3ecxilloac59cya0/Linguo-Cultural-Blobs.png?rlkey=8n9lwjemvtv7x0s6jn1pytfqk',   // Culture button
    Climate:     'https://dl.dropbox.com/scl/fi/weg21pw348tt804oyjhik/Koppen.png?rlkey=lrq0aqtoa1vqnc54ty39mrft0',
    Rivers:      'https://dl.dropbox.com/scl/fi/tpmiymuy2phdfiph8wxbq/Rivers.png?rlkey=939gdovlpsp0wx0ceewjp3bun',

    // Key (legend) images, shown bottom right: KeyLanguage while Culture is on, KeyClimate while Climate is on, KeyClaim in Claim mode.
    // Paste the links here like the maps above. Leave '' to show no key.
    KeyLanguage: 'https://dl.dropbox.com/scl/fi/mw9pc9p78d0lleq3a7k3s/Sunburst.png?rlkey=pmtvdcetezgy1pjbu6njr5lul',
    KeyClimate:  'https://dl.dropbox.com/scl/fi/vowbmxwdhkaa7zwqbr2xd/Koppen.png?rlkey=sdiyabccdc506fxbk7s5w9byd',
    KeyClaim:    'https://dl.dropbox.com/scl/fi/4p04ec85gt1yirwhiqmrh/Claimed.png?rlkey=3w1c5hw551wzfnhdq5eqlmdjt',
  },

  // Wiki map of already-claimed territory (shown in Claim mode; "Prevent contest" needs the host to allow CORS).
  claimedMapUrl: 'https://dl.dropbox.com/scl/fi/nd18d0jmfgm24vryb61z0/Claimed.png?rlkey=6ptg5e72fu7xbdioqgf4tquqa',

  // "Prevent contest" only counts wiki pixels of exactly this colour (hex) as claimed.
  contestColour: '7F0000',

  // The same Apps Script endpoint the language tree uses. A deployment id or URL in the page's #hash overrides `url`
  // (so  .../index.html#AKfycb...  points at another deployment), exactly like the language tree.
  sheets: {
    url: 'https://script.google.com/macros/s/AKfycbylLM7w0QOqfOQbZsND1GbFhWYgVm1WJOut1UJhKaOjtPET3aJDrccDHR3S9h28j36G/exec',
    cultures:  'Public',        // Family, Group, SubGroup, Language, Dialect, Hexcode   (same tab the language tree reads)
    provinces: 'Province Loc',  // uses the "Name" and "Hex" columns; the others are ignored
    cities:    'City Loc',      // Name, X, Y   (X/Y = pixel on the map image from the top-left, in the frame of config/geometry.json) - see tools/extract_cities.py
    timeoutMs: 20000,
  },
};
