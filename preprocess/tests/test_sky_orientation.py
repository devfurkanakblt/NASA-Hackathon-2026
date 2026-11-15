"""Analytical tests for the optional C-owned Earth orientation transform."""
import math

import numpy as np
import pytest

from preprocess.sky_orientation import (SPHERE_TO_ITRS, _validate_inputs, interpolation_errors,
    load_display_ephemeris, local_scene_basis, matrix_to_quaternion_xyzw, quaternion_xyzw_to_matrix, scene_rotation,
    sha256, write_display_manifest)


@pytest.mark.parametrize("lat,lon", [(0, 0), (-90, 0), (-89.4632, -137.49), (45, 90), (20, 170)])
def test_scene_basis_is_proper_rotation_and_maps_local_north_east_up(lat, lon):
    lat_r, lon_r = np.radians([lat, lon])
    east = [-np.sin(lon_r), np.cos(lon_r), 0]
    north = [-np.sin(lat_r)*np.cos(lon_r), -np.sin(lat_r)*np.sin(lon_r), np.cos(lat_r)]
    up = [np.cos(lat_r)*np.cos(lon_r), np.cos(lat_r)*np.sin(lon_r), np.sin(lat_r)]
    r = local_scene_basis(lat, lon)
    np.testing.assert_allclose(r @ east, [1, 0, 0], atol=1e-14)
    np.testing.assert_allclose(r @ north, [0, 0, -1], atol=1e-14)
    np.testing.assert_allclose(r @ up, [0, 1, 0], atol=1e-14)
    assert np.linalg.det(r) == pytest.approx(1)


@pytest.mark.parametrize("lon", [-180, -90, 0, 90, 180])
def test_three_sphere_uv_longitude_is_registered_to_itrs(lon):
    u = (lon + 180) / 360
    sphere = [-math.cos(2*math.pi*u), 0, math.sin(2*math.pi*u)]
    expected_itrs = [math.cos(math.radians(lon)), math.sin(math.radians(lon)), 0]
    np.testing.assert_allclose(SPHERE_TO_ITRS @ sphere, expected_itrs, atol=1e-14)
    np.testing.assert_allclose(SPHERE_TO_ITRS @ [0, 1, 0], [0, 0, 1], atol=1e-14)


@pytest.mark.parametrize("axis", [0, 1, 2])
@pytest.mark.parametrize("angle", [0, 0.1, 1.7, math.pi, 4.2])
def test_xyzw_quaternion_roundtrip_all_trace_branches(axis, angle):
    q = np.zeros(4)
    q[axis] = math.sin(angle / 2)
    q[3] = math.cos(angle / 2)
    r = quaternion_xyzw_to_matrix(q)
    result = matrix_to_quaternion_xyzw(r)
    assert np.linalg.norm(result) == pytest.approx(1)
    np.testing.assert_allclose(quaternion_xyzw_to_matrix(result), r, atol=1e-14)


def test_scene_rotation_composes_inverse_earth_rotation_in_correct_order():
    # A synthetic +90 degree ICRF->ITRS rotation means terrestrial Greenwich
    # is inertial -Y, not +Y. At lunar lat/lon 0/0 that means local west (-X).
    icrf_to_itrs = np.array([[0, -1, 0], [1, 0, 0], [0, 0, 1.]])
    r = scene_rotation(np.eye(3), icrf_to_itrs, 0, 0)
    np.testing.assert_allclose(r @ [1, 0, 0], [-1, 0, 0], atol=1e-14)
    np.testing.assert_allclose(r @ [0, 1, 0], [0, 0, -1], atol=1e-14)
    assert np.linalg.det(r) == pytest.approx(1)


def test_equivalent_longitudes_have_same_registered_rotation():
    np.testing.assert_allclose(scene_rotation(np.eye(3), np.eye(3), -89, -137.49),
                               scene_rotation(np.eye(3), np.eye(3), -89, 222.51), atol=1e-14)


@pytest.mark.parametrize("bad", [np.zeros((3, 3)), np.diag([-1, 1, 1]), np.ones((2, 2)), np.full((3, 3), np.nan)])
def test_quaternion_rejects_nonrotations(bad):
    with pytest.raises(ValueError):
        matrix_to_quaternion_xyzw(bad)


def test_ephemeris_grid_and_site_id_are_validated_without_guessing():
    site = {"id": "Custom42", "latDeg": -89, "lonDeg": 0}
    eph = {"siteId": "Custom42", "count": 2, "stepS": 600, "startUtc": "2026-11-15T00:00:00Z", "earth": {"distanceM": [4e8, 4e8]}}
    start, distance = _validate_inputs(site, eph)
    assert start.utcoffset().total_seconds() == 0
    assert distance.tolist() == [4e8, 4e8]
    for patch in ({"siteId": "Other"}, {"startUtc": "2026-11-15T00:00:00"}, {"earth": {"distanceM": [4e8, math.nan]}}, {"count": True}):
        with pytest.raises(ValueError):
            _validate_inputs(site, {**eph, **patch})


