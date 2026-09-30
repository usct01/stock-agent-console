// One-shot seed: builds backend/data/tickers.json from free sources (no keys).
//   - NASDAQ / NYSE / AMEX listings: api.nasdaq.com screener (paginated)
//   - S&P 500 membership: Wikipedia constituents table
// Run: node scripts/build-tickers.mjs   (takes ~1 min, polite sleeps included)
import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(DIR, '..', 'data')
const UA = 'Mozilla/5.0'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.json()
}

// Nasdaq uses BRK/B style; Yahoo needs BRK-B.
const yahooSym = (s) => s.toUpperCase().replace(/\//g, '-')
const flatSym = (s) => s.toUpperCase().replace(/[./-]/g, '')

async function fetchExchange(exchange) {
  const out = []
  let offset = 0
  for (;;) {
    const d = await getJson(
      `https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=2000&offset=${offset}&exchange=${exchange}`,
    )
    const rows = d?.data?.table?.rows || []
    for (const r of rows) {
      if (!r.symbol || !r.name) continue
      out.push({ s: yahooSym(r.symbol), n: r.name.trim(), x: exchange })
    }
    const total = d?.data?.totalrecords || 0
    offset += rows.length
    console.log(`${exchange}: ${offset}/${total}`)
    if (!rows.length || offset >= total) break
    await sleep(1500)
  }
  return out
}

function parseSp500(html) {
  // First wikitable.sortable = constituents: rows <tr><td>SYM</td><td>Security</td>...
  const table = html.split('<table class="wikitable sortable')[1]?.split('</table>')[0] || ''
  const set = new Set()
  for (const row of table.split('<tr').slice(1)) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
      .map((m) => m[1].replace(/<[^>]+>/g, '').replace(/&[^;]+;/g, '').trim())
    if (cells.length >= 2 && /^[A-Za-z0-9.\-/]+$/.test(cells[0])) set.add(flatSym(cells[0]))
  }
  return set
}

const all = []
for (const ex of ['nasdaq', 'nyse', 'amex']) {
  all.push(...(await fetchExchange(ex)))
  await sleep(1500)
}
console.log('listings:', all.length)

const res = await fetch('https://en.wikipedia.org/wiki/List_of_S%26P_500_companies', {
  headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000),
})
if (!res.ok) throw new Error(`Wikipedia HTTP ${res.status}`)
const sp = parseSp500(await res.text())
console.log('sp500:', sp.size)

const seen = new Set()
const tickers = []
for (const t of all) {
  if (seen.has(t.s)) continue
  seen.add(t.s)
  tickers.push({ ...t, sp: sp.has(flatSym(t.s)) ? 1 : 0 })
}
tickers.sort((a, b) => (a.s < b.s ? -1 : 1))

await mkdir(OUT, { recursive: true })
await writeFile(path.join(OUT, 'tickers.json'), JSON.stringify(tickers))
await writeFile(
  path.join(OUT, 'tickers.meta.json'),
  JSON.stringify({
    asOf: new Date().toISOString(),
    total: tickers.length,
    sp500: tickers.filter((t) => t.sp).length,
    byExchange: Object.fromEntries(['nasdaq', 'nyse', 'amex'].map((x) => [x, tickers.filter((t) => t.x === x).length])),
    sources: ['api.nasdaq.com screener', 'en.wikipedia.org S&P 500 constituents'],
  }, null, 2),
)
console.log('wrote', tickers.length, 'tickers,', tickers.filter((t) => t.sp).length, 'in S&P 500')
