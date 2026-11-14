"""JPL Horizons topocentric Sun/Earth az/el for a lunar surface observer.

Polite client: sequential requests, >=1 s spacing, retries with backoff, disk cache.
"""
import hashlib
import json
import time
from datetime import datetime, timezone

import requests

from . import config as C

API = "https://ssd.jpl.nasa.gov/api/horizons.api"
UA = {"User-Agent": "LunarSiteNavigator-preprocess/0.1"}
BODIES = {"sun": "10", "earth": "399"}
CACHE = C.RAW_DIR / "horizons_cache"
_last_call = 0.0


def _hz_time(iso: str) -> str:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).strftime("%Y-%m-%d %H:%M")


def build_params(body, lat, lon, alt_m, start_utc, stop_utc, step_s):
    return {
        "format": "json",
        "COMMAND": f"'{BODIES[body]}'",
        "OBJ_DATA": "'NO'",
        "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'OBSERVER'",
        "CENTER": "'coord@301'",
        "COORD_TYPE": "'GEODETIC'",
        "SITE_COORD": f"'{lon:.6f},{lat:.6f},{alt_m / 1000:.6f}'",
        "START_TIME": f"'{_hz_time(start_utc)}'",
        "STOP_TIME": f"'{_hz_time(stop_utc)}'",
        "STEP_SIZE": f"'{step_s // 60}m'",
        "TIME_TYPE": "'UT'",
        "QUANTITIES": "'4,20'",
        "APPARENT": "'AIRLESS'",
        "ANG_FORMAT": "'DEG'",
        "CSV_FORMAT": "'YES'",
        "EXTRA_PREC": "'YES'",
        "CAL_FORMAT": "'CAL'",
        "TIME_DIGITS": "'MINUTES'",
    }


def fetch(params) -> str:
    global _last_call
    key = hashlib.sha1(json.dumps(params, sort_keys=True).encode()).hexdigest()
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"{key}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))["result"]
    for attempt in range(3):
        wait = 1.0 - (time.time() - _last_call)
        if wait > 0:
            time.sleep(wait)
        _last_call = time.time()
        try:
            r = requests.get(API, params=params, headers=UA, timeout=120)
            r.raise_for_status()
            data = r.json()
            if "error" in data:
                raise RuntimeError(data["error"])
            path.write_text(json.dumps(data), encoding="utf-8")
            return data["result"]
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2 ** (attempt + 1))


def parse(result: str):
    """Return header text and rows of (utc_iso, az_deg, el_deg, range_m)."""
    if "$$SOE" not in result:
        raise RuntimeError("Horizons returned no ephemeris:\n" + result[-2000:])
    header, rest = result.split("$$SOE", 1)
    body = rest.split("$$EOE", 1)[0]
    # Column header line is the last non-separator line before $$SOE
    cols_line = [l for l in header.splitlines() if "Date__(UT)__HR:MN" in l][0]
    cols = [c.strip() for c in cols_line.split(",")]
    i_az, i_el = cols.index("Azimuth_(a-app)"), cols.index("Elevation_(a-app)")
    i_dl = cols.index("delta")
    rows = []
    for line in body.strip().splitlines():
        f = [x.strip() for x in line.split(",")]
        t = datetime.strptime(f[0], "%Y-%b-%d %H:%M").replace(tzinfo=timezone.utc)
        rows.append((t.isoformat().replace("+00:00", "Z"), float(f[i_az]), float(f[i_el]),
                     float(f[i_dl]) * 1.495978707e11))
    return header, rows


def query(body, lat, lon, alt_m, start_utc=C.START_UTC, stop_utc=C.STOP_UTC, step_s=C.STEP_S):
    return parse(fetch(build_params(body, lat, lon, alt_m, start_utc, stop_utc, step_s)))


if __name__ == "__main__":
    s = C.SITES["Site01"]
    header, rows = query("sun", s["lat"], s["lon"], 0.0,
                         "2026-11-15T00:00:00Z", "2026-11-15T01:00:00Z")
    for l in header.splitlines():
        if any(k in l for k in ("Center", "Target body", "radii", "Step-size")):
            print(l)
    for r in rows:
        print(r)
