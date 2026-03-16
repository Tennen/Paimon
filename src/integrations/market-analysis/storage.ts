// @ts-nocheck
import { getStore, registerStore, setStore } from "../../storage/persistence";
import {
  DEFAULT_ANALYSIS_CONFIG,
  MARKET_CONFIG_STORE,
  MARKET_PORTFOLIO_STORE,
  MARKET_RUNS_STORE,
  MARKET_STATE_STORE
} from "./defaults";
import { normalizeAssetName, normalizeCode, parsePositiveInteger, round, toNumber } from "./utils";

export function persistRun(input) {
  ensureStorage();

  const now = new Date();
  const timestamp = now.toISOString();
  const id = `market-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`;

  const run = {
    id,
    createdAt: timestamp,
    phase: input.phase,
    portfolioSnapshot: input.portfolio,
    marketSnapshot: input.marketData,
    signalResult: input.signalResult,
    explanation: input.explanation,
    optionalNewsContext: input.optionalNewsContext
  };

  const runsStore = readRunsStore();
  runsStore.runs[id] = run;
  runsStore.runs = pruneRunsByCreatedAt(runsStore.runs, 120);
  setStore(MARKET_RUNS_STORE, runsStore);

  const summary = summarizeRun(run);

  const state = readState();
  state.latestRunId = id;
  state.latestByPhase = state.latestByPhase || { midday: null, close: null };
  state.latestByPhase[input.phase] = {
    id,
    createdAt: timestamp
  };
  state.recentRuns = [summary]
    .concat(Array.isArray(state.recentRuns) ? state.recentRuns : [])
    .filter((item, idx, arr) => {
      if (!item || typeof item !== "object") return false;
      const runId = String(item.id || "");
      if (!runId) return false;
      return arr.findIndex((candidate) => candidate && candidate.id === runId) === idx;
    })
    .slice(0, 80);
  state.updatedAt = timestamp;

  setStore(MARKET_STATE_STORE, state);

  return {
    id,
    createdAt: timestamp,
    summary
  };
}

export function summarizeRun(run) {
  const signals = Array.isArray(run.signalResult && run.signalResult.assetSignals)
    ? run.signalResult.assetSignals
    : [];

  return {
    id: run.id,
    createdAt: run.createdAt,
    phase: run.phase,
    marketState: run.signalResult ? run.signalResult.marketState : "",
    benchmark: run.signalResult ? run.signalResult.benchmark : "",
    assetSignalCount: signals.length,
    signals: signals.slice(0, 8).map((item) => ({
      code: item.code,
      signal: item.signal
    })),
    explanationSummary: run.explanation && typeof run.explanation.summary === "string"
      ? run.explanation.summary
      : ""
  };
}

export function readPortfolio() {
  ensureStorage();
  const parsed = getStore(MARKET_PORTFOLIO_STORE);
  const normalized = normalizePortfolio(parsed);
  return normalized;
}

export function addPortfolioHolding(holdingInput) {
  ensureStorage();

  const code = normalizeCode(holdingInput && holdingInput.code);
  const quantity = toNumber(holdingInput && holdingInput.quantity);
  const avgCost = toNumber(holdingInput && holdingInput.avgCost);
  const name = normalizeAssetName(holdingInput && holdingInput.name);

  if (!code) {
    throw new Error("持仓代码无效。");
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("持仓数量必须是大于 0 的数字。");
  }
  if (!Number.isFinite(avgCost) || avgCost < 0) {
    throw new Error("持仓成本必须是大于等于 0 的数字。");
  }

  const portfolio = readPortfolio();
  const funds = Array.isArray(portfolio.funds) ? portfolio.funds.slice() : [];
  const index = funds.findIndex((item) => item && item.code === code);

  let action = "added";
  let updatedHolding = null;

  if (index >= 0) {
    const existing = funds[index];
    const existingQuantityValue = toNumber(existing.quantity);
    const existingAvgCostValue = toNumber(existing.avgCost);
    const existingQuantity = Number.isFinite(existingQuantityValue) && existingQuantityValue > 0
      ? existingQuantityValue
      : 0;
    const existingAvgCost = Number.isFinite(existingAvgCostValue) && existingAvgCostValue >= 0
      ? existingAvgCostValue
      : 0;
    const nextQuantity = round(existingQuantity + quantity, 4);
    const nextAvgCost = nextQuantity > 0
      ? round(((existingQuantity * existingAvgCost) + (quantity * avgCost)) / nextQuantity, 4)
      : round(avgCost, 4);

    updatedHolding = {
      code,
      name: name || normalizeAssetName(existing.name),
      quantity: nextQuantity,
      avgCost: nextAvgCost
    };
    funds[index] = updatedHolding;
    action = "updated";
  } else {
    updatedHolding = {
      code,
      name,
      quantity: round(quantity, 4),
      avgCost: round(avgCost, 4)
    };
    funds.push(updatedHolding);
  }

  const nextPortfolio = normalizePortfolio({
    ...portfolio,
    funds
  });
  setStore(MARKET_PORTFOLIO_STORE, nextPortfolio);

  const normalizedHolding = nextPortfolio.funds.find((item) => item.code === code) || updatedHolding;
  return {
    action,
    holding: normalizedHolding,
    portfolio: nextPortfolio
  };
}

export function readAnalysisConfig() {
  ensureStorage();
  const parsed = getStore(MARKET_CONFIG_STORE);
  const normalized = normalizeAnalysisConfig(parsed);
  return normalized;
}

