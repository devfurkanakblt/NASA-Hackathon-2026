import json
import subprocess
import sys

import numpy as np
import pytest

from preprocess import config as C

needs_dem = pytest.mark.skipif(not (C.RAW_DIR / "dem").exists(), reason="data_raw/dem missing")


def run(args, out_root):
    cmd = [sys.executable, "-m", "preprocess.refine_cells", *args, "--out-root", str(out_root)]
    return subprocess.run(cmd, cwd=C.ROOT, capture_output=True, text=True)


def _header(site_id):
    return json.loads((C.OUT_DIR / site_id / "extended.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("bad", ["r99c99", "r61c0", "r0c61", "36,32", "r-1c3", "c3r1"])
def test_unknown_cell_id_rejected(tmp_path, bad):
    r = run(["--site", "Site01", "--cells", bad], tmp_path)
    assert r.returncode == 2, r.stdout + r.stderr
    assert bad in r.stderr
    assert not any(tmp_path.iterdir())


@pytest.mark.parametrize("site", ["CE6", "Site99"])
def test_site_without_map_rejected(tmp_path, site):
    r = run(["--site", site, "--cells", "r0c0"], tmp_path)
    assert r.returncode == 2
    assert not any(tmp_path.iterdir())


def test_merge_keeps_entries_of_same_cells_file():
    from preprocess.refine_cells import merge
    old = {"version": 1, "siteId": "Site01", "cellsSha256": "a" * 64, "cells": {"r1c1": {"x": 1}, "r2c2": {"x": 2}}}
    doc = merge(old, "Site01", "a" * 64, {"r2c2": {"x": 3}, "r3c3": {"x": 4}})
    assert doc["cells"] == {"r1c1": {"x": 1}, "r2c2": {"x": 3}, "r3c3": {"x": 4}}
    assert list(doc["cells"]) == ["r1c1", "r2c2", "r3c3"]


def test_merge_drops_entries_of_a_stale_cells_file():
    from preprocess.refine_cells import merge
    old = {"version": 1, "siteId": "Site01", "cellsSha256": "a" * 64, "cells": {"r1c1": {"x": 1}}}
    doc = merge(old, "Site01", "b" * 64, {"r3c3": {"x": 4}})
    assert doc == {"version": 1, "siteId": "Site01", "cellsSha256": "b" * 64, "cells": {"r3c3": {"x": 4}}}


# ---------------------------------------------------------------- one real refinement (shared)
@pytest.fixture(scope="module")
def refined(tmp_path_factory):
    root = tmp_path_factory.mktemp("refined")
    r = run(["--site", "Site01", "--cells", "r36c32"], root)
    assert r.returncode == 0, r.stdout + r.stderr
    return json.loads((root / "Site01" / "refined.json").read_text(encoding="utf-8"))


@needs_dem
def test_refined_doc_shape(refined):
    from preprocess import writer as W
    assert refined["version"] == 1 and refined["siteId"] == "Site01"
    assert refined["cellsSha256"] == W.sha256_file(C.OUT_DIR / "Site01" / "cells.bin") == _header("Site01")["cells"]["sha256"]
    e = refined["cells"]["r36c32"]
    assert e["azStepDeg"] == 0.1 and e["count"] == 3600
    assert len(e["elevDeg"]) == len(e["distanceM"]) == 3600
    assert np.isfinite(e["elevDeg"]).all() and min(e["distanceM"]) > 0
    assert isinstance(e["warnings"], list)
    m = json.loads((C.OUT_DIR / "Site01" / "map.json").read_text(encoding="utf-8"))
    i = 36 * 61 + 32
    assert (e["latDeg"], e["lonDeg"]) == (m["latDeg"][i], m["lonDeg"][i])


@needs_dem
def test_refined_eye_equals_cells_eye(refined):
    assert refined["cells"]["r36c32"]["eyeM"] == _header("Site01")["cells"]["eyeM"][36 * 61 + 32]


@needs_dem
def test_refined_matches_1deg_within_tolerance(refined):
    """At every 1° column j, the refined max over [j-0.5°, j+0.5°] >= cells value - 0.05°."""
    cells = np.fromfile(C.OUT_DIR / "Site01" / "cells.bin", dtype="<i2").reshape(-1, 360)
    one = cells[36 * 61 + 32] / 100.0
    fine = np.array(refined["cells"]["r36c32"]["elevDeg"])
    idx = (np.arange(360)[:, None] * 10 + np.arange(-5, 6)[None, :]) % 3600
    window_max = fine[idx].max(axis=1)
    assert (window_max >= one - 0.05).all(), float((one - window_max).max())
