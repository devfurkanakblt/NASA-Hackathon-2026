# Data Contract (v1) — `public/data/`

Produced offline by `preprocess/` (Person A). Consumed by the web app (B, C, D).
**Frozen after team approval. Any change bumps `version` and is announced.**

## Conventions

| Quantity | Unit / convention |
|---|---|
| Length, height, distance | metre (`m`), suffix `M` in field names |
| Time instant | UTC, ISO-8601 with `Z` (e.g. `2026-11-15T00:00:00Z`) |
| Time interval | second (`s`), suffix `S` |
| Angle | degree (SI-accepted unit), suffix `Deg` |
| Azimuth | from local **north**, **clockwise toward east**, range `[0, 360)`. N=0, E=90, S=180, W=270 |
| Elevation | angle above the local horizontal plane, positive up, range `[-90, 90]` |
| Longitude | **east-positive**, range `(-180, 180]` |
| Power / energy (D's engine) | W / J internally; UI may show Wh |

Reference frame: MOON_ME (mean Earth / polar axis, DE421-compatible), reference sphere R = 1 737 400 m.
LOLA heights are relative to that sphere. Horizons reports `Center pole/equ: MEAN_ME`, consistent with LOLA.

"Local north" at the south polar sites is the direction toward the Moon's north pole along the surface (i.e. away from the south pole).

Time series do **not** carry a time array: `t[i] = startUtc + i * stepS`.

## `sites.json`

```json
{
  "version": 1,
  "coverage": { "startUtc": "2026-11-01T00:00:00Z", "endUtc": "2027-01-01T00:00:00Z", "stepS": 600 },
  "sites": [
    {
      "id": "Site01",
      "name": "Connecting Ridge",
      "latDeg": -89.4632,
      "lonDeg": -137.49,
      "surfaceElevationM": 1234.5,
      "observerHeightM": 2.0,
      "coordSource": "NASA Lunar Surface Data Book (M2M-30044, Mar 2025), Table A2.1-1",
      "demNear": "LOLA 5 m/px Site01 (Barker et al. 2021)",
      "demFar": "LDEM_80S_80MPP_ADJ (Barker et al. 2023)",
      "label": "Research region center — not a certified landing site",
      "warnings": []
    }
  ]
}
```

Optional fields for derived evaluation points (e.g. `Site04R`): `derivedFrom` (catalogue site id) and `derivation` (the reproducible rule, see `preprocess/ridge.py`). `warnings` may hold site notes (e.g. the Site04 catalogue coordinate lies on a ~32° crater wall) — show them in the UI.

Optional `category`: `"contrast"` marks comparison points away from the pole (`CE6`, `Apollo11`). They have no `map.json`, their terrain comes from the global LOLA DEM, and the UI lists them separately. Absent = south-pole site.

`surfaceElevationM` is the DEM height at the site. Observer eye = `surfaceElevationM + observerHeightM`.

## `{siteId}/ephemeris.json`

```json
{
  "version": 1,
  "siteId": "Site01",
  "source": "jpl-horizons",
  "generatedUtc": "2026-11-14T22:00:00Z",
  "settings": { "center": "coord@301", "refraction": false, "observerHeightM": 2.0, "frame": "MOON_ME" },
  "startUtc": "2026-11-01T00:00:00Z",
  "stepS": 600,
  "count": 8785,
  "sun":   { "azDeg": [], "elDeg": [], "distanceM": [] },
  "earth": { "azDeg": [], "elDeg": [], "distanceM": [] }
}
```

`elDeg` is relative to the local horizontal plane, **not** to the terrain. Terrain blocking is applied using `horizon.json`.

## `{siteId}/horizon.json`

```json
{
  "version": 1,
  "siteId": "Site01",
  "azStepDeg": 0.1,
  "count": 3600,
  "elevDeg": [],
  "distanceM": [],
  "params": {
    "nearRangeM": 7000, "nearStepM": 2.5,
    "maxRangeM": 250000, "farStepM": 40,
    "minRangeM": 10, "curvature": true
  },
  "warnings": []
}
```

`nearStepM` and `farStepM` are ray sampling steps, not DEM resolutions. Optional `params.nearDem` names the DEM when the near field does not come from a LOLA 5 m product: the contrast points `CE6` and `Apollo11` use `"LDEM_64 (~474 m/px)"` and carry a matching note in `warnings`.

Optional: `refinedAzDeg` (azimuths recomputed with halved steps) and `coverageLimitedAzDeg` (azimuths where terrain beyond the regional DEM's -80 deg edge could raise the horizon; absent when there are none, which is the case for all current sites).

- `elevDeg[i]` = terrain horizon elevation at azimuth `i * azStepDeg`.
- `distanceM[i]` = distance to the terrain point that forms the horizon. Use it in the UI as "blocked by a ridge X km away".

## `{siteId}/terrain.json` (3D only, visual)

```json
{
  "version": 1,
  "siteId": "Site01",
  "frame": "local ENU, origin at observer eye; x = east, y = north, z = up",
  "sizeM": 10000,
  "n": 256,
  "cellM": 39.2,
  "zM": []
}
```

- `zM` is row-major, `n*n` values, row 0 = southernmost (y = -sizeM/2), column 0 = westernmost (x = -sizeM/2).
- This grid is **for visualisation only**. Visibility always comes from `horizon.json`.

## `{siteId}/map.json` (regional map, added in v1 without breaking changes)

Summary values on a grid around the site, for the "alternative point in the same region" view.
Each cell has its own terrain horizon and its own Sun/Earth directions (see `docs/validation.md` §6).

```json
{
  "version": 1,
  "siteId": "Site01",
  "grid": { "nx": 61, "ny": 61, "spacingM": 100, "halfSizeM": 3000,
            "originENU": "site center (sites.json latDeg/lonDeg)",
            "order": "row-major, row 0 = south, col 0 = west",
            "cellCenter": "eastM = -halfSizeM + col*spacingM, northM = -halfSizeM + row*spacingM" },
  "coverage": { "startUtc": "2026-11-01T00:00:00Z", "endUtc": "2027-01-01T00:00:00Z", "stepS": 600, "count": 8785 },
  "latDeg": [], "lonDeg": [], "surfaceElevationM": [],
  "sunPct": [], "earthPct": [], "bothPct": [], "sunDiskFractionMean": [],
  "longestNoSunS": [], "longestNoEarthS": [],
  "slopeDeg": [],
  "method": { "horizon": "...", "ephemeris": "...", "visibility": "...", "slope": "...", "observerHeightM": 2 },
  "warnings": []
}
```

- All arrays have `nx * ny` values in the order given by `grid.order` (same as `terrain.json`). Index of a cell: `row * nx + col`. The centre cell (`row = col = (nx-1)/2`) is the site itself.
- `sunPct`, `earthPct`, `bothPct`: percentage of samples with `el > horizonAt(az)` (same rule as the site files) over `coverage`. `bothPct` = Sun and Earth at the same sample.
- `longestNoSunS`, `longestNoEarthS`: longest continuous run without Sun / Earth, seconds. A value equal to `(count) * stepS` means "never visible in the period".
- `slopeDeg`: terrain slope over a 25 m baseline from the 5 m DEM; `null` if not covered. Terrain descriptor only, not a landing-safety assessment.
- `surfaceElevationM`: DEM height of the cell (observer eye = this + 2 m).
- This file is a summary only; it holds no time series. Per-cell horizons for a full simulation are in `cells.bin` (see `extended.json` below): with them the app runs the energy simulation for a map cell, re-projecting the site's Sun/Earth series into the cell's own local frame (`src/sim/cell.ts`). Without `cells.bin`, show the numbers here as a summary for that period.
- Site01/04/04R/07 use 100 m cells (61×61); Site11/20/23 use 200 m cells (31×31). Always read `nx`, `spacingM` from the file.

## `{siteId}/season.json` (one-year summary, added in v1 without breaking changes)

The terrain horizon does not change; only the ephemeris is re-queried (JPL Horizons, same settings, 10-minute steps) for one year. This file holds monthly summaries; the year series itself is published separately as `year.bin` (see below).

```json
{
  "version": 1,
  "siteId": "Site01",
  "source": "jpl-horizons",
  "coverage": { "startUtc": "2026-11-01T00:00:00Z", "endUtc": "2027-11-01T00:00:00Z", "stepS": 600, "count": 52561 },
  "year":       { "samples": 52561, "sunPct": 47.4, "earthPct": 40.03, "bothPct": 0, "sunDiskFractionMean": 0,
                  "longestNoSunS": 0, "longestNoEarthS": 0, "sunElMaxDeg": 0, "sunElMinDeg": 0, "earthElMaxDeg": 0 },
  "mainPeriod": { "startUtc": "2026-11-01T00:00:00Z", "endUtc": "2027-01-01T00:00:00Z", "...": "same fields" },
  "months": [ { "month": "2026-11", "startIndex": 0, "endIndex": 4320, "...": "same fields" } ]
}
```

- `months[k]` covers samples `[startIndex, endIndex)` of the year series (calendar month, UTC).
- `mainPeriod` uses exactly the samples of `ephemeris.json`; its percentages equal `docs/reference/visibility.json` (checked when the file is built).
- `sunElMaxDeg` / `sunElMinDeg`: Sun elevation above the local horizontal plane (no terrain). When `sunElMaxDeg` is below the terrain horizon in the Sun's direction the month has no sunlight, which is the seasonal effect to show.

## `{siteId}/extended.json`, `year.bin`, `cells.bin` (loaded per site on demand, added in v1 without breaking changes)

Written by `python -m preprocess.extended` from existing caches only. Not part of the first page load; the app fetches them for one site when a scenario needs them. If they are missing, the two-month simulation keeps working.

```jsonc
{
  "version": 1, "extendedSchema": 2, "siteId": "Site01",
  "year": { "file": "year.bin", "sha256": "…", "startUtc": "2026-11-01T00:00:00Z", "endUtc": "2027-11-01T00:00:00Z",
            "stepS": 600, "count": 52561, "source": "jpl-horizons",
            "observer": { "latDeg": -89.4632, "lonDeg": -137.49, "eyeM": 1946.77 },
            "fields": ["sun.azDeg","sun.elDeg","sun.distanceM","earth.azDeg","earth.elDeg","earth.distanceM"] },
  // only for sites with map.json:
  "cells": { "file": "cells.bin", "sha256": "…", "azStartDeg": 0, "azStepDeg": 1, "count": 360, "coverageDeg": 360,
             "unitDeg": 0.01, "horizonResolutionDeg": 1, "n": 3721, "eyeM": [ /* n values */ ],
             "grid": { "nx": 61, "ny": 61, "spacingM": 100, "halfSizeM": 3000 } }
}
```

- `extendedSchema: 2` adds the fields below. `sha256` is the hex SHA-256 of the `.bin` file; `year.endUtc` is the inclusive last sample.
- `year.observer`: the site position and eye height (surface + 2 m) the year series was computed for; equals the `sites.json` observer used for `horizon.json`. `year.fields`: block order of `year.bin`.
- `cells.azStartDeg` / `azStepDeg` / `count` / `coverageDeg`: azimuth of column `j` is `azStartDeg + j × azStepDeg` (full 360° circle). `horizonResolutionDeg` is the stored resolution (1°). `cells.grid`: map grid, same as `map.json.grid`; `n = nx × ny`.
- The generator refuses to write `year.bin` with non-finite values or `cells.bin` containing the `-32768` sentinel.

- **`year.bin`**: little-endian float32, six blocks of `count` values in this order: `sun.azDeg, sun.elDeg, sun.distanceM, earth.azDeg, earth.elDeg, earth.distanceM`. Coverage `2026-11-01T00:00:00Z` … `2027-11-01T00:00:00Z`, `stepS` 600, count 52 561 (both ends inclusive). Same observer and settings as `ephemeris.json`; the first `ephemeris.json.count` samples equal it within float32 rounding (angles ≤ 1e-4°).
- **`cells.bin`**: little-endian int16, unit `unitDeg` (0.01°). Row = cell in `map.json` order (row 0 = south, col 0 = west, row-major), 360 columns = azimuth `j × 1°`. Taken as every second column of the 0.5° map horizons (decimation, not averaging: a horizon value is a maximum, an average would invent a value). No `distanceM`.
- `cells.eyeM[i]`: eye height of cell `i` above the 1737.4 km sphere (surface + 2 m).

## `{siteId}/refined.json` (optional, finalist map cells with the 0.1° horizon)

Written by `python -m preprocess.refine_cells --site Site01 --cells r36c32 …` (or `--reference` for the presentation cells). A few map cells recomputed with exactly the catalogue horizon recipe (`horizon.json`: same ray marcher, halved-step refinement, DEMs and 250 km range, 0.1° azimuth step) from the same observer as the cell: `map.json` cell centre and `cells.eyeM[i]`.

```jsonc
{ "version": 1, "siteId": "Site01", "cellsSha256": "<cells.sha256 of extended.json>",
  "cells": { "r36c32": { "latDeg": …, "lonDeg": …, "eyeM": …, "azStepDeg": 0.1, "count": 3600,
                         "elevDeg": [ … ], "distanceM": [ … ], "warnings": [ … ] } } }
```

- Missing file: cells keep the 1° screening horizon. A file whose `cellsSha256` differs from `cells.sha256` is stale and is ignored with a warning (never used); so is an entry whose `latDeg`/`lonDeg`/`eyeM` differ from the map cell.
- `warnings`: the near-field fallback and far-terrain coverage warnings of this horizon, as for `horizon.json`. A refined cell has `provenance.horizonSource: 'refined-cell'`, `horizonResolutionDeg: 0.1`, `precision: 'catalogue'`. It is still not a catalogue site, and good illumination does not mean flat or safe terrain.

## `coverage.json` (supported area and time range, added in v1 without breaking changes)

Written by `python -m preprocess.coverage` from `sites.json`, each site's `map.json`, `extended.json`, `horizon.json` and the DEM tile bounds. Optional: if it is missing or invalid the app still loads (`LoadedData.coverage` is then undefined).

```jsonc
{ "version": 1,
  "time": { "startUtc": "2026-11-01T00:00:00Z", "endUtc": "2027-11-01T00:00:00Z", "stepS": 600,
            "mainPeriodEndUtc": "2027-01-01T00:00:00Z" },
  "catalogue": [ { "siteId": "Site01", "latDeg": -89.4632, "lonDeg": -137.49, "horizonResolutionDeg": 0.1 } ],
  "maps": [ { "siteId": "Site01", "halfSizeM": 3000, "spacingM": 100, "horizonResolutionDeg": 1,
              "summaryResolutionDeg": 0.5, "summaryPeriod": ["2026-11-01T00:00:00Z", "2027-01-01T00:00:00Z"] } ],
  "dems": [ { "name": "LOLA 5 m/px Site01", "kind": "local-5m", "bounds": { "crs": "...", "xMin": -19000, "yMin": -20000, "xMax": -3000, "yMax": -4000 } },
            { "name": "LDEM_80S_80MPP_ADJ", "kind": "regional-80m", "latMaxDeg": -80 },
            { "name": "LDEM_64", "kind": "global-474m" } ],
  "freePoints": "not supported in the app; generate a package with python -m preprocess.custom_point" }
```

- `catalogue` lists every site in `sites.json` (including contrast points); `maps` only those with `map.json`. Read resolutions from here, never assume them.
- `bounds` are in the DEM's own south-polar-stereographic metres. `preprocess.coverage.classify_point(lat, lon)` returns `kind` = `map-cell`, `local-5m`, `regional-80m`, `global-only` or `invalid`, plus `tile` and an English `reason`. `local-5m` only when the whole 7 km near range lies inside a 5 m tile; a point nearer the tile edge is `regional-80m`.
- Longitude wraps at 180 degrees (one normalisation per language): 222.51 and -137.49 are the same point, as are 180 and -180.
- TypeScript: `pointCoverage(lat, lon, cov, bySite)` in `src/data/coverage.ts` returns `catalogue`, `map-cell` (via `snapToCell`) or `outside`; the `outside` message names the nearest map and its distance.

## Search data flow (A/D)

`src/sim/moonFixed.ts` turns the one-year ephemeris of a data package into Moon-fixed Sun and Earth positions once, then projects any cell for any window of samples.

```ts
moonFixedKey({ dataHash, latDeg, lonDeg, eyeM, horizonResolutionDeg }): string
moonFixedSeries(year: EphemerisDoc, centre: Observer, key: string): MoonFixedSeries   // cached by key
projectWindow(mf: MoonFixedSeries, cell: Observer, i0: number, i1: number): EphemerisDoc // samples [i0, i1)
```

- `MoonFixedSeries.sun` / `.earth` are `Float64Array` of 3·`count` Moon-fixed metres (x, y, z per sample). The series also carries `meta` (siteId, source, ...) so a projected window is a normal `EphemerisDoc`.
- The key is `dataHash|lat|lon|eyeM|horizonResolutionDeg` with `lat`/`lon` rounded to 1e-7°, `eyeM` rounded to 0.01 m and the horizon resolution as is. A different `dataHash` (`provenance.dataHash`, the year.bin SHA-256) never reuses an entry. The cache keeps the 8 most recently used series.
- `projectWindow` returns samples `[i0, i1)` with `startUtc` advanced by `i0·stepS`; a window outside `[0, count]` throws `CoverageError`. Azimuth is normalised to [0°, 360°).
- `cellEphemeris(eph, centre, cell)` keeps its signature and behaviour: an uncached series followed by `projectWindow(series, cell, 0, count)`. Caching happens only through `moonFixedSeries`.
- `map.json` percentages (`sunPct`, `earthPct`, `bothPct`) are not used in this flow; every number of a search comes from the horizon and the projected ephemeris.
- Measured in Node (Site01, 3721 cells, one window of 1008 samples each, series already built): about 0.52 s for the whole grid (three runs: 517, 510, 526 ms), well inside D's ~5 s budget.

## `{siteId}/terrain-far.json`, `earth-orientation.json` (3D only, visual; written by C)

Optional display files for the 3D scene. They are not used for visibility or energy, and the loader treats a missing or invalid file as a visual warning only.

- **`terrain-far.json`**: coarse regional terrain around `terrain.json`, same shape and frame as `terrain.json`. Written by `python -m preprocess.regional_moontrek` (NASA Moon Trek, LOLA 30 m/px south-pole DEM).
- **`earth-orientation.json`**: Earth texture orientation registered to UTC for each ephemeris sample. Written by `python -m preprocess.sky_orientation --crosscheck`; tied to the site's coordinates and `ephemeris.json`, so it must be rebuilt if either changes (the loader rejects a stale file).

Method, sources and checks: `docs/c-3d-validation.md`.

## Visibility rule (shared by B and D)

```ts
// circular linear interpolation of the horizon profile
function horizonAt(h: Horizon, azDeg: number): number {
  const x = (((azDeg % 360) + 360) % 360) / h.azStepDeg;
  const i0 = Math.floor(x) % h.count, i1 = (i0 + 1) % h.count, f = x - Math.floor(x);
  return h.elevDeg[i0] * (1 - f) + h.elevDeg[i1] * f;
}
const visible = (el: number, az: number, h: Horizon) => el > horizonAt(h, az);
```

Optional partial Sun disk: angular radius ≈ `0.2666 * 1.495978707e11 / distanceM` degrees; visible fraction ≈ clamp((el − horizon + r) / (2r), 0, 1).

## Mission catalogue extension (A, 15 Nov 2026)

`sites.json` additionally publishes 23 source-pinned points: Apollo 12/14–17, IM-1/IM-2,
Blue Ghost 1, Chandrayaan-3, SLIM, Chang'e-3/4/5, the centre of Peregrine's historical
target region, and nine published research candidates representing NASA's October 2024
Artemis III candidate-region list. The original nine entries retain their data and identifiers.

Optional entry fields (preserve them when copying a site):

| Field | Meaning |
|---|---|
| `program`, `mission` | Mission grouping and name; not a current operational-status feed |
| `coordinateStatus` | `landed`, `region-representative`, or `research-candidate` |
| `regionSource` | Dated primary region-list URL, separate from the coordinate source |
| `coordSource` | Primary URL or DOI and table/candidate identifier |

The region representatives are point samples, not polygons or selected landing sites.
Peregrine did not land; its record is the IAU feature centre of Sinus Viscositatis.
Do not describe all entries as certified, historical landings, or 5 m terrain. `demNear`,
`demFar`, `label`, and `warnings` describe the actual source/limitations. 0.1° is the azimuth
sampling interval, not an absolute angular-accuracy claim. New points have no regional
`map.json` unless explicitly provided. Test file existence; category alone is insufficient.
The existing seven regional maps retain their period, grids and cell data.

## Portable scientific package / generation boundary (A → B/D)

The static browser app does not run Python or provide a generation service. A service/worker
adapter owned by B/D can accept this request, or let a user import a generated folder:

```json
{
  "version": 1,
  "id": "MyPoint",
  "latDeg": -89.4632,
  "lonDeg": -137.49,
  "startUtc": "2026-11-01T00:00:00Z",
  "endUtc": "2029-11-01T00:00:00Z",
  "terrain": "local5m",
  "ephemerisSource": "skyfield"
}
```

This maps directly to `python -m preprocess.custom_point --id ... --lat ... --lon ...
--start ... --stop ... --terrain ... --source ...`. `id` starts with a letter and contains
1–32 letters/digits/underscores/hyphens; catalogue ids are reserved. Latitude is [-90,90],
longitude is normalised to (-180,180]. All inputs must be finite. Date endpoints must be
UTC on the 600 s grid, inside 2000-01-01 … 2040-01-01, increasing, with at most 1830 days
per package. The checked-in 2026–2029 Connecting Ridge example demonstrates a real
three-year series. The generator's allowed dates do not extend existing catalogue data.

`terrain` is an explicit accuracy choice:

- `local5m` (default): the entire 7 km near range must fit one available 5 m tile, else reject.
- `regional`: south of 80°S, 80 m regional DEM; missing far terrain remains warned about.
- `global`: any lunar coordinate, global LDEM_64 (~474 m/px). Longitude interpolation is
  periodic; polar edges use nearest real raster pixels. Small terrain hazards are unresolved.

Rejected input exits with code 2 and an English reason. Build failures do not publish a custom
package: generation uses a temporary folder, then renames the completed result. A future
service must execute an argument array (never interpolate inputs into a shell), propagate
failure/cancellation, and publish only the completed folder. There is no silent snap, time
clamp, synthetic zero horizon, or implicit switch to coarser terrain.

Each folder contains `site.json`, `horizon.json`, `terrain.json`, `ephemeris.json`,
`year.bin`, `extended.json`, and `package.json`. The horizon includes an explicit
`observer: {latDeg, lonDeg, eyeM}` matching the extended header; surface height is rounded
before all calculations so the same observer is used. `ephemeris.json` starts at the requested
start and covers up to 61 days. Despite its historical filename, `year.bin` covers the complete
requested period. Its header has the actual start/end/count, never an assumed 52,561 samples.
Terrain display is normally 10 km wide; if DEM coverage requires a smaller patch its `sizeM`
and site warning say so. Scientific horizon coverage is independent of this visual footprint.

`package.json` schema (`ScientificManifest` in `src/data/scientificPackage.ts`):

```text
version: 1, kind: "lunar-scientific-package", siteId
observer: {latDeg, lonDeg, eyeM}
coverage: {startUtc, endUtc, stepS, count}       # inclusive binary series
ephemeris: {startUtc, stepS, count, source}      # short JSON series
horizonResolutionDeg, warnings: string[]
files: { <each of the six filenames>: {bytes, sha256} }
```

`public/data/packages.json` lists relative manifest paths, manifest hashes, coordinates and
actual per-package coverage. It excludes unrelated local custom packages. No importer should
replace an existing scenario or overwrite a catalogue point without an explicit UI action.

Integration: collect the seven files as `Record<string, ArrayBuffer>` and call
`await parseScientificPackage(files)`. It validates sizes and SHA-256 hashes, supported
schemas, coordinate/observer agreement, full 360° horizon coverage, physical finite values,
and matching main/binary series. It returns `{manifest, header, data}`; `data: SiteData` already
contains the full-period ephemeris and provenance and can be passed to `evaluateScenario`.
Use its own coverage for date controls and last-valid-start calculation. Existing `sites.json`
coverage remains the main catalogue period; `coverage.json.time` remains its one-year
extension. B owns upload/generation UI and job progress/cancel; D owns service/motor wiring.

New packages and the three-year example are independently checked against Horizons at
14 epochs per body spanning the full period, with 32-azimuth horizon convergence checks.
See [validation-missions.md](validation-missions.md); hashes bind the measurements to files.

## Sample fixtures

`public/data/_sample/` holds synthetic JSON fixtures (`source: "synthetic"`). Published binary scientific packages accept only `jpl-horizons` or `skyfield-de421` sources.
