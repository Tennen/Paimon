import type { FundRawContext, FundType, StrategyType, TradableType } from "./fund_types";

export function normalizeFundLlmProvider(engine: string): {
  selector?: string;
  providerLabel: string;
} {
  const value = String(engine || "").trim().toLowerCase();
  if (!value || value === "local" || value === "default" || value === "auto") {
    return {
      selector: undefined,
      providerLabel: "local"
    };
  }
  if (["gpt_plugin", "gpt-plugin", "gptplugin", "chatgpt-bridge", "chatgpt_bridge", "bridge"].includes(value)) {
    return {
      selector: "gpt-plugin",
      providerLabel: "gpt-plugin"
    };
  }

  const selector = value.replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return {
    ...(selector ? { selector } : {}),
    providerLabel: selector || "local"
  };
}

export function inferFundType(code: string, name: string): FundType {
  const normalizedName = name.toLowerCase();

  if (/lof/.test(normalizedName) || code.startsWith("16")) {
    return "lof";
  }
  if (/etf/.test(normalizedName) || code.startsWith("5") || code.startsWith("15") || code.startsWith("56")) {
    return "etf";
  }
  if (code) {
    return "otc_public";
  }
  return "unknown";
}

export function inferStrategyType(name: string): StrategyType {
  const normalized = name.toLowerCase();

  if (/qdii/.test(normalized)) {
    return "qdii";
  }
  if (/货币/.test(name)) {
    return "money_market";
  }
  if (/债/.test(name)) {
    return "bond";
  }
  if (/fof/i.test(name)) {
    return "fof";
  }
  if (/混合/.test(name)) {
    return "mixed";
  }
  if (/指数|etf/.test(name) || /index/.test(normalized)) {
    return "index";
  }
  if (name) {
    return "active_equity";
  }
  return "unknown";
}

export function inferTradableType(fundType: FundType): TradableType {
  if (fundType === "etf" || fundType === "lof") {
    return "intraday";
  }
  if (fundType === "otc_public") {
    return "nav_t_plus_n";
  }
  return "unknown";
}

export function inferMarket(code: string, tradable: TradableType): string {
  if (!code) {
    return "unknown";
  }

  if (tradable === "nav_t_plus_n") {
    return "otc";
  }

  if (code.startsWith("6") || code.startsWith("5") || code.startsWith("9")) {
    return "sh";
  }

  if (code.startsWith("0") || code.startsWith("1") || code.startsWith("3")) {
    return "sz";
  }

  return "unknown";
}

export function inferAsOfDate(series: FundRawContext["price_or_nav_series"]): string {
  if (series.length === 0) {
    return todayDate();
  }
  return normalizeDateString(series[series.length - 1].date);
}

export function normalizeCode(raw: string): string {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) {
    return "";
  }
  return digits.length >= 6 ? digits.slice(-6) : digits.padStart(6, "0");
}

export function normalizeDateString(raw: string): string {
  const source = String(raw || "").trim();
  if (!source) {
    return todayDate();
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(source)) {
    return source;
  }

  if (/^\d{8}$/.test(source)) {
    return `${source.slice(0, 4)}-${source.slice(4, 6)}-${source.slice(6, 8)}`;
  }

  const timestamp = Date.parse(source);
  if (!Number.isFinite(timestamp)) {
    return todayDate();
  }

  return timestampToDate(timestamp);
}

export function normalizeDateTimeString(raw: string): string {
  const source = String(raw || "").trim();
  if (!source) {
    return "";
  }
  const normalized = source
    .replace(/\//g, "-")
    .replace(/\./g, "-")
    .replace(/\s+/g, " ")
    .trim();
  const exactMatch = normalized.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?$/);
  if (exactMatch) {
    return exactMatch[2]
      ? `${exactMatch[1]} ${exactMatch[2].length === 5 ? `${exactMatch[2]}:00` : exactMatch[2]}`
      : exactMatch[1];
  }
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) {
    return normalized;
  }
  const date = new Date(timestamp);
  return [
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
    `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`
  ].join(" ");
}

export function extractTimeString(raw: string): string {
  const source = String(raw || "").trim();
  if (!source) {
    return "";
  }
  const matched = source.match(/\b(\d{2}:\d{2}(?::\d{2})?)\b/);
  return matched?.[1] || "";
}

export function timestampToDate(timestamp: number): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return todayDate();
  }
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function todayDate(): string {
  return timestampToDate(Date.now());
}
