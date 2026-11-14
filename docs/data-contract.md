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
      "coordSource": "NASA Lunar Surface Data Book, Table A2.1-1",
      "demNear": "LOLA 5 m/px Site01 (Barker et al. 2021)",
      "demFar": "LDEM_80S_80MPP_ADJ (Barker et al. 2023)",
      "label": "Research region center — not a certified landing site",
      "warnings": []
    }
  ]
}
```

Optional fields for derived evaluation points (e.g. `Site04R`): `derivedFrom` (catalogue site id) and `derivation` (the reproducible rule, see `preprocess/ridge.py`). `warnings` may hold site notes (e.g. the Site04 catalogue coordinate lies on a ~32° crater wall) — show them in the UI.

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
    "maxRangeM": 100000, "farStepM": 40,
    "minRangeM": 10, "curvature": true
  },
  "warnings": []
}
```

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

## Sample data

`public/data/_sample/` holds synthetic files with exactly this shape (`source: "synthetic"`). Use them until real files land.
