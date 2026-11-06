"""
kerbin_common.py - helpers shared by generate_config.py and tileise.py (kept next to them; nothing to install).

* where each map lives inside the maps folder (MAP_FILES - edit here if you rename or swap a layer)
* the map frame (config/geometry.json) and the pixel <-> latitude/longitude conversions
* loading a layer "folded" to exactly one world turn, so the overlap strip never gets counted twice
"""
import json
import os
import sys
import time

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None

# ----------------------------------------------------------------------------------------------
# Maps folder layout. Paths are relative to the maps folder (the one holding Climate.pdn, Layers/ ...).
# .pdn files are never read - export the layer to PNG (they already live under Layers/).
# A value may be a list: the layers are read in that order (resources).
# ----------------------------------------------------------------------------------------------
LAYERS = "Layers"
MAP_FILES = {
    "Continent": f"{LAYERS}/Misc/Continents.png",
    "Provs":     f"{LAYERS}/Administrative/Prov Tiles.png",
    "Tiles":     f"{LAYERS}/Administrative/County Tiles.png",
    "Language":  f"{LAYERS}/Demographic/Linguo-Cultural Blobs.png",
    "Height":    f"{LAYERS}/Geologic/Height.png",  # greyscale height: red channel 0..255
    "Biomes":    f"{LAYERS}/Climate/KSP_Biomes.png",
    "Density":   f"{LAYERS}/Demographic/Population Density.png",
    "Ores":      [f"{LAYERS}/Resource/CommonOre.png", f"{LAYERS}/Resource/RareOre.png", f"{LAYERS}/Resource/NuclearOre.png"],
    "Food":      f"{LAYERS}/Resource/Food.png",
    "Hydrates":  f"{LAYERS}/Resource/Hydrates.png",
}

# Fallback only: Kerbin's equator (2*pi*600 km). The real setting is "equatorKmPerPixel" in config/geometry.json.
BODY_CIRCUMFERENCE_KM = 3769.911


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def hex6(r, g, b):
    return f"{int(r):02X}{int(g):02X}{int(b):02X}"


# ----------------------------------------------------------------------------------------------
# Finding map files
# ----------------------------------------------------------------------------------------------
def resolve_map(maps_dir, rel, overrides=None):
    """Full path of one map file. Tries the configured path, then the bare file name anywhere under maps_dir."""
    if overrides and rel in overrides:
        rel = overrides[rel]
    p = os.path.join(maps_dir, rel)
    if os.path.isfile(p):
        return p
    base = os.path.basename(rel).lower()
    for root, _, files in os.walk(maps_dir):
        for fn in files:
            if fn.lower() == base:
                return os.path.join(root, fn)
    stem = os.path.splitext(base)[0]
    hint = ""
    for root, _, files in os.walk(maps_dir):
        if any(f.lower() == stem + ".pdn" for f in files):
            hint = f" ({stem}.pdn exists but PDN files can't be read - export it to PNG)"
            break
    sys.exit(f"Map '{rel}' not found under {maps_dir}{hint}.\n"
             f"Edit MAP_FILES in tools/kerbin_common.py if the file has a different name or folder.")


def get_maps_root(cli_value, cfg):
    """The maps folder: --maps if given, else "mapsRoot" in config/geometry.json (a relative path is relative to that file)."""
    if cli_value:
        return cli_value
    gp = os.path.abspath(os.path.join(cfg, "geometry.json"))
    if not os.path.isfile(gp):
        sys.exit(f"{gp} not found")
    with open(gp, encoding="utf-8-sig") as fh:
        root = json.load(fh).get("mapsRoot")
    if not root:
        sys.exit(f"No maps folder: pass --maps, or set \"mapsRoot\" in {gp}")
    root = root if os.path.isabs(root) else os.path.join(os.path.dirname(gp), root)
    if not os.path.isdir(root):
        sys.exit(f"mapsRoot {root} (from geometry.json) is not a folder")
    return root


def find_maps_root(start):
    """Walk up from a file or folder to the folder that contains Layers/ (the maps root), or None."""
    p = os.path.abspath(start)
    if os.path.isfile(p):
        p = os.path.dirname(p)
    while True:
        if os.path.isdir(os.path.join(p, LAYERS)):
            return p
        parent = os.path.dirname(p)
        if parent == p:
            return None
        p = parent


