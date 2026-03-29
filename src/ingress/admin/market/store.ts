import { DATA_STORE, getStore, registerStore, setStore } from "../../../storage/persistence";
import {
  DEFAULT_MARKET_ANALYSIS_CONFIG,
  DEFAULT_MARKET_PORTFOLIO,
  MARKET_CONFIG_STORE,
  MARKET_PORTFOLIO_STORE,
  MARKET_STATE_STORE,
  MarketAnalysisConfig,
  MarketAnalysisEngine,
  MarketPhase,
  MarketPortfolio,
  MarketPortfolioFund,
  MarketRunSummary,
  MarketStateFile
} from "./types";
import {
  isNonNegativeNumber,
  normalizeMarketAnalysisEngine,
  normalizeMarketCode,
  normalizeMarketSearchEngine,
  parseMarketPhase,
  roundTo
} from "./common";
import { readSearchEngineStore } from "../../../integrations/search-engine/store";

export function ensureMarketStorage(): void {
  registerStore(MARKET_PORTFOLIO_STORE, () => DEFAULT_MARKET_PORTFOLIO);
  registerStore(MARKET_CONFIG_STORE, () => DEFAULT_MARKET_ANALYSIS_CONFIG);
  registerStore(MARKET_STATE_STORE, () => buildDefaultMarketState());
  registerStore(DATA_STORE.MARKET_RUNS, () => ({ version: 1, runs: {} }));
  readSearchEngineStore();
}

export function readMarketPortfolio(): MarketPortfolio {
  ensureMarketStorage();
  const parsed = getStore<unknown>(MARKET_PORTFOLIO_STORE);
  return normalizeMarketPortfolio(parsed);
}

export function readMarketAnalysisConfig(): MarketAnalysisConfig {
  ensureMarketStorage();
  const parsed = getStore<unknown>(MARKET_CONFIG_STORE);
  return normalizeMarketAnalysisConfig(parsed);
}

export function writeMarketPortfolio(portfolio: MarketPortfolio): void {
  ensureMarketStorage();
  setStore(MARKET_PORTFOLIO_STORE, normalizeMarketPortfolio(portfolio));
}

export function writeMarketAnalysisConfig(config: MarketAnalysisConfig): void {
  ensureMarketStorage();
  setStore(MARKET_CONFIG_STORE, normalizeMarketAnalysisConfig(config));
}

export function listMarketRunSummaries(limit: number, phase?: MarketPhase): MarketRunSummary[] {
  const state = readMarketStateFile();
  let summaries = state.recentRuns;

  if (summaries.length === 0) {
    summaries = loadMarketRunSummariesFromStore(Math.max(limit * 3, 24));
  }

  const filtered = phase ? summaries.filter((item) => item.phase === phase) : summaries.slice();

  filtered.sort((a, b) => {
    const left = Date.parse(a.createdAt);
    const right = Date.parse(b.createdAt);
    return (Number.isFinite(right) ? right : 0) - (Number.isFinite(left) ? left : 0);
  });

  return filtered.slice(0, limit);
}

