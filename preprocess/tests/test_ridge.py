import pytest

from preprocess import config as C

pytestmark = pytest.mark.skipif(not C.local_dem_path("Site04").exists(), reason="Site04 DEM not downloaded")


def test_site04r_matches_rule():
    from preprocess import ridge
    r = ridge.find("Site04", radius_m=2_000, max_slope_deg=10)
    s = C.SITES["Site04R"]
    assert r["lat"] == pytest.approx(s["lat"], abs=1e-5)
    assert r["lon"] == pytest.approx(s["lon"], abs=1e-4)
    assert r["slopeDeg"] <= 10 and r["catalogueSlopeDeg"] > 25


def test_ridge_rule_is_stable():
    from preprocess import ridge
    a = ridge.find("Site04", radius_m=2_000, max_slope_deg=10)
    b = ridge.find("Site04", radius_m=3_000, max_slope_deg=15)
    assert (a["lat"], a["lon"]) == (b["lat"], b["lon"])
