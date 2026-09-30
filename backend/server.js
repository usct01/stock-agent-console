import express from 'express'
import cors from 'cors'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyzeTA, sentimentOf, scoreTicker, assessRisk, annualRows, computeFys } from './lib/analysis.js'
import { resolveCompany, datasetStats } from './lib/resolve.js'

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
  JPM: '0000019617', BAC: '0000070858', WFC: '0000072971', C: '0000831001',
  GS: '0000886982', MS: '0000895421', KO: '0000021344', JNJ: '0000200406', PG: '0000080424',
}
// Company-name → ticker resolution over backend/data/tickers.json
// (NASDAQ + NYSE + AMEX with S&P 500 flags). Falls back to raw input.
const resolveTicker = (t) => resolveCompany(t)?.symbol || t
const REPORTS_FILE = path.join(ROOT, '.opencode', 'cache', 'reports', 'history.jsonl')

async function appendHistory(record) {
  try {
    await fs.mkdir(path.dirname(REPORTS_FILE), { recursive: true })
    let lines = []
    try { lines = (await fs.readFile(REPORTS_FILE, 'utf8')).split('\n').filter(Boolean) } catch { /* first run */ }
    lines.push(JSON.stringify(record))
    await fs.writeFile(REPORTS_FILE, lines.slice(-200).join('\n') + '\n')
  } catch { /* history best-effort */ }
}

async function readHistory(limit = 20) {
  try {
    const lines = (await fs.readFile(REPORTS_FILE, 'utf8')).split('\n').filter(Boolean)
    return lines.slice(-limit).map((l) => JSON.parse(l)).reverse()
  } catch { return [] }
}
const AGENTS = [
  { id: 'finance-news', title: 'Finance News' },
  { id: 'technical-analysis', title: 'Technical Analysis' },
  { id: 'fundamental-analysis', title: 'Fundamental Analysis' },
  { id: 'earnings', title: 'Earnings' },
  { id: 'sentiment', title: 'Sentiment' },
  { id: 'screener', title: 'Screener' },
  { id: 'risk-analysis', title: 'Risk Analysis' },
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
  if (!cik) return { filings: [], note: 'CIK unknown – SEC skipped' }
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
  if (!cik) return { fys: [], note: 'CIK unknown – fundamentals skipped' }
  const cacheFile = path.join(FA_CACHE, `${ticker}.json`)
  try {
    const st = await fs.stat(cacheFile)
    if (Date.now() - st.mtimeMs < 24 * 3600 * 1000) {
      return { ...(await JSON.parse(await fs.readFile(cacheFile, 'utf8'))), cached: true }
    }
  } catch { /* miss → fetch */ }
  const d = await getJSON(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, SEC_UA)
  const tags = d.facts?.['us-gaap'] || {}
  const byFy = {}
  const put = (key, rows) => rows.forEach((r) => { (byFy[r.fy] ??= { fy: r.fy }).end = r.end; byFy[r.fy][key] = r.val })
  put('rev', annualRows(tags, ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet']))
  put('ni', annualRows(tags, ['NetIncomeLoss']))
  put('equity', annualRows(tags, ['StockholdersEquity']))
  put('assets', annualRows(tags, ['Assets']))
  put('debt', annualRows(tags, ['LongTermDebtNoncurrent']))
  put('cash', annualRows(tags, ['CashAndCashEquivalentsAtCarryingValue']))
  const fysAll = computeFys(byFy)
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

app.get('/api/health', (_, res) => res.json({ ok: true, time: new Date().toISOString() }))
app.get('/api/agents', (_, res) => res.json({ agents: AGENTS }))
app.get('/api/resolve', (req, res) => {
  const q = String(req.query.q || '')
  const result = resolveCompany(q)
  res.json({ query: q, result, dataset: datasetStats() })
})
app.get('/api/reports', async (req, res) => {
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '20', 10) || 20))
  res.json({ reports: await readHistory(limit) })
})

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
        // Yahoo exchangeName: NMS→NASDAQ, NYQ→NYSE, ASE/AMX→AMEX. GF pages are per-exchange.
        const x = item.quote?.exchangeName || ''
        const xchg = /NYQ/.test(x) ? 'NYSE' : /ASE|AMX/.test(x) ? 'AMEX' : 'NASDAQ'
        item.news = await gfNews(t, xchg)
      }
      if (want.has('sentiment')) item.sentiment = sentimentOf(item.news || [])
      if (item.ta) {
        item.risk = assessRisk({
          ta: item.ta,
          fys: item.fa?.fys,
          pe: item.quote?.trailingPE ?? null,
          closes: item.series?.closes,
        })
      }
      results.push(item)
    }
    const screener = results
      .filter((r) => r.ta)
      .map((r) => {
        const { ta } = r
        const s = scoreTicker(ta)
        return { ticker: r.ticker, price: ta.last.c, score: s, rsi: ta.rsi == null ? null : +ta.rsi.toFixed(1), vsSMA50: ta.sma50 == null ? null : +(((ta.last.c / ta.sma50) - 1) * 100).toFixed(2), rvol: ta.rvol == null ? null : +ta.rvol.toFixed(2), risk: r.risk?.score ?? null, rating: r.risk?.rating ?? null }
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
      if (r.risk) lines.push(`${r.risk.marker}.`)
      if (r.errors.length) lines.push(`Notes: ${r.errors.join(' | ')}`)
      lines.push('Not financial advice.', '')
    }
    const payload = { asOf, range, results, screener, markdown: lines.join('\n'), notes: ['Quotes/TA: Yahoo live.', 'Filings + FY fundamentals: SEC EDGAR (facts cached 24h; www.sec.gov may 403 on shared IPs).', 'Risk: deterministic 0-100 (leverage/liquidity/profitability/valuation/volatility/RSI).', 'News: Google Finance page scrape, best-effort.', 'Estimates need websearch – run @earnings in opencode for those.', 'GDELT skipped server-side (throttled); sentiment from headlines only.'] }
    appendHistory({ id: `${Date.now()}-${tickers.join('')}`, asOf, tickers, range, screener, risks: results.filter((r) => r.risk).map((r) => ({ ticker: r.ticker, ...r.risk })), markdown: payload.markdown })
    res.json(payload)
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
