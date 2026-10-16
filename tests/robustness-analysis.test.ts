import { describe, expect, it } from "vitest";
import { runBacktest, type BacktestInput } from "../lib/backtesting";
import { analyzeRobustness } from "../lib/robustness-analysis";
import type { IndicatorCandle } from "../lib/indicators";

const BASE_TIME = Date.parse("2025-01-01T00:00:00.000Z");

function candles(count: number, seconds: number, start = BASE_TIME, slope = 0.02): IndicatorCandle[] {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index * slope + Math.sin(index * Math.PI / 12) * 0.35;
    const open = close - 0.02;
    return {
      time: new Date(start + index * seconds * 1000).toISOString(),
      open,
      high: Math.max(open, close) + 0.2,
      low: Math.min(open, close) - 0.2,
      close,
    };
  });
}

function input(overrides: Partial<BacktestInput> = {}): BacktestInput {
  const base: BacktestInput = {
    symbol: "EUR/USD",
    interval: "1min",
    candles: candles(500, 60),
    higherTimeframeCandles: {
      "5min": candles(700, 300),
      "15min": candles(700, 900),
    },
    config: { spreadBps: 1, slippageBps: 0.5, feeBpsPerSide: 0, maxCandlesInTrade: 8 },
  };
  return { ...base, ...overrides, config: { ...base.config, ...overrides.config } };
}

describe("analyzeRobustness", () => {
  it("returns baseline, 1.5x and 2x transaction-cost scenarios", () => {
    const data = input();
    const result = runBacktest(data);
    const analysis = analyzeRobustness(data, result);
    expect(analysis.costSensitivity.map((scenario) => scenario.label)).toEqual([
      "Baseline costs", "1.5× costs", "2× costs",
    ]);
    expect(analysis.costSensitivity[0]!.netPnl).toBe(result.summary.netPnl);
    expect(analysis.costSensitivity[2]!.spreadBps).toBe(result.config.spreadBps * 2);
  });

  it("reports a bounded, typed regime breakdown without inventing trades", () => {
    const data = input();
    const result = runBacktest(data);
    const analysis = analyzeRobustness(data, result);
    expect(analysis.version).toBe("1.0.0");
    expect(analysis.regimePerformance.reduce((sum, item) => sum + item.trades, 0)).toBe(result.trades.length);
    for (const item of analysis.regimePerformance) {
      expect(item.winRatePercent).toBeGreaterThanOrEqual(0);
      expect(item.winRatePercent).toBeLessThanOrEqual(100);
      expect(Number.isFinite(item.expectancyR)).toBe(true);
    }
  });

  it("warns when the trade sample is too small to support strong conclusions", () => {
    const data = input({ candles: candles(250, 60) });
    const result = runBacktest(data);
    const analysis = analyzeRobustness(data, result);
    expect(analysis.warnings.some((warning) => warning.includes("Fewer than 30 trades"))).toBe(true);
  });

  it("does not mutate the input configuration while scaling costs", () => {
    const data = input();
    const before = { ...data.config };
    analyzeRobustness(data, runBacktest(data));
    expect(data.config).toEqual(before);
  });
});
