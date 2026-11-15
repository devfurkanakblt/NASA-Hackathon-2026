"""Revalidate selected regional map cells with the 0.1 deg catalogue horizon.

A map cell normally uses the 1 deg horizon in cells.bin (a screening estimate). For a few
finalist cells this recomputes the horizon exactly as for a catalogue site (build_all:
horizon.compute + halved-step refinement, 0.1 deg azimuth step, same DEMs and range) from the
same observer: the cell centre of map.json and the eye height cells.eyeM[i] (surface + 2 m).

Writes {site}/refined.json and merges with the existing file when it refers to the same
cells.bin (cellsSha256); entries of an older cells.bin are dropped.

Usage:
  python -m preprocess.refine_cells --site Site01 --cells r36c32 r10c5
  python -m preprocess.refine_cells --reference     # Site01 r36c32 + docs/reference/cells.json cells
"""
import argparse
import json
import re
import sys
import time
from pathlib import Path

from . import config as C, writer as W
from .build_all import catalogue_horizon, horizon_warnings
from .dem import load_site_dems
from .extended import MAP_SITES

REFINED_VERSION = 1
CELL_RE = re.compile(r"^r(\d+)c(\d+)$")
PRESENTATION_CELLS = [("Site01", "r36c32")]


class UsageError(ValueError):
    pass


def _json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def parse_cell(text, nx, ny):
    """'r36c32' -> (36, 32); UsageError if malformed or outside the nx x ny map."""
    m = CELL_RE.match(text)
    if not m:
        raise UsageError(f"cell id {text!r} must look like r<row>c<col>, e.g. r36c32")
    row, col = int(m.group(1)), int(m.group(2))
    if row >= ny or col >= nx:
        raise UsageError(f"cell id {text!r} is outside the {nx}x{ny} map (rows 0..{ny - 1}, cols 0..{nx - 1})")
    return row, col


def site_inputs(site_id):
    """(map.json, extended.json cells section) of a map site; UsageError if there is none."""
    if site_id not in MAP_SITES:
        raise UsageError(f"{site_id!r} has no regional map (map sites: {', '.join(MAP_SITES)})")
    header = _json(C.OUT_DIR / site_id / "extended.json")
    if "cells" not in header:
        raise UsageError(f"{site_id}/extended.json has no cells section; run python -m preprocess.extended first")
    return _json(C.OUT_DIR / site_id / "map.json"), header["cells"]


def merge(old, site_id, cells_sha256, entries):
    """New refined.json: old entries are kept only when they refer to the same cells.bin."""
    kept = {}
    if old and old.get("cellsSha256") == cells_sha256:
        kept = dict(old.get("cells", {}))
    elif old:
        print(f"[{site_id}] existing refined.json refers to another cells.bin; its "
              f"{len(old.get('cells', {}))} entries are dropped")
    kept.update(entries)
    return {"version": REFINED_VERSION, "siteId": site_id, "cellsSha256": cells_sha256, "cells": kept}


def refine_entry(lat_deg, lon_deg, eye_m, near, far, far_range_m=C.FAR_RANGE_M):
    elev, dist, bad, fb, d = catalogue_horizon(lat_deg, lon_deg, eye_m, near, far, far_range_m)
    hw, n_leave, affected = horizon_warnings(lat_deg, lon_deg, eye_m, far, near.crs, elev, d, fb, far_range_m)
    # same rounding as horizon.json (writer.horizon_doc)
    return {"latDeg": lat_deg, "lonDeg": lon_deg, "eyeM": eye_m, "azStepDeg": C.AZ_STEP_DEG, "count": int(elev.size),
            "elevDeg": [round(float(x), 4) for x in elev], "distanceM": [round(float(x), 0) for x in dist],
            "warnings": hw}, int(bad.sum())


def refine(site_id, cell_ids, out_root=None):
    """Refine `cell_ids` of `site_id` and write <out_root>/<site_id>/refined.json; return the doc."""
    m, cells = site_inputs(site_id)
    nx, ny = m["grid"]["nx"], m["grid"]["ny"]
    rc = {cid: parse_cell(cid, nx, ny) for cid in cell_ids}
    # the far DEM window must reach FAR_RANGE_M from every cell, as in regional_map.build
    near, far, _ = load_site_dems(site_id, far_range_m=C.FAR_RANGE_M + m["grid"]["halfSizeM"] * 1.5)
    entries = {}
    for cid, (row, col) in rc.items():
        t0 = time.time()
        i = row * nx + col
        entry, n_ref = refine_entry(m["latDeg"][i], m["lonDeg"][i], cells["eyeM"][i], near, far)
        entries[cid] = entry
        print(f"[{site_id}] {cid}: eye {entry['eyeM']} m, refined {n_ref} / {entry['count']} azimuths, "
              f"{len(entry['warnings'])} warnings, {time.time() - t0:.0f} s")
    path = (out_root or C.OUT_DIR) / site_id / "refined.json"
    doc = merge(_json(path) if path.exists() else None, site_id, cells["sha256"], entries)
    W.write(path, doc)
    return doc


def reference_cells():
    """Site01 r36c32 plus the (siteId, row, col) cells of docs/reference/cells.json, grouped by site."""
    out = {}
    ref = _json(C.ROOT / "docs" / "reference" / "cells.json")
    for sid, cid in PRESENTATION_CELLS + [(c["siteId"], f"r{c['row']}c{c['col']}") for c in ref]:
        if cid not in out.setdefault(sid, []):
            out[sid].append(cid)
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--site")
    ap.add_argument("--cells", nargs="+")
    ap.add_argument("--reference", action="store_true", help="Site01 r36c32 + docs/reference/cells.json cells")
    ap.add_argument("--out-root", help="directory holding <site>/refined.json (default public/data)")
    args = ap.parse_args(argv)
    if (args.site or args.cells) if args.reference else not (args.site and args.cells):
        ap.error("give either --site with --cells, or --reference")
    jobs = reference_cells() if args.reference else {args.site: args.cells}
    out_root = Path(args.out_root) if args.out_root else None
    try:  # check every request before any DEM is loaded or file written
        for sid, cids in jobs.items():
            m, _ = site_inputs(sid)
            for cid in cids:
                parse_cell(cid, m["grid"]["nx"], m["grid"]["ny"])
    except UsageError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    for sid, cids in jobs.items():
        refine(sid, cids, out_root)
    return 0


if __name__ == "__main__":
    sys.exit(main())
