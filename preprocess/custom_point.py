"""Data package for a free coordinate with an explicit terrain-resolution choice.

    python -m preprocess.custom_point --id P001 --lat -89.45 --lon -137.2 \
        [--start 2026-11-01T00:00:00Z --stop 2027-11-01T00:00:00Z] [--source horizons|skyfield]
        [--terrain local5m|regional|global]

Writes public/data/custom/<id>/: horizon.json (0.1 deg), terrain.json, ephemeris.json (the main
two-month period), year.bin + extended.json (schema 2) and site.json. The same pipeline as a
catalogue site (build_all.build_site) runs on a temporary C.SITES entry; sites.json is not touched.

Default local5m accepts a point only if the whole NEAR_RANGE_M near range lies inside one 5 m tile;
regional/global accuracy must be chosen explicitly. Rejections exit with code 2, print the reason and write
nothing: the package is built in a temporary directory and renamed into place at the end.
"""
import argparse
import json
import math
import re
import shutil
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from . import build_all, config as C, coverage as CV, extended as X, season as S, writer as W
from .package_contract import write_manifest

LABEL = "Custom point - not a catalogue site, not a certified landing site"
COORD_SOURCE = "User-supplied coordinate (preprocess.custom_point)"
ID_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,31}$")
SOURCE_NAMES = {"horizons": "jpl-horizons", "skyfield": "skyfield-de421"}
GENERATOR_START = "2000-01-01T00:00:00Z"
GENERATOR_STOP = "2040-01-01T00:00:00Z"
MAX_SPAN_DAYS = 5 * 366


class Rejected(Exception):
    """Input the generator does not support; the message is shown to the user."""


def _parse_utc(name, text):
    try:
        t = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        raise Rejected(f"--{name} {text!r} is not an ISO 8601 UTC time such as 2026-11-01T00:00:00Z.") from None
    if t.tzinfo is None or t.utcoffset().total_seconds() != 0:
        raise Rejected(f"--{name} {text!r} must be given in UTC (suffix Z).")
    return t.astimezone(timezone.utc)


def check_times(start, stop):
    """Return (start, stop) as canonical ISO strings, or raise Rejected."""
    t0, t1 = _parse_utc("start", start), _parse_utc("stop", stop)
    lo, hi = S._dt(GENERATOR_START), S._dt(GENERATOR_STOP)
    for name, t in (("start", t0), ("stop", t1)):
        if not lo <= t <= hi:
            raise Rejected(f"--{name} {S._iso(t)} is outside the supported time range "
                           f"{GENERATOR_START} .. {GENERATOR_STOP}.")
        if (t - lo).total_seconds() % C.STEP_S:
            raise Rejected(f"--{name} {S._iso(t)} is not on the {C.STEP_S} s grid "
                           f"(whole multiples of {C.STEP_S} s from {GENERATOR_START}).")
    if t1 <= t0:
        raise Rejected(f"--stop {S._iso(t1)} must be after --start {S._iso(t0)}.")
    if (t1 - t0).total_seconds() > MAX_SPAN_DAYS * 86400:
        raise Rejected(f"A package may span at most {MAX_SPAN_DAYS} days; split a longer study into packages.")
    return S._iso(t0), S._iso(t1)


def check_id(pid):
    if not ID_RE.match(pid):
        raise Rejected(f"--id {pid!r} must start with a letter and contain only letters, digits, '_' or '-' "
                       "(at most 32 characters).")
    if pid.casefold() in {s.casefold() for s in C.SITES}:
        raise Rejected(f"--id {pid!r} is a catalogue site id; choose another id for a custom point.")


def check_point(lat, lon, terrain="local5m"):
    """Return (lat, normalised lon, 5 m tile), or raise Rejected."""
    if not (math.isfinite(lat) and math.isfinite(lon)):
        raise Rejected("Latitude and longitude must be finite numbers in degrees.")
    if not -90 <= lat <= 90:
        raise Rejected("Latitude must be between -90 and 90 degrees.")
    lon = CV.normalize_lon(lon)
    if terrain == "global":
        return lat, lon, "ldem64"
    if terrain == "regional":
        if lat > -80:
            raise Rejected("The regional 80 m DEM supports only points south of 80 S; choose --terrain global explicitly.")
        return lat, lon, "regional80"
    tile = CV.near_field_tile(lat, lon)
    if tile is None:
        try:
            r = CV.classify_point(lat, lon)
            reason = r["reason"]
            if r["kind"] == "map-cell":  # covered by the app's regional map, but not by this generator
                reason = (f"The point lies on the {r['tile']} regional map (map.json in the app), "
                          f"but its {C.NEAR_RANGE_M / 1000:g} km near range leaves the 5 m tile.")
        except Exception:  # noqa: BLE001 - only used to explain the rejection
            reason = "The 5 m DEM tiles are not available (data_raw/dem)."
        raise Rejected(f"({lat}, {lon}) is not supported: the whole {C.NEAR_RANGE_M / 1000:g} km near range must lie "
                       f"inside one LOLA 5 m tile. {reason} Free points are not computed from the 80 m regional "
                       "DEM alone.")
    return lat, lon, tile


