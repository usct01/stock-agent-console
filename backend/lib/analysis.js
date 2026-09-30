// Pure analysis functions shared by server.js and tests (no I/O, no deps).

export function sma(arr, k) {
  return arr.length >= k ? arr.slice(-k).reduce((a, b) => a + b, 0) / k : null
}

export function rsiWilder(closes, p = 14) {
  if (closes.length < p + 1) return null
  const g = [], l = []
  for (let i = 1; i < closes.length; i++) {
    g.push(Math.max(0, closes[i] - closes[i - 1]))
    l.push(Math.max(0, closes[i - 1] - closes[i]))
  }
  let ag = g.slice(0, p).reduce((a, b) => a + b, 0) / p
  let al = l.slice(0, p).reduce((a, b) => a + b, 0) / p
  for (let i = p; i < g.length; i++) {
    ag = (ag * (p - 1) + g[i]) / p
    al = (al * (p - 1) + l[i]) / p
  }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al)
}

export function annualizedVol(closes) {
  if (closes.length < 22) return null
  const rets = []
  for (let i = 1; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]))
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length
  const sd = Math.sqrt(rets.reduce((a, r) => a + (r - mean) ** 2, 0) / rets.length)
  return sd * Math.sqrt(252)
}

export function analyzeTA(bars) {
  const closes = bars.map((b) => b.c)
  const highs = bars.map((b) => b.h)
  const lows = bars.map((b) => b.l)
  const vols = bars.map((b) => b.v)
  const n = closes.length
  const sma20 = sma(closes, 20)
  const sma50 = sma(closes, 50)
  const rsi = rsiWilder(closes)
  const sd = sma20 == null ? null : Math.sqrt(closes.slice(-20).reduce((a, c) => a + (c - sma20) ** 2, 0) / 20)
  const pctB = sma20 == null || !sd ? null : (closes[n - 1] - (sma20 - 2 * sd)) / (4 * sd)
  const trs = []
  for (let i = 1; i < n; i++) trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])))
  const atr = trs.slice(-14).reduce((a, b) => a + b, 0) / Math.min(14, trs.length || 1)
  const vavg = vols.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, vols.length || 1)
  const rvol = vavg ? vols[n - 1] / vavg : null
  const ret5 = n >= 6 ? (closes[n - 1] / closes[n - 6] - 1) * 100 : null
  const bias =
    sma50 == null ? `Neutral (SMA50 n/a – ${n} bars)`
    : closes[n - 1] > sma50 && (rsi ?? 0) >= 55 ? 'Bullish-lean'
    : closes[n - 1] < sma50 && (rsi ?? 100) < 45 ? 'Bearish-lean'
    : 'Neutral'
  return {
    n, last: bars[n - 1], sma20, sma50, rsi, pctB, atr, rvol, ret5, bias,
    high20: Math.max(...highs.slice(-20)), low20: Math.min(...lows.slice(-20)),
  }
}

// Deterministic -5..+5 screen score (mirrors screener agent rules).
export function scoreTicker(ta) {
  let s =
    (ta.sma50 == null ? 0 : ta.last.c > ta.sma50 ? 1 : -1) +
    (ta.rsi == null ? 0 : ta.rsi < 30 ? 1 : ta.rsi > 70 ? -1 : 0) +
    (ta.ret5 == null ? 0 : ta.ret5 > 5 ? 1 : ta.ret5 < -5 ? -1 : 0) +
    (ta.rvol != null && ta.rvol >= 2 ? 1 : 0)
  return Math.max(-5, Math.min(5, s))
}

export function sentimentOf(headlines) {
  if (!headlines.length) return { label: 'Unknown (thin sample)', bull: [], bear: [] }
  const pos = /beat|surge|growth|record|upgrade|bull|rally|strong|buy|launch/i
  const neg = /miss|drop|cut|downgrade|bear|lawsuit|fine|layoff|risk|probe|miss/i
  const bull = headlines.filter((h) => pos.test(h.title)).slice(0, 3)
  const bear = headlines.filter((h) => neg.test(h.title)).slice(0, 3)
  const label =
    bull.length >= Math.ceil(headlines.length * 0.6) ? 'Positive'
    : bear.length >= Math.ceil(headlines.length * 0.6) ? 'Negative'
    : 'Mixed'
  return { label, bull, bear }
}

