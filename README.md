# Differential Privacy Tool

Share statistics from a survey or class data without exposing individuals. Load a CSV (or pick a synthetic sample), set a privacy budget, and release noisy counts, sums, means, medians, histograms, contingency tables and even synthetic datasets. Every answer shows its noise distribution and expected error, the budget refuses queries once it is spent, and the export contains only noisy numbers. Everything runs in your browser.

**Try it: [hermes98761234.github.io/differential-privacy-tool](https://hermes98761234.github.io/differential-privacy-tool/)**

[![Deploy to GitHub Pages](https://github.com/hermes98761234/differential-privacy-tool/actions/workflows/deploy.yml/badge.svg)](https://github.com/hermes98761234/differential-privacy-tool/actions/workflows/deploy.yml)

![Class grades loaded, three releases under a budget of epsilon 2, with the analyst preview showing true values next to noisy ones](docs/screenshot.png)

## Features

- **Queries:** count (with a condition), sum and mean with clamping bounds you set, histogram, quantile/median, two-way contingency table, and synthetic data release (MWEM or independent marginals).
- **Mechanisms:** discrete Laplace (ε-DP), discrete Gaussian (zCDP), and the exponential mechanism for quantiles.
- **Privacy budget manager:** total ε and δ, per-query spend, basic composition or zCDP accounting (ρ converted to ε, δ), and a hard refusal once the budget is exhausted. The ledger and releases persist in local storage.
- **See the cost of privacy:** an ε slider redraws the noise distribution, its 95% interval and an error-versus-ε curve before you spend anything.
- **Analyst preview vs release:** true values appear only in a clearly marked preview and are never stored or exported. The release export (JSON or CSV) holds noisy results and parameters only.
- **Learn:** a plain-language explainer and a coin-flip randomized-response classroom demo with the unbiased estimator.
- **Sample data:** class grades, employee survey and health survey, generated synthetically. Light and dark themes, works on a phone.

## How it works

**Neighbouring datasets** differ by adding or removing one record.

**Secure integer noise.** Randomness comes from `crypto.getRandomValues`, never `Math.random`. The textbook Laplace sampler (`-b·sign(u)·ln(1-2|u|)`) leaks through floating-point gaps (Mironov, 2012), so noise here is integer valued. Discrete Laplace and discrete Gaussian use the exact samplers of Canonne, Kamath and Steinke (2020), which need only coin flips with probability exp(−γ). Real-valued data is clamped to your bounds and put on a fixed-point grid (exactly 1 unit for integer bounds up to 65,536, otherwise 1/65,536 of the range), so the sensitivity is an exact integer and the integer noise applies directly.

**Calibration.** Both mechanisms use scale = sensitivity / ε: Laplace with b = Δ₁/ε gives ε-DP, Gaussian with σ = Δ₂/ε gives ρ = ε²/2 zCDP. A histogram or table costs one ε because a record lands in one cell. A mean is a noisy sum of (x − lo) plus a noisy count, ε/2 each.

**Budget.** Basic composition adds ε. Under zCDP the ρ values add (an ε-DP step is ε²/2-zCDP) and the total converts with ε = ρ + 2√(ρ ln(1/δ)) (Bun and Steinke, 2016). Gaussian queries are only allowed under zCDP accounting.

**Quantiles** use the exponential mechanism over the gaps between sorted clamped values, weight ∝ width · exp(−ε·|rank − q·n| / 2) (McSherry and Talwar, 2007).

**Synthetic data** is post-processing of noisy measurements. MWEM (Hardt, Ligett and McSherry, 2012) starts uniform and repeatedly picks the worst-fit 2-way marginal cell with the exponential mechanism, measures it with Laplace noise and applies a multiplicative-weights update. The baseline releases noisy 1-way marginals and samples columns independently.

**Randomized response.** Tell the truth with probability p, otherwise answer by a fair coin: P(yes) = p·π + (1−p)/2, so π̂ = (f − (1−p)/2)/p is unbiased, with ε = ln((1+p)/(1−p)) (ln 3 for the classic two-coin survey).

**Caveats.** Domains (bounds and category lists) must come from public knowledge; the tool guesses them for uploaded CSVs and says so. The exponential mechanism and MWEM use ordinary floating-point arithmetic for their weights. This is a learning and prototyping tool, not an audited library.

## Quick start

You need [Node.js](https://nodejs.org/) 22.

```bash
git clone https://github.com/hermes98761234/differential-privacy-tool.git
cd differential-privacy-tool
npm install
npm run dev       # http://localhost:5173
npm test          # sampler moments, sensitivity, budget, exponential mechanism, randomized response
npm run build     # static site in dist/
```

## License

MIT
