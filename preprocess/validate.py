"""Acceptance tests -> docs/validation.md

1. Ephemeris cross-check: JSON (Horizons) vs independent Skyfield/DE421, full series.
2. Horizon convergence: 32 azimuths, ray steps halved, |delta| <= 0.05 deg.
   Range sensitivity: 32 azimuths, 100 km vs the used range (250 km).
3. Data transfer: JSON values vs a fresh, independent Horizons request (TLIST) at
   >= 10 times per site and body, |delta| <= 0.01 deg.
4. Rise/set timing: terrain rise/set instants estimated from the 10-minute series
   vs a 1-minute Horizons reference series around the same events.

Usage: python -m preprocess.validate [--sites Site01 ...] [--skip-range] [--skip-horizon]
"""
import argparse
import json
from datetime import datetime, timedelta

import numpy as np

from . import config as C
from . import horizon as Hz
from . import visibility as V
from .dem import load_site_dems, surface_elevation

AZ32 = np.round(np.arange(32) * 11.25, 1)  # on the 0.1 deg grid of horizon.json
TOL_EPHEM = 0.01
TOL_HORIZON = 0.05
N_TRANSFER = 12   # random epochs per site (plus first and last sample)
N_EVENTS = 4      # rise/set events per site and body for the timing test
REF_STEP_S = 60   # 1-minute reference series


def load(site_id, name):
    return json.loads((C.OUT_DIR / site_id / name).read_text(encoding="utf-8"))


def load_eye(site_id):
    sites = json.loads((C.OUT_DIR / "sites.json").read_text(encoding="utf-8"))["sites"]
    e = next(x for x in sites if x["id"] == site_id)
    return e["surfaceElevationM"] + e["observerHeightM"]


def utc_at(eph, i):
    t0 = datetime.fromisoformat(eph["startUtc"].replace("Z", "+00:00"))
    return (t0 + timedelta(seconds=int(i) * eph["stepS"])).isoformat().replace("+00:00", "Z")


# ---------------------------------------------------------------- 1. ephemeris
def check_ephemeris(site_id):
    from . import ephemeris_skyfield as SF
    s = C.SITES[site_id]
    eph = load(site_id, "ephemeris.json")
    eye = load_eye(site_id)
    rows = []
    for body in ("sun", "earth"):
        sf = SF.query(body, s["lat"], s["lon"], eye)
        az_sf = np.array([r[1] for r in sf])
        el_sf = np.array([r[2] for r in sf])
        az = np.array(eph[body]["azDeg"])
        el = np.array(eph[body]["elDeg"])
        daz = np.abs((az - az_sf + 180) % 360 - 180)
        # azimuth error projected on the sky (shrinks near zenith)
        daz_sky = daz * np.cos(np.radians(el))
        rows.append((body, eph["source"], len(az), float(daz_sky.max()), float(np.abs(el - el_sf).max())))
    return rows


def ephemeris_section(args):
    md = ["## 1. Ephemeris: JPL Horizons vs Skyfield (DE421, MOON_ME_DE421)", "",
          "Every 10-minute sample over 2026-11-01 to 2027-01-01 is compared.", "",
          "| Site | Body | File source | Samples | max |dAz|*cos(el) [deg] | max |dEl| [deg] | Pass |",
          "|---|---|---|---|---|---|---|"]
    for sid in args.sites:
        for body, src, n, daz, dele in check_ephemeris(sid):
            ok = daz <= TOL_EPHEM and dele <= TOL_EPHEM
            md.append(f"| {sid} | {body} | {src} | {n} | {daz:.5f} | {dele:.5f} | {'yes' if ok else 'NO'} |")
            print(sid, body, f"{daz:.5f} {dele:.5f}")
    return md + [""]


