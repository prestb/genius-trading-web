import { describe, expect, it } from "vitest";
import { createValidationPlan, runOutOfSampleValidation } from "../lib/backtest-validation";
import type { BacktestInput } from "../lib/backtesting";
import type { IndicatorCandle } from "../lib/indicators";

const BASE_TIME = Date.parse("2024-12-30T00:00:00.000Z");

function makeCandles(count: number, intervalSeconds: number, startTime = BASE_TIME, slope = 0.02): IndicatorCandle[] {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index * slope + Math.sin(index * Math.PI / 12) * 0.35;
    const open = close - 0.02;
    return {
      time: new Date(startTime + index * intervalSeconds * 1000).toISOString(),
      open,
      high: Math.max(open, close) + 0.2,
      low: Math.min(open, close) - 0.2,
      close,
    };
  });
}

function validInput(overrides: Partial<BacktestInput> = {}): BacktestInput {
  const base: BacktestInput = {
    symbol: "EUR/USD",
    interval: "1min",
    candles: makeCandles(600, 60, Date.parse("2025-01-01T00:00:00.000Z")),
    higherTimeframeCandles: {
      "5min": makeCandles(900, 300),
      "15min": makeCandles(900, 900),
    },
    config: { initialBalance: 10000, spreadBps: 0, slippageBps: 0, feeBpsPerSide: 0, maxCandlesInTrade: 8 },
  };
  return { ...base, ...overrides, config: { ...base.config, ...overrides.config } };
}

describe("out-of-sample validation planning", () => {
  it("creates chronological non-overlapping 70/30 windows after warm-up", () => {
    const candles = makeCandles(700, 60);
    const result = createValidationPlan(candles);
    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.plan.inSample.candles + result.plan.outOfSample.candles).toBe(500);
    expect(Date.parse(result.plan.inSample.endTime)).toBeLessThan(Date.parse(result.plan.outOfSample.startTime));
    expect(result.plan.testStartIndex).toBe(200);
  });

  it("respects a selected UTC date range", () => {
    const candles = makeCandles(700, 3600, Date.parse("2024-12-10T00:00:00.000Z"));
    const result = createValidationPlan(candles, { startDate: "2024-12-25", endDate: "2024-12-30" });
    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.plan.inSample.startTime >= "2024-12-25T00:00:00.000Z").toBe(true);
    expect(result.plan.outOfSample.endTime < "2024-12-31T00:00:00.000Z").toBe(true);
  });

  it("requires enough warm-up history", () => {
    const result = createValidationPlan(makeCandles(300, 60, Date.parse("2025-01-01T00:00:00.000Z")), { startDate: "2025-01-01" });
    expect(result.status).toBe("insufficient-data");
  });

  it("requires minimum candle counts in both scored periods", () => {
    const result = createValidationPlan(makeCandles(240, 60));
    expect(result.status).toBe("insufficient-data");
  });

  it("rejects reversed or malformed dates", () => {
    expect(() => createValidationPlan(makeCandles(700, 60), { startDate: "2025-02-01", endDate: "2025-01-01" }))
      .toThrow(/on or before/);
    expect(() => createValidationPlan(makeCandles(700, 60), { startDate: "2025-02-30" }))
      .toThrow(/valid YYYY-MM-DD/);
  });

  it("rejects an invalid in-sample split percentage", () => {
    expect(() => createValidationPlan(makeCandles(700, 60), { inSamplePercent: 40 })).toThrow(/between 50 and 90/);
  });

  it("rejects unordered or duplicated candles before splitting", () => {
    const candles = makeCandles(700, 60);
    candles[300] = { ...candles[300]!, time: candles[299]!.time };
    expect(() => createValidationPlan(candles)).toThrow(/strictly increasing chronological order/);
  });
});

describe("runOutOfSampleValidation", () => {
  it("reports separate in-sample, out-of-sample and benchmark metrics", () => {
    const result = runOutOfSampleValidation(validInput());
    expect(result.status).toBe("completed");
    expect(result.inSample).not.toBeNull();
    expect(result.outOfSample).not.toBeNull();
    expect(result.benchmark?.label).toBe("Long-only buy-and-hold (price-only)");
    expect(result.noTradeBaseline?.returnPercent).toBe(0);
    expect(result.noTradeBaseline?.netPnl).toBe(0);
    expect(Date.parse(result.inSample!.endTime)).toBeLessThan(Date.parse(result.outOfSample!.startTime));
    expect(result.outOfSample!.candles).toBeGreaterThan(0);
  });

  it("does not claim validation when history is too short", () => {
    const result = runOutOfSampleValidation(validInput({ candles: makeCandles(250, 60) }));
    expect(result.status).toBe("insufficient-data");
    expect(result.inSample).toBeNull();
    expect(result.outOfSample).toBeNull();
    expect(result.benchmark).toBeNull();
  });

  it("documents benchmark limitations and the untouched-holdout requirement", () => {
    const result = runOutOfSampleValidation(validInput());
    expect(result.warnings.some((warning) => warning.includes("untouched holdout"))).toBe(true);
    expect(result.warnings.some((warning) => warning.includes("excludes spread, fees"))).toBe(true);
  });
});
