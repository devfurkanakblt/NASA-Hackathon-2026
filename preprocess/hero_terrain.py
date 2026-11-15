"""Measured terrain for the home-page descent: LOLA heights and baked sunlight near Shackleton.

Two crops of NASA's LOLA south-polar DEM (LRO_LOLA_DEM_SPole75_30mp_v04, via Moon Trek), in
the product's own south polar stereographic grid (R = 1737.4 km, x towards 90° E, y towards 0°):

  near  64 km square, 31.25 m, covering Shackleton and the final flight corridor
  far   360 km square around the pole, ~352 m, for the mountains out to the horizon

For each crop this writes, to public/assets/hero/terrain/:
  *-height.bin   int16 heights (0.5 m units, relative to the 1737.4 km sphere), row 0 = north (max y)
  *-light.webp   baked sunlight, R = direct (sqrt of 2 * cos(incidence) * sun visibility),
                 G = sky-facing term (n . up), for the fixed scene sun of the descent
plus terrain.json with the grid geometry, the sun used and the source provenance.

Sun visibility is a ray march through the DEM towards the Sun with a 0.53° solar disc, so
shadows have their real penumbra. Heights are resampled only (no smoothing, no exaggeration).

    python -m preprocess.hero_terrain
"""

import hashlib
import io
import json
import math
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image

R = 1737400.0
PRODUCT = "LRO_LOLA_DEM_SPole75_30mp_v04"
SERVICE = f"https://trek.nasa.gov/moon/trekarcgis/rest/services/{PRODUCT}/ImageServer"
UA = {"User-Agent": "LunarSiteNavigator-preprocess/0.1"}

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data_raw" / "moontrek" / "hero"
OUT = ROOT / "public" / "assets" / "hero" / "terrain"

# Must match SUN_DIRECTION in src/app/hero/descentPath.ts: sub-solar point 1.5° S, 60° E.
SUN_LAT, SUN_LON = -1.5, 60.0
SUN_RADIUS_TAN = math.tan(math.radians(0.2665))

# name: centre (x, y) m, side m, source pixels, light-map sizes (desktop, mobile), mesh sizes
CROPS = {
    "near": dict(center=(10_100.0, -10_100.0), size=64_000.0, pixels=2048, light=(2048, 1024), mesh=(512, 256)),
    "far": dict(center=(0.0, 0.0), size=360_000.0, pixels=1024, light=(1024, 512), mesh=(256, 128)),
}


def sun_vector():
    la, lo = math.radians(SUN_LAT), math.radians(SUN_LON)
    return np.array([math.cos(la) * math.cos(lo), math.sin(la), -math.cos(la) * math.sin(lo)])


def fetch(name, crop):
    cx, cy = crop["center"]
    h = crop["size"] / 2
    bounds = (cx - h, cy - h, cx + h, cy + h)
    n = crop["pixels"]
    dest = CACHE / f"{PRODUCT}_{name}_{n}_{'_'.join(f'{b:.0f}' for b in bounds)}.tif"
    if not dest.exists():
        params = {"bbox": ",".join(f"{b:.3f}" for b in bounds), "size": f"{n},{n}", "format": "tiff",
                  "pixelType": "F32", "interpolation": "RSP_BilinearInterpolation", "f": "image"}
        request = urllib.request.Request(f"{SERVICE}/exportImage?{urllib.parse.urlencode(params)}", headers=UA)
        with urllib.request.urlopen(request, timeout=900) as response:
            body = response.read()
            if "tiff" not in response.headers.get("Content-Type", ""):
                raise IOError(f"Moon Trek returned {response.headers.get('Content-Type')}: {body[:200]!r}")
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(body)
        print(f"  downloaded {dest.name} ({len(body) / 1e6:.1f} MB)")
    z = np.array(Image.open(io.BytesIO(dest.read_bytes())), dtype=np.float32)
    if z.shape != (n, n) or not np.isfinite(z).all() or np.abs(z).max() > 20_000:
        raise IOError(f"{dest.name}: unexpected grid {z.shape} or no-data values")
    return z, bounds, hashlib.sha256(dest.read_bytes()).hexdigest()


class Grid:
    """Pixel-is-area grid in polar stereographic metres; row 0 at the top (max y)."""

    def __init__(self, z, bounds):
        self.z = z.astype(np.float64)
        self.left, self.bottom, self.right, self.top = bounds
        self.res = (self.right - self.left) / z.shape[1]

    def sample(self, x, y):
        fc = (x - self.left) / self.res - 0.5
        fr = (self.top - y) / self.res - 0.5
        n = self.z.shape[0]
        ok = (fc >= 0) & (fr >= 0) & (fc < n - 1) & (fr < n - 1)
        c0 = np.clip(np.floor(fc).astype(np.int64), 0, n - 2)
        r0 = np.clip(np.floor(fr).astype(np.int64), 0, n - 2)
        tc, tr = fc - c0, fr - r0
        z = self.z
        v = (z[r0, c0] * (1 - tc) * (1 - tr) + z[r0, c0 + 1] * tc * (1 - tr)
             + z[r0 + 1, c0] * (1 - tc) * tr + z[r0 + 1, c0 + 1] * tc * tr)
        return np.where(ok, v, np.nan)


def to_world(x, y, h):
    """Stereographic metres + height -> Moon-frame metres (+Y north, +X lon 0, -Z lon 90° E)."""
    rho = np.hypot(x, y)
    c = 2 * np.arctan(rho / (2 * R))  # angle from the south pole
    lam = np.arctan2(x, y)
    r = R + h
    return np.stack([r * np.sin(c) * np.cos(lam), -r * np.cos(c), -r * np.sin(c) * np.sin(lam)], axis=-1)


