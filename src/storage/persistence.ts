import fs from "fs";
import path from "path";

const DEFAULT_DATA_DIR = "data";
const STORAGE_DRIVER = "json-file";
const DEFAULT_STORE_CODEC = "json";

export const DATA_STORE = {
  EVOLUTION_STATE: "evolution.state",
  EVOLUTION_RETRY_QUEUE: "evolution.retry_queue",
  EVOLUTION_METRICS: "evolution.metrics",
  SCHEDULER_TASKS: "scheduler.tasks",
  SCHEDULER_USERS: "scheduler.users",
  MARKET_PORTFOLIO: "market.portfolio",
  MARKET_CONFIG: "market.config",
  MARKET_STATE: "market.state",
  MARKET_RUNS: "market.runs",
  ENV_CONFIG: "env.config",
  MEMORY_SESSIONS: "memory.sessions",
  MEMORY_RAW: "memory.raw",
  MEMORY_SUMMARY: "memory.summary",
  MEMORY_SUMMARY_INDEX: "memory.summary_index",
  AUDIT_LOG: "audit.log",
  TOPIC_SUMMARY_CONFIG: "topic-summary.config",
  TOPIC_SUMMARY_STATE: "topic-summary.state",
  LLM_OPENAI_QUOTA: "llm.openai_quota"
} as const;

export type DataStoreName = typeof DATA_STORE[keyof typeof DATA_STORE];

const STORE_FILE_MAP: Record<DataStoreName, string> = {
  [DATA_STORE.EVOLUTION_STATE]: "evolution/evolution.json",
  [DATA_STORE.EVOLUTION_RETRY_QUEUE]: "evolution/retry_queue.json",
  [DATA_STORE.EVOLUTION_METRICS]: "evolution/metrics.json",
  [DATA_STORE.SCHEDULER_TASKS]: "scheduled-tasks.json",
  [DATA_STORE.SCHEDULER_USERS]: "push-users.json",
  [DATA_STORE.MARKET_PORTFOLIO]: "market-analysis/portfolio.json",
  [DATA_STORE.MARKET_CONFIG]: "market-analysis/config.json",
  [DATA_STORE.MARKET_STATE]: "market-analysis/state.json",
  [DATA_STORE.MARKET_RUNS]: "market-analysis/runs.json",
  [DATA_STORE.ENV_CONFIG]: "config/.env",
  [DATA_STORE.MEMORY_SESSIONS]: "memory/sessions.json",
  [DATA_STORE.MEMORY_RAW]: "memory/raw.json",
  [DATA_STORE.MEMORY_SUMMARY]: "memory/summary.json",
  [DATA_STORE.MEMORY_SUMMARY_INDEX]: "memory/summary-index.json",
  [DATA_STORE.AUDIT_LOG]: "audit.jsonl",
  [DATA_STORE.TOPIC_SUMMARY_CONFIG]: "topic-summary/config.json",
  [DATA_STORE.TOPIC_SUMMARY_STATE]: "topic-summary/state.json",
  [DATA_STORE.LLM_OPENAI_QUOTA]: "llm/openai-quota.json"
};

export type DataStoreCodec = "json" | "text";

export type RegisterStoreOptions<T> = {
  init: () => T;
  codec?: DataStoreCodec;
  filePath?: string;
};

type StoreEntry = {
  name: DataStoreName;
  filePath: string;
  init: () => unknown;
  codec: DataStoreCodec;
};

const storeRegistry = new Map<DataStoreName, StoreEntry>();

export type DataStoreDescriptor = {
  name: DataStoreName;
  driver: "json-file";
  codec: DataStoreCodec;
};

export function resolveDataPath(...segments: string[]): string {
  const baseDir = path.resolve(process.cwd(), DEFAULT_DATA_DIR);
  return path.resolve(baseDir, ...segments);
}

export function getStorageDriver(): "json-file" {
  return STORAGE_DRIVER;
}

