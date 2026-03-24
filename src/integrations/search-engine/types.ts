export type SearchRecencyFilter = "week" | "month" | "semiyear" | "year";

export type SearchEngineType = "serpapi" | "qianfan";

export type SerpApiSearchEngineConfig = {
  endpoint: string;
  apiKey: string;
  engine: string;
  hl: string;
  gl: string;
  num: number;
};

export type QianfanSearchEngineConfig = {
  endpoint: string;
  apiKey: string;
  searchSource: string;
  edition: "standard" | "lite";
  topK: number;
  recencyFilter: SearchRecencyFilter | "";
  safeSearch: boolean;
};

type BaseSearchEngineProfile<TType extends SearchEngineType, TConfig> = {
  id: string;
  name: string;
  type: TType;
  enabled: boolean;
  config: TConfig;
};

export type SerpApiSearchEngineProfile = BaseSearchEngineProfile<"serpapi", SerpApiSearchEngineConfig>;

export type QianfanSearchEngineProfile = BaseSearchEngineProfile<"qianfan", QianfanSearchEngineConfig>;

export type SearchEngineProfile = SerpApiSearchEngineProfile | QianfanSearchEngineProfile;

export type SearchEngineStore = {
  version: 1;
  defaultEngineId: string;
  engines: SearchEngineProfile[];
};

export type SearchResultItem = {
  title: string;
  source: string;
  link?: string;
  published_at?: string;
  snippet?: string;
};

export type SearchPlan = {
  label: string;
  query: string;
  sites?: string[];
  recency?: SearchRecencyFilter;
};

export type SearchExecutionInput = {
  engineSelector?: string;
  timeoutMs: number;
  maxItems: number;
  plans: SearchPlan[];
  logContext?: string;
};

export type SearchProviderExecutionInput = {
  profile: SearchEngineProfile;
  timeoutMs: number;
  maxItems: number;
  plans: SearchPlan[];
  logContext?: string;
};

export type SearchExecutionResult = {
  items: SearchResultItem[];
  source_chain: string[];
  errors: string[];
};

export type SearchProviderDescriptor = {
  type: string;
  variant: string;
  label: string;
};

export function formatSearchProviderLabel(typeRaw: string, variantRaw?: string): string {
  const type = String(typeRaw || "").trim().toLowerCase();
  const variant = String(variantRaw || "").trim();

  if (type === "serpapi") {
    return variant ? `SerpAPI(${variant})` : "SerpAPI";
  }

  if (type === "qianfan") {
    if (variant === "baidu_search_v2") {
      return "百度搜索";
    }
    return variant ? `百度千帆(${variant})` : "百度千帆";
  }

  return variant ? `${type}(${variant})` : type || "Search Engine";
}

export function readSearchProviderDescriptor(sourceChain: string[]): SearchProviderDescriptor | null {
  const variantEntry = sourceChain.find((item) => item.startsWith("search_provider_variant:"));
  if (variantEntry) {
    const [type, ...variantParts] = variantEntry.replace(/^search_provider_variant:/, "").split(":");
    const variant = variantParts.join(":");
    return {
      type,
      variant,
      label: formatSearchProviderLabel(type, variant)
    };
  }

  const typeEntry = sourceChain.find((item) => item.startsWith("search_provider:"));
  if (!typeEntry) {
    return null;
  }

  const type = typeEntry.replace(/^search_provider:/, "").trim();
  return {
    type,
    variant: "",
    label: formatSearchProviderLabel(type)
  };
}

export function hasSearchStatus(sourceChain: string[], status: string): boolean {
  return sourceChain.includes(`search_status:${status}`);
}
