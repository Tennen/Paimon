import test from "node:test";
import assert from "node:assert/strict";
import { buildFundFeatureContext } from "./fund_feature_engine";
import { evaluateFundRules } from "./fund_rule_engine";
import { buildFallbackFundDashboard, validateFundDecisionDashboard } from "./fund_schema";
import { CodexLLMEngine } from "../../engines/llm/codex";
import { runFundAnalysis } from "./fund_analysis_service";
import { FundRawContext, MarketAnalysisConfig } from "./fund_types";

const baseConfig: MarketAnalysisConfig = {
  version: 1,
  assetType: "fund",
  analysisEngine: "local",
  searchEngine: "default",
  gptPlugin: {
    timeoutMs: 20000,
    fallbackToLocal: true
  },
  fund: {
    enabled: true,
    maxAgeDays: 3,
    featureLookbackDays: 120,
    ruleRiskLevel: "medium",
    llmRetryMax: 1,
    newsQuerySuffix: "基金 公告 经理 申赎 风险"
  }
};

function buildRawContext(partial?: Partial<FundRawContext>): FundRawContext {
  return {
    identity: {
      fund_code: "510300",
      fund_name: "沪深300ETF",
      market: "sh",
      currency: "CNY",
      account_position: {
        quantity: 100,
        avg_cost: 4
      },
      fund_type: "etf",
      strategy_type: "index",
      tradable: "intraday",
      source_chain: ["unit_test"],
      errors: []
    },
    as_of_date: "2026-03-15",
    price_or_nav_series: [
      { date: "2026-02-01", value: 3.8, volume: 1000000 },
      { date: "2026-02-02", value: 3.9, volume: 1200000 },
      { date: "2026-02-03", value: 4.0, volume: 1300000 },
      { date: "2026-02-04", value: 4.1, volume: 1500000 },
      { date: "2026-02-05", value: 4.2, volume: 1600000 },
      { date: "2026-02-06", value: 4.25, volume: 1700000 },
      { date: "2026-02-07", value: 4.3, volume: 1750000 },
      { date: "2026-02-08", value: 4.4, volume: 1800000 },
      { date: "2026-02-09", value: 4.35, volume: 1720000 },
      { date: "2026-02-10", value: 4.45, volume: 1820000 },
      { date: "2026-02-11", value: 4.5, volume: 1840000 },
      { date: "2026-02-12", value: 4.55, volume: 1870000 },
      { date: "2026-02-13", value: 4.48, volume: 1790000 },
      { date: "2026-02-14", value: 4.62, volume: 1900000 },
      { date: "2026-02-15", value: 4.68, volume: 1940000 },
      { date: "2026-02-16", value: 4.72, volume: 1980000 },
      { date: "2026-02-17", value: 4.75, volume: 2010000 },
      { date: "2026-02-18", value: 4.8, volume: 2060000 },
      { date: "2026-02-19", value: 4.9, volume: 2120000 },
      { date: "2026-02-20", value: 4.95, volume: 2140000 },
      { date: "2026-02-21", value: 5.02, volume: 2170000 }
    ],
    benchmark_series: [
      { date: "2026-02-01", value: 3500 },
      { date: "2026-02-02", value: 3510 },
      { date: "2026-02-03", value: 3520 },
      { date: "2026-02-04", value: 3535 },
      { date: "2026-02-05", value: 3542 },
      { date: "2026-02-06", value: 3548 },
      { date: "2026-02-07", value: 3555 },
      { date: "2026-02-08", value: 3563 },
      { date: "2026-02-09", value: 3558 },
      { date: "2026-02-10", value: 3574 },
      { date: "2026-02-11", value: 3580 },
      { date: "2026-02-12", value: 3584 },
      { date: "2026-02-13", value: 3575 },
      { date: "2026-02-14", value: 3596 },
      { date: "2026-02-15", value: 3608 },
      { date: "2026-02-16", value: 3615 },
      { date: "2026-02-17", value: 3623 },
      { date: "2026-02-18", value: 3634 },
      { date: "2026-02-19", value: 3650 },
      { date: "2026-02-20", value: 3662 },
      { date: "2026-02-21", value: 3670 }
    ],
    benchmark_code: "000300",
    holdings_style: {
      top_holdings: [],
      sector_exposure: {},
      style_factor_exposure: {},
      duration_credit_profile: {}
    },
    events: {
      notices: [],
      manager_changes: [],
      subscription_redemption: [],
      regulatory_risks: [],
      market_news: []
    },
    account_context: {
      current_position: 100,
      avg_cost: 4,
      budget: 1000,
      risk_preference: "balanced",
      holding_horizon: "medium_term"
    },
    source_chain: ["unit_test"],
    errors: [],
    ...(partial || {})
  };
}

