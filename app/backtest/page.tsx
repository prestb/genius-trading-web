"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeft, FlaskConical, Play, ShieldAlert } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { BacktestConfig, BacktestInterval, BacktestResult } from "@/lib/backtesting";

const intervals: { label: string; value: BacktestInterval }[] = [
  { label: "1 minute", value: "1min" },
  { label: "5 minutes", value: "5min" },
  { label: "15 minutes", value: "15min" },
  { label: "30 minutes", value: "30min" },
  { label: "1 hour", value: "1h" },
  { label: "4 hours", value: "4h" },
  { label: "1 day", value: "1day" },
];

const money = (value: number) => value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percent = (value: number) => `${value.toFixed(2)}%`;

export default function BacktestPage() {
  const [symbol, setSymbol] = useState("EUR/USD");
  const [interval, setInterval] = useState<BacktestInterval>("15min");
  const [initialBalance, setInitialBalance] = useState("10000");
  const [riskPercent, setRiskPercent] = useState("1");
  const [spreadBps, setSpreadBps] = useState("1");
  const [slippageBps, setSlippageBps] = useState("0.5");
  const [feeBpsPerSide, setFeeBpsPerSide] = useState("0");
  const [maxCandlesInTrade, setMaxCandlesInTrade] = useState("100");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<BacktestResult | null>(null);

  const equityData = useMemo(() => {
    if (!result?.equityCurve.length) return [];
    const step = Math.max(1, Math.ceil(result.equityCurve.length / 220));
    const points = result.equityCurve.filter((_, index) => index % step === 0);
    const last = result.equityCurve.at(-1)!;
    if (points.at(-1)?.time !== last.time) points.push(last);
    return points.map((point) => ({ time: new Date(point.time).toLocaleString(), equity: Number(point.equity.toFixed(2)) }));
  }, [result]);

  async function run() {
    if (Boolean(startDate) !== Boolean(endDate)) {
      setError("Choose both a start date and an end date, or leave both blank.");
      return;
    }
    if (startDate && endDate && startDate > endDate) {
      setError("Start date must be on or before end date.");
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);
    const config: BacktestConfig = {
      initialBalance: Number(initialBalance),
      riskPercent: Number(riskPercent),
      spreadBps: Number(spreadBps),
      slippageBps: Number(slippageBps),
      feeBpsPerSide: Number(feeBpsPerSide),
      maxCandlesInTrade: Number(maxCandlesInTrade),
    };
    try {
      const response = await fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ symbol, interval, startDate: startDate || undefined, endDate: endDate || undefined, config }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Backtest request failed.");
      setResult(data as BacktestResult);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Backtest could not be completed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="backtest-page">
      <div className="backtest-topline">
        <Link className="backtest-back" href="/"><ArrowLeft size={16} /> Dashboard</Link>
        <span className="backtest-version"><FlaskConical size={14} /> HISTORICAL RESEARCH</span>
      </div>
      <header className="backtest-heading">
        <div className="backtest-eyebrow">PHASE 3 · STRATEGY VALIDATION</div>
        <h1>Backtesting <span>Lab</span></h1>
        <p>Replay historical candles with higher-timeframe confirmation and explicit trading-cost assumptions.</p>
      </header>

      <section className="backtest-card">
        <div className="backtest-section-title"><h2>Simulation settings</h2><span>Historical candles · No live orders</span></div>
        <div className="backtest-form-grid">
          <label>Start date (UTC, optional)<input type="date" value={startDate} max={endDate || undefined} onChange={(event) => setStartDate(event.target.value)} /></label>
          <label>End date (UTC, optional)<input type="date" value={endDate} min={startDate || undefined} max={new Date().toISOString().slice(0, 10)} onChange={(event) => setEndDate(event.target.value)} /></label>
          <label>Instrument<input value={symbol} onChange={(event) => setSymbol(event.target.value)} maxLength={30} placeholder="EUR/USD" /></label>
          <label>Signal timeframe<select value={interval} onChange={(event) => setInterval(event.target.value as BacktestInterval)}>{intervals.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label>Starting balance<input inputMode="decimal" type="number" min="1" value={initialBalance} onChange={(event) => setInitialBalance(event.target.value)} /></label>
          <label>Risk per trade (%)<input inputMode="decimal" type="number" min="0.01" max="5" step="0.1" value={riskPercent} onChange={(event) => setRiskPercent(event.target.value)} /></label>
          <label>Spread (basis points)<input inputMode="decimal" type="number" min="0" max="1000" step="0.1" value={spreadBps} onChange={(event) => setSpreadBps(event.target.value)} /></label>
          <label>Slippage (basis points)<input inputMode="decimal" type="number" min="0" max="1000" step="0.1" value={slippageBps} onChange={(event) => setSlippageBps(event.target.value)} /></label>
          <label>Fee per side (basis points)<input inputMode="decimal" type="number" min="0" max="1000" step="0.1" value={feeBpsPerSide} onChange={(event) => setFeeBpsPerSide(event.target.value)} /></label>
          <label>Maximum bars per trade<input inputMode="numeric" type="number" min="1" max="10000" step="1" value={maxCandlesInTrade} onChange={(event) => setMaxCandlesInTrade(event.target.value)} /></label>
        </div>
        <div className="backtest-actions"><p>Leave both dates blank for the latest available history, or select both dates for a historical period. Pre-period candles are used only to warm up indicators. Provider history limits apply.</p><button className="primary-button" onClick={run} disabled={loading}>{loading ? <span className="backtest-spinner" /> : <Play size={15} />}{loading ? "Running simulation…" : "Run backtest"}</button></div>
      </section>

      {error && <div className="backtest-error" role="alert"><ShieldAlert size={17} /><span>{error}</span></div>}
      {result && <>
        <section className="backtest-results-head"><div><div className="backtest-eyebrow">RESULTS · {result.symbol} · {result.interval}</div><p className="backtest-period-detail">Test candles: {result.period.firstCandleAt ? new Date(result.period.firstCandleAt).toLocaleString() : "—"} to {result.period.lastCandleAt ? new Date(result.period.lastCandleAt).toLocaleString() : "—"} · {result.period.candlesInRange} candles in range</p><h2>{result.status === "completed" ? "Simulation complete" : "Insufficient history"}</h2></div><span className={`backtest-result-pill ${result.summary.netPnl >= 0 ? "positive" : "negative"}`}>{percent(result.summary.returnPercent)} return</span></section>
        <section className="backtest-metrics">
          <Metric label="Net P/L" value={`${result.summary.netPnl >= 0 ? "+" : "−"}${money(Math.abs(result.summary.netPnl))}`} detail={`${money(result.summary.finalBalance)} final balance`} positive={result.summary.netPnl >= 0} />
          <Metric label="Win rate" value={percent(result.summary.winRatePercent)} detail={`${result.summary.wins} wins · ${result.summary.losses} losses`} />
          <Metric label="Profit factor" value={result.summary.profitFactor === null ? "∞*" : result.summary.profitFactor.toFixed(2)} detail={`${result.summary.trades} closed trades`} />
          <Metric label="Max drawdown" value={percent(result.summary.maxDrawdownPercent)} detail="Marked-to-market equity" negative={result.summary.maxDrawdownPercent > 15} />
          <Metric label="Expectancy / trade" value={money(result.summary.expectancyPerTrade)} detail="Average net result" positive={result.summary.expectancyPerTrade >= 0} />
          <Metric label="Expectancy (R)" value={`${result.summary.expectancyR.toFixed(2)}R`} detail="Average net P/L divided by initial stop risk" positive={result.summary.expectancyR >= 0} />
          <Metric label="Exposure" value={percent(result.summary.exposurePercent)} detail={`${result.summary.candlesAnalyzed} candles analyzed`} />
        </section>
        {equityData.length > 1 && <section className="backtest-card backtest-chart-card"><div className="backtest-section-title"><h2>Equity curve</h2><span>Realized and marked-to-market equity</span></div><div className="backtest-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={equityData} margin={{ top: 10, right: 15, bottom: 0, left: 0 }}><CartesianGrid stroke="#26343d" strokeDasharray="4 4" /><XAxis dataKey="time" hide /><YAxis domain={["auto", "auto"]} tick={{ fill: "#82919b", fontSize: 10 }} width={75} tickFormatter={(value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 0 })} /><Tooltip contentStyle={{ background: "#101820", border: "1px solid #30404a", borderRadius: 8, color: "#edf3f5", fontSize: 12 }} formatter={(value) => [money(Number(value)), "Equity"]} /><Line type="monotone" dataKey="equity" stroke="#f18a53" dot={false} strokeWidth={2} isAnimationActive={false} /></LineChart></ResponsiveContainer></div></section>}
        <section className="backtest-card"><div className="backtest-section-title"><h2>Trade log</h2><span>{result.trades.length} trades · newest first</span></div>{result.trades.length ? <div className="backtest-table-wrap"><table className="backtest-table"><thead><tr><th>Direction</th><th>Entry</th><th>Exit</th><th>Entry price</th><th>Exit price</th><th>Net P/L</th><th>Exit reason</th></tr></thead><tbody>{[...result.trades].reverse().slice(0, 100).map((trade, index) => <tr key={`${trade.entryTime}-${index}`}><td><span className={`direction-tag ${trade.direction.toLowerCase()}`}>{trade.direction}</span></td><td>{new Date(trade.entryTime).toLocaleString()}</td><td>{new Date(trade.exitTime).toLocaleString()}</td><td>{trade.entryPrice.toFixed(5)}</td><td>{trade.exitPrice.toFixed(5)}</td><td className={trade.netPnl >= 0 ? "pnl-positive" : "pnl-negative"}>{trade.netPnl >= 0 ? "+" : "−"}{money(Math.abs(trade.netPnl))}</td><td>{trade.exitReason}</td></tr>)}</tbody></table></div> : <p className="backtest-empty">No trades met the strategy and higher-timeframe confirmation rules during this historical sample.</p>}
          <p className="backtest-table-note">Showing up to 100 most recent trades. The simulation assumes stop-loss is hit first when stop and target are both touched in the same candle.</p>
        </section>
        <section className="backtest-card backtest-warnings"><div className="backtest-section-title"><h2>Interpretation & limitations</h2></div><ul>{result.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul><p>* Profit factor is shown as ∞ when there are profitable trades and no losing trades in this sample; this is not proof of a robust strategy.</p></section>
      </>}
      <footer className="backtest-footer">GENIUS TRADING INTELLIGENCE <span>RESEARCH TOOL · DOES NOT EXECUTE TRADES</span></footer>
    </main>
  );
}

function Metric({ label, value, detail, positive, negative }: { label: string; value: string; detail: string; positive?: boolean; negative?: boolean }) {
  return <div className="backtest-metric"><div className="backtest-metric-label">{label}</div><div className={`backtest-metric-value ${positive ? "positive" : ""} ${negative ? "negative" : ""}`}>{value}</div><div className="backtest-metric-detail">{detail}</div></div>;
}
