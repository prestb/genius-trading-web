import { describe, expect, it } from "vitest";
import {
  analyzeMultiTimeframe,
  getRequiredHigherTimeframes,
  type MultiTimeframeFrameInput,
} from "../lib/multi-timeframe";
import { analyzeSignal, type SignalAnalysisInput } from "../lib/signal-analysis";
import type { IndicatorCandle } from "../lib/indicators";
import type { TrendAnalysis } from "../lib/trend-analysis";

function makeCandles(direction: "up" | "down" = "up", count = 200): IndicatorCandle[] {
  return Array.from({ length: count }, (_, index) => {
    const close = direction === "up" ? 100 + index * 0.1 : 120 - index * 0.1;
    return {
      time: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
      open: close,
      high: close + 1,
      low: close - 1,
      close,
    };
  });
}

function frame(
  interval: string,
  direction: "Bullish" | "Bearish" | "Neutral" = "Bullish",
  overrides: Partial<MultiTimeframeFrameInput> = {},
): MultiTimeframeFrameInput {
  return {
    symbol: "TEST",
    interval,
    candles: makeCandles(direction === "Bearish" ? "down" : "up"),
    isFresh: true,
    candleAgeSeconds: 60,
    direction,
    ...overrides,
  };
}

const bullishTrend: TrendAnalysis = {
  direction: "Bullish",
  timeframe: "Long-term",
  explanation: "Bullish test trend.",
  checksPassed: 3,
  checksRequired: 3,
};

const bearishTrend: TrendAnalysis = {
  direction: "Bearish",
  timeframe: "Long-term",
  explanation: "Bearish test trend.",
  checksPassed: 3,
  checksRequired: 3,
};

function signalInput(overrides: Partial<SignalAnalysisInput> = {}): SignalAnalysisInput {
  return {
    symbol: "TEST",
    interval: "1h",
    candles: makeCandles(),
    indicators: { ema50: 115, ema200: 110, rsi14: 60, atr14: 2 },
    trend: bullishTrend,
    isFresh: true,
    candleAgeSeconds: 60,
    analyzedAt: "2026-10-14T12:00:00.000Z",
    ...overrides,
  };
}

