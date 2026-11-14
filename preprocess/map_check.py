"""Validation of the regional maps (plan P1.6) -> docs/validation.md §6.

1. Centre cell vs the published site values (docs/reference/visibility.json, full 0.1 deg horizon).
2. Random cells (fixed seed): map value (0.5 deg horizon) vs a full 0.1 deg horizon recomputed at
   the same cell with the same eye height and the same per-cell Sun/Earth directions.
   This isolates the only approximation of the map: the azimuth step.
3. Consistency: Site04R (derived ridge point) should rank among the best-lit cells of the Site04 map.

Usage: python -m preprocess.map_check [--sites Site01 ...] [--cells 6]
"""
import argparse
import json

import numpy as np

from . import config as C
from . import horizon as Hz
from . import regional_map as M
from .dem import Dem, to_xy
from .validate import load, load_eye

ACCEPT_PCT = 1.0  # percentage points


def cell_full(site_id, lat, lon, eye, near, far, body, step_s):
    elev, _, _ = Hz.compute(lat, lon, eye, near, far, near.crs)
    hz = {"elevDeg": elev, "azStepDeg": C.AZ_STEP_DEG, "count": elev.size}
    return M.cell_stats(body, hz, lat, lon, eye, step_s)


def check_site(site_id, n_cells, seed):
    npz = np.load(C.RAW_DIR / f"map_{site_id}.npz")
    doc = load(site_id, "map.json")
    s = C.SITES[site_id]
    eph = load(site_id, "ephemeris.json")
    body = M.body_vectors(eph, s["lat"], s["lon"], load_eye(site_id))
    near = Dem.open(C.local_dem_path(site_id))
    far = Dem.open(C.REGIONAL_DEM_PATH, center_xy=to_xy(near.crs, s["lon"], s["lat"]),
                   half_size_m=C.FAR_RANGE_M + 2_000 + doc["grid"]["halfSizeM"] * 1.5)
    ic = int(np.flatnonzero((npz["e"] == 0) & (npz["n"] == 0))[0])
    ref = json.loads((C.ROOT / "docs" / "reference" / "visibility.json").read_text(encoding="utf-8"))
    pv = ref["sites"][site_id]["percentVisible"]
    centre = dict(sun=doc["sunPct"][ic] - pv["sun"], earth=doc["earthPct"][ic] - pv["earth"],
                  both=doc["bothPct"][ic] - pv["both"])
    rng = np.random.default_rng(seed)
    idx = rng.choice(npz["lat"].size, n_cells, replace=False)
    diffs = []
    for i in idx:
        full = cell_full(site_id, npz["lat"][i], npz["lon"][i], npz["eye"][i], near, far, body, eph["stepS"])
        diffs.append([npz["stats"][i][k] - full[k] for k in range(3)])
    diffs = np.abs(np.array(diffs))
    return dict(site=site_id, n=int(doc["grid"]["nx"]) ** 2, spacing=doc["grid"]["spacingM"],
                centre=centre, cells=len(idx), max_sun=float(diffs[:, 0].max()),
                max_earth=float(diffs[:, 1].max()), max_both=float(diffs[:, 2].max()),
                mean_sun=float(diffs[:, 0].mean()), mean_earth=float(diffs[:, 1].mean()))


