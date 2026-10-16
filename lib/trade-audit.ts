import type { BacktestTrade } from "./backtesting";

export type TradeAuditMetadata = {
  symbol: string;
  interval: string;
  engineVersion: string;
  periodStart: string;
  periodEnd: string;
};

const COLUMNS = [
  "symbol", "interval", "engineVersion", "periodStart", "periodEnd",
  "direction", "signalTime", "entryTime", "exitTime", "entryPrice", "exitPrice",
  "stopLoss", "takeProfit", "quantity", "riskAmount", "grossPnl", "fees",
  "netPnl", "returnPercent", "barsHeld", "exitReason",
] as const;

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\\r\\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Serializes every trade, not only the dashboard's visible 100-row preview. */
export function tradesToAuditCsv(trades: BacktestTrade[], metadata: TradeAuditMetadata): string {
  const header = COLUMNS.join(",");
  const rows = trades.map((trade) => {
    const row: Record<(typeof COLUMNS)[number], string | number> = {
      symbol: metadata.symbol,
      interval: metadata.interval,
      engineVersion: metadata.engineVersion,
      periodStart: metadata.periodStart,
      periodEnd: metadata.periodEnd,
      direction: trade.direction,
      signalTime: trade.signalTime,
      entryTime: trade.entryTime,
      exitTime: trade.exitTime,
      entryPrice: trade.entryPrice,
      exitPrice: trade.exitPrice,
      stopLoss: trade.stopLoss,
      takeProfit: trade.takeProfit,
      quantity: trade.quantity,
      riskAmount: trade.riskAmount,
      grossPnl: trade.grossPnl,
      fees: trade.fees,
      netPnl: trade.netPnl,
      returnPercent: trade.returnPercent,
      barsHeld: trade.barsHeld,
      exitReason: trade.exitReason,
    };
    return COLUMNS.map((column) => csvCell(row[column])).join(",");
  });
  return [header, ...rows].join("\\r\\n");
}
