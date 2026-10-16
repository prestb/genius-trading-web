import { runBacktest, type BacktestInput, type BacktestResult } from "./backtesting";
import type { IndicatorCandle } from "./indicators";

export const OUT_OF_SAMPLE_VALIDATION_VERSION = "1.0.0" as const;
export const DEFAULT_IN_SAMPLE_PERCENT = 70;
export const DEFAULT_WARMUP_CANDLES = 200;
export const MIN_CANDLES_PER_PERIOD = 30;

type ValidationPlanOptions = {
  startDate?: string;
  endDate?: string;
  inSamplePercent?: number;
  warmupCandles?: number;
  minimumCandlesPerPeriod?: number;
};

export type ValidationPeriodPlan = {
  inSample: { startTime: string; endTime: string; candles: number };
  outOfSample: { startTime: string; endTime: string; candles: number };
  warmupCandles: number;
  splitIndex: number;
  testStartIndex: number;
  testEndIndex: number;
};

export type ValidationPeriodMetrics = {
  startTime: string;
  endTime: string;
  candles: number;
  trades: number;
  netPnl: number;
  returnPercent: number;
  winRatePercent: number;
  profitFactor: number | null;
  expectancyR: number;
  maxDrawdownPercent: number;
  finalBalance: number;
};

export type NoTradeBenchmark = {
  label: "No-trade baseline";
  initialBalance: number;
  finalBalance: number;
  netPnl: 0;
  returnPercent: 0;
};

export type BuyAndHoldBenchmark = {
  label: "Long-only buy-and-hold (price-only)";
  startPrice: number;
  endPrice: number;
  returnPercent: number;
  initialBalance: number;
  finalBalance: number;
  netPnl: number;
  excludesTradingCosts: true;
};

export type OutOfSampleValidation = {
  version: typeof OUT_OF_SAMPLE_VALIDATION_VERSION;
  status: "completed" | "insufficient-data";
  inSamplePercent: number;
  outOfSamplePercent: number;
  inSample: ValidationPeriodMetrics | null;
  outOfSample: ValidationPeriodMetrics | null;
  benchmark: BuyAndHoldBenchmark | null;
  noTradeBaseline: NoTradeBenchmark | null;
  warnings: string[];
};

function timestamp(candle: IndicatorCandle): number {
  return Date.parse(candle.time);
}

