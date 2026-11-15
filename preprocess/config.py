"""Shared constants. Units: SI (m, s); angles in degrees (SI-accepted); times UTC.

Azimuth convention: measured from local north, clockwise toward east, range [0, 360).
Elevation: angle above the local horizontal plane (plane perpendicular to the
radius vector of the 1737.4 km reference sphere), positive up.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data_raw"
OUT_DIR = ROOT / "public" / "data"

MOON_RADIUS_M = 1_737_400.0  # LOLA heights are relative to this sphere
OBSERVER_HEIGHT_M = 2.0

START_UTC = "2026-11-01T00:00:00Z"
STOP_UTC = "2027-01-01T00:00:00Z"
STEP_S = 600  # 10 minutes

AZ_STEP_DEG = 0.1
NEAR_RANGE_M = 7_000.0
NEAR_STEP_M = 2.5
FAR_RANGE_M = 250_000.0  # 100 km missed far massifs at Site07 (up to 1.3 deg)
FAR_STEP_M = 40.0
MIN_RANGE_M = 10.0  # skip DEM noise directly under the observer

COORD_SOURCE = "NASA Lunar Surface Data Book (M2M-30044, Mar 2025), Table A2.1-1"
# Highest LOLA height on the Moon relative to R (~ +10.8 km). Used as a conservative bound for
# terrain outside the regional DEM (see horizon.coverage_check).
MAX_LUNAR_HEIGHT_M = 10_800.0

SITES = {
    "Site01": dict(name="Connecting Ridge", lat=-89.4632, lon=-137.49),
    "Site04": dict(name="Shackleton Rim", lat=-89.7668, lon=-171.87,
                   notes=["catalogue coordinate lies on the ~32 deg inner wall of Shackleton, "
                          "not on the rim crest; see Site04R for the nearby ridge point"]),
    "Site07": dict(name="Peak Near Shackleton", lat=-88.811, lon=123.6901),
    # Derived evaluation point: the Site04 catalogue coordinate lies on the ~32 deg inner wall
    # of Shackleton. Rule (preprocess/ridge.py): highest 5 m pixel with slope <= 10 deg
    # (25 m baseline) within 2 km of Site04. Stable for radius 2-3 km and slope 10-15 deg.
    "Site04R": dict(name="Shackleton Rim (ridge point)", lat=-89.780403, lon=-156.196951,
                    tile="Site04", derivedFrom="Site04",
                    derivation="highest 5 m DEM pixel with slope <= 10 deg (25 m baseline) "
                               "within 2 km of Site04; offset 1.9 km"),
    # Plan P4: further catalogue sites with a LOLA 5 m product (same table, same pipeline).
    "Site11": dict(name="de Gerlache Rim 1", lat=-88.6834, lon=-67.9321),
    "Site20": dict(name="Leibnitz Beta Plateau", lat=-85.4266, lon=31.74276),
    "Site23": dict(name="Malapert Massif", lat=-85.9948, lon=-0.23578),
    # Plan P4: contrast points outside the south polar region (educational comparison only).
    # Terrain from the global LOLA LDEM_64 (~474 m/px): coarse near field, see preprocess/global_dem.py.
    "CE6": dict(name="Chang'e-6 landing site (far side)", lat=-41.6385, lon=-153.9852, dem="ldem64",
                category="contrast",
                coordSource="LROC, 'First Look: Chang'e 6' (lroc.asu.edu/images/1374): "
                            "41.6385 S, 206.0148 E, +-30 m",
                notes=["contrast point on the lunar far side: the Earth never rises here",
                       "terrain from the global 474 m/px LOLA map; nearby small hills are not resolved"]),
}

from .mission_catalogue import MISSION_SITES
SITES.update(MISSION_SITES)

PGDA = "https://pgda.gsfc.nasa.gov/data"
REGIONAL_DEM_URL = f"{PGDA}/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF"


def tile_of(site_id: str) -> str:
    return SITES.get(site_id, {}).get("tile", site_id)


def local_dem_url(site_id: str) -> str:
    t = tile_of(site_id)
    return f"{PGDA}/LOLA_5mpp/{t}/{t}_final_adj_5mpp_surf.tif"


def local_dem_path(site_id: str) -> Path:
    return RAW_DIR / "dem" / f"{tile_of(site_id)}_final_adj_5mpp_surf.tif"


REGIONAL_DEM_PATH = RAW_DIR / "dem" / "LDEM_80S_80MPP_ADJ.TIF"
