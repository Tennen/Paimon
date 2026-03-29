import type { FundFeatureContext, FundRawContext } from "./fund_types";
import type { FundRuleOutput } from "./fund_rule_engine";
import { buildFundReportContext } from "./fund_report_context";
import {
  buildFeatureLine,
  buildFundDashboardSchemaHint,
  buildNewsLines,
  formatCoverageLabel,
  formatFundTypeLabel,
  formatHoldingHorizonLabel,
  formatInstrumentLabel,
  formatMarketLabel,
  formatNewsSearchStatusLabel,
  formatPeerRankText,
  formatPromptMetricValue,
  formatPromptPercent,
  formatPromptText,
  formatRangeText,
  formatRiskPreferenceLabel,
  formatStrategyTypeLabel,
  formatTextList,
  formatTradableLabel,
  formatWarningsLine,
  inferNewsSearchStatus,
  metricPair,
  prunePromptPayload,
  summarizeNews
} from "./fund_prompt_builder_shared";
import { describeEvidenceStrength, describeRuleTilt, formatActionList, formatRuleFlagList } from "../readable_labels";

const PROMPT_VERSION = "fund_dashboard_v4";
const MAX_SERIES_POINTS = 90;
const MAX_NEWS_ITEMS = 8;

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
    "只要输入里给出了可用数值、排名、日期或事件，必须尽量保留到 thesis 或 data_perspective 中，不要只用“表现尚可”“波动可控”之类空话替代整组数据。",
    "sentiment_score、confidence、rule_adjusted_score、blocked_actions、rule_flags 是内部校准字段：schema 内要填写，但自然语言字段不得直接复述原始分数、英文 code 或枚举值。",
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
        "data_perspective 中凡是输入已给出的收益、风险、同类对照指标，尽量完整保留，不要只挑部分数字。",
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
    `- 数据质量: 特征覆盖 ${formatCoverageLabel(input.features.coverage)}，${describeEvidenceStrength(input.features.confidence)}。${formatWarningsLine(input.features.warnings)}`,
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
    `- 规则倾向: ${describeRuleTilt(input.rules.rule_adjusted_score, input.rules.hard_blocked)}`,
    `- 当前不建议动作: ${formatActionList(input.rules.blocked_actions, "无")}`,
    `- 风控提示: ${formatRuleFlagList(input.rules.rule_flags, "无")}`,
    `- 强制保守约束: ${input.rules.hard_blocked ? "是，优先观察或持有" : "否"}`,
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
    "- `data_perspective` 只要输入里给了数值，就尽量保留，不要用笼统结论替代整组收益/风险/同类数据。",
    "- `risk_alerts` 优先写限制性因素、回撤/波动、申赎限制、基金经理变化和监管风险。",
    "- `core_conclusion`、`risk_alerts`、`action_plan` 不得直接出现 `61/100`、`0.66`、`buy/add`、`subscription_redemption_restriction` 这类内部口径，要翻译成投资者能理解的中文。",
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
