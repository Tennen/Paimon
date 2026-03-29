import {
  cloneDefaultConfig,
  cloneDefaultConfigStore,
  cloneDefaultStateStore,
  createDefaultTopics,
  DEFAULT_CONFIG,
  DEFAULT_PROFILE_ID,
  DEFAULT_PROFILE_NAME,
  DEFAULT_STATE,
  LEGACY_DAILY_QUOTA,
  LEGACY_FEED_DISABLE_LIST,
  LEGACY_FEED_URL_MIGRATION,
  SENT_LOG_MAX_ITEMS
} from "./defaults";
import {
  asRecord,
  buildSourceId,
  clampInteger,
  clampNumber,
  clampWeight,
  normalizeCategory,
  normalizeFeedUrl,
  normalizeProfileId,
  normalizeQuotaNumber,
  normalizeSourceId,
  normalizeText,
  parseDateToIso,
  toArray
} from "./shared";
import type {
  TopicKey,
  TopicSummaryConfig,
  TopicSummaryConfigStore,
  TopicSummaryDigestLanguage,
  TopicSummaryFilters,
  TopicSummaryProfileConfig,
  TopicSummaryProfileState,
  TopicSummarySource,
  TopicSummaryState,
  TopicSummaryStateStore
} from "./types";

export function normalizeConfigStore(input: unknown): TopicSummaryConfigStore {
  const source = asRecord(input);
  if (!source || !Array.isArray(source.profiles)) {
    return {
      version: 2,
      activeProfileId: DEFAULT_PROFILE_ID,
      profiles: [
        {
          id: DEFAULT_PROFILE_ID,
          name: DEFAULT_PROFILE_NAME,
          config: normalizeConfig(input)
        }
      ]
    };
  }

  const normalizedProfilesRaw = toArray(source.profiles)
    .map((item, index) => normalizeConfigProfile(item, index))
    .filter((item): item is TopicSummaryProfileConfig => Boolean(item));
  const normalizedProfiles: TopicSummaryProfileConfig[] = [];
  const idSet = new Set<string>();
  for (const profile of normalizedProfilesRaw) {
    if (idSet.has(profile.id)) {
      continue;
    }
    idSet.add(profile.id);
    normalizedProfiles.push(profile);
  }

  if (normalizedProfiles.length === 0) {
    return cloneDefaultConfigStore();
  }

  const activeRaw = normalizeProfileId(source.activeProfileId);
  const activeProfileId = activeRaw && normalizedProfiles.some((item) => item.id === activeRaw)
    ? activeRaw
    : normalizedProfiles[0].id;

  return {
    version: 2,
    activeProfileId,
    profiles: normalizedProfiles
  };
}

export function normalizeStateStore(input: unknown): TopicSummaryStateStore {
  const source = asRecord(input);
  if (!source || !Array.isArray(source.profiles)) {
    return {
      version: 2,
      profiles: [
        {
          id: DEFAULT_PROFILE_ID,
          state: normalizeState(input)
        }
      ]
    };
  }

  const normalizedProfilesRaw = toArray(source.profiles)
    .map((item, index) => normalizeStateProfile(item, index))
    .filter((item): item is TopicSummaryProfileState => Boolean(item));
  const normalizedProfiles: TopicSummaryStateStore["profiles"] = [];
  const idSet = new Set<string>();
  for (const profile of normalizedProfilesRaw) {
    if (idSet.has(profile.id)) {
      continue;
    }
    idSet.add(profile.id);
    normalizedProfiles.push(profile);
  }

  if (normalizedProfiles.length === 0) {
    return cloneDefaultStateStore();
  }

  return {
    version: 2,
    profiles: normalizedProfiles
  };
}

