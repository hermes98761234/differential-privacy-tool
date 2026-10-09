// Randomized response with a forced-answer coin: with probability p the respondent
// tells the truth, otherwise they answer yes/no by a fair coin. The classroom version
// is p = 1/2 (flip once: heads = truth; tails = flip again and say that).

import { bernoulli } from './rng.ts'

/** eps of the mechanism: ln(P(yes|yes) / P(yes|no)). p = 1/2 gives ln 3. */
export const rrEpsilon = (p: number) => Math.log((1 + p) / (1 - p))

export function rrRespond(truth: boolean, p: number): boolean {
  return bernoulli(p) ? truth : bernoulli(0.5)
}

/** P(report yes) when a share pi of people truly say yes. */
export const rrYesProb = (pi: number, p: number) => p * pi + (1 - p) / 2

/** Unbiased estimate of pi from the observed yes fraction f: E[f] = p pi + (1 - p)/2. */
export const rrEstimate = (f: number, p: number) => (f - (1 - p) / 2) / p

/** Standard deviation of the estimate for n respondents when the true share is pi. */
export function rrSd(pi: number, n: number, p: number): number {
  const q = rrYesProb(pi, p)
  return Math.sqrt((q * (1 - q)) / n) / p
}
