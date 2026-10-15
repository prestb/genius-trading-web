import { NextRequest, NextResponse } from "next/server";
import { runBacktest, type BacktestConfig, type BacktestInterval } from "@/lib/backtesting";
import { getRequiredHigherTimeframes } from "@/lib/multi-timeframe";
import { isValidCandle } from "@/lib/market-validation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const allowedIntervals = new Set<BacktestInterval>([
  "1min", "5min", "15min", "30min", "1h", "4h", "1day",
]);
const HISTORY_SIZE = 1000;

type ProviderCandle = { datetime?: unknown; open?: unknown; high?: unknown; low?: unknown; close?: unknown };

async function fetchHistory(symbol: string, interval: string, apiKey: string) {
  const params = new URLSearchParams({
    symbol,
    interval,
    timezone: "UTC",
    outputsize: String(HISTORY_SIZE),
    apikey: apiKey,
  });
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
    .reverse();
  if (candles.length < 201) throw new Error(`Insufficient historical candles returned for ${interval}.`);
  return candles;
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Market data is not configured on the server." }, { status: 503 });
  }

  let body: { symbol?: unknown; interval?: unknown; config?: Partial<BacktestConfig> };
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
  if (body.config !== undefined && (!body.config || typeof body.config !== "object" || Array.isArray(body.config))) {
    return NextResponse.json({ error: "Backtest config must be an object of numeric settings." }, { status: 400 });
  }

  try {
    const requiredIntervals = getRequiredHigherTimeframes(interval);
    if (!requiredIntervals.length) {
      return NextResponse.json({ error: "No higher-timeframe mapping exists for this interval." }, { status: 400 });
    }
    const intervals = [interval, ...requiredIntervals];
    const histories = await Promise.all(intervals.map((frameInterval) => fetchHistory(symbol, frameInterval, apiKey)));
    const higherTimeframeCandles: Record<string, Awaited<ReturnType<typeof fetchHistory>>> = {};
    requiredIntervals.forEach((frameInterval, index) => {
      higherTimeframeCandles[frameInterval] = histories[index + 1]!;
    });
    const result = runBacktest({
      symbol,
      interval: interval as BacktestInterval,
      candles: histories[0]!,
      higherTimeframeCandles,
      config: body.config,
    });
    return NextResponse.json(result, {
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