# ---------------------------------------------------------------- 2. horizon
def check_horizon(site_id, skip_range):
    s = C.SITES[site_id]
    near, far, xy = load_site_dems(site_id, far_range_m=C.FAR_RANGE_M)
    z0, _ = surface_elevation(near, far, xy)
    eye = z0 + C.OBSERVER_HEIGHT_M
    base_d = Hz.distances()
    fine_d = Hz.distances(near_step=C.NEAR_STEP_M / 2, far_step=C.FAR_STEP_M / 2)
    e0, d0, _ = Hz.compute(s["lat"], s["lon"], eye, near, far, near.crs, az_deg=AZ32, d=base_d)
    e1, _, _ = Hz.compute(s["lat"], s["lon"], eye, near, far, near.crs, az_deg=AZ32, d=fine_d)
    # Where the build refined an azimuth (published value = half steps), test half vs quarter steps.
    hz_file = load(site_id, "horizon.json")
    refined = np.isin(np.round(AZ32, 1), np.round(hz_file.get("refinedAzDeg", []), 1))
    conv = np.abs(e1 - e0)
    if refined.any():
        q_d = Hz.distances(near_step=C.NEAR_STEP_M / 4, far_step=C.FAR_STEP_M / 4)
        e2, _, _ = Hz.compute(s["lat"], s["lon"], eye, near, far, near.crs, az_deg=AZ32[refined], d=q_d)
        conv[refined] = np.abs(e2 - e1[refined])
        e0 = np.where(refined, e1, e0)
    res = {"conv_max": float(conv.max()), "conv_fail": [float(a) for a in AZ32[conv > TOL_HORIZON]]}
    # consistency with the published file (which may contain refined azimuths)
    idx = np.round(AZ32 / hz_file["azStepDeg"]).astype(int)
    res["file_vs_recompute"] = float(np.abs(np.array(hz_file["elevDeg"])[idx] - e0).max())
    if not skip_range:
        e100, _, _ = Hz.compute(s["lat"], s["lon"], eye, near, far, near.crs, az_deg=AZ32,
                                d=Hz.distances(far_range=100_000))
        rng = np.abs(e0 - e100)
        res["range_max"] = float(rng.max())
        res["range_changed"] = [(float(a), float(x)) for a, x in zip(AZ32, rng) if x > TOL_HORIZON]
        res["far_hits"] = int((d0 > 100_000).sum())
    return res


def horizon_section(args):
    md = ["## 2. Horizon convergence and range sensitivity (32 azimuths, every 11.25 deg)", "",
          "| Site | Halved steps: max |d| [deg] | Failing az | File vs recompute [deg] | "
          "100 vs 250 km: max |d| [deg] | Azimuths changed > tol |",
          "|---|---|---|---|---|---|"]
    for sid in args.sites:
        r = check_horizon(sid, args.skip_range)
        print(sid, r)
        rng = f"{r['range_max']:.4f}" if "range_max" in r else "skipped"
        chg = ", ".join(f"{a:g} ({x:.3f})" for a, x in r.get("range_changed", [])) or "none"
        md.append(f"| {sid} | {r['conv_max']:.4f} | {', '.join(map(str, r['conv_fail'])) or 'none'} | "
                  f"{r['file_vs_recompute']:.5f} | {rng} | {chg} |")
    return md + [""]


# ---------------------------------------------------------------- 3. transfer
def check_transfer(site_id, seed):
    """JSON vs an independent Horizons TLIST request with identical settings."""
    from . import ephemeris_horizons as E
    s = C.SITES[site_id]
    eph = load(site_id, "ephemeris.json")
    rng = np.random.default_rng(seed)
    idx = np.unique(np.concatenate([[0, eph["count"] - 1],
                                    rng.choice(eph["count"], N_TRANSFER, replace=False)]))
    utc = [utc_at(eph, i) for i in idx]
    rows = []
    for body in ("sun", "earth"):
        got = E.query_times(body, s["lat"], s["lon"], load_eye(site_id), utc)[1]
        if [g[0] for g in got] != utc:
            raise RuntimeError(f"Horizons returned different epochs for {site_id} {body}")
        az = np.array([g[1] for g in got])
        el = np.array([g[2] for g in got])
        dist = np.array([g[3] for g in got])
        b = eph[body]
        fa, fe, fd = (np.array(b[k])[idx] for k in ("azDeg", "elDeg", "distanceM"))
        daz = np.abs((fa - az + 180) % 360 - 180) * np.cos(np.radians(el))
        rows.append((body, len(idx), float(daz.max()), float(np.abs(fe - el).max()),
                     float(np.abs(fd / dist - 1).max())))
    return rows


def transfer_section(args):
    md = ["## 3. Data transfer: JSON vs a fresh Horizons request", "",
          f"{N_TRANSFER} random epochs per site (fixed seed) plus the first and last sample are requested "
          "again from Horizons as a discrete time list (TLIST) with the same observer settings.", "",
          "| Site | Body | Epochs | max |dAz|*cos(el) [deg] | max |dEl| [deg] | max rel. distance diff | Pass |",
          "|---|---|---|---|---|---|---|"]
    for k, sid in enumerate(args.sites):
        for body, n, daz, dele, dd in check_transfer(sid, seed=k):
            ok = daz <= TOL_EPHEM and dele <= TOL_EPHEM
            md.append(f"| {sid} | {body} | {n} | {daz:.6f} | {dele:.6f} | {dd:.1e} | {'yes' if ok else 'NO'} |")
            print("transfer", sid, body, daz, dele, dd)
    md += ["", "The files store angles with 4 decimals (<= 0.00005 deg rounding) and distances to the "
           "nearest km (<= 500 m), which bounds the expected difference."]
    return md + [""]


# ---------------------------------------------------------------- 4. timing
def _crossing(t, f):
    """Linear zero crossings of f between samples, in the units of t."""
    k = np.flatnonzero(np.sign(f[:-1]) != np.sign(f[1:]))
    return [t[i] + (t[i + 1] - t[i]) * f[i] / (f[i] - f[i + 1]) for i in k]


