"""Regional terrain around each site for the 3D overview, from NASA Moon Trek.

The 10 km `terrain.json` patch ends long before the horizon. This script adds a coarse grid of
the surrounding region so the overview shows the real landscape (Shackleton, de Gerlache, the
massifs) out to ~120 km instead of empty space. Like `terrain.json` it is for display only:
visibility always comes from `horizon.json`.

Source: `LRO_LOLA_DEM_SPole75_30mp_v04` (LOLA 30 m/px south-pole DEM, 75 S to the pole), served
by NASA Moon Trek (https://trek.nasa.gov/moon/), one of the NASA resources listed for the
challenge. A crop is requested resampled to 250 m pixels (bilinear), then gridded with the same
code as `terrain.json` (`terrain.build`). Outside the polar product, the CE6 and Apollo 12
contrast points use A's PDS LDEM_64 global reader instead (about 474 m native pixels).

Output: `public/data/{site}/terrain-far.json` — same shape and frame as `terrain.json`
(local ENU, origin at the observer eye, row 0 = south, curvature included), plus `source`.

Usage: python -m preprocess.regional_moontrek [SiteXX ...]
Crops are cached in data_raw/moontrek/ (not committed).
"""
import json
import hashlib
import math
import re
import sys
from pathlib import Path

if __package__ in (None, ""):  # run as a file: make the repo root importable
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np
import rasterio
import requests
from datetime import datetime, timezone
from pyproj import Transformer

from preprocess import config as C
from preprocess import terrain as T
from preprocess import writer as W
from preprocess.dem import Dem, to_xy, LONLAT

PRODUCT = "LRO_LOLA_DEM_SPole75_30mp_v04"
SERVICE = f"https://trek.nasa.gov/moon/trekarcgis/rest/services/{PRODUCT}/ImageServer"
MOONTREK_CRS = f"+proj=stere +lat_0=-90 +lon_0=0 +k=1 +x_0=0 +y_0=0 +R={C.MOON_RADIUS_M} +units=m +no_defs"
RES_M = 250.0          # requested pixel size (the product itself is 30 m)
SIZE_M = 240_000.0     # grid covers +/- 120 km in local east/north
N = 192                # cells per side -> 1.25 km cells
MARGIN_M = 2_000.0
UA = {"User-Agent": "LunarSiteNavigator-preprocess/0.1"}


def crop_bounds(lon_deg, x0, y0):
    lam = math.radians(lon_deg)
    half = SIZE_M / 2 * (abs(math.cos(lam)) + abs(math.sin(lam))) + MARGIN_M
    lo = lambda v: RES_M * math.floor((v - half) / RES_M)  # noqa: E731
    hi = lambda v: RES_M * math.ceil((v + half) / RES_M)   # noqa: E731
    return lo(x0), lo(y0), hi(x0), hi(y0)


def fetch_crop(site_id, bounds):
    left, bottom, right, top = bounds
    width, height = round((right - left) / RES_M), round((top - bottom) / RES_M)
    dest = C.RAW_DIR / "moontrek" / site_id / f"{PRODUCT}_250m_{left:.0f}_{bottom:.0f}_{right:.0f}_{top:.0f}.tif"
    if not dest.exists():
        params = {"bbox": f"{left},{bottom},{right},{top}", "size": f"{width},{height}",
                  "format": "tiff", "pixelType": "F32", "interpolation": "RSP_BilinearInterpolation", "f": "image"}
        r = requests.get(f"{SERVICE}/exportImage", params=params, headers=UA, timeout=600)
        r.raise_for_status()
        if "tiff" not in r.headers.get("Content-Type", ""):
            raise IOError(f"Moon Trek returned {r.headers.get('Content-Type')}: {r.text[:200]}")
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(r.content)
        print(f"  downloaded {dest.name} ({dest.stat().st_size / 1e6:.1f} MB)")
    with rasterio.open(dest) as src:
        z = src.read(1, masked=True).astype(np.float32).filled(np.nan)
        transform = src.transform
        if src.crs is None or abs(transform.b) > 1e-9 or abs(transform.d) > 1e-9 or transform.a <= 0 or transform.e >= 0:
            raise IOError(f"{dest.name}: missing CRS or unsupported raster transform")
        if abs(transform.a + transform.e) > 1e-6:
            raise IOError(f"{dest.name}: expected square source pixels")
        # Compare numerical projection, rather than trusting a product name or manually assigned CRS.
        a = Transformer.from_crs(LONLAT, src.crs, always_xy=True)
        b = Transformer.from_crs(LONLAT, MOONTREK_CRS, always_xy=True)
        for lon, lat in [(0, -80), (90, -85), (-120, -89)]:
            if np.linalg.norm(np.array(a.transform(lon, lat)) - b.transform(lon, lat)) > 0.001:
                raise IOError(f"{dest.name}: returned projection differs from requested lunar polar grid")
        source_crs = src.crs.to_wkt()
    if z.shape != (height, width):
        raise IOError(f"{dest.name}: expected {height}x{width} pixels, got {z.shape}")
    if not np.isfinite(z).all():
        raise IOError(f"{dest.name}: source contains no-data; no synthetic fill will be generated")
    provenance = {"product": PRODUCT, "service": SERVICE, "sourceUrl": f"{SERVICE}/exportImage",
                  "sourceSha256": hashlib.sha256(dest.read_bytes()).hexdigest(),
                  "requestedBoundsM": list(bounds), "sourceSize": [width, height],
                  "sourceCrs": source_crs, "sourceTransform": list(transform)[:6],
                  "nativeProductPixelM": 30, "requestedPixelM": RES_M,
                  "sourceInterpolation": "bilinear", "outputCellM": SIZE_M / N,
                  "outputOversampling": 2, "curvature": True, "verticalExaggeration": 1,
                  "limits": "Visual-only resampled LOLA heights, not a replacement for the 250 km scientific horizon"}
    return Dem(z, transform.c, transform.f, transform.a, crs=MOONTREK_CRS, name=dest.name), provenance


