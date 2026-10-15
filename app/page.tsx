"use client";

import { analyzePriceAction } from "../lib/price-action";
import { analyzeSignal } from "../lib/signal-analysis";
import { analyzeMultiTimeframe, getRequiredHigherTimeframes, type MultiTimeframeFrameInput } from "../lib/multi-timeframe";
import { calculateIndicators } from "../lib/indicators";
import {
  analyzeTrend,
  validateMarketData,
} from "../lib/trend-analysis";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bell,
  BrainCircuit,
  CandlestickChart,
  ChevronDown,
  CircleHelp,
  Clock3,
  LayoutDashboard,
  LineChart,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
} from "lucide-react";

type Market = "Forex" | "Crypto" | "Stocks" | "Indices";

type Candle = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

type MarketResponse = {
  source: string;
  symbol: string;
  interval: string;
  count: number;
  candles: Candle[];
  retrievedAt: string;
  latestCandleAt?: string;
  candleAgeSeconds?: number;
  isFresh?: boolean;
  error?: string;
};

const marketSymbols: Record<Market, string[]> = {
  Forex: ["EUR/USD", "GBP/USD", "USD/JPY", "EUR/GBP"],
  Crypto: ["BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD"],
  Stocks: ["AAPL", "NVDA", "MSFT", "TSLA"],
  Indices: ["SPX", "NDX", "DJI", "FTSE 100"],
};

const intervalMap: Record<string, string> = {
  "1m": "1min",
  "5m": "5min",
  "15m": "15min",
  "30m": "30min",
  "1h": "1h",
  "4h": "4h",
  "1D": "1day",
};

