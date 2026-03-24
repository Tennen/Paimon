import test from "node:test";
import assert from "node:assert/strict";
import { buildFundSystemPrompt, buildFundUserPrompt } from "./fund_prompt_builder";
import { buildFundReportContext } from "./fund_report_context";
import { FundFeatureContext, FundRawContext } from "./fund_types";

function buildRawContext(partial?: Partial<FundRawContext>): FundRawContext {
  return {
    identity: {
      fund_code: "510300",
      fund_name: "沪深300ETF",
      market: "sh",
      currency: "CNY",
      account_position: {
        quantity: 100,
        avg_cost: 4.1
      },
      fund_type: "etf",
      strategy_type: "index",
      tradable: "intraday",
      source_chain: ["unit_test"],
      errors: []
    },
    as_of_date: "2026-03-16",
    price_or_nav_series: [
      { date: "2026-03-12", value: 4.2 },
      { date: "2026-03-13", value: 4.28 },
      { date: "2026-03-14", value: 4.3 },
      { date: "2026-03-15", value: 4.33 },
      { date: "2026-03-16", value: 4.35 }
    ],
    holdings_style: {
      top_holdings: ["腾讯控股(8.10%)", "英伟达(7.35%)"],
      sector_exposure: {},
      style_factor_exposure: {},
      duration_credit_profile: {}
    },
    reference_context: {
      comparison_reference: "同类基金百分位",
      estimated_nav: 4.36,
      estimated_nav_date: "2026-03-16",
      estimated_nav_time: "14:35:00",
      estimated_change_pct: 1.4,
      peer_percentile: 86.5,
      peer_rank_position: 18,
      peer_rank_total: 240,
      peer_percentile_series: [
        { date: "2026-03-12", value: 81.2 },
        { date: "2026-03-13", value: 83.8 },
        { date: "2026-03-14", value: 84.6 },
        { date: "2026-03-15", value: 85.4 },
        { date: "2026-03-16", value: 86.5 }
      ],
      current_managers: ["张三", "李四"]
    },
    events: {
      notices: ["分红公告"],
      manager_changes: [],
      subscription_redemption: [],
      regulatory_risks: [],
      market_news: [
        {
          title: "沪深300ETF份额增长",
          source: "test-source",
          snippet: "份额最近两周持续增长"
        }
      ]
    },
    account_context: {
      current_position: 100,
      avg_cost: 4.1,
      budget: 5000,
      risk_preference: "balanced",
      holding_horizon: "medium_term"
    },
    source_chain: [
      "eastmoney:fund_lsjz",
      "eastmoney:fund_pingzhongdata",
      "search_provider:serpapi",
      "search_provider_variant:serpapi:google_news",
      "search_status:hit"
    ],
    errors: [],
    ...(partial || {})
  };
}

function buildFeatureContext(): FundFeatureContext {
  return {
    returns: {
      ret_1d: 1.2,
      ret_5d: 2.8,
      ret_20d: 5.6,
      ret_60d: 9.4,
      ret_120d: "not_supported"
    },
    risk: {
      volatility_annualized: 18.3,
      max_drawdown: -7.2,
      drawdown_recovery_days: 8
    },
    stability: {
      excess_return_consistency: 1.2,
      style_drift: "not_supported",
      nav_smoothing_anomaly: "not_supported"
    },
    relative: {
      peer_percentile: 86.5,
      peer_percentile_change_20d: 6.8,
      peer_percentile_change_60d: 10.4,
      peer_rank_position: 18,
      peer_rank_total: 240
    },
    trading: {
      ma5: 4.3,
      ma10: 4.2,
      ma20: 4.0,
      premium_discount: "not_supported"
    },
    nav: {
      nav_slope_20d: 0.01,
      sharpe: 1.0,
      sortino: 1.2,
      calmar: 0.8,
      manager_tenure: "not_supported",
      style_drift_alert: "not_supported"
    },
    coverage: "ok",
    confidence: 0.88,
    warnings: []
  };
}