def fetch_global(lat, lon):
    """Use A's verified PDS LOLA reader for contrast points outside the polar product."""
    from preprocess import global_dem as G
    G.CACHE = C.RAW_DIR / "global"
    half = SIZE_M / 2 * math.sqrt(2) + 10000
    dem = G.window(lat, lon, half)
    first, last = G._rows(lat, half)
    cached = G.CACHE / f"ldem64_rows_{first}_{last}.npy"
    if not np.isfinite(dem.z).all():
        raise IOError("Global LOLA rows contain no-data")
    return dem, {"product": "LOLA LDEM_64", "sourceUrl": G.URL,
                 "cachedRowsSha256": hashlib.sha256(cached.read_bytes()).hexdigest(),
                 "rowRangeExclusive": [first, last], "sourceCrs": G.CRS,
                 "nativeProductPixelsPerDegree": 64, "heightScaleM": G.SCALE,
                 "outputCellM": SIZE_M / N, "outputOversampling": 2,
                 "curvature": True, "verticalExaggeration": 1,
                 "limits": "Global approximately 474 m LOLA product, display only; fine hills are unresolved"}, G.CRS


def build_site(site_id, entry):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", site_id) or site_id != entry["id"]:
        raise ValueError("Invalid catalogue site identifier")
    lat, lon = float(entry["latDeg"]), float(entry["lonDeg"])
    if not math.isfinite(lat) or not -90 <= lat <= 90 or not math.isfinite(lon):
        raise ValueError(f"{site_id}: invalid catalogue coordinate")
    if lat <= -75:
        x0, y0 = to_xy(MOONTREK_CRS, lon, lat)
        dem, provenance = fetch_crop(site_id, crop_bounds(lon, x0, y0))
        crs = MOONTREK_CRS
    else:
        dem, provenance, crs = fetch_global(lat, lon)
    eye = entry["surfaceElevationM"] + entry["observerHeightM"]
    z, miss = T.build(lat, lon, eye, dem, dem, crs, n=N, size_m=SIZE_M, oversample=2)
    if miss or not np.isfinite(z).all():
        raise RuntimeError(f"{site_id}: {miss} grid samples fell outside the Moon Trek crop")
    doc = W.terrain_doc(site_id, z, SIZE_M)
    doc["source"] = (f"NASA Moon Trek {PRODUCT} (LOLA 30 m/px), resampled to {RES_M:.0f} m; display only"
                     if lat <= -75 else "NASA PDS LOLA LDEM_64 (approximately 474 m/px); display only")
    doc["provenance"] = {**provenance, "generatedUtc": datetime.now(timezone.utc).isoformat(),
                         "latitudeDeg": lat, "longitudeDeg": lon, "observerHeightM": entry["observerHeightM"],
                         "siteSurfaceElevationM": entry["surfaceElevationM"],
                         "catalogueEntrySha256": hashlib.sha256(json.dumps(entry, sort_keys=True).encode()).hexdigest()}
    W.write(C.OUT_DIR / site_id / "terrain-far.json", doc)
    centre = z[N // 2 - 1:N // 2 + 1, N // 2 - 1:N // 2 + 1].mean()
    print(f"  {site_id}: z {z.min():.0f} .. {z.max():.0f} m, centre cells {centre:.0f} m relative to the eye")


def main(site_ids):
    entries = {e["id"]: e for e in json.loads((C.OUT_DIR / "sites.json").read_text(encoding="utf-8"))["sites"]}
    unknown = set(site_ids) - entries.keys()
    if unknown:
        raise ValueError(f"Unknown catalogue sites: {sorted(unknown)}")
    for site_id in site_ids or list(entries):
        print(f"[{site_id}]")
        build_site(site_id, entries[site_id])


if __name__ == "__main__":
    main(sys.argv[1:])
