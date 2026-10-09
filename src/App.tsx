import { useEffect, useMemo, useRef, useState } from 'react'
import BudgetPanel from './components/BudgetPanel.tsx'
import Builder from './components/Builder.tsx'
import DataPanel, { type Source } from './components/DataPanel.tsx'
import Learn from './components/Learn.tsx'
import ResultCard from './components/ResultCard.tsx'
import { BudgetExceeded, costOf, maxNextEps, spend, type BudgetState } from './lib/budget.ts'
import { inferSpecs, parseCsv, type ColSpec, type Dataset } from './lib/dataset.ts'
import { download } from './lib/download.ts'
import { reportCsv, reportJson, type Release } from './lib/report.ts'
import { execute, normalize, title, type QuerySpec } from './lib/run.ts'
import { SAMPLES } from './lib/samples.ts'
import { usePersistent } from './usePersistent.ts'

const FRESH_BUDGET: BudgetState = { totalEps: 2, delta: 1e-6, accounting: 'basic', ledger: [] }
const DEFAULT_QUERY: QuerySpec = { kind: 'mean', col: 'final', col2: 'section', cols: ['section', 'hours_per_week', 'passed'], cat: '', q: 0.5, eps: 0.3, mech: 'laplace', method: 'mwem', rounds: 10 }

interface DataState { source: Source; specs: ColSpec[] }
const initialData = (): DataState => ({ source: { kind: 'sample', id: 'grades' }, specs: SAMPLES[0].specs })

function load(source: Source): { ds: Dataset; specs: ColSpec[] } {
  if (source.kind === 'sample') {
    const s = SAMPLES.find((x) => x.id === source.id) ?? SAMPLES[0]
    return { ds: s.dataset, specs: s.specs }
  }
  const ds = parseCsv(source.text)!
  return { ds: { ...ds, name: source.name }, specs: inferSpecs(ds) }
}

