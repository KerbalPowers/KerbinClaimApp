#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# dependencies = ["numpy", "Pillow", "scipy"]
# ///
"""
extract_cities.py - turns the Cities raster into a list of (name, x, y) data points.

The raster draws every city as a solid white square (the point) with its name beside it in a tiny
1-bit font. Because the font is hard-edged and pixel-exact, the names are read by matching each letter's
bitmap against a built-in atlas (no OCR install needed). Run it locally:

    python extract_cities.py            # finds Cities.png next to this script, writes ../config/cities.json + cities.csv

or give paths explicitly: --cities PATH --out PATH --csv PATH

x, y   = centre pixel of the square on the map image, counted from the TOP-LEFT. x is folded into one turn of longitude.
lat/lon = from config/geometry.json (where 0 degrees longitude and the equator sit on the picture).

The new map is built to loop: it is wider than one turn of longitude, so the strip at the right repeats the strip at the left and
every city in it appears twice. The repeat distance is measured from the image itself, duplicates are merged (keeping the copy
whose label is best read), and the measured distance is compared with loopWidth in geometry.json. An image with no such strip
is read as wrapping around its own edges instead.

Anything the atlas can't read is written as '?' and listed under "review" (with --review-dir, as a picture
you can look at). To teach the tool a new letter, add one line to ATLAS below (--show-unknown prints them ready to paste).
"""
import argparse
import csv
import json
import os
import sys
from collections import Counter

try:
    import numpy as np
    import scipy.ndimage as ndi
    from PIL import Image
except ImportError as e:
    sys.exit(f"Missing a library ({e.name}). Install them with:\n    python -m pip install numpy scipy pillow")

Image.MAX_IMAGE_PIXELS = None

MARKER = 9            # side of the white square, in pixels
PAD = 150             # columns copied from each edge so wrapped labels read as one piece
SPACE_GAP = 5         # a gap this many pixels or wider between letters is a space (letters are <=3 apart, spaces 5-6)
START_GAP = 8         # label must start within this many pixels of the square
SEAM = 0              # blank columns inserted where the map wraps (0 = stitch the edges exactly)
MAX_GAP = 14          # a wider gap ends the label
FUZZY = 2             # accept a letter whose bitmap differs from an atlas entry by at most this many pixels

