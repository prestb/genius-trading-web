import { calculateIndicators, type IndicatorCandle } from "./indicators";
import { getRequiredHigherTimeframes } from "./multi-timeframe";

export const BACKTEST_ENGINE_VERSION = "1.0.0" as const;

export type BacktestInterval = "1min" | "5min" | "15min" | "30min" | "1h" | "4h" | "1day";
export type BacktestDirection = "BUY" | "SELL";
export type BacktestExitReason = "stop-loss" | "take-profit" | "max-hold" | "end-of-data";

export type BacktestConfig = {
  initialBalance: number;
  riskPercent: number;
  spreadBps: number;
  slippageBps: number;
  feeBpsPerSide: number;
  maxCandlesInTrade: number;
};

export type BacktestInput = {
  symbol: string;
  interval: BacktestInterval;
  candles: IndicatorCandle[];
  higherTimeframeCandles: Partial<Record<string, IndicatorCandle[]>>;
  config?: Partial<BacktestConfig>;
  /** Inclusive UTC calendar date, e.g. 2025-01-01. Candles before this date are indicator warm-up only. */
  startDate?: string;
  /** Inclusive UTC calendar date, e.g. 2025-03-31. */
  endDate?: string;
};

export type BacktestTrade = {
  direction: BacktestDirection;
  signalTime: string;
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  stopLoss: number;
  takeProfit: number;
  quantity: number;
  riskAmount: number;
  grossPnl: number;
  fees: number;
  netPnl: number;
  returnPercent: number;
  barsHeld: number;
  exitReason: BacktestExitReason;
};

export type BacktestEquityPoint = { time: string; equity: number };

export type BacktestResult = {
  engineVersion: typeof BACKTEST_ENGINE_VERSION;
  symbol: string;
  interval: BacktestInterval;
  status: "completed" | "insufficient-data";
  period: { startDate: string | null; endDate: string | null; firstCandleAt: string | null; lastCandleAt: string | null; candlesInRange: number };
  warnings: string[];
  config: BacktestConfig;
  summary: {
    candlesAnalyzed: number;
    trades: number;
    wins: number;
    losses: number;
    winRatePercent: number;
    initialBalance: number;
    finalBalance: number;
    netPnl: number;
    returnPercent: number;
    profitFactor: number | null;
    expectancyPerTrade: number;
    expectancyR: number;
    maxDrawdownPercent: number;
    averageWin: number;
    averageLoss: number;
    exposurePercent: number;
  };
  trades: BacktestTrade[];
  equityCurve: BacktestEquityPoint[];
};

const INTERVAL_SECONDS: Record<string, number> = {
  "1min": 60,
  "5min": 300,
  "15min": 900,
  "30min": 1800,
  "1h": 3600,
  "4h": 14400,
  "1day": 86400,
  "1week": 604800,
};

const DEFAULT_CONFIG: BacktestConfig = {
  initialBalance: 10_000,
  riskPercent: 1,
  spreadBps: 1,
  slippageBps: 0.5,
  feeBpsPerSide: 0,
  maxCandlesInTrade: 100,
};

const MIN_CANDLES = 200;
const STOP_ATR_MULTIPLIER = 1.5;
const TARGET_ATR_MULTIPLIER = 2.5;

type OpenPosition = {
  direction: BacktestDirection;
  signalTime: string;
  entryTime: string;
  entryIndex: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  quantity: number;
  riskAmount: number;
  entryFee: number;
  initialEquity: number;
};

function validCandle(candle: IndicatorCandle): boolean {
  return typeof candle.time === "string" && Number.isFinite(Date.parse(candle.time)) &&
    [candle.open, candle.high, candle.low, candle.close].every((v) => Number.isFinite(v) && v > 0) &&
    candle.high >= Math.max(candle.open, candle.close) && candle.low <= Math.min(candle.open, candle.close) &&
    candle.high >= candle.low;
}

