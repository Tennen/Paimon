import fs from "fs";
import path from "path";
import { getStore, registerStore, resolveDataPath, setStore } from "../../storage/persistence";
import {
  cloneDefaultConfig,
  cloneDefaultConfigStore,
  cloneDefaultState,
  cloneDefaultStateStore,
  createDefaultTopics,
  DEFAULT_CONFIG,
  DEFAULT_PROFILE_ID,
  DEFAULT_PROFILE_NAME,
  DEFAULT_STATE,
  LEGACY_DAILY_QUOTA,
  LEGACY_FEED_DISABLE_LIST,
  LEGACY_FEED_URL_MIGRATION,
  SENT_LOG_MAX_ITEMS,
  TOPIC_SUMMARY_CONFIG_STORE,
  TOPIC_SUMMARY_STATE_STORE
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
import {
  TopicKey,
  TopicSummaryConfig,
  TopicSummaryConfigStore,
  TopicSummaryDigestLanguage,
  TopicSummaryFilters,
  TopicSummaryProfileConfig,
  TopicSummaryProfileMeta,
  TopicSummaryProfileState,
  TopicSummaryProfileSnapshot,
  TopicSummarySnapshot,
  TopicSummarySource,
  TopicSummaryState,
  TopicSummaryStateStore
} from "./types";

export function ensureTopicSummaryStorage(): void {
  migrateLegacyTopicSummaryStoreFiles();
  registerStore(TOPIC_SUMMARY_CONFIG_STORE, () => DEFAULT_CONFIG_STORE_PROXY());
  registerStore(TOPIC_SUMMARY_STATE_STORE, () => DEFAULT_STATE_STORE_PROXY());
}

let legacyTopicSummaryStoreMigrated = false;

function migrateLegacyTopicSummaryStoreFiles(): void {
  if (legacyTopicSummaryStoreMigrated) {
    return;
  }
  legacyTopicSummaryStoreMigrated = true;

  migrateLegacyStoreFile("topic-push/config.json", "topic-summary/config.json");
  migrateLegacyStoreFile("topic-push/state.json", "topic-summary/state.json");
}

function migrateLegacyStoreFile(legacyRelativePath: string, nextRelativePath: string): void {
  const legacyPath = resolveDataPath(legacyRelativePath);
  const nextPath = resolveDataPath(nextRelativePath);
  if (!fs.existsSync(legacyPath) || fs.existsSync(nextPath)) {
    return;
  }
  fs.mkdirSync(path.dirname(nextPath), { recursive: true });
  fs.copyFileSync(legacyPath, nextPath);
}

function DEFAULT_CONFIG_STORE_PROXY(): TopicSummaryConfigStore {
  return cloneDefaultConfigStore();
}

function DEFAULT_STATE_STORE_PROXY(): TopicSummaryStateStore {
  return cloneDefaultStateStore();
}

export function getTopicSummaryConfig(profileId?: string): TopicSummaryConfig {
  ensureTopicSummaryStorage();
  return readConfig(profileId);
}

export function setTopicSummaryConfig(input: unknown, profileId?: string): TopicSummaryConfig {
  ensureTopicSummaryStorage();
  const config = normalizeConfig(input);
  writeConfig(config, profileId);
  return config;
}

export function getTopicSummaryState(profileId?: string): TopicSummaryState {
  ensureTopicSummaryStorage();
  return readState(profileId);
}

export function clearTopicSummarySentLog(profileId?: string): TopicSummaryState {
  ensureTopicSummaryStorage();
  const next: TopicSummaryState = {
    version: 1,
    sentLog: [],
    updatedAt: new Date().toISOString()
  };
  writeState(next, profileId);
  return next;
}

export function getTopicSummarySnapshot(): TopicSummarySnapshot {
  ensureTopicSummaryStorage();
  return buildTopicSummarySnapshot();
}

export function buildTopicSummarySnapshot(): TopicSummarySnapshot {
  const configStore = readConfigStore();
  const stateStore = readStateStore();

  const profiles: TopicSummaryProfileSnapshot[] = configStore.profiles.map((profile) => {
    const state = stateStore.profiles.find((item) => item.id === profile.id)?.state ?? cloneDefaultState();
    return {
      id: profile.id,
      name: profile.name,
      isActive: profile.id === configStore.activeProfileId,
      config: normalizeConfig(profile.config),
      state: normalizeState(state)
    };
  });

  return {
    activeProfileId: configStore.activeProfileId,
    profiles
  };
}

export function readConfig(profileId?: string): TopicSummaryConfig {
  const store = readConfigStore();
  const profile = getProfileById(store, profileId);
  return profile.config;
}

export function writeConfig(config: TopicSummaryConfig, profileId?: string): void {
  const store = readConfigStore();
  const profile = getProfileById(store, profileId);
  profile.config = normalizeConfig(config);
  writeConfigStore(store);
}

export function readState(profileId?: string): TopicSummaryState {
  const configStore = readConfigStore();
  const profile = getProfileById(configStore, profileId);
  const stateStore = readStateStore();
  const entry = stateStore.profiles.find((item) => item.id === profile.id);
  return entry?.state ? normalizeState(entry.state) : cloneDefaultState();
}

export function writeState(state: TopicSummaryState, profileId?: string): void {
  const configStore = readConfigStore();
  const profile = getProfileById(configStore, profileId);
  const stateStore = readStateStore();
  const index = stateStore.profiles.findIndex((item) => item.id === profile.id);
  const normalized = normalizeState(state);
  if (index < 0) {
    stateStore.profiles.push({ id: profile.id, state: normalized });
  } else {
    stateStore.profiles[index] = { id: profile.id, state: normalized };
  }
  writeStateStore(stateStore);
}

export function readConfigStore(): TopicSummaryConfigStore {
  const parsed = getStore<unknown>(TOPIC_SUMMARY_CONFIG_STORE);
  return normalizeConfigStore(parsed);
}

export function writeConfigStore(store: TopicSummaryConfigStore): void {
  setStore(TOPIC_SUMMARY_CONFIG_STORE, normalizeConfigStore(store));
}

export function readStateStore(): TopicSummaryStateStore {
  const parsed = getStore<unknown>(TOPIC_SUMMARY_STATE_STORE);
  return normalizeStateStore(parsed);
}

export function writeStateStore(store: TopicSummaryStateStore): void {
  setStore(TOPIC_SUMMARY_STATE_STORE, normalizeStateStore(store));
}

export function getProfileById(store: TopicSummaryConfigStore, requestedId?: string): TopicSummaryProfileConfig {
  const normalized = normalizeProfileId(requestedId ?? "");
  if (normalized) {
    const found = store.profiles.find((item) => item.id === normalized);
    if (!found) {
      throw new Error(`profile not found: ${normalized}`);
    }
    return found;
  }

  const active = store.profiles.find((item) => item.id === store.activeProfileId);
  if (active) {
    return active;
  }

  if (store.profiles.length > 0) {
    return store.profiles[0];
  }

  throw new Error("no topic profile configured");
}

export function getProfileMeta(profileId?: string): TopicSummaryProfileMeta {
  const store = readConfigStore();
  const profile = getProfileById(store, profileId);
  return {
    id: profile.id,
    name: profile.name,
    config: profile.config,
    isActive: profile.id === store.activeProfileId
  };
}

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

export function normalizeSources(input: unknown): TopicSummarySource[] {
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
