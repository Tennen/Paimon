import fs from "fs";
import path from "path";

const DEFAULT_DATA_DIR = "data";
const DEFAULT_STORE_CODEC: DataStoreCodec = "json";
const SQLITE_DB_DEFAULT_RELATIVE = path.join("storage", "metadata.sqlite");

export const DATA_STORE = {
  EVOLUTION_STATE: "evolution.state",
  EVOLUTION_RETRY_QUEUE: "evolution.retry_queue",
  EVOLUTION_METRICS: "evolution.metrics",
  SCHEDULER_TASKS: "scheduler.tasks",
  SCHEDULER_USERS: "scheduler.users",
  OBSERVABLE_MENU_CONFIG: "observable.menu_config",
  OBSERVABLE_EVENT_LOG: "observable.event_log",
  DIRECT_INPUT_MAPPINGS: "direct-input.mappings",
  MARKET_PORTFOLIO: "market.portfolio",
  MARKET_CONFIG: "market.config",
  MARKET_STATE: "market.state",
  MARKET_RUNS: "market.runs",
  SEARCH_ENGINES: "search.engines",
  ENV_CONFIG: "env.config",
  MEMORY_SESSIONS: "memory.sessions",
  MEMORY_RAW: "memory.raw",
  MEMORY_SUMMARY: "memory.summary",
  MEMORY_SUMMARY_INDEX: "memory.summary_index",
  AUDIT_LOG: "audit.log",
  TOPIC_SUMMARY_CONFIG: "topic-summary.config",
  TOPIC_SUMMARY_STATE: "topic-summary.state",
  WRITING_ORGANIZER_INDEX: "writing-organizer.index",
  LLM_OPENAI_QUOTA: "llm.openai_quota",
  LLM_PROVIDERS: "llm.providers"
} as const;

export type DataStoreName = typeof DATA_STORE[keyof typeof DATA_STORE];

const STORE_FILE_MAP: Record<DataStoreName, string> = {
  [DATA_STORE.EVOLUTION_STATE]: "evolution/evolution.json",
  [DATA_STORE.EVOLUTION_RETRY_QUEUE]: "evolution/retry_queue.json",
  [DATA_STORE.EVOLUTION_METRICS]: "evolution/metrics.json",
  [DATA_STORE.SCHEDULER_TASKS]: "scheduled-tasks.json",
  [DATA_STORE.SCHEDULER_USERS]: "push-users.json",
  [DATA_STORE.OBSERVABLE_MENU_CONFIG]: "observable/menu-config.json",
  [DATA_STORE.OBSERVABLE_EVENT_LOG]: "observable/event-log.json",
  [DATA_STORE.DIRECT_INPUT_MAPPINGS]: "direct-input/mappings.json",
  [DATA_STORE.MARKET_PORTFOLIO]: "market-analysis/portfolio.json",
  [DATA_STORE.MARKET_CONFIG]: "market-analysis/config.json",
  [DATA_STORE.MARKET_STATE]: "market-analysis/state.json",
  [DATA_STORE.MARKET_RUNS]: "market-analysis/runs.json",
  [DATA_STORE.SEARCH_ENGINES]: "search-engines/profiles.json",
  [DATA_STORE.ENV_CONFIG]: "config/.env",
  [DATA_STORE.MEMORY_SESSIONS]: "memory/sessions.json",
  [DATA_STORE.MEMORY_RAW]: "memory/raw.json",
  [DATA_STORE.MEMORY_SUMMARY]: "memory/summary.json",
  [DATA_STORE.MEMORY_SUMMARY_INDEX]: "memory/summary-index.json",
  [DATA_STORE.AUDIT_LOG]: "audit.jsonl",
  [DATA_STORE.TOPIC_SUMMARY_CONFIG]: "topic-summary/config.json",
  [DATA_STORE.TOPIC_SUMMARY_STATE]: "topic-summary/state.json",
  [DATA_STORE.WRITING_ORGANIZER_INDEX]: "writing/index.json",
  [DATA_STORE.LLM_OPENAI_QUOTA]: "llm/openai-quota.json",
  [DATA_STORE.LLM_PROVIDERS]: "llm/providers.json"
};

export type DataStoreCodec = "json" | "text";

const STORE_DEFAULT_CODEC_MAP: Record<DataStoreName, DataStoreCodec> = {
  [DATA_STORE.EVOLUTION_STATE]: "json",
  [DATA_STORE.EVOLUTION_RETRY_QUEUE]: "json",
  [DATA_STORE.EVOLUTION_METRICS]: "json",
  [DATA_STORE.SCHEDULER_TASKS]: "json",
  [DATA_STORE.SCHEDULER_USERS]: "json",
  [DATA_STORE.OBSERVABLE_MENU_CONFIG]: "json",
  [DATA_STORE.OBSERVABLE_EVENT_LOG]: "json",
  [DATA_STORE.DIRECT_INPUT_MAPPINGS]: "json",
  [DATA_STORE.MARKET_PORTFOLIO]: "json",
  [DATA_STORE.MARKET_CONFIG]: "json",
  [DATA_STORE.MARKET_STATE]: "json",
  [DATA_STORE.MARKET_RUNS]: "json",
  [DATA_STORE.SEARCH_ENGINES]: "json",
  [DATA_STORE.ENV_CONFIG]: "text",
  [DATA_STORE.MEMORY_SESSIONS]: "json",
  [DATA_STORE.MEMORY_RAW]: "json",
  [DATA_STORE.MEMORY_SUMMARY]: "json",
  [DATA_STORE.MEMORY_SUMMARY_INDEX]: "json",
  [DATA_STORE.AUDIT_LOG]: "text",
  [DATA_STORE.TOPIC_SUMMARY_CONFIG]: "json",
  [DATA_STORE.TOPIC_SUMMARY_STATE]: "json",
  [DATA_STORE.WRITING_ORGANIZER_INDEX]: "json",
  [DATA_STORE.LLM_OPENAI_QUOTA]: "json",
  [DATA_STORE.LLM_PROVIDERS]: "json"
};

