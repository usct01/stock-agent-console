# AGENTS.md — repo instructions for opencode

## What this is
Stock analysis console: React frontend (`frontend/`), Express backend (`backend/` API + serves the built frontend),
and opencode subagents (`.opencode/agent/`) for deep analysis. No API keys anywhere. No Docker.

## Agents (`.opencode/agent/`, `mode: subagent`, restart opencode after editing)
- `finance-news` – quotes + headlines (Google Finance page, Yahoo chart fallback). GDELT deactivated (shared-IP throttling).
- `technical-analysis` – SMA/EMA, RSI Wilder, MACD, Bollinger, ATR, Stochastic, OBV, Fib, candles. Yahoo `range/interval`, cache `.opencode/cache/ta/` 30m.
- `fundamental-analysis` – SEC EDGAR filings-first (CIK map inside), companyfacts frame rule (YTD vs `CYxxxx[Qx[I]]`), cache `.opencode/cache/fa/` 24h.
- `earnings` – dates/actuals from SEC, estimates labelled unofficial (websearch).
- `sentiment` – GF headlines + GDELT with 60s backoff, cache `.opencode/cache/sentiment/` 2h.
- `screener` – deterministic -5..+5 rank, reuses TA cache.
- `orchestrator` – routes via Task tool (SEC sleep 1, Yahoo sleep 2, sentiment last), hands raw outputs to `aggregator`.
- `aggregator` – merges only, conflict rules (price→Yahoo live, RSI→TA, actuals→SEC).

## Backend (`backend/server.js`)
Mirrors the agents over HTTP: `GET /api/health`, `GET /api/agents`, `POST /api/run {tickers, agents, range}`.
Serves `frontend/dist` in production (single process). Free sources only: Yahoo chart, SEC `data.sec.gov`, Google Finance pages.
Known limits: `www.sec.gov` 403s on shared IPs (use `data.sec.gov` + hardcoded CIKs), GDELT throttles (skipped server-side),
`www.google.com/finance` pages are heavy (~1.5MB, regex headline extract). Estimates need websearch → opencode path.

## Frontend (`frontend/`, Vite React + lightweight-charts)
`/api` proxied to `:3001` in dev; same-origin in prod. Run report → table + per-ticker cards (TV candles, RSI pane, FA bars, news) → print-to-PDF.

## Rules
- Never commit `.opencode/cache/`, `node_modules/`, `dist/`, logs.
- Keep responses short; always "Not financial advice." on stock output.
- Validate `opencode.json` against https://opencode.ai/config.json before changing it.
