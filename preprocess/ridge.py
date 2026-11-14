"""Derive an evaluation point on the nearby ridge for a site whose catalogue
coordinate falls on a steep slope (Site04: 33 deg inner wall of Shackleton).

Rule (documented, reproducible): within RADIUS_M of the catalogue coordinate,
among 5 m DEM pixels whose slope (over a 25 m baseline) is <= MAX_SLOPE_DEG,
pick the highest one.

Usage: python -m preprocess.ridge Site04
"""
import sys

import numpy as np
import rasterio
from pyproj import Transformer
from scipy.ndimage import uniform_filter

from . import config as C
from .dem import LONLAT, to_xy

RADIUS_M = 1_000.0
MAX_SLOPE_DEG = 10.0
BASELINE_PX = 5  # 5 px * 5 m = 25 m smoothing before the slope


def slope_deg(z, res):
    zs = uniform_filter(z, size=BASELINE_PX, mode="nearest")
    gy, gx = np.gradient(zs, res)
    return np.degrees(np.arctan(np.hypot(gx, gy)))


def find(site_id, radius_m=RADIUS_M, max_slope_deg=MAX_SLOPE_DEG):
    s = C.SITES[site_id]
    with rasterio.open(C.local_dem_path(site_id)) as src:
        z = src.read(1).astype(np.float64)
        res, tr, crs = src.res[0], src.transform, src.crs
    x0, y0 = to_xy(crs, s["lon"], s["lat"])
    rows, cols = np.indices(z.shape)
    xs = tr.c + (cols + 0.5) * res
    ys = tr.f - (rows + 0.5) * res
    dist = np.hypot(xs - x0, ys - y0)
    sl = slope_deg(z, res)
    ok = (dist <= radius_m) & (sl <= max_slope_deg) & np.isfinite(z)
    if not ok.any():
        raise RuntimeError("no pixel satisfies the rule")
    k = np.argmax(np.where(ok, z, -np.inf))
    r, c = np.unravel_index(k, z.shape)
    lon, lat = Transformer.from_crs(crs, LONLAT, always_xy=True).transform(xs[r, c], ys[r, c])
    r0, c0 = np.unravel_index(np.argmin(dist), z.shape)
    return dict(lat=float(lat), lon=float(lon), elevationM=float(z[r, c]), slopeDeg=float(sl[r, c]),
                offsetM=float(dist[r, c]), catalogueElevationM=float(z[r0, c0]),
                catalogueSlopeDeg=float(sl[r0, c0]))


if __name__ == "__main__":
    for sid in sys.argv[1:] or ["Site04"]:
        print(sid, find(sid))
