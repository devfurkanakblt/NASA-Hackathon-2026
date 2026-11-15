"""External comparison of every regional map cell with the PGDA polar illumination maps.

Extends validation §5 (7 site centres) to all map cells (7 maps, 3 721 or 961 cells each).

Our side, per cell: the cell's own terrain horizon (the 0.5 deg horizon behind map.json, cached in
data_raw/map_{site}.npz; same ray marcher, DEMs and 250 km range as horizon.json) and an
independent long-term ephemeris (Skyfield + DE421, 18.6 years) computed once at the site centre and
re-projected into each cell's local frame with the same code as map.json
(regional_map.body_vectors + local_azel). Definitions as in the products (see external.py):
  Sun   = mean visible fraction of the solar disk (linear approximation of the contract),
  Earth = fraction of time any part of the Earth's disk is above the terrain horizon.

Reference: AVGVISIB_85S_060M_201608 (Sun) and ..._EARTH, 60 m/px, pixel containing the cell centre,
plus the min-max of its 3x3 neighbourhood (180 m).

Not identical inputs (as in §5): the products use the 2016 60 m DEM and an observer on the surface;
we use the 5 m DEMs near the site and an observer 2 m above it. Differences are therefore expected on
steep slopes and sharp rims, so the results are also split by slope.

Usage: python -m preprocess.external_map [--sites Site01 ...] [--step-h 2] [--workers N]
       -> docs/validation.md §8, docs/reference/external-map.json, docs/figures/external-map.png
"""
import argparse
import json
import os
import time
from datetime import datetime, timedelta, timezone
from multiprocessing import Pool

import numpy as np
import rasterio

from . import config as C
from . import visibility as V
from .dem import to_xy
from .external import EARTH_RADIUS_M, ILLUM, LT_START, LT_YEARS, PRODUCTS, spearman
from .regional_map import MAP_AZ_STEP_DEG, body_vectors, local_azel
from .validate import load_eye

HEADING = "## 8. External comparison over every map cell (PGDA illumination maps)"
GENTLE_DEG = 10.0
STEEP_DEG = 25.0
RANGE_TOL = 0.02   # same allowance as §5 for "inside the 3x3 range"


# ---------------------------------------------------------------- ephemeris (once per site)
def long_term(site_id, step_s):
    from . import ephemeris_skyfield as SF
    s = C.SITES[site_id]
    t0 = datetime.fromisoformat(LT_START.replace("Z", "+00:00"))
    stop = t0 + timedelta(days=LT_YEARS * 365.25)
    iso = lambda t: t.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")  # noqa: E731
    eph = {}
    for b in ("sun", "earth"):
        rows = SF.query(b, s["lat"], s["lon"], load_eye(site_id), iso(t0), iso(stop), step_s)
        eph[b] = {"azDeg": np.array([r[1] for r in rows]), "elDeg": np.array([r[2] for r in rows]),
                  "distanceM": np.array([r[3] for r in rows])}
    return eph


# ---------------------------------------------------------------- per-cell work
_W = {}


def _init(body, r_sun, r_earth):
    _W.update(body=body, r_sun=r_sun, r_earth=r_earth)


def _cell(args):
    hz_elev, lat, lon, eye = args
    hz = {"elevDeg": hz_elev, "azStepDeg": MAP_AZ_STEP_DEG, "count": hz_elev.size}
    az, el = local_azel(_W["body"]["sun"][0], lat, lon, eye)
    m = el - V.horizon_at(hz, az)
    sun = float(np.clip((m + _W["r_sun"]) / (2 * _W["r_sun"]), 0.0, 1.0).mean())
    az, el = local_azel(_W["body"]["earth"][0], lat, lon, eye)
    earth = float((el - V.horizon_at(hz, az) + _W["r_earth"] > 0).mean())
    return sun, earth


