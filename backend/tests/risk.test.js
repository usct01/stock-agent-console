// Offline tests for the deterministic risk rating (no network).
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { assessRisk } from '../lib/analysis.js'

const flat = new Array(60).fill(100)

describe('assessRisk', () => {
  it('rates a fortress balance sheet + calm tape as Low', () => {
    const sideways = Array.from({ length: 60 }, (_, i) => 100 + (i % 2) * 0.5)
    const r = assessRisk({
      ta: { rsi: 50 },
      fys: [{ fy: '2024', ni: 100, equity: 1000, debt: 100 }],
      pe: null,
      closes: sideways,
    })
    assert.equal(r.rating, 'Low')
    assert.match(r.marker, /Overall Risk Rating: Low \(Score: \d+\/100\)/)
    assert.ok(r.score <= 30 && r.drivers.length >= 5)
  })

  it('rates distress (losses, high leverage, stretched RSI) as High', () => {
    const falling = Array.from({ length: 60 }, (_, i) => 100 - i)
    const r = assessRisk({
      ta: { rsi: 22 },
      fys: [{ fy: '2024', ni: -50, equity: 100, debt: 300 }],
      pe: 80,
      closes: falling,
    })
    assert.equal(r.rating, 'High')
    assert.ok(r.score > 60)
  })

  it('stays null-safe with everything missing', () => {
    const r = assessRisk({ ta: {}, fys: [], pe: null, closes: [1] })
    assert.ok(['Low', 'Moderate', 'High'].includes(r.rating))
    assert.match(r.marker, /Overall Risk Rating: \w+ \(Score: \d+\/100\)/)
  })
})
