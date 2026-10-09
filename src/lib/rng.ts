// Secure randomness and exact-ish samplers for integer-valued noise.
//
// Everything here draws bits from crypto.getRandomValues, never Math.random.
// Noise is integer valued (discrete Laplace / discrete Gaussian), sampled with the
// algorithms of Canonne, Kamath & Steinke, "The Discrete Gaussian for Differential
// Privacy" (NeurIPS 2020). They need only coin flips with probability exp(-gamma),
// so no log() or exp() of a random number is ever taken. That avoids the
// floating-point attack on the textbook continuous Laplace sampler (Mironov, CCS 2012).

const TWO32 = 2 ** 32

// crypto.getRandomValues is called per refill of a pool, which is much faster than per draw.
const pool = new Uint32Array(2048)
let poolPos = pool.length

export function randomUint32(): number {
  if (poolPos === pool.length) {
    crypto.getRandomValues(pool)
    poolPos = 0
  }
  return pool[poolPos++]
}

/** Uniform in [0, 1) with 53 random bits. */
export function uniform(): number {
  return ((randomUint32() >>> 5) * 2 ** 26 + (randomUint32() >>> 6)) / 2 ** 53
}

/** Uniform integer in [0, n) by rejection sampling, so there is no modulo bias. */
export function randBelow(n: number): number {
  if (!Number.isInteger(n) || n < 1 || n > TWO32) throw new RangeError(`randBelow: bad bound ${n}`)
  const limit = TWO32 - (TWO32 % n)
  for (;;) {
    const r = randomUint32()
    if (r < limit) return r % n
  }
}

export function bernoulli(p: number): boolean {
  return uniform() < p
}

/** Bernoulli(exp(-gamma)) for gamma >= 0, without evaluating exp (CKS Algorithm 1). */
export function bernoulliExp(gamma: number): boolean {
  while (gamma > 1) {
    if (!bernoulliExp01(1)) return false
    gamma -= 1
  }
  return bernoulliExp01(gamma)
}

function bernoulliExp01(gamma: number): boolean {
  let k = 1
  while (bernoulli(gamma / k)) k++
  return k % 2 === 1
}

/** G >= 0 with P(G = k) proportional to exp(-k / b). Expected O(1) coin flips. */
export function geometricExp(b: number): number {
  const t = Math.max(1, Math.ceil(b))
  let u: number
  do u = randBelow(t)
  while (!bernoulliExp(u / b))
  let v = 0
  while (bernoulliExp(t / b)) v++
  return u + t * v
}

/** Two-sided geometric: P(X = k) proportional to exp(-|k| / b). */
export function discreteLaplace(b: number): number {
  if (!(b > 0)) return 0
  for (;;) {
    const negative = bernoulli(0.5)
    const y = geometricExp(b)
    if (negative && y === 0) continue
    return negative ? -y : y
  }
}

/** Discrete Gaussian: P(X = k) proportional to exp(-k^2 / (2 sigma^2)) (CKS Algorithm 3). */
export function discreteGaussian(sigma: number): number {
  if (!(sigma > 0)) return 0
  const t = Math.floor(sigma) + 1
  const s2 = sigma * sigma
  for (;;) {
    const y = discreteLaplace(t)
    const d = Math.abs(y) - s2 / t
    if (bernoulliExp((d * d) / (2 * s2))) return y
  }
}
