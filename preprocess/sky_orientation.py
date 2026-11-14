"""Optional registered Earth display, separate from A's scientific ephemeris.

Run ``python -m preprocess.sky_orientation --cache-dir <raw-cache>``. All site IDs,
coordinates, time grids and light times come from existing public/data files. No
ephemeris, horizon, terrain or site catalogue is rewritten. Kernels are the same
ones used by ephemeris_skyfield._kernels(). This is a rigid Earth display model,
not a replacement for apparent topocentric Sun/Earth positions or visibility.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

from . import config as C

C_M_S = 299_792_458.0
TEXTURE_FRAME = ("Three sphere: +X=ITRS Greenwich/equator, +Y=ITRS north pole, "
                 "+Z=-ITRS 90E/equator; u=0 at longitude -180, u=0.5 at 0")
SOURCE_PAGE = "https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-topography-bathymetry/"
TEXTURE_URL = ("https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/"
               "bmng-topography-bathymetry/november/world.topo.bathy.200411.3x5400x2700.jpg")
TEXTURE_SHA256 = "388422e3bfc62517af2a9d538989a2f859fc193e6f6cde72c3d230ef29c2e69f"
# Columns map a Three SphereGeometry vector to ITRS. At longitude 0 the
# surface normal is +X; at longitude +90E it is -Z; the north pole is +Y.
SPHERE_TO_ITRS = np.array([[1., 0., 0.], [0., 0., -1.], [0., 1., 0.]])
KERNEL_NAMES = ("de421.bsp", "moon_080317.tf", "pck00008.tpc", "moon_pa_de421_1900-2050.bpc")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def local_scene_basis(lat_deg: float, lon_deg: float) -> np.ndarray:
    """MOON_ME vector -> Three scene vector (+east, +up, -north)."""
    lat, lon = math.radians(lat_deg), math.radians(lon_deg)
    sl, cl, so, co = math.sin(lat), math.cos(lat), math.sin(lon), math.cos(lon)
    return np.array([[-so, co, 0.], [cl * co, cl * so, sl],
                     [sl * co, sl * so, -cl]])


def scene_rotation(lunar_icrf_to_me: np.ndarray, icrf_to_itrs: np.ndarray,
                   lat_deg: float, lon_deg: float) -> np.ndarray:
    """Earth sphere local -> observer-local Three; each rotation has det +1."""
    return local_scene_basis(lat_deg, lon_deg) @ lunar_icrf_to_me @ icrf_to_itrs.T @ SPHERE_TO_ITRS


def matrix_to_quaternion_xyzw(matrix: np.ndarray) -> list[float]:
    """Convert a proper 3x3 rotation to the XYZW convention Three.js uses."""
    m = np.asarray(matrix, dtype=float)
    if m.shape != (3, 3) or not np.isfinite(m).all():
        raise ValueError("rotation must be a finite 3x3 matrix")
    if not np.allclose(m.T @ m, np.eye(3), atol=1e-9) or not math.isclose(np.linalg.det(m), 1., abs_tol=1e-9):
        raise ValueError("rotation must be orthonormal with determinant +1")
    trace = float(np.trace(m))
    if trace > 0:
        s = 2 * math.sqrt(trace + 1)
        q = [(m[2, 1] - m[1, 2]) / s, (m[0, 2] - m[2, 0]) / s,
             (m[1, 0] - m[0, 1]) / s, s / 4]
    else:
        i = int(np.argmax(np.diag(m)))
        if i == 0:
            s = 2 * math.sqrt(1 + m[0, 0] - m[1, 1] - m[2, 2])
            q = [s / 4, (m[0, 1] + m[1, 0]) / s, (m[0, 2] + m[2, 0]) / s, (m[2, 1] - m[1, 2]) / s]
        elif i == 1:
            s = 2 * math.sqrt(1 + m[1, 1] - m[0, 0] - m[2, 2])
            q = [(m[0, 1] + m[1, 0]) / s, s / 4, (m[1, 2] + m[2, 1]) / s, (m[0, 2] - m[2, 0]) / s]
        else:
            s = 2 * math.sqrt(1 + m[2, 2] - m[0, 0] - m[1, 1])
            q = [(m[0, 2] + m[2, 0]) / s, (m[1, 2] + m[2, 1]) / s, s / 4, (m[1, 0] - m[0, 1]) / s]
    return (np.asarray(q) / np.linalg.norm(q)).tolist()


def quaternion_xyzw_to_matrix(q) -> np.ndarray:
    x, y, z, w = q
    return np.array([[1 - 2 * (y*y + z*z), 2 * (x*y - z*w), 2 * (x*z + y*w)],
                     [2 * (x*y + z*w), 1 - 2 * (x*x + z*z), 2 * (y*z - x*w)],
                     [2 * (x*z - y*w), 2 * (y*z + x*w), 1 - 2 * (x*x + y*y)]])


def _validate_inputs(site: dict, ephemeris: dict):
    site_id = site["id"]
    if not re.fullmatch(r"[A-Za-z0-9_-]+", site_id) or ephemeris.get("siteId") != site_id:
        raise ValueError("site IDs must be safe and match the ephemeris")
    lat, lon = float(site["latDeg"]), float(site["lonDeg"])
    if not math.isfinite(lat) or not -90 <= lat <= 90 or not math.isfinite(lon):
        raise ValueError("invalid site latitude/longitude")
    count, step = ephemeris["count"], ephemeris["stepS"]
    if not isinstance(count, int) or isinstance(count, bool) or count < 2:
        raise ValueError("ephemeris count must be an integer >= 2")
    if not isinstance(step, (int, float)) or not math.isfinite(step) or step <= 0:
        raise ValueError("ephemeris stepS must be finite and positive")
    if not ephemeris["startUtc"].endswith("Z"):
        raise ValueError("ephemeris startUtc must use UTC Z")
    start = datetime.fromisoformat(ephemeris["startUtc"].replace("Z", "+00:00"))
    distances = np.asarray(ephemeris["earth"]["distanceM"], dtype=float)
    if distances.shape != (count,) or not np.isfinite(distances).all() or np.min(distances) <= 0:
        raise ValueError("Earth distanceM must have count positive finite samples")
    return start, distances


def build_orientation_doc(site: dict, ephemeris: dict, kernels: dict, cache_dir: Path) -> dict:
    """Generate display rotations and Earth-to-Sun light direction on A's grid."""
    from skyfield import __version__ as skyfield_version
    from skyfield.framelib import itrs
    from skyfield.functions import T, mxm, mxv

    start, distances = _validate_inputs(site, ephemeris)
    count, step = ephemeris["count"], ephemeris["stepS"]
    times = [start + timedelta(seconds=i * step) for i in range(count)]
    t = kernels["ts"].from_datetimes(times)
    # A's distance is rounded to kilometres, so the emission time uncertainty
    # from that rounding is <= 500/c seconds (~0.000007 degrees Earth rotation).
    emission = t - distances / C_M_S / 86400
    moon_r = kernels["frame"].rotation_at(t)  # reception orientation of local sky
    earth_r = itrs.rotation_at(emission)      # visible terrestrial surface epoch
    basis = local_scene_basis(site["latDeg"], site["lonDeg"])
    body_to_scene = mxm(basis, mxm(moon_r, mxm(T(earth_r), SPHERE_TO_ITRS)))
    quaternions = []
    previous = None
    max_roundtrip = 0.
    for i in range(count):
        q = np.asarray(matrix_to_quaternion_xyzw(body_to_scene[:, :, i]))
        # The same attitude has two quaternion signs. Keep the series continuous
        # so interpolators cannot accidentally take the long arc through a day.
        if previous is not None and np.dot(q, previous) < 0:
            q = -q
        previous = q
        rounded = np.round(q, 10).tolist()
        max_roundtrip = max(max_roundtrip, float(np.max(np.abs(quaternion_xyzw_to_matrix(rounded) - body_to_scene[:, :, i]))))
        quaternions.append(rounded)

    earth_to_sun = kernels["eph"]["earth"].at(emission).observe(kernels["eph"]["sun"]).apparent().position.au
    earth_to_sun /= np.linalg.norm(earth_to_sun, axis=0)
    light_scene = mxv(basis, mxv(moon_r, earth_to_sun))
    light_scene /= np.linalg.norm(light_scene, axis=0)

    dut1 = np.asarray(emission.dut1)
    orthogonality = np.einsum("jin,jkn->ikn", body_to_scene, body_to_scene)
    max_orthogonality = float(np.max(np.abs(orthogonality - np.eye(3)[:, :, None])))
    return {
        "version": 1, "siteId": site["id"], "startUtc": ephemeris["startUtc"],
        "stepS": step, "count": count, "quaternionXyzw": quaternions,
        "sunDirectionAtEarth": np.round(light_scene.T, 10).tolist(),
        "source": {
            "site": {"latitudeDeg": site["latDeg"], "longitudeDeg": site["lonDeg"],
                     "surfaceElevationM": site["surfaceElevationM"], "observerHeightM": site["observerHeightM"]},
            "method": "Skyfield ITRS at Earth emission time -> ICRF -> MOON_ME_DE421 at reception -> local ENU -> Three (+east,+up,-north)",
            "textureBodyFrame": TEXTURE_FRAME,
            "skyfieldVersion": skyfield_version,
            "kernelFrame": "MOON_ME_DE421",
            "kernels": [{"name": name, "sha256": sha256(cache_dir / "skyfield" / name)} for name in KERNEL_NAMES],
            "ephemerisSha256": hashlib.sha256(json.dumps(ephemeris, sort_keys=True, separators=(",", ":")).encode()).hexdigest(),
            "ephemerisHashEncoding": "UTF-8 JSON with recursively sorted keys and separators comma/colon (Python json.dumps)",
            "lightTime": "Earth ITRS uses reception UTC minus A's observer-Earth distance / 299792458 m/s; lunar frame uses reception epoch",
            "lightTimeSecondsRange": [float(np.min(distances) / C_M_S), float(np.max(distances) / C_M_S)],
            "earthRotationTimeScale": "UT1 from Skyfield bundled delta-T and leap-second tables (not UT1=UTC); precession/nutation included",
            "dut1SecondsRange": [float(np.min(dut1)), float(np.max(dut1))],
            "polarMotion": "Not applied; no IERS polar-motion table installed",
            "sunDirectionAtEarth": "Unit vector Earth(emission).observe(Sun).apparent in reception local Three frame, for visual phase shading only",
            "textureEpoch": "November 2004 monthly composite; not 2026 weather or live clouds",
            "limits": [
                "Rigid spherical visual globe; no Earth oblateness, terrain or dynamic clouds",
                "Orientation uses Skyfield bundled Earth rotation prediction, not an independent precision Earth-orientation solution",
                "No differential aberration or gravitational light-bending deformation of the extended Earth disc",
                "A's apparent topocentric centre position, angular diameter and terrain visibility remain authoritative",
                "Texture includes baked topographic/bathymetric shading; rendered illumination is a visual approximation",
            ],
            "validation": {"maxRotationOrthogonalityError": max_orthogonality,
                           "maxQuaternionMatrixRoundtripError": max_roundtrip,
                           "externalOrientationCrosscheck": "not performed by this generator"},
            "references": ["https://rhodesmill.org/skyfield/coordinates.html#rotation-matrices",
                           "https://rhodesmill.org/skyfield/planetary.html#computing-a-raw-rotation-matrix"],
        },
    }


