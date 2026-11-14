"""JSON writers that follow docs/data-contract.md (v1)."""
import json
from datetime import datetime, timezone

from . import config as C

VERSION = 1


def now_utc():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _r(xs, nd):
    return [round(float(x), nd) for x in xs]


def write(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {path.relative_to(C.ROOT)} ({path.stat().st_size/1e3:.0f} kB)")


def ephemeris_doc(site_id, source, sun_rows, earth_rows, start_utc=C.START_UTC, step_s=C.STEP_S):
    assert len(sun_rows) == len(earth_rows)
    assert sun_rows[0][0] == start_utc, (sun_rows[0][0], start_utc)

    def block(rows):
        return {"azDeg": _r((r[1] for r in rows), 4),
                "elDeg": _r((r[2] for r in rows), 4),
                "distanceM": _r((r[3] for r in rows), -3)}

    return {
        "version": VERSION, "siteId": site_id, "source": source, "generatedUtc": now_utc(),
        "settings": {"center": "coord@301", "refraction": False,
                     "observerHeightM": C.OBSERVER_HEIGHT_M, "frame": "MOON_ME"},
        "startUtc": start_utc, "stepS": step_s, "count": len(sun_rows),
        "sun": block(sun_rows), "earth": block(earth_rows),
    }


def horizon_doc(site_id, elev_deg, distance_m, params, warnings=()):
    return {"version": VERSION, "siteId": site_id, "azStepDeg": C.AZ_STEP_DEG,
            "count": len(elev_deg), "elevDeg": _r(elev_deg, 4), "distanceM": _r(distance_m, 0),
            "params": params, "warnings": list(warnings)}


def terrain_doc(site_id, z, size_m):
    n = z.shape[0]
    return {"version": VERSION, "siteId": site_id,
            "frame": "local ENU, origin at observer eye; x = east, y = north, z = up",
            "sizeM": size_m, "n": n, "cellM": round(size_m / n, 3),
            "zM": _r(z.ravel(), 1)}


def site_entry(site_id, surface_elev_m, warnings=()):
    s = C.SITES[site_id]
    return {"id": site_id, "name": s["name"], "latDeg": s["lat"], "lonDeg": s["lon"],
            "surfaceElevationM": round(float(surface_elev_m), 2),
            "observerHeightM": C.OBSERVER_HEIGHT_M, "coordSource": C.COORD_SOURCE,
            "demNear": f"LOLA 5 m/px {site_id} (Barker et al. 2021)",
            "demFar": "LDEM_80S_80MPP_ADJ (Barker et al. 2023)",
            "label": "Research region center - not a certified landing site",
            "warnings": list(warnings)}


def sites_doc(entries):
    return {"version": VERSION,
            "coverage": {"startUtc": C.START_UTC, "endUtc": C.STOP_UTC, "stepS": C.STEP_S},
            "sites": entries}