def ours(site_id, eph, workers):
    z = np.load(C.RAW_DIR / f"map_{site_id}.npz")
    s = C.SITES[site_id]
    body = body_vectors(eph, s["lat"], s["lon"], load_eye(site_id))
    r_sun = V.SUN_RADIUS_AU_DEG * V.AU_M / body["sun"][1]
    r_earth = np.degrees(np.arcsin(EARTH_RADIUS_M / body["earth"][1]))
    args = list(zip(z["horizons"].astype(np.float64), z["lat"], z["lon"], z["eye"]))
    with Pool(workers, initializer=_init, initargs=(body, r_sun, r_earth)) as pool:
        res = np.array(pool.map(_cell, args, chunksize=16))
    return dict(lat=z["lat"], lon=z["lon"], slope=z["slope"], sun=res[:, 0], earth=res[:, 1])


# ---------------------------------------------------------------- product
def product(name, lat, lon):
    """Pixel value and 3x3 min/max at each (lat, lon); NaN where the product has no data."""
    with rasterio.open(ILLUM / f"{PRODUCTS[name]}.TIF") as src:
        x, y = to_xy(src.crs, lon, lat)
        rows, cols = rasterio.transform.rowcol(src.transform, x, y)
        rows, cols = np.asarray(rows), np.asarray(cols)
        r0, r1, c0, c1 = rows.min() - 1, rows.max() + 2, cols.min() - 1, cols.max() + 2
        a = src.read(1, window=((r0, r1), (c0, c1))).astype(np.float64)
        a[a == src.nodata] = np.nan
        a = a * src.scales[0] + src.offsets[0]
    r, c = rows - r0, cols - c0
    nb = np.stack([a[r + dr, c + dc] for dr in (-1, 0, 1) for dc in (-1, 0, 1)])
    return a[r, c], np.nanmin(nb, 0), np.nanmax(nb, 0)


# ---------------------------------------------------------------- statistics
def _corr(a, b):
    """Pearson r, or None when it is undefined (fewer than 3 cells or a constant side)."""
    if a.size < 3 or not a.std() or not b.std():
        return None
    return float(np.corrcoef(a, b)[0, 1])


def stats(o, ref, lo, hi):
    ok = np.isfinite(o) & np.isfinite(ref)
    o, ref, lo, hi = o[ok], ref[ok], lo[ok], hi[ok]
    if o.size == 0:
        return dict(n=0)
    d = o - ref
    return dict(n=int(o.size), bias=float(d.mean()), mae=float(np.abs(d).mean()),
                rmse=float(np.sqrt((d ** 2).mean())), p95=float(np.percentile(np.abs(d), 95)),
                r=_corr(o, ref), rho=spearman(o, ref) if o.size > 2 and o.std() and ref.std() else None,
                in_range=float(((o >= lo - RANGE_TOL) & (o <= hi + RANGE_TOL)).mean()),
                within_05=float((np.abs(d) <= 0.05).mean()), within_10=float((np.abs(d) <= 0.10).mean()))


def compare(site_id, eph, workers):
    t0 = time.time()
    o = ours(site_id, eph, workers)
    out = dict(site=site_id, cells=int(o["lat"].size))
    for b in ("sun", "earth"):
        ref, lo, hi = product(b, o["lat"], o["lon"])
        o[f"ref_{b}"], o[f"lo_{b}"], o[f"hi_{b}"] = ref, lo, hi
        out[b] = stats(o[b], ref, lo, hi)
        slope = o["slope"]
        out[b]["gentle"] = stats(*(v[slope < GENTLE_DEG] for v in (o[b], ref, lo, hi)))
        out[b]["steep"] = stats(*(v[slope > STEEP_DEG] for v in (o[b], ref, lo, hi)))
    print(f"[{site_id}] {out['cells']} cells, {time.time() - t0:.0f} s  "
          f"sun MAE {out['sun']['mae']:.3f} r {out['sun']['r']:.3f}  "
          f"earth MAE {out['earth']['mae']:.3f} r {out['earth']['r']:.3f}")
    return out, o


