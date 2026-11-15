import { Quaternion, SphereGeometry, Vector3 } from 'three'

export interface GlobalTerrain {
  width: number; height: number; scaleM: number; referenceRadiusM: number; values?: Int16Array; heightAt?: (lat: number, lon: number) => number
  northPoleM: number; southPoleM: number
}

/** Display sampling: only the unsampled polar half-pixel is welded to one mean pole. */
export function globalHeightM(data: GlobalTerrain, latDeg: number, lonDeg: number): number {
  const lat = Math.max(-90, Math.min(90, latDeg)), lon = ((lonDeg % 360) + 360) % 360
  const halfPixel = 90 / data.height
  const poleBlend = Math.max(0, Math.min(1, (Math.abs(lat) - (90 - halfPixel)) / halfPixel))
  if (data.heightAt) {
    const z = data.heightAt(lat, lon), t = poleBlend
    return z * (1 - t) + (lat >= 0 ? data.northPoleM : data.southPoleM) * t
  }
  if (!data.values) throw new Error('Global display terrain is missing')
  const values = data.values
  const x = lon / 360 * data.width - .5, y = Math.max(0, Math.min(data.height - 1, (90 - lat) / 180 * data.height - .5))
  const x0 = Math.floor(x), y0 = Math.floor(y), u = x - x0, v = y - y0
  const at = (row: number, col: number) => values[Math.min(data.height - 1, row) * data.width + ((col % data.width) + data.width) % data.width] * data.scaleM
  const z = (1 - v) * ((1 - u) * at(y0, x0) + u * at(y0, x0 + 1)) + v * ((1 - u) * at(y0 + 1, x0) + u * at(y0 + 1, x0 + 1))
  return z * (1 - poleBlend) + (lat >= 0 ? data.northPoleM : data.southPoleM) * poleBlend
}

export function terrainRadius(data: GlobalTerrain | null, direction: Vector3, clearanceM = 0): number {
  if (!data) return 1 + clearanceM / 1737400
  const p = direction.clone().normalize()
  return 1 + (globalHeightM(data, Math.asin(p.y) * 180 / Math.PI, Math.atan2(-p.z, p.x) * 180 / Math.PI) + clearanceM) / data.referenceRadiusM
}

/** Actual measured radius; tessellation never changes source resolution or exaggerates height. */
export function globalGeometry(data: GlobalTerrain, direction?: Vector3, angle = .15) {
  const geometry = direction ? new SphereGeometry(1, 256, 96, 0, Math.PI * 2, 0, angle) : new SphereGeometry(1, 512, 256)
  if (direction) geometry.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction))
  const p = geometry.getAttribute('position'), point = new Vector3()
  for (let i = 0; i < p.count; i++) {
    point.fromBufferAttribute(p, i).normalize().multiplyScalar(terrainRadius(data, point))
    p.setXYZ(i, point.x, point.y, point.z)
  }
  geometry.computeVertexNormals(); geometry.computeBoundingSphere()
  return geometry
}
