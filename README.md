Genius — Trading Intelligence Roadmap
Last reviewed: 14 October 2026
Current milestone: Multi-timeframe confirmation is implemented; the historical backtesting engine and research page are now prepared for verification.
Genius is a personal-use, multi-market trading research dashboard built with Next.js and TypeScript. It helps inspect market data and evaluate analysis before a trading decision. It does not place trades or guarantee outcomes.
Current status
The user confirmed that the clock/status control opens successfully and displays the latest candle time, candle age, freshness result, and last API retrieval time. The previous Invalid Hook Call error in that status area is no longer appearing.
Completed
[x]
Responsive dark dashboard, navigation, market selector, search, chart, watchlist preview, and analysis panels.
[x]
Server-side Twelve Data adapter at app/api/market/route.ts; the API key is read from server environment configuration, not browser code.
[x]
Supported interval and symbol validation, UTC candle requests, and retrieval of up to 250 candles.
[x]
OHLC candle validation, chronological timestamp checks, and freshness metadata (latestCandleAt, candleAgeSeconds, isFresh, retrievedAt).
[x]
Reject malformed candle data and unexpected future timestamps; do not treat stale data as fresh.
[x]
Technical indicators implemented: EMA 50, EMA 200, RSI 14, and ATR 14.
[x]
Rule-based trend classification (bullish, bearish, neutral, or insufficient data) and market-data validation checks.
[x]
Clock/status UI wired to market freshness metadata; user-confirmed runtime check shows a fresh candle and retrieval timestamp.
[x]
Previous Invalid Hook Call in the freshness/status area resolved, according to the user's latest runtime check.
Remaining roadmap
Phase 1 — Stabilize and verify the data foundation
[ ]
Run TypeScript, ESLint, and production-build checks on the current Codespaces working tree.
[ ]
Add automated tests for symbol/interval validation, malformed OHLC candles, chronological ordering, stale candles, future timestamps, and API/provider failures.
[ ]
Verify freshness thresholds against each supported interval and explain provider/session delays clearly in the UI.
[ ]
Confirm that a failed or stale refresh never leaves old candles presented as current.
[ ]
Review Twelve Data plan limits, rate-limit responses, timeout handling, and safe error messages.
Phase 2 — Formalize the analysis engine
[ ]
Define typed, versioned analysis input/output contracts.
[ ]
Combine validated candles, EMA 50/200, RSI 14, ATR 14, and trend checks in one server-side analysis pipeline.
[ ]
Add deterministic BUY / SELL / WAIT (no-trade) candidate rules with explicit reasons and confidence/quality gates; never emit a directional signal from stale or invalid data.
[ ]
Add risk calculations: proposed entry, stop-loss, take-profit, risk/reward ratio, and position-sizing inputs. Make clear that these are estimates, not guarantees.
[ ]
Show signal rationale, invalidation conditions, data timestamp, and the difference between trend context and an actionable setup.
[ ]
Keep AI assistance optional and subordinate to validated data, deterministic checks, and explicit risk controls.
Phase 3 — Historical data and backtesting
[ ]
Verify the historical backtesting API against the configured Twelve Data plan and provider rate limits.
[x]
Build a deterministic backtesting engine that evaluates signals at candle close and enters at the next candle open.
[x]
Include configurable spread, slippage, per-side fees, ATR-based stops/targets, max holding period, and conservative stop-first handling for ambiguous candles.
[x]
Report sample size, win rate, expectancy, profit factor, marked-to-market maximum drawdown, average win/loss, and exposure.
[x]
Exclude incomplete higher-timeframe candles at each simulated decision time and block trades without aligned higher-timeframe confirmation.
[ ]
Add unit/property tests for no-look-ahead behavior, fills, metrics, and cost assumptions; run the full project checks.
[ ]
Add out-of-sample evaluation, benchmark comparison, and paper/forward testing before treating any strategy as usable.
Phase 4 — Persistence and user settings
[ ]
Select and configure a database and server-side access layer.
[ ]
Persist user preferences, watchlists, selected symbols/intervals, and analysis/signal history.
[ ]
Add authentication and authorization if the app is exposed beyond the user's private workspace.
[ ]
Define retention, migrations, backups, and error recovery.
Phase 5 — Reliability, security, and release
[ ]
Keep all provider/AI secrets server-side; ensure no secrets enter logs, browser responses, or committed files.
[ ]
Add structured server logging and basic observability without logging credentials.
[ ]
Test loading, empty, stale, provider-error, rate-limited, and offline states.
[ ]
Verify keyboard/mobile usability and chart readability.
[ ]
Configure deployment and environment variables; verify health, build, and runtime behavior in the deployed environment.
[ ]
Document known limitations and the fact that the app does not execute trades.
Recommended next task
Run the new backtesting suite, TypeScript, lint, and production build on a feature branch. Verify provider quotas and inspect several trades manually before relying on performance metrics. Then add out-of-sample splits and a buy-and-hold/flat baseline; backtest performance is research evidence, not a forecast.
Run locally
Requirements: Node.js 20.9+ and npm.
npm install
cp .env.example .env.local
npm run dev
Open http://localhost:3000.
Available checks:
npx tsc --noEmit
npm run lint
npm run build
Security and trading safety
Never commit .env.local or provider/API secrets.
Keep market-data and any AI API keys in server-side environment variables.
Do not generate actionable signals from stale, malformed, or insufficient data.
Backtest and forward-test strategies before relying on their output.
Genius is an analysis tool only; it does not place trades and does not guarantee results.

## Multi-timeframe confirmation

Actionable BUY/SELL signals now require the selected timeframe's required higher-timeframe trends to agree:

- 1min → 5min and 15min
- 5min → 15min and 1h
- 15min / 30min → 1h and 4h
- 1h → 4h and 1day
- 4h → 1day and 1week
- 1day → 1week

The market endpoint accepts `1week` and applies a freshness threshold of two weekly intervals. Missing, stale, invalid, insufficient, neutral, or conflicting higher-timeframe data blocks actionable signals and removes the risk plan. Confirmation is tied to the current symbol and selected interval. This is a conservative rule-based research gate, not a prediction or guarantee.

Dedicated regression coverage is in `tests/multi-timeframe.test.ts`.



Backtesting implementation notes
- Research page: `/backtest`; server endpoint: `POST /api/backtest`.
- The endpoint requests up to 1,000 historical candles for the selected interval and each required higher timeframe. It may consume multiple provider credits per run.
- Current baseline strategy: EMA 50/200 trend alignment, RSI 14 band, ATR 14 stop/target distances, and required higher-timeframe trend alignment.
- Risk sizing is a generic price-unit simulation. Confirm contract size, pip value, lot step, leverage, and fee conventions for each instrument before interpreting the absolute currency P/L.
- The engine does not submit trades, and a profitable backtest does not establish a future edge.
