import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";

const DEFAULT_DATA_DIR = "data";
const DEFAULT_STORE_CODEC: DataStoreCodec = "json";
const SQLITE_TABLE_NAME = "paimon_store";
const SQLITE_DB_DEFAULT_RELATIVE = path.join("storage", "metadata.sqlite");

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

const STORAGE_DRIVER: StorageDriver = normalizeStorageDriver(process.env.STORAGE_DRIVER);
const SQLITE_DB_PATH = resolveSqliteDbPath(process.env.STORAGE_SQLITE_PATH);

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

let sqliteReady = false;

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

export function getStorageDriver(): StorageDriver {
  return STORAGE_DRIVER;
}

export function getStorageSqlitePath(): string {
  return SQLITE_DB_PATH;
}

export function describeStore(name: DataStoreName): DataStoreDescriptor {
  const entry = storeRegistry.get(name);
  return {
    name,
    driver: STORAGE_DRIVER,
    codec: entry?.codec ?? defaultStoreCodec(name)
  };
}

export function listStoreDefinitions(): StoreDefinition[] {
  return Object.values(DATA_STORE)
    .map((name) => ({
      name,
      filePath: resolveStoreFile(name),
      codec: defaultStoreCodec(name)
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function registerStore<T>(
  name: DataStoreName,
  initOrOptions: (() => T) | RegisterStoreOptions<T>
): DataStoreDescriptor {
  const options = normalizeStoreOptions(name, initOrOptions);
  const filePath = path.resolve(options.filePath ?? resolveStoreFile(name));
  const codec = options.codec;
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
  ensureStoreInitialized(entry);
  return describeStore(name);
}

export function getStore<T>(name: DataStoreName): T {
  const entry = getRegisteredStore(name);
  ensureStoreInitialized(entry);

  if (STORAGE_DRIVER === "sqlite") {
    return readStoreFromSqlite(entry) as T;
  }

  return readStoreFromJson(entry) as T;
}

export function setStore(name: DataStoreName, payload: unknown): void {
  const entry = getRegisteredStore(name);

  if (STORAGE_DRIVER === "sqlite") {
    writeStoreToSqlite(entry, payload);
    return;
  }

  writeStoreToJson(entry, payload);
}

export function appendStore(name: DataStoreName, content: string): void {
  const entry = getRegisteredStore(name);
  if (entry.codec !== "text") {
    throw new Error(`appendStore only supports text codec: ${name}`);
  }

  if (STORAGE_DRIVER === "sqlite") {
    appendStoreToSqlite(entry, content);
    return;
  }

  ensureStoreInitialized(entry);
  fs.appendFileSync(entry.filePath, content, "utf-8");
}

export function migrateJsonStoresToSqlite(options?: {
  dbPath?: string;
  storeNames?: DataStoreName[];
}): StoreMigrationReport {
  const targetDbPath = path.resolve(options?.dbPath ?? SQLITE_DB_PATH);
  ensureSqliteSchema(targetDbPath);

  const requested = normalizeStoreSelection(options?.storeNames);
  const definitions = listStoreDefinitions().filter((definition) => requested.has(definition.name));

  const items: StoreMigrationItem[] = [];
  let migrated = 0;
  let skipped = 0;

  for (const definition of definitions) {
    if (!fs.existsSync(definition.filePath)) {
      skipped += 1;
      items.push({
        name: definition.name,
        codec: definition.codec,
        filePath: definition.filePath,
        status: "skipped",
        reason: "source file not found"
      });
      continue;
    }

    const raw = fs.readFileSync(definition.filePath, "utf-8");
    const normalized = normalizeRawForCodec(raw, definition.codec);
    if (normalized === null) {
      skipped += 1;
      items.push({
        name: definition.name,
        codec: definition.codec,
        filePath: definition.filePath,
        status: "skipped",
        reason: "invalid json payload"
      });
      continue;
    }

    upsertSqliteRow(targetDbPath, definition.name, definition.codec, normalized);
    migrated += 1;
    items.push({
      name: definition.name,
      codec: definition.codec,
      filePath: definition.filePath,
      status: "migrated"
    });
  }

  return {
    dbPath: targetDbPath,
    migrated,
    skipped,
    stores: items
  };
}

export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function ensureParentDir(filePath: string): void {
  ensureDir(path.dirname(filePath));
}

function ensureStoreInitialized(entry: StoreEntry): void {
  if (STORAGE_DRIVER === "sqlite") {
    ensureSqliteStore(entry);
    return;
  }

  ensureParentDir(entry.filePath);
  if (!fs.existsSync(entry.filePath)) {
    writeStoreToJson(entry, entry.init());
  }
}

function readStoreFromJson(entry: StoreEntry): unknown {
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

function writeStoreToJson(entry: StoreEntry, payload: unknown): void {
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

function ensureSqliteStore(entry: StoreEntry): void {
  ensureSqliteSchema(SQLITE_DB_PATH);

  const existing = readSqliteRow(entry.name, SQLITE_DB_PATH);
  if (existing) {
    if (existing.codec !== entry.codec) {
      throw new Error(
        `storage key already initialized with different codec in sqlite: ${entry.name} (${existing.codec} != ${entry.codec})`
      );
    }
    return;
  }

  const encoded = encodeStorePayload(entry.init(), entry.codec);
  upsertSqliteRow(SQLITE_DB_PATH, entry.name, entry.codec, encoded);
}

function readStoreFromSqlite(entry: StoreEntry): unknown {
  ensureSqliteStore(entry);
  const row = readSqliteRow(entry.name, SQLITE_DB_PATH);
  if (!row) {
    return entry.init();
  }

  return decodeStorePayload(row.payload, entry.codec, entry.init);
}

function writeStoreToSqlite(entry: StoreEntry, payload: unknown): void {
  ensureSqliteStore(entry);
  const encoded = encodeStorePayload(payload, entry.codec);
  upsertSqliteRow(SQLITE_DB_PATH, entry.name, entry.codec, encoded);
}

function appendStoreToSqlite(entry: StoreEntry, content: string): void {
  ensureSqliteStore(entry);
  appendSqliteRowPayload(SQLITE_DB_PATH, entry.name, entry.codec, content);
}

function ensureSqliteSchema(dbPath: string): void {
  if (dbPath === SQLITE_DB_PATH && sqliteReady) {
    return;
  }

  ensureParentDir(dbPath);
  runSqliteScript(
    dbPath,
    [
      `CREATE TABLE IF NOT EXISTS ${SQLITE_TABLE_NAME} (`,
      "  name TEXT PRIMARY KEY,",
      "  codec TEXT NOT NULL,",
      "  payload TEXT NOT NULL,",
      "  updated_at TEXT NOT NULL",
      ");",
      `CREATE INDEX IF NOT EXISTS idx_${SQLITE_TABLE_NAME}_updated_at ON ${SQLITE_TABLE_NAME}(updated_at);`
    ].join("\n")
  );

  if (dbPath === SQLITE_DB_PATH) {
    sqliteReady = true;
  }
}

type SqliteRow = {
  name: string;
  codec: DataStoreCodec;
  payload: string;
};

function readSqliteRow(name: DataStoreName, dbPath: string): SqliteRow | null {
  ensureSqliteSchema(dbPath);
  const sql = [
    ".mode json",
    `SELECT name, codec, payload FROM ${SQLITE_TABLE_NAME} WHERE name = ${toSqlString(name)} LIMIT 1;`
  ].join("\n");

  const output = runSqliteScript(dbPath, sql).trim();
  if (!output) {
    return null;
  }

  try {
    const parsed = JSON.parse(output) as Array<{ name?: unknown; codec?: unknown; payload?: unknown }>;
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return null;
    }

    const first = parsed[0];
    const codec = normalizeCodec(first.codec, "json");
    return {
      name: String(first.name ?? name),
      codec,
      payload: String(first.payload ?? "")
    };
  } catch {
    return null;
  }
}

function upsertSqliteRow(
  dbPath: string,
  name: DataStoreName,
  codec: DataStoreCodec,
  payload: string
): void {
  ensureSqliteSchema(dbPath);

  const sql = [
    `INSERT INTO ${SQLITE_TABLE_NAME} (name, codec, payload, updated_at) VALUES (`,
    `  ${toSqlString(name)},`,
    `  ${toSqlString(codec)},`,
    `  ${toSqlHexText(payload)},`,
    `  ${toSqlString(new Date().toISOString())}`,
    ")",
    "ON CONFLICT(name) DO UPDATE SET",
    "  codec = excluded.codec,",
    "  payload = excluded.payload,",
    "  updated_at = excluded.updated_at;"
  ].join("\n");

  runSqliteScript(dbPath, sql);
}

function appendSqliteRowPayload(
  dbPath: string,
  name: DataStoreName,
  codec: DataStoreCodec,
  content: string
): void {
  ensureSqliteSchema(dbPath);

  const sql = [
    `INSERT INTO ${SQLITE_TABLE_NAME} (name, codec, payload, updated_at) VALUES (`,
    `  ${toSqlString(name)},`,
    `  ${toSqlString(codec)},`,
    `  ${toSqlHexText(content)},`,
    `  ${toSqlString(new Date().toISOString())}`,
    ")",
    "ON CONFLICT(name) DO UPDATE SET",
    "  codec = excluded.codec,",
    `  payload = ${SQLITE_TABLE_NAME}.payload || excluded.payload,`,
    "  updated_at = excluded.updated_at;"
  ].join("\n");

  runSqliteScript(dbPath, sql);
}

function runSqliteScript(dbPath: string, sql: string): string {
  try {
    return execFileSync("sqlite3", [dbPath], {
      input: sql,
      encoding: "utf-8",
      maxBuffer: 32 * 1024 * 1024
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`sqlite storage operation failed: ${message}`);
  }
}

function encodeStorePayload(payload: unknown, codec: DataStoreCodec): string {
  if (codec === "text") {
    return normalizeTextPayload(payload);
  }

  return `${JSON.stringify(payload, null, 2)}\n`;
}

function decodeStorePayload<T>(payload: string, codec: DataStoreCodec, fallbackFactory: () => T): T {
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

function normalizeRawForCodec(raw: string, codec: DataStoreCodec): string | null {
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

function resolveStoreFile(name: DataStoreName): string {
  return resolveDataPath(STORE_FILE_MAP[name]);
}

function normalizeStoreOptions<T>(
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

function normalizeStorageDriver(raw: string | undefined): StorageDriver {
  const normalized = String(raw ?? "").trim().toLowerCase();
  if (normalized === "sqlite") {
    return "sqlite";
  }
  return "json-file";
}

function resolveSqliteDbPath(raw: string | undefined): string {
  const normalized = String(raw ?? "").trim();
  if (!normalized) {
    return resolveDataPath(SQLITE_DB_DEFAULT_RELATIVE);
  }
  return path.isAbsolute(normalized)
    ? normalized
    : path.resolve(process.cwd(), normalized);
}

function defaultStoreCodec(name: DataStoreName): DataStoreCodec {
  return STORE_DEFAULT_CODEC_MAP[name] ?? DEFAULT_STORE_CODEC;
}

function normalizeCodec(raw: unknown, fallback: DataStoreCodec): DataStoreCodec {
  if (raw === "json" || raw === "text") {
    return raw;
  }
  return fallback;
}

function toSqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function toSqlHexText(value: string): string {
  return `CAST(X'${Buffer.from(value, "utf-8").toString("hex")}' AS TEXT)`;
}

function normalizeStoreSelection(input: DataStoreName[] | undefined): Set<DataStoreName> {
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
