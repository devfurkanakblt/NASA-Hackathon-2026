"""Build all public/data files.

Usage:
  python -m preprocess.build_all                       # all sites, Horizons ephemeris
  python -m preprocess.build_all --sites Site01
  python -m preprocess.build_all --source skyfield     # offline fallback
  python -m preprocess.build_all --skip-ephemeris      # only DEM products
  python -m preprocess.build_all --far-range 250000
"""
import argparse
import json
import time

import numpy as np

from . import config as C, writer as W
from . import horizon as Hz, terrain as T
from .dem import load_site_dems, surface_elevation

REFINE_TOL_DEG = 0.02  # stricter than the 0.05 deg acceptance threshold


def ephemeris(site_id, eye_alt_m, source):
    s = C.SITES[site_id]
    if source == "horizons":
        from . import ephemeris_horizons as E
        try:
            sun = E.query("sun", s["lat"], s["lon"], eye_alt_m)[1]
            earth = E.query("earth", s["lat"], s["lon"], eye_alt_m)[1]
            return W.ephemeris_doc(site_id, "jpl-horizons", sun, earth)
        except Exception as exc:  # noqa: BLE001
            print(f"  Horizons failed ({exc}); falling back to Skyfield")
    from . import ephemeris_skyfield as SF
    sun = SF.query("sun", s["lat"], s["lon"], eye_alt_m)
    earth = SF.query("earth", s["lat"], s["lon"], eye_alt_m)
    return W.ephemeris_doc(site_id, "skyfield-de421", sun, earth)


GLOBAL_DEM_NOTE = ("near field uses the global LOLA DEM (~474 m/px); nearStepM is the ray sampling step, "
                   "not the DEM resolution")


def horizon_params(site_id, far_range_m):
    """`params` for horizon.json, plus a warning for sites whose near field is the global DEM.

    nearStepM/farStepM are ray sampling steps. On the global LDEM_64 a 2.5 m step only interpolates a
    ~474 m grid, so those sites name their DEM in `params.nearDem` and carry a note.
    """
    params = {"nearRangeM": C.NEAR_RANGE_M, "nearStepM": C.NEAR_STEP_M,
              "maxRangeM": far_range_m, "farStepM": C.FAR_STEP_M,
              "minRangeM": C.MIN_RANGE_M, "curvature": True}
    if C.SITES[site_id].get("dem") == "ldem64":
        params["nearDem"] = "LDEM_64 (~474 m/px)"
        return params, GLOBAL_DEM_NOTE
    return params, None


def build_site(site_id, args, out=None):
    """Build one site's files into `out` (default public/data/<site_id>); return its sites.json entry."""
    t0 = time.time()
    s = C.SITES[site_id]
    out = out or C.OUT_DIR / site_id
    near, far, xy = load_site_dems(site_id, far_range_m=args.far_range)
    z0, warnings = surface_elevation(near, far, xy)
    eye = z0 + C.OBSERVER_HEIGHT_M
    print(f"[{site_id}] surface {z0:.1f} m, eye {eye:.1f} m")

    if not args.skip_ephemeris:
        W.write(out / "ephemeris.json", ephemeris(site_id, eye, args.source))

    d = Hz.distances(far_range=args.far_range)
    elev, dist, fb = Hz.compute(s["lat"], s["lon"], eye, near, far, near.crs, d=d)
    # Refinement: recompute with halved steps; keep the finer value where they disagree.
    d_fine = Hz.distances(near_step=C.NEAR_STEP_M / 2, far_step=C.FAR_STEP_M / 2, far_range=args.far_range)
    elev_f, dist_f, _ = Hz.compute(s["lat"], s["lon"], eye, near, far, near.crs, d=d_fine)
    bad = np.abs(elev_f - elev) > REFINE_TOL_DEG
    elev[bad], dist[bad] = elev_f[bad], dist_f[bad]
    refined_az = [round(i * C.AZ_STEP_DEG, 1) for i in np.flatnonzero(bad)]
    print(f"  refined {bad.sum()} / {bad.size} azimuths with halved steps")
    hw = []
    if fb:
        hw.append(f"{fb} near-field samples (<= {C.NEAR_RANGE_M:.0f} m) used the 80 m DEM")
    n_leave, affected = Hz.coverage_check(s["lat"], s["lon"], eye, far, near.crs, elev, d=d)
    if n_leave:
        hw.append(f"{n_leave} of {elev.size} rays leave the 80 m DEM (latitude limit -80 deg) before "
                  f"{args.far_range / 1000:.0f} km; terrain beyond could raise the horizon at "
                  f"{len(affected)} azimuths (bound: {C.MAX_LUNAR_HEIGHT_M / 1000:.1f} km high terrain)")
    print(f"  coverage: {n_leave} rays leave the DEM, {len(affected)} azimuths possibly affected")
    params, dem_note = horizon_params(site_id, args.far_range)
    if dem_note:
        hw.append(dem_note)
    doc = W.horizon_doc(site_id, elev, dist, params, hw)
    doc["refinedAzDeg"] = refined_az
    if affected:
        doc["coverageLimitedAzDeg"] = affected
    W.write(out / "horizon.json", doc)
    print(f"  horizon: min {elev.min():.3f}, max {elev.max():.3f} deg")

    z, miss = T.build(s["lat"], s["lon"], eye, near, far, near.crs)
    W.write(out / "terrain.json", W.terrain_doc(site_id, z, 10_000.0))
    if miss:
        warnings.append(f"terrain grid: {miss} samples from 80 m DEM")
    print(f"  done in {time.time() - t0:.0f} s")
    return W.site_entry(site_id, z0, warnings)


def update_sites_json(entries):
    path = C.OUT_DIR / "sites.json"
    existing = {}
    if path.exists():
        existing = {e["id"]: e for e in json.loads(path.read_text(encoding="utf-8"))["sites"]}
    existing.update({e["id"]: e for e in entries})
    ordered = [existing[k] for k in C.SITES if k in existing]
    W.write(path, W.sites_doc(ordered))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sites", nargs="+", default=list(C.SITES))
    ap.add_argument("--source", choices=["horizons", "skyfield"], default="horizons")
    ap.add_argument("--skip-ephemeris", action="store_true")
    ap.add_argument("--far-range", type=float, default=C.FAR_RANGE_M)
    args = ap.parse_args()
    entries = [build_site(sid, args) for sid in args.sites]
    update_sites_json(entries)


if __name__ == "__main__":
    main()
