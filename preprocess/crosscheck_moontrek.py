"""Cross-check the 3D terrain grids against the LOLA DEM served by NASA Moon Trek.

Moon Trek (https://trek.nasa.gov/moon/) is one of the NASA resources listed on the challenge
page. Its `LRO_LOLA_DEM_SPole875_5mp_v04` image service holds the LOLA 5 m/px south-pole DEM
(87.5 S to the pole) in south-polar stereographic metres, heights relative to the 1737.4 km
sphere. It is a different LOLA product from the site DEMs (Barker et al. 2021) the pipeline
uses, so agreement between the two is an independent check of the terrain shown in 3D.

For each site this script downloads a native-resolution crop, rebuilds the terrain grid with
the same code as build_all (`terrain.build`) and compares it with
`public/data/{site}/terrain.json`. Nothing in `public/data/` is modified.

Usage:
  python -m preprocess.crosscheck_moontrek            # all sites -> docs/validation-moontrek.md
  python -m preprocess.crosscheck_moontrek Site01     # selected sites, printed only

Crops are cached in data_raw/moontrek/ (not committed).
This script was written with AI assistance (Anthropic Claude).
"""
import json
import math
import sys
from pathlib import Path

if __package__ in (None, ""):  # run as a file: make the repo root importable
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np
import rasterio
import requests

from preprocess import config as C
from preprocess import terrain as T
from preprocess.dem import Dem, to_xy

PRODUCT = "LRO_LOLA_DEM_SPole875_5mp_v04"
SERVICE = f"https://trek.nasa.gov/moon/trekarcgis/rest/services/{PRODUCT}/ImageServer"
# From the service metadata: Stereographic_South_Pole, central meridian 0, true scale at the pole.
MOONTREK_CRS = f"+proj=stere +lat_0=-90 +lon_0=0 +k=1 +x_0=0 +y_0=0 +R={C.MOON_RADIUS_M} +units=m +no_defs"
RES_M = 5.0
GRID_HALF_M = 5_000.0   # terrain.json covers +/- 5 km in local east/north
MARGIN_M = 60.0
GENTLE_DEG, STEEP_DEG = 10.0, 25.0   # slope classes used in the report
UA = {"User-Agent": "LunarSiteNavigator-preprocess/0.1"}
REPORT = C.ROOT / "docs" / "validation-moontrek.md"


def crop_bounds(lon_deg, x0, y0):
    """Stereographic box (aligned to the 5 m pixel grid) that contains the local ENU square."""
    lam = math.radians(lon_deg)
    half = GRID_HALF_M * (abs(math.cos(lam)) + abs(math.sin(lam))) + MARGIN_M
    lo = lambda v: RES_M * math.floor((v - half) / RES_M)  # noqa: E731
    hi = lambda v: RES_M * math.ceil((v + half) / RES_M)   # noqa: E731
    return lo(x0), lo(y0), hi(x0), hi(y0)


def fetch_crop(site_id, bounds):
    left, bottom, right, top = bounds
    width, height = round((right - left) / RES_M), round((top - bottom) / RES_M)
    dest = C.RAW_DIR / "moontrek" / site_id / f"{PRODUCT}_{left:.0f}_{bottom:.0f}_{right:.0f}_{top:.0f}.tif"
    if not dest.exists():
        params = {"bbox": f"{left},{bottom},{right},{top}", "size": f"{width},{height}",
                  "format": "tiff", "pixelType": "F32", "interpolation": "RSP_NearestNeighbor", "f": "image"}
        r = requests.get(f"{SERVICE}/exportImage", params=params, headers=UA, timeout=600)
        r.raise_for_status()
        if "tiff" not in r.headers.get("Content-Type", ""):
            raise IOError(f"Moon Trek returned {r.headers.get('Content-Type')}: {r.text[:200]}")
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(r.content)
        print(f"  downloaded {dest.name} ({dest.stat().st_size / 1e6:.1f} MB)")
    with rasterio.open(dest) as src:
        z = src.read(1).astype(np.float32)
    if z.shape != (height, width):
        raise IOError(f"{dest.name}: expected {height}x{width} pixels, got {z.shape}")
    return Dem(z, left, top, RES_M, crs=MOONTREK_CRS, name=dest.name), dest


def lookup_difference(dem):
    """Largest difference between crop pixels and Moon Trek's own point lookup (identify), or None."""
    nr, nc = dem.z.shape
    worst = 0.0
    try:
        for k in range(1, 5):   # four pixels along the diagonal of the crop
            r, c = nr * k // 5, nc * k // 5
            point = {"x": dem.left + (c + 0.5) * dem.res, "y": dem.top - (r + 0.5) * dem.res}
            reply = requests.get(f"{SERVICE}/identify", headers=UA, timeout=60, params={
                "geometry": json.dumps(point), "geometryType": "esriGeometryPoint",
                "returnGeometry": "false", "returnCatalogItems": "false", "f": "json"}).json()
            worst = max(worst, abs(float(reply["value"]) - float(dem.z[r, c])))
    except (requests.RequestException, KeyError, ValueError) as exc:
        print(f"  point lookup skipped ({exc})")
        return None
    return worst