function validateChronologicalCandles(candles: IndicatorCandle[]): boolean {
  return candles.every((candle, index) => validCandle(candle) &&
    (index === 0 || Date.parse(candles[index - 1]!.time) < Date.parse(candle.time)));
}

function executionPrice(rawPrice: number, direction: BacktestDirection, isEntry: boolean, config: BacktestConfig): number {
  const halfSpread = rawPrice * config.spreadBps / 20_000;
  const slippage = rawPrice * config.slippageBps / 10_000;
  const isBuyFill = isEntry ? direction === "BUY" : direction === "SELL";
  return rawPrice + (isBuyFill ? 1 : -1) * (halfSpread + slippage);
}

function sideFee(price: number, quantity: number, feeBpsPerSide: number): number {
  return Math.abs(price * quantity) * feeBpsPerSide / 10_000;
}

export function resolveStopTargetHit(
  direction: BacktestDirection,
  candle: Pick<IndicatorCandle, "high" | "low"> & Partial<Pick<IndicatorCandle, "open">>,
  stopLoss: number,
  takeProfit: number,
): { price: number; reason: "stop-loss" | "take-profit" } | null {
  const stopTouched = direction === "BUY" ? candle.low <= stopLoss : candle.high >= stopLoss;
  const targetTouched = direction === "BUY" ? candle.high >= takeProfit : candle.low <= takeProfit;
  if (stopTouched) {
    const openingPrice = typeof candle.open === "number" && Number.isFinite(candle.open) ? candle.open : null;
    const gapThroughStop = openingPrice !== null &&
      (direction === "BUY" ? openingPrice < stopLoss : openingPrice > stopLoss);
    return { price: gapThroughStop ? openingPrice : stopLoss, reason: "stop-loss" };
  }
  if (targetTouched) return { price: takeProfit, reason: "take-profit" };
  return null;
}

function higherTimeframeDirection(
  candles: IndicatorCandle[] | undefined,
  interval: string,
  signalCloseTime: number,
): "Bullish" | "Bearish" | null {
  const seconds = INTERVAL_SECONDS[interval];
  if (!candles || !seconds) return null;
  // Candle timestamps are treated as opening times; only completed candles are eligible.
  const completed = candles.filter((candle) => Date.parse(candle.time) + seconds * 1000 <= signalCloseTime);
  if (completed.length < MIN_CANDLES || !validateChronologicalCandles(completed)) return null;
  const indicators = calculateIndicators(completed);
  const latestClose = completed.at(-1)!.close;
  if (indicators.ema50 === null || indicators.ema200 === null) return null;
  if (indicators.ema50 > indicators.ema200 && latestClose > indicators.ema50) return "Bullish";
  if (indicators.ema50 < indicators.ema200 && latestClose < indicators.ema50) return "Bearish";
  return null;
}

function candidateDirection(
  candles: IndicatorCandle[],
  index: number,
  interval: BacktestInterval,
  higherTimeframeCandles: BacktestInput["higherTimeframeCandles"],
): BacktestDirection | null {
  const prefix = candles.slice(0, index + 1);
  const indicators = calculateIndicators(prefix);
  const current = prefix.at(-1)!;
  const { ema50, ema200, rsi14, atr14 } = indicators;
  if (ema50 === null || ema200 === null || rsi14 === null || atr14 === null || atr14 <= 0) return null;

  let direction: BacktestDirection | null = null;
  if (ema50 > ema200 && current.close > ema50 && rsi14 >= 50 && rsi14 <= 70) direction = "BUY";
  if (ema50 < ema200 && current.close < ema50 && rsi14 >= 30 && rsi14 <= 50) direction = "SELL";
  if (!direction) return null;

  const required = getRequiredHigherTimeframes(interval);
  if (!required.length) return null;
  const signalCloseTime = Date.parse(current.time) + INTERVAL_SECONDS[interval]! * 1000;
  const requiredDirections = required.map((frameInterval) =>
    higherTimeframeDirection(higherTimeframeCandles[frameInterval], frameInterval, signalCloseTime));
  if (requiredDirections.some((value) => value === null)) return null;
  const expected = direction === "BUY" ? "Bullish" : "Bearish";
  return requiredDirections.every((value) => value === expected) ? direction : null;
}

