"""External comparison with published LOLA illumination products (plan P3).

Reference: Mazarico et al. (2011) method, PGDA "Lunar Polar Illumination" products
(https://pgda.gsfc.nasa.gov/products/69), 85S-90S, 60 m/px, 2016-08 release:
  AVGVISIB_85S_060M_201608.TIF        mean visible fraction of the solar disk, hourly, 18.6 years
  AVGVISIB_85S_060M_201608_EARTH.TIF  mean Earth visibility (visible if any part of the disk is unobscured)
  LPSR_85S_060M_201608.TIF            permanent shadow

Our side: the same horizon as horizon.json (ray marcher, 5 m + 80 m LOLA DEMs) and an independent
ephemeris (Skyfield + DE421, MOON_ME_DE421; agrees with Horizons to <= 0.00006 deg, validation.md §1)
over an 18.6-year window at 1-hour steps, using the product definitions above.

Not identical inputs: the products use an older 60 m DEM (2016), observer at the surface, and an
unstated 18.6-year window; we use 5 m DEMs near the site and an observer 2 m above the surface.
The comparison is therefore "same magnitude and same ranking", not a numerical identity test.

Usage: python -m preprocess.external     -> docs/validation.md §5 (appended / replaced)
"""
import json
from datetime import datetime, timedelta, timezone

import numpy as np
import rasterio

from . import config as C
from . import horizon as Hz
from . import visibility as V
from .dem import LONLAT, Dem, load_site_dems, surface_elevation, to_xy
from .validate import load

ILLUM = C.RAW_DIR / "illum"
PRODUCTS = {"sun": "AVGVISIB_85S_060M_201608", "earth": "AVGVISIB_85S_060M_201608_EARTH",
            "psr": "LPSR_85S_060M_201608"}
LT_START = "2009-07-13T00:00:00Z"
LT_YEARS = 18.6
LT_STEP_S = 3600
EARTH_RADIUS_M = 6_371_000.0
# Shackleton crater floor (centre of the crater, IAU Gazetteer: 89.67 S, 129.78 E)
SHACKLETON_FLOOR = dict(lat=-89.67, lon=129.78)


def product_values(name, lat, lon, half=1):
    """Pixel containing (lat, lon) and the min/max over the (2*half+1)^2 neighbourhood."""
    with rasterio.open(ILLUM / f"{PRODUCTS[name]}.TIF") as src:
        x, y = to_xy(src.crs, lon, lat)
        r, c = src.index(x, y)
        a = src.read(1, window=((r - half, r + half + 1), (c - half, c + half + 1))).astype(float)
        a = a * src.scales[0] + src.offsets[0]
    return float(a[half, half]), float(a.min()), float(a.max())


def long_term_series(lat, lon, eye):
    from . import ephemeris_skyfield as SF
    t0 = datetime.fromisoformat(LT_START.replace("Z", "+00:00"))
    stop = t0 + timedelta(days=LT_YEARS * 365.25)
    iso = lambda t: t.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")  # noqa: E731
    out = {}
    for b in ("sun", "earth"):
        rows = SF.query(b, lat, lon, eye, iso(t0), iso(stop), LT_STEP_S)
        out[b] = {"azDeg": np.array([r[1] for r in rows]), "elDeg": np.array([r[2] for r in rows]),
                  "distanceM": np.array([r[3] for r in rows])}
    return out


def ours(eph, hz):
    """Product definitions applied to our horizon: Sun = mean disk fraction (contract's linear
    approximation), Earth = any part of the disk above the horizon."""
    sun = float(V.sun_fraction(eph, hz).mean())
    r_e = np.degrees(np.arcsin(EARTH_RADIUS_M / eph["earth"]["distanceM"]))
    earth_any = float((V.margin(eph, hz, "earth") + r_e > 0).mean())
    earth_center = float(V.visible(eph, hz, "earth").mean())
    return sun, earth_any, earth_center


def site_rows(sites):
    rows = []
    for sid in sites:
        s = C.SITES[sid]
        hz = load(sid, "horizon.json")
        sites_json = json.loads((C.OUT_DIR / "sites.json").read_text(encoding="utf-8"))["sites"]
        e = next(x for x in sites_json if x["id"] == sid)
        eph = long_term_series(s["lat"], s["lon"], e["surfaceElevationM"] + e["observerHeightM"])
        sun, earth_any, earth_c = ours(eph, hz)
        ref_sun = product_values("sun", s["lat"], s["lon"])
        ref_earth = product_values("earth", s["lat"], s["lon"])
        rows.append(dict(site=sid, sun=sun, earth=earth_any, earth_center=earth_c,
                         ref_sun=ref_sun, ref_earth=ref_earth, n=len(eph["sun"]["elDeg"])))
        print(sid, f"sun {sun:.3f} vs {ref_sun[0]:.3f} [{ref_sun[1]:.3f}-{ref_sun[2]:.3f}]  "
                   f"earth {earth_any:.3f} vs {ref_earth[0]:.3f} [{ref_earth[1]:.3f}-{ref_earth[2]:.3f}]")
    return rows