def check_site(site_id, entry):
    s = C.SITES[site_id]
    x0, y0 = to_xy(MOONTREK_CRS, s["lon"], s["lat"])
    dem, path = fetch_crop(site_id, crop_bounds(s["lon"], x0, y0))

    eye = entry["surfaceElevationM"] + entry["observerHeightM"]   # same datum as the team's grid
    z_mt, miss = T.build(s["lat"], s["lon"], eye, dem, dem, MOONTREK_CRS)
    if miss:
        raise RuntimeError(f"{site_id}: {miss} grid samples fell outside the Moon Trek crop")

    doc = json.loads((C.OUT_DIR / site_id / "terrain.json").read_text(encoding="utf-8"))
    z_team = np.asarray(doc["zM"], dtype=np.float64).reshape(doc["n"], doc["n"])
    d = z_mt - z_team
    a = np.abs(d)
    # Slope of the grid itself, to show where the two products differ.
    gy, gx = np.gradient(z_team, float(doc["cellM"]))
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    gentle, steep = slope < GENTLE_DEG, slope > STEEP_DEG
    rms = lambda m: float(np.sqrt((d[m] ** 2).mean())) if m.any() else float("nan")  # noqa: E731
    point = float(dem.sample(np.array([x0]), np.array([y0]))[0])
    return {
        "site": site_id,
        "file": path.name,
        "sizeMB": path.stat().st_size / 1e6,
        "relief": float(z_team.max() - z_team.min()),
        "pointTeam": entry["surfaceElevationM"],
        "pointMoonTrek": point,
        "bias": float(d.mean()),
        "rms": float(np.sqrt((d ** 2).mean())),
        "rmsGentle": rms(gentle), "shareGentle": float(gentle.mean()),
        "rmsSteep": rms(steep), "shareSteep": float(steep.mean()),
        "p50": float(np.percentile(a, 50)),
        "p95": float(np.percentile(a, 95)),
        "max": float(a.max()),
        "corr": float(np.corrcoef(z_mt.ravel(), z_team.ravel())[0, 1]),
        "lookup": lookup_difference(dem),
        "notes": "; ".join(entry.get("warnings", [])),
    }


def lookup_line(rows):
    checked = [r["lookup"] for r in rows if r["lookup"] is not None]
    if not checked:
        return "Download check: Moon Trek's point lookup was not reachable, so the crops were not re-checked."
    return (f"Download check: 4 pixels of each crop were compared with Moon Trek's own point lookup at the same "
            f"coordinates ({len(checked)} of {len(rows)} sites checked); largest difference {max(checked):.2f} m.")


def report(rows):
    lines = [
        "# Terrain cross-check against NASA Moon Trek",
        "",
        "Generated by `python -m preprocess.crosscheck_moontrek`.",
        "",
        f"Reference: `{PRODUCT}` (LOLA 5 m/px south-pole DEM, 87.5 S to the pole), served by",
        "[NASA Moon Trek](https://trek.nasa.gov/moon/), one of the NASA resources listed for the challenge.",
        "For each site a native-resolution crop is downloaded and the 3D terrain grid is rebuilt from it with",
        "the same code that builds `terrain.json` (256 x 256 cells, +/- 5 km, 4x oversampled mean, curvature",
        "included). The table compares that grid with the `terrain.json` in `public/data/`, which comes from",
        "the LOLA site DEMs (Barker et al. 2021). Differences are Moon Trek minus `terrain.json`, in metres.",
        "",
        "| Site | Relief in grid [m] | Site height: data / Moon Trek [m] | Mean diff | RMS diff | Median abs | 95% abs | Max abs | Correlation |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for r in rows:
        lines.append(
            f"| {r['site']} | {r['relief']:.0f} | {r['pointTeam']:.1f} / {r['pointMoonTrek']:.1f} | {r['bias']:+.2f} | "
            f"{r['rms']:.2f} | {r['p50']:.2f} | {r['p95']:.2f} | {r['max']:.1f} | {r['corr']:.6f} |")
    lines += [
        "",
        f"Where the difference sits (slope of the grid at ~39 m cells; gentle < {GENTLE_DEG:.0f} deg, steep > {STEEP_DEG:.0f} deg):",
        "",
        "| Site | Gentle cells | RMS diff on gentle [m] | Steep cells | RMS diff on steep [m] |",
        "|---|---|---|---|---|",
    ]
    for r in rows:
        steep = "-" if math.isnan(r["rmsSteep"]) else f"{r['rmsSteep']:.2f}"
        lines.append(f"| {r['site']} | {100 * r['shareGentle']:.0f}% | {r['rmsGentle']:.2f} | {100 * r['shareSteep']:.0f}% | {steep} |")
    lines += [
        "",
        f"Downloaded from `{SERVICE}/exportImage` (32-bit float GeoTIFF, native 5 m pixels, no resampling):",
        "",
        "| Site | Cached crop (name ends with its stereographic bounds in metres) | Size [MB] |",
        "|---|---|---|",
    ]
    lines += [f"| {r['site']} | `data_raw/moontrek/{r['site']}/{r['file']}` | {r['sizeMB']:.1f} |" for r in rows]
    notes = [f"- {r['site']}: {r['notes']}" for r in rows if r["notes"]]
    if notes:
        lines += ["", "Site notes carried over from `sites.json`:", *notes]
    lines += [
        "",
        "The two DEMs are separate LOLA products (different track adjustments and gridding), so metre-level",
        "differences are expected and grow with slope, where a small horizontal offset becomes a height",
        "difference. This is a consistency check between two NASA products, not a statement of either DEM's",
        "absolute accuracy.",
        "",
        lookup_line(rows),
        "",
    ]
    return "\n".join(lines)


def main(site_ids):
    entries = {e["id"]: e for e in json.loads((C.OUT_DIR / "sites.json").read_text(encoding="utf-8"))["sites"]}
    rows = []
    for site_id in site_ids or list(C.SITES):
        print(f"[{site_id}]")
        rows.append(check_site(site_id, entries[site_id]))
    text = report(rows)
    print(text)
    if not site_ids:
        REPORT.write_text(text, encoding="utf-8")
        print(f"wrote {REPORT.relative_to(C.ROOT)}")


if __name__ == "__main__":
    main(sys.argv[1:])
