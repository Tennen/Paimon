import { FundFeatureContext, FundRawContext } from "./fund_types";

export function buildFundFeatureContext(raw: FundRawContext): FundFeatureContext {
  const series = raw.price_or_nav_series;
  const benchmark = raw.benchmark_series;
  const values = series.map((item) => item.value).filter((value) => Number.isFinite(value) && value > 0);
  const benchmarkValues = benchmark.map((item) => item.value).filter((value) => Number.isFinite(value) && value > 0);

  const ret1d = calculateWindowReturn(values, 1);
  const ret5d = calculateWindowReturn(values, 5);
  const ret20d = calculateWindowReturn(values, 20);
  const ret60d = calculateWindowReturn(values, 60);
  const ret120d = calculateWindowReturn(values, 120);

  const dailyReturns = buildDailyReturns(values);

  const volatility = dailyReturns.length >= 20
    ? round(sampleStdDev(dailyReturns) * Math.sqrt(252) * 100, 4)
    : "not_supported";

  const maxDrawdown = values.length >= 2
    ? round(calculateMaxDrawdown(values), 4)
    : "not_supported";

  const drawdownRecoveryDays = values.length >= 10
    ? calculateRecoveryDays(values)
    : "not_supported";

  const benchmarkRet20d = calculateWindowReturn(benchmarkValues, 20);
  const benchmarkRet60d = calculateWindowReturn(benchmarkValues, 60);

  const relativeRet20d = typeof ret20d === "number" && typeof benchmarkRet20d === "number"
    ? round(ret20d - benchmarkRet20d, 4)
    : "not_supported";

  const relativeRet60d = typeof ret60d === "number" && typeof benchmarkRet60d === "number"
    ? round(ret60d - benchmarkRet60d, 4)
    : "not_supported";

  const trackingDeviation =
    dailyReturns.length >= 20 && benchmarkValues.length >= 21
      ? calculateTrackingDeviation(values, benchmarkValues)
      : "not_supported";

  const ma5 = movingAverage(values, 5);
  const ma10 = movingAverage(values, 10);
  const ma20 = movingAverage(values, 20);

  const latestVolume = series.length > 0 ? Number(series[series.length - 1].volume ?? NaN) : NaN;
  const avgVolume = average(
    series
      .slice(-10)
      .map((item) => Number(item.volume ?? NaN))
      .filter((item) => Number.isFinite(item) && item >= 0)
  );
  const volumeChangeRate = Number.isFinite(latestVolume) && Number.isFinite(avgVolume) && avgVolume > 0
    ? round(((latestVolume - avgVolume) / avgVolume) * 100, 4)
    : "not_supported";

  const navSlope20d = values.length >= 21
    ? round((values[values.length - 1] - values[values.length - 21]) / 20, 6)
    : "not_supported";

  const sharpe = dailyReturns.length >= 30 && sampleStdDev(dailyReturns) > 0
    ? round((average(dailyReturns) / sampleStdDev(dailyReturns)) * Math.sqrt(252), 4)
    : "not_supported";

  const sortino = dailyReturns.length >= 30
    ? calculateSortino(dailyReturns)
    : "not_supported";

  const calmar = typeof ret120d === "number" && typeof maxDrawdown === "number" && maxDrawdown !== 0
    ? round((ret120d / 100) / Math.abs(maxDrawdown / 100), 4)
    : "not_supported";

  const warnings: string[] = [];
  if (values.length < 20) {
    warnings.push("time_series_lt_20");
  }
  if (raw.events.subscription_redemption.length > 0) {
    warnings.push("subscription_redemption_event");
  }
  if (raw.events.regulatory_risks.length > 0) {
    warnings.push("regulatory_risk_event");
  }

  const metrics: Array<number | "not_supported"> = [
    ret1d,
    ret5d,
    ret20d,
    ret60d,
    ret120d,
    volatility,
    maxDrawdown,
    drawdownRecoveryDays,
    relativeRet20d,
    relativeRet60d,
    trackingDeviation,
    ma5,
    ma10,
    ma20,
    volumeChangeRate,
    navSlope20d,
    sharpe,
    sortino,
    calmar
  ];

  const numericCount = metrics.filter((item) => typeof item === "number" && Number.isFinite(item)).length;
  const coverageRatio = metrics.length > 0 ? numericCount / metrics.length : 0;

  const coverage = coverageRatio >= 0.8
    ? "ok"
    : coverageRatio >= 0.45
      ? "partial"
      : "insufficient";

  const confidence = round(Math.max(0.1, Math.min(0.95, coverageRatio)), 4);

  return {
    returns: {
      ret_1d: ret1d,
      ret_5d: ret5d,
      ret_20d: ret20d,
      ret_60d: ret60d,
      ret_120d: ret120d
    },
    risk: {
      volatility_annualized: volatility,
      max_drawdown: maxDrawdown,
      drawdown_recovery_days: drawdownRecoveryDays
    },
    stability: {
      excess_return_consistency: typeof relativeRet20d === "number" && typeof relativeRet60d === "number"
        ? round((relativeRet20d + relativeRet60d) / 2, 4)
        : "not_supported",
      style_drift: "not_supported",
      nav_smoothing_anomaly: "not_supported"
    },
    relative: {
      benchmark_excess_20d: relativeRet20d,
      benchmark_excess_60d: relativeRet60d,
      peer_percentile: "not_supported",
      tracking_deviation: trackingDeviation
    },
    trading: {
      ma5,
      ma10,
      ma20,
      liquidity_avg_volume_10d: Number.isFinite(avgVolume) ? round(avgVolume, 4) : "not_supported",
      volume_change_rate: volumeChangeRate,
      premium_discount: "not_supported"
    },
    nav: {
      nav_slope_20d: navSlope20d,
      sharpe,
      sortino,
      calmar,
      manager_tenure: "not_supported",
      style_drift_alert: "not_supported"
    },
    coverage,
    confidence,
    warnings
  };
}

