export type PaperSide = "LONG" | "SHORT";
export type PaperStatus = "OPEN" | "CLOSED";

export interface PaperConfig {
  startingBalance: number;
  spreadBps: number;
  slippageBps: number;
  feeBpsPerSide: number;
  maxOpenPositions: number;
  maxDailyLossPercent: number;
}

export interface PaperPosition {
  id: string;
  symbol: string;
  interval: string;
  side: PaperSide;
  quantity: number;
  entryPrice: number;
  markPrice: number;
  openedAt: string;
  closedAt: string | null;
  status: PaperStatus;
  entryFee: number;
  exitPrice: number | null;
  exitFee: number;
  grossPnl: number;
  netPnl: number | null;
}

export const DEFAULT_PAPER_CONFIG: PaperConfig = {
  startingBalance: 10000,
  spreadBps: 1,
  slippageBps: 0.5,
  feeBpsPerSide: 0,
  maxOpenPositions: 3,
  maxDailyLossPercent: 3,
};

export const PAPER_STORAGE_KEY = "genius-trading-paper-ledger-v1";

export interface PaperLedger {
  schemaVersion: 1;
  config: PaperConfig;
  positions: PaperPosition[];
}

export function createPaperLedger(config: PaperConfig = DEFAULT_PAPER_CONFIG): PaperLedger {
  return { schemaVersion: 1, config: { ...config }, positions: [] };
}

function validPositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function calculatePaperPnl(position: Pick<PaperPosition, "side" | "quantity" | "entryPrice" | "markPrice" | "entryFee">): number {
  const direction = position.side === "LONG" ? 1 : -1;
  return (position.markPrice - position.entryPrice) * position.quantity * direction - position.entryFee;
}

export function markPaperPositions(ledger: PaperLedger, symbol: string, price: number): PaperLedger {
  if (!validPositive(price)) throw new Error("Market price must be a positive finite number.");
  return {
    ...ledger,
    positions: ledger.positions.map((position) =>
      position.status === "OPEN" && position.symbol === symbol
        ? { ...position, markPrice: price, grossPnl: (price - position.entryPrice) * position.quantity * (position.side === "LONG" ? 1 : -1) }
        : position
    ),
  };
}

export function getPaperMetrics(ledger: PaperLedger, now = new Date()): {
  realizedPnl: number; unrealizedPnl: number; equity: number; availableBalance: number;
  openPositions: number; dailyRealizedPnl: number; dailyLossLimit: number; riskLimitReached: boolean;
} {
  const realizedPnl = ledger.positions.filter((p) => p.status === "CLOSED").reduce((sum, p) => sum + (p.netPnl ?? 0), 0);
  const open = ledger.positions.filter((p) => p.status === "OPEN");
  const unrealizedPnl = open.reduce((sum, p) => sum + calculatePaperPnl(p), 0);
  const today = now.toISOString().slice(0, 10);
  const dailyRealizedPnl = ledger.positions.filter((p) => p.status === "CLOSED" && p.closedAt?.slice(0, 10) === today).reduce((sum, p) => sum + (p.netPnl ?? 0), 0);
  const dailyLossLimit = ledger.config.startingBalance * ledger.config.maxDailyLossPercent / 100;
  const equity = ledger.config.startingBalance + realizedPnl + unrealizedPnl;
  const usedNotional = open.reduce((sum, p) => sum + p.quantity * p.markPrice, 0);
  return { realizedPnl, unrealizedPnl, equity, availableBalance: equity - usedNotional, openPositions: open.length, dailyRealizedPnl, dailyLossLimit, riskLimitReached: dailyRealizedPnl <= -dailyLossLimit };
}

export function openPaperPosition(input: {
  ledger: PaperLedger; symbol: string; interval: string; side: PaperSide; quantity: number;
  price: number; isFresh: boolean; now?: Date; id?: string;
}): PaperLedger {
  const { ledger, symbol, interval, side, quantity, price, isFresh } = input;
  if (!symbol.trim() || !interval.trim()) throw new Error("Choose a valid instrument and timeframe.");
  if (!isFresh) throw new Error("Orders are blocked because market data is stale or unverified.");
  if (!validPositive(quantity) || !validPositive(price)) throw new Error("Quantity and price must be positive finite numbers.");
  const metrics = getPaperMetrics(ledger, input.now ?? new Date());
  if (metrics.riskLimitReached) throw new Error("Daily realized-loss limit reached. New positions are disabled.");
  if (metrics.openPositions >= ledger.config.maxOpenPositions) throw new Error("Maximum number of open positions reached.");
  const sameSide = ledger.positions.some((p) => p.status === "OPEN" && p.symbol === symbol && p.side === side);
  if (sameSide) throw new Error("A position with this instrument and direction is already open.");
  if (quantity * price > Math.max(0, metrics.availableBalance)) throw new Error("Insufficient simulated available balance for this position.");
  const halfSpread = ledger.config.spreadBps / 20000;
  const slippage = ledger.config.slippageBps / 10000;
  const adverseFactor = side === "LONG" ? 1 + halfSpread + slippage : 1 - halfSpread - slippage;
  const entryPrice = price * adverseFactor;
  if (!validPositive(entryPrice)) throw new Error("Configured execution costs produced an invalid entry price.");
  const entryFee = entryPrice * quantity * ledger.config.feeBpsPerSide / 10000;
  const position: PaperPosition = {
    id: input.id ?? `paper-${(input.now ?? new Date()).getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    symbol, interval, side, quantity, entryPrice, markPrice: price,
    openedAt: (input.now ?? new Date()).toISOString(), closedAt: null, status: "OPEN",
    entryFee, exitPrice: null, exitFee: 0,
    grossPnl: (price - entryPrice) * quantity * (side === "LONG" ? 1 : -1), netPnl: null,
  };
  return { ...ledger, positions: [position, ...ledger.positions] };
}

export function closePaperPosition(ledger: PaperLedger, positionId: string, price: number, isFresh: boolean, now = new Date()): PaperLedger {
  if (!isFresh) throw new Error("Close is blocked because market data is stale or unverified.");
  if (!validPositive(price)) throw new Error("Market price must be a positive finite number.");
  const target = ledger.positions.find((p) => p.id === positionId && p.status === "OPEN");
  if (!target) throw new Error("Open paper position was not found.");
  const halfSpread = ledger.config.spreadBps / 20000;
  const slippage = ledger.config.slippageBps / 10000;
  const adverseFactor = target.side === "LONG" ? 1 - halfSpread - slippage : 1 + halfSpread + slippage;
  const exitPrice = price * adverseFactor;
  const exitFee = exitPrice * target.quantity * ledger.config.feeBpsPerSide / 10000;
  const grossPnl = (exitPrice - target.entryPrice) * target.quantity * (target.side === "LONG" ? 1 : -1);
  const netPnl = grossPnl - target.entryFee - exitFee;
  return { ...ledger, positions: ledger.positions.map((p) => p.id === positionId ? { ...p, markPrice: price, closedAt: now.toISOString(), status: "CLOSED", exitPrice, exitFee, grossPnl, netPnl } : p) };
}
