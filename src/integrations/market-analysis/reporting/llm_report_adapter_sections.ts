import type { RunFundAnalysisOutput } from "../fund/fund_analysis_service";
import type { FundAnalysisOutput, MarketPortfolio } from "../fund/fund_types";
import {
  buildFundReportContext,
  createEmptyFundReportContext,
  type FundReportContext
} from "../fund/fund_report_context";
import {
  describeSignalStrength,
  formatActionLabel
} from "../readable_labels";
import { asRecord, normalizeText, toFiniteNumber } from "./llm_report_adapter_format";
import {
  buildFundDataPerspectiveLines,
  buildFundExecutionLines,
  buildFundIntelligenceLines,
  buildFundRationaleLine
} from "./llm_report_adapter_fund";

type FundRecordContext = {
  reportContext: FundReportContext;
};

export function appendPortfolioSection(lines: string[], portfolio: MarketPortfolio): void {
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

export function appendSignalSection(lines: string[], signalResult: FundAnalysisOutput): void {
  lines.push("## 系统初步判断");
  const signals = Array.isArray(signalResult.assetSignals) ? signalResult.assetSignals : [];
  if (signals.length === 0) {
    lines.push("- 无信号");
    lines.push("");
    return;
  }

  for (const item of signals) {
    const signal = asRecord(item);
    lines.push(`- ${normalizeText(signal.code) || "-"}: ${formatActionLabel(normalizeText(signal.signal) || "WATCH")}`);
  }
  lines.push("");
}

export function appendFundDashboardSection(lines: string[], signalResult: FundAnalysisOutput, marketData: RunFundAnalysisOutput["marketData"]): void {
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
    const decision = formatActionLabel(normalizeText(dashboard.decision_type) || "watch");
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
    lines.push(`- 信号概览: ${describeSignalStrength(score, confidence)}`);

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

  const auditErrors = Array.isArray(signalResult.audit?.errors)
    ? signalResult.audit.errors.map((item) => normalizeText(item)).filter((item): item is string => Boolean(item))
    : [];
  if (auditErrors.length > 0) {
    lines.push("### 运行中需要注意");
    for (const error of auditErrors.slice(0, 8)) {
      lines.push(`- ${error}`);
    }
  }
  lines.push("");
}

export function appendMarketErrorsSection(lines: string[], marketData: RunFundAnalysisOutput["marketData"]): void {
  const errors = Array.isArray(marketData.errors)
    ? marketData.errors.map((item) => normalizeText(item)).filter((item): item is string => Boolean(item))
    : [];
  if (errors.length === 0) {
    return;
  }

  lines.push("## 数据告警与口径说明");
  for (const error of errors.slice(0, 8)) {
    lines.push(`- ${error}`);
  }
  lines.push("");
}

export function appendNewsSection(lines: string[], optionalNewsContext: RunFundAnalysisOutput["optionalNewsContext"]): void {
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

export function buildFundRecordMap(marketData: RunFundAnalysisOutput["marketData"]): Map<string, FundRecordContext> {
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

