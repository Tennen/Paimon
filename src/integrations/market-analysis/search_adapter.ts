import { FundNewsItem, FundType, StrategyType } from "./fund_types";
import {
  SearchEngineProfile,
  getSearchEngineProfile,
  resolveSearchEngineSelector
} from "../search-engine/store";

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

export type SerpApiSearchPlan = {
  label: string;
  engine: string;
  query: string;
  extraParams?: Record<string, string>;
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

  const selectedSearchEngineId = resolveSearchEngineSelector(input.searchEngine);
  const selectedSearchEngine = getSearchEngineProfile(selectedSearchEngineId);
  if (selectedSearchEngine) {
    sourceChain.push(`search_engine:${selectedSearchEngine.id}`);
  } else {
    sourceChain.push(`search_engine:missing:${selectedSearchEngineId}`);
  }

  const engineResult = selectedSearchEngine
    ? await fetchFromSearchEngine(selectedSearchEngine, input)
    : { items: [], source_chain: [], errors: ["search engine profile not found"] };
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

async function fetchFromSearchEngine(
  profile: SearchEngineProfile,
  input: FundNewsSearchInput
): Promise<FundNewsSearchResult> {
  if (!profile.enabled) {
    return {
      items: [],
      source_chain: [`search_engine:${profile.id}:disabled`],
      errors: []
    };
  }

  if (profile.type === "serpapi") {
    return fetchFromSerpApiProfile(profile, input);
  }

  return {
    items: [],
    source_chain: [`search_engine:${profile.id}:unsupported_type`],
    errors: [`unsupported search engine type: ${String(profile.type || "")}`]
  };
}

async function fetchFromSerpApiProfile(
  profile: SearchEngineProfile,
  input: FundNewsSearchInput
): Promise<FundNewsSearchResult> {
  const apiKey = String(profile.config.apiKey || "").trim();
  if (!apiKey) {
    return {
      items: [],
      source_chain: ["serpapi:disabled_no_key"],
      errors: []
    };
  }

  const endpoint = String(profile.config.endpoint || "https://serpapi.com/search.json").trim();
  const hl = String(profile.config.hl || "zh-cn").trim() || "zh-cn";
  const gl = String(profile.config.gl || "cn").trim() || "cn";
  const configuredNum = Number(profile.config.num);
  const normalizedNum = Number.isFinite(configuredNum) && configuredNum > 0
    ? Math.floor(configuredNum)
    : Math.max(5, Math.min(20, input.maxItems * 2));
  const plans = buildSerpApiSearchPlans(profile, input);
  const attemptSourceChain: string[] = [];
  const successSourceChain: string[] = [];
  const errors: string[] = [];
  let collected: FundNewsItem[] = [];

  for (const plan of plans) {
    console.log(
      `[MarketAnalysis][news][serpapi] plan fund=${truncateLogText(formatFundLogLabel(input.fundName, input.fundCode), 80)}`
      + ` label=${plan.label} engine=${plan.engine} query=${truncateLogText(plan.query, 160)}`
    );
    attemptSourceChain.push(`serpapi:${plan.engine}`, `serpapi_query:${plan.label}`);
    const url = buildSerpApiRequestUrl(endpoint, {
      apiKey,
      engine: plan.engine,
      query: plan.query,
      hl,
      gl,
      num: Math.max(1, Math.min(20, normalizedNum)),
      extraParams: plan.extraParams
    });

    try {
      const payload = await fetchJsonWithTimeout(url, input.timeoutMs);
      const apiError = extractSerpApiErrorMessage(payload);
      if (apiError) {
        console.error(`[MarketAnalysis][news][serpapi] api_error label=${plan.label} error=${truncateLogText(apiError, 200)}`);
        errors.push(`${plan.label}: ${apiError}`);
        continue;
      }

      const items = normalizeSerpApiItems(payload);
      if (items.length === 0) {
        console.log(`[MarketAnalysis][news][serpapi] no_hit label=${plan.label} engine=${plan.engine}`);
        continue;
      }

      console.log(`[MarketAnalysis][news][serpapi] hit label=${plan.label} engine=${plan.engine} items=${items.length}`);
      successSourceChain.push(`serpapi:${plan.engine}`, `serpapi_query:${plan.label}`);
      collected = dedupNews([...collected, ...items]);
      if (collected.length >= Math.max(3, input.maxItems)) {
        break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[MarketAnalysis][news][serpapi] failed label=${plan.label} engine=${plan.engine} error=${truncateLogText(message, 200)}`);
      errors.push(`${plan.label}: ${message}`);
    }
  }

  if (collected.length === 0) {
    console.warn(
      `[MarketAnalysis][news][serpapi] no_results fund=${truncateLogText(formatFundLogLabel(input.fundName, input.fundCode), 80)}`
      + ` plans=${plans.length} errors=${errors.length}`
    );
  }

  return {
    items: collected.slice(0, 12),
    source_chain: dedupStrings([...successSourceChain, ...attemptSourceChain]),
    errors: dedupStrings(errors)
  };
}

async function fetchFromFallbackEndpoint(endpoint: string, timeoutMs: number): Promise<FundNewsSearchResult> {
  try {
    const payload = await fetchJsonWithTimeout(endpoint, timeoutMs);
    const items = normalizeFallbackItems(payload);
    return {
      items,
      source_chain: [`fallback:${endpoint}`],
      errors: []
    };
  } catch (error) {
    return {
      items: [],
      source_chain: [`fallback:${endpoint}`],
      errors: [error instanceof Error ? error.message : String(error)]
    };
  }
}

function normalizeSerpApiItems(payload: unknown): FundNewsItem[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const source = payload as Record<string, unknown>;
  const newsResults = Array.isArray(source.news_results)
    ? source.news_results
    : Array.isArray(source.organic_results)
      ? source.organic_results
      : [];

  const normalized: FundNewsItem[] = [];

  for (const item of newsResults) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const row = item as Record<string, unknown>;
    const title = typeof row.title === "string" ? row.title.trim() : "";
    if (!title) {
      continue;
    }

    const sourceName = readNestedString(row.source, "name")
      || (typeof row.source === "string" ? row.source.trim() : "")
      || "unknown";

    const link = typeof row.link === "string"
      ? row.link.trim()
      : typeof row.url === "string"
        ? row.url.trim()
        : "";

    const publishedAt = typeof row.date === "string"
      ? row.date.trim()
      : typeof row.published_date === "string"
        ? row.published_date.trim()
        : "";

    const snippet = typeof row.snippet === "string"
      ? row.snippet.trim()
      : typeof row.summary === "string"
        ? row.summary.trim()
        : "";

    normalized.push({
      title,
      source: sourceName,
      ...(link ? { link } : {}),
      ...(publishedAt ? { published_at: publishedAt } : {}),
      ...(snippet ? { snippet } : {})
    });
  }

  return dedupNews(normalized).slice(0, 12);
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

export function buildSerpApiSearchPlans(
  profile: SearchEngineProfile,
  input: Pick<FundNewsSearchInput, "fundCode" | "fundName" | "querySuffix" | "fundType" | "strategyType">
): SerpApiSearchPlan[] {
  const configuredEngine = String(profile.config.engine || "google_news").trim() || "google_news";
  const normalizedSuffix = normalizeFundNewsQuerySuffix(
    input.querySuffix,
    input.fundName,
    input.fundType,
    input.strategyType
  );
  const queryVariants = buildFundNewsQueryVariants(input.fundName, input.fundCode, normalizedSuffix);
  const plans: SerpApiSearchPlan[] = [];

  for (const variant of queryVariants.slice(0, 3)) {
    plans.push({
      label: `${configuredEngine}:${variant.label}`,
      engine: configuredEngine,
      query: variant.query
    });
  }

  for (const variant of queryVariants.slice(0, 2)) {
    plans.push({
      label: `google_nws:${variant.label}`,
      engine: "google",
      query: variant.query,
      extraParams: {
        tbm: "nws",
        google_domain: "google.com.hk",
        tbs: "qdr:m"
      }
    });
  }

  const siteFocused = queryVariants.find((item) => item.label === "eastmoney_focus");
  if (siteFocused) {
    plans.push({
      label: "google_nws:eastmoney_focus",
      engine: "google",
      query: siteFocused.query,
      extraParams: {
        tbm: "nws",
        google_domain: "google.com.hk",
        tbs: "qdr:m"
      }
    });
  }

  return dedupPlans(plans);
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
): Array<{ label: string; query: string }> {
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
          query: ["site:eastmoney.com", name, "基金", shortSuffix || "公告 风险"].filter(Boolean).join(" ")
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

function dedupQueryVariants(items: Array<{ label: string; query: string }>): Array<{ label: string; query: string }> {
  const map = new Map<string, { label: string; query: string }>();
  for (const item of items) {
    const query = item.query.trim();
    if (!query || map.has(query)) {
      continue;
    }
    map.set(query, {
      label: item.label,
      query
    });
  }
  return Array.from(map.values());
}

function dedupPlans(items: SerpApiSearchPlan[]): SerpApiSearchPlan[] {
  const map = new Map<string, SerpApiSearchPlan>();
  for (const item of items) {
    const extra = item.extraParams ? JSON.stringify(item.extraParams) : "";
    const key = `${item.engine}|${item.query}|${extra}`;
    if (!map.has(key)) {
      map.set(key, item);
    }
  }
  return Array.from(map.values());
}

function buildSerpApiRequestUrl(
  endpoint: string,
  input: {
    apiKey: string;
    engine: string;
    query: string;
    hl: string;
    gl: string;
    num: number;
    extraParams?: Record<string, string>;
  }
): string {
  const url = new URL(endpoint);
  url.searchParams.set("engine", input.engine);
  url.searchParams.set("q", input.query);
  url.searchParams.set("hl", input.hl);
  url.searchParams.set("gl", input.gl);
  url.searchParams.set("num", String(input.num));
  url.searchParams.set("api_key", input.apiKey);

  Object.entries(input.extraParams || {}).forEach(([key, value]) => {
    if (value.trim()) {
      url.searchParams.set(key, value);
    }
  });

  return url.toString();
}

function extractSerpApiErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const source = payload as Record<string, unknown>;
  if (typeof source.error === "string" && source.error.trim()) {
    return source.error.trim();
  }

  const searchMetadata = source.search_metadata;
  if (searchMetadata && typeof searchMetadata === "object") {
    const metadata = searchMetadata as Record<string, unknown>;
    const status = typeof metadata.status === "string" ? metadata.status.trim() : "";
    const message = typeof metadata.error === "string" ? metadata.error.trim() : "";
    if (status.toLowerCase() === "error") {
      return message || "search_metadata.status=Error";
    }
  }

  return "";
}

function dedupStrings(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => String(item || "").trim()).filter(Boolean)));
}

function readNestedString(input: unknown, key: string): string {
  if (!input || typeof input !== "object") {
    return "";
  }

  const source = input as Record<string, unknown>;
  const value = source[key];
  return typeof value === "string" ? value.trim() : "";
}

async function fetchJsonWithTimeout(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  const target = toSafeLogUrl(url);

  console.log(`[MarketAnalysis][HTTP][news] request GET ${target} timeout=${timeoutMs}ms`);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }

    const durationMs = Date.now() - startedAt;
    console.log(`[MarketAnalysis][HTTP][news] response GET ${target} status=${response.status} duration=${durationMs}ms`);
    return await response.json();
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[MarketAnalysis][HTTP][news] failed GET ${target} duration=${durationMs}ms error=${message}`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const SENSITIVE_QUERY_KEYS = new Set(["api_key", "apikey", "token", "access_token", "auth", "authorization", "key", "secret"]);

function toSafeLogUrl(input: string): string {
  const raw = String(input || "").trim();
  if (!raw) {
    return "-";
  }

  try {
    const parsed = new URL(raw);
    for (const [key] of parsed.searchParams) {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
        parsed.searchParams.set(key, "***");
      }
    }
    const search = parsed.searchParams.toString();
    return truncateLogText(`${parsed.origin}${parsed.pathname}${search ? `?${search}` : ""}`, 220);
  } catch {
    return truncateLogText(raw, 220);
  }
}

function truncateLogText(input: string, maxLength: number): string {
  if (input.length <= maxLength) {
    return input;
  }
  return `${input.slice(0, maxLength)}...`;
}
