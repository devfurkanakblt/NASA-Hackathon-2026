"""Analytical tests for the optional C-owned Earth orientation transform."""
import math

import numpy as np
import pytest

from preprocess.sky_orientation import (SPHERE_TO_ITRS, _validate_inputs,
    local_scene_basis, matrix_to_quaternion_xyzw, quaternion_xyzw_to_matrix, scene_rotation)


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
