import { useState } from 'react'
import { parseCsv, type ColSpec, type Dataset } from '../lib/dataset.ts'
import { SAMPLES } from '../lib/samples.ts'

export type Source = { kind: 'sample'; id: string } | { kind: 'csv'; name: string; text: string }

interface Props {
  source: Source
  dataset: Dataset
  specs: ColSpec[]
  onSource: (s: Source) => void
}

export default function DataPanel({ source, dataset, onSource }: Props) {
  const [text, setText] = useState('')
  const [err, setErr] = useState('')
  const load = (t: string, name: string) => {
    const ds = parseCsv(t)
    if (!ds || ds.rows.length === 0) return setErr('Could not read that: need a header row and at least one data row.')
    if (ds.rows.length > 50000) return setErr('That file has more than 50,000 rows; trim it first.')
    setErr('')
    onSource({ kind: 'csv', name, text: t })
  }
  return (
    <section className="card">
      <h2>Data</h2>
      <div className="chips">
        {SAMPLES.map((s) => (
          <button key={s.id} className={source.kind === 'sample' && source.id === s.id ? 'on' : ''} onClick={() => onSource({ kind: 'sample', id: s.id })} title={s.blurb}>
            {s.title}
          </button>
        ))}
      </div>
      <p className="muted">
        {source.kind === 'sample' ? SAMPLES.find((s) => s.id === source.id)?.blurb + ' Synthetic, generated in your browser.' : `${source.name}: ${dataset.rows.length} rows, ${dataset.columns.length} columns.`}
      </p>
      <div className="row">
        <label className="file">
          Load CSV…
          <input type="file" accept=".csv,text/csv,text/plain" onChange={async (e) => {
            const f = e.target.files?.[0]
            if (f) load(await f.text(), f.name)
            e.target.value = ''
          }} />
        </label>
        <details>
          <summary>or paste</summary>
          <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={'age,smoker\n34,yes\n51,no'} />
          <button className="small" onClick={() => load(text, 'Pasted CSV')}>Use pasted data</button>
        </details>
      </div>
      {err && <p className="err">{err}</p>}
      {source.kind === 'csv' && (
        <p className="warn">
          Domains (bounds, categories) were guessed from this file. In a real release declare them from public knowledge, since guessing them from the data leaks a little. Edit them in the query builder.
        </p>
      )}
      <p className="muted">Your data never leaves this page.</p>
      <div className="scroll">
        <table className="mini">
          <thead><tr>{dataset.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>
            {dataset.rows.slice(0, 4).map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j}>{v}</td>)}</tr>)}
          </tbody>
        </table>
      </div>
    </section>
  )
}
