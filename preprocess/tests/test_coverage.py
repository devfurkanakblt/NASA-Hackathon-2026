import json

import pytest
from pyproj import Transformer

from preprocess import config as C
from preprocess.coverage import _tile_info, classify_point, point_inside_tile_edge
from preprocess.dem import LONLAT

pytestmark = pytest.mark.skipif(not (C.RAW_DIR / "dem").exists(), reason="data_raw/dem missing")


def test_site01_centre_is_local_5m():
    assert classify_point(-89.4632, -137.49)["kind"] in ("map-cell", "local-5m")


def test_lon_wraps():
    assert classify_point(-89.4632, 222.51) == classify_point(-89.4632, -137.49)


def test_180_and_minus_180_are_equal():
    assert classify_point(-89.9, 180) == classify_point(-89.9, -180)


def test_equator_is_global_only():
    assert classify_point(0.0, 0.0)["kind"] == "global-only"


@pytest.mark.parametrize("lat,lon", [(-91, 0), (91, 0), (float("nan"), 0), (-89, float("inf"))])
def test_out_of_range_is_invalid(lat, lon):
    assert classify_point(lat, lon)["kind"] == "invalid"


def test_edge_of_tile_is_not_local_5m():
    # ~2 km inside the tile edge: the 7 km near range spills out of the 5 m tile
    r = classify_point(*point_inside_tile_edge("Site01", 2000))
    assert r["kind"] != "local-5m"
    assert r["kind"] == "regional-80m" and r["tile"] == "Site01"
    assert "near range" in r["reason"]


def test_deep_inside_tile_is_local_5m():
    # Site23's tile is 21 km wide: its 7 km-margin box is wider than the +/-3 km map, so its corner is local-5m
    crs, (x0, y0, x1, y1) = _tile_info("Site23")
    lon, lat = Transformer.from_crs(crs, LONLAT, always_xy=True).transform(x0 + 7100, y0 + 7100)
    r = classify_point(lat, lon)
    assert (r["kind"], r["tile"]) == ("local-5m", "Site23")
    lon, lat = Transformer.from_crs(crs, LONLAT, always_xy=True).transform(x0 + 6900, y0 + 7100)
    assert classify_point(lat, lon)["kind"] == "regional-80m"


def test_polar_outside_tiles_is_regional():
    assert classify_point(-85.0, 100.0)["kind"] in ("regional-80m", "local-5m", "map-cell")
    assert classify_point(-80.5, 60.0)["kind"] == "regional-80m"


def test_coverage_json_matches_sources():
    path = C.OUT_DIR / "coverage.json"
    if not path.exists():
        pytest.skip("coverage.json not generated (python -m preprocess.coverage)")
    cov = json.loads(path.read_text())
    assert cov["version"] == 1
    assert cov["time"] == {"startUtc": "2026-11-01T00:00:00Z", "endUtc": "2027-11-01T00:00:00Z",
                           "stepS": 600, "mainPeriodEndUtc": "2027-01-01T00:00:00Z"}
    assert {m["siteId"] for m in cov["maps"]} == {"Site01", "Site04", "Site04R", "Site07", "Site11", "Site20", "Site23"}
    assert {c["siteId"] for c in cov["catalogue"]} == set(C.SITES)
    assert all(c["horizonResolutionDeg"] == 0.1 for c in cov["catalogue"])
    assert all(m["horizonResolutionDeg"] == 1 and m["summaryResolutionDeg"] == 0.5 for m in cov["maps"])
    assert [d["kind"] for d in cov["dems"]][-2:] == ["regional-80m", "global-474m"]
