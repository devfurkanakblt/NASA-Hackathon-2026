# Person C: terrain and registered Earth display

This change is based on `main` commit `2357d7d5c866653421917f0bd123467dfa32dede`, including A's nine-site expansion and the current B/D interface handoff, and includes the previously unmerged C regional-terrain work. The follow-up integration connects C's optional props in B's main screen and keeps B's regional map, seasonal chart and shareable scenarios. Person D's simulation functions/tests and Person A's scientific site catalogue, local terrain, horizon and ephemeris files remain unchanged by C.

## Terrain geometry

The old regional mesh lowered only its sparse vertices by 25 m. Its large triangles still crossed the detailed terrain, reaching 129.94 m above local vertices at Site04. The new implementation clips the actual coarse triangles outside the detailed footprint. An explicit vertical LOD seam joins the two measured boundary curves. Neither input height grid is lowered or edited.

`src/scene3d/regionalGeometry.test.ts` independently checks triangle/rectangle intersection, projected area conservation, winding, duplicate faces, unchanged source heights, exact boundary coverage and the outer reference-sphere boundary. These tests use every catalogue site that has a regional grid, not a fixed list of site IDs.

- Detailed visual grid: the original A `terrain.json`, typically 256 x 256 over 10 km.
- Regional visual grid: 192 x 192 over 240 km, 1.25 km output cells.
- Regional source: NASA Moon Trek `LRO_LOLA_DEM_SPole75_30mp_v04`, native 30 m pixels, requested at 250 m by bilinear resampling and averaged into the display grid.
- For the CE6 and Apollo11 contrast points outside that polar product, the generator reuses A's verified PDS LOLA LDEM_64 reader (about 474 m per native pixel, 0.5 m per height DN). Cached row hashes, row bounds, source URL and scale are recorded. It does not use polar heights at equatorial locations.
- The generator checks the returned GeoTIFF projection numerically, uses its actual transform, rejects no-data and records the source SHA-256, dimensions, projection, resampling, observer and catalogue-coordinate metadata.
- The grey reference sphere is only drawn beyond the measured mesh. It is a reference datum, not measured terrain.
- Vertical exaggeration is 1. The display mesh is downsampled; small stones and lander-scale relief are unresolved. LOD join faces are display connections and do not cast invented ridge shadows.
- Local and regional meshes use a shared neutral, rough material with weak specular response; no invented rocks, albedo or noise texture is added. Local and regional mesh shading uses the actual solar direction. Local sunlight absence does not switch off lighting for every mountain in the region. The scientific visibility flag still controls the lander's status/panel indicator. Mesh shadows remain a visual approximation.
- The **Relief lighting (view aid)** control is on by default for readable terrain. It adds neutral hemisphere and inspection light, with at most 8% normal-derived contrast. Switching it off leaves Sun-only illumination. Neither mode claims a calibrated lunar photometric model.

Reproduce regional visual data, after A generates the catalogue and scientific files:

```sh
python -m preprocess.regional_moontrek
```

The generator reads `public/data/sites.json`, including new site IDs. It does not require adding IDs to C's code. The selected product must cover the requested crop; unsupported coordinates/no-data are errors, not synthetic fill. All nine current sites have regional visual grids. Scientific `horizon.json` remains independent and can extend to 250 km.

## Sun and Earth appearance

- The body centres, distances and terrain visibility use A's existing apparent topocentric ephemeris and D's existing engine output.
- The solar disc retains the data-contract angular-size rule. It is drawn without a fake atmospheric halo; the Moon has no atmosphere to produce one.
- Earth's apparent spherical limb uses the angular diameter, with sphere radius `displayDistance * sin(diameter/2)`. Geometry is unit-sized and scaled without rebuilding a sphere at every time step.
- The procedural invented Earth continents have been removed. The surface image is NASA's **Blue Marble: Next Generation, November 2004**, resampled to 2048 x 1024. `docs/c-assets.json` records the official NASA page, source URL, source/derivative hashes, transform and credit.
- This is an archival cloud-free composite, not live clouds or 2026 weather. Baked topographic/bathymetric shading belongs to the original NASA image. Its colour is not an independently calibrated radiometric model.
- Rigid-Earth attitude is computed at the Earth's emission epoch (reception minus observer-Earth light travel time), using ITRS -> ICRF -> MOON_ME_DE421 -> local ENU -> Three axes. UT1 comes from Skyfield's bundled delta-T tables. Polar motion is not applied.
- Lighting direction is evaluated at Earth, rather than copied from the lunar observer's solar direction. Shader daylight is Lambertian; atmospheric scattering, terrain and dynamic weather are not modelled.
- The texture's Greenwich meridian/east longitude and north pole are registered to the sphere, independently of the body-position aim rotation. Time interpolation uses shortest-path quaternion SLERP.
- If a new site lacks optional orientation data, or A changes its coordinate so the file becomes stale, the map is hidden and an explicit visual warning is returned. The display does not invent a geographic rotation. Scientific calculations remain available.

