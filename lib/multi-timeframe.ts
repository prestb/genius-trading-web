import type { IndicatorCandle } from "./indicators";
import type { TrendDirection } from "./trend-analysis";

export type HigherTimeframeDirection = "Bullish" | "Bearish" | "Neutral" | "Insufficient data";
export type MultiTimeframeStatus = "Confirmed" | "Conflict" | "Blocked" | "Unavailable";

export type MultiTimeframeFrameInput = {
  symbol: string;
  interval: string;
  candles: IndicatorCandle[];
  isFresh: boolean;
  candleAgeSeconds: number | null;
  direction: TrendDirection;
};

export type MultiTimeframeFrameResult = {
  interval: string;
  status: "Confirmed" | "Conflict" | "Blocked" | "Unavailable";
  direction: HigherTimeframeDirection;
  latestCandleAt: string | null;
  detail: string;
};

export type MultiTimeframeAnalysis = {
  symbol: string;
  selectedInterval: string;
  requiredIntervals: string[];
  status: MultiTimeframeStatus;
  direction: "Bullish" | "Bearish" | "Neutral" | null;
  summary: string;
  frames: MultiTimeframeFrameResult[];
};

const REQUIRED_CONFIRMATIONS: Record<string, readonly string[]> = {
  "1min": ["5min", "15min"],
  "5min": ["15min", "1h"],
  "15min": ["1h", "4h"],
  "30min": ["1h", "4h"],
  "1h": ["4h", "1day"],
  "4h": ["1day", "1week"],
  "1day": ["1week"],
};

const MINIMUM_CANDLES = 200;

function validCandle(candle: IndicatorCandle): boolean {
  return (
    typeof candle.time === "string" &&
    Number.isFinite(Date.parse(candle.time)) &&
    [candle.open, candle.high, candle.low, candle.close].every(
      (value) => Number.isFinite(value) && value > 0,
    ) &&
    candle.high >= Math.max(candle.open, candle.close) &&
    candle.low <= Math.min(candle.open, candle.close) &&
    candle.high >= candle.low
  );
}

function validateFrame(
  symbol: string,
  interval: string,
  frame: MultiTimeframeFrameInput | undefined,
): MultiTimeframeFrameResult {
  if (!frame || frame.symbol !== symbol || frame.interval !== interval) {
    return {
      interval,
      status: "Unavailable",
      direction: "Insufficient data",
      latestCandleAt: null,
      detail: "Required timeframe data is missing or belongs to a different instrument.",
    };
  }

  const latestCandleAt = frame.candles.at(-1)?.time ?? null;
  if (
    !frame.isFresh ||
    frame.candleAgeSeconds === null ||
    !Number.isFinite(frame.candleAgeSeconds) ||
    frame.candleAgeSeconds < 0
  ) {
    return {
      interval,
      status: "Unavailable",
      direction: "Insufficient data",
      latestCandleAt,
      detail: "Higher-timeframe candle freshness could not be verified.",
    };
  }

  if (
    frame.candles.length < MINIMUM_CANDLES ||
    !frame.candles.every(validCandle) ||
    frame.candles.some(
      (candle, index) =>
        index > 0 &&
        Date.parse(candle.time) <= Date.parse(frame.candles[index - 1]!.time),
    )
  ) {
    return {
      interval,
      status: "Unavailable",
      direction: "Insufficient data",
      latestCandleAt,
      detail: `At least ${MINIMUM_CANDLES} valid chronological candles are required.`,
    };
  }

  if (frame.direction !== "Bullish" && frame.direction !== "Bearish") {
    return {
      interval,
      status: "Blocked",
      direction: frame.direction,
      latestCandleAt,
      detail: "Higher-timeframe trend is neutral or insufficient; it cannot confirm a trade.",
    };
  }

  return {
    interval,
    status: "Confirmed",
    direction: frame.direction,
    latestCandleAt,
    detail: `${frame.direction} higher-timeframe trend detected.`,
  };
}

export function getRequiredHigherTimeframes(selectedInterval: string): string[] {
  return [...(REQUIRED_CONFIRMATIONS[selectedInterval] ?? [])];
}

export function analyzeMultiTimeframe(input: {
  symbol: string;
  selectedInterval: string;
  frames: MultiTimeframeFrameInput[];
}): MultiTimeframeAnalysis {
  const requiredIntervals = getRequiredHigherTimeframes(input.selectedInterval);

  if (requiredIntervals.length === 0) {
    return {
      symbol: input.symbol,
      selectedInterval: input.selectedInterval,
      requiredIntervals,
      status: "Unavailable",
      direction: null,
      summary: "No higher-timeframe confirmation mapping exists for this interval.",
      frames: [],
    };
  }

  const results = requiredIntervals.map((interval) =>
    validateFrame(
      input.symbol,
      interval,
      input.frames.find((frame) => frame.interval === interval),
    ),
  );

  if (results.some((frame) => frame.status === "Unavailable")) {
    return {
      symbol: input.symbol,
      selectedInterval: input.selectedInterval,
      requiredIntervals,
      status: "Unavailable",
      direction: null,
      summary: "Higher-timeframe confirmation is unavailable because required data is missing, stale, or invalid.",
      frames: results,
    };
  }

  if (results.some((frame) => frame.status === "Blocked")) {
    return {
      symbol: input.symbol,
      selectedInterval: input.selectedInterval,
      requiredIntervals,
      status: "Blocked",
      direction: null,
      summary: "Higher-timeframe confirmation is blocked because at least one trend is neutral or insufficient.",
      frames: results,
    };
  }

  const directions = new Set(results.map((frame) => frame.direction));
  if (directions.size !== 1) {
    return {
      symbol: input.symbol,
      selectedInterval: input.selectedInterval,
      requiredIntervals,
      status: "Conflict",
      direction: null,
      summary: "Higher timeframes disagree. Wait for directional alignment.",
      frames: results.map((frame) => ({
        ...frame,
        status: "Conflict" as const,
        detail: `${frame.direction} conflicts with another required timeframe.`,
      })),
    };
  }

  const direction = results[0]!.direction as "Bullish" | "Bearish";
  return {
    symbol: input.symbol,
    selectedInterval: input.selectedInterval,
    requiredIntervals,
    status: "Confirmed",
    direction,
    summary: `All required higher timeframes confirm ${direction.toLowerCase()} direction.`,
    frames: results,
  };
}
