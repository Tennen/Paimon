import { resolveDataPath } from "../../storage/persistence";
import { isCodexProvider, runCodexMarkdownReport } from "../codex/markdownReport";

export type MarketRunPayload = {
  phase: string;
  portfolio: unknown;
  marketData: unknown;
  signalResult: unknown;
  optionalNewsContext: unknown;
  analysisEngine: string;
};

export type CodexMarkdownReport = {
  provider: "codex";
  model: string;
  summary: string;
  markdown: string;
  generatedAt: string;
  inputPath: string;
  outputPath: string;
};

const REPORT_DIR = resolveDataPath("market-analysis", "codex-reports");

export function shouldUseCodexMarkdownReport(engineRaw: unknown): boolean {
  return isCodexProvider(engineRaw);
}

export async function generateCodexMarkdownReport(input: MarketRunPayload): Promise<CodexMarkdownReport | null> {
  const sourceMarkdown = buildCodexMarketReportSourceMarkdown(input);
  const timeoutOverride = resolveTimeoutOverride(process.env.MARKET_ANALYSIS_LLM_TIMEOUT_MS);

  return runCodexMarkdownReport({
    providerRaw: input.analysisEngine,
    taskPrefix: input.phase,
    sourceMarkdown,
    systemPrompt: buildCodexMarketReportSystemPrompt(),
    userPrompt: "请阅读这份市场上下文 markdown，并输出完整分析报告。",
    engineSystemPrompt: buildMarkdownReportEngineSystemPrompt(),
    outputDir: REPORT_DIR,
    modelOverride: normalizeText(process.env.MARKET_ANALYSIS_LLM_MODEL),
    ...(timeoutOverride ? { timeoutMs: timeoutOverride } : {})
  });
}

export function buildCodexMarketReportSystemPrompt(): string {
  return [
    "你是市场策略分析助理，请只输出中文 markdown 报告。",
    "不要输出 JSON，不要输出代码块围栏，不要额外解释。",
    "报告必须可直接发给投资者阅读，语言自然、克制、可执行。",
    "必须严格保持输入里的信号方向和决策动作，不得反转或改写原始信号。",
    "输入中会出现“旧链路补充信息（必须吸收）”章节，这些字段必须在报告里覆盖，不能遗漏。",
    "对于基金这种结构化数据，优先在“持仓逐项建议”中使用 markdown 表格呈现（基金/动作/评分/置信度/关键指标/数据完整性/新闻检索）。",
    "高风险或强约束内容请使用 quote（>）或加粗强调。",
    "请按以下结构输出：",
    "# 今日结论",
    "## 市场状态",
    "## 持仓逐项建议",
    "## 风险与观察点",
    "## 执行清单（短期/中期）"
  ].join("\n");
}

function buildMarkdownReportEngineSystemPrompt(): string {
  return [
    "You are acting as an LLM backend for an automation runtime.",
    "Read the provided conversation messages and output only the assistant reply body.",
    "Do not execute side-effectful operations and do not modify workspace files.",
    "If the messages require strict JSON, output strict JSON only.",
    "Preserve markdown formatting instructions from the message content."
  ].join("\n");
}

export function buildCodexMarketReportSourceMarkdown(input: MarketRunPayload): string {
  const signalResult = asRecord(input.signalResult);
  const portfolio = asRecord(input.portfolio);
  const marketData = asRecord(input.marketData);
  const optionalNews = asRecord(input.optionalNewsContext);

  const lines: string[] = [
    "# Market Analysis Context",
    "",
    `- 运行阶段: ${normalizeText(input.phase) || "-"}`,
    `- 资产类型: ${normalizeText(signalResult.assetType) || normalizeText(marketData.assetType) || "-"}`,
    `- 市场状态: ${normalizeText(signalResult.marketState) || "-"}`,
    `- 基准: ${normalizeText(signalResult.benchmark) || "-"}`,
    `- 生成时间: ${normalizeText(signalResult.generatedAt) || new Date().toISOString()}`,
    ""
  ];

  appendPortfolioSection(lines, portfolio);
  appendSignalSection(lines, signalResult);
  appendFundDashboardSection(lines, signalResult, marketData);
  appendLegacyFundCoverageSection(lines, signalResult, marketData);
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
      `- ${name ? `${name}(${code})` : code} | quantity=${quantity === null ? "-" : quantity} | avgCost=${avgCost === null ? "-" : avgCost}`
    );
  }
  lines.push("");
}

