/** Register a north-up, observer-centred ENU archive image independently of normal-map UVs. */
export function lunarImageryTransform(meshSizeM: number, imageSizeM: number) {
  if (!(Number.isFinite(meshSizeM) && meshSizeM > 0 && Number.isFinite(imageSizeM) && imageSizeM > 0)) {
    throw new Error('Imagery and mesh footprints must be finite positive metres')
  }
  const repeat = meshSizeM / imageSizeM
  return { repeat, offset: (1 - repeat) / 2 }
}

/** Scale bar in CSS pixels at the centre of a vertical perspective map. */
export function mapScaleBar(metersPerPixel: number, targetWidthPx = 96) {
  if (!(Number.isFinite(metersPerPixel) && metersPerPixel > 0)) return undefined
  const desired = metersPerPixel * targetWidthPx
  const magnitude = 10 ** Math.floor(Math.log10(desired))
  const normalized = desired / magnitude
  const metres = (normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1) * magnitude
  return { metres, widthPx: metres / metersPerPixel,
    label: metres >= 1000 ? `${Number((metres / 1000).toPrecision(3))} km` : `${Number(metres.toPrecision(3))} m` }
}
