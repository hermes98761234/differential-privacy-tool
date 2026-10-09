import type { NoiseModel } from '../lib/mech.ts'
import { fmt } from '../lib/format.ts'

const W = 320
const H = 120
const PAD = { l: 8, r: 8, t: 8, b: 22 }

/** Probability mass of the noise, with the 95% interval shaded. */
export function NoiseChart({ model, mult, ciHalf, unit }: { model: NoiseModel; mult: number; ciHalf: number; unit: string }) {
  const ciK = Math.max(0, Math.round(ciHalf / mult))
  const K = Math.max(4, Math.ceil(ciK * 1.7))
  const step = Math.max(1, Math.floor(K / 120))
  const ks: number[] = []
  for (let k = -K; k <= K; k += step) ks.push(k)
  const peak = model.pmf(0)
  const x = (k: number) => PAD.l + ((k + K) / (2 * K)) * (W - PAD.l - PAD.r)
  const y = (p: number) => H - PAD.b - (p / peak) * (H - PAD.b - PAD.t)
  const path = ks.map((k, i) => `${i ? 'L' : 'M'}${x(k).toFixed(1)} ${y(model.pmf(k)).toFixed(1)}`).join(' ')
  const area = `${path} L${x(ks[ks.length - 1])} ${y(0)} L${x(ks[0])} ${y(0)} Z`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={`Noise distribution, 95% of the noise lies within plus or minus ${fmt(ciHalf)} ${unit}`}>
      <rect x={x(-ciK)} y={PAD.t} width={Math.max(1, x(ciK) - x(-ciK))} height={H - PAD.b - PAD.t} className="ci-band" />
      <path d={area} className="noise-area" />
      <path d={path} className="noise-line" fill="none" />
      <line x1={x(0)} x2={x(0)} y1={PAD.t} y2={H - PAD.b} className="axis" />
      <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} className="axis" />
      <text x={x(-ciK)} y={H - 8} className="tick" textAnchor="middle">−{fmt(ciHalf)}</text>
      <text x={x(0)} y={H - 8} className="tick" textAnchor="middle">0</text>
      <text x={x(ciK)} y={H - 8} className="tick" textAnchor="middle">+{fmt(ciHalf)}</text>
    </svg>
  )
}

/** 95% error against eps on log-log axes, with the current eps marked. */
export function TradeoffChart({ curve, eps, unit }: { curve: (eps: number) => number; eps: number; unit: string }) {
  const lo = Math.log10(0.01)
  const hi = Math.log10(10)
  const pts = Array.from({ length: 61 }, (_, i) => {
    const e = 10 ** (lo + ((hi - lo) * i) / 60)
    return { e, v: Math.max(curve(e), 1e-9) }
  })
  const ys = pts.map((p) => Math.log10(p.v))
  const y0 = Math.min(...ys)
  const y1 = Math.max(...ys, y0 + 0.5)
  const x = (e: number) => PAD.l + 14 + ((Math.log10(e) - lo) / (hi - lo)) * (W - PAD.l - PAD.r - 28)
  const y = (v: number) => H - PAD.b - ((Math.log10(Math.max(v, 1e-9)) - y0) / (y1 - y0)) * (H - PAD.b - PAD.t)
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.e).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ')
  const cur = curve(eps)
  const ex = Math.min(10, Math.max(0.01, eps))
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={`Error versus epsilon. At epsilon ${fmt(eps)} the 95% error is ${fmt(cur)} ${unit}`}>
      {[0.01, 0.1, 1, 10].map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={PAD.t} y2={H - PAD.b} className="grid" />
          <text x={x(t)} y={H - 8} className="tick" textAnchor="middle">{t}</text>
        </g>
      ))}
      <path d={path} className="noise-line" fill="none" />
      <circle cx={x(ex)} cy={y(cur)} r="4.5" className="marker" />
      <text x={Math.min(x(ex) + 8, W - 60)} y={Math.max(y(cur) - 8, 14)} className="tick">±{fmt(cur)}</text>
      <text x={W - PAD.r} y={12} className="tick" textAnchor="end">95% error vs ε</text>
    </svg>
  )
}
