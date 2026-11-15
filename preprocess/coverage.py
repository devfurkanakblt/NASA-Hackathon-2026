"""Supported area and time range, published as public/data/coverage.json, plus point classification.

    python -m preprocess.coverage            # write public/data/coverage.json
Numbers come from sites.json, <site>/map.json, <site>/extended.json and <site>/horizon.json;
nothing is guessed here.
"""
import json
import math
from functools import lru_cache

import numpy as np
import rasterio
from pyproj import Transformer

from . import config as C
from .dem import LONLAT, to_xy
from .regional_map import MAP_AZ_STEP_DEG
from .writer import write

FREE_POINTS = "Any coordinate can be entered in the app: inside the polar maps it uses the nearest map cell (distance shown); elsewhere the exact point is computed in the browser from the global LDEM_64 tiles (public/data/global-dem, ~1.9 km/px block mean) as a global screening estimate. For catalogue-quality terrain generate a portable package with python -m preprocess.custom_point: --terrain local5m (strict, default), regional (south of 80 S), or global (~474 m; unresolved small hills). Package importer: src/data/scientificPackage.ts."
REGIONAL_LAT_MAX_DEG = -80.0
GLOBAL_NAME = "LDEM_64"
REGIONAL_NAME = "LDEM_80S_80MPP_ADJ"


def normalize_lon(lon: float) -> float:
    """Longitude in (-180, 180]; the single place longitude is wrapped."""
    x = lon % 360.0
    return x - 360.0 if x > 180.0 else x


def _load(site_id, name):
    return json.loads((C.OUT_DIR / site_id / name).read_text(encoding="utf-8"))


def _sites():
    return json.loads((C.OUT_DIR / "sites.json").read_text(encoding="utf-8"))["sites"]


def _local_tiles():
    return sorted({C.tile_of(s) for s, v in C.SITES.items() if v.get("dem") not in ("ldem64", "regional80")})


@lru_cache(maxsize=None)
def _tile_info(tile):
    with rasterio.open(C.local_dem_path(tile)) as src:
        b = src.bounds
        return str(src.crs), (b.left, b.bottom, b.right, b.top)


@lru_cache(maxsize=None)
def _regional_info():
    with rasterio.open(C.REGIONAL_DEM_PATH) as src:
        b = src.bounds
        return str(src.crs), (b.left, b.bottom, b.right, b.top)


@lru_cache(maxsize=None)
def _maps():
    """Per map site: (siteId, spacingM, lat array, lon array)."""
    out = []
    for site in _sites():
        if site.get("category") == "contrast" or not (C.OUT_DIR / site["id"] / "map.json").exists():
            continue
        m = _load(site["id"], "map.json")
        out.append((site["id"], float(m["grid"]["spacingM"]), np.array(m["latDeg"]), np.array(m["lonDeg"])))
    return out


