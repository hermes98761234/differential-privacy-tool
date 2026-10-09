// Privacy budget manager. Add/remove-one-record neighbouring datasets throughout.
//
// Two accountants:
//  - basic: eps values of pure-DP mechanisms simply add up.
//  - zcdp:  each mechanism is expressed as rho-zCDP (an eps-DP mechanism is
//    eps^2/2-zCDP, a Gaussian with sigma = Delta/eps is eps^2/2 too), rhos add up,
//    and the total converts to (eps, delta)-DP with
//    eps = rho + 2 sqrt(rho ln(1/delta))   (Bun & Steinke 2016, Prop. 1.3).

export type Accounting = 'basic' | 'zcdp'

export interface Spend {
  id: string
  label: string
  /** Sum of the eps of every component mechanism (the basic-composition cost). */
  eps: number
  /** Sum of eps_i^2 / 2 over components (the zCDP cost). */
  rho: number
  /** False if a Gaussian component is used: only valid under zCDP accounting. */
  pure: boolean
}

export interface BudgetState {
  totalEps: number
  delta: number
  accounting: Accounting
  ledger: Spend[]
}

export class BudgetExceeded extends Error {}

const SLACK = 1e-9

export function costOf(parts: number[], pure: boolean): Pick<Spend, 'eps' | 'rho' | 'pure'> {
  return {
    eps: parts.reduce((a, b) => a + b, 0),
    rho: parts.reduce((a, b) => a + (b * b) / 2, 0),
    pure,
  }
}

export function zcdpToEps(rho: number, delta: number): number {
  return rho + 2 * Math.sqrt(rho * Math.log(1 / delta))
}

/** Largest rho whose (eps, delta) conversion stays within totalEps. */
export function rhoBudget(totalEps: number, delta: number): number {
  const l = Math.log(1 / delta)
  return (Math.sqrt(l + totalEps) - Math.sqrt(l)) ** 2
}

export const spentEps = (b: BudgetState) => b.ledger.reduce((a, s) => a + (s.pure ? s.eps : Infinity), 0)
export const spentRho = (b: BudgetState) => b.ledger.reduce((a, s) => a + s.rho, 0)

/** Total eps guaranteed so far under the chosen accountant. */
export function epsSpent(b: BudgetState): number {
  return b.accounting === 'basic' ? spentEps(b) : zcdpToEps(spentRho(b), b.delta)
}

export function canSpend(b: BudgetState, cost: Pick<Spend, 'eps' | 'rho' | 'pure'>): boolean {
  if (b.accounting === 'basic') return cost.pure && spentEps(b) + cost.eps <= b.totalEps + SLACK
  return spentRho(b) + cost.rho <= rhoBudget(b.totalEps, b.delta) + SLACK
}

export function spend(b: BudgetState, entry: Spend): BudgetState {
  if (!canSpend(b, entry)) throw new BudgetExceeded(`"${entry.label}" would exceed the privacy budget`)
  return { ...b, ledger: [...b.ledger, entry] }
}

/** Largest eps a single-component query could still use. */
export function maxNextEps(b: BudgetState): number {
  if (b.accounting === 'basic') return Math.max(0, b.totalEps - spentEps(b))
  return Math.sqrt(2 * Math.max(0, rhoBudget(b.totalEps, b.delta) - spentRho(b)))
}

/** Fraction of the budget used, 0..1. */
export function fractionUsed(b: BudgetState): number {
  const f = b.accounting === 'basic' ? spentEps(b) / b.totalEps : spentRho(b) / rhoBudget(b.totalEps, b.delta)
  return Math.min(1, f)
}