# 'row offset from the square's centre : bitmap rows' -> text.   '|' is a plain vertical bar (I or l, decided by position).
# Some entries are letters whose neighbours touch in the font (rt, fi, ...) or whose accent/descender detached.
ATLAS = {
    "-2:.###./#...#/....#/.####/#...#/#..##/.##.#": "a",
    "-2:.###./#...#/#...#/#####/#..../#...#/.###.": "e",
    "-5:#/././#/#/#/#/#/#/#": "i",
    "-2:#.#/##./#../#../#../#../#..": "r",
    "-2:#.##./##..#/#...#/#...#/#...#/#...#/#...#": "n",
    "-2:.###./#...#/#...#/#...#/#...#/#...#/.###.": "o",
    "-5:#/#/#/#/#/#/#/#/#/#": "|",
    "-2:.###./#...#/#..../.###./....#/#...#/.###.": "s",
    "-4:.#./.#./###/.#./.#./.#./.#./.#./.##": "t",
    "-2:#...#/#...#/#...#/#...#/#...#/#...#/.####": "u",
    "-5:#..../#..../#..../#.##./##..#/#...#/#...#/#...#/#...#/#...#": "h",
    "-5:....#/....#/....#/.##.#/#..##/#...#/#...#/#...#/#...#/.####": "d",
    "-5:#..../#..../#..../#...#/#..#./#.#../###../#..#./#..#./#...#": "k",
    "-2:#...#/#...#/.#.#./.#.#./.#.#./..#../..#../..#../..#../##...": "y",
    "-2:#.##..##./##..##..#/#...#...#/#...#...#/#...#...#/#...#...#/#...#...#": "m",
    "-2:.###./#...#/#..../#..../#..../#...#/.###.": "c",
    "-2:.##.#/#..##/#...#/#...#/#...#/#..##/.##.#/....#/#...#/.###.": "g",
    "-5:....#..../...#.#.../...#.#.../...#.#.../..#...#../..#...#../.#######./.#.....#./#.......#/#.......#": "A",
    "-2:#...#/#...#/.#.#./.#.#./.#.#./..#../..#..": "v",
    "-5:.#####./#.....#/#.....#/#....../.###.../....##./......#/#.....#/#.....#/.#####.": "S",
    "-5:######./#.....#/#.....#/#.....#/######./#.....#/#.....#/#.....#/#.....#/######.": "B",
    "-5:#......#/#.....#./#....#../#...#.../#..#..../#.##..../##..#.../#....#../#.....#./#......#": "K",
    "-5:#..../#..../#..../#.##./##..#/#...#/#...#/#...#/#...#/####.": "b",
    "-5:#######/...#.../...#.../...#.../...#.../...#.../...#.../...#.../...#.../...#...": "T",
    "-5:..###../.#...#./#.....#/#....../#....../#....../#....../#.....#/.#...#./..###..": "C",
    "-2:#.##./##..#/#...#/#...#/#...#/##..#/#.##./#..../#..../#....": "p",
    "-5:######./#.....#/#.....#/#.....#/#.....#/######./#....../#....../#....../#......": "P",
    "-5:#.....#/##....#/#.#...#/#.#...#/#..#..#/#..#..#/#...#.#/#...#.#/#....##/#.....#": "N",
    "-5:..####../.#....#./#......#/#......./#......./#...####/#......#/#......#/.#....#./..####..": "G",
    "-5:######./#.....#/#.....#/#.....#/#.....#/######./#...#../#....#./#....#./#.....#": "R",
    "-5:#####../#....#./#.....#/#.....#/#.....#/#.....#/#.....#/#.....#/#....#./#####..": "D",
    "-5:#.......#/#.......#/.#.....#./.#.....#./..#...#../..#...#../...#.#.../...#.#.../....#..../....#....": "V",
    "-2:#####/...#./...#./..#../.#.../.#.../#####": "z",
    "-5:#.....#/#.....#/#.....#/#.....#/#######/#.....#/#.....#/#.....#/#.....#/#.....#": "H",
    "-5:#.......#/##.....##/##.....##/#.#...#.#/#.#...#.#/#..#.#..#/#..#.#..#/#..#.#..#/#...#...#/#...#...#": "M",
    "-5:#...../#...../#...../#...../#...../#...../#...../#...../#...../######": "L",
    "-5:######/#...../#...../#...../#####./#...../#...../#...../#...../#.....": "F",
    "-5:#######/#....../#....../#....../#######/#....../#....../#....../#....../#######": "E",
    "-5:..####../.#....#./#......#/#......#/#......#/#......#/#......#/#......#/.#....#./..####..": "O",
    "-5:..#/.../.../..#/..#/..#/..#/..#/..#/..#/..#/..#/##.": "j",
    "-2:#...#...#/#...#...#/.#.#.#.#./.#.#.#.#./.#.#.#.#./..#...#../..#...#..": "w",
    "-2:.##.#/#..##/#...#/#...#/#...#/#..##/.##.#/....#/....#/.###.": "g",
    "-5:..##/.#../.#../###./.#../.#../.#../.#../.#../.#..": "f",
    "-5:#.....#.....#/#....#.#....#/.#...#.#...#./.#...#.#...#./.#...#.#...#./..#.#...#.#../..#.#...#.#../..#.#...#.#../...#.....#.../...#.....#...": "W",
    "-5:.######/.....#./....#../....#../...#.../...#.../..#..../..#..../.#...../#######": "Z",
    "-4:....#./....#./#.####/##..#./#...#./#...#./#...#./#...#./#...##": "rt",
    "-2:#...#/.#.#./.#.#./..#../.#.#./.#.#./#...#": "x",
    "-5:#.....#/.#...#./.#...#./..#.#../..#.#../...#.../...#.../...#.../...#.../...#...": "Y",
    "-5:#.....#/#.....#/#.....#/#.....#/#.....#/#.....#/#.....#/#.....#/.#...#./..###..": "U",
    "-5:....#/....#/....#/....#/....#/....#/....#/#...#/#...#/.###.": "J",
    "-5:#/#/#": "'",
    "-5:#.....#/.#...#./.#...#./..#.#../...#.../...#.../..#.#../.#...#./.#...#./#.....#": "X",
    "-2:.##.#/#..##/#...#/#...#/#...#/#..##/.##.#/....#/....#/....#": "q",
    "-2:#.##...#/##.#...#/#...#.#./#...#.#./#...#.#./#....#../#....#..": "rv",
    "-5:.....##/....#../....#../#.####./##..#../#...#../#...#../#...#../#...#../#...#..": "rf",
    "-5:..###/.#.../.#.../###.#/.#..#/.#..#/.#..#/.#..#/.#..#/.#..#": "fi",
    "-5:..####../.#....#./#......#/#......#/#......#/#......#/#......#/#...##.#/.#....#./..####.#": "Q",
    "-5:...#./..#../...../.###./#...#/#...#/#####/#..../#...#/.###.": "é",
    "-4:#/./#/#/#/#/#/#/#": "i",
    "-2:#....#/#....#/#....#/#....#/#....#/#...##/.###.#": "u",
    "-5:..##../.#..#./.#..#./######/.#..#./.#..#./.#..#./.#..#./.#..#./.#..##": "ft",
    "-2:.###.###./#...#...#/....#...#/.########/#...#..../#..##...#/.##.####.": "æ",
    "-5:.#/#./../#./#./#./#./#./#./#.": "í",
    "-5:...#./..#../...../.###./#...#/....#/.####/#...#/#..##/.##.#": "á",
    "-5:...#./..#../...../.###./#...#/#...#/#...#/#...#/#...#/.###.": "ó",
    "-5:...#./..#../...../#...#/#...#/#...#/#...#/#...#/#...#/.####": "ú",
    "-4:..#../...../.###./#...#/....#/.####/#...#/#..##/.##.#": "å",
    "-2:.###./#..##/#.#.#/#.#.#/#.#.#/##..#/.###.": "ø",
    "-5:..####.#/.#....#./#....###/#....#.#/#...#..#/#..#...#/#.##...#/#.#....#/.#....#./#.####..": "Ø",
    "-2:#.../#.../.#.#/.#.#/.#.#/..#./..#.": "v",
    "-1:#/#": "",
    "-5:.#####./#.....#/#.....#/#.....#/#.....#/######./#...#../#....#./#....#./#.....#": "R",
    "-2:#/#/#/#/#/#/#": "i",
    "-2:.###/#.../#.../#.../#.../#.../.###": "c",
    "-6:#######/...#.../...#.../...#.../...#.../...#.../...#.../...#.../...#.../...#.../...#...": "T",
    "-6:#/./././#/#/#/#/#/#/#": "i",
    "-6:#..../#..../#..../#..../#...#/#..#./#.#../###../#..#./#..#./#...#": "k",
    "-2:..#.#/..##./..#../..#../..#../..#../..#../...../#...#/.###.": "r",
    "-2:.##.#/#..##/#...#/#...#/#...#/#..##/.##.#/....#": "g",
    "-5:..##.##/.#..#../.#..#../######./.#..#../.#..#../.#..#../.#..#../.#..#../.#..#..": "ff",
    "4:#": ".",
    "-2:.##.#/#..##/#...#/#...#/#...#/#..##/.##.#/....#/#...#": "g",
    "-2:..###./.#...#/.....#/..####/.#...#/.#..##/..##.#/....../....../###...": "a",
    "-6:.#/#./../../#./#./#./#./#./#./#.": "i",
    "-5:..#../.#.../...../.###./#...#/#...#/#...#/#...#/#...#/.###.": "ó",
    "-2:.##.#/#..##/#...#/#...#/#...#/#..##/.##.#/....#/#...#/.##.#": "g",
    "-2:.##../#..##/#...#/#...#/#...#/#..##/.##.#/....#/#...#/.###.": "g",
    "-5:.....###/....#.../....#.../#.####.#/##..#..#/#...#..#/#...#..#/#...#..#/#...#..#/#...#..#": "rfi",
    "-5:#######/#.....#/#.....#/#.....#/#.....#/######./#....../#....../#....../#......": "P",
    "-5:#..../#..../#..../#..#./#..#./#.#../###../#..#./#..#./#...#": "k",
    "-5:..###..../.#..#..../.#..#..../###.#...#/.#..#..#./.#..#.#../.#..###../.#..#..#./.#..#..#./.#..#...#": "fk",
    "-5:######/....#./...#../...#../..#.../..#.../.#..../.#..../#...../######": "Z",
    "-4:.####/...../.###./#...#/#...#/#...#/#...#/#...#/.###.": "ō",
    "-4:.###./...../.###./#...#/#...#/#...#/#...#/#...#/.###.": "ō",
    "-5:..###/.#..#/.#..#/###.#/.#..#/.#..#/.#..#/.#..#/.#..#/.#..#": "fl",
    "-4:.####/...../#...#/#...#/#...#/#...#/#...#/#...#/.####": "ū",
    "-5:.###./#...#/#..../#..../.##../...#./....#/....#/#...#/.###.": "S",
    "-2:#.##/##../#.../#.../#.../#.../#...": "r",
    "-5:#####../#....#./#.....#/#.....#/#.....#/#.....#/#.....#/#.....#/#....#./#######": "D",
    "-5:#..../#..../#..../#.##./##..#/#...#/#...#/#...#/#...#/#####": "b",
    "-2:#...#...#/#...#...#/.#.#.#.#./.#.#.#.#./.#.#.#.#./..#...#../..#..#...": "w",
    "-5:....#..../....#..../...#.#.../...#.#.../..#...#../..#...#../.#######./.#.....#./#.......#/#.......#": "A",
    "-2:.###.#/#...##/#....#/#....#/#....#/#...##/.###.#/.....#/.....#/.....#": "q",
    "-2:#.###./##...#/#....#/#....#/#....#/#....#/#....#": "n",
    "-2:.##.#/#..##/#...#/#...#/#...#/#..##/.##.#/....#/...##/.###.": "g",
    "-5:....#.....#/...#.#...../...#.#...../...#.#....#/..#...#...#/..#...#...#/.#######..#/.#.....#..#/#.......#.#/#.......#.#/..........#/..........#/........##.": "Aj",
    "-2:#.##...#...#/##.#...#...#/#...#.#.#.#./#...#.#.#.#./#...#.#.#.#./#....#...#../#....#...#..": "rw",
    # glyphs fused by the map's wrap-around seam
    "-5:#......./#......./#......./#.#####./##.....#/#......#/#...####/#......#/#.....##/######.#": "ba",
    "-5:..#..../.#.#.../.#.#.../.#.#.../#...#../#...#../######./.....#./......#/......#": "A",
}


