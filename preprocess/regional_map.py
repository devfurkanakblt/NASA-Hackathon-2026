"""Regional Sun / Earth visibility and slope map around a site (plan P1).

For every cell of an ENU grid centred on the site:
  1. terrain horizon from that cell (same ray marcher, step sizes and 250 km range as
     horizon.json; only the azimuth step is coarser: MAP_AZ_STEP_DEG),
  2. Sun / Earth direction seen from that cell. The body position is reconstructed in the
     Moon-fixed frame from the site's ephemeris.json (Horizons az/el/range at the site
     centre) and re-projected into the cell's own local ENU frame. Near the pole a few km
     change the azimuth by degrees, so this rotation is required; the topocentric
     parallax of the Earth over a few km is also included,
  3. the contract's visibility rule (visible = el > horizonAt(az)) per 10-minute sample,
  4. slope over a 25 m baseline from the 5 m DEM (same method as preprocess/ridge.py).

Usage:
  python -m preprocess.regional_map --sites Site01          # writes public/data/Site01/map.json
  python -m preprocess.regional_map --sites Site01 --half 3000 --spacing 100 --workers 14
"""
import argparse
import os
import time
from multiprocessing import Pool

import numpy as np

from . import config as C, writer as W
from . import horizon as Hz
from . import visibility as V
from .dem import Dem, to_xy
from .ridge import slope_deg
from .validate import load, load_eye

MAP_AZ_STEP_DEG = 0.5   # 1 deg changed site percentages by <= 0.08 points, 0.5 deg by <= 0.01
HALF_M = 3_000.0
SPACING_M = 100.0
R = C.MOON_RADIUS_M


# ---------------------------------------------------------------- geometry
def enu_basis(lat_deg, lon_deg):
    """Unit vectors (east, north, up) of the local frame in Moon-fixed coordinates. Shape (..., 3)."""
    phi, lam = np.radians(lat_deg), np.radians(lon_deg)
    phi, lam = np.broadcast_arrays(phi, lam)
    up = np.stack([np.cos(phi) * np.cos(lam), np.cos(phi) * np.sin(lam), np.sin(phi)], -1)
    north = np.stack([-np.sin(phi) * np.cos(lam), -np.sin(phi) * np.sin(lam), np.cos(phi)], -1)
    east = np.stack([-np.sin(lam), np.cos(lam), np.zeros_like(lam)], -1)
    return east, north, up


def grid(site_id, half_m=HALF_M, spacing_m=SPACING_M):
    """Cells on the local tangent plane of the site; (e, n) mapped onto the sphere along
    the great circle with azimuth atan2(e, n) and arc length hypot(e, n).
    Row 0 = south, col 0 = west (same order as terrain.json)."""
    s = C.SITES[site_id]
    k = np.arange(-half_m, half_m + 1e-6, spacing_m)
    e, n = np.meshgrid(k, k)            # rows: n ascending (south first), cols: e ascending
    az = np.degrees(np.arctan2(e, n)).ravel()
    d = np.hypot(e, n).ravel()
    lon = np.empty(d.size)
    lat = np.empty(d.size)
    for i in range(d.size):             # ray_lonlat is (A, D); one ray per cell
        lo, la = Hz.ray_lonlat(s["lat"], s["lon"], [az[i]], [d[i]])
        lon[i], lat[i] = lo[0, 0], la[0, 0]
    center = d == 0
    lon[center], lat[center] = s["lon"], s["lat"]
    return k.size, e.ravel(), n.ravel(), lat, lon


def body_vectors(eph, lat_c, lon_c, eye_c):
    """Moon-fixed position of Sun / Earth [m] per sample, from ephemeris.json at the site centre."""
    E, N, U = enu_basis(lat_c, lon_c)
    p_c = (R + eye_c) * U
    out = {}
    for b in ("sun", "earth"):
        az = np.radians(np.asarray(eph[b]["azDeg"]))
        el = np.radians(np.asarray(eph[b]["elDeg"]))
        dist = np.asarray(eph[b]["distanceM"])
        u = (np.cos(el) * np.sin(az))[:, None] * E + (np.cos(el) * np.cos(az))[:, None] * N \
            + np.sin(el)[:, None] * U
        out[b] = (p_c + dist[:, None] * u, dist)
    return out