# ---------------------------------------------------------------- outputs
def _row(name, s):
    if not s.get("n"):
        return f"| {name} | 0 | - | - | - | - | - | - | - |"
    r = "-" if s["r"] is None else f"{s['r']:.3f}"
    return (f"| {name} | {s['n']} | {s['bias']:+.3f} | {s['mae']:.3f} | {s['rmse']:.3f} | {s['p95']:.3f} | "
            f"{r} | {100 * s['in_range']:.0f} % | {100 * s['within_10']:.0f} % |")


def _slope_note(pooled):
    """One sentence on where the differences sit, read from the pooled slope split (not assumed)."""
    parts = []
    for b, name in (("sun", "Sun"), ("earth", "Earth")):
        g, st = pooled[b]["gentle"], pooled[b]["steep"]
        parts.append(f"{name} {g['mae']:.3f} on slopes < {GENTLE_DEG:.0f} deg vs {st['mae']:.3f} on slopes > "
                     f"{STEEP_DEG:.0f} deg")
    worse_gentle = all(pooled[b]["gentle"]["mae"] > pooled[b]["steep"]["mae"] for b in ("sun", "earth"))
    where = ("Most of the difference sits on gentle ground (plateaus and ridge tops), not on steep walls"
             if worse_gentle else "The differences are not concentrated on gentle ground")
    return f"{where}: mean abs diff {'; '.join(parts)}."


def section(results, pooled, step_s):
    head = ("| Site | Cells | Bias (ours - product) | Mean abs diff | RMS diff | 95 % abs diff | Pearson r | "
            "In 3x3 range | abs diff <= 0.10 |")
    sep = "|---|---|---|---|---|---|---|---|---|"
    md = [HEADING, "",
          "Section 5 compares 7 site centres. Here every regional map cell is compared with the same PGDA "
          "products (`AVGVISIB_85S_060M_201608`, `..._EARTH`, 60 m/px). Ours: the cell's own 0.5 deg terrain "
          "horizon (the one behind `map.json`) and an independent Skyfield/DE421 ephemeris over "
          f"{LT_YEARS} years from {LT_START[:10]} at {step_s // 3600}-hour steps, computed at the site centre "
          "and re-projected into each cell's local frame (same code as `map.json`). Same definitions as §5: "
          "Sun = mean visible fraction of the solar disk, Earth = any part of the disk above the horizon. "
          "Values are fractions (0-1); 0.01 = 1 percentage point. Reference = the 60 m pixel containing the "
          f"cell centre; \"in 3x3 range\" = within the min-max of the 180 m neighbourhood (+-{RANGE_TOL}).", "",
          "Generated by `python -m preprocess.external_map`; per-site numbers in "
          "`docs/reference/external-map.json`, scatter plot `docs/figures/external-map.png`.", ""]
    for b, title in (("sun", "Sun (mean visible disk fraction)"), ("earth", "Earth (any part of the disk)")):
        md += [f"### {title}", "", head, sep]
        md += [_row(r["site"], r[b]) for r in results]
        md += [_row("**All cells**", pooled[b]),
               _row(f"All, slope < {GENTLE_DEG:.0f} deg", pooled[b]["gentle"]),
               _row(f"All, slope > {STEEP_DEG:.0f} deg", pooled[b]["steep"]), ""]
        md += [f"Rank correlation (Spearman) over all cells: {pooled[b]['rho']:.3f}.", ""]
    md += ["Reading the table: the bias column shows whether we are systematically brighter or darker "
           "than the product; the slope split shows where the differences sit. " + _slope_note(pooled) + " "
           "Inputs differ: the products use the 2016 60 m DEM and an observer on the surface, we use the "
           "5 m DEMs and an observer 2 m above it. Near the pole the Sun stays within a few degrees of the "
           "horizon, so on flat high ground a small change in the local horizon (finer terrain, observer "
           "height) changes the lit fraction noticeably; on steep walls the horizon is dominated by large "
           "terrain that both DEMs resolve. Pearson r is shown as \"-\" where one side is constant. "
           "This is a comparison with an independent published model, not with ground truth.", ""]
    return md