function closePosition(
  position: OpenPosition,
  rawExitPrice: number,
  exitTime: string,
  exitIndex: number,
  exitReason: BacktestExitReason,
  config: BacktestConfig,
): BacktestTrade {
  const exitPrice = executionPrice(rawExitPrice, position.direction, false, config);
  const sign = position.direction === "BUY" ? 1 : -1;
  const grossPnl = (exitPrice - position.entryPrice) * position.quantity * sign;
  const exitFee = sideFee(exitPrice, position.quantity, config.feeBpsPerSide);
  const fees = position.entryFee + exitFee;
  const netPnl = grossPnl - fees;
  return {
    direction: position.direction,
    signalTime: position.signalTime,
    entryTime: position.entryTime,
    exitTime,
    entryPrice: position.entryPrice,
    exitPrice,
    stopLoss: position.stopLoss,
    takeProfit: position.takeProfit,
    quantity: position.quantity,
    riskAmount: position.riskAmount,
    grossPnl,
    fees,
    netPnl,
    returnPercent: position.initialEquity > 0 ? netPnl / position.initialEquity * 100 : 0,
    barsHeld: Math.max(1, exitIndex - position.entryIndex + 1),
    exitReason,
  };
}

function emptyResult(input: BacktestInput, config: BacktestConfig, warning: string): BacktestResult {
  return {
    engineVersion: BACKTEST_ENGINE_VERSION,
    symbol: input.symbol,
    interval: input.interval,
    status: "insufficient-data",
    period: { startDate: input.startDate ?? null, endDate: input.endDate ?? null, firstCandleAt: null, lastCandleAt: null, candlesInRange: 0 },
    warnings: [warning],
    config,
    summary: {
      candlesAnalyzed: 0, trades: 0, wins: 0, losses: 0, winRatePercent: 0,
      initialBalance: config.initialBalance, finalBalance: config.initialBalance, netPnl: 0,
      returnPercent: 0, profitFactor: null, expectancyPerTrade: 0, expectancyR: 0, maxDrawdownPercent: 0,
      averageWin: 0, averageLoss: 0, exposurePercent: 0,
    },
    trades: [],
    equityCurve: input.candles.length ? [{ time: input.candles[0]!.time, equity: config.initialBalance }] : [],
  };
}

