// Offline tests for company-name → ticker resolution (no network).
// Runs against the committed backend/data/tickers.json snapshot.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolveCompany, norm, datasetStats } from '../lib/resolve.js'

describe('dataset', () => {
  it('covers NASDAQ + NYSE + AMEX with S&P 500 flags', () => {
    const s = datasetStats()
    assert.ok(s.total > 6000, `expected 6000+ listings, got ${s.total}`)
    assert.ok(s.byExchange.nasdaq > 3000)
    assert.ok(s.byExchange.nyse > 2000)
    assert.ok(s.byExchange.amex > 100)
    assert.ok(s.sp500 >= 450 && s.sp500 <= 550, `S&P count ${s.sp500} out of band`)
  })
})

describe('common names', () => {
  const cases = [
    ['Apple', 'AAPL'], ['NVIDIA', 'NVDA'], ['Equinix', 'EQIX'],
    ['Microsoft', 'MSFT'], ['Amazon', 'AMZN'], ['Amazon.com', 'AMZN'],
    ['Tesla', 'TSLA'], ['Meta', 'META'], ['Berkshire Hathaway', 'BRK-B'],
    ['Coca-Cola', 'KO'], ['3M', 'MMM'], ['Johnson & Johnson', 'JNJ'],
    ['Procter & Gamble', 'PG'], ['Advanced Micro Devices', 'AMD'],
    ['Alphabet', 'GOOGL'], ['Google', 'GOOGL'], ['Facebook', 'META'],
    ['JPMorgan', 'JPM'], ['JP Morgan', 'JPM'], ['Bank of America', 'BAC'],
    ['Morgan Stanley', 'MS'], ['Wells Fargo', 'WFC'], ['Goldman Sachs', 'GS'],
  ]
  for (const [q, sym] of cases) {
    it(`${q} -> ${sym}`, () => {
      assert.equal(resolveCompany(q)?.symbol, sym)
    })
  }
})

describe('symbols in, symbols out', () => {
  it('is case-insensitive and punctuation-insensitive', () => {
    assert.equal(resolveCompany('aapl')?.symbol, 'AAPL')
    assert.equal(resolveCompany('  NvDa  ')?.symbol, 'NVDA')
    assert.equal(resolveCompany('BRK.B')?.symbol, 'BRK-B')
    assert.equal(resolveCompany('BRK/B')?.symbol, 'BRK-B')
  })
  it('resolves single letters as symbols (T = AT&T)', () => {
    const r = resolveCompany('T')
    assert.equal(r?.symbol, 'T')
    assert.equal(r?.method, 'symbol')
  })
  it('emits Yahoo-style class shares, never slashes', () => {
    assert.equal(resolveCompany('Berkshire Hathaway')?.symbol, 'BRK-B')
    assert.match(resolveCompany('Berkshire Hathaway')?.symbol || '', /^[A-Z0-9.-]+$/)
  })
  it('prefers common stock over preferred depositary shares', () => {
    // Regression: run-together "JPMorgan" must not match JPM^J-style preferreds.
    for (const q of ['JPMorgan', 'JP Morgan', 'JPMorgan Chase']) {
      const r = resolveCompany(q)
      assert.equal(r?.symbol, 'JPM')
      assert.match(r?.name || '', /Common Stock/)
    }
  })
})

describe('edge cases', () => {
  it('returns null for unknown and empty input', () => {
    assert.equal(resolveCompany('No Such Company XYZ'), null)
    assert.equal(resolveCompany(''), null)
    assert.equal(resolveCompany('   '), null)
    assert.equal(resolveCompany(null), null)
  })
  it('handles punctuation and suffix noise', () => {
    assert.equal(resolveCompany('AT&T')?.symbol, 'T')
    assert.equal(resolveCompany('Apple, Inc.')?.symbol, 'AAPL')
    assert.equal(resolveCompany('Coca-Cola Company (The)')?.symbol, 'KO')
  })
  it('flags S&P 500 membership', () => {
    assert.equal(resolveCompany('Apple')?.sp500, true)
    const r = resolveCompany('ATA Creativity Global')
    if (r) assert.equal(r.sp500, false)
  })
  it('reports the resolution method', () => {
    assert.equal(resolveCompany('AAPL')?.method, 'symbol')
    assert.equal(resolveCompany('Google')?.method, 'alias')
    assert.equal(resolveCompany('Apple')?.method, 'exact')
    assert.ok(['exact', 'fuzzy'].includes(resolveCompany('Ford')?.method || ''))
  })
  it('normalizes corporate suffixes away', () => {
    assert.equal(norm('Apple Inc. Common Stock'), 'APPLE')
    assert.equal(norm('Alphabet Inc. Class C Capital Stock'), 'ALPHABET')
    assert.equal(norm('Coca-Cola Company (The)'), 'COCA COLA')
  })
})
