export interface Dataset {
  name: string
  columns: string[]
  rows: string[][]
}

export type ColSpec =
  | { kind: 'num'; lo: number; hi: number; bins: number }
  | { kind: 'cat'; categories: string[] }

export function parseCsv(text: string): Dataset | null {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const t = text.replace(/^﻿/, '')
  const first = t.split('\n', 1)[0]
  const delim = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : ','
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (quoted) {
      if (c === '"' && t[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === delim) { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some((x) => x.trim() !== '')) rows.push(row)
      row = []
    } else cell += c
  }
  row.push(cell)
  if (row.some((x) => x.trim() !== '')) rows.push(row)
  if (rows.length < 2) return null
  const columns = rows[0].map((c, i) => c.trim() || `column ${i + 1}`)
  const body = rows.slice(1).map((r) => columns.map((_, i) => (r[i] ?? '').trim()))
  return { name: 'CSV', columns, rows: body }
}

const needsQuote = /[",\n\r;]/
export function toCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map((v) => { const s = String(v); return needsQuote.test(s) ? `"${s.replace(/"/g, '""')}"` : s }).join(',')).join('\n') + '\n'
}

const num = (s: string) => (s === '' || !Number.isFinite(Number(s)) ? NaN : Number(s))

/** Guess a domain per column. The domain of a real analysis must come from public knowledge, not from the data. */
export function inferSpecs(ds: Dataset): ColSpec[] {
  return ds.columns.map((_, c) => {
    const vals = ds.rows.map((r) => r[c]).filter((v) => v !== '')
    const nums = vals.map(num).filter((x) => !Number.isNaN(x))
    if (vals.length > 0 && nums.length >= 0.9 * vals.length && new Set(vals).size > 6) {
      const lo = Math.floor(Math.min(...nums))
      const hi = Math.max(lo + 1, Math.ceil(Math.max(...nums)))
      return { kind: 'num', lo, hi, bins: 8 }
    }
    const freq = new Map<string, number>()
    for (const v of vals) freq.set(v, (freq.get(v) ?? 0) + 1)
    const categories = [...freq].sort((a, b) => b[1] - a[1]).slice(0, 12).map((e) => e[0]).sort()
    return { kind: 'cat', categories }
  })
}

export function column(ds: Dataset, name: string): string[] {
  const c = ds.columns.indexOf(name)
  return c < 0 ? [] : ds.rows.map((r) => r[c])
}

/** Numeric values of a column; blanks and non-numbers are skipped. */
export function numericColumn(ds: Dataset, name: string): number[] {
  return column(ds, name).map(num).filter((x) => !Number.isNaN(x))
}

/** Bin / category index of a raw value, or -1 if it is outside the declared domain. */
export function binIndex(spec: ColSpec, raw: string): number {
  if (spec.kind === 'cat') return spec.categories.indexOf(raw)
  const x = num(raw)
  if (Number.isNaN(x)) return -1
  const t = (Math.min(spec.hi, Math.max(spec.lo, x)) - spec.lo) / (spec.hi - spec.lo)
  return Math.min(spec.bins - 1, Math.floor(t * spec.bins))
}

export function domainSize(spec: ColSpec): number {
  return spec.kind === 'cat' ? spec.categories.length : spec.bins
}

const fmt = (x: number) => String(Number(x.toPrecision(4)))
export function binLabels(spec: ColSpec): string[] {
  if (spec.kind === 'cat') return spec.categories
  const w = (spec.hi - spec.lo) / spec.bins
  return Array.from({ length: spec.bins }, (_, i) => `${fmt(spec.lo + i * w)}–${fmt(spec.lo + (i + 1) * w)}`)
}
