# Preprocessing (offline)

Generates the static data the web app reads from `public/data/`. No server runs at app time.
Format and units: [`docs/data-contract.md`](../docs/data-contract.md).

```bash
pip install -r preprocess/requirements.txt
python -m preprocess.download          # LOLA DEMs -> data_raw/dem (~300 MB, not committed)
python -m preprocess.download Site11 Site20 Site23   # further site DEMs (same URL pattern)
python -m preprocess.build_all         # ephemeris + horizon + terrain + sites.json
python -m preprocess.reference         # -> docs/reference/visibility.{json,md} (expected values for the web app's tests)
python -m preprocess.season            # -> {site}/season.json (1 year, monthly summary; needs reference first)
python -m preprocess.regional_map      # -> {site}/map.json (per-cell horizon, Sun/Earth %, slope; ~30 min/site)
python -m preprocess.refine_cells   # -> {site}/refined.json (finalist map cells recomputed with the 0.1° catalogue horizon; not wired into the app yet)
python -m preprocess.coverage        # -> public/data/coverage.json (where each kind of point is accepted)
python -m preprocess.validate          # -> docs/validation.md §1-4 (Skyfield, horizon, Horizons re-query, rise/set timing)
python -m preprocess.external          # -> docs/validation.md §5 (Mazarico et al. illumination products; data_raw/illum)
python -m preprocess.map_check         # -> docs/validation.md §6 (map cells vs full-resolution horizon)
python -m preprocess.crosscheck_moontrek  # -> docs/validation-moontrek.md (terrain vs NASA Moon Trek LOLA 5 m DEM; sites south of 87.5 S)
python -m preprocess.figures          # -> docs/figures/*.png (Site04 map, 1-year monthly visibility; for the slides)
python -m pytest preprocess/tests      # unit tests
python -m preprocess.make_sample       # synthetic sample in public/data/_sample
python -m preprocess.custom_point --id P001 --lat -89.45 --lon -137.2 [--start ... --stop ...] [--source skyfield]
                                       # -> custom/P001/ data package for a free coordinate (see below)
python -m preprocess.global_tiles      # -> global-dem/ LDEM_64 tiles (4x4 mean, ~33 MB) for free points in the browser
```

## Custom point packages

`preprocess.custom_point` builds the same files as a catalogue site for a free coordinate, into
`public/data/custom/<id>/`: `horizon.json` (0.1°), `terrain.json`, `ephemeris.json` (main two-month
period), `year.bin` + `extended.json` (schema 2) and `site.json` (`sites.json` entry format,
`category: "custom"`) and a hash-bound `package.json` manifest. `sites.json` is not changed;
`src/data/scientificPackage.ts` accepts package bytes for B/D integration (`src/data/packageService.ts`). The app's coordinate form no
longer needs a package for a quick look: outside the polar maps it computes the exact point in the browser from
`global-dem/` (global screening estimate). A package remains the way to get catalogue-quality terrain.

- **Default accepted area (`--terrain local5m`):** the whole 7 km near range must lie inside one LOLA 5 m tile. On the ~16 km
  Site01/04/07/11/20 tiles that is roughly a 2 km box around the tile centre. Points outside it are
  rejected; the 80 m regional DEM is never used as a silent fallback for the near field.
  Explicit `--terrain regional` allows south-polar points using the 80 m DEM; `--terrain global`
  allows any lunar latitude/longitude using global LDEM_64 (~474 m/px), including the longitude seam
  and polar caps. This is coarse screening, not local-hazard assessment. Missing regional terrain
  is warned about; a display patch may be smaller if its original 10 km footprint leaves the DEM.
- **Time range:** `--start`/`--stop` default to 2026-11-01T00:00:00Z … 2027-11-01T00:00:00Z, must lie in
  2000-01-01T00:00:00Z … 2040-01-01T00:00:00Z, on the 600 s grid, with at most 1830 days per package;
  `--stop` must be after `--start`. The JSON series starts at the requested start and covers up to
  61 days; `year.bin` covers the entire requested period. Longitude is normalised to
  (−180, 180].
- **One observer:** horizon, ephemeris and year series use the same eye, surface height + 2 m
  (`extended.json` `year.observer`).
- **Warnings:** far terrain missing from the 80 m DEM is reported in `horizon.json` and `site.json`
  `warnings`, never set to zero.
- **Rejections** exit with code 2 and an English reason. Nothing is written: the package is built in a
  temporary directory and renamed into place only when complete.

## Mission catalogue and longer studies

`python -m preprocess.build_missions` builds the 23 new source-pinned mission/research points
in `preprocess/mission_catalogue.py`. It queries Skyfield/DE421 by default (explicitly labelled),
publishes matching main/annual ephemeris, horizon, terrain, monthly summary and portable package,
then updates `sites.json`. Use `--source horizons` for JPL production instead. Complete packages
are reused; `--force` regenerates selected points. Rebuild references and coverage afterward:

