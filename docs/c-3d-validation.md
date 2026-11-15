# C: verified terrain display and annual Earth view

Current implementation is based on main `e8b5f55`. C changes remain confined to display geometry, optional visual data, their preprocessing/validation, and minimal scene-prop wiring. The scientific catalogue, terrain/horizon/ephemeris/year binaries and the D evaluation engine are not edited by C.

## Terrain transition

The 10 km local visual grid (256 x 256, 39.0625 m cells) meets the 240 km regional grid (192 x 192, 1250 m cells). Those area averages can differ substantially at their common edge. Simply joining them vertically produced a visible wall.

The regional triangles are now clipped outside the local patch plus a **2.5 km transition band**. Square rings sampled at **156.25 m** connect the exact fine and coarse boundaries. The transition uses the coarse triangle height plus a smoothly decaying fine-boundary residual. It is explicitly **visual interpolation**, not a new measured DEM product. Source arrays are preserved; no fine/coarse source height is lowered or rewritten. There are no vertical join faces at the inner patch.

Independent tests cover projected area conservation, overlap, winding, duplicate faces, connectedness, internal two-face edges (no holes), source preservation and exact boundary matching at all nine sites. The measured maximum inner boundary gap is 0 m; outer gap is 0.000226 m. These are computational join tolerances, not DEM physical accuracy. A spatially indexed sampler makes overview-camera clearance follow the actual transition triangles.

The original regional display data remains NASA Moon Trek LOLA 30 m polar DEM, requested at 250 m then averaged into the 1.25 km display cells. CE6/Apollo11 use A's PDS global LDEM_64 reader (~474 m native pixels). Each `terrain-far.json` retains source/projection/hash/resampling metadata.

## Measured surface normals

Seven polar sites have a 1024 x 1024 `terrain-normal.png` plus `terrain-normal.json`. These maps come from the original NASA PGDA **5 m LOLA** georeferenced TIFFs. No rock, crater or noise pattern is invented. Six maps cover 10 km; Site04R uses only the fully covered centred **9 km** square because its shared Site04 native tile does not cover the requested 10 km square. Missing source areas are never filled with invented height.

The generator samples native heights, includes the same lunar curvature/observer frame as the visual terrain, computes finite gradients and encodes normalised object normals `(-dZ/dEast, 1, +dZ/dNorth)`. PNG RGB8 is linear numeric data, not a colour photograph. North is at the image top; the Three axes are +east, +up, -north. Source and PNG SHA-256, CRS, transforms, coordinates, footprint, sampling and encoding error are recorded per site. Source pixel spacing is not absolute height accuracy.

The material uses `ObjectSpaceNormalMap`, `NoColorSpace`, and a centred UV transform for the actual footprint. Detail fades back to geometric normals over its outer ~200 m; outside a smaller measured footprint only geometric shading is used. This prevents a shading edge. The coarse contrast sites receive no pretend fine detail. The seven PNGs total **8,408,434 bytes** and load locally on first viewing, then cache by content hash. A missing/malformed map is optional and never replaces scientific data.

## Annual registered Earth

All nine Earth orientation files now cover **2026-11-01 to 2027-11-01 UTC**, matching A's annual display range. They retain the source-coordinate registration, emission-time Earth rotation, ITRS -> ICRF -> MOON_ME -> local Three axes and Earth-to-Sun illumination vector. The archived NASA Blue Marble map remains November 2004, not live weather.

Hourly nodes (8761 per site) keep payload nearly constant: total orientation JSON is **7,735,395 bytes**, only 0.15% above the previous two-month files. Shortest-arc quaternion SLERP and normalised vector interpolation were compared at **394,200 intermediate 10-minute epochs**. Maximum attitude difference was **0.006916 degrees**; Sun-vector difference was **0.00001514 degrees** against the native model.