def test_hourly_slerp_is_compared_at_every_native_ten_minute_epoch():
    angles = np.radians(np.arange(7) * 2.5)
    q = [[0, math.sin(a/2), 0, math.cos(a/2)] for a in angles]
    rotations = np.stack([quaternion_xyzw_to_matrix(x) for x in q], axis=2)
    light = np.array([[math.cos(a/10), math.sin(a/10), 0] for a in angles]).T
    report = interpolation_errors([q[0], q[-1]], [light[:, 0], light[:, -1]], rotations, light, 6)
    assert report["referenceSamples"] == 7
    assert report["intermediateSamples"] == 5
    assert report["maxAttitudeInterpolationErrorDeg"] < 1e-12
    assert report["maxSunVectorInterpolationErrorDeg"] < 1e-4
    assert report["pass"]


def test_interpolation_check_rejects_excess_mid_hour_error_and_is_site_basis_invariant():
    angles = np.radians([0, 2.5, 5, 7.6, 10, 12.5, 15])
    q = [[0, math.sin(a/2), 0, math.cos(a/2)] for a in angles]
    rotations = np.stack([quaternion_xyzw_to_matrix(x) for x in q], axis=2)
    light = np.repeat([[1.], [0.], [0.]], 7, axis=1)
    report = interpolation_errors([q[0], q[-1]], [[1, 0, 0], [1, 0, 0]], rotations, light, 6)
    assert report["maxAttitudeInterpolationErrorDeg"] == pytest.approx(0.1, abs=1e-12)
    assert not report["pass"]
    basis = local_scene_basis(-41.6385, -153.9852)
    rotated = np.einsum("ij,jkn->ikn", basis, rotations)
    nodes = [matrix_to_quaternion_xyzw(rotated[:, :, i]) for i in (0, 6)]
    other = interpolation_errors(nodes, [basis @ [1, 0, 0]] * 2, rotated, basis @ light, 6)
    assert other["maxAttitudeInterpolationErrorDeg"] == pytest.approx(report["maxAttitudeInterpolationErrorDeg"], abs=1e-12)


def test_annual_source_reader_keeps_float32_metre_units_and_identifies_input_files(tmp_path):
    import json
    header = {"version": 1, "siteId": "Test", "year": {"file": "year.bin", "count": 2,
              "startUtc": "2026-11-01T00:00:00Z", "stepS": 600, "source": "jpl-horizons"}}
    (tmp_path / "extended.json").write_text(json.dumps(header))
    values = np.array([[1, 2], [3, 4], [1.5e11, 1.5e11], [5, 6], [7, 8], [3.8e8, 3.9e8]], dtype="<f4")
    values.tofile(tmp_path / "year.bin")
    doc, provenance = load_display_ephemeris(tmp_path, "Test")
    assert doc["earth"]["distanceM"] == values[5].astype(float).tolist()
    assert doc["sun"]["azDeg"] == [1, 2]
    assert provenance["file"] == "year.bin" and len(provenance["sha256"]) == 64
    values[0, 0] = np.nan
    values.tofile(tmp_path / "year.bin")
    with pytest.raises(ValueError, match="finite"):
        load_display_ephemeris(tmp_path, "Test")


def test_manifest_drops_crosschecks_for_different_orientation_content(tmp_path):
    import json
    (tmp_path / "sites.json").write_text(json.dumps({"sites": [{"id": "Test"}]}))
    folder = tmp_path / "Test"
    folder.mkdir()
    path = folder / "earth-orientation.json"
    path.write_text(json.dumps({"siteId": "Test", "startUtc": "2026-11-01T00:00:00Z", "stepS": 3600, "count": 2,
        "source": {"validation": {"interpolation": {"intermediateSamples": 5,
            "maxAttitudeInterpolationErrorDeg": 0.001, "maxSunVectorInterpolationErrorDeg": 0.00001}}}}))
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps({"orientationValidation": {"queries": [{"siteId": "Test", "orientationSha256": "old"}]}}))
    write_display_manifest(tmp_path, manifest)
    result = json.loads(manifest.read_text())
    assert "orientationValidation" not in result
    assert result["orientationDisplay"]["testedIntermediateEpochs"] == 5
    result["orientationValidation"] = {"queries": [{"siteId": "Test", "orientationSha256": sha256(path)}]}
    manifest.write_text(json.dumps(result))
    write_display_manifest(tmp_path, manifest)
    assert "orientationValidation" in json.loads(manifest.read_text())
