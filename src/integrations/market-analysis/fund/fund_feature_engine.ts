import { FundFeatureContext, FundRawContext } from "./fund_types";

export function buildFundFeatureContext(raw: FundRawContext): FundFeatureContext {
  const series = raw.price_or_nav_series;
  const values = series.map((item) => item.value).filter((value) => Number.isFinite(value) && value > 0);
  const peerPercentileSeries = Array.isArray(raw.reference_context.peer_percentile_series)
    ? raw.reference_context.peer_percentile_series
    : [];
  const peerPercentileValues = peerPercentileSeries
    .map((item) => Number(item.value))
    .filter((value) => Number.isFinite(value) && value > 0);
  const peerPercentile = Number(raw.reference_context.peer_percentile);
  const peerRankPosition = Number(raw.reference_context.peer_rank_position);
  const peerRankTotal = Number(raw.reference_context.peer_rank_total);

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

  const peerPercentileChange20d = calculateWindowDelta(peerPercentileValues, 20);
  const peerPercentileChange60d = calculateWindowDelta(peerPercentileValues, 60);

  const ma5 = movingAverage(values, 5);
  const ma10 = movingAverage(values, 10);
  const ma20 = movingAverage(values, 20);

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
    Number.isFinite(peerPercentile) ? peerPercentile : "not_supported",
    peerPercentileChange20d,
    peerPercentileChange60d,
    Number.isFinite(peerRankPosition) ? peerRankPosition : "not_supported",
    Number.isFinite(peerRankTotal) ? peerRankTotal : "not_supported",
    ma5,
    ma10,
    ma20,
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
      excess_return_consistency: typeof peerPercentileChange20d === "number" && typeof peerPercentileChange60d === "number"
        ? round((peerPercentileChange20d + peerPercentileChange60d) / 2, 4)
        : "not_supported",
      style_drift: "not_supported",
      nav_smoothing_anomaly: "not_supported"
    },
    relative: {
      peer_percentile: Number.isFinite(peerPercentile) ? round(peerPercentile, 4) : "not_supported",
      peer_percentile_change_20d: peerPercentileChange20d,
      peer_percentile_change_60d: peerPercentileChange60d,
      peer_rank_position: Number.isFinite(peerRankPosition) ? round(peerRankPosition, 0) : "not_supported",
      peer_rank_total: Number.isFinite(peerRankTotal) ? round(peerRankTotal, 0) : "not_supported"
    },
    trading: {
      ma5,
      ma10,
      ma20,
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

function calculateWindowDelta(values: number[], window: number): number | "not_supported" {
  if (values.length <= window) {
    return "not_supported";
  }
  const start = values[values.length - 1 - window];
  const end = values[values.length - 1];
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return "not_supported";
  }
  return round(end - start, 4);
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
