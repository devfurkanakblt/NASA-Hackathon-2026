"""Unit tests for the plan-A expansion modules (regional map geometry, season months, coverage bound)."""
import numpy as np

from preprocess import horizon as Hz
from preprocess import regional_map as M
from preprocess import season as S
from preprocess.tests.test_horizon import CRS, LAT, LON, grid_dem


def fake_eph(n=50, seed=0):
    rng = np.random.default_rng(seed)
    return {b: {"azDeg": rng.uniform(0, 360, n), "elDeg": rng.uniform(-5, 10, n),
                "distanceM": np.full(n, d)} for b, d in (("sun", 1.496e11), ("earth", 3.8e8))}


def test_body_vectors_roundtrip_at_centre():
    eph = fake_eph()
    body = M.body_vectors(eph, LAT, LON, 1000.0)
    for b in ("sun", "earth"):
        az, el = M.local_azel(body[b][0], LAT, LON, 1000.0)
        daz = (az - eph[b]["azDeg"] + 180) % 360 - 180
        assert np.abs(daz).max() < 1e-9 and np.abs(el - eph[b]["elDeg"]).max() < 1e-9


def test_azimuth_rotates_with_position_near_pole():
    # 3 km away at 89.46 S the local north turns by ~ 3 km / 16 km rad ~ 10 deg: the Sun's azimuth must change
    eph = fake_eph()
    body = M.body_vectors(eph, LAT, LON, 0.0)
    lon, lat = Hz.ray_lonlat(LAT, LON, [90.0], [3000.0])
    az, _ = M.local_azel(body["sun"][0], lat[0, 0], lon[0, 0], 0.0)
    daz = np.abs((az - eph["sun"]["azDeg"] + 180) % 360 - 180)
    assert daz.min() > 5.0


def test_earth_parallax_is_small_but_present():
    eph = fake_eph()
    body = M.body_vectors(eph, LAT, LON, 0.0)
    lon, lat = Hz.ray_lonlat(LAT, LON, [0.0], [3000.0])
    _, el_far = M.local_azel(body["earth"][0], lat[0, 0], lon[0, 0], 0.0)
    _, el_sun = M.local_azel(body["sun"][0], lat[0, 0], lon[0, 0], 0.0)
    # elevations shift mainly from the tilt of the local vertical (3 km / R ~ 0.1 deg)
    assert 0.05 < np.abs(el_sun - eph["sun"]["elDeg"]).max() < 0.11
    assert np.abs(el_far - eph["earth"]["elDeg"]).max() < 0.15


def test_grid_order_and_centre():
    n, e, nn, lat, lon = M.grid("Site01", half_m=1000, spacing_m=500)
    assert n == 5 and e.size == 25
    assert e[0] == -1000 and nn[0] == -1000          # row 0 = south, col 0 = west
    assert e[1] == -500 and nn[1] == -1000           # columns advance east
    assert lat[12] == LAT and lon[12] == LON         # centre cell is the site


def test_month_starts():
    m = S.month_starts("2026-11-01T00:00:00Z", "2027-02-01T00:00:00Z")
    assert [x.strftime("%Y-%m") for x in m] == ["2026-11", "2026-12", "2027-01", "2027-02"]


def test_coverage_check_flags_missing_high_terrain():
    far = grid_dem(80, 30_000)                         # flat DEM, rays leave it at ~30 km
    d = Hz.distances(far_range=60_000)
    elev, _, _ = Hz.compute(LAT, LON, 2.0, None, far, CRS, az_deg=[0, 90], d=d)
    n_leave, affected = Hz.coverage_check(LAT, LON, 2.0, far, CRS, elev, az_deg=[0, 90], d=d)
    assert n_leave == 2 and affected == [0.0, 90.0]    # 10.8 km terrain at 30 km would dominate
    n_leave, affected = Hz.coverage_check(LAT, LON, 2.0, far, CRS, np.array([30.0, 30.0]),
                                          az_deg=[0, 90], d=d)
    assert n_leave == 2 and affected == []             # cannot exceed a 30 deg horizon