export function normalizeMarketAnalysisConfig(input: unknown): MarketAnalysisConfig {
  const fallback = {
    ...DEFAULT_MARKET_ANALYSIS_CONFIG,
    gptPlugin: { ...DEFAULT_MARKET_ANALYSIS_CONFIG.gptPlugin },
    fund: { ...DEFAULT_MARKET_ANALYSIS_CONFIG.fund }
  };
  if (!input || typeof input !== "object") {
    return fallback;
  }

  const source = input as Record<string, unknown>;
  const engineRaw = typeof source.analysisEngine === "string" ? source.analysisEngine.trim().toLowerCase() : "";
  const analysisEngine: MarketAnalysisEngine = normalizeMarketAnalysisEngine(engineRaw);
  const searchEngineRaw = typeof source.searchEngine === "string" ? source.searchEngine.trim().toLowerCase() : "";
  const searchEngine = normalizeMarketSearchEngine(searchEngineRaw);
  const gptPlugin = source.gptPlugin && typeof source.gptPlugin === "object"
    ? source.gptPlugin as Record<string, unknown>
    : {};
  const timeoutMs = Number(gptPlugin.timeoutMs);
  const fallbackToLocal = typeof gptPlugin.fallbackToLocal === "boolean"
    ? gptPlugin.fallbackToLocal
    : undefined;
  const fund = source.fund && typeof source.fund === "object"
    ? source.fund as Record<string, unknown>
    : {};
  const fundEnabled = typeof fund.enabled === "boolean" ? fund.enabled : undefined;
  const maxAgeDays = Number(fund.maxAgeDays);
  const featureLookbackDays = Number(fund.featureLookbackDays);
  const llmRetryMax = Number(fund.llmRetryMax);
  const newsQuerySuffix = typeof fund.newsQuerySuffix === "string"
    ? fund.newsQuerySuffix.trim()
    : "";
  const ruleRiskLevelRaw = typeof fund.ruleRiskLevel === "string"
    ? fund.ruleRiskLevel.trim().toLowerCase()
    : "";
  const ruleRiskLevel: "low" | "medium" | "high" = ruleRiskLevelRaw === "low"
    ? "low"
    : ruleRiskLevelRaw === "high"
      ? "high"
      : "medium";

  return {
    version: 1,
    analysisEngine,
    searchEngine,
    gptPlugin: {
      timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0
        ? Math.floor(timeoutMs)
        : DEFAULT_MARKET_ANALYSIS_CONFIG.gptPlugin.timeoutMs,
      fallbackToLocal: fallbackToLocal ?? DEFAULT_MARKET_ANALYSIS_CONFIG.gptPlugin.fallbackToLocal
    },
    fund: {
      enabled: fundEnabled ?? DEFAULT_MARKET_ANALYSIS_CONFIG.fund.enabled,
      maxAgeDays: Number.isFinite(maxAgeDays) && maxAgeDays > 0
        ? Math.floor(maxAgeDays)
        : DEFAULT_MARKET_ANALYSIS_CONFIG.fund.maxAgeDays,
      featureLookbackDays: Number.isFinite(featureLookbackDays) && featureLookbackDays > 0
        ? Math.floor(featureLookbackDays)
        : DEFAULT_MARKET_ANALYSIS_CONFIG.fund.featureLookbackDays,
      ruleRiskLevel,
      llmRetryMax: Number.isFinite(llmRetryMax) && llmRetryMax > 0
        ? Math.floor(llmRetryMax)
        : DEFAULT_MARKET_ANALYSIS_CONFIG.fund.llmRetryMax,
      newsQuerySuffix: newsQuerySuffix || DEFAULT_MARKET_ANALYSIS_CONFIG.fund.newsQuerySuffix
    }
  };
}

export function normalizeMarketPortfolio(input: unknown): MarketPortfolio {
  if (!input || typeof input !== "object") {
    return {
      funds: [],
      cash: 0
    };
  }

  const source = input as Record<string, unknown>;
  const funds: MarketPortfolioFund[] = [];
  const rawFunds = Array.isArray(source.funds) ? source.funds : [];

  for (const item of rawFunds) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const value = item as Record<string, unknown>;
    const code = normalizeMarketCode(value.code);
    const name = typeof value.name === "string" ? value.name.trim() : "";
    if (!code) {
      continue;
    }

    const holding: MarketPortfolioFund = {
      code,
      name
    };

    const quantity = Number(value.quantity);
    if (Number.isFinite(quantity) && quantity > 0) {
      holding.quantity = roundTo(quantity, 4);
    }

    const avgCost = Number(value.avgCost);
    if (isNonNegativeNumber(avgCost)) {
      holding.avgCost = roundTo(avgCost, 4);
    }

    funds.push(holding);
  }

  const dedupMap = new Map<string, MarketPortfolioFund>();
  for (const item of funds) {
    dedupMap.set(item.code, item);
  }

  const cash = Number(source.cash);
  return {
    funds: Array.from(dedupMap.values()),
    cash: Number.isFinite(cash) && cash > 0 ? roundTo(cash, 4) : 0
  };
}

function readMarketStateFile(): MarketStateFile {
  ensureMarketStorage();
  const parsed = getStore<unknown>(MARKET_STATE_STORE);
  return normalizeMarketState(parsed);
}

function loadMarketRunSummariesFromStore(limit: number): MarketRunSummary[] {
  ensureMarketStorage();
  const parsed = getStore<unknown>(DATA_STORE.MARKET_RUNS);
  if (!parsed || typeof parsed !== "object") {
    return [];
  }

  const source = parsed as { runs?: unknown };
  const runs = source.runs && typeof source.runs === "object"
    ? source.runs as Record<string, unknown>
    : {};

  const summaries: MarketRunSummary[] = [];
  for (const [runId, run] of Object.entries(runs)) {
    if (!run || typeof run !== "object") {
      continue;
    }
    const summary = normalizeMarketRunSummaryFromRecord(run as Record<string, unknown>, runId);
    if (summary) {
      summaries.push(summary);
    }
  }

  summaries.sort((a, b) => {
    const left = Date.parse(a.createdAt);
    const right = Date.parse(b.createdAt);
    return (Number.isFinite(right) ? right : 0) - (Number.isFinite(left) ? left : 0);
  });

  return summaries.slice(0, limit);
}