export type StorageDriver = "json-file" | "sqlite";

export type RegisterStoreOptions<T> = {
  init: () => T;
  codec?: DataStoreCodec;
  filePath?: string;
};

export type StoreEntry = {
  name: DataStoreName;
  filePath: string;
  init: () => unknown;
  codec: DataStoreCodec;
};

export type DataStoreDescriptor = {
  name: DataStoreName;
  driver: StorageDriver;
  codec: DataStoreCodec;
};

export type StoreDefinition = {
  name: DataStoreName;
  filePath: string;
  codec: DataStoreCodec;
};

export type StoreMigrationItem = {
  name: DataStoreName;
  codec: DataStoreCodec;
  filePath: string;
  status: "migrated" | "skipped";
  reason?: string;
};

export type StoreMigrationReport = {
  dbPath: string;
  migrated: number;
  skipped: number;
  stores: StoreMigrationItem[];
};

export function resolveDataPath(...segments: string[]): string {
  const baseDir = path.resolve(process.cwd(), DEFAULT_DATA_DIR);
  return path.resolve(baseDir, ...segments);
}

export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function resolveStoreFile(name: DataStoreName): string {
  return resolveDataPath(STORE_FILE_MAP[name]);
}

export function defaultStoreCodec(name: DataStoreName): DataStoreCodec {
  return STORE_DEFAULT_CODEC_MAP[name] ?? DEFAULT_STORE_CODEC;
}

export function normalizeCodec(raw: unknown, fallback: DataStoreCodec): DataStoreCodec {
  if (raw === "json" || raw === "text") {
    return raw;
  }
  return fallback;
}

export function normalizeStoreOptions<T>(
  name: DataStoreName,
  initOrOptions: (() => T) | RegisterStoreOptions<T>
): RegisterStoreOptions<T> & { codec: DataStoreCodec } {
  if (typeof initOrOptions === "function") {
    return {
      init: initOrOptions,
      codec: defaultStoreCodec(name)
    };
  }

  return {
    init: initOrOptions.init,
    codec: normalizeCodec(initOrOptions.codec, defaultStoreCodec(name)),
    ...(typeof initOrOptions.filePath === "string" && initOrOptions.filePath.trim().length > 0
      ? { filePath: initOrOptions.filePath }
      : {})
  };
}

export function normalizeTextPayload(payload: unknown): string {
  if (typeof payload === "string") {
    return payload;
  }
  if (payload === null || payload === undefined) {
    return "";
  }
  return String(payload);
}

export function encodeStorePayload(payload: unknown, codec: DataStoreCodec): string {
  if (codec === "text") {
    return normalizeTextPayload(payload);
  }

  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function decodeStorePayload<T>(payload: string, codec: DataStoreCodec, fallbackFactory: () => T): T {
  if (codec === "text") {
    return payload as T;
  }

  const normalized = payload.trim();
  if (!normalized) {
    return fallbackFactory();
  }

  try {
    return JSON.parse(normalized) as T;
  } catch {
    return fallbackFactory();
  }
}

export function normalizeRawForCodec(raw: string, codec: DataStoreCodec): string | null {
  if (codec === "text") {
    return raw;
  }

  const normalized = raw.trim();
  if (!normalized) {
    return "\n";
  }

  try {
    const parsed = JSON.parse(normalized);
    return `${JSON.stringify(parsed, null, 2)}\n`;
  } catch {
    return null;
  }
}

export function normalizeStoreSelection(input: DataStoreName[] | undefined): Set<DataStoreName> {
  if (!input || input.length === 0) {
    return new Set(Object.values(DATA_STORE));
  }

  const known = new Set(Object.values(DATA_STORE));
  const selected: DataStoreName[] = [];
  for (const name of input) {
    if (known.has(name)) {
      selected.push(name);
    }
  }
  return new Set(selected);
}

export function normalizeStorageDriver(raw: string | undefined): StorageDriver {
  const normalized = String(raw ?? "").trim().toLowerCase();
  if (normalized === "sqlite") {
    return "sqlite";
  }
  return "json-file";
}

export function resolveSqliteDbPath(raw: string | undefined): string {
  const normalized = String(raw ?? "").trim();
  if (!normalized) {
    return resolveDataPath(SQLITE_DB_DEFAULT_RELATIVE);
  }
  return path.isAbsolute(normalized)
    ? normalized
    : path.resolve(process.cwd(), normalized);
}