def prepare_texture(original: Path, root: Path):
    """Resample the pinned NASA source; reject any other input by SHA-256."""
    from PIL import Image, __version__ as pillow_version

    if sha256(original) != TEXTURE_SHA256:
        raise ValueError("NASA source image SHA-256 does not match the archived official source")
    image = Image.open(original)
    if image.size != (5400, 2700):
        raise ValueError("NASA source dimensions differ from expected 5400x2700")
    target = root / "public" / "assets" / "earth-blue-marble.jpg"
    target.parent.mkdir(parents=True, exist_ok=True)
    image.convert("RGB").resize((2048, 1024), Image.Resampling.LANCZOS).save(target, "JPEG", quality=95, subsampling=0, optimize=True)
    manifest = {
        "version": 1,
        "assets": [{"path": "public/assets/earth-blue-marble.jpg", "sha256": sha256(target),
                    "width": 2048, "height": 1024, "bytes": target.stat().st_size,
                    "title": "NASA Blue Marble: Next Generation with Topography and Bathymetry, November 2004",
                    "credit": "NASA Earth Observatory, Blue Marble: Next Generation",
                    "sourcePage": SOURCE_PAGE, "sourceUrl": TEXTURE_URL,
                    "sourceSha256": TEXTURE_SHA256, "sourceWidth": 5400, "sourceHeight": 2700,
                    "sourceEpoch": "2004-11 monthly surface composite",
                    "projection": "equirectangular; west=-180, east=180, north=90, south=-90; north at image top",
                    "transformation": f"Pillow {pillow_version}: RGB, LANCZOS 2048x1024, JPEG quality95 subsampling0 optimize; no generative imagery",
                    "usage": "Public NASA imagery; attribution retained; not a NASA endorsement",
                    "usagePolicy": "https://www.nasa.gov/nasa-brand-center/images-and-media/",
                    "limitations": ["Archival cloud-free monthly composite, not live clouds or 2026 weather",
                                    "Baked topographic/bathymetric shading is part of the source image"],
                    "textureBodyFrame": TEXTURE_FRAME}],
        "orientationFiles": "public/data/{siteId}/earth-orientation.json; regenerate from the site's own ephemeris grid and coordinates",
    }
    dest = root / "docs" / "c-assets.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Texture: {target} ({target.stat().st_size} bytes)")


