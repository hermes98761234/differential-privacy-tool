import { describe, expect, it } from 'vitest'
import { BudgetExceeded, canSpend, costOf, epsSpent, maxNextEps, rhoBudget, spend, zcdpToEps, type BudgetState } from './budget.ts'
import { binIndex, inferSpecs, parseCsv, toCsv } from './dataset.ts'
import { exponentialMechanism, noiseModel } from './mech.ts'
import { clampedSteps, countQuery, meanQuery, quantileQuery, sumGrid, sumQuery } from './queries.ts'
import { discreteGaussian, discreteLaplace, randBelow, uniform } from './rng.ts'
import { rrEpsilon, rrEstimate, rrRespond, rrSd, rrYesProb } from './rr.ts'
import { SAMPLES } from './samples.ts'
import { independentMarginals, marginalError, mwem } from './synth.ts'

function moments(draw: () => number, n: number) {
  let s = 0
  let s2 = 0
  for (let i = 0; i < n; i++) {
    const x = draw()
    s += x
    s2 += x * x
  }
  const mean = s / n
  return { mean, variance: s2 / n - mean * mean }
}

describe('secure samplers', () => {
  it('uniform has mean 1/2 and variance 1/12', () => {
    const m = moments(uniform, 100000)
    expect(m.mean).toBeCloseTo(0.5, 2)
    expect(m.variance).toBeCloseTo(1 / 12, 2)
  })
  it('randBelow is uniform on its range', () => {
    const c = [0, 0, 0]
    for (let i = 0; i < 30000; i++) c[randBelow(3)]++
    for (const x of c) expect(Math.abs(x - 10000)).toBeLessThan(500)
  })
  it.each([0.5, 3, 12])('discrete Laplace (b=%s) has mean 0 and the theoretical variance', (b) => {
    const m = moments(() => discreteLaplace(b), 200000)
    const theory = noiseModel('laplace', b).sd ** 2
    expect(Math.abs(m.mean)).toBeLessThan(5 * Math.sqrt(theory / 200000))
    expect(m.variance / theory).toBeGreaterThan(0.95)
    expect(m.variance / theory).toBeLessThan(1.05)
  })
  it.each([0.7, 4, 15])('discrete Gaussian (sigma=%s) has mean 0 and the theoretical variance', (s) => {
    const m = moments(() => discreteGaussian(s), 200000)
    const theory = noiseModel('gaussian', s).sd ** 2
    expect(Math.abs(m.mean)).toBeLessThan(5 * Math.sqrt(theory / 200000))
    expect(m.variance / theory).toBeGreaterThan(0.95)
    expect(m.variance / theory).toBeLessThan(1.05)
  })
  it('discrete Laplace matches its pmf and the eps-DP likelihood ratio', () => {
    const b = 2
    const n = 200000
    const c = new Map<number, number>()
    for (let i = 0; i < n; i++) {
      const x = discreteLaplace(b)
      c.set(x, (c.get(x) ?? 0) + 1)
    }
    const model = noiseModel('laplace', b)
    for (const k of [0, 1, -2, 4]) expect((c.get(k) ?? 0) / n).toBeCloseTo(model.pmf(k), 2)
    // Shifting the answer by 1 changes any outcome's probability by at most e^(1/b).
    expect(model.pmf(3) / model.pmf(4)).toBeCloseTo(Math.exp(1 / b), 10)
  })
  it('noise model quantiles bracket 95%', () => {
    for (const mech of ['laplace', 'gaussian'] as const) {
      const m = noiseModel(mech, 5)
      const k = m.quantileAbs(0.95)
      let p = 0
      for (let i = -k; i <= k; i++) p += m.pmf(i)
      expect(p).toBeGreaterThanOrEqual(0.95 - 1e-9)
      let q = 0
      for (let i = -(k - 1); i <= k - 1; i++) q += m.pmf(i)
      expect(q).toBeLessThan(0.95)
    }
  })
})

