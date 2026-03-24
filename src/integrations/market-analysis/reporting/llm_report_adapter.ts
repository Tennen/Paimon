import { resolveDataPath } from "../../../storage/persistence";
import {
  buildFundReportContext,
  createEmptyFundReportContext,
  type FundReportContext,
  type FundSeriesSummary
} from "../fund/fund_report_context";
import type { RunFundAnalysisOutput } from "../fund/fund_analysis_service";
import type { FundAnalysisOutput, MarketPhase, MarketPortfolio } from "../fund/fund_types";
import { isCodexProvider, runCodexMarkdownReport } from "../../codex/markdownReport";

export type MarketReportPayload = {
  phase: MarketPhase;
  portfolio: MarketPortfolio;
  marketData: RunFundAnalysisOutput["marketData"];
  signalResult: FundAnalysisOutput;
  optionalNewsContext: RunFundAnalysisOutput["optionalNewsContext"];
  analysisEngine: string;
};

export type MarketLlmReport = {
  provider: "codex";
  model: string;
  summary: string;
  markdown: string;
  generatedAt: string;
  inputPath: string;
  outputPath: string;
};

type FundRecordContext = {
  reportContext: FundReportContext;
};

const REPORT_DIR = resolveDataPath("market-analysis", "llm-reports");

export function shouldUseLlmReport(engineRaw: unknown): boolean {
  return isCodexProvider(engineRaw);
}

export async function generateMarketLlmReport(input: MarketReportPayload): Promise<MarketLlmReport | null> {
  const sourceMarkdown = buildMarketReportSourceMarkdown(input);
  const timeoutOverride = resolveTimeoutOverride(process.env.MARKET_ANALYSIS_LLM_TIMEOUT_MS);

  return runCodexMarkdownReport({
    providerRaw: input.analysisEngine,
    taskPrefix: input.phase,
    sourceMarkdown,
    systemPrompt: buildMarketReportSystemPrompt(),
    userPrompt: "请阅读这份市场上下文 markdown，并输出完整分析报告。",
    outputDir: REPORT_DIR,
    modelOverride: normalizeText(process.env.MARKET_ANALYSIS_LLM_MODEL),
    ...(timeoutOverride ? { timeoutMs: timeoutOverride } : {})
  });
}

export function buildMarketReportSystemPrompt(): string {
  return [
    "你是市场策略分析助理，请只输出中文 markdown 报告。",
    "不要输出 JSON，不要输出代码块围栏，不要额外解释。",
    "报告必须可直接发给投资者阅读，语言自然、克制、可执行。",
    "默认面向手机端阅读：段落尽量短，每段控制在 1-3 句。",
    "正文优先使用自然语言，不要堆砌字段名、枚举值、变量名或调试口径。",
    "把输入视为基金持仓日报素材包，分析架构尽量贴近“决策仪表盘”：核心结论、数据视角、情报观察、执行计划。",
    "优先使用二级/三级标题和短 bullet，避免连续大段文字。",
    "持仓逐项建议中，每个标的都按“核心结论 / 数据视角 / 情报观察 / 执行计划”四段展开，再补充结构化表格。",
    "必须严格保持输入里的信号方向和决策动作，不得反转或改写原始信号。",
    "对于结构化数据，请在\"持仓逐项建议\"中补充 markdown 表格，列名使用中文，指标名称改成人能读懂的表达；宽表最多 4 列，超过时拆成多段短列表。",
    "除专有名词（如 ETF、LOF、SerpAPI）外，尽量保持中文表达一致，避免中英文混写。",
    "高风险或强约束内容请使用 quote（>）或加粗强调。",
    "关键信号值需转换为人类可读语言：",
    "- 决策动作: BUY→买入, ADD→加仓, HOLD→持有, REDUCE→减仓, REDEEM→赎回, WATCH→观察",
    "- 市场状态: MARKET_STRONG→偏强, MARKET_WEAK→偏弱, MARKET_NEUTRAL→中性",
    "- 阶段: midday→盘中, close→收盘",
    "- 特征覆盖: ok→完整, partial→部分可用, insufficient→不足",
    "请按以下结构输出：",
    "# 今日结论",
    "## 市场状态",
    "## 持仓逐项建议",
    "## 风险与观察点",
    "## 执行清单（短期/中期）"
  ].join("\n");
}

