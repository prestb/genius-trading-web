import { describe, expect, it } from "vitest";
import { resolveStopTargetHit, runBacktest, type BacktestInput } from "../lib/backtesting";
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
    candles: makeCandles(450, 60, Date.parse("2025-01-01T00:00:00.000Z")),
    higherTimeframeCandles: {
      "5min": makeCandles(700, 300),
      "15min": makeCandles(700, 900),
    },
    config: { spreadBps: 0, slippageBps: 0, feeBpsPerSide: 0, maxCandlesInTrade: 8 },
  };
  return { ...base, ...overrides, config: { ...base.config, ...overrides.config } };
}

describe("runBacktest", () => {
  it("returns a completed result with coherent summary fields", () => {
    const result = runBacktest(validInput());
    expect(result.status).toBe("completed");
    expect(result.summary.candlesAnalyzed).toBe(450);
    expect(result.equityCurve.length).toBe(451);
    expect(result.summary.trades).toBe(result.trades.length);
    expect(Number.isFinite(result.summary.finalBalance)).toBe(true);
    expect(result.warnings.some((warning) => warning.includes("future candles"))).toBe(true);
    expect(result.trades.every((trade) => Date.parse(trade.signalTime) <= Date.parse(trade.entryTime))).toBe(true);
  });

  it("does not generate trades without the required higher-timeframe candles", () => {
    const result = runBacktest(validInput({ higherTimeframeCandles: {} }));
    expect(result.status).toBe("completed");
    expect(result.trades).toHaveLength(0);
  });

  it("blocks trades when higher-timeframe directions conflict", () => {
    const input = validInput({
      higherTimeframeCandles: {
        "5min": makeCandles(700, 300),
        "15min": makeCandles(700, 900, BASE_TIME, -0.02),
      },
    });
    const result = runBacktest(input);
    expect(result.trades).toHaveLength(0);
  });

  it("does not use higher-timeframe candles that have not closed by the decision time", () => {
    const futureStart = Date.parse("2025-01-10T00:00:00.000Z");
    const result = runBacktest(validInput({
      higherTimeframeCandles: {
        "5min": makeCandles(700, 300, futureStart),
        "15min": makeCandles(700, 900, futureStart),
      },
    }));
    expect(result.trades).toHaveLength(0);
  });

  it("returns insufficient-data for a history too short to execute a signal", () => {
    const result = runBacktest(validInput({ candles: makeCandles(200, 60) }));
    expect(result.status).toBe("insufficient-data");
    expect(result.summary.trades).toBe(0);
    expect(result.summary.finalBalance).toBe(result.config.initialBalance);
  });

  it("rejects invalid or unordered OHLC data", () => {
    const candles = makeCandles(250, 60);
    candles[10] = { ...candles[10]!, high: 1, low: 200 };
    expect(() => runBacktest(validInput({ candles }))).toThrow(/valid OHLC/);
    expect(() => runBacktest(validInput({ candles: makeCandles(250, 60).reverse() }))).toThrow(/chronological order/);
  });

  it("rejects risk settings above the configured safety cap", () => {
    expect(() => runBacktest(validInput({ config: { riskPercent: 5.1 } }))).toThrow(/no more than 5%/);
  });

  it("includes trading costs in net PnL", () => {
    const noCosts = runBacktest(validInput());
    const withCosts = runBacktest(validInput({ config: { spreadBps: 3, slippageBps: 2, feeBpsPerSide: 1 } }));
    expect(withCosts.summary.finalBalance).toBeLessThanOrEqual(noCosts.summary.finalBalance);
  });

  it("uses stop-loss first when a candle touches both stop and target", () => {
    expect(resolveStopTargetHit("BUY", { high: 112, low: 88 }, 95, 105)).toEqual({ price: 95, reason: "stop-loss" });
    expect(resolveStopTargetHit("SELL", { high: 112, low: 88 }, 105, 95)).toEqual({ price: 105, reason: "stop-loss" });
  });

  it("reports bounded drawdown and exposure percentages", () => {
    const result = runBacktest(validInput());
    expect(result.summary.maxDrawdownPercent).toBeGreaterThanOrEqual(0);
    expect(result.summary.maxDrawdownPercent).toBeLessThanOrEqual(100);
    expect(result.summary.exposurePercent).toBeGreaterThanOrEqual(0);
    expect(result.summary.exposurePercent).toBeLessThanOrEqual(100);
  });

  it("restricts simulated trades to an inclusive UTC date range while using earlier candles for warm-up", () => {
    const start = Date.parse("2024-12-31T20:00:00.000Z");
    const candles = makeCandles(450, 60, start);
    const result = runBacktest(validInput({ candles, startDate: "2025-01-01", endDate: "2025-01-01" }));
    expect(result.status).toBe("completed");
    expect(result.summary.candlesAnalyzed).toBe(210);
    expect(result.period.candlesInRange).toBe(210);
    expect(result.period.firstCandleAt).toBe("2025-01-01T00:00:00.000Z");
    expect(result.trades.every((trade) =>
      Date.parse(trade.signalTime) >= Date.parse("2025-01-01T00:00:00.000Z") &&
      Date.parse(trade.exitTime) < Date.parse("2025-01-02T00:00:00.000Z")
    )).toBe(true);
  });

  it("rejects reversed and malformed historical date ranges", () => {
    expect(() => runBacktest(validInput({ startDate: "2025-02-01", endDate: "2025-01-01" })))
      .toThrow(/startDate must be on or before endDate/);
    expect(() => runBacktest(validInput({ startDate: "2025-02-30", endDate: "2025-03-01" })))
      .toThrow(/valid YYYY-MM-DD/);
  });

  it("requires pre-period warm-up history for an explicit start date", () => {
    const candles = makeCandles(250, 60, Date.parse("2025-01-01T00:00:00.000Z"));
    const result = runBacktest(validInput({ candles, startDate: "2025-01-01", endDate: "2025-01-01" }));
    expect(result.status).toBe("insufficient-data");
    expect(result.trades).toHaveLength(0);
  });

  it("models a stop gap at the candle open rather than assuming a fill at the stop price", () => {
    expect(resolveStopTargetHit("BUY", { open: 90, high: 94, low: 88 }, 95, 105))
      .toEqual({ price: 90, reason: "stop-loss" });
    expect(resolveStopTargetHit("SELL", { open: 110, high: 112, low: 106 }, 105, 95))
      .toEqual({ price: 110, reason: "stop-loss" });
  });

  it("blocks trades if completed higher-timeframe candles are unordered or duplicated", () => {
    const htf = makeCandles(700, 300);
    htf[400] = { ...htf[400]!, time: htf[399]!.time };
    const result = runBacktest(validInput({
      higherTimeframeCandles: { "5min": htf, "15min": makeCandles(700, 900) },
    }));
    expect(result.trades).toHaveLength(0);
  });

});

  it("closes any open trade at the selected test-window end instead of using later candles", () => {
    const candles = makeCandles(500, 60, Date.parse("2025-01-01T00:00:00.000Z"));
    const endTime = candles[349]!.time;
    const result = runBacktest(validInput({
      candles,
      testStartTime: candles[250]!.time,
      testEndTime: endTime,
      config: { maxCandlesInTrade: 10000 },
    }));
    expect(result.period.lastCandleAt).toBe(endTime);
    expect(result.trades.every((trade) => Date.parse(trade.exitTime) <= Date.parse(endTime))).toBe(true);
  });

  it("rejects overlapping calendar and precise timestamp bounds", () => {
    const candles = makeCandles(450, 60);
    expect(() => runBacktest(validInput({
      candles,
      startDate: "2025-01-01",
      testStartTime: candles[250]!.time,
    }))).toThrow(/either calendar date bounds or precise test timestamps/);
  });
