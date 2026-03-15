import { FundFeatureContext, FundRawContext } from "./fund_types";
import { FundRuleOutput } from "./fund_rule_engine";

export type FundPromptInput = {
  raw: FundRawContext;
  features: FundFeatureContext;
  rules: FundRuleOutput;
};

export function buildFundSystemPrompt(): string {
  return [
    "你是基金投研助手，不做收益保证，不做价格预测承诺。",
    "必须严格依据输入数据推理，不得编造净值、收益、费率、公告、新闻内容。",
    "若数据不足，必须在 insufficient_data 中明确标记，并在结论中体现保守处理。",
    "若 blocked_actions 非空，decision_type 与 action_plan 不能与其冲突。",
    "只能输出 JSON，不要输出 Markdown、代码块或额外解释。",
    "输出必须对齐 FundDecisionDashboard schema。"
  ].join("\n");
}

export function buildFundUserPrompt(input: FundPromptInput): string {
  const payload = {
    section_order: [
      "basic_info",
      "raw_context_summary",
      "feature_context",
      "rule_result",
      "news_and_events",
      "schema"
    ],
    basic_info: {
      fund_code: input.raw.identity.fund_code,
      fund_name: input.raw.identity.fund_name,
      as_of_date: input.raw.as_of_date,
      fund_type: input.raw.identity.fund_type,
      strategy_type: input.raw.identity.strategy_type,
      tradable: input.raw.identity.tradable,
      account_position: input.raw.identity.account_position
    },
    raw_context_summary: {
      series_points: input.raw.price_or_nav_series.slice(-120),
      benchmark_code: input.raw.benchmark_code,
      benchmark_points: input.raw.benchmark_series.slice(-120),
      holdings_style: input.raw.holdings_style,
      account_context: input.raw.account_context,
      source_chain: input.raw.source_chain,
      errors: input.raw.errors
    },
    feature_context: input.features,
    rule_result: {
      rule_flags: input.rules.rule_flags,
      blocked_actions: input.rules.blocked_actions,
      rule_adjusted_score: input.rules.rule_adjusted_score,
      hard_blocked: input.rules.hard_blocked
    },
    news_and_events: {
      notices: input.raw.events.notices,
      manager_changes: input.raw.events.manager_changes,
      subscription_redemption: input.raw.events.subscription_redemption,
      regulatory_risks: input.raw.events.regulatory_risks,
      market_news: input.raw.events.market_news
    },
    forced_constraints: [
      "输出完整 JSON",
      "数据不足时必须标记 insufficient_data",
      "若 blocked_actions 非空，建议不得与之冲突",
      "若关键序列缺失，decision_type 应偏向 watch/hold"
    ],
    schema: buildFundDashboardSchemaHint()
  };

  return [
    "# 基金决策仪表盘分析请求",
    JSON.stringify(payload, null, 2)
  ].join("\n");
}

function buildFundDashboardSchemaHint(): Record<string, unknown> {
  return {
    fund_code: "string",
    fund_name: "string",
    as_of_date: "YYYY-MM-DD",
    decision_type: "buy|add|hold|reduce|redeem|watch",
    sentiment_score: "0-100",
    confidence: "0.0-1.0",
    core_conclusion: {
      one_sentence: "string",
      thesis: ["string"]
    },
    risk_alerts: ["string"],
    action_plan: {
      suggestion: "string",
      position_change: "string",
      execution_conditions: ["string"],
      stop_conditions: ["string"]
    },
    data_perspective: {
      return_metrics: {},
      risk_metrics: {},
      relative_metrics: {},
      feature_coverage: "ok|partial|insufficient"
    },
    rule_trace: {
      rule_flags: ["string"],
      blocked_actions: ["string"],
      adjusted_score: "0-100"
    },
    insufficient_data: {
      is_insufficient: "boolean",
      missing_fields: ["string"]
    }
  };
}
