import { FundFeatureContext, FundNewsItem, FundRawContext } from "./fund_types";
import { FundRuleOutput } from "./fund_rule_engine";

const PROMPT_VERSION = "fund_dashboard_v2";
const MAX_NEWS_ITEMS = 8;
const MAX_SERIES_POINTS = 90;

export type FundPromptInput = {
  raw: FundRawContext;
  features: FundFeatureContext;
  rules: FundRuleOutput;
};

export function buildFundSystemPrompt(): string {
  return [
    "你是基金投研助手，目标是给出可执行且风控优先的基金决策仪表盘。",
    "必须严格依据输入数据推理，严禁编造净值、收益、公告、新闻、费率或持仓数据。",
    "如果数据不足，必须在 insufficient_data 中明确标记并给出保守建议。",
    "若 blocked_actions 非空，decision_type 与 action_plan 不能与其冲突。",
    "结论要先给动作，再给理由，再给触发/停止条件。",
    "输出仅允许 JSON，不要输出 Markdown、代码块或额外解释。",
    "输出字段必须完整且对齐 FundDecisionDashboard schema。"
  ].join("\n");
}

export function buildFundUserPrompt(input: FundPromptInput): string {
  const fundSeriesSummary = summarizeSeries(input.raw.price_or_nav_series, MAX_SERIES_POINTS);
  const benchmarkSeriesSummary = summarizeSeries(input.raw.benchmark_series, MAX_SERIES_POINTS);
  const latestValue = typeof fundSeriesSummary.latest_value === "number"
    ? fundSeriesSummary.latest_value
    : undefined;
  const payload = prunePromptPayload({
    prompt_meta: {
      version: PROMPT_VERSION,
      language: "zh-CN",
      output_channel: "wechat_text",
      section_order: [
        "basic_info",
        "market_snapshot",
        "feature_context",
        "rule_result",
        "news_and_events",
        "task_and_constraints",
        "output_schema"
      ]
    },
    basic_info: {
      fund_code: input.raw.identity.fund_code,
      fund_name: input.raw.identity.fund_name,
      as_of_date: input.raw.as_of_date,
      fund_type: input.raw.identity.fund_type,
      strategy_type: input.raw.identity.strategy_type,
      tradable: input.raw.identity.tradable,
      market: input.raw.identity.market,
      currency: input.raw.identity.currency,
      account_position: input.raw.identity.account_position
    },
    market_snapshot: {
      fund_series_summary: fundSeriesSummary,
      benchmark_code: input.raw.benchmark_code,
      benchmark_series_summary: benchmarkSeriesSummary,
      position_snapshot: summarizePosition(input.raw.account_context, latestValue),
      raw_context_summary: {
        holdings_style: input.raw.holdings_style,
        account_context: input.raw.account_context
      },
      data_quality: {
        feature_coverage: input.features.coverage,
        feature_confidence: input.features.confidence,
        source_chain: input.raw.source_chain,
        ingestion_errors: input.raw.errors.slice(0, 12)
      },
      series_points: input.raw.price_or_nav_series.slice(-MAX_SERIES_POINTS),
      benchmark_points: input.raw.benchmark_series.slice(-MAX_SERIES_POINTS)
    },
    feature_context: input.features,
    rule_result: {
      rule_flags: input.rules.rule_flags,
      blocked_actions: input.rules.blocked_actions,
      rule_adjusted_score: input.rules.rule_adjusted_score,
      hard_blocked: input.rules.hard_blocked
    },
    news_and_events: {
      news_search_status: inferNewsSearchStatus(input.raw),
      notices: input.raw.events.notices,
      manager_changes: input.raw.events.manager_changes,
      subscription_redemption: input.raw.events.subscription_redemption,
      regulatory_risks: input.raw.events.regulatory_risks,
      key_news: summarizeNews(input.raw.events.market_news, MAX_NEWS_ITEMS)
    },
    task_and_constraints: {
      must_answer: [
        "给出单行核心结论 one_sentence，直接说明动作。",
        "action_plan 要明确建议动作、仓位变化、执行条件、停止条件。",
        "至少给 2 条 thesis，且每条引用输入里的具体指标或事件。",
        "risk_alerts 需优先展示高风险约束和新闻中的风险事件。",
        "若 blocked_actions 非空，不得输出被阻断动作。"
      ],
      forbidden: [
        "不得承诺收益或给出确定性涨跌预测。",
        "不得补造输入中不存在的数据。",
        "不得输出 schema 之外的自由文本段落。"
      ],
      decision_guardrails: {
        hard_blocked: input.rules.hard_blocked,
        blocked_actions: input.rules.blocked_actions,
        coverage: input.features.coverage,
        warnings: input.features.warnings
      },
      fallback_requirements: [
        "若关键序列缺失，decision_type 必须偏向 watch 或 hold。",
        "若是 insufficient_data，confidence 建议 <= 0.55。",
        "若有 subscription_redemption_restriction，不能输出 buy/add。"
      ]
    },
    output_schema: buildFundDashboardSchemaHint()
  });

  return [
    "# 基金决策仪表盘分析请求",
    JSON.stringify(payload || {}, null, 2)
  ].join("\n");
}