export function buildMarketReportSourceMarkdown(input: MarketReportPayload): string {
  const signalResult = input.signalResult;
  const portfolio = input.portfolio;
  const marketData = input.marketData;
  const optionalNews = input.optionalNewsContext;

  const lines: string[] = [
    "# 市场分析上下文",
    "",
    `- 运行阶段: ${formatPhaseLabel(normalizeText(input.phase))}`,
    "- 资产类型: 基金",
    `- 市场状态: ${formatMarketStateLabel(normalizeText(signalResult.marketState))}`,
    `- 基准: ${normalizeText(signalResult.benchmark) || "-"}`,
    `- 生成时间: ${normalizeText(signalResult.generatedAt) || new Date().toISOString()}`,
    ""
  ];

  appendPortfolioSection(lines, portfolio);
  appendSignalSection(lines, signalResult);
  appendFundDashboardSection(lines, signalResult, marketData);
  appendMarketErrorsSection(lines, marketData);
  appendNewsSection(lines, optionalNews);
  return lines.join("\n").trim();
}

function appendPortfolioSection(lines: string[], portfolio: MarketPortfolio): void {
  lines.push("## 账户持仓");
  const cash = toFiniteNumber(portfolio.cash);
  lines.push(`- 可用现金: ${cash === null ? "-" : String(cash)}`);

  const funds = portfolio.funds;
  if (funds.length === 0) {
    lines.push("- 持仓: (空)");
    lines.push("");
    return;
  }

  for (const item of funds) {
    const code = normalizeText(item.code) || "-";
    const name = normalizeText(item.name);
    const quantity = toFiniteNumber(item.quantity);
    const avgCost = toFiniteNumber(item.avgCost);
    lines.push(
      `- ${name ? `${name}(${code})` : code} | 持仓数量: ${quantity === null ? "-" : quantity} | 持仓成本: ${avgCost === null ? "-" : avgCost}`
    );
  }
  lines.push("");
}

function appendSignalSection(lines: string[], signalResult: FundAnalysisOutput): void {
  lines.push("## 系统初步判断");
  const signals = Array.isArray(signalResult.assetSignals) ? signalResult.assetSignals : [];
  if (signals.length === 0) {
    lines.push("- 无信号");
    lines.push("");
    return;
  }

  for (const item of signals) {
    const signal = asRecord(item);
    lines.push(`- ${normalizeText(signal.code) || "-"}: ${formatSignalLabel(normalizeText(signal.signal) || "WATCH")}`);
  }
  lines.push("");
}

function appendFundDashboardSection(lines: string[], signalResult: FundAnalysisOutput, marketData: RunFundAnalysisOutput["marketData"]): void {
  const dashboards = Array.isArray(signalResult.fund_dashboards) ? signalResult.fund_dashboards : [];
  if (dashboards.length === 0) {
    return;
  }
  const fundRecordMap = buildFundRecordMap(marketData);

  lines.push("## 持仓逐项建议");
  for (const item of dashboards) {
    const dashboard = item;
    const code = normalizeText(dashboard.fund_code) || "-";
    const name = normalizeText(dashboard.fund_name) || "-";
    const decision = formatDecisionLabel(normalizeText(dashboard.decision_type) || "watch");
    const score = toFiniteNumber(dashboard.sentiment_score);
    const confidence = toFiniteNumber(dashboard.confidence);
    const conclusion = normalizeText(dashboard.core_conclusion?.one_sentence) || "未提供";
    const label = name ? `${name}(${code})` : code;

    const record = fundRecordMap.get(code);
    const reportContext = record?.reportContext ?? createEmptyFundReportContext();

    lines.push(`### ${label}`);
    lines.push("#### 核心结论");
    lines.push(`- 当前动作: ${decision}`);
    lines.push(`- 一句话判断: ${conclusion}`);
    lines.push(`- 信号强弱: ${formatSignalStrength(score, confidence)}`);

    const rationale = buildFundRationaleLine(dashboard, reportContext);
    if (rationale) {
      lines.push(`- 结论依据: ${rationale}`);
    }

    lines.push("#### 数据视角");
    for (const dataLine of buildFundDataPerspectiveLines(dashboard, reportContext)) {
      lines.push(`- ${dataLine}`);
    }

    lines.push("#### 情报观察");
    for (const intelLine of buildFundIntelligenceLines(dashboard, reportContext)) {
      lines.push(`- ${intelLine}`);
    }

    lines.push("#### 执行计划");
    for (const planLine of buildFundExecutionLines(dashboard, reportContext)) {
      lines.push(`- ${planLine}`);
    }

    lines.push("");
  }

  const brief = normalizeText(signalResult.portfolio_report?.brief);
  const full = normalizeText(signalResult.portfolio_report?.full);
  if (brief || full) {
    lines.push("### 组合层判断");
    if (brief) {
      lines.push(`- 摘要: ${brief}`);
    }
    if (full) {
      lines.push(`- 详情: ${full}`);
    }
  }

  const auditErrors = asArray(signalResult.audit?.errors)
    .map((item) => normalizeText(item))
    .filter((item): item is string => Boolean(item));
  if (auditErrors.length > 0) {
    lines.push("### 运行中需要注意");
    for (const error of auditErrors.slice(0, 8)) {
      lines.push(`- ${error}`);
    }
  }
  lines.push("");
}

