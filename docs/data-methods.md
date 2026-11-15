# Data & Methods

*Lunar Landing Site Navigator — text for the project page (NASA Space Apps 2026). Numbers in this
document come from the scripts in `preprocess/`; the full tables are in [`validation.md`](validation.md).*

## What the tool computes

For a point on the lunar surface and a time, the tool answers two questions: **is the Sun visible**
(power) and **is the Earth visible** (direct-to-Earth communication). Both depend on where the body is
in the sky *and* on whether the local terrain hides it. Near the south pole the Sun and the Earth stay
within a few degrees of the horizon, so a ridge a few kilometres away decides the answer.

All heavy computation runs offline (Python). The web app reads static JSON files and applies one
shared visibility rule: a body is visible when its elevation is above the terrain horizon in its
direction (`el > horizonAt(az)`).

## Data

| Data | Source | Use |
|---|---|---|
| Site coordinates | NASA *Lunar Surface Data Book*, M2M-30044 Baseline (Mar 2025), Table A2.1-1 | Site01, 04, 07, 11, 20, 23 |
| Contrast-point coordinates | LROC *First Look: Chang'e 6* (CE6); NASA NSSDC Apollo landing site coordinates (Apollo 12/14/16) | CE6, Apollo12 |
| Topography near the site | LOLA 5 m/px site DEMs (Barker et al. 2021), PGDA | horizon up to 7 km, slope, 3D view |
| Regional topography | LOLA `LDEM_80S_80MPP_ADJ`, 80 m/px (Barker et al. 2023), PGDA | horizon 7–250 km |
| Topography at the contrast points | LOLA global `LDEM_64` (64 px/deg, ~474 m/px), PDS `LRO-L-LOLA-4-GDR-V1.0` | CE6, Apollo12 horizon and 3D view |
| Sun and Earth positions | JPL Horizons, observer on the Moon (`coord@301`, MEAN_ME frame), airless, 10-min steps | az/el/distance per sample |
| Independent ephemeris | Skyfield + DE421, `MOON_ME_DE421` frame | cross-check, 18.6-year runs |
| External reference | PGDA *Lunar Polar Illumination* (Mazarico et al.), 85S 60 m maps, 2016-08 | comparison only |
| Regional terrain in the 3D view | NASA Moon Trek, LOLA 30 m/px south-pole DEM (`LRO_LOLA_DEM_SPole75_30mp_v04`) | display only; not used for visibility |
| Earth image in the 3D view | Archive composite (Blue Marble Next Generation, Nov 2004), NASA Earth Observatory; not live imagery or weather | display only |