def check_timing(site_id):
    """Terrain rise/set instants: 10-min series (interpolated) vs 1-min Horizons reference."""
    from . import ephemeris_horizons as E
    s = C.SITES[site_id]
    eph = load(site_id, "ephemeris.json")
    hz = load(site_id, "horizon.json")
    step = eph["stepS"]
    out = []
    for body in ("sun", "earth"):
        m = V.margin(eph, hz, body)
        ev = V.transitions(m > 0)
        ev = ev[(ev >= 1) & (ev <= eph["count"] - 3)]  # room for the reference window
        if len(ev) == 0:
            out.append(dict(body=body, events=0))
            continue
        pick = ev[np.unique(np.linspace(0, len(ev) - 1, min(N_EVENTS, len(ev))).round().astype(int))]
        errs, rates = [], []
        for i in pick:
            t10 = _crossing(np.array([0.0, step]), m[i:i + 2])[0]  # seconds after sample i
            ref = E.query(body, s["lat"], s["lon"], load_eye(site_id),
                          utc_at(eph, i - 1), utc_at(eph, i + 2), REF_STEP_S)[1]
            az = np.array([r[1] for r in ref])
            el = np.array([r[2] for r in ref])
            f = el - V.horizon_at(hz, az)
            tr = np.arange(len(f)) * float(REF_STEP_S) - step  # seconds after sample i
            c = _crossing(tr, f)
            if not c:
                continue
            t1 = min(c, key=lambda x: abs(x - t10))
            errs.append(abs(t10 - t1))
            k = int(np.clip(np.searchsorted(tr, t1), 1, len(f) - 1))
            rates.append(abs(f[k] - f[k - 1]) / REF_STEP_S * 60)  # deg/min
        rates = np.array(rates)
        out.append(dict(body=body, events=int(len(V.transitions(m > 0))), tested=len(errs),
                        err_max_s=float(max(errs)), err_mean_s=float(np.mean(errs)),
                        rate_min=float(rates.min()), rate_max=float(rates.max()),
                        min_per_005=float(TOL_HORIZON / rates.max()),
                        max_per_005=float(TOL_HORIZON / rates.min())))
    return out


def timing_section(args):
    md = ["## 4. Rise/set timing: 10-minute series vs 1-minute reference", "",
          "A terrain rise/set is a sign change of `el - horizonAt(az)`. The instant is estimated by linear "
          "interpolation between the two 10-minute samples and compared with the crossing in a 1-minute "
          f"Horizons series around the same event (up to {N_EVENTS} events per site and body, spread over "
          "the period). The last column converts the 0.05 deg horizon tolerance into time using the "
          "observed rate at the crossing.", "",
          "| Site | Body | Events in period | Tested | max |dt| [min] | mean |dt| [min] | "
          "Rate at crossing [deg/h] | 0.05 deg horizon error = [min] |",
          "|---|---|---|---|---|---|---|---|"]
    for sid in args.sites:
        for r in check_timing(sid):
            print("timing", sid, r)
            if r["events"] == 0:
                md.append(f"| {sid} | {r['body']} | 0 | - | - | - | - | - |")
                continue
            md.append(f"| {sid} | {r['body']} | {r['events']} | {r['tested']} | {r['err_max_s'] / 60:.2f} | "
                      f"{r['err_mean_s'] / 60:.2f} | {r['rate_min'] * 60:.2f}-{r['rate_max'] * 60:.2f} | "
                      f"{r['min_per_005']:.0f}-{r['max_per_005']:.0f} |")
    md += ["", "Using samples without interpolation (visible if `el > horizonAt(az)` at the sample) shifts "
           "an event by up to one step (10 min). Near the pole the Sun and Earth cross the horizon slowly, "
           "so a small angle error becomes a large time error (last column)."]
    return md + [""]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sites", nargs="+", default=list(C.SITES))
    ap.add_argument("--skip-range", action="store_true")
    ap.add_argument("--skip-ephemeris", action="store_true")
    ap.add_argument("--skip-horizon", action="store_true")
    args = ap.parse_args()

    md = ["# Validation report", "",
          "Generated by `python -m preprocess.validate`. Tolerances: ephemeris "
          f"{TOL_EPHEM} deg, horizon {TOL_HORIZON} deg.", ""]
    if not args.skip_ephemeris:
        md += ephemeris_section(args)
    if not args.skip_horizon:
        md += horizon_section(args)
    md += transfer_section(args) + timing_section(args)
    md += ["Pixel size and these numerical checks are not a statement of the DEM's absolute accuracy."]
    out = C.ROOT / "docs" / "validation.md"
    out.write_text("\n".join(md) + "\n", encoding="utf-8")
    print(f"wrote {out.relative_to(C.ROOT)}")


if __name__ == "__main__":
    main()
