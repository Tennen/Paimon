import test from "node:test";
import assert from "node:assert/strict";
import { buildFundFeatureContext } from "./fund_feature_engine";
import { evaluateFundRules } from "./fund_rule_engine";
import { buildFallbackFundDashboard, validateFundDecisionDashboard } from "./fund_schema";
import { CodexLLMEngine } from "../../../engines/llm/codex";
import { runFundAnalysis } from "./fund_analysis_service";
import { FundRawContext, MarketAnalysisConfig } from "./fund_types";

const baseConfig: MarketAnalysisConfig = {
  version: 1,
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
  const peerPercentileSeries = Array.from({ length: 21 }, (_, index) => ({
    date: `2026-02-${String(index + 1).padStart(2, "0")}`,
    value: Number((62 + index * 1.02).toFixed(2))
  }));

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
      { date: "2026-02-01", value: 3.8 },
      { date: "2026-02-02", value: 3.9 },
      { date: "2026-02-03", value: 4.0 },
      { date: "2026-02-04", value: 4.1 },
      { date: "2026-02-05", value: 4.2 },
      { date: "2026-02-06", value: 4.25 },
      { date: "2026-02-07", value: 4.3 },
      { date: "2026-02-08", value: 4.4 },
      { date: "2026-02-09", value: 4.35 },
      { date: "2026-02-10", value: 4.45 },
      { date: "2026-02-11", value: 4.5 },
      { date: "2026-02-12", value: 4.55 },
      { date: "2026-02-13", value: 4.48 },
      { date: "2026-02-14", value: 4.62 },
      { date: "2026-02-15", value: 4.68 },
      { date: "2026-02-16", value: 4.72 },
      { date: "2026-02-17", value: 4.75 },
      { date: "2026-02-18", value: 4.8 },
      { date: "2026-02-19", value: 4.9 },
      { date: "2026-02-20", value: 4.95 },
      { date: "2026-02-21", value: 5.02 }
    ],
    holdings_style: {
      top_holdings: ["贵州茅台(9.80%)", "宁德时代(8.12%)"],
      sector_exposure: {},
      style_factor_exposure: {},
      duration_credit_profile: {}
    },
    reference_context: {
      comparison_reference: "同类基金百分位",
      estimated_nav: 5.03,
      estimated_nav_date: "2026-02-21",
      estimated_nav_time: "14:35:00",
      estimated_change_pct: 0.8,
      peer_percentile: 82.4,
      peer_rank_position: 18,
      peer_rank_total: 220,
      peer_percentile_series: peerPercentileSeries,
      current_managers: ["张三", "李四"]
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
      if (url.includes("fundgz.1234567.com.cn/js/510300.js")) return createTextResponse(buildFundEstimateScript());
      if (url.includes("fundf10.eastmoney.com/F10DataApi.aspx")) return createTextResponse(buildFundHistoryPayload(buildMockFundHistoryRows()));
      if (url.includes("fundf10.eastmoney.com/FundArchivesDatas.aspx")) return createTextResponse(buildFundHoldingsPayload());
      if (url.includes("fund.eastmoney.com/pingzhongdata/510300.js")) return createTextResponse(buildPingzhongdataScript());
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

test("runFundAnalysis should skip a fund when base history data fetch fails and log the base data error", { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const originalChat = CodexLLMEngine.prototype.chat;

  const errorLogs: string[] = [];
  let llmCalls = 0;

  try {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("fundgz.1234567.com.cn/js/510300.js")) return createTextResponse(buildFundEstimateScript());
      if (url.includes("fundf10.eastmoney.com/F10DataApi.aspx")) throw new Error("fund history endpoint failed");
      if (url.includes("fundf10.eastmoney.com/FundArchivesDatas.aspx")) return createTextResponse(buildFundHoldingsPayload());
      if (url.includes("fund.eastmoney.com/pingzhongdata/510300.js")) throw new Error("pingzhongdata endpoint failed");
      throw new Error(`unexpected fetch url in test: ${url}`);
    }) as typeof fetch;

    console.error = (...args: unknown[]) => {
      errorLogs.push(args.map((item) => String(item)).join(" "));
    };

    (CodexLLMEngine.prototype as unknown as { chat: () => Promise<string> }).chat = async () => {
      llmCalls += 1;
      return JSON.stringify({});
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
        analysisEngine: "codex"
      }
    });

    const fund = result.marketData.funds[0];
    const dashboard = result.explanation.dashboards[0];
    const auditSteps = result.signalResult.audit.steps.map((step) => step.step);

    assert.equal(llmCalls, 0);
    assert.equal(fund.raw_context.price_or_nav_series.length, 0);
    assert.equal(fund.raw_context.errors.includes("base_fund_series_unavailable"), true);
    assert.equal(fund.raw_context.errors.includes("fund history endpoint failed"), true);
    assert.equal(fund.raw_context.errors.includes("pingzhongdata endpoint failed"), true);
    assert.equal(fund.feature_context.coverage, "insufficient");
    assert.deepEqual(fund.rule_context.rule_flags, []);
    assert.deepEqual(fund.rule_context.blocked_actions, []);
    assert.equal(fund.llm_provider, "base_data_skip");
    assert.equal(dashboard.decision_type, "watch");
    assert.deepEqual(dashboard.risk_alerts, []);
    assert.equal(dashboard.core_conclusion.one_sentence, "基础行情数据获取失败，本次跳过该基金分析。");
    assert.equal(auditSteps.includes("ingestion:510300"), true);
    assert.equal(auditSteps.includes("skip:510300"), true);
    assert.equal(auditSteps.includes("feature:510300"), false);
    assert.equal(auditSteps.includes("rule:510300"), false);
    assert.equal(auditSteps.includes("llm:510300"), false);
    assert.deepEqual(result.optionalNewsContext.funds[0]?.market_news || [], []);
    assert.equal(
      errorLogs.some((line) =>
        line.includes("[MarketAnalysis][fund][base_data] failed fund=沪深300ETF(510300)")
        && line.includes("fund history endpoint failed")
      ),
      true
    );
  } finally {
    CodexLLMEngine.prototype.chat = originalChat;
    console.error = originalError;
    globalThis.fetch = originalFetch;
  }
});

