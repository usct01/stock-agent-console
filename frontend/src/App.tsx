import { useEffect, useMemo, useState } from 'react'
import { AGENTS, FULL_SET, type AgentId } from './agents'
import { TvChart, RsiChart, FaBars, type Series, type FaFy } from './charts'
import './styles.css'

type Mode = 'full' | 'custom' | 'compare'

interface RunResult {
  ticker: string
  errors: string[]
  quote?: { regularMarketPrice?: number; regularMarketChangePercent?: number; fiftyTwoWeekHigh?: number; fiftyTwoWeekLow?: number }
  ta?: { last: { c: number }; sma20: number | null; sma50: number | null; rsi: number | null; atr: number; rvol: number; ret5: number; bias: string }
  bars?: number
  series?: Series
  fa?: { fys: FaFy[]; cached?: boolean }
  filings?: { form: string; filed: string; acc: string }[]
  news?: { title: string; url: string }[]
  sentiment?: { label: string }
  risk?: { score: number; rating: string; drivers: [string, string][]; marker: string }
}
interface RunResponse {
  asOf: string
  range: string
  results: RunResult[]
  screener: { ticker: string; price: number; score: number; rsi: number | null; vsSMA50: number | null; rvol: number; risk?: number | null; rating?: string | null }[]
  markdown: string
  notes: string[]
}
interface HistoryItem {
  id: string
  asOf: string
  tickers: string[]
  range: string
  screener: RunResponse['screener']
  risks: { ticker: string; rating: string; score: number; marker: string }[]
  markdown: string
}

function Badge({ children, tone }: { children: string; tone: 'up' | 'down' | 'flat' }) {
  return <span className={`badge ${tone}`}>{children}</span>
}