A separate sequential JPL Horizons Q14/Q17 check covered 45 epochs, including 27 between-node epochs. Maximum longitude/latitude/pole-angle differences were **0.004323 / 0.007152 / 0.006768 degrees**, all below the chosen 0.01-degree consistency threshold. Query parameters, raw hashes, per-site file hashes and results are in `docs/c-assets.json`. These checks do not guarantee absolute orientation accuracy; bundled UT1 prediction, omitted polar motion and spherical/static Earth limits remain.

The loader accepts a validated covering display grid (up to hourly) without weakening required scientific ephemeris checks. Sampling outside the visual range returns no geographic map and a date-specific warning; it never invents a rotation.

## Scene and UI

The neutral inspection light is kept at the user's reduced setting: exposure 1.1, hemisphere fill 0.75 and inspection directional fill 0.9. It is labelled as a viewing aid and can be disabled for Sun-only shading. Actual Sun direction, body angular sizes, visibility and energy outputs remain authoritative. Shadows are illustrative, not the scientific visibility source.

Controls now sit in a separate strip above the canvas, including on narrow screens. The label overlay remains attached to the canvas coordinate origin. Source/model details remain collapsed by default. The Earth camera target is 18 degrees, Sun target 32 degrees; these are camera zoom presets, not enlarged bodies. Both cameras render the measured regional mesh. The exterior smooth sphere and distant horizon curtain remain display/reference surfaces, not measured fine terrain.

## Verification snapshot

259 JS/TS tests, 55 C Python tests and production build passed. All nine catalogue sites opened in both cameras with no shader errors. The registered Earth map was checked at April 2027 in the actual main app. At 390 px width the page did not overflow, and toolbar bottom equalled canvas viewport top: controls no longer overlay the terrain. No physical phone was attached. These checks do not constitute a flight accuracy or device-independent FPS guarantee.

## Integration and reproduction

Existing `MissionScene3D` props still work. `terrain.normalDetail` is a runtime-only validated extension attached by `loadAllData`; original `terrain.json` is not rewritten. `farTerrain`, registered Earth/Sun directions, panel engine output and coverage warning are wired in the main app and C harness. Missing visual data produces a bounded fallback or explicit warning, while invalid science is rejected.

```sh
python -m pip install -r preprocess/requirements-c.txt
python -m preprocess.terrain_detail --raw-dir data_raw
python -m preprocess.terrain_detail --raw-dir data_raw --no-download
python -m preprocess.sky_orientation --cache-dir data_raw --grid year --display-step-s 3600 --crosscheck
npm test
npm run build
python -m pytest preprocess/tests/test_sky_orientation.py preprocess/tests/test_c_regional.py preprocess/tests/test_terrain_detail.py -q
```

The native DEM TIFFs and astronomy kernels are cache inputs, not committed assets. `?demo=3d` opens the C harness; `?diagnostics=1` enables main-scene diagnostics. Idle demand rendering is not reported as slow FPS. This remains a scientific-data visualisation prototype, not a flight-qualified simulator.

## Remaining handoffs to A/B/D

- **B/D: selected-cell annual chart.** `cellSiteData` currently inherits `base.season`, and the annual tab draws that catalogue-centre summary. Reproduced real `Site01:r36c32`: inherited Sun 47.4% / Earth 40.03%, versus the cell's own annual sample visibility 65.84% / 50.90%. D should supply/cache a cell summary; B should use it, or clearly label/hide the centre summary meanwhile. C does not edit their calculation/UI code.
- **A/D: extended binary data validation.** `parseYear`/`parseCells` need the equivalent metadata and finite-value checks of the JSON science path: supported version, correct site/time grid/source, safe counts, complete azimuth grid, positive scale, matching observer arrays and finite body values. Malformed synthetic fixtures were accepted; this does not claim that the current NASA binaries are corrupt. Keep annual coverage independent from the two-month mission files. Add regression tests at the data-consumer boundary.
- A map cell still has no registered 3D patch. The existing UI correctly explains this instead of pretending the catalogue terrain is at the selected cell. Extending that feature requires a separately agreed data product.
