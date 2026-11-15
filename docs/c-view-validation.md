# C whole-Moon view: integration checks, 15 November 2026

Integrated against `origin/main` at `072b74d`, including the team's duration editor,
six-colour palette, package/free-point calculation infrastructure and Research view.

## Automated checks

- `npm test`: **540 passed**, 50 files. Includes the existing real-data, package, search,
  research, energy and scientific validation checks.
- New display checks cover both hemispheres, periodic longitude, one value at each pole,
  signed metre heights, true radial scale, local ENU orientation, analytical spherical
  curvature at both poles, observer-ground alignment and missing-height rejection.
- Extended limit regressions cover 365-day missions, eight candidates, shared comparisons
  beyond Z, source-coverage rejection, four-label collision avoidance, and the team's retained 90-day performance test.
- `npm run build`: passes (TypeScript and production Vite bundle). Vite reports its
  existing large-chunk advisory; this is not a measured performance certification.
- `npm run lint`: exit 0, with existing React warnings in the hero, boundary,
  `PolarMoonCap` and MissionApp effect. No claim that the repository has no warnings.
- `python -m pytest preprocess/tests -q`: **254 passed, 22 skipped, 9 failed** in 51.47 s.
  The nine failures require absent `data_raw/map_Site*.npz` and the raw Site01 DEM under
  `data_raw/dem/`. Raw producer inputs were not downloaded or committed for this view
  change; those checks need A's complete raw cache. They were not changed to mask failures.

## Browser checks

- Selected a non-catalogue point by clicking the actual globe surface; its own computed
  Sun/Earth and battery results appeared. Four scenarios were evaluated together.
- Changed the shared mission duration to 90 days: all four results and time series updated.
- Verified the Research list displays alternative names, distance, UTC start, duration,
  criterion/reason and alternate start windows, with source/rule details collapsed.
- Tested the production build at a northern free point, 31 N / 15 E: own calculation,
  registered local 3D map, terrain overview, NASA imagery control, current Sun/Earth status
  and return to the globe. No production-page console errors were observed.
- Inspected the south-polar close-up: per-fragment projection removes the old polar UV
  streaks. The normal narrow browser view and a 1280 x 900 desktop view were inspected. Narrow screens retain a 460 px globe, with labels clear of the focus and comparison controls; hidden prewarmed scene labels do not bleed into the picker.

## Accuracy boundary

Display uses the existing SHA-256-checked 16 px/degree global LOLA tiles (~1.9 km/px),
not a new scientific data product. Refining triangles does not add source resolution.
Only the unsampled polar half-pixel is welded to a mean pole for a continuous display.
Local fallback grids retain curvature and are vertically aligned to the observer's ground;
fine-map heights may differ from this coarse display. Scientific inputs are unchanged.

Archive WAC / polar photographs retain their original composite illumination. Disable
NASA imagery to inspect selected-time directional shading. No live lunar photograph,
exact small-scale hazard map, equivalent geology certification or guaranteed radio link
is claimed. Follow-up work for A/B/D is in [team notes](ekip-notlari.md).