def site_doc(entry, horizon):
    """site.json: the sites.json entry format, marked as a custom point; horizon warnings repeated."""
    doc = dict(entry)
    doc["coordSource"] = COORD_SOURCE
    doc["label"] = LABEL
    doc["warnings"] = list(entry["warnings"]) + [f"horizon: {w}" for w in horizon.get("warnings", [])]
    return doc


def _replace_dir(tmp, final):
    root = tmp.parent.resolve()
    if final.parent.resolve() != root or not tmp.resolve().is_relative_to(root) or not final.resolve().is_relative_to(root):
        raise ValueError("Package replacement must stay inside the output root")
    old = None
    if final.exists():
        old = final.with_name(f".{final.name}.old")
        if old.exists():
            raise ValueError(f"A previous package backup already exists: {old}; recover it before replacing")
        final.rename(old)
    try:
        tmp.rename(final)
    except BaseException:
        if old is not None:
            old.rename(final)
        raise
    if old is not None:
        shutil.rmtree(old, ignore_errors=True)


def build(pid, lat, lon, tile, start, stop, source, far_range, out_root):
    created_root = not out_root.exists()
    out_root.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix=f".{pid}.", suffix=".tmp", dir=out_root))
    C.SITES[pid] = dict(name=f"Custom point {pid}", lat=lat, lon=lon, category="custom", coordSource=COORD_SOURCE,
                        **({"dem": tile} if tile in ("ldem64", "regional80") else {"tile": tile}))
    try:
        args = argparse.Namespace(far_range=far_range, skip_ephemeris=True, source=source)
        entry = build_all.build_site(pid, args, out=tmp)
        # One eye for horizon, ephemeris and year series: the rounded surface height + observer height,
        # exactly what load_eye gives for a catalogue site.
        eye = entry["surfaceElevationM"] + C.OBSERVER_HEIGHT_M
        rows = S.query_year(pid, source, start, stop, lat, lon, eye)
        # The main series belongs to this package's period, never to a hard-coded 2026 window.
        nmain = min(len(rows["sun"]), 61 * 86400 // C.STEP_S + 1)
        W.write(tmp / "ephemeris.json", W.ephemeris_doc(pid, SOURCE_NAMES[source],
                rows["sun"][:nmain], rows["earth"][:nmain], start))
        year = X.write_year_array(pid, X.year_array(pid, rows), tmp, start, stop, SOURCE_NAMES[source],
                                  entry["latDeg"], entry["lonDeg"], eye)
        X.write_header(pid, year, out_dir=tmp)
        horizon = json.loads((tmp / "horizon.json").read_text(encoding="utf-8"))
        W.write(tmp / "site.json", site_doc(entry, horizon))
        write_manifest(tmp)
        final = out_root / pid
        _replace_dir(tmp, final)
        return final
    except BaseException:
        shutil.rmtree(tmp, ignore_errors=True)
        if created_root and not any(out_root.iterdir()):
            out_root.rmdir()
        raise
    finally:
        C.SITES.pop(pid, None)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--id", required=True, help="package id, e.g. P001")
    ap.add_argument("--lat", type=float, required=True, help="latitude in degrees")
    ap.add_argument("--lon", type=float, required=True, help="longitude in degrees (east; 0..360 is accepted)")
    ap.add_argument("--start", default=S.SEASON_START)
    ap.add_argument("--stop", default=S.SEASON_STOP)
    ap.add_argument("--source", choices=["horizons", "skyfield"], default="horizons")
    ap.add_argument("--terrain", choices=["local5m", "regional", "global"], default="local5m",
                    help="Explicit accuracy choice: local 5 m tile (default), south-polar 80 m, or global ~474 m")
    ap.add_argument("--far-range", type=float, default=C.FAR_RANGE_M)
    ap.add_argument("--out-root", type=Path, default=C.OUT_DIR / "custom", help=argparse.SUPPRESS)
    args = ap.parse_args(argv)
    try:
        check_id(args.id)
        start, stop = check_times(args.start, args.stop)
        if not math.isfinite(args.far_range) or args.far_range < C.NEAR_RANGE_M + C.FAR_STEP_M:
            raise Rejected(f"--far-range must be finite and at least {C.NEAR_RANGE_M + C.FAR_STEP_M:g} m.")
        lat, lon, tile = check_point(args.lat, args.lon, args.terrain)
    except Rejected as exc:
        print(f"custom_point: rejected: {exc}", file=sys.stderr)
        return 2
    print(f"[{args.id}] lat {lat}, lon {lon}: terrain source {tile}")
    final = build(args.id, lat, lon, tile, start, stop, args.source, args.far_range, args.out_root)
    print(f"[{args.id}] package ready: {W.display_path(final)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
