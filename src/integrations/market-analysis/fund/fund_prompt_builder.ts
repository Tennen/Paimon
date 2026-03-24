import { FundFeatureContext, FundNewsItem, FundRawContext } from "./fund_types";
import { FundRuleOutput } from "./fund_rule_engine";
import { buildFundReportContext } from "./fund_report_context";
import { hasSearchStatus } from "../../search-engine/types";

const PROMPT_VERSION = "fund_dashboard_v4";
const MAX_NEWS_ITEMS = 8;
const MAX_SERIES_POINTS = 90;

export type FundPromptInput = {
  raw: FundRawContext;
  features: FundFeatureContext;
  rules: FundRuleOutput;
};

export function buildFundSystemPrompt(): string {
  return [
    "你是基金投研助手，目标是给出可执行、风控优先、能直接被投资者理解的基金决策仪表盘。",
    "必须严格依据输入数据推理，严禁编造净值、收益、公告、新闻、费率、持仓、基金经理或申赎信息。",
    "分析架构请尽量向“决策仪表盘”靠拢：核心结论、数据透视、舆情情报、作战计划四块必须清晰分工。",
    "虽然输出是 FundDecisionDashboard JSON，但字段语义必须对应这四块：core_conclusion=核心结论，data_perspective=数据透视，risk_alerts=舆情风险看板，action_plan=作战计划。",
    "核心结论、风险提示、执行建议要写成自然中文，不要照抄字段名、枚举值或程序化描述。",
    "不同基金使用对应指标表达：ETF/指数基金优先参考同类百分位、同类排名变化、折溢价；主动基金优先参考收益、回撤、波动、基金经理与申赎事件。",
    "如果数据不足，必须在 insufficient_data 中明确标记，并把建议收敛到保守动作。",
    "若 blocked_actions 非空，decision_type 与 action_plan 不能与其冲突。",
    "结论要先给动作，再给理由，再给执行条件和停止条件。",
    "输出仅允许 JSON，不要输出 Markdown、代码块或额外解释。",
    "输出字段必须完整且对齐 FundDecisionDashboard schema。"
  ].join("\n");
}

