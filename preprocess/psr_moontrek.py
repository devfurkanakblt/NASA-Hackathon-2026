"""South-pole permanently shadowed regions (PSRs) from NASA Moon Trek, for the research view.

Source: the `PSR_SP` layer of NASA Moon Trek (https://trek.nasa.gov/moon/), a NASA resource
listed for the challenge. It holds 164 south-pole PSRs of at least 10 km2, each with a
centroid, an area and the nearest named lunar features. Only those attributes are kept.
The layer gives no outlines, so the app treats each PSR as a circle of the same area around
its centroid when it measures the distance to the nearest PSR edge (an approximation).

Output: public/data/psr-south.json
Usage: python -m preprocess.psr_moontrek
This script was written with AI assistance (Anthropic Claude).
"""
import json
import sys
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import requests

from preprocess import config as C
from preprocess import writer as W

SERVICE = "https://trek.nasa.gov/moon/trekarcgis/rest/services/PSR_SP/MapServer/0"
UA = {"User-Agent": "LunarSiteNavigator-preprocess/0.1"}


def main():
    r = requests.get(f"{SERVICE}/query", headers=UA, timeout=120,
                     params={"where": "1=1", "outFields": "*", "returnGeometry": "false", "f": "json"})
    r.raise_for_status()
    features = [f["attributes"] for f in r.json()["features"]]
    psrs = []
    for a in features:
        lon = a["Cent__Long"] % 360
        psrs.append({"id": a["PSR_ID"], "name": (a.get("Lunar_Feat") or "").strip() or None,
                     "latDeg": round(a["Cent__Lat_"], 4), "lonDeg": round(lon - 360 if lon > 180 else lon, 4),
                     "areaKm2": round(a["Area__km2_"], 3)})
    psrs.sort(key=lambda p: p["latDeg"])
    doc = {"version": 1, "generatedUtc": W.now_utc(),
           "source": {"name": "NASA Moon Trek, layer PSR_SP (south-pole permanently shadowed regions)",
                      "service": SERVICE, "count": len(psrs),
                      "fields": "PSR_ID, centroid latitude/longitude, area (km2), nearest named feature"},
           "note": "PSRs of at least 10 km2 only. No outlines: distances to a PSR edge use a circle of equal area "
                   "around the centroid. Longitudes east-positive.",
           "psrs": psrs}
    W.write(C.OUT_DIR / "psr-south.json", doc)
    print(f"{len(psrs)} PSRs, {sum(p['areaKm2'] for p in psrs):.0f} km2 in total")


if __name__ == "__main__":
    main()
