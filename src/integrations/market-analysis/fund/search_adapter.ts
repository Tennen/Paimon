import { executeSearch } from "../../search-engine/service";
import type { SearchPlan } from "../../search-engine/types";
import { FundNewsItem, FundType, StrategyType } from "./fund_types";

export type FundNewsSearchInput = {
  fundCode: string;
  fundName: string;
  fundType?: FundType;
  strategyType?: StrategyType;
  searchEngine?: string;
  querySuffix?: string;
  timeoutMs: number;
  maxItems: number;
};

export type FundNewsSearchResult = {
  items: FundNewsItem[];
  source_chain: string[];
  errors: string[];
};

export async function fetchFundNews(input: FundNewsSearchInput): Promise<FundNewsSearchResult> {
  const sourceChain: string[] = [];
  const errors: string[] = [];

  const staticNews = String(process.env.MARKET_ANALYSIS_NEWS_CONTEXT || "").trim();
  if (staticNews) {
    sourceChain.push("env:MARKET_ANALYSIS_NEWS_CONTEXT");
    return {
      items: [
        {
          title: "MARKET_ANALYSIS_NEWS_CONTEXT",
          source: "env",
          snippet: staticNews
        }
      ],
      source_chain: sourceChain,
      errors
    };
  }

  const engineResult = await executeSearch({
    engineSelector: input.searchEngine,
    timeoutMs: input.timeoutMs,
    maxItems: input.maxItems,
    plans: buildFundNewsSearchPlans(input),
    logContext: formatFundLogLabel(input.fundName, input.fundCode)
  });
  sourceChain.push(...engineResult.source_chain);
  errors.push(...engineResult.errors);

  if (engineResult.items.length > 0) {
    return {
      items: engineResult.items.slice(0, Math.max(1, input.maxItems)),
      source_chain: sourceChain,
      errors
    };
  }

  const fallbackEndpoint = String(process.env.MARKET_ANALYSIS_NEWS_API || "").trim();
  if (!fallbackEndpoint) {
    return {
      items: [],
      source_chain: sourceChain,
      errors
    };
  }

  const fallback = await fetchFromFallbackEndpoint(fallbackEndpoint, input.timeoutMs);
  sourceChain.push(...fallback.source_chain);
  errors.push(...fallback.errors);

  return {
    items: fallback.items.slice(0, Math.max(1, input.maxItems)),
    source_chain: sourceChain,
    errors
  };
}

async function fetchFromFallbackEndpoint(endpoint: string, timeoutMs: number): Promise<FundNewsSearchResult> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(endpoint, {
        method: "GET",
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${endpoint}`);
      }
      const payload = await response.json();
      return {
        items: normalizeFallbackItems(payload),
        source_chain: [`fallback:${endpoint}`],
        errors: []
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[MarketAnalysis][news][fallback] failed endpoint=${endpoint}`
      + ` timeout=${timeoutMs}ms fallback=empty error=${message}`
    );
    return {
      items: [],
      source_chain: [`fallback:${endpoint}`],
      errors: [message]
    };
  }
}

function normalizeFallbackItems(payload: unknown): FundNewsItem[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const source = payload as Record<string, unknown>;
  const rows = Array.isArray(source.items)
    ? source.items
    : Array.isArray(source.news)
      ? source.news
      : [];

  const items: FundNewsItem[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const value = row as Record<string, unknown>;
    const title = typeof value.title === "string" ? value.title.trim() : "";
    if (!title) {
      continue;
    }
    items.push({
      title,
      source: typeof value.source === "string" ? value.source.trim() : "fallback",
      ...(typeof value.link === "string" && value.link.trim() ? { link: value.link.trim() } : {}),
      ...(typeof value.published_at === "string" && value.published_at.trim()
        ? { published_at: value.published_at.trim() }
        : {}),
      ...(typeof value.snippet === "string" && value.snippet.trim()
        ? { snippet: value.snippet.trim() }
        : {})
    });
  }

  return dedupNews(items).slice(0, 12);
}

function dedupNews(items: FundNewsItem[]): FundNewsItem[] {
  const map = new Map<string, FundNewsItem>();
  for (const item of items) {
    const key = `${item.title.toLowerCase()}|${String(item.link || "")}`;
    if (!map.has(key)) {
      map.set(key, item);
    }
  }
  return Array.from(map.values());
}

export function buildFundNewsSearchPlans(
  input: Pick<FundNewsSearchInput, "fundCode" | "fundName" | "querySuffix" | "fundType" | "strategyType">
): SearchPlan[] {
  const normalizedSuffix = normalizeFundNewsQuerySuffix(
    input.querySuffix,
    input.fundName,
    input.fundType,
    input.strategyType
  );
  return buildFundNewsQueryVariants(input.fundName, input.fundCode, normalizedSuffix).map((item) => ({
    label: item.label,
    query: item.query,
    ...(item.sites && item.sites.length > 0 ? { sites: item.sites } : {}),
    recency: "month"
  }));
}

