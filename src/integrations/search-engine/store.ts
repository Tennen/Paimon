import fs from "fs";
import {
  DATA_STORE,
  getStore,
  registerStore,
  resolveDataPath,
  setStore
} from "../../storage/persistence";
import type {
  QianfanSearchEngineConfig,
  QianfanSearchEngineProfile,
  SearchEngineProfile,
  SearchEngineStore,
  SearchEngineType,
  SearchRecencyFilter,
  SerpApiSearchEngineConfig,
  SerpApiSearchEngineProfile
} from "./types";

const SEARCH_ENGINE_STORE = DATA_STORE.SEARCH_ENGINES;
const LEGACY_MARKET_SEARCH_ENGINE_FILE = resolveDataPath("market-analysis/search-engines.json");

const DEFAULT_SERPAPI_ENGINE_ID = "serpapi-default";
const DEFAULT_SERPAPI_ENDPOINT = "https://serpapi.com/search.json";
const DEFAULT_SERPAPI_ENGINE = "google_news";
const DEFAULT_SERPAPI_HL = "zh-cn";
const DEFAULT_SERPAPI_GL = "cn";
const DEFAULT_SERPAPI_NUM = 10;
const DEFAULT_QIANFAN_ENGINE_ID = "qianfan-default";
const DEFAULT_QIANFAN_ENDPOINT = "https://qianfan.baidubce.com/v2/ai_search/web_search";
const DEFAULT_QIANFAN_SOURCE = "baidu_search_v2";
const DEFAULT_QIANFAN_EDITION = "standard";
const DEFAULT_QIANFAN_TOP_K = 10;
const DEFAULT_QIANFAN_RECENCY = "month";

let searchEngineStoreRegistered = false;

export function ensureSearchEngineStore(): void {
  if (searchEngineStoreRegistered) {
    return;
  }
  registerStore(SEARCH_ENGINE_STORE, () => createInitialSearchEngineStore());
  searchEngineStoreRegistered = true;
}

export function readSearchEngineStore(): SearchEngineStore {
  ensureSearchEngineStore();
  const raw = getStore<unknown>(SEARCH_ENGINE_STORE);
  return normalizeSearchEngineStore(raw);
}

export function writeSearchEngineStore(input: unknown): SearchEngineStore {
  const normalized = normalizeSearchEngineStore(input);
  ensureSearchEngineStore();
  setStore(SEARCH_ENGINE_STORE, normalized);
  return normalized;
}

export function listSearchEngineProfiles(): SearchEngineProfile[] {
  return readSearchEngineStore().engines;
}

export function getSearchEngineProfile(engineId: string): SearchEngineProfile | null {
  const normalizedId = normalizeEngineId(engineId);
  if (!normalizedId) {
    return null;
  }
  const store = readSearchEngineStore();
  return store.engines.find((item) => item.id === normalizedId) ?? null;
}

export function getDefaultSearchEngineProfile(): SearchEngineProfile {
  const store = readSearchEngineStore();
  const selected = store.engines.find((item) => item.id === store.defaultEngineId);
  if (selected) {
    return selected;
  }
  return store.engines[0] ?? buildDefaultSearchEngineProfilesFromEnv()[0];
}

export function upsertSearchEngineProfile(input: unknown): SearchEngineStore {
  const profile = normalizeSearchEngineProfile(input, 0);
  if (!profile) {
    throw new Error("invalid search engine payload");
  }

  const store = readSearchEngineStore();
  const index = store.engines.findIndex((item) => item.id === profile.id);
  if (index >= 0) {
    store.engines[index] = profile;
  } else {
    store.engines.push(profile);
  }

  if (!store.defaultEngineId || !store.engines.some((item) => item.id === store.defaultEngineId)) {
    store.defaultEngineId = profile.id;
  }

  return writeSearchEngineStore(store);
}

