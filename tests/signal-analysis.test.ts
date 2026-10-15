
import { describe, expect, it } from "vitest";
import {
    analyzeSignal,
    type SignalAnalysisInput,
} from "../lib/signal-analysis";
import type { IndicatorCandle } from "../lib/indicators";
import type { TrendAnalysis } from "../lib/trend-analysis";
import type { PriceActionAnalysis } from "../lib/price-action";

type TestRegime = NonNullable<SignalAnalysisInput["regime"]>;

function makeCandles(
    direction: "up" | "down" = "up",
    count = 200,
): IndicatorCandle[] {
    return Array.from({ length: count }, (_, index) => {
        const close =
            direction === "up"
                ? 100 + index * 0.1
                : 120 - index * 0.1;

        return {
            time: new Date(
                Date.UTC(2026, 0, 1, 0, index),
            ).toISOString(),
            open: close,
            high: close + 1,
            low: close - 1,
            close,
        };
    });
}

const bullishTrend: TrendAnalysis = {
    direction: "Bullish",
    timeframe: "Long-term",
    explanation: "Bullish test trend.",
    checksPassed: 3,
    checksRequired: 3,
};

const bearishTrend: TrendAnalysis = {
    direction: "Bearish",
    timeframe: "Long-term",
    explanation: "Bearish test trend.",
    checksPassed: 3,
    checksRequired: 3,
};


const TEST_REGIME_CANDLE_TIME =
    new Date(Date.UTC(2026, 0, 1, 0, 199)).toISOString();

const bullishTrendingRegime = {
    version: "1.0.0",
    regime: "Trending",
    direction: "Bullish",
    confidence: "High",
    actionable: true,
    summary: "A bullish trend-like regime is detected.",
    efficiencyRatio: 0.65,
    volatilityRatio: 1.2,
    reasons: ["Directional movement confirms a bullish trend."],
    latestCandleAt: TEST_REGIME_CANDLE_TIME,
} as TestRegime;

const bearishTrendingRegime = {
    ...bullishTrendingRegime,
    direction: "Bearish",
    summary: "A bearish trend-like regime is detected.",
} as TestRegime;

const rangingRegime = {
    ...bullishTrendingRegime,
    regime: "Ranging",
    direction: "Neutral",
    confidence: "Moderate",
    actionable: false,
    summary: "Market is ranging.",
    efficiencyRatio: 0.15,
} as TestRegime;

const highVolatilityRegime = {
    ...bullishTrendingRegime,
    regime: "High volatility",
    confidence: "Moderate",
    actionable: false,
    summary: "Volatility is elevated.",
    volatilityRatio: 2.1,
} as TestRegime;

const unclearRegime = {
    ...bullishTrendingRegime,
    regime: "Unclear",
    direction: "Neutral",
    confidence: "Low",
    actionable: false,
    summary: "Market conditions are mixed.",
    efficiencyRatio: 0.3,
} as TestRegime;

function makePriceAction(
    overrides: Partial<PriceActionAnalysis> = {},
): PriceActionAnalysis {
    return {
        version: "1.0.0",
        status: "Available",
        direction: "Bullish",
        actionable: false,
        summary: "Bullish test structure.",
        support: 99,
        resistance: 120,
        latestSwingHigh: 120,
        latestSwingLow: 99,
        events: [],
        reasons: [],
        latestCandleAt: "2026-10-14T11:59:00.000Z",
        ...overrides,
    };
}

function makeInput(
    overrides: Partial<SignalAnalysisInput> = {},
): SignalAnalysisInput {
    return {
        symbol: "TEST",
        interval: "1h",
        candles: makeCandles(),
        indicators: {
            ema50: 115,
            ema200: 110,
            rsi14: 60,
            atr14: 2,
        },
        trend: bullishTrend,
        isFresh: true,
        candleAgeSeconds: 60,
        analyzedAt: "2026-10-14T12:00:00.000Z",
        ...overrides,
    };
}