function appendMarketErrorsSection(lines: string[], marketData: RunFundAnalysisOutput["marketData"]): void {
  const errors = asArray(marketData.errors)
    .map((item) => normalizeText(item))
    .filter((item): item is string => Boolean(item));
  if (errors.length === 0) {
    return;
  }

  lines.push("## 数据告警与口径说明");
  for (const error of errors.slice(0, 8)) {
    lines.push(`- ${error}`);
  }
  lines.push("");
}

function appendNewsSection(lines: string[], optionalNewsContext: RunFundAnalysisOutput["optionalNewsContext"]): void {
  if (!optionalNewsContext || !Array.isArray(optionalNewsContext.funds) || optionalNewsContext.funds.length === 0) {
    return;
  }

  lines.push("## 近期公开信息摘录");

  for (const fund of optionalNewsContext.funds.slice(0, 16)) {
    const code = normalizeText(fund.fund_code) || "-";
    const name = normalizeText(fund.fund_name) || "-";
    lines.push(`- ${name}(${code})`);
    for (const news of fund.market_news.slice(0, 4)) {
      const row = asRecord(news);
      const title = normalizeText(row.title);
      const source = normalizeText(row.source);
      const published = normalizeText(row.published_at);
      const snippet = normalizeText(row.snippet);
      const text = [title || "未命名新闻", source ? `来源=${source}` : "", published ? `发布时间=${published}` : "", snippet || ""]
        .filter(Boolean)
        .join("；");
      lines.push(`  - ${text}`);
    }
  }
  lines.push("");
}

function buildFundRecordMap(marketData: RunFundAnalysisOutput["marketData"]): Map<string, FundRecordContext> {
  const map = new Map<string, FundRecordContext>();
  for (const record of marketData.funds) {
    const code = normalizeText(record.identity?.fund_code);
    if (!code) {
      continue;
    }
    map.set(code, {
      reportContext: buildFundReportContext(record.raw_context, record.feature_context)
    });
  }
  return map;
}

function buildFundMetricSummary(
  dashboard: Record<string, unknown>,
  reportContext: FundReportContext
): string[] {
  const metrics: string[] = [];
  const dataPerspective = asRecord(dashboard.data_perspective);
  const returns = mergeMetricRecords(asRecord(dataPerspective.return_metrics), asRecord(reportContext.feature_context.returns));
  const risks = mergeMetricRecords(asRecord(dataPerspective.risk_metrics), asRecord(reportContext.feature_context.risk));
  const relative = mergeMetricRecords(asRecord(dataPerspective.relative_metrics), asRecord(reportContext.feature_context.relative));
  const coverage = formatCoverageLabel(normalizeText(dataPerspective.feature_coverage));
  if (coverage) {
    metrics.push(`数据完整性: ${coverage}`);
  }

  const latestLine = joinSlashParts([
    compactMetricEntry("基金 ", reportContext.fund_series_summary.latest_value, 6, "", false),
    compactMetricEntry("基准 ", reportContext.benchmark_series_summary.latest_value, 6, "", false)
  ]);
  if (latestLine) {
    metrics.push(`最新值: ${latestLine}`);
  }

  const shortTerm = joinSlashParts([
    compactMetricEntry("1日", returns.ret_1d, 2, "%", true),
    compactMetricEntry("5日", returns.ret_5d, 2, "%", true)
  ]);
  if (shortTerm) {
    metrics.push(`短线回报: ${shortTerm}`);
  }

  const midTerm = joinSlashParts([
    compactMetricEntry("20日", returns.ret_20d, 2, "%", true),
    compactMetricEntry("60日", returns.ret_60d, 2, "%", true),
    compactMetricEntry("120日", returns.ret_120d, 2, "%", true)
  ]);
  if (midTerm) {
    metrics.push(`中期回报: ${midTerm}`);
  }

  const riskLine = joinSlashParts([
    compactMetricEntry("回撤", risks.max_drawdown, 2, "%", true),
    compactMetricEntry("波动", risks.volatility_annualized, 2, "%", false),
    compactMetricEntry("修复", risks.drawdown_recovery_days, 0, "天", false)
  ]);
  if (riskLine) {
    metrics.push(`风险刻画: ${riskLine}`);
  }

  const relativeLine = joinSlashParts([
    compactMetricEntry("20日超额", relative.benchmark_excess_20d, 2, "%", true),
    compactMetricEntry("60日超额", relative.benchmark_excess_60d, 2, "%", true),
    compactMetricEntry("跟踪偏离", relative.tracking_deviation, 2, "%", false)
  ]);
  if (relativeLine) {
    metrics.push(`相对表现: ${relativeLine}`);
  }

  return metrics.slice(0, 5);
}

