"""One-year ephemeris and per-cell horizons as lazily loaded binary files (web app extension).

Reads only existing caches (data_raw/horizons_cache/, data_raw/map_*.npz); no new computation
and no network request when the caches are warm. Writes per site:

  {site}/year.bin       little-endian float32, 6 blocks of `count` values:
                        sun.azDeg, sun.elDeg, sun.distanceM, earth.azDeg, earth.elDeg, earth.distanceM
  {site}/cells.bin      little-endian int16, unit 0.01 deg, row = map cell (map.json order),
                        360 columns = azimuth j * 1 deg (every second 0.5 deg npz value)
  {site}/extended.json  small header describing both files

Usage: python -m preprocess.extended [--sites ...] [--only year|cells|warning|reference] [--check]
"""
import argparse
import json

import numpy as np

from . import config as C, writer as W
from . import season as S
from .validate import load

YEAR_FIELDS = [(b, f) for b in ("sun", "earth") for f in ("azDeg", "elDeg", "distanceM")]


def year_array(site_id):
    """(6, count) float32 array of the one-year series, in YEAR_FIELDS order."""
    eph = S.as_eph(S.query_year(site_id))
    return np.stack([np.asarray(eph[b][f], dtype=np.float64) for b, f in YEAR_FIELDS]).astype("<f4")


def write_year(site_id):
    y = year_array(site_id)
    path = C.OUT_DIR / site_id / "year.bin"
    path.parent.mkdir(parents=True, exist_ok=True)
    y.tofile(path)
    print(f"wrote {path.relative_to(C.ROOT)} ({path.stat().st_size / 1e6:.2f} MB)")
    return {"file": "year.bin", "startUtc": S.SEASON_START, "stepS": C.STEP_S,
            "count": int(y.shape[1]), "source": "jpl-horizons"}


def read_header(site_id):
    p = C.OUT_DIR / site_id / "extended.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def write_header(site_id, year, cells=None):
    doc = {"version": W.VERSION, "siteId": site_id, "year": year}
    if cells is not None:
        doc["cells"] = cells
    W.write(C.OUT_DIR / site_id / "extended.json", doc)
    return doc


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sites", nargs="+", default=list(C.SITES))
    ap.add_argument("--only", choices=["year", "cells", "warning", "reference"])
    args = ap.parse_args()
    for sid in args.sites:
        if args.only in (None, "year"):
            old = read_header(sid) or {}
            write_header(sid, write_year(sid), old.get("cells"))


if __name__ == "__main__":
    main()
