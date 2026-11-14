# Presentation notes (Person D, draft)

Numbers for the project page and the seven English slides. Every number below comes from the
files in `public/data/` through the simulation engine (`src/sim/`) or from `docs/validation.md`;
nothing was tuned for the story. Re-check the tables if the data is regenerated.

Example mission hardware (assumptions, not a real lander): 2 m² tracking panel, 25 % efficiency,
0.8 system factor, 5 kWh battery starting at 80 % with a 20 % reserve, 90 % charge/discharge
efficiency, 200 W base load + 100 W while Earth is in view, 6 h accepted Earth outage.

## Seven-slide outline (official demo, English)

| # | Title | On the slide | Visual |
|---|---|---|---|
| 1 | Problem & promise | At the south pole the Sun and Earth skim the horizon: a few hundred metres of terrain decide power and contact. We show it and let planners test it. | Polar map with the 4 sites |
| 2 | User flow | Site → date → mission hardware → compare up to 3 scenarios. No server, instant updates. | App screenshot with the 4 steps labelled |
| 3 | Terrain evidence | Horizon panorama: real skyline vs. flat horizon, Sun/Earth tracks; Site04 Earth hidden behind the crater wall all week. | Panorama screenshot (+ 3D view if ready) |
| 4 | Energy evidence | Same site, change the hardware or date → battery result changes (Site04: +72 h start → unmet 1.0 → 15.4 kWh). | Battery / power chart screenshot |
| 5 | Comparison | Site04 vs. Site04R vs. Site04R +72 h with the same hardware; plain conditions, no score. | Comparison screen screenshot + table below |
| 6 | Scientific basis | NASA data, validation numbers, model limits (sections below). | Small table of checks |
| 7 | Impact & access | Live app, source (MIT), offline build, team, next steps (Site11/20/23, shareable links, thermal / relay models). | Links + QR code, team names |

## Story: the catalogue point vs. the ridge 1.9 km away (slides 3–5)

Site04 (Shackleton Rim) catalogue coordinate lies on the ~32° inner wall of Shackleton crater.
Site04R is the highest gentle (≤ 10° slope) 5 m pixel within 2 km of it: a reproducible rule
(`preprocess/ridge.py`), not a hand-picked spot.

**Whole computed period (1 Nov 2026 – 1 Jan 2027), terrain included:**

| Site | Sun in view | Earth in view | Both |
|---|---|---|---|
| Site01 Connecting Ridge | 73 % | 37 % | 24 % |
| Site04 Shackleton Rim (catalogue point) | 27 % | 0 % | 0 % |
| Site04R ridge point, 1.9 km away | 100 % | 48 % | 48 % |
| Site07 Peak Near Shackleton | 100 % | 50 % | 50 % |

**Default mission: 15 Nov 2026 00:00 UTC, 7 days:**

| Site | Sun | Earth | Longest Earth outage | Battery reserve | Unmet demand |
|---|---|---|---|---|---|
| Site04 | 83.5 % | 0 % | 168 h (whole mission) | broken after 158 h, battery empties | 1.0 kWh |
| Site04R | 100 % | 72 % | 47 h | kept (never below 80 %) | 0 |
| Site01 | 100 % | 46 % | 90 h | kept | 0 |
| Site07 | 100 % | 75 % | 42 h | kept | 0 |

**Same hardware, start shifted +72 h (18 Nov 2026):**

| Site | Sun | Earth | Longest Earth outage | Battery reserve | Unmet demand |
|---|---|---|---|---|---|
| Site04 | 40.6 % | 0 % | 168 h | broken after 86 h | 15.4 kWh |
| Site04R | 100 % | 100 % | 0 h | kept | 0 |
| Site07 | 100 % | 100 % | 0 h | kept | 0 |
| Site01 | 100 % | 89 % | 18 h | kept | 0 |

Talking points:
- Moving 1.9 km, from the crater wall to the ridge, turns "no Earth contact at all, battery runs
  dry" into "continuous Sun, reserve kept".
- Choosing the date matters too: three days later, Site04R and Site07 see Earth for the whole
  week, so the 6 h outage limit is met; on 15 Nov no site meets it.
- The comparison reports plain conditions ("keeps the battery reserve", "Earth outage within
  limit"), not a hidden-weight score.

## Scientific basis and validation (slide 6)

- **Sun/Earth positions:** JPL Horizons, observer on the lunar surface (`coord@301`, MEAN_ME),
  no refraction, 10-minute steps, eye 2 m above the LOLA surface.
- **Ephemeris cross-check:** Horizons vs. Skyfield (DE421) on every sample (8 785 per site and
  body): max difference ≤ 0.00006°. A fresh Horizons re-query at 14 epochs per site matches the
  JSON within ≤ 0.00005° (the 4-decimal rounding).
- **Terrain horizon:** 3 600 azimuths (0.1°), LOLA 5 m/px within 7 km and 80 m/px out to
  250 km, lunar curvature included. Halving the ray steps changes the horizon by ≤ 0.019°
  (tolerance 0.05°). A 100 km scan would miss far mountains by up to 1.3° at Site07/Site04R,
  which is why the data uses 250 km.
- **Rise/set timing:** 10-minute series with interpolation vs. a 1-minute Horizons series:
  ≤ 0.05 min at most sites, ≤ 0.33 min at Site04.
- **Terrain cross-check:** our 3D grids vs. NASA Moon Trek's LOLA 5 m south-pole DEM:
  RMS 1.3–2.4 m on gentle ground (< 10°), 16–18 m on Shackleton's steep wall (> 25°).
- **Engine:** the TypeScript engine reproduces the Python pipeline's reference values (visibility
  percentages, every window, horizon test vectors, mean Sun-disk fraction) exactly on all four
  sites; 98 automated tests.

## Model limits (say them out loud)

- Visibility is decided by the centre of the Sun/Earth against the terrain horizon. An optional
  partial-disk mode scales panel output by the visible share of the disk (linear approximation);
  it is off by default and changes the results little (Site04 unmet demand 1.0 → 0.6 kWh).
- No eclipses, temperature effects, dust, or battery ageing.
- Earth view is line of sight only: no ground-station schedule, antenna or link budget.
- Near the pole the Sun and Earth cross the horizon slowly: a 0.05° horizon error is 29–138 min
  of rise/set time (`docs/validation.md` §4).
- Site04R's near terrain partly falls back to the 80 m DEM where the 5 m product has no data
  (warning carried in `horizon.json`).
- Sites are research region centres, not certified landing sites. Pixel size and these checks are
  not a statement of the DEM's absolute accuracy.
