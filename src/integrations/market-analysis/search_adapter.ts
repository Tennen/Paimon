import { FundNewsItem } from "./fund_types";

export type FundNewsSearchInput = {
  fundCode: string;
  fundName: string;
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

  const serpApiResult = await fetchFromSerpApi(input);
  sourceChain.push(...serpApiResult.source_chain);
  errors.push(...serpApiResult.errors);

  if (serpApiResult.items.length > 0) {
    return {
      items: serpApiResult.items.slice(0, Math.max(1, input.maxItems)),
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

async function fetchFromSerpApi(input: FundNewsSearchInput): Promise<FundNewsSearchResult> {
  const apiKey = String(process.env.SERPAPI_KEY || "").trim();
  if (!apiKey) {
    return {
      items: [],
      source_chain: [],
      errors: ["missing SERPAPI_KEY"]
    };
  }

  const endpoint = String(process.env.SERPAPI_ENDPOINT || "https://serpapi.com/search.json").trim();
  const queryParts = [input.fundName, input.fundCode, "基金 公告 经理 申赎 风险"]
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  const query = queryParts.join(" ");

  const url = new URL(endpoint);
  url.searchParams.set("engine", "google_news");
  url.searchParams.set("q", query);
  url.searchParams.set("hl", "zh-cn");
  url.searchParams.set("gl", "cn");
  url.searchParams.set("num", String(Math.max(5, Math.min(20, input.maxItems * 2))));
  url.searchParams.set("api_key", apiKey);

  try {
    const payload = await fetchJsonWithTimeout(url.toString(), input.timeoutMs);
    const items = normalizeSerpApiItems(payload);
    return {
      items,
      source_chain: ["serpapi:google_news"],
      errors: []
    };
  } catch (error) {
    return {
      items: [],
      source_chain: ["serpapi:google_news"],
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

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}
