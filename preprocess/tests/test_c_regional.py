"""C-owned catalogue-driven display pipeline tests; no network or scientific file edits."""
import json
import numpy as np
import pytest
from preprocess import regional_moontrek as m


def entry(site_id="Site99"):
    return dict(id=site_id, latDeg=-88.25, lonDeg=50.5, surfaceElevationM=1200, observerHeightM=2)


def test_uses_new_catalogue_entries_without_config_site_registry(tmp_path, monkeypatch):
    monkeypatch.setattr(m.C, "OUT_DIR", tmp_path)
    monkeypatch.setattr(m.C, "SITES", {})
    sites = [entry("Site99"), entry("Site100")]
    (tmp_path / "sites.json").write_text(json.dumps({"sites": sites}))
    called = []
    monkeypatch.setattr(m, "build_site", lambda site_id, value: called.append((site_id, value)))
    m.main([])
    assert called == [(s["id"], s) for s in sites]
    with pytest.raises(ValueError, match="Unknown catalogue"):
        m.main(["not-in-catalogue"])


def test_build_uses_catalogue_geometry_and_keeps_provenance(monkeypatch):
    monkeypatch.setattr(m.C, "SITES", {})
    monkeypatch.setattr(m, "to_xy", lambda *args: (10, 20))
    monkeypatch.setattr(m, "fetch_crop", lambda *args: (object(), {"product": "test fixture", "sourceSha256": "0" * 64}))
    arguments = []
    monkeypatch.setattr(m.T, "build", lambda *args, **kwargs: (arguments.append(args) or np.zeros((m.N, m.N)), 0))
    written = []
    monkeypatch.setattr(m.W, "write", lambda path, doc: written.append(doc))
    s = entry()
    m.build_site(s["id"], s)
    assert arguments[0][:3] == (s["latDeg"], s["lonDeg"], 1202)
    assert written[0]["siteId"] == s["id"]
    assert written[0]["provenance"]["longitudeDeg"] == s["lonDeg"]
    assert len(written[0]["provenance"]["catalogueEntrySha256"]) == 64


@pytest.mark.parametrize("site", [entry("../bad"), {**entry(), "latDeg": 91}, {**entry(), "lonDeg": float("nan")}])
def test_refuses_unsafe_ids_and_out_of_coverage_coordinates(site):
    with pytest.raises(ValueError):
        m.build_site(site["id"], site)


def test_refuses_no_data_instead_of_writing_fake_fill(monkeypatch):
    monkeypatch.setattr(m, "to_xy", lambda *args: (0, 0))
    monkeypatch.setattr(m, "fetch_crop", lambda *args: (object(), {}))
    monkeypatch.setattr(m.T, "build", lambda *args, **kwargs: (np.full((m.N, m.N), np.nan), 1))
    with pytest.raises(RuntimeError):
        m.build_site("Site99", entry())


def test_contrast_point_uses_global_product_instead_of_polar_crop(monkeypatch):
    monkeypatch.setattr(m, "fetch_crop", lambda *args: pytest.fail("polar source cannot cover this point"))
    monkeypatch.setattr(m, "fetch_global", lambda lat, lon: (object(), {"product": "global test fixture"}, "global-crs"))
    calls = []
    monkeypatch.setattr(m.T, "build", lambda *args, **kwargs: (calls.append(args) or np.zeros((m.N,m.N)), 0))
    docs = []
    monkeypatch.setattr(m.W, "write", lambda path, doc: docs.append(doc))
    m.build_site("NewNearSide", {**entry("NewNearSide"), "latDeg": 2})
    assert calls[0][0] == 2
    assert calls[0][-1] == "global-crs"
    assert docs[0]["source"].startswith("NASA PDS")