export function describeStore(name: DataStoreName): DataStoreDescriptor {
  const entry = storeRegistry.get(name);
  return {
    name,
    driver: STORAGE_DRIVER,
    codec: entry?.codec ?? DEFAULT_STORE_CODEC
  };
}

export function registerStore<T>(
  name: DataStoreName,
  initOrOptions: (() => T) | RegisterStoreOptions<T>
): DataStoreDescriptor {
  const options = normalizeStoreOptions(initOrOptions);
  const filePath = path.resolve(options.filePath ?? resolveStoreFile(name));
  const codec = options.codec ?? DEFAULT_STORE_CODEC;
  const existing = storeRegistry.get(name);
  if (existing) {
    if (existing.filePath !== filePath || existing.codec !== codec) {
      throw new Error(
        `storage key already registered with different config: ${name}`
      );
    }
    return describeStore(name);
  }
  const entry: StoreEntry = {
    name,
    filePath,
    init: options.init,
    codec
  };
  storeRegistry.set(name, entry);
  ensureStoreFile(entry);
  return describeStore(name);
}

export function getStore<T>(name: DataStoreName): T {
  const entry = getRegisteredStore(name);
  ensureStoreFile(entry);
  return readStore(entry) as T;
}

export function setStore(name: DataStoreName, payload: unknown): void {
  const entry = getRegisteredStore(name);
  writeStore(entry, payload);
}

export function appendStore(name: DataStoreName, content: string): void {
  const entry = getRegisteredStore(name);
  if (entry.codec !== "text") {
    throw new Error(`appendStore only supports text codec: ${name}`);
  }
  ensureStoreFile(entry);
  fs.appendFileSync(entry.filePath, content, "utf-8");
}

export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function ensureParentDir(filePath: string): void {
  ensureDir(path.dirname(filePath));
}

function ensureStoreFile(entry: StoreEntry): void {
  ensureParentDir(entry.filePath);
  if (!fs.existsSync(entry.filePath)) {
    writeStore(entry, entry.init());
  }
}

function readStore(entry: StoreEntry): unknown {
  const fallback = entry.init();
  if (!fs.existsSync(entry.filePath)) {
    return fallback;
  }
  const raw = fs.readFileSync(entry.filePath, "utf-8");
  if (entry.codec === "text") {
    return raw;
  }
  const normalized = raw.trim();
  if (!normalized) {
    return fallback;
  }
  try {
    return JSON.parse(normalized);
  } catch {
    return fallback;
  }
}

function writeStore(entry: StoreEntry, payload: unknown): void {
  if (entry.codec === "text") {
    writeFileAtomic(entry.filePath, normalizeTextPayload(payload));
    return;
  }
  writeFileAtomic(entry.filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function writeFileAtomic(filePath: string, content: string): void {
  ensureParentDir(filePath);
  const tempPath = `${filePath}.${process.pid}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  fs.writeFileSync(tempPath, content, "utf-8");
  fs.renameSync(tempPath, filePath);
}

function resolveStoreFile(name: DataStoreName): string {
  return resolveDataPath(STORE_FILE_MAP[name]);
}

function normalizeStoreOptions<T>(
  initOrOptions: (() => T) | RegisterStoreOptions<T>
): RegisterStoreOptions<T> {
  if (typeof initOrOptions === "function") {
    return {
      init: initOrOptions,
      codec: DEFAULT_STORE_CODEC
    };
  }
  return {
    init: initOrOptions.init,
    codec: initOrOptions.codec ?? DEFAULT_STORE_CODEC,
    ...(typeof initOrOptions.filePath === "string" && initOrOptions.filePath.trim().length > 0
      ? { filePath: initOrOptions.filePath }
      : {})
  };
}

function normalizeTextPayload(payload: unknown): string {
  if (typeof payload === "string") {
    return payload;
  }
  if (payload === null || payload === undefined) {
    return "";
  }
  return String(payload);
}

function getRegisteredStore(name: DataStoreName): StoreEntry {
  const entry = storeRegistry.get(name);
  if (entry) {
    return entry;
  }
  throw new Error(`storage key not registered: ${name}`);
}
