export type ReadinessState = "complete" | "incomplete" | "blocked";

export interface ReadinessCheck {
  id: string;
  title: string;
  detail: string;
  state: ReadinessState;
}

export interface ReadinessReport {
  liveExecutionEnabled: false;
  brokerAdapterImplemented: false;
  checks: ReadinessCheck[];
  blockingCount: number;
}

const BASE_CHECKS: ReadinessCheck[] = [
  {
    id: "broker-adapter",
    title: "Broker adapter and supported account",
    detail: "No broker-specific adapter or account verification is implemented in this release.",
    state: "blocked",
  },
  {
    id: "server-credentials",
    title: "Server-side credential storage",
    detail: "Broker credentials must be stored server-side in a secret manager and must never be sent to the browser.",
    state: "incomplete",
  },
  {
    id: "order-lifecycle",
    title: "Order lifecycle and reconciliation",
    detail: "Submission, acknowledgement, partial fills, cancellation, rejection and broker reconciliation still require implementation.",
    state: "incomplete",
  },
  {
    id: "risk-controls",
    title: "Server-enforced risk controls",
    detail: "Paper-trading limits are browser-local and are not suitable as live-trading safeguards.",
    state: "incomplete",
  },
  {
    id: "idempotency",
    title: "Persistent idempotency and audit log",
    detail: "Live orders need durable duplicate-submission protection and an immutable server-side audit trail.",
    state: "incomplete",
  },
  {
    id: "kill-switch",
    title: "Emergency stop and recovery tests",
    detail: "A server-side kill switch, open-order cancellation policy and recovery drills must be implemented and verified.",
    state: "incomplete",
  },
];

export function getLiveTradingReadinessReport(): ReadinessReport {
  const checks = BASE_CHECKS.map((check) => ({ ...check }));
  return {
    liveExecutionEnabled: false,
    brokerAdapterImplemented: false,
    checks,
    blockingCount: checks.filter((check) => check.state !== "complete").length,
  };
}

export interface OrderPreflightInput {
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  referencePrice: number;
  maxOrderNotional: number;
  killSwitchActive: boolean;
  liveExecutionEnabled: boolean;
  idempotencyKey: string;
}

export type OrderPreflightResult =
  | { allowed: true; estimatedNotional: number }
  | { allowed: false; reason: string };

export function validateOrderPreflight(input: OrderPreflightInput): OrderPreflightResult {
  if (!input.liveExecutionEnabled) {
    return { allowed: false, reason: "Live execution is disabled." };
  }
  if (input.killSwitchActive) {
    return { allowed: false, reason: "Emergency stop is active." };
  }
  if (!/^[A-Za-z0-9_./-]{1,30}$/.test(input.symbol)) {
    return { allowed: false, reason: "Invalid instrument symbol." };
  }
  if (input.side !== "BUY" && input.side !== "SELL") {
    return { allowed: false, reason: "Invalid order side." };
  }
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    return { allowed: false, reason: "Quantity must be a positive finite number." };
  }
  if (!Number.isFinite(input.referencePrice) || input.referencePrice <= 0) {
    return { allowed: false, reason: "Reference price must be a positive finite number." };
  }
  if (!Number.isFinite(input.maxOrderNotional) || input.maxOrderNotional <= 0) {
    return { allowed: false, reason: "Maximum order notional must be a positive finite number." };
  }
  if (!/^[A-Za-z0-9:_-]{16,128}$/.test(input.idempotencyKey)) {
    return { allowed: false, reason: "A valid idempotency key is required." };
  }
  const estimatedNotional = input.quantity * input.referencePrice;
  if (!Number.isFinite(estimatedNotional) || estimatedNotional > input.maxOrderNotional) {
    return { allowed: false, reason: "Order exceeds the configured notional limit." };
  }
  return { allowed: true, estimatedNotional };
}
