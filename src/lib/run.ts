// Turns a query description plus a dataset into a differentially private output.

import { binIndex, binLabels, column, domainSize, numericColumn, type ColSpec, type Dataset } from './dataset.ts'
import { type Mechanism, type NoiseModel } from './mech.ts'
import {
  countQuery, countingPlan, histogramQuery, meanPlan, meanQuery, quantileQuery, quantileRankError, sumPlan, sumQuery, tableQuery,
  type QueryOutput,
} from './queries.ts'
import { uniform } from './rng.ts'
import { independentMarginals, marginalError, MAX_DOMAIN, mwem } from './synth.ts'

export type Kind = 'count' | 'sum' | 'mean' | 'quantile' | 'histogram' | 'table' | 'synth'

export interface QuerySpec {
  kind: Kind
  col: string
  col2: string
  cols: string[]
  /** count: category to match (categorical) or lower threshold (numeric); empty = every non-blank row. */
  cat: string
  q: number
  eps: number
  mech: Mechanism
  method: 'mwem' | 'independent'
  rounds: number
}

export const KIND_LABEL: Record<Kind, string> = {
  count: 'Count',
  sum: 'Sum (clamped)',
  mean: 'Mean (clamped)',
  quantile: 'Quantile / median',
  histogram: 'Histogram',
  table: 'Contingency table',
  synth: 'Synthetic data',
}

export interface RunOutput extends QueryOutput {
  synthetic?: { columns: string[]; rows: string[][] }
}

export const title = (s: QuerySpec): string => {
  switch (s.kind) {
    case 'count': return s.cat ? `Count of ${s.col} ${/^-?\d/.test(s.cat) ? '≥' : '='} ${s.cat}` : `Count of rows with ${s.col}`
    case 'sum': return `Sum of ${s.col}`
    case 'mean': return `Mean of ${s.col}`
    case 'quantile': return `${s.q === 0.5 ? 'Median' : `${Math.round(s.q * 100)}th percentile`} of ${s.col}`
    case 'histogram': return `Histogram of ${s.col}`
    case 'table': return `Table ${s.col} × ${s.col2}`
    case 'synth': return `Synthetic data (${s.method === 'mwem' ? 'MWEM' : 'independent'}): ${s.cols.join(', ')}`
  }
}

export function execute(s: QuerySpec, ds: Dataset, specs: ColSpec[]): RunOutput {
  const spec = (name: string) => specs[ds.columns.indexOf(name)]
  const bins = (name: string) => column(ds, name).map((v) => binIndex(spec(name), v))
  switch (s.kind) {
    case 'count': {
      const raw = column(ds, s.col)
      const sp = spec(s.col)
      const hit = (v: string) => (v === '' ? false : !s.cat ? true : sp?.kind === 'num' ? Number(v) >= Number(s.cat) : v === s.cat)
      return countQuery(raw.filter(hit).length, title(s), s.mech, s.eps)
    }
    case 'sum':
    case 'mean':
    case 'quantile': {
      const sp = spec(s.col)
      if (sp?.kind !== 'num') throw new Error('Pick a numeric column')
      const v = numericColumn(ds, s.col)
      if (s.kind === 'sum') return sumQuery(v, sp.lo, sp.hi, s.mech, s.eps)
      if (s.kind === 'mean') return meanQuery(v, sp.lo, sp.hi, s.mech, s.eps)
      return quantileQuery(v, sp.lo, sp.hi, s.q, s.eps)
    }
    case 'histogram':
      return histogramQuery(bins(s.col), binLabels(spec(s.col)), s.mech, s.eps)
    case 'table':
      return tableQuery(bins(s.col), bins(s.col2), binLabels(spec(s.col)), binLabels(spec(s.col2)), s.mech, s.eps)
    case 'synth': {
      const sps = s.cols.map(spec)
      const dims = sps.map(domainSize)
      const idx = s.cols.map(bins)
      const records = ds.rows.map((_, i) => idx.map((c) => c[i])).filter((r) => r.every((x) => x >= 0))
      const r = s.method === 'mwem' ? mwem(records, dims, s.eps, s.rounds) : independentMarginals(records, dims, s.eps)
      const decode = (sp: ColSpec, b: number) => {
        if (sp.kind === 'cat') return sp.categories[b]
        const w = (sp.hi - sp.lo) / sp.bins
        return String(Number((sp.lo + (b + uniform()) * w).toFixed(2))) // a random point inside the bin
      }
      return {
        values: [], labels: [], sd: NaN, ciHalf: NaN, parts: r.parts, pure: true,
        trueValues: [marginalError(records, r.rows, dims)],
        synthetic: { columns: s.cols, rows: r.rows.map((row) => row.map((b, c) => decode(sps[c], b))) },
        note: `${r.rows.length} synthetic rows; each column is a bin-level sample, so numbers are random points inside their bin.`,
      }
    }
  }
}