export function buildFundUserPrompt(input: FundPromptInput): string {
  const reportContext = buildFundReportContext(input.raw, input.features);
  const fundSeriesSummary = reportContext.fund_series_summary;
  const peerPercentileSummary = reportContext.peer_percentile_summary;
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
      comparison_reference: input.raw.reference_context.comparison_reference,
      peer_percentile_summary: peerPercentileSummary,
      position_snapshot: reportContext.position_snapshot,
      raw_context_summary: {
        holdings_style: reportContext.holdings_style,
        reference_context: reportContext.reference_context,
        account_context: reportContext.account_context
      },
      data_quality: {
        feature_coverage: reportContext.feature_context.coverage,
        feature_confidence: reportContext.feature_context.confidence,
        source_chain: reportContext.source_chain,
        ingestion_errors: reportContext.errors.slice(0, 12)
      },
      series_points: input.raw.price_or_nav_series.slice(-MAX_SERIES_POINTS),
      peer_percentile_points: input.raw.reference_context.peer_percentile_series.slice(-MAX_SERIES_POINTS)
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

  const positionSummary = reportContext.position_snapshot;
  const lines: string[] = [
    "# 基金决策仪表盘分析请求",
    "",
    "## 📊 基金基础信息",
    "| 项目 | 数据 |",
    "| --- | --- |",
    `| 标的 | ${formatInstrumentLabel(input.raw.identity.fund_name, input.raw.identity.fund_code)} |`,
    `| 截止日期 | ${input.raw.as_of_date || "未知"} |`,
    `| 基金类型 | ${formatFundTypeLabel(input.raw.identity.fund_type)} |`,
    `| 策略属性 | ${formatStrategyTypeLabel(input.raw.identity.strategy_type)} |`,
    `| 交易方式 | ${formatTradableLabel(input.raw.identity.tradable)} |`,
    `| 市场/币种 | ${formatMarketLabel(input.raw.identity.market)} / ${input.raw.identity.currency || "CNY"} |`,
    `| 相对参照 | ${input.raw.reference_context.comparison_reference || "未提供"} |`,
    "",
    "## 📈 数据透视",
    "### 净值与同类位置",
    "| 项目 | 数据 |",
    "| --- | --- |",
    `| 最新净值/价格 | ${formatPromptMetricValue(fundSeriesSummary.latest_value, 6)} |`,
    `| 最新日期 | ${formatPromptText(fundSeriesSummary.latest_date)} |`,
    `| 近1日收益 | ${formatPromptPercent(fundSeriesSummary.ret_1d)} |`,
    `| 近5日收益 | ${formatPromptPercent(fundSeriesSummary.ret_5d)} |`,
    `| 近20日收益 | ${formatPromptPercent(fundSeriesSummary.ret_20d)} |`,
    `| 近60日收益 | ${formatPromptPercent(fundSeriesSummary.ret_60d)} |`,
    `| 20日净值斜率 | ${formatPromptMetricValue(fundSeriesSummary.nav_slope_20d, 6)} |`,
    `| 近60日区间 | ${formatRangeText(fundSeriesSummary.low_60d, fundSeriesSummary.high_60d, 6)} |`,
    `| 当前同类百分位 | ${formatPromptMetricValue(input.features.relative.peer_percentile, 2)} |`,
    `| 20日百分位变化 | ${formatPromptMetricValue(input.features.relative.peer_percentile_change_20d, 2)} |`,
    `| 60日百分位变化 | ${formatPromptMetricValue(input.features.relative.peer_percentile_change_60d, 2)} |`,
    `| 同类排名 | ${formatPeerRankText(input.features.relative.peer_rank_position, input.features.relative.peer_rank_total)} |`,
    "",
    "### 风险收益与同类对照",
    `- 收益表现: ${buildFeatureLine([
      metricPair("近1日", input.features.returns.ret_1d, "percent"),
      metricPair("近5日", input.features.returns.ret_5d, "percent"),
      metricPair("近20日", input.features.returns.ret_20d, "percent"),
      metricPair("近60日", input.features.returns.ret_60d, "percent"),
      metricPair("近120日", input.features.returns.ret_120d, "percent")
    ])}`,
    `- 风险刻画: ${buildFeatureLine([
      metricPair("最大回撤", input.features.risk.max_drawdown, "percent"),
      metricPair("年化波动", input.features.risk.volatility_annualized, "percent"),
      metricPair("回撤修复天数", input.features.risk.drawdown_recovery_days, "plain")
    ])}`,
    `- 相对表现: ${buildFeatureLine([
      metricPair("同类分位", input.features.relative.peer_percentile, "plain"),
      metricPair("20日分位变化", input.features.relative.peer_percentile_change_20d, "plain"),
      metricPair("60日分位变化", input.features.relative.peer_percentile_change_60d, "plain"),
      metricPair("同类排名", formatPeerRankText(input.features.relative.peer_rank_position, input.features.relative.peer_rank_total), "text")
    ])}`,
    `- 交易参考: ${buildFeatureLine([
      metricPair("MA5", input.features.trading.ma5, "plain"),
      metricPair("MA10", input.features.trading.ma10, "plain"),
      metricPair("MA20", input.features.trading.ma20, "plain"),
      metricPair("折溢价", input.features.trading.premium_discount, "percent")
    ])}`,
    `- 稳定性与质量: ${buildFeatureLine([
      metricPair("同类排名趋势", input.features.stability.excess_return_consistency, "plain"),
      metricPair("风格漂移", input.features.stability.style_drift, "plain"),
      metricPair("净值平滑异常", input.features.stability.nav_smoothing_anomaly, "plain"),
      metricPair("Sharpe", input.features.nav.sharpe, "plain"),
      metricPair("Sortino", input.features.nav.sortino, "plain"),
      metricPair("Calmar", input.features.nav.calmar, "plain"),
      metricPair("基金经理任职", input.features.nav.manager_tenure, "plain")
    ])}`,
    `- 数据质量: 特征覆盖 ${formatCoverageLabel(input.features.coverage)}，模型置信度 ${formatPromptMetricValue(input.features.confidence, 2)}。${formatWarningsLine(input.features.warnings)}`,
    "",
    "### 持仓与策略背景",
    "| 项目 | 数据 |",
    "| --- | --- |",
    `| 当前持仓份额 | ${formatPromptMetricValue(positionSummary.current_position, 4)} |`,
    `| 持仓成本 | ${formatPromptMetricValue(positionSummary.avg_cost, 4)} |`,
    `| 估算市值 | ${formatPromptMetricValue(positionSummary.estimated_market_value, 2)} |`,
    `| 浮动盈亏 | ${formatPromptPercent(positionSummary.estimated_position_pnl_pct)} |`,
    `| 可用预算 | ${formatPromptMetricValue(positionSummary.budget, 2)} |`,
    `| 风险偏好 | ${formatRiskPreferenceLabel(positionSummary.risk_preference)} |`,
    `| 持有周期 | ${formatHoldingHorizonLabel(positionSummary.holding_horizon)} |`,
    `| 现任基金经理 | ${formatTextList(input.raw.reference_context.current_managers, "数据不足")} |`,
    `| 十大重仓参考 | ${formatTextList(input.raw.holdings_style.top_holdings, "数据不足")} |`,
    "",
    "## 🧭 规则约束与当前判断",
    `- 当前规则分数: ${formatPromptMetricValue(input.rules.rule_adjusted_score, 0)} / 100`,
    `- 被阻断动作: ${formatTextList(input.rules.blocked_actions, "无")}`,
    `- 风控标记: ${formatTextList(input.rules.rule_flags, "无")}`,
    `- 强制保守约束: ${input.rules.hard_blocked ? "是" : "否"}`,
    "",
    "## 📰 舆情情报",
    `- 新闻检索状态: ${formatNewsSearchStatusLabel(inferNewsSearchStatus(input.raw))}`,
    `- 公告/提示: ${formatTextList(input.raw.events.notices, "暂无重点公告")}`,
    `- 基金经理变化: ${formatTextList(input.raw.events.manager_changes, "暂无相关变化")}`,
    `- 申购赎回约束: ${formatTextList(input.raw.events.subscription_redemption, "暂无明显限制")}`,
    `- 监管或异常风险: ${formatTextList(input.raw.events.regulatory_risks, "暂无新增风险")}`,
    ...buildNewsLines(input.raw.events.market_news),
    "",
    "## ✅ 分析任务",
    "请基于以上信息输出一个完整的 FundDecisionDashboard JSON，并遵守以下要求：",
    "### 决策仪表盘四块结构（必须吸收）",
    "1. 核心结论：`core_conclusion.one_sentence` 先给动作，再给一句原因；不要写成程序字段解释。",
    "2. 数据透视：`core_conclusion.thesis` 至少给 2 条，分别覆盖收益/回撤/同类对照中的关键事实。",
    "3. 舆情情报：`risk_alerts` 不只是罗列风险词，要像情报板一样指出当前最值得盯的新闻、公告或限制。",
    "4. 作战计划：`action_plan` 要像作战计划，优先同时说明持仓者怎么做、未持仓者能不能追，以及什么条件下执行、什么条件下停止。",
    "",
    "### 重点要求",
    "- `core_conclusion.one_sentence` 要像成熟基金日报里的“一句话核心结论”，简洁、直接、有动作。",
    "- `action_plan.suggestion` 尽量写成“持仓者...；未持仓者...”这种双视角句式，而不是单句口号。",
    "- ETF/指数基金不要套用股票特有口径，优先使用同类百分位、同类排名变化、折溢价等基金指标。",
    "- `risk_alerts` 优先写限制性因素、回撤/波动、申赎限制、基金经理变化和监管风险。",
    "- 如果 `blocked_actions` 非空，最终动作和执行计划不得与之冲突。",
    "- 如果数据不足或事件不清晰，要直接承认不确定性并给保守建议。",
    "",
    "## 结构化输入快照（供校验，禁止照抄字段名）",
    "```json",
    JSON.stringify(payload || {}, null, 2),
    "```",
    "",
    "## 输出 JSON Schema",
    "```json",
    JSON.stringify(buildFundDashboardSchemaHint(), null, 2),
    "```"
  ];

  return lines.join("\n");
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
  if (sourceChain.some((item) => /^search_engine:.+:disabled$/.test(String(item || "")))) {
    return "search_engine_disabled";
  }
  if (hasSearchStatus(sourceChain, "disabled_no_key")) {
    return "search_engine_disabled_no_key";
  }
  if (sourceChain.some((item) => String(item).startsWith("fallback:"))) {
    return raw.events.market_news.length > 0 ? "fallback_hit" : "fallback_no_hit";
  }
  if (hasSearchStatus(sourceChain, "hit")) {
    return raw.events.market_news.length > 0 ? "search_engine_hit" : "search_engine_no_hit";
  }
  if (hasSearchStatus(sourceChain, "no_hit")) {
    return "search_engine_no_hit";
  }
  if (hasSearchStatus(sourceChain, "error") || errors.length > 0) {
    return "search_engine_error";
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
      one_sentence: "一句话核心结论，<=40字，先给动作，再给原因",
      thesis: ["数据透视结论1", "数据透视结论2"]
    },
    risk_alerts: ["舆情/风险/限制性情报"],
    action_plan: {
      suggestion: "作战计划口吻，优先覆盖持仓者/未持仓者",
      position_change: "仓位处理建议",
      execution_conditions: ["执行条件/入场观察点"],
      stop_conditions: ["失效条件/停止条件"]
    },
    data_perspective: {
      return_metrics: "收益与净值表现",
      risk_metrics: "回撤/波动/修复",
      relative_metrics: "同类百分位/同类排名变化",
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

function buildNewsLines(items: FundNewsItem[]): string[] {
  if (!Array.isArray(items) || items.length === 0) {
    return ["- 近7日未抓到高置信度公开新闻，请以净值、回撤和规则约束为主。"];
  }

  return items.slice(0, MAX_NEWS_ITEMS).map((item, index) => {
    const parts = [
      `${index + 1}. ${String(item.title || "").trim() || "未命名新闻"}`,
      item.source ? `来源=${item.source}` : "",
      item.published_at ? `时间=${item.published_at}` : "",
      item.snippet ? `摘要=${compactSnippet(item.snippet, 90)}` : ""
    ].filter(Boolean);
    return `- ${parts.join("；")}`;
  });
}

function buildFeatureLine(items: Array<{ label: string; value: string } | null>): string {
  const content = items
    .filter((item): item is { label: string; value: string } => Boolean(item && item.value))
    .map((item) => `${item.label}${item.value}`)
    .join("；");
  return content || "暂无足够特征数据。";
}

function metricPair(
  label: string,
  value: unknown,
  mode: "plain" | "percent" | "text"
): { label: string; value: string } | null {
  const text = mode === "percent"
    ? formatPromptPercent(value)
    : mode === "text"
      ? formatPromptText(value)
      : formatPromptMetricValue(value, 4);
  return text === "数据不足" ? null : { label: `${label} `, value: text };
}

function formatPeerRankText(position: unknown, total: unknown): string {
  const pos = formatPromptMetricValue(position, 0);
  const count = formatPromptMetricValue(total, 0);
  if (pos === "数据不足" || count === "数据不足") {
    return "数据不足";
  }
  return `${pos}/${count}`;
}

function formatInstrumentLabel(name: string, code: string): string {
  const normalizedName = String(name || "").trim();
  const normalizedCode = String(code || "").trim();
  if (normalizedName && normalizedCode) {
    return `${normalizedName}(${normalizedCode})`;
  }
  return normalizedName || normalizedCode || "未知标的";
}

function formatFundTypeLabel(value: string): string {
  switch (value) {
    case "etf":
      return "ETF";
    case "lof":
      return "LOF";
    case "otc_public":
      return "场外公募基金";
    default:
      return value || "未知";
  }
}

function formatStrategyTypeLabel(value: string): string {
  switch (value) {
    case "index":
      return "指数跟踪";
    case "active_equity":
      return "主动权益";
    case "bond":
      return "债券";
    case "mixed":
      return "混合";
    case "fof":
      return "FOF";
    case "money_market":
      return "货币";
    case "qdii":
      return "QDII";
    default:
      return value || "未知";
  }
}

function formatTradableLabel(value: string): string {
  switch (value) {
    case "intraday":
      return "场内实时交易";
    case "nav_t_plus_n":
      return "场外按净值申赎";
    default:
      return value || "未知";
  }
}

function formatMarketLabel(value: string): string {
  switch (value) {
    case "sh":
      return "上交所";
    case "sz":
      return "深交所";
    case "otc":
      return "场外";
    default:
      return value || "未知";
  }
}

function formatRiskPreferenceLabel(value: unknown): string {
  switch (String(value || "").trim().toLowerCase()) {
    case "conservative":
      return "稳健";
    case "balanced":
      return "均衡";
    case "aggressive":
      return "进取";
    default:
      return formatPromptText(value);
  }
}

function formatHoldingHorizonLabel(value: unknown): string {
  switch (String(value || "").trim().toLowerCase()) {
    case "short_term":
      return "短期";
    case "medium_term":
      return "中期";
    case "long_term":
      return "长期";
    default:
      return formatPromptText(value);
  }
}

function formatNewsSearchStatusLabel(value: string): string {
  switch (value) {
    case "manual_env_context":
      return "使用环境变量注入的新闻上下文";
    case "search_engine_hit":
      return "Search Engine 已命中相关公开信息";
    case "search_engine_no_hit":
      return "Search Engine 本次未命中相关公开信息";
    case "search_engine_disabled":
      return "Search Engine 当前已禁用";
    case "search_engine_disabled_no_key":
      return "Search Engine 未配置可用密钥";
    case "search_engine_error":
      return "Search Engine 请求失败";
    case "fallback_hit":
      return "已由回退新闻源补齐";
    case "fallback_no_hit":
      return "回退新闻源也未命中";
    default:
      return "新闻可用性不足";
  }
}

function formatWarningsLine(warnings: string[]): string {
  if (!Array.isArray(warnings) || warnings.length === 0) {
    return "暂无额外警告。";
  }
  return `需要额外留意：${warnings.slice(0, 6).join("；")}。`;
}

function formatRangeText(low: unknown, high: unknown, digits: number): string {
  const lowText = formatPromptMetricValue(low, digits);
  const highText = formatPromptMetricValue(high, digits);
  if (lowText === "数据不足" || highText === "数据不足") {
    return "数据不足";
  }
  return `${lowText} - ${highText}`;
}

function formatPromptPercent(value: unknown): string {
  if (value === null || value === undefined || value === "not_supported") {
    return "数据不足";
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "数据不足";
  }
  const normalized = roundNumber(numeric, 2);
  const prefix = normalized > 0 ? "+" : "";
  return `${prefix}${normalized}%`;
}

function formatPromptMetricValue(value: unknown, digits: number): string {
  if (value === null || value === undefined || value === "not_supported") {
    return "数据不足";
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return String(roundNumber(numeric, digits));
  }
  const text = String(value || "").trim();
  return text || "数据不足";
}

function formatPromptText(value: unknown): string {
  const text = String(value || "").trim();
  return text || "数据不足";
}

function formatCoverageLabel(value: string): string {
  switch (value) {
    case "ok":
      return "完整";
    case "partial":
      return "部分可用";
    case "insufficient":
      return "不足";
    default:
      return value || "未知";
  }
}

function formatTextList(values: string[], fallback: string): string {
  if (!Array.isArray(values) || values.length === 0) {
    return fallback;
  }
  return values.join("；");
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
