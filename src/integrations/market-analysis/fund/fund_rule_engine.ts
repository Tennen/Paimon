import { FundFeatureContext, FundRawContext, FundRiskLevel, MarketAnalysisConfig } from "./fund_types";

export type FundRuleInput = {
  raw: FundRawContext;
  features: FundFeatureContext;
  analysisConfig: MarketAnalysisConfig;
};

export type FundRuleOutput = {
  rule_flags: string[];
  rule_adjusted_score: number;
  blocked_actions: string[];
  hard_blocked: boolean;
};

export function evaluateFundRules(input: FundRuleInput): FundRuleOutput {
  const { raw, features, analysisConfig } = input;
  const fundConfig = analysisConfig.fund;

  const ruleFlags: string[] = [];
  const blockedActions = new Set<string>();

  let score = baseScoreFromFeatures(features);

  const isStale = isDataStale(raw.as_of_date, fundConfig.maxAgeDays);
  if (isStale) {
    ruleFlags.push("data_stale");
    blockedActions.add("buy");
    blockedActions.add("add");
    score -= 25;
  }

  if (features.coverage === "insufficient") {
    ruleFlags.push("feature_coverage_insufficient");
    blockedActions.add("buy");
    blockedActions.add("add");
    score -= 20;
  } else if (features.coverage === "partial") {
    ruleFlags.push("feature_coverage_partial");
    score -= 8;
  }

  const subscriptionRestriction = raw.events.subscription_redemption.some((item) => /暂停|限制|限购|限赎/.test(item));
  if (subscriptionRestriction) {
    ruleFlags.push("subscription_redemption_restriction");
    blockedActions.add("buy");
    blockedActions.add("add");
    score -= 15;
  }

  if (raw.events.regulatory_risks.length > 0) {
    ruleFlags.push("regulatory_risk_event");
    score -= 10;
  }

  const riskExceeded = exceedsRiskBudget(features, fundConfig.ruleRiskLevel);
  if (riskExceeded) {
    ruleFlags.push("risk_level_exceeded");
    blockedActions.add("buy");
    blockedActions.add("add");
    score -= 18;
  }

  const maxDrawdown = features.risk.max_drawdown;
  if (typeof maxDrawdown === "number" && maxDrawdown <= -20) {
    ruleFlags.push("high_drawdown_penalty");
    score -= 12;
  }

  if (raw.events.manager_changes.length > 0) {
    ruleFlags.push("manager_change_penalty");
    score -= 6;
  }

  const costPenalty = estimateCostPenalty(raw, features);
  if (costPenalty > 0) {
    ruleFlags.push("cost_fee_penalty");
    score -= costPenalty;
  }

  const hardBlocked = blockedActions.has("buy") && blockedActions.has("add") && features.coverage === "insufficient";

  return {
    rule_flags: dedup(ruleFlags),
    rule_adjusted_score: clamp(round(score, 2), 0, 100),
    blocked_actions: Array.from(blockedActions),
    hard_blocked: hardBlocked
  };
}

function baseScoreFromFeatures(features: FundFeatureContext): number {
  let score = 50;

  const ret20d = features.returns.ret_20d;
  const ret60d = features.returns.ret_60d;

  if (typeof ret20d === "number") {
    score += ret20d >= 5 ? 10 : ret20d >= 0 ? 4 : -8;
  }

  if (typeof ret60d === "number") {
    score += ret60d >= 10 ? 10 : ret60d >= 0 ? 4 : -10;
  }

  const peerPercentile = features.relative.peer_percentile;
  if (typeof peerPercentile === "number") {
    score += peerPercentile >= 75 ? 8 : peerPercentile >= 50 ? 4 : peerPercentile <= 25 ? -8 : -2;
  }

  const peerPercentileChange20d = features.relative.peer_percentile_change_20d;
  if (typeof peerPercentileChange20d === "number") {
    score += peerPercentileChange20d >= 5 ? 4 : peerPercentileChange20d >= 0 ? 1 : -4;
  }

  const volatility = features.risk.volatility_annualized;
  if (typeof volatility === "number") {
    score += volatility <= 12 ? 6 : volatility <= 25 ? 0 : -8;
  }

  return score;
}

function isDataStale(asOfDate: string, maxAgeDays: number): boolean {
  if (!asOfDate) {
    return true;
  }
  const timestamp = Date.parse(asOfDate);
  if (!Number.isFinite(timestamp)) {
    return true;
  }

  const ageMs = Date.now() - timestamp;
  const maxMs = Math.max(1, maxAgeDays) * 24 * 60 * 60 * 1000;
  return ageMs > maxMs;
}

function exceedsRiskBudget(features: FundFeatureContext, riskLevel: FundRiskLevel): boolean {
  const volatility = features.risk.volatility_annualized;
  const drawdown = features.risk.max_drawdown;

  const thresholds = riskLevel === "low"
    ? { volatility: 18, drawdown: -15 }
    : riskLevel === "high"
      ? { volatility: 45, drawdown: -35 }
      : { volatility: 30, drawdown: -25 };

  if (typeof volatility === "number" && volatility > thresholds.volatility) {
    return true;
  }
  if (typeof drawdown === "number" && drawdown < thresholds.drawdown) {
    return true;
  }

  return false;
}

function estimateCostPenalty(raw: FundRawContext, features: FundFeatureContext): number {
  const latest = raw.price_or_nav_series[raw.price_or_nav_series.length - 1]?.value;
  const avgCostValue = raw.account_context.avg_cost;
  const avgCost = typeof avgCostValue === "number" && Number.isFinite(avgCostValue)
    ? avgCostValue
    : NaN;
  if (!Number.isFinite(latest) || latest <= 0 || !Number.isFinite(avgCost) || avgCost <= 0) {
    return 0;
  }

  const pnlPct = ((latest - avgCost) / avgCost) * 100;
  const ret20d = features.returns.ret_20d;

  if (pnlPct < -15) {
    return 10;
  }

  if (typeof ret20d === "number" && ret20d < -6) {
    return 6;
  }

  return 0;
}

function dedup(values: string[]): string[] {
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)));
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