export function normalizeFundNewsQuerySuffix(
  raw: unknown,
  fundName: string,
  fundType?: FundType,
  strategyType?: StrategyType
): string {
  const inputText = String(raw || "").trim();
  const defaultKeywords = buildFundSearchKeywordBlueprint(fundName, fundType, strategyType);

  const rawTokens = (inputText || defaultKeywords.join(" "))
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const tokens: string[] = [];

  for (const token of rawTokens) {
    if (token === "申赎") {
      tokens.push("申购", "赎回");
      continue;
    }
    if (token === "经理") {
      tokens.push("基金经理");
      continue;
    }
    if (token === "公告信息") {
      tokens.push("公告");
      continue;
    }
    tokens.push(token);
  }

  for (const token of defaultKeywords) {
    tokens.push(token);
  }

  return Array.from(new Set(tokens)).slice(0, 10).join(" ");
}

function buildFundSearchKeywordBlueprint(
  fundName: string,
  fundType?: FundType,
  strategyType?: StrategyType
): string[] {
  const normalizedName = String(fundName || "").toLowerCase();
  const resolvedFundType = fundType || inferFundTypeFromName(normalizedName);
  const resolvedStrategyType = strategyType || inferStrategyTypeFromName(fundName, normalizedName);

  if (resolvedFundType === "etf" || resolvedFundType === "lof" || resolvedStrategyType === "index") {
    return ["基金", "公告", "基金经理", "份额", "折溢价", "跟踪误差", "流动性", "风险"];
  }
  if (resolvedStrategyType === "bond") {
    return ["基金", "公告", "基金经理", "久期", "信用", "净值", "赎回", "风险"];
  }
  if (resolvedStrategyType === "qdii") {
    return ["基金", "公告", "基金经理", "海外", "汇率", "净值", "申购", "风险"];
  }
  if (resolvedStrategyType === "fof") {
    return ["基金", "公告", "基金经理", "持仓", "调仓", "净值", "赎回", "风险"];
  }
  if (resolvedStrategyType === "money_market") {
    return ["基金", "公告", "收益", "规模", "流动性", "赎回", "净值", "风险"];
  }
  return ["基金", "公告", "基金经理", "净值", "申购", "赎回", "持仓", "风险"];
}

function buildFundNewsQueryVariants(
  fundName: string,
  fundCode: string,
  querySuffix: string
): Array<{ label: string; query: string; sites?: string[] }> {
  const name = String(fundName || "").trim();
  const code = String(fundCode || "").trim();
  const suffix = String(querySuffix || "").trim();
  const shortSuffix = suffix
    .split(/\s+/)
    .slice(0, 4)
    .join(" ");

  return dedupQueryVariants([
    ...(name
      ? [{
          label: "name_keywords",
          query: [name, suffix].filter(Boolean).join(" ")
        }]
      : []),
    ...(name
      ? [{
          label: "quoted_name_keywords",
          query: [`"${name}"`, suffix].filter(Boolean).join(" ")
        }]
      : []),
    ...((name || code)
      ? [{
          label: "name_code_keywords",
          query: [name, code, shortSuffix || suffix].filter(Boolean).join(" ")
        }]
      : []),
    ...(name
      ? [{
          label: "eastmoney_focus",
          query: [name, "基金", shortSuffix || "公告 风险"].filter(Boolean).join(" "),
          sites: ["eastmoney.com"]
        }]
      : [])
  ]);
}

function inferFundTypeFromName(normalizedName: string): FundType {
  if (/lof/.test(normalizedName)) {
    return "lof";
  }
  if (/etf/.test(normalizedName)) {
    return "etf";
  }
  return "unknown";
}

function inferStrategyTypeFromName(name: string, normalizedName: string): StrategyType {
  if (/qdii/.test(normalizedName)) {
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
  if (/指数|etf/.test(name) || /index/.test(normalizedName)) {
    return "index";
  }
  return "unknown";
}

function formatFundLogLabel(fundName: string, fundCode: string): string {
  const name = String(fundName || "").trim();
  const code = String(fundCode || "").trim();
  if (name && code) {
    return `${name}(${code})`;
  }
  return name || code || "-";
}

function dedupQueryVariants(
  items: Array<{ label: string; query: string; sites?: string[] }>
): Array<{ label: string; query: string; sites?: string[] }> {
  const map = new Map<string, { label: string; query: string; sites?: string[] }>();
  for (const item of items) {
    const query = item.query.trim();
    const sites = Array.isArray(item.sites)
      ? item.sites.map((site) => String(site || "").trim()).filter(Boolean)
      : [];
    const key = `${query}|${sites.join(",")}`;
    if (!query || map.has(key)) {
      continue;
    }
    map.set(key, {
      label: item.label,
      query,
      ...(sites.length > 0 ? { sites } : {})
    });
  }
  return Array.from(map.values());
}
