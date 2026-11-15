# C: photographic Moon display

All nine catalogue points have a north-up 10 km local image and a 240 km regional image, each 2048 x 2048 pixels. The 18 JPEGs total 25,465,294 bytes. Each has a colocated JSON manifest with observer coordinates, footprint, source requests, lunar CRS, returned affine transform, raw and image SHA-256, coverage, resampling and limitations. The global locator uses a separate 4096 x 2048 WAC image (4,919,722 bytes) and manifest under `public/assets/`.

## Sources and registration

- [LROC controlled south-pole NAC average mosaic](https://data.lroc.im-ldi.com/lroc/view_rdr/NAC_POLE_SOUTH_CM_AVG): archival 2009–2013 observations, native 1 m product; photographic composite, not a single lighting condition. Coverage reaches 84 degrees south; the control network reaches 85 degrees south.
- LROC WAC global mosaic, native 100 m, supplies the non-polar points and genuine gaps in NAC coverage. Exact layer details are recorded from the [official LROC WMS capabilities](https://wms.im-ldi.com/?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetCapabilities).
- Credits: NASA/GSFC/Arizona State University/LROC. No Google imagery or generative surface is used.

Both polar scales use the same controlled NAC average composite, avoiding a product switch at the 10 km patch boundary. Regional NAC coverage is 100% at Site01/04/04R, 99.17% at Site07, 98.76% at Site11, 62.10% at Site20 and 69.29% at Site23. Remaining pixels use genuine WAC observations. All 18 delivered images have complete photographic coverage; no missing surface is synthesized.

Target pixel centres use the same spherical surface-distance frame as `preprocess.terrain`, then transform through lunar longitude/latitude into the returned source CRS and bilinearly sample real source pixel centres. Polar crops use `IAU2000:30120` stereographic coordinates on the 1,737,400 m sphere; contrast sites use lunar geographic coordinates. Pole and longitude-wrap coverage are checked. North is image row zero; Three texture UVs preserve east and north.

Local output spacing is 4.8828125 m/pixel; regional output spacing is 117.1875 m/pixel. Requested source crops can be coarser than the native product. WAC resampling does not create 5 m detail. Native spacing, delivered spacing, mixed-source coverage and output spacing are separate metadata. None is an absolute geolocation accuracy claim. The terrain display geometry retains its original coarser resolution.

## Illumination and limits

These mosaics contain archival composite lighting. They are **not albedo or selected-UTC shadow maps**. The photograph material is unlit, with a persistent warning. Turning NASA imagery off restores the modelled Sun-direction/optional inspection shading. Photographs never determine visibility, power or battery state. Incomplete photographic coverage is rejected by the display loader rather than rendered as an opaque black surface.

The global locator uses a true equirectangular WAC photograph, with no procedural bump map. It is an archival location reference, not selected-UTC illumination. Its fallback is explicitly untextured. All images are bundled locally; the browser makes no NASA API requests.

## Reproduction and verification

```sh
python -m preprocess.lunar_imagery --cache-dir data_raw/lunar-imagery
python -m preprocess.global_moon_imagery --cache-dir data_raw/global-moon
python -m pytest preprocess/tests/test_lunar_imagery.py preprocess/tests/test_global_moon_imagery.py -q
npm test
npm run build
```

Raw GeoTIFF requests are cached outside the repository. The generators validate lunar CRS, bounds, pixel centres and coverage before writing manifests. Analytical tests cover coordinate orientation, polar extents, source alpha, fallback and cache hashes. An independent source-pixel comparison at Site01 used 10,000 points: JPEG grayscale mean absolute difference 1.183, versus 43.88/56.03 when north/east were reversed. This verifies internal registration and encoding, not externally measured absolute accuracy. Final integrity checks validated all 18 image hashes, dimensions, catalogue-coordinate registration and full coverage.
