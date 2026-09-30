export type AgentId =
  | 'finance-news'
  | 'technical-analysis'
  | 'fundamental-analysis'
  | 'earnings'
  | 'sentiment'
  | 'screener'
  | 'risk-analysis'

export interface AgentMeta {
  id: AgentId
  title: string
  blurb: string
  sources: string
  keywords: string
}

export const AGENTS: AgentMeta[] = [
  { id: 'finance-news', title: 'Finance News', blurb: 'Live quotes + fresh headlines from Google Finance + Yahoo.', sources: 'Google Finance, Yahoo', keywords: 'news, price, headlines' },
  { id: 'technical-analysis', title: 'Technical Analysis', blurb: 'RSI, MACD, SMA/EMA, Bollinger, ATR, Stochastic, OBV, Fib + patterns.', sources: 'Yahoo (+Stooq fallback)', keywords: 'chart, trend, indicators' },
  { id: 'fundamental-analysis', title: 'Fundamental Analysis', blurb: 'Valuation, margins, growth, health from SEC EDGAR filings.', sources: 'SEC EDGAR, Yahoo', keywords: 'P/E, margins, 10-K' },
  { id: 'earnings', title: 'Earnings', blurb: 'Dates, actuals vs (unofficial) estimates, surprise + price reaction.', sources: 'SEC, Yahoo, websearch', keywords: 'EPS, quarter, guidance' },
  { id: 'sentiment', title: 'Sentiment', blurb: 'News/social tone with strict GDELT backoff (60s) + cache.', sources: 'GDELT, Google Finance', keywords: 'buzz, mood, tone' },
  { id: 'screener', title: 'Screener', blurb: 'Rank 2–10 tickers with deterministic -5..+5 rules.', sources: 'Yahoo + TA cache', keywords: 'screen, rank, compare' },
  { id: 'risk-analysis', title: 'Risk Analysis', blurb: 'Deterministic 0-100 rating from leverage, earnings, valuation, volatility, RSI.', sources: 'SEC + Yahoo (no key)', keywords: 'risk, rating, downside' },
]

export const FULL_SET: AgentId[] = [
  'finance-news',
  'technical-analysis',
  'fundamental-analysis',
  'earnings',
  'sentiment',
  'risk-analysis',
]
