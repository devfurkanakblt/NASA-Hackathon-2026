"""Portable scientific package manifest for B/D import (no UI or service assumptions)."""
import json
from . import writer as W

FILES = ("site.json", "horizon.json", "terrain.json", "ephemeris.json", "year.bin", "extended.json")


def write_manifest(root):
    site = json.loads((root / "site.json").read_text(encoding="utf-8"))
    ext = json.loads((root / "extended.json").read_text(encoding="utf-8"))
    eph = json.loads((root / "ephemeris.json").read_text(encoding="utf-8"))
    hz = json.loads((root / "horizon.json").read_text(encoding="utf-8"))
    eye = site["surfaceElevationM"] + site["observerHeightM"]
    observer = ext["year"]["observer"]
    if (observer["latDeg"], observer["lonDeg"]) != (site["latDeg"], site["lonDeg"]) or abs(observer["eyeM"] - eye) > .011:
        raise ValueError("Package observer differs between site.json and extended.json")
    if any(abs(hz.get("observer", {}).get(k, float("inf")) - v) > 1e-8 for k, v in observer.items()):
        raise ValueError("Package horizon observer differs from extended.json")
    doc = {"version": 1, "kind": "lunar-scientific-package", "siteId": site["id"],
           "observer": observer, "coverage": {k: ext["year"][k] for k in ("startUtc", "endUtc", "stepS", "count")},
           "ephemeris": {k: eph[k] for k in ("startUtc", "stepS", "count", "source")},
           "horizonResolutionDeg": hz["azStepDeg"],
           "warnings": list(site["warnings"]) + list(hz.get("warnings", [])),
           "files": {name: {"sha256": W.sha256_file(root / name), "bytes": (root / name).stat().st_size} for name in FILES}}
    W.write(root / "package.json", doc)
    return doc