function summarizeSeries(
  points: FundRawContext["price_or_nav_series"],
  limit: number
): Record<string, unknown> {
  const valid = Array.isArray(points)
    ? points
      .filter((item) => item && Number.isFinite(Number(item.value)) && Number(item.value) > 0)
      .slice(-Math.max(10, limit))
    : [];

  const values = valid.map((item) => Number(item.value));
  const last = valid.length > 0 ? valid[valid.length - 1] : null;
  const high60d = values.length > 0 ? Math.max(...values.slice(-60)) : undefined;
  const low60d = values.length > 0 ? Math.min(...values.slice(-60)) : undefined;

  return {
    point_count: valid.length,
    latest_date: last ? String(last.date || "") : undefined,
    latest_value: last ? roundNumber(Number(last.value), 6) : undefined,
    ret_1d: calculateWindowReturn(values, 1),
    ret_5d: calculateWindowReturn(values, 5),
    ret_20d: calculateWindowReturn(values, 20),
    ret_60d: calculateWindowReturn(values, 60),
    nav_slope_20d: values.length >= 21
      ? roundNumber((values[values.length - 1] - values[values.length - 21]) / 20, 6)
      : "not_supported",
    high_60d: Number.isFinite(high60d) ? roundNumber(high60d as number, 6) : "not_supported",
    low_60d: Number.isFinite(low60d) ? roundNumber(low60d as number, 6) : "not_supported"
  };
}

function summarizePosition(
  account: FundRawContext["account_context"],
  latestValue?: number
): Record<string, unknown> {
  const quantity = Number(account.current_position);
  const avgCost = Number(account.avg_cost);
  const hasValidAvgCost = Number.isFinite(avgCost) && avgCost > 0;
  const hasLatest = Number.isFinite(latestValue) && (latestValue as number) > 0;
  const pnlPct = hasValidAvgCost && hasLatest
    ? roundNumber((((latestValue as number) - avgCost) / avgCost) * 100, 4)
    : "not_supported";
  const marketValue = Number.isFinite(quantity) && quantity > 0 && hasLatest
    ? roundNumber(quantity * (latestValue as number), 4)
    : "not_supported";

  return {
    current_position: account.current_position,
    avg_cost: account.avg_cost,
    budget: account.budget,
    risk_preference: account.risk_preference,
    holding_horizon: account.holding_horizon,
    estimated_market_value: marketValue,
    estimated_position_pnl_pct: pnlPct
  };
}

function summarizeNews(items: FundNewsItem[], maxItems: number): Array<Record<string, unknown>> {
  const normalized = Array.isArray(items) ? items.slice(0, Math.max(1, maxItems)) : [];
  return normalized.map((item) => ({
    title: item.title,
    source: item.source,
    published_at: item.published_at,
    snippet: compactSnippet(item.snippet, 120),
    risk_hint: inferNewsRiskHint(item.title, item.snippet)
  }));
}