export default function App() {
  const [tab, setTab] = useState<'explore' | 'learn'>('explore')
  const [data, setData] = usePersistent<DataState>('dp.data', initialData())
  const [budget, setBudget] = usePersistent<BudgetState>('dp.budget', FRESH_BUDGET)
  const [store, setStore] = usePersistent<{ releases: Release[] }>('dp.releases', { releases: [] })
  const [query, setQuery] = usePersistent<QuerySpec>('dp.query', DEFAULT_QUERY)
  const [preview, setPreview] = useState(false)
  const [truth, setTruth] = useState<Record<string, number[]>>({})
  const [error, setError] = useState('')
  const started = useRef(false)

  const { ds, specs } = useMemo(() => {
    try {
      const l = load(data.source)
      return { ds: l.ds, specs: data.specs.length === l.ds.columns.length ? data.specs : l.specs }
    } catch {
      const l = load(initialData().source)
      return { ds: l.ds, specs: l.specs }
    }
  }, [data])

  const eq = useMemo(() => {
    const n = normalize(query, ds, specs)
    return budget.accounting === 'zcdp' ? n : { ...n, mech: 'laplace' as const }
  }, [query, ds, specs, budget.accounting])

  /** Run queries one after another against one budget; returns the new state. */
  const runAll = (qs: QuerySpec[], b: BudgetState, rs: Release[]) => {
    const newTruth: Record<string, number[]> = {}
    for (const q of qs) {
      const out = execute(q, ds, specs)
      const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
      const t = title(q)
      b = spend(b, { id, label: t, ...costOf(out.parts, out.pure) })
      const { trueValues, ...rest } = out
      newTruth[id] = trueValues
      rs = [...rs, { ...rest, id, title: t, kind: q.kind, mech: q.mech, eps: q.eps, at: new Date().toISOString() }]
    }
    setTruth((t) => ({ ...t, ...newTruth }))
    setBudget(b)
    setStore({ releases: rs })
  }

  useEffect(() => {
    // First visit: release a few starter answers so the page shows something.
    if (started.current || localStorage.getItem('dp.started')) return
    started.current = true
    localStorage.setItem('dp.started', '1')
    if (budget.ledger.length || store.releases.length) return
    const base = { ...DEFAULT_QUERY, col2: '', cols: [] }
    runAll([
      { ...base, kind: 'mean', col: 'final', eps: 0.5 },
      { ...base, kind: 'histogram', col: 'section', eps: 0.2 },
      { ...base, kind: 'table', col: 'section', col2: 'passed', eps: 0.2 },
    ], budget, store.releases)
  }, [])

  const onRun = () => {
    setError('')
    try {
      runAll([{ ...eq }], budget, store.releases)
    } catch (e) {
      setError(e instanceof BudgetExceeded ? `Refused: ${e.message}. Lower ε or raise the total budget.` : e instanceof Error ? e.message : String(e))
    }
  }

  const reset = () => {
    setBudget(FRESH_BUDGET)
    setStore({ releases: [] })
    setTruth({})
    setError('')
  }

  const onSource = (source: Source) => {
    setData({ source, specs: load(source).specs })
    setError('')
  }

  const releases = store.releases
  const zc = budget.accounting === 'zcdp'

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>Differential Privacy Tool</h1>
          <p className="muted">Share statistics from a survey or class data without exposing individuals. Runs entirely in your browser.</p>
        </div>
        <nav role="tablist">
          <button role="tab" aria-selected={tab === 'explore'} className={tab === 'explore' ? 'on' : ''} onClick={() => setTab('explore')}>Explore</button>
          <button role="tab" aria-selected={tab === 'learn'} className={tab === 'learn' ? 'on' : ''} onClick={() => setTab('learn')}>Learn &amp; demo</button>
        </nav>
      </header>
      {tab === 'learn' ? (
        <Learn />
      ) : (
        <main className="layout">
          <div className="col">
            <DataPanel source={data.source} dataset={ds} specs={specs} onSource={onSource} />
            <BudgetPanel b={budget} setB={(f) => setBudget(f)} onReset={reset} />
          </div>
          <div className="col">
            <Builder
              q={eq}
              setQ={(f) => setQuery((prev) => f(normalize(prev, ds, specs)))}
              ds={ds}
              specs={specs}
              setSpec={(c, s) => setData((d) => ({ ...d, specs: specs.map((x, i) => (ds.columns[i] === c ? s : x)) }))}
              gaussianOk={zc}
              maxEps={maxNextEps(budget)}
              error={error}
              onRun={onRun}
            />
            <section className="card">
              <div className="results-head">
                <h2>Releases</h2>
                <label className="switch">
                  <input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} />
                  Analyst preview
                </label>
              </div>
              {preview && (
                <p className="warn" role="alert">
                  Analyst preview shows the exact answers next to the noisy ones. Those true values are <b>not private</b>: never copy them into a report. The export always contains the noisy numbers only.
                </p>
              )}
              {releases.length === 0 && <p className="muted">Nothing released yet. Ask a question on the left.</p>}
              {[...releases].reverse().map((r) => <ResultCard key={r.id} r={r} truth={truth[r.id]} preview={preview} />)}
              {releases.length > 0 && (
                <div className="row">
                  <button onClick={() => download('dp-release.json', reportJson(ds.name, budget, releases), 'application/json')}>Export release JSON</button>
                  <button onClick={() => download('dp-release.csv', reportCsv(releases), 'text/csv')}>Export release CSV</button>
                </div>
              )}
              {preview && Object.keys(truth).length === 0 && releases.length > 0 && <p className="muted">True values are kept in memory only; run a new query to see them after a reload.</p>}
            </section>
          </div>
        </main>
      )}
      <footer className="foot muted">
        Noise is drawn with crypto.getRandomValues using integer-valued discrete Laplace / Gaussian samplers (no floating-point Laplace). Neighbouring datasets differ by adding or removing one record.
      </footer>
    </div>
  )
}
