import { clamp, exponentialMechanism, gridFor, noiseModel, sampleNoise, scaleFor, type Grid, type Mechanism, type NoiseModel } from './mech.ts'
import { uniform } from './rng.ts'

export interface QueryOutput {
  /** Noisy, releasable numbers. */
  values: number[]
  /** Exact answers for the analyst preview only. Never exported. */
  trueValues: number[]
  labels: string[]
  shape?: [number, number]
  /** Noise standard deviation per value (output units); NaN when not defined. */
  sd: number
  /** Half-width of an approximate 95% interval per value (output units); NaN when not defined. */
  ciHalf: number
  /** eps of each component mechanism, for budget accounting. */
  parts: number[]
  pure: boolean
  note?: string
}

export const Z95 = 1.959964

// ---- counting-type queries (sensitivity 1) ------------------------------------

export function noisyCounts(counts: number[], mech: Mechanism, eps: number): number[] {
  const scale = scaleFor(eps, 1)
  return counts.map((c) => Math.max(0, c + sampleNoise(mech, scale)))
}

export function countingPlan(mech: Mechanism, eps: number): { model: NoiseModel; scale: number; ciHalf: number } {
  const scale = scaleFor(eps, 1)
  const model = noiseModel(mech, scale)
  return { model, scale, ciHalf: model.quantileAbs(0.95) }
}

export function countQuery(count: number, label: string, mech: Mechanism, eps: number): QueryOutput {
  const { model, ciHalf } = countingPlan(mech, eps)
  return { values: noisyCounts([count], mech, eps), trueValues: [count], labels: [label], sd: model.sd, ciHalf, parts: [eps], pure: mech === 'laplace' }
}

/** idx: bin of each record (-1 = outside the domain, not counted). */
export function histogramQuery(idx: number[], labels: string[], mech: Mechanism, eps: number): QueryOutput {
  const counts = new Array<number>(labels.length).fill(0)
  for (const i of idx) if (i >= 0) counts[i]++
  const { model, ciHalf } = countingPlan(mech, eps)
  // One record falls in one bin, so the whole histogram costs a single eps (parallel composition).
  return { values: noisyCounts(counts, mech, eps), trueValues: counts, labels, sd: model.sd, ciHalf, parts: [eps], pure: mech === 'laplace' }
}

export function tableQuery(rowIdx: number[], colIdx: number[], rowLabels: string[], colLabels: string[], mech: Mechanism, eps: number): QueryOutput {
  const c = colLabels.length
  const flat = rowIdx.map((r, i) => (r >= 0 && colIdx[i] >= 0 ? r * c + colIdx[i] : -1))
  const labels = rowLabels.flatMap((r) => colLabels.map((k) => `${r} × ${k}`))
  return { ...histogramQuery(flat, labels, mech, eps), shape: [rowLabels.length, c] }
}

// ---- sum and mean with clamping ------------------------------------------------

const isInt = (x: number) => Number.isInteger(x)

/** Grid steps of each clamped value x - offset; every record's term lies in [0, grid.sens] (or [-sens, sens] for offset 0). */
export function clampedSteps(values: number[], lo: number, hi: number, offset: number, grid: Grid): number[] {
  return values.map((x) => Math.round((clamp(x, lo, hi) - offset) / grid.g))
}

export function sumGrid(lo: number, hi: number): Grid {
  return gridFor(Math.max(Math.abs(lo), Math.abs(hi)), isInt(lo) && isInt(hi))
}
export function meanGrid(lo: number, hi: number): Grid {
  return gridFor(hi - lo, isInt(lo) && isInt(hi))
}

function checkBounds(lo: number, hi: number) {
  if (!(hi > lo) || !Number.isFinite(lo) || !Number.isFinite(hi)) throw new RangeError('Upper bound must be above lower bound')
}

/** Noise model for the sum of clamped values, in output units. */
export function sumPlan(lo: number, hi: number, mech: Mechanism, eps: number) {
  checkBounds(lo, hi)
  const grid = sumGrid(lo, hi)
  const scale = scaleFor(eps, grid.sens)
  const model = noiseModel(mech, scale)
  return { grid, scale, model, sd: model.sd * grid.g, ciHalf: model.quantileAbs(0.95) * grid.g }
}

