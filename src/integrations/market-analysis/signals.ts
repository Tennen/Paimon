// @ts-nocheck
import { chooseBenchmarkCode } from "./marketData";
import { average, isFiniteNumber, movingAverage, normalizeAssetName, round, safeNumber } from "./utils";

export function calculateFeatureLayer(marketData) {
  const indices = {};
  const assets = {};

  for (const [code, snapshot] of Object.entries(marketData.indices || {})) {
    indices[code] = calculateMetrics(snapshot);
  }

  for (const [code, snapshot] of Object.entries(marketData.assets || {})) {
    assets[code] = calculateMetrics(snapshot);
  }

  return { indices, assets };
}

export function executeRuleEngine(input) {
  const phase = input.phase;
  const portfolio = input.portfolio;
  const marketData = input.marketData;
  const marketAssets = marketData && typeof marketData === "object" && marketData.assets && typeof marketData.assets === "object"
    ? marketData.assets
    : {};
  const featureLayer = input.featureLayer;

  const benchmarkCode = chooseBenchmarkCode(featureLayer.indices);
  const benchmarkMetrics = benchmarkCode ? featureLayer.indices[benchmarkCode] : null;

  const marketState = evaluateMarketState(benchmarkMetrics);

  const assetSignals = [];
  for (const holding of portfolio.funds) {
    const quantity = toOptionalPositiveNumber(holding.quantity);
    const avgCost = toOptionalNonNegativeNumber(holding.avgCost);
    const marketAsset = marketAssets[holding.code] || null;
    const name = normalizeAssetName(holding.name) || normalizeAssetName(marketAsset && marketAsset.name);
    const metrics = featureLayer.assets[holding.code] || null;
    if (!metrics) {
      const missingMetrics = {
        ma5: null,
        ma10: null,
        ma20: null,
        pctChange: null,
        volumeChangeRate: null,
        price: null,
        prevClose: null,
        ...(Number.isFinite(quantity) ? { quantity } : {}),
        ...(Number.isFinite(avgCost) ? { avgCost } : {})
      };
      assetSignals.push({
        code: holding.code,
        name,
        signal: "DATA_MISSING",
        metrics: missingMetrics
      });
      continue;
    }

    const signal = evaluateAssetSignal(phase, metrics);
    const positionPnLPct = Number.isFinite(avgCost) && avgCost > 0
      ? round(((metrics.price - avgCost) / avgCost) * 100, 4)
      : undefined;

    assetSignals.push({
      code: holding.code,
      name,
      signal,
      metrics: {
        ma5: metrics.ma5,
        ma10: metrics.ma10,
        ma20: metrics.ma20,
        pctChange: metrics.pctChange,
        volumeChangeRate: metrics.volumeChangeRate,
        price: metrics.price,
        prevClose: metrics.prevClose,
        ...(Number.isFinite(quantity) ? { quantity } : {}),
        ...(Number.isFinite(avgCost) ? { avgCost } : {}),
        ...(Number.isFinite(positionPnLPct) ? { positionPnLPct } : {})
      }
    });
  }

  return {
    phase,
    marketState,
    benchmark: benchmarkCode || "",
    generatedAt: new Date().toISOString(),
    assetSignals
  };
}

function calculateMetrics(snapshot) {
  const history = Array.isArray(snapshot.history) ? snapshot.history.slice() : [];
  const volumeHistory = Array.isArray(snapshot.volumeHistory) ? snapshot.volumeHistory.slice() : [];

  const price = safeNumber(snapshot.price);
  const prevClose = safeNumber(snapshot.prevClose);
  const volume = Math.max(0, safeNumber(snapshot.volume));

  const ma5 = movingAverage(history, 5);
  const ma10 = movingAverage(history, 10);
  const ma20 = movingAverage(history, 20);

  const pctChange = prevClose > 0
    ? round(((price - prevClose) / prevClose) * 100, 4)
    : 0;

  const referenceVolume = average(volumeHistory.slice(-5));
  const volumeChangeRate = referenceVolume > 0
    ? round(((volume - referenceVolume) / referenceVolume) * 100, 4)
    : 0;

  return {
    price: round(price, 4),
    prevClose: round(prevClose, 4),
    volume: round(volume, 4),
    ma5,
    ma10,
    ma20,
    pctChange,
    volumeChangeRate
  };
}

function evaluateMarketState(metrics) {
  if (!metrics) {
    return "MARKET_NEUTRAL";
  }

  if (isFiniteNumber(metrics.ma20) && metrics.price < metrics.ma20) {
    return "MARKET_WEAK";
  }

  if (
    isFiniteNumber(metrics.ma5) &&
    isFiniteNumber(metrics.ma10) &&
    isFiniteNumber(metrics.ma20) &&
    metrics.ma5 > metrics.ma10 &&
    metrics.price > metrics.ma20
  ) {
    return "MARKET_STRONG";
  }

  return "MARKET_NEUTRAL";
}

function evaluateAssetSignal(phase, metrics) {
  if (phase === "midday") {
    if (metrics.price < metrics.prevClose && metrics.volumeChangeRate > 0) {
      return "INTRADAY_WEAK";
    }
    if (metrics.price > metrics.prevClose) {
      return "INTRADAY_STABLE";
    }
    return "INTRADAY_NEUTRAL";
  }

  if (!isFiniteNumber(metrics.ma20)) {
    return "TREND_NEUTRAL";
  }

  if (metrics.price < metrics.ma20) {
    return "TREND_WEAK";
  }

  if (
    metrics.price > metrics.ma20 &&
    isFiniteNumber(metrics.ma5) &&
    isFiniteNumber(metrics.ma10) &&
    metrics.ma5 > metrics.ma10
  ) {
    return "TREND_UP";
  }

  return "TREND_NEUTRAL";
}

function toOptionalPositiveNumber(value) {
  const numeric = safeNumber(value);
  return numeric > 0 ? numeric : undefined;
}

function toOptionalNonNegativeNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return undefined;
  }
  return numeric;
}
