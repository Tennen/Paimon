import { clipText, dedupSearchItems, dedupStrings, fetchJsonWithTimeout, normalizeText, truncateLogText } from "./common";
import type {
  QianfanSearchEngineProfile,
  SearchExecutionResult,
  SearchPlan,
  SearchProviderExecutionInput,
  SearchRecencyFilter,
  SearchResultItem
} from "./types";

type QianfanRequestBody = {
  messages: Array<{ role: "user"; content: string }>;
  search_source: string;
  resource_type_filter: Array<{ type: "web"; top_k: number }>;
  edition?: "standard" | "lite";
  search_filter?: {
    match?: {
      site?: string[];
    };
  };
  search_recency_filter?: SearchRecencyFilter;
  safe_search?: boolean;
};

export async function executeQianfanSearch(input: SearchProviderExecutionInput): Promise<SearchExecutionResult> {
  if (input.profile.type !== "qianfan") {
    throw new Error(`invalid qianfan profile type: ${input.profile.type}`);
  }

  const profile = input.profile as QianfanSearchEngineProfile;
  const apiKey = String(profile.config.apiKey || "").trim();
  if (!apiKey) {
    return {
      items: [],
      source_chain: ["search_provider:qianfan", "search_status:disabled_no_key"],
      errors: []
    };
  }

  const endpoint = String(profile.config.endpoint || "https://qianfan.baidubce.com/v2/ai_search/web_search").trim();
  const configuredTopK = Number(profile.config.topK);
  const normalizedTopK = Number.isFinite(configuredTopK) && configuredTopK > 0
    ? Math.max(1, Math.min(50, Math.floor(configuredTopK)))
    : Math.max(5, Math.min(50, input.maxItems * 2));
  const attemptSourceChain: string[] = [];
  const successSourceChain: string[] = [];
  const statusSourceChain: string[] = [];
  const errors: string[] = [];
  let collected: SearchResultItem[] = [];

  for (const plan of input.plans) {
    const target = truncateLogText(String(input.logContext || "-"), 80);
    console.log(
      `[SearchEngine][qianfan] plan target=${target}`
      + ` label=${plan.label} query=${truncateLogText(plan.query, 160)}`
    );
    attemptSourceChain.push(
      "search_provider:qianfan",
      `search_provider_variant:qianfan:${profile.config.searchSource}`,
      `search_plan:${plan.label}`
    );

    try {
      const payload = await fetchJsonWithTimeout(endpoint, {
        method: "POST",
        timeoutMs: input.timeoutMs,
        headers: buildQianfanHeaders(apiKey),
        body: JSON.stringify(buildQianfanRequestBody(profile, plan, normalizedTopK))
      });
      const apiError = extractQianfanErrorMessage(payload);
      if (apiError) {
        console.error(`[SearchEngine][qianfan] api_error label=${plan.label} error=${truncateLogText(apiError, 200)}`);
        errors.push(`qianfan ${plan.label}: ${apiError}`);
        continue;
      }

      const items = normalizeQianfanItems(payload);
      if (items.length === 0) {
        console.log(`[SearchEngine][qianfan] no_hit label=${plan.label}`);
        continue;
      }

      console.log(`[SearchEngine][qianfan] hit label=${plan.label} items=${items.length}`);
      successSourceChain.push(
        "search_provider:qianfan",
        `search_provider_variant:qianfan:${profile.config.searchSource}`,
        `search_plan:${plan.label}`
      );
      collected = dedupSearchItems([...collected, ...items]);
      if (collected.length >= Math.max(3, input.maxItems)) {
        break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[SearchEngine][qianfan] failed label=${plan.label} error=${truncateLogText(message, 200)}`);
      errors.push(`qianfan ${plan.label}: ${message}`);
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

export function buildQianfanRequestBody(
  profile: QianfanSearchEngineProfile,
  plan: SearchPlan,
  topK: number
): QianfanRequestBody {
  const sites = Array.isArray(plan.sites)
    ? plan.sites.map((item) => normalizeText(item)).filter(Boolean).slice(0, 100)
    : [];
  const recency = resolveQianfanRecency(plan.recency, profile.config.recencyFilter);
  const content = truncateQianfanQuery(plan.query);
  const safeSearch = Boolean(profile.config.safeSearch);

  return {
    messages: [{ role: "user", content }],
    search_source: profile.config.searchSource,
    resource_type_filter: [{ type: "web", top_k: Math.max(1, Math.min(50, Math.floor(topK))) }],
    ...(profile.config.edition ? { edition: profile.config.edition } : {}),
    ...(sites.length > 0
      ? {
          search_filter: {
            match: {
              site: sites
            }
          }
        }
      : {}),
    ...(recency ? { search_recency_filter: recency } : {}),
    ...(safeSearch ? { safe_search: true } : {})
  };
}

function buildQianfanHeaders(apiKey: string): Record<string, string> {
  const authorization = `Bearer ${apiKey}`;
  return {
    Authorization: authorization,
    "X-Appbuilder-Authorization": authorization,
    "Content-Type": "application/json"
  };
}

function resolveQianfanRecency(planRecency?: SearchRecencyFilter, profileRecency?: SearchRecencyFilter | ""): SearchRecencyFilter | undefined {
  const candidate = String(planRecency || profileRecency || "").trim().toLowerCase();
  if (candidate === "week" || candidate === "month" || candidate === "semiyear" || candidate === "year") {
    return candidate;
  }
  return undefined;
}

function truncateQianfanQuery(input: string): string {
  const source = String(input || "").trim();
  if (!source) {
    return "";
  }

  let units = 0;
  let output = "";
  for (const char of source) {
    const nextUnits = units + (/[\u0000-\u00ff]/.test(char) ? 1 : 2);
    if (nextUnits > 72) {
      break;
    }
    output += char;
    units = nextUnits;
  }

  return output.trim() || source.slice(0, 72).trim();
}

function extractQianfanErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const source = payload as Record<string, unknown>;
  const code = typeof source.code === "string" ? source.code.trim() : "";
  const message = typeof source.message === "string" ? source.message.trim() : "";
  if (code || message) {
    return [code, message].filter(Boolean).join(": ");
  }

  return "";
}

function normalizeQianfanItems(payload: unknown): SearchResultItem[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const source = payload as Record<string, unknown>;
  const references = Array.isArray(source.references) ? source.references : [];
  const normalized: SearchResultItem[] = [];

  for (const item of references) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as Record<string, unknown>;
    const title = typeof row.title === "string" ? row.title.trim() : "";
    if (!title) {
      continue;
    }

    const link = typeof row.url === "string" ? row.url.trim() : "";
    const sourceName = typeof row.website === "string"
      ? row.website.trim()
      : typeof row.web_anchor === "string"
        ? row.web_anchor.trim()
        : "baidu";
    const publishedAt = typeof row.date === "string" ? row.date.trim() : "";
    const snippet = typeof row.content === "string" ? clipText(row.content, 400) : "";

    normalized.push({
      title,
      source: sourceName || "baidu",
      ...(link ? { link } : {}),
      ...(publishedAt ? { published_at: publishedAt } : {}),
      ...(snippet ? { snippet } : {})
    });
  }

  return dedupSearchItems(normalized);
}