export function sumQuery(values: number[], lo: number, hi: number, mech: Mechanism, eps: number): QueryOutput {
  const p = sumPlan(lo, hi, mech, eps)
  const s = clampedSteps(values, lo, hi, 0, p.grid).reduce((a, b) => a + b, 0)
  return {
    values: [(s + sampleNoise(mech, p.scale)) * p.grid.g],
    trueValues: [s * p.grid.g],
    labels: ['sum'],
    sd: p.sd,
    ciHalf: p.ciHalf,
    parts: [eps],
    pure: mech === 'laplace',
  }
}

/** Mean = noisy sum of (x - lo) over noisy count, each with eps/2. Result clamped to [lo, hi] (post-processing). */
export function meanQuery(values: number[], lo: number, hi: number, mech: Mechanism, eps: number): QueryOutput {
  checkBounds(lo, hi)
  const grid = meanGrid(lo, hi)
  const half = eps / 2
  const sScale = scaleFor(half, grid.sens)
  const nScale = scaleFor(half, 1)
  const s = clampedSteps(values, lo, hi, lo, grid).reduce((a, b) => a + b, 0)
  const n = values.length
  const noisyS = (s + sampleNoise(mech, sScale)) * grid.g
  const noisyN = Math.max(1, n + sampleNoise(mech, nScale))
  const mean = clamp(lo + noisyS / noisyN, lo, hi)
  const sdS = noiseModel(mech, sScale).sd * grid.g
  const sdN = noiseModel(mech, nScale).sd
  const sd = Math.sqrt(sdS ** 2 + ((mean - lo) * sdN) ** 2) / noisyN
  return {
    values: [mean],
    trueValues: [n ? lo + (s * grid.g) / n : NaN],
    labels: ['mean'],
    sd,
    ciHalf: Z95 * sd,
    parts: [half, half],
    pure: mech === 'laplace',
    note: `Released as a noisy sum over a noisy count (eps/2 each), clamped to [${lo}, ${hi}].`,
  }
}

/** Planning-time error of the mean for n records (the row count is treated as public here). */
export function meanPlan(n: number, lo: number, hi: number, mech: Mechanism, eps: number) {
  checkBounds(lo, hi)
  const grid = meanGrid(lo, hi)
  const model = noiseModel(mech, scaleFor(eps / 2, grid.sens))
  const sd = (model.sd * grid.g) / Math.max(1, n)
  return { model, grid, scale: scaleFor(eps / 2, grid.sens), sd, ciHalf: Z95 * sd, unit: grid.g / Math.max(1, n) }
}

// ---- quantile via the exponential mechanism -----------------------------------

/** Rank error (in records) that holds with probability >= 1 - beta (Smith 2011 style bound). */
export function quantileRankError(n: number, eps: number, beta = 0.05): number {
  return (2 / eps) * Math.log((n + 1) / beta)
}

/**
 * Pick one of the n+1 gaps between sorted clamped values with probability
 * proportional to width * exp(-eps * |rank - q n| / 2), then a uniform point inside it.
 * Utility -|rank - q n| has sensitivity 1.
 */
export function quantileQuery(values: number[], lo: number, hi: number, q: number, eps: number): QueryOutput {
  checkBounds(lo, hi)
  const xs = values.map((x) => clamp(x, lo, hi)).sort((a, b) => a - b)
  const n = xs.length
  const pts = [lo, ...xs, hi]
  const scores = pts.slice(0, -1).map((_, i) => -Math.abs(i - q * n))
  const logW = pts.slice(0, -1).map((_, i) => Math.log(pts[i + 1] - pts[i])) // -Infinity for empty gaps
  const i = exponentialMechanism(scores, eps, 1, logW)
  const v = pts[i] + uniform() * (pts[i + 1] - pts[i])
  const exact = n ? xs[Math.min(n - 1, Math.max(0, Math.ceil(q * n) - 1))] : NaN
  return {
    values: [v],
    trueValues: [exact],
    labels: [`${q === 0.5 ? 'median' : `${Math.round(q * 100)}th percentile`}`],
    sd: NaN,
    ciHalf: NaN,
    parts: [eps],
    pure: true,
    note: `Exponential mechanism. With 95% probability the answer's rank is within about ${Math.ceil(quantileRankError(n, eps))} records of the true one.`,
  }
}
