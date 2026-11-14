"""Down-sampled local terrain grid for the 3D view (visual only).

Grid is local ENU with origin at the observer eye; z includes lunar curvature so the
3D scene is geometrically consistent with horizon.json.
"""
import numpy as np
from pyproj import Transformer

from . import config as C
from .dem import LONLAT

R = C.MOON_RADIUS_M


def enu_to_lonlat(lat_deg, lon_deg, east_m, north_m):
    phi, lam = np.radians(lat_deg), np.radians(lon_deg)
    p = np.array([np.cos(phi) * np.cos(lam), np.cos(phi) * np.sin(lam), np.sin(phi)])
    nv = np.array([-np.sin(phi) * np.cos(lam), -np.sin(phi) * np.sin(lam), np.cos(phi)])
    ev = np.array([-np.sin(lam), np.cos(lam), 0.0])
    s = np.hypot(east_m, north_m)
    th = s / R
    with np.errstate(invalid="ignore", divide="ignore"):
        ue = np.where(s > 0, east_m / s, 0.0)
        un = np.where(s > 0, north_m / s, 0.0)
    u = ue[..., None] * ev + un[..., None] * nv
    q = p * np.cos(th)[..., None] + u * np.sin(th)[..., None]
    lat = np.degrees(np.arcsin(np.clip(q[..., 2], -1, 1)))
    lon = np.degrees(np.arctan2(q[..., 1], q[..., 0]))
    return lon, lat, th


def build(lat_deg, lon_deg, eye_height_m, near, far, crs, n=256, size_m=10_000.0, oversample=4):
    """Return z (n, n) row 0 = south, col 0 = west, metres relative to observer eye."""
    m = n * oversample
    cell = size_m / m
    c = -size_m / 2 + (np.arange(m) + 0.5) * cell
    E, N = np.meshgrid(c, c)                          # row 0 = south
    lon, lat, th = enu_to_lonlat(lat_deg, lon_deg, E, N)
    x, y = Transformer.from_crs(LONLAT, crs, always_xy=True).transform(lon, lat)
    h = near.sample(x, y)
    miss = np.isnan(h)
    if miss.any():
        h[miss] = far.sample(x[miss], y[miss])
    z = (R + h) * np.cos(th) - (R + eye_height_m)     # up-component in ENU
    z = z.reshape(n, oversample, n, oversample).mean(axis=(1, 3))
    return z, int(miss.sum())