function parsePromptSnapshot(prompt: string): Record<string, unknown> {
  const match = prompt.match(/## 结构化输入快照（供校验，禁止照抄字段名）\n```json\n([\s\S]*?)\n```/);
  assert.ok(match, "prompt should contain a structured json snapshot");
  return JSON.parse(match[1]);
}

test("fund system prompt should enforce json-only and data constraints", () => {
  const prompt = buildFundSystemPrompt();
  assert.ok(prompt.includes("输出仅允许 JSON"));
  assert.ok(prompt.includes("严禁编造"));
  assert.ok(prompt.includes("blocked_actions"));
  assert.ok(prompt.includes("自然中文"));
  assert.ok(prompt.includes("ETF/指数基金"));
  assert.ok(prompt.includes("核心结论、数据透视、舆情情报、作战计划"));
  assert.ok(prompt.includes("不得直接复述原始分数"));
  assert.ok(prompt.includes("尽量保留到 thesis 或 data_perspective"));
});

test("fund user prompt should include natural-language sections and structured snapshot", () => {
  const raw = buildRawContext();
  const prompt = buildFundUserPrompt({
    raw,
    features: buildFeatureContext(),
    rules: {
      rule_flags: ["data_stale"],
      blocked_actions: ["buy", "add"],
      rule_adjusted_score: 48,
      hard_blocked: false
    }
  });

  const payload = parsePromptSnapshot(prompt);
  const newsAndEvents = payload.news_and_events as Record<string, unknown>;
  const marketSnapshot = payload.market_snapshot as Record<string, unknown>;

  assert.match(prompt, /## 📊 基金基础信息/);
  assert.match(prompt, /## 📈 数据透视/);
  assert.match(prompt, /### 风险收益与同类对照/);
  assert.match(prompt, /## 📰 舆情情报/);
  assert.match(prompt, /## ✅ 分析任务/);
  assert.match(prompt, /### 决策仪表盘四块结构（必须吸收）/);
  assert.match(prompt, /持仓者\.\.\.；未持仓者\.\.\./);
  assert.match(prompt, /近7日未抓到高置信度公开新闻|1\. 沪深300ETF份额增长/);
  assert.match(prompt, /data_perspective 中凡是输入已给出的收益、风险、同类对照指标/);
  assert.match(prompt, /证据支撑较充分/);
  assert.match(prompt, /规则倾向: 偏谨慎/);
  assert.match(prompt, /当前不建议动作: 买入、加仓/);
  assert.match(prompt, /风控提示: 数据时效性不足/);
  assert.equal(newsAndEvents.news_search_status, "search_engine_hit");
  assert.equal((marketSnapshot.fund_series_summary as Record<string, unknown>).latest_value, 4.35);
  assert.deepEqual((marketSnapshot.raw_context_summary as Record<string, unknown>).reference_context, {
    comparison_reference: "同类基金百分位",
    estimated_nav: 4.36,
    estimated_nav_date: "2026-03-16",
    estimated_nav_time: "14:35:00",
    estimated_change_pct: 1.4,
    peer_percentile: 86.5,
    peer_rank_position: 18,
    peer_rank_total: 240,
    peer_percentile_series: [
      { date: "2026-03-12", value: 81.2 },
      { date: "2026-03-13", value: 83.8 },
      { date: "2026-03-14", value: 84.6 },
      { date: "2026-03-15", value: 85.4 },
      { date: "2026-03-16", value: 86.5 }
    ],
    current_managers: ["张三", "李四"]
  });
  assert.equal(Array.isArray((payload.task_and_constraints as Record<string, unknown>).must_answer), true);
});

test("fund report context should expose prompt-aligned latest values and position snapshot", () => {
  const context = buildFundReportContext(buildRawContext(), buildFeatureContext());

  assert.equal(context.fund_series_summary.latest_value, 4.35);
  assert.equal(context.fund_series_summary.latest_date, "2026-03-16");
  assert.equal(context.peer_percentile_summary.latest_value, 86.5);
  assert.equal(context.position_snapshot.estimated_market_value, 435);
  assert.equal(context.position_snapshot.estimated_position_pnl_pct, 6.0976);
  assert.equal(context.feature_context.returns.ret_1d, 1.2);
});
