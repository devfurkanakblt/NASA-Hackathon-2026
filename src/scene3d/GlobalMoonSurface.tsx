import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { SphereGeometry, TextureLoader, SRGBColorSpace, Vector3, Vector4 } from 'three'
import type { Mesh, MeshBasicMaterial, Texture } from 'three'
import { globalGeometry } from './globalTerrain.ts'
import type { GlobalTerrain } from './globalTerrain.ts'
import { useMoonSurfaceTexture } from './moonSurfaceTexture.ts'
import context from '../../public/assets/moon-south-context.json'
import polar from '../../public/assets/moon-south-polar.json'

const photos = new Map<string, Promise<Texture>>()
function usePhoto(file: string) {
  const [texture, setTexture] = useState<Texture | null>(null)
  const invalidate = useThree(s => s.invalidate)
  useEffect(() => {
    let cancelled = false
    let promise = photos.get(file)
    if (!promise) {
      promise = new TextureLoader().loadAsync(`${import.meta.env.BASE_URL}assets/${file}`).then(t => { t.colorSpace = SRGBColorSpace; t.anisotropy = 8; return t })
      photos.set(file, promise)
    }
    void promise.then(t => { if (!cancelled) { setTexture(t); invalidate() } }).catch(() => { photos.delete(file) })
    return () => { cancelled = true }
  }, [file, invalidate])
  return texture
}

interface Patch { direction: Vector3; angle: number }
export interface GlobalPhotoFrame { latDeg: number; lonDeg: number; surfaceElevationM: number }
export function Photograph({ clip, patch, frame }: { clip: boolean; patch: Patch | null; frame?: GlobalPhotoFrame }) {
  const { texture } = useMoonSurfaceTexture()
  const contextMap = usePhoto(context.file), polarMap = usePhoto(polar.file)
  const invalidate = useThree(s => s.invalidate)
  const uniforms = useMemo(() => ({
    uContext: { value: null as Texture | null }, uPolar: { value: null as Texture | null },
    uHasContext: { value: 0 }, uHasPolar: { value: 0 },
    uContextBounds: { value: new Vector4(...context.bounds as [number, number, number, number]) },
    uPolarBounds: { value: new Vector4(...polar.bounds as [number, number, number, number]) },
    uPatchDirection: { value: new Vector3(0, 1, 0) }, uPatchCos: { value: 2 },
    uOrigin: { value: new Vector3() }, uEast: { value: new Vector3() },
    uNorth: { value: new Vector3() }, uUp: { value: new Vector3() },
  }), [])
  useEffect(() => {
    uniforms.uContext.value = contextMap; uniforms.uPolar.value = polarMap
    uniforms.uHasContext.value = contextMap ? 1 : 0; uniforms.uHasPolar.value = polarMap ? 1 : 0
    uniforms.uPatchCos.value = clip && patch ? Math.cos(patch.angle * .97) : 2
    if (patch) uniforms.uPatchDirection.value.copy(patch.direction)
    if (frame) {
      const lat = frame.latDeg * Math.PI / 180, lon = frame.lonDeg * Math.PI / 180
      uniforms.uUp.value.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon))
      uniforms.uOrigin.value.copy(uniforms.uUp.value).multiplyScalar(1737400 + frame.surfaceElevationM)
      uniforms.uEast.value.set(-Math.sin(lon), 0, -Math.cos(lon))
      uniforms.uNorth.value.set(-Math.sin(lat) * Math.cos(lon), Math.cos(lat), Math.sin(lat) * Math.sin(lon))
    }
    invalidate()
  }, [uniforms, contextMap, polarMap, clip, patch, frame, invalidate])
  const compile = useCallback<NonNullable<MeshBasicMaterial['onBeforeCompile']>>(shader => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = 'varying vec3 vMoonDirection;\nuniform vec3 uOrigin, uEast, uNorth, uUp;\n' + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\nvMoonDirection = ${frame ? 'uOrigin + position.x * uEast + position.y * uUp - position.z * uNorth' : 'normalize(position)'};`)
    shader.fragmentShader = `varying vec3 vMoonDirection;
      uniform sampler2D uContext; uniform sampler2D uPolar;
      uniform float uHasContext; uniform float uHasPolar;
      uniform vec4 uContextBounds; uniform vec4 uPolarBounds;
      uniform vec3 uPatchDirection; uniform float uPatchCos;
    ` + shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (dot(normalize(vMoonDirection), uPatchDirection) > uPatchCos) discard;')
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      #ifdef USE_MAP
        vec3 d = normalize(vMoonDirection);
        float latitude = asin(clamp(d.y, -1.0, 1.0));
        vec2 uv = vec2(atan(-d.z, d.x) / 6.28318530718 + 0.5, latitude / 3.14159265359 + 0.5);
        vec4 photo = texture2D(map, uv);
        if (d.y < -0.866 && uHasContext > 0.5) {
          vec2 xy = vec2(-d.z, d.x) * (3474800.0 / (1.0 - d.y));
          vec2 puv = (xy - uContextBounds.xy) / (uContextBounds.zw - uContextBounds.xy);
          photo = mix(photo, texture2D(uContext, puv), smoothstep(60.0, 62.0, -degrees(latitude)));
          if (uHasPolar > 0.5) {
            vec2 nuv = (xy - uPolarBounds.xy) / (uPolarBounds.zw - uPolarBounds.xy);
            photo = mix(photo, texture2D(uPolar, nuv), smoothstep(84.3, 85.0, -degrees(latitude)));
          }
        }
        diffuseColor *= photo;
      #endif
    `)
  }, [uniforms, frame])
  return <meshBasicMaterial key={`${Boolean(texture)}:${Boolean(frame)}`} map={texture} color={texture ? '#ffffff' : '#777777'} toneMapped={false} polygonOffset={!clip && !frame} polygonOffsetFactor={-1} polygonOffsetUnits={-2} onBeforeCompile={compile} customProgramCacheKey={() => `global-lola-photograph-v1:${Boolean(frame)}`} />
}

