import express from 'express'
import cors from 'cors'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FA_CACHE = path.join(ROOT, '.opencode', 'cache', 'fa')
const app = express()
app.use(cors())
app.use(express.json({ limit: '64kb' }))

const YAHOO_UA = 'Mozilla/5.0'
const SEC_UA = 'AgentTest contact@localhost'
const CIKS = {
  AAPL: '0000320193', MSFT: '0000789019', GOOGL: '0001652044', GOOG: '0001652044',
  AMZN: '0001018724', TSLA: '0001318605', NVDA: '0001045810', META: '0001326801',
  EQIX: '0001101239', AVGO: '0001730168', AMD: '0000002488', NFLX: '0001065280',
}
// Company-name → ticker resolution (Yahoo needs symbols, not names)
const NAME_MAP = {
  APPLE: 'AAPL', NVIDIA: 'NVDA', EQUINIX: 'EQIX', MICROSOFT: 'MSFT',
  ALPHABET: 'GOOGL', GOOGLE: 'GOOGL', AMAZON: 'AMZN', TESLA: 'TSLA',
  META: 'META', FACEBOOK: 'META', BROADCOM: 'AVGO', AMD: 'AMD',
  'ADVANCED MICRO DEVICES': 'AMD', NETFLIX: 'NFLX',
}
const resolveTicker = (t) => NAME_MAP[t] || t
const AGENTS = [
  { id: 'finance-news', title: 'Finance News' },
  { id: 'technical-analysis', title: 'Technical Analysis' },
  { id: 'fundamental-analysis', title: 'Fundamental Analysis' },
  { id: 'earnings', title: 'Earnings' },
  { id: 'sentiment', title: 'Sentiment' },
  { id: 'screener', title: 'Screener' },
  { id: 'orchestrator', title: 'Orchestrator' },
  { id: 'aggregator', title: 'Aggregator' },
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function getJSON(url, ua) {
  const res = await fetch(url, { headers: { 'User-Agent': ua, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.json()
}
async function getText(url, ua) {
  const res = await fetch(url, { headers: { 'User-Agent': ua }, signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

async function yahooMeta(ticker) {
  const d = await getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5d`, YAHOO_UA)
  return d.chart.result[0].meta
}
async function yahooHistory(ticker, range) {
  const d = await getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=${range}&interval=1d`, YAHOO_UA)
  const r = d.chart.result[0]
  const q = r.indicators.quote[0]
  const bars = []
  r.timestamp.forEach((t, i) => {
    if (q.close[i] == null) return
    bars.push({ date: new Date(t * 1000).toISOString().slice(0, 10), o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i] || 0 })
  })
  return bars
}
async function secFilings(ticker) {
  const cik = CIKS[ticker]
  if (!cik) return { note: 'CIK unknown – SEC skipped' }
  const d = await getJSON(`https://data.sec.gov/submissions/CIK${cik}.json`, SEC_UA)
  const f = d.filings.recent
  const out = []
  for (let i = 0; i < f.form.length && out.length < 2; i++) {
    if (f.form[i] === '10-K' || f.form[i] === '10-Q') out.push({ form: f.form[i], filed: f.filingDate[i], acc: f.accessionNumber[i] })
  }
  return { filings: out }
}
// Annual fundamentals from SEC companyfacts (cached 24h). Returns last 3 FYs.
async function faFacts(ticker) {
  const cik = CIKS[ticker]
  if (!cik) return { note: 'CIK unknown – fundamentals skipped' }
  const cacheFile = path.join(FA_CACHE, `${ticker}.json`)
  try {
    const st = await fs.stat(cacheFile)
    if (Date.now() - st.mtimeMs < 24 * 3600 * 1000) {
      return { ...(await JSON.parse(await fs.readFile(cacheFile, 'utf8'))), cached: true }
    }
  } catch { /* miss → fetch */ }
  const d = await getJSON(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, SEC_UA)
  const tags = d.facts?.['us-gaap'] || {}
  const annual = (names) => {
    // Merge across candidate tags: same metric may change tags across years (e.g. GOOG revenue).
    const merged = {}
    for (const name of names) {
      const u = tags[name]?.units?.USD
      if (!u) continue
      // Flow facts (income): exact CYxxxx frames are annual totals – prefer them.
      const exact = u.filter((x) => /^CY\d{4}$/.test(x.frame || '')).sort((a, b) => a.frame.localeCompare(b.frame))
      const pick = exact.length ? exact : Object.values(
        u.reduce((m, x) => {
          // Instant facts (balance sheet): CYxxxxQxI frames – latest quarter per year.
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
  const byFy = {}
  const put = (key, rows) => rows.forEach((r) => { (byFy[r.fy] ??= { fy: r.fy }).end = r.end; byFy[r.fy][key] = r.val })
  put('rev', annual(['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet']))
  put('ni', annual(['NetIncomeLoss']))
  put('equity', annual(['StockholdersEquity']))
  put('assets', annual(['Assets']))
  put('debt', annual(['LongTermDebtNoncurrent']))
  put('cash', annual(['CashAndCashEquivalentsAtCarryingValue']))
  const fysAll = Object.values(byFy).sort((a, b) => a.fy.localeCompare(b.fy)).slice(-4).map((f, i, arr) => {
    const prev = arr[i - 1]
    return {
      ...f,
      margin: f.rev && f.ni != null ? f.ni / f.rev : null,
      revYoY: f.rev && prev?.rev ? f.rev / prev.rev - 1 : null,
      roe: f.ni != null && f.equity ? f.ni / f.equity : null,
      de: f.debt != null && f.equity ? f.debt / f.equity : null,
    }
  })
  const fys = fysAll.slice(-3)
  const out = { fys, cached: false }
  try { await fs.mkdir(FA_CACHE, { recursive: true }); await fs.writeFile(cacheFile, JSON.stringify(out)) } catch { /* cache best-effort */ }
  return out
}
async function gfNews(ticker, exchange = 'NASDAQ') {
  try {
    const html = await getText(`https://www.google.com/finance/quote/${ticker}:${exchange}?hl=en`, YAHOO_UA)
    const seen = new Set()
    const items = []
    const re = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g
    let m
    while ((m = re.exec(html)) && items.length < 8) {
      const title = m[2].replace(/<[^>]+>/g, ' ').replace(/&[^;]+;/g, ' ').replace(/\s+/g, ' ').trim()
      if (title.length < 30 || title.length > 180 || seen.has(title)) continue
      if (/google\.|gstatic|accounts\.|Sign in|Google apps/i.test(m[1] + ' ' + title)) continue
      seen.add(title)
      items.push({ title, url: m[1] })
    }
    return items
  } catch {
    return []
  }
}

function sma(arr, k) { return arr.length >= k ? arr.slice(-k).reduce((a, b) => a + b, 0) / k : null }
function rsiWilder(closes, p = 14) {
  if (closes.length < p + 1) return null
  const g = [], l = []
  for (let i = 1; i < closes.length; i++) { g.push(Math.max(0, closes[i] - closes[i - 1])); l.push(Math.max(0, closes[i - 1] - closes[i])) }
  let ag = g.slice(0, p).reduce((a, b) => a + b, 0) / p
  let al = l.slice(0, p).reduce((a, b) => a + b, 0) / p
  for (let i = p; i < g.length; i++) { ag = (ag * (p - 1) + g[i]) / p; al = (al * (p - 1) + l[i]) / p }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al)
}
function analyzeTA(bars) {
  const closes = bars.map((b) => b.c), highs = bars.map((b) => b.h), lows = bars.map((b) => b.l), vols = bars.map((b) => b.v)
  const n = closes.length
  const sma20 = sma(closes, 20), sma50 = sma(closes, 50)
  const rsi = rsiWilder(closes)
  const sd = Math.sqrt(closes.slice(-20).reduce((a, c) => a + (c - sma20) ** 2, 0) / 20)
  const pctB = (closes[n - 1] - (sma20 - 2 * sd)) / (4 * sd)
  const trs = []
  for (let i = 1; i < n; i++) trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])))
  const atr = trs.slice(-14).reduce((a, b) => a + b, 0) / 14
  const vavg = vols.slice(-20).reduce((a, b) => a + b, 0) / 20
  const rvol = vols[n - 1] / vavg
  const ret5 = (closes[n - 1] / closes[n - 6] - 1) * 100
  const bias = sma50 == null ? `Neutral (SMA50 n/a – ${n} bars)` : closes[n - 1] > sma50 && rsi >= 55 ? 'Bullish-lean' : closes[n - 1] < sma50 && rsi < 45 ? 'Bearish-lean' : 'Neutral'
  return { n, last: bars[n - 1], sma20, sma50, rsi, pctB, atr, rvol, ret5, bias, high20: Math.max(...highs.slice(-20)), low20: Math.min(...lows.slice(-20)) }
}
function sentimentOf(headlines) {
  if (!headlines.length) return { label: 'Unknown (thin sample)', bull: [], bear: [] }
  const pos = /beat|surge|growth|record|upgrade|bull|rally|strong|buy|launch/i
  const neg = /miss|drop|cut|downgrade|bear|lawsuit|fine|layoff|risk|probe|miss/i
  const bull = headlines.filter((h) => pos.test(h.title)).slice(0, 3)
  const bear = headlines.filter((h) => neg.test(h.title)).slice(0, 3)
  const label = bull.length >= Math.ceil(headlines.length * 0.6) ? 'Positive' : bear.length >= Math.ceil(headlines.length * 0.6) ? 'Negative' : 'Mixed'
  return { label, bull, bear }
}

app.get('/api/health', (_, res) => res.json({ ok: true, time: new Date().toISOString() }))
app.get('/api/agents', (_, res) => res.json({ agents: AGENTS }))

app.post('/api/run', async (req, res) => {
  try {
    const rawTickers = Array.isArray(req.body.tickers) ? req.body.tickers : []
    const tickers = [...new Set(rawTickers.map((t) => resolveTicker(String(t).toUpperCase().trim().replace(/\s+/g, ' '))).filter((t) => /^[A-Z0-9.\-]{1,10}$/.test(t)))].slice(0, 5)
    if (!tickers.length) return res.status(400).json({ error: 'Provide 1–5 ticker symbols (e.g. EQIX, NVDA) or company names (e.g. Equinix, NVIDIA)' })
    const range = ['1mo', '3mo', '6mo', '1y'].includes(req.body.range) ? req.body.range : '6mo'
    const want = new Set(Array.isArray(req.body.agents) && req.body.agents.length ? req.body.agents : ['finance-news', 'technical-analysis', 'screener'])
    const asOf = new Date().toISOString()
    const results = []
    for (const t of tickers) {
      const item = { ticker: t, errors: [] }
      try { item.quote = await yahooMeta(t) } catch (e) { item.errors.push('yahoo-quote: ' + e.message) }
      await sleep(1500)
      try {
        const bars = await yahooHistory(t, range)
        item.ta = analyzeTA(bars)
        item.bars = bars.length
        const closes = bars.map((b) => b.c)
        const roll = (k) => closes.map((_, i) => (i >= k - 1 ? closes.slice(i - k + 1, i + 1).reduce((a, b) => a + b, 0) / k : null))
        item.series = {
          dates: bars.map((b) => b.date), closes,
          opens: bars.map((b) => b.o), highs: bars.map((b) => b.h), lows: bars.map((b) => b.l), vols: bars.map((b) => b.v),
          sma20: roll(20), sma50: roll(50),
        }
      } catch (e) { item.errors.push('yahoo-history: ' + e.message) }
      await sleep(1500)
      if (want.has('fundamental-analysis') || want.has('earnings')) {
        try { Object.assign(item, await secFilings(t)) } catch (e) { item.errors.push('sec: ' + e.message) }
        await sleep(1000)
      }
      if (want.has('fundamental-analysis')) {
        try { item.fa = await faFacts(t) } catch (e) { item.errors.push('sec-facts: ' + e.message) }
        await sleep(1000)
      }
      if (want.has('finance-news') || want.has('sentiment')) {
        item.news = await gfNews(t)
      }
      if (want.has('sentiment')) item.sentiment = sentimentOf(item.news || [])
      results.push(item)
    }
    const screener = results
      .filter((r) => r.ta)
      .map((r) => {
        const { ta } = r
        let s = (ta.sma50 == null ? 0 : ta.last.c > ta.sma50 ? 1 : -1) + (ta.rsi == null ? 0 : ta.rsi < 30 ? 1 : ta.rsi > 70 ? -1 : 0) + (ta.ret5 > 5 ? 1 : ta.ret5 < -5 ? -1 : 0) + (ta.rvol >= 2 ? 1 : 0)
        return { ticker: r.ticker, price: ta.last.c, score: Math.max(-5, Math.min(5, s)), rsi: ta.rsi == null ? null : +ta.rsi.toFixed(1), vsSMA50: ta.sma50 == null ? null : +(((ta.last.c / ta.sma50) - 1) * 100).toFixed(2), rvol: +ta.rvol.toFixed(2) }
      })
      .sort((a, b) => b.score - a.score)
    const f2 = (v) => (v == null || Number.isNaN(v) ? 'n/a' : Number(v).toFixed(2))
    const lines = [`# Stock report ${asOf}`, '']
    for (const r of results) {
      const q = r.quote || {}
      lines.push(`## ${r.ticker} – $${q.regularMarketPrice ?? r.ta?.last.c ?? 'n/a'} (${f2(q.regularMarketChangePercent)}% today)`)
      if (r.ta) lines.push(`TA: ${r.ta.bias}, RSI ${f2(r.ta.rsi)}, SMA20 ${f2(r.ta.sma20)}, SMA50 ${f2(r.ta.sma50)}, ATR ${f2(r.ta.atr)}.`)
      if (r.filings) lines.push(`SEC: ${r.filings.map((f) => `${f.form} filed ${f.filed}`).join('; ')}.`)
      if (r.fa?.fys?.length) {
        const f = r.fa.fys[r.fa.fys.length - 1]
        lines.push(`FA FY${f.fy}${r.fa.cached ? ' (SEC cached)' : ''}: rev $${(f.rev / 1e9).toFixed(1)}B (${f.revYoY == null ? 'n/a' : (f.revYoY * 100).toFixed(1) + '% YoY'}), margin ${f.margin == null ? 'n/a' : (f.margin * 100).toFixed(1) + '%'}, ROE ${f2(f.roe)}, LT D/E ${f2(f.de)}.`)
      }      if (r.news?.length) { lines.push('News:'); r.news.slice(0, 5).forEach((n, i) => lines.push(`${i + 1}. ${n.title}`)) }
      if (r.sentiment) lines.push(`Sentiment: ${r.sentiment.label}.`)
      if (r.errors.length) lines.push(`Notes: ${r.errors.join(' | ')}`)
      lines.push('Not financial advice.', '')
    }
    res.json({ asOf, range, results, screener, markdown: lines.join('\n'), notes: ['Quotes/TA: Yahoo live.', 'Filings + FY fundamentals: SEC EDGAR (facts cached 24h; www.sec.gov may 403 on shared IPs).', 'News: Google Finance page scrape, best-effort.', 'Estimates need websearch – run @earnings in opencode for those.', 'GDELT skipped server-side (throttled); sentiment from headlines only.'] })
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) })
  }
})

const PORT = process.env.PORT || 3001

// Production: serve the built frontend (single process, no Docker).
// frontend/dist is created by `npm run build`. Absent in dev – API still works.
const DIST = path.join(ROOT, 'frontend', 'dist')
try {
  const st = await fs.stat(path.join(DIST, 'index.html'))
  if (st.isFile()) {
    app.use(express.static(DIST, { maxAge: '1h' }))
    app.get('*', (_, res) => res.sendFile(path.join(DIST, 'index.html')))
    console.log('serving frontend from', DIST)
  }
} catch { /* no dist – API-only mode */ }

app.listen(PORT, () => console.log(`backend on :${PORT}`))
