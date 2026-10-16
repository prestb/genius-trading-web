import { describe, expect, it } from "vitest";
import { tradesToAuditCsv } from "../lib/trade-audit";
import type { BacktestTrade } from "../lib/backtesting";

const trade: BacktestTrade = {
  direction: "BUY",
  signalTime: "2025-01-01T10:00:00.000Z",
  entryTime: "2025-01-01T10:15:00.000Z",
  exitTime: "2025-01-01T11:00:00.000Z",
  entryPrice: 1.1,
  exitPrice: 1.105,
  stopLoss: 1.095,
  takeProfit: 1.11,
  quantity: 1000,
  riskAmount: 5,
  grossPnl: 5,
  fees: 0.5,
  netPnl: 4.5,
  returnPercent: 0.045,
  barsHeld: 3,
  exitReason: "take-profit",
};

const metadata = {
  symbol: "EUR/USD",
  interval: "15min",
  engineVersion: "1.1.0",
  periodStart: "2025-01-01T00:00:00.000Z",
  periodEnd: "2025-01-31T23:45:00.000Z",
};

describe("trade audit CSV", () => {
  it("exports all audit fields and metadata", () => {
    const csv = tradesToAuditCsv([trade], metadata);
    expect(csv.split("\\r\\n")).toHaveLength(2);
    expect(csv).toContain("symbol,interval,engineVersion");
    expect(csv).toContain('EUR/USD,"15min",1.1.0');
    expect(csv).toContain("take-profit");
    expect(csv).toContain("2025-01-01T10:00:00.000Z");
  });

  it("escapes commas, quotes, and newlines in values", () => {
    const csv = tradesToAuditCsv([trade], { ...metadata, symbol: 'EUR, "USD"\\nspot' });
    expect(csv).toContain('"EUR, ""USD""\\nspot"');
  });

  it("exports every trade rather than truncating the list", () => {
    const trades = Array.from({ length: 125 }, (_, index) => ({
      ...trade,
      signalTime: new Date(Date.parse(trade.signalTime) + index * 60_000).toISOString(),
    }));
    expect(tradesToAuditCsv(trades, metadata).split("\\r\\n")).toHaveLength(126);
  });

  it("exports a header for an empty trade list", () => {
    const csv = tradesToAuditCsv([], metadata);
    expect(csv.split("\\r\\n")).toHaveLength(1);
    expect(csv).toContain("exitReason");
  });
});
