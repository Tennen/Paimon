import { FundNewsItem } from "./fund_types";
import {
  SearchEngineProfile,
  getSearchEngineProfile,
  resolveSearchEngineSelector
} from "../search-engine/store";

export type FundNewsSearchInput = {
  fundCode: string;
  fundName: string;
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
  const querySuffix = String(input.querySuffix || "基金 公告 经理 申赎 风险").trim();
  const queryParts = [input.fundName, input.fundCode, querySuffix]
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  const query = queryParts.join(" ");

  const url = new URL(endpoint);
  const engine = String(profile.config.engine || "google_news").trim() || "google_news";
  const hl = String(profile.config.hl || "zh-cn").trim() || "zh-cn";
  const gl = String(profile.config.gl || "cn").trim() || "cn";
  const configuredNum = Number(profile.config.num);
  const normalizedNum = Number.isFinite(configuredNum) && configuredNum > 0
    ? Math.floor(configuredNum)
    : Math.max(5, Math.min(20, input.maxItems * 2));

  url.searchParams.set("engine", engine);
  url.searchParams.set("q", query);
  url.searchParams.set("hl", hl);
  url.searchParams.set("gl", gl);
  url.searchParams.set("num", String(Math.max(1, Math.min(20, normalizedNum))));
  url.searchParams.set("api_key", apiKey);

  try {
    const payload = await fetchJsonWithTimeout(url.toString(), input.timeoutMs);
    const items = normalizeSerpApiItems(payload);
    return {
      items,
      source_chain: [`serpapi:${engine}`],
      errors: []
    };
  } catch (error) {
    return {
      items: [],
      source_chain: [`serpapi:${engine}`],
      errors: [error instanceof Error ? error.message : String(error)]
    };
  }
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
