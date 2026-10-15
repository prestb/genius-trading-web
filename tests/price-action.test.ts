
import { describe, expect, it } from "vitest";
import {
    analyzePriceAction,
    PRICE_ACTION_VERSION,
} from "../lib/price-action";
import type { IndicatorCandle } from "../lib/indicators";

function makeCandles(count = 30): IndicatorCandle[] {
    return Array.from({ length: count }, (_, index) => {
        const close = 100 + index * 0.1;

        return {
            time: new Date(
                Date.UTC(2026, 0, 1, 0, index),
            ).toISOString(),
            open: close,
            high: close + 0.2,
            low: close - 0.2,
            close,
        };
    });
}

function makeSwingCandles(): IndicatorCandle[] {
    const candles = makeCandles(30);

    // Create a confirmed swing high at index 24.
    candles[22] = {
        ...candles[22]!,
        high: 103,
    };
    candles[23] = {
        ...candles[23]!,
        high: 104,
    };
    candles[24] = {
        ...candles[24]!,
        open: 103,
        high: 110,
        low: 102.5,
        close: 103,
    };
    candles[25] = {
        ...candles[25]!,
        high: 104,
    };
    candles[26] = {
        ...candles[26]!,
        high: 103,
    };

    // Create a confirmed swing low at index 20.
    candles[18] = {
        ...candles[18]!,
        low: 99,
    };
    candles[19] = {
        ...candles[19]!,
        low: 98,
    };
    candles[20] = {
        ...candles[20]!,
        open: 101,
        high: 102,
        low: 90,
        close: 101,
    };
    candles[21] = {
        ...candles[21]!,
        low: 98.5,
    };

    return candles;
}

describe("analyzePriceAction", () => {
    it("returns a versioned result for valid candle history", () => {
        const result = analyzePriceAction({
            candles: makeCandles(),
        });

        expect(result.version).toBe(PRICE_ACTION_VERSION);
        expect(result.status).toBe("Available");
        expect(result.latestCandleAt).not.toBeNull();
    });

    it("returns unavailable for insufficient history", () => {
        const result = analyzePriceAction({
            candles: makeCandles(10),
        });

        expect(result.status).toBe("Unavailable");
        expect(result.actionable).toBe(false);
        expect(result.events).toHaveLength(0);
    });

    it("rejects an invalid pivot strength", () => {
        const result = analyzePriceAction({
            candles: makeCandles(),
            pivotStrength: 0,
        });

        expect(result.status).toBe("Unavailable");
        expect(result.reasons[0]).toContain("Pivot strength");
    });

    it("rejects invalid candle data", () => {
        const candles = makeCandles();
        candles[10] = {
            ...candles[10]!,
            high: 1,
        };

        const result = analyzePriceAction({ candles });

        expect(result.status).toBe("Unavailable");
        expect(result.actionable).toBe(false);
    });

    it("rejects candles that are not chronological", () => {
        const candles = makeCandles();
        candles[10] = {
            ...candles[10]!,
            time: candles[9]!.time,
        };

        const result = analyzePriceAction({ candles });

        expect(result.status).toBe("Unavailable");
    });

    it("detects a bullish break above a confirmed swing high", () => {
        const candles = makeSwingCandles();
        const last = candles.length - 1;

        candles[last - 1] = {
            ...candles[last - 1]!,
            open: 102,
            high: 104,
            low: 101,
            close: 103,
        };

        candles[last] = {
            ...candles[last]!,
            open: 104,
            high: 112,
            low: 103,
            close: 111,
        };

        const result = analyzePriceAction({ candles });

        expect(result.events).toContainEqual(
            expect.objectContaining({
                type: "BULLISH_BOS",
                level: 110,
            }),
        );
    });

    it("detects a bearish break below a confirmed swing low", () => {
        const candles = makeSwingCandles();
        const last = candles.length - 1;

        candles[last - 1] = {
            ...candles[last - 1]!,
            open: 101,
            high: 103,
            low: 99,
            close: 100,
        };

        candles[last] = {
            ...candles[last]!,
            open: 99,
            high: 100,
            low: 88,
            close: 89,
        };

        const result = analyzePriceAction({ candles });

        expect(result.events).toContainEqual(
            expect.objectContaining({
                type: "BEARISH_BOS",
                level: 90,
            }),
        );
    });

    it("detects a potential bearish liquidity sweep", () => {
        const candles = makeSwingCandles();
        const last = candles.length - 1;

        candles[last - 1] = {
            ...candles[last - 1]!,
            open: 103,
            high: 105,
            low: 102,
            close: 104,
        };

        candles[last] = {
            ...candles[last]!,
            open: 108,
            high: 112,
            low: 102,
            close: 108,
        };

        const result = analyzePriceAction({ candles });

        expect(result.events).toContainEqual(
            expect.objectContaining({
                type: "BEARISH_LIQUIDITY_SWEEP",
                level: 110,
            }),
        );
    });

    it("detects a potential bullish liquidity sweep", () => {
        const candles = makeSwingCandles();
        const last = candles.length - 1;

        candles[last - 1] = {
            ...candles[last - 1]!,
            open: 100,
            high: 102,
            low: 95,
            close: 99,
        };

        candles[last] = {
            ...candles[last]!,
            open: 92,
            high: 103,
            low: 87,
            close: 102,
        };

        const result = analyzePriceAction({ candles });

        expect(result.events).toContainEqual(
            expect.objectContaining({
                type: "BULLISH_LIQUIDITY_SWEEP",
                level: 90,
            }),
        );
    });

    it("never labels a price-action observation as an actionable trade", () => {
        const result = analyzePriceAction({
            candles: makeSwingCandles(),
        });

        expect(result.actionable).toBe(false);
    });
});