function appendSignalSection(lines: string[], signalResult: Record<string, unknown>): void {
  lines.push("## 规则引擎信号");
  const signals = asArray(signalResult.assetSignals);
  if (signals.length === 0) {
    lines.push("- 无信号");
    lines.push("");
    return;
  }

  for (const item of signals) {
    const signal = asRecord(item);
    lines.push(`- ${normalizeText(signal.code) || "-"}: ${normalizeText(signal.signal) || "WATCH"}`);
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

  lines.push("## 基金分析要点");
  for (const item of dashboards) {
    const dashboard = asRecord(item);
    const code = normalizeText(dashboard.fund_code) || "-";
    const name = normalizeText(dashboard.fund_name) || "-";
    const decision = normalizeText(dashboard.decision_type) || "watch";
    const score = toFiniteNumber(dashboard.sentiment_score);
    const confidence = toFiniteNumber(dashboard.confidence);
    const conclusion = normalizeText(asRecord(dashboard.core_conclusion).one_sentence) || "未提供";
    lines.push(`- ${name}(${code}) | decision=${decision} | score=${score ?? "-"} | confidence=${confidence ?? "-"}`);
    lines.push(`  - 结论: ${conclusion}`);

    const riskAlerts = asArray(dashboard.risk_alerts)
      .map((risk) => normalizeText(risk))
      .filter((risk): risk is string => Boolean(risk))
      .slice(0, 4);
    if (riskAlerts.length > 0) {
      lines.push(`  - 风险: ${riskAlerts.join(" | ")}`);
    }

    const action = asRecord(dashboard.action_plan);
    const suggestion = normalizeText(action.suggestion);
    const positionChange = normalizeText(action.position_change);
    if (suggestion || positionChange) {
      lines.push(`  - 执行: ${suggestion || "未提供"}${positionChange ? ` | 仓位: ${positionChange}` : ""}`);
    }

    const metricSummary = buildFundMetricSummary(dashboard);
    if (metricSummary.length > 0) {
      lines.push(`  - 关键指标: ${metricSummary.join(" | ")}`);
    }

    const insufficientData = asRecord(dashboard.insufficient_data);
    const isInsufficient = Boolean(insufficientData.is_insufficient);
    if (isInsufficient) {
      const missingFields = asArray(insufficientData.missing_fields)
        .map((field) => normalizeText(field))
        .filter((field): field is string => Boolean(field))
        .slice(0, 6);
      lines.push(`  - 数据完整性: 不足${missingFields.length > 0 ? ` (missing=${missingFields.join(", ")})` : ""}`);
    } else {
      lines.push("  - 数据完整性: 完整");
    }

    const record = fundRecordMap.get(code);
    if (record && Object.keys(record).length > 0) {
      const rawContext = asRecord(record.raw_context);
      const newsStatus = describeNewsStatus(rawContext);
      const newsHeadline = pickTopNewsHeadline(rawContext);
      lines.push(`  - 新闻检索: ${newsStatus}`);
      if (newsHeadline) {
        lines.push(`  - 新闻样本: ${newsHeadline}`);
      }
    }
  }

  const portfolioReport = asRecord(signalResult.portfolio_report);
  const brief = normalizeText(portfolioReport.brief);
  const full = normalizeText(portfolioReport.full);
  if (brief || full) {
    lines.push("### 组合层结论");
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
    lines.push("### 审计错误");
    for (const error of auditErrors.slice(0, 8)) {
      lines.push(`- ${error}`);
    }
  }
  lines.push("");
}

function appendLegacyFundCoverageSection(
  lines: string[],
  signalResult: Record<string, unknown>,
  marketData: Record<string, unknown>
): void {
  const dashboards = asArray(signalResult.fund_dashboards);
  if (dashboards.length === 0) {
    return;
  }

  const fundRecordMap = buildFundRecordMap(marketData);
  lines.push("## 旧链路补充信息（必须吸收）");
  lines.push("> 以下字段来自旧文字链路，最终 markdown 报告必须覆盖这些信息，不得遗漏。");
  lines.push("");
  lines.push("### 基金逐项速览（结构化）");
  lines.push("| 基金 | 动作 | score | confidence | 关键指标 | 数据完整性 | 新闻检索 |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");

  for (const item of dashboards) {
    const dashboard = asRecord(item);
    const code = normalizeText(dashboard.fund_code) || "-";
    const name = normalizeText(dashboard.fund_name) || "-";
    const label = sanitizeMarkdownTableCell(`${name}(${code})`);
    const decision = sanitizeMarkdownTableCell(normalizeText(dashboard.decision_type) || "watch");
    const score = toFiniteNumber(dashboard.sentiment_score);
    const confidence = toFiniteNumber(dashboard.confidence);
    const metricSummary = sanitizeMarkdownTableCell(buildFundMetricSummary(dashboard).join(" / ") || "-");

    const insufficientData = asRecord(dashboard.insufficient_data);
    const isInsufficient = Boolean(insufficientData.is_insufficient);
    const missingFields = asArray(insufficientData.missing_fields)
      .map((field) => normalizeText(field))
      .filter((field): field is string => Boolean(field))
      .slice(0, 4);
    const dataIntegrity = sanitizeMarkdownTableCell(
      isInsufficient
        ? `不足${missingFields.length > 0 ? `(${missingFields.join(", ")})` : ""}`
        : "完整"
    );

    const record = fundRecordMap.get(code);
    const rawContext = record ? asRecord(record.raw_context) : {};
    const newsStatus = sanitizeMarkdownTableCell(describeNewsStatus(rawContext));

    lines.push(
      `| ${label} | ${decision} | ${score ?? "-"} | ${confidence ?? "-"} | ${metricSummary} | ${dataIntegrity} | ${newsStatus} |`
    );
  }
  lines.push("");
  lines.push("### 逐项补充字段");
  for (const item of dashboards) {
    const dashboard = asRecord(item);
    const code = normalizeText(dashboard.fund_code) || "-";
    const name = normalizeText(dashboard.fund_name) || "-";
    const label = name ? `${name}(${code})` : code;
    lines.push(`- ${label}`);

    const conclusion = normalizeText(asRecord(dashboard.core_conclusion).one_sentence);
    if (conclusion) {
      lines.push(`  - 结论: ${conclusion}`);
    }

    const action = asRecord(dashboard.action_plan);
    const suggestion = normalizeText(action.suggestion);
    const positionChange = normalizeText(action.position_change);
    if (suggestion || positionChange) {
      lines.push(`  - 执行: ${suggestion || "未提供"}${positionChange ? ` | 仓位: ${positionChange}` : ""}`);
    }

    const riskAlerts = asArray(dashboard.risk_alerts)
      .map((risk) => normalizeText(risk))
      .filter((risk): risk is string => Boolean(risk))
      .slice(0, 4);
    if (riskAlerts.length > 0) {
      lines.push(`  - 风险: ${riskAlerts.join(" | ")}`);
    }

    const record = fundRecordMap.get(code);
    if (record && Object.keys(record).length > 0) {
      const rawContext = asRecord(record.raw_context);
      const headline = pickTopNewsHeadline(rawContext);
      if (headline) {
        lines.push(`  - 新闻样本: ${headline}`);
      }
    }
  }

  const portfolioReport = asRecord(signalResult.portfolio_report);
  const brief = normalizeText(portfolioReport.brief);
  if (brief) {
    lines.push("");
    lines.push(`### 组合摘要\n- ${brief}`);
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

  lines.push("## 数据告警");
  for (const error of errors.slice(0, 8)) {
    lines.push(`- ${error}`);
  }
  lines.push("");
}

function appendNewsSection(lines: string[], optionalNewsContext: Record<string, unknown>): void {
  if (Object.keys(optionalNewsContext).length === 0) {
    return;
  }

  lines.push("## 新闻上下文");

  const equityNews = optionalNewsContext.content;
  if (typeof equityNews === "string" && equityNews.trim()) {
    lines.push(`- 摘要: ${equityNews.trim()}`);
  }

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
      const text = [title || "未命名新闻", source ? `source=${source}` : "", published ? `published=${published}` : "", snippet || ""]
        .filter(Boolean)
        .join(" | ");
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
  const coverage = normalizeText(dataPerspective.feature_coverage);
  if (coverage) {
    metrics.push(`coverage=${coverage}`);
  }

  const ret20d = formatMetricValue(returns.ret_20d, 2, "%", true);
  if (ret20d) {
    metrics.push(`ret20d=${ret20d}`);
  }
  const ret60d = formatMetricValue(returns.ret_60d, 2, "%", true);
  if (ret60d) {
    metrics.push(`ret60d=${ret60d}`);
  }
  const drawdown = formatMetricValue(risks.max_drawdown, 2, "%", true);
  if (drawdown) {
    metrics.push(`maxDD=${drawdown}`);
  }
  const volatility = formatMetricValue(risks.volatility_annualized, 2, "%", false);
  if (volatility) {
    metrics.push(`vol=${volatility}`);
  }
  const excess20d = formatMetricValue(relative.benchmark_excess_20d, 2, "%", true);
  if (excess20d) {
    metrics.push(`excess20d=${excess20d}`);
  }

  return metrics.slice(0, 6);
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
    return `Search Engine 已禁用（${engineId || "unknown"}）`;
  }
  const missingSearchEngine = sourceChain.find((item) => /search_engine:missing:/.test(item));
  if (missingSearchEngine) {
    return `Search Engine 缺失（${missingSearchEngine.replace(/^search_engine:missing:/, "")}）`;
  }

  if (sourceChain.includes("env:MARKET_ANALYSIS_NEWS_CONTEXT")) {
    return `使用环境变量新闻上下文 (${newsCount}条)`;
  }
  if (sourceChain.includes("serpapi:disabled_no_key")) {
    return "未启用 SerpAPI（SERPAPI_KEY 未配置）";
  }
  const serpApiSource = sourceChain.find((item) => item.startsWith("serpapi:"));
  if (serpApiSource) {
    const serpApiEngine = serpApiSource.replace(/^serpapi:/, "") || "unknown";
    if (newsCount > 0) {
      return `SerpAPI(${serpApiEngine}) 命中 ${newsCount} 条`;
    }
    const serpError = errors.find((item) => /serpapi/i.test(item));
    if (serpError) {
      return `SerpAPI 失败: ${serpError}`;
    }
    return `SerpAPI(${serpApiEngine}) 已调用，未命中相关新闻`;
  }
  const fallbackSource = sourceChain.find((item) => item.startsWith("fallback:"));
  if (fallbackSource) {
    return newsCount > 0 ? `回退新闻源命中 ${newsCount} 条` : "回退新闻源无结果";
  }
  const serpError = errors.find((item) => /serpapi/i.test(item));
  if (serpError) {
    return `SerpAPI 失败: ${serpError}`;
  }

  return newsCount > 0 ? `新闻命中 ${newsCount} 条` : "未获取到相关新闻";
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

function sanitizeMarkdownTableCell(input: string): string {
  const text = normalizeText(input) || "-";
  return text.replace(/\|/g, "/");
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
