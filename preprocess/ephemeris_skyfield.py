"""Skyfield fallback / cross-check: topocentric Sun/Earth for a lunar observer in MOON_ME_DE421."""
from datetime import datetime, timedelta, timezone

import numpy as np
from skyfield.api import Loader
from skyfield.planetarylib import PlanetaryConstants

from . import config as C

_cache = {}


def _kernels():
    if not _cache:
        load = Loader(str(C.RAW_DIR / "skyfield"))
        eph = load("de421.bsp")
        pc = PlanetaryConstants()
        pc.read_text(load("moon_080317.tf"))
        pc.read_text(load("pck00008.tpc"))
        pc.read_binary(load("moon_pa_de421_1900-2050.bpc"))
        _cache.update(ts=load.timescale(), eph=eph, frame=pc.build_frame_named("MOON_ME_DE421"), pc=pc)
    return _cache


def times(start_utc=C.START_UTC, stop_utc=C.STOP_UTC, step_s=C.STEP_S):
    t0 = datetime.fromisoformat(start_utc.replace("Z", "+00:00"))
    t1 = datetime.fromisoformat(stop_utc.replace("Z", "+00:00"))
    n = int((t1 - t0).total_seconds() // step_s) + 1
    return [t0 + timedelta(seconds=i * step_s) for i in range(n)]


def query(body, lat, lon, alt_m, start_utc=C.START_UTC, stop_utc=C.STOP_UTC, step_s=C.STEP_S):
    """Return rows of (utc_iso, az_deg, el_deg, range_m), same shape as Horizons."""
    k = _kernels()
    dts = times(start_utc, stop_utc, step_s)
    t = k["ts"].from_datetimes(dts)
    site = k["eph"]["moon"] + k["pc"].build_latlon_degrees(k["frame"], lat, lon, elevation_m=alt_m)
    alt, az, dist = site.at(t).observe(k["eph"][body]).apparent().altaz()
    return [(d.isoformat().replace("+00:00", "Z"), float(a), float(e), float(r))
            for d, a, e, r in zip(dts, az.degrees, alt.degrees, dist.m)]


if __name__ == "__main__":
    from . import ephemeris_horizons as H
    s = C.SITES["Site01"]
    for body in ("sun", "earth"):
        _, hz = H.query(body, s["lat"], s["lon"], 0.0, "2026-11-15T00:00:00Z", "2026-11-15T01:00:00Z")
        sf = query(body, s["lat"], s["lon"], 0.0, "2026-11-15T00:00:00Z", "2026-11-15T01:00:00Z")
        for h, f in zip(hz, sf):
            print(body, h[0], f"dAz={f[1]-h[1]:+.5f} dEl={f[2]-h[2]:+.5f} deg  el_hz={h[2]:.4f}")