```bash
python -m preprocess.reference
python -m preprocess.coverage
python -m preprocess.package_index
python -m preprocess.validate_missions
```

The nine Artemis entries are representative research candidates from Wueller et al., Table A1
(doi:10.1029/2025JE009434), associated with NASA's dated October 2024 Artemis III region list.
They are neither region centroids nor approved touchdown coordinates. The catalogue is limited to
the southern hemisphere: northern landing sites (Apollo 11/15/17, Blue Ghost 1, Chang'e-3/5,
Peregrine) are not included. Source URLs,
coordinate status, warnings and explicit DEM choices accompany each record. The two Artemis
points covered by the existing Site20/Site23 5 m tiles reuse those tiles. Other points use explicitly
labelled regional 80 m or global ~474 m data. Nearest-site distances and full near-field coverage
are checked in `docs/validation-missions.md`; region polygon containment is not inferred.

Example multiyear package (included under `public/data/packages/`):

```bash
python -m preprocess.custom_point --id ConnectingRidge2026to2029 --lat -89.4632 --lon -137.49 --start 2026-11-01T00:00:00Z --stop 2029-11-01T00:00:00Z --source skyfield --out-root public/data/packages
```

`public/data/packages.json` lists discoverable manifests and independent coverage periods. The
base catalogue still has the existing one-year range; importing a package does not silently extend
every other site's coverage. See `docs/data-contract.md` for the generation/import boundary.

## Method

| Step | Source / model |
|---|---|
| Site coordinates | NASA Lunar Surface Data Book (M2M-30044 Baseline, 18 Mar 2025), Table A2.1-1. (The 2023 Rev A table has shifted rows; do not use it) |
| Sun & Earth az/el | JPL Horizons API, observer `coord@301` (geodetic, MEAN_ME frame, R = 1737.4 km), airless, 10-min steps, observer 2 m above the DEM surface |
| Cross-check | Skyfield + DE421 + `moon_pa_de421` in the `MOON_ME_DE421` frame |
| Near terrain (≤ 7 km) | LOLA 5 m/px site DEMs (Barker et al. 2021) |
| Far terrain (7–250 km) | LOLA `LDEM_80S_80MPP_ADJ` (Barker et al. 2023) |
| Horizon | 3600 great-circle rays (0.1°), 2.5 m steps near / 40 m far, bilinear DEM sampling, exact spherical curvature: `elev = atan2(Rt cos θ − Ro, Rt sin θ)` |
| Site04R | Site04's catalogue coordinate lies on the ~32° inner wall of Shackleton. Derived ridge point: highest 5 m pixel with slope ≤ 10° (25 m baseline) within 2 km (`preprocess/ridge.py`); 1.9 km offset, stable for 2–3 km / 10–15° |
| 3D terrain | 256×256 ENU grid, ±5 km, 4× oversampled mean, curvature included. Visual only |
| Coverage check | Rays that leave the 80 m DEM (−80° edge, Site20/23) are bounded with 10.8 km high terrain at the edge; flagged in `coverageLimitedAzDeg` if that could raise the horizon (none for current sites) |
| Season | Same horizon, Horizons ephemeris for 1 year (2026-11-01 – 2027-11-01, 10 min), monthly table |
| Regional map | ±3 km grid (100 m; 200 m for Site11/20/23). Per cell: own horizon (0.5° azimuth, same steps and 250 km range), Sun/Earth rebuilt in the Moon-fixed frame from the site's Horizons ephemeris and projected into the cell's local frame, slope over 25 m |
| External check | PGDA Lunar Polar Illumination (Mazarico et al.), 85S 60 m: AVGVISIB (Sun, Earth), LPSR; our horizon + Skyfield over 18.6 years with the product definitions |

Azimuth: from local north, clockwise toward east. Elevation: above the local horizontal plane.

## References

- Barker, M.K. et al. (2021), *Improved LOLA elevation maps for south pole landing sites*, PSS 203, 105119. doi:10.1016/j.pss.2020.105119
- Barker, M.K. et al. (2023), *A New View of the Lunar South Pole from LOLA*, PSJ 4, 183. doi:10.3847/PSJ/acf3e1; data doi:10.60903/gsfcpgda-lola-spole
- Mazarico, E. et al. (2011), *Illumination conditions of the lunar polar regions using LOLA topography*, Icarus 211, 1066–1081. doi:10.1016/j.icarus.2010.10.030
- PGDA, *Lunar Polar Illumination* products (AVGVISIB, LPSR, 2016-08 release), https://pgda.gsfc.nasa.gov/products/69
- NASA (2025), *Moon to Mars Lunar Surface Data Book*, M2M-30044 Baseline, NASA/TP-20250002845
- JPL Horizons System, https://ssd.jpl.nasa.gov/horizons/
- Rhodes, B., Skyfield, https://rhodesmill.org/skyfield/
