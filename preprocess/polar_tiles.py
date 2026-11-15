"""South-polar 80 m DEM tiles for free coordinates in the browser (D).

Source: LOLA LDEM_80S_80MPP_ADJ (Barker et al. 2023, PGDA), the regional DEM the catalogue already
uses (`C.REGIONAL_DEM_PATH`): 7600 x 7600 float32, 80 m pixels, south polar stereographic on the
1737.4 km sphere (+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0), pixel-is-area, centre of pixel (r, c)
at x = -304000 + (c + 0.5) * 80, y = 304000 - (r + 0.5) * 80.

Written to public/data/polar-dem/:
- `n_<r>_<c>.bin.gz`: the 80 m grid in 256 x 256 tiles (near field of a point);
- `far.bin.gz`: the 8 x 8 block mean (640 m, 950 x 950) for the far field out to 250 km;
both int16 heights in 0.5 m above 1737.4 km (-32768 = no data), row-major, each row delta-encoded
(first value as is, then differences) and gzip-compressed. `manifest.json` holds the geometry and the
SHA-256 of every file as published.

Usage: python -m preprocess.polar_tiles
"""
import gzip
import hashlib
import json

import numpy as np
import rasterio

from . import config as C

OUT = C.ROOT / "public" / "data" / "polar-dem"
SCALE = 0.5
NODATA = -32768
TILE = 256
FAR_K = 8


def encode(a):
    """int16 rows, delta-encoded, gzip (deterministic: mtime 0)."""
    d = np.diff(a.astype(np.int32), axis=1, prepend=0).astype("<i2")
    return gzip.compress(d.tobytes(), compresslevel=9, mtime=0)


def quantize(z):
    q = np.where(np.isnan(z), NODATA, np.rint(z / SCALE))
    if np.nanmax(np.abs(q[q != NODATA])) >= 32767:
        raise ValueError("height out of int16 range")
    return q.astype("<i2")


def main():
    with rasterio.open(C.REGIONAL_DEM_PATH) as src:
        z = src.read(1).astype(np.float64)
        t = src.transform
        assert abs(t.a - 80) < 1e-9 and abs(t.e + 80) < 1e-9, "unexpected pixel size"
        left, top, res = t.c, t.f, t.a
    rows, cols = z.shape
    OUT.mkdir(parents=True, exist_ok=True)
    for old in list(OUT.glob("*.bin.gz")):
        old.unlink()
    files = {}
    q = quantize(z)
    for r0 in range(0, rows, TILE):
        for c0 in range(0, cols, TILE):
            tile = np.full((TILE, TILE), NODATA, dtype="<i2")
            part = q[r0:r0 + TILE, c0:c0 + TILE]
            tile[:part.shape[0], :part.shape[1]] = part
            if (tile == NODATA).all():
                continue
            name = f"n_{r0 // TILE}_{c0 // TILE}.bin.gz"
            data = encode(tile)
            (OUT / name).write_bytes(data)
            files[name] = {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}
    m = rows // FAR_K
    blocks = z[:m * FAR_K, :m * FAR_K].reshape(m, FAR_K, m, FAR_K)
    with np.errstate(invalid="ignore"):
        far = np.nanmean(blocks, axis=(1, 3))
    data = encode(quantize(far))
    (OUT / "far.bin.gz").write_bytes(data)
    files["far.bin.gz"] = {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}
    manifest = {
        "version": 1,
        "kind": "polar-dem-tiles",
        "source": "LOLA LDEM_80S_80MPP_ADJ, 80 m/px south-polar DEM (Barker et al. 2023, NASA GSFC PGDA)",
        "sourceUrl": C.REGIONAL_DEM_URL,
        "projection": {"proj": "stere", "lat0Deg": -90, "latTsDeg": -90, "lon0Deg": 0, "radiusM": C.MOON_RADIUS_M},
        "scaleM": SCALE,
        "nodata": NODATA,
        "encoding": "int16 little-endian, row-major, each row delta-encoded (first value, then differences), gzip",
        "near": {"left": left, "top": top, "resM": res, "rows": rows, "cols": cols, "tilePx": TILE},
        "far": {"left": left, "top": top, "resM": res * FAR_K, "rows": m, "cols": m, "file": "far.bin.gz",
                "method": f"{FAR_K} x {FAR_K} block mean of the 80 m grid"},
        "pixelCentre": "x = left + (c + 0.5) * resM, y = top - (r + 0.5) * resM",
        "files": files,
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    total = sum(f["bytes"] for f in files.values())
    print(f"wrote {len(files)} files ({total / 1e6:.1f} MB) to {OUT}")


if __name__ == "__main__":
    main()
