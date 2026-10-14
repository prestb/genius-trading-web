
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const allowedIntervals = new Set([
      "1min",
      "5min",
      "15min",
      "30min",
      "1h",
      "4h",
      "1day",
]);

const intervalSeconds: Record<string, number> = {
      "1min": 60,
      "5min": 300,
      "15min": 900,
      "30min": 1800,
      "1h": 3600,
      "4h": 14400,
      "1day": 86400,
};

const freshnessMultiplier = 2;

export async function GET(request: NextRequest) {
      const apiKey = process.env.TWELVE_DATA_API_KEY;

      if (!apiKey) {
            return NextResponse.json(
                  { error: "Market data is not configured on the server." },
                  { status: 503 }
            );
      }

      const symbol =
            request.nextUrl.searchParams.get("symbol") || "EUR/USD";
      const interval =
            request.nextUrl.searchParams.get("interval") || "15min";

      if (!/^[A-Za-z0-9_./-]{1,30}$/.test(symbol)) {
            return NextResponse.json(
                  { error: "Invalid market symbol." },
                  { status: 400 }
            );
      }

      if (!allowedIntervals.has(interval)) {
            return NextResponse.json(
                  { error: "Unsupported interval." },
                  { status: 400 }
            );
      }

      try {
            const params = new URLSearchParams({
                  symbol,
                  interval,
                  timezone: "UTC",
                  outputsize: "250",
                  apikey: apiKey,
            });

            const response = await fetch(
                  `https://api.twelvedata.com/time_series?${params}`,
                  {
                        cache: "no-store",
                        signal: AbortSignal.timeout(12000),
                  }
            );

            if (!response.ok) {
                  return NextResponse.json(
                        { error: "The market-data provider request failed." },
                        { status: 502 }
                  );
            }

            const data = await response.json();

            if (
                  data.status === "error" ||
                  !Array.isArray(data.values) ||
                  data.values.length === 0
            ) {
                  return NextResponse.json(
                        {
                              error:
                                    typeof data.message === "string"
                                          ? data.message
                                          : "No verified candle data was returned.",
                        },
                        { status: 502 }
                  );
            }

            const candles = data.values
                  .map((item: Record<string, unknown>) => ({
                        time: String(item.datetime ?? ""),
                        open: Number(item.open),
                        high: Number(item.high),
                        low: Number(item.low),
                        close: Number(item.close),
                  }))
                  .filter(
                        (candle: {
                              time: string;
                              open: number;
                              high: number;
                              low: number;
                              close: number;
                        }) =>
                              candle.time.length > 0 &&
                              [
                                    candle.open,
                                    candle.high,
                                    candle.low,
                                    candle.close,
                              ].every(Number.isFinite) &&
                              candle.high >= candle.low &&
                              candle.high >= Math.max(candle.open, candle.close) &&
                              candle.low <= Math.min(candle.open, candle.close)
                  )
                  .reverse();

            if (candles.length === 0) {
                  return NextResponse.json(
                        { error: "No valid market candles were returned." },
                        { status: 502 }
                  );
            }

            const latestCandle = candles[candles.length - 1];
            const latestCandleTime = Date.parse(latestCandle.time);

            if (!Number.isFinite(latestCandleTime)) {
                  return NextResponse.json(
                        { error: "The latest candle has an invalid timestamp." },
                        { status: 502 }
                  );
            }

            const ageMilliseconds = Date.now() - latestCandleTime;

            if (ageMilliseconds < -60_000) {
                  return NextResponse.json(
                              { error: "The latest candle timestamp is unexpectedly in the future." },
                                          { status: 502 }
                                                );
                                                }

                                                const candleAgeSeconds = Math.max(
                                                      0,
                                                            Math.floor(ageMilliseconds / 1000)
                                                            );

            const maxCandleAgeSeconds =
                  intervalSeconds[interval] * freshnessMultiplier;

            const isFresh = candleAgeSeconds <= maxCandleAgeSeconds;

            return NextResponse.json(
                  {
                        source: "Twelve Data",
                        symbol,
                        interval,
                        count: candles.length,
                        candles,
                        retrievedAt: new Date().toISOString(),
                        latestCandleAt: latestCandle.time,
                        candleAgeSeconds,
                        isFresh,
                  },
                  {
                        headers: {
                              "Cache-Control": "no-store, max-age=0",
                        },
                  }
            );
      } catch {
            return NextResponse.json(
                  {
                        error:
                              "Market data request timed out or could not connect.",
                  },
                  { status: 502 }
            );
      }
}
