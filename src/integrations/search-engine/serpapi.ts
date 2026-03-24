import { dedupSearchItems, dedupStrings, fetchJsonWithTimeout, readNestedString, truncateLogText } from "./common";
import type {
  SearchExecutionResult,
  SearchPlan,
  SearchProviderExecutionInput,
  SearchResultItem,
  SerpApiSearchEngineProfile
} from "./types";

type SerpApiAttempt = {
  planLabel: string;
  variant: string;
  engine: string;
  query: string;
  extraParams?: Record<string, string>;
};

export async function executeSerpApiSearch(input: SearchProviderExecutionInput): Promise<SearchExecutionResult> {
  if (input.profile.type !== "serpapi") {
    throw new Error(`invalid serpapi profile type: ${input.profile.type}`);
  }

  const profile = input.profile as SerpApiSearchEngineProfile;
  const apiKey = String(profile.config.apiKey || "").trim();
  if (!apiKey) {
    return {
      items: [],
      source_chain: ["search_provider:serpapi", "search_status:disabled_no_key"],
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
  const attempts = buildSerpApiAttempts(profile, input.plans);
  const attemptSourceChain: string[] = [];
  const successSourceChain: string[] = [];
  const statusSourceChain: string[] = [];
  const errors: string[] = [];
  let collected: SearchResultItem[] = [];

  for (const attempt of attempts) {
    const target = truncateLogText(String(input.logContext || "-"), 80);
    console.log(
      `[SearchEngine][serpapi] plan target=${target}`
      + ` label=${attempt.planLabel} variant=${attempt.variant} query=${truncateLogText(attempt.query, 160)}`
    );
    attemptSourceChain.push(
      "search_provider:serpapi",
      `search_provider_variant:serpapi:${attempt.variant}`,
      `search_plan:${attempt.planLabel}`
    );

    const url = buildSerpApiRequestUrl(endpoint, {
      apiKey,
      engine: attempt.engine,
      query: attempt.query,
      hl,
      gl,
      num: Math.max(1, Math.min(20, normalizedNum)),
      extraParams: attempt.extraParams
    });

    try {
      const payload = await fetchJsonWithTimeout(url, {
        method: "GET",
        timeoutMs: input.timeoutMs
      });
      const apiError = extractSerpApiErrorMessage(payload);
      if (apiError) {
        console.error(`[SearchEngine][serpapi] api_error label=${attempt.planLabel} error=${truncateLogText(apiError, 200)}`);
        errors.push(`serpapi ${attempt.planLabel}: ${apiError}`);
        continue;
      }

      const items = normalizeSerpApiItems(payload);
      if (items.length === 0) {
        console.log(`[SearchEngine][serpapi] no_hit label=${attempt.planLabel} variant=${attempt.variant}`);
        continue;
      }

      console.log(`[SearchEngine][serpapi] hit label=${attempt.planLabel} variant=${attempt.variant} items=${items.length}`);
      successSourceChain.push(
        "search_provider:serpapi",
        `search_provider_variant:serpapi:${attempt.variant}`,
        `search_plan:${attempt.planLabel}`
      );
      collected = dedupSearchItems([...collected, ...items]);
      if (collected.length >= Math.max(3, input.maxItems)) {
        break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[SearchEngine][serpapi] failed label=${attempt.planLabel} variant=${attempt.variant} error=${truncateLogText(message, 200)}`);
      errors.push(`serpapi ${attempt.planLabel}: ${message}`);
    }
  }

  if (collected.length > 0) {
    statusSourceChain.push("search_status:hit");
  } else {
    statusSourceChain.push("search_status:no_hit");
  }
  if (errors.length > 0) {
    statusSourceChain.push("search_status:error");
  }

  return {
    items: collected.slice(0, Math.max(1, input.maxItems)),
    source_chain: dedupStrings([...successSourceChain, ...attemptSourceChain, ...statusSourceChain]),
    errors: dedupStrings(errors)
  };
}

function buildSerpApiAttempts(profile: SerpApiSearchEngineProfile, plans: SearchPlan[]): SerpApiAttempt[] {
  const configuredEngine = String(profile.config.engine || "google_news").trim() || "google_news";
  const attempts: SerpApiAttempt[] = [];

  for (const plan of plans) {
    attempts.push({
      planLabel: plan.label,
      variant: configuredEngine,
      engine: configuredEngine,
      query: withSiteQuery(plan.query, plan.sites)
    });
  }

  const fallbackCandidates = dedupFallbackPlans([
    ...plans.slice(0, 2),
    ...plans.filter((item) => Array.isArray(item.sites) && item.sites.length > 0)
  ]);
  for (const plan of fallbackCandidates) {
    attempts.push({
      planLabel: plan.label,
      variant: "google_nws",
      engine: "google",
      query: withSiteQuery(plan.query, plan.sites),
      extraParams: {
        tbm: "nws",
        google_domain: "google.com.hk",
        ...(resolveGoogleRecencyParams(plan.recency) ? { tbs: resolveGoogleRecencyParams(plan.recency) as string } : {})
      }
    });
  }

  return attempts;
}

function dedupFallbackPlans(items: SearchPlan[]): SearchPlan[] {
  const map = new Map<string, SearchPlan>();
  for (const item of items) {
    const key = `${item.label}|${item.query}|${JSON.stringify(item.sites || [])}|${item.recency || ""}`;
    if (!map.has(key)) {
      map.set(key, item);
    }
  }
  return Array.from(map.values());
}

function withSiteQuery(query: string, sites?: string[]): string {
  const normalizedSites = Array.isArray(sites)
    ? sites.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  if (normalizedSites.length === 0) {
    return query;
  }
  const firstSite = normalizedSites[0];
  if (query.includes(`site:${firstSite}`)) {
    return query;
  }
  return `site:${firstSite} ${query}`.trim();
}

function resolveGoogleRecencyParams(recency?: string): string {
  switch (String(recency || "").trim().toLowerCase()) {
    case "week":
      return "qdr:w";
    case "month":
      return "qdr:m";
    case "year":
      return "qdr:y";
    default:
      return "";
  }
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

function normalizeSerpApiItems(payload: unknown): SearchResultItem[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const source = payload as Record<string, unknown>;
  const newsResults = Array.isArray(source.news_results)
    ? source.news_results
    : Array.isArray(source.organic_results)
      ? source.organic_results
      : [];

  const normalized: SearchResultItem[] = [];

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

  return dedupSearchItems(normalized);
}
