import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image
import pytest
from rasterio.io import MemoryFile
from rasterio.transform import from_origin

from preprocess import config as C
from preprocess.global_moon_imagery import validate_raster


def raster(*, radius=1737400, transparent=False, shifted=False):
    memory = MemoryFile()
    with memory.open(driver="GTiff", width=16, height=8, count=2, dtype="uint8",
                     crs=f"+proj=longlat +R={radius} +no_defs",
                     transform=from_origin(-170 if shifted else -180, 90, 22.5, 22.5)) as target:
        target.write(np.full((8, 16), 128, dtype=np.uint8), 1)
        alpha = np.full((8, 16), 255, dtype=np.uint8)
        if transparent:
            alpha[0, 0] = 0
        target.write(alpha, 2)
    return memory


def test_global_georeference_and_north_first_grid():
    with raster() as memory:
        with memory.open() as src:
            validate_raster(src, 16)


@pytest.mark.parametrize("kwargs", [{"radius": 6378137}, {"transparent": True}, {"shifted": True}])
def test_reject_wrong_body_missing_coverage_or_shifted_longitude(kwargs):
    with raster(**kwargs) as memory:
        with memory.open() as src:
            with pytest.raises(ValueError):
                validate_raster(src, 16)


def test_published_global_photograph_matches_recorded_hash_and_size():
    directory = C.ROOT / "public" / "assets"
    manifest = json.loads((directory / "moon-lroc-wac.json").read_text())
    image_path = directory / manifest["file"]
    assert hashlib.sha256(image_path.read_bytes()).hexdigest() == manifest["sha256"]
    with Image.open(image_path) as image:
        assert image.size == (manifest["width"], manifest["height"])
        assert image.width == image.height * 2
    assert manifest["archiveShadows"] is True
    assert manifest["source"]["validCoverageFraction"] == 1
    assert manifest["source"]["query"]["BBOX"] == "-180,-90,180,90"