def splice(md):
    path = C.ROOT / "docs" / "validation.md"
    lines = path.read_text(encoding="utf-8").split("\n")
    if HEADING in lines:
        a = lines.index(HEADING)
        b = next((i for i in range(a + 1, len(lines)) if lines[i].startswith("## ")), len(lines))
    else:
        footer = "Pixel size and these numerical checks"
        tail = [i for i, l in enumerate(lines) if l.startswith(footer)]
        a = b = tail[-1] if tail and tail[-1] > max(i for i, l in enumerate(lines) if l.startswith("## ")) \
            else len(lines)
    lines[a:b] = md
    path.write_text("\n".join(lines), encoding="utf-8")
    print(f"updated {path.relative_to(C.ROOT)}")


def figure(cells):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, axes = plt.subplots(1, 2, figsize=(10, 4.8), constrained_layout=True)
    for ax, b, title in ((axes[0], "sun", "Sun: mean visible disk fraction"),
                         (axes[1], "earth", "Earth: fraction of time in view")):
        for sid, o in cells.items():
            ok = np.isfinite(o[f"ref_{b}"])
            ax.scatter(o[f"ref_{b}"][ok], o[b][ok], s=2, alpha=0.35, label=sid, rasterized=True)
        ax.plot([0, 1], [0, 1], color="0.3", lw=1)
        ax.set(xlim=(0, 1), ylim=(0, 1), aspect="equal", title=title,
               xlabel="NASA PGDA product (60 m, 18.6 yr)", ylabel="This project (map cell, 18.6 yr)")
        ax.grid(alpha=0.3)
    axes[1].legend(markerscale=6, fontsize=8, loc="lower right")
    n = sum(o["lat"].size for o in cells.values())
    fig.suptitle(f"Every regional map cell ({n} cells, 7 polar sites) vs NASA's published illumination maps")
    out = C.ROOT / "docs" / "figures" / "external-map.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out, dpi=150)
    print(f"wrote {out.relative_to(C.ROOT)}")


def main():
    map_sites = [s for s in C.SITES if (C.RAW_DIR / f"map_{s}.npz").exists()]
    ap = argparse.ArgumentParser()
    ap.add_argument("--sites", nargs="+", default=map_sites)
    ap.add_argument("--step-h", type=int, default=2, help="ephemeris step in hours (default 2)")
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 2))
    args = ap.parse_args()
    step_s = args.step_h * 3600

    results, cells = [], {}
    for sid in args.sites:
        eph = long_term(sid, step_s)
        r, o = compare(sid, eph, args.workers)
        results.append(r)
        cells[sid] = o
    cat = {k: np.concatenate([o[k] for o in cells.values()])
           for k in ("sun", "earth", "slope", "ref_sun", "lo_sun", "hi_sun", "ref_earth", "lo_earth", "hi_earth")}
    pooled = {}
    for b in ("sun", "earth"):
        v = [cat[b], cat[f"ref_{b}"], cat[f"lo_{b}"], cat[f"hi_{b}"]]
        pooled[b] = stats(*v)
        pooled[b]["gentle"] = stats(*(x[cat["slope"] < GENTLE_DEG] for x in v))
        pooled[b]["steep"] = stats(*(x[cat["slope"] > STEEP_DEG] for x in v))
        ok = np.isfinite(v[0]) & np.isfinite(v[1])
        pooled[b]["rho"] = spearman(v[0][ok], v[1][ok])
        print(b, {k: (round(x, 4) if isinstance(x, float) else x) for k, x in pooled[b].items()
                  if not isinstance(x, dict)})

    ref = C.ROOT / "docs" / "reference" / "external-map.json"
    ref.write_text(json.dumps({"stepS": step_s, "start": LT_START, "years": LT_YEARS, "sites": results,
                               "all": pooled}, indent=1), encoding="utf-8")
    print(f"wrote {ref.relative_to(C.ROOT)}")
    splice(section(results, pooled, step_s))
    figure(cells)


if __name__ == "__main__":
    main()
