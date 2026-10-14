
import { describe, expect, it } from "vitest";
import {
    calculateIndicators,
    type IndicatorCandle,
} from "../lib/indicators";

function makeCandles(
    closes: number[],
    highOffset = 1,
    lowOffset = 1,
): IndicatorCandle[] {
    return closes.map((close, index) => ({
        time: new Date(Date.UTC(2026, 0, 1, 0, index))
            .toISOString(),
        open: close,
        high: close + highOffset,
        low: close - lowOffset,
        close,
    }));
}

describe("calculateIndicators", () => {
    it("returns null when there is insufficient data", () => {
        const result = calculateIndicators(makeCandles([100, 101, 102]));

        expect(result).toEqual({
            ema50: null,
            ema200: null,
            rsi14: null,
            atr14: null,
        });
    });

    it("calculates finite EMA values with enough candles", () => {
        const closes = Array.from(
            { length: 200 },
            (_, index) => 100 + index,
        );

        const result = calculateIndicators(makeCandles(closes));

        expect(result.ema50).toEqual(expect.any(Number));
        expect(result.ema200).toEqual(expect.any(Number));
        expect(Number.isFinite(result.ema50)).toBe(true);
        expect(Number.isFinite(result.ema200)).toBe(true);
    });

    it("returns RSI of 100 when prices only rise", () => {
        const closes = Array.from(
            { length: 20 },
            (_, index) => 100 + index,
        );

        const result = calculateIndicators(makeCandles(closes));

        expect(result.rsi14).toBe(100);
    });

    it("returns RSI of 0 when prices only fall", () => {
        const closes = Array.from(
            { length: 20 },
            (_, index) => 120 - index,
        );

        const result = calculateIndicators(makeCandles(closes));

        expect(result.rsi14).toBe(0);
    });

    it("returns RSI of 50 when prices remain constant", () => {
        const result = calculateIndicators(
            makeCandles(Array(20).fill(100)),
        );

        expect(result.rsi14).toBe(50);
    });

    it("calculates ATR for valid candles", () => {
        const closes = Array.from(
            { length: 20 },
            (_, index) => 100 + index,
        );

        const result = calculateIndicators(makeCandles(closes));

        expect(result.atr14).toEqual(expect.any(Number));
        expect(Number.isFinite(result.atr14)).toBe(true);
        expect(result.atr14).toBeGreaterThan(0);
    });
});