export function deleteSearchEngineProfile(engineId: string): SearchEngineStore {
  const normalizedId = normalizeEngineId(engineId);
  if (!normalizedId) {
    throw new Error("engineId is required");
  }

  const store = readSearchEngineStore();
  if (store.engines.length <= 1) {
    throw new Error("at least one search engine must remain");
  }

  const nextEngines = store.engines.filter((item) => item.id !== normalizedId);
  if (nextEngines.length === store.engines.length) {
    throw new Error(`search engine not found: ${normalizedId}`);
  }

  store.engines = nextEngines;
  if (store.defaultEngineId === normalizedId) {
    store.defaultEngineId = nextEngines[0].id;
  }
  return writeSearchEngineStore(store);
}

export function setDefaultSearchEngine(engineId: string): SearchEngineStore {
  const normalizedId = normalizeEngineId(engineId);
  if (!normalizedId) {
    throw new Error("engineId is required");
  }

  const store = readSearchEngineStore();
  if (!store.engines.some((item) => item.id === normalizedId)) {
    throw new Error(`default search engine not found: ${normalizedId}`);
  }
  store.defaultEngineId = normalizedId;
  return writeSearchEngineStore(store);
}

export function resolveSearchEngineSelector(raw: unknown): string {
  const store = readSearchEngineStore();
  const normalized = normalizeSearchEngineSelector(raw);

  if (normalized === "default") {
    return resolveDefaultEngineId(store);
  }

  if (normalized === "serpapi") {
    const serpApiEngine = store.engines.find((item) => item.type === "serpapi" && item.enabled)
      ?? store.engines.find((item) => item.type === "serpapi")
      ?? store.engines[0];
    return serpApiEngine?.id ?? resolveDefaultEngineId(store);
  }

  if (normalized === "qianfan") {
    const qianfanEngine = store.engines.find((item) => item.type === "qianfan" && item.enabled)
      ?? store.engines.find((item) => item.type === "qianfan")
      ?? store.engines[0];
    return qianfanEngine?.id ?? resolveDefaultEngineId(store);
  }

  if (store.engines.some((item) => item.id === normalized)) {
    return normalized;
  }

  return resolveDefaultEngineId(store);
}

function createInitialSearchEngineStore(): SearchEngineStore {
  const legacy = readLegacyMarketSearchEngineStore();
  if (legacy) {
    return legacy;
  }
  return createDefaultSearchEngineStoreFromEnv();
}