# ----------------------------------------------------------------------------------------------
# Geometry
# ----------------------------------------------------------------------------------------------
class Geometry:
    """The map frame from config/geometry.json.

    width x height   size of every layer picture
    loopWidth (P)    pixels in one full turn of longitude. Columns P..width-1 are a REPEAT of columns 0..width-P-1
    equatorY         picture row of latitude 0, counted from the TOP
    meridianX        picture column of longitude 0
    equatorKmPerPixel  the one scale setting: how many km one pixel is along the equator (and, equirectangular, along any meridian).
                     Circumference = equatorKmPerPixel * loopWidth. Everything in km/km2 comes from this number.
    """

    def __init__(self, g):
        self.raw = g
        self.W, self.H = int(g["width"]), int(g["height"])
        self.P = int(g["loopWidth"])
        self.eq = float(g["equatorY"])
        self.mx = float(g["meridianX"])
        if g.get("equatorKmPerPixel"):
            self.km_px = float(g["equatorKmPerPixel"])
        else:
            self.km_px = BODY_CIRCUMFERENCE_KM / self.P
            log(f"WARNING geometry.json has no equatorKmPerPixel - using {self.km_px:.6f} km/px (from {BODY_CIRCUMFERENCE_KM} km / loopWidth)")
        self.ppd = self.P / 360.0
        self.circumference = self.km_px * self.P
        self.radius = self.circumference / (2 * np.pi)
        tf = g["tileFrame"]            # frame the Position values inside config/tiles/*.json are written in (y from the BOTTOM)
        self.tf = dict(W=tf["width"], H=tf["height"], mx=tf["meridianX"], eq=tf["equatorY"], ppd=tf["width"] / 360.0)

    # picture pixel (x in [0,P), y_bottom = rows counted from the bottom, as Unity/this code samples) <-> lat/lon
    def pixel_to_latlon(self, x, y_bottom):
        y_top = self.H - 1 - y_bottom + 0.5
        return (self.eq - y_top) / self.ppd, (x + 0.5 - self.mx) / self.ppd

    def latlon_to_pixel(self, lat, lon):
        x = (self.mx + lon * self.ppd) % self.P
        y_top = self.eq - lat * self.ppd
        return x, self.H - 1 - (y_top - 0.5)

    # the tile JSON's Position <-> lat/lon <-> picture pixel
    def pos_to_latlon(self, pos):
        t = self.tf
        return (pos["y"] - t["eq"]) / t["ppd"], (pos["x"] - t["mx"]) / t["ppd"]

    def latlon_to_pos(self, lat, lon):
        t = self.tf
        lon = (lon + 180) % 360 - 180
        return {"x": round(t["mx"] + lon * t["ppd"], 2), "y": round(t["eq"] + lat * t["ppd"], 2)}

    def pos_to_pixel(self, pos):
        x, yb = self.latlon_to_pixel(*self.pos_to_latlon(pos))
        return int(np.clip(int(x), 0, self.P - 1)), int(np.clip(int(yb), 0, self.H - 1))

    def pixel_to_pos(self, x, y_bottom):
        return self.latlon_to_pos(*self.pixel_to_latlon(x, y_bottom))

    def row_area_km2(self):
        """Area in km2 of ONE pixel in each picture row (row 0 = top). A pixel is a slice of a latitude band:
        R^2 * dLon * (sin lat_top - sin lat_bottom), with dLon = 2*pi/P and R from equatorKmPerPixel.
        Summed over the P x H world picture this is the sphere's area between the picture's top and bottom latitudes."""
        y = np.arange(self.H)
        lt, lb = np.radians((self.eq - y) / self.ppd), np.radians((self.eq - (y + 1)) / self.ppd)
        return self.radius ** 2 * (2 * np.pi / self.P) * (np.sin(lt) - np.sin(lb))


def load_geometry(cfg):
    p = os.path.join(cfg, "geometry.json")
    if not os.path.isfile(p):
        sys.exit(f"{p} not found")
    with open(p, encoding="utf-8-sig") as fh:
        return Geometry(json.load(fh))


# ----------------------------------------------------------------------------------------------
# Rasters, folded to one world turn
# ----------------------------------------------------------------------------------------------
def fold_overlap(arr, P):
    """(H, W, 4) -> (H, P, 4). The last W-P columns repeat the first ones; where the left copy is transparent the right copy fills in."""
    W = arr.shape[1]
    if W <= P:
        return arr
    out = arr[:, :P].copy()
    strip = min(W - P, P)
    left, tail = out[:, :strip], arr[:, P:P + strip]
    m = left[..., 3] == 0
    left[m] = tail[m]
    return out


class Raster:
    """An RGBA map addressed the way Unity does it: (x, y) with y counted from the BOTTOM row.
    Always exactly one world turn wide (the overlap strip is merged in), so w == geometry.P and every pixel is a distinct world pixel."""

    def __init__(self, path, geom):
        log(f"loading {os.path.relpath(path)}")
        im = Image.open(path)
        im.load()
        a = np.asarray(im.convert("RGBA"))
        h, w = a.shape[:2]
        if h != geom.H or w not in (geom.W, geom.P):
            sys.exit(f"{os.path.basename(path)} is {w}x{h}; geometry.json expects {geom.W}x{geom.H} (or one world turn, {geom.P}x{geom.H}).")
        self.arr = fold_overlap(a, geom.P)
        self.h, self.w = self.arr.shape[:2]

    def at(self, xs, ys):
        return self.arr[self.h - 1 - np.asarray(ys), np.asarray(xs)]       # (n, 4) uint8

    def keys_flat(self):
        """uint32 per pixel in Unity order: bit 24 = opaque, low 24 bits = RGB."""
        out = np.empty(self.w * self.h, dtype=np.uint32)
        rows = 256
        for y0 in range(0, self.h, rows):
            y1 = min(y0 + rows, self.h)
            blk = self.arr[self.h - y1: self.h - y0][::-1]
            k = (blk[..., 0].astype(np.uint32) << 16) | (blk[..., 1].astype(np.uint32) << 8) | blk[..., 2]
            k |= (blk[..., 3] > 0).astype(np.uint32) << 24
            out[y0 * self.w: y1 * self.w] = k.reshape(-1)
        return out