def parse_atlas():
    table = {}
    for pat, text in ATLAS.items():
        off, rows = pat.split(":")
        rows = rows.split("/")
        bm = np.array([[c == "#" for c in r] for r in rows], dtype=bool)
        table[(int(off), bm.shape[0], bm.shape[1], bm.tobytes())] = (text, bm)
    return table


def load_geometry(path, W, H):
    """config/geometry.json -> dict. Missing file: assume a plain 360-degree picture with 0 degrees in the middle."""
    g = {"width": W, "height": H, "loopWidth": W, "meridianX": W / 2, "equatorY": H / 2}
    if path and os.path.isfile(path):
        with open(path, encoding="utf-8-sig") as fh:
            g.update({k: v for k, v in json.load(fh).items() if k in g})
        print(f"geometry from {path}: loopWidth={g['loopWidth']}, 0 deg at x={g['meridianX']}, equator at y={g['equatorY']}", flush=True)
    else:
        print(f"no geometry file at {path}; assuming loopWidth={W}, 0 deg at x={W / 2}, equator at y={H / 2}", flush=True)
    if (g["width"], g["height"]) != (W, H):
        print(f"NOTE: the image is {W}x{H} but geometry.json says {g['width']}x{g['height']}; using the image's size.", flush=True)
    return g


