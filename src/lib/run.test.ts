import { describe, expect, it } from 'vitest'
import { costOf } from './budget.ts'
import { estimateParts, execute, normalize, plan, type QuerySpec } from './run.ts'
import { reportCsv, reportJson, type Release } from './report.ts'
import { SAMPLES } from './samples.ts'

const base: QuerySpec = { kind: 'histogram', col: 'section', col2: 'passed', cols: ['section', 'passed'], cat: '', q: 0.5, eps: 50, mech: 'laplace', method: 'mwem', rounds: 6 }
const { dataset: ds, specs } = SAMPLES[0]

describe('query execution on a sample dataset', () => {
  it('histogram at large eps is close to the exact counts and totals the rows', () => {
    const r = execute(base, ds, specs)
    expect(r.labels).toEqual(['A', 'B', 'C'])
    expect(r.trueValues.reduce((a, b) => a + b, 0)).toBe(ds.rows.length)
    r.values.forEach((v, i) => expect(Math.abs(v - r.trueValues[i])).toBeLessThan(5))
  })
  it('contingency table has rows x cols cells', () => {
    const r = execute({ ...base, kind: 'table' }, ds, specs)
    expect(r.shape).toEqual([3, 2])
    expect(r.values).toHaveLength(6)
  })
  it('estimated cost parts match what execution reports', () => {
    for (const kind of ['count', 'sum', 'mean', 'quantile', 'histogram', 'table', 'synth'] as const) {
      const q = { ...base, kind, col: kind === 'count' || kind === 'histogram' || kind === 'table' ? 'section' : 'final', eps: 1 }
      const out = execute(q, ds, specs)
      expect(costOf(estimateParts(q), true).eps).toBeCloseTo(costOf(out.parts, true).eps, 9)
      expect(costOf(estimateParts(q), true).rho).toBeCloseTo(costOf(out.parts, true).rho, 9)
    }
  })
  it('synthetic release has the chosen columns and in-domain values', () => {
    const r = execute({ ...base, kind: 'synth', eps: 20 }, ds, specs)
    expect(r.synthetic!.columns).toEqual(['section', 'passed'])
    for (const row of r.synthetic!.rows) {
      expect(['A', 'B', 'C']).toContain(row[0])
      expect(['yes', 'no']).toContain(row[1])
    }
  })
  it('plans expected error that shrinks as eps grows', () => {
    const q = { ...base, kind: 'mean' as const, col: 'final', eps: 0.5 }
    const p = plan(q, ds, specs)!
    expect(p.curve(1)).toBeLessThan(p.curve(0.1))
    expect(p.curve(0.5)).toBeCloseTo(p.ciHalf, 9)
  })
  it('normalize repairs a query that points at a missing column', () => {
    const n = normalize({ ...base, kind: 'mean', col: 'nope' }, ds, specs)
    expect(specs[ds.columns.indexOf(n.col)].kind).toBe('num')
  })
  it('the exported report never contains true values', () => {
    const out = execute({ ...base, eps: 1 }, ds, specs)
    const { trueValues, ...rest } = out
    const rel: Release = { ...rest, id: 'x', title: 't', kind: 'histogram', mech: 'laplace', eps: 1, at: '' }
    const json = reportJson('d', { totalEps: 2, delta: 1e-6, accounting: 'basic', ledger: [] }, [rel])
    expect(json).not.toContain('trueValues')
    expect(JSON.stringify(Object.keys(JSON.parse(json).releases[0]))).not.toMatch(/true/)
    expect(reportCsv([rel]).split('\n')).toHaveLength(3 + 2)
    expect(JSON.parse(json).releases[0].values).toEqual(out.values)
    expect(trueValues).toHaveLength(3)
  })
})