def site04r_rank():
    """Where does the derived ridge point fall in the Site04 map?"""
    doc = load("Site04", "map.json")
    lat, lon = np.array(doc["latDeg"]), np.array(doc["lonDeg"])
    r = C.SITES["Site04R"]
    near = Dem.open(C.local_dem_path("Site04"))
    x, y = to_xy(near.crs, lon, lat)
    x0, y0 = to_xy(near.crs, r["lon"], r["lat"])
    k = int(np.argmin(np.hypot(x - x0, y - y0)))
    sun = np.array(doc["sunPct"], dtype=float)
    both = np.array(doc["bothPct"], dtype=float)
    return dict(dist=float(np.hypot(x[k] - x0, y[k] - y0)), sun=sun[k], both=both[k],
                sun_pctile=float((sun < sun[k]).mean() * 100), both_pctile=float((both < both[k]).mean() * 100),
                frac100=float((sun >= 99.99).mean() * 100), centre_sun=sun[sun.size // 2])


def section(rows, r04):
    md = ["## 6. Regional maps (`map.json`)", "",
          "Each map cell has its own terrain horizon (same ray marcher, step sizes, DEMs and 250 km range as "
          "`horizon.json`, but a 0.5 deg azimuth step) and its own Sun/Earth directions (body positions "
          "rebuilt in the Moon-fixed frame from the site's Horizons ephemeris and projected into the cell's "
          "local frame; at the site centre this reproduces ephemeris.json to 1e-13 deg).", "",
          "Centre cell = published site values (full 0.1 deg horizon); random cells = map value vs a full "
          f"0.1 deg horizon recomputed at that cell. Acceptance: <= {ACCEPT_PCT} percentage point.", "",
          "| Site | Cells | Spacing [m] | Centre dSun / dEarth / dBoth [pp] | Random cells | "
          "max |dSun| [pp] | max |dEarth| [pp] | max |dBoth| [pp] | Pass |",
          "|---|---|---|---|---|---|---|---|---|"]
    for r in rows:
        c = r["centre"]
        ok = max(abs(c["sun"]), abs(c["earth"]), abs(c["both"]), r["max_sun"], r["max_earth"],
                 r["max_both"]) <= ACCEPT_PCT
        md.append(f"| {r['site']} | {r['n']} | {r['spacing']:.0f} | {c['sun']:+.2f} / {c['earth']:+.2f} / "
                  f"{c['both']:+.2f} | {r['cells']} | {r['max_sun']:.2f} | {r['max_earth']:.2f} | "
                  f"{r['max_both']:.2f} | {'yes' if ok else 'NO'} |")
    if r04:
        md += ["", f"Consistency: the Site04 map cell nearest to the derived ridge point Site04R "
               f"({r04['dist']:.0f} m away) has Sun {r04['sun']:.1f} % and Sun+Earth {r04['both']:.1f} %, "
               f"in the top {100 - r04['sun_pctile']:.1f} % / {100 - r04['both_pctile']:.1f} % of the map's cells "
               f"(catalogue centre: Sun {r04['centre_sun']:.1f} %). {r04['frac100']:.1f} % of the cells see the "
               "Sun at every sample of the period."]
    md += ["", "The map reports a 2-month period (same as ephemeris.json); see `season.json` for the "
           "seasonal change at the site centres. Slope is from the 5 m DEM over a 25 m baseline; it is a "
           "terrain descriptor, not a landing-safety assessment.", ""]
    return md


def write_section(md):
    path = C.ROOT / "docs" / "validation.md"
    text = path.read_text(encoding="utf-8")
    head = "## 6. Regional maps"
    if head in text:
        i = text.index(head)
        j = text.find("\n## ", i + 1)
        text = text[:i] + (text[j + 1:] if j != -1 else "")
    footer = "Pixel size and these numerical checks"
    k = text.find(footer)
    block = "\n".join(md) + "\n"
    text = text[:k] + block + text[k:] if k != -1 else text + "\n" + block
    path.write_text(text, encoding="utf-8")
    print(f"updated {path.relative_to(C.ROOT)}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sites", nargs="+", default=None)
    ap.add_argument("--cells", type=int, default=6)
    args = ap.parse_args()
    sites = args.sites or [s for s in C.SITES if (C.OUT_DIR / s / "map.json").exists()
                           and (C.RAW_DIR / f"map_{s}.npz").exists()]
    rows = []
    for k, sid in enumerate(sites):
        r = check_site(sid, args.cells, seed=100 + k)
        print(r)
        rows.append(r)
    r04 = site04r_rank() if (C.OUT_DIR / "Site04" / "map.json").exists() else None
    print(r04)
    write_section(section(rows, r04))


if __name__ == "__main__":
    main()