test("feature engine should output coverage for valid series", () => {
  const raw = buildRawContext();
  const feature = buildFundFeatureContext(raw);

  assert.equal(feature.coverage === "ok" || feature.coverage === "partial", true);
  assert.equal(typeof feature.returns.ret_20d === "number", true);
  assert.equal(typeof feature.risk.max_drawdown === "number", true);
});

test("rule engine should block buy/add when data stale or insufficient", () => {
  const raw = buildRawContext({
    as_of_date: "2020-01-01",
    price_or_nav_series: []
  });
  const feature = buildFundFeatureContext(raw);
  const rules = evaluateFundRules({
    raw,
    features: feature,
    analysisConfig: baseConfig
  });

  assert.equal(rules.blocked_actions.includes("buy"), true);
  assert.equal(rules.blocked_actions.includes("add"), true);
  assert.equal(rules.rule_flags.includes("data_stale"), true);
});

test("dashboard validation should fallback missing required fields", () => {
  const fallback = buildFallbackFundDashboard({
    fundCode: "510300",
    fundName: "沪深300ETF",
    asOfDate: "2026-03-15",
    featureCoverage: "partial",
    adjustedScore: 55,
    ruleFlags: [],
    blockedActions: [],
    insufficient: false,
    missingFields: []
  });

  const result = validateFundDecisionDashboard({
    decision_type: "add"
  }, fallback);

  assert.equal(result.isValid, true);
  assert.equal(result.dashboard.fund_code, "510300");
  assert.equal(result.dashboard.decision_type, "add");
});

test("runFundAnalysis should stop LLM retries after timeout-like error", { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  const originalNewsContext = process.env.MARKET_ANALYSIS_NEWS_CONTEXT;
  const originalModel = process.env.MARKET_ANALYSIS_LLM_MODEL;
  const originalChat = CodexLLMEngine.prototype.chat;

  let llmCalls = 0;

  try {
    process.env.MARKET_ANALYSIS_NEWS_CONTEXT = "unit test static news";
    process.env.MARKET_ANALYSIS_LLM_MODEL = "gpt-5-codex";

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("push2.eastmoney.com/api/qt/stock/get")) return createJsonResponse({ data: { f43: 4.36, f47: 1234567 } });
      if (url.includes("push2his.eastmoney.com/api/qt/stock/kline/get")) return createJsonResponse({ data: { klines: buildMockKlines() } });
      throw new Error(`unexpected fetch url in test: ${url}`);
    }) as typeof fetch;

    (CodexLLMEngine.prototype as unknown as { chat: () => Promise<string> }).chat = async () => {
      llmCalls += 1;
      throw new Error("codex timeout after 15000ms");
    };

    const result = await runFundAnalysis({
      phase: "close",
      withExplanation: true,
      portfolio: {
        funds: [{ code: "510300", name: "沪深300ETF", quantity: 100, avgCost: 4 }],
        cash: 1000
      },
      analysisConfig: {
        ...baseConfig,
        analysisEngine: "codex",
        fund: { ...baseConfig.fund, llmRetryMax: 3 }
      }
    });

    const errors = result.marketData.funds[0]?.llm_errors || [];
    assert.equal(llmCalls, 1);
    assert.equal(errors.includes("attempt_1: timeout_retry_strategy=stop_after_timeout"), true);
    assert.equal(errors.some((item) => item.toLowerCase().includes("codex timeout after 15000ms")), true);
    assert.equal(errors.some((item) => item.startsWith("attempt_2:")), false);

    const llmStep = result.signalResult.audit.steps.find((step) => step.step === "llm:510300");
    assert.equal(Boolean(llmStep), true);
    assert.equal((llmStep?.errors || []).some((item) => item.startsWith("attempt_2:")), false);
  } finally {
    CodexLLMEngine.prototype.chat = originalChat;
    globalThis.fetch = originalFetch;
    if (originalNewsContext === undefined) {
      delete process.env.MARKET_ANALYSIS_NEWS_CONTEXT;
    } else {
      process.env.MARKET_ANALYSIS_NEWS_CONTEXT = originalNewsContext;
    }
    if (originalModel === undefined) {
      delete process.env.MARKET_ANALYSIS_LLM_MODEL;
    } else {
      process.env.MARKET_ANALYSIS_LLM_MODEL = originalModel;
    }
  }
});

function buildMockKlines(): string[] {
  return Array.from({ length: 40 }, (_, index) => {
    const day = index + 1;
    return `2026-02-${String(day).padStart(2, "0")},0,${(4 + day * 0.01).toFixed(4)},0,0,${1_000_000 + day * 10_000}`;
  });
}

function createJsonResponse(payload: unknown): Response {
  return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) } as Response;
}
