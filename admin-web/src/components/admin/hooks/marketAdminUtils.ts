import type {
  LLMProviderStore,
  MarketAnalysisConfig,
  MarketFundHolding,
  MarketPortfolio,
  MarketSecuritySearchItem,
  SearchEngineStore
} from "@/types/admin";
import { DEFAULT_MARKET_ANALYSIS_CONFIG } from "@/types/admin";

export function resizeStringArray(values: string[], targetLength: number): string[] {
  if (values.length === targetLength) {
    return values;
  }
  if (values.length > targetLength) {
    return values.slice(0, targetLength);
  }
  return values.concat(Array.from({ length: targetLength - values.length }, () => ""));
}

export function resizeSearchResultsArray(
  values: MarketSecuritySearchItem[][],
  targetLength: number
): MarketSecuritySearchItem[][] {
  if (values.length === targetLength) {
    return values;
  }
  if (values.length > targetLength) {
    return values.slice(0, targetLength);
  }
  return values.concat(Array.from({ length: targetLength - values.length }, () => [] as MarketSecuritySearchItem[]));
}

export function resizeSavedFundsArray(
  values: Array<MarketFundHolding | null>,
  targetLength: number
): Array<MarketFundHolding | null> {
  if (values.length === targetLength) {
    return values;
  }
  if (values.length > targetLength) {
    return values.slice(0, targetLength);
  }
  return values.concat(Array.from({ length: targetLength - values.length }, () => null));
}

export function normalizeMarketFund(fund: Partial<MarketFundHolding> | null | undefined): MarketFundHolding {
  const digits = String(fund?.code ?? "").replace(/\D/g, "");
  const quantity = Number(fund?.quantity);
  const avgCost = Number(fund?.avgCost);
  return {
    code: digits ? digits.slice(-6).padStart(6, "0") : "",
    name: String(fund?.name ?? "").trim(),
    ...(Number.isFinite(quantity) && quantity > 0 ? { quantity } : {}),
    ...(Number.isFinite(avgCost) && avgCost >= 0 ? { avgCost } : {})
  };
}

export function resolveMarketAnalysisProviderId(raw: unknown, store: LLMProviderStore | null | undefined): string {
  const normalized = normalizeMarketAnalysisEngine(raw);
  return resolveModuleProviderId(normalized, store, { allowGeminiLegacy: true });
}

export function resolveMarketSearchEngineId(raw: unknown, store: SearchEngineStore | null | undefined): string {
  const normalized = normalizeMarketSearchEngine(raw);
  if (!store || !Array.isArray(store.engines) || store.engines.length === 0) {
    return normalized;
  }
  if (normalized === "default") {
    return resolveDefaultMarketSearchEngineId(store) || normalized;
  }
  if (normalized === "serpapi") {
    const serpApiEngineId = store.engines.find((item) => item.type === "serpapi" && item.enabled)?.id
      ?? store.engines.find((item) => item.type === "serpapi")?.id;
    return serpApiEngineId || normalized;
  }
  if (normalized === "qianfan") {
    const qianfanEngineId = store.engines.find((item) => item.type === "qianfan" && item.enabled)?.id
      ?? store.engines.find((item) => item.type === "qianfan")?.id;
    return qianfanEngineId || normalized;
  }
  if (store.engines.some((item) => item.id === normalized)) {
    return normalized;
  }
  return resolveDefaultMarketSearchEngineId(store) || normalized;
}

export function normalizeMarketPortfolio(portfolio: MarketPortfolio): MarketPortfolio {
  return {
    cash: Number.isFinite(Number(portfolio?.cash)) ? Number(portfolio.cash) : 0,
    funds: Array.isArray(portfolio?.funds) ? portfolio.funds.map((fund) => normalizeMarketFund(fund)) : []
  };
}

