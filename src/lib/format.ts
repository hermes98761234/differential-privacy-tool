export const fmt = (x: number, digits = 3): string => {
  if (!Number.isFinite(x)) return '–'
  const a = Math.abs(x)
  if (a !== 0 && (a >= 1e6 || a < 0.001)) return x.toExponential(2)
  return String(Number(x.toPrecision(digits)))
}