test("runFundAnalysis should continue when fund estimate fetch fails but fund history is available", { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("fundgz.1234567.com.cn/js/510300.js")) throw new Error("fund estimate endpoint failed");
      if (url.includes("fundf10.eastmoney.com/F10DataApi.aspx")) return createTextResponse(buildFundHistoryPayload(buildMockFundHistoryRows()));
      if (url.includes("fundf10.eastmoney.com/FundArchivesDatas.aspx")) return createTextResponse(buildFundHoldingsPayload());
      if (url.includes("fund.eastmoney.com/pingzhongdata/510300.js")) return createTextResponse(buildPingzhongdataScript());
      throw new Error(`unexpected fetch url in test: ${url}`);
    }) as typeof fetch;

    const result = await runFundAnalysis({
      phase: "close",
      withExplanation: false,
      portfolio: {
        funds: [{ code: "510300", name: "沪深300ETF", quantity: 100, avgCost: 4 }],
        cash: 1000
      },
      analysisConfig: baseConfig
    });

    const fund = result.marketData.funds[0];
    const auditSteps = result.signalResult.audit.steps.map((step) => step.step);

    assert.equal(fund.raw_context.price_or_nav_series.length > 0, true);
    assert.equal(fund.raw_context.errors.includes("base_fund_series_unavailable"), false);
    assert.equal(fund.raw_context.reference_context.estimated_nav, undefined);
    assert.deepEqual(fund.raw_context.holdings_style.top_holdings, ["贵州茅台(9.80%)", "宁德时代(8.12%)"]);
    assert.equal(fund.llm_provider, "rule_template");
    assert.equal(auditSteps.includes("feature:510300"), true);
    assert.equal(auditSteps.includes("rule:510300"), true);
    assert.equal(auditSteps.includes("skip:510300"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runFundAnalysis should use peer percentile reference without requesting legacy stock reference endpoints", { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;

  const errorLogs: string[] = [];
  const requestedUrls: string[] = [];

  try {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      requestedUrls.push(url);
      if (url.includes("fundgz.1234567.com.cn/js/510300.js")) return createTextResponse(buildFundEstimateScript());
      if (url.includes("fundf10.eastmoney.com/F10DataApi.aspx")) return createTextResponse(buildFundHistoryPayload(buildMockFundHistoryRows()));
      if (url.includes("fundf10.eastmoney.com/FundArchivesDatas.aspx")) return createTextResponse(buildFundHoldingsPayload());
      if (url.includes("fund.eastmoney.com/pingzhongdata/510300.js")) return createTextResponse(buildPingzhongdataScript());
      throw new Error(`unexpected fetch url in test: ${url}`);
    }) as typeof fetch;

    console.error = (...args: unknown[]) => {
      errorLogs.push(args.map((item) => String(item)).join(" "));
    };

    const result = await runFundAnalysis({
      phase: "close",
      withExplanation: false,
      portfolio: {
        funds: [{ code: "510300", name: "沪深300ETF", quantity: 100, avgCost: 4 }],
        cash: 1000
      },
      analysisConfig: baseConfig
    });

    const fund = result.marketData.funds[0];
    const auditSteps = result.signalResult.audit.steps.map((step) => step.step);

    assert.equal(
      requestedUrls.every((url) => (
        url.startsWith("https://fundgz.1234567.com.cn/js/510300.js")
        || url.startsWith("https://fundf10.eastmoney.com/F10DataApi.aspx")
        || url.startsWith("https://fundf10.eastmoney.com/FundArchivesDatas.aspx")
        || url.startsWith("https://fund.eastmoney.com/pingzhongdata/510300.js")
      )),
      true
    );
    assert.equal(fund.raw_context.price_or_nav_series.length > 0, true);
    assert.equal(fund.raw_context.reference_context.comparison_reference, "同类基金百分位");
    assert.equal(fund.raw_context.reference_context.peer_percentile, 78.4);
    assert.equal(fund.raw_context.reference_context.peer_rank_position, 15);
    assert.equal(fund.raw_context.reference_context.peer_rank_total, 240);
    assert.equal(fund.raw_context.reference_context.peer_percentile_series.length > 0, true);
    assert.equal(result.signalResult.comparisonReference, "同类基金百分位");
    assert.equal(auditSteps.includes("feature:510300"), true);
    assert.equal(auditSteps.includes("rule:510300"), true);
    assert.equal(errorLogs.length, 0);
  } finally {
    console.error = originalError;
    globalThis.fetch = originalFetch;
  }
});

