
import type { MarketRegimeAnalysis } from "./market-regime";
import type { IndicatorCandle, TechnicalIndicators } from "./indicators";
import type { TrendAnalysis } from "./trend-analysis";
import type { PriceActionAnalysis } from "./price-action";

export const SIGNAL_ENGINE_VERSION = "1.0.0" as const;

export type SignalDirection = "BUY" | "SELL" | "WAIT";

export type SignalQuality = "High" | "Moderate" | "Low" | "Unavailable";

export type SignalReason = {
    code: string;
    message: string;
    passed: boolean;
};

export type RiskPlan = {
    entry: number;
    stopLoss: number;
    takeProfit: number;
    riskPerUnit: number;
    rewardPerUnit: number;
    riskRewardRatio: number;
    riskPercent: number;
};

export type SignalAnalysisInput = {
    symbol: string;
    interval: string;
    candles: IndicatorCandle[];
    indicators: TechnicalIndicators;
    trend: TrendAnalysis;
    isFresh: boolean;
    candleAgeSeconds: number | null;
    analyzedAt?: string;
    accountBalance?: number;
    riskPercent?: number;
    regime?: MarketRegimeAnalysis;
    priceAction?: PriceActionAnalysis;
};

export type SignalAnalysis = {
    engineVersion: typeof SIGNAL_ENGINE_VERSION;
    symbol: string;
    interval: string;
    direction: SignalDirection;
    quality: SignalQuality;
    actionable: boolean;
    summary: string;
    reasons: SignalReason[];
    riskPlan: RiskPlan | null;
    invalidation: string[];
    latestCandleAt: string | null;
    candleAgeSeconds: number | null;
    analyzedAt: string;
};

const MINIMUM_CANDLES = 200;
const MIN_RISK_REWARD_RATIO = 1.5;
const DEFAULT_RISK_PERCENT = 1;
const MAX_RISK_PERCENT = 5;

type CandidateDirection = "Bullish" | "Bearish";

type RegimeGateResult = {
    allowed: boolean;
    code: string;
    message: string;
};

function waitResult(
    input: SignalAnalysisInput,
    summary: string,
    reasons: SignalReason[],
    quality: SignalQuality = "Unavailable",
): SignalAnalysis {
    const lastCandle = input.candles.at(-1);

    return {
        engineVersion: SIGNAL_ENGINE_VERSION,
        symbol: input.symbol,
        interval: input.interval,
        direction: "WAIT",
        quality,
        actionable: false,
        summary,
        reasons,
        riskPlan: null,
        invalidation: [
            "Reassess after receiving valid, sufficiently recent market data.",
            "Re-evaluate the setup when the indicator conditions change.",
        ],
        latestCandleAt: lastCandle?.time ?? null,
        candleAgeSeconds: input.candleAgeSeconds,
        analyzedAt: input.analyzedAt ?? new Date().toISOString(),
    };
}

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

