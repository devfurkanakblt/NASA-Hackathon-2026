import { DataTexture, RGBAFormat, ShaderMaterial, Vector2, Vector3, Vector4 } from 'three'
import type { IUniform, Texture } from 'three'
import context from '../../../public/assets/moon-south-context.json'
import polar from '../../../public/assets/moon-south-polar.json'
import { SUN_DIRECTION } from './descentPath.ts'

/**
 * Materials for the descent. The Moon sphere and the measured polar terrain share one lighting
 * model and one set of uniforms, so where they meet there is no seam in tone or colour.
 *
 * Two looks, blended by uReal:
 *  - photo look (far and top-down): the LROC photographs as they were lit, with a gentle
 *    lunar-Lambert sun on top. Sampled per pixel in their native projections (equirectangular
 *    global mosaic; south polar stereographic context and NAC mosaics), so the pole never
 *    stretches. Near the pole the camera adapts its exposure to the photograph (uAdapt).
 *  - real look (low, forward view): the fixed scene Sun on the measured terrain, with the
 *    baked LOLA slope light and solar-disc shadows, warm direct light and a faint cool fill.
 *    This is the light of the RIMLIGHT hero: grazing gold on the rims, charcoal elsewhere.
 */

const SURFACE_GLSL = /* glsl */ `
uniform sampler2D uPolar;
uniform vec2 uPolarHalf;
uniform vec3 uSun;
uniform float uExposure;
uniform float uAdapt;
uniform float uReal;
uniform float uSunGain;

const float PI = 3.141592653589793;
const float R = 1737400.0;
const vec3 TINT = vec3(1.0, 0.962, 0.915);
const vec3 SUN_COLOR = vec3(1.0, 0.79, 0.54);
const vec3 SKY_COLOR = vec3(0.56, 0.62, 0.74);

// South polar stereographic (R = 1737.4 km): x towards 90° E, y towards 0°.
vec2 polarMap(vec3 n) {
  float k = 2.0 * R / max(1.0 - n.y, 1e-4);
  return vec2(-n.z * k, n.x * k);
}

// Photo look: up = the smooth-sphere normal, so sphere and terrain agree exactly.
vec3 photoLook(vec3 albedo, vec3 up, vec3 v, float lat) {
  float mu0 = dot(up, uSun);
  float mu = max(dot(up, v), 0.0);
  float ls = 2.0 * max(mu0, 0.0) / (max(mu0, 0.0) + mu + 1e-3);
  float sun = mix(max(mu0, 0.0), ls, 0.62) * smoothstep(-0.012, 0.035, mu0);
  // Near the pole the sun is always on the horizon; the NAC mosaic averages many sun angles,
  // so an adapted camera sees the ground as the photograph shows it.
  float photoLit = uAdapt * smoothstep(-70.0, -80.0, lat);
  float light = mix(sun * uExposure, 0.72 + 0.16 * smoothstep(-0.02, 0.06, mu0), photoLit);
  return albedo * TINT * (light + 0.010);
}

// Real look: charcoal regolith, photo brightness only as gentle albedo variation.
vec3 realLook(vec3 photo, float direct, float sky) {
  float a = 0.2 * mix(1.0, clamp(photo.g / 0.13, 0.0, 2.5), 0.3);
  vec3 albedo = a * vec3(1.0, 0.95, 0.88);
  // Fill: light scattered from nearby sunlit slopes plus the camera exposing for the shadows,
  // so shadowed ground keeps charcoal detail as in the hero photograph.
  return albedo * (SUN_COLOR * direct * uSunGain + SKY_COLOR * (0.24 * sky * sky + 0.035));
}
`

const moonVertex = /* glsl */ `
varying vec3 vObj;
void main() {
  vObj = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const moonFragment = /* glsl */ `
${SURFACE_GLSL}
uniform sampler2D uGlobal;
uniform sampler2D uContext;
uniform float uContextOn;
uniform float uPolarOn;
uniform vec2 uContextHalf;
// Map radius (m) inside which the measured terrain replaces the sphere; 0 = no terrain yet.
uniform float uHole;
varying vec3 vObj;

vec3 sampleGlobal(vec3 n) {
  vec2 uv = vec2(atan(-n.z, n.x) / (2.0 * PI) + 0.5, asin(clamp(n.y, -1.0, 1.0)) / PI + 0.5);
  // Explicit gradients: the longitude wrap would otherwise pick the smallest mip along the seam.
  vec2 dx = dFdx(uv), dy = dFdy(uv);
  dx.x -= floor(dx.x + 0.5);
  dy.x -= floor(dy.x + 0.5);
  return textureGrad(uGlobal, uv, dx, dy).rgb;
}

