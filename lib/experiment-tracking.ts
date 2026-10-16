import type { BacktestResult } from "./backtesting";

export const EXPERIMENT_STORAGE_KEY = "genius-trading-web-experiments-v1";
export const MAX_SAVED_EXPERIMENTS = 25;

export type ExperimentSnapshot = {
  id: string;
  savedAt: string;
  schemaVersion: 1;
  engineVersion: string;
  symbol: string;
  interval: string;
  status: BacktestResult["status"];
  config: BacktestResult["config"];
  requestedPeriod: { startDate: string | null; endDate: string | null };
  actualDataWindow: {
    firstCandleAt: string | null;
    lastCandleAt: string | null;
    candlesInRange: number;
    candlesAnalyzed: number;
  };
  validationIncluded: boolean;
  summary: BacktestResult["summary"];
};

export function createExperimentSnapshot(
  result: BacktestResult & { validation?: unknown },
  id: string,
  savedAt: string,
): ExperimentSnapshot {
  return {
    id,
    savedAt,
    schemaVersion: 1,
    engineVersion: result.engineVersion,
    symbol: result.symbol,
    interval: result.interval,
    status: result.status,
    config: { ...result.config },
    requestedPeriod: {
      startDate: result.period.startDate,
      endDate: result.period.endDate,
    },
    actualDataWindow: {
      firstCandleAt: result.period.firstCandleAt,
      lastCandleAt: result.period.lastCandleAt,
      candlesInRange: result.period.candlesInRange,
      candlesAnalyzed: result.summary.candlesAnalyzed,
    },
    validationIncluded: Boolean(result.validation),
    summary: { ...result.summary },
  };
}

export function addExperiment(
  experiments: ExperimentSnapshot[],
  experiment: ExperimentSnapshot,
  limit = MAX_SAVED_EXPERIMENTS,
): ExperimentSnapshot[] {
  const deduplicated = experiments.filter((item) => item.id !== experiment.id);
  return [experiment, ...deduplicated].slice(0, Math.max(1, limit));
}

export function exportExperimentJson(experiment: ExperimentSnapshot): string {
  return JSON.stringify(experiment, null, 2);
}
