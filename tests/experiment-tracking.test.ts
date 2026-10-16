import { describe, expect, it } from "vitest";
import type { BacktestResult } from "../lib/backtesting";
import {
  addExperiment,
  createExperimentSnapshot,
  exportExperimentJson,
  MAX_SAVED_EXPERIMENTS,
  type ExperimentSnapshot,
} from "../lib/experiment-tracking";

const result = {
  engineVersion: "1.1.0",
  symbol: "EUR/USD",
  interval: "15min",
  status: "completed",
  config: {
    initialBalance: 10000,
    riskPercent: 1,
    spreadBps: 1,
    slippageBps: 0.5,
    feeBpsPerSide: 0,
    maxCandlesInTrade: 100,
  },
  period: {
    startDate: "2025-01-01",
    endDate: "2025-01-31",
    firstCandleAt: "2025-01-01T00:00:00.000Z",
    lastCandleAt: "2025-01-31T23:45:00.000Z",
    candlesInRange: 1000,
  },
  summary: {
    candlesAnalyzed: 950,
    trades: 20,
    wins: 12,
    losses: 8,
    winRatePercent: 60,
    initialBalance: 10000,
    finalBalance: 10450,
    netPnl: 450,
    returnPercent: 4.5,
    profitFactor: 1.6,
    expectancyPerTrade: 22.5,
    expectancyR: 0.45,
    maxDrawdownPercent: 8.2,
    averageWin: 80,
    averageLoss: -65,
    exposurePercent: 14,
  },
  trades: [],
  equityCurve: [],
} as BacktestResult;

function experiment(id: string): ExperimentSnapshot {
  return createExperimentSnapshot(result, id, "2025-02-01T12:00:00.000Z");
}

describe("experiment tracking", () => {
  it("captures run identity, engine, configuration, data window, and metrics", () => {
    const snapshot = experiment("run-123");
    expect(snapshot.id).toBe("run-123");
    expect(snapshot.engineVersion).toBe("1.1.0");
    expect(snapshot.config.riskPercent).toBe(1);
    expect(snapshot.actualDataWindow.candlesInRange).toBe(1000);
    expect(snapshot.actualDataWindow.candlesAnalyzed).toBe(950);
    expect(snapshot.summary.netPnl).toBe(450);
    expect(snapshot.validationIncluded).toBe(false);
  });

  it("records validation availability and preserves requested dates", () => {
    const snapshot = createExperimentSnapshot({ ...result, validation: {} }, "run-2", "2025-02-01T12:00:00.000Z");
    expect(snapshot.validationIncluded).toBe(true);
    expect(snapshot.requestedPeriod).toEqual({ startDate: "2025-01-01", endDate: "2025-01-31" });
  });

  it("deduplicates run IDs and keeps newest records first within the limit", () => {
    const items = [experiment("same"), experiment("older")];
    const updated = addExperiment(items, { ...experiment("same"), savedAt: "2025-03-01T00:00:00.000Z" });
    expect(updated.map((item) => item.id)).toEqual(["same", "older"]);
    expect(updated[0]?.savedAt).toBe("2025-03-01T00:00:00.000Z");
    const capped = addExperiment(Array.from({ length: 30 }, (_, i) => experiment(`old-${i}`)), experiment("new"));
    expect(capped).toHaveLength(MAX_SAVED_EXPERIMENTS);
    expect(capped[0]?.id).toBe("new");
  });

  it("exports a portable JSON snapshot", () => {
    const snapshot = experiment("json-run");
    const parsed = JSON.parse(exportExperimentJson(snapshot)) as ExperimentSnapshot;
    expect(parsed).toEqual(snapshot);
  });
});