def detect_period(markers, W):
    """Squares that repeat: same row, same distance apart. The most common distance is the loop width."""
    rows = {}
    for x, y in markers:
        rows.setdefault(y, []).append(x)
    d = Counter()
    for xs in rows.values():
        xs.sort()
        for i, a in enumerate(xs):
            for b in xs[i + 1:]:
                if b - a > W // 3:
                    d[b - a] += 1
    if not d:
        return None, 0
    dist, n = d.most_common(1)[0]
    return (dist, n) if n >= 3 else (None, n)


def load_mask(path):
    a = np.asarray(Image.open(path).convert("RGBA"))
    white = (a[..., 3] > 200) & (a[..., 0] > 200)
    return white


def find_markers(ext):
    r = MARKER // 2
    hit = ndi.binary_erosion(ext, structure=np.ones((MARKER, MARKER), bool), border_value=0)
    lab, n = ndi.label(hit, structure=np.ones((3, 3)))
    out = []
    for i, s in enumerate(ndi.find_objects(lab)):
        ys, xs = np.nonzero(lab[s] == i + 1)
        k = len(ys) // 2                       # a square touching extra white gives several hits: take the middle
        out.append((s[1].start + int(xs[k]), s[0].start + int(ys[k])))
    return out, r


def components(ext, markers, r):
    mask = ext.copy()
    for x, y in markers:
        mask[y - r:y + r + 1, x - r:x + r + 1] = False
    lab, n = ndi.label(mask, structure=np.ones((3, 3)))
    comps = []
    for i, s in enumerate(ndi.find_objects(lab)):
        comps.append(dict(x0=s[1].start, x1=s[1].stop - 1, y0=s[0].start, y1=s[0].stop - 1, bm=(lab[s] == i + 1)))
    return comps