function buildMockFundHistoryRows(): Array<{
  date: string;
  unit_nav: string;
  cumulative_nav: string;
  daily_growth: string;
  purchase_status: string;
  redemption_status: string;
  dividend: string;
}> {
  return Array.from({ length: 40 }, (_, index) => {
    const day = index + 1;
    const value = (4 + day * 0.01).toFixed(4);
    return {
      date: `2026-02-${String(day).padStart(2, "0")}`,
      unit_nav: value,
      cumulative_nav: (5 + day * 0.01).toFixed(4),
      daily_growth: "0.35%",
      purchase_status: day === 40 ? "限大额" : "开放申购",
      redemption_status: "开放赎回",
      dividend: day === 38 ? "每份派现金0.02元" : "--"
    };
  });
}

function buildFundHistoryPayload(rows: Array<{
  date: string;
  unit_nav: string;
  cumulative_nav: string;
  daily_growth: string;
  purchase_status: string;
  redemption_status: string;
  dividend: string;
}>): string {
  const body = rows
    .map((row) => `<tr><td>${row.date}</td><td>${row.unit_nav}</td><td>${row.cumulative_nav}</td><td>${row.daily_growth}</td><td>${row.purchase_status}</td><td>${row.redemption_status}</td><td>${row.dividend}</td></tr>`)
    .join("");
  return `var apidata={ content:"<table><tbody>${body}</tbody></table>",records:${rows.length},pages:1,curpage:1};`;
}

function buildFundHoldingsPayload(): string {
  return "var apidata={ content:\"<table><tbody><tr><td>1</td><td>600519</td><td>贵州茅台</td><td>9.80%</td></tr><tr><td>2</td><td>300750</td><td>宁德时代</td><td>8.12%</td></tr></tbody></table>\",arryear:[2026],curyear:2026};";
}

function buildPingzhongdataScript(): string {
  const netWorth = buildMockFundHistoryRows()
    .map((row, index) => `{x:${Date.parse(`${row.date}T00:00:00Z`)},y:${(4 + (index + 1) * 0.01).toFixed(4)}}`)
    .join(",");
  const peerPercentiles = buildMockFundHistoryRows()
    .map((row, index) => `[${Date.parse(`${row.date}T00:00:00Z`)},${(55 + index * 0.6).toFixed(1)}]`)
    .join(",");
  return [
    "var Data_netWorthTrend=[",
    netWorth,
    "];",
    "var Data_rateInSimilarPersent=[",
    peerPercentiles,
    "];",
    "var Data_rateInSimilarType=[{x:1700000000000,y:15,sc:240}];",
    "var Data_currentFundManager=[{name:\"张三\"},{name:\"李四\"}];"
  ].join("");
}

function buildFundEstimateScript(): string {
  return "jsonpgz({\"fundcode\":\"510300\",\"name\":\"沪深300ETF\",\"jzrq\":\"2026-02-21\",\"dwjz\":\"4.4000\",\"gsz\":\"4.4100\",\"gszzl\":\"0.23\",\"gztime\":\"2026-02-21 14:35\"});";
}

function createJsonResponse(payload: unknown): Response {
  return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) } as Response;
}

function createTextResponse(payload: string): Response {
  return { ok: true, status: 200, text: async () => payload, json: async () => ({}) } as Response;
}