function validateRegimeForCandidate(
    regime: MarketRegimeAnalysis,
    latestCandle: IndicatorCandle,
    candidateDirection: CandidateDirection,
): RegimeGateResult {
    const regimeCandleTime =
        typeof regime.latestCandleAt === "string"
            ? Date.parse(regime.latestCandleAt)
            : Number.NaN;

    const signalCandleTime = Date.parse(latestCandle.time);

    if (
        !Number.isFinite(regimeCandleTime) ||
        !Number.isFinite(signalCandleTime) ||
        regimeCandleTime !== signalCandleTime
    ) {
        return {
            allowed: false,
            code: "MARKET_REGIME_STALE_OR_MISMATCHED",
            message:
                "Market-regime analysis does not match the latest signal candle. Recalculate the regime before evaluating a trade.",
        };
    }

    if (
        !["Trending", "Ranging", "High volatility", "Unclear"].includes(
            regime.regime,
        ) ||
        !["Bullish", "Bearish", "Neutral"].includes(regime.direction) ||
        !["High", "Moderate", "Low", "Unavailable"].includes(
            regime.confidence,
        ) ||
        typeof regime.actionable !== "boolean" ||
        typeof regime.summary !== "string" ||
        !Array.isArray(regime.reasons)
    ) {
        return {
            allowed: false,
            code: "MARKET_REGIME_INVALID",
            message:
                "Market-regime analysis is malformed or incomplete. A valid analysis is required.",
        };
    }

    if (
        regime.confidence === "Unavailable" ||
        regime.confidence === "Low" ||
        regime.regime === "Unclear"
    ) {
        return {
            allowed: false,
            code: "MARKET_REGIME_GATE",
            message:
                "Market-regime confidence is insufficient. Wait for clearer market conditions.",
        };
    }

    if (
        regime.regime === "Trending" &&
        (
            regime.efficiencyRatio === null ||
            !Number.isFinite(regime.efficiencyRatio) ||
            regime.efficiencyRatio < 0 ||
            regime.efficiencyRatio > 1 ||
            regime.volatilityRatio === null ||
            !Number.isFinite(regime.volatilityRatio) ||
            regime.volatilityRatio < 0
        )
    ) {
        return {
            allowed: false,
            code: "MARKET_REGIME_METRICS_INVALID",
            message:
                "Trending regime metrics are invalid. Recalculate the market regime before considering a trade.",
        };
    }

    if (regime.regime !== "Trending") {
        return {
            allowed: false,
            code: "MARKET_REGIME_GATE",
            message:
                `Market regime is ${regime.regime}; trend-following signals are blocked.`,
        };
    }

    if (!regime.actionable) {
        return {
            allowed: false,
            code: "MARKET_REGIME_NOT_ACTIONABLE",
            message:
                "Market regime is not actionable. Wait for the regime detector to confirm suitable conditions.",
        };
    }

    if (
        regime.direction !== "Bullish" &&
        regime.direction !== "Bearish"
    ) {
        return {
            allowed: false,
            code: "MARKET_REGIME_NEUTRAL",
            message:
                "Market-regime direction is neutral and cannot confirm a directional trade.",
        };
    }

    if (regime.direction !== candidateDirection) {
        return {
            allowed: false,
            code: "MARKET_REGIME_GATE",
            message:
                `Market-regime direction (${regime.direction}) conflicts with the ${candidateDirection} candidate.`,
        };
    }

    return {
        allowed: true,
        code: "MARKET_REGIME_CONFIRMATION",
        message:
            `Market regime is Trending and confirms ${candidateDirection.toLowerCase()} direction.`,
    };
}

function createRiskPlan(
    direction: Exclude<SignalDirection, "WAIT">,
    entry: number,
    atr: number,
    riskPercent: number,
): RiskPlan | null {
    if (
        !Number.isFinite(entry) ||
        !Number.isFinite(atr) ||
        entry <= 0 ||
        atr <= 0 ||
        !Number.isFinite(riskPercent) ||
        riskPercent <= 0 ||
        riskPercent > MAX_RISK_PERCENT
    ) {
        return null;
    }

    // ATR-based estimates, not guaranteed execution prices.
    const stopDistance = atr * 1.5;
    const rewardDistance = atr * 2.5;

    const stopLoss =
        direction === "BUY"
            ? entry - stopDistance
            : entry + stopDistance;

    const takeProfit =
        direction === "BUY"
            ? entry + rewardDistance
            : entry - rewardDistance;

    if (
        !Number.isFinite(stopLoss) ||
        !Number.isFinite(takeProfit) ||
        stopLoss <= 0 ||
        takeProfit <= 0
    ) {
        return null;
    }

    const riskPerUnit = Math.abs(entry - stopLoss);
    const rewardPerUnit = Math.abs(takeProfit - entry);

    const riskRewardRatio = rewardPerUnit / riskPerUnit;

    if (
        !Number.isFinite(riskPerUnit) ||
        !Number.isFinite(rewardPerUnit) ||
        !Number.isFinite(riskRewardRatio) ||
        riskPerUnit <= 0 ||
        rewardPerUnit <= 0
    ) {
        return null;
    }

    return {
        entry,
        stopLoss,
        takeProfit,
        riskPerUnit,
        rewardPerUnit,
        riskRewardRatio,
        riskPercent,
    };
}