describe('clamping bounds sensitivity', () => {
  const lo = 0
  const hi = 100
  const grid = sumGrid(lo, hi)
  const total = (v: number[]) => clampedSteps(v, lo, hi, 0, grid).reduce((a, b) => a + b, 0)
  it('adding a record, however extreme, moves the clamped sum by at most the sensitivity', () => {
    const base = Array.from({ length: 50 }, (_, i) => (i * 37) % 101)
    for (const extra of [-1e9, -5, 0, 50, 100, 1e12, Infinity]) {
      expect(Math.abs(total([...base, extra]) - total(base))).toBeLessThanOrEqual(grid.sens)
    }
    expect(total([...base, 1e12]) - total(base)).toBe(100)
  })
  it('uses an exact integer grid for integer bounds and a 65536-step grid otherwise', () => {
    expect(sumGrid(0, 100)).toEqual({ g: 1, sens: 100 })
    expect(sumGrid(-3, 2)).toEqual({ g: 1, sens: 3 })
    const g = sumGrid(0, 0.5)
    expect(g.sens).toBe(65536)
    expect(g.g * g.sens).toBeCloseTo(0.5, 12)
  })
  it('noisy sum and mean are unbiased and respect the bounds', () => {
    const vals = Array.from({ length: 200 }, (_, i) => i % 100)
    const sums = Array.from({ length: 400 }, () => sumQuery(vals, 0, 100, 'laplace', 1).values[0])
    const truth = vals.reduce((a, b) => a + b, 0)
    expect(sums.reduce((a, b) => a + b, 0) / sums.length).toBeGreaterThan(truth - 60)
    expect(sums.reduce((a, b) => a + b, 0) / sums.length).toBeLessThan(truth + 60)
    const mean = meanQuery([...vals, 1e9, -1e9], 0, 100, 'gaussian', 5)
    expect(mean.values[0]).toBeGreaterThanOrEqual(0)
    expect(mean.values[0]).toBeLessThanOrEqual(100)
    expect(mean.trueValues[0]).toBeGreaterThan(40)
    expect(mean.trueValues[0]).toBeLessThan(60)
  })
  it('rejects empty bounds', () => {
    expect(() => meanQuery([1], 5, 5, 'laplace', 1)).toThrow()
  })
})

describe('budget accounting', () => {
  const fresh = (accounting: BudgetState['accounting'], totalEps = 1): BudgetState => ({ totalEps, delta: 1e-6, accounting, ledger: [] })
  const entry = (id: string, parts: number[], pure = true) => ({ id, label: id, ...costOf(parts, pure) })
  it('basic composition adds eps and refuses overspend', () => {
    let b = fresh('basic')
    b = spend(b, entry('a', [0.4]))
    b = spend(b, entry('b', [0.6]))
    expect(epsSpent(b)).toBeCloseTo(1, 12)
    expect(() => spend(b, entry('c', [0.01]))).toThrow(BudgetExceeded)
    expect(maxNextEps(b)).toBeCloseTo(0, 9)
  })
  it('refuses Gaussian queries under basic accounting', () => {
    expect(canSpend(fresh('basic'), entry('g', [0.1], false))).toBe(false)
    expect(canSpend(fresh('zcdp'), entry('g', [0.1], false))).toBe(true)
  })
  it('zCDP: rho adds, conversion round-trips and overspend is refused', () => {
    const rho = rhoBudget(2, 1e-6)
    expect(zcdpToEps(rho, 1e-6)).toBeCloseTo(2, 9)
    let b = fresh('zcdp', 2)
    const eps = Math.sqrt(2 * rho / 4) // four equal queries use the whole rho budget
    for (let i = 0; i < 4; i++) b = spend(b, entry(`q${i}`, [eps]))
    expect(epsSpent(b)).toBeCloseTo(2, 6)
    expect(() => spend(b, entry('x', [0.05]))).toThrow(BudgetExceeded)
  })
  it('zCDP composes many small queries better than basic', () => {
    const b: BudgetState = { ...fresh('zcdp', 5), ledger: Array.from({ length: 1000 }, (_, i) => entry(`q${i}`, [0.01])) }
    expect(epsSpent(b)).toBeLessThan(2) // basic would say 10
    expect(canSpend(b, entry('next', [0.01]))).toBe(true)
  })
  it('splitting a query into parts costs the sum of parts', () => {
    expect(costOf([0.5, 0.5], true).eps).toBe(1)
    expect(costOf([0.5, 0.5], true).rho).toBeCloseTo(0.25, 12)
  })
})

describe('randomized response', () => {
  it('epsilon of the coin-flip survey is ln 3', () => {
    expect(rrEpsilon(0.5)).toBeCloseTo(Math.log(3), 12)
  })
  it('the estimator is exactly unbiased in expectation', () => {
    for (const p of [0.25, 0.5, 0.9]) for (const pi of [0, 0.3, 1]) expect(rrEstimate(rrYesProb(pi, p), p)).toBeCloseTo(pi, 12)
  })
  it('simulated survey recovers the share with the predicted spread', () => {
    const p = 0.5
    const pi = 0.3
    const n = 4000
    const ests: number[] = []
    for (let r = 0; r < 200; r++) {
      let yes = 0
      for (let i = 0; i < n; i++) if (rrRespond(i < pi * n, p)) yes++
      ests.push(rrEstimate(yes / n, p))
    }
    const m = moments(() => ests.pop()!, 200)
    expect(m.mean).toBeCloseTo(pi, 1)
    expect(Math.sqrt(m.variance) / rrSd(pi, n, p)).toBeGreaterThan(0.8)
    expect(Math.sqrt(m.variance) / rrSd(pi, n, p)).toBeLessThan(1.25)
  })
})