export function synthDomain(cols: string[], ds: Dataset, specs: ColSpec[]): number {
  return cols.reduce((a, c) => a * Math.max(1, domainSize(specs[ds.columns.indexOf(c)] ?? { kind: 'cat', categories: [] })), 1)
}
export const SYNTH_LIMIT = MAX_DOMAIN

export interface Plan {
  model?: NoiseModel
  /** Multiplier turning integer noise into output units. */
  mult: number
  sd: number
  ciHalf: number
  /** 95% half-width at another eps. */
  curve: (eps: number) => number
  unit: string
}

/** Expected error before spending anything. Uses only parameters and the (assumed public) row count. */
export function plan(s: QuerySpec, ds: Dataset, specs: ColSpec[]): Plan | null {
  const sp = specs[ds.columns.indexOf(s.col)]
  const n = ds.rows.length
  try {
    if (s.kind === 'count' || s.kind === 'histogram' || s.kind === 'table') {
      const p = countingPlan(s.mech, s.eps)
      return { model: p.model, mult: 1, sd: p.model.sd, ciHalf: p.ciHalf, curve: (e) => countingPlan(s.mech, e).ciHalf, unit: 'records' }
    }
    if (sp?.kind !== 'num') return null
    if (s.kind === 'sum') {
      const p = sumPlan(sp.lo, sp.hi, s.mech, s.eps)
      return { model: p.model, mult: p.grid.g, sd: p.sd, ciHalf: p.ciHalf, curve: (e) => sumPlan(sp.lo, sp.hi, s.mech, e).ciHalf, unit: 'sum units' }
    }
    if (s.kind === 'mean') {
      const p = meanPlan(n, sp.lo, sp.hi, s.mech, s.eps)
      const ci = (e: number) => { const q = meanPlan(n, sp.lo, sp.hi, s.mech, e); return q.model.quantileAbs(0.95) * q.unit }
      return { model: p.model, mult: p.unit, sd: p.sd, ciHalf: ci(s.eps), curve: ci, unit: s.col }
    }
    if (s.kind === 'quantile') {
      const r = (e: number) => quantileRankError(n, e)
      return { mult: 1, sd: NaN, ciHalf: r(s.eps), curve: r, unit: 'ranks' }
    }
  } catch {
    return null
  }
  return null
}


/** Components of the eps cost, known before running (mirrors what execute returns). */
export function estimateParts(s: QuerySpec): number[] {
  if (s.kind === 'mean') return [s.eps / 2, s.eps / 2]
  if (s.kind === 'synth') {
    if (s.method === 'independent') return [s.eps * 0.1, ...s.cols.map(() => (s.eps * 0.9) / s.cols.length)]
    return [s.eps * 0.1, ...Array.from({ length: s.rounds * 2 }, () => (s.eps * 0.9) / s.rounds / 2)]
  }
  return [s.eps]
}

export const isPure = (s: QuerySpec) => s.mech === 'laplace' || s.kind === 'quantile' || s.kind === 'synth'

/** Make the query refer to columns that exist and suit its kind. */
export function normalize(q: QuerySpec, ds: Dataset, specs: ColSpec[]): QuerySpec {
  const names = ds.columns
  const usable = names.filter((_, i) => domainSize(specs[i]) > 0 || specs[i].kind === 'num')
  const numeric = names.filter((_, i) => specs[i].kind === 'num')
  const pool = q.kind === 'sum' || q.kind === 'mean' || q.kind === 'quantile' ? numeric : q.kind === 'count' ? names : usable
  const col = pool.includes(q.col) ? q.col : (pool[0] ?? '')
  const col2 = usable.includes(q.col2) && q.col2 !== col ? q.col2 : (usable.find((c) => c !== col) ?? col)
  const cols = q.cols.filter((c) => usable.includes(c))
  return { ...q, col, col2, cols: cols.length ? cols : usable.slice(0, 3), cat: q.col === col ? q.cat : '' }
}
