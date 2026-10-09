import { fmt } from '../lib/format.ts'
import { binLabels, domainSize, type ColSpec, type Dataset } from '../lib/dataset.ts'
import { KIND_LABEL, SYNTH_LIMIT, plan, synthDomain, type Kind, type QuerySpec } from '../lib/run.ts'
import { NoiseChart, TradeoffChart } from './charts.tsx'
import NumField from './NumField.tsx'

interface Props {
  q: QuerySpec
  setQ: (f: (q: QuerySpec) => QuerySpec) => void
  ds: Dataset
  specs: ColSpec[]
  setSpec: (col: string, s: ColSpec) => void
  gaussianOk: boolean
  maxEps: number
  error: string
  onRun: () => void
}

function DomainEditor({ name, spec, onChange, binsToo }: { name: string; spec: ColSpec; onChange: (s: ColSpec) => void; binsToo: boolean }) {
  return (
    <div className="domain">
      <b>{name}</b>
      <select aria-label={`${name} type`} value={spec.kind} onChange={(e) => onChange(e.target.value === 'num'
        ? { kind: 'num', lo: 0, hi: 10, bins: 5 }
        : { kind: 'cat', categories: [] })}>
        <option value="num">numeric</option>
        <option value="cat">categorical</option>
      </select>
      {spec.kind === 'num' ? (
        <>
          <label>clamp to<NumField label={`${name} lower bound`} value={spec.lo} onChange={(lo) => onChange({ ...spec, lo })} /></label>
          <label>–<NumField label={`${name} upper bound`} value={spec.hi} onChange={(hi) => onChange({ ...spec, hi })} /></label>
          {binsToo && <label>bins<NumField label={`${name} bins`} value={spec.bins} min={1} max={50} step={1} onChange={(bins) => onChange({ ...spec, bins: Math.min(50, Math.max(1, Math.round(bins))) })} /></label>}
          {spec.hi <= spec.lo && <span className="err">upper bound must exceed lower</span>}
        </>
      ) : (
        <label className="wide">categories (comma separated)
          <input value={spec.categories.join(', ')} onChange={(e) => onChange({ kind: 'cat', categories: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
        </label>
      )}
    </div>
  )
}

export default function Builder({ q, setQ, ds, specs, setSpec, gaussianOk, maxEps, error, onRun }: Props) {
  const specOf = (c: string) => specs[ds.columns.indexOf(c)]
  const numeric = ds.columns.filter((_, i) => specs[i].kind === 'num')
  const usable = ds.columns.filter((_, i) => domainSize(specs[i]) > 0)
  const set = (p: Partial<QuerySpec>) => setQ((s) => ({ ...s, ...p }))
  const mechOk = q.kind !== 'quantile' && q.kind !== 'synth'
  const colList = q.kind === 'sum' || q.kind === 'mean' || q.kind === 'quantile' ? numeric : q.kind === 'count' ? ds.columns : usable
  const p = plan(q, ds, specs)
  const sp = specOf(q.col)
  const dom = q.kind === 'synth' ? synthDomain(q.cols, ds, specs) : 0
  const ed = (c: string, bins: boolean) => specOf(c) && <DomainEditor key={c} name={c} spec={specOf(c)} binsToo={bins} onChange={(s) => setSpec(c, s)} />
  const logEps = Math.log10(q.eps)
  const exhausted = maxEps <= 1e-9
  return (
    <section className="card">
      <h2>Ask a question</h2>
      <div className="form-grid">
        <label>
          Query
          <select value={q.kind} onChange={(e) => set({ kind: e.target.value as Kind })}>
            {(Object.keys(KIND_LABEL) as Kind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </label>
        {q.kind !== 'synth' && (
          <label>
            Column
            <select value={q.col} onChange={(e) => set({ col: e.target.value })}>
              {colList.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
        )}
        {q.kind === 'table' && (
          <label>
            Second column
            <select value={q.col2} onChange={(e) => set({ col2: e.target.value })}>
              {usable.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
        )}
        {q.kind === 'count' && sp?.kind === 'cat' && (
          <label>
            Where equal to
            <select value={q.cat} onChange={(e) => set({ cat: e.target.value })}>
              <option value="">(any value)</option>
              {sp.categories.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
        )}
        {q.kind === 'count' && sp?.kind === 'num' && (
          <label>At least<input type="number" placeholder="(any)" value={q.cat} onChange={(e) => set({ cat: e.target.value })} /></label>
        )}
        {q.kind === 'quantile' && (
          <label>
            Quantile
            <select value={q.q} onChange={(e) => set({ q: Number(e.target.value) })}>
              {[0.1, 0.25, 0.5, 0.75, 0.9].map((v) => <option key={v} value={v}>{v === 0.5 ? 'median' : `${v * 100}th percentile`}</option>)}
            </select>
          </label>
        )}
        {mechOk && (
          <label>
            Mechanism
            <select value={gaussianOk ? q.mech : 'laplace'} onChange={(e) => set({ mech: e.target.value as 'laplace' | 'gaussian' })}>
              <option value="laplace">Discrete Laplace (ε-DP)</option>
              <option value="gaussian" disabled={!gaussianOk}>Discrete Gaussian (zCDP){gaussianOk ? '' : ' – needs zCDP accounting'}</option>
            </select>
          </label>
        )}
        {q.kind === 'synth' && (
          <>
            <label>
              Method
              <select value={q.method} onChange={(e) => set({ method: e.target.value as 'mwem' | 'independent' })}>
                <option value="mwem">MWEM (2-way marginals)</option>
                <option value="independent">Independent marginals</option>
              </select>
            </label>
            {q.method === 'mwem' && <label>Rounds<NumField value={q.rounds} min={1} max={40} step={1} onChange={(v) => set({ rounds: Math.min(40, Math.max(1, Math.round(v))) })} /></label>}
          </>
        )}
      </div>

      {q.kind === 'synth' && (
        <div className="chips" role="group" aria-label="Columns to synthesize">
          {usable.map((c) => (
            <label key={c} className={`chip ${q.cols.includes(c) ? 'on' : ''}`}>
              <input type="checkbox" checked={q.cols.includes(c)} onChange={(e) => set({ cols: e.target.checked ? [...q.cols, c] : q.cols.filter((x) => x !== c) })} />
              {c}
            </label>
          ))}
        </div>
      )}
      {q.kind === 'synth' && (dom > SYNTH_LIMIT || q.cols.length === 0) && <p className="err">{q.cols.length ? `The domain has ${dom} cells; the limit is ${SYNTH_LIMIT}. Pick fewer columns or fewer bins.` : 'Pick at least one column.'}</p>}

      <div className="domains">
        {(q.kind === 'sum' || q.kind === 'mean' || q.kind === 'quantile') && sp && ed(q.col, false)}
        {q.kind === 'histogram' && sp && ed(q.col, true)}
        {q.kind === 'table' && <>{ed(q.col, true)}{ed(q.col2, true)}</>}
        {q.kind === 'synth' && q.cols.map((c) => ed(c, true))}
      </div>
      {(q.kind === 'sum' || q.kind === 'mean') && sp?.kind === 'num' && (
        <p className="muted">
          Every value is clamped into [{fmt(sp.lo)}, {fmt(sp.hi)}] first, so one person moves the {q.kind === 'sum' ? `sum by at most ${fmt(Math.max(Math.abs(sp.lo), Math.abs(sp.hi)))}` : `noisy sum by at most ${fmt(sp.hi - sp.lo)} (the range), and the count by 1`}.
        </p>
      )}
      {q.kind === 'histogram' && sp && <p className="muted">{binLabels(sp).length} bins: a person is in one bin, so the whole histogram costs a single ε.</p>}

      <label className="eps-slider">
        <span>ε for this query: <b>{fmt(q.eps)}</b> <small className="muted">(privacy cost; lower = more private, noisier)</small></span>
        <input type="range" min="-2" max="1" step="0.01" value={logEps} onChange={(e) => set({ eps: Number((10 ** Number(e.target.value)).toPrecision(2)) })} aria-label="Epsilon for this query" />
        <span className="scale"><span>0.01 private</span><span>0.1</span><span>1</span><span>10 accurate</span></span>
      </label>

      {p ? (
        <div className="plan">
          <div>
            <h3>Noise you will add</h3>
            {p.model ? <NoiseChart model={p.model} mult={p.mult} ciHalf={p.ciHalf} unit={p.unit} /> : <p className="muted">The exponential mechanism picks an output with probability falling off exponentially in its rank error.</p>}
            <p className="muted">95% of the time the noise is within <b>±{fmt(p.ciHalf)}</b> {p.unit}{Number.isFinite(p.sd) ? ` (sd ${fmt(p.sd)})` : ''}.</p>
          </div>
          <div>
            <h3>Accuracy vs privacy</h3>
            <TradeoffChart curve={p.curve} eps={q.eps} unit={p.unit} />
            <p className="muted">Ten times the ε buys about ten times less noise.</p>
          </div>
        </div>
      ) : q.kind === 'synth' ? (
        <p className="muted">Synthetic rows are post-processing of noisy marginals. Each marginal cell gets about ±{fmt(Math.ceil(Math.log(20) / (q.eps * 0.9 / (q.method === 'mwem' ? q.rounds * 2 : Math.max(1, q.cols.length)))))} records of noise; more columns or rounds share the same ε and so add noise.</p>
      ) : null}

      <div className="row">
        <button className="primary" onClick={onRun} disabled={exhausted || (q.kind === 'synth' && (dom > SYNTH_LIMIT || q.cols.length === 0))}>
          {exhausted ? 'Budget exhausted' : `Release with ε = ${fmt(q.eps)}`}
        </button>
        <span className="muted">Remaining ε: {fmt(maxEps)}</span>
      </div>
      {error && <p className="err" role="alert">{error}</p>}
    </section>
  )
}