void main() {
  vec3 n = normalize(vObj);
  vec2 m = polarMap(n);
  if (uHole > 0.0 && n.y < 0.0 && length(m) < uHole) discard;
  float lat = degrees(asin(clamp(n.y, -1.0, 1.0)));

  vec3 albedo = sampleGlobal(n);
  vec3 ctx = texture2D(uContext, m / (2.0 * uContextHalf) + 0.5).rgb;
  vec3 pol = texture2D(uPolar, m / (2.0 * uPolarHalf) + 0.5).rgb;
  albedo = mix(albedo, ctx, uContextOn * smoothstep(-60.0, -62.5, lat));
  albedo = mix(albedo, pol, uPolarOn * smoothstep(-84.3, -85.4, lat));

  vec3 v = normalize(cameraPosition - vObj);
  vec3 color = photoLook(albedo, n, v, lat);
  if (uReal > 0.0) {
    float mu0 = dot(n, uSun);
    color = mix(color, realLook(albedo, max(mu0, 0.0) * smoothstep(-0.01, 0.02, mu0), 1.0), uReal);
  }
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

const terrainVertex = /* glsl */ `
attribute vec2 mapXY;
varying vec2 vMap;
varying vec3 vWorld;
void main() {
  vMap = mapXY;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

const terrainFragment = /* glsl */ `
${SURFACE_GLSL}
uniform sampler2D uLight;
// Light-map box: left, bottom, side (m).
uniform vec3 uLightBox;
// Clip: drop fragments beyond this map radius, and inside this box (the finer mesh's area).
uniform float uOuter;
uniform vec4 uInner;
varying vec2 vMap;
varying vec3 vWorld;

void main() {
  if (length(vMap) > uOuter) discard;
  if (vMap.x > uInner.x && vMap.x < uInner.z && vMap.y > uInner.y && vMap.y < uInner.w) discard;
  vec3 up = normalize(vWorld);
  float lat = degrees(asin(clamp(up.y, -1.0, 1.0)));
  vec3 photo = texture2D(uPolar, vMap / (2.0 * uPolarHalf) + 0.5).rgb;
  vec3 v = normalize(cameraPosition - vWorld);
  vec3 color = photoLook(photo, up, v, lat);
  if (uReal > 0.0) {
    vec2 lm = texture2D(uLight, (vMap - uLightBox.xy) / uLightBox.z).rg;
    color = mix(color, realLook(photo, lm.r * lm.r * 0.5, lm.g), uReal);
  }
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

const half = (bounds: number[]) => new Vector2((bounds[2] - bounds[0]) / 2, (bounds[3] - bounds[1]) / 2)

function placeholder() {
  const t = new DataTexture(new Uint8Array([60, 60, 58, 255]), 1, 1, RGBAFormat)
  t.needsUpdate = true
  return t
}

export type SurfaceUniforms = {
  uPolar: IUniform<Texture>
  uPolarHalf: IUniform<Vector2>
  uSun: IUniform<Vector3>
  uExposure: IUniform<number>
  uAdapt: IUniform<number>
  uReal: IUniform<number>
  uSunGain: IUniform<number>
}

export function createMoonMaterial() {
  const blank = placeholder()
  const shared: SurfaceUniforms = {
    uPolar: { value: blank },
    uPolarHalf: { value: half(polar.bounds) },
    uSun: { value: new Vector3().copy(SUN_DIRECTION) },
    uExposure: { value: 1.9 },
    uAdapt: { value: 0 },
    uReal: { value: 0 },
    uSunGain: { value: 9.5 },
  }
  const material = new ShaderMaterial({
    vertexShader: moonVertex,
    fragmentShader: moonFragment,
    uniforms: {
      ...shared,
      uGlobal: { value: blank as Texture },
      uContext: { value: blank as Texture },
      uContextOn: { value: 0 },
      uPolarOn: { value: 0 },
      uContextHalf: { value: half(context.bounds) },
      uHole: { value: 0 },
    },
  })
  return { material, shared }
}

/** Terrain patch material; uniform objects are shared with the sphere, so they stay in step. */
export function createTerrainMaterial(shared: SurfaceUniforms, light: Texture, bounds: number[], clip: { outer?: number; inner?: number[] } = {}) {
  const inner = clip.inner ?? [0, 0, 0, 0]
  return new ShaderMaterial({
    vertexShader: terrainVertex,
    fragmentShader: terrainFragment,
    uniforms: {
      ...shared,
      uLight: { value: light },
      uLightBox: { value: new Vector3(bounds[0], bounds[1], bounds[2] - bounds[0]) },
      uOuter: { value: clip.outer ?? 1e9 },
      uInner: { value: new Vector4(inner[0], inner[1], inner[2], inner[3]) },
    },
  })
}