/** Continuous whole-Moon measured terrain, plus a camera-following refined display mesh. */
export function GlobalMoonSurface({ terrain, meshRef, refine = true }: {
  terrain: GlobalTerrain | null; meshRef: RefObject<Mesh | null>
  /** Off while the camera flies: rebuilding the refined patch every few frames stalls the flight. */
  refine?: boolean
}) {
  const global = useMemo(() => terrain ? globalGeometry(terrain) : new SphereGeometry(1, 256, 128), [terrain])
  const [patch, setPatch] = useState<Patch | null>(null)
  const last = useRef<Patch | null>(null)
  const patchGeometry = useMemo(() => terrain && patch ? globalGeometry(terrain, patch.direction, patch.angle) : null, [terrain, patch])
  useEffect(() => () => global.dispose(), [global])
  useEffect(() => () => patchGeometry?.dispose(), [patchGeometry])
  useEffect(() => { if (!refine) { last.current = null; setPatch(null) } }, [refine])
  useFrame(({ camera }) => {
    if (!terrain || !refine) return
    const altitude = camera.position.length() - 1
    if (altitude > .35) { if (last.current) { last.current = null; setPatch(null) }; return }
    const direction = camera.position.clone().normalize(), angle = Math.max(.015, Math.min(.5, altitude * 3))
    if (!last.current || direction.angleTo(last.current.direction) > angle * .2 || Math.abs(angle - last.current.angle) > angle * .25) {
      const value = { direction, angle }; last.current = value; setPatch(value)
    }
  })
  return <>
    <mesh ref={meshRef} geometry={global}><Photograph clip patch={patchGeometry ? patch : null} /></mesh>
    {patchGeometry && <mesh geometry={patchGeometry}><Photograph clip={false} patch={null} /></mesh>}
  </>
}
