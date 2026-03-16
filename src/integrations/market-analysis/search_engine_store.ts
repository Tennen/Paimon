import { DATA_STORE, getStore, registerStore, setStore } from "../../storage/persistence";

export type MarketSearchEngineType = "serpapi";

export type SerpApiMarketSearchEngineConfig = {
  endpoint: string;
  apiKey: string;
  engine: string;
  hl: string;
  gl: string;
  num: number;
  querySuffix: string;
};

export type MarketSearchEngineProfile = {
  id: string;
  name: string;
  type: MarketSearchEngineType;
  enabled: boolean;
  config: SerpApiMarketSearchEngineConfig;
};

export type MarketSearchEngineStore = {
  version: 1;
  defaultEngineId: string;
  engines: MarketSearchEngineProfile[];
};

const MARKET_SEARCH_ENGINE_STORE = DATA_STORE.MARKET_SEARCH_ENGINES;
const DEFAULT_ENGINE_ID = "serpapi-default";
const DEFAULT_ENDPOINT = "https://serpapi.com/search.json";
const DEFAULT_ENGINE = "google_news";
const DEFAULT_HL = "zh-cn";
const DEFAULT_GL = "cn";
const DEFAULT_NUM = 10;
const DEFAULT_QUERY_SUFFIX = "基金 公告 经理 申赎 风险";

let marketSearchEngineStoreRegistered = false;

export function ensureMarketSearchEngineStore(): void {
  if (marketSearchEngineStoreRegistered) {
    return;
  }
  registerStore(MARKET_SEARCH_ENGINE_STORE, () => createDefaultSearchEngineStoreFromEnv());
  marketSearchEngineStoreRegistered = true;
}

export function readMarketSearchEngineStore(): MarketSearchEngineStore {
  ensureMarketSearchEngineStore();
  const raw = getStore<unknown>(MARKET_SEARCH_ENGINE_STORE);
  return normalizeMarketSearchEngineStore(raw);
}

export function writeMarketSearchEngineStore(input: unknown): MarketSearchEngineStore {
  const normalized = normalizeMarketSearchEngineStore(input);
  ensureMarketSearchEngineStore();
  setStore(MARKET_SEARCH_ENGINE_STORE, normalized);
  return normalized;
}

export function listMarketSearchEngineProfiles(): MarketSearchEngineProfile[] {
  return readMarketSearchEngineStore().engines;
}

export function getMarketSearchEngineProfile(engineId: string): MarketSearchEngineProfile | null {
  const normalizedId = normalizeEngineId(engineId);
  if (!normalizedId) {
    return null;
  }
  const store = readMarketSearchEngineStore();
  return store.engines.find((item) => item.id === normalizedId) ?? null;
}

export function getDefaultMarketSearchEngineProfile(): MarketSearchEngineProfile {
  const store = readMarketSearchEngineStore();
  const selected = store.engines.find((item) => item.id === store.defaultEngineId);
  if (selected) {
    return selected;
  }
  return store.engines[0] ?? createDefaultSearchEngineProfileFromEnv();
}

export function upsertMarketSearchEngineProfile(input: unknown): MarketSearchEngineStore {
  const profile = normalizeMarketSearchEngineProfile(input, 0);
  if (!profile) {
    throw new Error("invalid market search engine payload");
  }

  const store = readMarketSearchEngineStore();
  const index = store.engines.findIndex((item) => item.id === profile.id);
  if (index >= 0) {
    store.engines[index] = profile;
  } else {
    store.engines.push(profile);
  }

  if (!store.defaultEngineId || !store.engines.some((item) => item.id === store.defaultEngineId)) {
    store.defaultEngineId = profile.id;
  }

  return writeMarketSearchEngineStore(store);
}

export function deleteMarketSearchEngineProfile(engineId: string): MarketSearchEngineStore {
  const normalizedId = normalizeEngineId(engineId);
  if (!normalizedId) {
    throw new Error("engineId is required");
  }

  const store = readMarketSearchEngineStore();
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
  return writeMarketSearchEngineStore(store);
}

export function setDefaultMarketSearchEngine(engineId: string): MarketSearchEngineStore {
  const normalizedId = normalizeEngineId(engineId);
  if (!normalizedId) {
    throw new Error("engineId is required");
  }

  const store = readMarketSearchEngineStore();
  if (!store.engines.some((item) => item.id === normalizedId)) {
    throw new Error(`default search engine not found: ${normalizedId}`);
  }
  store.defaultEngineId = normalizedId;
  return writeMarketSearchEngineStore(store);
}

export function resolveMarketSearchEngineSelector(raw: unknown): string {
  const store = readMarketSearchEngineStore();
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

function resolveDefaultEngineId(store: MarketSearchEngineStore): string {
  if (store.defaultEngineId && store.engines.some((item) => item.id === store.defaultEngineId)) {
    return store.defaultEngineId;
  }
  return store.engines[0]?.id ?? DEFAULT_ENGINE_ID;
}

function createDefaultSearchEngineStoreFromEnv(): MarketSearchEngineStore {
  const profile = createDefaultSearchEngineProfileFromEnv();
  return {
    version: 1,
    defaultEngineId: profile.id,
    engines: [profile]
  };
}

function createDefaultSearchEngineProfileFromEnv(): MarketSearchEngineProfile {
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
      num: DEFAULT_NUM,
      querySuffix: DEFAULT_QUERY_SUFFIX
    }
  };
}

function normalizeMarketSearchEngineStore(input: unknown): MarketSearchEngineStore {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const rawEngines = Array.isArray(source.engines) ? source.engines : [];
  const engines: MarketSearchEngineProfile[] = [];

  rawEngines.forEach((item, index) => {
    const normalized = normalizeMarketSearchEngineProfile(item, index);
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

function normalizeMarketSearchEngineProfile(input: unknown, index: number): MarketSearchEngineProfile | null {
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

function normalizeSerpApiConfig(source: Record<string, unknown>): SerpApiMarketSearchEngineConfig {
  return {
    endpoint: normalizeUrlOrDefault(source.endpoint, DEFAULT_ENDPOINT),
    apiKey: normalizeText(source.apiKey),
    engine: normalizeText(source.engine) || DEFAULT_ENGINE,
    hl: normalizeText(source.hl) || DEFAULT_HL,
    gl: normalizeText(source.gl) || DEFAULT_GL,
    num: clampInt(source.num, DEFAULT_NUM, 1, 20),
    querySuffix: normalizeText(source.querySuffix) || DEFAULT_QUERY_SUFFIX
  };
}

function normalizeEngineType(raw: unknown): MarketSearchEngineType {
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
