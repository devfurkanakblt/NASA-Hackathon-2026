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
import re

import numpy as np

from . import config as C, writer as W
from . import season as S
from .validate import load, load_eye

YEAR_FIELDS = [(b, f) for b in ("sun", "earth") for f in ("azDeg", "elDeg", "distanceM")]


def year_array(site_id):
    """(6, count) float32 array of the one-year series, in YEAR_FIELDS order."""
    eph = S.as_eph(S.query_year(site_id))
    return np.stack([np.asarray(eph[b][f], dtype=np.float64) for b, f in YEAR_FIELDS]).astype("<f4")


def write_year(site_id):
    y = year_array(site_id)
    if not np.isfinite(y).all():
        raise ValueError(f"{site_id}: year series has non-finite values, year.bin not written")
    path = C.OUT_DIR / site_id / "year.bin"
    path.parent.mkdir(parents=True, exist_ok=True)
    y.tofile(path)
    print(f"wrote {path.relative_to(C.ROOT)} ({path.stat().st_size / 1e6:.2f} MB)")
    site = next(x for x in load_sites() if x["id"] == site_id)
    return {"file": "year.bin", "sha256": W.sha256_file(path),
            "startUtc": S.SEASON_START, "endUtc": S.SEASON_STOP, "stepS": C.STEP_S,
            "count": int(y.shape[1]), "source": "jpl-horizons",
            "observer": {"latDeg": site["latDeg"], "lonDeg": site["lonDeg"],
                         "eyeM": round(float(load_eye(site_id)), 2)},
            "fields": [f"{b}.{f}" for b, f in YEAR_FIELDS]}


# ---------------------------------------------------------------- cells
MAP_SITES = [s for s in C.SITES if C.SITES[s].get("dem") != "ldem64"]
TEST_CELLS_61 = [(5, 5), (5, 55), (55, 5), (55, 55), (30, 10), (36, 32)]
REFERENCE_CELLS = [("Site01", None), ("Site01", (36, 32)), ("Site04", (5, 55)), ("Site07", (55, 5)),
                   ("Site11", (2, 27))]
REFERENCE_SAMPLES = [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 8784]


def _npz(site_id):
    return np.load(C.RAW_DIR / f"map_{site_id}.npz")


def cells_int16(site_id):
    """(N, 360) int16 horizons in 0.01 deg: every second 0.5 deg value (decimation, not averaging)."""
    hz = _npz(site_id)["horizons"]
    assert hz.shape[1] == 720, hz.shape
    v = np.round(hz[:, ::2].astype(np.float64) * 100)
    lim = np.iinfo("<i2")
    if not np.isfinite(v).all():
        raise ValueError(f"{site_id}: cell horizons contain non-finite values, cells.bin not written")
    if v.min() < lim.min + 1 or v.max() > lim.max:
        raise ValueError(f"{site_id}: cell horizons outside int16 range at 0.01 deg "
                         f"({v.min() / 100:.2f}..{v.max() / 100:.2f} deg), cells.bin not written")
    return v.astype("<i2")


def eye_m(site_id):
    return [round(float(v), 2) for v in _npz(site_id)["eye"]]


def write_cells(site_id):
    c = cells_int16(site_id)
    if (c == -32768).any():
        raise ValueError(f"{site_id}: cells contain the -32768 sentinel, cells.bin not written")
    path = C.OUT_DIR / site_id / "cells.bin"
    c.tofile(path)
    print(f"wrote {path.relative_to(C.ROOT)} ({path.stat().st_size / 1e6:.2f} MB)")
    g = load(site_id, "map.json")["grid"]
    return {"file": "cells.bin", "sha256": W.sha256_file(path), "azStartDeg": 0, "azStepDeg": 1,
            "count": 360, "coverageDeg": 360, "unitDeg": 0.01, "horizonResolutionDeg": 1,
            "n": int(c.shape[0]), "eyeM": eye_m(site_id),
            "grid": {k: g[k] for k in ("nx", "ny", "spacingM", "halfSizeM")}}


