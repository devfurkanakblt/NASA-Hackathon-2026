"""DEM loading and vectorised bilinear sampling in south-polar-stereographic metres."""
import numpy as np
import rasterio
from rasterio.windows import from_bounds
from pyproj import Transformer

from . import config as C

LONLAT = f"+proj=longlat +R={C.MOON_RADIUS_M} +no_defs"


class Dem:
    """Grid with pixel-is-area georeferencing: pixel (r, c) centre at
    x = left + (c + 0.5) * res, y = top - (r + 0.5) * res."""

    def __init__(self, z, left, top, res, crs=None, name=""):
        self.z = np.asarray(z, dtype=np.float32)
        self.left, self.top, self.res = float(left), float(top), float(res)
        self.crs, self.name = crs, name

    @classmethod
    def open(cls, path, center_xy=None, half_size_m=None):
        with rasterio.open(path) as src:
            assert abs(src.res[0] - src.res[1]) < 1e-9, "non-square pixels"
            if center_xy is None:
                window = None
            else:
                cx, cy = center_xy
                window = from_bounds(cx - half_size_m, cy - half_size_m,
                                     cx + half_size_m, cy + half_size_m,
                                     src.transform).round_offsets().round_lengths()
            z = src.read(1, window=window, masked=True).filled(np.nan).astype(np.float32)
            tr = src.window_transform(window) if window is not None else src.transform
            return cls(z, tr.c, tr.f, src.res[0], src.crs, name=path.name)

    def sample(self, x, y):
        """Bilinear sample; NaN outside the grid or next to nodata."""
        x = np.asarray(x, dtype=np.float64)
        y = np.asarray(y, dtype=np.float64)
        fc = (x - self.left) / self.res - 0.5
        fr = (self.top - y) / self.res - 0.5
        c0 = np.floor(fc).astype(np.int64)
        r0 = np.floor(fr).astype(np.int64)
        nr, nc = self.z.shape
        ok = (c0 >= 0) & (r0 >= 0) & (c0 < nc - 1) & (r0 < nr - 1)
        out = np.full(x.shape, np.nan, dtype=np.float64)
        if not ok.any():
            return out
        c0o, r0o = c0[ok], r0[ok]
        tc, tr = fc[ok] - c0o, fr[ok] - r0o
        z = self.z
        out[ok] = (z[r0o, c0o] * (1 - tc) * (1 - tr) + z[r0o, c0o + 1] * tc * (1 - tr)
                   + z[r0o + 1, c0o] * (1 - tc) * tr + z[r0o + 1, c0o + 1] * tc * tr)
        return out

    def bounds(self):
        nr, nc = self.z.shape
        return self.left, self.top - nr * self.res, self.left + nc * self.res, self.top


def to_xy(crs, lon, lat):
    return Transformer.from_crs(LONLAT, crs, always_xy=True).transform(lon, lat)


def load_site_dems(site_id, far_range_m=C.FAR_RANGE_M):
    s = C.SITES[site_id]
    near = Dem.open(C.local_dem_path(site_id))
    xy = to_xy(near.crs, s["lon"], s["lat"])
    far = Dem.open(C.REGIONAL_DEM_PATH, center_xy=xy, half_size_m=far_range_m + 2_000)
    return near, far, xy


def surface_elevation(near, far, xy):
    z = float(near.sample(np.array([xy[0]]), np.array([xy[1]]))[0])
    warnings = []
    if np.isnan(z):
        z = float(far.sample(np.array([xy[0]]), np.array([xy[1]]))[0])
        warnings.append("site height taken from 80 m regional DEM (outside 5 m tile)")
    return z, warnings
