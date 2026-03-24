import { FundFeatureContext, FundRawContext } from "./fund_types";

export type FundSeriesMetricValue = number | "not_supported";

export type FundSeriesSummary = {
  point_count: number;
  latest_date?: string;
  latest_value?: number;
  ret_1d: FundSeriesMetricValue;
  ret_5d: FundSeriesMetricValue;
  ret_20d: FundSeriesMetricValue;
  ret_60d: FundSeriesMetricValue;
  nav_slope_20d: FundSeriesMetricValue;
  high_60d: FundSeriesMetricValue;
  low_60d: FundSeriesMetricValue;
};

export type FundPositionSnapshot = {
  current_position?: number;
  avg_cost?: number;
  budget: number;
  risk_preference: string;
  holding_horizon: string;
  estimated_market_value: number | "not_supported";
  estimated_position_pnl_pct: number | "not_supported";
};

export type FundReportContext = {
  fund_series_summary: FundSeriesSummary;
  peer_percentile_summary: FundSeriesSummary;
  position_snapshot: FundPositionSnapshot;
  feature_context: FundFeatureContext;
  holdings_style: FundRawContext["holdings_style"];
  reference_context: FundRawContext["reference_context"];
  account_context: FundRawContext["account_context"];
  events: FundRawContext["events"];
  source_chain: string[];
  errors: string[];
};

const DEFAULT_SUMMARY_LIMIT = 90;

export function summarizeFundSeries(
  points: FundRawContext["price_or_nav_series"],
  limit = DEFAULT_SUMMARY_LIMIT
): FundSeriesSummary {
  const valid = Array.isArray(points)
    ? points
      .filter((item) => item && Number.isFinite(Number(item.value)) && Number(item.value) > 0)
      .slice(-Math.max(10, limit))
    : [];

  const values = valid.map((item) => Number(item.value));
  const last = valid.length > 0 ? valid[valid.length - 1] : null;
  const high60d = values.length > 0 ? Math.max(...values.slice(-60)) : undefined;
  const low60d = values.length > 0 ? Math.min(...values.slice(-60)) : undefined;

  return {
    point_count: valid.length,
    latest_date: last ? String(last.date || "") : undefined,
    latest_value: last ? roundNumber(Number(last.value), 6) : undefined,
    ret_1d: calculateWindowReturn(values, 1),
    ret_5d: calculateWindowReturn(values, 5),
    ret_20d: calculateWindowReturn(values, 20),
    ret_60d: calculateWindowReturn(values, 60),
    nav_slope_20d: values.length >= 21
      ? roundNumber((values[values.length - 1] - values[values.length - 21]) / 20, 6)
      : "not_supported",
    high_60d: Number.isFinite(high60d) ? roundNumber(high60d as number, 6) : "not_supported",
    low_60d: Number.isFinite(low60d) ? roundNumber(low60d as number, 6) : "not_supported"
  };
}

export function summarizeFundPosition(
  account: FundRawContext["account_context"],
  latestValue?: number
): FundPositionSnapshot {
  const quantity = Number(account.current_position);
  const avgCost = Number(account.avg_cost);
  const hasValidAvgCost = Number.isFinite(avgCost) && avgCost > 0;
  const hasLatest = Number.isFinite(latestValue) && (latestValue as number) > 0;
  const pnlPct = hasValidAvgCost && hasLatest
    ? roundNumber((((latestValue as number) - avgCost) / avgCost) * 100, 4)
    : "not_supported";
  const marketValue = Number.isFinite(quantity) && quantity > 0 && hasLatest
    ? roundNumber(quantity * (latestValue as number), 4)
    : "not_supported";

  return {
    current_position: account.current_position,
    avg_cost: account.avg_cost,
    budget: account.budget,
    risk_preference: account.risk_preference,
    holding_horizon: account.holding_horizon,
    estimated_market_value: marketValue,
    estimated_position_pnl_pct: pnlPct
  };
}

export function buildFundReportContext(
  rawContext: FundRawContext,
  featureContext: FundFeatureContext
): FundReportContext {
  const fundSeriesSummary = summarizeFundSeries(rawContext.price_or_nav_series);
  const peerPercentileSummary = summarizeFundSeries(rawContext.reference_context.peer_percentile_series);
  const latestValue = typeof fundSeriesSummary.latest_value === "number"
    ? fundSeriesSummary.latest_value
    : undefined;

  return {
    fund_series_summary: fundSeriesSummary,
    peer_percentile_summary: peerPercentileSummary,
    position_snapshot: summarizeFundPosition(rawContext.account_context, latestValue),
    feature_context: featureContext,
    holdings_style: rawContext.holdings_style,
    reference_context: rawContext.reference_context,
    account_context: rawContext.account_context,
    events: rawContext.events,
    source_chain: rawContext.source_chain,
    errors: rawContext.errors
  };
}

export function createEmptyFundReportContext(): FundReportContext {
  const emptyFeatureContext: FundFeatureContext = {
    returns: {},
    risk: {},
    stability: {},
    relative: {},
    trading: {},
    nav: {},
    coverage: "insufficient",
    confidence: 0.1,
    warnings: []
  };

  const accountContext: FundRawContext["account_context"] = {
    budget: 0,
    risk_preference: "",
    holding_horizon: ""
  };

  return {
    fund_series_summary: summarizeFundSeries([]),
    peer_percentile_summary: summarizeFundSeries([]),
    position_snapshot: summarizeFundPosition(accountContext),
    feature_context: emptyFeatureContext,
    holdings_style: {
      top_holdings: [],
      sector_exposure: {},
      style_factor_exposure: {},
      duration_credit_profile: {}
    },
    reference_context: {
      peer_percentile_series: [],
      current_managers: []
    },
    account_context: accountContext,
    events: {
      notices: [],
      manager_changes: [],
      subscription_redemption: [],
      regulatory_risks: [],
      market_news: []
    },
    source_chain: [],
    errors: []
  };
}

function calculateWindowReturn(values: number[], window: number): FundSeriesMetricValue {
  if (values.length <= window) {
    return "not_supported";
  }
  const start = values[values.length - window - 1];
  const end = values[values.length - 1];
  if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0) {
    return "not_supported";
  }
  return roundNumber(((end - start) / start) * 100, 4);
}

function roundNumber(input: number, digits: number): number {
  if (!Number.isFinite(input)) {
    return 0;
  }
  const factor = 10 ** digits;
  return Math.round(input * factor) / factor;
}
