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
