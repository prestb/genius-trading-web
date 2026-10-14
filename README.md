# Genius — Trading Intelligence (Starter)

A Next.js + TypeScript starter interface inspired by the reference screenshot.

## Current status
- Responsive dark dashboard and navigation
- Market category selector and instrument search
- Watchlist toggles (client-side preview state)
- Candlestick-style illustration for layout preview only
- Explicit demo labels; no fake live prices or trading signals
- Placeholder configuration for market-data, AI and database integrations

## Requirements
- Node.js 20.9+ (recommended: current Node.js LTS)
- npm

## Run locally
```bash
npm install
cp .env.example .env.local
npm run dev
```
Then open http://localhost:3000.

## Next implementation steps
1. Configure a market-data provider and implement a server-only adapter.
2. Add validated OHLCV candle types and freshness checks.
3. Implement/test indicators (EMA, RSI, ATR, momentum, support/resistance).
4. Add a server-side AI analysis route with structured output and strict input validation.
5. Persist settings, watchlist and signal history in a database.
6. Backtest and forward-test before relying on any signal.

## Security
- Never commit `.env.local`.
- Never expose market-data or AI API keys in browser code.
- Do not use the illustrative chart as real market data.
- This app does not place trades or guarantee outcomes.
