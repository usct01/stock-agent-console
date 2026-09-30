// Offline tests for SEC companyfacts frame rules (no network).
// Covers: quarterly-vs-YTD disambiguation, instant (balance-sheet) frames,
// tag switches across years (GOOG revenue), and YoY computation.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { annualRows, computeFys } from '../lib/analysis.js'

const usd = (entries) => ({ units: { USD: entries } })
const q = (frame, val) => ({ frame, val, end: '2024-01-01', form: '10-Q', filed: '2024-01-01' })
const a = (frame, val) => ({ frame, val, end: '2024-01-01', form: '10-K', filed: '2024-01-01' })

describe('annualRows', () => {
  it('prefers exact annual frames over quarterly/YTD noise', () => {
    const tags = { R: usd([q('CY2024Q2', 50), { ...q('CY2024Q2', 999), frame: undefined }, a('CY2024', 200), a('CY2023', 100)]) }
    const rows = annualRows(tags, ['R'])
    assert.deepEqual(rows.map((r) => [r.fy, r.val]), [['2023', 100], ['2024', 200]])
  })

  it('merges across candidate tags when the filer switches tags by year', () => {
    const tags = {
      New: usd([a('CY2023', 300), a('CY2024', 350)]),
      Old: usd([a('CY2023', 1), a('CY2024', 2), a('CY2025', 402)]),
    }
    const rows = annualRows(tags, ['New', 'Old'])
    // First tag with data wins per year: 2023/2024 from New, 2025 falls back to Old.
    assert.deepEqual(rows.map((r) => [r.fy, r.val]), [['2023', 300], ['2024', 350], ['2025', 402]])
  })

  it('reads instant balance-sheet frames (CYxxxxQxI), latest quarter per year', () => {
    const tags = { E: usd([q('CY2024Q1I', 60), q('CY2024Q4I', 66), q('CY2025Q2I', 88)]) }
    const rows = annualRows(tags, ['E'])
    assert.deepEqual(rows.map((r) => [r.fy, r.val]), [['2024', 66], ['2025', 88]])
  })

  it('ignores frame-less YTD entries', () => {
    const tags = { R: usd([{ ...q('CY2024Q3', 109), frame: undefined }, q('CY2024Q3', 109)]) }
    // No exact annual frame and no instant frames → nothing annualizable.
    assert.deepEqual(annualRows(tags, ['R']), [])
  })
})

describe('computeFys', () => {
  it('computes margin, YoY, ROE, D/E with a 4-year lookback for YoY', () => {
    const byFy = {
      '2022': { fy: '2022', rev: 100, ni: 10, equity: 50, debt: 10 },
      '2023': { fy: '2023', rev: 200, ni: 40, equity: 60, debt: 120 },
      '2024': { fy: '2024', rev: 400, ni: 100, equity: 80, debt: 40 },
    }
    const [f23, f24] = computeFys(byFy).slice(-2)
    assert.equal(f23.margin, 0.2)
    assert.equal(f23.revYoY, 1)
    assert.equal(f24.roe, 1.25)
    assert.equal(f24.de, 0.5)
  })

  it('uses nulls instead of NaN on missing inputs', () => {
    const [f] = computeFys({ 2024: { fy: '2024' } })
    assert.equal(f.margin, null)
    assert.equal(f.revYoY, null)
    assert.equal(f.roe, null)
    assert.equal(f.de, null)
  })
})
