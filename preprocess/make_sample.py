"""Synthetic-but-contract-valid sample files for B/C/D. Ephemeris is real (Skyfield, alt 0),
horizon and terrain are synthetic. Usage: python -m preprocess.make_sample"""
import numpy as np

from . import config as C, writer as W
from . import ephemeris_skyfield as SF

OUT = C.OUT_DIR / "_sample"


def main():
    sid = "Site01"
    s = C.SITES[sid]
    sun = SF.query("sun", s["lat"], s["lon"], 0.0)
    earth = SF.query("earth", s["lat"], s["lon"], 0.0)
    doc = W.ephemeris_doc(sid, "synthetic", sun, earth)
    W.write(OUT / sid / "ephemeris.json", doc)

    az = np.arange(3600) * C.AZ_STEP_DEG
    elev = 1.2 * np.sin(np.radians(2 * az)) + 0.6 * np.sin(np.radians(5 * az + 40)) + 0.3
    dist = 20_000 + 15_000 * np.cos(np.radians(az))
    W.write(OUT / sid / "horizon.json",
            W.horizon_doc(sid, elev, dist, {"synthetic": True}, ["synthetic sample"]))

    n, size = 128, 10_000.0
    x = np.linspace(-size / 2, size / 2, n)
    X, Y = np.meshgrid(x, x)
    Z = 150 * np.exp(-((X - 2000) ** 2 + Y ** 2) / 2e6) - 2e-6 * (X ** 2 + Y ** 2) * 20
    W.write(OUT / sid / "terrain.json", W.terrain_doc(sid, Z, size))

    W.write(OUT / "sites.json", W.sites_doc([W.site_entry(sid, 0.0, ["synthetic sample"])]))


if __name__ == "__main__":
    main()
