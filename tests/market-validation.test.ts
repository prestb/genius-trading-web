
import { describe, expect, it } from "vitest";
import {
    getCandleAgeSeconds,
    isCandleFresh,
    isValidCandle,
    type MarketCandle,
} from "../lib/market-validation";

const validCandle: MarketCandle = {
    time: "2026-10-14T12:00:00Z",
    open: 100,
    high: 110,
    low: 90,
    close: 105,
};

describe("isValidCandle", () => {
    it("accepts a valid OHLC candle", () => {
        expect(isValidCandle(validCandle)).toBe(true);
    });

    it("rejects a high below the low", () => {
        expect(
            isValidCandle({ ...validCandle, high: 80 }),
        ).toBe(false);
    });

    it("rejects a high below the open", () => {
        expect(
            isValidCandle({ ...validCandle, high: 99 }),
        ).toBe(false);
    });

    it("rejects a low above the close", () => {
        expect(
            isValidCandle({ ...validCandle, low: 106 }),
        ).toBe(false);
    });

    it("rejects non-finite prices", () => {
        expect(
            isValidCandle({ ...validCandle, close: Number.NaN }),
        ).toBe(false);
    });

    it("rejects an empty timestamp", () => {
        expect(
            isValidCandle({ ...validCandle, time: "" }),
        ).toBe(false);
    });
});

describe("getCandleAgeSeconds", () => {
    const now = Date.parse("2026-10-14T12:10:00Z");

    it("calculates the candle age in seconds", () => {
        expect(
            getCandleAgeSeconds("2026-10-14T12:03:00Z", now),
        ).toBe(420);
    });

    it("returns zero for a slightly future timestamp", () => {
        expect(
            getCandleAgeSeconds("2026-10-14T12:10:30Z", now),
        ).toBe(0);
    });

    it("rejects a timestamp more than one minute in the future", () => {
        expect(
            getCandleAgeSeconds("2026-10-14T12:11:01Z", now),
        ).toBeNull();
    });

    it("rejects an invalid timestamp", () => {
        expect(getCandleAgeSeconds("not-a-date", now)).toBeNull();
    });
});

describe("isCandleFresh", () => {
    it("accepts a candle within the freshness threshold", () => {
        expect(isCandleFresh(1_500, 900)).toBe(true);
    });

    it("accepts a candle exactly at the threshold", () => {
        expect(isCandleFresh(1_800, 900)).toBe(true);
    });

    it("rejects a candle older than the threshold", () => {
        expect(isCandleFresh(1_801, 900)).toBe(false);
    });
});