def to_map(p):
    r = np.linalg.norm(p, axis=-1)
    d = p / r[..., None]
    c = np.arccos(np.clip(-d[..., 1], -1, 1))
    lam = np.arctan2(-d[..., 2], d[..., 0])
    rho = 2 * R * np.tan(c / 2)
    return rho * np.sin(lam), rho * np.cos(lam), r - R


def light_block(x, y, step, grid, sample_all, sun):
    h = sample_all(x, y)
    h = np.where(np.isfinite(h), h, grid.sample(np.clip(x, grid.left + grid.res, grid.right - grid.res),
                                                np.clip(y, grid.bottom + grid.res, grid.top - grid.res)))
    d = step
    px = to_world(x + d, y, sample_all(x + d, y)) - to_world(x - d, y, sample_all(x - d, y))
    py = to_world(x, y + d, sample_all(x, y + d)) - to_world(x, y - d, sample_all(x, y - d))
    normal = np.cross(px, py)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    p = to_world(x, y, h)
    up = p / np.linalg.norm(p, axis=-1, keepdims=True)
    normal *= np.sign(np.sum(normal * up, axis=-1, keepdims=True))  # outward
    normal = np.where(np.isfinite(normal), normal, up)  # crop edge: no neighbour, keep it level
    mu0 = np.sum(normal * sun, axis=-1)
    sky = np.clip(np.sum(normal * up, axis=-1), 0, 1)

    # March towards the Sun: geometric steps from 0.6 texel out to 400 km.
    visible = np.full(x.shape, np.inf)
    start = p + up * 2.0
    for t in np.geomspace(step * 0.6, 400_000.0, 170):
        qx, qy, qh = to_map(start + sun * t)
        ground = sample_all(qx, qy)
        margin = (qh - ground) / (t * SUN_RADIUS_TAN + 1.0)  # in solar radii above the terrain
        visible = np.fmin(visible, np.where(np.isfinite(ground), margin, np.inf))
    vis = np.clip(0.5 + 0.5 * visible, 0, 1)
    return np.clip(mu0, 0, None) * vis, sky


def bake(name, grid, size, sample_all, sun):
    """Direct sunlight and sky-facing term at size x size texel centres of this crop."""
    step = (grid.right - grid.left) / size
    xs = grid.left + (np.arange(size) + 0.5) * step
    ys = grid.top - (np.arange(size) + 0.5) * step
    direct = np.zeros((size, size))
    sky = np.zeros((size, size))
    block = max(1, 262_144 // size)  # rows per pass, to bound memory
    for r0 in range(0, size, block):
        x, y = np.meshgrid(xs, ys[r0:r0 + block])
        direct[r0:r0 + block], sky[r0:r0 + block] = light_block(x, y, step, grid, sample_all, sun)
    print(f"  {name} {size}^2: lit fraction {np.mean(direct > 0.01):.2f}, mean sky {sky.mean():.3f}")
    rgb = np.zeros((size, size, 3), np.uint8)
    rgb[..., 0] = np.round(np.sqrt(np.clip(direct * 2, 0, 1)) * 255)
    rgb[..., 1] = np.round(sky * 255)
    return rgb


def block_mean(z, size):
    k = z.shape[0] // size
    return z[: size * k, : size * k].reshape(size, k, size, k).mean(axis=(1, 3))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    grids, meta = {}, {}
    for name, crop in CROPS.items():
        z, bounds, sha = fetch(name, crop)
        grids[name] = Grid(z, bounds)
        meta[name] = dict(bounds=list(bounds), sourcePixels=crop["pixels"], sourceSha256=sha,
                          minM=float(z.min()), maxM=float(z.max()))

    near, far = grids["near"], grids["far"]

    def sample_all(x, y):
        v = near.sample(x, y)
        return np.where(np.isfinite(v), v, far.sample(x, y))

    sun = sun_vector()
    for name, crop in CROPS.items():
        grid = grids[name]
        for suffix, light, mesh in (("", crop["light"][0], crop["mesh"][0]), ("-mobile", crop["light"][1], crop["mesh"][1])):
            Image.fromarray(bake(name, grid, light, sample_all, sun)).save(OUT / f"{name}{suffix}-light.webp", "WEBP", quality=88, method=6)
            heights = np.round(block_mean(grid.z, mesh) * 2).astype("<i2")
            (OUT / f"{name}{suffix}-height.bin").write_bytes(heights.tobytes())
            meta[name][f"mesh{suffix or '-desktop'}"] = mesh
            meta[name][f"light{suffix or '-desktop'}"] = light

    doc = {
        "version": 1,
        "frame": "south polar stereographic, R 1737400 m, x towards 90° E, y towards 0°; heights relative to the sphere",
        "heightEncoding": "int16 little-endian, 0.5 m units, row 0 = max y (north edge of the map), column 0 = min x",
        "lightEncoding": "R = sqrt(clamp(2 * max(n.sun, 0) * sunVisibility, 0, 1)); G = clamp(n.up, 0, 1)",
        "sun": {"subSolarLatDeg": SUN_LAT, "subSolarLonDeg": SUN_LON, "discRadiusDeg": 0.2665},
        "crops": meta,
        "source": {"product": PRODUCT, "service": SERVICE, "nativePixelM": 30, "interpolation": "bilinear",
                   "credit": "NASA/GSFC LOLA team; Moon Trek (NASA JPL)"},
        "limits": "Display only. Baked light is for one fixed scene sun, not a mission date.",
        "generatedUtc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    (OUT / "terrain.json").write_text(json.dumps(doc, indent=2))
    for f in sorted(OUT.iterdir()):
        print(f"  {f.relative_to(ROOT)}  {f.stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
