/**
 * Past landings outside the south-polar catalogue, offered as one-click coordinates. The catalogue
 * is deliberately south-polar (the challenge's focus); these points run on the global LOLA terrain
 * like any typed coordinate, as a screening estimate for comparison, not as catalogue sites.
 * Coordinates: published landing positions (LROC / mission reports), rounded to 0.001°.
 */
export interface ReferenceLanding {
  name: string
  latDeg: number
  /** East positive. */
  lonDeg: number
}

export const REFERENCE_LANDINGS: ReferenceLanding[] = [
  { name: 'Apollo 11', latDeg: 0.674, lonDeg: 23.473 },
  { name: 'Apollo 15', latDeg: 26.132, lonDeg: 3.634 },
  { name: 'Apollo 17', latDeg: 20.191, lonDeg: 30.772 },
  { name: "Chang'e 3", latDeg: 44.121, lonDeg: -19.512 },
  { name: "Chang'e 5", latDeg: 43.058, lonDeg: -51.916 },
  { name: 'Blue Ghost M1', latDeg: 18.562, lonDeg: 61.810 },
]