def _wrap_difference(a: float, b: float) -> float:
    return (a - b + 180) % 360 - 180


def displayed_subobserver_and_pole(site: dict, ephemeris: dict, orientation: dict, index: int):
    """Recover Q14/Q17 from the display transform for an independent check.

    Horizons Q14 reports planetodetic latitude on its ellipsoid, while the
    display is spherical. Convert the recovered planetocentric direction to
    the normal of that ellipsoid before comparing latitude. Q17 is measured
    counterclockwise from the observer body's (Moon) pole on the sky.
    """
    az, el = np.radians([ephemeris["earth"]["azDeg"][index], ephemeris["earth"]["elDeg"][index]])
    direction = np.array([math.cos(el) * math.sin(az), math.sin(el), -math.cos(el) * math.cos(az)])
    r = quaternion_xyzw_to_matrix(orientation["quaternionXyzw"][index])
    itrs_observer = SPHERE_TO_ITRS @ (r.T @ -direction)
    lon = math.degrees(math.atan2(itrs_observer[1], itrs_observer[0])) % 360
    lat = math.degrees(math.atan2(itrs_observer[2] * 6378.137**2,
                                   math.hypot(*itrs_observer[:2]) * 6356.752**2))
    pole = r @ [0, 1, 0]
    lunar_north = local_scene_basis(site["latDeg"], site["lonDeg"]) @ [0, 0, 1]
    pole -= direction * np.dot(pole, direction)
    lunar_north -= direction * np.dot(lunar_north, direction)
    pole /= np.linalg.norm(pole)
    lunar_north /= np.linalg.norm(lunar_north)
    pa = math.degrees(math.atan2(-np.dot(direction, np.cross(lunar_north, pole)), np.dot(lunar_north, pole))) % 360
    return lon, lat, pa


