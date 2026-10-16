import { describe, expect, it } from "vitest";
import { analyzeStrategyResearch } from "../lib/strategy-research";
import type { BacktestTrade } from "../lib/backtesting";

function trade(direction: "BUY" | "SELL", pnl: number, returnPercent = pnl / 100): BacktestTrade {
  return {
    direction, signalTime: "2025-01-01T00:00:00.000Z", entryTime: "2025-01-01T00:01:00.000Z",
    exitTime: "2025-01-01T00:02:00.000Z", entryPrice: 100, exitPrice: 101,
    stopLoss: 99, takeProfit: 102, quantity: 1, riskAmount: 1, grossPnl: pnl,
    fees: 0, netPnl: pnl, returnPercent, barsHeld: 1, exitReason: "take-profit",
  };
}

describe("strategy research diagnostics", () => {
  it("summarizes direction, payoff, and losing/winning streaks", () => {
    const result = analyzeStrategyResearch({ trades: [trade("BUY", 4), trade("BUY", -2), trade("SELL", -3), trade("SELL", 6)] });
    expect(result.version).toBe("1.0.0");
    expect(result.payoffRatio).toBe(2);
    expect(result.maxConsecutiveWins).toBe(1);
    expect(result.maxConsecutiveLosses).toBe(2);
    expect(result.directionBreakdown.map((item) => item.direction)).toEqual(["BUY", "SELL"]);
    expect(result.directionBreakdown[0]?.trades).toBe(2);
  });

  it("handles empty and constant-return samples without NaN or infinity", () => {
    const empty = analyzeStrategyResearch({ trades: [] });
    expect(empty.tradeCount).toBe(0);
    expect(empty.tradeReturnSharpe).toBeNull();
    expect(empty.payoffRatio).toBeNull();
    const constant = analyzeStrategyResearch({ trades: [trade("BUY", 1, 1), trade("SELL", 1, 1)] });
    expect(constant.tradeReturnSharpe).toBeNull();
    expect(constant.tradeReturnSortino).toBeNull();
  });

  it("warns about small samples and labels ratios as unannualized", () => {
    const result = analyzeStrategyResearch({ trades: [trade("BUY", 1)] });
    expect(result.warnings.some((warning) => warning.includes("Fewer than 30"))).toBe(true);
    expect(result.warnings.some((warning) => warning.includes("unannualized"))).toBe(true);
  });

  it("reports finite directional metrics for both sides", () => {
    const result = analyzeStrategyResearch({ trades: [trade("BUY", 3), trade("SELL", -1)] });
    expect(result.directionBreakdown).toHaveLength(2);
    expect(result.directionBreakdown.every((item) => Number.isFinite(item.winRatePercent))).toBe(true);
  });
});
