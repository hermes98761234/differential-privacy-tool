import { epsSpent, type BudgetState } from './budget.ts'
import { toCsv } from './dataset.ts'
import type { Mechanism } from './mech.ts'
import type { Kind, RunOutput } from './run.ts'

/** A released result. It deliberately has no field for the true answer. */
export interface Release extends Omit<RunOutput, 'trueValues'> {
  id: string
  title: string
  kind: Kind
  mech: Mechanism
  eps: number
  at: string
}

const clean = (r: Release) => ({
  title: r.title,
  kind: r.kind,
  mechanism: r.kind === 'quantile' ? 'exponential' : r.kind === 'synth' ? 'laplace + exponential' : r.mech,
  epsilon_cost: r.eps,
  epsilon_components: r.parts,
  labels: r.labels,
  values: r.values,
  noise_sd: Number.isFinite(r.sd) ? r.sd : null,
  ci95_half_width: Number.isFinite(r.ciHalf) ? r.ciHalf : null,
  synthetic_rows: r.synthetic?.rows.length,
  note: r.note,
})

export function reportJson(dataset: string, b: BudgetState, rs: Release[]): string {
  return JSON.stringify(
    {
      tool: 'differential-privacy-tool',
      note: 'Contains only noisy results and parameters; no true values.',
      dataset,
      neighbouring: 'add/remove one record',
      budget: { total_epsilon: b.totalEps, delta: b.delta, accounting: b.accounting, epsilon_spent: epsSpent(b) },
      releases: rs.map(clean),
    },
    null,
    2,
  )
}

export function reportCsv(rs: Release[]): string {
  const rows: (string | number)[][] = [['query', 'label', 'noisy_value', 'noise_sd', 'ci95_half_width', 'mechanism', 'epsilon']]
  for (const r of rs) {
    const mech = r.kind === 'quantile' ? 'exponential' : r.mech
    r.values.forEach((v, i) => rows.push([r.title, r.labels[i], v, Number.isFinite(r.sd) ? r.sd : '', Number.isFinite(r.ciHalf) ? r.ciHalf : '', mech, r.eps]))
  }
  return toCsv(rows)
}
