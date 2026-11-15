"""C display normals derived from the measured NASA LOLA 5 m surface DEMs.

No procedural grain, craters or albedo is generated. The PNG is a linear-data
object-space normal map in Three scene axes (+east, +up, -north), not a photo.
The scientific horizon, terrain.json, site catalogue and ephemeris are untouched.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

import numpy as np
import rasterio
import requests
from PIL import Image
from pyproj import Transformer

from . import config as C
from .dem import Dem, LONLAT
from .terrain import enu_to_lonlat

FRAME = "Three object normal (+east,+up,-north)"
UA = {"User-Agent": "LunarSiteNavigator-display/1.0"}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fetch_tile(tile_id: str, raw_dir: Path, download: bool = True) -> tuple[Path, str]:
    if not re.fullmatch(r"Site\d+", tile_id):
        raise ValueError("Unsafe or unsupported LOLA 5 m tile ID")
    url = f"{C.PGDA}/LOLA_5mpp/{tile_id}/{tile_id}_final_adj_5mpp_surf.tif"
    path = raw_dir / "dem" / f"{tile_id}_final_adj_5mpp_surf.tif"
    if not path.exists():
        if not download:
            raise FileNotFoundError(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        partial = path.with_suffix(".tif.part")
        head = requests.head(url, headers=UA, timeout=30, allow_redirects=True)
        head.raise_for_status()
        total = int(head.headers["Content-Length"])
        # Small resumable ranges avoid losing a whole tile to an idle connection.
        start = partial.stat().st_size if partial.exists() else 0
        if start > total:
            raise ValueError("Partial download exceeds source content length")
        while start < total:
            end = min(total, start + 2 * 1024 * 1024) - 1
            error = None
            for attempt in range(4):
                try:
                    response = requests.get(url, headers={**UA, "Range": f"bytes={start}-{end}"}, timeout=(20, 40))
                    response.raise_for_status()
                    if response.status_code != 206 or response.headers.get("Content-Range") != f"bytes {start}-{end}/{total}":
                        raise ValueError("Source did not honor exact byte range")
                    if len(response.content) != end - start + 1:
                        raise ValueError("Incomplete source byte range")
                    with partial.open("ab") as target:
                        target.write(response.content)
                    error = None
                    break
                except requests.RequestException as exc:
                    error = exc
            if error is not None:
                raise error
            start = end + 1
        partial.replace(path)
    return path, url


def local_heights(site: dict, dem: Dem, n: int = 1024, size_m: float = 10_000,
                  oversample: int = 2, chunk_rows: int = 32) -> np.ndarray:
    """Pixel-area means, row 0 south, including the same ENU curvature as terrain.json.

    Sampling is chunked rather than constructing a multi-million point ECEF
    matrix. Missing native DEM coverage is an error, never synthetic fill.
    """
    if n < 3 or oversample < 1 or chunk_rows < 1 or not np.isfinite(size_m) or size_m <= 0:
        raise ValueError("Invalid display grid")
    m = n * oversample
    step = size_m / m
    centres = -size_m / 2 + (np.arange(m) + .5) * step
    transform = Transformer.from_crs(LONLAT, dem.crs, always_xy=True)
    eye = site["surfaceElevationM"] + site["observerHeightM"]
    out = np.empty((n, n), dtype=np.float64)
    for start in range(0, n, chunk_rows):
        end = min(n, start + chunk_rows)
        east, north = np.meshgrid(centres, centres[start * oversample:end * oversample])
        lon, lat, theta = enu_to_lonlat(site["latDeg"], site["lonDeg"], east, north)
        x, y = transform.transform(lon, lat)
        heights = dem.sample(x, y)
        if not np.isfinite(heights).all() or (np.abs(heights) > 20_000).any():
            raise ValueError(f"{site['id']}: native 5 m DEM does not cover the entire normal-map patch")
        z = (C.MOON_RADIUS_M + heights) * np.cos(theta) - (C.MOON_RADIUS_M + eye)
        out[start:end] = z.reshape(end - start, oversample, n, oversample).mean(axis=(1, 3))
    return out


def object_normals(z: np.ndarray, cell_m: float) -> np.ndarray:
    """Unit normals in Three (+east,+up,-north); z rows increase northward.

    surface(E,N)=(E,z(E,N),-N), so upward n=(-dz/dE,1,+dz/dN).
    """
    z = np.asarray(z, dtype=np.float64)
    if z.ndim != 2 or min(z.shape) < 3 or not np.isfinite(z).all() or not np.isfinite(cell_m) or cell_m <= 0:
        raise ValueError("Normals require a finite height grid and positive cell spacing")
    dn, de = np.gradient(z, cell_m, cell_m, edge_order=2)
    normal = np.stack((-de, np.ones_like(z), dn), axis=-1)
    return normal / np.linalg.norm(normal, axis=-1, keepdims=True)


def covered_heights(site: dict, dem: Dem, n: int, requested_size_m: float, oversample: int):
    """Largest tested centred square with complete native sampling coverage.

    A derived ridge point can be offset inside its parent tile. Smaller measured
    coverage is reported honestly rather than filling missing detail from a coarse DEM.
    """
    last_error = None
    for ratio in (1., .9, .8, .7, .6):
        size = requested_size_m * ratio
        try:
            return local_heights(site, dem, n, size, oversample), size
        except ValueError as error:
            if "native 5 m DEM does not cover" not in str(error):
                raise
            last_error = error
    raise last_error


def encode_normals(normals: np.ndarray) -> tuple[np.ndarray, float]:
    """RGB8 linear UNORM. PNG top is north; uploader uses flipY=true.

    Root renders u=east/size+.5, v=north/size+.5 with ObjectSpaceNormalMap.
    RGB are data and must NOT have an sRGB/gamma colour transform.
    """
    normals = np.asarray(normals, dtype=np.float64)
    if normals.ndim != 3 or normals.shape[2] != 3 or not np.isfinite(normals).all():
        raise ValueError("Invalid object normals")
    if not np.allclose(np.linalg.norm(normals, axis=-1), 1, atol=1e-6):
        raise ValueError("Normals must be unit length")
    rgb = np.clip(np.rint((normals + 1) * 127.5), 0, 255).astype(np.uint8)
    decoded = rgb.astype(np.float64) / 127.5 - 1
    decoded /= np.linalg.norm(decoded, axis=-1, keepdims=True)
    dots = np.clip(np.sum(normals * decoded, axis=-1), -1, 1)
    max_error_deg = float(np.degrees(np.arccos(dots)).max())
    return np.ascontiguousarray(rgb[::-1]), max_error_deg


def build_site(site: dict, raw_dir: Path, data_dir: Path, n: int = 1024,
               size_m: float = 10_000, oversample: int = 2, download: bool = True):
    sid = site["id"]
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*", sid):
        raise ValueError("Unsafe site ID")
    if site.get("category") == "contrast":
        return None  # The 474 m global DEM cannot supply extra 5 m detail.
    tile = site.get("derivedFrom") or C.tile_of(sid)
    path, url = fetch_tile(tile, raw_dir, download)
    with rasterio.open(path) as src:
        if src.crs is None or not np.allclose(src.res, (5, 5), atol=1e-6):
            raise ValueError(f"{sid}: expected georeferenced 5 m square source pixels")
        source = {"url": url, "tileId": tile, "sha256": sha256(path),
                  "crs": src.crs.to_wkt(), "transform": list(src.transform)[:6],
                  "dimensions": [src.width, src.height]}
    dem = Dem.open(path)
    requested_size_m = size_m
    z, size_m = covered_heights(site, dem, n, requested_size_m, oversample)
    if size_m / n < 5:
        raise ValueError("Output normal pixels must not be smaller than the 5 m source pixels; reduce --n")
    pixels, error = encode_normals(object_normals(z, size_m / n))
    directory = data_dir / sid
    directory.mkdir(parents=True, exist_ok=True)
    image_path = directory / "terrain-normal.png"
    image_partial = image_path.with_suffix(".png.part")
    Image.fromarray(pixels).save(image_partial, format="PNG", optimize=True)
    image_partial.replace(image_path)
    source.update({"site": {"latitudeDeg": site["latDeg"], "longitudeDeg": site["lonDeg"],
                            "surfaceElevationM": site["surfaceElevationM"], "observerHeightM": site["observerHeightM"]},
                   "method": f"Bilinear native-DEM sampling, {oversample}x{oversample} area mean per output pixel; local ENU curvature; second-order finite gradients; normalised object normals",
                   "pngOrientation": "north at top; east at right; texture.flipY=true",
                   "encoding": "RGB8 linear UNORM: component=2*channel/255-1; no colour transfer",
                   "uv": "u=east/sizeM+0.5; v=north/sizeM+0.5",
                   "heightReference": "same 1737400 m sphere and observer-eye ENU origin as terrain.json",
                   "requestedSizeM": requested_size_m,
                   "coverageStrategy": "Largest fully covered centred square among requested width x [1,.9,.8,.7,.6]; no native-data gap fill",
                   "maxEncodingAngularErrorDeg": error,
                   "limitations": ["Display shading only; geometry and scientific horizon unchanged",
                                   "Source pixel spacing is not absolute elevation accuracy",
                                   "Output is a normal-data map, not measured albedo or a surface photograph",
                                   "No noise, invented craters or procedural detail added"]})
    manifest = {"version": 1, "siteId": sid, "file": image_path.name, "sizeM": size_m,
                "n": n, "frame": FRAME, "sourceNativePixelM": 5,
                "outputPixelM": size_m / n, "sha256": sha256(image_path), "source": source}
    manifest_path = directory / "terrain-normal.json"
    manifest_partial = manifest_path.with_suffix(".json.part")
    manifest_partial.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    manifest_partial.replace(manifest_path)
    print(f"{sid}: {n}x{n} over {size_m:g} m, {image_path.stat().st_size} bytes, encoding error {error:.4f} deg", flush=True)
    return manifest


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("site_ids", nargs="*")
    parser.add_argument("--raw-dir", type=Path, default=C.RAW_DIR)
    parser.add_argument("--data-dir", type=Path, default=C.OUT_DIR)
    parser.add_argument("--n", type=int, default=1024)
    parser.add_argument("--oversample", type=int, default=2)
    parser.add_argument("--no-download", action="store_true")
    args = parser.parse_args(argv)
    sites = json.loads((args.data_dir / "sites.json").read_text(encoding="utf-8"))["sites"]
    ids = {s["id"] for s in sites}
    if set(args.site_ids) - ids:
        raise ValueError("Unknown catalogue site")
    for site in sites:
        if not args.site_ids or site["id"] in args.site_ids:
            build_site(site, args.raw_dir, args.data_dir, n=args.n, oversample=args.oversample,
                       download=not args.no_download)


if __name__ == "__main__":
    main()
