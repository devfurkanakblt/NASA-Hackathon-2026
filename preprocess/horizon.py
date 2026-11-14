"""Terrain horizon profile by ray marching on a sphere with exact curvature.

For azimuth a (from north, clockwise) the ray follows the great circle from the
observer; each sample's elevation angle is
    elev = atan2(Rt cos(theta) - Ro, Rt sin(theta)),  theta = d / R
with Ro = R + observer eye height and Rt = R + terrain height.
"""
import numpy as np
from pyproj import Transformer

from . import config as C
from .dem import LONLAT

R = C.MOON_RADIUS_M


def distances(near_range=C.NEAR_RANGE_M, near_step=C.NEAR_STEP_M, far_range=C.FAR_RANGE_M,
              far_step=C.FAR_STEP_M, min_range=C.MIN_RANGE_M):
    d_near = np.arange(near_step, near_range + 1e-9, near_step)
    d_far = np.arange(near_range + far_step, far_range + 1e-9, far_step)
    d = np.concatenate([d_near, d_far])
    return d[d >= min_range]


def ray_lonlat(lat_deg, lon_deg, az_deg, d):
    """Great-circle points. az_deg: (A,), d: (D,) -> lon, lat arrays (A, D) in degrees."""
    phi, lam = np.radians(lat_deg), np.radians(lon_deg)
    p = np.array([np.cos(phi) * np.cos(lam), np.cos(phi) * np.sin(lam), np.sin(phi)])
    north = np.array([-np.sin(phi) * np.cos(lam), -np.sin(phi) * np.sin(lam), np.cos(phi)])
    east = np.array([-np.sin(lam), np.cos(lam), 0.0])
    a = np.radians(np.atleast_1d(np.asarray(az_deg, dtype=np.float64)))[:, None, None]
    u = np.cos(a) * north + np.sin(a) * east                     # (A, 1, 3)
    th = (np.atleast_1d(np.asarray(d, dtype=np.float64)) / R)[None, :, None]
    q = p * np.cos(th) + u * np.sin(th)                          # (A, D, 3)
    lat = np.degrees(np.arcsin(np.clip(q[..., 2], -1, 1)))
    lon = np.degrees(np.arctan2(q[..., 1], q[..., 0]))
    return lon, lat


def compute(lat_deg, lon_deg, eye_height_m, near, far, crs, az_deg=None, d=None,
            near_range=C.NEAR_RANGE_M, block=60):
    """Return (elev_deg, dist_m, near_fallback_count) per azimuth.

    eye_height_m: terrain height at site + observer height (relative to sphere R).
    near/far: Dem objects (near may be None), both in projection `crs`.
    """
    if az_deg is None:
        az_deg = np.arange(int(round(360 / C.AZ_STEP_DEG))) * C.AZ_STEP_DEG
    if d is None:
        d = distances(near_range=near_range)
    az_deg = np.atleast_1d(np.asarray(az_deg, dtype=np.float64))
    tf = Transformer.from_crs(LONLAT, crs, always_xy=True)
    Ro = R + eye_height_m
    th = d / R
    cos_th, sin_th = np.cos(th), np.sin(th)
    is_near = d <= near_range
    elev = np.empty(az_deg.size)
    dist = np.empty(az_deg.size)
    fallback = 0
    for i in range(0, az_deg.size, block):
        lon, lat = ray_lonlat(lat_deg, lon_deg, az_deg[i:i + block], d)
        x, y = tf.transform(lon, lat)
        h = np.full(x.shape, np.nan)
        if near is not None:
            h[:, is_near] = near.sample(x[:, is_near], y[:, is_near])
        miss = np.isnan(h)
        fallback += int(miss[:, is_near].sum())
        h[miss] = far.sample(x[miss], y[miss])
        Rt = R + h
        e = np.arctan2(Rt * cos_th - Ro, Rt * sin_th)
        e = np.where(np.isnan(e), -np.inf, e)
        k = np.argmax(e, axis=1)
        elev[i:i + block] = np.degrees(e[np.arange(e.shape[0]), k])
        dist[i:i + block] = d[k]
    return elev, dist, fallback
