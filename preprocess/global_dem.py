"""Window of the global LOLA LDEM_64 (64 px/deg, ~474 m/px) for sites outside the polar DEM (plan P4).

Only the rows that cover the window are fetched with HTTP range requests (~50 MB for +-260 km),
then cached as .npy in data_raw/global/. Product: LRO-L-LOLA-4-GDR-V1.0, LDEM_64.IMG
(int16 LSB, height = DN * 0.5 m relative to R = 1737.4 km, simple cylindrical, line 1 at 90 N,
sample 1 at 0 E, pixel centres at LINE/SAMPLE_PROJECTION_OFFSET 5759.5 / 11519.5).

Returned Dem uses an equirectangular CRS centred on 180 E so that the whole 0..360 E range is
continuous; ray points are projected into it with pyproj like for the polar DEMs.
"""
import numpy as np
import requests

from . import config as C
from .dem import Dem

URL = ("https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/"
       "cylindrical/img/ldem_64.img")
PPD = 64
LINES, SAMPLES = 11520, 23040
RECORD_BYTES = SAMPLES * 2
SCALE = 0.5
CRS = f"+proj=eqc +lat_ts=0 +lat_0=0 +lon_0=180 +x_0=0 +y_0=0 +R={C.MOON_RADIUS_M} +units=m +no_defs"
CACHE = C.RAW_DIR / "global"
UA = {"User-Agent": "LunarSiteNavigator-preprocess/0.1"}
NAME = "LOLA LDEM_64 (64 px/deg, ~474 m/px, PDS LRO-L-LOLA-4-GDR-V1.0)"


class GlobalDem(Dem):
    """Periodic longitude, including bilinear interpolation across the 0/360 seam.

    Polar caps use the nearest pixel centre at the edge (no invented zero terrain).
    """
    def sample(self, x, y):
        width = self.z.shape[1] * self.res
        x = (np.asarray(x) - self.left - self.res / 2) % width + self.left + self.res / 2
        y = np.asarray(y)
        pole = np.pi * C.MOON_RADIUS_M / 2
        if abs(self.top - pole) < 1:
            y = np.minimum(y, self.top - self.res / 2)
        if abs(self.top - self.z.shape[0] * self.res + pole) < 1:
            y = np.maximum(y, self.top - (self.z.shape[0] - 0.5) * self.res + 1e-6)
        # One wrapped column on each side is sufficient for bilinear interpolation.
        if not hasattr(self, "_periodic"):
            self._periodic = Dem(np.pad(self.z, ((0, 0), (1, 1)), mode="wrap"), self.left - self.res,
                                 self.top, self.res, self.crs, self.name)
        return self._periodic.sample(x, y)


def _rows(lat_deg, half_m):
    dlat = np.degrees(half_m / C.MOON_RADIUS_M)
    i0 = int(np.floor((90 - (lat_deg + dlat)) * PPD)) - 2
    i1 = int(np.ceil((90 - (lat_deg - dlat)) * PPD)) + 2
    return max(i0, 0), min(i1, LINES)


def fetch_rows(i0, i1):
    path = CACHE / f"ldem64_rows_{i0}_{i1}.npy"
    if path.exists():
        return np.load(path)
    CACHE.mkdir(parents=True, exist_ok=True)
    # Reuse overlapping latitude windows (e.g. Apollo 12/14).
    z = np.empty((i1 - i0, SAMPLES), dtype="<i2")
    available = np.zeros(i1 - i0, dtype=bool)
    for cached in CACHE.glob("ldem64_rows_*_*.npy"):
        a, b = map(int, cached.stem.split("_")[-2:])
        lo, hi = max(a, i0), min(b, i1)
        if hi > lo:
            old = np.load(cached, mmap_mode="r")
            z[lo - i0:hi - i0] = old[lo - a:hi - a]
            available[lo - i0:hi - i0] = True
    # Small cached ranges avoid long all-or-nothing transfers on constrained connections.
    for row in range(i0, i1, 64):
        end = min(row + 64, i1)
        if available[row - i0:end - i0].all():
            continue
        chunk = CACHE / f"ldem64_part_{row}_{end}.bin"
        expected = (end - row) * RECORD_BYTES
        if chunk.exists() and chunk.stat().st_size == expected:
            data = chunk.read_bytes()
        else:
            rng = f"bytes={row * RECORD_BYTES}-{end * RECORD_BYTES - 1}"
            r = requests.get(URL, headers=dict(UA, Range=rng), timeout=60)
            r.raise_for_status()
            content_range = f"bytes {row * RECORD_BYTES}-{end * RECORD_BYTES - 1}/"
            if r.status_code != 206 or len(r.content) != expected or not r.headers.get("Content-Range", "").startswith(content_range):
                raise IOError(f"range request failed ({r.status_code}, {len(r.content)} bytes)")
            data = r.content
            chunk.write_bytes(data)
        z[row - i0:end - i0] = np.frombuffer(data, dtype="<i2").reshape(end - row, SAMPLES)
        print(f"LOLA rows {row}..{end} / {i1}", flush=True)
    np.save(path, z)
    return z


def window(lat_deg, lon_deg, half_m):
    """Dem covering +-half_m (north-south) around the site, all longitudes of those rows."""
    i0, i1 = _rows(lat_deg, half_m)
    z = fetch_rows(i0, i1).astype(np.float32) * SCALE
    res = np.radians(1 / PPD) * C.MOON_RADIUS_M            # 473.8 m
    left = -np.pi * C.MOON_RADIUS_M                         # x of lon = 0 E (lon_0 = 180)
    top = np.radians(90 - i0 / PPD) * C.MOON_RADIUS_M       # y of the top edge of row i0
    return GlobalDem(z, left, top, res, crs=CRS, name=NAME)
