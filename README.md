# Lunar Landing Site Navigator

A 3D mission-control view and a transparent energy / communication simulator for lunar south-pole
landing sites, built for the NASA Space Apps Challenge 2026 challenge
[Lunar Landing Site Navigator](https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/).

For a chosen site and start date it answers:

- Where are the Sun and Earth relative to the **real terrain horizon**?
- How much power can the solar panel produce, and when does the battery hit its reserve?
- When is there a line of sight to Earth, and how long is the longest outage?
- Would another site or another date do better with the **same hardware**?

Multiple scenarios are compared side by side; there is no fixed scenario-count cap. Results are stated as plain conditions
("keeps the battery reserve", "Earth outage within the limit"), never as a hidden-weight score.

> The sites are research region centres, **not certified landing sites**. The hardware values are
> example assumptions, not a real lander.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # engine + data tests (Vitest)
npm run build      # static site in dist/
npm run preview    # serve dist/ locally (works offline)
```

There is no server at run time: the app loads the JSON files in `public/data/` once and does every
calculation in the browser. At start it fetches only what the calculations need (each site's
ephemeris, horizon, regional map and season summary); the 3D terrain, imagery and Earth-orientation
files are fetched per site, only for the places being shown.

Python pipeline tests: `pip install -r preprocess/requirements-c.txt`, then `python -m pytest preprocess`.
Tests that need the raw DEM tiles in `data_raw/` (not in git) skip themselves when the tiles are
missing; GitHub Actions (`.github/workflows/ci.yml`) runs lint, both test suites and the build on
every pull request, so those DEM tests still need a run on a machine that has the tiles.
`python -m preprocess.coverage` rewrites `public/data/coverage.json` from the DEMs and catalogue.

**Comparing dates at one place.** In the mission controls (Simulation and Results), the scenario
row switches between scenarios; **+ Another date here** adds the selected place again one week
later (then change its date), and **Remove** drops the selected scenario. Chips and lists add the
date when a place appears more than once. The Sun and Earth line shows the current elevation and
the next set or rise; when none falls inside the mission, the place's full loaded series is searched
for the real next sunset / Earthset. Result cards and the detailed table show the Sun's highest and
average elevation. **Download CSV** exports every 10-minute sample of the selected scenario with
its settings and sources; the **Through the year** tab exports daily Sun / Earth visibility.
Playback speed runs from 6 hours to 10 days of mission time per second.

## Mission recommendations

The Simulation and Results mission controls include **Find a mission that works**:

- **Landing location** fixes the current UTC landing date, duration and hardware. By default it
  searches the **south polar region (60°S–90°S)**, the focus of this tool; **Entire southern
  hemisphere** is an option. It samples latitude rings (15°, 10° or 5° spacing, longitude counts
  scaled by latitude, one point at the pole; no equator row), then a finer 5 × 5 neighbourhood
  around five screening leaders, and rechecks ten finalists. It is not restricted to the white
  catalogue markers. Many points tie on the chosen metric (a battery that never discharges stays
  at its starting charge everywhere in daylight), so ties are broken by end-of-mission charge, the
  other two metrics, and then nearness to the south pole; the panel says when the top results tie.
- **Landing date & mission duration** fixes the selected location and hardware. It tests daily
  UTC starts in the requested interval and finds the longest feasible whole-day duration at
  each start, capped by the selected maximum and actual ephemeris coverage. Equal durations
  use the selected battery / simultaneous visibility / Earth outage metric, then earlier dates.

Every recommendation must keep battery reserve, serve energy demand and stay within the Earth
outage limit. Location searches use the global LOLA terrain (~1.9 km/pixel) over a 250 km
horizon range: 1° horizon sampling for screening, 0.1° for finalists. Angular horizon sampling
does not improve the DEM resolution. Results rank the rechecked finalists; unsampled points or
screening rejections may contain better options. These are sampled mission-feasibility
recommendations, not a continuous global optimum or a terrain-hazard landing certification.
Missing terrain fails the search rather than assuming flat ground. Searches run in a worker,
support cancellation, and are invalidated when mission controls or hardware change.
When no date/duration option passes, the panel reports rejection counts for the minimum
one-day screening and examples with their actual failed conditions. Data-coverage failures
are counted separately from physical failures. If Earth is hidden throughout every tested
one-day mission, the panel explains the 24-hour outage versus the configured limit; changing
the tie breaker cannot override that limit. Relay communication is not modelled and no limit
is automatically relaxed.

The **Research** tab automatically lists the three best other tested locations for every
research type rated Good fit or Possible at the selected point. A separate worker evaluates a
southern-hemisphere grid, local refinements around each research type's leaders, and mapped PSR
centres / approximate edges for ice research. Finalists are rechecked at 0.1° horizon sampling
and compared with catalogue locations using each research type's own displayed criterion.
Each entry shows coordinates or a catalogue name, distance, the measured research value,
comparison with the selected point, terrain precision, and any battery / energy / Earth-contact
failures. **Add to compare** simulates the alternative with the same date, duration and hardware.
Research rankings do not silently discard radio-shielded points for lacking direct Earth contact;
hardware conflicts are shown explicitly. Equal-area PSR proximity does not confirm an ice deposit,
unknown local slopes remain unverified, and mission-only radio shielding is labelled Possible
rather than a full-year result. Changing the selected location or mission cancels stale searches.

## How it works

```
NASA data ──► Python preprocessing (offline) ──► public/data/*.json ──► React + TypeScript app
 Horizons        ephemeris, horizon profile,        sites, ephemeris,       visibility, energy,
 LOLA DEMs       3D terrain grid, validation        horizon, terrain        battery, comparison
```

| Part | Where | What |
|---|---|---|
| Preprocessing | [`preprocess/`](preprocess/README.md) | Downloads LOLA DEMs, queries JPL Horizons, computes terrain horizons and 3D grids, validates them |
| Data contract | [`docs/data-contract.md`](docs/data-contract.md) | File formats, units (SI) and angle conventions |
| Simulation engine | [`src/sim/`](src/sim/) | Pure TypeScript functions, unit-tested |
| App screen | [`src/app/`](src/app/) | Places and dates, lander settings, result cards, "See why" tabs (skyline, battery, area map, year), guided tour |
| 3D view | [`src/scene3d/`](src/scene3d/) | React Three Fiber; terrain is visual only |
| Validation | [`docs/validation.md`](docs/validation.md), [`docs/validation-moontrek.md`](docs/validation-moontrek.md) | Numerical checks and cross-checks |

### Sites

The catalogue contains **26 points**, all in the southern hemisphere. The original polar sites and
the Chang'e-6 contrast point are listed below. The 18 additions cover Apollo 12/14/16, IM-1/IM-2,
Chandrayaan-3, SLIM, Chang'e-4, one published research candidate for each of NASA's nine
October 2024 Artemis III candidate regions, and one **future CLPS target**: VIPER's Mons Mouton
mission area (85.42088° S, 31.6218° E, Heldmann et al., NASA NTRS 20260005586), planned for
Blue Origin's Blue Moon MK1 under CLPS task order CS-7 in late 2027 (`coordinateStatus:
"planned-target"`, not a landing). Griffin-1 and Chang'e-7 have no published coordinate yet and are
not listed. Northern landing sites (Apollo 11/15/17, Blue Ghost 1,
Chang'e-3/5, Peregrine) are left out on purpose: the tool is about the south pole, where the Sun and
Earth skim the horizon and where Artemis III and current landers aim. They are still one click
away: the coordinate forms offer **Past landings** presets (Apollo 11/15/17, Chang'e-3/5, Blue
Ghost M1) that run on the global LOLA terrain like any typed coordinate, and the globe shows the
whole Moon. Apollo 12 (3.0° S) takes Apollo 11's place as the near-side equatorial
contrast point (Earth always up, two-week day and night). Research representatives are not approved landing
sites. Coordinate status, primary sources and DEM resolution
travel with each point. Details: [mission catalogue](preprocess/mission_catalogue.py),
[independent validation and DEM coverage](docs/validation-missions.md).

| Id | Name | Lat | Lon (east) | Note |
|---|---|---|---|---|
| Site01 | Connecting Ridge | −89.4632° | −137.49° | |
| Site04 | Shackleton Rim | −89.7668° | −171.87° | catalogue point lies on the ~32° inner crater wall |
| Site04R | Shackleton Rim (ridge point) | −89.7804° | −156.1970° | derived: highest ≤ 10° slope 5 m pixel within 2 km of Site04 |
| Site07 | Peak Near Shackleton | −88.811° | 123.6901° | |
| Site11 | de Gerlache Rim 1 | −88.6834° | −67.9321° | |
| Site20 | Leibnitz Beta Plateau | −85.4266° | 31.74276° | |
| Site23 | Malapert Massif | −85.9948° | −0.23578° | |
| CE6 | Chang'e-6 landing site | −41.6385° | −153.9852° | contrast point (far side, Earth never rises); global 474 m/px DEM |

**Libration.** Earth is not fixed in the lunar sky. The Moon's elliptical orbit and tilted axis make it
appear to rock (libration), so Earth draws a loop about once every 27 days. The JPL Horizons /
DE421 positions already contain this motion; nothing is added on top. At the polar sites the loop
spans ~11–15° of azimuth and ~13–14° of elevation per month (Site01: −7.5° to +6.2° over the year),
so it crosses the horizon and Earth rises and sets. The "Skyline" tab explains this and gives the
numbers for the current mission. Details: [Data & Methods](docs/data-methods.md#libration).

Coordinates: NASA Lunar Surface Data Book (M2M-30044, 2025), Table A2.1-1; contrast points from
LROC (Chang'e-6) and NASA NSSDC (Apollo). Missions of one day or more can start anywhere from
1 Nov 2026 to 1 Nov 2027 UTC (10-minute steps; a site's one-year series loads when a mission runs past
1 Jan 2027; the entire mission must fit the available series; an imported package brings its own
period, up to 1830 days). Each original polar site also has a regional map (`map.json`: Sun / Earth visibility
and slope on a ±3 km grid) whose points can be simulated as missions, and a one-year monthly summary
(`season.json`); see the [data contract](docs/data-contract.md).

There is no mission-length or place-count cap in evaluation, controls or shared links.
The entire mission must still fit its actual source series; this does not generate additional dates.
Scenario labels continue after Z (AA, AB, …). The first six colours retain the team's palette.

**Whole-Moon view.** The picker draws both hemispheres on the shared, hash-checked global
LOLA tiles (~1.9 km/px). A refined display mesh follows close-up navigation without inventing
extra relief or exaggerating heights. LROC WAC and south-polar photographs are projected per
fragment on the same surface, avoiding polar UV streaks and floating photograph layers.
Points without a local display package also get an ENU 3D map/terrain/lander view from this
coarse global DEM; its vertical datum is aligned to the selected observer's ground. This is a
view adapter only: the point's scientific horizon, ephemeris and energy results are unchanged.
Archive photograph illumination is explicitly separate from selected-time Sun shading.

For longer studies the repository includes a **2026–2029 Connecting Ridge package**.
`python -m preprocess.custom_point` generates other coordinates/periods with an explicit terrain
choice: local 5 m (strict default), south-polar 80 m, or global ~474 m screening. Dates may be
within 2000–2040, up to 1830 days per package. A hash-checking TypeScript importer and generation
contract are wired into the engine and the searches.

**Your own coordinate.** "Enter your own coordinates" (place picker and Simulation) accepts any
point on the Moon. Inside the ±3 km polar maps the nearest map cell is used and its distance is
shown; anywhere else the app computes that exact point in the browser: the Sun and Earth from the
loaded JPL Horizons year series re-projected to the point (checked against five catalogue sites'
own series, ≤ 0.003° elevation), and a 0.1° terrain horizon ray-marched out to 250 km on the
global LOLA LDEM_64 tiles (`public/data/global-dem/`, 4 × 4 block mean, ~1.9 km/px,
`python -m preprocess.global_tiles`). Such points are labelled **global screening estimate**:
hills and crater walls smaller than a few km are not resolved. See
[preprocessing](preprocess/README.md) and [package contract](docs/data-contract.md).

### Model

**Visibility.** The Sun or Earth is in view when its centre is above the terrain horizon at its
azimuth: `el > horizonAt(az)`, with `horizonAt` a circular linear interpolation of a 3 600-direction
(0.1°) horizon profile. The profile is computed from LOLA 5 m/px DEMs within 7 km and the 80 m/px
south-pole DEM out to 250 km, with lunar curvature. The 3D scene never decides visibility.
New mission points outside local tile coverage explicitly use the 80 m regional or ~474 m global
DEM. Their 0.1° horizon sampling does not resolve small terrain hazards or certify landing safety.

**Power.**

```
P = 1361 W/m² × (1 au / d_sun)² × area × efficiency × system factor × incidence × visibility
```

Incidence is 1 for an ideal tracking panel and `max(0, cos θ)` for a fixed panel. Energy per
10-minute step uses the part of the step during which the Sun's centre was up (rise and set are
placed by linear interpolation). An optional *partial Sun disk* mode scales output by the visible
share of the disk instead (linear approximation); it is off by default.

**Battery.** Generation serves the load directly; only the surplus is stored (charge efficiency)
and only the shortfall is drawn (discharge efficiency). The state of charge is kept within
capacity; demand that cannot be served is recorded as unmet energy. The engine reports the first
reserve violation and the longest Earth outage.

**Default example hardware.** 2 m² tracking panel, 25 % efficiency, 0.8 system factor; 5 kWh
battery, 80 % initial charge, 20 % reserve, 90 % charge/discharge efficiency; 200 W base load,
+100 W while Earth is in view; 6 h accepted Earth outage.

**Limits (out of scope by design).** Not modelled: eclipses, temperature, dust, battery ageing,
limb darkening. Earth view is line of sight only: no Deep Space Network schedule, antenna or link
budget. Near the pole the Sun
and Earth cross the horizon slowly, so a 0.05° horizon error equals roughly 30 minutes to 4 hours of
rise/set time. DEM pixel size and the checks below are not a statement of absolute accuracy.

### Validation (summary)

- Horizons vs. Skyfield (DE421), every sample: ≤ 0.00006°. One-year series (`year.bin`, incl. all of 2027): ≤ 0.00003°.
- JSON vs. a fresh Horizons query at 14 epochs per site: ≤ 0.00005° (storage rounding).
- Horizon convergence with halved ray steps: ≤ 0.019° (tolerance 0.05°).
- Rise/set from 10-minute samples vs. a 1-minute Horizons series: ≤ 0.33 min (2.4 min at Site20).
- NASA GSFC polar illumination maps (Mazarico et al., 18.6 years): all 7 polar sites within the local 3×3-pixel range; rank correlation 0.96 (Sun) and 0.96 (Earth); Shackleton floor permanently shadowed in both.
- Same maps vs. every regional map cell (17 767 cells, 7 maps): mean abs difference 0.029 (Sun) / 0.021 (Earth), 96 % / 98 % within the 3×3-pixel range, rank correlation 0.93 / 0.96; differences sit mostly on flat ground ([`docs/validation.md`](docs/validation.md) §8).
- Regional map cells vs. a full-resolution horizon at the same cell: ≤ 0.06 percentage points.
- 3D terrain vs. NASA Moon Trek LOLA 5 m DEM: RMS 1.3–2.4 m on gentle ground, 16–18 m on Shackleton's steep wall.
- The TypeScript engine reproduces the Python reference values (`docs/reference/`) exactly on all sites.

## Data and references

- JPL Horizons System, NASA/JPL-Caltech — https://ssd.jpl.nasa.gov/horizons/
- LOLA 5 m/px south-pole site DEMs: Barker, M.K. et al. (2021), *Improved LOLA elevation maps for south pole landing sites*, PSS 203, 105119. doi:10.1016/j.pss.2020.105119 — https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/
- LOLA 80 m/px south-pole DEM: Barker, M.K. et al. (2023), *A New View of the Lunar South Pole from LOLA*, PSJ 4, 183. doi:10.3847/PSJ/acf3e1; data doi:10.60903/gsfcpgda-lola-spole — https://pgda.gsfc.nasa.gov/products/90
- NASA Moon Trek (LOLA 5 m south-pole mosaic, cross-check) — https://trek.nasa.gov/moon/
- NASA Moon Trek, LOLA 30 m/px south-pole DEM `LRO_LOLA_DEM_SPole75_30mp_v04` (regional terrain in the 3D view, display only) — https://trek.nasa.gov/moon/
- NASA Earth Observatory, *Blue Marble: Next Generation* (November 2004) (Earth image in the 3D view: archive composite, not live imagery; display only) — https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-topography-bathymetry/
- NASA, *Moon to Mars (M2M) Lunar Surface Data Book*, M2M-30044 Baseline (2025), NASA/TP-20250002845, Table A2.1-1 (site coordinates) — https://ntrs.nasa.gov/citations/20250002845
- LOLA global DEM LDEM_64 (~474 m/px), PDS LRO-L-LOLA-4-GDR-V1.0 (contrast points) — https://pds-geosciences.wustl.edu/missions/lro/lola.htm
- NASA GSFC PGDA Lunar Polar Illumination maps (Mazarico et al.) — https://pgda.gsfc.nasa.gov/products/69
- Solar constant 1361 W/m² — NASA GSFC solar irradiance — https://earth.gsfc.nasa.gov/climate/projects/solar-irradiance/science
- Mazarico, E. et al. (2011), *Illumination conditions of the lunar polar regions using LOLA topography*, Icarus 211, 1066–1081. doi:10.1016/j.icarus.2010.10.030
- Contrast-point coordinates: LROC (ASU/NASA) *First Look: Chang'e 6* — https://lroc.asu.edu/images/1374; NASA NSSDC Apollo landing site coordinates — https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_sites.html
- Software: Skyfield (JPL DE421), NumPy, SciPy, Rasterio, PyProj, Requests, Matplotlib, React, three.js / React Three Fiber, Vite, Vitest

NASA data are used under NASA's open data policy; NASA does not endorse this project.

## Use of AI

AI assistants (Anthropic Claude) were used for research, code, tests and documentation. Every
number shown in the app comes from the NASA data through code in this repository and is checked
by the automated tests and the validation reports above.

## License

[MIT](LICENSE)