export default function App() {
  const [tickers, setTickers] = useState('AAPL, GOOG')
  const [mode, setMode] = useState<Mode>('full')
  const [range, setRange] = useState('6mo')
  const [selected, setSelected] = useState<AgentId[]>([...FULL_SET])
  const [copied, setCopied] = useState(false)
  const [running, setRunning] = useState(false)
  const [report, setReport] = useState<RunResponse | null>(null)
  const [runError, setRunError] = useState('')
  const [history, setHistory] = useState<HistoryItem[]>([])

  const loadHistory = async () => {
    try {
      const res = await fetch('/api/reports?limit=20')
      if (res.ok) setHistory(await res.json().then((d) => d.reports))
    } catch { /* history best-effort */ }
  }
  useEffect(() => { loadHistory() }, [])

  const parsed = useMemo(
    () =>
      tickers
        .split(/[,\s]+/)
        .map((t) => t.trim().toUpperCase())
        .filter(Boolean)
        .slice(0, 5),
    [tickers],
  )

  const effective: AgentId[] = useMemo(() => {
    if (mode === 'full') return [...FULL_SET, ...(parsed.length > 1 ? (['screener'] as AgentId[]) : [])]
    if (mode === 'compare') return ['screener', 'finance-news', 'technical-analysis']
    return selected
  }, [mode, selected, parsed.length])

  const toggle = (id: AgentId) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  const prompt = useMemo(() => {
    const t = parsed.join(', ') || 'AAPL'
    return `@orchestrator ${mode === 'full' ? 'full deep-dive' : mode} on ${t} using ${effective.join(', ')} (TA range ${range}). Run specialists in throttle order, then hand raw outputs to @aggregator.`
  }, [parsed, mode, effective, range])

  const plan = useMemo(() => {
    const steps: string[] = []
    if (effective.includes('fundamental-analysis') || effective.includes('earnings'))
      steps.push('1. fundamental-analysis + earnings (SEC, sleep 1 between calls)')
    if (effective.includes('finance-news') || effective.includes('technical-analysis'))
      steps.push('2. finance-news + technical-analysis (Yahoo, sleep 2 between tickers)')
    if (effective.includes('screener')) steps.push('3. screener (reuses TA cache, max 10 tickers)')
    if (effective.includes('sentiment')) steps.push('4. sentiment last (GDELT sleep 60, max 2 calls/ticker)')
    steps.push('5. aggregator merges raw outputs into one dashboard')
    return steps
  }, [effective])

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const runReport = async () => {
    setRunning(true)
    setRunError('')
    setReport(null)
    try {
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers: parsed, agents: effective, range }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setReport(data)
      loadHistory()
    } catch (e) {
      setRunError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="page">
      <header className="no-print">
        <h1>Stock Agent Console</h1>
        <p>Run report executes the backend pipeline (Yahoo + SEC + Google Finance) directly, or copy the prompt for deep opencode analysis.</p>
      </header>

      <section className="card no-print">
        <h2>1. Tickers + mode</h2>
        <label>
          Tickers or company names (max 5, comma separated — e.g. EQIX, NVDA or Equinix, NVIDIA)
          <input value={tickers} onChange={(e) => setTickers(e.target.value)} placeholder="AAPL, GOOG" />
        </label>
        <div className="row">
          <label>
            Mode
            <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
              <option value="full">Full deep-dive (orchestrator picks)</option>
              <option value="custom">Custom (I pick agents)</option>
              <option value="compare">Compare (screener-led)</option>
            </select>
          </label>
          <label>
            TA range
            <select value={range} onChange={(e) => setRange(e.target.value)}>
              <option value="1mo">1mo</option>
              <option value="3mo">3mo</option>
              <option value="6mo">6mo</option>
              <option value="1y">1y</option>
            </select>
          </label>
        </div>
      </section>

      <section className="card no-print">
        <h2>2. Agents {mode !== 'custom' && <span className="muted">(auto-selected, switch to Custom to edit)</span>}</h2>
        <div className="grid">
          {AGENTS.map((a) => (
            <label key={a.id} className={`agent ${effective.includes(a.id) ? 'on' : ''}`}>
              <input
                type="checkbox"
                checked={effective.includes(a.id)}
                disabled={mode !== 'custom'}
                onChange={() => toggle(a.id)}
              />
              <div>
                <strong>@{a.id}</strong>
                <div className="title">{a.title}</div>
                <div className="muted">{a.blurb}</div>
                <div className="muted small">{a.sources} · {a.keywords}</div>
              </div>
            </label>
          ))}
        </div>
        <div className="muted small">+ @orchestrator routes, @aggregator merges. Restart opencode after editing .opencode/agent/*.md.</div>
      </section>

      <section className="card no-print">
        <h2>3. Run plan</h2>
        <ol>{plan.map((p) => <li key={p}>{p}</li>)}</ol>
        <div className="row">
          <button onClick={runReport} disabled={running || !parsed.length}>
            {running ? 'Running agents…' : 'Run report'}
          </button>
          <button onClick={() => copy(prompt)}>{copied ? 'Copied!' : 'Copy opencode prompt'}</button>
        </div>
        <h2>Prompt for opencode (deep analysis)</h2>
        <pre className="prompt">{prompt}</pre>
      </section>

      <section className="card" id="report">
        <div className="report-head">
          <h2>4. Report {report && <span className="muted small">· {report.asOf} · {report.range}</span>}</h2>
          {report && (
            <div className="row no-print">
              <button onClick={() => window.print()}>Download PDF</button>
              <button onClick={() => copy(report.markdown)}>{copied ? 'Copied!' : 'Copy markdown'}</button>
            </div>
          )}
        </div>
        {runError && <p className="error">Backend error: {runError} (is the backend on :3001?)</p>}
        {!report && !running && !runError && (
          <p className="muted">No run yet — click Run report. Live quotes + TA + screener from the backend; deep FA/estimates still via the opencode prompt above.</p>
        )}
        {running && <p>Fetching Yahoo + SEC + Google Finance… (up to ~40s for 5 tickers with fundamentals)</p>}
        {report && (
          <>
            <table>
              <thead><tr><th>Ticker</th><th>Price</th><th>Day%</th><th>RSI</th><th>vs SMA50</th><th>Score</th><th>Risk</th></tr></thead>
              <tbody>
                {report.results.map((r) => {
                  const s = report.screener.find((x) => x.ticker === r.ticker)
                  const day = r.quote?.regularMarketChangePercent
                  return (
                    <tr key={r.ticker}>
                      <td><strong>{r.ticker}</strong></td>
                      <td>${r.quote?.regularMarketPrice?.toFixed(2) ?? r.ta?.last.c.toFixed(2) ?? 'n/a'}</td>
                      <td>{day == null ? 'n/a' : <Badge tone={day >= 0 ? 'up' : 'down'}>{`${day >= 0 ? '+' : ''}${day.toFixed(2)}%`}</Badge>}</td>
                      <td>{r.ta?.rsi != null ? r.ta.rsi.toFixed(1) : 'n/a'}</td>
                      <td>{s?.vsSMA50 == null ? 'n/a' : `${s.vsSMA50 >= 0 ? '+' : ''}${s.vsSMA50}%`}</td>
                      <td>
                        <span className="score-bar"><span className={`fill ${s && s.score >= 0 ? 'pos' : 'neg'}`} style={{ width: `${Math.abs(s?.score ?? 0) * 20}%` }} /></span>
                        {s?.score ?? 'n/a'}
                      </td>
                      <td>{r.risk ? <Badge tone={r.risk.rating === 'Low' ? 'up' : r.risk.rating === 'High' ? 'down' : 'flat'}>{`${r.risk.rating} ${r.risk.score}`}</Badge> : 'n/a'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {report.results.map((r) => (
              <article key={r.ticker} className="ticker-card">
                <h3>
                  {r.ticker} — ${r.quote?.regularMarketPrice?.toFixed(2) ?? r.ta?.last.c.toFixed(2) ?? 'n/a'}
                  {r.ta && <Badge tone={r.ta.bias.includes('Bullish') ? 'up' : r.ta.bias.includes('Bearish') ? 'down' : 'flat'}>{r.ta.bias}</Badge>}
                  {r.sentiment && <Badge tone={r.sentiment.label === 'Positive' ? 'up' : r.sentiment.label === 'Negative' ? 'down' : 'flat'}>{r.sentiment.label}</Badge>}
                  {r.risk && <Badge tone={r.risk.rating === 'Low' ? 'up' : r.risk.rating === 'High' ? 'down' : 'flat'}>{`Risk ${r.risk.rating} ${r.risk.score}/100`}</Badge>}
                </h3>
                {r.series && <TvChart series={r.series} ticker={r.ticker} />}
                {r.series && <RsiChart closes={r.series.closes} dates={r.series.dates} />}
                {r.ta && (
                  <p className="muted small">
                    SMA20 {r.ta.sma20 != null ? `$${r.ta.sma20.toFixed(2)}` : 'n/a'} · SMA50 {r.ta.sma50 != null ? `$${r.ta.sma50.toFixed(2)}` : 'n/a'} ·
                    ATR ${r.ta.atr.toFixed(2)} · RVOL {r.ta.rvol.toFixed(2)} · 5d {r.ta.ret5.toFixed(1)}% · {r.bars} bars
                    {r.quote?.fiftyTwoWeekHigh ? ` · 52w $${r.quote.fiftyTwoWeekLow?.toFixed(0)}–$${r.quote.fiftyTwoWeekHigh.toFixed(0)}` : ''}
                  </p>
                )}
                {r.fa && r.fa.fys.length > 0 && (
                  <>
                    <h4>Fundamentals (SEC EDGAR{r.fa.cached ? ', cached' : ', live'})</h4>
                    <FaBars fys={r.fa.fys} ticker={r.ticker} />
                  </>
                )}
                {r.filings && <p className="muted small">SEC: {r.filings.map((f) => `${f.form} filed ${f.filed}`).join('; ')}.</p>}
                {r.risk && (
                  <details>
                    <summary>Risk drivers ({r.risk.rating} {r.risk.score}/100)</summary>
                    <ul>{r.risk.drivers.map(([k, v]) => <li key={k}><strong>{k}:</strong> {v}</li>)}</ul>
                  </details>
                )}
                {r.news && r.news.length > 0 && (
                  <>
                    <h4>News</h4>
                    <ul>{r.news.slice(0, 5).map((n) => <li key={n.url}><a href={n.url} target="_blank" rel="noreferrer">{n.title}</a></li>)}</ul>
                  </>
                )}
                {r.errors.length > 0 && <p className="muted small">Notes: {r.errors.join(' | ')}</p>}
              </article>
            ))}
            <ul className="muted small">{report.notes.map((n) => <li key={n}>{n}</li>)}</ul>
            <details className="no-print">
              <summary>Markdown report</summary>
              <pre className="prompt">{report.markdown}</pre>
            </details>
            <p className="muted small">Not financial advice.</p>
          </>
        )}
      </section>

      <section className="card no-print">
        <div className="report-head">
          <h2>5. History</h2>
          <button onClick={loadHistory}>Refresh</button>
        </div>
        {history.length === 0 && <p className="muted">No past runs yet — reports persist here after each run (last 200 kept).</p>}
        {history.map((h) => (
          <details key={h.id}>
            <summary>
              {h.asOf.slice(0, 16).replace('T', ' ')} UTC · {h.tickers.join(', ')} ·{' '}
              {h.risks.map((r) => `${r.ticker} ${r.rating} ${r.score}`).join(' · ') || 'no risk scores'}
            </summary>
            <pre className="prompt">{h.markdown}</pre>
          </details>
        ))}
      </section>
    </div>
  )
}
