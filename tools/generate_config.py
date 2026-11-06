#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# dependencies = ["numpy", "Pillow"]
# ///
"""
generate_config.py - builds the JSON config the claim app reads, from the map images.

This is a port of the generation half of MapGen.cs (the Unity version). Run it locally; the website only reads the JSON it produces.

    python tools/generate_config.py                      # all stages, maps folder from geometry.json
    python tools/generate_config.py --stages data claims

The maps folder (holding the .pdn files and Layers/) is "mapsRoot" in config/geometry.json; --maps overrides it. Which PNG feeds which
stage is MAP_FILES in tools/kerbin_common.py. .pdn files are not read. Override one file for a single run:
    --map Height="Layers/Geologic/Relief.png"

Stages (run in this order; each one reads the previous one's JSON from --config):
    build      Continent/Provs/Tiles  -> continents, provinces, tiles, positions, areas
    areas      Tiles                  -> refresh only the surface areas in existing config (then re-run data and claims)
    data       Language/Height/Biomes/Density   -> culture, altitude, terrain, population, GDP, coordinates
    resources  Common/Rare/Nuclear ore, Food, Hydrates -> LocalResources per tile
    claims     (no images)            -> ClaimValue per tile from the numbers above

Frame: every layer is the geometry.json frame (width x height). It is folded to ONE world turn (loopWidth wide) on load - the
overlap strip is merged, never double counted. Scale comes from "equatorKmPerPixel" in geometry.json.
"""
import argparse
import colorsys
import json
import os
import sys

import numpy as np
from PIL import Image

from kerbin_common import MAP_FILES, Raster, get_maps_root, hex6, load_geometry, log, resolve_map

# ----------------------------------------------------------------------------------------------
# Settings - copied from the serialized MapGen component in SampleScene.unity.
# ----------------------------------------------------------------------------------------------
# Scale (km per pixel) is set in config/geometry.json as equatorKmPerPixel.
# Tile areas are calculated (true spherical area of the pixels, from equatorKmPerPixel). The data
# committed before this was made from an equal-area picture and is EXACTLY 4/3 larger than that (checked on all 6,473 tiles), so
# population, GDP and claim values built on it are 33% higher than true areas would give. AREA_SCALE = 4/3 (or --area-scale 1.3333333)
# reproduces the old numbers; 1.0 gives true areas.
AREA_SCALE = 1.0
ZERO_ALT = -1070.0
MAX_ALT = 6768.0
BIGGEST_TILE = (750, 350)       # half-size of the search window used for a tile's mean position
SEARCH_INCREMENT = 100
POPULATION_SCALER = 50
GDPPC_SCALER = 100

# (time, value, inSlope, outSlope) - Unity AnimationCurve keys, cubic Hermite between keys
DENSITY_CURVE = [
    (0, 40000, -52631.58, -105263.16), (0.19, 20000, -105263.16, -71428.58),
    (0.26, 15000, -71428.58, -83333.33), (0.32, 10000, -83333.33, -28571.432),
    (0.39, 8000, -28571.432, -33333.332), (0.45, 6000, -33333.332, -19999.996),
    (0.5, 5000, -19999.996, -16666.666), (0.56, 4000, -16666.666, -19999.996),
    (0.61, 3000, -19999.996, -12500.012), (0.65, 2500, -12500.012, -9999.998),
    (0.7, 2000, -9999.998, -12499.993), (0.74, 1500, -12499.993, -12500.012),
    (0.78, 1000, -12500.012, -6249.9966), (0.82, 750, -6249.9966, -8333.325),
    (0.85, 500, -8333.325, -8333.341), (0.88, 250, -8333.341, -6250.006),
    (0.9, 125, -6250.006, -1666.6649), (0.93, 75, -1666.6649, -2750.0027),
    (0.95, 20, -2750.0027, -1000.001), (0.96, 10, -1000.001, -249.9995),
    (0.98, 5, -249.9995, -300.00027), (0.99, 2, -300.00027, -200.0002),
    (1, 0, -200.0002, 0),
]
GDPPC_CURVE = [(0, 80000, -214933.95, -214933.95), (1, 313, 0, 0)]

