
import { describe, expect, it } from "vitest";
import {
    analyzeMarketRegime,
    type MarketRegimeInput,
} from "../lib/market-regime";
import type { IndicatorCandle } from "../lib/indicators";

function makeCandles(
    mode: "trend-up" | "trend-down" | "range" | "volatile",
    count = 60,
): IndicatorCandle[] {
    return Array.from({ length: count }, (_, index) => {
        let close: number;

        if (mode === "trend-up") {
            close = 100 + index * 2;
        } else if (mode === "trend-down") {
            close = 220 - index * 2;
        } else if (mode === "range") {
            close = 100 + (index % 2 === 0 ? 0.1 : -0.1);
        } else {
            close = 100 + index * 0.05;
        }

        const range =
            mode === "volatile" && index >= count - 5
                ? 8
                : mode === "range"
                    ? 0.5
                    : 1;

        return {
            time: new Date(
                Date.UTC(2026, 0, 1, 0, index),
            ).toISOString(),
            open: close,
            high: close + range,
            low: close - range,
            close,
        };
    });
}

function makeInput(
    mode: "trend-up" | "trend-down" | "range" | "volatile",
): MarketRegimeInput {
    return { candles: makeCandles(mode) };
}

describe("analyzeMarketRegime", () => {
    it("detects a directional upward market", () => {
        const result = analyzeMarketRegime(makeInput("trend-up"));

        expect(result.regime).toBe("Trending");
        expect(result.direction).toBe("Bullish");
        expect(result.efficiencyRatio).toBeGreaterThanOrEqual(0.4);
        expect(result.latestCandleAt).not.toBeNull();
    });

    it("detects a directional downward market", () => {
        const result = analyzeMarketRegime(makeInput("trend-down"));

        expect(result.regime).toBe("Trending");
        expect(result.direction).toBe("Bearish");
    });

    it("detects a ranging market", () => {
        const result = analyzeMarketRegime(makeInput("range"));

        expect(result.regime).toBe("Ranging");
        expect(result.direction).toBe("Neutral");
        expect(result.actionable).toBe(false);
    });

    it("detects a sudden volatility expansion", () => {
        const result = analyzeMarketRegime(makeInput("volatile"));

        expect(result.regime).toBe("High volatility");
        expect(result.actionable).toBe(false);
        expect(result.volatilityRatio).toBeGreaterThanOrEqual(1.8);
    });

    it("rejects insufficient history", () => {
        const result = analyzeMarketRegime({
            candles: makeCandles("trend-up", 20),
        });

        expect(result.regime).toBe("Unclear");
        expect(result.confidence).toBe("Unavailable");
        expect(result.actionable).toBe(false);
    });

    it("rejects invalid OHLC values", () => {
        const candles = makeCandles("trend-up");
        candles[10] = { ...candles[10], high: 1 };

        const result = analyzeMarketRegime({ candles });

        expect(result.regime).toBe("Unclear");
        expect(result.actionable).toBe(false);
    });

    it("rejects non-chronological candles", () => {
        const candles = makeCandles("trend-up");
        candles[20] = {
            ...candles[20],
            time: candles[19].time,
        };

        const result = analyzeMarketRegime({ candles });

        expect(result.regime).toBe("Unclear");
        expect(result.confidence).toBe("Unavailable");
    });

    it("returns a versioned, explainable result", () => {
        const result = analyzeMarketRegime(makeInput("trend-up"));

        expect(result.version).toBe("1.0.0");
        expect(result.summary.length).toBeGreaterThan(0);
        expect(result.reasons.length).toBeGreaterThan(0);
        expect(result.efficiencyRatio).not.toBeNull();
        expect(result.volatilityRatio).not.toBeNull();
    });
});