function buildFundRationaleLine(
  dashboard: Record<string, unknown>,
  reportContext: FundReportContext
): string {
  const conclusion = asRecord(dashboard.core_conclusion);
  const thesis = asArray(conclusion.thesis)
    .map((item) => normalizeText(item))
    .filter((item): item is string => Boolean(item))
    .slice(0, 2);
  const metrics = buildFundMetricSummary(dashboard, reportContext).slice(0, 4);
  const parts = [...thesis];
  if (metrics.length > 0) {
    parts.push(`可直接核对的数据包括 ${metrics.join("、")}`);
  }
  return parts.join("；");
}

function buildFundDataPerspectiveLines(
  dashboard: Record<string, unknown>,
  reportContext: FundReportContext
): string[] {
  const dataPerspective = asRecord(dashboard.data_perspective);
  const returns = mergeMetricRecords(asRecord(dataPerspective.return_metrics), asRecord(reportContext.feature_context.returns));
  const risks = mergeMetricRecords(asRecord(dataPerspective.risk_metrics), asRecord(reportContext.feature_context.risk));
  const relative = mergeMetricRecords(asRecord(dataPerspective.relative_metrics), asRecord(reportContext.feature_context.relative));
  const trading = asRecord(reportContext.feature_context.trading);
  const stability = asRecord(reportContext.feature_context.stability);
  const nav = asRecord(reportContext.feature_context.nav);
  const warnings = readStringList(reportContext.feature_context.warnings).slice(0, 4);
  const fundSeries = reportContext.fund_series_summary;
  const benchmarkSeries = reportContext.benchmark_series_summary;
  const lines: string[] = [];

  const snapshotLine = joinReadableParts([
    formatSeriesLatest("基金最新值", fundSeries),
    formatSeriesLatest("基准最新值", benchmarkSeries),
    formatRangeStatement("基金近60日区间", fundSeries)
  ]);
  if (snapshotLine) {
    lines.push(`净值快照: ${snapshotLine}`);
  }

  const returnLine = joinReadableParts([
    metricStatement("近1日回报", returns.ret_1d, 2, "%", true),
    metricStatement("近5日回报", returns.ret_5d, 2, "%", true),
    metricStatement("近20日回报", returns.ret_20d, 2, "%", true),
    metricStatement("近60日回报", returns.ret_60d, 2, "%", true),
    metricStatement("近120日回报", returns.ret_120d, 2, "%", true)
  ]);
  if (returnLine) {
    lines.push(`收益表现: ${returnLine}`);
  }

  const riskLine = joinReadableParts([
    metricStatement("最大回撤", risks.max_drawdown, 2, "%", true),
    metricStatement("年化波动", risks.volatility_annualized, 2, "%", false),
    metricStatement("回撤修复", risks.drawdown_recovery_days, 0, "天", false)
  ]);
  if (riskLine) {
    lines.push(`风险刻画: ${riskLine}`);
  }

  const relativeLine = joinReadableParts([
    metricStatement("近20日相对基准超额", relative.benchmark_excess_20d, 2, "%", true),
    metricStatement("近60日相对基准超额", relative.benchmark_excess_60d, 2, "%", true),
    metricStatement("跟踪偏离", relative.tracking_deviation, 2, "%", false),
    metricStatement("同类分位", relative.peer_percentile, 2, "", false)
  ]);
  if (relativeLine) {
    lines.push(`相对表现: ${relativeLine}`);
  }

  const tradingLine = joinReadableParts([
    metricStatement("MA5 ", trading.ma5, 4, "", false),
    metricStatement("MA10 ", trading.ma10, 4, "", false),
    metricStatement("MA20 ", trading.ma20, 4, "", false),
    metricStatement("10日均成交量 ", trading.liquidity_avg_volume_10d, 2, "", false),
    metricStatement("量能变化", trading.volume_change_rate, 2, "%", true),
    metricStatement("折溢价", trading.premium_discount, 2, "%", true)
  ]);
  if (tradingLine) {
    lines.push(`交易结构: ${tradingLine}`);
  }

  const qualityLine = joinReadableParts([
    metricStatement("超额收益稳定度", stability.excess_return_consistency, 2, "", false),
    metricStatement("风格漂移", stability.style_drift, 2, "", false),
    metricStatement("净值平滑异常", stability.nav_smoothing_anomaly, 2, "", false),
    metricStatement("20日净值斜率", nav.nav_slope_20d, 4, "", false),
    metricStatement("Sharpe ", nav.sharpe, 2, "", false),
    metricStatement("Sortino ", nav.sortino, 2, "", false),
    metricStatement("Calmar ", nav.calmar, 2, "", false),
    metricStatement("基金经理任职 ", nav.manager_tenure, 2, "", false)
  ]);
  if (qualityLine) {
    lines.push(`稳定性与质量: ${qualityLine}`);
  }

  const coverage = formatCoverageLabel(normalizeText(dataPerspective.feature_coverage));
  if (coverage) {
    lines.push(`数据质量: 数据完整性 ${coverage}${warnings.length > 0 ? `；额外提示 ${warnings.join("；")}` : ""}`);
  } else if (warnings.length > 0) {
    lines.push(`数据质量: 额外提示 ${warnings.join("；")}`);
  }

  if (lines.length === 0) {
    lines.push("暂时没有足够的数据透视信息。");
  }

  return lines;
}

