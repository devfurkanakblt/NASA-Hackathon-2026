/**
 * Panel and battery model from the plan (§3 "Enerji modeli"):
 *
 *   power = solar flux × panel area × efficiency × system factor × incidence × visibility
 *
 * with the flux scaled from 1361 W/m² at 1 au by the Sun's distance. Partial Sun discs,
 * eclipses and temperature effects are not modelled. Power in W, energy in J.
 */

export const SOLAR_CONSTANT_W_M2 = 1361
export const AU_M = 1.495978707e11
export const J_PER_WH = 3600

const DEG2RAD = Math.PI / 180

export type PanelMode = 'tracking' | 'fixed'

export interface PanelSettings {
  panelAreaM2: number
  /** Cell efficiency, 0–1. */
  panelEfficiency: number
  /** Everything between the cells and the bus (wiring, conversion, dust), 0–1. */
  systemFactor: number
  /** `tracking`: always square-on to the Sun; `fixed`: normal given by the two angles below. */
  panelMode: PanelMode
  fixedNormalAzDeg: number
  fixedNormalElDeg: number
}

/** Cosine of the angle between two directions given as azimuth / elevation. */
export function cosBetween(az1Deg: number, el1Deg: number, az2Deg: number, el2Deg: number): number {
  const e1 = el1Deg * DEG2RAD
  const e2 = el2Deg * DEG2RAD
  return Math.sin(e1) * Math.sin(e2) + Math.cos(e1) * Math.cos(e2) * Math.cos((az1Deg - az2Deg) * DEG2RAD)
}

/** Solar flux at the given distance from the Sun. */
export function solarFluxWm2(sunDistanceM: number): number {
  return SOLAR_CONSTANT_W_M2 * (AU_M / sunDistanceM) ** 2
}

/**
 * Panel output with an unobstructed Sun. Terrain blocking is applied by the caller,
 * which knows for what part of each step the Sun's centre was above the horizon.
 */
export function clearSkyPanelPowerW(panel: PanelSettings, sunAzDeg: number, sunElDeg: number, sunDistanceM: number): number {
  const incidence = panel.panelMode === 'tracking' ? 1 : Math.max(0, cosBetween(panel.fixedNormalAzDeg, panel.fixedNormalElDeg, sunAzDeg, sunElDeg))
  return solarFluxWm2(sunDistanceM) * panel.panelAreaM2 * panel.panelEfficiency * panel.systemFactor * incidence
}

export interface BatterySettings {
  capacityJ: number
  initialJ: number
  reserveJ: number
  /** Fraction of surplus energy that ends up stored, 0–1. */
  chargeEfficiency: number
  /** Fraction of energy taken from the battery that reaches the loads, 0–1. */
  dischargeEfficiency: number
}

export interface BatteryResult {
  /** State of charge at every sample (one more value than there are steps). */
  socJ: Float64Array
  /** Demand that could not be served because the battery was empty. */
  unmetJ: number
  /** Surplus that could not be stored because the battery was full. */
  curtailedJ: number
  /** First sample at which the state of charge is below the reserve, or `null`. */
  firstReserveViolationIndex: number | null
  minSocJ: number
}

/**
 * Energy balance over consecutive steps. `generationJ[i]` and `loadJ[i]` are the energy
 * produced and demanded during step `i`. Generation serves the load directly; only the
 * difference goes through the battery and pays its efficiency.
 */
export function simulateBattery(generationJ: ArrayLike<number>, loadJ: ArrayLike<number>, battery: BatterySettings): BatteryResult {
  const steps = Math.min(generationJ.length, loadJ.length)
  const socJ = new Float64Array(steps + 1)
  let soc = Math.min(Math.max(battery.initialJ, 0), battery.capacityJ)
  let unmetJ = 0
  let curtailedJ = 0
  let minSocJ = soc
  let firstReserveViolationIndex: number | null = soc < battery.reserveJ ? 0 : null
  socJ[0] = soc

  for (let i = 0; i < steps; i++) {
    const net = generationJ[i] - loadJ[i]
    if (net >= 0) {
      const stored = net * battery.chargeEfficiency
      const room = battery.capacityJ - soc
      if (stored > room) {
        curtailedJ += (stored - room) / battery.chargeEfficiency
        soc = battery.capacityJ
      } else {
        soc += stored
      }
    } else {
      const wanted = -net / battery.dischargeEfficiency
      if (wanted > soc) {
        unmetJ += (wanted - soc) * battery.dischargeEfficiency
        soc = 0
      } else {
        soc -= wanted
      }
    }
    socJ[i + 1] = soc
    if (soc < minSocJ) minSocJ = soc
    if (firstReserveViolationIndex === null && soc < battery.reserveJ) firstReserveViolationIndex = i + 1
  }

  return { socJ, unmetJ, curtailedJ, firstReserveViolationIndex, minSocJ }
}
