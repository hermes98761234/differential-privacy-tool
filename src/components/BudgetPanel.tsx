import { fmt } from '../lib/format.ts'
import { epsSpent, fractionUsed, rhoBudget, spentEps, spentRho, zcdpToEps, type Accounting, type BudgetState } from '../lib/budget.ts'

import NumField from './NumField.tsx'

interface Props {
  b: BudgetState
  setB: (f: (b: BudgetState) => BudgetState) => void
  onReset: () => void
}

export default function BudgetPanel({ b, setB, onReset }: Props) {
  const frac = fractionUsed(b)
  const impure = b.ledger.some((s) => !s.pure)
  const rho = spentRho(b)
  return (
    <section className="card">
      <h2>Privacy budget</h2>
      <div className="form-grid">
        <label>Total ε<NumField value={b.totalEps} min={0.01} step={0.1} label="Total epsilon" onChange={(v) => v > 0 && setB((s) => ({ ...s, totalEps: v }))} /></label>
        <label>
          δ
          <select value={b.delta} onChange={(e) => setB((s) => ({ ...s, delta: Number(e.target.value) }))}>
            {[1e-4, 1e-5, 1e-6, 1e-8].map((d) => <option key={d} value={d}>{d.toExponential(0)}</option>)}
          </select>
        </label>
        <label>
          Accounting
          <select value={b.accounting} onChange={(e) => setB((s) => ({ ...s, accounting: e.target.value as Accounting }))}>
            <option value="basic" disabled={impure}>Basic (Σ ε, pure DP)</option>
            <option value="zcdp">zCDP (Σ ρ → ε, δ)</option>
          </select>
        </label>
      </div>
      <div className={`gauge ${frac >= 1 ? 'full' : ''}`} role="progressbar" aria-valuenow={Math.round(frac * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Budget used">
        <span style={{ width: `${frac * 100}%` }} />
      </div>
      <p>
        <b>ε spent: {fmt(epsSpent(b))}</b> of {fmt(b.totalEps)} ({Math.round(frac * 100)}%)
        {frac >= 0.999 && <span className="err"> Budget exhausted: new queries are refused.</span>}
      </p>
      <p className="muted">
        {b.accounting === 'basic'
          ? `Basic: every query's ε adds up. Under zCDP the same queries would cost ε ≈ ${fmt(zcdpToEps(rho, b.delta))} (ρ = ${fmt(rho)}, ρ budget ${fmt(rhoBudget(b.totalEps, b.delta))}).`
          : `zCDP: ρ adds up (${fmt(rho)} of ${fmt(rhoBudget(b.totalEps, b.delta))}) and converts to ε = ρ + 2√(ρ ln 1/δ). Basic composition would say ε = ${fmt(spentEps(b))}.`}
      </p>
      {b.ledger.length > 0 && (
        <ol className="ledger">
          {b.ledger.map((s) => (
            <li key={s.id}><span>{s.label}</span><span>ε {fmt(s.eps)}{s.pure ? '' : ' · ρ'}</span></li>
          ))}
        </ol>
      )}
      <button className="small danger" onClick={() => confirm('Reset the budget and clear all releases? In real use, resetting defeats the purpose of the budget.') && onReset()}>
        Reset (demo only)
      </button>
    </section>
  )
}