export function runBacktest(input: BacktestInput): BacktestResult {
  const config: BacktestConfig = { ...DEFAULT_CONFIG, ...input.config };
  if (!Number.isFinite(config.initialBalance) || config.initialBalance <= 0) throw new Error("initialBalance must be greater than zero.");
  if (!Number.isFinite(config.riskPercent) || config.riskPercent <= 0 || config.riskPercent > 5) throw new Error("riskPercent must be greater than zero and no more than 5%.");
  for (const [name, value] of [["spreadBps", config.spreadBps], ["slippageBps", config.slippageBps], ["feeBpsPerSide", config.feeBpsPerSide]] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 1000) throw new Error(`${name} must be between 0 and 1000 basis points.`);
  }
  if (!Number.isInteger(config.maxCandlesInTrade) || config.maxCandlesInTrade < 1 || config.maxCandlesInTrade > 10000) throw new Error("maxCandlesInTrade must be an integer between 1 and 10000.");
  if (!validateChronologicalCandles(input.candles)) throw new Error("Candles must be valid OHLC data in strictly increasing chronological order.");
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  for (const [name, value] of [["startDate", input.startDate], ["endDate", input.endDate]] as const) {
    if (value !== undefined && (!datePattern.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)) || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value)) {
      throw new Error(`${name} must be a valid YYYY-MM-DD calendar date.`);
    }
  }
  if (input.startDate && input.endDate && input.startDate > input.endDate) throw new Error("startDate must be on or before endDate.");
  const rangeStart = input.startDate ? Date.parse(`${input.startDate}T00:00:00.000Z`) : Date.parse(input.candles[0]?.time ?? "");
  const rangeEndExclusive = input.endDate ? Date.parse(`${input.endDate}T00:00:00.000Z`) + 86_400_000 : Number.POSITIVE_INFINITY;
  const rangeStartIndex = input.candles.findIndex((candle) => Date.parse(candle.time) >= rangeStart && Date.parse(candle.time) < rangeEndExclusive);
  let rangeEndIndex = -1;
  for (let index = input.candles.length - 1; index >= 0; index--) {
    const time = Date.parse(input.candles[index]!.time);
    if (time >= rangeStart && time < rangeEndExclusive) { rangeEndIndex = index; break; }
  }
  const candlesInRange = rangeStartIndex >= 0 && rangeEndIndex >= rangeStartIndex ? rangeEndIndex - rangeStartIndex + 1 : 0;
  if (input.candles.length < MIN_CANDLES + 1 || candlesInRange < 1 || (Boolean(input.startDate) && rangeStartIndex < MIN_CANDLES)) {
    return emptyResult(input, config, `Insufficient history for the selected period. At least ${MIN_CANDLES} warm-up candles before the first test candle and one in-range candle are required.`);
  }

  const warnings = [
    "Signals are evaluated at candle close and filled at the next candle open; future candles are never used for a signal.",
    "If stop-loss and take-profit are both touched within one candle, the stop-loss is assumed to occur first (conservative handling).",
    "Higher-timeframe candles are eligible only after their timestamp plus interval duration; incomplete higher-timeframe candles are excluded.",
    "Position size uses ATR stop distance; spread, slippage, and fees can make realized losses exceed the configured risk percentage.",
    "This is a rule-based historical simulation, not evidence of future profitability. Provider data quality and instrument-specific contract sizing may affect results.",
  ];
  if (input.startDate || input.endDate) {
    warnings.push("Historical range coverage is limited by the data provider and market sessions. Review the reported first/last test-candle timestamps and candle count; the requested calendar range may not be fully represented.");
  }
  const trades: BacktestTrade[] = [];
  const firstCandleTime = Date.parse(input.candles[rangeStartIndex]!.time);
  const equityCurve: BacktestEquityPoint[] = [{
    time: new Date((input.startDate ? rangeStart : firstCandleTime) - INTERVAL_SECONDS[input.interval]! * 1000).toISOString(),
    equity: config.initialBalance,
  }];
  let balance = config.initialBalance;
  let position: OpenPosition | null = null;
  let barsExposed = 0;

  for (let i = 0; i <= rangeEndIndex; i++) {
    const candle = input.candles[i]!;
    if (position) {
      barsExposed++;
      const intrabarExit = resolveStopTargetHit(position.direction, candle, position.stopLoss, position.takeProfit);
      let rawExit: number | null = intrabarExit?.price ?? null;
      let reason: BacktestExitReason | null = intrabarExit?.reason ?? null;
      if (rawExit === null && i - position.entryIndex + 1 >= config.maxCandlesInTrade) {
        rawExit = candle.close;
        reason = "max-hold";
      } else if (rawExit === null && i === input.candles.length - 1) {
        rawExit = candle.close;
        reason = "end-of-data";
      }
      if (rawExit !== null && reason) {
        const trade = closePosition(position, rawExit, candle.time, i, reason, config);
        trades.push(trade);
        balance += trade.netPnl;
        position = null;
      }
    }

    if (!position && i >= rangeStartIndex && i < rangeEndIndex && i >= MIN_CANDLES - 1) {
      const direction = candidateDirection(input.candles, i, input.interval, input.higherTimeframeCandles ?? {});
      const next = input.candles[i + 1]!;
      const atr = calculateIndicators(input.candles.slice(0, i + 1)).atr14;
      if (direction && atr !== null && atr > 0 && balance > 0) {
        const entryPrice = executionPrice(next.open, direction, true, config);
        const stopDistance = atr * STOP_ATR_MULTIPLIER;
        const targetDistance = atr * TARGET_ATR_MULTIPLIER;
        const quantity = balance * config.riskPercent / 100 / stopDistance;
        const entryFee = sideFee(entryPrice, quantity, config.feeBpsPerSide);
        position = {
          direction,
          signalTime: new Date(Date.parse(candle.time) + INTERVAL_SECONDS[input.interval]! * 1000).toISOString(),
          entryTime: next.time,
          entryIndex: i + 1,
          entryPrice,
          stopLoss: entryPrice + (direction === "BUY" ? -1 : 1) * stopDistance,
          takeProfit: entryPrice + (direction === "BUY" ? 1 : -1) * targetDistance,
          quantity,
          riskAmount: quantity * stopDistance,
          entryFee,
          initialEquity: balance,
        };
      }
    }
    let markedEquity = balance;
    if (position && position.entryIndex <= i) {
      const markPrice = executionPrice(candle.close, position.direction, false, config);
      const sign = position.direction === "BUY" ? 1 : -1;
      const unrealizedGross = (markPrice - position.entryPrice) * position.quantity * sign;
      const estimatedExitFee = sideFee(markPrice, position.quantity, config.feeBpsPerSide);
      markedEquity += unrealizedGross - position.entryFee - estimatedExitFee;
    }
    if (i >= rangeStartIndex) equityCurve.push({ time: candle.time, equity: markedEquity });
  }

  // If an entry was opened on the last available bar, no future candle exists to evaluate it.
  // The loop never opens a position at the final bar, so this is a defensive safeguard.
  if (position) {
    const last = input.candles[rangeEndIndex]!;
    const trade = closePosition(position, last.close, last.time, rangeEndIndex, "end-of-data", config);
    trades.push(trade);
    balance += trade.netPnl;
    if (equityCurve.at(-1)?.time !== last.time) equityCurve.push({ time: last.time, equity: balance });
  }

  const wins = trades.filter((trade) => trade.netPnl > 0);
  const losses = trades.filter((trade) => trade.netPnl < 0);
  const grossWins = wins.reduce((sum, trade) => sum + trade.netPnl, 0);
  const grossLosses = Math.abs(losses.reduce((sum, trade) => sum + trade.netPnl, 0));
  let peak = config.initialBalance;
  let maxDrawdownPercent = 0;
  for (const point of equityCurve) {
    peak = Math.max(peak, point.equity);
    if (peak > 0) maxDrawdownPercent = Math.max(maxDrawdownPercent, (peak - point.equity) / peak * 100);
  }
  const netPnl = balance - config.initialBalance;
  const averageWin = wins.length ? grossWins / wins.length : 0;
  const averageLoss = losses.length ? grossLosses / losses.length : 0;
  return {
    engineVersion: BACKTEST_ENGINE_VERSION,
    symbol: input.symbol,
    interval: input.interval,
    status: "completed",
    period: {
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
      firstCandleAt: input.candles[rangeStartIndex]?.time ?? null,
      lastCandleAt: input.candles[rangeEndIndex]?.time ?? null,
      candlesInRange,
    },
    warnings,
    config,
    summary: {
      candlesAnalyzed: candlesInRange,
      trades: trades.length,
      wins: wins.length,
      losses: losses.length,
      winRatePercent: trades.length ? wins.length / trades.length * 100 : 0,
      initialBalance: config.initialBalance,
      finalBalance: balance,
      netPnl,
      returnPercent: netPnl / config.initialBalance * 100,
      profitFactor: grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? null : 0,
      expectancyPerTrade: trades.length ? netPnl / trades.length : 0,
      expectancyR: trades.length ? trades.reduce((sum, trade) => sum + trade.netPnl / Math.max(trade.riskAmount, Number.EPSILON), 0) / trades.length : 0,
      maxDrawdownPercent,
      averageWin,
      averageLoss,
      exposurePercent: input.candles.length ? Math.min(100, barsExposed / input.candles.length * 100) : 0,
    },
    trades,
    equityCurve,
  };
}
