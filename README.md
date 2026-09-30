# Stock Agent Console

Free stock-analysis console: pick tickers, run a report (quotes, technicals, fundamentals, news, screener),
visualize with TradingView-style interactive charts, print to PDF — or go deeper via opencode subagents.
**No API keys. No Docker. Not financial advice.**

## Quickstart

```bash
npm install          # workspaces: frontend + backend
npm run build        # build frontend into frontend/dist
npm start            # backend on :3001, serves API + frontend
```

Dev (two terminals):

```bash
npm run dev:backend   # :3001
npm run dev:frontend  # :5173, /api proxied to :3001
```

Open http://localhost:5173 (dev) or http://localhost:3001 (prod).

## What you get

- **Run report** – `POST /api/run {tickers, agents, range}` → comparison table, per-ticker cards
  (candles + volume + SMA, RSI pane, FY revenue/margin charts from SEC EDGAR, headlines, filings), screener rank, markdown + print-to-PDF.
- **Company names work** – `Equinix, NVIDIA` resolve to `EQIX, NVDA`.
- **opencode agents** (`.opencode/agent/`) – `finance-news`, `technical-analysis`, `fundamental-analysis`,
  `earnings`, `sentiment`, `screener`, plus `orchestrator` (routes) and `aggregator` (merges).
  Copy the app's generated prompt into opencode for estimates + full filing analysis.

## API

- `GET /api/health` – liveness (used by render.yaml)
- `GET /api/agents` – agent registry
- `POST /api/run` – `{tickers: ["AAPL","GOOG"], agents: [...], range: "6mo"}` (1–5 tickers, `1mo|3mo|6mo|1y`)

## Deploy (Render, no Docker)

Push to GitHub, then Render → New Web Service → select repo (reads `render.yaml`):
build `npm install && npm run build`, start `npm start`, health check `/api/health`.
Same single-process model works on Railway (`npm run build` + `npm start`).

## Known limits

- Estimates need web search (opencode `@earnings` path); backend marks them n/a.
- `www.sec.gov` 403s on some shared IPs (backend uses `data.sec.gov` + hardcoded CIKs).
- GDELT throttles aggressively (skipped server-side; opencode `@sentiment` uses 60s backoff).
- Daily bars only; Google Finance scrape is best-effort.

## Layout

```
frontend/          Vite React + lightweight-charts (TradingView charts)
backend/server.js  Express API + serves frontend/dist in prod
.opencode/agent/   opencode subagents (orchestrator, aggregator, 6 specialists)
```

## License

MIT
