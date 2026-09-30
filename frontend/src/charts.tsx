import { useEffect, useRef, useState } from 'react'
import {
  createChart,
  CandlestickSeries,
  AreaSeries,
  LineSeries,
  HistogramSeries,
  type UTCTimestamp,
} from 'lightweight-charts'

export interface Series {
  dates: string[]
  closes: number[]
  opens?: (number | null)[]
  highs?: (number | null)[]
  lows?: (number | null)[]
  vols?: number[]
  sma20: (number | null)[]
  sma50: (number | null)[]
}

export interface FaFy {
  fy: string
  rev?: number
  ni?: number
  margin?: number | null
  revYoY?: number | null
  roe?: number | null
  de?: number | null
}

function day(t: string): UTCTimestamp {
  return Math.floor(new Date(t + 'T00:00:00Z').getTime() / 1000) as UTCTimestamp
}

function rsiSeries(closes: number[], p = 14): (number | null)[] {
  const out: (number | null)[] = closes.map(() => null)
  if (closes.length < p + 1) return out
  const g: number[] = [], l: number[] = []
  for (let i = 1; i < closes.length; i++) {
    g.push(Math.max(0, closes[i] - closes[i - 1]))
    l.push(Math.max(0, closes[i - 1] - closes[i]))
  }
  let ag = g.slice(0, p).reduce((a, b) => a + b, 0) / p
  let al = l.slice(0, p).reduce((a, b) => a + b, 0) / p
  out[p] = al === 0 ? 100 : 100 - 100 / (1 + ag / al)
  for (let i = p; i < g.length; i++) {
    ag = (ag * (p - 1) + g[i]) / p
    al = (al * (p - 1) + l[i]) / p
    out[i + 1] = al === 0 ? 100 : 100 - 100 / (1 + ag / al)
  }
  return out
}

const GRID = 'rgba(148,163,184,0.25)'
const TEXT = '#475569'

export function TvChart({ series, ticker }: { series: Series; ticker: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<'candles' | 'area'>('candles')
  const [sma, setSma] = useState(true)
  const [vol, setVol] = useState(true)
  const [ohlc, setOhlc] = useState('')

  const hasOhlc = !!series.opens?.length && !!series.highs?.length

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const chart = createChart(el, {
      height: 340,
      layout: { background: { color: '#ffffff' }, textColor: TEXT, attributionLogo: false },
      grid: { vertLines: { color: GRID }, horzLines: { color: GRID } },
      timeScale: { borderColor: GRID },
      rightPriceScale: { borderColor: GRID },
    })
    const main =
      style === 'candles' && hasOhlc
        ? chart.addSeries(CandlestickSeries, { upColor: '#16a34a', downColor: '#dc2626', wickUpColor: '#16a34a', wickDownColor: '#dc2626' })
        : chart.addSeries(AreaSeries, { lineColor: '#111827', topColor: 'rgba(17,24,39,0.25)', bottomColor: 'rgba(17,24,39,0.0)' })
    if (style === 'candles' && hasOhlc) {
      main.setData(
        series.dates.map((t, i) => ({
          time: day(t), open: series.opens![i] ?? series.closes[i], high: series.highs![i] ?? series.closes[i],
          low: series.lows![i] ?? series.closes[i], close: series.closes[i],
        })),
      )
    } else {
      main.setData(series.dates.map((t, i) => ({ time: day(t), value: series.closes[i] })))
    }
    if (sma) {
      const s20 = chart.addSeries(LineSeries, { color: '#2563eb', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false })
      s20.setData(series.dates.flatMap((t, i) => (series.sma20[i] == null ? [] : [{ time: day(t), value: series.sma20[i] as number }])))
      const s50 = chart.addSeries(LineSeries, { color: '#ea580c', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false })
      s50.setData(series.dates.flatMap((t, i) => (series.sma50[i] == null ? [] : [{ time: day(t), value: series.sma50[i] as number }])))
    }
    if (vol && series.vols?.length) {
      const vs = chart.addSeries(HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' } })
      chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })
      vs.setData(series.dates.map((t, i) => ({
        time: day(t), value: series.vols![i],
        color: (series.opens?.[i] ?? series.closes[i]) <= series.closes[i] ? 'rgba(22,163,74,0.5)' : 'rgba(220,38,38,0.5)',
      })))
    }
    const last = series.dates.length - 1
    setOhlc(
      hasOhlc
        ? `O ${series.opens![last]?.toFixed(2)} H ${series.highs![last]?.toFixed(2)} L ${series.lows![last]?.toFixed(2)} C ${series.closes[last].toFixed(2)}`
        : `C ${series.closes[last].toFixed(2)}`,
    )
    chart.subscribeCrosshairMove((param) => {
      const v = param.seriesData.get(main) as { open?: number; high?: number; low?: number; close?: number; value?: number } | undefined
      if (!v) return
      setOhlc(v.close != null && v.open != null ? `O ${v.open.toFixed(2)} H ${v.high!.toFixed(2)} L ${v.low!.toFixed(2)} C ${v.close.toFixed(2)}` : `C ${(v.value ?? v.close ?? 0).toFixed(2)}`)
    })
    chart.timeScale().fitContent()
    const ro = new ResizeObserver((es) => chart.applyOptions({ width: es[0].contentRect.width }))
    ro.observe(el)
    return () => { ro.disconnect(); chart.remove() }
  }, [series, style, sma, vol, hasOhlc])

  return (
    <figure className="chart">
      <div className="chart-bar">
        <span className="muted small">{ticker} · {ohlc}</span>
        <span className="toggles">
          <button className={style === 'candles' ? 'mini on' : 'mini'} onClick={() => setStyle('candles')}>Candles</button>
          <button className={style === 'area' ? 'mini on' : 'mini'} onClick={() => setStyle('area')}>Area</button>
          <button className={sma ? 'mini on' : 'mini'} onClick={() => setSma(!sma)}>SMA</button>
          <button className={vol ? 'mini on' : 'mini'} onClick={() => setVol(!vol)}>Vol</button>
        </span>
      </div>
      <div ref={ref} className="tv" />
      <div className="muted small">Drag to pan · scroll to zoom · hover for OHLC crosshair.</div>
    </figure>
  )
}

