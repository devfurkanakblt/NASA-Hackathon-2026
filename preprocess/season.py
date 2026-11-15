"""One-year seasonal summary per site (plan P2).

The terrain horizon does not change with time, so only the ephemeris is re-queried
(JPL Horizons, same observer settings as ephemeris.json, 10-minute steps) over
SEASON_START..SEASON_STOP. The full series is not published (it would be ~6x the size
of ephemeris.json); the web app gets a monthly table in {siteId}/season.json.

Consistency check: the first two months of the year series must reproduce the
2-month reference values (docs/reference/visibility.json) exactly, because the
observer, settings and sample times are identical.

Usage: python -m preprocess.season [--sites Site01 ...] [--source skyfield]
"""
import argparse
import json
from datetime import datetime, timedelta, timezone

import numpy as np

from . import config as C, writer as W
from . import visibility as V
from .validate import load, load_eye

SEASON_START = "2026-11-01T00:00:00Z"
SEASON_STOP = "2027-11-01T00:00:00Z"
CHUNK_MONTHS = 3  # Horizons output stays well under its line limit


def _dt(iso):
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


def _iso(dt):
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def month_starts(start=SEASON_START, stop=SEASON_STOP):
    t, t1, out = _dt(start), _dt(stop), []
    while t < t1:
        out.append(t)
        t = t.replace(year=t.year + (t.month == 12), month=t.month % 12 + 1)
    return out + [t1]


def query_year(site_id, source="horizons", start=SEASON_START, stop=SEASON_STOP, lat=None, lon=None, eye=None):
    """Return {'sun': rows, 'earth': rows} for start..stop (rows as in Horizons).

    Defaults: the season period and the catalogue site's coordinate and eye (sites.json). A custom
    point passes lat/lon/eye itself; start/stop must lie inside the season on the STEP_S grid.
    """
    s = C.SITES.get(site_id, {})
    lat = s["lat"] if lat is None else lat
    lon = s["lon"] if lon is None else lon
    eye = load_eye(site_id) if eye is None else eye
    t0, t1 = _dt(start), _dt(stop)
    # Chunk edges come from the season's quarter starts, so the default call keeps its Horizons cache keys.
    edges = [t0] + [m for m in month_starts()[::CHUNK_MONTHS] if t0 < m < t1] + [t1]
    out = {}
    for body in ("sun", "earth"):
        rows = []
        for a, b in zip(edges[:-1], edges[1:]):
            if source == "horizons":
                from . import ephemeris_horizons as E
                part = E.query(body, lat, lon, eye, _iso(a), _iso(b), C.STEP_S)[1]
            else:
                from . import ephemeris_skyfield as SF
                part = SF.query(body, lat, lon, eye, _iso(a), _iso(b), C.STEP_S)
            if rows and rows[-1][0] == part[0][0]:
                part = part[1:]  # chunk edges overlap by one sample
            rows += part
        out[body] = rows
    n = int((t1 - t0).total_seconds() // C.STEP_S) + 1
    for body, rows in out.items():
        assert len(rows) == n, (body, len(rows), n)
        assert rows[0][0] == start and rows[-1][0] == stop
    return out


def as_eph(rows):
    return {b: {"azDeg": np.array([r[1] for r in rows[b]]), "elDeg": np.array([r[2] for r in rows[b]]),
                "distanceM": np.array([r[3] for r in rows[b]])} for b in ("sun", "earth")}


def longest_s(mask):
    r = V.runs(mask)
    return int(max(L for _, L in r) * C.STEP_S) if r else 0


def stats(eph, hz, sl):
    sun = V.visible(eph, hz, "sun")[sl]
    earth = V.visible(eph, hz, "earth")[sl]
    frac = V.sun_fraction(eph, hz)[sl]
    return {"samples": int(sun.size),
            "sunPct": round(100 * float(sun.mean()), 2),
            "earthPct": round(100 * float(earth.mean()), 2),
            "bothPct": round(100 * float((sun & earth).mean()), 2),
            "sunDiskFractionMean": round(float(frac.mean()), 4),
            "longestNoSunS": longest_s(~sun), "longestNoEarthS": longest_s(~earth),
            "sunElMaxDeg": round(float(np.max(eph["sun"]["elDeg"][sl])), 3),
            "sunElMinDeg": round(float(np.min(eph["sun"]["elDeg"][sl])), 3),
            "earthElMaxDeg": round(float(np.max(eph["earth"]["elDeg"][sl])), 3)}


def site_doc(site_id, rows, source):
    eph = as_eph(rows)
    hz = load(site_id, "horizon.json")
    t0 = _dt(SEASON_START)
    months = []
    ms = month_starts()
    for a, b in zip(ms[:-1], ms[1:]):
        i0 = int((a - t0).total_seconds() // C.STEP_S)
        i1 = int((b - t0).total_seconds() // C.STEP_S)  # [i0, i1): month without its end sample
        months.append({"month": a.strftime("%Y-%m"), "startIndex": i0, "endIndex": i1,
                       **stats(eph, hz, slice(i0, i1))})
    n = len(rows["sun"])
    # Same samples as ephemeris.json (Nov 1 .. Jan 1 inclusive) -> must equal the reference values
    n2 = int((_dt(C.STOP_UTC) - t0).total_seconds() // C.STEP_S) + 1
    return {"version": W.VERSION, "siteId": site_id, "source": source, "generatedUtc": W.now_utc(),
            "coverage": {"startUtc": SEASON_START, "endUtc": SEASON_STOP, "stepS": C.STEP_S, "count": n},
            "rule": "visible = elDeg > horizonAt(horizon, azDeg) per sample (docs/data-contract.md)",
            "year": stats(eph, hz, slice(0, n)),
            "mainPeriod": {"startUtc": C.START_UTC, "endUtc": C.STOP_UTC, **stats(eph, hz, slice(0, n2))},
            "months": months}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sites", nargs="+", default=list(C.SITES))
    ap.add_argument("--source", choices=["horizons", "skyfield"], default="horizons")
    args = ap.parse_args()
    ref = json.loads((C.ROOT / "docs" / "reference" / "visibility.json").read_text(encoding="utf-8"))
    for sid in args.sites:
        rows = query_year(sid, args.source)
        doc = site_doc(sid, rows, "jpl-horizons" if args.source == "horizons" else "skyfield-de421")
        W.write(C.OUT_DIR / sid / "season.json", doc)
        r = ref["sites"][sid]["percentVisible"]
        m = doc["mainPeriod"]
        ok = (m["sunPct"], m["earthPct"], m["bothPct"]) == (r["sun"], r["earth"], r["both"])
        print(f"[{sid}] year sun {doc['year']['sunPct']} earth {doc['year']['earthPct']}; "
              f"Nov-Dec vs reference: {'match' if ok else 'MISMATCH'} {m['sunPct'], m['earthPct'], m['bothPct']} "
              f"vs {r['sun'], r['earth'], r['both']}")
        for mo in doc["months"]:
            print(f"   {mo['month']}: sun {mo['sunPct']:6.2f}  earth {mo['earthPct']:6.2f}  "
                  f"both {mo['bothPct']:6.2f}  sunElMax {mo['sunElMaxDeg']:6.3f}")


if __name__ == "__main__":
    main()
