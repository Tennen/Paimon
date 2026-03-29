import type {
  LLMProviderStore,
  TopicSummaryCategory,
  TopicSummaryConfig,
  TopicSummaryDailyQuota,
  TopicSummaryDigestLanguage,
  TopicSummaryProfile,
  TopicSummaryProfilesPayload,
  TopicSummarySource,
  TopicSummaryState
} from "@/types/admin";
import { DEFAULT_TOPIC_SUMMARY_CONFIG, DEFAULT_TOPIC_SUMMARY_STATE } from "@/types/admin";

export function clampNumberValue(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const rounded = Math.floor(value);
  if (rounded < min) {
    return min;
  }
  if (rounded > max) {
    return max;
  }
  return rounded;
}

export function clampFloatValue(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return Math.round(value * 100) / 100;
}

export function normalizeTopicSummaryEngine(raw: unknown): string {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value || value === "local" || value === "default" || value === "auto") {
    return "local";
  }
  if (["gpt_plugin", "gpt-plugin", "gptplugin", "chatgpt-bridge", "chatgpt_bridge", "bridge"].includes(value)) {
    return "gpt_plugin";
  }
  return value.replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "local";
}

export function resolveDefaultLlmProviderId(store: LLMProviderStore | null | undefined): string {
  if (!store || !Array.isArray(store.providers) || store.providers.length === 0) {
    return "";
  }
  if (store.providers.some((item) => item.id === store.defaultProviderId)) {
    return store.defaultProviderId;
  }
  return store.providers[0].id;
}

export function resolveModuleProviderId(
  normalizedEngine: string,
  store: LLMProviderStore | null | undefined,
  options: { allowGeminiLegacy?: boolean } = {}
): string {
  if (!store || !Array.isArray(store.providers) || store.providers.length === 0) {
    return normalizedEngine;
  }

  if (store.providers.some((item) => item.id === normalizedEngine)) {
    return normalizedEngine;
  }

  const defaultProviderId = resolveDefaultLlmProviderId(store);
  if (normalizedEngine === "local") {
    return defaultProviderId || normalizedEngine;
  }
  if (normalizedEngine === "gpt_plugin") {
    const gptPluginProviderId = store.providers.find((item) => item.type === "gpt-plugin")?.id;
    return gptPluginProviderId || defaultProviderId || normalizedEngine;
  }
  if (options.allowGeminiLegacy && normalizedEngine === "gemini") {
    return normalizedEngine;
  }
  return defaultProviderId || normalizedEngine;
}

export function resolveTopicSummaryProviderId(raw: unknown, store: LLMProviderStore | null | undefined): string {
  return resolveModuleProviderId(normalizeTopicSummaryEngine(raw), store);
}

export function normalizeTopicSummaryDefaultLanguage(raw: unknown): TopicSummaryDigestLanguage {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value.startsWith("zh")) {
    return "zh-CN";
  }
  if (value.startsWith("en")) {
    return "en";
  }
  return "auto";
}

export function normalizeTopicSummaryCategory(raw: unknown): TopicSummaryCategory {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "news") {
    return "news";
  }
  if (value === "ecosystem") {
    return "ecosystem";
  }
  return "engineering";
}

export function normalizeTopicSourceId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function buildNextTopicSourceId(baseId: string, existingIds: string[]): string {
  const normalizedBase = normalizeTopicSourceId(baseId) || "source";
  const used = new Set(existingIds.map((item) => normalizeTopicSourceId(item)));
  if (!used.has(normalizedBase)) {
    return normalizedBase;
  }

  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${normalizedBase}-${i}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }

  return `${normalizedBase}-${Date.now()}`;
}

export function normalizeTopicSummarySource(source: Partial<TopicSummarySource> | null | undefined, index: number): TopicSummarySource {
  const id = normalizeTopicSourceId(String(source?.id ?? ""));
  const category = normalizeTopicSummaryCategory(source?.category);
  const weight = Number(source?.weight);
  return {
    id: id || `source-${index + 1}`,
    name: String(source?.name ?? "").trim(),
    category,
    feedUrl: String(source?.feedUrl ?? "").trim(),
    weight: Number.isFinite(weight) ? clampFloatValue(weight, 1, 0.1, 5) : 1,
    enabled: typeof source?.enabled === "boolean" ? source.enabled : true
  };
}

export function normalizeTopicSummaryState(state: TopicSummaryState | null | undefined): TopicSummaryState {
  const source = state ?? DEFAULT_TOPIC_SUMMARY_STATE;
  const sentLog = Array.isArray(source.sentLog)
    ? source.sentLog
        .map((item) => ({
          urlNormalized: String(item?.urlNormalized ?? "").trim(),
          sentAt: String(item?.sentAt ?? "").trim(),
          title: String(item?.title ?? "").trim()
        }))
        .filter((item) => Boolean(item.urlNormalized))
    : [];

  return {
    version: 1,
    sentLog: sentLog.slice(0, 5000),
    updatedAt: String(source.updatedAt ?? "").trim()
  };
}

