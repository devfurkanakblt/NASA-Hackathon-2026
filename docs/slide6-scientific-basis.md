# Slide 6 — Scientific basis (content draft)

**Title:** Built on NASA data, checked against NASA results

**Left column — Data**
- Sites: NASA Lunar Surface Data Book (2025), Table A2.1-1 — 6 south-pole sites + 1 derived ridge point + 2 contrast sites (far side Chang'e-6 from LROC, Apollo 11 from NSSDC)
- Terrain: LOLA 5 m/px site maps + 80 m regional map (Barker et al. 2021, 2023)
- Sun & Earth: JPL Horizons, every 10 min, observer 2 m above the surface
- Horizon: 3600 directions × 250 km, lunar curvature included

**Right column — Validation (one table)**

| Check | Result |
|---|---|
| Horizons vs independent ephemeris (Skyfield/DE421) | ≤ 0.0001° |
| Horizon numerical convergence | ≤ 0.02° |
| Rise/set timing vs 1-min reference | ≤ 2.4 min (most sites ≤ 20 s) |
| Sun visibility vs NASA/Mazarico 18.6-yr product | 7/7 sites agree, rank corr. 0.96 |
| Shackleton crater floor | permanent shadow in both |
| Terrain vs NASA Moon Trek LOLA 5 m DEM (5 sites inside the mosaic) | RMS 1.3–2.4 m on gentle ground |

**Optional visuals** (`docs/figures/`): `site04-map.png` (catalogue point on the wall vs the lit ridge 1.9 km away)
for slides 3–5; `season-polar-sites.png` (Nov–Dec is the sunny season; year averages are lower) for slide 6 or Q&A.

**Bottom strip — Limits (small font)**
One observer height (2 m) · partial Sun disk approximated · DEM accuracy not claimed ·
near the pole a 0.05° horizon error = 30 min to 4 h in sunrise time · not a landing-site certification

**Speaker note (≈20 s):** "Every number comes from NASA and JPL data through scripts in our repo. We
checked the ephemeris against an independent library, the terrain math for convergence, and our
long-term sunlight against NASA's published illumination maps: all seven sites agree, and Shackleton's
floor stays in permanent shadow in both."