export function normalizeConfig(input: unknown): TopicSummaryConfig {
  const source = asRecord(input);
  if (!source) {
    return cloneDefaultConfig();
  }

  const summaryEngine = normalizeSummaryEngine(
    source.summaryEngine
    ?? source.summary_engine
    ?? source.analysisEngine
    ?? source.engine
  );
  const defaultLanguage = normalizeConfigDigestLanguage(
    source.defaultLanguage
    ?? source.default_language
    ?? source.language
  );
  const normalizedSources = normalizeSources(source.sources);
  const normalizedTopics = normalizeTopics(source.topics);
  const normalizedFilters = normalizeFilters(source.filters);
  const normalizedQuota = normalizeDailyQuota(source.dailyQuota);

  return {
    version: 1,
    summaryEngine,
    defaultLanguage,
    sources: normalizedSources,
    topics: normalizedTopics,
    filters: normalizedFilters,
    dailyQuota: normalizedQuota
  };
}

export function normalizeState(input: unknown): TopicSummaryState {
  const source = asRecord(input);
  if (!source) {
    return { ...DEFAULT_STATE };
  }

  const sentLog = toArray(source.sentLog)
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => ({
      urlNormalized: normalizeText(item.urlNormalized),
      sentAt: parseDateToIso(item.sentAt) ?? "",
      title: normalizeText(item.title)
    }))
    .filter((item) => Boolean(item.urlNormalized && item.sentAt));

  sentLog.sort((left, right) => Date.parse(right.sentAt) - Date.parse(left.sentAt));

  return {
    version: 1,
    sentLog: sentLog.slice(0, SENT_LOG_MAX_ITEMS),
    updatedAt: parseDateToIso(source.updatedAt) ?? ""
  };
}

export function normalizeSummaryEngine(raw: unknown): TopicSummaryConfig["summaryEngine"] {
  const value = normalizeText(raw).toLowerCase();
  if (!value || ["local", "default", "auto"].includes(value)) {
    return "local";
  }
  if (["gpt_plugin", "gpt-plugin", "gptplugin", "chatgpt-bridge", "chatgpt_bridge", "bridge"].includes(value)) {
    return "gpt_plugin";
  }
  return value
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "local";
}

export function normalizeConfigDigestLanguage(raw: unknown): TopicSummaryDigestLanguage {
  const value = normalizeText(raw).toLowerCase();
  if (!value || ["auto", "default", "detect", "auto-detect", "automatic", "自动"].includes(value)) {
    return "auto";
  }
  if (value.startsWith("zh")) {
    return "zh-CN";
  }
  if (value.startsWith("en")) {
    return "en";
  }
  return "auto";
}

function normalizeConfigProfile(input: unknown, index: number): TopicSummaryProfileConfig | null {
  const source = asRecord(input);
  if (!source) {
    return null;
  }

  const name = normalizeText(source.name);
  const idRaw = normalizeText(source.id) || name || `profile-${index + 1}`;
  const id = normalizeProfileId(idRaw);
  if (!id) {
    return null;
  }

  const config = normalizeConfig(source.config ?? source);
  return {
    id,
    name: name || `Profile ${index + 1}`,
    config
  };
}

function normalizeStateProfile(input: unknown, index: number): TopicSummaryStateStore["profiles"][number] | null {
  const source = asRecord(input);
  if (!source) {
    return null;
  }

  const idRaw = normalizeText(source.id) || `profile-${index + 1}`;
  const id = normalizeProfileId(idRaw);
  if (!id) {
    return null;
  }

  return {
    id,
    state: normalizeState(source.state ?? source)
  };
}

function normalizeSources(input: unknown): TopicSummarySource[] {
  const rows = toArray(input);
  const out: TopicSummarySource[] = [];
  const idSet = new Set<string>();

  for (let i = 0; i < rows.length; i += 1) {
    const source = normalizeSource(rows[i], i);
    if (!source) {
      continue;
    }
    if (idSet.has(source.id)) {
      continue;
    }
    idSet.add(source.id);
    out.push(source);
  }

  if (out.length === 0) {
    return DEFAULT_CONFIG.sources.map((item) => ({ ...item }));
  }

  return out;
}

