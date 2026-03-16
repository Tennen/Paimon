import { resolveDataPath } from "../../storage/persistence";
import { isCodexProvider, runCodexMarkdownReport } from "../codex/markdownReport";

type MarketRunPayload = {
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
  const sourceMarkdown = buildSourceMarkdown(input);
  const timeoutOverride = resolveTimeoutOverride(process.env.MARKET_ANALYSIS_LLM_TIMEOUT_MS);

  return runCodexMarkdownReport({
    providerRaw: input.analysisEngine,
    taskPrefix: input.phase,
    sourceMarkdown,
    systemPrompt: [
      "你是市场策略分析助理，请只输出中文 markdown 报告。",
      "不要输出 JSON，不要输出代码块围栏，不要额外解释。",
      "报告必须可直接发给投资者阅读，语言自然、克制、可执行。",
      "请按以下结构输出：",
      "# 今日结论",
      "## 市场状态",
      "## 持仓逐项建议",
      "## 风险与观察点",
      "## 执行清单（短期/中期）"
    ].join("\n"),
    userPrompt: "请阅读这份市场上下文 markdown，并输出完整分析报告。",
    outputDir: REPORT_DIR,
    modelOverride: normalizeText(process.env.MARKET_ANALYSIS_LLM_MODEL),
    ...(timeoutOverride ? { timeoutMs: timeoutOverride } : {})
  });
}

function buildSourceMarkdown(input: MarketRunPayload): string {
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
  appendFundDashboardSection(lines, signalResult);
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

function appendFundDashboardSection(lines: string[], signalResult: Record<string, unknown>): void {
  const dashboards = asArray(signalResult.fund_dashboards);
  if (dashboards.length === 0) {
    return;
  }

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
