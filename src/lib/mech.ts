import { discreteGaussian, discreteLaplace, uniform } from './rng.ts'

export type Mechanism = 'laplace' | 'gaussian'

/**
 * Both mechanisms are parametrised by one number, eps, so a slider means the same
 * thing for each: scale = sensitivity / eps.
 *  - laplace:  discrete Laplace with b = L1 sensitivity / eps; satisfies eps-DP.
 *  - gaussian: discrete Gaussian with sigma = L2 sensitivity / eps, which is
 *    rho-zCDP with rho = Delta^2 / (2 sigma^2) = eps^2 / 2.
 */
export function scaleFor(eps: number, sens: number): number {
  return sens / eps
}

export const rhoOf = (eps: number) => (eps * eps) / 2

export function sampleNoise(mech: Mechanism, scale: number): number {
  return mech === 'laplace' ? discreteLaplace(scale) : discreteGaussian(scale)
}

export interface NoiseModel {
  sd: number
  pmf: (k: number) => number
  /** Smallest integer k with P(|X| <= k) >= p. */
  quantileAbs: (p: number) => number
}

export function noiseModel(mech: Mechanism, scale: number): NoiseModel {
  if (mech === 'laplace') {
    const a = Math.exp(-1 / scale)
    return {
      sd: Math.sqrt((2 * a) / (1 - a) ** 2),
      pmf: (k) => ((1 - a) / (1 + a)) * a ** Math.abs(k),
      quantileAbs: (p) => Math.max(0, Math.ceil(Math.log(((1 - p) * (1 + a)) / 2) / Math.log(a)) - 1),
    }
  }
  const m = Math.ceil(12 * scale) + 2
  const w = (k: number) => Math.exp(-(k * k) / (2 * scale * scale))
  let z = 0
  let v = 0
  for (let k = -m; k <= m; k++) {
    z += w(k)
    v += k * k * w(k)
  }
  return {
    sd: Math.sqrt(v / z),
    pmf: (k) => w(k) / z,
    quantileAbs: (p) => {
      let c = w(0) / z
      for (let k = 0; k < m; k++) {
        if (c >= p) return k
        c += (2 * w(k + 1)) / z
      }
      return m
    },
  }
}

/** Fixed-point grid for real-valued data: integers with a bounded range, so integer noise applies. */
export interface Grid {
  g: number // value of one grid step
  sens: number // largest change of one record's grid value
}

const MAX_STEPS = 65536

/** Grid for values with |x| <= maxAbs. Integer bounds up to 65536 are used exactly (g = 1). */
export function gridFor(maxAbs: number, integerBounds: boolean): Grid {
  if (integerBounds && maxAbs <= MAX_STEPS) return { g: 1, sens: maxAbs }
  return { g: maxAbs / MAX_STEPS, sens: MAX_STEPS }
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}

/** Exponential mechanism: returns index i with P proportional to exp(eps * score_i / (2 sens)) * weight_i. */
export function exponentialMechanism(scores: number[], eps: number, sens: number, logBase?: number[]): number {
  const lw = scores.map((s, i) => (eps * s) / (2 * sens) + (logBase ? logBase[i] : 0))
  const mx = Math.max(...lw)
  const w = lw.map((x) => Math.exp(x - mx))
  const total = w.reduce((a, b) => a + b, 0)
  let r = uniform() * total
  for (let i = 0; i < w.length; i++) {
    r -= w[i]
    if (r < 0) return i
  }
  return w.findLastIndex((x) => x > 0)
}
