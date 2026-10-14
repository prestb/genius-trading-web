
export type MarketCandle = {
    time: string;
    open: number;
    high: number;
    low: number;
    close: number;
};

export function isValidCandle(candle: MarketCandle): boolean {
    return (
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
    );
}

export function getCandleAgeSeconds(
    latestCandleTime: string,
    now = Date.now(),
): number | null {
    const timestamp = Date.parse(latestCandleTime);

    if (!Number.isFinite(timestamp)) return null;

    const ageMilliseconds = now - timestamp;

    if (ageMilliseconds < -60_000) return null;

    return Math.max(0, Math.floor(ageMilliseconds / 1000));
}

export function isCandleFresh(
    candleAgeSeconds: number,
    intervalSeconds: number,
    freshnessMultiplier = 2,
): boolean {
    return candleAgeSeconds <= intervalSeconds * freshnessMultiplier;
}
