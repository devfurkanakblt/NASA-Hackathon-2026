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
python -m preprocess.validate          # -> docs/validation.md §1-4 (Skyfield, horizon, Horizons re-query, rise/set timing)
python -m preprocess.external          # -> docs/validation.md §5 (Mazarico et al. illumination products; data_raw/illum)
python -m preprocess.map_check         # -> docs/validation.md §6 (map cells vs full-resolution horizon)
python -m preprocess.crosscheck_moontrek  # -> docs/validation-moontrek.md (terrain vs NASA Moon Trek LOLA 5 m DEM; sites south of 87.5 S)
python -m preprocess.figures          # -> docs/figures/*.png (Site04 map, 1-year monthly visibility; for the slides)
python -m pytest preprocess/tests      # unit tests
python -m preprocess.make_sample       # synthetic sample in public/data/_sample
python -m preprocess.custom_point --id P001 --lat -89.45 --lon -137.2 [--start ... --stop ...] [--source skyfield]
                                       # -> custom/P001/ data package for a free coordinate (see below)
```

## Custom point packages

`preprocess.custom_point` builds the same files as a catalogue site for a free coordinate, into
`public/data/custom/<id>/`: `horizon.json` (0.1°), `terrain.json`, `ephemeris.json` (main two-month
period), `year.bin` + `extended.json` (schema 2) and `site.json` (`sites.json` entry format,
`category: "custom"`). `sites.json` is not changed; the app does not load these packages yet.

- **Accepted area:** the whole 7 km near range must lie inside one LOLA 5 m tile. On the ~16 km
  Site01/04/07/11/20 tiles that is roughly a 2 km box around the tile centre. Points outside it are
  rejected; the 80 m regional DEM is never used as a silent fallback for the near field.
- **Time range:** `--start`/`--stop` default to 2026-11-01T00:00:00Z … 2027-11-01T00:00:00Z, must lie in
  that range and on the 600 s grid, and `--stop` must be after `--start`. Longitude is normalised to
  (−180, 180].
- **One observer:** horizon, ephemeris and year series use the same eye, surface height + 2 m
  (`extended.json` `year.observer`).
- **Warnings:** far terrain missing from the 80 m DEM is reported in `horizon.json` and `site.json`
  `warnings`, never set to zero.
- **Rejections** exit with code 2 and an English reason. Nothing is written: the package is built in a
  temporary directory and renamed into place only when complete.

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
