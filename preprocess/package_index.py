"""Publish discoverable package URLs without adding free points to the main catalogue."""
import json
from . import config as C, writer as W
from .mission_catalogue import MISSION_SITES


def main():
    roots = [C.OUT_DIR / sid for sid in MISSION_SITES]
    roots += sorted((C.OUT_DIR / "packages").glob("*/"))
    entries = []
    for root in roots:
        manifest = root / "package.json"
        if not manifest.exists():
            raise ValueError(f"{root}: incomplete scientific package")
        doc = json.loads(manifest.read_text(encoding="utf-8"))
        entries.append({"siteId": doc["siteId"], "manifest": manifest.relative_to(C.OUT_DIR).as_posix(),
                        "manifestSha256": W.sha256_file(manifest), "coverage": doc["coverage"],
                        "observer": doc["observer"], "horizonResolutionDeg": doc["horizonResolutionDeg"]})
    W.write(C.OUT_DIR / "packages.json", {"version": 1, "packages": entries})


if __name__ == "__main__":
    main()