describe("analyzeSignal", () => {
    it("returns BUY when all bullish conditions align", () => {
        const result = analyzeSignal(makeInput());

        expect(result.direction).toBe("BUY");
        expect(result.actionable).toBe(true);
        expect(result.quality).toBe("High");
        expect(result.riskPlan).not.toBeNull();
        expect(result.riskPlan?.riskRewardRatio).toBeCloseTo(
            2.5 / 1.5,
        );
    });

    it("returns SELL when all bearish conditions align", () => {
        const result = analyzeSignal(
            makeInput({
                candles: makeCandles("down"),
                indicators: {
                    ema50: 105,
                    ema200: 110,
                    rsi14: 40,
                    atr14: 2,
                },
                trend: bearishTrend,
            }),
        );

        expect(result.direction).toBe("SELL");
        expect(result.actionable).toBe(true);
        expect(result.riskPlan?.stopLoss).toBeGreaterThan(
            result.riskPlan?.entry ?? 0,
        );
        expect(result.riskPlan?.takeProfit).toBeLessThan(
            result.riskPlan?.entry ?? 0,
        );
    });

    it("returns WAIT when market data is stale", () => {
        const result = analyzeSignal(
            makeInput({ isFresh: false }),
        );

        expect(result.direction).toBe("WAIT");
        expect(result.actionable).toBe(false);
        expect(result.riskPlan).toBeNull();
        expect(result.reasons[0]?.code).toBe(
            "STALE_OR_UNVERIFIED_DATA",
        );
    });

    it("returns WAIT when candle history is insufficient", () => {
        const result = analyzeSignal(
            makeInput({ candles: makeCandles("up", 100) }),
        );

        expect(result.direction).toBe("WAIT");
        expect(result.actionable).toBe(false);
        expect(result.reasons[0]?.code).toBe(
            "INVALID_OR_INSUFFICIENT_HISTORY",
        );
    });

    it("returns WAIT when candle data is invalid", () => {
        const candles = makeCandles();
        candles[50] = {
            ...candles[50]!,
            high: 1,
        };

        const result = analyzeSignal(makeInput({ candles }));

        expect(result.direction).toBe("WAIT");
        expect(result.actionable).toBe(false);
    });

    it("returns WAIT when indicators are unavailable", () => {
        const result = analyzeSignal(
            makeInput({
                indicators: {
                    ema50: null,
                    ema200: null,
                    rsi14: null,
                    atr14: null,
                },
            }),
        );

        expect(result.direction).toBe("WAIT");
        expect(result.riskPlan).toBeNull();
        expect(result.reasons[0]?.code).toBe(
            "INVALID_INDICATORS",
        );
    });

    it("returns WAIT when trend confirmation disagrees", () => {
        const result = analyzeSignal(
            makeInput({
                trend: {
                    ...bullishTrend,
                    direction: "Neutral",
                },
            }),
        );

        expect(result.direction).toBe("WAIT");
        expect(result.actionable).toBe(false);
    });

    it("rejects a risk percentage above the limit", () => {
        const result = analyzeSignal(
            makeInput({ riskPercent: 6 }),
        );

        expect(result.direction).toBe("WAIT");
        expect(result.reasons[0]?.code).toBe(
            "INVALID_RISK_PERCENT",
        );
    });

    it("preserves the symbol, timeframe and engine version", () => {
        const result = analyzeSignal(makeInput());

        expect(result.symbol).toBe("TEST");
        expect(result.interval).toBe("1h");
        expect(result.engineVersion).toBe("1.0.0");
        expect(result.analyzedAt).toBe(
            "2026-10-14T12:00:00.000Z",
        );
    });

    it("allows BUY when the regime confirms a bullish trend", () => {
        const result = analyzeSignal(
            makeInput({ regime: bullishTrendingRegime }),
        );

        expect(result.direction).toBe("BUY");
        expect(result.actionable).toBe(true);

        expect(
            result.reasons.filter(
                (reason) => reason.code === "MARKET_REGIME_CONFIRMATION",
            ),
        ).toHaveLength(1);
    });

    it("allows SELL when the regime confirms a bearish trend", () => {
        const result = analyzeSignal(
            makeInput({
                candles: makeCandles("down"),
                indicators: {
                    ema50: 105,
                    ema200: 110,
                    rsi14: 40,
                    atr14: 2,
                },
                trend: bearishTrend,
                regime: bearishTrendingRegime,
            }),
        );

        expect(result.direction).toBe("SELL");
        expect(result.actionable).toBe(true);
    });

    it("blocks a BUY candidate in a ranging market", () => {
        const result = analyzeSignal(
            makeInput({ regime: rangingRegime }),
        );

        expect(result.direction).toBe("WAIT");
        expect(result.actionable).toBe(false);
        expect(result.riskPlan).toBeNull();
        expect(result.reasons[0]?.code).toBe(
            "MARKET_REGIME_GATE",
        );
    });

    it("blocks a BUY candidate during high volatility", () => {
        const result = analyzeSignal(
            makeInput({ regime: highVolatilityRegime }),
        );

        expect(result.direction).toBe("WAIT");
        expect(result.actionable).toBe(false);
        expect(result.reasons[0]?.code).toBe(
            "MARKET_REGIME_GATE",
        );
    });

    it("blocks a BUY candidate when the regime is bearish", () => {
        const result = analyzeSignal(
            makeInput({ regime: bearishTrendingRegime }),
        );

        expect(result.direction).toBe("WAIT");
        expect(result.actionable).toBe(false);
        expect(result.reasons[0]?.code).toBe(
            "MARKET_REGIME_GATE",
        );
        expect(result.summary.toLowerCase()).toContain(
            "conflicts",
        );
    });

    it("blocks a candidate when the regime is unclear", () => {
        const result = analyzeSignal(
            makeInput({ regime: unclearRegime }),
        );

        expect(result.direction).toBe("WAIT");
        expect(result.actionable).toBe(false);
        expect(result.reasons[0]?.code).toBe(
            "MARKET_REGIME_GATE",
        );
    });

    it("allows BUY when price-action structure confirms bullish direction", () => {
        const result = analyzeSignal(
            makeInput({
                priceAction: makePriceAction({
                    direction: "Bullish",
                }),
            }),
        );

        expect(result.direction).toBe("BUY");
        expect(result.actionable).toBe(true);
        expect(result.reasons).toContainEqual(
            expect.objectContaining({
                code: "PRICE_ACTION_CONFIRMATION",
                passed: true,
            }),
        );
        expect(result.summary).toContain(
            "Price-action confirmation passed.",
        );
    });

    it("allows SELL when price-action structure confirms bearish direction", () => {
        const result = analyzeSignal(
            makeInput({
                candles: makeCandles("down"),
                indicators: {
                    ema50: 105,
                    ema200: 110,
                    rsi14: 40,
                    atr14: 2,
                },
                trend: bearishTrend,
                priceAction: makePriceAction({
                    direction: "Bearish",
                }),
            }),
        );

        expect(result.direction).toBe("SELL");
        expect(result.actionable).toBe(true);
    });

    it("allows a matching bullish BOS when swing direction is unclear", () => {
        const result = analyzeSignal(
            makeInput({
                priceAction: makePriceAction({
                    direction: "Unclear",
                    events: [
                        {
                            type: "BULLISH_BOS",
                            level: 120,
                            candleTime: "2026-10-14T11:59:00.000Z",
                            description: "Price closed above swing resistance.",
                        },
                    ],
                }),
            }),
        );

        expect(result.direction).toBe("BUY");
        expect(result.actionable).toBe(true);
        expect(result.reasons).toContainEqual(
            expect.objectContaining({
                code: "PRICE_ACTION_BULLISH_BOS",
                passed: true,
            }),
        );
    });

    it("blocks BUY when price-action structure is bearish", () => {
        const result = analyzeSignal(
            makeInput({
                priceAction: makePriceAction({
                    direction: "Bearish",
                }),
            }),
        );

        expect(result.direction).toBe("WAIT");
        expect(result.actionable).toBe(false);
        expect(result.riskPlan).toBeNull();
        expect(result.reasons).toContainEqual(
            expect.objectContaining({
                code: "PRICE_ACTION_CONFIRMATION",
                passed: false,
            }),
        );
    });

    it("blocks a candidate when price action is available but provides no confirmation", () => {
        const result = analyzeSignal(
            makeInput({
                priceAction: makePriceAction({
                    direction: "Unclear",
                    events: [],
                }),
            }),
        );

        expect(result.direction).toBe("WAIT");
        expect(result.actionable).toBe(false);
        expect(result.riskPlan).toBeNull();
    });

    it("blocks a candidate when price-action analysis is unavailable", () => {
        const result = analyzeSignal(
            makeInput({
                priceAction: makePriceAction({
                    status: "Unavailable",
                    direction: "Unclear",
                    reasons: [
                        "Insufficient valid candles for price-action analysis.",
                    ],
                }),
            }),
        );

        expect(result.direction).toBe("WAIT");
        expect(result.actionable).toBe(false);
        expect(result.reasons[0]?.code).toBe(
            "PRICE_ACTION_UNAVAILABLE",
        );
    });

    it("blocks BUY when an opposing bearish price-action event is present", () => {
        const result = analyzeSignal(
            makeInput({
                priceAction: makePriceAction({
                    direction: "Bullish",
                    events: [
                        {
                            type: "BEARISH_LIQUIDITY_SWEEP",
                            level: 120,
                            candleTime: "2026-10-14T11:59:00.000Z",
                            description: "Price swept above swing resistance and closed below it.",
                        },
                    ],
                }),
            }),
        );

        expect(result.direction).toBe("WAIT");
        expect(result.actionable).toBe(false);
        expect(result.reasons).toContainEqual(
            expect.objectContaining({
                code: "PRICE_ACTION_CONFIRMATION",
                passed: false,
            }),
        );
    });

    it("preserves the ATR risk plan when price-action confirmation passes", () => {
        const result = analyzeSignal(
            makeInput({
                priceAction: makePriceAction({
                    direction: "Bullish",
                }),
            }),
        );

        expect(result.direction).toBe("BUY");
        expect(result.riskPlan?.entry).toBe(
            result.riskPlan?.stopLoss !== undefined
                ? makeCandles().at(-1)?.close
                : undefined,
        );
        expect(result.riskPlan?.riskPerUnit).toBeCloseTo(3);
        expect(result.riskPlan?.rewardPerUnit).toBeCloseTo(5);
        expect(result.riskPlan?.riskRewardRatio).toBeCloseTo(
            5 / 3,
        );
    });
});
