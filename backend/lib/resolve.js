// Company-name → ticker resolution over backend/data/tickers.json
// (NASDAQ + NYSE + AMEX listings with S&P 500 flags, seeded by
// scripts/build-tickers.mjs from Nasdaq screener + Wikipedia).
// Pure functions, no I/O at query time (dataset loaded once).
import tickers from '../data/tickers.json' with { type: 'json' }

// Explicit overrides for ambiguous multi-class / household names.
// Keys are normalized (see norm()). Documented, deterministic.
const ALIASES = {
  'GOOGLE': 'GOOGL',
  'ALPHABET': 'GOOGL',
  'FACEBOOK': 'META',
  'BERKSHIRE HATHAWAY': 'BRK-B',
  'BERKSHIRE': 'BRK-B',
}

const STOP = new Set(
  ('COMMON STOCK COMMON SHARES ORDINARY SHARES AMERICAN DEPOSITARY ADS ' +
    'INCORPORATED INC CORPORATION CORP COMPANY THE CO LIMITED LTD HOLDINGS HOLDING ' +
    'GROUP TECHNOLOGIES TECHNOLOGY LABS LABORATORIES SYSTEMS SOLUTIONS NETWORKS ' +
    'PHARMACEUTICALS ENERGY RESOURCES FINANCIAL CAPITAL PARTNERS TRUST REIT COM ' +
    'PLC SA AG NV SE AB CLASS').split(' '),
)

export function norm(raw) {
  return String(raw || '')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // split run-together words ("JPMorgan" -> "JP Morgan")
    .toUpperCase()
    .replace(/\([^)]*\)/g, ' ') // "(The)", "(Class A)" ...
    .replace(/&/g, '') // AT&T -> ATT
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\b[ABC]\b/g, ' ') // bare class letters ("Class C" -> "")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w))
    .join(' ')
}

const flatSym = (s) => s.toUpperCase().replace(/[./-]/g, '')

const INDEX = tickers.map((t) => ({
  ...t,
  flat: flatSym(t.s),
  tokens: new Set(norm(t.n).split(' ').filter(Boolean)),
}))

const BY_SYMBOL = new Map(INDEX.map((t) => [t.flat, t]))

/**
 * Resolve a ticker symbol or company name to a listing.
 * @returns {symbol, name, exchange, sp500, method} or null.
 * Methods: symbol (exact symbol) | alias (override) | exact (name match) | fuzzy (token subset).
 * Single letters resolve as symbols (T = AT&T). Unknown/empty → null.
 */
export function resolveCompany(query) {
  const raw = String(query || '').trim()
  if (!raw) return null
  const up = raw.toUpperCase()

  // 1. Exact symbol (punctuation-insensitive: BRK.B / BRK-B / BRKB all work).
  const bySym = BY_SYMBOL.get(flatSym(up))
  if (bySym) return out(bySym, 'symbol')

  // 2. Explicit aliases for ambiguous household names.
  const n = norm(raw)
  if (!n) return null
  if (ALIASES[n]) {
    const t = BY_SYMBOL.get(flatSym(ALIASES[n]))
    if (t) return out(t, 'alias')
  }

  // 3-4. Name matching over normalized tokens.
  const qt = n.split(' ')
  const cands = []
  for (const t of INDEX) {
    if (t.tokens.size === 0) continue
    if ([...qt].every((w) => t.tokens.has(w))) cands.push(t)
  }
  if (cands.length) {
    cands.sort((a, b) =>
      (b.sp - a.sp) ||
      (a.tokens.size - qt.length) - (b.tokens.size - qt.length) ||
      (a.s < b.s ? -1 : a.s > b.s ? 1 : 0),
    )
    const best = cands[0]
    // exact = same token set; otherwise fuzzy (query was a subset of a longer name)
    return out(best, best.tokens.size === qt.length ? 'exact' : 'fuzzy')
  }
  // Concatenated fallback for run-together spellings ("JPMorgan", "BerkshireHathaway").
  // Requires 4+ chars on both sides to avoid substring noise on short queries.
  const flat = qt.join('')
  if (flat.length >= 4) {
    const c2 = INDEX.filter((t) => {
      if (t.tokens.size === 0) return false
      const f = [...t.tokens].join('')
      if (f.length < 4) return false
      return f.includes(flat) || flat.includes(f)
    })
    c2.sort((a, b) =>
      (b.sp - a.sp) ||
      Math.abs([...a.tokens].join('').length - flat.length) - Math.abs([...b.tokens].join('').length - flat.length) ||
      (a.s < b.s ? -1 : a.s > b.s ? 1 : 0),
    )
    if (c2.length) return out(c2[0], 'fuzzy')
  }
  return null
}

function out(t, method) {
  return { symbol: t.s, name: t.n, exchange: t.x, sp500: t.sp === 1, method }
}

export function datasetStats() {
  return {
    total: INDEX.length,
    sp500: INDEX.filter((t) => t.sp).length,
    byExchange: {
      nasdaq: INDEX.filter((t) => t.x === 'nasdaq').length,
      nyse: INDEX.filter((t) => t.x === 'nyse').length,
      amex: INDEX.filter((t) => t.x === 'amex').length,
    },
  }
}
