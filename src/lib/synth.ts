// Synthetic data release from noisy marginals. Everything after the noisy
// measurements is post-processing, so the privacy cost is only the measurements.
//
//  - independent: one noisy 1-way histogram per column, rows sampled column by column.
//  - mwem: Multiplicative Weights + Exponential Mechanism (Hardt, Ligett & McSherry 2012)
//    over all 2-way marginal cells, starting from a uniform distribution.
//
// Records are tuples of bin indices, one per selected column.

import { exponentialMechanism } from './mech.ts'
import { discreteLaplace, uniform } from './rng.ts'

export interface SynthResult {
  rows: number[][]
  /** eps of each pure-DP component, for accounting. */
  parts: number[]
}

export const MAX_DOMAIN = 20000

const lap = (c: number, eps: number) => c + discreteLaplace(1 / eps)

function sampleFrom(weights: number[], total: number): number {
  let r = uniform() * total
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]
    if (r < 0) return i
  }
  return weights.length - 1
}

/** Share of eps spent on estimating the number of rows. */
const N_SHARE = 0.1

export function independentMarginals(records: number[][], dims: number[], eps: number): SynthResult {
  const epsN = eps * N_SHARE
  const epsCol = (eps - epsN) / dims.length
  const n = Math.max(0, Math.round(lap(records.length, epsN)))
  const margs = dims.map((d, c) => {
    const h = new Array<number>(d).fill(0)
    for (const r of records) h[r[c]]++
    return h.map((x) => Math.max(0, lap(x, epsCol)))
  })
  const sums = margs.map((m) => m.reduce((a, b) => a + b, 0))
  const rows = Array.from({ length: n }, () =>
    margs.map((m, c) => (sums[c] > 0 ? sampleFrom(m, sums[c]) : Math.floor(uniform() * dims[c]))),
  )
  return { rows, parts: [epsN, ...dims.map(() => epsCol)] }
}

export function mwem(records: number[][], dims: number[], eps: number, rounds: number): SynthResult {
  const k = dims.length
  const D = dims.reduce((a, b) => a * b, 1)
  if (D > MAX_DOMAIN) throw new RangeError(`Domain too large (${D} cells, limit ${MAX_DOMAIN}). Use fewer columns or bins.`)
  const epsN = eps * N_SHARE
  const epsRound = (eps - epsN) / rounds / 2
  const n = Math.max(1, Math.round(lap(records.length, epsN)))

  // Marginal sets: all column pairs, or the single column.
  const sets: number[][] = []
  if (k === 1) sets.push([0])
  else for (let a = 0; a < k; a++) for (let b = a + 1; b < k; b++) sets.push([a, b])
  const strides = dims.map((_, c) => dims.slice(c + 1).reduce((a, b) => a * b, 1))
  const cellOf = (set: number[], x: number) => set.reduce((acc, c) => acc * dims[c] + (Math.floor(x / strides[c]) % dims[c]), 0)
  const cells = sets.map((s) => s.reduce((a, c) => a * dims[c], 1))
  // For every set, which marginal cell each domain point falls in.
  const map = sets.map((s) => Uint32Array.from({ length: D }, (_, x) => cellOf(s, x)))
  const marginal = (si: number, w: ArrayLike<number>) => {
    const m = new Float64Array(cells[si])
    for (let x = 0; x < D; x++) m[map[si][x]] += w[x]
    return m
  }
  const trueW = new Float64Array(D)
  for (const r of records) trueW[r.reduce((acc, v, c) => acc + v * strides[c], 0)]++
  const truth = sets.map((_, si) => marginal(si, trueW))

  const A = new Float64Array(D).fill(n / D)
  const measured: { si: number; cell: number; m: number }[] = []
  for (let t = 0; t < rounds; t++) {
    const synth = sets.map((_, si) => marginal(si, A))
    const flat: { si: number; cell: number }[] = []
    const scores: number[] = []
    sets.forEach((_, si) => {
      for (let c = 0; c < cells[si]; c++) {
        flat.push({ si, cell: c })
        scores.push(Math.abs(truth[si][c] - synth[si][c]))
      }
    })
    const pick = flat[exponentialMechanism(scores, epsRound, 1)]
    measured.push({ ...pick, m: lap(truth[pick.si][pick.cell], epsRound) })
    // Multiplicative weights over everything measured so far.
    for (const { si, cell, m } of measured) {
      const ans = marginal(si, A)[cell]
      const f = (m - ans) / (2 * n)
      for (let x = 0; x < D; x++) if (map[si][x] === cell) A[x] *= Math.exp(f)
      const total = A.reduce((a, b) => a + b, 0)
      for (let x = 0; x < D; x++) A[x] *= n / total
    }
  }
  const total = A.reduce((a, b) => a + b, 0)
  const weights = Array.from(A)
  const rows = Array.from({ length: n }, () => {
    const x = sampleFrom(weights, total)
    return dims.map((d, c) => Math.floor(x / strides[c]) % d)
  })
  return { rows, parts: [epsN, ...Array.from({ length: rounds * 2 }, () => epsRound)] }
}

/** Average total-variation distance over all 2-way marginals (1-way if one column): 0 identical, 1 disjoint. */
export function marginalError(a: number[][], b: number[][], dims: number[]): number {
  if (!a.length || !b.length) return 1
  const sets: number[][] = dims.length === 1 ? [[0]] : []
  for (let i = 0; i < dims.length; i++) for (let j = i + 1; j < dims.length; j++) sets.push([i, j])
  let sum = 0
  for (const s of sets) {
    const size = s.reduce((acc, c) => acc * dims[c], 1)
    const hist = (rows: number[][]) => {
      const h = new Float64Array(size)
      for (const r of rows) h[s.reduce((acc, c) => acc * dims[c] + r[c], 0)] += 1 / rows.length
      return h
    }
    const ha = hist(a)
    const hb = hist(b)
    sum += ha.reduce((acc, v, i) => acc + Math.abs(v - hb[i]), 0) / 2
  }
  return sum / sets.length
}
