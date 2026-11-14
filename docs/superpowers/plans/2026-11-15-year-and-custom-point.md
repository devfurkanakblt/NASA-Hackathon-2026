# One-year simulation and map-point simulation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the cached one-year ephemeris and per-cell horizons as lazily loaded binary files, so any date from 1 Nov 2026 to 1 Nov 2027 and any regional-map cell can be simulated with the existing engine; rewrite the map's near-field warning as a percentage.

**Architecture:** Python (`preprocess/extended.py`) reads existing caches (`data_raw/horizons_cache/`, `data_raw/map_*.npz`) and writes `year.bin`, `cells.bin` and a small `extended.json` header per site. The app keeps `loadAllData()` unchanged and loads the new files per site on demand; a cell becomes a synthetic `SiteData` (ephemeris re-projected into the cell's local frame, 1° horizon) that is added to the `bySite` map handed to the unchanged `evaluateScenario`.

**Tech Stack:** Python 3 + numpy (preprocess, pytest); React 19 + TypeScript + Vite, Vitest. No new dependencies (Windows `npm install` corrupts `package-lock.json`).

**Spec:** `docs/superpowers/specs/2026-11-15-year-and-custom-point-design.md`

## Global Constraints

- Year coverage: `2026-11-01T00:00:00Z` … `2027-11-01T00:00:00Z`, `stepS` 600, count 52 561 (both ends inclusive, as `season.query_year` asserts).
- `year.bin`: little-endian float32, six blocks of `count` values in order `sun.azDeg, sun.elDeg, sun.distanceM, earth.azDeg, earth.elDeg, earth.distanceM`.
- `cells.bin`: little-endian int16, unit 0.01°, row = cell in `map.json` order (row 0 = south, col 0 = west, row-major), 360 columns = azimuth `j × 1°`, taken as every second column of the 0.5° npz horizons (decimation, not averaging).
- `extended.json` fields: `version`, `siteId`, `year: {file: "year.bin", startUtc, stepS, count, source}`, and for map sites `cells: {file: "cells.bin", azStepDeg: 1, count: 360, unitDeg: 0.01, n, eyeM: number[]}` (`eyeM` = npz `eye`, height above the 1737.4 km sphere).
- Existing validated files (`ephemeris.json`, `horizon.json`, `map.json` numbers, `season.json`) are not changed; only the one near-field warning line in 7 `map.json` files is rewritten.
- `loadAllData()` and the first page load stay as they are; new files are fetched only per site, after first render.
- Cell label (exact copy): `Regional map point (1° horizon), not a catalogue site`.
- Coordinate input is limited to the ±3 km maps of polar sites; contrast points have no cells.
- UI copy is English.
- Cell id format: `<siteId>:r<row>c<col>` (e.g. `Site01:r36c32`). *Deviation from the spec's `Site01@30,42` example:* `@` and `,` are already separators in the share fragment.
- Year series is converted to `number[]` with `Array.from` at parse time so `BodySeries` keeps its type. *Deviation from the spec's "no copy" note; ~315 k numbers per site, negligible.*

## Review Focus

1. A date after 1 Jan 2027 is entered before `year.bin` has arrived → the scenario shows a loading message, then evaluates by itself once the file loads (not a permanent coverage error).
2. A shared link containing a cell id opens before `cells.bin` has arrived → the scenario shows "Loading…", not "No data for site".
3. Longitude typed as 0–360 (e.g. `320` instead of `-40`) or near the ±180 seam → snaps to the same cell as the −180…180 form.
4. A mission that runs past 1 Nov 2027 → `CoverageError` whose message names the one-year end.
5. `year.bin` / `cells.bin` missing or failing to fetch → the two-month simulation and the rest of the page keep working; only the new controls say "not available".

Each line has its test in the owning task (Tasks 4–6).

---

## File map

| File | Responsibility |
|---|---|
| `preprocess/extended.py` (new) | Writes `year.bin`, `cells.bin`, `extended.json`; rewrites the warning line; writes `docs/reference/cells.json`; `--check` prints cell-vs-map differences |
| `preprocess/regional_map.py` | New warning wording for future runs |
| `preprocess/tests/test_extended.py` (new) | Python checks of the files |
| `src/data/extended.ts` (new) | Types, binary parsers, cached per-site loaders |
| `src/sim/cell.ts` (new) | Cell ephemeris re-projection, `cellSiteData` |
| `src/app/extendedSites.ts` (new) | Cell ids, `resolveSiteData`, coordinate snapping |
| `src/data/contract.ts` | `HorizonDoc.distanceM` optional |
| `src/app/share.ts`, `MissionApp.tsx`, `ScenarioList.tsx`, `charts/SiteMap.tsx`, `charts/Panorama.tsx`, `Sources.tsx` | Wiring |
| `docs/data-contract.md`, `docs/validation.md` §7, `docs/ekip-notlari.md` | Docs |

---

### Task 1: `year.bin` + `extended.json` (Person A)

**Files:**
- Create: `preprocess/extended.py`, `preprocess/tests/test_extended.py`
- Create (generated): `public/data/<site>/year.bin`, `public/data/<site>/extended.json` for all 9 sites
- Modify: `docs/data-contract.md` (new section "extended.json / year.bin / cells.bin")

**Interfaces:**
- Consumes: `season.query_year(site_id) -> {'sun': rows, 'earth': rows}`, `season.as_eph(rows)`, `season.SEASON_START/STOP`, `validate.load`.
- Produces: `extended.year_array(site_id) -> np.ndarray` shape `(6, count)` float32; `extended.write_year(site_id) -> dict` (header `year` block); `extended.write_header(site_id, year: dict, cells: dict | None)`; CLI `python -m preprocess.extended [--sites ...] [--only year|cells|warning|reference] [--check]`.

- [ ] **Step 1: Write failing tests** in `preprocess/tests/test_extended.py` (skip if `public/data/Site01/year.bin` is missing, same pattern as `test_ridge.py`):

```python
def test_year_header():
    h = load("Site01", "extended.json")["year"]
    assert (h["startUtc"], h["stepS"], h["count"]) == ("2026-11-01T00:00:00Z", 600, 52561)
    assert (C.OUT_DIR / "Site01" / "year.bin").stat().st_size == 6 * 52561 * 4

@pytest.mark.parametrize("sid", list(C.SITES))
def test_year_matches_two_month_ephemeris(sid):
    y = read_year(sid)              # helper in the test: np.fromfile(..., "<f4").reshape(6, -1)
    e = load(sid, "ephemeris.json")
    n = e["count"]
    for k, (b, f) in enumerate([(b, f) for b in ("sun", "earth") for f in ("azDeg", "elDeg", "distanceM")]):
        tol = 1e-4 if f != "distanceM" else 2e4 if b == "sun" else 50.0
        assert np.max(np.abs(y[k, :n] - np.asarray(e[b][f]))) <= tol, (b, f)
```

- [ ] **Step 2:** Run `python -m pytest preprocess/tests/test_extended.py -q` → tests skipped (files missing). Temporarily run with the skip removed → FAIL (`year.bin` not found).
- [ ] **Step 3:** Implement `year_array`, `write_year`, `write_header` and the CLI `--only year`. Azimuth wrap: compare azimuth differences modulo 360 in the test helper if a value sits at 359.99/0.
- [ ] **Step 4:** Run `python -m preprocess.extended --only year` (must not hit the network when the cache is warm; it prints one line per site), then `python -m pytest preprocess/tests -q` → all pass.
- [ ] **Step 5:** Add the three files' description to `docs/data-contract.md` (Global Constraints values verbatim).
- [ ] **Step 6: Commit** `preprocess/extended.py preprocess/tests/test_extended.py public/data/*/year.bin public/data/*/extended.json docs/data-contract.md` — "Publish the one-year ephemeris as year.bin".

### Task 2: `cells.bin`, reference values, validation §7 (Person A)

**Files:**
- Modify: `preprocess/extended.py`, `preprocess/tests/test_extended.py`
- Create (generated): `public/data/<site>/cells.bin` for Site01, Site04, Site04R, Site07, Site11, Site20, Site23; `docs/reference/cells.json`
- Modify: `public/data/<site>/extended.json` (adds `cells`), `docs/validation.md` (new §7)

**Interfaces:**
- Consumes: `data_raw/map_<site>.npz` (`horizons` (N,720) float32, `eye`, `lat`, `lon`), `regional_map.body_vectors`, `regional_map.local_azel`, `regional_map.cell_stats`.
- Produces: `extended.cells_int16(site_id) -> np.ndarray` (N,360) int16; `extended.write_cells(site_id) -> dict` (header `cells` block); `docs/reference/cells.json` = list of `{siteId, row, col, index, samples: [{i, sun: {azDeg, elDeg}, earth: {azDeg, elDeg}}]}`; `extended.check(site_id) -> dict` max |Δ| in sun/earth/both % between the 1° horizon and `map.json` over the fixed test cells.

Fixed test cells (used here and in Task 5): centre plus `(row, col)` = `(5,5) (5,55) (55,5) (55,55) (30,10) (36,32)` on 61×61 maps; on 31×31 maps divide by 2 and floor. Reference file: 5 cells (Site01 centre, Site01 (36,32), Site04 (5,55), Site07 (55,5), Site11 (2,27)) × sample indices `[0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 8784]`, computed from `ephemeris.json` (float64) with `body_vectors` + `local_azel`.

- [ ] **Step 1: Write failing tests:**

```python
def test_cells_shape_and_decimation():
    hz = np.load(C.RAW_DIR / "map_Site01.npz")["horizons"]
    c = np.fromfile(C.OUT_DIR / "Site01" / "cells.bin", "<i2").reshape(-1, 360)
    assert c.shape == (3721, 360)
    assert np.max(np.abs(c / 100 - hz[:, ::2])) <= 0.005

def test_cells_header_eye():
    h = load("Site01", "extended.json")["cells"]
    assert h["n"] == 3721 and len(h["eyeM"]) == 3721 and h["azStepDeg"] == 1

@pytest.mark.parametrize("sid", ["Site01", "Site04", "Site04R", "Site07", "Site11", "Site20", "Site23"])
def test_one_degree_cells_match_map(sid):
    d = extended.check(sid)
    assert max(d["sunPct"], d["earthPct"], d["bothPct"]) <= 0.2
```

- [ ] **Step 2:** Run → FAIL (`cells.bin` missing / `check` undefined).
- [ ] **Step 3:** Implement `cells_int16` (`np.round(hz[:, ::2] * 100).astype("<i2")`), `write_cells`, `--only cells`, `--only reference`, `check` (re-uses `cell_stats` with `{"elevDeg": c/100, "azStepDeg": 1, "count": 360}`) and `--check` printing a table.
- [ ] **Step 4:** Run `python -m preprocess.extended --only cells`, `--only reference`, `--check`; then `python -m pytest preprocess/tests -q` → pass.
- [ ] **Step 5:** Write `docs/validation.md` §7 "Map points: 1° horizon vs map.json" with the `--check` table (max |Δ| per site) and one sentence on why the difference exists (0.5° → 1° decimation).
- [ ] **Step 6: Commit** — "Publish per-cell 1° horizons as cells.bin with reference values".

### Task 3: Near-field warning as a percentage (Person A)

**Files:**
- Modify: `preprocess/regional_map.py:167-168`, `preprocess/extended.py` (`--only warning`), 7 × `public/data/<site>/map.json` (one line each), `preprocess/tests/test_extended.py`

**Interfaces:**
- Produces: `extended.near_field_total(n_cells: int, n_az: int = 720) -> int` = `n_cells × n_az × count(d in Hz.distances() with d <= C.NEAR_RANGE_M)` (same `is_near` set as `horizon.compute`); `extended.near_field_warning(fallback: int, total: int) -> str`.

Exact copy: `f"{100 * fallback / total:.1f} % of terrain samples within {C.NEAR_RANGE_M / 1000:.0f} km of each cell fell outside the 5 m DEM and used the 80 m DEM"`.

- [ ] **Step 1: Failing tests:**

```python
def test_warning_text():
    assert extended.near_field_warning(27, 1000) == "2.7 % of terrain samples within 7 km of each cell fell outside the 5 m DEM and used the 80 m DEM"

def test_no_raw_counts_left_in_maps():
    for sid in MAP_SITES:
        assert not any("near-field ray samples" in w for w in load(sid, "map.json").get("warnings", []))
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement; `--only warning` reads the integer from the old line with `re.match(r"(\d+) near-field ray samples", w)`, replaces only that list item, writes with `writer.write`, and checks every other key is unchanged (assert before writing). Use the same functions in `regional_map.build`.
- [ ] **Step 4:** Run `python -m preprocess.extended --only warning`, `python -m pytest preprocess/tests -q`, `npm test` → pass (TS map tests still read `map.json`).
- [ ] **Step 5: Commit** — "Show the near-field DEM fallback as a percentage".

### Task 4: Binary parsers and lazy loaders (Person D)

**Files:**
- Create: `src/data/extended.ts`, `tests/extended.test.ts`
- Modify: `src/data/contract.ts` (`HorizonDoc.distanceM?: number[]`; fix the type errors this causes in `charts/Panorama.tsx:30` and `scene3d/SceneCanvas.tsx` by returning `undefined` when absent)

**Interfaces:**
- Consumes: files from Tasks 1–2.
- Produces:
  ```ts
  export interface ExtendedHeader { version: number; siteId: string
    year: { file: string; startUtc: string; stepS: number; count: number; source: string }
    cells?: { file: string; azStepDeg: number; count: number; unitDeg: number; n: number; eyeM: number[] } }
  export interface CellHorizons { azStepDeg: number; count: number; n: number; eyeM: number[]; data: Int16Array; unitDeg: number }
  export function parseYear(siteId: string, header: ExtendedHeader, buf: ArrayBuffer): EphemerisDoc
  export function parseCells(header: ExtendedHeader, buf: ArrayBuffer): CellHorizons
  export function cellHorizon(cells: CellHorizons, index: number): HorizonDoc   // no distanceM
  export function loadYear(siteId: string, baseUrl?: string): Promise<EphemerisDoc>      // cached per site
  export function loadCells(siteId: string, baseUrl?: string): Promise<CellHorizons>     // cached per site
  ```
  Loaders share one cached `extended.json` fetch per site; a failed promise is removed from the cache so a retry is possible; default `baseUrl` = `${import.meta.env.BASE_URL}data` as in `load.ts`.

- [ ] **Step 1: Failing tests** in `tests/extended.test.ts` (read files with `node:fs` like `tests/mapSeason.test.ts`):

```ts
it('year series reproduces ephemeris.json over the two months', () => { /* every site: |Δaz| (mod 360), |Δel| <= 1e-4 for i < ephemeris.count */ })
it('year series gives season.json monthly percentages', () => {
  // Site01, Site07, CE6: for each month [startIndex, endIndex): sunPct/earthPct/bothPct from marginSeries(...) > 0
  // with the site's horizon.json; |Δ| <= 0.01 vs season.json
})
it('a mission past the year end throws CoverageError naming 2027-11-01', () => {
  // evaluateScenario({...site01, ephemeris: year}, '2027-10-30T00:00:00Z', {...DEFAULT_SETTINGS, durationDays: 7})
  // expect toThrow(CoverageError) and message toContain('2027-11-01')
})
it('loadYear rejects with the file name when year.bin is missing, and a later call retries', async () => { /* stub fetch: 404 then 200 */ })
```

- [ ] **Step 2:** `npx vitest run tests/extended.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement `src/data/extended.ts` per the interface (`new Float32Array(buf)`, blocks of `count`, `Array.from`; `source` from header).
- [ ] **Step 4:** `npm test` and `npx tsc -b` → pass, no type errors.
- [ ] **Step 5: Commit** — "Load one-year ephemeris and cell horizons per site on demand".

### Task 5: Cell ephemeris and `cellSiteData` (Person D)

**Files:**
- Create: `src/sim/cell.ts`, `src/sim/cell.test.ts`

**Interfaces:**
- Consumes: `EphemerisDoc`, `SiteData`, `MapDoc` (cell `latDeg/lonDeg/surfaceElevationM`), `CellHorizons`, `cellHorizon` (Task 4).
- Produces:
  ```ts
  export const MOON_RADIUS_M = 1737400
  export function cellEphemeris(eph: EphemerisDoc, centre: { latDeg: number; lonDeg: number; eyeM: number },
                                cell: { latDeg: number; lonDeg: number; eyeM: number }): EphemerisDoc
  export function cellSiteData(base: SiteData, year: EphemerisDoc, cells: CellHorizons, row: number, col: number): SiteData
  ```
  `centre.eyeM` = `site.surfaceElevationM + site.observerHeightM`. Algorithm = `regional_map.body_vectors` then `local_azel` (ENU basis: up = (cosφcosλ, cosφsinλ, sinφ), north = (−sinφcosλ, −sinφsinλ, cosφ), east = (−sinλ, cosλ, 0); position = (R+eye)·up; body = p_c + dist·u; seen from the cell: v = body − p_cell, az = atan2(v·E, v·N) mod 360, el = atan2(v·U, hypot)). `distanceM` = |v|.
  `cellSiteData`: `site` = copy of base with `id = "<base>:r<row>c<col>"`, `name = "<base.name> — map point"`, `latDeg/lonDeg/surfaceElevationM` of the cell, `label` = exact copy from Global Constraints, `derivedFrom = base.site.id`, `warnings = []`; `horizon = cellHorizon(cells, row*nx+col)`; `ephemeris = cellEphemeris(year, …)`; `terrain`, `season`, `map` from base.

- [ ] **Step 1: Failing tests:**

```ts
it('matches the Python re-projection (docs/reference/cells.json)', () => {
  // for each reference cell and sample: cellEphemeris(ephemeris.json of the site, ...) az/el within 0.001° (az mod 360)
})
it('the centre cell reproduces the site ephemeris', () => { /* |Δ| <= 1e-6° */ })
it('cell percentages over the two months match map.json within 0.2 points', () => {
  // 7 map sites × Task 2's fixed cells: marginSeries on cellSiteData(...) for i < ephemeris.count
})
it('cell scenario evaluates in April 2027', () => {
  // evaluateScenario(cellSiteData(Site07 ..., 55, 5), '2027-04-10T00:00:00Z', DEFAULT_SETTINGS) has result.count > 0
})
```

- [ ] **Step 2:** `npx vitest run src/sim/cell.test.ts` → FAIL.
- [ ] **Step 3:** Implement `src/sim/cell.ts`.
- [ ] **Step 4:** `npm test` → pass.
- [ ] **Step 5: Commit** — "Simulate a regional map cell with the site's ephemeris re-projected".

### Task 6: Cell ids, site resolution, coordinate snapping, share links (Person B)

**Files:**
- Create: `src/app/extendedSites.ts`, `tests/extendedSites.test.ts`
- Modify: `src/app/share.ts`, `src/app/share.test.ts`

**Interfaces:**
- Consumes: `cellSiteData` (Task 5), `EphemerisDoc`, `CellHorizons` (Task 4), `cellAt` from `mapGrid.ts`.
- Produces:
  ```ts
  export function cellId(siteId: string, row: number, col: number): string
  export function parseCellId(id: string): { siteId: string; row: number; col: number } | null
  export interface ExtendedState { years: Record<string, EphemerisDoc | 'loading' | 'error'>; cells: Record<string, CellHorizons | 'loading' | 'error'> }
  /** Data the engine should use for a scenario's site id: year series when loaded, a cell when its files are loaded. */
  export function needsYear(id: string, startUtc: string, coverageEndUtc: string): boolean
  export function resolveSiteData(id: string, startUtc: string, coverageEndUtc: string, bySite: Record<string, SiteData>, ext: ExtendedState):
    { data: SiteData } | { loading: string } | { error: string }
  export function sitesNeeded(scenarios: { siteId: string; startUtc: string }[], coverageEndUtc: string): { years: string[]; cells: string[] }   // base site ids to fetch
  export function snapToCell(latDeg: number, lonDeg: number, bySite: Record<string, SiteData>):
    { siteId: string; row: number; col: number; distanceM: number } | { error: string }
  ```
  `needsYear`: true for any cell id, and for a plain site whose start is later than `coverageEndUtc` minus 1 day (the mission could not fit in the two months). `resolveSiteData` rules: plain site with `!needsYear` → always base (two-month, float64) data, so the validated demo numbers cannot shift by float32 rounding at a threshold; plain site with `needsYear` → year-swapped data when loaded, else `{ loading: 'Loading one-year data…' }` while loading or `{ error: 'One-year data not available.' }` on error. Cell id → needs its base's year and cells: `{ loading: 'Loading map point…' }` while either loads, `{ error: 'Map point data not available.' }` on error, else `{ data: cellSiteData(...) }`. `sitesNeeded` uses `needsYear` and `parseCellId`, so the rule lives in one place.
  `snapToCell`: normalise lon to (−180, 180]; nearest cell over all `map` grids by great-circle distance (R = 1 737 400 m); error `"Outside the ±3 km maps around the polar sites."` when that distance > the grid's `spacingM`.
  `decodeShare(hash, isKnownSite: (id: string) => boolean)` replaces the `siteIds: string[]` parameter; MissionApp passes a function accepting site ids and valid cell ids of map sites.

- [ ] **Step 1: Failing tests:**

```ts
it('round-trips cell ids', () => { expect(parseCellId(cellId('Site04R', 5, 55))).toEqual({ siteId: 'Site04R', row: 5, col: 55 }); expect(parseCellId('Site04R')).toBeNull() })
it('a cell is loading until both files are there', () => { /* ext with year loaded, cells 'loading' → { loading } ; not "No data" */ })
it('a plain site needing the year falls back to loading, then data', () => {})
it('a missing year.bin leaves two-month scenarios working', () => { /* years: { Site04: 'error' }, start 2026-11-15 → { data } with ephemeris.count 8785 */ })
it('snaps Site01 ridge coordinates to row 36 col 32', () => { /* lat/lon from Site01 map.json cell (36,32) */ })
it('accepts longitude given as 0–360', () => { /* same cell with lon + 360 */ })
it('rejects a point 10 km away and contrast points', () => {})
it('share link keeps a cell scenario', () => { /* encodeShare → decodeShare with isKnownSite accepting cell ids */ })
```

- [ ] **Step 2:** `npx vitest run tests/extendedSites.test.ts src/app/share.test.ts` → FAIL.
- [ ] **Step 3:** Implement; update existing `share.test.ts` calls to the new `decodeShare` signature.
- [ ] **Step 4:** `npm test` → pass.
- [ ] **Step 5: Commit** — "Resolve cell and one-year scenarios; snap coordinates to map cells".

### Task 7: UI wiring (Person B)

**Files:**
- Modify: `src/app/MissionApp.tsx`, `src/app/ScenarioList.tsx`, `src/app/charts/SiteMap.tsx`, `src/app/charts/Panorama.tsx`, `src/app/Sources.tsx`, `src/app/scenarios.ts` (`evaluateAll` takes a resolver), `tests/appScenarios.test.ts`
- Modify: `docs/ekip-notlari.md` (one line per person: what changed), `docs/submission.md` (date range and map-point sentence)

**Interfaces:**
- Consumes: everything from Tasks 4–6.
- Produces (UI only):
  - `evaluateAll(scenarios, settings, resolve: (id: string, startUtc: string) => { data: SiteData } | { loading: string } | { error: string })`; a `loading` result is shown on the scenario like an error but in muted style. Update `tests/appScenarios.test.ts` with a resolver that returns base data; the demo numbers must stay the same.
  - `MissionApp` holds `ExtendedState`; an effect calls `loadYear`/`loadCells` for what `sitesNeeded` lists plus the year of every scenario's base site (in the background after first render) and stores results; the resolver is `(id, startUtc) => resolveSiteData(id, startUtc, sites.coverage.endUtc, bySite, ext)`.
  - `ScenarioList`: date `max` per scenario = year end when that site's year is loaded, else `sites.coverage.endUtc`; new row "Lat / Lon (±3 km of a site)" with a "Use point" button → `snapToCell` → sets the active scenario's `siteId` to the cell id and shows `Snapped to <id> (<n> m away)` or the error.
  - `SiteMap`: new optional prop `onSimulate?: (siteId: string, row: number, col: number) => void`; button "Simulate this point" under the picked-cell readout; remove "so a cell cannot be simulated as a scenario" from the component comment. When the active scenario is a cell, the map shows that cell as picked.
  - `Panorama`: no "formed by terrain X km away" text when `distanceM` is absent.
  - `Sources`: for a cell shows its `label` and "1° horizon, no distance data; summary maps use 0.5°".
  - 3D card: when the active site id is a cell id, show `The 3D view shows the catalogue point; the selected map point is <offset> from it.` instead of the scene.

- [ ] **Step 1:** Update `tests/appScenarios.test.ts` for the new `evaluateAll` signature; add one test: a resolver returning `{ loading: 'Loading one-year data…' }` gives an outcome with `result: null` and that text.
- [ ] **Step 2:** `npm test` → the new test FAILS.
- [ ] **Step 3:** Implement the wiring above.
- [ ] **Step 4:** `npm test`, `npx tsc -b`, `npm run lint`, `npm run build` → all pass.
- [ ] **Step 5: Manual check** with `npm run dev` (use the `run` skill): (a) default page numbers unchanged; (b) set scenario B to `2027-04-10T00:00` → "Loading…" then results; (c) Site01 map → pick the ridge cell (+200 m E, +600 m N) → "Simulate this point" → comparison shows the cell with label; (d) type the Site01 ridge lat/lon → same cell; (e) copy link, open in a new tab → cell scenario restored; (f) DevTools Network: first load requests unchanged, `year.bin`/`cells.bin` appear only afterwards.
- [ ] **Step 6:** Update `docs/ekip-notlari.md` and `docs/submission.md` ("start date (1 Nov 2026 – 1 Nov 2027 UTC)", "any 100 m map cell can be simulated as a scenario").
- [ ] **Step 7: Commit** — "Pick any date in the year and simulate any map point in the app".