export default function Home() {
  const [market, setMarket] = useState<Market>("Forex");
  const [symbol, setSymbol] = useState("EUR/USD");
  const [timeframe, setTimeframe] = useState("15m");
  const [activeNav, setActiveNav] = useState("Overview");
  const [search, setSearch] = useState("");
  const [watchlist, setWatchlist] = useState<string[]>([
    "EUR/USD",
    "BTC/USD",
    "AAPL",
  ]);

  const [notice, setNotice] = useState(
    "Genius is connected to the market-data API. Signals require verified market data and confirmation."
  );

  const [candles, setCandles] = useState<Candle[]>([]);
  const [multiTimeframeFrames, setMultiTimeframeFrames] = useState<MultiTimeframeFrameInput[]>([]);
  const [loadingMarket, setLoadingMarket] = useState(false);
  const [marketError, setMarketError] = useState("");
  const [retrievedAt, setRetrievedAt] = useState("");
  const [marketDataIdentity, setMarketDataIdentity] = useState("");

  const [marketFreshness, setMarketFreshness] = useState<{
    latestCandleAt?: string;
    candleAgeSeconds?: number;
    isFresh?: boolean;
  } | null>(null);

  const [watchPrices, setWatchPrices] = useState<
    Record<string, { price: number; previous: number | null }>
  >({});

  const [refreshKey, setRefreshKey] = useState(0);

  // Technical indicators for the currently selected instrument.
  const indicators = useMemo(
    () => calculateIndicators(candles),
    [candles]
  );

  const trendAnalysis = useMemo(
    () =>
      analyzeTrend(
        candles.length > 0
          ? candles[candles.length - 1].close
          : null,
        indicators
      ),
    [candles, indicators]
  );

  const marketValidation = useMemo(
    () => validateMarketData(candles),
    [candles]
  );

  // Price action is evidence used by the signal engine, not a signal by itself.
  const priceAction = useMemo(
    () => analyzePriceAction({ candles }),
    [candles]
  );

  const selectedInterval = intervalMap[timeframe] || "15min";

  const multiTimeframeAnalysis = useMemo(
    () =>
      analyzeMultiTimeframe({
        symbol,
        selectedInterval,
        frames: multiTimeframeFrames,
      }),
    [symbol, selectedInterval, multiTimeframeFrames]
  );

  // A signal can only be actionable when the engine's required checks pass.
  const signalAnalysis = useMemo(
    () =>
      analyzeSignal({
        symbol,
        interval: selectedInterval,
        candles,
        indicators,
        trend: trendAnalysis,
        isFresh:
          marketDataIdentity === `${symbol}|${selectedInterval}` &&
          marketFreshness?.isFresh === true,
        candleAgeSeconds:
          marketFreshness?.candleAgeSeconds ?? null,
        priceAction,
        multiTimeframe: multiTimeframeAnalysis,
      }),
    [
      symbol,
      selectedInterval,
      candles,
      indicators,
      trendAnalysis,
      marketFreshness,
      marketDataIdentity,
      priceAction,
      multiTimeframeAnalysis,
    ]
  );

  // Fetch each required higher timeframe independently. A missing or stale
  // response remains a hard block in the signal engine.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const requiredIntervals = getRequiredHigherTimeframes(selectedInterval);

    setMultiTimeframeFrames([]);

    if (requiredIntervals.length === 0) {
      return () => {
        cancelled = true;
        controller.abort();
      };
    }

    async function loadHigherTimeframes() {
      const results = await Promise.all(
        requiredIntervals.map(async (interval) => {
          try {
            const params = new URLSearchParams({ symbol, interval });
            const response = await fetch(`/api/market?${params.toString()}`, {
              cache: "no-store",
              signal: controller.signal,
            });
            const data = (await response.json()) as MarketResponse;

            if (
              data.symbol !== symbol ||
              data.interval !== interval ||
              !Array.isArray(data.candles)
            ) {
              return null;
            }

            const frameCandles = data.candles;
            const frameIndicators = calculateIndicators(frameCandles);
            const latest = frameCandles.at(-1);
            const frameTrend = analyzeTrend(
              latest ? latest.close : null,
              frameIndicators
            );

            return {
              symbol,
              interval,
              candles: frameCandles,
              isFresh: response.ok && data.isFresh === true,
              candleAgeSeconds:
                typeof data.candleAgeSeconds === "number"
                  ? data.candleAgeSeconds
                  : null,
              direction: frameTrend.direction,
            } satisfies MultiTimeframeFrameInput;
          } catch {
            return null;
          }
        })
      );

      if (!cancelled) {
        setMultiTimeframeFrames(
          results.filter(
            (frame): frame is MultiTimeframeFrameInput => frame !== null
          )
        );
      }
    }

    void loadHigherTimeframes();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [symbol, selectedInterval, refreshKey]);

  // Load fresh prices for watchlist instruments.
  useEffect(() => {
    let cancelled = false;

    async function loadWatchlistPrices() {
      const symbols = Array.from(new Set([...watchlist, symbol]));

      const results = await Promise.all(
        symbols.map(async (item) => {
          try {
            const params = new URLSearchParams({
              symbol: item,
              interval: "15min",
            });

            const response = await fetch(
              `/api/market?${params.toString()}`
            );
            const data = await response.json();

            if (
              !response.ok ||
              data.isFresh !== true ||
              !Array.isArray(data.candles) ||
              data.candles.length === 0
            ) {
              return [item, null] as const;
            }

            const latest = data.candles[data.candles.length - 1];
            const previous =
              data.candles.length > 1
                ? data.candles[data.candles.length - 2]
                : null;

            const price = Number(latest.close);
            const previousPrice = previous
              ? Number(previous.close)
              : null;

            if (!Number.isFinite(price)) {
              return [item, null] as const;
            }

            return [
              item,
              {
                price,
                previous:
                  previousPrice !== null &&
                  Number.isFinite(previousPrice)
                    ? previousPrice
                    : null,
              },
            ] as const;
          } catch {
            return [item, null] as const;
          }
        })
      );

      if (cancelled) return;

      setWatchPrices((current) => {
        const next = { ...current };

        for (const [item, quote] of results) {
          if (quote) {
            next[item] = quote;
          }
        }

        return next;
      });
    }

    loadWatchlistPrices();

    return () => {
      cancelled = true;
    };
  }, [watchlist, symbol]);

  // Fetch candles through the server-side market-data endpoint.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function loadMarketData() {
      setLoadingMarket(true);
      setMarketError("");
      setCandles([]);
      setRetrievedAt("");
      setMarketDataIdentity("");
      setMarketFreshness(null);

      try {
        const params = new URLSearchParams({
          symbol,
          interval: intervalMap[timeframe] || "15min",
        });

        const response = await fetch(
          `/api/market?${params.toString()}`,
          {
            cache: "no-store",
            signal: controller.signal,
          }
        );

        const data = (await response.json()) as MarketResponse;

        if (!response.ok) {
          throw new Error(
            data.error || "Unable to load market data."
          );
        }

        if (data.isFresh !== true) {
          const age = Number.isFinite(data.candleAgeSeconds)
            ? ` Latest candle age: ${data.candleAgeSeconds} seconds.`
            : "";

          throw new Error(
            `Market data is stale or its freshness could not be verified.${age}`
          );
        }

        if (
          !Array.isArray(data.candles) ||
          data.candles.length === 0 ||
          !data.candles.every(
            (c) =>
              typeof c.time === "string" &&
              [c.open, c.high, c.low, c.close].every(
                (value) =>
                  typeof value === "number" &&
                  Number.isFinite(value)
              ) &&
              c.high >= Math.max(c.open, c.close, c.low) &&
              c.low <= Math.min(c.open, c.close, c.high)
          )
        ) {
          throw new Error(
            "The provider returned invalid market candles."
          );
        }

        if (!cancelled) {
          setCandles(data.candles);
          setRetrievedAt(data.retrievedAt || "");
          setMarketDataIdentity(`${symbol}|${intervalMap[timeframe] || "15min"}`);

          setMarketFreshness({
            latestCandleAt: data.latestCandleAt,
            candleAgeSeconds: data.candleAgeSeconds,
            isFresh: data.isFresh,
          });

          setNotice(
            `${data.source || "Market provider"} returned ${data.candles.length} candles for ${symbol}.`
          );
        }
      } catch (error) {
        if (
          !cancelled &&
          !(error instanceof Error && error.name === "AbortError")
        ) {
          setCandles([]);
          setRetrievedAt("");
          setMarketDataIdentity("");
          setMarketFreshness(null);

          setMarketError(
            error instanceof Error
              ? error.message
              : "Unable to load market data."
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingMarket(false);
        }
      }
    }

    loadMarketData();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [symbol, timeframe, refreshKey]);

  const symbols = marketSymbols[market];

  const visibleSymbols = useMemo(
    () =>
      symbols.filter((item) =>
        item.toLowerCase().includes(search.toLowerCase())
      ),
    [symbols, search]
  );

  const latestCandle =
    candles.length > 0
      ? candles[candles.length - 1]
      : undefined;

  const previousCandle =
    candles.length > 1
      ? candles[candles.length - 2]
      : undefined;

  const priceChange =
    latestCandle && previousCandle
      ? latestCandle.close - previousCandle.close
      : undefined;

  const priceChangePercent =
    previousCandle &&
    priceChange !== undefined &&
    previousCandle.close !== 0
      ? (priceChange / previousCandle.close) * 100
      : undefined;

  const priceDigits = symbol.includes("JPY") ? 3 : 5;

  const formattedPrice = latestCandle
    ? latestCandle.close.toFixed(priceDigits)
    : "—";

  const formattedChange =
    priceChangePercent === undefined
      ? "Awaiting candles"
      : `${priceChangePercent >= 0 ? "+" : ""}${priceChangePercent.toFixed(2)}% vs previous candle`;

  const formattedCandleTime = latestCandle
    ? latestCandle.time
    : "Unavailable";

  const connected = candles.length > 0 && !marketError;

  function changeMarket(next: Market) {
    setMarket(next);
    setSymbol(marketSymbols[next][0]);
    setSearch("");
  }

  function selectSymbol(item: string) {
    setSymbol(item);
    setNotice(`Loading market data for ${item}…`);
  }

  function toggleWatchlist(item: string) {
    setWatchlist((current) =>
      current.includes(item)
        ? current.filter((x) => x !== item)
        : [...current, item]
    );
  }

  function refreshMarket() {
    setRefreshKey((current) => current + 1);
  }

  function showFreshnessDetails() {
    const age =
      typeof marketFreshness?.candleAgeSeconds === "number"
        ? `${Math.floor(marketFreshness.candleAgeSeconds / 60)} minutes ${Math.floor(
            marketFreshness.candleAgeSeconds % 60
          )} seconds`
        : "Unavailable";

    const status =
      marketFreshness?.isFresh === true
        ? "Fresh"
        : marketFreshness?.isFresh === false
          ? "Stale"
          : "Unknown";

    setNotice(
      `Latest candle: ${marketFreshness?.latestCandleAt || "Unavailable"}. Candle age: ${age}. Status: ${status}. Last API retrieval: ${
        retrievedAt
          ? new Date(retrievedAt).toLocaleString()
          : "Unavailable"
      }.`
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Sparkles size={22} strokeWidth={2.4} />
          </div>
          <div>
            <div className="brand-name">GENIUS</div>
            <div className="brand-subtitle">
              TRADING INTELLIGENCE
            </div>
          </div>
        </div>

        <div className="workspace-label">WORKSPACE</div>

        <nav className="nav-list" aria-label="Main navigation">
          {[
            { label: "Overview", icon: LayoutDashboard },
            { label: "Markets", icon: CandlestickChart },
            { label: "AI Signal Lab", icon: BrainCircuit },
            { label: "Signal History", icon: Activity },
            { label: "Watchlist", icon: Star },
          ].map(({ label, icon: Icon }) => (
            <button
              key={label}
              className={`nav-item ${activeNav === label ? "active" : ""}`}
              onClick={() => setActiveNav(label)}
            >
              <Icon size={17} />
              <span>{label}</span>
              {label === "AI Signal Lab" && (
                <span className="nav-dot" />
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-spacer" />

        <div className="sidebar-card">
          <div className="sidebar-card-icon">
            <ShieldCheck size={18} />
          </div>
          <div className="sidebar-card-title">
            Analysis integrity
          </div>
          <p>
            Signals only use verified market data. No verified data,
            no actionable signal.
          </p>
          <span className="status-pill">
            <span className="status-dot" /> Guardrails enabled
          </span>
        </div>

        <button
          className="nav-item settings-button"
          onClick={() =>
            setNotice("Settings will be added in a later phase.")
          }
        >
          <Settings2 size={17} />
          <span>Settings</span>
        </button>

        <div className="profile-row">
          <div className="avatar">G</div>
          <div className="profile-copy">
            <strong>Personal workspace</strong>
            <span>Private account</span>
          </div>
          <ChevronDown size={15} className="muted-icon" />
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Workspace</span>
            <span className="crumb-slash">/</span>
            <strong>{activeNav}</strong>
          </div>

          <div className="topbar-actions">
            <div className="connection-status">
              <span
                className={`status-dot ${connected ? "" : "amber"}`}
              />
              {loadingMarket
                ? "Connecting…"
                : marketError
                  ? "Connection issue"
                  : connected
                    ? "Twelve Data connected"
                    : "Waiting for data"}
            </div>

            <button
              className="icon-button"
              aria-label="Market candle freshness details"
              title="Market candle freshness details"
              onClick={showFreshnessDetails}
            >
              <Clock3 size={18} />
            </button>

            <button
              className="icon-button"
              aria-label="Help"
              onClick={() =>
                setNotice(
                  "Genius provides rule-based technical and price-action research. A BUY or SELL result is not a guarantee of profit."
                )
              }
            >
              <CircleHelp size={18} />
            </button>

            <button
              className="icon-button"
              aria-label="Notifications"
              onClick={() =>
                setNotice(
                  "Notifications will be configured in a later phase."
                )
              }
            >
              <Bell size={18} />
            </button>

            <div className="top-avatar">G</div>
          </div>
        </header>

        <div className="content">
          <section className="welcome-row">
            <div>
              <div className="eyebrow">
                <span className="eyebrow-line" />
                PERSONAL MARKET TERMINAL
              </div>
              <h1>
                Market overview
                <span className="title-period">.</span>
              </h1>
              <p className="subtitle">
                Your market, your signals, your decisions.
              </p>
            </div>
          </section>

          <div className="demo-alert">
            <div className="alert-icon">
              <Activity size={16} />
            </div>
            <div>
              <strong>
                {marketError ? "Market data issue" : "Market data status"}
              </strong>
              <span>{marketError || notice}</span>
            </div>
            <button
              onClick={() =>
                setNotice("Genius market dashboard status.")
              }
              aria-label="Reset notice"
            >
              ×
            </button>
          </div>

          <section className="metric-grid">
            <div className="metric-card">
              <div className="metric-top">
                <span>Tracked markets</span>
                <span className="metric-icon">
                  <CandlestickChart size={16} />
                </span>
              </div>
              <div className="metric-value">
                {watchlist.length} <small>watchlist items</small>
              </div>
              <div className="metric-foot">
                Across your selected instruments
              </div>
            </div>

            <div className="metric-card">
              <div className="metric-top">
                <span>Current signal</span>
                <span className="metric-icon orange">
                  <BrainCircuit size={16} />
                </span>
              </div>
              <div className="metric-value">
                {signalAnalysis.direction}
              </div>
              <div className="metric-foot">
                {signalAnalysis.actionable
                  ? "All required signal gates passed"
                  : "Waiting for all required confirmations"}
              </div>
            </div>

            <div className="metric-card">
              <div className="metric-top">
                <span>Data connection</span>
                <span className="metric-icon">
                  <Activity size={16} />
                </span>
              </div>
              <div className="metric-value metric-status">
                {loadingMarket
                  ? "Connecting…"
                  : marketError
                    ? "Connection issue"
                    : candles.length > 0
                      ? "Connected"
                      : "Waiting"}
              </div>
              <div className="metric-foot">
                <span
                  className={`status-dot ${connected ? "" : "amber"}`}
                />
                {connected
                  ? `Twelve Data · ${symbol} feed`
                  : marketError
                    ? "Check market data connection"
                    : "Waiting for verified candles"}
              </div>
              <div className="metric-foot">
                <span
                  className={`status-dot ${connected ? "" : "amber"}`}
                />
                {connected
                  ? "Provider candles received"
                  : "Waiting for valid data"}
              </div>
            </div>

            <div className="metric-card">
              <div className="metric-top">
                <span>Analysis engine</span>
                <span className="metric-icon purple">
                  <Sparkles size={16} />
                </span>
              </div>
              <div className="metric-value metric-status">
                {loadingMarket
                  ? "Loading"
                  : signalAnalysis.actionable
                    ? "Confirmed"
                    : "Standby"}
              </div>
              <div className="metric-foot">
                Rule-based checks, not a win-probability estimate
              </div>
            </div>
          </section>

          <section
            className="panel"
            style={{ padding: "20px", marginBottom: "24px" }}
          >
            <div className="section-heading">
              <div>
                <h2>Technical indicators</h2>
                <p>
                  Calculated from the selected instrument&apos;s market
                  candles.
                </p>
              </div>
            </div>

            <div className="metric-grid">
              <div className="metric-card">
                <div className="metric-top">
                  <span>EMA 50</span>
                </div>
                <div className="metric-value">
                  {indicators.ema50 !== null
                    ? indicators.ema50.toFixed(priceDigits)
                    : "Not enough data"}
                </div>
                <div className="metric-foot">
                  Medium-term trend
                </div>
              </div>

              <div className="metric-card">
                <div className="metric-top">
                  <span>EMA 200</span>
                </div>
                <div className="metric-value">
                  {indicators.ema200 !== null
                    ? indicators.ema200.toFixed(priceDigits)
                    : "Need 200 candles"}
                </div>
                <div className="metric-foot">
                  Long-term trend
                </div>
              </div>

              <div className="metric-card">
                <div className="metric-top">
                  <span>RSI 14</span>
                </div>
                <div className="metric-value">
                  {indicators.rsi14 !== null
                    ? indicators.rsi14.toFixed(2)
                    : "Not enough data"}
                </div>
                <div className="metric-foot">
                  {indicators.rsi14 === null
                    ? "Momentum unavailable"
                    : indicators.rsi14 >= 70
                      ? "Potentially overbought"
                      : indicators.rsi14 <= 30
                        ? "Potentially oversold"
                        : "Between 30 and 70"}
                </div>
              </div>

              <div className="metric-card">
                <div className="metric-top">
                  <span>ATR 14</span>
                </div>
                <div className="metric-value">
                  {indicators.atr14 !== null
                    ? indicators.atr14.toFixed(priceDigits)
                    : "Not enough data"}
                </div>
                <div className="metric-foot">
                  Average true range · volatility
                </div>
              </div>
            </div>
          </section>

          <section
            className="panel"
            style={{ padding: "20px", marginBottom: "24px" }}
          >
            <div className="section-heading">
              <div>
                <h2>Price-action analysis</h2>
                <p>
                  Confirmed market structure, swing levels, and
                  liquidity events.
                </p>
              </div>
              <span className="soon-pill">
                {priceAction.status === "Available"
                  ? "ANALYZED"
                  : "UNAVAILABLE"}
              </span>
            </div>

            <div className="metric-grid">
              <div className="metric-card">
                <div className="metric-top">
                  <span>Market structure</span>
                </div>
                <div className="metric-value">
                  {priceAction.direction}
                </div>
                <div className="metric-foot">
                  {priceAction.actionable
                    ? "Actionable structural evidence"
                    : "Evidence only — not a standalone signal"}
                </div>
              </div>

              <div className="metric-card">
                <div className="metric-top">
                  <span>Latest swing high</span>
                </div>
                <div className="metric-value">
                  {priceAction.latestSwingHigh !== null
                    ? priceAction.latestSwingHigh.toFixed(priceDigits)
                    : "Unavailable"}
                </div>
                <div className="metric-foot">
                  Potential resistance reference
                </div>
              </div>

              <div className="metric-card">
                <div className="metric-top">
                  <span>Latest swing low</span>
                </div>
                <div className="metric-value">
                  {priceAction.latestSwingLow !== null
                    ? priceAction.latestSwingLow.toFixed(priceDigits)
                    : "Unavailable"}
                </div>
                <div className="metric-foot">
                  Potential support reference
                </div>
              </div>

              <div className="metric-card">
                <div className="metric-top">
                  <span>Detected events</span>
                </div>
                <div className="metric-value">
                  {priceAction.events.length}
                </div>
                <div className="metric-foot">
                  Structure breaks and liquidity sweeps
                </div>
              </div>
            </div>

            <p>{priceAction.summary}</p>

            {priceAction.events.length > 0 ? (
              <div className="analysis-checks">
                <div className="checks-heading">
                  RECENT PRICE-ACTION EVENTS
                </div>

                {priceAction.events.map((event, index) => (
                  <div
                    className="check-row"
                    key={`${event.type}-${event.candleTime}-${index}`}
                  >
                    <span
                      className="check-empty"
                      style={{
                        background: event.type.startsWith("BULLISH")
                          ? "#16a34a"
                          : "#dc2626",
                      }}
                    />
                    <span>{event.description}</span>
                    <span className="check-pending">
                      {event.level.toFixed(priceDigits)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="metric-foot">
                No qualifying structure breaks or liquidity sweeps
                were detected.
              </p>
            )}

            {priceAction.reasons.length > 0 && (
              <div className="analysis-checks">
                <div className="checks-heading">
                  ANALYSIS NOTES
                </div>
                {priceAction.reasons.map((reason, index) => (
                  <p
                    key={`${reason}-${index}`}
                    className="metric-foot"
                  >
                    {reason}
                  </p>
                ))}
              </div>
            )}
          </section>

          <div className="section-heading">
            <div>
              <h2>Market explorer</h2>
              <p>Select a market and instrument to inspect.</p>
            </div>
            <button
              className="secondary-button"
              onClick={() =>
                setNotice(
                  "Choose an asset class and instrument from the watchlist below."
                )
              }
            >
              <SlidersHorizontal size={15} /> Filters
            </button>
          </div>

          <section className="market-layout">
            <div className="panel chart-panel">
              <div className="chart-header">
                <div className="symbol-heading">
                  <div className="coin-icon">
                    {market === "Crypto"
                      ? "₿"
                      : market === "Stocks"
                        ? "S"
                        : market === "Indices"
                          ? "▥"
                          : "€"}
                  </div>
                  <div>
                    <div className="symbol-name">
                      {symbol}
                      <ChevronDown size={14} />
                    </div>
                    <div className="symbol-caption">
                      {market}
                      <span className="bullet"> · </span>
                      <span className="muted">
                        {connected
                          ? "Provider candles"
                          : "Waiting for data"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="timeframe-list">
                  {["1m", "5m", "15m", "30m", "1h", "4h", "1D"].map(
                    (tf) => (
                      <button
                        key={tf}
                        className={timeframe === tf ? "selected" : ""}
                        onClick={() => setTimeframe(tf)}
                        disabled={loadingMarket}
                      >
                        {tf}
                      </button>
                    )
                  )}
                </div>
              </div>

              <div className="chart-price-row">
                <div>
                  <span className="price-label">
                    {symbol} · Latest candle close
                  </span>
                  <div className="price-value">
                    {formattedPrice}
                    <span className="price-change">
                      {loadingMarket
                        ? "Loading…"
                        : marketError
                          ? "Price unavailable"
                          : formattedChange}
                    </span>
                  </div>
                  <div className="metric-foot">
                    Candle time: {formattedCandleTime}
                  </div>
                </div>

                <button
                  className="chart-action"
                  onClick={refreshMarket}
                  disabled={loadingMarket}
                >
                  <LineChart size={15} />
                  {loadingMarket ? "Loading…" : "Refresh data"}
                </button>
              </div>

              <div className="chart-wrap">
                {loadingMarket ? (
                  <div className="signal-empty">
                    <p>Loading market candles…</p>
                  </div>
                ) : marketError ? (
                  <div className="signal-empty">
                    <p>{marketError}</p>
                    <button
                      className="primary-button"
                      onClick={refreshMarket}
                    >
                      Retry market data
                    </button>
                  </div>
                ) : candles.length > 0 ? (
                  (() => {
                    const chartWidth = 720;
                    const chartHeight = 270;
                    const highs = candles.map((c) => c.high);
                    const lows = candles.map((c) => c.low);
                    const maxPrice = Math.max(...highs);
                    const minPrice = Math.min(...lows);
                    const range = maxPrice - minPrice || 1;
                    const padding = 12;
                    const usableHeight = chartHeight - padding * 2;
                    const slotWidth = chartWidth / candles.length;
                    const bodyWidth = Math.max(
                      2,
                      Math.min(9, slotWidth * 0.6)
                    );

                    const y = (price: number) =>
                      padding +
                      ((maxPrice - price) / range) * usableHeight;

                    return (
                      <>
                        <div className="chart-y-labels">
                          <span>{maxPrice.toFixed(priceDigits)}</span>
                          <span>
                            {(maxPrice - range * 0.25).toFixed(
                              priceDigits
                            )}
                          </span>
                          <span>
                            {(maxPrice - range * 0.5).toFixed(
                              priceDigits
                            )}
                          </span>
                          <span>
                            {(maxPrice - range * 0.75).toFixed(
                              priceDigits
                            )}
                          </span>
                          <span>{minPrice.toFixed(priceDigits)}</span>
                        </div>

                        <svg
                          className="candle-chart"
                          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                          preserveAspectRatio="none"
                          role="img"
                          aria-label={`${symbol} ${timeframe} candlestick chart`}
                        >
                          {[30, 80, 130, 180, 230].map((gridY) => (
                            <line
                              key={gridY}
                              x1="0"
                              y1={gridY}
                              x2={chartWidth}
                              y2={gridY}
                              className="chart-gridline"
                            />
                          ))}

                          {candles.map((candle, index) => {
                            const x =
                              index * slotWidth + slotWidth / 2;
                            const rising =
                              candle.close >= candle.open;
                            const bodyTop = y(
                              Math.max(candle.open, candle.close)
                            );
                            const bodyBottom = y(
                              Math.min(candle.open, candle.close)
                            );
                            const bodyHeight = Math.max(
                              1.5,
                              bodyBottom - bodyTop
                            );

                            return (
                              <g
                                key={`${candle.time}-${index}`}
                                className={
                                  rising
                                    ? "candle-up"
                                    : "candle-down"
                                }
                              >
                                <line
                                  x1={x}
                                  y1={y(candle.high)}
                                  x2={x}
                                  y2={y(candle.low)}
                                  stroke="currentColor"
                                  strokeWidth="1"
                                />
                                <rect
                                  x={x - bodyWidth / 2}
                                  y={bodyTop}
                                  width={bodyWidth}
                                  height={bodyHeight}
                                  rx="0.5"
                                  fill="currentColor"
                                />
                              </g>
                            );
                          })}
                        </svg>

                        <div className="chart-watermark">
                          <CandlestickChart size={18} />
                          {candles.length} provider candles
                        </div>
                      </>
                    );
                  })()
                ) : (
                  <div className="signal-empty">
                    <p>Market candles will appear here.</p>
                  </div>
                )}
              </div>

              <div className="chart-legend">
                <span>
                  <i className="legend-dot green" /> Bullish candle
                </span>
                <span>
                  <i className="legend-dot red" /> Bearish candle
                </span>
                <span>
                  <i className="legend-line" /> Price history
                </span>
              </div>
            </div>

            <aside className="panel signal-panel">
              <div className="panel-title-row">
                <div>
                  <div className="panel-kicker">
                    <Sparkles size={14} /> GENIUS SIGNAL ENGINE
                  </div>
                  <h3>Signal analysis</h3>
                </div>
                <span className="soon-pill">
                  {signalAnalysis.actionable
                    ? "CONFIRMED"
                    : "WAIT"}
                </span>
              </div>

              <div className="signal-empty">
                <div className="brain-orb">
                  <BrainCircuit size={26} />
                </div>

                <h4>
                  {signalAnalysis.direction === "BUY"
                    ? "BUY"
                    : signalAnalysis.direction === "SELL"
                      ? "SELL"
                      : "WAIT — No trade"}
                </h4>

                <p>{signalAnalysis.summary}</p>

                <div className="metric-foot">
                  Instrument: {signalAnalysis.symbol} ·{" "}
                  {signalAnalysis.interval}
                </div>

                <div className="metric-foot">
                  Signal quality: {signalAnalysis.quality}
                </div>

                <div className="metric-foot">
                  Latest candle:{" "}
                  {signalAnalysis.latestCandleAt ?? "Unavailable"}
                </div>

                <div className="metric-foot">
                  Candle age:{" "}
                  {signalAnalysis.candleAgeSeconds === null
                    ? "Unavailable"
                    : `${Math.floor(signalAnalysis.candleAgeSeconds / 60)}m ${Math.floor(
                        signalAnalysis.candleAgeSeconds % 60
                      )}s`}
                </div>
              </div>

              <div className="analysis-checks">
                <div className="checks-heading">
                  HIGHER-TIMEFRAME CONFIRMATION
                  <span>{multiTimeframeAnalysis.status}</span>
                </div>
                <p className="metric-foot">{multiTimeframeAnalysis.summary}</p>
                {multiTimeframeAnalysis.frames.map((frame) => (
                  <div className="check-row" key={frame.interval}>
                    <span
                      className="check-empty"
                      style={{
                        background:
                          frame.status === "Confirmed"
                            ? "#16a34a"
                            : frame.status === "Conflict"
                              ? "#dc2626"
                              : "#d97706",
                      }}
                    />
                    <span>
                      {frame.interval}: {frame.detail}
                    </span>
                    <span className="check-pending">
                      {frame.status}
                    </span>
                  </div>
                ))}
              </div>

              <div className="analysis-checks">
                <div className="checks-heading">
                  SIGNAL REASONS
                  <span>{signalAnalysis.reasons.length}</span>
                </div>

                {signalAnalysis.reasons.map((reason, index) => (
                  <div
                    className="check-row"
                    key={`${reason.code}-${index}`}
                  >
                    <span
                      className="check-empty"
                      style={{
                        background: reason.passed
                          ? "#16a34a"
                          : "#dc2626",
                      }}
                    />
                    <span>{reason.message}</span>
                    <span className="check-pending">
                      {reason.passed ? "Passed" : "Blocked"}
                    </span>
                  </div>
                ))}

                {signalAnalysis.reasons.length === 0 && (
                  <p className="metric-foot">
                    No detailed checks are available for this result.
                  </p>
                )}
              </div>

              <div className="analysis-checks">
                <div className="checks-heading">
                  DATA VALIDATION
                  <span>
                    {
                      marketValidation.checks.filter(
                        (check) => check.passed
                      ).length
                    }
                    /{marketValidation.checks.length}
                  </span>
                </div>

                {marketValidation.checks.map((check) => (
                  <div className="check-row" key={check.label}>
                    <span
                      className="check-empty"
                      style={{
                        background: check.passed
                          ? "#16a34a"
                          : "#dc2626",
                      }}
                    />
                    <span>{check.label}</span>
                    <span className="check-pending">
                      {check.passed ? "Passed" : "Failed"}
                    </span>
                  </div>
                ))}
              </div>

              <div className="analysis-checks">
                <div className="checks-heading">RISK PLAN</div>

                {signalAnalysis.riskPlan ? (
                  <>
                    <div className="check-row">
                      <span>Entry reference</span>
                      <strong>
                        {signalAnalysis.riskPlan.entry.toFixed(
                          priceDigits
                        )}
                      </strong>
                    </div>

                    <div className="check-row">
                      <span>Stop-loss estimate</span>
                      <strong>
                        {signalAnalysis.riskPlan.stopLoss.toFixed(
                          priceDigits
                        )}
                      </strong>
                    </div>

                    <div className="check-row">
                      <span>Take-profit estimate</span>
                      <strong>
                        {signalAnalysis.riskPlan.takeProfit.toFixed(
                          priceDigits
                        )}
                      </strong>
                    </div>

                    <div className="check-row">
                      <span>Risk / reward</span>
                      <strong>
                        1:
                        {signalAnalysis.riskPlan.riskRewardRatio.toFixed(
                          2
                        )}
                      </strong>
                    </div>

                    <div className="check-row">
                      <span>Configured risk</span>
                      <strong>
                        {signalAnalysis.riskPlan.riskPercent}%
                      </strong>
                    </div>
                  </>
                ) : (
                  <p className="metric-foot">
                    No risk plan is available because the signal
                    conditions or risk safeguards have not been
                    satisfied.
                  </p>
                )}
              </div>

              <div className="analysis-checks">
                <div className="checks-heading">
                  INVALIDATION &amp; CAUTION
                </div>

                {signalAnalysis.invalidation.map((item, index) => (
                  <p
                    className="metric-foot"
                    key={`${item}-${index}`}
                  >
                    • {item}
                  </p>
                ))}
              </div>

              <div className="signal-disclaimer">
                <ShieldCheck size={15} />
                <span>
                  Rule-based market research, not financial advice.
                  Stop-loss and take-profit values are estimates, not
                  guaranteed execution prices. An actionable result
                  does not guarantee a profitable trade.
                </span>
              </div>
            </aside>
          </section>

          <div className="section-heading watch-heading">
            <div>
              <h2>Watchlist</h2>
              <p>
                Select an instrument to request its market candles.
              </p>
            </div>
            <div className="search-box">
              <Search size={15} />
              <input
                aria-label="Search instruments"
                placeholder="Search instruments"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <section className="panel watchlist-panel">
            <div className="market-tabs">
              {(Object.keys(marketSymbols) as Market[]).map(
                (item) => (
                  <button
                    key={item}
                    className={market === item ? "tab-active" : ""}
                    onClick={() => changeMarket(item)}
                  >
                    {item}
                  </button>
                )
              )}
            </div>

            <div className="watch-table">
              <div className="watch-table-head">
                <span>INSTRUMENT</span>
                <span>ASSET CLASS</span>
                <span>PRICE</span>
                <span>CHANGE</span>
                <span>WATCHLIST</span>
              </div>

              {visibleSymbols.map((item, i) => {
                const isWatched = watchlist.includes(item);
                const quote = watchPrices[item];
                const previousPrice = quote?.previous ?? null;

                const change =
                  quote && previousPrice !== null && previousPrice !== 0
                    ? ((quote.price - previousPrice) /
                        previousPrice) *
                      100
                    : null;

                return (
                  <div className="watch-row" key={item}>
                    <button
                      className="watch-instrument"
                      onClick={() => selectSymbol(item)}
                      aria-label={`Load ${item} market data`}
                    >
                      <div className={`mini-symbol color-${i % 4}`}>
                        {item.slice(0, 1)}
                      </div>
                      <strong>{item}</strong>
                    </button>

                    <span className="asset-type">{market}</span>

                    <span className="no-data">
                      {quote
                        ? quote.price.toFixed(
                            item.includes("JPY") ? 3 : 5
                          )
                        : "—"}
                    </span>

                    <span className="no-data">
                      {change !== null
                        ? `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`
                        : "Unavailable"}
                    </span>

                    <button
                      className={`star-button ${isWatched ? "starred" : ""}`}
                      aria-label={`${isWatched ? "Remove" : "Add"} ${item} ${isWatched ? "from" : "to"} watchlist`}
                      onClick={() => toggleWatchlist(item)}
                    >
                      <Star
                        size={16}
                        fill={isWatched ? "currentColor" : "none"}
                      />
                    </button>
                  </div>
                );
              })}

              {visibleSymbols.length === 0 && (
                <div className="empty-search">
                  No instruments match “{search}”.
                </div>
              )}
            </div>

            <div className="table-footer">
              <span>{visibleSymbols.length} instruments shown</span>
              <span>
                Only the selected instrument has loaded candles; other
                prices remain unavailable until requested.
              </span>
            </div>
          </section>

          <footer className="page-footer">
            <span>
              GENIUS <span className="footer-sep">/</span> PERSONAL
              TRADING WORKSPACE
            </span>
            <span>
              <span
                className={`status-dot ${connected ? "" : "amber"}`}
              />
              {connected
                ? "Market data received"
                : "Awaiting market data"}{" "}
              · Not financial advice
            </span>
          </footer>
        </div>
      </section>
    </main>
  );
}