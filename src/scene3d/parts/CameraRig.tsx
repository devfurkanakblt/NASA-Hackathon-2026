import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useRef } from 'react'
import type { ComponentRef, RefObject } from 'react'
import { MOUSE, TOUCH, Vector3 } from 'three'
import type { PerspectiveCamera } from 'three'
import { azElToUnitVector, normalizeAzimuth } from '../coords.ts'
import { overviewHeightAboveTerrain, overviewStartPosition } from '../cameraPlacement.ts'
import { terrainHeightAt } from '../terrainGeometry.ts'
import type { TerrainMeshData } from '../terrainGeometry.ts'
import { mapScaleBar } from '../lunarImagery.ts'
import type { BodyState, CameraMode, LookTarget } from '../types.ts'

const OVERVIEW_FOV = 45
const LANDER_FOV = 55
const EARTH_TARGET_FOV = 18
const SUN_TARGET_FOV = 32
const LANDER_FOV_MIN = 6
const LANDER_FOV_MAX = 75
const PITCH_MIN = -89.9
const PITCH_MAX = 89.9

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export interface CameraRigProps {
  animateArrival?: boolean
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
  terrainMesh?: TerrainMeshData
  regionalMesh?: TerrainMeshData
  mapScale?: { line: RefObject<HTMLSpanElement | null>; label: RefObject<HTMLOutputElement | null> }
}

/**
 * Three view modes on one rig:
 *  - map: north-up, top-down, drag to pan and wheel/pinch to zoom;
 *  - overview: orbit around the lander above the terrain patch;
 *  - lander: stand at the observer point (2 m above ground) and look at the horizon.
 *    Drag to look around, wheel to zoom. While a look target is set the view follows it.
 */
export function CameraRig({ animateArrival = false, mode, halfExtentM, farPlaneM, eyeHeightM, lookTarget, sun, earth, onUserLook, terrainMesh, regionalMesh, mapScale }: CameraRigProps) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const gl = useThree((s) => s.gl)
  const invalidate = useThree((s) => s.invalidate)
  const arrival = useRef<{ target: Vector3; start: Vector3; elapsed: number } | null>(null)
  const look = useRef({ yawDeg: 0, pitchDeg: 2, fov: LANDER_FOV })
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null)
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
    // A north-up map needs north (-Z), rather than height (+Y), at the top of the image.
    camera.up.set(0, mode === 'map' ? 0 : 1, mode === 'map' ? -1 : 0)
    if (mode === 'map') {
      arrival.current = null
      camera.near = 5
      camera.fov = OVERVIEW_FOV
      camera.position.set(0, Math.max(halfExtentM * 3.2, (terrainMesh?.maxY ?? 0) + halfExtentM * 2.2), 0)
      camera.lookAt(0, 0, 0)
      controls.current?.target.set(0, 0, 0)
      camera.updateProjectionMatrix()
      controls.current?.update()
      invalidate()
    } else if (mode === 'overview') {
      camera.near = 5
      camera.fov = OVERVIEW_FOV
      // Low and behind the lander, looking towards the Sun, so the horizon and the sky are in frame.
      camera.position.set(...overviewStartPosition(halfExtentM, sunAzDeg.current, terrainMesh, regionalMesh))
      arrival.current = null
      if (animateArrival && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const target = camera.position.clone()
        const start = target.clone().multiplyScalar(2.2)
        camera.position.copy(start)
        arrival.current = { target, start, elapsed: 0 }
      }
      camera.lookAt(0, 0, 0)
      controls.current?.target.set(0, 0, 0)
      camera.updateProjectionMatrix()
      invalidate()
    } else {
      arrival.current = null
      camera.near = 1
      applyLook()
    }
  }, [mode, halfExtentM, farPlaneM, camera, invalidate, applyLook, terrainMesh, regionalMesh, animateArrival])

  // OrbitControls runs before this frame callback. Keep its camera above measured terrain,
  // including after a user orbit/zoom, without changing the scientific lander viewpoint.
  useFrame((state, delta) => {
    if (mode === 'map') {
      const p = camera.position, target = controls.current?.target
      if (!target) return
      const limit = (regionalMesh?.halfExtentM ?? halfExtentM) * 0.95
      const x = clamp(target.x, -limit, limit), z = clamp(target.z, -limit, limit)
      if (x !== target.x || z !== target.z) {
        p.x += x - target.x; p.z += z - target.z
        target.x = x; target.z = z
        invalidate()
      }
      const y = overviewHeightAboveTerrain(p.x, p.y, p.z, Math.max(50, halfExtentM * 0.02), terrainMesh, regionalMesh)
      if (y > p.y) { p.y = y; camera.lookAt(target); invalidate() }
      const groundY = (terrainMesh && terrainHeightAt(terrainMesh, target.x, target.z)) ??
        (regionalMesh && terrainHeightAt(regionalMesh, target.x, target.z)) ?? 0
      const metersPerPixel = 2 * Math.max(1, p.y - groundY) * Math.tan(camera.fov * Math.PI / 360) /
        (Math.max(1, state.size.height) * camera.zoom)
      const bar = mapScaleBar(metersPerPixel)
      if (bar && mapScale?.line.current && mapScale.label.current) {
        mapScale.line.current.style.width = `${bar.widthPx}px`
        mapScale.label.current.textContent = bar.label
      }
      return
    }
    if (mode !== 'overview') return
    if (arrival.current) {
      const motion = arrival.current
      motion.elapsed += Math.min(delta, .05)
      const t = Math.min(1, motion.elapsed / .65)
      camera.position.lerpVectors(motion.start, motion.target, 1 - Math.pow(1 - t, 3))
      camera.lookAt(0, 0, 0)
      if (t === 1) arrival.current = null
      invalidate()
    }
    const p = camera.position
    const y = overviewHeightAboveTerrain(p.x, p.y, p.z, Math.max(5, halfExtentM * 0.01), terrainMesh, regionalMesh)
    if (y > p.y) {
      p.y = y
      camera.lookAt(0, 0, 0)
      camera.updateMatrixWorld()
      invalidate()
    }
  })

  useEffect(() => {
    const cancelArrival = () => { arrival.current = null }
    gl.domElement.addEventListener('pointerdown', cancelArrival)
    gl.domElement.addEventListener('wheel', cancelArrival, { passive: true })
    return () => {
      gl.domElement.removeEventListener('pointerdown', cancelArrival)
      gl.domElement.removeEventListener('wheel', cancelArrival)
    }
  }, [gl])

  // Selecting a body starts with an inspection zoom. Target motion is deliberately
  // absent from these dependencies, so playback does not undo a manual wheel zoom.
  useEffect(() => {
    if (mode !== 'lander' || lookTarget === 'free') return
    look.current.fov = lookTarget === 'earth' ? EARTH_TARGET_FOV : SUN_TARGET_FOV
    applyLook()
  }, [mode, lookTarget, applyLook])

  // Follow the selected body in the lander view, keeping the current field of view.
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

  if (mode === 'lander') return null
  const map = mode === 'map'
  return (
    <OrbitControls
      key={mode}
      ref={controls}
      makeDefault
      enableRotate={!map}
      enablePan={map}
      screenSpacePanning={map}
      mouseButtons={map ? { LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN } : undefined}
      touches={map ? { ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_PAN } : undefined}
      minDistance={map ? 120 : 60}
      maxDistance={map ? Math.min(farPlaneM * 0.8, (regionalMesh?.halfExtentM ?? halfExtentM) * 3) : halfExtentM * 6}
      maxPolarAngle={map ? Math.PI : Math.PI / 2 - 0.02}
    />
  )
}