describe("multi-timeframe confirmation", () => {
  it("maps each supported timeframe to higher confirmations", () => {
    expect(getRequiredHigherTimeframes("1min")).toEqual(["5min", "15min"]);
    expect(getRequiredHigherTimeframes("5min")).toEqual(["15min", "1h"]);
    expect(getRequiredHigherTimeframes("15min")).toEqual(["1h", "4h"]);
    expect(getRequiredHigherTimeframes("30min")).toEqual(["1h", "4h"]);
    expect(getRequiredHigherTimeframes("1h")).toEqual(["4h", "1day"]);
    expect(getRequiredHigherTimeframes("4h")).toEqual(["1day", "1week"]);
    expect(getRequiredHigherTimeframes("1day")).toEqual(["1week"]);
  });

  it("confirms when every required higher timeframe agrees", () => {
    const result = analyzeMultiTimeframe({
      symbol: "TEST",
      selectedInterval: "1h",
      frames: [frame("4h"), frame("1day")],
    });

    expect(result.status).toBe("Confirmed");
    expect(result.direction).toBe("Bullish");
    expect(result.frames.every((item) => item.status === "Confirmed")).toBe(true);
  });

  it("blocks conflicting higher-timeframe directions", () => {
    const result = analyzeMultiTimeframe({
      symbol: "TEST",
      selectedInterval: "1h",
      frames: [frame("4h"), frame("1day", "Bearish")],
    });

    expect(result.status).toBe("Conflict");
    expect(result.direction).toBeNull();
    expect(result.frames.every((item) => item.status === "Conflict")).toBe(true);
  });

  it("blocks missing required timeframe data", () => {
    const result = analyzeMultiTimeframe({
      symbol: "TEST",
      selectedInterval: "1h",
      frames: [frame("4h")],
    });

    expect(result.status).toBe("Unavailable");
    expect(result.frames.find((item) => item.interval === "1day")?.status).toBe("Unavailable");
  });

  it("blocks stale higher-timeframe data", () => {
    const result = analyzeMultiTimeframe({
      symbol: "TEST",
      selectedInterval: "1h",
      frames: [frame("4h", "Bullish", { isFresh: false }), frame("1day")],
    });

    expect(result.status).toBe("Unavailable");
    expect(result.frames[0]?.detail).toContain("freshness");
  });

  it("blocks missing age verification", () => {
    const result = analyzeMultiTimeframe({
      symbol: "TEST",
      selectedInterval: "1h",
      frames: [frame("4h", "Bullish", { candleAgeSeconds: null }), frame("1day")],
    });
    expect(result.status).toBe("Unavailable");
  });

  it("blocks insufficient history", () => {
    const result = analyzeMultiTimeframe({
      symbol: "TEST",
      selectedInterval: "1h",
      frames: [frame("4h", "Bullish", { candles: makeCandles("up", 100) }), frame("1day")],
    });
    expect(result.status).toBe("Unavailable");
  });

  it("blocks invalid and non-chronological candles", () => {
    const invalid = makeCandles();
    invalid[10] = { ...invalid[10]!, high: 1 };
    const reversed = makeCandles();
    [reversed[20], reversed[21]] = [reversed[21]!, reversed[20]!];

    expect(analyzeMultiTimeframe({
      symbol: "TEST",
      selectedInterval: "1h",
      frames: [frame("4h", "Bullish", { candles: invalid }), frame("1day")],
    }).status).toBe("Unavailable");

    expect(analyzeMultiTimeframe({
      symbol: "TEST",
      selectedInterval: "1h",
      frames: [frame("4h", "Bullish", { candles: reversed }), frame("1day")],
    }).status).toBe("Unavailable");
  });

  it("rejects data for a different symbol or interval", () => {
    const result = analyzeMultiTimeframe({
      symbol: "TEST",
      selectedInterval: "1h",
      frames: [
        frame("4h", "Bullish", { symbol: "OTHER" }),
        frame("1day"),
      ],
    });
    expect(result.status).toBe("Unavailable");
  });

  it("blocks neutral higher-timeframe direction", () => {
    const result = analyzeMultiTimeframe({
      symbol: "TEST",
      selectedInterval: "1h",
      frames: [frame("4h", "Neutral"), frame("1day")],
    });
    expect(result.status).toBe("Blocked");
  });

  it("requires weekly confirmation for the daily timeframe", () => {
    const result = analyzeMultiTimeframe({
      symbol: "TEST",
      selectedInterval: "1day",
      frames: [frame("1week")],
    });
    expect(result.status).toBe("Confirmed");
    expect(result.requiredIntervals).toEqual(["1week"]);
  });

  it("allows BUY only when higher timeframes confirm BUY", () => {
    const multiTimeframe = analyzeMultiTimeframe({
      symbol: "TEST",
      selectedInterval: "1h",
      frames: [frame("4h"), frame("1day")],
    });
    const result = analyzeSignal(signalInput({ multiTimeframe }));
    expect(result.direction).toBe("BUY");
    expect(result.actionable).toBe(true);
    expect(result.reasons.some((reason) => reason.code === "MULTI_TIMEFRAME_CONFIRMATION" && reason.passed)).toBe(true);
  });

  it("allows SELL only when higher timeframes confirm SELL", () => {
    const multiTimeframe = analyzeMultiTimeframe({
      symbol: "TEST",
      selectedInterval: "1h",
      frames: [frame("4h", "Bearish"), frame("1day", "Bearish")],
    });
    const result = analyzeSignal(signalInput({
      candles: makeCandles("down"),
      indicators: { ema50: 105, ema200: 110, rsi14: 40, atr14: 2 },
      trend: bearishTrend,
      multiTimeframe,
    }));
    expect(result.direction).toBe("SELL");
    expect(result.actionable).toBe(true);
    expect(result.reasons.some((reason) => reason.code === "MULTI_TIMEFRAME_CONFIRMATION" && reason.passed)).toBe(true);
  });

  it("blocks an otherwise valid BUY when higher timeframes conflict", () => {
    const multiTimeframe = analyzeMultiTimeframe({
      symbol: "TEST",
      selectedInterval: "1h",
      frames: [frame("4h"), frame("1day", "Bearish")],
    });
    const result = analyzeSignal(signalInput({ multiTimeframe }));
    expect(result.direction).toBe("WAIT");
    expect(result.actionable).toBe(false);
    expect(result.riskPlan).toBeNull();
    expect(result.reasons[0]?.code).toBe("MULTI_TIMEFRAME_CONFLICT");
  });

  it("blocks an otherwise valid BUY when confirmation data is missing", () => {
    const multiTimeframe = analyzeMultiTimeframe({
      symbol: "TEST",
      selectedInterval: "1h",
      frames: [frame("4h")],
    });
    const result = analyzeSignal(signalInput({ multiTimeframe }));
    expect(result.direction).toBe("WAIT");
    expect(result.reasons[0]?.code).toBe("MULTI_TIMEFRAME_UNAVAILABLE");
  });

  it("rejects confirmation reused for another symbol or selected interval", () => {
    const multiTimeframe = analyzeMultiTimeframe({
      symbol: "OTHER",
      selectedInterval: "1h",
      frames: [frame("4h", "Bullish", { symbol: "OTHER" }), frame("1day", "Bullish", { symbol: "OTHER" })],
    });
    const result = analyzeSignal(signalInput({ multiTimeframe }));
    expect(result.direction).toBe("WAIT");
    expect(result.reasons[0]?.code).toBe("MULTI_TIMEFRAME_IDENTITY_MISMATCH");
  });

  it("does not break existing single-timeframe callers that omit the gate", () => {
    const result = analyzeSignal(signalInput());
    expect(result.direction).toBe("BUY");
    expect(result.actionable).toBe(true);
  });
});
