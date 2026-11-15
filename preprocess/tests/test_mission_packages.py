"""Mission sources, multiyear boundaries and global-DEM seams; no network needed."""
import json
import numpy as np
import pytest
from preprocess import config as C
from preprocess.custom_point import check_times, check_point, Rejected
from preprocess.global_dem import GlobalDem, CRS
from preprocess.mission_catalogue import MISSION_SITES
from preprocess.package_contract import FILES
from preprocess.writer import sha256_file


def test_multi_year_period_is_supported_without_clipping():
    assert check_times("2026-11-01T00:00:00Z", "2029-11-01T00:00:00Z") == (
        "2026-11-01T00:00:00Z", "2029-11-01T00:00:00Z")
    with pytest.raises(Rejected, match="at most"):
        check_times("2026-11-01T00:00:00Z", "2033-11-01T00:00:00Z")
    with pytest.raises(Rejected, match="600"):
        check_times("2028-01-01T00:04:00Z", "2029-01-01T00:00:00Z")


def test_chunking_handles_month_end_and_leap_day():
    from preprocess.season import month_starts
    edges = month_starts("2028-01-31T12:00:00Z", "2028-04-01T12:00:00Z")
    assert [e.strftime("%Y-%m-%d") for e in edges] == ["2028-01-31", "2028-02-01", "2028-03-01", "2028-04-01"]


def test_global_choice_is_explicit_and_normalises_longitude():
    assert check_point(0, 222, "global") == (0, -138, "ldem64")
    assert check_point(90, -180, "global") == (90, 180, "ldem64")
    with pytest.raises(Rejected, match="south of 80"):
        check_point(0, 0, "regional")


def test_global_dem_periodic_seam_and_missing_latitudes():
    g = GlobalDem(np.array([[1, 2, 3, 4], [1, 2, 3, 4], [1, 2, 3, 4]]), 0, 3, 1, CRS)
    assert g.sample([0, 4, -4], [2, 2, 2]).tolist() == [2.5, 2.5, 2.5]
    assert np.isnan(g.sample([1], [10])).all()  # cropped window must not clamp missing terrain


def test_global_dem_polar_edge_uses_real_pixels():
    pole = np.pi * C.MOON_RADIUS_M / 2
    g = GlobalDem(np.ones((3, 4)) * 123, 0, pole, 1, CRS)
    assert g.sample([1], [pole])[0] == 123


def test_all_nine_artemis_regions_are_source_pinned_research_candidates():
    entries = [v for v in MISSION_SITES.values() if v["program"] == "Artemis"]
    assert len(entries) == 9
    assert all(v["coordinateStatus"] == "research-candidate" and "Table A1" in v["coordSource"] for v in entries)
    assert MISSION_SITES["ArtemisMalapert"]["tile"] == "Site23"
    assert MISSION_SITES["ArtemisMouton"]["tile"] == "Site20"
    assert MISSION_SITES["PeregrineTarget"]["coordinateStatus"] == "region-representative"


def test_failed_custom_build_publishes_nothing(tmp_path, monkeypatch):
    from preprocess import custom_point as P
    def fail(*args, **kwargs):
        raise ValueError("missing DEM")
    monkeypatch.setattr(P.build_all, "build_site", fail)
    with pytest.raises(ValueError, match="missing DEM"):
        P.build("Transient", 0, 0, "ldem64", "2028-01-01T00:00:00Z", "2029-01-01T00:00:00Z",
                "skyfield", C.FAR_RANGE_M, tmp_path / "output")
    assert not (tmp_path / "output").exists()
    assert "Transient" not in C.SITES


def test_writer_refuses_nonfinite_json_without_replacing_existing_file(tmp_path):
    from preprocess.writer import write
    path = tmp_path / "terrain.json"
    path.write_text('{"valid":true}')
    with pytest.raises(ValueError):
        write(path, {"zM": [float("nan")]})
    assert path.read_text() == '{"valid":true}'


@pytest.mark.parametrize("sid", list(MISSION_SITES))
def test_published_packages_are_complete_and_hash_bound(sid):
    root = C.OUT_DIR / sid
    manifest = json.loads((root / "package.json").read_text())
    assert manifest["siteId"] == sid
    for name in FILES:
        assert manifest["files"][name] == {"bytes": (root / name).stat().st_size, "sha256": sha256_file(root / name)}
    ext = json.loads((root / "extended.json").read_text())
    hz = json.loads((root / "horizon.json").read_text())
    assert manifest["observer"] == ext["year"]["observer"] == hz["observer"]
    assert manifest["coverage"]["endUtc"] == "2027-11-01T00:00:00Z"
    assert np.isfinite(np.fromfile(root / "year.bin", "<f4")).all()
