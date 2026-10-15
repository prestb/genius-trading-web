
import type { IndicatorCandle } from "./indicators";

export const PRICE_ACTION_VERSION = "1.0.0" as const;

export type PriceActionDirection =
    | "Bullish"
    | "Bearish"
    | "Mixed"
    | "Unclear";

export type PriceActionEventType =
    | "BULLISH_BOS"
    | "BEARISH_BOS"
    | "BULLISH_LIQUIDITY_SWEEP"
    | "BEARISH_LIQUIDITY_SWEEP";

export type PriceActionEvent = {
    type: PriceActionEventType;
    level: number;
    candleTime: string;
    description: string;
};

export type PriceActionInput = {
    candles: IndicatorCandle[];
    pivotStrength?: number;
};

export type PriceActionAnalysis = {
    version: typeof PRICE_ACTION_VERSION;
    status: "Available" | "Unavailable";
    direction: PriceActionDirection;
    actionable: boolean;
    summary: string;
    support: number | null;
    resistance: number | null;
    latestSwingHigh: number | null;
    latestSwingLow: number | null;
    events: PriceActionEvent[];
    reasons: string[];
    latestCandleAt: string | null;
};

type SwingPoint = {
    index: number;
    price: number;
    time: string;
};

const DEFAULT_PIVOT_STRENGTH = 2;
const MAX_PIVOT_STRENGTH = 10;
const MINIMUM_CANDLES = 20;

