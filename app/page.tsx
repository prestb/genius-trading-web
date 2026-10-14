
"use client";

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
    "Genius is connected to the market-data API. Trading signals are not enabled yet."
  );

  // All state declarations come before effects and calculations.
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loadingMarket, setLoadingMarket] = useState(false);
  const [marketError, setMarketError] = useState("");
  const [retrievedAt, setRetrievedAt] = useState("");


  const [watchPrices, setWatchPrices] = useState<
    Record<string, { price: number; previous: number | null }>
  >({});

  // Calculate technical indicators from the selected market candles.
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


  async function fetchLatestPrice(item: string): Promise<number | null> {
    try {
      const params = new URLSearchParams({
        symbol: item,
        interval: "15min",
      });

      const response = await fetch(`/api/market?${params.toString()}`);
      const data = await response.json();

      if (
        !response.ok ||
        data.isFresh !== true ||
        !Array.isArray(data.candles) ||
        data.candles.length === 0
      ) {
        return null;
      }

      const latest = data.candles[data.candles.length - 1];
      const price = Number(latest.close);

      return Number.isFinite(price) ? price : null;
    } catch {
      return null;
    }
  }


  useEffect(() => {
    let cancelled = false;

    async function loadWatchlistPrices() {
      const symbols = Array.from(
        new Set([...watchlist, symbol])
      );

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

            const latest =
              data.candles[data.candles.length - 1];
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


  const [refreshKey, setRefreshKey] = useState(0);

  // Fetch candles from our server-side Twelve Data endpoint.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function loadMarketData() {
      setLoadingMarket(true);
      setMarketError("");

      try {
        const params = new URLSearchParams({
          symbol,
          interval: intervalMap[timeframe] || "15min",
        });

        const response = await fetch(`/api/market?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });

        const data = (await response.json()) as MarketResponse;

        if (!response.ok) {
          throw new Error(data.error || "Unable to load market data.");
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
              [c.open, c.high, c.low, c.close].every(Number.isFinite)
          )
        ) {
          throw new Error("The provider returned invalid market candles.");
        }

        if (!cancelled) {
          setCandles(data.candles);
          setRetrievedAt(data.retrievedAt || "");
          setNotice(
            `${data.source || "Market provider"} returned ${data.candles.length} candles for ${symbol}.`
          );
        }
      } catch (error) {
        if (!cancelled && !(error instanceof Error && error.name === "AbortError")) {
          setCandles([]);
          setRetrievedAt("");
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
    candles.length > 0 ? candles[candles.length - 1] : undefined;

  const previousCandle =
    candles.length > 1 ? candles[candles.length - 2] : undefined;

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

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Sparkles size={22} strokeWidth={2.4} />
          </div>
          <div>
            <div className="brand-name">GENIUS</div>
            <div className="brand-subtitle">TRADING INTELLIGENCE</div>
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
              {label === "AI Signal Lab" && <span className="nav-dot" />}
            </button>
          ))}
        </nav>

        <div className="sidebar-spacer" />

        <div className="sidebar-card">
          <div className="sidebar-card-icon">
            <ShieldCheck size={18} />
          </div>
          <div className="sidebar-card-title">Analysis integrity</div>
          <p>Signals will only use verified market data. No data, no signal.</p>
          <span className="status-pill">
            <span className="status-dot" /> Guardrails enabled
          </span>
        </div>

        <button
          className="nav-item settings-button"
          onClick={() => setNotice("Settings will be added in a later phase.")}
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
              aria-label="Help"
              onClick={() =>
                setNotice(
                  "Genius displays provider candles. Technical analysis and trading signals are not enabled yet."
                )
              }
            >
              <CircleHelp size={18} />
            </button>

            <button
              className="icon-button"
              aria-label="Notifications"
              onClick={() =>
                setNotice("Notifications will be configured in a later phase.")
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
                <span className="eyebrow-line" /> PERSONAL MARKET TERMINAL
              </div>
              <h1>
                Market overview<span className="title-period">.</span>
              </h1>
              <p className="subtitle">
                Your market, your signals, your decisions.
              </p>
            </div>

            <button
              className="date-button"
              onClick={() =>
                setNotice(
                  retrievedAt
                    ? `Last API retrieval: ${new Date(retrievedAt).toLocaleString()}`
                    : "Market retrieval time is not available yet."
                )
              }
            >
              <Clock3 size={15} />
              <span>
                {retrievedAt
                  ? `Retrieved ${new Date(retrievedAt).toLocaleTimeString()}`
                  : "Waiting for market data"}
              </span>
            </button>
          </section>

          <div className="demo-alert">
            <div className="alert-icon">
              <Activity size={16} />
            </div>
            <div>
              <strong>{marketError ? "Market data issue" : "Market data status"}</strong>
              <span>{marketError || notice}</span>
            </div>
            <button
              onClick={() => setNotice("Genius market dashboard status.")}
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
              <div className="metric-foot">Across your selected instruments</div>
            </div>

            <div className="metric-card">
              <div className="metric-top">
                <span>Signals today</span>
                <span className="metric-icon orange">
                  <BrainCircuit size={16} />
                </span>
              </div>
              <div className="metric-value">—</div>
              <div className="metric-foot">Signal engine not enabled</div>
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
                <span className={`status-dot ${candles.length > 0 && !marketError ? "" : "amber"}`} />
                {candles.length > 0 && !marketError
                  ? "Twelve Data · EUR/USD feed"
                  : marketError
                    ? "Check market data connection"
                    : "Waiting for verified candles"}
              </div>
              <div className="metric-foot">
                <span className={`status-dot ${connected ? "" : "amber"}`} />
                {connected ? "Provider candles received" : "Waiting for valid data"}
              </div>
            </div>

            <div className="metric-card">
              <div className="metric-top">
                <span>AI analysis</span>
                <span className="metric-icon purple">
                  <Sparkles size={16} />
                </span>
              </div>
              <div className="metric-value metric-status">Standby</div>
              <div className="metric-foot">No signals fabricated</div>
            </div>
          </section>


          <section className="panel" style={{ padding: "20px", marginBottom: "24px" }}>
            <div className="section-heading">
              <div>
                <h2>Technical indicators</h2>
                <p>Calculated from the selected instrument&apos;s market candles.</p>
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
                <div className="metric-foot">Medium-term trend</div>
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
                <div className="metric-foot">Long-term trend</div>
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
                <div className="metric-foot">Average true range · volatility</div>
              </div>
            </div>
          </section>


          <div className="section-heading">
            <div>
              <h2>Market explorer</h2>
              <p>Select a market and instrument to inspect.</p>
            </div>
            <button
              className="secondary-button"
              onClick={() =>
                setNotice("Choose an asset class and instrument from the watchlist below.")
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
                        {connected ? "Provider candles" : "Waiting for data"}
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
                            {(maxPrice - range * 0.25).toFixed(priceDigits)}
                          </span>
                          <span>
                            {(maxPrice - range * 0.5).toFixed(priceDigits)}
                          </span>
                          <span>
                            {(maxPrice - range * 0.75).toFixed(priceDigits)}
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
                            const x = index * slotWidth + slotWidth / 2;
                            const rising = candle.close >= candle.open;
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
                                  rising ? "candle-up" : "candle-down"
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
                    <Sparkles size={14} /> GENIUS AI
                  </div>
                  <h3>Signal analysis</h3>
                </div>
                <span className="soon-pill">STANDBY</span>
              </div>


              <div className="signal-empty">
                <div className="brain-orb">
                  <BrainCircuit size={26} />
                </div>

                <h4>
                  {trendAnalysis.direction === "Bullish"
                    ? "Bullish trend detected"
                    : trendAnalysis.direction === "Bearish"
                      ? "Bearish trend detected"
                      : trendAnalysis.direction === "Neutral"
                        ? "No clear trend"
                        : "Insufficient data"}
                </h4>

                <p>{trendAnalysis.explanation}</p>

                <div className="metric-foot">
                  Analysis timeframe: {trendAnalysis.timeframe}
                </div>

                <div className="metric-foot">
                  Trend checks: {trendAnalysis.checksPassed}/
                  {trendAnalysis.checksRequired}
                </div>

                <p>
                  This is a rule-based trend assessment, not a buy or sell
                  recommendation.
                </p>
              </div>



              <div className="analysis-checks">
                <div className="checks-heading">
                  ANALYSIS CHECKLIST{" "}
                  <span>
                    {marketValidation.checks.filter((check) => check.passed).length}/
                    {marketValidation.checks.length}
                  </span>
                </div>

                {marketValidation.checks.map((check) => (
                  <div className="check-row" key={check.label}>
                    <span
                      className="check-empty"
                      style={{
                        background: check.passed ? "#16a34a" : "#dc2626",
                      }}
                    />
                    <span>{check.label}</span>
                    <span className="check-pending">
                      {check.passed ? "Passed" : "Failed"}
                    </span>
                  </div>
                ))}

                <div className="check-row">
                  <span
                    className="check-empty"
                    style={{
                      background:
                        trendAnalysis.direction === "Insufficient data"
                          ? "#dc2626"
                          : "#16a34a",
                    }}
                  />
                  <span>Trend assessment</span>
                  <span className="check-pending">
                    {trendAnalysis.direction === "Insufficient data"
                      ? "Unavailable"
                      : trendAnalysis.direction}
                  </span>
                </div>

                <div className="check-row">
                  <span
                    className="check-empty"
                    style={{
                      background:
                        indicators.atr14 !== null ? "#16a34a" : "#dc2626",
                    }}
                  />
                  <span>Volatility (ATR)</span>
                  <span className="check-pending">
                    {indicators.atr14 !== null ? "Available" : "Unavailable"}
                  </span>
                </div>

                <div className="check-row">
                  <span
                    className="check-empty"
                    style={{
                      background:
                        indicators.ema200 !== null ? "#16a34a" : "#dc2626",
                    }}
                  />
                  <span>EMA 200</span>
                  <span className="check-pending">
                    {indicators.ema200 !== null ? "Available" : "Needs more data"}
                  </span>
                </div>
              </div>


              <div className="signal-disclaimer">
                <ShieldCheck size={15} />
                <span>
                  Genius will not issue a trading signal until the required
                  market data and analysis have been validated.
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
              {(Object.keys(marketSymbols) as Market[]).map((item) => (
                <button
                  key={item}
                  className={market === item ? "tab-active" : ""}
                  onClick={() => changeMarket(item)}
                >
                  {item}
                </button>
              ))}
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
                const isCurrentSymbol = item === symbol;
                const isWatched = watchlist.includes(item);

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
                      {watchPrices[item]
                        ? watchPrices[item].price.toFixed(
                          item.includes("JPY") ? 3 : 5
                        )
                        : "—"}
                    </span>

                    <span className="no-data">
                      {watchPrices[item]?.previous
                        ? `${watchPrices[item]!.price >=
                          watchPrices[item]!.previous!
                          ? "+"
                          : ""
                        }${(
                          ((watchPrices[item]!.price -
                            watchPrices[item]!.previous!) /
                            watchPrices[item]!.previous!) *
                          100
                        ).toFixed(2)}%`
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
                Only the selected instrument has loaded candles; other prices
                remain unavailable until requested.
              </span>
            </div>
          </section>

          <footer className="page-footer">
            <span>
              GENIUS <span className="footer-sep">/</span> PERSONAL TRADING
              WORKSPACE
            </span>
            <span>
              <span className={`status-dot ${connected ? "" : "amber"}`} />
              {connected ? "Market data received" : "Awaiting market data"} ·
              Not financial advice
            </span>
          </footer>
        </div>
      </section>
    </main>
  );
}