function validDate(value: string | undefined): boolean {
  if (value === undefined) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

/**
 * Creates non-overlapping chronological windows. Warm-up candles are available to both
 * simulations as historical context, but are never part of either scored period.
 */
export function createValidationPlan(
  candles: IndicatorCandle[],
  options: ValidationPlanOptions = {},
): ValidationPlanPlanResult {
  const inSamplePercent = options.inSamplePercent ?? DEFAULT_IN_SAMPLE_PERCENT;
  const warmupCandles = options.warmupCandles ?? DEFAULT_WARMUP_CANDLES;
  const minimum = options.minimumCandlesPerPeriod ?? MIN_CANDLES_PER_PERIOD;
  if (!Number.isFinite(inSamplePercent) || inSamplePercent < 50 || inSamplePercent > 90) {
    throw new Error("inSamplePercent must be between 50 and 90.");
  }
  if (!Number.isInteger(warmupCandles) || warmupCandles < 1) throw new Error("warmupCandles must be a positive integer.");
  if (!Number.isInteger(minimum) || minimum < 1) throw new Error("minimumCandlesPerPeriod must be a positive integer.");
  if (!validDate(options.startDate) || !validDate(options.endDate)) throw new Error("Validation dates must be valid YYYY-MM-DD calendar dates.");
  if (options.startDate && options.endDate && options.startDate > options.endDate) throw new Error("startDate must be on or before endDate.");
  if (!candles.every((candle, index) => Number.isFinite(timestamp(candle)) && (index === 0 || timestamp(candles[index - 1]!) < timestamp(candle)))) {
    throw new Error("Validation candles must be in strictly increasing chronological order.");
  }

  const dateStart = options.startDate ? Date.parse(`${options.startDate}T00:00:00.000Z`) : null;
  const dateEndExclusive = options.endDate ? Date.parse(`${options.endDate}T00:00:00.000Z`) + 86_400_000 : null;
  const testStartIndex = options.startDate
    ? candles.findIndex((candle) => timestamp(candle) >= dateStart!)
    : warmupCandles;
  const testEndIndex = options.endDate
    ? candles.findLastIndex((candle) => timestamp(candle) < dateEndExclusive!)
    : candles.length - 1;

  if (testStartIndex < warmupCandles || testEndIndex < testStartIndex) {
    return { status: "insufficient-data", reason: `At least ${warmupCandles} earlier warm-up candles and a non-empty requested test period are required.` };
  }
  const total = testEndIndex - testStartIndex + 1;
  const inSampleCount = Math.floor(total * inSamplePercent / 100);
  const outOfSampleCount = total - inSampleCount;
  if (inSampleCount < minimum || outOfSampleCount < minimum) {
    return { status: "insufficient-data", reason: `The selected history must contain at least ${minimum} scored candles in both the in-sample and out-of-sample periods.` };
  }

  const splitIndex = testStartIndex + inSampleCount;
  return {
    status: "completed",
    plan: {
      inSample: { startTime: candles[testStartIndex]!.time, endTime: candles[splitIndex - 1]!.time, candles: inSampleCount },
      outOfSample: { startTime: candles[splitIndex]!.time, endTime: candles[testEndIndex]!.time, candles: outOfSampleCount },
      warmupCandles,
      splitIndex,
      testStartIndex,
      testEndIndex,
    },
  };
}

type ValidationPlanPlan = {
  inSample: { startTime: string; endTime: string; candles: number };
  outOfSample: { startTime: string; endTime: string; candles: number };
  warmupCandles: number;
  splitIndex: number;
  testStartIndex: number;
  testEndIndex: number;
};
type ValidationPlanPlanResult =
  | { status: "completed"; plan: ValidationPlanPlan }
  | { status: "insufficient-data"; reason: string };

function metrics(result: BacktestResult): ValidationPeriodMetrics {
  return {
    startTime: result.period.firstCandleAt ?? "",
    endTime: result.period.lastCandleAt ?? "",
    candles: result.period.candlesInRange,
    trades: result.summary.trades,
    netPnl: result.summary.netPnl,
    returnPercent: result.summary.returnPercent,
    winRatePercent: result.summary.winRatePercent,
    profitFactor: result.summary.profitFactor,
    expectancyR: result.summary.expectancyR,
    maxDrawdownPercent: result.summary.maxDrawdownPercent,
    finalBalance: result.summary.finalBalance,
  };
}

function benchmark(candles: IndicatorCandle[], startTime: string, endTime: string, initialBalance: number): BuyAndHoldBenchmark | null {
  const period = candles.filter((candle) => timestamp(candle) >= Date.parse(startTime) && timestamp(candle) <= Date.parse(endTime));
  if (!period.length || period[0]!.open <= 0) return null;
  const startPrice = period[0]!.open;
  const endPrice = period[period.length - 1]!.close;
  const returnPercent = (endPrice / startPrice - 1) * 100;
  return {
    label: "Long-only buy-and-hold (price-only)",
    startPrice,
    endPrice,
    returnPercent,
    initialBalance,
    finalBalance: initialBalance * (1 + returnPercent / 100),
    netPnl: initialBalance * returnPercent / 100,
    excludesTradingCosts: true,
  };
}

export function runOutOfSampleValidation(input: BacktestInput, inSamplePercent = DEFAULT_IN_SAMPLE_PERCENT): OutOfSampleValidation {
  const planResult = createValidationPlan(input.candles, {
    startDate: input.startDate,
    endDate: input.endDate,
    inSamplePercent,
  });
  if (planResult.status === "insufficient-data") {
    return {
      version: OUT_OF_SAMPLE_VALIDATION_VERSION,
      status: "insufficient-data",
      inSamplePercent,
      outOfSamplePercent: 100 - inSamplePercent,
      inSample: null,
      outOfSample: null,
      benchmark: null,
      noTradeBaseline: null,
      warnings: [planResult.reason, "No independent performance conclusion can be drawn from an insufficient sample."],
    };
  }

  const { plan } = planResult;
  const runPeriod = (startTime: string, endTime: string) => runBacktest({
    ...input,
    startDate: undefined,
    endDate: undefined,
    testStartTime: startTime,
    testEndTime: endTime,
  });
  const inSampleResult = runPeriod(plan.inSample.startTime, plan.inSample.endTime);
  const outOfSampleResult = runPeriod(plan.outOfSample.startTime, plan.outOfSample.endTime);
  const outMetrics = metrics(outOfSampleResult);
  return {
    version: OUT_OF_SAMPLE_VALIDATION_VERSION,
    status: inSampleResult.status === "completed" && outOfSampleResult.status === "completed" ? "completed" : "insufficient-data",
    inSamplePercent,
    outOfSamplePercent: 100 - inSamplePercent,
    inSample: metrics(inSampleResult),
    outOfSample: outMetrics,
    benchmark: benchmark(input.candles, plan.outOfSample.startTime, plan.outOfSample.endTime, input.config?.initialBalance ?? 10_000),
    noTradeBaseline: {
      label: "No-trade baseline",
      initialBalance: input.config?.initialBalance ?? 10_000,
      finalBalance: input.config?.initialBalance ?? 10_000,
      netPnl: 0,
      returnPercent: 0,
    },
    warnings: [
      "The split is chronological: in-sample candles end before out-of-sample candles begin; the two scored windows do not overlap.",
      "Out-of-sample results are for an untouched holdout only if strategy rules and settings were not changed after inspecting these results.",
      "The buy-and-hold benchmark is long-only and price-only; it excludes spread, fees, financing, dividends, and instrument-specific contract sizing, so it is directional context rather than a perfectly matched comparison.",
      "Both periods use prior candles only for indicator and higher-timeframe warm-up; warm-up candles are not scored as trades.",
    ],
  };
}
