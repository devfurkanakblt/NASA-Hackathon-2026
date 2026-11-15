# A — Veri kapsamı, extended sözleşmesi ve hassasiyet etiketleri: Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A'ya bırakılan 15 Kasım notlarının hepsini kapatmak. Kapsanacaklar: doğrulanabilir extended veri sözleşmesi, desteklenen alanı tanımlayan kapsam metadata'sı, serbest koordinat için veri paketi üretici, hassasiyet/köken etiketleri, finalist hücreleri ince ufukla doğrulama, A/D önbellek sözleşmesi ve kabul testleri.

**Architecture:** Python üreticileri (`preprocess/`) her binary dosyanın yanına sürüm, gözlemci, kapsam ve hash bilgisi taşıyan metadata yazar. TypeScript tarafı (`src/data/`) bu metadata'yı ve binary değerleri açıkça doğrular, hatalı dosyayı adıyla reddeder. Serbest koordinat ve hücre finalistleri çevrimdışı komutlarla üretilir. Uygulama hiçbir zaman kapsam dışına sessizce kırpmaz. Ay'a sabit gövde vektörleri her site/yıl için bir kez hesaplanır ve yalnız görev dilimi aday hücreye yansıtılır.

**Tech Stack:** Python 3.14 (numpy 2.x, rasterio, pytest), TypeScript + Vite + Vitest.

**Spec:** `docs/ekip-notlari.md`: A başlığı satır 8–13, B/D başlıklarında A'ya düşen kısımlar satır 149 ve 152. Mevcut format `docs/data-contract.md` §`extended.json`.

## Global Constraints