function buildFundIntelligenceLines(
  dashboard: Record<string, unknown>,
  reportContext: FundReportContext
): string[] {
  const lines: string[] = [];
  const events = reportContext.events;
  const riskAlerts = asArray(dashboard.risk_alerts)
    .map((risk) => normalizeText(risk))
    .filter((risk): risk is string => Boolean(risk))
    .slice(0, 4);
  const positiveSignals = pickPositiveIntel(reportContext).slice(0, 3);
  const newsStatus = describeNewsStatus(reportContext);
  const headline = pickTopNewsHeadline(reportContext);

  lines.push(`风险情报: ${riskAlerts.length > 0 ? riskAlerts.join("；") : "暂无新增重点风险。"}`);
  if (positiveSignals.length > 0) {
    lines.push(`积极线索: ${positiveSignals.join("；")}`);
  }
  const notices = summarizeStringList(events.notices, 3);
  if (notices) {
    lines.push(`公告/提示: ${notices}`);
  }
  const managerChanges = summarizeStringList(events.manager_changes, 3);
  if (managerChanges) {
    lines.push(`基金经理变化: ${managerChanges}`);
  }
  const subscriptionRedemption = summarizeStringList(events.subscription_redemption, 3);
  if (subscriptionRedemption) {
    lines.push(`申购赎回约束: ${subscriptionRedemption}`);
  }
  const regulatoryRisks = summarizeStringList(events.regulatory_risks, 3);
  if (regulatoryRisks) {
    lines.push(`监管/异常风险: ${regulatoryRisks}`);
  }
  if (newsStatus) {
    lines.push(`新闻检索: ${newsStatus}`);
  }
  if (headline) {
    lines.push(`代表性新闻: ${headline}`);
  }

  return lines;
}