Install C preprocessing dependencies with `python -m pip install -r preprocess/requirements-c.txt`. The app itself uses checked-in assets and needs no Python/NASA connection at runtime. To reproduce the NASA image derivative, download the exact `sourceUrl` in the manifest and use `python -m preprocess.sky_orientation --texture-source <original.jpg>` (the source hash is checked).

Regenerate display orientations for all current catalogue sites:

```sh
python -m preprocess.sky_orientation --cache-dir data_raw --crosscheck
```

The extra file is `public/data/{siteId}/earth-orientation.json`. This operation does not rewrite A's `sites.json`, `ephemeris.json`, `horizon.json` or `terrain.json`.

### Independent orientation consistency check

JPL Horizons Q14 (subobserver longitude/geodetic latitude) and Q17 (north-pole position angle) were queried sequentially at three epochs per site: 27 checks across nine sites. Measured maximum absolute differences:

- Longitude: **0.002152 degrees**.
- Geodetic latitude: **0.000963 degrees**.
- Pole position angle: **0.000065 degrees**.

All are below the chosen 0.01 degree consistency threshold. The manifest stores exact query parameters, raw result hashes, reference orientation/EOP labels and individual results. This is a sampled comparison, not a guarantee of absolute accuracy at every time. Differences include Earth-orientation prediction/polar-motion and finite precision of the input centre directions.

## Loader and scene isolation

Required scientific JSON is validated before evaluation: supported version, site ID, UTC coverage, reference frame, observer height, array lengths, finite angles/distances and complete horizon azimuth grid. Invalid science causes an explicit error; no zero horizon or invented ephemeris is substituted.

`terrain.json`, `terrain-far.json` and `earth-orientation.json` are optional visuals. Their absence/malformation returns `visualWarnings` and leaves valid scientific data available. The 3D wrapper accepts missing local terrain and shows a bounded fallback. Changing to a new valid terrain resets a previous scene error.

New catalogue IDs are loaded dynamically. Tests include a new site absent from the original registry, optional terrain 404, invalid frames, broken arrays, missing orientation and a changed catalogue coordinate with a stale Earth display file.

## Component integration

The existing import remains:

```tsx
import { MissionScene3D } from './scene3d'
```

Existing props keep their meaning. Added optional props:

```tsx
<MissionScene3D
  terrain={data.terrain}
  farTerrain={data.terrainFar}
  horizon={data.horizon}
  sun={sunState}
  earth={earthState}
  earthOrientation={earthOrientationAt(data.earthOrientation, displayedUtc)}
  earthSunDirection={earthSunDirectionAt(data.earthOrientation, displayedUtc)}
  panelPowerW={result.generationW[k]}
  /* existing panel, sky tracks, observerHeightM and surfaceElevationM */
/>
```

`earthOrientationAt` and `earthSunDirectionAt` are pure helpers in `src/scene3d/appearance.ts`; they do not import Three.js into the main bundle. Use the engine's `alignedStartUtc` or `sampleUtc` for the displayed UTC. Both the main planner and the C-owned temporary harness now provide these connections. The main planner also displays C's optional-data warnings in Sources and model.

### Main-screen integration

`src/app/MissionApp.tsx` now passes `farTerrain`, `earthOrientation`, `earthSunDirection` and `panelPowerW`, using the active scenario and the exact displayed UTC. `Sources.tsx` exposes `visualWarnings` with duplicate messages removed. B's map, season and share functions are preserved. The data loader combines both extensions instead of replacing B's new files with the older C-only shape.

The annual season range is independent of the mission ephemeris range. Regional-map missing cells may be `null` and remain unavailable rather than being turned into zero. Contrast sites do not request regional `map.json` files. These optional summaries never replace the per-site horizon or ephemeris used by the engine.

`panelPowerW` lets the visual panel indicator follow the existing engine when its optional partial-Sun mode is used. The 3D view does not change power, visibility windows, battery integration or model selection.

## Readability follow-up

The display uses ACES tone mapping, exposure 1.1, a 1.5–2 pixel ratio, and 4096 soft solar shadow maps fitted to the local patch (light at 45 km, shadow depth 30–60 km). These settings improve readability; shadows still do not decide scientific visibility. The regional mesh now renders in both cameras, with the horizon silhouette outside its measured boundary rather than a flat wall in front of it. Sun/Earth positions and apparent diameters remain unchanged. Earth uses the same tone-mapping pipeline as the terrain.

Selecting Earth in the lander camera sets an 18-degree inspection field of view; Sun uses 32 degrees. This is camera zoom, not an enlarged body model. Playback preserves later manual zoom. No finer terrain detail is claimed than the source grid resolves.

The browser date-input regression was fixed in `ScenarioList.tsx`: input and change events both update the validated UTC value. A manual 18 November entry now updates the shared UTC, panorama and scene together.

A 30-second silent step-through demo is delivered separately as `C-3D-Demo.mp4`. It uses actual UI frames at Site23, 18 November 2026: Earth is terrain-blocked at 00:30 and visible at 00:40 UTC. Frames are held for readability; this is not real-time video or a claim of event timing to the minute.

## Tests and manual QA

Measured on this Windows computer: **200 JavaScript/TypeScript tests and 39 C Python tests passed; production build passed**. The build reports a large lazy Three.js scene chunk (~262 kB gzip); the main bundle remains separate (~93 kB gzip).