export function normalizeSource(input: unknown, index: number): TopicSummarySource | null {
  const source = asRecord(input);
  if (!source) {
    return null;
  }

  const name = normalizeText(source.name);
  const category = normalizeCategory(source.category);
  const feedUrlRaw = normalizeText(source.feedUrl ?? source.feed_url ?? source.url);
  if (!name || !category || !feedUrlRaw) {
    return null;
  }

  const idRaw = normalizeText(source.id) || buildSourceId(name, feedUrlRaw, index);
  const id = normalizeSourceId(idRaw);
  if (!id) {
    return null;
  }

  const migratedFeedUrl = migrateLegacyFeedUrl(feedUrlRaw);
  const feedUrl = normalizeFeedUrl(migratedFeedUrl);
  if (!feedUrl) {
    return null;
  }
  if (shouldDropLegacySource(id, feedUrl)) {
    return null;
  }

  return {
    id,
    name,
    category,
    feedUrl,
    weight: clampWeight(clampNumber(source.weight, 1, 0.1, 5)),
    enabled: typeof source.enabled === "boolean" ? source.enabled : true
  };
}

function normalizeTopics(input: unknown): Record<TopicKey, string[]> {
  const source = asRecord(input);
  const out = createDefaultTopics();

  if (!source) {
    return out;
  }

  for (const key of Object.keys(out) as TopicKey[]) {
    const list = toArray(source[key])
      .map((item) => normalizeText(item))
      .filter(Boolean);
    if (list.length > 0) {
      out[key] = Array.from(new Set(list));
    }
  }

  return out;
}

function normalizeFilters(input: unknown): TopicSummaryFilters {
  const source = asRecord(input);
  const fallback = DEFAULT_CONFIG.filters;
  const dedup = asRecord(source?.dedup);

  return {
    timeWindowHours: clampInteger(source?.timeWindowHours, fallback.timeWindowHours, 1, 168),
    minTitleLength: clampInteger(source?.minTitleLength, fallback.minTitleLength, 1, 80),
    blockedDomains: toArray(source?.blockedDomains)
      .map((item) => normalizeText(item).toLowerCase())
      .filter(Boolean),
    blockedKeywordsInTitle: toArray(source?.blockedKeywordsInTitle)
      .map((item) => normalizeText(item))
      .filter(Boolean),
    maxPerDomain: clampInteger(source?.maxPerDomain, fallback.maxPerDomain, 1, 10),
    dedup: {
      titleSimilarityThreshold: clampNumber(dedup?.titleSimilarityThreshold, fallback.dedup.titleSimilarityThreshold, 0.5, 1),
      urlNormalization: typeof dedup?.urlNormalization === "boolean"
        ? dedup.urlNormalization
        : fallback.dedup.urlNormalization
    }
  };
}

function normalizeDailyQuota(input: unknown): TopicSummaryConfig["dailyQuota"] {
  const source = asRecord(input);
  const fallback = DEFAULT_CONFIG.dailyQuota;
  const quota = {
    total: normalizeQuotaNumber(source?.total, fallback.total),
    engineering: normalizeQuotaNumber(source?.engineering, fallback.engineering),
    news: normalizeQuotaNumber(source?.news, fallback.news),
    ecosystem: normalizeQuotaNumber(source?.ecosystem, fallback.ecosystem)
  };
  return migrateLegacyDailyQuota(quota);
}

function migrateLegacyDailyQuota(quota: TopicSummaryConfig["dailyQuota"]): TopicSummaryConfig["dailyQuota"] {
  if (
    quota.total === LEGACY_DAILY_QUOTA.total
    && quota.engineering === LEGACY_DAILY_QUOTA.engineering
    && quota.news === LEGACY_DAILY_QUOTA.news
    && quota.ecosystem === LEGACY_DAILY_QUOTA.ecosystem
  ) {
    return { ...DEFAULT_CONFIG.dailyQuota };
  }
  return quota;
}

function migrateLegacyFeedUrl(feedUrl: string): string {
  const key = feedUrl.toLowerCase();
  const migrated = LEGACY_FEED_URL_MIGRATION[key];
  if (!migrated) {
    return feedUrl;
  }
  return normalizeFeedUrl(migrated) || feedUrl;
}

function shouldDropLegacySource(id: string, feedUrl: string): boolean {
  const key = feedUrl.toLowerCase();
  if (id !== "anthropic-news") {
    return false;
  }
  return LEGACY_FEED_DISABLE_LIST.has(key);
}