export function readState() {
  ensureStorage();
  const parsed = getStore(MARKET_STATE_STORE);
  if (!parsed || typeof parsed !== "object") {
    return buildDefaultState();
  }
  return {
    version: 1,
    latestRunId: typeof parsed.latestRunId === "string" ? parsed.latestRunId : "",
    latestByPhase: {
      midday: parsed.latestByPhase && parsed.latestByPhase.midday ? parsed.latestByPhase.midday : null,
      close: parsed.latestByPhase && parsed.latestByPhase.close ? parsed.latestByPhase.close : null
    },
    recentRuns: Array.isArray(parsed.recentRuns) ? parsed.recentRuns : [],
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : ""
  };
}

export function readRunsStore() {
  ensureStorage();
  const parsed = getStore(MARKET_RUNS_STORE);
  if (!parsed || typeof parsed !== "object") {
    return buildDefaultRunsStore();
  }
  const runs = parsed.runs && typeof parsed.runs === "object"
    ? parsed.runs
    : {};
  return {
    version: 1,
    runs
  };
}

export function pruneRunsByCreatedAt(input, maxSize) {
  const entries = Object.entries(input || {});
  entries.sort((left, right) => {
    const leftRun = left[1] && typeof left[1] === "object" ? left[1] : {};
    const rightRun = right[1] && typeof right[1] === "object" ? right[1] : {};
    const leftTime = Date.parse(leftRun.createdAt || "");
    const rightTime = Date.parse(rightRun.createdAt || "");
    return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
  });

  const next = {};
  for (const [runId, run] of entries.slice(0, Math.max(1, maxSize))) {
    next[runId] = run;
  }
  return next;
}

export function normalizePortfolio(input) {
  const funds = [];
  const rawFunds = input && Array.isArray(input.funds) ? input.funds : [];

  for (const item of rawFunds) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const code = normalizeCode(item.code);
    const name = normalizeAssetName(item.name);
    const quantity = toNumber(item.quantity);
    const avgCost = toNumber(item.avgCost);

    if (!code) {
      continue;
    }

    const normalized = {
      code,
      name
    };
    if (Number.isFinite(quantity) && quantity > 0) {
      normalized.quantity = round(quantity, 4);
    }
    if (Number.isFinite(avgCost) && avgCost >= 0) {
      normalized.avgCost = round(avgCost, 4);
    }

    funds.push(normalized);
  }

  const dedup = new Map();
  for (const item of funds) {
    dedup.set(item.code, item);
  }

  const cash = Math.max(0, round(toNumber(input && input.cash), 4));

  return {
    funds: Array.from(dedup.values()),
    cash
  };
}

export function normalizeAnalysisConfig(input) {
  const source = (input && typeof input === "object") ? input : {};
  const assetTypeRaw = typeof source.assetType === "string"
    ? source.assetType.trim().toLowerCase()
    : "";
  const assetType = assetTypeRaw === "fund" ? "fund" : "equity";

  const engineRaw = typeof source.analysisEngine === "string"
    ? source.analysisEngine.trim().toLowerCase()
    : "";
  const analysisEngine = normalizeMarketAnalysisEngine(engineRaw);

  const gptPlugin = source.gptPlugin && typeof source.gptPlugin === "object"
    ? source.gptPlugin
    : {};
  const timeoutMs = parsePositiveInteger(gptPlugin.timeoutMs, DEFAULT_ANALYSIS_CONFIG.gptPlugin.timeoutMs);
  const fallbackFlag = String(gptPlugin.fallbackToLocal ?? DEFAULT_ANALYSIS_CONFIG.gptPlugin.fallbackToLocal)
    .trim()
    .toLowerCase();
  const fallbackToLocal = !(fallbackFlag === "false" || fallbackFlag === "0" || fallbackFlag === "off");

  const fund = source.fund && typeof source.fund === "object"
    ? source.fund
    : {};
  const enabledFlag = String(fund.enabled ?? DEFAULT_ANALYSIS_CONFIG.fund.enabled)
    .trim()
    .toLowerCase();
  const enabled = !(enabledFlag === "false" || enabledFlag === "0" || enabledFlag === "off");
  const maxAgeDays = parsePositiveInteger(fund.maxAgeDays, DEFAULT_ANALYSIS_CONFIG.fund.maxAgeDays);
  const featureLookbackDays = parsePositiveInteger(
    fund.featureLookbackDays,
    DEFAULT_ANALYSIS_CONFIG.fund.featureLookbackDays
  );
  const llmRetryMax = parsePositiveInteger(fund.llmRetryMax, DEFAULT_ANALYSIS_CONFIG.fund.llmRetryMax);
  const riskRaw = typeof fund.ruleRiskLevel === "string"
    ? fund.ruleRiskLevel.trim().toLowerCase()
    : "";
  const ruleRiskLevel = ["low", "medium", "high"].includes(riskRaw)
    ? riskRaw
    : DEFAULT_ANALYSIS_CONFIG.fund.ruleRiskLevel;

  return {
    version: 1,
    assetType,
    analysisEngine,
    gptPlugin: {
      timeoutMs,
      fallbackToLocal
    },
    fund: {
      enabled,
      maxAgeDays,
      featureLookbackDays,
      ruleRiskLevel,
      llmRetryMax
    }
  };
}

function normalizeMarketAnalysisEngine(raw: string): string {
  const value = String(raw || "").trim().toLowerCase();
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

export function buildDefaultState() {
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

export function buildDefaultRunsStore() {
  return {
    version: 1,
    runs: {}
  };
}

export function ensureStorage() {
  registerStore(MARKET_PORTFOLIO_STORE, () => ({
    funds: [],
    cash: 0
  }));
  registerStore(MARKET_CONFIG_STORE, () => normalizeAnalysisConfig(DEFAULT_ANALYSIS_CONFIG));
  registerStore(MARKET_STATE_STORE, () => buildDefaultState());
  registerStore(MARKET_RUNS_STORE, () => buildDefaultRunsStore());
}