describe('exponential mechanism and quantiles', () => {
  it('prefers high-utility outputs with the e^(eps du / 2) ratio', () => {
    const eps = 1
    const scores = [0, -1, -2, -6]
    const c = [0, 0, 0, 0]
    for (let i = 0; i < 60000; i++) c[exponentialMechanism(scores, eps, 1)]++
    expect(c.indexOf(Math.max(...c))).toBe(0)
    expect(c[0] / c[1]).toBeGreaterThan(Math.exp(0.5) * 0.9)
    expect(c[0] / c[1]).toBeLessThan(Math.exp(0.5) * 1.1)
    expect(c[3]).toBeLessThan(c[2])
  })
  it('never picks a zero-width interval', () => {
    for (let i = 0; i < 200; i++) expect(exponentialMechanism([5, 0], 1, 1, [-Infinity, 0])).toBe(1)
  })
  it('median is close to the truth at high eps and stays within bounds', () => {
    const vals = Array.from({ length: 501 }, (_, i) => i / 5)
    const r = quantileQuery(vals, 0, 100, 0.5, 20)
    expect(r.trueValues[0]).toBeCloseTo(50, 0)
    expect(Math.abs(r.values[0] - 50)).toBeLessThan(3)
    const wild = quantileQuery([1e9, -1e9, 4], 0, 10, 0.5, 0.1)
    expect(wild.values[0]).toBeGreaterThanOrEqual(0)
    expect(wild.values[0]).toBeLessThanOrEqual(10)
  })
})

describe('counts, data and synthetic release', () => {
  it('noisy count is centred on the truth', () => {
    const xs = Array.from({ length: 2000 }, () => countQuery(100, 'n', 'laplace', 0.5).values[0])
    expect(xs.reduce((a, b) => a + b, 0) / xs.length).toBeGreaterThan(98)
    expect(xs.reduce((a, b) => a + b, 0) / xs.length).toBeLessThan(102)
  })
  it('parses quoted CSV and round-trips it', () => {
    const ds = parseCsv('a,b\n1,"x, y"\n2,"say ""hi"""\n')!
    expect(ds.rows).toEqual([['1', 'x, y'], ['2', 'say "hi"']])
    expect(parseCsv(toCsv([ds.columns, ...ds.rows]))!.rows).toEqual(ds.rows)
  })
  it('bins values and infers specs', () => {
    expect(binIndex({ kind: 'num', lo: 0, hi: 10, bins: 5 }, '10')).toBe(4)
    expect(binIndex({ kind: 'num', lo: 0, hi: 10, bins: 5 }, '-5')).toBe(0)
    expect(binIndex({ kind: 'cat', categories: ['a'] }, 'z')).toBe(-1)
    expect(inferSpecs(SAMPLES[0].dataset)[3].kind).toBe('num')
  })
  it('sample datasets are consistent', () => {
    for (const s of SAMPLES) {
      expect(s.specs).toHaveLength(s.dataset.columns.length)
      for (const r of s.dataset.rows) expect(r).toHaveLength(s.dataset.columns.length)
    }
  })
  const dims = [2, 3, 2]
  const records = Array.from({ length: 1500 }, (_, i) => {
    const a = i % 2
    return [a, a === 0 ? i % 3 : 2, (a + (i % 7 === 0 ? 1 : 0)) % 2]
  })
  it('independent marginals and MWEM reproduce structure at high eps', () => {
    const ind = independentMarginals(records, dims, 50)
    const mw = mwem(records, dims, 50, 12)
    expect(Math.abs(ind.rows.length - 1500)).toBeLessThan(100)
    expect(marginalError(records, mw.rows, dims)).toBeLessThan(0.1)
    // MWEM captures correlation that independent sampling cannot.
    expect(marginalError(records, mw.rows, dims)).toBeLessThan(marginalError(records, ind.rows, dims))
  })
  it('synthesis spends exactly the requested eps', () => {
    for (const r of [independentMarginals(records, dims, 1), mwem(records, dims, 1, 5)]) {
      expect(r.parts.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9)
    }
  })
  it('refuses oversized domains', () => {
    expect(() => mwem([], [200, 200], 1, 3)).toThrow(/too large/)
  })
})