def local_azel(body_pos, lat, lon, eye):
    """Az/el [deg] of Moon-fixed positions (T, 3) seen from one cell."""
    E, N, U = enu_basis(lat, lon)
    v = body_pos - (R + eye) * U
    x, y, z = v @ E, v @ N, v @ U
    return np.degrees(np.arctan2(x, y)) % 360.0, np.degrees(np.arctan2(z, np.hypot(x, y)))


# ---------------------------------------------------------------- workers
_W = {}


def _init(site_id, far_half_m):
    near = Dem.open(C.local_dem_path(site_id))
    s = C.SITES[site_id]
    xy = to_xy(near.crs, s["lon"], s["lat"])
    far = Dem.open(C.REGIONAL_DEM_PATH, center_xy=xy, half_size_m=far_half_m)
    _W.update(near=near, far=far, d=Hz.distances(),
              az=np.arange(int(round(360 / MAP_AZ_STEP_DEG))) * MAP_AZ_STEP_DEG)


def _horizon(args):
    lat, lon, eye = args
    elev, dist, fb = Hz.compute(lat, lon, eye, _W["near"], _W["far"], _W["near"].crs,
                                az_deg=_W["az"], d=_W["d"])
    return elev.astype(np.float32), fb


# ---------------------------------------------------------------- main computation
def longest_s(mask, step_s):
    r = V.runs(mask)
    return int(max(L for _, L in r) * step_s) if r else 0


def cell_stats(body, hz, lat, lon, eye, step_s):
    vis = {}
    for b in ("sun", "earth"):
        az, el = local_azel(body[b][0], lat, lon, eye)
        vis[b] = el > V.horizon_at(hz, az)
        if b == "sun":
            r = V.SUN_RADIUS_AU_DEG * V.AU_M / body[b][1]
            frac = np.clip((el - V.horizon_at(hz, az) + r) / (2 * r), 0, 1)
    sun, earth = vis["sun"], vis["earth"]
    return (100 * sun.mean(), 100 * earth.mean(), 100 * (sun & earth).mean(), frac.mean(),
            longest_s(~sun, step_s), longest_s(~earth, step_s))


