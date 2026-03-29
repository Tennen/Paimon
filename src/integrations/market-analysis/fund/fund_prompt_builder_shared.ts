import { FundNewsItem, FundRawContext } from "./fund_types";
import { hasSearchStatus } from "../../search-engine/types";
import { formatRuleFlagList } from "../readable_labels";

const MAX_NEWS_ITEMS = 8;

export function summarizeNews(items: FundNewsItem[], maxItems: number): Array<Record<string, unknown>> {
  const normalized = Array.isArray(items) ? items.slice(0, Math.max(1, maxItems)) : [];
  return normalized.map((item) => ({
    title: item.title,
    source: item.source,
    published_at: item.published_at,
    snippet: compactSnippet(item.snippet, 120),
    risk_hint: inferNewsRiskHint(item.title, item.snippet)
  }));
}

export function inferNewsSearchStatus(raw: FundRawContext): string {
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

export function buildFundDashboardSchemaHint(): Record<string, unknown> {
  return {
    fund_code: "string",
    fund_name: "string",
    as_of_date: "YYYY-MM-DD",
    decision_type: "buy|add|hold|reduce|redeem|watch",
    sentiment_score: "0-100 integer（内部校准字段，填写数值；不要在中文结论里直接写分数）",
    confidence: "0.0-1.0（内部校准字段，填写数值；不要在中文结论里直接写置信度）",
    core_conclusion: {
      one_sentence: "一句话核心结论，<=40字，先给动作，再给原因",
      thesis: ["数据透视结论1（含具体指标）", "数据透视结论2（含具体指标）"]
    },
    risk_alerts: ["舆情/风险/限制性情报"],
    action_plan: {
      suggestion: "作战计划口吻，优先覆盖持仓者/未持仓者",
      position_change: "仓位处理建议",
      execution_conditions: ["执行条件/入场观察点"],
      stop_conditions: ["失效条件/停止条件"]
    },
    data_perspective: {
      return_metrics: {
        ret_1d: "number|string|null（若输入有值应尽量保留）",
        ret_5d: "number|string|null",
        ret_20d: "number|string|null",
        ret_60d: "number|string|null",
        ret_120d: "number|string|null"
      },
      risk_metrics: {
        max_drawdown: "number|string|null",
        volatility_annualized: "number|string|null",
        drawdown_recovery_days: "number|string|null"
      },
      relative_metrics: {
        peer_percentile: "number|string|null",
        peer_percentile_change_20d: "number|string|null",
        peer_percentile_change_60d: "number|string|null",
        peer_rank_position: "number|string|null",
        peer_rank_total: "number|string|null"
      },
      feature_coverage: "ok|partial|insufficient"
    },
    rule_trace: {
      rule_flags: ["string"],
      blocked_actions: ["string"],
      adjusted_score: "0-100 number（内部规则校准字段，填写数值；不要在中文结论里直接写）"
    },
    insufficient_data: {
      is_insufficient: "boolean",
      missing_fields: ["string"]
    }
  };
}

export function buildNewsLines(items: FundNewsItem[]): string[] {
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

export function buildFeatureLine(items: Array<{ label: string; value: string } | null>): string {
  const content = items
    .filter((item): item is { label: string; value: string } => Boolean(item && item.value))
    .map((item) => `${item.label}${item.value}`)
    .join("；");
  return content || "暂无足够特征数据。";
}

export function metricPair(
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

export function formatPeerRankText(position: unknown, total: unknown): string {
  const pos = formatPromptMetricValue(position, 0);
  const count = formatPromptMetricValue(total, 0);
  if (pos === "数据不足" || count === "数据不足") {
    return "数据不足";
  }
  return `${pos}/${count}`;
}

export function formatInstrumentLabel(name: string, code: string): string {
  const normalizedName = String(name || "").trim();
  const normalizedCode = String(code || "").trim();
  if (normalizedName && normalizedCode) {
    return `${normalizedName}(${normalizedCode})`;
  }
  return normalizedName || normalizedCode || "未知标的";
}

export function formatFundTypeLabel(value: string): string {
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

export function formatStrategyTypeLabel(value: string): string {
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

export function formatTradableLabel(value: string): string {
  switch (value) {
    case "intraday":
      return "场内实时交易";
    case "nav_t_plus_n":
      return "场外按净值申赎";
    default:
      return value || "未知";
  }
}

export function formatMarketLabel(value: string): string {
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

export function formatRiskPreferenceLabel(value: unknown): string {
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

export function formatHoldingHorizonLabel(value: unknown): string {
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

export function formatNewsSearchStatusLabel(value: string): string {
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

export function formatWarningsLine(warnings: string[]): string {
  if (!Array.isArray(warnings) || warnings.length === 0) {
    return "暂无额外警告。";
  }
  return `需要额外留意：${formatRuleFlagList(warnings, "无")}。`;
}

export function formatRangeText(low: unknown, high: unknown, digits: number): string {
  const lowText = formatPromptMetricValue(low, digits);
  const highText = formatPromptMetricValue(high, digits);
  if (lowText === "数据不足" || highText === "数据不足") {
    return "数据不足";
  }
  return `${lowText} - ${highText}`;
}

export function formatPromptPercent(value: unknown): string {
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

export function formatPromptMetricValue(value: unknown, digits: number): string {
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

export function formatPromptText(value: unknown): string {
  const text = String(value || "").trim();
  return text || "数据不足";
}

export function formatCoverageLabel(value: string): string {
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

export function formatTextList(values: string[], fallback: string): string {
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

export function prunePromptPayload(input: unknown): unknown {
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