function inferNewsSearchStatus(raw: FundRawContext): string {
  const sourceChain = Array.isArray(raw.source_chain) ? raw.source_chain : [];
  const errors = Array.isArray(raw.errors) ? raw.errors : [];

  if (sourceChain.includes("env:MARKET_ANALYSIS_NEWS_CONTEXT")) {
    return "manual_env_context";
  }
  if (sourceChain.includes("serpapi:disabled_no_key")) {
    return "serpapi_disabled_no_key";
  }
  if (sourceChain.includes("serpapi:google_news")) {
    return raw.events.market_news.length > 0 ? "serpapi_hit" : "serpapi_no_hit";
  }
  if (errors.some((item) => /serpapi/i.test(String(item || "")))) {
    return "serpapi_error";
  }
  if (sourceChain.some((item) => String(item).startsWith("fallback:"))) {
    return raw.events.market_news.length > 0 ? "fallback_hit" : "fallback_no_hit";
  }
  return "news_unavailable";
}

function buildFundDashboardSchemaHint(): Record<string, unknown> {
  return {
    fund_code: "string",
    fund_name: "string",
    as_of_date: "YYYY-MM-DD",
    decision_type: "buy|add|hold|reduce|redeem|watch",
    sentiment_score: "0-100 integer",
    confidence: "0.0-1.0",
    core_conclusion: {
      one_sentence: "string, <=40字, 先给动作",
      thesis: ["string", "string"]
    },
    risk_alerts: ["string"],
    action_plan: {
      suggestion: "string",
      position_change: "string",
      execution_conditions: ["string"],
      stop_conditions: ["string"]
    },
    data_perspective: {
      return_metrics: "key-value from features.returns",
      risk_metrics: "key-value from features.risk",
      relative_metrics: "key-value from features.relative",
      feature_coverage: "ok|partial|insufficient"
    },
    rule_trace: {
      rule_flags: ["string"],
      blocked_actions: ["string"],
      adjusted_score: "0-100 number"
    },
    insufficient_data: {
      is_insufficient: "boolean",
      missing_fields: ["string"]
    }
  };
}

function calculateWindowReturn(values: number[], window: number): number | "not_supported" {
  if (values.length <= window) {
    return "not_supported";
  }
  const start = values[values.length - window - 1];
  const end = values[values.length - 1];
  if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0) {
    return "not_supported";
  }
  return roundNumber(((end - start) / start) * 100, 4);
}

function compactSnippet(input: unknown, maxLength: number): string | undefined {
  const source = String(input || "").trim();
  if (!source) {
    return undefined;
  }
  if (source.length <= maxLength) {
    return source;
  }
  return `${source.slice(0, Math.max(0, maxLength - 1))}…`;
}

function inferNewsRiskHint(title: string, snippet?: string): string | undefined {
  const text = `${String(title || "")} ${String(snippet || "")}`;
  if (/处罚|监管|风险提示|违约|清盘|踩雷/.test(text)) {
    return "high_risk";
  }
  if (/暂停申购|暂停赎回|限购|限赎/.test(text)) {
    return "restriction";
  }
  if (/基金经理|离任|变更/.test(text)) {
    return "manager_change";
  }
  if (/分红|增持|获批|扩容/.test(text)) {
    return "positive_catalyst";
  }
  return undefined;
}

function roundNumber(input: number, digits: number): number {
  if (!Number.isFinite(input)) {
    return 0;
  }
  const factor = 10 ** digits;
  return Math.round(input * factor) / factor;
}

function prunePromptPayload(input: unknown): unknown {
  if (input === null || input === undefined) {
    return undefined;
  }

  if (typeof input === "number") {
    return Number.isFinite(input) ? input : undefined;
  }

  if (typeof input === "string") {
    const trimmed = input.trim();
    return trimmed ? trimmed : undefined;
  }

  if (typeof input === "boolean") {
    return input;
  }

  if (Array.isArray(input)) {
    const nextArray = input
      .map((item) => prunePromptPayload(item))
      .filter((item) => item !== undefined);
    return nextArray.length > 0 ? nextArray : undefined;
  }

  if (typeof input === "object") {
    const source = input as Record<string, unknown>;
    const entries = Object.entries(source)
      .map(([key, value]) => [key, prunePromptPayload(value)] as const)
      .filter(([, value]) => value !== undefined);
    if (entries.length === 0) {
      return undefined;
    }
    return Object.fromEntries(entries);
  }

  return undefined;
}