def read_label(comps, order, xs, cx, cy):
    lo, hi = np.searchsorted(xs, cx - 130), np.searchsorted(xs, cx + 130)
    band = [comps[order[j]] for j in range(lo, hi)
            if comps[order[j]]["y0"] >= cy - 6 and comps[order[j]]["y1"] <= cy + 8 and comps[order[j]]["y1"] >= cy - 6]
    right = sorted((c for c in band if c["x0"] >= cx + MARKER // 2 + 1), key=lambda c: c["x0"])
    left = sorted((c for c in band if c["x1"] <= cx - MARKER // 2 - 1), key=lambda c: -c["x1"])

    def chain(seq, d):
        if not seq:
            return None
        first = seq[0]
        sg = first["x0"] - (cx + MARKER // 2) - 1 if d > 0 else (cx - MARKER // 2) - first["x1"] - 1
        if sg > START_GAP:
            return None
        used, gaps = [first], []
        for c in seq[1:]:
            g = c["x0"] - used[-1]["x1"] - 1 if d > 0 else used[-1]["x0"] - c["x1"] - 1
            if g > MAX_GAP:
                break
            gaps.append(g); used.append(c)
        return sg, used, gaps

    cand = [(s, c) for s, c in (("R", chain(right, 1)), ("L", chain(left, -1))) if c]
    if not cand:
        return None
    side, (sg, used, gaps) = min(cand, key=lambda t: t[1][0])
    if side == "L":
        used, gaps = used[::-1], gaps[::-1]
    return side, used, gaps


def merge_glyphs(used, gaps, cy):
    """Pieces whose columns overlap (i-dots, accents, ':') are one glyph. Returns [(glyph, gap_before)]."""
    gl = []
    for c, g in zip(used, [None] + list(gaps)):
        if gl and c["x0"] <= gl[-1]["x1"] and c["x1"] >= gl[-1]["x0"]:
            q = gl[-1]; q["parts"].append(c)
            q["x0"] = min(q["x0"], c["x0"]); q["x1"] = max(q["x1"], c["x1"]); q["y0"] = min(q["y0"], c["y0"]); q["y1"] = max(q["y1"], c["y1"])
        else:
            gl.append(dict(x0=c["x0"], x1=c["x1"], y0=c["y0"], y1=c["y1"], parts=[c], gap=g))
    for i, q in enumerate(gl):                 # spacing between whole glyphs (not between loose pieces)
        q["gap"] = None if i == 0 else q["x0"] - gl[i - 1]["x1"] - 1
    for q in gl:
        h, w = q["y1"] - q["y0"] + 1, q["x1"] - q["x0"] + 1
        bm = np.zeros((h, w), bool)
        for p in q["parts"]:
            bm[p["y0"] - q["y0"]:p["y1"] - q["y0"] + 1, p["x0"] - q["x0"]:p["x1"] - q["x0"] + 1] |= p["bm"]
        q["bm"] = bm
    # the text baseline sits 4 below the centre; a label that is off by a pixel is re-aligned
    ys = [q["y1"] - cy for q in gl if q["y1"] - cy <= 5]
    shift = (Counter(ys).most_common(1)[0][0] - 4) if ys else 0
    for q in gl:
        q["off"] = q["y0"] - cy - shift
    return gl


def match(q, table, by_size):
    k = (q["off"], q["bm"].shape[0], q["bm"].shape[1], q["bm"].tobytes())
    if k in table:
        return table[k][0], False
    best, bd = None, FUZZY + 1
    for off, bm, text in by_size.get(q["bm"].shape, []):
        if abs(off - q["off"]) > 1:
            continue
        d = int((bm != q["bm"]).sum())
        if d < bd:
            best, bd = text, d
    if best is not None:
        return best, True
    return None, False


def pattern(q):
    return f"{q['off']}:" + "/".join("".join("#" if v else "." for v in r) for r in q["bm"])


def decode_glyphs(glyphs, table, by_size, unknown=None, tag=None):
    text, notes = "", []
    for q in glyphs:
        if q["gap"] is not None and q["gap"] >= SPACE_GAP:
            text += " "
        t, fuzzy = match(q, table, by_size)
        if t is None:
            text += "?"; notes.append("unknown letter")
            if unknown is not None:
                unknown.setdefault(pattern(q), []).append(tag)
            continue
        if fuzzy:
            notes.append("approximate letter")
        if t == "|":                       # a plain bar is I or l: capital at the start of a word, otherwise l
            t = "I" if (text == "" or text.endswith((" ", "-"))) else "l"
        if t[:1].isupper() and text[-1:].islower() and q["gap"] is not None and q["gap"] >= 3:
            text += " "                    # "ZolotiyeVarota": a capital right after a lowercase letter starts a new word
        text += t
    return text.strip(), sorted(set(notes))


def orphan_labels(comps, claimed, lo, hi):
    """Text no square claimed (only pieces starting inside columns lo..hi, i.e. the real map, not the wrap padding)."""
    left = sorted((c for c in comps if id(c) not in claimed and lo <= c["x0"] < hi), key=lambda c: c["x0"])
    groups = []
    for c in left:
        for g in groups:
            last = g[-1]
            gap = c["x0"] - last["x1"] - 1
            if -6 <= gap <= MAX_GAP and min(c["y1"], last["y1"]) - max(c["y0"], last["y0"]) >= -2 \
                    and max(c["y1"], *(p["y1"] for p in g)) - min(c["y0"], *(p["y0"] for p in g)) <= 14:
                g.append(c); break
        else:
            groups.append([c])
    return groups


def find_image(given, here):
    """The path you gave, else cities.png (any capitalisation) next to this script, else in the current folder or ./maps."""
    if given:
        if os.path.isfile(given):
            return given
        sys.exit(f"Can't find {given}")
    for folder in (here, os.getcwd(), os.path.join(os.getcwd(), "maps"), os.path.join(os.path.dirname(here), "maps")):
        if os.path.isdir(folder):
            for fn in sorted(os.listdir(folder)):
                if fn.lower() == "cities.png":
                    return os.path.join(folder, fn)
    sys.exit(f"Couldn't find cities.png. Put it in {here} (next to this script), or pass --cities PATH.")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cities", help="the Cities raster (default: cities.png in the same folder as this script)")
    ap.add_argument("--out", help="JSON output (default: ../config/cities.json, next to this script's folder)")
    ap.add_argument("--csv", help="CSV output, Name,X,Y,Lat,Lon, ready to paste into the sheet (default: same folder as --out)")
    ap.add_argument("--geometry", help="geometry.json (default: ../config/geometry.json)")
    ap.add_argument("--review-dir", help="write a picture of every city that needs checking")
    ap.add_argument("--show-unknown", action="store_true", help="print ATLAS lines for letters the atlas does not know")
    a = ap.parse_args()
    here = os.path.dirname(os.path.abspath(__file__))
    a.cities = find_image(a.cities, here)
    a.out = a.out or os.path.join(os.path.dirname(here), "config", "cities.json")
    a.csv = a.csv or os.path.join(os.path.dirname(os.path.abspath(a.out)), "cities.csv")
    a.geometry = a.geometry or os.path.join(os.path.dirname(here), "config", "geometry.json")
    print(f"reading {a.cities}", flush=True)

    white = load_mask(a.cities)
    H, W = white.shape
    geom = load_geometry(a.geometry, W, H)
    P = float(geom["loopWidth"])

    # Built-in overlap strip (picture wider than one turn): read it as it is. Otherwise the picture wraps around itself.
    linear = W > P + 1
    pad = 0 if linear else PAD
    if linear:
        ext = white
        to_orig = lambda xe: xe
    else:
        ext = np.concatenate([white[:, -pad:], white, white[:, :pad]], axis=1)
        def to_orig(xe):
            if xe < pad:
                return W - pad + xe
            if xe < pad + W:
                return xe - pad
            return xe - (pad + W)
    print(f"{W}x{H}; {'picture has an overlap strip' if linear else 'picture wraps around its own edges'}; looking for {MARKER}x{MARKER} squares...", flush=True)
    hits, r = find_markers(ext)
    seen = {}
    for x, y in hits:                          # wrapped picture: a square near an edge is found twice (once in the pad): keep the main-area copy
        xo = to_orig(x)
        if (xo, y) not in seen or pad <= x < pad + W:
            seen[(xo, y)] = (x, y)
    markers = sorted(seen.values(), key=lambda p: (to_orig(p[0]), p[1]))

    if linear:
        found, n = detect_period(markers, W)
        if found and abs(found - P) > 0.5:
            print(f"\n*** WARNING: this image repeats every {found} px ({n} squares agree), but geometry.json says loopWidth = {int(P)}."
                  f"\n*** Using {found} for this run. Set \"loopWidth\": {found} in config/geometry.json so the site matches.\n", flush=True)
            P = float(found)
        elif found:
            print(f"loop width confirmed from the image: repeats every {found} px ({n} squares agree)", flush=True)
        else:
            print(f"couldn't measure the loop width from the image (too few repeated squares); using geometry.json's {int(P)}", flush=True)
    fold = lambda xe: to_orig(xe) % P if linear else to_orig(xe)

    comps = components(ext, markers, r)
    order = sorted(range(len(comps)), key=lambda i: comps[i]["x0"])
    xs = np.array([comps[i]["x0"] for i in order])
    table = parse_atlas()
    by_size = {}
    for (off, h, w, _), (text, bm) in table.items():
        by_size.setdefault((h, w), []).append((off, bm, text))
    print(f"{len(markers)} squares in the picture, {len(comps)} letter pieces, {len(table)} atlas entries", flush=True)

    cities, unknown, claimed = [], {}, set()
    for cx, cy in markers:
        x_o = to_orig(cx)
        edge = min(x_o, W - 1 - x_o)                                    # distance from the picture's edge (labels near it may be cut off)
        res = read_label(comps, order, xs, cx, cy)
        if not res:
            cities.append(dict(name="", x=x_o, y=cy, edge=edge, review="square has no label in the raster")); continue
        side, used, gaps = res
        for c in used:
            claimed.add(id(c))
        glyphs = merge_glyphs(used, gaps, cy)
        text, notes = decode_glyphs(glyphs, table, by_size, unknown, len(cities))
        cities.append(dict(name=text, x=x_o, y=cy, edge=edge, review="; ".join(notes)))

    # Merge the squares that are the same place seen twice (overlap strip): keep the best-read copy.
    if linear:
        best = {}
        for c in cities:
            key = (int(round(c["x"] % P)), c["y"])
            sc = (not c["review"], len(c["name"]), c["edge"])
            if key not in best or sc > best[key][0]:
                best[key] = (sc, c)
        merged = len(cities) - len(best)
        cities = [c for _, c in sorted(best.values(), key=lambda t: (t[1]["x"] % P, t[1]["y"]))]
        print(f"{merged} squares were the overlap strip repeating; {len(cities)} distinct cities", flush=True)
        for c in cities:
            c["x"] = int(round(c["x"] % P))

    orphans = []
    claimed_xy = {(fold(c["x0"]), c["y0"]) for c in comps if id(c) in claimed}
    seen_orph = set()
    for g in orphan_labels(comps, claimed, 0 if linear else pad, W if linear else pad + W):
        if all((fold(c["x0"]), c["y0"]) in claimed_xy for c in g):
            continue
        g = sorted(g, key=lambda c: c["x0"])
        gl = merge_glyphs(g, [None] + [g[i]["x0"] - g[i - 1]["x1"] - 1 for i in range(1, len(g))][:len(g) - 1], g[0]["y1"] - 4)
        txt, _ = decode_glyphs(gl, table, by_size)
        key = (int(fold(g[0]["x0"])), g[0]["y1"])
        if len(txt.replace("?", "").replace(" ", "")) >= 2 and key not in seen_orph:
            seen_orph.add(key)
            orphans.append(dict(text=txt, x=int(fold(g[0]["x0"])), y=g[0]["y1"] - 4))

    ppd = P / 360.0
    for c in cities:
        lon = (c["x"] - geom["meridianX"]) / ppd
        c["lon"] = round(((lon + 180) % 360) - 180, 2)
        c["lat"] = round((geom["equatorY"] - c["y"]) / ppd, 2)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    out = [dict(Name=c["name"], X=c["x"], Y=c["y"], Lat=c["lat"], Lon=c["lon"]) for c in cities]
    with open(a.out, "w", encoding="utf-8", newline="\n") as fh:
        json.dump({"Content": out, "Width": W, "Height": H, "LoopWidth": int(P), "Orphans": orphans}, fh, ensure_ascii=False, indent=1)
    if a.csv:
        with open(a.csv, "w", encoding="utf-8-sig", newline="") as fh:
            w = csv.writer(fh); w.writerow(["Name", "X", "Y", "Lat", "Lon"])
            for c in out: w.writerow([c["Name"], c["X"], c["Y"], c["Lat"], c["Lon"]])
    bad = [c for c in cities if c["review"]]
    print(f"wrote {len(cities)} cities to {a.out}; {len(bad)} need a look:")
    for c in bad[:25]:
        print(f"   ({c['x']},{c['y']}) {c['name']!r}: {c['review']}")
    if orphans:
        print(f"{len(orphans)} piece(s) of text have no square next to them (see 'Orphans' in the JSON):")
        for o in orphans[:12]:
            print(f"   near ({o['x']},{o['y']}): {o['text']!r}")
    if a.show_unknown and unknown:
        print("\nATLAS lines for unknown letters (add the text after the colon):")
        for pat, ids in unknown.items():
            print(f'    "{pat}": "",   # seen {len(ids)}x')
    if a.review_dir and bad:
        os.makedirs(a.review_dir, exist_ok=True)
        for n, c in enumerate(bad):
            x0 = max(0, c["x"] - 70); y0 = max(0, c["y"] - 14)
            crop = white[y0:y0 + 28][:, np.arange(x0, x0 + 190) % W]
            Image.fromarray((crop * 255).astype(np.uint8)).resize((190 * 4, 28 * 4), Image.NEAREST).save(
                os.path.join(a.review_dir, f"{n:03d}_{c['x']}_{c['y']}.png"))
        print(f"review pictures in {a.review_dir}")


if __name__ == "__main__":
    main()
