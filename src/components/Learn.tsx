import { fmt } from '../lib/format.ts'
import { useMemo, useState } from 'react'
import { rrEpsilon, rrEstimate, rrRespond, rrSd } from '../lib/rr.ts'
import { bernoulli } from '../lib/rng.ts'


function Coin() {
  const [secret, setSecret] = useState(true)
  const [flips, setFlips] = useState<string[] | null>(null)
  const flip = () => {
    const first = bernoulli(0.5)
    setFlips(first ? ['Heads'] : ['Tails', bernoulli(0.5) ? 'Heads' : 'Tails'])
  }
  const reported = flips ? (flips[0] === 'Heads' ? secret : flips[1] === 'Heads') : null
  return (
    <div className="card">
      <h3>Flip the coins yourself</h3>
      <p>Imagine the question is a sensitive one. Your true answer is:</p>
      <div className="row">
        <label><input type="radio" checked={secret} onChange={() => { setSecret(true); setFlips(null) }} /> Yes</label>
        <label><input type="radio" checked={!secret} onChange={() => { setSecret(false); setFlips(null) }} /> No</label>
        <button onClick={flip}>Flip</button>
      </div>
      {flips && (
        <p>
          First coin: <b>{flips[0]}</b>.{' '}
          {flips[0] === 'Heads' ? 'Heads means tell the truth.' : <>Tails means answer by a second flip: <b>{flips[1]}</b> means “{flips[1] === 'Heads' ? 'Yes' : 'No'}”.</>}{' '}
          You report <b>{reported ? 'Yes' : 'No'}</b>. Nobody, including the teacher, can tell whether that was your real answer.
        </p>
      )}
    </div>
  )
}

function Classroom() {
  const [n, setN] = useState(200)
  const [pi, setPi] = useState(0.3)
  const [p, setP] = useState(0.5)
  const [again, setAgain] = useState(0)
  const out = useMemo(() => {
    void again
    const yesPeople = Math.round(pi * n)
    let yes = 0
    for (let i = 0; i < n; i++) if (rrRespond(i < yesPeople, p)) yes++
    const f = yes / n
    return { yes, est: rrEstimate(f, p), sd: rrSd(pi, n, p), shown: yesPeople / n }
  }, [n, pi, p, again])
  const lo = out.est - 1.96 * out.sd
  const hi = out.est + 1.96 * out.sd
  return (
    <div className="card">
      <h3>Run a whole class</h3>
      <div className="form-grid">
        <label>Students: {n}<input type="range" min="20" max="5000" step="10" value={n} onChange={(e) => setN(+e.target.value)} /></label>
        <label>Who really answer yes: {Math.round(pi * 100)}%<input type="range" min="0" max="100" value={pi * 100} onChange={(e) => setPi(+e.target.value / 100)} /></label>
        <label>Chance to tell the truth: {Math.round(p * 100)}%<input type="range" min="10" max="95" value={p * 100} onChange={(e) => setP(+e.target.value / 100)} /></label>
      </div>
      <p>
        {out.yes} of {n} said “yes” ({fmt((out.yes / n) * 100, 3)}%). Undoing the coins gives an estimate of{' '}
        <b>{fmt(out.est * 100, 3)}%</b> (95% interval {fmt(Math.max(0, lo) * 100, 3)}–{fmt(Math.min(1, hi) * 100, 3)}%), against a true{' '}
        {fmt(out.shown * 100, 3)}%.
      </p>
      <div className="meter" aria-hidden="true">
        <span className="meter-ci" style={{ left: `${Math.max(0, lo) * 100}%`, width: `${(Math.min(1, hi) - Math.max(0, lo)) * 100}%` }} />
        <span className="meter-est" style={{ left: `${Math.min(1, Math.max(0, out.est)) * 100}%` }} />
        <span className="meter-true" style={{ left: `${out.shown * 100}%` }} />
      </div>
      <p className="muted">
        Privacy level: ε = ln((1+p)/(1−p)) = {fmt(rrEpsilon(p))}{p === 0.5 ? ' (= ln 3, the classic two-coin survey)' : ''}. Raise the truth chance and the estimate sharpens, but individuals are protected less.
      </p>
      <button onClick={() => setAgain(again + 1)}>Run again</button>
    </div>
  )
}

export default function Learn() {
  return (
    <div className="learn">
      <section className="card">
        <h2>Differential privacy in plain language</h2>
        <p>
          Publishing exact statistics can leak facts about individuals: “the average salary of the 3 people in this team”, or the same count published before and after one person leaves. Differential privacy (DP) fixes this by adding carefully sized random noise, so the published answer would look almost the same whether or not any single person's record was in the data.
        </p>
        <ul>
          <li><b>ε (epsilon)</b> is the privacy loss. Small ε means more noise and stronger protection; any one person can change the odds of any outcome by at most a factor e<sup>ε</sup>.</li>
          <li><b>Sensitivity</b> is how much one person can change the answer. Counts change by 1. For sums and means we <b>clamp</b> every value into bounds you choose, so one extreme value cannot move the answer by more than the range.</li>
          <li><b>Noise is calibrated</b> to sensitivity ÷ ε. More data means the same noise matters less: a count of 10,000 barely notices ±5.</li>
          <li><b>The budget</b> is finite. Every answer you release spends some ε, and the spends add up (basic composition) or add up more cheaply through zCDP. When it is gone the tool refuses to answer.</li>
          <li><b>Post-processing is free.</b> Rounding, clamping at zero, or building a synthetic dataset from noisy numbers costs no extra privacy.</li>
        </ul>
        <h3>What this tool protects, and what it does not</h3>
        <ul>
          <li>It protects against what a reader of the <i>release</i> (the noisy export) can learn about one record. Analyst preview shows true values and is not private; use it only on data you already hold.</li>
          <li>The domain (category lists, clamping bounds) must come from public knowledge. Inferring it from a CSV leaks a little, so check it before you rely on it.</li>
          <li>The number of rows is treated as public for planning charts only; released means use a noisy count.</li>
          <li>It protects individuals' records, not groups. A strong effect in the whole class is still visible, by design.</li>
        </ul>
      </section>
      <section>
        <h2>Classroom demo: the coin-flip survey</h2>
        <p>
          To ask “have you cheated on a test?” without learning anyone's answer: each student flips a coin privately. <b>Heads</b>: answer truthfully. <b>Tails</b>: flip again and answer “yes” for heads, “no” for tails. A “yes” on your paper is explained by chance, so it proves nothing about you, yet the class share can still be recovered:
          P(yes) = ½·share + ¼, so <b>share = 2·(observed yes) − ½</b>, an unbiased estimate.
        </p>
        <div className="two-col">
          <Coin />
          <Classroom />
        </div>
      </section>
    </div>
  )
}