function confirmPriceAction(
    priceAction: PriceActionAnalysis,
    candidateDirection: CandidateDirection,
): {
    confirmed: boolean;
    reasons: SignalReason[];
    summary: string;
} {
    if (priceAction.status !== "Available") {
        return {
            confirmed: false,
            summary: "Price-action analysis is unavailable.",
            reasons: [
                {
                    code: "PRICE_ACTION_UNAVAILABLE",
                    message:
                        priceAction.reasons.join(" ") ||
                        "Valid price-action analysis is required.",
                    passed: false,
                },
            ],
        };
    }

    const expectedBullish = candidateDirection === "Bullish";

    const matchingEventTypes = expectedBullish
        ? ["BULLISH_BOS", "BULLISH_LIQUIDITY_SWEEP"]
        : ["BEARISH_BOS", "BEARISH_LIQUIDITY_SWEEP"];

    const opposingEventTypes = expectedBullish
        ? ["BEARISH_BOS", "BEARISH_LIQUIDITY_SWEEP"]
        : ["BULLISH_BOS", "BULLISH_LIQUIDITY_SWEEP"];

    const matchingEvents = priceAction.events.filter((event) =>
        matchingEventTypes.includes(event.type),
    );

    const opposingEvents = priceAction.events.filter((event) =>
        opposingEventTypes.includes(event.type),
    );

    const oppositeDirection: CandidateDirection =
        expectedBullish ? "Bearish" : "Bullish";

    const structureConflicts =
        priceAction.direction === oppositeDirection;

    const hasOpposingEvents = opposingEvents.length > 0;

    const structureConfirms =
        priceAction.direction === candidateDirection;

    const eventConfirms = matchingEvents.length > 0;

    const confirmed =
        !structureConflicts &&
        !hasOpposingEvents &&
        (structureConfirms || eventConfirms);

    const reasons: SignalReason[] = [
        {
            code: "PRICE_ACTION_CONFIRMATION",
            message: structureConfirms
                ? `Price-action structure confirms the ${candidateDirection.toLowerCase()} candidate.`
                : eventConfirms
                    ? `A matching price-action event supports the ${candidateDirection.toLowerCase()} candidate.`
                    : structureConflicts
                        ? `Price-action structure conflicts with the ${candidateDirection.toLowerCase()} candidate.`
                        : hasOpposingEvents
                            ? `An opposing price-action event conflicts with the ${candidateDirection.toLowerCase()} candidate.`
                            : "Price action does not provide sufficient directional confirmation.",
            passed: confirmed,
        },
    ];

    for (const event of priceAction.events) {
        const isMatching = matchingEventTypes.includes(event.type);
        const isOpposing = opposingEventTypes.includes(event.type);

        reasons.push({
            code: `PRICE_ACTION_${event.type}`,
            message: event.description,
            passed: isMatching && !isOpposing,
        });
    }

    return {
        confirmed,
        summary: confirmed
            ? `Price action confirms the ${candidateDirection.toLowerCase()} candidate.`
            : `Price action does not confirm the ${candidateDirection.toLowerCase()} candidate.`,
        reasons,
    };
}

