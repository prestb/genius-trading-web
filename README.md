Genius — Trading Intelligence Roadmap
Last reviewed: 14 October 2026
Current milestone: Live market data and baseline technical analysis are working.
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
Design historical candle retrieval/storage with symbol, interval, provider, and timestamp provenance.
[ ]
Build a backtesting engine using only information available at each simulated decision time.
[ ]
Include realistic fees, spread/slippage assumptions, stop/target handling, and unfilled/ambiguous candle cases.
[ ]
Report sample size, win rate, expectancy, profit factor, maximum drawdown, and risk-adjusted results.
[ ]
Prevent look-ahead bias and data leakage; compare results with a simple baseline.
[ ]
Add out-of-sample evaluation and paper/forward testing before treating any strategy as usable.
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
Complete Phase 1 verification and tests before building the signal engine. First run the project checks in Codespaces, then add focused tests for the market API and freshness/validation rules. This establishes a trustworthy base for any later trading signals.
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

