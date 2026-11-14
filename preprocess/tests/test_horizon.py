import numpy as np
import pytest
from pyproj import Transformer

from preprocess import horizon as Hz
from preprocess.dem import Dem, LONLAT

CRS = "+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +x_0=0 +y_0=0 +R=1737400 +units=m +no_defs"
LAT, LON = -89.4632, -137.49
TF = Transformer.from_crs(LONLAT, CRS, always_xy=True)


def site_xy():
    return TF.transform(LON, LAT)


def grid_dem(res, half, fn=None):
    cx, cy = site_xy()
    n = int(2 * half / res)
    left, top = cx - half, cy + half
    xs = left + (np.arange(n) + 0.5) * res
    ys = top - (np.arange(n) + 0.5) * res
    X, Y = np.meshgrid(xs, ys)
    z = np.zeros_like(X) if fn is None else fn(X - cx, Y - cy)
    return Dem(z, left, top, res)


def elev_exact(h_t, d, h_o=2.0):
    R = Hz.R
    return np.degrees(np.arctan2((R + h_t) * np.cos(d / R) - (R + h_o), (R + h_t) * np.sin(d / R)))


def test_flat_sphere_dip():
    far = grid_dem(80, 30_000)
    d = Hz.distances(far_range=20_000)
    elev, dist, _ = Hz.compute(LAT, LON, 2.0, None, far, CRS, az_deg=[0, 90, 200], d=d)
    expected = -np.degrees(np.arccos(Hz.R / (Hz.R + 2.0)))  # ~ -0.0027 deg
    assert np.allclose(elev, expected, atol=2e-4)
    assert np.allclose(dist, np.sqrt(2 * Hz.R * 2.0), rtol=0.05)  # tangent point ~2.6 km


def test_wall_in_one_direction():
    # 1000 m wall ~10 km away along projected +x only
    wall = lambda X, Y: np.where((X > 10_000) & (X < 10_400) & (np.abs(Y) < 2_000), 1000.0, 0.0)
    far = grid_dem(40, 30_000, wall)
    azs = np.arange(0, 360, 0.25)
    lon, lat = Hz.ray_lonlat(LAT, LON, azs, [10_200])
    x, _ = TF.transform(lon, lat)
    az_x = azs[np.argmax(x[:, 0])]
    elev, dist, _ = Hz.compute(LAT, LON, 2.0, None, far, CRS, az_deg=[az_x, (az_x + 180) % 360],
                               d=Hz.distances(far_range=20_000))
    assert elev[0] == pytest.approx(elev_exact(1000.0, 10_000.0), abs=0.05)
    assert 9_900 <= dist[0] <= 10_100
    assert elev[1] < 0.01


def test_az0_points_north():
    _, lat = Hz.ray_lonlat(LAT, LON, [0, 180], [1000])
    assert lat[0, 0] > LAT and lat[1, 0] < LAT


def test_az90_points_east():
    lon, _ = Hz.ray_lonlat(LAT, LON, [90], [1000])
    dlon = (lon[0, 0] - LON + 540) % 360 - 180
    assert dlon > 0


def test_near_dem_preferred_and_fallback():
    near = grid_dem(5, 3_000, lambda X, Y: np.full_like(X, 50.0))   # covers only 3 km
    far = grid_dem(80, 30_000)
    d = Hz.distances(far_range=10_000)
    elev, dist, fb = Hz.compute(LAT, LON, 2.0, near, far, CRS, az_deg=[45], d=d)
    assert fb > 0                       # 3..7 km came from far DEM
    assert dist[0] < 3_100              # horizon is the 50 m plateau edge


def test_bilinear():
    dem = Dem(np.array([[0, 10], [20, 30]], dtype=np.float32), left=0, top=10, res=5)
    assert dem.sample(np.array([5.0]), np.array([5.0]))[0] == pytest.approx(15.0)
    assert np.isnan(dem.sample(np.array([-50.0]), np.array([5.0]))[0])
