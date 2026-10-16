import { describe, expect, it } from "vitest";
import { getLiveTradingReadinessReport, validateOrderPreflight, type OrderPreflightInput } from "@/lib/live-trading-readiness";

const validInput: OrderPreflightInput = {
  symbol: "EUR/USD",
  side: "BUY",
  quantity: 1000,
  referencePrice: 1.1,
  maxOrderNotional: 2000,
  killSwitchActive: false,
  liveExecutionEnabled: true,
  idempotencyKey: "request-key-00000001",
};

describe("live trading readiness safety gates", () => {
  it("keeps live execution disabled and reports unresolved readiness checks", () => {
    const report = getLiveTradingReadinessReport();
    expect(report.liveExecutionEnabled).toBe(false);
    expect(report.brokerAdapterImplemented).toBe(false);
    expect(report.blockingCount).toBeGreaterThan(0);
    expect(report.checks.some((check) => check.state === "blocked")).toBe(true);
  });

  it("blocks all order preflight while live execution is disabled", () => {
    expect(validateOrderPreflight({ ...validInput, liveExecutionEnabled: false })).toEqual({
      allowed: false,
      reason: "Live execution is disabled.",
    });
  });

  it("blocks when the emergency stop is active", () => {
    expect(validateOrderPreflight({ ...validInput, killSwitchActive: true })).toEqual({
      allowed: false,
      reason: "Emergency stop is active.",
    });
  });

  it("rejects invalid quantity and reference price", () => {
    expect(validateOrderPreflight({ ...validInput, quantity: 0 }).allowed).toBe(false);
    expect(validateOrderPreflight({ ...validInput, referencePrice: Number.NaN }).allowed).toBe(false);
  });

  it("requires a valid idempotency key", () => {
    expect(validateOrderPreflight({ ...validInput, idempotencyKey: "short" })).toEqual({
      allowed: false,
      reason: "A valid idempotency key is required.",
    });
  });

  it("rejects orders above the notional limit", () => {
    expect(validateOrderPreflight({ ...validInput, maxOrderNotional: 1000 })).toEqual({
      allowed: false,
      reason: "Order exceeds the configured notional limit.",
    });
  });

  it("allows a valid preflight without submitting an order", () => {
    expect(validateOrderPreflight(validInput)).toEqual({ allowed: true, estimatedNotional: 1100 });
  });
});
