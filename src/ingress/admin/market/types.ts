import { DATA_STORE } from "../../../storage/persistence";

export type MarketPhase = "midday" | "close";

export type MarketPortfolioFund = {
  code: string;
  name: string;
  quantity?: number;
  avgCost?: number;
};

export type MarketPortfolio = {
  funds: MarketPortfolioFund[];
  cash: number;
};

export type MarketAnalysisEngine = string;

export type MarketGptPluginConfig = {
  timeoutMs: number;
  fallbackToLocal: boolean;
};

export type MarketFundAnalysisConfig = {
  enabled: boolean;
  maxAgeDays: number;
  featureLookbackDays: number;
  ruleRiskLevel: "low" | "medium" | "high";
  llmRetryMax: number;
  newsQuerySuffix: string;
};

export type MarketAnalysisConfig = {
  version: 1;
  analysisEngine: MarketAnalysisEngine;
  searchEngine: string;
  gptPlugin: MarketGptPluginConfig;
  fund: MarketFundAnalysisConfig;
};

export type MarketRunSummary = {
  id: string;
  createdAt: string;
  phase: MarketPhase;
  marketState: string;
  comparisonReference?: string;
  assetSignalCount: number;
  signals: Array<{ code: string; signal: string }>;
  explanationSummary?: string;
  file?: string;
};

export type MarketSecuritySearchItem = {
  code: string;
  name: string;
  market: string;
  securityType: string;
  secid?: string;
};

export type MarketStateFile = {
  version: 1;
  latestRunId: string;
  latestByPhase: {
    midday: { id: string; createdAt: string; file?: string } | null;
    close: { id: string; createdAt: string; file?: string } | null;
  };
  recentRuns: MarketRunSummary[];
  updatedAt: string;
};

export type BootstrapMarketTasksPayload = {
  userId: string;
  middayTime?: string;
  closeTime?: string;
  enabled?: boolean;
};

export type RunMarketOncePayload = {
  userId: string;
  phase: MarketPhase;
};

export type RunMarketOncePayloadParseResult =
  | { payload: RunMarketOncePayload; error?: undefined }
  | { payload?: undefined; error: string };

export type ImportMarketPortfolioCodesPayload = {
  codes: string[];
};

export type ImportMarketPortfolioCodesResult = {
  code: string;
  name?: string;
  status: "added" | "updated" | "exists" | "not_found" | "error";
  message?: string;
};

export const MARKET_PORTFOLIO_STORE = DATA_STORE.MARKET_PORTFOLIO;
export const MARKET_CONFIG_STORE = DATA_STORE.MARKET_CONFIG;
export const MARKET_STATE_STORE = DATA_STORE.MARKET_STATE;
export const MARKET_SECURITY_SEARCH_TIMEOUT_MS = 8000;
export const MARKET_PORTFOLIO_IMPORT_MAX_CODES = 120;
export const EASTMONEY_SEARCH_TOKEN = "D43BF722C8E33BDC906FB84D85E326E8";

export const DEFAULT_MARKET_PORTFOLIO: MarketPortfolio = {
  funds: [],
  cash: 0
};

export const DEFAULT_MARKET_ANALYSIS_CONFIG: MarketAnalysisConfig = {
  version: 1,
  analysisEngine: "local",
  searchEngine: "default",
  gptPlugin: {
    timeoutMs: 20000,
    fallbackToLocal: true
  },
  fund: {
    enabled: true,
    maxAgeDays: 5,
    featureLookbackDays: 120,
    ruleRiskLevel: "medium",
    llmRetryMax: 1,
    newsQuerySuffix: "基金 公告 经理 申赎 风险"
  }
};
