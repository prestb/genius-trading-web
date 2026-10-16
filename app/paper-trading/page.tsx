"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, RefreshCw, ShieldAlert, CircleDollarSign, Activity } from "lucide-react";
import { closePaperPosition, createPaperLedger, DEFAULT_PAPER_CONFIG, getPaperMetrics, markPaperPositions, openPaperPosition, PAPER_STORAGE_KEY, type PaperLedger, type PaperPosition, type PaperSide } from "@/lib/paper-trading";

type Candle = { time: string; open: number; high: number; low: number; close: number };
type MarketResponse = { symbol?: string; interval?: string; candles?: Candle[]; retrievedAt?: string; latestCandleAt?: string; candleAgeSeconds?: number; isFresh?: boolean; error?: string };
const symbols = ["EUR/USD", "GBP/USD", "USD/JPY", "EUR/GBP", "BTC/USD", "ETH/USD", "AAPL", "NVDA", "MSFT", "TSLA"];
const intervals = ["1min", "5min", "15min", "30min", "1h", "4h", "1day"];
const money = (value: number) => value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function PaperTradingPage() {
  const [ledger, setLedger] = useState<PaperLedger>(() => createPaperLedger());
  const [loaded, setLoaded] = useState(false);
  const [symbol, setSymbol] = useState("EUR/USD");
  const [interval, setInterval] = useState("15min");
  const [quantity, setQuantity] = useState("1000");
  const [price, setPrice] = useState<number | null>(null);
  const [marketFresh, setMarketFresh] = useState(false);
  const [latestCandleAt, setLatestCandleAt] = useState("");
  const [retrievedAt, setRetrievedAt] = useState("");
  const [loadingPrice, setLoadingPrice] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PAPER_STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && "schemaVersion" in parsed && parsed.schemaVersion === 1 && "config" in parsed && "positions" in parsed && Array.isArray(parsed.positions)) {
          setLedger(parsed as PaperLedger);
        }
      }
    } catch {
      setError("Saved paper ledger could not be read. Existing browser data was left untouched.");
    } finally { setLoaded(true); }
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try { window.localStorage.setItem(PAPER_STORAGE_KEY, JSON.stringify(ledger)); }
    catch { setError("Browser storage is unavailable. Export or record your paper-trading history before leaving this page."); }
  }, [ledger, loaded]);

  const metrics = useMemo(() => getPaperMetrics(ledger), [ledger]);

  const refreshPrice = useCallback(async () => {
    setLoadingPrice(true); setError(""); setMessage("");
    try {
      const params = new URLSearchParams({ symbol, interval });
      const response = await fetch(`/api/market?${params.toString()}`, { cache: "no-store" });
      const data = await response.json() as MarketResponse;
      if (!response.ok || !Array.isArray(data.candles) || !data.candles.length) throw new Error(data.error || "No market candles returned.");
      if (data.symbol !== symbol || data.interval !== interval) throw new Error("Market response did not match the selected instrument and timeframe.");
      const latest = data.candles[data.candles.length - 1];
      if (!latest || !Number.isFinite(latest.close) || latest.close <= 0) throw new Error("Latest market price is invalid.");
      setPrice(latest.close); setMarketFresh(data.isFresh === true); setLatestCandleAt(data.latestCandleAt || latest.time); setRetrievedAt(data.retrievedAt || new Date().toISOString());
      setLedger((current) => markPaperPositions(current, symbol, latest.close));
      if (data.isFresh !== true) setError("Market data is stale. Opening and closing paper positions are blocked until fresh data is available.");
    } catch (caught) {
      setMarketFresh(false); setError(caught instanceof Error ? caught.message : "Market data could not be loaded.");
    } finally { setLoadingPrice(false); }
  }, [symbol, interval]);

  useEffect(() => { setPrice(null); setMarketFresh(false); setLatestCandleAt(""); }, [symbol, interval]);

  function open(side: PaperSide) {
    setError(""); setMessage("");
    try {
      if (price === null) throw new Error("Refresh market data before opening a paper position.");
      const updated = openPaperPosition({ ledger, symbol, interval, side, quantity: Number(quantity), price, isFresh: marketFresh });
      setLedger(updated);
      setMessage(`${side} paper position submitted to the simulation ledger. No real order was placed.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Paper position could not be opened."); }
  }

  function close(position: PaperPosition) {
    setError(""); setMessage("");
    if (symbol !== position.symbol || interval !== position.interval || price === null || !marketFresh) {
      setError(`Select ${position.symbol} / ${position.interval} and refresh fresh market data before closing this position.`); return;
    }
    try {
      const updated = closePaperPosition(ledger, position.id, price, marketFresh);
      setLedger(updated);
      setMessage(`Paper position ${position.id} closed in simulation. No real order was placed.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Paper position could not be closed."); }
  }

  function resetLedger() {
    if (!window.confirm("Reset the entire local paper-trading ledger? This permanently clears its positions from this browser.")) return;
    setLedger(createPaperLedger({ ...DEFAULT_PAPER_CONFIG })); setMessage("Paper ledger reset."); setError("");
  }

  function exportLedger() {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), mode: "SIMULATION_ONLY", ledger }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `genius-paper-ledger-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); URL.revokeObjectURL(url);
  }

  return <main className="backtest-page paper-page">
    <div className="backtest-topline"><Link href="/" className="backtest-back"><ArrowLeft size={15} /> Back to dashboard</Link><span className="backtest-version"><Activity size={12} /> SIMULATION ONLY</span></div>
    <header className="backtest-heading"><div className="backtest-eyebrow">PHASE 11 · PAPER EXECUTION</div><h1>Paper <span>Trading</span></h1><p>Practice order handling against verified market prices without placing real orders. This ledger is stored locally in this browser and is not a broker account.</p></header>
    <div className="paper-safety"><ShieldAlert size={20}/><div><strong>Real-money trading is disabled.</strong><span>Orders are simulated locally. Data may be delayed; stale or unverified data blocks opening and closing positions. Simulated fills do not guarantee live execution quality.</span></div></div>
    <section className="backtest-metrics paper-metrics">
      {[{label:"Simulated equity", value:money(metrics.equity), detail:"Starting balance + realized and unrealized P/L"},{label:"Realized P/L", value:`${metrics.realizedPnl >= 0 ? "+" : "−"}${money(Math.abs(metrics.realizedPnl))}`, detail:"Closed positions, after modeled costs"},{label:"Unrealized P/L", value:`${metrics.unrealizedPnl >= 0 ? "+" : "−"}${money(Math.abs(metrics.unrealizedPnl))}`, detail:"Open positions, includes entry fee"},{label:"Open positions", value:String(metrics.openPositions), detail:`Limit ${ledger.config.maxOpenPositions} positions` }].map((item) => <article className="backtest-metric" key={item.label}><div className="backtest-metric-label">{item.label}</div><div className={`backtest-metric-value ${item.value.startsWith("−") ? "negative" : ""}`}>{item.value}</div><div className="backtest-metric-detail">{item.detail}</div></article>)}
    </section>
    <section className="backtest-card"><div className="backtest-section-title"><h2>Market and simulated order</h2><span>Manual refresh · no background polling</span></div>
      <div className="backtest-form-grid paper-form-grid">
        <label>Instrument<select value={symbol} onChange={(event) => setSymbol(event.target.value)}>{symbols.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Timeframe<select value={interval} onChange={(event) => setInterval(event.target.value)}>{intervals.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Quantity<input type="number" min="0.000001" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)}/></label>
        <label>Latest verified close<input readOnly value={price === null ? "Refresh market data" : price.toLocaleString(undefined, { maximumFractionDigits: 8 })}/></label>
      </div>
      <div className="paper-market-status"><span className={`paper-status-dot ${marketFresh ? "fresh" : "stale"}`}/><span>{marketFresh ? "Fresh according to provider freshness rules" : "No fresh market quote verified"}</span><span>Latest candle: {latestCandleAt || "—"}</span><span>Retrieved: {retrievedAt ? new Date(retrievedAt).toLocaleTimeString() : "—"}</span></div>
      <div className="paper-order-actions"><button className="secondary-button" disabled={loadingPrice} onClick={() => void refreshPrice()}><RefreshCw size={13}/>{loadingPrice ? "Refreshing…" : "Refresh market price"}</button><div><button className="paper-long" disabled={!marketFresh || price === null || loadingPrice || metrics.riskLimitReached} onClick={() => open("LONG")}>Open simulated LONG</button><button className="paper-short" disabled={!marketFresh || price === null || loadingPrice || metrics.riskLimitReached} onClick={() => open("SHORT")}>Open simulated SHORT</button></div></div>
      <p className="backtest-table-note">Execution assumptions: spread {ledger.config.spreadBps} bps, slippage {ledger.config.slippageBps} bps, fee {ledger.config.feeBpsPerSide} bps per side. Position size is quantity × price; instrument-specific contract multipliers are not modeled.</p>
    </section>
    {error && <div className="backtest-error" role="alert">{error}</div>}{message && <div className="paper-message" role="status">{message}</div>}
    {metrics.riskLimitReached && <div className="backtest-error" role="alert">Daily realized-loss limit reached. Opening new positions is disabled. The limit is a guardrail, not a guarantee of loss containment.</div>}
    <section className="backtest-card"><div className="backtest-section-title"><h2>Paper position ledger</h2><span>{ledger.positions.length} total positions</span></div><div className="paper-ledger-actions"><button className="secondary-button" onClick={exportLedger}>Export ledger JSON</button><button className="secondary-button" onClick={resetLedger}>Reset ledger</button></div>
      {!ledger.positions.length ? <div className="backtest-empty">No paper positions yet. Refresh verified market data, then open a simulated LONG or SHORT position.</div> : <div className="backtest-table-wrap"><table className="backtest-table paper-table"><thead><tr><th>Instrument / TF</th><th>Side</th><th>Quantity</th><th>Entry</th><th>Mark / Exit</th><th>Status</th><th>Net P/L</th><th>Opened</th><th>Action</th></tr></thead><tbody>{ledger.positions.map((position) => { const pnl = position.status === "CLOSED" ? (position.netPnl ?? 0) : (position.markPrice - position.entryPrice) * position.quantity * (position.side === "LONG" ? 1 : -1) - position.entryFee; return <tr key={position.id}><td>{position.symbol} / {position.interval}</td><td><span className={`direction-tag ${position.side === "LONG" ? "buy" : "sell"}`}>{position.side}</span></td><td>{position.quantity.toLocaleString()}</td><td>{position.entryPrice.toPrecision(7)}</td><td>{(position.exitPrice ?? position.markPrice).toPrecision(7)}</td><td>{position.status}</td><td className={pnl >= 0 ? "pnl-positive" : "pnl-negative"}>{pnl >= 0 ? "+" : "−"}{money(Math.abs(pnl))}</td><td>{new Date(position.openedAt).toLocaleString()}</td><td>{position.status === "OPEN" ? <button className="paper-close" onClick={() => close(position)}>Close</button> : "—"}</td></tr>; })}</tbody></table></div>}
    </section>
    <footer className="backtest-footer"><span>GENIUS TRADING WEB · PAPER MODE</span><span>Browser-local ledger · Not broker connected · Not investment advice</span></footer>
  </main>;
}
