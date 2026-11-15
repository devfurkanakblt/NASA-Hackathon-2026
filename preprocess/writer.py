"""JSON writers that follow docs/data-contract.md (v1)."""
import hashlib
import json
from datetime import datetime, timezone

from . import config as C

VERSION = 1


def now_utc():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _r(xs, nd):
    return [round(float(x), nd) for x in xs]


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def display_path(path):
    """Path relative to the repo root when inside it (log lines), else as given."""
    try:
        return path.relative_to(C.ROOT)
    except ValueError:
        return path


def write(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(obj, separators=(",", ":"), allow_nan=False)
    path.write_text(text, encoding="utf-8")
    print(f"wrote {display_path(path)} ({path.stat().st_size/1e3:.0f} kB)")


def ephemeris_doc(site_id, source, sun_rows, earth_rows, start_utc=C.START_UTC, step_s=C.STEP_S):
    assert len(sun_rows) == len(earth_rows)
    assert sun_rows[0][0] == start_utc, (sun_rows[0][0], start_utc)

    def block(rows):
        return {"azDeg": [v % 360 for v in _r((r[1] for r in rows), 4)],
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
    entry = {"id": site_id, "name": s["name"], "latDeg": s["lat"], "lonDeg": s["lon"],
            "surfaceElevationM": round(float(surface_elev_m), 2),
            "observerHeightM": C.OBSERVER_HEIGHT_M, "coordSource": C.COORD_SOURCE,
            "demNear": f"LOLA 5 m/px {C.tile_of(site_id)} (Barker et al. 2021)",
            "demFar": "LDEM_80S_80MPP_ADJ (Barker et al. 2023)",
            "label": "Research region center - not a certified landing site",
            "warnings": list(s.get("notes", [])) + list(warnings)}
    if s.get("dem") == "ldem64":
        from .global_dem import NAME
        entry["demNear"] = entry["demFar"] = NAME
        entry["coordSource"] = s["coordSource"]
        entry["label"] = "Contrast point outside the south polar region - educational comparison"
    if "category" in s:
        entry["category"] = s["category"]
    if s.get("dem") == "regional80":
        entry["demNear"] = entry["demFar"] = "LDEM_80S_80MPP_ADJ (80 m/px; no local 5 m tile)"
    if "coordSource" in s:
        entry["coordSource"] = s["coordSource"]
    if "label" in s:
        entry["label"] = s["label"]
    for key in ("mission", "program", "coordinateStatus", "regionSource", "aliases"):
        if key in s:
            entry[key] = s[key]
    if "derivedFrom" in s:
        entry["coordSource"] = f"Derived from {s['derivedFrom']} ({C.COORD_SOURCE})"
        entry["derivedFrom"] = s["derivedFrom"]
        entry["derivation"] = s["derivation"]
    return entry


def sites_doc(entries):
    return {"version": VERSION,
            "coverage": {"startUtc": C.START_UTC, "endUtc": C.STOP_UTC, "stepS": C.STEP_S},
            "sites": entries}