Manual checks: all nine sites in overview and lander cameras; registered Earth/Sun targets; date input and UTC readout; GPU context loss and recovery; malformed-terrain fallback with scientific readouts preserved; 390 x 844 responsive scene/source details. A local ten-run benchmark loaded nine sites (7 maps, 9 seasons, 9 regional meshes and 9 Earth orientations) without warnings; evaluating three cached scenarios took 0.78–5.66 ms, mean 1.76 ms, with zero extra data requests. This is this computer’s computation timing, not a browser FPS or cross-device guarantee. A physical phone was not available; 390 x 844 browser layout was checked.

The merged main screen was loaded, then its own local HTTP server was stopped. Switching to scenario B, overview camera and playback still worked; its regional map and annual chart remained available without a load error. The earlier C-only test also passed site/date/target changes with its server stopped. This checks loaded-page isolation; cold starts still require serving the local bundle. No OS network settings were changed.

Repeatable commands:

```sh
npm test
npm run build
python -m pytest preprocess/tests/test_sky_orientation.py preprocess/tests/test_c_regional.py -q
```

The C-only development harness at `/?demo=3d&diagnostics=1` has a GPU context-loss button and render/GPU resource readouts. Diagnostics are hidden by default; no user-facing production flow needs them. A malformed-terrain scene can be checked with `/?demo=3d&fail=terrain`.

Browser checks include both cameras, Sun/Earth look targets, time slider, +24/+72 shifts, fixed/tracking panel, annotation and relief controls, GPU context loss/reload, and preserving calculation readouts when the 3D scene fails. Device-specific timings and final nine-site manual results are recorded in the local handoff summary, not represented as NASA model accuracy.

## References

- NASA challenge resources: https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/
- NASA Moon Trek: https://trek.nasa.gov/moon/
- NASA regional product service: https://trek.nasa.gov/moon/trekarcgis/rest/services/LRO_LOLA_DEM_SPole75_30mp_v04/ImageServer
- NASA Blue Marble source/derivative: see `docs/c-assets.json`.
- JPL Horizons quantities: https://ssd.jpl.nasa.gov/horizons/manual.html#obsquan
- Skyfield frame documentation: https://rhodesmill.org/skyfield/coordinates.html#rotation-matrices

NASA data is credited separately; no generated image replaces a NASA observation. This module is a scientific-data visualisation prototype with the limits above, not a flight-qualified mission simulator.


## Follow-up review at main 22b365f

Only a small lighting adjustment was implemented in this follow-up: exposure 1.2 -> 1.1, hemisphere fill 0.9 -> 0.75, inspection directional fill 1.1 -> 0.9. Solar direction, solar-light intensity, terrain geometry and scientific calculation code were not edited. 237 existing JS/TS tests, the build and browser shader check passed. The following items are analysis, not additional implemented features.

1. **LOD boundary quality (C).** The 39.0625 m visual grid meets a 1250 m grid, a 32-fold spacing jump. Triangle-interpolated boundary samples at Site04 differ by up to about 224.7 m between these resolutions. `terrainGeometry.ts` closes the difference with vertical faces: no overlap or hole remains, but a visible artificial cliff/line can remain. Add an intermediate resolution ring sampled from consistent source/datum, with matched boundaries. This is display error from resampling, not evidence of a real cliff or erroneous scientific horizon.
2. **Selected-cell annual chart (B/D coordination).** `cellSiteData` inherits `base.season`; the annual tab renders it without selecting a cell-specific summary. Reproduced with real `Site01:r36c32`: the inherited summary says Site01, Sun 47.4% / Earth 40.03%, while the cell's own year-series sample visibility is 65.84% / 50.90%. Compute the cell summary, or clearly show that the chart is the catalogue centre. The code was not changed during this review.
3. **Extended binary validation (shared data layer).** `parseYear`/`parseCells` check byte lengths but do not enforce all metadata/finite-value constraints used by the original JSON path. A synthetic in-memory fixture with wrong version/site, invalid UTC, zero step and float32 NaNs was accepted. Current NASA files were not changed or declared corrupt. Validate metadata and numeric arrays before these values reach evaluation.
4. **Annual registered Earth display (C).** The annual series extends to 2027-11-01; registered Earth orientation ends at 2027-01-01. Sampling April returns undefined orientation and Earth-Sun direction, so the map is safely omitted. Extend and validate the display coverage and report a date-specific visual warning. No incorrect geographic orientation should be invented.
5. **Surface detail and distant silhouette (C).** Normals currently come from the downsampled mesh; the material has no measured albedo detail. More faithful close views require a finer measured DEM mesh or DEM-derived normal map, not invented crater/noise texture. The distant horizon curtain is a one-dimensional visibility silhouette, and the exterior sphere is a smooth reference datum. Their plain shading should not be presented as measured three-dimensional relief.

Priority: fix the selected-cell summary association and extended-data validation before adding analytical claims; for visual quality, fix the LOD transition before adding more light or decorative texture. A physical illumination view and a labelled inspection view serve different purposes; the existing inspection fill should remain explicit.
