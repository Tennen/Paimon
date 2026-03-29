import type { DataStoreDescriptor } from "./common";
import type { PushUser } from "./messages";
import type { LLMProviderProfile, SearchEngineProfile } from "./system";

export type MarketFundHolding = {
  code: string;
  name: string;
  quantity?: number;
  avgCost?: number;
};

export type MarketPortfolio = {
  funds: MarketFundHolding[];
  cash: number;
};

export type MarketAnalysisEngine = string;

export type MarketFundRiskLevel = "low" | "medium" | "high";

export type MarketAnalysisConfig = {
  version: 1;
  analysisEngine: MarketAnalysisEngine;
  searchEngine: string;
  gptPlugin: {
    timeoutMs: number;
    fallbackToLocal: boolean;
  };
  fund: {
    enabled: boolean;
    maxAgeDays: number;
    featureLookbackDays: number;
    ruleRiskLevel: MarketFundRiskLevel;
    llmRetryMax: number;
    newsQuerySuffix: string;
  };
};

export type MarketConfig = {
  portfolio: MarketPortfolio;
  config: MarketAnalysisConfig;
  portfolioStore: DataStoreDescriptor;
  configStore: DataStoreDescriptor;
  stateStore: DataStoreDescriptor;
  runsStore: DataStoreDescriptor;
};

export type MarketPhase = "midday" | "close";

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

export type MarketRunOnceResponse = {
  ok: boolean;
  phase: MarketPhase;
  message: string;
  acceptedAsync: boolean;
  responseText?: string;
  imageCount?: number;
};

export type MarketPortfolioImportResultItem = {
  code: string;
  name?: string;
  status: "added" | "updated" | "exists" | "not_found" | "error";
  message?: string;
};

export type MarketPortfolioImportResponse = {
  ok: boolean;
  portfolio: MarketPortfolio;
  results: MarketPortfolioImportResultItem[];
  summary: {
    added: number;
    updated: number;
    exists: number;
    not_found: number;
    error: number;
  };
};

export type MarketSecuritySearchItem = {
  code: string;
  name: string;
  market: string;
  securityType: string;
  secid?: string;
};

export type MarketSectionProps = {
  marketConfig: MarketConfig | null;
  marketPortfolio: MarketPortfolio;
  marketAnalysisConfig: MarketAnalysisConfig;
  marketSearchEngines: SearchEngineProfile[];
  defaultMarketSearchEngineId: string;
  llmProviders: LLMProviderProfile[];
  defaultLlmProviderId: string;
  marketRuns: MarketRunSummary[];
  savingMarketPortfolio: boolean;
  savingMarketAnalysisConfig: boolean;
  marketFundSaveStates: Array<"saved" | "dirty" | "saving">;
  bootstrappingMarketTasks: boolean;
  runningMarketOncePhase: MarketPhase | null;
  enabledUsers: PushUser[];
  marketTaskUserId: string;
  marketMiddayTime: string;
  marketCloseTime: string;
  marketBatchCodesInput: string;
  importingMarketCodes: boolean;
  marketSearchInputs: string[];
  marketSearchResults: MarketSecuritySearchItem[][];
  searchingMarketFundIndex: number | null;
  onCashChange: (value: number) => void;
  onMarketAnalysisEngineChange: (value: MarketAnalysisEngine) => void;
  onMarketSearchEngineChange: (value: string) => void;
  onMarketFundNewsQuerySuffixChange: (value: string) => void;
  onMarketGptPluginTimeoutMsChange: (value: number) => void;
  onMarketGptPluginFallbackToLocalChange: (value: boolean) => void;
  onMarketFundEnabledChange: (value: boolean) => void;
  onMarketFundMaxAgeDaysChange: (value: number) => void;
  onMarketFundFeatureLookbackDaysChange: (value: number) => void;
  onMarketFundRiskLevelChange: (value: MarketFundRiskLevel) => void;
  onMarketFundLlmRetryMaxChange: (value: number) => void;
  onMarketTaskUserIdChange: (value: string) => void;
  onMarketMiddayTimeChange: (value: string) => void;
  onMarketCloseTimeChange: (value: string) => void;
  onMarketBatchCodesInputChange: (value: string) => void;
  onAddMarketFund: () => void;
  onRemoveMarketFund: (index: number) => void;
  onMarketFundChange: (index: number, key: keyof MarketFundHolding, value: string) => void;
  onMarketSearchInputChange: (index: number, value: string) => void;
  onSearchMarketByName: (index: number) => void;
  onApplyMarketSearchResult: (index: number, item: MarketSecuritySearchItem) => void;
  onSaveMarketFund: (index: number) => void;
  onSaveMarketPortfolio: () => void;
  onSaveMarketAnalysisConfig: () => void;
  onImportMarketCodes: () => void;
  onRefresh: () => void;
  onBootstrapMarketTasks: () => void;
  onRunMarketOnce: (phase: MarketPhase) => void;
};
