import json
import subprocess
import sys

import numpy as np
import pytest

from preprocess import config as C

needs_dem = pytest.mark.skipif(not (C.RAW_DIR / "dem").exists(), reason="data_raw/dem missing")

SITE01 = ["--lat", "-89.4632", "--lon", "222.51"]  # Site01, longitude given in 0..360


def run(args, out_root=None):
    cmd = [sys.executable, "-m", "preprocess.custom_point", *args]
    if out_root is not None:
        cmd += ["--out-root", str(out_root)]
    return subprocess.run(cmd, cwd=C.ROOT, capture_output=True, text=True)


def test_rejects_point_without_5m_near_field(tmp_path):
    r = run(["--id", "X", "--lat", "0", "--lon", "0"], tmp_path)
    assert r.returncode == 2
    assert "5 m" in r.stderr
    assert not any(tmp_path.iterdir())


def test_rejects_point_near_tile_edge(tmp_path):
    from preprocess.coverage import point_inside_tile_edge
    lat, lon = point_inside_tile_edge("Site01", 2000)  # inside the tile, near range spills out
    r = run(["--id", "X", "--lat", repr(lat), "--lon", repr(lon)], tmp_path)
    assert r.returncode == 2 and "5 m" in r.stderr and "80 m" in r.stderr


def test_rejects_start_not_on_600s_grid(tmp_path):
    r = run(["--id", "X", *SITE01, "--start", "2026-11-01T00:04:00Z"], tmp_path)
    assert r.returncode == 2 and "600 s" in r.stderr


def test_rejects_stop_before_start(tmp_path):
    r = run(["--id", "X", *SITE01, "--start", "2027-01-01T00:00:00Z", "--stop", "2026-12-01T00:00:00Z"], tmp_path)
    assert r.returncode == 2 and "after" in r.stderr


def test_rejects_range_outside_generator_coverage(tmp_path):
    r = run(["--id", "X", *SITE01, "--stop", "2041-01-01T00:00:00Z"], tmp_path)
    assert r.returncode == 2 and "2040-01-01T00:00:00Z" in r.stderr


@pytest.mark.parametrize("bad", ["../X", "Site01", ""])
def test_rejects_bad_or_catalogue_id(tmp_path, bad):
    r = run(["--id", bad, *SITE01], tmp_path)
    assert r.returncode == 2


@pytest.mark.parametrize("lat,lon", [("-91", "0"), ("nan", "0"), ("-89", "inf")])
def test_rejects_invalid_coordinate(tmp_path, lat, lon):
    r = run(["--id", "X", "--lat", lat, "--lon", lon], tmp_path)
    assert r.returncode == 2


def test_no_partial_output_on_rejection():
    r = run(["--id", "X", "--lat", "0", "--lon", "0"])
    assert r.returncode == 2
    assert not (C.OUT_DIR / "custom" / "X").exists()


def test_query_year_defaults_unchanged():
    from preprocess import season as S
    import inspect
    sig = inspect.signature(S.query_year)
    assert sig.parameters["start"].default == S.SEASON_START
    assert sig.parameters["stop"].default == S.SEASON_STOP
    assert all(sig.parameters[k].default is None for k in ("lat", "lon", "eye"))


# ---------------------------------------------------------------- full build (one shared package)
@pytest.fixture(scope="module")
def tmp_out(tmp_path_factory):
    root = tmp_path_factory.mktemp("custom")
    r = run(["--id", "T01", *SITE01, "--source", "skyfield"], root)
    assert r.returncode == 0, r.stdout + r.stderr
    pkg = root / "T01"
    assert [p.name for p in root.iterdir()] == ["T01"]  # temp build dir renamed, nothing else left
    return pkg


def _j(pkg, name):
    return json.loads((pkg / name).read_text(encoding="utf-8"))


@needs_dem
def test_package_files(tmp_out):
    names = sorted(p.name for p in tmp_out.iterdir())
    assert names == ["ephemeris.json", "extended.json", "horizon.json", "package.json", "site.json", "terrain.json", "year.bin"]
    h = _j(tmp_out, "horizon.json")
    assert h["azStepDeg"] == 0.1 and h["count"] == 3600 and h["params"]["maxRangeM"] == C.FAR_RANGE_M
    e = _j(tmp_out, "ephemeris.json")
    assert (e["startUtc"], e["stepS"]) == (C.START_UTC, C.STEP_S)


@needs_dem
def test_lon_normalised_in_site_json(tmp_out):
    s = _j(tmp_out, "site.json")
    assert s["lonDeg"] == -137.49 and s["latDeg"] == -89.4632
    assert s["id"] == "T01" and s["category"] == "custom"
    assert s["label"] == "Custom point - not a catalogue site, not a certified landing site"
    assert s["demNear"] == "LOLA 5 m/px Site01 (Barker et al. 2021)"


@needs_dem
def test_catalogue_coordinate_reproduces_site01(tmp_out):
    mine = np.array(_j(tmp_out, "horizon.json")["elevDeg"])
    ref = np.array(json.loads((C.OUT_DIR / "Site01" / "horizon.json").read_text(encoding="utf-8"))["elevDeg"])
    assert mine.shape == ref.shape
    assert np.abs(mine - ref).max() <= 0.01
    ref_eye = json.loads((C.OUT_DIR / "Site01" / "extended.json").read_text(encoding="utf-8"))["year"]["observer"]["eyeM"]
    assert _j(tmp_out, "extended.json")["year"]["observer"]["eyeM"] == ref_eye


@needs_dem
def test_package_observer_is_shared(tmp_out):
    from preprocess import writer as W
    s, ext = _j(tmp_out, "site.json"), _j(tmp_out, "extended.json")
    y = ext["year"]
    assert ext["extendedSchema"] == 2 and ext["siteId"] == "T01"
    assert y["observer"] == {"latDeg": s["latDeg"], "lonDeg": s["lonDeg"],
                             "eyeM": round(s["surfaceElevationM"] + 2, 2)}
    assert (y["startUtc"], y["endUtc"], y["stepS"]) == ("2026-11-01T00:00:00Z", "2027-11-01T00:00:00Z", 600)
    assert y["source"] == "skyfield-de421"
    assert y["sha256"] == W.sha256_file(tmp_out / "year.bin")
    data = np.fromfile(tmp_out / "year.bin", dtype="<f4")
    assert data.size == 6 * y["count"] == 6 * 52561 and np.isfinite(data).all()
    # the first two months of year.bin are the ephemeris.json samples (same observer, same times)
    e = _j(tmp_out, "ephemeris.json")
    n = e["count"]
    sun_el = data.reshape(6, -1)[1][:n]
    assert np.abs(sun_el - np.array(e["sun"]["elDeg"])).max() < 1e-3
