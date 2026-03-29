import type { FundRawContext } from "./fund_types";

export const DEFAULT_COMPARISON_REFERENCE = "同类基金百分位";

export function buildEmptyHoldingsStyle(): FundRawContext["holdings_style"] {
  return {
    top_holdings: [],
    sector_exposure: {},
    style_factor_exposure: {},
    duration_credit_profile: {}
  };
}

export function buildEmptyReferenceContext(): FundRawContext["reference_context"] {
  return {
    comparison_reference: DEFAULT_COMPARISON_REFERENCE,
    peer_percentile_series: [],
    current_managers: []
  };
}