def fixed_cells(nx):
    """Fixed test cells (row, col): centre plus TEST_CELLS_61, halved on 31x31 maps."""
    c = nx // 2
    k = 1 if nx == 61 else 2
    return [(c, c)] + [(r // k, q // k) for r, q in TEST_CELLS_61]


def check(site_id):
    """Max |difference| in percentage points between 1 deg cell horizons and map.json (0.5 deg)."""
    from .regional_map import body_vectors, cell_stats
    m = load(site_id, "map.json")
    eph = load(site_id, "ephemeris.json")
    s = next(x for x in load_sites() if x["id"] == site_id)
    body = body_vectors(eph, s["latDeg"], s["lonDeg"], s["surfaceElevationM"] + s["observerHeightM"])
    c = cells_int16(site_id)
    eye = eye_m(site_id)
    nx = m["grid"]["nx"]
    out = {"sunPct": 0.0, "earthPct": 0.0, "bothPct": 0.0, "cells": 0}
    for r, q in fixed_cells(nx):
        i = r * nx + q
        hz = {"elevDeg": c[i] / 100.0, "azStepDeg": 1, "count": 360}
        st = cell_stats(body, hz, m["latDeg"][i], m["lonDeg"][i], eye[i], eph["stepS"])
        for k, key in enumerate(("sunPct", "earthPct", "bothPct")):
            out[key] = max(out[key], abs(round(float(st[k]), 2) - m[key][i]))
        out["cells"] += 1
    return {k: round(v, 2) if isinstance(v, float) else v for k, v in out.items()}


def load_sites():
    return json.loads((C.OUT_DIR / "sites.json").read_text(encoding="utf-8"))["sites"]


def reference_doc():
    """Az/el of Sun/Earth seen from a few cells, from ephemeris.json (float64), for the TS test."""
    from .regional_map import body_vectors, local_azel
    sites = {x["id"]: x for x in load_sites()}
    out = []
    for sid, rc in REFERENCE_CELLS:
        m = load(sid, "map.json")
        nx = m["grid"]["nx"]
        r, q = rc if rc else (nx // 2, nx // 2)
        i = r * nx + q
        s = sites[sid]
        eph = load(sid, "ephemeris.json")
        body = body_vectors(eph, s["latDeg"], s["lonDeg"], s["surfaceElevationM"] + s["observerHeightM"])
        eye = eye_m(sid)[i]
        azel = {b: local_azel(body[b][0][REFERENCE_SAMPLES], m["latDeg"][i], m["lonDeg"][i], eye)
                for b in ("sun", "earth")}
        out.append({"siteId": sid, "row": r, "col": q, "index": i, "samples": [
            {"i": t, **{b: {"azDeg": round(float(azel[b][0][k]), 6), "elDeg": round(float(azel[b][1][k]), 6)}
                        for b in ("sun", "earth")}} for k, t in enumerate(REFERENCE_SAMPLES)]})
    return out


# ---------------------------------------------------------------- near-field warning
NEAR_FIELD_RE = re.compile(r"(\d+) near-field ray samples")


def near_field_total(n_cells, n_az=720):
    """Number of near-field terrain samples of a map: cells x azimuths x ray steps <= NEAR_RANGE_M
    (the same is_near set as horizon.compute, whose misses are the fallback count)."""
    from . import horizon as Hz
    return int(n_cells) * int(n_az) * int((Hz.distances() <= C.NEAR_RANGE_M).sum())


def near_field_warning(fallback, total):
    return (f"{100 * fallback / total:.1f} % of terrain samples within {C.NEAR_RANGE_M / 1000:.0f} km "
            "of each cell fell outside the 5 m DEM and used the 80 m DEM")


def rewrite_warning(site_id):
    """Replace only the raw near-field count line in map.json; every other byte stays the same."""
    path = C.OUT_DIR / site_id / "map.json"
    text = path.read_text(encoding="utf-8")
    old = json.loads(text)
    ws = old.get("warnings", [])
    hits = [w for w in ws if NEAR_FIELD_RE.match(w)]
    if not hits:
        print(f"[{site_id}] no raw near-field count, unchanged")
        return
    (w,) = hits
    n = len(old["latDeg"])
    new_w = near_field_warning(int(NEAR_FIELD_RE.match(w).group(1)), near_field_total(n))
    new_text = text.replace(json.dumps(w), json.dumps(new_w))
    new = json.loads(new_text)
    assert new["warnings"] == [new_w if x == w else x for x in ws]
    assert {k: v for k, v in new.items() if k != "warnings"} == {k: v for k, v in old.items() if k != "warnings"}
    path.write_text(new_text, encoding="utf-8")
    print(f"[{site_id}] {new_w}")


def read_header(site_id):
    p = C.OUT_DIR / site_id / "extended.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def write_header(site_id, year, cells=None):
    doc = {"version": W.VERSION, "extendedSchema": 2, "siteId": site_id, "year": year}
    if cells is not None:
        doc["cells"] = cells
    W.write(C.OUT_DIR / site_id / "extended.json", doc)
    return doc


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sites", nargs="+", default=list(C.SITES))
    ap.add_argument("--only", choices=["year", "cells", "warning", "reference"])
    ap.add_argument("--check", action="store_true", help="print 1 deg cells vs map.json differences")
    args = ap.parse_args()
    if args.check:
        print("site      cells  max|d sun|  max|d earth|  max|d both|  (percentage points)")
        for sid in [s for s in args.sites if s in MAP_SITES]:
            d = check(sid)
            print(f"{sid:9s} {d['cells']:5d}  {d['sunPct']:10.2f}  {d['earthPct']:12.2f}  {d['bothPct']:11.2f}")
        return
    for sid in args.sites:
        if args.only in (None, "year"):
            old = read_header(sid) or {}
            write_header(sid, write_year(sid), old.get("cells"))
        if args.only in (None, "cells") and sid in MAP_SITES:
            old = read_header(sid)
            assert old is not None, f"{sid}: run --only year first"
            write_header(sid, old["year"], write_cells(sid))
    if args.only in (None, "warning"):
        for sid in [s for s in args.sites if s in MAP_SITES]:
            rewrite_warning(sid)
    if args.only in (None, "reference"):
        p = C.ROOT / "docs" / "reference" / "cells.json"
        p.write_text(json.dumps(reference_doc(), indent=1), encoding="utf-8")
        print(f"wrote {p.relative_to(C.ROOT)}")


if __name__ == "__main__":
    main()
