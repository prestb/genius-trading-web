
import type { IndicatorCandle } from "./indicators";

export const MARKET_REGIME_VERSION = "1.0.0" as const;

export type MarketRegime =
    | "Trending"
    | "Ranging"
    | "High volatility"
    | "Unclear";

export type RegimeDirection = "Bullish" | "Bearish" | "Neutral";

export type MarketRegimeInput = {
    candles: IndicatorCandle[];
};

export type MarketRegimeAnalysis = {
    version: typeof MARKET_REGIME_VERSION;
    regime: MarketRegime;
    direction: RegimeDirection;
    confidence: "High" | "Moderate" | "Low" | "Unavailable";
    actionable: boolean;
    summary: string;
    efficiencyRatio: number | null;
    volatilityRatio: number | null;
    reasons: string[];
    latestCandleAt: string | null;
};

const EFFICIENCY_LOOKBACK = 20;
const RECENT_VOLATILITY_PERIOD = 5;
const BASELINE_VOLATILITY_PERIOD = 20;
const MINIMUM_CANDLES =
    EFFICIENCY_LOOKBACK +
    RECENT_VOLATILITY_PERIOD +
    BASELINE_VOLATILITY_PERIOD;

const TRENDING_THRESHOLD = 0.4;
const RANGING_THRESHOLD = 0.25;
const HIGH_VOLATILITY_THRESHOLD = 1.8;

function isValidCandle(candle: IndicatorCandle): boolean {
    return (
        typeof candle.time === "string" &&
        Number.isFinite(Date.parse(candle.time)) &&
        [candle.open, candle.high, candle.low, candle.close].every(
            (value) => Number.isFinite(value) && value > 0,
        ) &&
        candle.high >= Math.max(candle.open, candle.close) &&
        candle.low <= Math.min(candle.open, candle.close) &&
        candle.high >= candle.low
    );
}

function trueRange(
    current: IndicatorCandle,
    previousClose: number,
): number {
    return Math.max(
        current.high - current.low,
        Math.abs(current.high - previousClose),
        Math.abs(current.low - previousClose),
    );
}

function unavailableResult(
    candles: IndicatorCandle[],
    reason: string,
): MarketRegimeAnalysis {
    return {
        version: MARKET_REGIME_VERSION,
        regime: "Unclear",
        direction: "Neutral",
        confidence: "Unavailable",
        actionable: false,
        summary: reason,
        efficiencyRatio: null,
        volatilityRatio: null,
        reasons: [reason],
        latestCandleAt: candles.at(-1)?.time ?? null,
    };
}

export function analyzeMarketRegime(
    input: MarketRegimeInput,
): MarketRegimeAnalysis {
    const { candles } = input;
    const latest = candles.at(-1);

    if (
        candles.length < MINIMUM_CANDLES ||
        !candles.every(isValidCandle) ||
        candles.some(
            (candle, index) =>
                index > 0 &&
                Date.parse(candle.time) <=
                Date.parse(candles[index - 1].time),
        )
    ) {
        return unavailableResult(
            candles,
            `At least ${MINIMUM_CANDLES} valid, chronological candles are required.`,
        );
    }

    if (!latest) {
        return unavailableResult(candles, "Latest candle is unavailable.");
    }

    const lookbackStart =
        candles.length - 1 - EFFICIENCY_LOOKBACK;
    const startClose = candles[lookbackStart].close;

    let totalMovement = 0;

    for (let index = lookbackStart + 1; index < candles.length; index++) {
        totalMovement += Math.abs(
            candles[index].close - candles[index - 1].close,
        );
    }

    const netMovement = latest.close - startClose;

    const efficiencyRatio =
        totalMovement === 0
            ? 0
            : Math.abs(netMovement) / totalMovement;

    const ranges = candles.slice(1).map((candle, index) =>
        trueRange(candle, candles[index].close),
    );

    const recentRanges = ranges.slice(
        -RECENT_VOLATILITY_PERIOD,
    );

    const baselineRanges = ranges.slice(
        -(
            RECENT_VOLATILITY_PERIOD +
            BASELINE_VOLATILITY_PERIOD
        ),
        -RECENT_VOLATILITY_PERIOD,
    );

    const recentAverage =
        recentRanges.reduce((sum, value) => sum + value, 0) /
        recentRanges.length;

    const baselineAverage =
        baselineRanges.reduce((sum, value) => sum + value, 0) /
        baselineRanges.length;

    const volatilityRatio =
        baselineAverage === 0
            ? recentAverage === 0
                ? 1
                : Number.POSITIVE_INFINITY
            : recentAverage / baselineAverage;

    const direction: RegimeDirection =
        efficiencyRatio >= TRENDING_THRESHOLD
            ? netMovement > 0
                ? "Bullish"
                : netMovement < 0
                    ? "Bearish"
                    : "Neutral"
            : "Neutral";

    const reasons: string[] = [];

    reasons.push(
        `Directional efficiency over ${EFFICIENCY_LOOKBACK} candles: ${efficiencyRatio.toFixed(2)}.`,
    );

    reasons.push(
        `Recent average true range is ${Number.isFinite(volatilityRatio) ? `${volatilityRatio.toFixed(2)}x` : "higher than"} the preceding baseline.`,
    );

    if (volatilityRatio >= HIGH_VOLATILITY_THRESHOLD) {
        reasons.push(
            "Recent volatility is elevated relative to its recent baseline.",
        );

        return {
            version: MARKET_REGIME_VERSION,
            regime: "High volatility",
            direction,
            confidence: "Moderate",
            actionable: false,
            summary:
                "Volatility has expanded sharply. Require additional risk and entry confirmation before considering a trade.",
            efficiencyRatio,
            volatilityRatio,
            reasons,
            latestCandleAt: latest.time,
        };
    }

    if (efficiencyRatio >= TRENDING_THRESHOLD) {
        reasons.push(
            "Price movement is directionally efficient enough to qualify as trending under the current rule.",
        );

        return {
            version: MARKET_REGIME_VERSION,
            regime: "Trending",
            direction,
            confidence:
                efficiencyRatio >= 0.6 ? "High" : "Moderate",
            actionable: true,
            summary:
                `A ${direction.toLowerCase()} trend-like regime is detected. Other signal and risk checks are still required.`,
            efficiencyRatio,
            volatilityRatio,
            reasons,
            latestCandleAt: latest.time,
        };
    }

    if (efficiencyRatio <= RANGING_THRESHOLD) {
        reasons.push(
            "Price has made limited net progress relative to its total movement.",
        );

        return {
            version: MARKET_REGIME_VERSION,
            regime: "Ranging",
            direction: "Neutral",
            confidence: "Moderate",
            actionable: false,
            summary:
                "Price is moving without a sufficiently strong directional trend. Trend-following setups need extra confirmation.",
            efficiencyRatio,
            volatilityRatio,
            reasons,
            latestCandleAt: latest.time,
        };
    }

    reasons.push(
        "Directional efficiency is between the trending and ranging thresholds.",
    );

    return {
        version: MARKET_REGIME_VERSION,
        regime: "Unclear",
        direction: "Neutral",
        confidence: "Low",
        actionable: false,
        summary:
            "Market conditions are mixed. Wait for a clearer regime before relying on a trend-following setup.",
        efficiencyRatio,
        volatilityRatio,
        reasons,
        latestCandleAt: latest.time,
    };
}
