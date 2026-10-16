import type { BacktestEquityPoint, BacktestResult } from "./backtesting";

export const PORTFOLIO_ANALYSIS_VERSION = "1.0.0" as const;

export type PortfolioComponent = {
  id: string;
  result: Pick<BacktestResult, "symbol" | "interval" | "status" | "config" | "summary" | "equityCurve" | "period">;
};

export type PortfolioAnalysis = {
  version: typeof PORTFOLIO_ANALYSIS_VERSION;
  components: number;
  initialCapital: number;
  finalEquity: number;
  netPnl: number;
  returnPercent: number;
  maxDrawdownPercent: number;
  equityCurve: BacktestEquityPoint[];
  correlations: { left: string; right: string; correlation: number | null; observations: number }[];
  warnings: string[];
};

function correlation(a: number[], b: number[]): number | null {
  if (a.length < 3 || a.length !== b.length) return null;
  const meanA = a.reduce((sum, value) => sum + value, 0) / a.length;
  const meanB = b.reduce((sum, value) => sum + value, 0) / b.length;
  const numerator = a.reduce((sum, value, index) => sum + (value - meanA) * (b[index]! - meanB), 0);
  const denominatorA = Math.sqrt(a.reduce((sum, value) => sum + (value - meanA) ** 2, 0));
  const denominatorB = Math.sqrt(b.reduce((sum, value) => sum + (value - meanB) ** 2, 0));
  return denominatorA > 0 && denominatorB > 0 ? numerator / (denominatorA * denominatorB) : null;
}

function cleanCurve(curve: BacktestEquityPoint[]): BacktestEquityPoint[] {
  const sorted = [...curve].filter((point) => Number.isFinite(Date.parse(point.time)) && Number.isFinite(point.equity) && point.equity >= 0)
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  const deduped = new Map<string, BacktestEquityPoint>();
  for (const point of sorted) deduped.set(point.time, point);
  return [...deduped.values()];
}

/** Combines equity curves by timestamp. Each component contributes its own configured starting balance. */
export function analyzePortfolio(components: PortfolioComponent[]): PortfolioAnalysis {
  const valid = components.filter((component) => component.result.status === "completed" && component.result.config.initialBalance > 0);
  const initialCapital = valid.reduce((sum, component) => sum + component.result.config.initialBalance, 0);
  const curves = valid.map((component) => ({
    label: `${component.result.symbol} (${component.result.interval})`,
    initial: component.result.config.initialBalance,
    points: cleanCurve(component.result.equityCurve),
  }));
  const timestamps = [...new Set(curves.flatMap((curve) => curve.points.map((point) => point.time)))].sort((a, b) => Date.parse(a) - Date.parse(b));
  const equityCurve: BacktestEquityPoint[] = [];
  const latest = curves.map(() => 0);
  for (const time of timestamps) {
    let total = 0;
    curves.forEach((curve, index) => {
      while (latest[index]! < curve.points.length && Date.parse(curve.points[latest[index]!]!.time) <= Date.parse(time)) latest[index]! += 1;
      const point = latest[index]! > 0 ? curve.points[latest[index]! - 1] : null;
      total += point ? point.equity : curve.initial;
    });
    equityCurve.push({ time, equity: total });
  }
  const finalEquity = equityCurve.at(-1)?.equity ?? initialCapital;
  let peak = initialCapital;
  let maxDrawdownPercent = 0;
  for (const point of equityCurve) {
    peak = Math.max(peak, point.equity);
    if (peak > 0) maxDrawdownPercent = Math.max(maxDrawdownPercent, (peak - point.equity) / peak * 100);
  }
  const returnsByComponent = curves.map((curve) => {
    const byTime = new Map(curve.points.map((point) => [point.time, point.equity]));
    const points = [...byTime.entries()].sort((a, b) => Date.parse(a[0]) - Date.parse(b[0]));
    return { label: curve.label, returns: new Map(points.slice(1).map(([time, value], index) => [time, points[index]![1] > 0 ? value / points[index]![1] - 1 : 0])) };
  });
  const correlations: PortfolioAnalysis["correlations"] = [];
  for (let i = 0; i < returnsByComponent.length; i += 1) {
    for (let j = i + 1; j < returnsByComponent.length; j += 1) {
      const left = returnsByComponent[i]!;
      const right = returnsByComponent[j]!;
      const common = [...left.returns.keys()].filter((time) => right.returns.has(time)).sort((a, b) => Date.parse(a) - Date.parse(b));
      correlations.push({ left: left.label, right: right.label, correlation: correlation(common.map((time) => left.returns.get(time)!), common.map((time) => right.returns.get(time)!)), observations: common.length });
    }
  }
  const warnings: string[] = [];
  if (components.length !== valid.length) warnings.push("Some components were excluded because their backtest was incomplete or had an invalid starting balance.");
  if (valid.length < 2) warnings.push("Add at least two completed backtests to assess a multi-component portfolio.");
  if (curves.some((curve) => curve.points.length < 2)) warnings.push("At least one component has fewer than two equity points; portfolio drawdown and return may be incomplete.");
  if (valid.some((component) => component.result.interval !== valid[0]?.result.interval)) warnings.push("Components use different timeframes. Forward-filled equity is an approximate alignment, not a synchronized execution simulation.");
  if (correlations.some((item) => item.correlation === null)) warnings.push("Correlation requires at least three shared return observations with non-zero variation; unavailable values are shown as —.");
  warnings.push("Portfolio components are summed using each run's configured starting balance. This assumes independent capital allocations; it does not simulate shared margin, leverage, order timing, financing, or cross-instrument currency conversion.");
  return {
    version: PORTFOLIO_ANALYSIS_VERSION,
    components: valid.length,
    initialCapital,
    finalEquity,
    netPnl: finalEquity - initialCapital,
    returnPercent: initialCapital > 0 ? (finalEquity / initialCapital - 1) * 100 : 0,
    maxDrawdownPercent,
    equityCurve,
    correlations,
    warnings,
  };
}
