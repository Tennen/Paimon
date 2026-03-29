import { FundReportContext, FundSeriesSummary } from "../fund/fund_report_context";
import { hasSearchStatus, readSearchProviderDescriptor } from "../../search-engine/types";
import {
  describeRuleTilt,
  formatActionLabel,
  formatActionList,
  formatInvestorReadableList,
  formatRuleFlagList
} from "../readable_labels";

export function mergeMetricRecords(
  primary: Record<string, unknown>,
  fallback: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...fallback,
    ...primary
  };
}

export function compactMetricEntry(
  label: string,
  value: unknown,
  digits: number,
  suffix: string,
  signed: boolean
): string {
  const rendered = formatMetricValue(value, digits, suffix, signed);
  return rendered ? `${label}${rendered}` : "";
}

export function compactRankEntry(label: string, position: unknown, total: unknown): string {
  const pos = formatMetricValue(position, 0, "", false);
  const count = formatMetricValue(total, 0, "", false);
  return pos && count ? `${label}${pos}/${count}` : "";
}

export function joinSlashParts(items: string[]): string {
  return items.filter(Boolean).join("/");
}

export function readStringList(input: unknown): string[] {
  return asArray(input)
    .map((item) => normalizeText(item))
    .filter((item): item is string => Boolean(item));
}

export function summarizeStringList(input: unknown, limit: number): string {
  return readStringList(input).slice(0, limit).join("；");
}

export function formatSeriesLatest(label: string, summary: FundSeriesSummary): string {
  if (typeof summary.latest_value !== "number") {
    return "";
  }
  return `${label} ${formatMetricValue(summary.latest_value, 6, "", false)}${summary.latest_date ? ` (${summary.latest_date})` : ""}`;
}

export function formatRangeStatement(label: string, summary: FundSeriesSummary): string {
  if (summary.low_60d === "not_supported" || summary.high_60d === "not_supported") {
    return "";
  }
  return `${label} ${formatMetricValue(summary.low_60d, 6, "", false)} - ${formatMetricValue(summary.high_60d, 6, "", false)}`;
}

export function metricStatement(
  label: string,
  value: unknown,
  digits: number,
  suffix: string,
  signed: boolean
): string {
  const rendered = formatMetricValue(value, digits, suffix, signed);
  return rendered ? `${label}${rendered}` : "";
}

export function rankStatement(label: string, position: unknown, total: unknown): string {
  const pos = formatMetricValue(position, 0, "", false);
  const count = formatMetricValue(total, 0, "", false);
  return pos && count ? `${label}${pos}/${count}` : "";
}

export function joinReadableParts(items: string[]): string {
  return items.filter(Boolean).join("；");
}

export function formatMetricValue(value: unknown, digits: number, suffix: string, signed: boolean): string {
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

export function describeNewsStatus(reportContext: FundReportContext): string {
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
  const provider = readSearchProviderDescriptor(sourceChain);
  if (hasSearchStatus(sourceChain, "disabled_no_key")) {
    return `${provider?.label || "Search Engine"} 未配置可用密钥`;
  }
  if (provider && hasSearchStatus(sourceChain, "hit")) {
    return newsCount > 0
      ? `${provider.label} 命中 ${newsCount} 条`
      : `${provider.label} 本次未命中明确新闻`;
  }
  const fallbackSource = sourceChain.find((item) => item.startsWith("fallback:"));
  if (fallbackSource) {
    return newsCount > 0
      ? `回退新闻源命中 ${newsCount} 条`
      : "回退新闻源未命中";
  }
  if (provider && hasSearchStatus(sourceChain, "no_hit")) {
    return `${provider.label} 本次未命中明确新闻`;
  }
  if (provider && hasSearchStatus(sourceChain, "error") && errors.length > 0) {
    return `${provider.label} 失败: ${errors[0]}`;
  }
  if (newsCount === 0) {
    return "";
  }

  return `新闻命中 ${newsCount} 条`;
}

export function pickTopNewsHeadline(reportContext: FundReportContext): string {
  const newsItems = asArray(reportContext.events.market_news);
  if (newsItems.length === 0) {
    return "";
  }

  const first = newsItems[0] as Record<string, unknown>;
  const title = normalizeText(first.title);
  const source = normalizeText(first.source);
  const snippet = normalizeText(first.snippet);
  return [title || "未命名新闻", source ? `来源=${source}` : "", snippet || ""]
    .filter(Boolean)
    .join("；");
}

export function formatCoverageLabel(raw: string): string {
  switch (raw) {
    case "ok":
      return "完整";
    case "partial":
      return "部分可用";
    case "insufficient":
      return "不足";
    default:
      return raw || "未知";
  }
}

export function formatRiskPreferenceLabel(raw: string): string {
  switch (String(raw || "").trim().toLowerCase()) {
    case "conservative":
      return "稳健";
    case "balanced":
      return "均衡";
    case "aggressive":
      return "进取";
    default:
      return raw || "未知";
  }
}

export function formatHoldingHorizonLabel(raw: string): string {
  switch (String(raw || "").trim().toLowerCase()) {
    case "short_term":
      return "短期";
    case "medium_term":
      return "中期";
    case "long_term":
      return "长期";
    default:
      return raw || "未知";
  }
}

export function formatMarketStateLabel(raw: string): string {
  switch (String(raw || "").trim().toUpperCase()) {
    case "MARKET_STRONG":
      return "偏强";
    case "MARKET_WEAK":
      return "偏弱";
    case "MARKET_NEUTRAL":
      return "中性";
    default:
      return raw || "未知";
  }
}

export function formatPhaseLabel(raw: string): string {
  switch (String(raw || "").trim().toLowerCase()) {
    case "midday":
      return "盘中";
    case "close":
      return "收盘";
    default:
      return raw || "未知";
  }
}

export function resolveTimeoutOverride(raw: unknown): number | undefined {
  const text = normalizeText(raw);
  if (!text) {
    return undefined;
  }
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.floor(value);
}

export function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

export function asArray(input: unknown): unknown[] {
  return Array.isArray(input) ? input : [];
}

export function normalizeText(input: unknown): string {
  if (typeof input !== "string") {
    return "";
  }
  return input.trim();
}

export function toFiniteNumber(input: unknown): number | null {
  const value = Number(input);
  if (!Number.isFinite(value)) {
    return null;
  }
  return value;
}