export function analyzeSignal(
    input: SignalAnalysisInput,
): SignalAnalysis {
    const { candles, indicators, trend } = input;
    const latest = candles.at(-1);

    if (
        !input.isFresh ||
        input.candleAgeSeconds === null ||
        !Number.isFinite(input.candleAgeSeconds) ||
        input.candleAgeSeconds < 0
    ) {
        return waitResult(
            input,
            "No signal: market-data freshness is not verified.",
            [
                {
                    code: "STALE_OR_UNVERIFIED_DATA",
                    message: "Directional signals require verified fresh candles.",
                    passed: false,
                },
            ],
        );
    }

    if (
        candles.length < MINIMUM_CANDLES ||
        !candles.every(validCandle) ||
        candles.some(
            (candle, index) =>
                index > 0 &&
                Date.parse(candle.time) <=
                    Date.parse(candles[index - 1]!.time),
        )
    ) {
        return waitResult(
            input,
            `No signal: at least ${MINIMUM_CANDLES} valid, chronological candles are required.`,
            [
                {
                    code: "INVALID_OR_INSUFFICIENT_HISTORY",
                    message: "Candle history is incomplete or invalid.",
                    passed: false,
                },
            ],
        );
    }

    if (!latest) {
        return waitResult(
            input,
            "No signal: latest candle is unavailable.",
            [],
        );
    }

    const { ema50, ema200, rsi14, atr14 } = indicators;

    if (
        ema50 === null ||
        ema200 === null ||
        rsi14 === null ||
        atr14 === null ||
        ![ema50, ema200, rsi14, atr14].every(Number.isFinite) ||
        ema50 <= 0 ||
        ema200 <= 0 ||
        rsi14 < 0 ||
        rsi14 > 100 ||
        atr14 <= 0
    ) {
        return waitResult(
            input,
            "No signal: one or more technical indicators are unavailable or invalid.",
            [
                {
                    code: "INVALID_INDICATORS",
                    message:
                        "Valid EMA 50, EMA 200, RSI 14 and ATR 14 are required.",
                    passed: false,
                },
            ],
        );
    }

    const bullishChecks: SignalReason[] = [
        {
            code: "EMA_TREND",
            message: "EMA 50 is above EMA 200.",
            passed: ema50 > ema200,
        },
        {
            code: "PRICE_TREND",
            message: "Price is above EMA 50.",
            passed: latest.close > ema50,
        },
        {
            code: "RSI_MOMENTUM",
            message: "RSI is between 50 and 70.",
            passed: rsi14 > 50 && rsi14 < 70,
        },
        {
            code: "TREND_CONFIRMATION",
            message: "The trend engine confirms a bullish trend.",
            passed: trend.direction === "Bullish",
        },
    ];

    const bearishChecks: SignalReason[] = [
        {
            code: "EMA_TREND",
            message: "EMA 50 is below EMA 200.",
            passed: ema50 < ema200,
        },
        {
            code: "PRICE_TREND",
            message: "Price is below EMA 50.",
            passed: latest.close < ema50,
        },
        {
            code: "RSI_MOMENTUM",
            message: "RSI is between 30 and 50.",
            passed: rsi14 > 30 && rsi14 < 50,
        },
        {
            code: "TREND_CONFIRMATION",
            message: "The trend engine confirms a bearish trend.",
            passed: trend.direction === "Bearish",
        },
    ];

    const bullish = bullishChecks.every((check) => check.passed);
    const bearish = bearishChecks.every((check) => check.passed);

    const candidateDirection: CandidateDirection | null = bullish
        ? "Bullish"
        : bearish
            ? "Bearish"
            : null;

    if (!bullish && !bearish) {
        const checks = [
            ...bullishChecks.map((check) => ({
                ...check,
                message: `BUY condition: ${check.message}`,
            })),
            ...bearishChecks.map((check) => ({
                ...check,
                message: `SELL condition: ${check.message}`,
            })),
        ];

        return waitResult(
            input,
            "No complete setup. Wait for trend, price and momentum conditions to align.",
            checks,
            "Moderate",
        );
    }

    if (input.regime && candidateDirection) {
        const regimeCheck = validateRegimeForCandidate(
            input.regime,
            latest,
            candidateDirection,
        );

        if (!regimeCheck.allowed) {
            return waitResult(
                input,
                `No signal: ${regimeCheck.message}`,
                [
                    {
                        code: regimeCheck.code,
                        message: regimeCheck.message,
                        passed: false,
                    },
                ],
                "Moderate",
            );
        }
    }

    const direction: Exclude<SignalDirection, "WAIT"> =
        bullish ? "BUY" : "SELL";

    const confirmedDirection: CandidateDirection =
        direction === "BUY" ? "Bullish" : "Bearish";

    let priceActionReasons: SignalReason[] = [];

    if (input.priceAction) {
        const priceActionConfirmation = confirmPriceAction(
            input.priceAction,
            confirmedDirection,
        );

        priceActionReasons = priceActionConfirmation.reasons;

        if (!priceActionConfirmation.confirmed) {
            return waitResult(
                input,
                `No signal: ${priceActionConfirmation.summary}`,
                priceActionReasons,
                "Moderate",
            );
        }
    }

    const matchedChecks: SignalReason[] = [
        ...(bullish ? bullishChecks : bearishChecks),
    ];

    if (input.regime) {
        matchedChecks.push({
            code: "MARKET_REGIME_CONFIRMATION",
            message:
                `Market regime is Trending and confirms ${confirmedDirection.toLowerCase()} direction.`,
            passed: true,
        });
    }

    matchedChecks.push(...priceActionReasons);

    const riskPercent = input.riskPercent ?? DEFAULT_RISK_PERCENT;

    if (
        !Number.isFinite(riskPercent) ||
        riskPercent <= 0 ||
        riskPercent > MAX_RISK_PERCENT
    ) {
        return waitResult(
            input,
            "No signal: risk percentage must be greater than 0 and no more than 5%.",
            [
                {
                    code: "INVALID_RISK_PERCENT",
                    message: "Risk input is outside the permitted range.",
                    passed: false,
                },
            ],
        );
    }

    const riskPlan = createRiskPlan(
        direction,
        latest.close,
        atr14,
        riskPercent,
    );

    if (!riskPlan || riskPlan.riskRewardRatio < MIN_RISK_REWARD_RATIO) {
        return waitResult(
            input,
            "No signal: a valid risk plan could not be calculated.",
            [
                {
                    code: "INVALID_RISK_PLAN",
                    message:
                        "The proposed stop and target do not meet risk constraints.",
                    passed: false,
                },
            ],
        );
    }

    const accountBalance = input.accountBalance;

    const balanceValid =
        accountBalance === undefined ||
        (Number.isFinite(accountBalance) && accountBalance > 0);

    if (!balanceValid) {
        return waitResult(
            input,
            "No signal: the optional account balance is invalid.",
            [
                {
                    code: "INVALID_ACCOUNT_BALANCE",
                    message: "Provide a positive account balance or omit it.",
                    passed: false,
                },
            ],
        );
    }

    const priceActionSummary = input.priceAction
        ? " Price-action confirmation passed."
        : "";

    return {
        engineVersion: SIGNAL_ENGINE_VERSION,
        symbol: input.symbol,
        interval: input.interval,
        direction,
        quality: "High",
        actionable: true,
        summary:
            `${direction} candidate: trend, price and momentum conditions align.` +
            priceActionSummary +
            " This is a rule-based research result, not a prediction or guarantee.",
        reasons: matchedChecks,
        riskPlan,
        invalidation: [
            "Reassess if EMA 50 and EMA 200 no longer support the direction.",
            "Reassess if price closes across EMA 50 against the setup.",
            ...(input.priceAction
                ? [
                    "Reassess if subsequent price action contradicts the confirmed structure or event.",
                ]
                : []),
            ...(input.regime
                ? [
                    "Reassess if the market regime changes, becomes non-actionable, or conflicts with the trade direction.",
                ]
                : []),
            "The estimated stop-loss is a risk reference, not a guaranteed fill price.",
        ],
        latestCandleAt: latest.time,
        candleAgeSeconds: input.candleAgeSeconds,
        analyzedAt: input.analyzedAt ?? new Date().toISOString(),
    };
}
 