function validCandle(candle: IndicatorCandle): boolean {
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

function findSwingHighs(
    candles: IndicatorCandle[],
    strength: number,
): SwingPoint[] {
    const points: SwingPoint[] = [];

    for (
        let index = strength;
        index < candles.length - strength;
        index += 1
    ) {
        const candidate = candles[index];

        if (!candidate) {
            continue;
        }

        let isSwingHigh = true;

        for (let offset = 1; offset <= strength; offset += 1) {
            const left = candles[index - offset];
            const right = candles[index + offset];

            if (
                !left ||
                !right ||
                candidate.high <= left.high ||
                candidate.high <= right.high
            ) {
                isSwingHigh = false;
                break;
            }
        }

        if (isSwingHigh) {
            points.push({
                index,
                price: candidate.high,
                time: candidate.time,
            });
        }
    }

    return points;
}

function findSwingLows(
    candles: IndicatorCandle[],
    strength: number,
): SwingPoint[] {
    const points: SwingPoint[] = [];

    for (
        let index = strength;
        index < candles.length - strength;
        index += 1
    ) {
        const candidate = candles[index];

        if (!candidate) {
            continue;
        }

        let isSwingLow = true;

        for (let offset = 1; offset <= strength; offset += 1) {
            const left = candles[index - offset];
            const right = candles[index + offset];

            if (
                !left ||
                !right ||
                candidate.low >= left.low ||
                candidate.low >= right.low
            ) {
                isSwingLow = false;
                break;
            }
        }

        if (isSwingLow) {
            points.push({
                index,
                price: candidate.low,
                time: candidate.time,
            });
        }
    }

    return points;
}

function unavailableResult(
    candles: IndicatorCandle[],
    reason: string,
): PriceActionAnalysis {
    return {
        version: PRICE_ACTION_VERSION,
        status: "Unavailable",
        direction: "Unclear",
        actionable: false,
        summary: "Price-action analysis is unavailable.",
        support: null,
        resistance: null,
        latestSwingHigh: null,
        latestSwingLow: null,
        events: [],
        reasons: [reason],
        latestCandleAt: candles.at(-1)?.time ?? null,
    };
}

export function analyzePriceAction(
    input: PriceActionInput,
): PriceActionAnalysis {
    const { candles } = input;
    const strength = input.pivotStrength ?? DEFAULT_PIVOT_STRENGTH;

    if (
        !Number.isInteger(strength) ||
        strength < 1 ||
        strength > MAX_PIVOT_STRENGTH
    ) {
        return unavailableResult(
            candles,
            "Pivot strength must be an integer between 1 and 10.",
        );
    }

    if (
        candles.length < MINIMUM_CANDLES ||
        !candles.every(validCandle) ||
        candles.some((candle, index) =>
            index > 0 &&
            Date.parse(candle.time) <=
            Date.parse(candles[index - 1]!.time),
        )
    ) {
        return unavailableResult(
            candles,
            `At least ${MINIMUM_CANDLES} valid, chronological candles are required.`,
        );
    }

    const latest = candles.at(-1);
    const previous = candles.at(-2);

    if (!latest || !previous) {
        return unavailableResult(
            candles,
            "The latest candle or previous candle is unavailable.",
        );
    }

    const swingHighs = findSwingHighs(candles, strength);
    const swingLows = findSwingLows(candles, strength);

    // Use only levels that existed before the latest candle.
    // This prevents the latest candle from defining the level it breaks.
    const priorSwingHighs = swingHighs.filter(
        (point) => point.index < candles.length - 1,
    );
    const priorSwingLows = swingLows.filter(
        (point) => point.index < candles.length - 1,
    );

    const latestHigh = priorSwingHighs.at(-1) ?? null;
    const latestLow = priorSwingLows.at(-1) ?? null;

    const events: PriceActionEvent[] = [];

    if (
        latestHigh &&
        previous.close <= latestHigh.price &&
        latest.close > latestHigh.price
    ) {
        events.push({
            type: "BULLISH_BOS",
            level: latestHigh.price,
            candleTime: latest.time,
            description:
                "Price closed above a previously confirmed swing high, indicating a potential bullish break of structure.",
        });
    }

    if (
        latestLow &&
        previous.close >= latestLow.price &&
        latest.close < latestLow.price
    ) {
        events.push({
            type: "BEARISH_BOS",
            level: latestLow.price,
            candleTime: latest.time,
            description:
                "Price closed below a previously confirmed swing low, indicating a potential bearish break of structure.",
        });
    }

    if (
        latestHigh &&
        latest.high > latestHigh.price &&
        latest.close < latestHigh.price
    ) {
        events.push({
            type: "BEARISH_LIQUIDITY_SWEEP",
            level: latestHigh.price,
            candleTime: latest.time,
            description:
                "Price traded above a previous swing high but closed back below it, consistent with a potential buy-side liquidity sweep.",
        });
    }

    if (
        latestLow &&
        latest.low < latestLow.price &&
        latest.close > latestLow.price
    ) {
        events.push({
            type: "BULLISH_LIQUIDITY_SWEEP",
            level: latestLow.price,
            candleTime: latest.time,
            description:
                "Price traded below a previous swing low but closed back above it, consistent with a potential sell-side liquidity sweep.",
        });
    }

    const recentHighs = priorSwingHighs.slice(-2);
    const recentLows = priorSwingLows.slice(-2);

    const higherHighs =
        recentHighs.length === 2 &&
        recentHighs[1]!.price > recentHighs[0]!.price;

    const lowerHighs =
        recentHighs.length === 2 &&
        recentHighs[1]!.price < recentHighs[0]!.price;

    const higherLows =
        recentLows.length === 2 &&
        recentLows[1]!.price > recentLows[0]!.price;

    const lowerLows =
        recentLows.length === 2 &&
        recentLows[1]!.price < recentLows[0]!.price;

    let direction: PriceActionDirection = "Unclear";

    if (higherHighs && higherLows) {
        direction = "Bullish";
    } else if (lowerHighs && lowerLows) {
        direction = "Bearish";
    } else if (
        (higherHighs && lowerLows) ||
        (lowerHighs && higherLows)
    ) {
        direction = "Mixed";
    }

    const reasons: string[] = [];

    if (latestHigh) {
        reasons.push(
            `Latest confirmed swing-high resistance: ${latestHigh.price}.`,
        );
    } else {
        reasons.push("No confirmed swing-high resistance was found.");
    }

    if (latestLow) {
        reasons.push(
            `Latest confirmed swing-low support: ${latestLow.price}.`,
        );
    } else {
        reasons.push("No confirmed swing-low support was found.");
    }

    if (events.length === 0) {
        reasons.push(
            "The latest candle did not confirm a swing break or liquidity sweep.",
        );
    } else {
        reasons.push(
            "A detected price event is evidence for review, not a standalone trading signal.",
        );
    }

    const summary =
        direction === "Bullish"
            ? "Recent swing structure shows higher highs and higher lows."
            : direction === "Bearish"
                ? "Recent swing structure shows lower highs and lower lows."
                : direction === "Mixed"
                    ? "Recent swing structure is mixed."
                    : "There is not enough consistent swing structure to determine direction.";

    return {
        version: PRICE_ACTION_VERSION,
        status: "Available",
        direction,
        actionable: false,
        summary,
        support: latestLow?.price ?? null,
        resistance: latestHigh?.price ?? null,
        latestSwingHigh: latestHigh?.price ?? null,
        latestSwingLow: latestLow?.price ?? null,
        events,
        reasons,
        latestCandleAt: latest.time,
    };
}
