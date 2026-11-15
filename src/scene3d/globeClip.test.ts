import { expect, it } from 'vitest'
import { globeNearPlane } from './globeClip.ts'

it('preserves 24-bit depth separation of the 0.0001-radius photograph shells at globe zooms', () => {
  for (const distance of [1.001, 1.008, 1.18, 2.8, 4]) {
    // The limb is the farthest visible sphere point; the back face is occluded.
    const near = globeNearPlane(distance), far = 30, z = Math.sqrt(distance * distance - 1)
    const depthStep = (far - near) * z * z / (far * near * (2 ** 24 - 1))
    expect(near).toBeLessThan(distance - 1)
    expect(depthStep).toBeLessThan(.0001)
  }
  // The previous constant near plane cannot resolve the photograph shell at the initial zoom.
  expect((30 - .0001) * 3.8 ** 2 / (30 * .0001 * (2 ** 24 - 1))).toBeGreaterThan(.0001)
})
