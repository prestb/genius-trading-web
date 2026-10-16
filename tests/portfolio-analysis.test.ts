import { describe, expect, it } from "vitest";
import { analyzePortfolio, type PortfolioComponent } from "../lib/portfolio-analysis";
import type { BacktestResult } from "../lib/backtesting";

function component(id: string, symbol: string, initialBalance: number, points: [string, number][]): PortfolioComponent {
  const result = {
    engineVersion: "1.1.0", symbol, interval: "15min", status: "completed",
    config: { initialBalance, riskPercent: 1, spreadBps: 1, slippageBps: 0, feeBpsPerSide: 0, maxCandlesInTrade: 10 },
    period: { startDate: null, endDate: null, firstCandleAt: points[0]?.[0] ?? null, lastCandleAt: points.at(-1)?.[0] ?? null, candlesInRange: points.length },
    summary: { candlesAnalyzed: points.length, trades: 0, wins: 0, losses: 0, winRatePercent: 0, initialBalance, finalBalance: points.at(-1)?.[1] ?? initialBalance, netPnl: (points.at(-1)?.[1] ?? initialBalance) - initialBalance, returnPercent: 0, profitFactor: null, expectancyPerTrade: 0, expectancyR: 0, maxDrawdownPercent: 0, averageWin: 0, averageLoss: 0, exposurePercent: 0 },
    equityCurve: points.map(([time, equity]) => ({ time, equity })),
  } as unknown as BacktestResult;
  return { id, result };
}

const times = ["2025-01-01T00:00:00.000Z", "2025-01-01T00:15:00.000Z", "2025-01-01T00:30:00.000Z", "2025-01-01T00:45:00.000Z"];

describe("portfolio analysis", () => {
  it("combines independent starting balances and equity curves", () => {
    const result = analyzePortfolio([
      component("a", "EUR/USD", 1000, times.map((time, i) => [time, [1000, 1010, 1020, 1030][i]!] as [string, number])),
      component("b", "GBP/USD", 2000, times.map((time, i) => [time, [2000, 1990, 2010, 2020][i]!] as [string, number])),
    ]);
    expect(result.components).toBe(2);
    expect(result.initialCapital).toBe(3000);
    expect(result.finalEquity).toBe(3050);
    expect(result.netPnl).toBe(50);
    expect(result.returnPercent).toBeCloseTo(50 / 3000 * 100);
    expect(result.equityCurve).toHaveLength(4);
  });

  it("calculates maximum portfolio drawdown from combined equity", () => {
    const result = analyzePortfolio([component("a", "EUR/USD", 1000, times.map((time, i) => [time, [1000, 1200, 900, 1100][i]!] as [string, number]))]);
    expect(result.maxDrawdownPercent).toBeCloseTo(25);
  });

  it("reports pairwise correlation when shared return observations are available", () => {
    const result = analyzePortfolio([
      component("a", "EUR/USD", 1000, times.map((time, i) => [time, [100, 110, 105, 120][i]!] as [string, number])),
      component("b", "GBP/USD", 1000, times.map((time, i) => [time, [200, 220, 210, 240][i]!] as [string, number])),
    ]);
    expect(result.correlations).toHaveLength(1);
    expect(result.correlations[0]?.correlation).toBeCloseTo(1);
  });

  it("handles empty portfolios and explains limitations", () => {
    const result = analyzePortfolio([]);
    expect(result.initialCapital).toBe(0);
    expect(result.finalEquity).toBe(0);
    expect(result.returnPercent).toBe(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
