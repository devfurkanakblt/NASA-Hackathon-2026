import numpy as np

from preprocess import visibility as V

H = {"azStepDeg": 0.1, "count": 3600, "elevDeg": list(np.arange(3600) * 0.001)}  # 0 .. 3.599 deg


def test_horizon_at_grid_and_interpolation():
    assert V.horizon_at(H, 0.0) == 0.0
    assert np.isclose(V.horizon_at(H, 10.0), 0.1)
    assert np.isclose(V.horizon_at(H, 10.05), 0.1005)


def test_horizon_at_wraps_359_to_0():
    # between 359.9 (3.599) and 0.0 (0.0): halfway -> 1.7995
    assert np.isclose(V.horizon_at(H, 359.95), 1.7995)
    assert np.isclose(V.horizon_at(H, -0.05), 1.7995)
    assert np.isclose(V.horizon_at(H, 360.0), 0.0)
    assert np.isclose(V.horizon_at(H, 730.0), V.horizon_at(H, 10.0))


def test_runs_and_transitions():
    m = np.array([True, True, False, True, False, False, True])
    assert V.runs(m) == [(0, 2), (3, 1), (6, 1)]
    assert V.transitions(m).tolist() == [1, 2, 3, 5]
    assert V.runs(np.zeros(4, bool)) == []


def test_visibility_strictly_above_horizon():
    eph = {"sun": {"azDeg": [10.0, 10.0], "elDeg": [0.1, 0.1001], "distanceM": [1.5e11, 1.5e11]}}
    assert V.visible(eph, H, "sun").tolist() == [False, True]
