import { resolveDataPath } from "../../../storage/persistence";
import { isCodexProvider, runCodexMarkdownReport } from "../../codex/markdownReport";

export type MarketReportPayload = {
  phase: string;
  portfolio: unknown;
  marketData: unknown;
  signalResult: unknown;
  optionalNewsContext: unknown;
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
  const signalResult = asRecord(input.signalResult);
  const portfolio = asRecord(input.portfolio);
  const marketData = asRecord(input.marketData);
  const optionalNews = asRecord(input.optionalNewsContext);

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

function appendPortfolioSection(lines: string[], portfolio: Record<string, unknown>): void {
  lines.push("## 账户持仓");
  const cash = toFiniteNumber(portfolio.cash);
  lines.push(`- 可用现金: ${cash === null ? "-" : String(cash)}`);

  const funds = asArray(portfolio.funds);
  if (funds.length === 0) {
    lines.push("- 持仓: (空)");
    lines.push("");
    return;
  }

  for (const item of funds) {
    const holding = asRecord(item);
    const code = normalizeText(holding.code) || "-";
    const name = normalizeText(holding.name);
    const quantity = toFiniteNumber(holding.quantity);
    const avgCost = toFiniteNumber(holding.avgCost);
    lines.push(
      `- ${name ? `${name}(${code})` : code} | 持仓数量: ${quantity === null ? "-" : quantity} | 持仓成本: ${avgCost === null ? "-" : avgCost}`
    );
  }
  lines.push("");
}

function appendSignalSection(lines: string[], signalResult: Record<string, unknown>): void {
  lines.push("## 系统初步判断");
  const signals = asArray(signalResult.assetSignals);
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

function appendFundDashboardSection(
  lines: string[],
  signalResult: Record<string, unknown>,
  marketData: Record<string, unknown>
): void {
  const dashboards = asArray(signalResult.fund_dashboards);
  if (dashboards.length === 0) {
    return;
  }
  const fundRecordMap = buildFundRecordMap(marketData);

  lines.push("## 持仓逐项建议");
  for (const item of dashboards) {
    const dashboard = asRecord(item);
    const code = normalizeText(dashboard.fund_code) || "-";
    const name = normalizeText(dashboard.fund_name) || "-";
    const decision = formatDecisionLabel(normalizeText(dashboard.decision_type) || "watch");
    const score = toFiniteNumber(dashboard.sentiment_score);
    const confidence = toFiniteNumber(dashboard.confidence);
    const conclusion = normalizeText(asRecord(dashboard.core_conclusion).one_sentence) || "未提供";
    const label = name ? `${name}(${code})` : code;

    const record = fundRecordMap.get(code);
    const rawContext = record ? asRecord(record.raw_context) : {};

    lines.push(`### ${label}`);
    lines.push("#### 核心结论");
    lines.push(`- 当前动作: ${decision}`);
    lines.push(`- 一句话判断: ${conclusion}`);
    lines.push(`- 信号强弱: ${formatSignalStrength(score, confidence)}`);

    const rationale = buildFundRationaleLine(dashboard);
    if (rationale) {
      lines.push(`- 结论依据: ${rationale}`);
    }

    lines.push("#### 数据视角");
    for (const dataLine of buildFundDataPerspectiveLines(dashboard)) {
      lines.push(`- ${dataLine}`);
    }

    lines.push("#### 情报观察");
    for (const intelLine of buildFundIntelligenceLines(dashboard, rawContext)) {
      lines.push(`- ${intelLine}`);
    }

    lines.push("#### 执行计划");
    for (const planLine of buildFundExecutionLines(dashboard, rawContext)) {
      lines.push(`- ${planLine}`);
    }

    lines.push("");
  }

  const portfolioReport = asRecord(signalResult.portfolio_report);
  const brief = normalizeText(portfolioReport.brief);
  const full = normalizeText(portfolioReport.full);
  if (brief || full) {
    lines.push("### 组合层判断");
    if (brief) {
      lines.push(`- 摘要: ${brief}`);
    }
    if (full) {
      lines.push(`- 详情: ${full}`);
    }
  }

  const audit = asRecord(signalResult.audit);
  const auditErrors = asArray(audit.errors)
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

function appendMarketErrorsSection(lines: string[], marketData: Record<string, unknown>): void {
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

function appendNewsSection(lines: string[], optionalNewsContext: Record<string, unknown>): void {
  if (Object.keys(optionalNewsContext).length === 0) {
    return;
  }

  lines.push("## 近期公开信息摘录");

  const funds = asArray(optionalNewsContext.funds);
  for (const item of funds.slice(0, 16)) {
    const fund = asRecord(item);
    const code = normalizeText(fund.fund_code) || "-";
    const name = normalizeText(fund.fund_name) || "-";
    lines.push(`- ${name}(${code})`);
    const marketNews = asArray(fund.market_news);
    for (const news of marketNews.slice(0, 4)) {
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

function buildFundRecordMap(marketData: Record<string, unknown>): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  const fundRecords = asArray(marketData.funds);
  for (const item of fundRecords) {
    const record = asRecord(item);
    const identity = asRecord(record.identity);
    const code = normalizeText(identity.fund_code);
    if (!code) {
      continue;
    }
    map.set(code, record);
  }
  return map;
}

function buildFundMetricSummary(dashboard: Record<string, unknown>): string[] {
  const metrics: string[] = [];
  const dataPerspective = asRecord(dashboard.data_perspective);
  const returns = asRecord(dataPerspective.return_metrics);
  const risks = asRecord(dataPerspective.risk_metrics);
  const relative = asRecord(dataPerspective.relative_metrics);
  const coverage = formatCoverageLabel(normalizeText(dataPerspective.feature_coverage));
  if (coverage) {
    metrics.push(`数据完整性: ${coverage}`);
  }

  const ret20d = formatMetricValue(returns.ret_20d, 2, "%", true);
  if (ret20d) {
    metrics.push(`近20个交易日回报: ${ret20d}`);
  }
  const ret60d = formatMetricValue(returns.ret_60d, 2, "%", true);
  if (ret60d) {
    metrics.push(`近60个交易日回报: ${ret60d}`);
  }
  const drawdown = formatMetricValue(risks.max_drawdown, 2, "%", true);
  if (drawdown) {
    metrics.push(`最大回撤: ${drawdown}`);
  }
  const volatility = formatMetricValue(risks.volatility_annualized, 2, "%", false);
  if (volatility) {
    metrics.push(`年化波动: ${volatility}`);
  }
  const excess20d = formatMetricValue(relative.benchmark_excess_20d, 2, "%", true);
  if (excess20d) {
    metrics.push(`近20个交易日相对基准超额: ${excess20d}`);
  }

  return metrics.slice(0, 6);
}

function buildFundRationaleLine(dashboard: Record<string, unknown>): string {
  const conclusion = asRecord(dashboard.core_conclusion);
  const thesis = asArray(conclusion.thesis)
    .map((item) => normalizeText(item))
    .filter((item): item is string => Boolean(item))
    .slice(0, 2);
  const metrics = buildFundMetricSummary(dashboard).slice(0, 4);
  const parts = [...thesis];
  if (metrics.length > 0) {
    parts.push(`可直接核对的数据包括 ${metrics.join("、")}`);
  }
  return parts.join("；");
}

function buildFundDataPerspectiveLines(dashboard: Record<string, unknown>): string[] {
  const dataPerspective = asRecord(dashboard.data_perspective);
  const returns = asRecord(dataPerspective.return_metrics);
  const risks = asRecord(dataPerspective.risk_metrics);
  const relative = asRecord(dataPerspective.relative_metrics);
  const lines: string[] = [];

  const returnLine = joinReadableParts([
    metricStatement("近20个交易日回报", returns.ret_20d, 2, "%", true),
    metricStatement("近60个交易日回报", returns.ret_60d, 2, "%", true)
  ]);
  if (returnLine) {
    lines.push(`收益表现: ${returnLine}`);
  }

  const riskLine = joinReadableParts([
    metricStatement("最大回撤", risks.max_drawdown, 2, "%", true),
    metricStatement("年化波动", risks.volatility_annualized, 2, "%", false)
  ]);
  if (riskLine) {
    lines.push(`风险刻画: ${riskLine}`);
  }

  const relativeLine = joinReadableParts([
    metricStatement("近20个交易日相对基准超额", relative.benchmark_excess_20d, 2, "%", true),
    metricStatement("近60个交易日相对基准超额", relative.benchmark_excess_60d, 2, "%", true),
    metricStatement("跟踪偏离", relative.tracking_deviation, 2, "%", false)
  ]);
  if (relativeLine) {
    lines.push(`相对表现: ${relativeLine}`);
  }

  const coverage = formatCoverageLabel(normalizeText(dataPerspective.feature_coverage));
  if (coverage) {
    lines.push(`数据完整性: ${coverage}`);
  }

  if (lines.length === 0) {
    lines.push("暂时没有足够的数据透视信息。");
  }

  return lines;
}

function buildFundIntelligenceLines(
  dashboard: Record<string, unknown>,
  rawContext: Record<string, unknown>
): string[] {
  const lines: string[] = [];
  const riskAlerts = asArray(dashboard.risk_alerts)
    .map((risk) => normalizeText(risk))
    .filter((risk): risk is string => Boolean(risk))
    .slice(0, 4);
  const positiveSignals = pickPositiveIntel(rawContext).slice(0, 3);
  const newsStatus = describeNewsStatus(rawContext);
  const headline = pickTopNewsHeadline(rawContext);

  lines.push(`风险情报: ${riskAlerts.length > 0 ? riskAlerts.join("；") : "暂无新增重点风险。"}`);
  if (positiveSignals.length > 0) {
    lines.push(`积极线索: ${positiveSignals.join("；")}`);
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
  rawContext: Record<string, unknown>
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
  const checklist = buildFundChecklist(dashboard, rawContext);

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
  if (checklist.length > 0) {
    lines.push(`检查清单: ${checklist.join("；")}`);
  }

  return lines;
}

function buildFundChecklist(
  dashboard: Record<string, unknown>,
  rawContext: Record<string, unknown>
): string[] {
  const items: string[] = [];
  const dataPerspective = asRecord(dashboard.data_perspective);
  const relative = asRecord(dataPerspective.relative_metrics);
  const risks = asRecord(dataPerspective.risk_metrics);
  const coverage = normalizeText(dataPerspective.feature_coverage);
  const excess20d = toFiniteNumber(relative.benchmark_excess_20d);
  const maxDrawdown = toFiniteNumber(risks.max_drawdown);
  const riskAlerts = asArray(dashboard.risk_alerts);
  const hasNews = Boolean(describeNewsStatus(rawContext));

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
  items.push(riskAlerts.length > 0 ? "⚠️ 需要持续跟踪风险事件" : "✅ 暂无新增公开风险");
  items.push(hasNews ? "✅ 已有公开信息样本可跟踪" : "⚠️ 公开信息样本有限");

  return items.slice(0, 5);
}

function pickPositiveIntel(rawContext: Record<string, unknown>): string[] {
  const events = asRecord(rawContext.events);
  const newsItems = asArray(events.market_news);
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

function describeNewsStatus(rawContext: Record<string, unknown>): string {
  const sourceChain = asArray(rawContext.source_chain).map((item) => normalizeText(item)).filter((item): item is string => Boolean(item));
  const errors = asArray(rawContext.errors).map((item) => normalizeText(item)).filter((item): item is string => Boolean(item));
  const events = asRecord(rawContext.events);
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

function pickTopNewsHeadline(rawContext: Record<string, unknown>): string {
  const events = asRecord(rawContext.events);
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
