// Offline tests for machine-readable agent markers (no network).
// Contract shared by earnings.md / screener.md / risk-analysis.md prompts
// and parsed by aggregator.md — keep these formats stable.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { earningSurprise, earningsMarker, screenerMarker } from '../lib/analysis.js'

describe('earningSurprise', () => {
  it('labels Beat/Miss/In-line on a ±2% band', () => {
    const beat = earningSurprise(2.02, 1.89)
    assert.equal(beat.label, 'Beat')
    assert.ok(Math.abs((beat.pct ?? 0) - 0.0688) < 1e-4)
    assert.equal(earningSurprise(2.85, 2.91).label, 'Miss')
    assert.equal(earningSurprise(100, 101).label, 'In-line')
  })
  it('never divides by zero and nulls on missing inputs', () => {
    assert.deepEqual(earningSurprise(2.02, 0), { pct: null, label: 'n/a' })
    assert.deepEqual(earningSurprise(null, 1.89), { pct: null, label: 'n/a' })
    assert.deepEqual(earningSurprise(2.02, null), { pct: null, label: 'n/a' })
  })
})

describe('earningsMarker', () => {
  it('emits the aggregator-parseable line', () => {
    assert.equal(
      earningsMarker('AAPL', 'Q3 FY2026', 2.02, 1.89),
      'EPS Surprise: Beat +6.9% (AAPL Q3 FY2026, actual 2.02 vs est 1.89)',
    )
  })
  it('marks n/a cleanly without estimates', () => {
    assert.equal(
      earningsMarker('GOOG', 'Q3 FY2026', 2.85, null),
      'EPS Surprise: n/a n/a (GOOG Q3 FY2026, actual 2.85 vs est n/a)',
    )
  })
})

describe('screenerMarker', () => {
  it('emits signed score with ±5 scale and clamps', () => {
    assert.equal(screenerMarker('AAPL', 1), 'Screener Score: AAPL +1/±5')
    assert.equal(screenerMarker('TSLA', -3), 'Screener Score: TSLA -3/±5')
    assert.equal(screenerMarker('X', 99), 'Screener Score: X +5/±5')
  })
})
