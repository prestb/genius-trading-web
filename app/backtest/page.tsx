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
import type { OutOfSampleValidation } from "@/lib/backtest-validation";
import type { RobustnessAnalysis } from "@/lib/robustness-analysis";
import { tradesToAuditCsv } from "@/lib/trade-audit";

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
  const [includeValidation, setIncludeValidation] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<(BacktestResult & { validation?: OutOfSampleValidation; robustness?: RobustnessAnalysis }) | null>(null);

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
        body: JSON.stringify({ symbol, interval, startDate: startDate || undefined, endDate: endDate || undefined, config, includeValidation }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Backtest request failed.");
      setResult(data as BacktestResult & { validation?: OutOfSampleValidation });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Backtest could not be completed.");
    } finally {
      setLoading(false);
    }
  }

  function exportTradeAudit() {
    if (!result) return;
    const csv = tradesToAuditCsv(result.trades, {
      symbol: result.symbol,
      interval: result.interval,
      engineVersion: result.engineVersion,
      periodStart: result.period.firstCandleAt ?? "",
      periodEnd: result.period.lastCandleAt ?? "",
    });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `genius-trading-audit-${result.symbol.replace(/[^a-z0-9_-]/gi, "_")}-${result.interval}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="backtest-page">
      <div className="backtest-topline">
        <Link className="backtest-back" href="/"><ArrowLeft size={16} /> Dashboard</Link>
        <span className="backtest-version"><FlaskConical size={14} /> HISTORICAL RESEARCH</span>
      </div>
      <header className="backtest-heading">
        <div className="backtest-eyebrow">PHASE 5 · OUT-OF-SAMPLE VALIDATION</div>
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
        <div className="backtest-validation-option"><label><input type="checkbox" checked={includeValidation} onChange={(event) => setIncludeValidation(event.target.checked)} /><span><strong>Run out-of-sample validation</strong><small>Use the first 70% of the scored history for in-sample research and the final 30% as a chronological holdout. Includes a price-only buy-and-hold benchmark.</small></span></label></div>
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
        {"validation" in result && result.validation && <ValidationPanel validation={result.validation} />}
        {"robustness" in result && result.robustness && <RobustnessPanel analysis={result.robustness} />}
        {equityData.length > 1 && <section className="backtest-card backtest-chart-card"><div className="backtest-section-title"><h2>Equity curve</h2><span>Realized and marked-to-market equity</span></div><div className="backtest-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={equityData} margin={{ top: 10, right: 15, bottom: 0, left: 0 }}><CartesianGrid stroke="#26343d" strokeDasharray="4 4" /><XAxis dataKey="time" hide /><YAxis domain={["auto", "auto"]} tick={{ fill: "#82919b", fontSize: 10 }} width={75} tickFormatter={(value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 0 })} /><Tooltip contentStyle={{ background: "#101820", border: "1px solid #30404a", borderRadius: 8, color: "#edf3f5", fontSize: 12 }} formatter={(value) => [money(Number(value)), "Equity"]} /><Line type="monotone" dataKey="equity" stroke="#f18a53" dot={false} strokeWidth={2} isAnimationActive={false} /></LineChart></ResponsiveContainer></div></section>}
        <section className="backtest-card"><div className="backtest-section-title"><h2>Trade log</h2><span>{result.trades.length} trades · newest first</span></div><div className="backtest-audit-actions"><button type="button" className="backtest-run-button" onClick={exportTradeAudit} disabled={!result.trades.length}>Export full trade audit CSV</button><span>Includes all trades, execution assumptions, risk levels, fees, and exit reasons.</span></div>{result.trades.length ? <div className="backtest-table-wrap"><table className="backtest-table"><thead><tr><th>Direction</th><th>Signal time</th><th>Entry</th><th>Exit</th><th>Entry price</th><th>Exit price</th><th>Stop loss</th><th>Take profit</th><th>Quantity</th><th>Fees</th><th>Net P/L</th><th>Bars held</th><th>Exit reason</th></tr></thead><tbody>{[...result.trades].reverse().slice(0, 100).map((trade, index) => <tr key={`${trade.entryTime}-${index}`}><td><span className={`direction-tag ${trade.direction.toLowerCase()}`}>{trade.direction}</span></td><td>{new Date(trade.entryTime).toLocaleString()}</td><td>{new Date(trade.exitTime).toLocaleString()}</td><td>{trade.entryPrice.toFixed(5)}</td><td>{trade.exitPrice.toFixed(5)}</td><td className={trade.netPnl >= 0 ? "pnl-positive" : "pnl-negative"}>{trade.netPnl >= 0 ? "+" : "−"}{money(Math.abs(trade.netPnl))}</td><td>{trade.barsHeld}</td><td>{trade.exitReason}</td></tr>)}</tbody></table></div> : <p className="backtest-empty">No trades met the strategy and higher-timeframe confirmation rules during this historical sample.</p>}
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

function RobustnessPanel({ analysis }: { analysis: RobustnessAnalysis }) {
  return <section className="backtest-card">
    <div className="backtest-section-title"><h2>Robustness analysis</h2><span>Version {analysis.version}</span></div>
    <h3>Trading-cost sensitivity</h3>
    <p className="backtest-validation-intro">The same strategy is replayed with configured spread, slippage, and fees scaled by each scenario. This is a sensitivity check, not a forecast.</p>
    <div className="backtest-table-wrap"><table className="backtest-table"><thead><tr><th>Scenario</th><th>Spread</th><th>Slippage</th><th>Fee / side</th><th>Net P/L</th><th>Return</th><th>Trades</th><th>Expectancy (R)</th></tr></thead><tbody>
      {analysis.costSensitivity.map((scenario) => <tr key={scenario.label}><td>{scenario.label}</td><td>{scenario.spreadBps.toFixed(2)} bps</td><td>{scenario.slippageBps.toFixed(2)} bps</td><td>{scenario.feeBpsPerSide.toFixed(2)} bps</td><td className={scenario.netPnl >= 0 ? "pnl-positive" : "pnl-negative"}>{money(scenario.netPnl)}</td><td>{percent(scenario.returnPercent)}</td><td>{scenario.trades}</td><td>{scenario.expectancyR.toFixed(2)}R</td></tr>)}
    </tbody></table></div>
    <h3>Performance by heuristic market regime</h3>
    {analysis.regimePerformance.length ? <div className="backtest-table-wrap"><table className="backtest-table"><thead><tr><th>Regime</th><th>Trades</th><th>Wins</th><th>Win rate</th><th>Net P/L</th><th>Expectancy (R)</th></tr></thead><tbody>
      {analysis.regimePerformance.map((item) => <tr key={item.regime}><td>{item.regime}</td><td>{item.trades}</td><td>{item.wins}</td><td>{percent(item.winRatePercent)}</td><td className={item.netPnl >= 0 ? "pnl-positive" : "pnl-negative"}>{money(item.netPnl)}</td><td>{item.expectancyR.toFixed(2)}R</td></tr>)}
    </tbody></table></div> : <p className="backtest-empty">No closed trades available for regime breakdown.</p>}
    <ul>{analysis.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
  </section>;
}

function ValidationPanel({ validation }: { validation: OutOfSampleValidation }) {
  return <section className="backtest-card backtest-validation-panel">
    <div className="backtest-section-title"><h2>Out-of-sample validation</h2><span>{validation.inSamplePercent}% in-sample · {validation.outOfSamplePercent}% holdout</span></div>
    {validation.status !== "completed" || !validation.inSample || !validation.outOfSample ? <div className="backtest-validation-insufficient"><ShieldAlert size={17} /><span>Not enough historical data to create a reliable split. Choose a wider date range or use an instrument/timeframe with more available history.</span></div> : <>
      <p className="backtest-validation-intro">The holdout period follows the in-sample period chronologically and is scored separately. Do not tune the strategy using these holdout results if you want to preserve an independent evaluation.</p>
      <div className="backtest-table-wrap"><table className="backtest-table backtest-validation-table"><thead><tr><th>Measure</th><th>In-sample</th><th>Out-of-sample holdout</th><th>Buy-and-hold benchmark*</th><th>No-trade baseline</th></tr></thead><tbody>
        <tr><td>Period</td><td>{new Date(validation.inSample.startTime).toLocaleString()} – {new Date(validation.inSample.endTime).toLocaleString()}</td><td>{new Date(validation.outOfSample.startTime).toLocaleString()} – {new Date(validation.outOfSample.endTime).toLocaleString()}</td><td>{new Date(validation.outOfSample.startTime).toLocaleString()} – {new Date(validation.outOfSample.endTime).toLocaleString()}</td><td>{new Date(validation.outOfSample.startTime).toLocaleString()} – {new Date(validation.outOfSample.endTime).toLocaleString()}</td></tr>
        <tr><td>Scored candles</td><td>{validation.inSample.candles.toLocaleString()}</td><td>{validation.outOfSample.candles.toLocaleString()}</td><td>{validation.outOfSample.candles.toLocaleString()}</td><td>{validation.outOfSample.candles.toLocaleString()}</td></tr>
        <tr><td>Net P/L</td><td>{money(validation.inSample.netPnl)}</td><td>{money(validation.outOfSample.netPnl)}</td><td>{validation.benchmark ? money(validation.benchmark.netPnl) : "—"}</td><td>{validation.noTradeBaseline ? money(validation.noTradeBaseline.netPnl) : "—"}</td></tr>
        <tr><td>Return</td><td>{percent(validation.inSample.returnPercent)}</td><td>{percent(validation.outOfSample.returnPercent)}</td><td>{validation.benchmark ? percent(validation.benchmark.returnPercent) : "—"}</td><td>{validation.noTradeBaseline ? percent(validation.noTradeBaseline.returnPercent) : "—"}</td></tr>
        <tr><td>Trade count</td><td>{validation.inSample.trades}</td><td>{validation.outOfSample.trades}</td><td>—</td><td>—</td></tr>
        <tr><td>Win rate</td><td>{percent(validation.inSample.winRatePercent)}</td><td>{percent(validation.outOfSample.winRatePercent)}</td><td>—</td><td>—</td></tr>
        <tr><td>Profit factor</td><td>{validation.inSample.profitFactor === null ? "∞*" : validation.inSample.profitFactor.toFixed(2)}</td><td>{validation.outOfSample.profitFactor === null ? "∞*" : validation.outOfSample.profitFactor.toFixed(2)}</td><td>—</td><td>—</td></tr>
        <tr><td>Expectancy (R)</td><td>{validation.inSample.expectancyR.toFixed(2)}R</td><td>{validation.outOfSample.expectancyR.toFixed(2)}R</td><td>—</td><td>—</td></tr>
        <tr><td>Maximum drawdown</td><td>{percent(validation.inSample.maxDrawdownPercent)}</td><td>{percent(validation.outOfSample.maxDrawdownPercent)}</td><td>—</td><td>—</td></tr>
      </tbody></table></div>
      <p className="backtest-table-note">* Buy-and-hold is a long-only price-return reference. It excludes spread, fees, funding, dividends and instrument-specific contract sizing, so it is not a perfectly matched strategy comparison.</p>
    </>}
    <ul className="backtest-validation-warnings">{validation.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
  </section>;
}
