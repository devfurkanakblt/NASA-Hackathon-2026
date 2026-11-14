# Person C: terrain and registered Earth display

This change is based on `main` commit `79e657030147452c39eff8bfd34356bca29f8c79`, including A's nine-site expansion and the current B/D interface handoff, and includes the previously unmerged C regional-terrain work. It does not modify Person B's application layout, Person D's simulation functions/tests, or Person A's scientific site catalogue, local terrain, horizon and ephemeris files.

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
- Local and regional mesh shading uses the actual solar direction. Local sunlight absence does not switch off lighting for every mountain in the region. The scientific visibility flag still controls the lander's status/panel indicator. Mesh shadows remain a visual approximation.
- The optional **Relief lighting (view aid)** control adds fill light and height tint for inspection. It is off by default. It is not a measured illumination product.

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

`earthOrientationAt` and `earthSunDirectionAt` are pure helpers in `src/scene3d/appearance.ts`; they do not import Three.js into the main bundle. Use the engine's `alignedStartUtc` or `sampleUtc` for the displayed UTC. The C-owned temporary harness demonstrates all these connections; B's application code is unchanged.

### Handoff to B (no B files edited)

At the current base, the main `src/app/MissionApp.tsx` still passes only the original props. C's fully connected check view is **`/?demo=3d`**. B needs to pass `farTerrain`, `earthOrientation`, `earthSunDirection`, and `panelPowerW` as shown above, using the active scenario data and its displayed UTC. Also expose `activeData.visualWarnings` beside the existing model/source notes. Without those optional props the old main screen still works, but does not display the new regional mesh or registered NASA Earth map. This integration was deliberately left to B under the user's ownership boundary.

`panelPowerW` lets the visual panel indicator follow the existing engine when its optional partial-Sun mode is used. The 3D view does not change power, visibility windows, battery integration or model selection.

## Tests and manual QA

Measured on this Windows computer: **179 JavaScript/TypeScript tests and 39 C Python tests passed; production build passed**. The build reports a large lazy Three.js scene chunk (~262 kB gzip); the main bundle remains separate (~88 kB gzip).

Manual checks: all nine sites in overview and lander cameras; registered Earth/Sun targets; date input and UTC readout; GPU context loss and recovery; malformed-terrain fallback with scientific readouts preserved; 390 x 844 responsive scene/source details. During playback one desktop sample reported ~138 render FPS, 27 draw calls, 25 geometries and 3 textures. This is one device sample, not a device-independent guarantee. Site/camera changes did not show monotonic GPU resource growth.

The production page was loaded, then its own local HTTP server was stopped. Site23 selection, +72 h, camera/target changes and playback still worked from loaded data (00:00 to 06:20 UTC). This checks loaded-page isolation; cold starts still require serving the local bundle. No OS network settings were changed.

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