def build(site_id, half_m=HALF_M, spacing_m=SPACING_M, workers=None):
    t0 = time.time()
    s = C.SITES[site_id]
    eph = load(site_id, "ephemeris.json")
    eye_c = load_eye(site_id)
    n_side, e, n, lat, lon = grid(site_id, half_m, spacing_m)

    near = Dem.open(C.local_dem_path(site_id))
    far_half = C.FAR_RANGE_M + 2_000 + half_m * 1.5
    far = Dem.open(C.REGIONAL_DEM_PATH, center_xy=to_xy(near.crs, s["lon"], s["lat"]), half_size_m=far_half)
    x, y = to_xy(near.crs, lon, lat)
    z = near.sample(x, y)
    from_far = np.isnan(z)
    z[from_far] = far.sample(x[from_far], y[from_far])
    slope = Dem(slope_deg(near.z.astype(np.float64), near.res), near.left, near.top, near.res).sample(x, y)
    eye = z + C.OBSERVER_HEIGHT_M
    # the site centre uses the published eye height so the centre cell reproduces horizon.json
    ic = int(np.flatnonzero((e == 0) & (n == 0))[0])
    eye[ic] = eye_c

    workers = workers or max(1, (os.cpu_count() or 2) - 2)
    with Pool(workers, initializer=_init, initargs=(site_id, far_half)) as pool:
        res = pool.map(_horizon, list(zip(lat, lon, eye)), chunksize=8)
    horizons = np.stack([r[0] for r in res])
    fallback = int(sum(r[1] for r in res))
    t_hz = time.time() - t0

    body = body_vectors(eph, s["lat"], s["lon"], eye_c)
    out = np.empty((lat.size, 6))
    for i in range(lat.size):
        hz = {"elevDeg": horizons[i], "azStepDeg": MAP_AZ_STEP_DEG, "count": horizons.shape[1]}
        out[i] = cell_stats(body, hz, lat[i], lon[i], eye[i], eph["stepS"])
    print(f"[{site_id}] {lat.size} cells, horizons {t_hz:.0f} s, total {time.time() - t0:.0f} s")

    warnings = []
    if from_far.any():
        warnings.append(f"{int(from_far.sum())} cells outside the 5 m tile: height/slope from the 80 m DEM")
    if fallback:
        from .extended import near_field_total, near_field_warning
        warnings.append(near_field_warning(fallback, near_field_total(lat.size, horizons.shape[1])))
    if np.isnan(slope).any():
        warnings.append("slopeDeg is null where the 5 m DEM does not cover the cell")

    def arr(a, nd):
        return [None if not np.isfinite(v) else round(float(v), nd) for v in a]

    doc = {
        "version": W.VERSION, "siteId": site_id, "generatedUtc": W.now_utc(),
        "grid": {"nx": n_side, "ny": n_side, "spacingM": spacing_m, "halfSizeM": half_m,
                 "originENU": "site center (sites.json latDeg/lonDeg)",
                 "order": "row-major, row 0 = south, col 0 = west",
                 "cellCenter": "eastM = -halfSizeM + col*spacingM, northM = -halfSizeM + row*spacingM",
                 "projection": "local tangent plane mapped onto the sphere along great circles "
                               "(azimuth atan2(e, n), arc length hypot(e, n))"},
        "coverage": {"startUtc": eph["startUtc"], "endUtc": C.STOP_UTC, "stepS": eph["stepS"],
                     "count": eph["count"]},
        "latDeg": arr(lat, 6), "lonDeg": arr(lon, 6),
        "surfaceElevationM": arr(z, 1),
        "sunPct": arr(out[:, 0], 2), "earthPct": arr(out[:, 1], 2), "bothPct": arr(out[:, 2], 2),
        "sunDiskFractionMean": arr(out[:, 3], 4),
        "longestNoSunS": [int(v) for v in out[:, 4]], "longestNoEarthS": [int(v) for v in out[:, 5]],
        "slopeDeg": arr(slope, 1),
        "method": {
            "horizon": f"per cell: {MAP_AZ_STEP_DEG} deg azimuth, ray steps {C.NEAR_STEP_M} m to "
                       f"{C.NEAR_RANGE_M:.0f} m then {C.FAR_STEP_M} m to {C.FAR_RANGE_M:.0f} m, "
                       "5 m DEM near / 80 m DEM far, spherical curvature",
            "ephemeris": "Sun/Earth position rebuilt in the Moon-fixed frame from ephemeris.json "
                         "(JPL Horizons at the site centre) and projected into each cell's local frame",
            "visibility": "visible = el > horizonAt(az), linear interpolation on the cell's horizon "
                          "(docs/data-contract.md)",
            "slope": "25 m baseline (5x5 px mean of the 5 m DEM), central differences",
            "observerHeightM": C.OBSERVER_HEIGHT_M},
        "warnings": warnings,
    }
    W.write(C.OUT_DIR / site_id / "map.json", doc)
    np.savez_compressed(C.RAW_DIR / f"map_{site_id}.npz", horizons=horizons, lat=lat, lon=lon, eye=eye,
                        e=e, n=n, stats=out, slope=slope)
    return doc


def main():
    ap = argparse.ArgumentParser()
    # contrast sites (global 474 m DEM) are too coarse for a 100-200 m map
    ap.add_argument("--sites", nargs="+", default=[s for s in C.SITES if C.SITES[s].get("dem") != "ldem64" and not C.SITES[s].get("program")])
    ap.add_argument("--half", type=float, default=HALF_M)
    ap.add_argument("--spacing", type=float, default=SPACING_M)
    ap.add_argument("--workers", type=int, default=None)
    args = ap.parse_args()
    for sid in args.sites:
        build(sid, args.half, args.spacing, args.workers)


if __name__ == "__main__":
    main()