export function normalizeTopicSummaryConfig(config: TopicSummaryConfig | null | undefined): TopicSummaryConfig {
  const fallback = DEFAULT_TOPIC_SUMMARY_CONFIG;
  const source = config ?? fallback;
  const rawSources = Array.isArray(source.sources) ? source.sources : [];
  const sources = rawSources.map((item, index) => normalizeTopicSummarySource(item, index));

  const topicKeys: Array<keyof TopicSummaryConfig["topics"]> = [
    "llm_apps",
    "agents",
    "multimodal",
    "reasoning",
    "rag",
    "eval",
    "on_device",
    "safety"
  ];
  const topics = topicKeys.reduce<TopicSummaryConfig["topics"]>((acc, key) => {
    const list = Array.isArray(source.topics?.[key]) ? source.topics[key] : [];
    acc[key] = Array.from(new Set(list.map((item) => String(item ?? "").trim()).filter(Boolean)));
    return acc;
  }, {
    llm_apps: [],
    agents: [],
    multimodal: [],
    reasoning: [],
    rag: [],
    eval: [],
    on_device: [],
    safety: []
  });

  const filters = source.filters ?? fallback.filters;
  const dailyQuota = source.dailyQuota ?? fallback.dailyQuota;
  const summaryEngine = normalizeTopicSummaryEngine(source.summaryEngine);
  const defaultLanguage = normalizeTopicSummaryDefaultLanguage(source.defaultLanguage);

  return {
    version: 1,
    summaryEngine,
    defaultLanguage,
    sources,
    topics,
    filters: {
      timeWindowHours: clampNumberValue(filters.timeWindowHours, 24, 1, 168),
      minTitleLength: clampNumberValue(filters.minTitleLength, 8, 1, 80),
      blockedDomains: Array.isArray(filters.blockedDomains) ? filters.blockedDomains.map((item) => String(item ?? "").trim()).filter(Boolean) : [],
      blockedKeywordsInTitle: Array.isArray(filters.blockedKeywordsInTitle)
        ? filters.blockedKeywordsInTitle.map((item) => String(item ?? "").trim()).filter(Boolean)
        : [],
      maxPerDomain: clampNumberValue(filters.maxPerDomain, 2, 1, 10),
      dedup: {
        titleSimilarityThreshold: clampFloatValue(filters.dedup?.titleSimilarityThreshold, 0.9, 0.5, 1),
        urlNormalization: typeof filters.dedup?.urlNormalization === "boolean" ? filters.dedup.urlNormalization : true
      }
    },
    dailyQuota: {
      total: clampNumberValue(dailyQuota.total, fallback.dailyQuota.total, 1, 40),
      engineering: clampNumberValue(dailyQuota.engineering, fallback.dailyQuota.engineering, 0, 40),
      news: clampNumberValue(dailyQuota.news, fallback.dailyQuota.news, 0, 40),
      ecosystem: clampNumberValue(dailyQuota.ecosystem, fallback.dailyQuota.ecosystem, 0, 40)
    }
  };
}

export function normalizeTopicSummaryProfilesPayload(
  payload: TopicSummaryProfilesPayload | null | undefined
): { activeProfileId: string; profiles: TopicSummaryProfile[] } {
  const source = payload ?? {
    activeProfileId: "",
    profiles: []
  } as TopicSummaryProfilesPayload;

  const rawProfiles = Array.isArray(source.profiles) ? source.profiles : [];
  const profiles: TopicSummaryProfile[] = [];
  const idSet = new Set<string>();

  for (let i = 0; i < rawProfiles.length; i += 1) {
    const item = rawProfiles[i];
    const normalizedId = normalizeTopicProfileId(String(item?.id ?? ""));
    const id = normalizedId || `profile-${i + 1}`;
    if (idSet.has(id)) {
      continue;
    }
    idSet.add(id);
    profiles.push({
      id,
      name: String(item?.name ?? id).trim() || id,
      isActive: Boolean(item?.isActive),
      config: normalizeTopicSummaryConfig(item?.config ?? DEFAULT_TOPIC_SUMMARY_CONFIG),
      state: normalizeTopicSummaryState(item?.state ?? DEFAULT_TOPIC_SUMMARY_STATE)
    });
  }

  if (profiles.length === 0) {
    const fallbackId = "ai-engineering";
    profiles.push({
      id: fallbackId,
      name: "AI Engineering",
      isActive: true,
      config: normalizeTopicSummaryConfig(source.config ?? DEFAULT_TOPIC_SUMMARY_CONFIG),
      state: normalizeTopicSummaryState(source.state ?? DEFAULT_TOPIC_SUMMARY_STATE)
    });
  }

  const activeFromPayload = normalizeTopicProfileId(String(source.activeProfileId ?? ""));
  const activeId = profiles.some((item) => item.id === activeFromPayload)
    ? activeFromPayload
    : (profiles.find((item) => item.isActive)?.id ?? profiles[0].id);

  return {
    activeProfileId: activeId,
    profiles: profiles.map((item) => ({
      ...item,
      isActive: item.id === activeId
    }))
  };
}

export function normalizeTopicProfileId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}
