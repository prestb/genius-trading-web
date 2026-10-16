import { runBacktest, type BacktestInput, type BacktestResult } from "./backtesting";
import type { IndicatorCandle } from "./indicators";

export const ROBUSTNESS_ANALYSIS_VERSION = "1.0.0" as const;

export type CostScenario = {
  label: string;
  spreadBps: number;
  slippageBps: number;
  feeBpsPerSide: number;
  netPnl: number;
  returnPercent: number;
  trades: number;
  profitFactor: number | null;
  expectancyR: number;
};

export type RegimeBucket = "Trending" | "Ranging" | "Mixed" | "High volatility";

export type RegimePerformance = {
  regime: RegimeBucket;
  trades: number;
  wins: number;
  netPnl: number;
  winRatePercent: number;
  expectancyR: number;
};

export type RobustnessAnalysis = {
  version: typeof ROBUSTNESS_ANALYSIS_VERSION;
  costSensitivity: CostScenario[];
  regimePerformance: RegimePerformance[];
  warnings: string[];
};

function safeProfitFactor(result: BacktestResult): number | null {
  const grossWins = result.trades.reduce((sum, trade) => sum + Math.max(0, trade.netPnl), 0);
  const grossLosses = result.trades.reduce((sum, trade) => sum + Math.max(0, -trade.netPnl), 0);
  return grossLosses === 0 ? (grossWins > 0 ? null : 0) : grossWins / grossLosses;
}

function candleRegimes(candles: IndicatorCandle[]): Map<string, RegimeBucket> {
  const windowSize = 20;
  const windows: { time: string; efficiency: number; volatility: number }[] = [];
  for (let end = windowSize; end <= candles.length; end += 1) {
    const slice = candles.slice(end - windowSize, end);
    const closes = slice.map((candle) => candle.close);
    const path = closes.slice(1).reduce((sum, close, index) => sum + Math.abs(close - closes[index]!), 0);
    const net = Math.abs(closes.at(-1)! - closes[0]!);
    const returns = closes.slice(1).map((close, index) => Math.abs(close / closes[index]! - 1));
    const volatility = returns.reduce((sum, value) => sum + value, 0) / Math.max(1, returns.length);
    windows.push({ time: slice.at(-1)!.time, efficiency: path > 0 ? net / path : 0, volatility });
  }
  const sortedVolatility = windows.map((item) => item.volatility).sort((a, b) => a - b);
  const median = sortedVolatility.length ? sortedVolatility[Math.floor(sortedVolatility.length / 2)]! : 0;
  const result = new Map<string, RegimeBucket>();
  for (const window of windows) {
    const regime: RegimeBucket = median > 0 && window.volatility >= median * 1.8
      ? "High volatility"
      : window.efficiency >= 0.45
        ? "Trending"
        : window.efficiency <= 0.2
          ? "Ranging"
          : "Mixed";
    result.set(window.time, regime);
  }
  return result;
}

export function analyzeRobustness(input: BacktestInput, baseline: BacktestResult): RobustnessAnalysis {
  const baseConfig = { ...baseline.config };
  const costMultipliers = [
    { label: "Baseline costs", multiplier: 1 },
    { label: "1.5× costs", multiplier: 1.5 },
    { label: "2× costs", multiplier: 2 },
  ];
  const costSensitivity = costMultipliers.map(({ label, multiplier }) => {
    const result = multiplier === 1
      ? baseline
      : runBacktest({
          ...input,
          config: {
            ...baseConfig,
            spreadBps: baseConfig.spreadBps * multiplier,
            slippageBps: baseConfig.slippageBps * multiplier,
            feeBpsPerSide: baseConfig.feeBpsPerSide * multiplier,
          },
        });
    return {
      label,
      spreadBps: result.config.spreadBps,
      slippageBps: result.config.slippageBps,
      feeBpsPerSide: result.config.feeBpsPerSide,
      netPnl: result.summary.netPnl,
      returnPercent: result.summary.returnPercent,
      trades: result.summary.trades,
      profitFactor: safeProfitFactor(result),
      expectancyR: result.summary.expectancyR,
    };
  });

  const regimes = candleRegimes(input.candles);
  const grouped = new Map<RegimeBucket, typeof baseline.trades>();
  for (const trade of baseline.trades) {
    const tradeTime = Date.parse(trade.entryTime);
    let regime: RegimeBucket = "Mixed";
    for (const [time, candidate] of regimes) {
      if (Date.parse(time) <= tradeTime) regime = candidate;
      else break;
    }
    const trades = grouped.get(regime) ?? [];
    trades.push(trade);
    grouped.set(regime, trades);
  }
  const order: RegimeBucket[] = ["Trending", "Ranging", "High volatility", "Mixed"];
  const regimePerformance = order.filter((regime) => grouped.has(regime)).map((regime) => {
    const trades = grouped.get(regime)!;
    const wins = trades.filter((trade) => trade.netPnl > 0).length;
    return {
      regime,
      trades: trades.length,
      wins,
      netPnl: trades.reduce((sum, trade) => sum + trade.netPnl, 0),
      winRatePercent: trades.length ? (wins / trades.length) * 100 : 0,
      expectancyR: trades.length ? trades.reduce((sum, trade) => sum + (trade.riskAmount > 0 ? trade.netPnl / trade.riskAmount : 0), 0) / trades.length : 0,
    };
  });

  const warnings: string[] = [];
  if (baseline.summary.trades < 30) warnings.push("Fewer than 30 trades: regime and cost-sensitivity results are highly uncertain.");
  if (input.candles.length < 250) warnings.push("Limited candle history may make regime classification unstable.");
  if (costSensitivity.at(-1)!.netPnl > costSensitivity[0]!.netPnl) warnings.push("Higher modeled costs improved net P/L; inspect trade execution and cost assumptions.");
  warnings.push("Regimes are heuristic classifications of historical price movement, not official market states or predictive labels.");
  warnings.push("Cost scenarios scale the configured spread, slippage, and per-side fee; they do not model variable intrabar spreads, financing, or broker-specific contract rules.");
  return { version: ROBUSTNESS_ANALYSIS_VERSION, costSensitivity, regimePerformance, warnings };
}
