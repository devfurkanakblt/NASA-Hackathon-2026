"""C display-detail math tests use analytic fixtures, never fabricated production relief."""
import numpy as np
import pytest
import json
from pathlib import Path
from PIL import Image

from preprocess import config as C
from preprocess import terrain_detail as d
from preprocess.dem import LONLAT


def test_three_object_normal_axis_and_gradient_signs():
    c = np.arange(9, dtype=float) * 10
    east, north = np.meshgrid(c, c)
    z = .2 * east - .3 * north
    actual = d.object_normals(z, 10)
    expected = np.array([-.2, 1., -.3])
    expected /= np.linalg.norm(expected)
    np.testing.assert_allclose(actual, np.broadcast_to(expected, actual.shape), atol=1e-14)


def test_rgb_data_are_north_at_top_and_quantisation_is_bounded():
    c = np.arange(9, dtype=float) * 10
    east, north = np.meshgrid(c, c)
    normals = d.object_normals(north ** 2 / 1000, 10)
    rgb, error = d.encode_normals(normals)
    assert rgb.dtype == np.uint8
    assert rgb[0, 0, 2] > rgb[-1, 0, 2]  # northmost dz/dN > southmost
    assert error < .5
    flat, _ = d.encode_normals(d.object_normals(east * 0, 10))
    np.testing.assert_array_equal(flat[0, 0], [128, 255, 128])


def test_chunked_sampling_preserves_curvature_and_means():
    class Sphere:
        crs = LONLAT
        def sample(self, x, y):
            return np.zeros_like(x)
    site = dict(id="fixture", latDeg=-89, lonDeg=30, surfaceElevationM=0, observerHeightM=2)
    a = d.local_heights(site, Sphere(), n=9, size_m=900, oversample=2, chunk_rows=2)
    b = d.local_heights(site, Sphere(), n=9, size_m=900, oversample=2, chunk_rows=9)
    np.testing.assert_allclose(a, b, atol=0)
    c = -450 + (np.arange(18) + .5) * 50
    east, north = np.meshgrid(c, c)
    expected = (C.MOON_RADIUS_M * np.cos(np.hypot(east, north) / C.MOON_RADIUS_M)
                - (C.MOON_RADIUS_M + 2)).reshape(9, 2, 9, 2).mean(axis=(1, 3))
    np.testing.assert_allclose(a, expected, atol=1e-8)


def test_missing_native_coverage_cannot_turn_into_detail():
    class Missing:
        crs = LONLAT
        def sample(self, x, y):
            return np.full_like(x, np.nan)
    site = dict(id="fixture", latDeg=-89, lonDeg=30, surfaceElevationM=0, observerHeightM=2)
    with pytest.raises(ValueError, match="does not cover"):
        d.local_heights(site, Missing(), n=8, size_m=80)


@pytest.mark.parametrize("z,spacing", [(np.full((3,3), np.nan), 1), (np.zeros((2,2)),1), (np.zeros((3,3)),0)])
def test_rejects_bad_grids(z, spacing):
    with pytest.raises(ValueError):
        d.object_normals(z, spacing)


def test_contrast_points_do_not_get_fabricated_fine_detail(tmp_path):
    assert d.build_site({"id": "Apollo11", "category": "contrast"}, tmp_path, tmp_path) is None
    assert list(tmp_path.iterdir()) == []


def test_download_resumes_an_exact_verified_range(tmp_path, monkeypatch):
    cache = tmp_path / "dem"
    cache.mkdir()
    partial = cache / "Site01_final_adj_5mpp_surf.tif.part"
    partial.write_bytes(b"abc")
    class Response:
        status_code = 206
        headers = {"Content-Range": "bytes 3-4/5"}
        content = b"de"
        def raise_for_status(self): pass
    class Head(Response):
        headers = {"Content-Length": "5"}
    seen = []
    monkeypatch.setattr(d.requests, "head", lambda *a, **k: Head())
    monkeypatch.setattr(d.requests, "get", lambda *a, **k: (seen.append(k["headers"]["Range"]) or Response()))
    target, _ = d.fetch_tile("Site01", tmp_path)
    assert target.read_bytes() == b"abcde"
    assert seen == ["bytes=3-4"]
    assert not partial.exists()


def test_rejects_nonunit_normal_data():
    with pytest.raises(ValueError, match="unit length"):
        d.encode_normals(np.zeros((3, 3, 3)))


def test_small_native_footprint_is_explicit_not_coarse_fill(monkeypatch):
    seen = []
    def sample(site, dem, n, size, oversample):
        seen.append(size)
        if size > 9000:
            raise ValueError("site: native 5 m DEM does not cover the entire normal-map patch")
        return np.ones((n,n))
    monkeypatch.setattr(d, "local_heights", sample)
    grid, size = d.covered_heights({}, object(), 8, 10000, 2)
    assert seen == [10000, 9000]
    assert size == 9000
    np.testing.assert_array_equal(grid, 1)


def test_generated_data_maps_match_manifest_hash_and_linear_encoding():
    data = Path(__file__).resolve().parents[2] / "public" / "data"
    manifests = sorted(data.glob("*/terrain-normal.json"))
    assert manifests
    for path in manifests:
        doc = json.loads(path.read_text(encoding="utf-8"))
        image = path.parent / doc["file"]
        assert d.sha256(image) == doc["sha256"]
        assert doc["frame"] == d.FRAME
        assert doc["outputPixelM"] == doc["sizeM"] / doc["n"]
        assert doc["outputPixelM"] >= doc["sourceNativePixelM"] == 5
        with Image.open(image) as source:
            assert source.format == "PNG" and source.mode == "RGB"
            assert source.size == (doc["n"], doc["n"])
            assert "srgb" not in source.info and "icc_profile" not in source.info
            decoded = np.asarray(source, dtype=np.float64) / 127.5 - 1
            length = np.linalg.norm(decoded, axis=-1)
            assert np.min(length) > .99 and np.max(length) < 1.01
