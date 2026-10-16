import type { BacktestResult, BacktestTrade } from "./backtesting";

export const STRATEGY_RESEARCH_VERSION = "1.0.0" as const;

export type DirectionResearch = {
  direction: "BUY" | "SELL";
  trades: number;
  wins: number;
  netPnl: number;
  winRatePercent: number;
  expectancyR: number;
  profitFactor: number | null;
};

export type StrategyResearch = {
  version: typeof STRATEGY_RESEARCH_VERSION;
  tradeCount: number;
  averageWin: number;
  averageLoss: number;
  payoffRatio: number | null;
  tradeReturnSharpe: number | null;
  tradeReturnSortino: number | null;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  directionBreakdown: DirectionResearch[];
  warnings: string[];
};

function profitFactor(trades: BacktestTrade[]): number | null {
  const wins = trades.reduce((sum, trade) => sum + Math.max(0, trade.netPnl), 0);
  const losses = trades.reduce((sum, trade) => sum + Math.max(0, -trade.netPnl), 0);
  if (losses === 0) return wins > 0 ? null : 0;
  return wins / losses;
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function standardDeviation(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = average(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
}

function streaks(trades: BacktestTrade[]): { wins: number; losses: number } {
  let currentWins = 0, currentLosses = 0, maxWins = 0, maxLosses = 0;
  for (const trade of trades) {
    if (trade.netPnl > 0) {
      currentWins += 1; currentLosses = 0; maxWins = Math.max(maxWins, currentWins);
    } else if (trade.netPnl < 0) {
      currentLosses += 1; currentWins = 0; maxLosses = Math.max(maxLosses, currentLosses);
    } else {
      currentWins = 0; currentLosses = 0;
    }
  }
  return { wins: maxWins, losses: maxLosses };
}

function directionBreakdown(trades: BacktestTrade[]): DirectionResearch[] {
  return (["BUY", "SELL"] as const).map((direction) => {
    const selected = trades.filter((trade) => trade.direction === direction);
    const wins = selected.filter((trade) => trade.netPnl > 0).length;
    return {
      direction,
      trades: selected.length,
      wins,
      netPnl: selected.reduce((sum, trade) => sum + trade.netPnl, 0),
      winRatePercent: selected.length ? wins / selected.length * 100 : 0,
      expectancyR: average(selected.map((trade) => trade.riskAmount > 0 ? trade.netPnl / trade.riskAmount : 0)),
      profitFactor: profitFactor(selected),
    };
  }).filter((item) => item.trades > 0);
}

/** Descriptive trade-level diagnostics. Ratios are not annualized and are not inferential statistics. */
export function analyzeStrategyResearch(result: Pick<BacktestResult, "trades">): StrategyResearch {
  const trades = result.trades;
  const wins = trades.filter((trade) => trade.netPnl > 0).map((trade) => trade.netPnl);
  const losses = trades.filter((trade) => trade.netPnl < 0).map((trade) => Math.abs(trade.netPnl));
  const returns = trades.map((trade) => trade.returnPercent).filter(Number.isFinite);
  const deviation = standardDeviation(returns);
  const downside = returns.filter((value) => value < 0);
  const downsideDeviation = downside.length ? Math.sqrt(average(downside.map((value) => value ** 2))) : null;
  const streak = streaks(trades);
  const warnings: string[] = [];
  if (trades.length < 30) warnings.push("Fewer than 30 closed trades: trade-level ratios and directional comparisons are highly uncertain.");
  if (trades.length < 2) warnings.push("At least two closed trades are required to estimate trade-return dispersion.");
  if (!losses.length) warnings.push("No losing trades in this sample; payoff ratio is unavailable and profit-factor-like measures can be misleading.");
  warnings.push("Trade-return Sharpe and Sortino are unannualized descriptive ratios. Trades are not equally spaced in time, and these values are not statistical significance tests.");
  warnings.push("Directional and streak breakdowns are historical descriptions, not predictions. Avoid selecting rules based on the same holdout period used to evaluate them.");
  return {
    version: STRATEGY_RESEARCH_VERSION,
    tradeCount: trades.length,
    averageWin: average(wins),
    averageLoss: average(losses),
    payoffRatio: losses.length && wins.length ? average(wins) / average(losses) : null,
    tradeReturnSharpe: deviation !== null && deviation > 0 ? average(returns) / deviation : null,
    tradeReturnSortino: downsideDeviation !== null && downsideDeviation > 0 ? average(returns) / downsideDeviation : null,
    maxConsecutiveWins: streak.wins,
    maxConsecutiveLosses: streak.losses,
    directionBreakdown: directionBreakdown(trades),
    warnings,
  };
}
