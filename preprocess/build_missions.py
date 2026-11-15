"""Build source-pinned mission catalogue data, annual series and integrity manifests.

python -m preprocess.build_missions [--sites IM1 IM2 ...] [--source skyfield|horizons]
Complete packages are reused unless --force is supplied. Catalogue publication is last.
"""
import argparse
import json
from . import config as C, build_all as B, season as S, extended as X, writer as W
from .mission_catalogue import MISSION_SITES
from .package_contract import write_manifest


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--sites", nargs="+", choices=list(MISSION_SITES), default=list(MISSION_SITES))
    ap.add_argument("--source", choices=["skyfield", "horizons"], default="skyfield")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    entries = []
    for sid in args.sites:
        out = C.OUT_DIR / sid
        if (out / "package.json").exists() and not args.force:
            manifest = json.loads((out / "package.json").read_text(encoding="utf-8"))
            intact = all((out / name).exists() and (out / name).stat().st_size == meta["bytes"] and
                         W.sha256_file(out / name) == meta["sha256"] for name, meta in manifest["files"].items())
            if intact:
                entries.append(json.loads((out / "site.json").read_text(encoding="utf-8")))
                continue
        entry = B.build_site(sid, argparse.Namespace(source=args.source, far_range=C.FAR_RANGE_M,
                                                     skip_ephemeris=True))
        # Query once: the main JSON and annual binary use precisely the same observer/source.
        eye = entry["surfaceElevationM"] + entry["observerHeightM"]
        rows = S.query_year(sid, args.source, lat=entry["latDeg"], lon=entry["lonDeg"], eye=eye)
        source = "jpl-horizons" if args.source == "horizons" else "skyfield-de421"
        nmain = int((S._dt(C.STOP_UTC) - S._dt(C.START_UTC)).total_seconds() / C.STEP_S) + 1
        W.write(out / "ephemeris.json", W.ephemeris_doc(sid, source, rows["sun"][:nmain], rows["earth"][:nmain]))
        year = X.write_year_array(sid, X.year_array(sid, rows), out, S.SEASON_START, S.SEASON_STOP,
                                  source, entry["latDeg"], entry["lonDeg"], eye)
        X.write_header(sid, year)
        W.write(out / "site.json", entry)
        W.write(out / "season.json", S.site_doc(sid, rows, source))
        write_manifest(out)
        entries.append(entry)
    B.update_sites_json(entries)


if __name__ == "__main__":
    main()
