"""Small whole-Moon height grid for the place-picker globe (display only).

The globe mesh is 512 x 256 vertices, yet it used to download all 72 global tiles (33 MB,
`public/data/global-dem/`, A/D's 4 x 4 block mean of NASA PDS LOLA LDEM_64) before it could draw.
This script averages those same checked tiles a further 4 x 4 (16 px/deg -> 4 px/deg, ~7.6 km
pixels) into one 2 MB file. Nothing else is involved: no new source, no smoothing, no height
exaggeration. Zoomed-in views and custom points still load the full tiles around the point.

Output: public/data/global-dem/display-4ppd.bin (int16 LE, row-major, same layout and scale as
the tiles) and display-4ppd.json (shape, method, source tiles' manifest hash, sha256).

Usage: python -m preprocess.global_display_dem
"""
import hashlib
import json
import sys
from pathlib import Path

if __package__ in (None, ""):  # run as a file: make the repo root importable
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np

from preprocess import config as C

FACTOR = 4


def main() -> None:
    folder = C.OUT_DIR / "global-dem"
    manifest_path = folder / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    rows, cols, tile = manifest["rows"], manifest["cols"], manifest["tilePx"]
    full = np.empty((rows, cols), dtype=np.int16)
    for name, meta in manifest["tiles"].items():
        data = (folder / name).read_bytes()
        if hashlib.sha256(data).hexdigest() != meta["sha256"]:
            raise ValueError(f"{name}: sha256 differs from manifest.json")
        r, c = (int(v) for v in name[2:-4].split("_"))
        full[r * tile:(r + 1) * tile, c * tile:(c + 1) * tile] = np.frombuffer(data, dtype="<i2").reshape(tile, tile)
    small = full.reshape(rows // FACTOR, FACTOR, cols // FACTOR, FACTOR).astype(np.float64).mean(axis=(1, 3))
    out = np.rint(small).astype("<i2")
    blob = out.tobytes()
    (folder / "display-4ppd.bin").write_bytes(blob)
    doc = {
        "version": 1,
        "kind": "global-dem-display",
        "file": "display-4ppd.bin",
        "source": manifest["source"],
        "sourceUrl": manifest["sourceUrl"],
        "derivedFrom": "global-dem/manifest.json",
        "derivedFromSha256": hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
        "method": f"{FACTOR} x {FACTOR} block mean of the {manifest['ppd']} px/deg global tiles ({manifest['method']})",
        "ppd": manifest["ppd"] // FACTOR,
        "rows": int(out.shape[0]),
        "cols": int(out.shape[1]),
        "scaleM": manifest["scaleM"],
        "radiusM": manifest["radiusM"],
        "layout": "int16 little-endian, row-major; row 0 centre at 90 - 0.5/ppd deg N, col 0 centre at 0.5/ppd deg E; height = value * scaleM above radiusM",
        "bytes": len(blob),
        "sha256": hashlib.sha256(blob).hexdigest(),
        "limits": "Display only (place-picker globe). Science and custom points use the full tiles.",
    }
    (folder / "display-4ppd.json").write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {folder / 'display-4ppd.bin'} ({len(blob) / 1e6:.2f} MB, {out.shape[1]} x {out.shape[0]})")


if __name__ == "__main__":
    main()