export function normalizeMarketAnalysisConfig(config: MarketAnalysisConfig): MarketAnalysisConfig {
  const timeoutMs = Number(config?.gptPlugin?.timeoutMs);
  const maxAgeDays = Number(config?.fund?.maxAgeDays);
  const featureLookbackDays = Number(config?.fund?.featureLookbackDays);
  const llmRetryMax = Number(config?.fund?.llmRetryMax);
  const newsQuerySuffix = typeof config?.fund?.newsQuerySuffix === "string"
    ? config.fund.newsQuerySuffix.trim()
    : DEFAULT_MARKET_ANALYSIS_CONFIG.fund.newsQuerySuffix;
  const riskLevel = config?.fund?.ruleRiskLevel === "low"
    ? "low"
    : config?.fund?.ruleRiskLevel === "high"
      ? "high"
      : "medium";

  return {
    version: 1,
    analysisEngine: normalizeMarketAnalysisEngine(config?.analysisEngine),
    searchEngine: normalizeMarketSearchEngine(config?.searchEngine),
    gptPlugin: {
      timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0
        ? Math.floor(timeoutMs)
        : DEFAULT_MARKET_ANALYSIS_CONFIG.gptPlugin.timeoutMs,
      fallbackToLocal: typeof config?.gptPlugin?.fallbackToLocal === "boolean"
        ? config.gptPlugin.fallbackToLocal
        : DEFAULT_MARKET_ANALYSIS_CONFIG.gptPlugin.fallbackToLocal
    },
    fund: {
      enabled: typeof config?.fund?.enabled === "boolean"
        ? config.fund.enabled
        : DEFAULT_MARKET_ANALYSIS_CONFIG.fund.enabled,
      maxAgeDays: Number.isFinite(maxAgeDays) && maxAgeDays > 0
        ? Math.floor(maxAgeDays)
        : DEFAULT_MARKET_ANALYSIS_CONFIG.fund.maxAgeDays,
      featureLookbackDays: Number.isFinite(featureLookbackDays) && featureLookbackDays > 0
        ? Math.floor(featureLookbackDays)
        : DEFAULT_MARKET_ANALYSIS_CONFIG.fund.featureLookbackDays,
      ruleRiskLevel: riskLevel,
      llmRetryMax: Number.isFinite(llmRetryMax) && llmRetryMax > 0
        ? Math.floor(llmRetryMax)
        : DEFAULT_MARKET_ANALYSIS_CONFIG.fund.llmRetryMax,
      newsQuerySuffix: newsQuerySuffix || DEFAULT_MARKET_ANALYSIS_CONFIG.fund.newsQuerySuffix
    }
  };
}

export function isValidMarketFund(fund: MarketFundHolding): boolean {
  return Boolean(fund.code);
}

export function isSameMarketFund(left: MarketFundHolding, right: MarketFundHolding): boolean {
  const leftQuantity = typeof left.quantity === "number" ? left.quantity : null;
  const rightQuantity = typeof right.quantity === "number" ? right.quantity : null;
  const leftAvgCost = typeof left.avgCost === "number" ? left.avgCost : null;
  const rightAvgCost = typeof right.avgCost === "number" ? right.avgCost : null;
  return left.code === right.code
    && left.name === right.name
    && leftQuantity === rightQuantity
    && leftAvgCost === rightAvgCost;
}

export function toMarketErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "unknown error");
}

function normalizeMarketAnalysisEngine(raw: unknown): string {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value || value === "local" || value === "default" || value === "auto") {
    return "local";
  }
  if (["gpt_plugin", "gpt-plugin", "gptplugin", "chatgpt-bridge", "chatgpt_bridge", "bridge"].includes(value)) {
    return "gpt_plugin";
  }
  if (value === "gemini") {
    return "gemini";
  }
  return value.replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "local";
}

function normalizeMarketSearchEngine(raw: unknown): string {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value || value === "default" || value === "auto" || value === "local") {
    return "default";
  }
  if (["serpapi", "serp-api", "serp_api", "google-news", "google_news"].includes(value)) {
    return "serpapi";
  }
  if (["qianfan", "baidu", "baidu-search", "baidu_search", "qianfan-baidu", "qianfan_baidu"].includes(value)) {
    return "qianfan";
  }
  return value.replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "default";
}

function resolveDefaultLlmProviderId(store: LLMProviderStore | null | undefined): string {
  if (!store || !Array.isArray(store.providers) || store.providers.length === 0) {
    return "";
  }
  if (store.providers.some((item) => item.id === store.defaultProviderId)) {
    return store.defaultProviderId;
  }
  return store.providers[0].id;
}

function resolveDefaultMarketSearchEngineId(store: SearchEngineStore | null | undefined): string {
  if (!store || !Array.isArray(store.engines) || store.engines.length === 0) {
    return "";
  }
  if (store.engines.some((item) => item.id === store.defaultEngineId)) {
    return store.defaultEngineId;
  }
  return store.engines[0].id;
}

function resolveModuleProviderId(
  normalizedEngine: string,
  store: LLMProviderStore | null | undefined,
  options: { allowGeminiLegacy?: boolean } = {}
): string {
  if (!store || !Array.isArray(store.providers) || store.providers.length === 0) {
    return normalizedEngine;
  }
  if (store.providers.some((item) => item.id === normalizedEngine)) {
    return normalizedEngine;
  }

  const defaultProviderId = resolveDefaultLlmProviderId(store);
  if (normalizedEngine === "local") {
    return defaultProviderId || normalizedEngine;
  }
  if (normalizedEngine === "gpt_plugin") {
    const gptPluginProviderId = store.providers.find((item) => item.type === "gpt-plugin")?.id;
    return gptPluginProviderId || defaultProviderId || normalizedEngine;
  }
  if (options.allowGeminiLegacy && normalizedEngine === "gemini") {
    return normalizedEngine;
  }
  return defaultProviderId || normalizedEngine;
}
