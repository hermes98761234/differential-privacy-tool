// Synthetic example datasets (generated with a fixed seed; no real people).

import type { ColSpec, Dataset } from './dataset.ts'

export interface Sample {
  id: string
  title: string
  blurb: string
  dataset: Dataset
  specs: ColSpec[]
}

function rng(seed: number) {
  // mulberry32: deterministic, only for generating the examples, never for noise.
  let a = seed
  const u = () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const normal = () => Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u())
  const pick = <T,>(items: T[], w: number[]) => {
    let r = u() * w.reduce((x, y) => x + y, 0)
    for (let i = 0; i < items.length; i++) if ((r -= w[i]) < 0) return items[i]
    return items[items.length - 1]
  }
  return { u, normal, pick }
}

const cl = (x: number, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, x)))

function grades(): Sample {
  const { u, normal, pick } = rng(11)
  const rows: string[][] = []
  for (let i = 0; i < 120; i++) {
    const section = pick(['A', 'B', 'C'], [4, 3, 3])
    const hours = cl(6 + normal() * 3 + (section === 'A' ? 1 : 0), 0, 20)
    const ability = normal() * 9
    const midterm = cl(58 + hours * 1.6 + ability, 0, 100)
    const final = cl(55 + hours * 1.4 + ability * 0.8 + normal() * 6, 0, 100)
    rows.push([String(i + 1), section, String(hours), String(midterm), String(final), (midterm + final) / 2 >= 60 ? 'yes' : 'no', u() < 0.55 ? 'yes' : 'no'])
  }
  return {
    id: 'grades',
    title: 'Class grades',
    blurb: '120 students: section, study hours, midterm, final, pass/fail.',
    dataset: { name: 'Class grades', columns: ['student', 'section', 'hours_per_week', 'midterm', 'final', 'passed', 'attended_review'], rows },
    specs: [
      { kind: 'cat', categories: [] },
      { kind: 'cat', categories: ['A', 'B', 'C'] },
      { kind: 'num', lo: 0, hi: 20, bins: 5 },
      { kind: 'num', lo: 0, hi: 100, bins: 10 },
      { kind: 'num', lo: 0, hi: 100, bins: 10 },
      { kind: 'cat', categories: ['yes', 'no'] },
      { kind: 'cat', categories: ['yes', 'no'] },
    ],
  }
}

function employees(): Sample {
  const { u, normal, pick } = rng(23)
  const depts = ['Engineering', 'Sales', 'Support', 'Finance', 'HR']
  const base: Record<string, number> = { Engineering: 82, Sales: 64, Support: 48, Finance: 70, HR: 55 }
  const rows: string[][] = []
  for (let i = 0; i < 300; i++) {
    const dept = pick(depts, [9, 6, 7, 3, 2])
    const tenure = cl(Math.abs(normal()) * 4 + 0.5, 0, 25)
    const salary = cl(base[dept] + tenure * 1.8 + normal() * 8, 25, 200)
    const remote = cl((dept === 'Engineering' ? 3 : dept === 'Support' ? 0.5 : 1.5) + normal(), 0, 5)
    const sat = cl(3.2 + remote * 0.25 - (salary < 55 ? 0.7 : 0) + normal() * 0.9, 1, 5)
    rows.push([dept, String(tenure), String(salary), String(remote), String(sat), u() < 0.15 + sat * 0.14 ? 'yes' : 'no'])
  }
  return {
    id: 'employees',
    title: 'Employee survey',
    blurb: '300 employees: department, tenure, salary (k$), remote days, satisfaction 1–5.',
    dataset: { name: 'Employee survey', columns: ['department', 'tenure_years', 'salary_k', 'remote_days', 'satisfaction', 'would_recommend'], rows },
    specs: [
      { kind: 'cat', categories: depts },
      { kind: 'num', lo: 0, hi: 25, bins: 5 },
      { kind: 'num', lo: 25, hi: 200, bins: 7 },
      { kind: 'num', lo: 0, hi: 5, bins: 6 },
      { kind: 'num', lo: 1, hi: 5, bins: 5 },
      { kind: 'cat', categories: ['yes', 'no'] },
    ],
  }
}

function health(): Sample {
  const { u, normal, pick } = rng(37)
  const rows: string[][] = []
  for (let i = 0; i < 400; i++) {
    const age = cl(45 + normal() * 16, 18, 90)
    const exercise = pick(['none', 'light', 'regular'], [3, 4, 3])
    const smoker = u() < (exercise === 'none' ? 0.3 : 0.14) ? 'yes' : 'no'
    const bmi = cl(26 + normal() * 4.5 - (exercise === 'regular' ? 2 : 0), 15, 45)
    const bp = cl(104 + age * 0.3 + (bmi - 25) * 0.7 + (smoker === 'yes' ? 5 : 0) + normal() * 9, 80, 200)
    const sleep = cl(7 + normal() * 1.1, 3, 12)
    const diabetic = u() < 0.02 + Math.max(0, bmi - 25) * 0.012 + age * 0.0008 ? 'yes' : 'no'
    rows.push([String(age), String(bmi), bp.toString(), exercise, smoker, String(sleep), diabetic])
  }
  return {
    id: 'health',
    title: 'Health survey',
    blurb: '400 adults: age, BMI, blood pressure, exercise, smoking, sleep, diabetes.',
    dataset: { name: 'Health survey', columns: ['age', 'bmi', 'systolic_bp', 'exercise', 'smoker', 'sleep_hours', 'diabetic'], rows },
    specs: [
      { kind: 'num', lo: 18, hi: 90, bins: 6 },
      { kind: 'num', lo: 15, hi: 45, bins: 6 },
      { kind: 'num', lo: 80, hi: 200, bins: 6 },
      { kind: 'cat', categories: ['none', 'light', 'regular'] },
      { kind: 'cat', categories: ['yes', 'no'] },
      { kind: 'num', lo: 3, hi: 12, bins: 6 },
      { kind: 'cat', categories: ['yes', 'no'] },
    ],
  }
}

export const SAMPLES: Sample[] = [grades(), employees(), health()]