- Dal: `feat/a-data-scope` (`main`'den). `main`'e doğrudan commit yok.
- Mevcut zaman kapsamı: `2026-11-01T00:00:00Z` … `2027-11-01T00:00:00Z`, `stepS` 600, `count` 52 561 (iki uç dahil).
- Çözünürlükler: katalog ufku 0.1°, hücre ufku 1°, `map.json` özeti 0.5°. Bu değerler metadata'da sayı olarak yazılır, kodda tahmin edilmez.
- Gözlemci: yüzey + `OBSERVER_HEIGHT_M` = 2 m. Ufuk ve efemeris aynı göz yüksekliğini kullanır.
- Kapsam dışı girişte kırpma, sıfır ufuk ya da uydurma seri yok. Açık hata ve neden gösterilir.
- Arayüz/metadata metinleri İngilizce. Hücre sonuçları `"regional screening estimate"` ifadesini taşır.
- 100/200 m hücre aralığı veya DEM pikseli mutlak doğruluk olarak sunulmaz.
- İyi aydınlanma "düz", "eğimsiz" ya da "inişe güvenli" anlamına gelmez.
- Kaynaklar doğru adıyla yazılır. NASA verisi ile Google Moon hizmeti karıştırılmaz. Dünya görüntüsü "archive composite" olarak sunulur.
- `src/sim/` D'nin, `src/app/` B'nin alanı. Task 2 ve 7 D ile ortak; PR'da D reviewer olarak eklenir.
- Kabul: `npm test`, `npx tsc -b`, `python -m pytest preprocess/tests` temiz geçer.

## Review Focus

1. **Boylam ±180° sarması:** `179.999°` ve `-180.001°` aynı noktadır. Kapsam sınıflandırması, snap ve paket üretici aynı sonucu vermeli. Test: Task 3 ve Task 4.
2. **Header ile bin uyuşmazlığı:** `year.bin` yeniden üretildi ama `extended.json` eski kaldı. Hash kontrolü bunu yakalamalı. Test: Task 2 (`sha256` uyuşmazlığı).
3. **5 m DEM kenarındaki nokta:** Nokta karonun içinde ama 7 km yakın menzil kısmen dışarıda. Üretici reddetmeli, 80 m'ye sessizce düşmemeli. Test: Task 4 (`near-field outside 5 m tile`).
4. **Son geçerli başlangıç:** `start + duration == coverageEnd` kabul edilir, 600 s sonrası reddedilir. Test: Task 8.
5. **int16 sentinel / NaN:** `cells.bin` içinde `-32768` ya da `year.bin` içinde NaN/Inf varsa dosya reddedilir, değer 0'a çevrilmez. Test: Task 2.

---

### Task 1: Extended metadata'yı üreticide genişlet

**Files:**
- Modify: `preprocess/extended.py` (`write_year`, `write_cells`, `write_header`)
- Modify: `docs/data-contract.md` §`extended.json`
- Test: `preprocess/tests/test_extended.py`

**Interfaces:**
- Produces: `extended.json` şeması (`extendedSchema: 2`):

```jsonc
{
  "version": 1, "extendedSchema": 2, "siteId": "Site01",
  "year": { "file": "year.bin", "sha256": "…", "startUtc": "2026-11-01T00:00:00Z", "endUtc": "2027-11-01T00:00:00Z",
            "stepS": 600, "count": 52561, "source": "jpl-horizons",
            "observer": { "latDeg": -89.4632, "lonDeg": -137.49, "eyeM": 1662.3 },
            "fields": ["sun.azDeg","sun.elDeg","sun.distanceM","earth.azDeg","earth.elDeg","earth.distanceM"] },
  "cells": { "file": "cells.bin", "sha256": "…", "azStartDeg": 0, "azStepDeg": 1, "count": 360, "coverageDeg": 360,
             "unitDeg": 0.01, "horizonResolutionDeg": 1, "n": 3721, "eyeM": [ … ],
             "grid": { "nx": 61, "ny": 61, "spacingM": 100, "halfSizeM": 3000 } }
}
```

- [ ] **Step 1: Write the failing tests**

```python
@pytest.mark.parametrize("sid", list(C.SITES))
def test_header_schema_2(sid):
    h = load(sid, "extended.json")
    y = h["year"]
    assert h["extendedSchema"] == 2 and h["siteId"] == sid
    assert (y["startUtc"], y["endUtc"], y["stepS"], y["count"]) == ("2026-11-01T00:00:00Z", "2027-11-01T00:00:00Z", 600, 52561)
    assert y["fields"] == [f"{b}.{f}" for b in ("sun", "earth") for f in ("azDeg", "elDeg", "distanceM")]
    assert y["sha256"] == sha256_file(C.OUT_DIR / sid / "year.bin")

@pytest.mark.parametrize("sid", list(C.SITES))
def test_year_observer_equals_horizon_observer(sid):
    s = next(x for x in load_sites() if x["id"] == sid)
    o = load(sid, "extended.json")["year"]["observer"]
    assert (o["latDeg"], o["lonDeg"]) == (s["latDeg"], s["lonDeg"])
    assert abs(o["eyeM"] - (s["surfaceElevationM"] + s["observerHeightM"])) <= 0.01

@pytest.mark.parametrize("sid", MAP_SITES)
def test_cells_header_schema_2(sid):
    c = load(sid, "extended.json")["cells"]
    m = load(sid, "map.json")["grid"]
    assert (c["azStartDeg"], c["azStepDeg"], c["count"], c["coverageDeg"], c["horizonResolutionDeg"]) == (0, 1, 360, 360, 1)
    assert c["grid"]["nx"] == m["nx"] and c["n"] == m["nx"] * m["ny"] == len(c["eyeM"])
    assert c["sha256"] == sha256_file(C.OUT_DIR / sid / "cells.bin")

@pytest.mark.parametrize("sid", list(C.SITES))
def test_year_bin_all_finite(sid):
    assert np.isfinite(read_year(sid)).all()
```

- [ ] **Step 2: Run, expect FAIL** (`KeyError: 'extendedSchema'`)

Run: `python -m pytest preprocess/tests/test_extended.py -v`

- [ ] **Step 3: Implement**
  - `sha256_file(path) -> str` goes in `preprocess/writer.py` (hashlib, 1 MB blocks).
  - Before writing, `write_year` asserts `np.isfinite(y).all()` and `write_cells` asserts `(c != -32768).all()`. On failure the file is not written and the error names the site.
  - `observer.eyeM` comes from `validate.load_eye(site_id)`, the same source `season.query_year` uses.
  - `write_header` adds `extendedSchema: 2`. `endUtc` comes from `season.SEASON_STOP`.

- [ ] **Step 4: Regenerate** `python -m preprocess.extended --only year` then `--only cells` (from cache, no network). Run `git diff --stat public/data`. Expect only `extended.json` to change. The `.bin` files should stay byte-identical: check that `sha256` matches the old file.

- [ ] **Step 5: Run tests, expect PASS.** Update the example and field descriptions in `docs/data-contract.md`.

- [ ] **Step 6: Commit** — `Describe observer, coverage and hashes in extended.json`

---

### Task 2: Strict parsing of `parseYear` / `parseCells` (with D)

**Files:**
- Modify: `src/data/extended.ts`
- Test: `tests/extended.test.ts` (synthetic fixtures)

**Interfaces:**
- Consumes: Task 1 schema.
- Produces:
  - `ExtendedHeader` type (schema 2 fields).
  - `validateExtendedHeader(h: unknown, siteId: string): string[]`. An empty array means valid. Each message is an English sentence that includes `siteId/extended.json`.
  - `parseYear` and `parseCells` throw `Error` with the file name on: invalid header, byte-length mismatch, non-finite value, or the `-32768` sentinel.
  - `SUPPORTED_EXTENDED_SCHEMA = 2`.

- [ ] **Step 1: Write the failing tests** (small synthetic buffers, `count` = 3)

```ts
it('rejects a header from another site', () => expect(validateExtendedHeader({ ...hdr, siteId: 'Site04' }, 'Site01')).toContainEqual(expect.stringMatching(/siteId/)))
it('rejects an unsupported schema', () => expect(validateExtendedHeader({ ...hdr, extendedSchema: 1 }, 'Site01').length).toBeGreaterThan(0))
it('rejects stepS other than 600, unparsable startUtc, endUtc ≠ start + (count−1)·stepS', …)
it('rejects fields in another order', …)
it('rejects cells whose azStepDeg·count ≠ 360 or azStartDeg ≠ 0', …)
it('rejects eyeM of the wrong length or with a non-finite value', …)
it('parseYear rejects NaN and Infinity in year.bin and names the file', () => expect(() => parseYear('Site01', hdr, bufWith(NaN))).toThrow(/Site01\/year\.bin.*finite/))
it('parseCells rejects the int16 sentinel −32768', () => expect(() => parseCells(hdr, cellsWith(-32768))).toThrow(/cells\.bin/))
it('the real Site01 header passes validation', async () => expect(validateExtendedHeader(readJson('public/data/Site01/extended.json'), 'Site01')).toEqual([]))
```

- [ ] **Step 2: Run, expect FAIL.** `npx vitest run tests/extended.test.ts`

- [ ] **Step 3: Implement.** `loadHeader` calls `validateExtendedHeader`. If issues come back, it rejects with them joined. The browser does not check `sha256` at runtime because hashing large files costs CPU on each load. Instead, `npm test` checks the real files' hashes in the next step.

- [ ] **Step 4: Add a test that compares `sha256` against `node:crypto`** for every real `.bin` (Node test, `tests/extended.test.ts`). This covers Review Focus #2.

- [ ] **Step 5: Run tests, expect PASS** (`npm test`, `npx tsc -b`).

- [ ] **Step 6: Commit** — `Validate extended headers and binary values before use`

---

### Task 3: Supported-area metadata (`coverage.json`)

**Files:**
- Create: `preprocess/coverage.py`, `preprocess/tests/test_coverage.py`
- Create: `src/data/coverage.ts`, `src/data/coverage.test.ts`
- Modify: `src/data/load.ts` (optional file, `optional(getJson(...))` pattern), `src/data/contract.ts`, `docs/data-contract.md`

**Interfaces:**
- Produces `public/data/coverage.json`:

```jsonc
{ "version": 1,
  "time": { "startUtc": "2026-11-01T00:00:00Z", "endUtc": "2027-11-01T00:00:00Z", "stepS": 600,
            "mainPeriodEndUtc": "2027-01-01T00:00:00Z" },
  "catalogue": [ { "siteId": "Site01", "latDeg": …, "lonDeg": …, "horizonResolutionDeg": 0.1 } ],
  "maps": [ { "siteId": "Site01", "halfSizeM": 3000, "spacingM": 100, "horizonResolutionDeg": 1,
              "summaryResolutionDeg": 0.5, "summaryPeriod": ["2026-11-01T00:00:00Z", "2027-01-01T00:00:00Z"] } ],
  "dems": [ { "name": "LOLA 5 m/px Site01", "kind": "local-5m", "bounds": { "crs": "…", "xMin": …, … } },
            { "name": "LDEM_80S_80MPP_ADJ", "kind": "regional-80m", "latMaxDeg": -80 },
            { "name": "LDEM_64", "kind": "global-474m" } ],
  "freePoints": "not supported in the app; generate a package with python -m preprocess.custom_point" }
```

- Python: `classify_point(lat: float, lon: float) -> dict` returns `{"kind": "map-cell"|"local-5m"|"regional-80m"|"global-only"|"invalid", "tile": str|None, "reason": str}`. `local-5m` means the near range (`NEAR_RANGE_M`, 7 km) lies entirely inside a 5 m tile.
- TS: `pointCoverage(lat: number, lon: number, cov: CoverageDoc, bySite): { kind: 'catalogue'|'map-cell'|'outside'; siteId?: string; snappedLatDeg?: number; snappedLonDeg?: number; distanceM?: number; message: string }`. It uses the existing `snapToCell`. On `outside`, the message names the nearest map and its distance.

- [ ] **Step 1: Write the failing tests**

```python
def test_site01_centre_is_local_5m():            assert classify_point(-89.4632, -137.49)["kind"] in ("map-cell", "local-5m")
def test_lon_wraps():                            assert classify_point(-89.4632, 222.51) == classify_point(-89.4632, -137.49)
def test_equator_is_global_only():               assert classify_point(0.0, 0.0)["kind"] == "global-only"
def test_lat_out_of_range_is_invalid():          assert classify_point(-91, 0)["kind"] == "invalid"
def test_edge_of_tile_is_not_local_5m():         # a point ~2 km inside the tile edge: the 7 km near range spills out
    assert classify_point(*point_inside_tile_edge("Site01", 2000))["kind"] != "local-5m"
```

```ts
it('snapped point reports the snapped coordinate and distance', …)    // kind 'map-cell', distanceM ≤ spacingM
it('180° and −180° snap to the same cell', …)
it('a point 10 km from every map is outside and names the nearest map with its distance', …)
it('missing coverage.json does not break loadAllData', …)
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement.** Read tile bounds with `rasterio.open(...).bounds`. Get lat/lon → x/y from `dem.to_xy`. Fill `catalogue`/`maps` from `sites.json` + `map.json`. Command: `python -m preprocess.coverage`.

- [ ] **Step 4: Generate the file, run tests, expect PASS.**

- [ ] **Step 5: Commit** — `Publish supported area and time range as coverage.json`

---

### Task 4: Data package generator for a free coordinate

**Files:**
- Create: `preprocess/custom_point.py`, `preprocess/tests/test_custom_point.py`
- Modify: `preprocess/season.py` (`query_year` gets `start`, `stop`, `lat`, `lon`, `eye` parameters; defaults keep current behaviour)
- Modify: `preprocess/README.md`

**Interfaces:**
- Consumes: `coverage.classify_point` (Task 3), `build_all` horizon/terrain steps, `extended` year/header writers (Task 1).
- Produces: `python -m preprocess.custom_point --id P001 --lat -89.45 --lon -137.2 [--start 2026-11-01T00:00:00Z --stop 2027-11-01T00:00:00Z] [--source horizons|skyfield]`. Output goes to `public/data/custom/P001/`:
  - `horizon.json` (0.1°)
  - `terrain.json`
  - `ephemeris.json` (first 2 months)
  - `year.bin` + `extended.json` (schema 2, `observer` = same eye)
  - `site.json` (`site_entry` format, `category: "custom"`, `label: "Custom point - not a catalogue site, not a certified landing site"`)
- Rejections exit with code 2 and print an English reason. Nothing is written: no partial directory is left behind (write to a temp directory, then rename).

- [ ] **Step 1: Write the failing tests** (the DEM-dependent ones are skipped when `data_raw/dem` is missing)

```python
def test_rejects_point_without_5m_near_field():       # global-only point
    assert run(["--id", "X", "--lat", "0", "--lon", "0"]).returncode == 2 and "5 m" in run(...).stderr
def test_rejects_start_not_on_600s_grid():            # --start 2026-11-01T00:04:00Z
def test_rejects_stop_before_start(): …
def test_no_partial_output_on_rejection():            assert not (C.OUT_DIR / "custom" / "X").exists()
def test_lon_normalised_in_site_json():               # --lon 222.51 → lonDeg -137.49
@needs_dem
def test_catalogue_coordinate_reproduces_site01(tmp_out):   # same coordinate as Site01 → horizon same as Site01 within 0.01°, eyeM same
def test_package_observer_is_shared(tmp_out):          # extended.year.observer.eyeM == site.surfaceElevationM + 2
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement.** Add a temporary `C.SITES[id] = dict(name=…, lat, lon, tile=<classify tile>)` entry and call `build_all.build_site`. Do not touch `sites.json`; the package carries its own `site.json`. The `--far-range` default is `C.FAR_RANGE_M`. If `coverage_check` finds missing far terrain, write that as a `warnings` entry; never zero it out. App integration (loading the package into the selector) is not part of this plan. B/D will do it later; write that as a note in `ekip-notlari.md` in Task 8.

- [ ] **Step 4: Run tests, expect PASS.** One manual run: `--id P001 --lat -89.4632 --lon -137.49 --source skyfield`. Compare with the Site01 horizon.

- [ ] **Step 5: Commit** — `Generate a data package for a coordinate inside the 5 m DEM coverage`

---

### Task 5: Provenance and precision labels

**Files:**
- Modify: `src/data/contract.ts` (`Provenance` type, `SiteData.provenance?`)
- Modify: `src/data/load.ts` (catalogue sites), `src/sim/cell.ts` (`cellSiteData`, `CELL_LABEL`)
- Test: `src/sim/cell.test.ts`, `src/data/load.test.ts`

**Interfaces:**
- Produces:

```ts
export interface Provenance {
  latDeg: number; lonDeg: number; observerHeightM: number; eyeM: number
  horizonResolutionDeg: number          // 0.1 catalogue, 1 cell, 0.1 refined cell
  horizonSource: 'catalogue' | 'map-cell' | 'refined-cell'
  ephemerisSource: string; dataHash: string | null   // year.sha256 or null on the two-month series
  precision: 'catalogue' | 'regional screening estimate'
  coverageWarnings: string[]
}
```

- `CELL_LABEL = 'Regional screening estimate (1° horizon), not a catalogue site'`

- [ ] **Step 1: Write the failing tests**

```ts
it('catalogue site carries 0.1° provenance', () => expect(data.Site01.provenance).toMatchObject({ horizonResolutionDeg: 0.1, precision: 'catalogue' }))
it('cell carries 1° screening provenance with its own coordinate and eye', () => {
  const p = cellSiteData(base, year, cells, 36, 32).provenance!
  expect(p).toMatchObject({ horizonResolutionDeg: 1, horizonSource: 'map-cell', precision: 'regional screening estimate', eyeM: cells.eyeM[36 * 61 + 32] })
  expect(p.dataHash).toBe(header.year.sha256)
})
it('cell label says regional screening estimate', () => expect(CELL_LABEL).toMatch(/screening estimate/))
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** `cellSiteData` takes a new parameter, `header: ExtendedHeader`, to get `dataHash`. Update the existing callers (`src/app/extendedSites.ts`). Find tests that hard-code the old label text with grep and update them.
- [ ] **Step 4: `npm test` PASS. Commit** — `Carry provenance and precision with every scenario site`

---

### Task 6: Revalidating finalist cells with a 0.1° horizon

**Files:**
- Create: `preprocess/refine_cells.py`, `preprocess/tests/test_refine_cells.py`
- Modify: `src/data/extended.ts` (`loadRefined`), `src/sim/cell.ts` (use the refined horizon)
- Test: `src/sim/cell.test.ts`

**Interfaces:**
- Produces: `python -m preprocess.refine_cells --site Site01 --cells r36c32 r10c5`. Writes `public/data/Site01/refined.json` (merges with the existing file):

```jsonc
{ "version": 1, "siteId": "Site01", "cellsSha256": "<cells.bin sha256>",
  "cells": { "r36c32": { "latDeg": …, "lonDeg": …, "eyeM": …, "azStepDeg": 0.1, "count": 3600,
                         "elevDeg": [ … ], "distanceM": [ … ], "warnings": [ … ] } } }
```

- The eye height is the `cells.eyeM[i]` value: the same observer as the 1° horizon.
- TS: `loadRefined(siteId): Promise<RefinedDoc | null>` returns `null` when the file is missing. If `cellsSha256` does not match the `cells.sha256` in the header, it is rejected as stale.
- `cellSiteData(..., refined?)` → when there is a refined horizon: `horizonResolutionDeg: 0.1`, `horizonSource: 'refined-cell'`, `precision: 'catalogue'`. Otherwise the result from Task 5 is unchanged.

- [ ] **Step 1: Write the failing tests**

```python
@needs_dem
def test_refined_matches_1deg_within_tolerance():   # at every 1° column, refined max over [j-0.5°, j+0.5°] ≥ cells value − 0.05°
def test_refined_eye_equals_cells_eye(): …
def test_unknown_cell_id_rejected(): …               # r99c99 → exit 2
```

```ts
it('a refined cell switches to 0.1° provenance', …)
it('a refined file with a stale cellsSha256 is ignored with a warning', …)
```

- [ ] **Step 2: Run, expect FAIL. Step 3: Implement** (reuse `horizon.compute` + the halved-step refinement from `build_all.build_site`).
- [ ] **Step 4: Refine the presentation cells:** Site01 `r36c32` plus the `REFERENCE_CELLS` in `docs/reference/cells.json`. Report the difference between the 1° and 0.1° results in `docs/validation.md` §7.
- [ ] **Step 5: Tests PASS. Commit** — `Refine finalist map cells with the 0.1° catalogue horizon`

---

### Task 7: Moon-fixed body-vector cache (A/D contract)

**Files:**
- Create: `src/sim/moonFixed.ts`, `src/sim/moonFixed.test.ts`
- Modify: `src/sim/cell.ts` (`cellEphemeris` uses this module; its behaviour does not change)
- Modify: `docs/data-contract.md` (new "Search data flow (A/D)" section)

**Interfaces:**
- Produces:

```ts
export interface MoonFixedSeries { key: string; startUtc: string; stepS: number; count: number; sun: Float64Array; earth: Float64Array } // 3·count, Moon-fixed metres
export function moonFixedKey(p: { dataHash: string; latDeg: number; lonDeg: number; eyeM: number; horizonResolutionDeg: number }): string
export function moonFixedSeries(year: EphemerisDoc, centre: Observer, key: string): MoonFixedSeries   // cached by key
export function projectWindow(mf: MoonFixedSeries, cell: Observer, i0: number, i1: number): EphemerisDoc // samples [i0, i1)
```

- The key uses `lat/lon` rounded to 1e-7°, `eyeM` rounded to 0.01 m, and `horizonResolutionDeg` as is.
- `map.json` percentages are not used in this flow. This is written explicitly in the doc.

- [ ] **Step 1: Write the failing tests**

```ts
it('projectWindow equals the matching slice of cellEphemeris to 1e-9°', …)   // Site01 r36c32, window 1000..2008
it('same key returns the same cached object, different eyeM gives a different key', …)
it('different dataHash never reuses the cache', …)
it('window past count throws CoverageError', …)
it('azimuth wraps 359.9° → 0.1° without a jump', …)
```

- [ ] **Step 2: Run, expect FAIL. Step 3: Implement.** Pull the math out of `cellEphemeris` into this module. `cellEphemeris` = `projectWindow(moonFixedSeries(...), cell, 0, count)`.
- [ ] **Step 4: `npm test` PASS.** Measure: one window of 1008 samples across 3721 cells takes N ms in Node. Record the number in the doc. This covers D's ~5 s budget.
- [ ] **Step 5: Commit** — `Cache Moon-fixed body vectors and project only the mission window`

---

### Task 8: Acceptance tests, wording and team notes

**Files:**
- Modify: `tests/extendedSites.test.ts` (last valid start, ±180°)
- Modify: `docs/data-methods.md`, `docs/submission.md` (if needed), `preprocess/README.md`
- Modify: `docs/ekip-notlari.md` (notes for B and D)

- [ ] **Step 1: Write the failing tests**

```ts
it('start + duration exactly at 2027-11-01T00:00:00Z is accepted', …)
it('600 s later throws CoverageError naming 2027-11-01', …)
it('snapToCell(-89.4632, 180.0001) and (…, -179.9999) agree', …)
it('missing cells.bin shows an error, not a zero horizon', …)
```

- [ ] **Step 2: Run. Fix any that fail** (fixes stay within the A/D files).
- [ ] **Step 3: Wording review.**
  - Run `grep -rn "Google" docs src` and confirm NASA and Google Moon are not mixed up.
  - Make sure the Earth image is called "archive composite (Blue Marble Next Generation, Nov 2004)".
  - Add a "Limits" sentence to `docs/data-methods.md`: "Good illumination does not mean flat or safe terrain for landing." Also add a note that the 1° cell horizon is a "regional screening estimate".
- [ ] **Step 4: `docs/ekip-notlari.md`:**
  - Under B: the `coverage.json` / `pointCoverage` message, `provenance`, and the new `CELL_LABEL`.
  - Under D: `moonFixed.ts`, the `refined.json` flow, and the strict parser.
  - Under C: the extended task is complete.
- [ ] **Step 5: Full check:** `npm test && npx tsc -b && python -m pytest preprocess/tests`
- [ ] **Step 6: Commit and open a PR** (reviewers: D). Description ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
