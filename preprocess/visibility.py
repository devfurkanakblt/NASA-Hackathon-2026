"""Python twin of the visibility rule in docs/data-contract.md (shared by B and D).

Kept deliberately identical to the TypeScript `horizonAt` so that reference values
produced here can be used as unit-test expectations in the web app.
"""
import numpy as np

SUN_RADIUS_AU_DEG = 0.2666  # angular radius of the Sun at 1 au [deg]
AU_M = 1.495978707e11


def horizon_at(h, az_deg):
    """Circular linear interpolation of the horizon profile (vectorised)."""
    elev = np.asarray(h["elevDeg"], dtype=np.float64)
    x = np.mod(np.mod(np.asarray(az_deg, dtype=np.float64), 360.0) + 360.0, 360.0) / h["azStepDeg"]
    fl = np.floor(x)
    i0 = fl.astype(np.int64) % h["count"]
    i1 = (i0 + 1) % h["count"]
    f = x - fl
    return elev[i0] * (1 - f) + elev[i1] * f


def margin(eph, h, body):
    """Elevation above the terrain horizon [deg]; > 0 means visible."""
    b = eph[body]
    return np.asarray(b["elDeg"]) - horizon_at(h, b["azDeg"])


def visible(eph, h, body):
    return margin(eph, h, body) > 0


def sun_fraction(eph, h):
    """Visible fraction of the solar disk (linear approximation from the contract)."""
    r = SUN_RADIUS_AU_DEG * AU_M / np.asarray(eph["sun"]["distanceM"])
    return np.clip((margin(eph, h, "sun") + r) / (2 * r), 0.0, 1.0)


def runs(mask):
    """(start, length) of consecutive True runs."""
    m = np.concatenate([[False], np.asarray(mask, bool), [False]])
    d = np.diff(m.astype(np.int8))
    s, e = np.flatnonzero(d == 1), np.flatnonzero(d == -1)
    return list(zip(s.tolist(), (e - s).tolist()))


def transitions(mask):
    """Indices i where mask[i] != mask[i+1] (the event lies between sample i and i+1)."""
    m = np.asarray(mask, bool)
    return np.flatnonzero(m[:-1] != m[1:])
