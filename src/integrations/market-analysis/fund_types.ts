import { FeatureCoverage, FundDecisionDashboard } from "./fund_schema";

export type MarketAnalysisAssetType = "equity" | "fund";

export type MarketAnalysisEngine = "local" | "gpt_plugin" | "gemini";

export type FundRiskLevel = "low" | "medium" | "high";

export type MarketAnalysisConfig = {
  version: 1;
  assetType: MarketAnalysisAssetType;
  analysisEngine: MarketAnalysisEngine;
  gptPlugin: {
    timeoutMs: number;
    fallbackToLocal: boolean;
  };
  fund: {
    enabled: boolean;
    maxAgeDays: number;
    featureLookbackDays: number;
    ruleRiskLevel: FundRiskLevel;
    llmRetryMax: number;
  };
};

export type MarketPhase = "midday" | "close";

export type PortfolioHolding = {
  code: string;
  name: string;
  quantity: number;
  avgCost: number;
};

export type MarketPortfolio = {
  funds: PortfolioHolding[];
  cash: number;
};

export type FundType = "etf" | "lof" | "otc_public" | "unknown";

export type StrategyType =
  | "index"
  | "active_equity"
  | "bond"
  | "mixed"
  | "fof"
  | "money_market"
  | "qdii"
  | "unknown";

export type TradableType = "intraday" | "nav_t_plus_n" | "unknown";

export type FundIdentity = {
  fund_code: string;
  fund_name: string;
  market: string;
  currency: string;
  account_position: {
    quantity: number;
    avg_cost: number;
  };
  fund_type: FundType;
  strategy_type: StrategyType;
  tradable: TradableType;
  source_chain: string[];
  errors: string[];
};

export type FundSeriesPoint = {
  date: string;
  value: number;
  volume?: number;
};

export type FundNewsItem = {
  title: string;
  source: string;
  link?: string;
  published_at?: string;
  snippet?: string;
};

export type FundRawContext = {
  identity: FundIdentity;
  as_of_date: string;
  price_or_nav_series: FundSeriesPoint[];
  benchmark_series: FundSeriesPoint[];
  benchmark_code: string;
  holdings_style: {
    top_holdings: string[];
    sector_exposure: Record<string, number | string>;
    style_factor_exposure: Record<string, number | string>;
    duration_credit_profile: Record<string, number | string>;
  };
  events: {
    notices: string[];
    manager_changes: string[];
    subscription_redemption: string[];
    regulatory_risks: string[];
    market_news: FundNewsItem[];
  };
  account_context: {
    current_position: number;
    avg_cost: number;
    budget: number;
    risk_preference: string;
    holding_horizon: string;
  };
  source_chain: string[];
  errors: string[];
};

export type FundFeatureContext = {
  returns: Record<string, number | "not_supported">;
  risk: Record<string, number | "not_supported">;
  stability: Record<string, number | "not_supported">;
  relative: Record<string, number | "not_supported">;
  trading: Record<string, number | "not_supported">;
  nav: Record<string, number | "not_supported">;
  coverage: FeatureCoverage;
  confidence: number;
  warnings: string[];
};

export type FundRuleOutput = {
  rule_flags: string[];
  rule_adjusted_score: number;
  blocked_actions: string[];
  hard_blocked: boolean;
};

export type FundAuditStep = {
  step: string;
  duration_ms: number;
  source_chain: string[];
  errors: string[];
};

export type FundAnalysisOutput = {
  phase: MarketPhase;
  marketState: string;
  benchmark: string;
  generatedAt: string;
  assetSignals: Array<{ code: string; signal: string }>;
  assetType: "fund";
  fund_dashboards: FundDecisionDashboard[];
  portfolio_report: {
    brief: string;
    full: string;
  };
  audit: {
    steps: FundAuditStep[];
    errors: string[];
  };
};
