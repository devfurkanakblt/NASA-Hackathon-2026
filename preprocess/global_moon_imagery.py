"""A real georegistered LROC WAC global locator texture; no procedural surface fill.

Run ``python -m preprocess.global_moon_imagery --cache-dir data_raw/global-moon``.
The served JPEG is archival photography, not albedo or mission-time illumination.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET

import numpy as np
import requests
from PIL import Image, __version__ as pillow_version
from pyproj import CRS
from rasterio.io import MemoryFile

from . import config as C

WMS = "https://wms.im-ldi.com/"
LAYER = "luna_wac_global"
UA = {"User-Agent": "LunarSiteNavigator-global-photographic-display/1.0"}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def capabilities(cache: Path):
    path = cache / "capabilities.xml"
    query = {"SERVICE": "WMS", "VERSION": "1.1.1", "REQUEST": "GetCapabilities"}
    if not path.exists():
        response = requests.get(WMS, params=query, headers=UA, timeout=(20, 120))
        response.raise_for_status()
        path.write_bytes(response.content)
    raw = path.read_bytes()
    root = ET.fromstring(raw)
    supported = [e.text for e in root.iter() if e.tag in ("SRS", "CRS")]
    if "IAU2000:30100" not in supported:
        raise ValueError("LROC capabilities do not advertise lunar geographic coordinates")
    for layer in root.iter("Layer"):
        if layer.findtext("Name") == LAYER:
            bbox = layer.find("LatLonBoundingBox")
            if bbox is None or [float(bbox.get(k)) for k in ("minx", "miny", "maxx", "maxy")] != [-180, -90, 180, 90]:
                raise ValueError("LROC layer does not advertise the complete globe")
            abstract = layer.findtext("Abstract") or ""
            return {"url": WMS, "query": query, "sha256": sha256(raw),
                    "title": layer.findtext("Title"), "abstractSha256": sha256(abstract.encode()),
                    "metadataSummary": "WAC global mosaic combines observations from November 2009 to February 2011; polar and equatorial source products have different illumination and brightness."}
    raise ValueError("The requested LROC photographic layer is not advertised")


def validate_raster(src, width: int):
    if src.width != width or src.height != width // 2 or src.count != 2 or src.dtypes != ("uint8", "uint8"):
        raise ValueError("Expected a 2:1 gray+alpha byte raster")
    crs = CRS.from_user_input(src.crs)
    if not crs.is_geographic or abs(crs.ellipsoid.semi_major_metre - C.MOON_RADIUS_M) > .01 or abs(crs.ellipsoid.semi_minor_metre - C.MOON_RADIUS_M) > .01:
        raise ValueError("Returned global image is not on the lunar geographic sphere")
    expected = np.array([360 / width, 0, -180, 0, -180 / (width // 2), 90])
    if not np.allclose(np.array(list(src.transform)[:6]), expected, rtol=0, atol=1e-9):
        raise ValueError("Returned WMS image does not cover longitude -180..180, north first")
    if not np.all(src.read(2) == 255):
        raise ValueError("Global WAC image has missing coverage: refuse synthetic JPEG fill")


def build(cache: Path, width: int = 4096):
    if width not in (2048, 4096):
        raise ValueError("Supported locator widths: 2048 or 4096")
    cache.mkdir(parents=True, exist_ok=True)
    caps = capabilities(cache)
    query = {"SERVICE": "WMS", "VERSION": "1.1.1", "REQUEST": "GetMap", "LAYERS": LAYER,
             "STYLES": "", "SRS": "IAU2000:30100", "BBOX": "-180,-90,180,90",
             "WIDTH": str(width), "HEIGHT": str(width // 2), "FORMAT": "image/tiff", "TRANSPARENT": "TRUE"}
    path = cache / f"wac-global-{width}x{width//2}.tif"
    if not path.exists():
        response = requests.get(WMS, params=query, headers=UA, timeout=(20, 240))
        response.raise_for_status()
        if response.content[:2] not in (b"II", b"MM"):
            raise ValueError("LROC WMS returned a service exception rather than a GeoTIFF")
        partial = path.with_suffix(".tif.part")
        partial.write_bytes(response.content)
        partial.replace(path)
    raw = path.read_bytes()
    with MemoryFile(raw) as memory:
        with memory.open() as src:
            validate_raster(src, width)
            pixels = src.read(1)
            source = {"url": WMS, "query": query, "sha256": sha256(raw), "bytes": len(raw),
                      "crs": src.crs.to_wkt(), "transform": list(src.transform)[:6],
                      "validCoverageFraction": 1.0, "nativePixelM": 100,
                      "equatorialOutputPixelM": float(2 * np.pi * C.MOON_RADIUS_M / width)}
    output = C.ROOT / "public" / "assets" / "moon-lroc-wac.jpg"
    output.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(pixels).convert("RGB").save(output, format="JPEG", quality=95, subsampling=0, optimize=True)
    doc = {"version": 1, "file": output.name, "sha256": sha256(output.read_bytes()), "width": width, "height": width // 2,
           "projection": "equirectangular longitude/latitude; west=-180 east=180 north=90 south=-90; row 0 north",
           "sphereAxes": "+X longitude 0; +Y north pole; -Z longitude +90 east; Three sphere u=(longitude+180)/360",
           "archiveShadows": True, "source": source, "capabilities": caps,
           "credit": "NASA/GSFC/Arizona State University, Lunar Reconnaissance Orbiter Camera (LROC) team",
           "derivative": f"Pillow {pillow_version}; source gray byte band to RGB JPEG quality95 subsampling0 optimize; no contrast stretch, noise, fill or generated craters",
           "limitations": ["Archival WAC mosaic acquired November 2009-February 2011, not selected mission UTC or live illumination",
                           "Baked shadows and polar/equatorial brightness seams are present in the source mosaic",
                           "Source native pixel spacing is 100 m; this global locator derivative is about 2.67 km per pixel at the equator at width4096",
                           "The global locator uses a sphere, not a terrain mesh; close views use the separate measured local scene",
                           "A photograph is not a height map or calibrated albedo; it is not used for bump mapping or scientific calculations"]}
    manifest = output.with_suffix(".json")
    manifest.write_text(json.dumps(doc, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
    print(f"{output.name}: {output.stat().st_size} bytes, sha256 {doc['sha256']}", flush=True)
    return doc


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-dir", type=Path, default=C.RAW_DIR / "global-moon")
    parser.add_argument("--width", type=int, default=4096)
    args = parser.parse_args(argv)
    build(args.cache_dir, args.width)


if __name__ == "__main__":
    main()
