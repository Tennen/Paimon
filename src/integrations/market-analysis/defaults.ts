// @ts-nocheck
import { DATA_STORE } from "../../storage/persistence";

export const MARKET_PORTFOLIO_STORE = DATA_STORE.MARKET_PORTFOLIO;
export const MARKET_CONFIG_STORE = DATA_STORE.MARKET_CONFIG;
export const MARKET_STATE_STORE = DATA_STORE.MARKET_STATE;
export const MARKET_RUNS_STORE = DATA_STORE.MARKET_RUNS;

export const DEFAULT_INDEX_CODES = ["000300", "000001", "399001"];
export const DEFAULT_TIMEOUT_MS = 10000;
export const HISTORY_LIMIT = 90;

export const SH_INDEX_CODES = new Set(["000001", "000016", "000300", "000688", "000905", "000852"]);
export const SZ_INDEX_CODES = new Set(["399001", "399005", "399006", "399102", "399303"]);

export const DEFAULT_ANALYSIS_CONFIG = {
  version: 1,
  assetType: "equity",
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
