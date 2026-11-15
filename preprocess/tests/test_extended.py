import numpy as np
import pytest

from preprocess import config as C
from preprocess.validate import load

pytestmark = pytest.mark.skipif(not (C.OUT_DIR / "Site01" / "year.bin").exists(),
                                reason="year.bin not generated (python -m preprocess.extended)")


def read_year(sid):
    return np.fromfile(C.OUT_DIR / sid / "year.bin", "<f4").reshape(6, -1)


def test_year_header():
    h = load("Site01", "extended.json")["year"]
    assert (h["startUtc"], h["stepS"], h["count"]) == ("2026-11-01T00:00:00Z", 600, 52561)
    assert (C.OUT_DIR / "Site01" / "year.bin").stat().st_size == 6 * 52561 * 4


@pytest.mark.parametrize("sid", list(C.SITES))
def test_year_matches_two_month_ephemeris(sid):
    y = read_year(sid)
    e = load(sid, "ephemeris.json")
    n = e["count"]
    fields = [(b, f) for b in ("sun", "earth") for f in ("azDeg", "elDeg", "distanceM")]
    for k, (b, f) in enumerate(fields):
        d = y[k, :n].astype(np.float64) - np.asarray(e[b][f])
        if f == "azDeg":
            d = (d + 180.0) % 360.0 - 180.0
        # ephemeris.json rounds distanceM to 1 km (writer._r(..., -3)); float32 adds <= 16 m (Earth), 4 km (Sun)
        tol = 1e-4 if f != "distanceM" else 2e4 if b == "sun" else 600.0
        assert np.max(np.abs(d)) <= tol, (b, f, float(np.max(np.abs(d))))


@pytest.mark.skipif(not (C.RAW_DIR / "skyfield" / "de421.bsp").exists(), reason="Skyfield kernels not downloaded")
def test_year_matches_skyfield_over_whole_year():
    """Validation section 1b for one site: the 2027 part is not covered by the two-month checks."""
    from preprocess.validate import TOL_EPHEM, check_year
    _, rows = check_year("Site01")
    for body, n, daz, dele, d27 in rows:
        assert n == 52561
        assert max(daz, dele, d27) <= TOL_EPHEM, (body, daz, dele, d27)


MAP_SITES = ["Site01", "Site04", "Site04R", "Site07", "Site11", "Site20", "Site23"]


def test_cells_shape_and_decimation():
    hz = np.load(C.RAW_DIR / "map_Site01.npz")["horizons"]
    c = np.fromfile(C.OUT_DIR / "Site01" / "cells.bin", "<i2").reshape(-1, 360)
    assert c.shape == (3721, 360)
    assert np.max(np.abs(c / 100 - hz[:, ::2])) <= 0.005


def test_cells_header_eye():
    h = load("Site01", "extended.json")["cells"]
    assert h["n"] == 3721 and len(h["eyeM"]) == 3721 and h["azStepDeg"] == 1


@pytest.mark.parametrize("sid", MAP_SITES)
def test_one_degree_cells_match_map(sid):
    from preprocess import extended
    d = extended.check(sid)
    assert max(d["sunPct"], d["earthPct"], d["bothPct"]) <= 0.2


def test_warning_text():
    from preprocess import extended
    assert extended.near_field_warning(27, 1000) == ("2.7 % of terrain samples within 7 km of each cell fell "
                                                    "outside the 5 m DEM and used the 80 m DEM")


def test_near_field_total_counts_near_steps():
    from preprocess import extended, horizon as Hz
    n_near = int((Hz.distances() <= C.NEAR_RANGE_M).sum())
    assert extended.near_field_total(10) == 10 * 720 * n_near


def test_no_raw_counts_left_in_maps():
    for sid in MAP_SITES:
        assert not any("near-field ray samples" in w for w in load(sid, "map.json").get("warnings", []))
