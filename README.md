# Genius Trading Web

A personal-use, multi-market trading research dashboard built with **Next.js**, **React**, and **TypeScript**. It combines validated market data, rule-based technical analysis, multi-timeframe confirmation, and historical backtesting.

> **Research software only.** Genius Trading Web does not place trades, predict guaranteed outcomes, or establish that a strategy will be profitable in live markets.

## Table of contents

- [Features](#features)
- [Project status](#project-status)
- [Requirements](#requirements)
- [Getting started](#getting-started)
- [Environment configuration](#environment-configuration)
- [Development commands](#development-commands)
- [Application routes](#application-routes)
- [Signal and market-data rules](#signal-and-market-data-rules)
- [Backtesting methodology](#backtesting-methodology)
- [Out-of-sample validation](#out-of-sample-validation)
- [Robustness analysis](#robustness-analysis)
- [Known limitations](#known-limitations)
- [Security and trading safety](#security-and-trading-safety)
- [Development roadmap](#development-roadmap)

## Features

### Market dashboard

- Responsive dark dashboard with market selection, search, charts, watchlist preview, and analysis panels.
- Server-side Twelve Data integration; provider credentials are not exposed to browser code.
- Candle validation, chronological ordering checks, freshness metadata, and safe handling of stale or malformed data.
- EMA 50, EMA 200, RSI 14, and ATR 14 indicators.
- Rule-based trend classification and a visible market-data status.

### Rule-based signals

- Deterministic `BUY`, `SELL`, or `WAIT` decisions.
- Trend, indicator, data-freshness, and risk-plan safety gates.
- Explainable reasons and invalidation context.
- Signals are blocked when required data is missing, stale, malformed, insufficient, neutral, or conflicting.

### Multi-timeframe confirmation

Actionable signals require confirmation from the mapped higher timeframes:

| Selected timeframe | Required higher timeframes |
| --- | --- |
| 1 minute | 5 minutes and 15 minutes |
| 5 minutes | 15 minutes and 1 hour |
| 15 minutes or 30 minutes | 1 hour and 4 hours |
| 1 hour | 4 hours and 1 day |
| 4 hours | 1 day and 1 week |
| 1 day | 1 week |

Confirmation uses completed higher-timeframe candles only and is tied to the selected instrument and interval. Conflicting or unavailable confirmation blocks an actionable signal.

### Backtesting Lab

Open `/backtest` to run historical simulations with configurable:

- Starting balance and risk percentage.
- Spread, slippage, and per-side fees.
- Maximum holding period.
- Optional UTC start and end dates.
- Optional chronological in-sample / out-of-sample validation.

The report includes net P/L, return, win rate, profit factor, expectancy per trade and in risk units (`R`), maximum marked-to-market drawdown, exposure, equity curve, and a trade log.

## Project status

The supplied baseline includes the core market-analysis workflow, multi-timeframe confirmation, backtesting, date-range controls, and chronological out-of-sample reporting. This working update adds transaction-cost sensitivity and a heuristic performance breakdown by market regime. Keep these new changes on a feature branch until the complete test suite, TypeScript, lint, and production build pass and the branch is merged.

## Requirements

- Node.js 20.9 or newer.
- npm.
- A valid Twelve Data API key for live market data and historical backtests.

## Getting started

```bash
npm ci
```

Create a local environment file from the example:

```bash
cp .env.example .env.local
```

Add the required provider key to `.env.local`, then start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

On Windows PowerShell, copy the example with:

```powershell
Copy-Item .env.example .env.local
```

## Environment configuration

Configure the Twelve Data API key in the server environment used by the market and backtesting routes. Check `.env.example` for the exact variable name expected by this repository.

- Never prefix server-only credentials with `NEXT_PUBLIC_`.
- Never commit `.env.local` or real API keys.
- Do not paste credentials into issue reports, screenshots, or logs.

## Development commands

Run the full verification set before opening or merging a pull request:

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
```

`npm test` runs the Vitest suite. A green test suite verifies only the behaviors covered by those tests; it is not evidence that a trading strategy is profitable.

## Application routes

| Route | Purpose |
| --- | --- |
| `/` | Market dashboard and rule-based analysis |
| `/backtest` | Historical backtesting, performance metrics, trade log, validation, and robustness reports |
| `/api/market` | Validated market-data retrieval; see `app/api/market/route.ts` for supported methods |
| `POST /api/backtest` | Historical data retrieval and backtest, validation, and robustness results |

The market-data API and backtesting endpoint use server-side environment configuration and should not return provider secrets to clients.

## Signal and market-data rules

- Validate OHLC values and chronological candle ordering before analysis.
- Reject unexpected future timestamps and do not present stale candles as fresh.
- Compute signals using only candles available at the decision time.
- Use the selected timeframe's required higher-timeframe confirmations.
- Block actionable signals when any required safety gate fails.
- Treat stops, targets, sizing, and signal quality as estimates, not guarantees.

### Higher-timeframe mapping

The `lib/multi-timeframe.ts` module defines the timeframe confirmation mapping. Its behavior is covered by `tests/multi-timeframe.test.ts`.

## Backtesting methodology

The backtesting engine is implemented in `lib/backtesting.ts`; its API is `POST /api/backtest`.

- Signals are evaluated at candle close; simulated entries occur at the next candle open.
- Higher-timeframe candles are eligible only after their full interval has closed by the decision timestamp.
- ATR-based stop-loss and take-profit levels, maximum holding duration, spread, slippage, and per-side fees are configurable.
- If a stop is crossed by a gap at the next candle open, the model uses the opening price before applying modeled execution costs.
- If stop-loss and take-profit are both touched in the same candle and intrabar order is unknown, the engine assumes stop-loss first.
- Date-range boundaries are interpreted as UTC calendar dates. Candles before the start date can warm up indicators but cannot trigger scored entries.
- A trade must close within the selected test window. Inspect the returned first/last candle timestamps and candle count to assess provider coverage.

### Metrics

- **Net P/L and return:** simulated account change after modeled trading costs.
- **Win rate:** proportion of closed trades with positive net P/L.
- **Profit factor:** gross winning net P/L divided by gross losing net P/L. A result with no losses is not proof of robustness.
- **Expectancy (R):** average net P/L divided by the initial risk amount for each trade.
- **Maximum drawdown:** largest peak-to-trough decline in the marked-to-market equity curve.
- **Exposure:** portion of the scored period spent in an open position.

Risk sizing is a generic price-unit simulation. Before interpreting absolute currency P/L, confirm contract size, pip value, lot step, leverage, and fee conventions for each instrument.

## Out-of-sample validation

The Backtesting Lab can split the scored history chronologically into a 70% in-sample period and a final 30% out-of-sample holdout. Earlier candles are retained only for indicator and higher-timeframe warm-up. The periods are scored independently from the configured initial balance.

The holdout report includes returns, net P/L, trade count, win rate, profit factor, expectancy in `R`, and maximum drawdown. It also includes:

- A long-only, price-only buy-and-hold reference.
- A no-trade baseline with zero modeled return.

The buy-and-hold reference does not fully match a leveraged or short-capable strategy: it excludes transaction costs, financing, dividends, and instrument-specific contract sizing.

**Preserve the holdout.** Do not tune rules or settings after inspecting holdout results and then continue to call the same period an independent test. If holdout results influence a strategy change, reserve a later, untouched period for fresh validation.

## Robustness analysis

The robustness module (`lib/robustness-analysis.ts`) adds two research views to the Backtesting Lab.

### Transaction-cost sensitivity

The same input history is replayed with:

1. Baseline configured spread, slippage, and fees.
2. Those costs scaled to `1.5×`.
3. Those costs scaled to `2×`.

This helps assess whether apparent performance is fragile to higher modeled execution costs. It does not model variable spreads, order-book depth, swaps/funding, partial fills, or broker-specific contract rules.

### Performance by heuristic market regime

Closed trades are grouped by a simple historical price-action classification:

- **Trending:** high directional efficiency.
- **Ranging:** low directional efficiency.
- **Mixed:** intermediate directional efficiency.
- **High volatility:** recent absolute price changes exceed a heuristic threshold relative to the sample.

The classification is descriptive and heuristic. It is not an official market-state label, a predictive feature, or a guarantee that the strategy behaves similarly in future conditions. Small trade counts should be treated as weak evidence; the UI includes warnings when the sample is limited.

## Known limitations

- Historical availability and request limits depend on the configured Twelve Data plan, symbol, interval, and market sessions.
- The engine is bar-based and cannot reconstruct every intrabar price path.
- It does not fully model order-book depth, variable spreads, swaps/funding, dividends, broker-specific contract sizing, partial fills, or latency.
- The initial benchmark is a simplified reference and may not be economically comparable for all instruments.
- Heuristic regime classifications can be unstable on short histories.
- Passing software tests does not establish profitability, statistical significance, or live-trading readiness.
- The application does not execute trades.

## Security and trading safety

- Keep provider and optional AI credentials server-side.
- Never commit `.env.local` or API keys.
- Do not create actionable signals from stale, malformed, conflicting, or insufficient data.
- Verify API rate limits and provider quotas before running many backtests.
- Inspect individual simulated trades and returned candle coverage before interpreting aggregate metrics.
- Paper-test and independently validate strategies before considering any live use.

## Development roadmap

- [x] Market-data validation and freshness handling.
- [x] EMA, RSI, ATR, and rule-based trend analysis.
- [x] Multi-timeframe confirmation.
- [x] Historical backtesting with configurable modeled costs.
- [x] UTC date-range filtering and execution safeguards.
- [x] Chronological out-of-sample validation and basic benchmark reporting.
- [ ] Complete verification and merge of the robustness-analysis feature branch.
- [ ] Add further property tests for no-look-ahead behavior, fills, and cost assumptions.
- [ ] Add richer robustness studies and independent forward/paper testing.
- [ ] Review persistence, user preferences, deployment, observability, and release hardening.

---

**Genius Trading Web is a research tool, not financial advice or an automated trading system.** All simulations are estimates based on historical data and explicit assumptions; future results may differ materially.
