"""Global DEM tiles for free coordinates in the browser (D).

Source: the project's global DEM, LOLA LDEM_64 (PDS LRO-L-LOLA-4-GDR-V1.0, 64 px/deg, ~474 m/px,
int16 LSB, height = DN * 0.5 m above R = 1737.4 km, simple cylindrical, line 1 at 90 N, sample 1
at 0 E). The whole file is read with HTTP range requests in 64-line parts, cached in
data_raw/global/ with the same part names as preprocess/global_dem.py (so either tool reuses
them), and written as square int16 tiles under public/data/global-dem/.

By default the tiles are the 4 x 4 block mean of LDEM_64 (16 px/deg, ~1.9 km/px, ~33 MB in all):
the full 64 px/deg grid is ~530 MB, too large to publish with the web app. `--ppd 64` writes the
full resolution if a deployment can carry it. The browser labels results computed from these
tiles as a "global screening estimate"; they never replace a catalogue horizon.

Usage: python -m preprocess.global_tiles [--ppd 16] [--tile-deg 30]
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import time
import urllib.request

import numpy as np

from . import config as C

URL = ("https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/"
       "cylindrical/img/ldem_64.img")
SRC_PPD = 64
LINES, SAMPLES = 11520, 23040
RECORD_BYTES = SAMPLES * 2
SCALE = 0.5
PART = 64
CACHE = C.RAW_DIR / "global"
OUT = C.ROOT / "public" / "data" / "global-dem"
UA = "LunarSiteNavigator-preprocess/0.1"


def part(row):
    """LDEM_64 lines [row, row + 64) as int16, from the cache or one range request."""
    end = min(row + PART, LINES)
    path = CACHE / f"ldem64_part_{row}_{end}.bin"
    expected = (end - row) * RECORD_BYTES
    if not (path.exists() and path.stat().st_size == expected):
        rng = f"bytes={row * RECORD_BYTES}-{end * RECORD_BYTES - 1}"
        for attempt in range(5):
            try:
                req = urllib.request.Request(URL, headers={"User-Agent": UA, "Range": rng})
                with urllib.request.urlopen(req, timeout=120) as r:
                    data = r.read()
                    if r.status != 206 or len(data) != expected or not r.headers.get("Content-Range", "").startswith(f"bytes {row * RECORD_BYTES}-"):
                        raise IOError(f"range request failed ({r.status}, {len(data)} bytes)")
                break
            except Exception as exc:  # noqa: BLE001 - retried, then re-raised
                if attempt == 4:
                    raise
                print(f"retry lines {row}..{end}: {exc}", flush=True)
                time.sleep(3 * (attempt + 1))
        CACHE.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_bytes(data)
        tmp.replace(path)
    return np.frombuffer(path.read_bytes(), dtype="<i2").reshape(end - row, SAMPLES)


def build(ppd, tile_deg):
    if SRC_PPD % ppd:
        raise SystemExit("--ppd must divide 64")
    k = SRC_PPD // ppd
    rows, cols = LINES // k, SAMPLES // k
    tile = tile_deg * ppd
    if rows % tile or cols % tile:
        raise SystemExit("--tile-deg must divide 180")
    grid = np.empty((rows, cols), dtype="<i2")
    # fetch the parts a few at a time (cached; the averaging below reads them back in order)
    with ThreadPoolExecutor(max_workers=6) as pool:
        for i, _ in enumerate(pool.map(lambda r: part(r) is not None, range(0, LINES, PART))):
            if i % 10 == 0:
                print(f"LDEM_64 part {i + 1} / {LINES // PART}", flush=True)
    for row in range(0, LINES, PART):
        z = part(row).astype(np.float64)
        n = z.shape[0] // k
        # k x k block mean, in DN (0.5 m) units, rounded back to int16
        block = z[: n * k].reshape(n, k, cols, k).mean(axis=(1, 3))
        grid[row // k: row // k + n] = np.rint(block).astype("<i2")
        print(f"LDEM_64 lines {row}..{min(row + PART, LINES)} / {LINES}", flush=True)
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("t_*.bin"):
        old.unlink()
    tiles = {}
    for r0 in range(0, rows, tile):
        for c0 in range(0, cols, tile):
            name = f"t_{r0 // tile}_{c0 // tile}.bin"
            data = np.ascontiguousarray(grid[r0:r0 + tile, c0:c0 + tile]).tobytes()
            (OUT / name).write_bytes(data)
            tiles[name] = {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}
    manifest = {
        "version": 1,
        "kind": "global-dem-tiles",
        "source": "LOLA LDEM_64 (PDS LRO-L-LOLA-4-GDR-V1.0), 64 px/deg, ~474 m/px",
        "sourceUrl": URL,
        "method": f"{k} x {k} block mean of LDEM_64" if k > 1 else "LDEM_64 as published",
        "ppd": ppd,
        "pixelM": round(np.radians(1 / ppd) * C.MOON_RADIUS_M, 1),
        "scaleM": SCALE,
        "radiusM": C.MOON_RADIUS_M,
        "rows": rows,
        "cols": cols,
        "tileDeg": tile_deg,
        "tilePx": tile,
        "layout": "int16 little-endian, row-major; row 0 centre at 90 - 0.5/ppd deg N, col 0 centre at 0.5/ppd deg E; "
                  "tile t_<r>_<c> holds rows [r*tilePx, (r+1)*tilePx) and cols [c*tilePx, (c+1)*tilePx); height = value * scaleM above radiusM",
        "tiles": tiles,
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    print(f"wrote {len(tiles)} tiles ({sum(t['bytes'] for t in tiles.values()) / 1e6:.1f} MB) to {OUT}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ppd", type=int, default=16, choices=[4, 8, 16, 32, 64])
    ap.add_argument("--tile-deg", type=int, default=30)
    a = ap.parse_args()
    build(a.ppd, a.tile_deg)


if __name__ == "__main__":
    main()