def _arc_m(lat1, lon1, lat2, lon2):
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dl = np.radians(lon2 - lon1)
    a = np.sin((p2 - p1) / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * C.MOON_RADIUS_M * np.arcsin(np.sqrt(np.clip(a, 0, 1)))


def _inside(xy, box, margin=0.0):
    x, y = xy
    return box[0] + margin <= x <= box[2] - margin and box[1] + margin <= y <= box[3] - margin


def near_field_tile(lat: float, lon: float):
    """The 5 m tile that holds the whole NEAR_RANGE_M near range around (lat, lon), else None.

    Purely geometric (no map-cell precedence); tiles whose DEM file is missing do not count.
    """
    lon = normalize_lon(float(lon))
    for tile in _local_tiles():
        if not C.local_dem_path(tile).exists():
            continue
        crs, box = _tile_info(tile)
        if _inside(to_xy(crs, lon, float(lat)), box, C.NEAR_RANGE_M):
            return tile
    return None


def classify_point(lat: float, lon: float) -> dict:
    """Which terrain product supports a point. Never falls back silently: `reason` says why."""
    def res(kind, tile, reason):
        return {"kind": kind, "tile": tile, "reason": reason}

    if not (isinstance(lat, (int, float)) and isinstance(lon, (int, float))
            and math.isfinite(lat) and math.isfinite(lon)):
        return res("invalid", None, "Latitude and longitude must be finite numbers in degrees.")
    if lat < -90 or lat > 90:
        return res("invalid", None, "Latitude must be between -90 and 90 degrees.")
    lon = normalize_lon(float(lon))
    lat = float(lat)

    for site_id, spacing, lats, lons in _maps():
        if float(_arc_m(lat, lon, lats, lons).min()) <= spacing:
            return res("map-cell", C.tile_of(site_id), f"Within one cell spacing ({spacing:g} m) of a {site_id} map cell.")

    for tile in _local_tiles():
        crs, box = _tile_info(tile)
        xy = to_xy(crs, lon, lat)
        if _inside(xy, box, C.NEAR_RANGE_M):
            return res("local-5m", tile, f"The whole {C.NEAR_RANGE_M / 1000:g} km near range lies inside the 5 m tile {tile}.")
        if _inside(xy, box):
            return res("regional-80m", tile,
                       f"Inside the 5 m tile {tile}, but the {C.NEAR_RANGE_M / 1000:g} km near range leaves the tile; "
                       "the 80 m regional DEM is used beyond the tile edge.")

    if lat <= REGIONAL_LAT_MAX_DEG:
        crs, box = _regional_info()
        if _inside(to_xy(crs, lon, lat), box):
            return res("regional-80m", None, "Inside the 80 m regional DEM (south of 80 S); no 5 m tile covers the near range.")
    return res("global-only", None, "Only the global 474 m LOLA DEM covers this point; small hills are not resolved.")


def point_inside_tile_edge(tile: str, inset_m: float, frac_y: float = 0.5):
    """(lat, lon) of a point `inset_m` inside the west edge of a 5 m tile (test helper)."""
    crs, (x0, y0, x1, y1) = _tile_info(tile)
    x, y = x0 + inset_m, y0 + frac_y * (y1 - y0)
    lon, lat = Transformer.from_crs(crs, LONLAT, always_xy=True).transform(x, y)
    return lat, lon


def build_coverage() -> dict:
    sites = _sites()
    year = _load("Site01", "extended.json")["year"]
    sites_doc = json.loads((C.OUT_DIR / "sites.json").read_text(encoding="utf-8"))
    main_end = sites_doc["coverage"]["endUtc"]
    time = {"startUtc": year["startUtc"], "endUtc": year["endUtc"], "stepS": year["stepS"], "mainPeriodEndUtc": main_end}
    catalogue, maps = [], []
    for s in sites:
        h = _load(s["id"], "horizon.json")
        catalogue.append({"siteId": s["id"], "latDeg": s["latDeg"], "lonDeg": s["lonDeg"],
                          "horizonResolutionDeg": h["azStepDeg"]})
        if not (C.OUT_DIR / s["id"] / "map.json").exists():
            continue
        m, ext = _load(s["id"], "map.json"), _load(s["id"], "extended.json")
        if ext["year"]["startUtc"] != time["startUtc"] or ext["year"]["endUtc"] != time["endUtc"] or ext["year"]["stepS"] != time["stepS"]:
            raise ValueError(f"{s['id']}: extended.json time range differs from Site01")
        g = m["grid"]
        maps.append({"siteId": s["id"], "halfSizeM": g["halfSizeM"], "spacingM": g["spacingM"],
                     "horizonResolutionDeg": ext["cells"]["horizonResolutionDeg"],
                     "summaryResolutionDeg": MAP_AZ_STEP_DEG,
                     "summaryPeriod": [m["coverage"]["startUtc"], m["coverage"]["endUtc"]]})
    dems = []
    for tile in _local_tiles():
        crs, (x0, y0, x1, y1) = _tile_info(tile)
        dems.append({"name": f"LOLA 5 m/px {tile}", "kind": "local-5m",
                     "bounds": {"crs": crs, "xMin": x0, "yMin": y0, "xMax": x1, "yMax": y1}})
    dems.append({"name": REGIONAL_NAME, "kind": "regional-80m", "latMaxDeg": REGIONAL_LAT_MAX_DEG})
    dems.append({"name": GLOBAL_NAME, "kind": "global-474m"})
    return {"version": 1, "time": time, "catalogue": catalogue, "maps": maps, "dems": dems, "freePoints": FREE_POINTS}


def main():
    write(C.OUT_DIR / "coverage.json", build_coverage())


if __name__ == "__main__":
    main()
