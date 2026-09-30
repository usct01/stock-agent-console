// Offline tests for TA math + screener scoring (no network).
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sma, rsiWilder, analyzeTA, scoreTicker, annualizedVol } from '../lib/analysis.js'

// Rising staircase: every bar +1. RSI must be 100, SMA exact, bias bullish.
const rising = Array.from({ length: 60 }, (_, i) => ({
  date: `2026-01-${String(i + 1).padStart(2, '0')}`,
  o: 100 + i, h: 101 + i, l: 99 + i, c: 100 + i, v: 1000,
}))

describe('sma', () => {
  it('averages last k and returns null when short', () => {
    assert.equal(sma([1, 2, 3, 4], 4), 2.5)
    assert.equal(sma([1, 2], 20), null)
  })
})

describe('rsiWilder', () => {
  it('is 100 for a pure rally and 0 for a pure selloff', () => {
    assert.equal(rsiWilder(rising.map((b) => b.c)), 100)
    assert.equal(rsiWilder(rising.map((b) => 200 - b.c)), 0)
  })
  it('returns null with too few bars', () => {
    assert.equal(rsiWilder([1, 2, 3]), null)
  })
})

describe('analyzeTA', () => {
  it('computes trend internals on the rally fixture', () => {
    const ta = analyzeTA(rising)
    assert.equal(ta.n, 60)
    assert.equal(ta.sma20, 149.5)
    assert.equal(ta.sma50, 134.5)
    assert.equal(ta.rsi, 100)
    assert.equal(ta.bias, 'Bullish-lean')
    assert.ok(ta.atr > 0 && ta.rvol === 1 && ta.pctB > 0.5 && ta.pctB <= 1.2)
  })
  it('marks SMA50 n/a instead of crashing on short history', () => {
    const ta = analyzeTA(rising.slice(0, 25))
    assert.equal(ta.sma50, null)
    assert.match(ta.bias, /SMA50 n\/a/)
  })
})

describe('scoreTicker', () => {
  it('clamps to [-5, 5] and rewards uptrend', () => {
    const ta = analyzeTA(rising)
    const s = scoreTicker({ ...ta, rvol: 3, ret5: 8 })
    assert.ok(s >= -5 && s <= 5 && s >= 2)
  })
})

describe('annualizedVol', () => {
  it('needs 22+ bars and is sane on flat prices', () => {
    assert.equal(annualizedVol([100, 101]), null)
    assert.ok(Math.abs(annualizedVol(new Array(30).fill(100))) < 1e-9)
  })
})
