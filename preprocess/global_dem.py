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
    rng = f"bytes={i0 * RECORD_BYTES}-{i1 * RECORD_BYTES - 1}"
    r = requests.get(URL, headers=dict(UA, Range=rng), timeout=600)
    r.raise_for_status()
    if r.status_code != 206 or len(r.content) != (i1 - i0) * RECORD_BYTES:
        raise IOError(f"range request failed ({r.status_code}, {len(r.content)} bytes)")
    z = np.frombuffer(r.content, dtype="<i2").reshape(i1 - i0, SAMPLES)
    np.save(path, z)
    return z


def window(lat_deg, lon_deg, half_m):
    """Dem covering +-half_m (north-south) around the site, all longitudes of those rows."""
    if abs(lat_deg) + np.degrees(half_m / C.MOON_RADIUS_M) > 80:
        raise ValueError("global window would reach a pole; use the polar DEMs")
    i0, i1 = _rows(lat_deg, half_m)
    z = fetch_rows(i0, i1).astype(np.float32) * SCALE
    res = np.radians(1 / PPD) * C.MOON_RADIUS_M            # 473.8 m
    left = -np.pi * C.MOON_RADIUS_M                         # x of lon = 0 E (lon_0 = 180)
    top = np.radians(90 - i0 / PPD) * C.MOON_RADIUS_M       # y of the top edge of row i0
    return Dem(z, left, top, res, crs=CRS, name=NAME)
