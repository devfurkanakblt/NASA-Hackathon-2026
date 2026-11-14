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

COORD_SOURCE = "NASA Lunar Surface Data Book, Table A2.1-1"

SITES = {
    "Site01": dict(name="Connecting Ridge", lat=-89.4632, lon=-137.49),
    "Site04": dict(name="Shackleton Rim", lat=-89.7668, lon=-171.87),
    "Site07": dict(name="Peak Near Shackleton", lat=-88.811, lon=123.6901),
}

PGDA = "https://pgda.gsfc.nasa.gov/data"
REGIONAL_DEM_URL = f"{PGDA}/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF"


def local_dem_url(site_id: str) -> str:
    return f"{PGDA}/LOLA_5mpp/{site_id}/{site_id}_final_adj_5mpp_surf.tif"


def local_dem_path(site_id: str) -> Path:
    return RAW_DIR / "dem" / f"{site_id}_final_adj_5mpp_surf.tif"


REGIONAL_DEM_PATH = RAW_DIR / "dem" / "LDEM_80S_80MPP_ADJ.TIF"
