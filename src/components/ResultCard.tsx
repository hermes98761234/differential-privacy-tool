import { fmt } from '../lib/format.ts'
import { toCsv } from '../lib/dataset.ts'
import type { Release } from '../lib/report.ts'

import { download } from '../lib/download.ts'

interface Props {
  r: Release
  truth?: number[]
  preview: boolean
}

const pm = (r: Release) => (Number.isFinite(r.ciHalf) ? ` ± ${fmt(r.ciHalf)}` : '')

export default function ResultCard({ r, truth, preview }: Props) {
  const showTruth = preview && truth && truth.length > 0
  const max = Math.max(1, ...r.values, ...(showTruth ? truth : []))
  return (
    <article className="result">
      <header>
        <h4>{r.title}</h4>
        <span className="tag">{r.mech === 'gaussian' ? 'Gaussian' : r.kind === 'quantile' ? 'exponential' : 'Laplace'} · ε {fmt(r.eps)}</span>
      </header>
      {r.synthetic ? (
        <>
          <table className="mini">
            <thead><tr>{r.synthetic.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>
              {r.synthetic.rows.slice(0, 6).map((row, i) => <tr key={i}>{row.map((v, j) => <td key={j}>{v}</td>)}</tr>)}
            </tbody>
          </table>
          <p className="muted">
            {r.synthetic.rows.length} rows.{' '}
            <button className="small" onClick={() => download(`synthetic-${r.id}.csv`, toCsv([r.synthetic!.columns, ...r.synthetic!.rows]), 'text/csv')}>Download CSV</button>
            {showTruth && <> Analyst preview: average 2-way marginal error {fmt(truth[0] * 100)}%.</>}
          </p>
        </>
      ) : r.shape ? (
        <div className="scroll">
          <table className="mini grid-table">
            <tbody>
              {Array.from({ length: r.shape[0] }, (_, i) => (
                <tr key={i}>
                  <th>{r.labels[i * r.shape![1]].split(' × ')[0]}</th>
                  {Array.from({ length: r.shape![1] }, (_, j) => {
                    const k = i * r.shape![1] + j
                    return (
                      <td key={j} style={{ background: `color-mix(in srgb, var(--accent) ${Math.round((r.values[k] / max) * 55)}%, transparent)` }}>
                        {fmt(r.values[k])}
                        {showTruth && <small className="true"> ({fmt(truth[k])})</small>}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
            <thead>
              <tr><th />{r.labels.slice(0, r.shape[1]).map((l) => <th key={l}>{l.split(' × ')[1]}</th>)}</tr>
            </thead>
          </table>
        </div>
      ) : r.values.length > 1 ? (
        <ul className="bars">
          {r.values.map((v, i) => (
            <li key={i}>
              <span className="lab">{r.labels[i]}</span>
              <span className="track">
                <span className="bar" style={{ width: `${(v / max) * 100}%` }} />
                {showTruth && <span className="truth-mark" style={{ left: `${(truth[i] / max) * 100}%` }} />}
              </span>
              <span className="val">{fmt(v)}{showTruth && <small className="true"> ({fmt(truth[i])})</small>}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="big">
          {fmt(r.values[0], 4)}<span className="muted">{pm(r)}</span>
          {showTruth && <small className="true"> true {fmt(truth[0], 4)}</small>}
        </p>
      )}
      {r.note && <p className="muted">{r.note}</p>}
      {!r.synthetic && Number.isFinite(r.ciHalf) && <p className="muted">± is an approximate 95% interval from the noise alone (sd {fmt(r.sd)}).</p>}
    </article>
  )
}
