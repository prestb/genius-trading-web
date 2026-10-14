
export type IndicatorCandle = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type TechnicalIndicators = {
  ema50: number | null;
  ema200: number | null;
  rsi14: number | null;
  atr14: number | null;
};

function calculateEMA(
  values: number[],
  period: number
): number | null {
  if (values.length < period) return null;

  const multiplier = 2 / (period + 1);

  let ema =
    values.slice(0, period).reduce((sum, value) => sum + value, 0) /
    period;

  for (let i = period; i < values.length; i++) {
    ema = values[i] * multiplier + ema * (1 - multiplier);
  }

  return ema;
}

function calculateRSI(
  closes: number[],
  period = 14
): number | null {
  if (closes.length <= period) return null;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    gains += Math.max(change, 0);
    losses += Math.max(-change, 0);
  }

  let averageGain = gains / period;
  let averageLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];

    averageGain =
      (averageGain * (period - 1) + Math.max(change, 0)) /
      period;

    averageLoss =
      (averageLoss * (period - 1) + Math.max(-change, 0)) /
      period;
  }

  if (averageGain === 0 && averageLoss === 0) return 50;
  if (averageLoss === 0) return 100;

  const relativeStrength = averageGain / averageLoss;

  return 100 - 100 / (1 + relativeStrength);
}

function calculateATR(
  candles: IndicatorCandle[],
  period = 14
): number | null {
  if (candles.length <= period) return null;

  const trueRanges: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const previousClose = candles[i - 1].close;

    trueRanges.push(
      Math.max(
        current.high - current.low,
        Math.abs(current.high - previousClose),
        Math.abs(current.low - previousClose)
      )
    );
  }

  const initial = trueRanges.slice(0, period);

  let atr =
    initial.reduce((sum, value) => sum + value, 0) / period;

  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
  }

  return atr;
}

export function calculateIndicators(
  candles: IndicatorCandle[]
): TechnicalIndicators {
  const validCandles = candles.filter(
    (candle) =>
      Number.isFinite(candle.open) &&
      Number.isFinite(candle.high) &&
      Number.isFinite(candle.low) &&
      Number.isFinite(candle.close)
  );

  const closes = validCandles.map((candle) => candle.close);

  return {
    ema50: calculateEMA(closes, 50),
    ema200: calculateEMA(closes, 200),
    rsi14: calculateRSI(closes, 14),
    atr14: calculateATR(validCandles, 14),
  };
}
