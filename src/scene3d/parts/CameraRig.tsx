import { OrbitControls } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useCallback, useEffect, useRef } from 'react'
import type { PerspectiveCamera } from 'three'
import { DEG2RAD, azElToUnitVector, normalizeAzimuth } from '../coords.ts'
import type { BodyState, CameraMode, LookTarget } from '../types.ts'

const OVERVIEW_FOV = 45
/** Overview start position, in units of half the terrain patch: ~12° above the horizontal. */
const OVERVIEW_DISTANCE = 2.3
const OVERVIEW_HEIGHT = 0.5
const OVERVIEW_SIDE_OFFSET_DEG = 12
const LANDER_FOV = 55
const LANDER_FOV_MIN = 6
const LANDER_FOV_MAX = 75
const PITCH_MIN = -60
const PITCH_MAX = 80

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export interface CameraRigProps {
  mode: CameraMode
  /** Half the terrain patch width (m) — sets camera distances. */
  halfExtentM: number
  /** Far clip plane (m): beyond the sky sphere. */
  farPlaneM: number
  eyeHeightM: number
  lookTarget: LookTarget
  sun: BodyState
  earth: BodyState
  /** Called when the user drags the lander view, so the UI can drop "Look at Sun/Earth". */
  onUserLook: () => void
}

/**
 * Two cameras on one rig:
 *  - overview: orbit around the lander above the terrain patch;
 *  - lander: stand at the observer point (2 m above ground) and look at the horizon.
 *    Drag to look around, wheel to zoom. While a look target is set the view follows it.
 */
export function CameraRig({ mode, halfExtentM, farPlaneM, eyeHeightM, lookTarget, sun, earth, onUserLook }: CameraRigProps) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const gl = useThree((s) => s.gl)
  const invalidate = useThree((s) => s.invalidate)
  const look = useRef({ yawDeg: 0, pitchDeg: 2, fov: LANDER_FOV })
  // Azimuth of the Sun when the overview is (re)entered: the camera starts out facing it.
  const sunAzDeg = useRef(sun.azDeg)
  sunAzDeg.current = sun.azDeg

  const applyLook = useCallback(() => {
    const { yawDeg, pitchDeg, fov } = look.current
    const [x, y, z] = azElToUnitVector(yawDeg, pitchDeg)
    camera.position.set(0, eyeHeightM, 0)
    camera.lookAt(x, eyeHeightM + y, z)
    camera.fov = fov
    camera.updateProjectionMatrix()
    invalidate()
  }, [camera, eyeHeightM, invalidate])

  // Camera placement and clip planes for the active mode.
  useEffect(() => {
    camera.far = farPlaneM
    if (mode === 'overview') {
      camera.near = 5
      camera.fov = OVERVIEW_FOV
      // Low and behind the lander, looking towards the Sun, so the horizon and the sky are in frame.
      const behind = (sunAzDeg.current + 180 + OVERVIEW_SIDE_OFFSET_DEG) * DEG2RAD
      const distance = halfExtentM * OVERVIEW_DISTANCE
      camera.position.set(Math.sin(behind) * distance, halfExtentM * OVERVIEW_HEIGHT, -Math.cos(behind) * distance)
      camera.lookAt(0, 0, 0)
      camera.updateProjectionMatrix()
      invalidate()
    } else {
      camera.near = 1
      applyLook()
    }
  }, [mode, halfExtentM, farPlaneM, camera, invalidate, applyLook])

  // Follow the selected body in the lander view.
  const target = lookTarget === 'sun' ? sun : lookTarget === 'earth' ? earth : null
  const targetAz = target?.azDeg
  const targetEl = target?.elDeg
  useEffect(() => {
    if (mode !== 'lander' || targetAz === undefined || targetEl === undefined) return
    look.current.yawDeg = normalizeAzimuth(targetAz)
    look.current.pitchDeg = clamp(targetEl, PITCH_MIN, PITCH_MAX)
    applyLook()
  }, [mode, targetAz, targetEl, applyLook])

  // Drag to look around, wheel to zoom (lander view only).
  useEffect(() => {
    if (mode !== 'lander') return
    const el = gl.domElement
    let dragging = false
    let lastX = 0
    let lastY = 0

    const onDown = (e: PointerEvent) => {
      dragging = true
      lastX = e.clientX
      lastY = e.clientY
      el.setPointerCapture(e.pointerId)
    }
    const onMove = (e: PointerEvent) => {
      if (!dragging) return
      const degPerPx = look.current.fov / Math.max(1, el.clientHeight)
      look.current.yawDeg = normalizeAzimuth(look.current.yawDeg - (e.clientX - lastX) * degPerPx)
      look.current.pitchDeg = clamp(look.current.pitchDeg + (e.clientY - lastY) * degPerPx, PITCH_MIN, PITCH_MAX)
      lastX = e.clientX
      lastY = e.clientY
      onUserLook()
      applyLook()
    }
    const onUp = (e: PointerEvent) => {
      dragging = false
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      // Proportional to the wheel delta, so mouse notches and trackpad swipes both feel right.
      const factor = Math.exp(clamp(e.deltaY, -300, 300) * 0.0015)
      look.current.fov = clamp(look.current.fov * factor, LANDER_FOV_MIN, LANDER_FOV_MAX)
      applyLook()
    }

    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      el.removeEventListener('wheel', onWheel)
    }
  }, [mode, gl, applyLook, onUserLook])

  if (mode !== 'overview') return null
  return (
    <OrbitControls
      makeDefault
      target={[0, 0, 0]}
      enablePan={false}
      minDistance={60}
      maxDistance={halfExtentM * 6}
      maxPolarAngle={Math.PI / 2 - 0.02}
    />
  )
}