function readLegacyMarketSearchEngineStore(): SearchEngineStore | null {
  if (!fs.existsSync(LEGACY_MARKET_SEARCH_ENGINE_FILE)) {
    return null;
  }

  try {
    const content = fs.readFileSync(LEGACY_MARKET_SEARCH_ENGINE_FILE, "utf-8").trim();
    if (!content) {
      return null;
    }
    const parsed = JSON.parse(content);
    const normalized = normalizeSearchEngineStore(parsed);
    if (normalized.engines.length === 0) {
      return null;
    }
    return normalized;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[SearchEngine][store] legacy_migration_failed`
      + ` file=${LEGACY_MARKET_SEARCH_ENGINE_FILE} fallback=default_store error=${message}`
    );
    return null;
  }
}

function resolveDefaultEngineId(store: SearchEngineStore): string {
  if (store.defaultEngineId && store.engines.some((item) => item.id === store.defaultEngineId)) {
    return store.defaultEngineId;
  }
  return store.engines[0]?.id ?? DEFAULT_SERPAPI_ENGINE_ID;
}

function createDefaultSearchEngineStoreFromEnv(): SearchEngineStore {
  const engines = buildDefaultSearchEngineProfilesFromEnv();
  return {
    version: 1,
    defaultEngineId: engines[0].id,
    engines
  };
}

function buildDefaultSearchEngineProfilesFromEnv(): SearchEngineProfile[] {
  const serpApi = createDefaultSerpApiSearchEngineProfileFromEnv();
  const qianfan = createDefaultQianfanSearchEngineProfileFromEnv();

  if (serpApi.config.apiKey && qianfan.config.apiKey) {
    return [serpApi, qianfan];
  }

  if (qianfan.config.apiKey) {
    return [qianfan, serpApi];
  }

  return [serpApi];
}

function createDefaultSerpApiSearchEngineProfileFromEnv(): SerpApiSearchEngineProfile {
  return {
    id: DEFAULT_SERPAPI_ENGINE_ID,
    name: "SerpAPI Default",
    type: "serpapi",
    enabled: true,
    config: {
      endpoint: normalizeUrlOrDefault(process.env.SERPAPI_ENDPOINT, DEFAULT_SERPAPI_ENDPOINT),
      apiKey: normalizeText(process.env.SERPAPI_KEY),
      engine: DEFAULT_SERPAPI_ENGINE,
      hl: DEFAULT_SERPAPI_HL,
      gl: DEFAULT_SERPAPI_GL,
      num: DEFAULT_SERPAPI_NUM
    }
  };
}

function createDefaultQianfanSearchEngineProfileFromEnv(): QianfanSearchEngineProfile {
  return {
    id: DEFAULT_QIANFAN_ENGINE_ID,
    name: "Qianfan Default",
    type: "qianfan",
    enabled: true,
    config: {
      endpoint: normalizeUrlOrDefault(process.env.QIANFAN_SEARCH_ENDPOINT, DEFAULT_QIANFAN_ENDPOINT),
      apiKey: normalizeText(process.env.QIANFAN_SEARCH_API_KEY),
      searchSource: normalizeText(process.env.QIANFAN_SEARCH_SOURCE) || DEFAULT_QIANFAN_SOURCE,
      edition: normalizeEdition(process.env.QIANFAN_SEARCH_EDITION),
      topK: clampInt(process.env.QIANFAN_SEARCH_TOP_K, DEFAULT_QIANFAN_TOP_K, 1, 50),
      recencyFilter: normalizeRecencyFilter(
        normalizeText(process.env.QIANFAN_SEARCH_RECENCY_FILTER) || DEFAULT_QIANFAN_RECENCY
      ),
      safeSearch: parseBooleanOrDefault(process.env.QIANFAN_SEARCH_SAFE_SEARCH, false)
    }
  };
}

function normalizeSearchEngineStore(input: unknown): SearchEngineStore {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const rawEngines = Array.isArray(source.engines) ? source.engines : [];
  const engines: SearchEngineProfile[] = [];

  rawEngines.forEach((item, index) => {
    const normalized = normalizeSearchEngineProfile(item, index);
    if (normalized) {
      engines.push(normalized);
    }
  });

  if (engines.length === 0) {
    engines.push(...buildDefaultSearchEngineProfilesFromEnv());
  }

  const defaultEngineIdRaw = normalizeEngineId(source.defaultEngineId);
  const defaultEngineId = defaultEngineIdRaw && engines.some((item) => item.id === defaultEngineIdRaw)
    ? defaultEngineIdRaw
    : engines[0].id;

  return {
    version: 1,
    defaultEngineId,
    engines
  };
}

function normalizeSearchEngineProfile(input: unknown, index: number): SearchEngineProfile | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const source = input as Record<string, unknown>;
  const type = normalizeEngineType(source.type ?? source.engineType ?? source.provider ?? "serpapi");
  const idRaw = source.id ?? source.engineId ?? source.key ?? source.name ?? `${type}-${index + 1}`;
  const id = normalizeEngineId(idRaw) || `${type}-${index + 1}`;
  const name = normalizeText(source.name) || id;
  const enabled = parseBooleanOrDefault(source.enabled, true);
  const configSource = source.config && typeof source.config === "object"
    ? source.config as Record<string, unknown>
    : source;

  if (type === "qianfan") {
    return {
      id,
      name,
      type,
      enabled,
      config: normalizeQianfanConfig(configSource)
    };
  }

  return {
    id,
    name,
    type,
    enabled,
    config: normalizeSerpApiConfig(configSource)
  };
}

function normalizeSerpApiConfig(source: Record<string, unknown>): SerpApiSearchEngineConfig {
  return {
    endpoint: normalizeUrlOrDefault(source.endpoint, DEFAULT_SERPAPI_ENDPOINT),
    apiKey: normalizeText(source.apiKey),
    engine: normalizeText(source.engine) || DEFAULT_SERPAPI_ENGINE,
    hl: normalizeText(source.hl) || DEFAULT_SERPAPI_HL,
    gl: normalizeText(source.gl) || DEFAULT_SERPAPI_GL,
    num: clampInt(source.num, DEFAULT_SERPAPI_NUM, 1, 20)
  };
}

function normalizeQianfanConfig(source: Record<string, unknown>): QianfanSearchEngineConfig {
  const recencyRaw = source.recencyFilter ?? source.searchRecencyFilter ?? source.search_recency_filter;
  return {
    endpoint: normalizeUrlOrDefault(source.endpoint, DEFAULT_QIANFAN_ENDPOINT),
    apiKey: normalizeText(source.apiKey),
    searchSource: normalizeText(source.searchSource ?? source.search_source) || DEFAULT_QIANFAN_SOURCE,
    edition: normalizeEdition(source.edition),
    topK: clampInt(source.topK ?? source.top_k, DEFAULT_QIANFAN_TOP_K, 1, 50),
    recencyFilter: recencyRaw === ""
      ? ""
      : normalizeRecencyFilter(recencyRaw),
    safeSearch: parseBooleanOrDefault(source.safeSearch ?? source.safe_search, false)
  };
}

function normalizeEngineType(raw: unknown): SearchEngineType {
  const value = String(raw ?? "").trim().toLowerCase();
  if (["serpapi", "serp-api", "serp_api", "google-news", "google_news"].includes(value)) {
    return "serpapi";
  }
  if (["qianfan", "baidu", "baidu-search", "baidu_search", "qianfan-baidu", "qianfan_baidu"].includes(value)) {
    return "qianfan";
  }
  return "serpapi";
}

function normalizeSearchEngineSelector(raw: unknown): string {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value || value === "default" || value === "auto" || value === "local") {
    return "default";
  }
  if (["serpapi", "serp-api", "serp_api", "google-news", "google_news"].includes(value)) {
    return "serpapi";
  }
  if (["qianfan", "baidu", "baidu-search", "baidu_search", "qianfan-baidu", "qianfan_baidu"].includes(value)) {
    return "qianfan";
  }
  return normalizeEngineId(value);
}

function normalizeEngineId(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function normalizeUrlOrDefault(raw: unknown, fallback: string): string {
  const value = normalizeText(raw);
  if (!value) {
    return fallback;
  }
  if (!/^https?:\/\//i.test(value)) {
    return fallback;
  }
  return value;
}

function parseBooleanOrDefault(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === "boolean") {
    return raw;
  }
  if (typeof raw === "string") {
    const value = raw.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(value)) {
      return true;
    }
    if (["false", "0", "no", "off"].includes(value)) {
      return false;
    }
  }
  return fallback;
}

function normalizeText(raw: unknown): string {
  return String(raw ?? "").trim();
}

function normalizeEdition(raw: unknown): "standard" | "lite" {
  return String(raw ?? "").trim().toLowerCase() === "lite" ? "lite" : "standard";
}

function normalizeRecencyFilter(raw: unknown): SearchRecencyFilter | "" {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "week" || value === "month" || value === "semiyear" || value === "year") {
    return value;
  }
  return "";
}

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  const rounded = Math.floor(numeric);
  if (rounded < min) {
    return min;
  }
  if (rounded > max) {
    return max;
  }
  return rounded;
}