def crosscheck_horizons(sites: list[dict], data_dir: Path, cache_dir: Path) -> dict:
    """Sequential fresh Q14/Q17 queries at the first/middle/example/last epochs.

    Does not regenerate or alter A's series. The raw API result is cached
    separately with the existing polite client and its SHA-256 is reported.
    """
    from . import ephemeris_horizons as H

    H.CACHE = cache_dir / "horizons-orientation"
    rows = []
    query_records = []
    for site in sites:
        folder = data_dir / site["id"]
        eph = json.loads((folder / "ephemeris.json").read_text(encoding="utf-8"))
        orientation = json.loads((folder / "earth-orientation.json").read_text(encoding="utf-8"))
        count, step = eph["count"], eph["stepS"]
        indices = sorted({0, min(round(14 * 86400 / step), count - 1), count - 1})
        start = datetime.fromisoformat(eph["startUtc"].replace("Z", "+00:00"))
        epochs = [start + timedelta(seconds=i * step) for i in indices]
        params = H.build_params("earth", site["latDeg"], site["lonDeg"],
                                site["surfaceElevationM"] + site["observerHeightM"],
                                eph["startUtc"], eph["startUtc"], step)
        for key in ("START_TIME", "STOP_TIME", "STEP_SIZE"):
            params.pop(key)
        params.update(TLIST=" ".join(f"'{d.timestamp() / 86400 + 2440587.5:.9f}'" for d in epochs),
                      TLIST_TYPE="'JD'", TIME_DIGITS="'SECONDS'", QUANTITIES="'14,17'")
        raw = H.fetch(params)
        if "$$SOE" not in raw:
            raise RuntimeError("Horizons orientation query returned no table")
        header, rest = raw.split("$$SOE", 1)
        columns = [s.strip() for s in next(line for line in header.splitlines() if "Date__(UT)__HR:MN" in line).split(",")]
        table = [[s.strip() for s in line.split(",")] for line in rest.split("$$EOE")[0].strip().splitlines()]
        if len(table) != len(indices):
            raise RuntimeError("Horizons orientation query count differs from requested epochs")
        for index, epoch, record in zip(indices, epochs, table):
            ours = displayed_subobserver_and_pole(site, eph, orientation, index)
            theirs = [float(record[columns.index(key)]) for key in ("ObsSub-LON", "ObsSub-LAT", "NP.ang")]
            rows.append({"siteId": site["id"], "utc": epoch.isoformat().replace("+00:00", "Z"),
                         "subobserverLonDifferenceDeg": _wrap_difference(ours[0], theirs[0]),
                         "subobserverGeodeticLatDifferenceDeg": ours[1] - theirs[1],
                         "northPolePositionAngleDifferenceDeg": _wrap_difference(ours[2], theirs[2])})
        query_records.append({"siteId": site["id"], "params": params,
                              "resultSha256": hashlib.sha256(raw.encode()).hexdigest(),
                              "targetOrientation": next((l.strip() for l in header.splitlines() if "Target pole/equ" in l), "unknown"),
                              "eop": next((l.strip() for l in header.splitlines() if "EOP file" in l), "unknown")})
    maxima = {key: max(abs(row[key]) for row in rows) for key in
              ("subobserverLonDifferenceDeg", "subobserverGeodeticLatDifferenceDeg", "northPolePositionAngleDifferenceDeg")}
    return {"method": "Independent JPL Horizons API Q14 (subobserver east longitude/geodetic latitude) and Q17 (north-pole position angle), three epochs per site",
            "source": H.API, "reference": "https://ssd.jpl.nasa.gov/horizons/manual.html#obsquan",
            "toleranceDeg": 0.01, "pass": all(value <= 0.01 for value in maxima.values()),
            "maxAbsoluteDifferenceDeg": maxima, "samples": rows, "queries": query_records,
            "limits": ["Sampled consistency check, not an absolute orientation accuracy guarantee",
                       "Horizons uses ITRF93 plus current EOP; Skyfield uses its bundled UT1 prediction and omits polar motion",
                       "Geodetic latitude comparison accounts for the reference ellipsoid; rendered Earth remains spherical"]}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("site_ids", nargs="*")
    parser.add_argument("--cache-dir", type=Path, default=C.RAW_DIR)
    parser.add_argument("--data-dir", type=Path, default=C.OUT_DIR)
    parser.add_argument("--texture-source", type=Path, help="Optional pinned NASA source JPEG to resample and document")
    parser.add_argument("--crosscheck", action="store_true", help="Query Horizons Q14/Q17 independently and add measured checks to docs/c-assets.json")
    args = parser.parse_args(argv)
    if args.texture_source:
        prepare_texture(args.texture_source, C.ROOT)
    C.RAW_DIR = args.cache_dir
    from .ephemeris_skyfield import _kernels
    kernels = _kernels()
    sites = json.loads((args.data_dir / "sites.json").read_text(encoding="utf-8"))["sites"]
    selected = set(args.site_ids)
    unknown = selected - {s["id"] for s in sites}
    if unknown:
        raise ValueError(f"Unknown site IDs: {sorted(unknown)}")
    for site in sites:
        if selected and site["id"] not in selected:
            continue
        if not re.fullmatch(r"[A-Za-z0-9_-]+", site["id"]):
            raise ValueError("Unsafe site ID")
        folder = args.data_dir / site["id"]
        ephemeris = json.loads((folder / "ephemeris.json").read_text(encoding="utf-8"))
        result = build_orientation_doc(site, ephemeris, kernels, args.cache_dir)
        (folder / "earth-orientation.json").write_text(json.dumps(result, separators=(",", ":"), allow_nan=False) + "\n", encoding="utf-8")
        print(f"{site['id']}: {result['count']} registered attitudes; {result['source']['validation']}")
    if args.crosscheck:
        selected_sites = [s for s in sites if not selected or s["id"] in selected]
        report = crosscheck_horizons(selected_sites, args.data_dir, args.cache_dir)
        manifest_path = C.ROOT / "docs" / "c-assets.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {"version": 1}
        manifest["orientationValidation"] = report
        manifest_path.write_text(json.dumps(manifest, indent=2, allow_nan=False) + "\n", encoding="utf-8")
        print(f"Horizons cross-check: {report['pass']} {report['maxAbsoluteDifferenceDeg']}")


if __name__ == "__main__":
    main()
