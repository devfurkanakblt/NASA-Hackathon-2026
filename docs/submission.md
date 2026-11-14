# Submission text (draft, Person D)

Copy each section into the matching field of the Space Apps project form. Fill the `[...]`
placeholders before submitting. Numbers match `docs/presentation-notes.md`.

---

## Project name

Lunar Landing Site Navigator

## High-level project summary

We built a browser-based mission-control tool for lunar south-pole landing sites (7 NASA
candidate regions, plus 2 contrast points: the Chang'e-6 far-side site and Apollo 11). For a site and
a start date it shows where the Sun and Earth are against the real terrain horizon, how much power
a solar panel produces, when the battery drops below its reserve, and when there is a line of
sight to Earth. Up to three scenarios (sites or dates) are compared with the same hardware, and
the result is stated as plain conditions instead of a hidden score. Example: Shackleton Rim's
catalogue point sits on a crater wall with no view of Earth all week and a battery that runs dry;
a ridge 1.9 km away gets continuous sunlight and keeps its reserve.

## Links

- Demo (7 slides): [link]
- Live app: [link]
- Source code (MIT): https://github.com/devfurkanakblt/NASA-Hackathon-2026

## Project details

**What it does.** A mission planner picks a site, a start date (1 Nov 2026 – 1 Jan 2027 UTC) and a
mission length (1–30 days), sets panel, battery and load assumptions, and pins up to three
scenarios. The app shows a horizon panorama (terrain skyline with the Sun and Earth tracks), a 3D
view of the local terrain with the lander, timelines of Sun / Earth / both in view, panel output
versus demand, and battery state of charge. Each scenario reports whether it keeps the battery
reserve, the first reserve violation, unmet energy, the longest Earth outage against the accepted
limit, and the time to the next rise or set.

**How it works.** Offline Python preprocessing queries JPL Horizons for Sun and Earth azimuth,
elevation and distance seen from each site (10-minute steps, observer 2 m above the surface),
and computes a 3 600-direction terrain horizon from LOLA 5 m/px DEMs within 7 km and the LOLA
80 m/px south-pole DEM out to 250 km, including lunar curvature. The results are small static JSON
files. The web app (React + TypeScript) loads them once and runs the visibility, power and battery
model in the browser, so every setting change updates instantly and no server is needed. The 3D
terrain is for orientation only; visibility always comes from the horizon profile.

**Why it matters.** At the lunar south pole the Sun and Earth stay close to the horizon, so a few
hundred metres of terrain decide whether a lander has power and communication. Coordinates alone
do not show this. Our tool makes the effect visible and testable: change the site, the date or the
hardware and see which conditions hold, with sources and model limits on screen.

**Validation.** Horizons and Skyfield agree within 0.00006°; a fresh Horizons query matches the
stored data within 0.00005°; halving the horizon ray steps changes the horizon by at most 0.019°;
rise/set times from 10-minute data agree with a 1-minute series within 0.33 min at most sites
(2.4 min at Site20); our terrain grids agree with NASA Moon Trek's LOLA 5 m DEM within 1.3–2.4 m RMS
on gentle ground. Against NASA GSFC's independent polar illumination maps (Mazarico et al., 18.6
years) our Sun and Earth visibility falls within the map's local 3×3-pixel range at all 7 polar
sites (rank correlation 0.96 for both), and Shackleton's floor is permanently shadowed in both.
The TypeScript engine reproduces the Python reference values exactly; 108 automated tests run on
every change.

**Limits.** Sites are research region centres, not certified landing sites; hardware values are
example assumptions. Not modelled: eclipses, temperature, dust, battery ageing, ground-station
schedules and link budgets. Near the pole a 0.05° horizon error equals about 30 minutes to 4 hours of
rise/set time. The contrast points use the 474 m/px global LOLA map, so small nearby hills are
not resolved.

**Tools.** Python (NumPy, Rasterio, PyProj, Skyfield, Requests), TypeScript, React, three.js /
React Three Fiber, [ECharts — keep only if the final UI uses it], Vite, Vitest. Static hosting on [Vercel / GitHub Pages]; the same
build runs offline.

**Next steps.** Show the precomputed regional maps (Sun / Earth visibility and slope on a ±3 km
grid around each polar site) and the one-year monthly summary in the app, shareable scenario links,
thermal and relay-satellite models.

## Use of Artificial Intelligence (AI)

[Team: confirm or edit.] We used AI assistants (Anthropic Claude) during research, coding, testing
and writing documentation. The team chose the approach, defined the data contract and the model,
and reviewed the code. AI-generated code is covered by the same automated tests and validation
reports as the rest of the project. No AI-generated images, data or results are presented as NASA
data; every number in the app is computed from the NASA sources below by code in our repository.

## NASA data

- JPL Horizons System (Sun and Earth positions seen from the lunar surface) — https://ssd.jpl.nasa.gov/horizons/
- LOLA 5 m/px south-pole landing site DEMs, NASA GSFC PGDA (Barker et al. 2021) — https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/
- LOLA 80 m/px south-pole DEM, NASA GSFC PGDA (Barker et al. 2023) — https://pgda.gsfc.nasa.gov/products/90
- LOLA global DEM LDEM_64 (~474 m/px, contrast points), PDS LRO-L-LOLA-4-GDR-V1.0 — https://pds-geosciences.wustl.edu/missions/lro/lola.htm
- NASA GSFC PGDA Lunar Polar Illumination maps (Mazarico et al.; external validation) — https://pgda.gsfc.nasa.gov/products/69
- NASA Moon Trek, LOLA 5 m south-pole mosaic (terrain cross-check) — https://trek.nasa.gov/moon/
- NASA Lunar Surface Data Book, M2M-30044 (2025), Table A2.1-1 (site coordinates) — https://ntrs.nasa.gov/citations/20250002845
- Contrast point coordinates: NASA NSSDC Apollo landing sites; LROC (ASU/NASA) Chang'e-6 first look — https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_sites.html, https://lroc.asu.edu/images/1374

## Space agency partner and other data

- Skyfield with JPL DE421 ephemeris and lunar PA frame (independent cross-check) — https://rhodesmill.org/skyfield/

## References

- Barker, M.K. et al. (2021). Improved LOLA elevation maps for south pole landing sites. Planetary and Space Science 203, 105119. doi:10.1016/j.pss.2020.105119
- Barker, M.K. et al. (2023). A New View of the Lunar South Pole from LOLA. Planetary Science Journal 4, 183. doi:10.3847/PSJ/acf3e1
- Mazarico, E. et al. (2011). Illumination conditions of the lunar polar regions using LOLA topography. Icarus 211, 1066–1081.
- NASA GSFC, Solar irradiance (solar constant 1361 W/m²) — https://earth.gsfc.nasa.gov/climate/projects/solar-irradiance/science