function calculateWindowReturn(values: number[], window: number): number | "not_supported" {
  if (values.length <= window) {
    return "not_supported";
  }
  const start = values[values.length - 1 - window];
  const end = values[values.length - 1];
  if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0) {
    return "not_supported";
  }
  return round(((end - start) / start) * 100, 4);
}

function calculateMaxDrawdown(values: number[]): number {
  let peak = values[0] ?? 0;
  let maxDrawdown = 0;

  for (const value of values) {
    if (value > peak) {
      peak = value;
      continue;
    }
    if (peak <= 0) {
      continue;
    }
    const drawdown = ((value - peak) / peak) * 100;
    if (drawdown < maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  return maxDrawdown;
}

function calculateRecoveryDays(values: number[]): number | "not_supported" {
  if (values.length < 3) {
    return "not_supported";
  }

  const maxDrawdownIdx = findMaxDrawdownBottom(values);
  if (maxDrawdownIdx < 0 || maxDrawdownIdx >= values.length - 1) {
    return "not_supported";
  }

  const recoveryTarget = Math.max(...values.slice(0, maxDrawdownIdx + 1));
  for (let idx = maxDrawdownIdx + 1; idx < values.length; idx += 1) {
    if (values[idx] >= recoveryTarget) {
      return idx - maxDrawdownIdx;
    }
  }

  return "not_supported";
}

function findMaxDrawdownBottom(values: number[]): number {
  let peak = values[0] ?? 0;
  let peakIdx = 0;
  let maxDrawdown = 0;
  let bottomIdx = -1;

  for (let idx = 0; idx < values.length; idx += 1) {
    const value = values[idx];
    if (value > peak) {
      peak = value;
      peakIdx = idx;
      continue;
    }

    if (peak <= 0) {
      continue;
    }

    const drawdown = ((value - peak) / peak) * 100;
    if (drawdown < maxDrawdown) {
      maxDrawdown = drawdown;
      bottomIdx = idx > peakIdx ? idx : -1;
    }
  }

  return bottomIdx;
}

function calculateTrackingDeviation(values: number[], benchmarkValues: number[]): number | "not_supported" {
  const length = Math.min(values.length, benchmarkValues.length);
  if (length < 21) {
    return "not_supported";
  }

  const alignedValues = values.slice(-length);
  const alignedBenchmark = benchmarkValues.slice(-length);

  const excessDaily: number[] = [];
  for (let idx = 1; idx < length; idx += 1) {
    const prev = alignedValues[idx - 1];
    const curr = alignedValues[idx];
    const prevBenchmark = alignedBenchmark[idx - 1];
    const currBenchmark = alignedBenchmark[idx];

    if (prev <= 0 || prevBenchmark <= 0) {
      continue;
    }

    const ret = (curr - prev) / prev;
    const benchmarkRet = (currBenchmark - prevBenchmark) / prevBenchmark;
    excessDaily.push(ret - benchmarkRet);
  }

  if (excessDaily.length < 20) {
    return "not_supported";
  }

  return round(sampleStdDev(excessDaily) * Math.sqrt(252) * 100, 4);
}

function calculateSortino(dailyReturns: number[]): number | "not_supported" {
  const negative = dailyReturns.filter((item) => item < 0);
  if (negative.length < 10) {
    return "not_supported";
  }

  const downsideDev = sampleStdDev(negative);
  if (!Number.isFinite(downsideDev) || downsideDev <= 0) {
    return "not_supported";
  }

  return round((average(dailyReturns) / downsideDev) * Math.sqrt(252), 4);
}

function buildDailyReturns(values: number[]): number[] {
  const returns: number[] = [];
  for (let idx = 1; idx < values.length; idx += 1) {
    const prev = values[idx - 1];
    const curr = values[idx];
    if (prev <= 0 || !Number.isFinite(curr)) {
      continue;
    }
    returns.push((curr - prev) / prev);
  }
  return returns;
}

function movingAverage(values: number[], period: number): number | "not_supported" {
  if (values.length < period) {
    return "not_supported";
  }
  return round(average(values.slice(-period)), 4);
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sum = values.reduce((acc, item) => acc + item, 0);
  return sum / values.length;
}

function sampleStdDev(values: number[]): number {
  if (values.length <= 1) {
    return 0;
  }

  const mean = average(values);
  const variance = values.reduce((acc, item) => {
    const delta = item - mean;
    return acc + (delta * delta);
  }, 0) / (values.length - 1);

  return Math.sqrt(Math.max(0, variance));
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
