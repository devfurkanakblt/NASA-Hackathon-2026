import { useThree } from '@react-three/fiber'
import { useEffect, useMemo, useState } from 'react'
import { ShaderMaterial, SRGBColorSpace, TextureLoader, Vector3 } from 'three'
import type { Texture } from 'three'
import { descentPose, SUN_DIRECTION } from './descentPath.ts'

/** Earth's angular diameter seen from the Moon (~1.9°). */
const ANGULAR_DIAMETER_DEG = 1.9
const DISTANCE = 150
/** Placement in the final frame: right of centre and just above the skyline, as on the hero. */
const AZIMUTH_DEG = 21
const ELEVATION_DEG = 5.5

/**
 * Where Earth sits: fixed in the Moon frame, chosen from the final camera pose so it appears on
 * the right of the closing shot. (Seen from the pole Earth really does hang on the horizon; its
 * exact azimuth here is a composition choice, as on the hero image.)
 */
export function earthPlacement() {
  const pose = descentPose(1, 32, 16 / 9)
  const right = pose.forward.clone().cross(pose.up).normalize()
  const az = AZIMUTH_DEG * Math.PI / 180, el = ELEVATION_DEG * Math.PI / 180
  const direction = pose.forward.clone().multiplyScalar(Math.cos(az) * Math.cos(el))
    .addScaledVector(right, Math.sin(az) * Math.cos(el))
    .addScaledVector(pose.up, Math.sin(el))
    .normalize()
  return { position: pose.position.clone().addScaledVector(direction, DISTANCE), cameraEnd: pose.position.clone() }
}

const vertexShader = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vNormal = normalize(mat3(modelMatrix) * normal);
  vView = normalize(cameraPosition - world.xyz);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

const fragmentShader = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uLight;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vec3 n = normalize(vNormal);
  float day = smoothstep(-0.08, 0.25, dot(n, uLight));
  vec3 color = texture2D(uMap, vUv).rgb * (0.03 + 0.62 * day);
  // Thin atmosphere: blue limb on the day side.
  float rim = pow(1.0 - max(dot(n, normalize(vView)), 0.0), 3.0);
  color += vec3(0.32, 0.55, 1.0) * rim * (0.15 + 0.85 * day) * 0.35;
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

export function Earth() {
  const { invalidate } = useThree()
  const [map, setMap] = useState<Texture | null>(null)
  const { position, light } = useMemo(() => {
    const { position, cameraEnd } = earthPlacement()
    // Lit from the Sun's side (the right, towards the sunrise glow); the phase is opened up to a
    // gibbous Earth so it reads at this size, as on the hero image.
    const toCamera = cameraEnd.clone().sub(position).normalize()
    return { position, light: SUN_DIRECTION.clone().multiplyScalar(0.55).add(toCamera).normalize() }
  }, [])
  const material = useMemo(() => new ShaderMaterial({
    vertexShader, fragmentShader,
    uniforms: { uMap: { value: null }, uLight: { value: new Vector3() } },
  }), [])
  useEffect(() => { material.uniforms.uLight.value.copy(light) }, [light, material])
  useEffect(() => () => material.dispose(), [material])

  useEffect(() => {
    let cancelled = false
    new TextureLoader().loadAsync(`${import.meta.env.BASE_URL}assets/hero/earth.webp`).then((texture) => {
      if (cancelled) return texture.dispose()
      texture.colorSpace = SRGBColorSpace
      material.uniforms.uMap.value = texture
      setMap(texture)
      invalidate()
    }).catch(() => { /* No Earth texture: the scene simply has no Earth. */ })
    return () => { cancelled = true }
  }, [invalidate, material])
  useEffect(() => () => map?.dispose(), [map])

  const radius = DISTANCE * Math.tan(ANGULAR_DIAMETER_DEG / 2 * Math.PI / 180)
  if (!map) return null
  return (
    // Tilted so Africa and Europe face the Moon, north roughly up.
    <mesh position={position} material={material} rotation={[0.35, -1.2, 0.2]} renderOrder={1}>
      <sphereGeometry args={[radius, 48, 32]} />
    </mesh>
  )
}
