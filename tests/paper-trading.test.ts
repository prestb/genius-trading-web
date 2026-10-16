import { describe, expect, it } from "vitest";
import { closePaperPosition, createPaperLedger, getPaperMetrics, markPaperPositions, openPaperPosition } from "../lib/paper-trading";

const now = new Date("2026-10-16T10:00:00.000Z");
const open = (side: "LONG" | "SHORT" = "LONG") => openPaperPosition({ ledger: createPaperLedger(), symbol: "EUR/USD", interval: "15min", side, quantity: 10, price: 100, isFresh: true, now, id: "p1" });

describe("paper trading simulation", () => {
  it("blocks opening when market data is stale", () => {
    expect(() => openPaperPosition({ ledger: createPaperLedger(), symbol: "EUR/USD", interval: "15min", side: "LONG", quantity: 1, price: 100, isFresh: false, now })).toThrow(/stale or unverified/);
  });
  it("marks an open position and calculates unrealized P/L", () => {
    const ledger = markPaperPositions(open(), "EUR/USD", 102);
    expect(getPaperMetrics(ledger, now).unrealizedPnl).toBeGreaterThan(0);
  });
  it("closes positions and records net P/L including modeled fees", () => {
    const ledger = closePaperPosition(open(), "p1", 102, true, new Date("2026-10-16T10:05:00.000Z"));
    expect(ledger.positions[0]?.status).toBe("CLOSED");
    expect(ledger.positions[0]?.netPnl).toBeGreaterThan(0);
    expect(getPaperMetrics(ledger, new Date("2026-10-16T10:06:00.000Z")).openPositions).toBe(0);
  });
  it("blocks duplicate same-side positions for one symbol", () => {
    expect(() => openPaperPosition({ ledger: open(), symbol: "EUR/USD", interval: "1h", side: "LONG", quantity: 1, price: 100, isFresh: true, now })).toThrow(/already open/);
  });
  it("applies adverse modeled spread and slippage to both sides", () => {
    const ledger = createPaperLedger({ startingBalance: 10000, spreadBps: 10, slippageBps: 5, feeBpsPerSide: 0, maxOpenPositions: 3, maxDailyLossPercent: 3 });
    const long = openPaperPosition({ ledger, symbol: "EUR/USD", interval: "15min", side: "LONG", quantity: 1, price: 100, isFresh: true, now });
    const short = openPaperPosition({ ledger, symbol: "GBP/USD", interval: "15min", side: "SHORT", quantity: 1, price: 100, isFresh: true, now });
    expect(long.positions[0]!.entryPrice).toBeGreaterThan(100);
    expect(short.positions[0]!.entryPrice).toBeLessThan(100);
  });
});
