import { NextRequest, NextResponse } from "next/server";
import { runBacktest, type BacktestConfig, type BacktestInterval } from "@/lib/backtesting";
import { runOutOfSampleValidation } from "@/lib/backtest-validation";
import { analyzeRobustness } from "@/lib/robustness-analysis";
import { getRequiredHigherTimeframes } from "@/lib/multi-timeframe";
import { isValidCandle } from "@/lib/market-validation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const allowedIntervals = new Set<BacktestInterval>([
  "1min", "5min", "15min", "30min", "1h", "4h", "1day",
]);
const LATEST_HISTORY_SIZE = 1000;
const RANGE_HISTORY_SIZE = 5000;
const INTERVAL_SECONDS: Record<string, number> = {
  "1min": 60, "5min": 300, "15min": 900, "30min": 1800,
  "1h": 3600, "4h": 14400, "1day": 86400, "1week": 604800,
};

type ProviderCandle = { datetime?: unknown; open?: unknown; high?: unknown; low?: unknown; close?: unknown };

async function fetchHistory(symbol: string, interval: string, apiKey: string, startDate?: string, endDate?: string) {
  const params = new URLSearchParams({
    symbol,
    interval,
    timezone: "UTC",
    outputsize: String(startDate && endDate ? RANGE_HISTORY_SIZE : LATEST_HISTORY_SIZE),
    apikey: apiKey,
  });
  if (startDate && endDate) {
    const intervalSeconds = INTERVAL_SECONDS[interval];
    if (!intervalSeconds) throw new Error(`Unsupported interval for historical warm-up: ${interval}.`);
    const warmupStart = new Date(Date.parse(`${startDate}T00:00:00.000Z`) - intervalSeconds * 220 * 1000);
    const requestedEnd = new Date(Date.parse(`${endDate}T00:00:00.000Z`) + 86_399_000);
    const formatProviderDate = (date: Date) => date.toISOString().slice(0, 19).replace("T", " ");
    params.set("start_date", formatProviderDate(warmupStart));
    params.set("end_date", formatProviderDate(requestedEnd));
  }
  const response = await fetch(`https://api.twelvedata.com/time_series?${params.toString()}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("Market data provider request failed.");
  const data = await response.json();
  if (data.status === "error" || !Array.isArray(data.values)) {
    throw new Error("Historical market data is unavailable for one or more required timeframes.");
  }
  const candles = (data.values as ProviderCandle[])
    .map((item) => ({
      time: String(item.datetime ?? ""),
      open: Number(item.open),
      high: Number(item.high),
      low: Number(item.low),
      close: Number(item.close),
    }))
    .filter((candle) => isValidCandle(candle) && Number.isFinite(Date.parse(candle.time)))
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  if (candles.length < 201) throw new Error(`Insufficient historical candles returned for ${interval}.`);
  return candles;
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Market data is not configured on the server." }, { status: 503 });
  }

  let body: { symbol?: unknown; interval?: unknown; startDate?: unknown; endDate?: unknown; includeValidation?: unknown; config?: Partial<BacktestConfig> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const symbol = typeof body.symbol === "string" ? body.symbol.trim() : "";
  const interval = typeof body.interval === "string" ? body.interval : "";
  if (!/^[A-Za-z0-9_./-]{1,30}$/.test(symbol)) {
    return NextResponse.json({ error: "Invalid market symbol." }, { status: 400 });
  }
  if (!allowedIntervals.has(interval as BacktestInterval)) {
    return NextResponse.json({ error: "Unsupported backtest interval." }, { status: 400 });
  }
  if (body.includeValidation !== undefined && typeof body.includeValidation !== "boolean") {
    return NextResponse.json({ error: "includeValidation must be a boolean." }, { status: 400 });
  }
  if ((body.startDate !== undefined && body.startDate !== "" && typeof body.startDate !== "string") ||
      (body.endDate !== undefined && body.endDate !== "" && typeof body.endDate !== "string")) {
    return NextResponse.json({ error: "startDate and endDate must be date strings." }, { status: 400 });
  }
  const startDate = typeof body.startDate === "string" && body.startDate ? body.startDate : undefined;
  const endDate = typeof body.endDate === "string" && body.endDate ? body.endDate : undefined;
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const isValidDate = (value: string | undefined) => value === undefined ||
    (datePattern.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)) &&
      new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value);
  if (!isValidDate(startDate) || !isValidDate(endDate)) {
    return NextResponse.json({ error: "Dates must be valid YYYY-MM-DD calendar dates." }, { status: 400 });
  }
  if ((startDate && !endDate) || (!startDate && endDate)) {
    return NextResponse.json({ error: "Provide both startDate and endDate, or leave both blank to use the latest available history." }, { status: 400 });
  }
  if (startDate && endDate && startDate > endDate) {
    return NextResponse.json({ error: "startDate must be on or before endDate." }, { status: 400 });
  }
  if (endDate && endDate > new Date().toISOString().slice(0, 10)) {
    return NextResponse.json({ error: "endDate cannot be in the future." }, { status: 400 });
  }
  if (body.config !== undefined && (!body.config || typeof body.config !== "object" || Array.isArray(body.config))) {
    return NextResponse.json({ error: "Backtest config must be an object of numeric settings." }, { status: 400 });
  }

  try {
    const requiredIntervals = getRequiredHigherTimeframes(interval);
    if (!requiredIntervals.length) {
      return NextResponse.json({ error: "No higher-timeframe mapping exists for this interval." }, { status: 400 });
    }
    const intervals = [interval, ...requiredIntervals];
    const histories = await Promise.all(intervals.map((frameInterval) => fetchHistory(symbol, frameInterval, apiKey, startDate, endDate)));
    const higherTimeframeCandles: Record<string, Awaited<ReturnType<typeof fetchHistory>>> = {};
    requiredIntervals.forEach((frameInterval, index) => {
      higherTimeframeCandles[frameInterval] = histories[index + 1]!;
    });
    const backtestInput = {
      symbol,
      interval: interval as BacktestInterval,
      candles: histories[0]!,
      higherTimeframeCandles,
      config: body.config,
      startDate,
      endDate,
    };
    const result = runBacktest(backtestInput);
    const validation = body.includeValidation === true
      ? runOutOfSampleValidation(backtestInput)
      : undefined;
    const robustness = result.status === "completed" ? analyzeRobustness(backtestInput, result) : undefined;
    return NextResponse.json({ ...result, ...(validation ? { validation } : {}), ...(robustness ? { robustness } : {}) }, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Backtest could not be completed.";
    const isValidation = /must be|chronological|valid OHLC|between|greater than|no more than|integer/i.test(message);
    return NextResponse.json(
      { error: isValidation ? message : "Historical data could not be loaded. Check the symbol, provider plan, and API usage limits." },
      { status: isValidation ? 400 : 502 },
    );
  }
}
