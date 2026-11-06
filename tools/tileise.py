#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# dependencies = ["numpy", "Pillow"]
# ///
"""
tileise.py - flattens a map into a tile-based map: every tile gets one flat colour, sampled from the source map at the tile's position.

    python tools/tileise.py "D:/Maps/Layers/Climate/Koppen.png"
    python tools/tileise.py "D:/Maps/Layers/Geologic/Height.png" --heatmap

One argument: the source map. The result is written next to this script as <source name>_tiles.png.
The tile outlines (Layers/Administrative/County Tiles.png) are found by walking up from the source file to the maps folder
(the one containing Layers/); the tile positions come from ../config. The source must be in the geometry.json frame
(or one world turn wide); each tile's colour is painted wherever the tile map is drawn, strip included, and nowhere else. Needs config/ generated from the SAME maps (run generate_config.py first), or the sample positions won't line up.

--heatmap re-colours the sample from its blue channel only (grey-to-blue ramp), as Tileiser's 'generateHeatmap' option did.
"""
import argparse
import os
import sys

import numpy as np
from PIL import Image

from kerbin_common import MAP_FILES, find_maps_root, fold_overlap, load_geometry, log, resolve_map

HERE = os.path.dirname(os.path.abspath(__file__))


def load_tiles(config_dir, geom):
    """(hex, picture x, picture y-from-bottom) for every tile in config/tiles/*.json."""
    import json
    d = os.path.join(config_dir, "tiles")
    if not os.path.isdir(d):
        sys.exit(f"{d} not found - run generate_config.py first")
    tiles = []
    for fn in sorted(os.listdir(d)):
        if not fn.lower().endswith(".json"):
            continue
        with open(os.path.join(d, fn), encoding="utf-8-sig") as fh:
            for cont in json.load(fh).get("Content", []):
                for prov in cont["Provinces"]:
                    for t in prov["Tiles"]:
                        x, y = geom.pos_to_pixel(t["Position"])
                        tiles.append((int(t["HexCode"], 16), x, y))
    return tiles


def load_rgba(path):
    log(f"loading {os.path.basename(path)}")
    im = Image.open(path)
    im.load()
    return np.asarray(im.convert("RGBA"))                      # (H, W, 4), top row first


def heatmap(rgba):
    """Tileiser.GenerateHeatmapColor: grey ramp in red/green that saturates blue (opaque result)."""
    f32 = np.float32
    b = rgba[:, 2].astype(f32) / f32(255)
    ramp = np.clip(f32(1) - f32(2) * (f32(1) - b), 0, 1)
    out = np.empty_like(rgba)
    out[:, 0] = out[:, 1] = np.floor(ramp * f32(255) + f32(0.5)).astype(np.uint8)
    out[:, 2] = np.floor(np.clip(b, 0, 1) * f32(255) + f32(0.5)).astype(np.uint8)
    out[:, 3] = 255
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source", help="the map PNG to sample")
    ap.add_argument("--heatmap", action="store_true", help="colour tiles from the source's blue channel as a heatmap")
    ap.add_argument("--config", default=os.path.join(HERE, "..", "config"), help="folder containing geometry.json and tiles/ (default: ../config)")
    a = ap.parse_args()
    if not os.path.isfile(a.source):
        sys.exit(f"{a.source} not found")

    maps = find_maps_root(a.source)
    if maps is None:
        sys.exit("couldn't find the maps folder (the one containing Layers/) above the source file")
    tiles_path = resolve_map(maps, MAP_FILES["Tiles"])
    geom = load_geometry(a.config)
    tiles = load_tiles(a.config, geom)
    log(f"{len(tiles)} tiles in config")

    src = load_rgba(a.source)
    H, W = src.shape[:2]
    if H != geom.H or W not in (geom.W, geom.P):
        sys.exit(f"{os.path.basename(a.source)} is {W}x{H}; geometry.json expects {geom.W}x{geom.H} (or {geom.P}x{geom.H})")
    W_full = W
    src = fold_overlap(src, geom.P)                            # sample the merged world, as generate_config does: a tile in the strip reads whichever copy has data
    hexes = np.array([t[0] for t in tiles], dtype=np.int64)
    xs, ys = np.array([t[1] for t in tiles]), np.array([t[2] for t in tiles])
    sample = src[H - 1 - ys, xs]                               # x is inside the first world turn; y counted from the bottom
    del src
    if a.heatmap:
        sample = heatmap(sample)

    order = np.argsort(hexes)
    keys_sorted, colours = hexes[order], sample[order]

    tm = load_rgba(tiles_path)
    if tm.shape[:2] != (H, W_full):
        sys.exit(f"size mismatch: source is {W_full}x{H}, tile map is {tm.shape[1]}x{tm.shape[0]}")
    out = np.zeros((H, W_full, 4), dtype=np.uint8)                  # painted exactly where the tile map is drawn: nothing is copied or filled
    painted = 0
    unknown = {}                                               # opaque tile-map colours that are not in config/tiles: nothing to paint them with
    ux0, ux1 = {}, {}
    for y0 in range(0, H, 256):
        blk = tm[y0:y0 + 256]
        k = (blk[..., 0].astype(np.int64) << 16) | (blk[..., 1].astype(np.int64) << 8) | blk[..., 2]
        pos = np.searchsorted(keys_sorted, k)
        pos[pos >= len(keys_sorted)] = 0
        match = keys_sorted[pos] == k
        hit = match & (blk[..., 3] > 0)
        out[y0:y0 + 256][hit] = colours[pos[hit]]
        painted += int(hit.sum())
        miss = (blk[..., 3] > 0) & ~match
        if miss.any():
            ys_, xs_ = np.nonzero(miss)
            for c, x in zip(k[miss].tolist(), xs_.tolist()):
                unknown[c] = unknown.get(c, 0) + 1
                ux0[c] = min(ux0.get(c, x), x); ux1[c] = max(ux1.get(c, x), x)
    log(f"painted {painted:,} pixels")
    if unknown:
        tot = sum(unknown.values())
        log(f"WARNING {tot:,} opaque tile-map pixels ({len(unknown)} colours) are NOT in config/tiles, so they stay blank - the config doesn't match this tile map. Largest:")
        for c, n in sorted(unknown.items(), key=lambda t: -t[1])[:6]:
            log(f"   {c:06X}: {n:,} px, columns {ux0[c]}-{ux1[c]}")
    blank_src = int((sample[:, 3] == 0).sum())
    if blank_src:
        log(f"NOTE {blank_src} of {len(tiles)} tiles sampled a transparent pixel in the source map, so they come out blank (source has no data at the tile's position)")
    dest = os.path.join(HERE, os.path.splitext(os.path.basename(a.source))[0] + "_tiles.png")
    Image.fromarray(out, "RGBA").save(dest)
    log(f"wrote {dest}")


if __name__ == "__main__":
    main()