# Map colour -> value tables (from MapGen.cs)
RESOURCE_COLOURS = {
    "ECAEA4": ("Common Ore", 1), "DB6551": ("Common Ore", 2), "8D4134": ("Common Ore", 3),
    "F3C99C": ("Rare Ore", 1), "E99942": ("Rare Ore", 2), "96632A": ("Rare Ore", 3),
    "A4E4A4": ("Nuclear Ore", 1), "51CC51": ("Nuclear Ore", 2), "348434": ("Nuclear Ore", 3),
    "B7D0F6": ("Hydrates", 1), "75A6EF": ("Hydrates", 2), "4B6B9A": ("Hydrates", 3),
    "D8EAD3": ("Food", 1), "B6D7AB": ("Food", 2), "758B6E": ("Food", 3),
}
BIOME_COLOURS = {
    "3762AB": "Ocean", "4A85E2": "Shallows", "5498FF": "Freshwater", "A7A7A7": "Mountain",
    "C78FDF": "Tundra", "D8D8D8": "Ice Cap", "E4FDFF": "Ice Sheet", "EABF6F": "Desert",
    "974F23": "Badlands", "83BC2E": "Grasslands", "5D852A": "Highlands", "FAF2B7": "Shores",
}
# Claim cost weights.
# MapGen.cs says: population 0.08, GDP 0.01, area 10, resource multiplier 800.
# The tile JSON committed to the repo was balanced with these instead (fitted against all 6473
# tiles: exact for ~99%, +-1 on the rest), so they are the defaults here. Flip to the C# numbers
# if you want to regenerate with the original code's balance.
CLAIM_POP_WEIGHT = 0.16        # C#: 0.08
CLAIM_GDP_WEIGHT = 0.0         # C#: 0.01
CLAIM_AREA_WEIGHT = 12         # C#: 10
CLAIM_RESOURCE_MULT = 900      # C#: 800
RESOURCE_CLAIM_WEIGHT = {"Common Ore": 15, "Rare Ore": 30, "Nuclear Ore": 25, "Food": 2, "Hydrates": 10}

f32 = np.float32


# ----------------------------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------------------------
MAP_OVERRIDES = {}


def load_map(maps, key, geom, i=None):
    rel = MAP_FILES[key]
    rel = rel if i is None else rel[i]
    return Raster(resolve_map(maps, rel, MAP_OVERRIDES), geom)


def unique_in_order(keys, with_counts=False):
    """Opaque colours in order of first appearance (what a C# HashSet<Color> yields), plus counts."""
    big = np.iinfo(np.int32).max
    first = np.full(1 << 24, big, dtype=np.int32)
    counts = np.zeros(1 << 24, dtype=np.int64) if with_counts else None
    ch = 1 << 23
    for start in reversed(range(0, len(keys), ch)):
        chunk = keys[start:start + ch]
        idx = np.flatnonzero(chunk >> 24)
        if idx.size == 0:
            continue
        rgb = (chunk[idx] & 0xFFFFFF).astype(np.int64)
        first[rgb[::-1]] = (idx[::-1] + start).astype(np.int32)           # smallest index is written last
        if with_counts:
            counts += np.bincount(rgb, minlength=1 << 24)
    present = np.flatnonzero(first < big)
    order = present[np.argsort(first[present], kind="stable")]
    return order, first, counts


def pixel_sweep(keys, w, target, area, inc, offset):
    """Port of MapGen.pixelSweep: first match along a strided walk through the flat pixel array."""
    start = int(inc * offset)
    sl = keys[start:area:inc]
    hit = np.flatnonzero(sl == target)
    if hit.size == 0:
        return (0, 0)
    i = start + int(hit[0]) * inc
    y = i // w
    return (i - y * w, y)


