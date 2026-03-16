import fs from "fs";
import {
  DATA_STORE,
  getStore,
  registerStore,
  resolveDataPath,
  setStore
} from "../../storage/persistence";

export type SearchEngineType = "serpapi";

export type SerpApiSearchEngineConfig = {
  endpoint: string;
  apiKey: string;
  engine: string;
  hl: string;
  gl: string;
  num: number;
};

export type SearchEngineProfile = {
  id: string;
  name: string;
  type: SearchEngineType;
  enabled: boolean;
  config: SerpApiSearchEngineConfig;
};

export type SearchEngineStore = {
  version: 1;
  defaultEngineId: string;
  engines: SearchEngineProfile[];
};

const SEARCH_ENGINE_STORE = DATA_STORE.SEARCH_ENGINES;
const LEGACY_MARKET_SEARCH_ENGINE_FILE = resolveDataPath("market-analysis/search-engines.json");

const DEFAULT_ENGINE_ID = "serpapi-default";
const DEFAULT_ENDPOINT = "https://serpapi.com/search.json";
const DEFAULT_ENGINE = "google_news";
const DEFAULT_HL = "zh-cn";
const DEFAULT_GL = "cn";
const DEFAULT_NUM = 10;

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
  return store.engines[0] ?? createDefaultSearchEngineProfileFromEnv();
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
  } catch {
    return null;
  }
}

function resolveDefaultEngineId(store: SearchEngineStore): string {
  if (store.defaultEngineId && store.engines.some((item) => item.id === store.defaultEngineId)) {
    return store.defaultEngineId;
  }
  return store.engines[0]?.id ?? DEFAULT_ENGINE_ID;
}

function createDefaultSearchEngineStoreFromEnv(): SearchEngineStore {
  const profile = createDefaultSearchEngineProfileFromEnv();
  return {
    version: 1,
    defaultEngineId: profile.id,
    engines: [profile]
  };
}

function createDefaultSearchEngineProfileFromEnv(): SearchEngineProfile {
  return {
    id: DEFAULT_ENGINE_ID,
    name: "SerpAPI Default",
    type: "serpapi",
    enabled: true,
    config: {
      endpoint: normalizeUrlOrDefault(process.env.SERPAPI_ENDPOINT, DEFAULT_ENDPOINT),
      apiKey: normalizeText(process.env.SERPAPI_KEY),
      engine: DEFAULT_ENGINE,
      hl: DEFAULT_HL,
      gl: DEFAULT_GL,
      num: DEFAULT_NUM
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
    engines.push(createDefaultSearchEngineProfileFromEnv());
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
    endpoint: normalizeUrlOrDefault(source.endpoint, DEFAULT_ENDPOINT),
    apiKey: normalizeText(source.apiKey),
    engine: normalizeText(source.engine) || DEFAULT_ENGINE,
    hl: normalizeText(source.hl) || DEFAULT_HL,
    gl: normalizeText(source.gl) || DEFAULT_GL,
    num: clampInt(source.num, DEFAULT_NUM, 1, 20)
  };
}

function normalizeEngineType(raw: unknown): SearchEngineType {
  const value = String(raw ?? "").trim().toLowerCase();
  if (["serpapi", "serp-api", "serp_api", "google-news", "google_news"].includes(value)) {
    return "serpapi";
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
