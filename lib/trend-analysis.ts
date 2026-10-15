
import type { TechnicalIndicators } from "./indicators";

export type TrendDirection =
  | "Bullish"
  | "Bearish"
  | "Neutral"
  | "Insufficient data";

export type TrendAnalysis = {
  direction: TrendDirection;
  timeframe: "Short-term" | "Long-term" | "Unconfirmed";
  explanation: string;
  checksPassed: number;
  checksRequired: number;
};

export function analyzeTrend(
  latestClose: number | null,
  indicators: TechnicalIndicators
): TrendAnalysis {
  const { ema50, ema200, rsi14 } = indicators;

  // Refuse to assess invalid or incomplete price data.
  if (
    latestClose === null ||
    !Number.isFinite(latestClose) ||
    ema50 === null ||
    rsi14 === null ||
    !Number.isFinite(ema50) ||
    !Number.isFinite(rsi14)
  ) {
    return {
      direction: "Insufficient data",
      timeframe: "Unconfirmed",
      explanation:
        "Valid closing prices, EMA 50, and RSI 14 are required.",
      checksPassed: 0,
      checksRequired: 3,
    };
  }
 
  const priceAboveEma50 = latestClose > ema50;
  const priceBelowEma50 = latestClose < ema50;
  const rsiBullish = rsi14 > 50;
  const rsiBearish = rsi14 < 50;

  // With fewer than 200 candles, assess short-term conditions only.
  if (ema200 === null || !Number.isFinite(ema200)) {
    if (priceAboveEma50 && rsiBullish) {
      return {
        direction: "Bullish",
        timeframe: "Short-term",
        explanation:
          "Price is above EMA 50 and RSI is above 50. Long-term trend is unconfirmed because EMA 200 is unavailable.",
        checksPassed: 2,
        checksRequired: 2,
      };
    }

    if (priceBelowEma50 && rsiBearish) {
      return {
        direction: "Bearish",
        timeframe: "Short-term",
        explanation:
          "Price is below EMA 50 and RSI is below 50. Long-term trend is unconfirmed because EMA 200 is unavailable.",
        checksPassed: 2,
        checksRequired: 2,
      };
    }

    return {
      direction: "Neutral",
      timeframe: "Short-term",
      explanation:
        "Price and momentum do not agree on a clear short-term direction. Long-term trend is unconfirmed.",
      checksPassed: 1,
      checksRequired: 2,
    };
  }

  // Require agreement between price, both EMAs, and RSI.
  if (
    !Number.isFinite(ema200)
  ) {
    return {
      direction: "Insufficient data",
      timeframe: "Unconfirmed",
      explanation: "EMA 200 is not a valid number.",
      checksPassed: 0,
      checksRequired: 4,
    };
  }

  if (
    ema50 > ema200 &&
    priceAboveEma50 &&
    rsiBullish
  ) {
    return {
      direction: "Bullish",
      timeframe: "Long-term",
      explanation:
        "EMA 50 is above EMA 200, price is above EMA 50, and RSI is above 50.",
      checksPassed: 3,
      checksRequired: 3,
    };
  }

  if (
    ema50 < ema200 &&
    priceBelowEma50 &&
    rsiBearish
  ) {
    return {
      direction: "Bearish",
      timeframe: "Long-term",
      explanation:
        "EMA 50 is below EMA 200, price is below EMA 50, and RSI is below 50.",
      checksPassed: 3,
      checksRequired: 3,
    };
  }

  return {
    direction: "Neutral",
    timeframe: "Long-term",
    explanation:
      "The price, moving averages, and momentum do not all agree on a clear trend.",
    checksPassed: 1,
    checksRequired: 3,
  };
}


import type { IndicatorCandle } from "./indicators";

export type MarketValidation = {
  valid: boolean;
  checks: {
    label: string;
    passed: boolean;
    detail: string;
  }[];
};

export function validateMarketData(
  candles: IndicatorCandle[]
): MarketValidation {
  const enoughCandles = candles.length >= 15;

  const validValues =
    candles.length > 0 &&
    candles.every(
      (candle) =>
        Number.isFinite(candle.open) &&
        Number.isFinite(candle.high) &&
        Number.isFinite(candle.low) &&
        Number.isFinite(candle.close) &&
        candle.high >= candle.low &&
        candle.high >= Math.max(candle.open, candle.close) &&
        candle.low <= Math.min(candle.open, candle.close)
    );

  const validTimes =
    candles.length > 0 &&
    candles.every(
      (candle) =>
        typeof candle.time === "string" &&
        candle.time.trim().length > 0
    );

  const orderedTimes =
    validTimes &&
    candles.every((candle, index) => {
      if (index === 0) return true;

      const previous = Date.parse(candles[index - 1].time);
      const current = Date.parse(candle.time);

      return (
        Number.isFinite(previous) &&
        Number.isFinite(current) &&
        current > previous
      );
    });

  const checks = [
    {
      label: "Minimum candle history",
      passed: enoughCandles,
      detail: enoughCandles
        ? `${candles.length} candles available`
        : `Need at least 15 candles; received ${candles.length}`,
    },
    {
      label: "OHLC price integrity",
      passed: validValues,
      detail: validValues
        ? "Candle prices pass basic consistency checks"
        : "Missing, invalid, or inconsistent candle prices",
    },
    {
      label: "Candle timestamps",
      passed: validTimes && orderedTimes,
      detail:
        validTimes && orderedTimes
          ? "Timestamps are present and chronological"
          : "Timestamps are missing, invalid, or out of order",
    },
  ];

  return {
    valid: checks.every((check) => check.passed),
    checks,
  };
}