The catalogue has 25 points, all in the southern hemisphere: the eight original points (seven polar
sites and CE6) plus 17 mission/research points. Northern landing sites (Apollo 11/15/17, Blue
Ghost 1, Chang'e-3/5, Peregrine) were packaged and validated earlier but are left out of the
published catalogue on purpose: the question is a south-pole question, and the globe shows the
southern hemisphere only. Apollo 12 (3.0° S) replaces Apollo 11 as the near-side equatorial contrast
point; the validation tables below that list nine sites were run while Apollo 11 was still included.
Coordinates and status
are pinned in [`preprocess/mission_catalogue.py`](../preprocess/mission_catalogue.py):
[NASA NSSDCA Apollo coordinates](https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_sites.html),
[NASA NSSDCA lunar spacecraft table](https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_artifact_impacts.html),
[IAU/USGS Sinus Viscositatis](https://planetarynames.wr.usgs.gov/Feature/16118), and
[Wueller et al., Table A1](https://doi.org/10.1029/2025JE009434). The nine Artemis research
points represent the [NASA October 2024 region list](https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/),
not approved touchdown points or a claim about current mission assignments. Peregrine's entry
is its historical target region's feature centre, not a landed spacecraft. The two research points
inside the Site20/Site23 full near-field coverage reuse the 5 m tiles; other mission points use
explicitly labelled 80 m regional or ~474 m global DEMs. New ephemeris packages use
Skyfield/DE421, checked independently against JPL Horizons; the original nine retain Horizons.
The measured checks and DEM overlap distances are in [validation-missions.md](validation-missions.md).
All 25 new packages (23 catalogue points and two coordinate examples) pass 14 independent JPL
epochs per body: maximum sky angle error 0.00002442° and 32-direction horizon convergence
below 0.01550°. File hashes are recorded in the machine-readable report.

The catalogue's one-year series remains unchanged. A separate Connecting Ridge package covers
1 Nov 2026–1 Nov 2029. Coordinate packages can be generated with an explicit terrain choice
and UTC range (2000–2040, maximum 1830 days each); their manifest declares the actual range,
observer and hashes. The current app form still snaps coordinates to map cells. The package
loader and B/D integration boundary are documented in [data-contract.md](data-contract.md).

## Method

1. **Terrain horizon.** From an observer 2 m above the DEM surface, 3600 rays (every 0.1°) follow
   great circles out to 250 km. Steps: 2.5 m up to 7 km on the 5 m DEM, then 40 m on the 80 m DEM.
   Each sample's elevation angle includes the exact curvature of the Moon:
   `elev = atan2(Rt·cos θ − Ro, Rt·sin θ)`. The horizon is the highest angle along the ray.
   Azimuths whose result changes by more than 0.02° when the steps are halved are recomputed with
   the finer steps.
2. **Sun and Earth.** JPL Horizons gives azimuth, elevation and distance for the same observer
   (same coordinates and height) every 10 minutes, 1 Nov 2026 – 1 Jan 2027 (main period) and
   1 Nov 2026 – 1 Nov 2027 (season table and `year.bin`). The app loads `year.bin` for a site only
   when a mission runs past the main period, so a mission can start on any date up to 1 Nov 2027.
3. **Visibility.** At each sample: visible if `el > horizonAt(az)` (linear interpolation of the horizon).
   For the Sun, the visible fraction of the disk is approximated linearly from the disk's angular radius.
   Rise/set instants are interpolated between the two samples around a sign change.
4. **Regional map.** On a ±3 km grid around each site (100 m cells; 200 m for Site11/20/23), every
   cell gets its own horizon (same ray marcher, 0.5° azimuth step) and its own Sun/Earth direction:
   the body position is rebuilt in the Moon-fixed frame from the site's Horizons data and projected
   into the cell's local frame. Near the pole a few kilometres turn the local north by degrees, so this
   step is required. Slope comes from the 5 m DEM over a 25 m baseline.
   **Any map point as a scenario.** A clicked cell, or a typed latitude/longitude within ±3 km of a
   map site (snapped to the nearest cell), is simulated like a listed site: its horizon is the cell's
   map horizon at 1° steps (`cells.bin`, every second 0.5° value, no averaging), and the browser
   re-projects the site's Sun/Earth series (two months or the full year) into the cell's local frame
   with the same formula as the map. The energy model and timelines then run unchanged.
5. **Derived point Site04R.** The Site04 catalogue coordinate lies on the ~32° inner wall of
   Shackleton. Site04R is the highest 5 m pixel with slope ≤ 10° within 2 km (rule in
   `preprocess/ridge.py`), 1.9 km away. It is labelled as derived, not as a catalogue site.

### Libration

Seen from the Moon, Earth would hang still if the Moon's spin matched its orbit exactly. It does not:
the orbit is elliptical (the spin is steady but the orbital speed is not, ~±7.9° in longitude) and the
spin axis is tilted to the orbit (~±6.7° in latitude). The Moon therefore appears to rock, and from
the surface Earth traces a small loop in the sky about once every 27.3 days, plus a smaller daily
parallax term.

No separate libration model is needed: JPL Horizons (`coord@301`, `MOON_ME`) and Skyfield/DE421
(`MOON_ME_DE421`) give Earth's direction for an observer fixed on the rotating Moon, so the physical
and optical libration is already in every `ephemeris.json` / `year.bin` sample. Measured from
`year.bin` (1 Nov 2026 – 1 Nov 2027, terrain ignored):

| Site | Earth azimuth span per 27.3 d | Earth elevation span per 27.3 d | Elevation range over the year |
|---|---|---|---|
| Site01 Connecting Ridge | 10.7–15.3° | 13.1–13.7° | −7.5° … +6.2° |
| Site04 Shackleton Rim | 10.8–15.4° | 13.1–13.7° | −7.3° … +6.4° |
| Site23 Malapert Massif | 10.8–15.4° | 13.1–13.7° | −3.1° … +10.6° |
| Apollo12 (near side) | 29.7–32.6° | 12.3–16.2° | +57.3° … +74.4° |
| CE6 (far side) | 6.8–14.4° | 15.5–18.6° | −51.7° … −32.9° |

At the pole the loop straddles the level horizon, so libration alone makes Earth rise and set about
once a month, and the terrain then decides how much of the upper half is actually in view. At
Apollo 12 the loop stays high (Earth always up); at CE6 it stays below (Earth never up). The
"Skyline" tab shows the azimuth span and elevation range for the current mission
(`src/app/libration.ts`).

## Validation (summary)

| Check | Result |
|---|---|
| Horizons vs Skyfield/DE421, every sample, 9 sites | ≤ 0.00006° (tolerance 0.01°) |
| One-year series (`year.bin`, 52 561 samples incl. all of 2027) vs Skyfield/DE421, 9 sites | ≤ 0.00003° (tolerance 0.01°) |
| JSON vs a fresh Horizons request (random epochs) | ≤ 0.00005° (= storage rounding) |
| Horizon: halved ray steps, 32 azimuths per site | ≤ 0.02° (tolerance 0.05°) |
| Rise/set from 10-min series vs 1-min reference | ≤ 0.33 min at 8 of 9 sites; 2.4 min at Site20 (slowest crossings) |
| Season file: Nov–Dec of the 1-year series vs published reference values | identical, 9/9 sites |
| **External:** 18.6-year Sun visibility vs Mazarico et al. product | 7/7 sites within the product's 3×3-pixel range; rank correlation 0.96 (Sun) and 0.96 (Earth) |
| **External:** every regional map cell (17 767 cells, 7 maps) vs the same product, 18.6 years | mean abs diff 0.029 (Sun) / 0.021 (Earth); 96 % / 98 % within the product's 3×3-pixel range; rank correlation 0.93 / 0.96; larger differences on flat ground than on steep walls (`validation.md` §8) |
| **External:** Shackleton crater floor | never lit in our model over 18.6 years (Sun ≥ 17.9° below the terrain horizon); product: permanent shadow |
| Regional map vs full-resolution horizon (centre + 6 random cells per site, 7 maps) | ≤ 0.06 percentage points (tolerance 1) |
| Map point simulation (1° horizon) vs `map.json` (centre + 6 fixed cells per map, 7 maps) | ≤ 0.15 percentage points |
| **External:** terrain grid vs NASA Moon Trek LOLA 5 m DEM (`LRO_LOLA_DEM_SPole875_5mp_v04`), 5 sites (all inside the mosaic, 87.5–90 S) | RMS 1.3–2.4 m on slopes < 10°, 16–18 m on slopes > 25° (`validation-moontrek.md`) |

## Limits of the model

- **One observer height** (2 m). Higher masts or rovers see more Sun; the files do not cover that.
- **Partial Sun disk** is a linear approximation; the Earth is treated as a point at its centre
  (the external comparison also shows the "any part of the disk" variant).
- **DEM accuracy is not claimed.** Pixel sizes and numerical convergence say nothing about the absolute
  accuracy of LOLA heights. Barker et al. (2021) give per-pixel height uncertainties of the 5 m maps.
- **Time precision.** Near the pole the Sun crosses the horizon at only 0.01–0.10° per hour, so a
  0.05° horizon error moves a sunrise by 30 minutes to 4 hours (6–8 min at the mid-latitude contrast points). Times are shown to the minute but should
  not be read as exact to the minute.
- **Coverage.** The 80 m regional DEM ends at 80° S. For Site20 and Site23 some rays leave it before
  250 km; a conservative bound (10.8 km high terrain at the DEM edge) shows the missing terrain cannot
  raise any horizon, and this check runs for every site.
- **Regional map colours** are two-month (main period) summaries. A map point run as a scenario gets the
  full time series and energy simulation, but with a 1° horizon instead of the 0.1° used at listed
  sites. Custom coordinates are limited to ±3 km around the 7 polar map sites (none around the
  contrast points); the rest of the Moon is out of scope. Slope is a terrain descriptor, not a
  landing-safety assessment.
- **Good illumination does not mean flat or safe terrain for landing.** Sun and Earth visibility says
  nothing about slope at the lander scale, rocks, or hazards; slope shown is a coarse terrain descriptor.
- **Map-point horizon is a regional screening estimate.** The 1° cell horizon (`cells.bin`) is a screening
  estimate for a region, not the 0.1° catalogue horizon. Only the few finalist cells in `refined.json`
  are recomputed at 0.1° (they differ from the 1° result by at most 0.10 percentage points,
  `validation.md` §7); every other cell stays a screening estimate.
- **Not a landing-site certification.** Sites are research region centres from the Data Book.

## Seasons

The main period (Nov–Dec 2026) is southern summer at the pole. Over a full year the picture changes a
lot: Site07 sees the Sun 100 % of the time in Nov–Dec but 68 % over the year and 14 % in April 2027;
Site01 drops from 73 % to 47 %. The `season.json` files give the monthly table for every site.

Figures for the slides (`python -m preprocess.figures`): `docs/figures/season-polar-sites.png` (monthly Sun and
Earth visibility, 7 polar sites) and `docs/figures/site04-map.png` (Site04 regional map: Sun, Sun + Earth, slope,
with the catalogue point and the Site04R ridge point).

## References

- Barker, M.K. et al. (2021). Improved LOLA elevation maps for south pole landing sites: Error estimates and their impact on illumination conditions. *Planetary and Space Science* 203, 105119. doi:10.1016/j.pss.2020.105119
- Barker, M.K. et al. (2023). A new view of the lunar south pole from the Lunar Orbiter Laser Altimeter (LOLA). *Planetary Science Journal* 4, 183. doi:10.3847/PSJ/acf3e1; data doi:10.60903/gsfcpgda-lola-spole
- Mazarico, E. et al. (2011). Illumination conditions of the lunar polar regions using LOLA topography. *Icarus* 211, 1066–1081. doi:10.1016/j.icarus.2010.10.030
- NASA PGDA, Lunar Polar Illumination products. https://pgda.gsfc.nasa.gov/products/69
- NASA (2025). *Moon to Mars (M2M) Lunar Surface Data Book*, M2M-30044 Baseline. NASA/TP-20250002845. https://ntrs.nasa.gov/citations/20250002845
- JPL Horizons System, NASA/JPL-Caltech. https://ssd.jpl.nasa.gov/horizons/
- NASA PDS Geosciences Node, LRO LOLA Gridded Data Records (`LDEM_64`, LRO-L-LOLA-4-GDR-V1.0). https://pds-geosciences.wustl.edu/missions/lro/lola.htm
- LROC (ASU/NASA), *First Look: Chang'e 6*. https://lroc.asu.edu/images/1374
- NASA NSSDC, Apollo landing site coordinates. https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_sites.html
- NASA GSFC, Solar irradiance (solar constant 1361 W/m²). https://earth.gsfc.nasa.gov/climate/projects/solar-irradiance/science
- NASA Moon Trek (LOLA 5 m south-pole mosaic for the terrain cross-check; LOLA 30 m south-pole DEM for the 3D view). https://trek.nasa.gov/moon/
- NASA Earth Observatory, Blue Marble: Next Generation (November 2004). https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-topography-bathymetry/
- Rhodes, B. Skyfield. https://rhodesmill.org/skyfield/ ; JPL DE421 planetary ephemeris (Folkner et al. 2008).
- Software: NumPy, SciPy, rasterio/GDAL, pyproj/PROJ, Requests, Matplotlib (figures).

NASA data are used under NASA's open data policy; NASA does not endorse this project.

## Use of AI (preprocessing and documentation, part A)

An AI coding assistant (Claude, Anthropic, via Claude Code) helped write the preprocessing scripts,
unit tests and these documents, and helped search for data sources. The team chose the method, set the
acceptance tests and reviewed the results. Every number in the data files and in this document is
produced by the scripts from the NASA/JPL data listed above and checked by the validation in
`docs/validation.md`; no value was typed in by hand or generated by the AI.