function buildFundExecutionLines(
  dashboard: Record<string, unknown>,
  reportContext: FundReportContext
): string[] {
  const lines: string[] = [];
  const action = asRecord(dashboard.action_plan);
  const suggestion = normalizeText(action.suggestion);
  const positionChange = normalizeText(action.position_change);
  const executionConditions = asArray(action.execution_conditions)
    .map((item) => normalizeText(item))
    .filter((item): item is string => Boolean(item))
    .slice(0, 4);
  const stopConditions = asArray(action.stop_conditions)
    .map((item) => normalizeText(item))
    .filter((item): item is string => Boolean(item))
    .slice(0, 4);
  const checklist = buildFundChecklist(dashboard, reportContext);
  const ruleConstraint = buildRuleConstraintLine(dashboard);
  const positionContext = buildPositionContext(reportContext);

  lines.push(`操作建议: ${suggestion || "未提供"}`);
  if (positionChange) {
    lines.push(`仓位处理: ${positionChange}`);
  }
  if (executionConditions.length > 0) {
    lines.push(`执行条件: ${executionConditions.join("；")}`);
  }
  if (stopConditions.length > 0) {
    lines.push(`停止条件: ${stopConditions.join("；")}`);
  }
  if (ruleConstraint) {
    lines.push(ruleConstraint);
  }
  if (positionContext) {
    lines.push(`持仓背景: ${positionContext}`);
  }
  if (checklist.length > 0) {
    lines.push(`检查清单: ${checklist.join("；")}`);
  }

  return lines;
}

function buildFundChecklist(
  dashboard: Record<string, unknown>,
  reportContext: FundReportContext
): string[] {
  const items: string[] = [];
  const dataPerspective = asRecord(dashboard.data_perspective);
  const relative = mergeMetricRecords(asRecord(dataPerspective.relative_metrics), asRecord(reportContext.feature_context.relative));
  const risks = mergeMetricRecords(asRecord(dataPerspective.risk_metrics), asRecord(reportContext.feature_context.risk));
  const events = reportContext.events;
  const coverage = normalizeText(dataPerspective.feature_coverage);
  const excess20d = toFiniteNumber(relative.benchmark_excess_20d);
  const maxDrawdown = toFiniteNumber(risks.max_drawdown);
  const riskAlerts = asArray(dashboard.risk_alerts);
  const hasNews = Boolean(describeNewsStatus(reportContext));
  const warnings = readStringList(reportContext.feature_context.warnings);

  items.push(
    coverage === "ok"
      ? "✅ 数据完整度可用"
      : coverage === "partial"
        ? "⚠️ 数据仅部分可用"
        : "❌ 数据完整度不足"
  );
  if (excess20d !== null) {
    items.push(excess20d >= 0 ? "✅ 近20日相对基准未转弱" : "⚠️ 近20日相对基准偏弱");
  }
  if (maxDrawdown !== null) {
    items.push(maxDrawdown >= -5 ? "✅ 回撤仍在可控区间" : "⚠️ 回撤压力偏大");
  }
  if (asArray(events.subscription_redemption).length > 0) {
    items.push("⚠️ 存在申购赎回约束");
  } else if (asArray(events.manager_changes).length > 0) {
    items.push("⚠️ 存在基金经理变化");
  } else if (asArray(events.regulatory_risks).length > 0) {
    items.push("⚠️ 存在监管或异常风险");
  } else {
    items.push(riskAlerts.length > 0 ? "⚠️ 需要持续跟踪风险事件" : "✅ 暂无新增公开风险");
  }
  if (warnings.length > 0) {
    items.push("⚠️ 特征侧提示需复核");
  }
  items.push(hasNews ? "✅ 已有公开信息样本可跟踪" : "⚠️ 公开信息样本有限");

  return items.slice(0, 6);
}

function pickPositiveIntel(reportContext: FundReportContext): string[] {
  const newsItems = reportContext.events.market_news;
  const positives: string[] = [];

  for (const item of newsItems) {
    const row = asRecord(item);
    const title = normalizeText(row.title);
    const snippet = normalizeText(row.snippet);
    const text = `${title} ${snippet}`;
    if (/分红|扩容|获批|增长|回暖|修复|净流入|份额增长|创新高/.test(text)) {
      positives.push(title || text);
    }
  }

  return positives.filter(Boolean);
}