def psr_check():
    """Our model must give zero direct sunlight on the Shackleton floor over 18.6 years."""
    p = SHACKLETON_FLOOR
    near = Dem.open(C.local_dem_path("Site04"))
    far = Dem.open(C.REGIONAL_DEM_PATH, center_xy=to_xy(near.crs, p["lon"], p["lat"]),
                   half_size_m=C.FAR_RANGE_M + 2_000)
    xy = to_xy(near.crs, p["lon"], p["lat"])
    z0, _ = surface_elevation(near, far, xy)
    eye = z0 + C.OBSERVER_HEIGHT_M
    elev, _, _ = Hz.compute(p["lat"], p["lon"], eye, near, far, near.crs)
    hz = {"elevDeg": elev, "azStepDeg": C.AZ_STEP_DEG, "count": elev.size}
    eph = long_term_series(p["lat"], p["lon"], eye)
    m = V.margin(eph, hz, "sun")
    frac = V.sun_fraction(eph, hz)
    return dict(z0=z0, max_margin=float(m.max()), lit_fraction=float((frac > 0).mean()),
                psr=product_values("psr", p["lat"], p["lon"]),
                avg=product_values("sun", p["lat"], p["lon"]), n=len(m))


def spearman(a, b):
    ra, rb = np.argsort(np.argsort(a)), np.argsort(np.argsort(b))
    return float(np.corrcoef(ra, rb)[0, 1])


def section(rows, psr):
    md = ["## 5. External comparison: LOLA polar illumination products (Mazarico et al.)", "",
          "Reference: PGDA *Lunar Polar Illumination* (https://pgda.gsfc.nasa.gov/products/69), "
          "85S-90S 60 m/px maps, release 2016-08: mean visible fraction of the solar disk "
          "(`AVGVISIB_85S_060M_201608`) and mean Earth visibility, Earth counted visible if any part "
          "of its disk is unobscured (`..._EARTH`), both hourly over 18.6 years (one lunar nutation cycle).",
          "",
          f"Ours: `horizon.json` of each site with an independent ephemeris (Skyfield/DE421) over "
          f"{LT_YEARS} years from {LT_START[:10]}, {LT_STEP_S // 60}-minute steps, with the same two "
          "definitions. Reference columns show the 60 m pixel containing the site and the min-max of "
          "its 3x3 neighbourhood (180 m), which indicates how fast the value changes nearby.", "",
          "| Site | Ours: Sun disk mean | Product: Sun (3x3 range) | Ours: Earth (any part) | "
          "Product: Earth (3x3 range) | Ours: Earth (centre rule) |",
          "|---|---|---|---|---|---|"]
    for r in rows:
        md.append(f"| {r['site']} | {r['sun']:.3f} | {r['ref_sun'][0]:.3f} ({r['ref_sun'][1]:.3f}-"
                  f"{r['ref_sun'][2]:.3f}) | {r['earth']:.3f} | {r['ref_earth'][0]:.3f} "
                  f"({r['ref_earth'][1]:.3f}-{r['ref_earth'][2]:.3f}) | {r['earth_center']:.3f} |")
    if len(rows) >= 3:
        rs = spearman([r["sun"] for r in rows], [r["ref_sun"][0] for r in rows])
        re = spearman([r["earth"] for r in rows], [r["ref_earth"][0] for r in rows])
        md += ["", f"Rank correlation (Spearman) over {len(rows)} sites: Sun {rs:.2f}, Earth {re:.2f}."]
    dsun = [abs(r["sun"] - r["ref_sun"][0]) for r in rows]
    inrange = sum(r["ref_sun"][1] - 0.02 <= r["sun"] <= r["ref_sun"][2] + 0.02 for r in rows)
    md += [f"Largest Sun difference: {max(dsun):.3f}; ours within the 3x3 range (+-0.02) at "
           f"{inrange} of {len(rows)} sites.", "",
           "Expected differences: the products use the 2016 60 m DEM and an observer on the surface; "
           "we use the 5 m site DEMs (Barker et al. 2021) near the site and an observer 2 m above it. "
           "On ridges and crater rims the value changes by tens of percent within one 60 m pixel "
           "(see the 3x3 range), so agreement in magnitude and ranking is the meaningful test.", "",
           "### Permanent shadow: Shackleton crater floor", "",
           f"Point {SHACKLETON_FLOOR['lat']}, {SHACKLETON_FLOOR['lon']} (crater centre), surface "
           f"{psr['z0']:.0f} m. Our horizon from that point and {psr['n']} hourly Sun positions over "
           f"{LT_YEARS} years: highest Sun centre above the terrain horizon {psr['max_margin']:+.2f} deg, "
           f"fraction of hours with any part of the disk above the horizon {psr['lit_fraction']:.4f}. "
           f"Products at the same pixel: LPSR {psr['psr'][0]:.2f}, AVGVISIB {psr['avg'][0]:.3f}. "
           f"{'Both agree: permanently shadowed.' if psr['lit_fraction'] == 0 and psr['avg'][0] < 0.01 else 'See values.'}",
           ""]
    return md


def write_section(md):
    path = C.ROOT / "docs" / "validation.md"
    text = path.read_text(encoding="utf-8")
    head = "## 5. External comparison"
    if head in text:
        i = text.index(head)
        j = text.find("\n## ", i + 1)
        tail = text[j + 1:] if j != -1 else ""
        text = text[:i] + tail
    footer = "Pixel size and these numerical checks"
    k = text.find(footer)
    block = "\n".join(md) + "\n"
    text = text[:k] + block + text[k:] if k != -1 else text + "\n" + block
    path.write_text(text, encoding="utf-8")
    print(f"updated {path.relative_to(C.ROOT)}")


def main(sites=None):
    sites = sites or [s for s in C.SITES if (C.OUT_DIR / s / "horizon.json").exists()
                      and C.SITES[s]["lat"] <= -85.0]  # product covers 85S-90S
    rows = site_rows(sites)
    psr = psr_check()
    print("PSR", psr)
    write_section(section(rows, psr))


if __name__ == "__main__":
    import sys
    main(sys.argv[1:] or None)
