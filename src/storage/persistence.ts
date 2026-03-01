import fs from "fs";
import path from "path";

const DEFAULT_DATA_DIR = "data";
const STORAGE_DRIVER = "json-file";

export const DATA_STORE = {
  EVOLUTION_STATE: "evolution.state",
  EVOLUTION_RETRY_QUEUE: "evolution.retry_queue",
  EVOLUTION_METRICS: "evolution.metrics",
  SCHEDULER_TASKS: "scheduler.tasks",
  SCHEDULER_USERS: "scheduler.users",
  MARKET_PORTFOLIO: "market.portfolio",
  MARKET_CONFIG: "market.config",
  MARKET_STATE: "market.state"
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
  [DATA_STORE.MARKET_STATE]: "market-analysis/state.json"
};

type StoreEntry = {
  name: DataStoreName;
  filePath: string;
  init: () => unknown;
};

const storeRegistry = new Map<DataStoreName, StoreEntry>();

export type DataStoreDescriptor = {
  name: DataStoreName;
  driver: "json-file";
};

export function resolveDataPath(...segments: string[]): string {
  const baseDir = path.resolve(process.cwd(), DEFAULT_DATA_DIR);
  return path.resolve(baseDir, ...segments);
}

export function getStorageDriver(): "json-file" {
  return STORAGE_DRIVER;
}

export function describeStore(name: DataStoreName): DataStoreDescriptor {
  return {
    name,
    driver: STORAGE_DRIVER
  };
}

export function registerStore<T>(name: DataStoreName, init: () => T): DataStoreDescriptor {
  const existing = storeRegistry.get(name);
  if (existing) {
    return describeStore(name);
  }
  const entry: StoreEntry = {
    name,
    filePath: resolveStoreFile(name),
    init
  };
  storeRegistry.set(name, entry);
  ensureJsonFile(entry.filePath, entry.init);
  return describeStore(name);
}

export function getStore<T>(name: DataStoreName): T {
  const entry = getRegisteredStore(name);
  ensureJsonFile(entry.filePath, entry.init);
  return readJsonWithFallback(entry.filePath, entry.init) as T;
}

export function setStore(name: DataStoreName, payload: unknown): void {
  const entry = getRegisteredStore(name);
  writeJsonAtomic(entry.filePath, payload);
}

export function getStoreFilePathForDebug(name: DataStoreName): string {
  return resolveStoreFile(name);
}

export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function ensureParentDir(filePath: string): void {
  ensureDir(path.dirname(filePath));
}

export function ensureJsonFile(filePath: string, createDefault: () => unknown): void {
  ensureParentDir(filePath);
  if (!fs.existsSync(filePath)) {
    writeJsonAtomic(filePath, createDefault());
  }
}

export function readJsonWithFallback<T>(filePath: string, createFallback: () => T): unknown {
  if (!fs.existsSync(filePath)) {
    return createFallback();
  }
  const raw = fs.readFileSync(filePath, "utf-8").trim();
  if (!raw) {
    return createFallback();
  }
  try {
    return JSON.parse(raw);
  } catch {
    return createFallback();
  }
}

export function writeJsonAtomic(filePath: string, payload: unknown): void {
  ensureParentDir(filePath);
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
  fs.renameSync(tempPath, filePath);
}

function resolveStoreFile(name: DataStoreName): string {
  return resolveDataPath(STORE_FILE_MAP[name]);
}

function getRegisteredStore(name: DataStoreName): StoreEntry {
  const entry = storeRegistry.get(name);
  if (entry) {
    return entry;
  }
  throw new Error(`storage key not registered: ${name}`);
}