def first_position(keys, w, n_total, n_land, target, land_first):
    pos = (0, 0)
    stages = ([(n_land, SEARCH_INCREMENT, 0)] if land_first else [(n_total, SEARCH_INCREMENT, 0)]) + [
        (n_total, SEARCH_INCREMENT // 2, 0.25), (n_total, SEARCH_INCREMENT // 10, 0.5), (n_total, 1, 0)]
    for area, inc, off in stages:
        pos = pixel_sweep(keys, w, target, area, inc, off)
        if pos != (0, 0):
            return pos
    return pos


def eval_curve(keys, t):
    """Unity AnimationCurve.Evaluate (non-weighted keys, clamped outside the range), in float32.
    Uses Unity's own cubic-coefficient form; verified bit-exact against the committed GDP values."""
    t = f32(t)
    if t <= keys[0][0]:
        return f32(keys[0][1])
    if t >= keys[-1][0]:
        return f32(keys[-1][1])
    for k0, k1 in zip(keys, keys[1:]):
        if t <= k1[0]:
            dt = f32(k1[0]) - f32(k0[0])
            m0, m1 = f32(k0[3]) * dt, f32(k1[2]) * dt
            v0, v1 = f32(k0[1]), f32(k1[1])
            a = f32(2) * v0 - f32(2) * v1 + m0 + m1
            b = f32(-3) * v0 + f32(3) * v1 - f32(2) * m0 - m1
            s = (t - f32(k0[0])) / dt
            return f32(((a * s + b) * s + m0) * s + v0)
    return f32(keys[-1][1])


def jf(x):
    """A float32 value as a JSON number (matches how Unity's JsonUtility prints floats)."""
    return float(f32(x))


# ----------------------------------------------------------------------------------------------
# Config file IO (same {"Content": [...]} wrapper Unity's JsonHelper uses, so existing files load as-is)
# ----------------------------------------------------------------------------------------------
def read_content(path):
    with open(path, encoding="utf-8-sig") as fh:
        return json.load(fh).get("Content", [])


def write_content(path, items):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        json.dump({"Content": items}, fh, indent=4, ensure_ascii=False)


def tile_areas(keys, W, H, geom):
    """Surface area in km2 of every tile colour. Returns an array indexed by 0xRRGGBB.

    `keys` is the tile map already folded to one world turn (W == geom.P), so each world pixel is counted once however wide the
    original picture was. One pixel's area comes from geom.row_area_km2(): the true area of its slice of the sphere, with the
    radius implied by equatorKmPerPixel (equator pixel = km_px x km_px; pixels nearer the poles are narrower)."""
    km2_row = geom.row_area_km2() * AREA_SCALE
    k2 = keys.reshape(H, W)                                    # Unity order: row 0 is the BOTTOM of the picture
    km2_unity = km2_row[::-1]
    total = np.zeros(1 << 24)
    for r0 in range(0, H, 512):
        blk = k2[r0:r0 + 512]
        opaque = (blk >> 24) == 1
        w = np.broadcast_to(km2_unity[r0:r0 + 512, None], blk.shape)[opaque]
        total += np.bincount((blk[opaque] & 0xFFFFFF).astype(np.int64), weights=w, minlength=1 << 24)
    return total


def load_continents(cfg):
    d = os.path.join(cfg, "tiles")
    if not os.path.isdir(d):
        sys.exit(f"{d} not found - run the 'build' stage first")
    out = []
    for fn in sorted(os.listdir(d)):
        if fn.lower().endswith(".json"):
            out.extend(read_content(os.path.join(d, fn)))
    return out


def save_continents(cfg, continents):
    d = os.path.join(cfg, "tiles")
    for c in continents:
        write_content(os.path.join(d, c["HexCode"] + ".json"), [c])
    # a static site cannot list a folder, so keep a manifest of the tile files next to them
    files = sorted(fn for fn in os.listdir(d) if fn.lower().endswith(".json"))
    with open(os.path.join(cfg, "manifest.json"), "w", encoding="utf-8", newline="\n") as fh:
        json.dump({"tiles": ["tiles/" + fn for fn in files]}, fh, indent=2)
    log(f"wrote {len(continents)} continent files to {d} (+ manifest.json)")


def load_names(cfg):
    d = os.path.join(cfg, "localisation")
    def rd(n):
        p = os.path.join(d, n)
        return read_content(p) if os.path.isfile(p) else []
    return rd("Continents.json"), rd("Provinces.json")


def save_names(cfg, cont_names, prov_names):
    d = os.path.join(cfg, "localisation")
    write_content(os.path.join(d, "Continents.json"), cont_names)
    write_content(os.path.join(d, "Provinces.json"), prov_names)


def all_tiles(continents):
    for c in continents:
        for p in c["Provinces"]:
            for t in p["Tiles"]:
                yield c, p, t


def new_tile(hexcode, pos, area, projected, prov_hex, cont_hex):
    return {"HexCode": hexcode, "Culture": "", "LocalResources": [], "GDP": 0.0,
            "Coordinates": {"x": 0.0, "y": 0.0}, "Position": {"x": jf(pos[0]), "y": jf(pos[1])},
            "Altitude": 0.0, "Terrain": "", "Area": jf(area), "ProjectedArea": projected,
            "Population": 0, "ProvinceParent": prov_hex, "ContinentParent": cont_hex, "ClaimValue": 0}


# ----------------------------------------------------------------------------------------------
# Continents: the Continents map has the base colours (listed in Continents.json) plus many SHADES of them for subdivisions.
# Every shade is folded into the base colour it was derived from, so the app keeps its small set of continents.
# ----------------------------------------------------------------------------------------------
GREY_SAT = 0.15          # below this saturation a colour is a grey / black rather than a hue
BLACK_VAL = 0.10         # ...and below this brightness it is the black base
AMBIGUOUS_HUE = 20.0     # shade further than this (degrees) from the nearest base hue is reported as doubtful
SHADES_FILE = "ContinentShades.json"


def classify_shade(rgb, bases):
    """Nearest base continent for a colour, comparing hue (shades keep the hue of their base; only lightness/saturation move).
    bases = {hex: (r, g, b)}. Returns (base_hex, confident)."""
    h, sat, v = colorsys.rgb_to_hsv(*(c / 255 for c in rgb))
    hue = h * 360
    greys = {k: colorsys.rgb_to_hsv(*(c / 255 for c in b)) for k, b in bases.items()}
    greys = {k: hsv for k, hsv in greys.items() if hsv[1] < GREY_SAT}
    chroma = {k: hsv[0] * 360 for k, hsv in ((k, colorsys.rgb_to_hsv(*(c / 255 for c in b))) for k, b in bases.items()) if k not in greys}
    if sat < GREY_SAT or v < BLACK_VAL:
        if greys:
            blk = [k for k, g in greys.items() if g[2] < BLACK_VAL]
            lit = [k for k in greys if k not in blk]
            if v < BLACK_VAL and blk:
                return blk[0], True
            if lit:
                return min(lit, key=lambda k: abs(greys[k][2] - v)), sat < GREY_SAT
            return blk[0], True
    if not chroma:
        return next(iter(bases)), False
    d = sorted((min(abs(hue - ch), 360 - abs(hue - ch)), k) for k, ch in chroma.items())
    ok = d[0][0] <= AMBIGUOUS_HUE and (len(d) == 1 or d[1][0] - d[0][0] > 8)
    return d[0][1], ok


def reconcile_continents(ck, cfg):
    """Replace every shade in the continent key array by its base colour. Returns the new array.
    Manual decisions live in config/localisation/ContinentShades.json: an entry with "Auto": false is never overwritten
    (edit "Continent" there to fix a wrong guess, set "Auto" to false, re-run build)."""
    cn, _ = load_names(cfg)
    bases = {n["HexCode"]: tuple(int(n["HexCode"][i:i + 2], 16) for i in (0, 2, 4)) for n in cn}
    path = os.path.join(cfg, "localisation", SHADES_FILE)
    saved = {e["Shade"]: e for e in (read_content(path) if os.path.isfile(path) else [])}
    opaque = (ck >> 24) == 1
    counts = np.bincount((ck[opaque] & 0xFFFFFF).astype(np.int64), minlength=1 << 24)
    present = np.flatnonzero(counts)
    lut = np.arange(1 << 24, dtype=np.uint32)
    entries, doubtful = [], []
    for c in present:
        shade = f"{int(c):06X}"
        old = saved.get(shade)
        if shade in bases:
            base, auto, ok = shade, True, True
        elif old and not old.get("Auto", True):
            base, auto, ok = old["Continent"], False, True
        else:
            base, ok = classify_shade((int(c) >> 16, (int(c) >> 8) & 255, int(c) & 255), bases)
            auto = True
        lut[c] = int(base, 16)
        entries.append({"Shade": shade, "Continent": base, "Pixels": int(counts[c]), "Auto": auto, "Confident": bool(ok)})
        if not ok:
            doubtful.append((shade, base, int(counts[c])))
    out = (ck & np.uint32(0xFF000000)) | lut[(ck & 0xFFFFFF).astype(np.int64)]
    out[~opaque] = 0
    entries.sort(key=lambda e: (e["Continent"], e["Shade"]))
    write_content(path, entries)
    n_shades = sum(1 for e in entries if e["Shade"] not in bases)
    log(f"continent shades: {n_shades} shades folded into {len(bases)} base colours (table: {path})")
    for shade, base, n in sorted(doubtful, key=lambda t: -t[2])[:15]:
        log(f"  CHECK {shade} -> {base} ({n:,} px): hue is not clearly closest to one base; fix in {SHADES_FILE} with \"Auto\": false")
    return out


# ----------------------------------------------------------------------------------------------
# Stage: build  (MapGen.DelayBuild)
# ----------------------------------------------------------------------------------------------
def stage_build(maps, cfg, mean_image, keep_positions=False):
    geom = load_geometry(cfg)
    cont = load_map(maps, "Continent", geom)
    W, H = cont.w, cont.h
    N = W * H
    ck = reconcile_continents(cont.keys_flat(), cfg)
    del cont
    log(f"scale: {geom.km_px:.6f} km per pixel at the equator, loop {geom.P} px -> circumference {geom.circumference:.3f} km, radius {geom.radius:.3f} km")
    order, first, _ = unique_in_order(ck)
    n_land = int(np.count_nonzero(ck >> 24))
    # continents: every distinct colour incl. the transparent one, in first-appearance order
    trans_idx = int(np.argmax((ck >> 24) == 0)) if np.any((ck >> 24) == 0) else None
    cont_entries = [(int(first[c]), c) for c in order]
    if trans_idx is not None:
        cont_entries.append((trans_idx, 0))
        cont_entries.sort()
    continents, by_hex = [], {}
    for _, c in cont_entries:
        h = f"{c:06X}"
        node = {"HexCode": h, "Provinces": []}
        continents.append(node)
        by_hex.setdefault(h, node)
    log(f"continents: {len(continents)}")

    # provinces
    pk = load_map(maps, "Provs", geom).keys_flat()
    porder, _, _ = unique_in_order(pk)
    log(f"provinces: {len(porder)}")
    prov_lookup = {}
    for i, c in enumerate(porder):
        target = np.uint32((1 << 24) | int(c))
        x, y = first_position(pk, W, N, n_land, target, land_first=True)
        parent_hex = f"{int(ck[y * W + x]) & 0xFFFFFF:06X}"
        parent = by_hex.get(parent_hex)
        if parent is None or parent_hex == "000000":
            log(f"  province {int(c):06X}: continent not found at ({x},{y})")
            if parent is None:
                continue
        prov = {"HexCode": f"{int(c):06X}", "ContinentParent": parent_hex, "Area": 0.0, "Population": 0, "Tiles": []}
        parent["Provinces"].append(prov)
        prov_lookup[(parent_hex, prov["HexCode"])] = prov
    # tiles
    tk = load_map(maps, "Tiles", geom).keys_flat()
    area_km2 = tile_areas(tk, W, H, geom)
    log(f"surface areas calculated from {geom.km_px:.6f} km/px (loop width {geom.P}, equator at row {geom.eq:g})")
    k2d = tk.reshape(H, W)
    torder, _, _ = unique_in_order(tk)
    log(f"tiles: {len(torder)}")
    mean_img = np.zeros((H, W, 4), dtype=np.uint8) if mean_image else None
    tile_by_hex = {}
    bx, by = BIGGEST_TILE
    for n, c in enumerate(torder):
        target = np.uint32((1 << 24) | int(c))
        fx, fy = first_position(tk, W, N, N, target, land_first=False)
        x0, x1 = fx - bx, fx + bx
        y0, y1 = max(fy - by, 0), min(fy + by, H)
        tx = ty = 0.0
        cnt = 0
        xa, xb = max(x0, 0), min(x1, W)
        if xb > xa:                                            # window inside the map
            ys, xs = np.nonzero(k2d[y0:y1, xa:xb] == target)
            tx += float((xs + xa).sum()); ty += float((ys + y0).sum()); cnt += xs.size
        if x0 < 0:                                             # spills left: Unity's flat index lands on the previous row
            r0 = max(y0, 1)
            if y1 > r0:
                ys, xs = np.nonzero(k2d[r0 - 1:y1 - 1, W + x0:W] == target)
                tx += float((xs + x0).sum()); ty += float((ys + r0).sum()); cnt += xs.size
        if x1 > W:                                             # spills right: lands on the next row
            r1 = min(y1, H - 1)
            if r1 > y0:
                ys, xs = np.nonzero(k2d[y0 + 1:r1 + 1, 0:x1 - W] == target)
                tx += float((xs + W).sum()); ty += float((ys + y0).sum()); cnt += xs.size
        mx = round(tx / cnt, 2) if cnt else 0.0
        my = round(ty / cnt, 2) if cnt else 0.0
        pos = (mx, my)
        if mean_img is not None:
            mean_img[H - 1 - int(round(my)) % H, int(round(mx)) % W] = (255, 255, 255, 255)
        flat = int(my) * W + int(mx)                           # flat index like Unity: x past the edge wraps to the next row
        on_land = cnt > 0 and 0 <= flat < N and (int(tk[flat]) >> 24) == 1
        if not on_land:
            pos = (fx, fy)                                     # mean fell on water: use the first pixel found
        area = f32(area_km2[int(c)])
        ph = f"{int(ck[fy * W + fx]) & 0xFFFFFF:06X}"
        qh = f"{int(pk[fy * W + fx]) & 0xFFFFFF:06X}"
        prov = prov_lookup.get((ph, qh))
        if prov is None:
            log(f"  tile {int(c):06X}: province {qh} / continent {ph} not found, skipped")
            continue
        jp = geom.pixel_to_pos(pos[0], pos[1])                 # picture pixels -> the JSON's Position frame (via lat/lon, wraps at 180)
        t = new_tile(f"{int(c):06X}", (jp["x"], jp["y"]), area, cnt, prov["HexCode"], prov["ContinentParent"])
        prov["Tiles"].append(t)
        tile_by_hex[t["HexCode"]] = t
        if (n + 1) % 500 == 0:
            log(f"  tiles {n + 1}/{len(torder)}")

    # Positions can be hand-corrected in the JSON (a tile whose mean falls on water gets an arbitrary
    # fallback pixel). Rebuilding would silently throw those fixes away, so report - or keep - them.
    if os.path.isdir(os.path.join(cfg, "tiles")):
        old_pos = {t["HexCode"]: t["Position"] for _, _, t in all_tiles(load_continents(cfg))}
        changed = 0
        for _, _, t in all_tiles(continents):
            o = old_pos.get(t["HexCode"])
            if o and max(abs(o["x"] - t["Position"]["x"]), abs(o["y"] - t["Position"]["y"])) > 1:
                changed += 1
                if keep_positions:
                    t["Position"] = o
        if changed:
            log(f"{changed} tile positions differ from the existing config by >1px "
                + ("- kept the existing ones (--keep-positions)" if keep_positions
                   else "- OVERWRITTEN (use --keep-positions to preserve hand-edited positions)"))

    stale = [fn for fn in os.listdir(os.path.join(cfg, "tiles")) if fn.lower().endswith(".json")] if os.path.isdir(os.path.join(cfg, "tiles")) else []
    for fn in stale:                                           # a rebuild replaces ALL tile files, so continents/tiles from older maps can't linger
        os.remove(os.path.join(cfg, "tiles", fn))
    if stale:
        log(f"removed {len(stale)} old tile files from {os.path.join(cfg, 'tiles')}")
    save_continents(cfg, continents)
    cn, pn = load_names(cfg)
    known_c = {n["HexCode"] for n in cn}
    known_p = {n["HexCode"] for n in pn}
    for c in continents:
        if c["HexCode"] not in known_c:
            cn.append({"HexCode": c["HexCode"], "Name": c["HexCode"] + "-"})
        for p in c["Provinces"]:
            if p["HexCode"] not in known_p:
                pn.append({"HexCode": p["HexCode"], "Name": p["HexCode"] + "-" + c["HexCode"]})
    save_names(cfg, cn, pn)
    if mean_img is not None:
        out = os.path.join(cfg, "MeanPosition.png")
        Image.fromarray(mean_img).save(out)
        log(f"wrote {out}")


# ----------------------------------------------------------------------------------------------
# Stage: data  (MapGen.UpdateTileData)
# ----------------------------------------------------------------------------------------------
def tile_pixels(geom, tiles):
    """Picture pixel (x, y from the bottom) of every tile's Position."""
    px = [geom.pos_to_pixel(t["Position"]) for _, _, t in tiles]
    return np.array([p[0] for p in px]), np.array([p[1] for p in px])


def stage_data(maps, cfg):
    geom = load_geometry(cfg)
    continents = load_continents(cfg)
    tiles = list(all_tiles(continents))
    xs, ys = tile_pixels(geom, tiles)

    def sample(name):
        r = load_map(maps, name, geom)
        out = r.at(xs, ys)
        return out, r.w, r.h

    lang, W, H = sample("Language")
    height, _, _ = sample("Height")
    biome, _, _ = sample("Biomes")
    dens, _, _ = sample("Density")

    bad_biomes = {}
    for p in {id(p): p for _, p, _ in tiles}.values():
        p["Population"] = 0
        p["Area"] = 0.0
    prov_area, prov_pop = {}, {}
    for i, (c, p, t) in enumerate(tiles):
        lat, lon = geom.pos_to_latlon(t["Position"])            # real latitude/longitude from the geometry (meridianX, equatorY, loopWidth)
        t["Coordinates"] = {"x": jf(round(((lon + 180) % 360) - 180, 2)), "y": jf(round(lat, 2))}
        key = id(p)
        prov_area[key] = f32(prov_area.get(key, f32(0)) + f32(t["Area"]))
        t["Culture"] = hex6(*lang[i][:3])
        h = f32(height[i][0]) / f32(255)
        t["Altitude"] = jf(f32(ZERO_ALT) + (f32(MAX_ALT) - f32(ZERO_ALT)) * min(max(h, f32(0)), f32(1)))
        bh = hex6(*biome[i][:3])
        if bh not in BIOME_COLOURS:
            bad_biomes[bh] = bad_biomes.get(bh, 0) + 1
        t["Terrain"] = BIOME_COLOURS.get(bh, "Undefined")
        heat = f32(dens[i][0]) / f32(255)
        density = eval_curve(DENSITY_CURVE, heat)
        pop = int(float(density) * (POPULATION_SCALER / 100) * float(f32(t["Area"])))
        t["Population"] = pop
        prov_pop[key] = prov_pop.get(key, 0) + pop
        gdppc = eval_curve(GDPPC_CURVE, heat)       # NB: the Unity code feeds the density heat into the GDPPC curve
        t["GDP"] = float(gdppc) * (GDPPC_SCALER / 100) * pop
    for _, p, _ in tiles:
        p["Area"] = jf(prov_area.get(id(p), 0))
        p["Population"] = prov_pop.get(id(p), 0)
    if bad_biomes:
        log(f"WARNING unknown biome colours (terrain set to 'Undefined'): {bad_biomes}")
    save_continents(cfg, continents)

    cn, pn = load_names(cfg)
    known_c = {n["HexCode"] for n in cn}
    known_p = {n["HexCode"] for n in pn}
    for c in continents:
        if c["HexCode"] not in known_c:
            cn.append({"HexCode": c["HexCode"], "Name": c["HexCode"] + "-"})
        for p in c["Provinces"]:
            if p["HexCode"] not in known_p:
                pn.append({"HexCode": p["HexCode"], "Name": p["HexCode"] + "-" + c["HexCode"]})
    save_names(cfg, cn, pn)


# ----------------------------------------------------------------------------------------------
# Stage: resources  (MapGen.UpdateTileResources)
# ----------------------------------------------------------------------------------------------
def stage_resources(maps, cfg):
    geom = load_geometry(cfg)
    continents = load_continents(cfg)
    tiles = list(all_tiles(continents))
    xs, ys = tile_pixels(geom, tiles)
    for _, _, t in tiles:
        t["LocalResources"] = []
    layers = [("Ores", i) for i in range(len(MAP_FILES["Ores"]))] + [("Food", None), ("Hydrates", None)]   # common, rare, nuclear, food, hydrates
    for name, i in layers:
        r = load_map(maps, name, geom, i)
        px = r.at(xs, ys)
        for (_, _, t), v in zip(tiles, px):
            hit = RESOURCE_COLOURS.get(hex6(*v[:3]))
            if hit:
                t["LocalResources"].append({"Resource": hit[0], "Yield": hit[1]})
        del r
    save_continents(cfg, continents)


# ----------------------------------------------------------------------------------------------
# Stage: claims  (MapGen.BalanceClaimCosts)
# ----------------------------------------------------------------------------------------------
def stage_areas(maps, cfg):
    """Recalculate Area on every tile and province from the tile map, leaving everything else alone."""
    continents = load_continents(cfg)
    geom = load_geometry(cfg)
    tk = load_map(maps, "Tiles", geom)
    W, H = tk.w, tk.h
    keys = tk.keys_flat()
    del tk
    area_km2 = tile_areas(keys, W, H, geom)
    log(f"one world turn {W}x{H}: {geom.km_px:.6f} km/px at the equator, equator at row {geom.eq:g}")
    changed, missing, rel = 0, [], []
    for _, p, _ in all_tiles(continents):
        p["Area"] = 0.0
    prov_area = {}
    for _, p, t in all_tiles(continents):
        new = f32(area_km2[int(t["HexCode"], 16)])
        if new == 0:
            missing.append(t["HexCode"])
        old = float(t["Area"]) if t.get("Area") else 0.0
        if old > 0 and new > 0:
            rel.append(abs(float(new) - old) / old)
        changed += float(new) != old
        t["Area"] = jf(new)
        prov_area[id(p)] = f32(prov_area.get(id(p), f32(0)) + new)
    for _, p, _ in all_tiles(continents):
        p["Area"] = jf(prov_area.get(id(p), 0))
    save_continents(cfg, continents)
    if rel:
        r = np.array(rel)
        log(f"areas changed on {changed} tiles; median change {np.median(r) * 100:.2f}%, 95th percentile {np.percentile(r, 95) * 100:.2f}%, largest {r.max() * 100:.1f}%")
    if missing:
        log(f"WARNING {len(missing)} tiles have no pixels in this tile map (area set to 0): {missing[:8]}")
    log("Population, GDP and claim values depend on area: now re-run  --stages data claims")


def stage_claims(cfg):
    continents = load_continents(cfg)
    n = 0
    for _, _, t in all_tiles(continents):
        value = int(np.rint(f32(t["Population"]) * f32(CLAIM_POP_WEIGHT)))
        value += int(np.rint(f32(float(t["GDP"]) * float(f32(CLAIM_GDP_WEIGHT)))))
        value += int(np.rint(f32(t["Area"]) * f32(CLAIM_AREA_WEIGHT)))
        res = sum(r["Yield"] * RESOURCE_CLAIM_WEIGHT.get(r["Resource"], 0) for r in t["LocalResources"])
        t["ClaimValue"] = int((value + res * CLAIM_RESOURCE_MULT) / 5)      # C# int division truncates
        n += 1
    save_continents(cfg, continents)
    log(f"claim values set on {n} tiles")
    limit = os.path.join(cfg, "Limit.json")
    if not os.path.isfile(limit):
        write_content(limit, [750000])
        log("wrote default Limit.json (750000)")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--maps", default=None, help="the maps folder (holds the .pdn files and Layers/). Default: mapsRoot in config/geometry.json")
    ap.add_argument("--config", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "config"),
                    help="folder the JSON is read from / written to (default: ../config, next to tools/)")
    ap.add_argument("--map", action="append", default=[], metavar="KEY=PATH",
                    help="use another file for one layer, e.g. --map Height=Layers/Geologic/Relief.png (keys: " + ", ".join(MAP_FILES) + "; relative to --maps)")
    ap.add_argument("--stages", nargs="+", default=["all"], choices=["all", "build", "areas", "data", "resources", "claims"])
    ap.add_argument("--area-scale", type=float, default=None,
                    help="multiply every calculated area (default 1.0 = true areas; 1.3333333 reproduces the data made from the old equal-area image)")
    ap.add_argument("--keep-positions", action="store_true",
                    help="build stage: keep tile positions already in --config (preserves hand-corrected ones)")
    ap.add_argument("--mean-image", action="store_true", help="build stage: also write MeanPosition.png for checking")
    a = ap.parse_args()
    a.maps = get_maps_root(a.maps, a.config)
    for kv in a.map:
        k, _, v = kv.partition("=")
        if k not in MAP_FILES or not v or isinstance(MAP_FILES[k], list):
            sys.exit(f"--map {kv!r}: expected KEY=PATH with KEY one of " + ", ".join(k for k in MAP_FILES if not isinstance(MAP_FILES[k], list)))
        MAP_OVERRIDES[MAP_FILES[k]] = v
    if a.area_scale is not None:
        globals()["AREA_SCALE"] = a.area_scale
    stages = ["build", "data", "resources", "claims"] if "all" in a.stages else a.stages
    for s in ["build", "areas", "data", "resources", "claims"]:
        if s in stages:
            log(f"=== {s} ===")
            {"build": lambda: stage_build(a.maps, a.config, a.mean_image, a.keep_positions),
             "areas": lambda: stage_areas(a.maps, a.config),
             "data": lambda: stage_data(a.maps, a.config),
             "resources": lambda: stage_resources(a.maps, a.config),
             "claims": lambda: stage_claims(a.config)}[s]()
    log("done")


if __name__ == "__main__":
    main()