function normalizeMarketRunSummaryFromRecord(
  parsed: Record<string, unknown>,
  fallbackId: string
): MarketRunSummary | null {
  const phase = parseMarketPhase(parsed.phase);
  if (!phase) {
    return null;
  }

  const signalResult = parsed.signalResult && typeof parsed.signalResult === "object"
    ? parsed.signalResult as Record<string, unknown>
    : {};
  const assetSignals = Array.isArray(signalResult.assetSignals)
    ? signalResult.assetSignals
    : [];

  const compactSignals = assetSignals
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const value = item as Record<string, unknown>;
      const code = typeof value.code === "string" ? value.code : "";
      const signal = typeof value.signal === "string" ? value.signal : "";
      if (!code || !signal) {
        return null;
      }
      return { code, signal };
    })
    .filter((item): item is { code: string; signal: string } => Boolean(item));

  const explanation = parsed.explanation && typeof parsed.explanation === "object"
    ? parsed.explanation as Record<string, unknown>
    : {};

  return {
    id: typeof parsed.id === "string" ? parsed.id : fallbackId,
    createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : "",
    phase,
    marketState: typeof signalResult.marketState === "string" ? signalResult.marketState : "",
    comparisonReference: typeof signalResult.comparisonReference === "string" ? signalResult.comparisonReference : "",
    assetSignalCount: compactSignals.length,
    signals: compactSignals.slice(0, 8),
    explanationSummary: typeof explanation.summary === "string" ? explanation.summary : ""
  };
}

function buildDefaultMarketState(): MarketStateFile {
  return {
    version: 1,
    latestRunId: "",
    latestByPhase: {
      midday: null,
      close: null
    },
    recentRuns: [],
    updatedAt: ""
  };
}

function normalizeMarketState(input: unknown): MarketStateFile {
  const fallback = buildDefaultMarketState();
  if (!input || typeof input !== "object") {
    return fallback;
  }

  const source = input as Record<string, unknown>;
  const recent = Array.isArray(source.recentRuns) ? source.recentRuns : [];
  const normalizedRuns = recent
    .map((item) => normalizeMarketRunSummary(item))
    .filter((item): item is MarketRunSummary => Boolean(item));

  return {
    version: 1,
    latestRunId: typeof source.latestRunId === "string" ? source.latestRunId : "",
    latestByPhase: {
      midday: normalizeMarketPhasePointer(source.latestByPhase, "midday"),
      close: normalizeMarketPhasePointer(source.latestByPhase, "close")
    },
    recentRuns: normalizedRuns,
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : ""
  };
}

function normalizeMarketPhasePointer(
  input: unknown,
  phase: MarketPhase
): { id: string; createdAt: string; file?: string } | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const source = input as Record<string, unknown>;
  const raw = source[phase];
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const value = raw as Record<string, unknown>;
  const id = typeof value.id === "string" ? value.id : "";
  const createdAt = typeof value.createdAt === "string" ? value.createdAt : "";
  if (!id || !createdAt) {
    return null;
  }

  const file = typeof value.file === "string" ? value.file : undefined;
  return file ? { id, createdAt, file } : { id, createdAt };
}

function normalizeMarketRunSummary(input: unknown): MarketRunSummary | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const source = input as Record<string, unknown>;
  const phase = parseMarketPhase(source.phase);
  if (!phase) {
    return null;
  }

  const id = typeof source.id === "string" ? source.id.trim() : "";
  if (!id) {
    return null;
  }

  const signals = Array.isArray(source.signals)
    ? source.signals
        .map((item) => {
          if (!item || typeof item !== "object") {
            return null;
          }
          const value = item as Record<string, unknown>;
          const code = typeof value.code === "string" ? value.code : "";
          const signal = typeof value.signal === "string" ? value.signal : "";
          if (!code || !signal) {
            return null;
          }
          return { code, signal };
        })
        .filter((item): item is { code: string; signal: string } => Boolean(item))
    : [];

  return {
    id,
    createdAt: typeof source.createdAt === "string" ? source.createdAt : "",
    phase,
    marketState: typeof source.marketState === "string" ? source.marketState : "",
    comparisonReference: typeof source.comparisonReference === "string" ? source.comparisonReference : "",
    assetSignalCount: Number.isFinite(Number(source.assetSignalCount))
      ? Math.max(0, Math.floor(Number(source.assetSignalCount)))
      : signals.length,
    signals,
    explanationSummary: typeof source.explanationSummary === "string" ? source.explanationSummary : "",
    file: typeof source.file === "string" ? source.file : undefined
  };
}