function buildRuleConstraintLine(dashboard: Record<string, unknown>): string {
  const ruleTrace = asRecord(dashboard.rule_trace);
  const blockedActions = summarizeStringList(ruleTrace.blocked_actions, 4);
  const ruleFlags = summarizeStringList(ruleTrace.rule_flags, 4);
  const adjustedScore = toFiniteNumber(ruleTrace.adjusted_score);
  const content = joinReadableParts([
    blockedActions ? `禁止动作 ${blockedActions}` : "",
    ruleFlags ? `风控标记 ${ruleFlags}` : "",
    adjustedScore === null ? "" : `规则调整分 ${formatMetricValue(adjustedScore, 0, "分", false)}`
  ]);
  return content ? `规则约束: ${content}` : "";
}

function buildPositionContext(reportContext: FundReportContext): string {
  const account = reportContext.account_context;
  const position = reportContext.position_snapshot;

  return joinReadableParts([
    position.current_position === undefined ? "" : `当前持仓 ${formatMetricValue(position.current_position, 4, "", false)}`,
    position.avg_cost === undefined ? "" : `持仓成本 ${formatMetricValue(position.avg_cost, 4, "", false)}`,
    position.estimated_market_value === "not_supported" ? "" : `估算市值 ${formatMetricValue(position.estimated_market_value, 2, "", false)}`,
    position.estimated_position_pnl_pct === "not_supported" ? "" : `浮动盈亏 ${formatMetricValue(position.estimated_position_pnl_pct, 2, "%", true)}`,
    `可用预算 ${formatMetricValue(position.budget, 2, "", false)}`,
    normalizeText(account.risk_preference) ? `风险偏好 ${formatRiskPreferenceLabel(normalizeText(account.risk_preference))}` : "",
    normalizeText(account.holding_horizon) ? `持有周期 ${formatHoldingHorizonLabel(normalizeText(account.holding_horizon))}` : ""
  ]);
}

function mergeMetricRecords(
  primary: Record<string, unknown>,
  fallback: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...fallback,
    ...primary
  };
}

function compactMetricEntry(
  label: string,
  value: unknown,
  digits: number,
  suffix: string,
  signed: boolean
): string {
  const rendered = formatMetricValue(value, digits, suffix, signed);
  return rendered ? `${label}${rendered}` : "";
}

function joinSlashParts(items: string[]): string {
  return items.filter(Boolean).join("/");
}

function readStringList(input: unknown): string[] {
  return asArray(input)
    .map((item) => normalizeText(item))
    .filter((item): item is string => Boolean(item));
}

function summarizeStringList(input: unknown, limit: number): string {
  return readStringList(input).slice(0, limit).join("；");
}

function formatSeriesLatest(label: string, summary: FundSeriesSummary): string {
  if (typeof summary.latest_value !== "number") {
    return "";
  }
  return `${label} ${formatMetricValue(summary.latest_value, 6, "", false)}${summary.latest_date ? ` (${summary.latest_date})` : ""}`;
}

function formatRangeStatement(label: string, summary: FundSeriesSummary): string {
  if (summary.low_60d === "not_supported" || summary.high_60d === "not_supported") {
    return "";
  }
  return `${label} ${formatMetricValue(summary.low_60d, 6, "", false)} - ${formatMetricValue(summary.high_60d, 6, "", false)}`;
}

function metricStatement(
  label: string,
  value: unknown,
  digits: number,
  suffix: string,
  signed: boolean
): string {
  const rendered = formatMetricValue(value, digits, suffix, signed);
  return rendered ? `${label}${rendered}` : "";
}

function joinReadableParts(items: string[]): string {
  return items.filter(Boolean).join("；");
}

function formatMetricValue(value: unknown, digits: number, suffix: string, signed: boolean): string {
  if (value === null || value === undefined || value === "not_supported") {
    return "";
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "";
  }
  const normalized = Number(numeric.toFixed(digits));
  const prefix = signed && normalized > 0 ? "+" : "";
  return `${prefix}${normalized}${suffix || ""}`;
}