export function RsiChart({ closes, dates }: { closes: number[]; dates: string[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const vals = rsiSeries(closes)
  const last = vals.filter((v): v is number => v != null).pop()
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const chart = createChart(el, {
      height: 140,
      layout: { background: { color: '#ffffff' }, textColor: TEXT, attributionLogo: false },
      grid: { vertLines: { color: GRID }, horzLines: { color: GRID } },
      timeScale: { visible: false },
      rightPriceScale: { borderColor: GRID },
    })
    const line = chart.addSeries(LineSeries, { color: '#7c3aed', lineWidth: 2, priceLineVisible: false, lastValueVisible: true })
    line.setData(dates.flatMap((t, i) => (vals[i] == null ? [] : [{ time: day(t), value: vals[i] as number }])))
    line.createPriceLine({ price: 70, color: '#dc2626', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'overbought' })
    line.createPriceLine({ price: 30, color: '#16a34a', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'oversold' })
    chart.timeScale().fitContent()
    const ro = new ResizeObserver((es) => chart.applyOptions({ width: es[0].contentRect.width }))
    ro.observe(el)
    return () => { ro.disconnect(); chart.remove() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closes.join(','), dates.join(',')])
  const zone = last == null ? 'n/a' : last > 70 ? 'Overbought' : last < 30 ? 'Oversold' : last >= 55 ? 'Bullish zone' : last < 45 ? 'Bearish zone' : 'Neutral'
  return (
    <figure className="chart">
      <div className="chart-bar"><span className="muted small">RSI(14) · {last?.toFixed(1) ?? 'n/a'} · {zone}</span></div>
      <div ref={ref} className="tv" />
    </figure>
  )
}

export function FaBars({ fys, ticker }: { fys: FaFy[]; ticker: string }) {
  const [view, setView] = useState<'rev' | 'prof'>('rev')
  if (!fys?.length) return <p className="muted">Fundamentals n/a for {ticker} (SEC facts missing).</p>
  const w = 640, h = 200, pad = 30
  const label = (fy: string) => (fy.length === 2 ? `20${fy}` : fy)
  const rows = view === 'rev'
    ? fys.map((f) => ({ fy: f.fy, a: f.rev || 0, b: f.ni || 0, unit: 1e9, prefix: '$', suffix: 'B', sub: f.margin != null ? `${(f.margin * 100).toFixed(0)}% margin` : '' }))
    : fys.map((f) => ({ fy: f.fy, a: (f.margin || 0) * 100, b: (f.roe || 0) * 100, unit: 1, prefix: '', suffix: '%', sub: f.de != null ? `D/E ${f.de.toFixed(2)}` : '' }))
  const max = Math.max(...rows.flatMap((r) => [r.a, r.b]), 1)
  const bw = (w - 2 * pad) / rows.length
  return (
    <figure className="chart">
      <div className="chart-bar">
        <span className="muted small">{ticker} FY {view === 'rev' ? 'revenue vs net income' : 'margin vs ROE'}</span>
        <span className="toggles">
          <button className={view === 'rev' ? 'mini on' : 'mini'} onClick={() => setView('rev')}>Revenue</button>
          <button className={view === 'prof' ? 'mini on' : 'mini'} onClick={() => setView('prof')}>Profitability</button>
        </span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${ticker} fundamentals chart`}>
        {[0.5, 1].map((f) => {
          const y = pad + (1 - f) * (h - 2 * pad)
          return <line key={f} x1={pad} x2={w - pad} y1={y} y2={y} className="grid" />
        })}
        {rows.map((r, i) => {
          const x = pad + i * bw + bw * 0.2
          const ah = (r.a / max) * (h - 2 * pad)
          const bh = (r.b / max) * (h - 2 * pad)
          return (
            <g key={r.fy}>
              <rect x={x} y={h - pad - ah} width={bw * 0.28} height={ah} className="bar rev">
                <title>{`FY${label(r.fy)}: ${r.prefix}${((rows[i].a * 1) / (view === 'rev' ? 1e9 : 1)).toFixed(1)}${r.suffix} ${r.sub}`}</title>
              </rect>
              <rect x={x + bw * 0.32} y={h - pad - bh} width={bw * 0.28} height={bh} className="bar ni">
                <title>{`FY${label(r.fy)}: second series ${(r.b / (view === 'rev' ? 1e9 : 1)).toFixed(1)}${r.suffix}`}</title>
              </rect>
              <text x={x + bw * 0.3} y={h - 14} className="tick">FY{label(r.fy)}</text>
            </g>
          )
        })}
      </svg>
      <table>
        <thead><tr><th>FY</th><th>Rev YoY</th><th>Margin</th><th>ROE</th><th>LT D/E</th></tr></thead>
        <tbody>
          {fys.map((f) => (
            <tr key={f.fy}>
              <td>{label(f.fy)}</td>
              <td>{f.revYoY == null ? 'n/a' : `${(f.revYoY * 100).toFixed(1)}%`}</td>
              <td>{f.margin == null ? 'n/a' : `${(f.margin * 100).toFixed(1)}%`}</td>
              <td>{f.roe == null ? 'n/a' : f.roe.toFixed(2)}</td>
              <td>{f.de == null ? 'n/a' : f.de.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