// Merge annual values across candidate XBRL tags (same metric may change tags
// across years). Flow facts prefer exact CYxxxx frames; instant (balance-sheet)
// facts use latest CYxxxxQxI quarter per year. Returns last 4 year-rows.
export function annualRows(tags, names) {
  const merged = {}
  for (const name of names) {
    const u = tags[name]?.units?.USD
    if (!u) continue
    const exact = u.filter((x) => /^CY\d{4}$/.test(x.frame || '')).sort((a, b) => a.frame.localeCompare(b.frame))
    const pick = exact.length
      ? exact
      : Object.values(
          u.reduce((m, x) => {
            const mt = /^CY(\d{4})Q[1-4]I$/.exec(x.frame || '')
            if (!mt) return m
            if (!m[mt[1]] || x.frame > m[mt[1]].frame) m[mt[1]] = x
            return m
          }, {}),
        ).sort((a, b) => a.frame.localeCompare(b.frame))
    for (const x of pick) {
      const fy = x.frame.slice(2, 6)
      if (!(fy in merged)) merged[fy] = { fy, end: x.end, val: x.val }
    }
  }
  return Object.values(merged).sort((a, b) => a.fy.localeCompare(b.fy)).slice(-4)
}

export function computeFys(byFy) {
  const all = Object.values(byFy)
    .sort((a, b) => a.fy.localeCompare(b.fy))
    .slice(-4)
    .map((f, i, arr) => {
      const prev = arr[i - 1]
      return {
        ...f,
        margin: f.rev && f.ni != null ? f.ni / f.rev : null,
        revYoY: f.rev && prev?.rev ? f.rev / prev.rev - 1 : null,
        roe: f.ni != null && f.equity ? f.ni / f.equity : null,
        de: f.debt != null && f.equity ? f.debt / f.equity : null,
      }
    })
  return all.slice(-3)
}

// Deterministic 0-100 risk rating (adapted from InvestmentResearchbyAgents
// RiskAgent heuristics; null-safe: unknowns add small weight + note).
export function assessRisk({ ta, fys, pe, closes }) {
  const drivers = []
  let score = 0
  const f = [...(fys || [])].reverse().find((x) => x.ni != null) || {}
  const de = f.de ?? null
  if (de == null) { score += 10; drivers.push(['Leverage', 'D/E n/a → assumed adequate (check filings)']) }
  else if (de < 0.5) { score += 10; drivers.push(['Leverage', `D/E ${de.toFixed(2)} → low burden`]) }
  else if (de < 1.5) { score += 20; drivers.push(['Leverage', `D/E ${de.toFixed(2)} → moderate burden`]) }
  else { score += 30; drivers.push(['Leverage', `D/E ${de.toFixed(2)} → elevated burden`]) }

  drivers.push(['Liquidity', 'current ratio n/a (not in companyfacts subset) → small weight'])
  score += 5

  if (f.ni == null) { score += 15; drivers.push(['Profitability', 'earnings unknown → mid weight']) }
  else if (f.ni <= 0) { score += 20; drivers.push(['Profitability', 'negative net income']) }
  else { score += 5; drivers.push(['Profitability', 'positive earnings']) }

  if (pe == null) { drivers.push(['Valuation', 'P/E n/a → no weight']) }
  else if (pe < 0) { score += 10; drivers.push(['Valuation', `P/E ${pe.toFixed(1)} (loss-making multiple)`]) }
  else if (pe > 50) { score += 15; drivers.push(['Valuation', `expensive P/E ${pe.toFixed(1)}`]) }
  else if (pe > 25) { score += 10; drivers.push(['Valuation', `growth-priced P/E ${pe.toFixed(1)}`]) }
  else { score += 5; drivers.push(['Valuation', `reasonable P/E ${pe.toFixed(1)}`]) }

  const vol = closes ? annualizedVol(closes) : null
  if (vol == null) { score += 10; drivers.push(['Volatility', 'history too short → mid weight']) }
  else if (vol < 0.25) { score += 10; drivers.push(['Volatility', `annualized vol ${(vol * 100).toFixed(0)}% → contained`]) }
  else if (vol < 0.45) { score += 20; drivers.push(['Volatility', `annualized vol ${(vol * 100).toFixed(0)}% → elevated`]) }
  else { score += 30; drivers.push(['Volatility', `annualized vol ${(vol * 100).toFixed(0)}% → very high`]) }

  const rsi = ta?.rsi
  if (rsi != null && (rsi >= 70 || rsi <= 30)) {
    score += 5
    drivers.push(['Technical', `RSI ${rsi.toFixed(1)} → stretched`])
  }
  score = Math.round(Math.min(score, 100))
  const rating = score <= 30 ? 'Low' : score <= 60 ? 'Moderate' : 'High'
  return { score, rating, drivers, marker: `Overall Risk Rating: ${rating} (Score: ${score}/100)` }
}