function describeNewsStatus(reportContext: FundReportContext): string {
  const sourceChain = asArray(reportContext.source_chain).map((item) => normalizeText(item)).filter((item): item is string => Boolean(item));
  const errors = asArray(reportContext.errors).map((item) => normalizeText(item)).filter((item): item is string => Boolean(item));
  const events = asRecord(reportContext.events);
  const newsItems = asArray(events.market_news);
  const newsCount = newsItems.length;

  const disabledSearchEngine = sourceChain.find((item) => /search_engine:.+:disabled$/.test(item));
  if (disabledSearchEngine) {
    const engineId = disabledSearchEngine.replace(/^search_engine:/, "").replace(/:disabled$/, "");
    return `新闻检索已禁用（${engineId || "unknown"}）`;
  }
  const missingSearchEngine = sourceChain.find((item) => /search_engine:missing:/.test(item));
  if (missingSearchEngine) {
    return `新闻检索配置缺失（${missingSearchEngine.replace(/^search_engine:missing:/, "")}）`;
  }

  if (sourceChain.includes("env:MARKET_ANALYSIS_NEWS_CONTEXT")) {
    return `使用环境变量新闻上下文 (${newsCount}条)`;
  }
  const serpApiSource = sourceChain.find((item) => item.startsWith("serpapi:"));
  if (serpApiSource) {
    const serpApiEngine = serpApiSource.replace(/^serpapi:/, "") || "unknown";
    return newsCount > 0
      ? `SerpAPI(${serpApiEngine}) 命中 ${newsCount} 条`
      : `SerpAPI(${serpApiEngine}) 本次未命中明确新闻`;
  }
  const fallbackSource = sourceChain.find((item) => item.startsWith("fallback:"));
  if (fallbackSource) {
    return newsCount > 0
      ? `回退新闻源命中 ${newsCount} 条`
      : "回退新闻源未命中";
  }
  const serpError = errors.find((item) => /serpapi/i.test(item));
  if (serpError) {
    return `SerpAPI 失败: ${serpError}`;
  }

  if (newsCount === 0) {
    return "";
  }

  return `新闻命中 ${newsCount} 条`;
}

function pickTopNewsHeadline(reportContext: FundReportContext): string {
  const events = asRecord(reportContext.events);
  const newsItems = asArray(events.market_news);
  if (newsItems.length === 0) {
    return "";
  }
  const item = asRecord(newsItems[0]);
  const title = normalizeText(item.title);
  const source = normalizeText(item.source);
  if (!title) {
    return "";
  }
  return source ? `${title} (${source})` : title;
}

function formatDecisionLabel(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (value === "buy") return "买入";
  if (value === "add") return "加仓";
  if (value === "hold") return "持有";
  if (value === "reduce") return "减仓";
  if (value === "redeem") return "赎回";
  if (value === "watch") return "观察";
  return raw || "观察";
}

function formatSignalLabel(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (value === "buy") return "买入";
  if (value === "add") return "加仓";
  if (value === "hold") return "持有";
  if (value === "reduce") return "减仓";
  if (value === "redeem") return "赎回";
  if (value === "watch") return "观察";
  return raw || "观察";
}

function formatCoverageLabel(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (value === "ok") return "完整";
  if (value === "partial") return "部分可用";
  if (value === "insufficient") return "不足";
  return raw || "";
}

function formatRiskPreferenceLabel(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (value === "conservative") return "稳健";
  if (value === "balanced") return "均衡";
  if (value === "aggressive") return "进取";
  return raw || "-";
}

function formatHoldingHorizonLabel(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (value === "short_term") return "短期";
  if (value === "medium_term") return "中期";
  if (value === "long_term") return "长期";
  return raw || "-";
}

function formatMarketStateLabel(raw: string): string {
  const value = raw.trim().toUpperCase();
  if (value === "MARKET_STRONG") return "偏强";
  if (value === "MARKET_WEAK") return "偏弱";
  if (value === "MARKET_NEUTRAL") return "中性";
  return raw || "-";
}

function formatPhaseLabel(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (value === "midday") return "盘中";
  if (value === "close") return "收盘";
  return raw || "-";
}

function formatSignalStrength(score: number | null, confidence: number | null): string {
  const scoreText = score === null ? "评分未知" : `评分 ${Math.round(score)} 分`;
  const confidenceText = confidence === null ? "置信度未知" : `置信度 ${confidence.toFixed(2)}`;
  return `${scoreText}，${confidenceText}`;
}

function resolveTimeoutOverride(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return 15000;
  }
  return Math.floor(value);
}

function asRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  return input as Record<string, unknown>;
}

function asArray(input: unknown): unknown[] {
  return Array.isArray(input) ? input : [];
}

function normalizeText(input: unknown): string {
  if (typeof input !== "string") {
    return "";
  }
  return input.trim();
}

function toFiniteNumber(input: unknown): number | null {
  const value = Number(input);
  if (!Number.isFinite(value)) {
    return null;
  }
  return Math.round(value * 10000) / 10000;
}
