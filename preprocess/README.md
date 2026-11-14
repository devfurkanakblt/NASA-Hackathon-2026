# Preprocessing (offline)

Generates the static data the web app reads from `public/data/`. No server runs at app time.
Format and units: [`docs/data-contract.md`](../docs/data-contract.md).

```bash
pip install -r preprocess/requirements.txt
python -m preprocess.download          # LOLA DEMs -> data_raw/dem (~300 MB, not committed)
python -m preprocess.build_all         # ephemeris + horizon + terrain + sites.json
python -m preprocess.validate          # -> docs/validation.md (Skyfield, horizon, Horizons re-query, rise/set timing)
python -m preprocess.reference         # -> docs/reference/visibility.{json,md} (expected values for the web app's tests)
python -m pytest preprocess/tests      # unit tests
python -m preprocess.make_sample       # synthetic sample in public/data/_sample
```

## Method

| Step | Source / model |
|---|---|
| Site coordinates | NASA Lunar Surface Data Book, Table A2.1-1 |
| Sun & Earth az/el | JPL Horizons API, observer `coord@301` (geodetic, MEAN_ME frame, R = 1737.4 km), airless, 10-min steps, observer 2 m above the DEM surface |
| Cross-check | Skyfield + DE421 + `moon_pa_de421` in the `MOON_ME_DE421` frame |
| Near terrain (≤ 7 km) | LOLA 5 m/px site DEMs (Barker et al. 2021) |
| Far terrain (7–250 km) | LOLA `LDEM_80S_80MPP_ADJ` (Barker et al. 2023) |
| Horizon | 3600 great-circle rays (0.1°), 2.5 m steps near / 40 m far, bilinear DEM sampling, exact spherical curvature: `elev = atan2(Rt cos θ − Ro, Rt sin θ)` |
| Site04R | Site04's catalogue coordinate lies on the ~32° inner wall of Shackleton. Derived ridge point: highest 5 m pixel with slope ≤ 10° (25 m baseline) within 2 km (`preprocess/ridge.py`); 1.9 km offset, stable for 2–3 km / 10–15° |
| 3D terrain | 256×256 ENU grid, ±5 km, 4× oversampled mean, curvature included. Visual only |

Azimuth: from local north, clockwise toward east. Elevation: above the local horizontal plane.

## References

- Barker, M.K. et al. (2021), *Improved LOLA elevation maps for south pole landing sites*, PSS 203, 105119. doi:10.1016/j.pss.2020.105119
- Barker, M.K. et al. (2023), *A New View of the Lunar South Pole from LOLA*, PSJ 4, 183. doi:10.3847/PSJ/acf3e1; data doi:10.60903/gsfcpgda-lola-spole
- Mazarico, E. et al. (2011), *Illumination conditions of the lunar polar regions using LOLA topography*, Icarus 211, 1066–1081
- JPL Horizons System, https://ssd.jpl.nasa.gov/horizons/
- Rhodes, B., Skyfield, https://rhodesmill.org/skyfield/
