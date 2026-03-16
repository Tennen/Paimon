import path from "path";
import {
  DATA_STORE,
  DataStoreCodec,
  DataStoreDescriptor,
  DataStoreName,
  RegisterStoreOptions,
  StorageDriver,
  StoreDefinition,
  StoreEntry,
  StoreMigrationItem,
  StoreMigrationReport,
  defaultStoreCodec,
  ensureDir,
  normalizeRawForCodec,
  normalizeStoreOptions,
  normalizeStoreSelection,
  normalizeStorageDriver,
  resolveDataPath,
  resolveSqliteDbPath,
  resolveStoreFile
} from "./persistence/shared";
import {
  appendJsonStore,
  ensureJsonStore,
  readJsonStore,
  readRawJsonStoreFile,
  writeJsonStore
} from "./persistence/json_driver";
import {
  appendSqliteStore,
  ensureSqliteStore,
  readSqliteStore,
  upsertSqliteRow,
  writeSqliteStore
} from "./persistence/sqlite_driver";

const STORAGE_DRIVER: StorageDriver = normalizeStorageDriver(process.env.STORAGE_DRIVER);
const SQLITE_DB_PATH = resolveSqliteDbPath(process.env.STORAGE_SQLITE_PATH);

const storeRegistry = new Map<DataStoreName, StoreEntry>();

export {
  DATA_STORE,
  ensureDir,
  resolveDataPath
};

export type {
  DataStoreCodec,
  DataStoreDescriptor,
  DataStoreName,
  RegisterStoreOptions,
  StorageDriver,
  StoreDefinition,
  StoreMigrationItem,
  StoreMigrationReport
};

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
      throw new Error(`storage key already registered with different config: ${name}`);
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
    return readSqliteStore(entry, SQLITE_DB_PATH) as T;
  }

  return readJsonStore(entry) as T;
}

export function setStore(name: DataStoreName, payload: unknown): void {
  const entry = getRegisteredStore(name);

  if (STORAGE_DRIVER === "sqlite") {
    writeSqliteStore(entry, payload, SQLITE_DB_PATH);
    return;
  }

  writeJsonStore(entry, payload);
}

export function appendStore(name: DataStoreName, content: string): void {
  const entry = getRegisteredStore(name);
  if (entry.codec !== "text") {
    throw new Error(`appendStore only supports text codec: ${name}`);
  }

  if (STORAGE_DRIVER === "sqlite") {
    appendSqliteStore(entry, content, SQLITE_DB_PATH);
    return;
  }

  appendJsonStore(entry, content);
}

export function migrateJsonStoresToSqlite(options?: {
  dbPath?: string;
  storeNames?: DataStoreName[];
}): StoreMigrationReport {
  const targetDbPath = options?.dbPath ? resolveSqliteDbPath(options.dbPath) : SQLITE_DB_PATH;
  const requested = normalizeStoreSelection(options?.storeNames);
  const definitions = listStoreDefinitions().filter((definition) => requested.has(definition.name));

  const items: StoreMigrationReport["stores"] = [];
  let migrated = 0;
  let skipped = 0;

  for (const definition of definitions) {
    const raw = readRawJsonStoreFile(definition.filePath);
    if (raw === null) {
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

function ensureStoreInitialized(entry: StoreEntry): void {
  if (STORAGE_DRIVER === "sqlite") {
    ensureSqliteStore(entry, SQLITE_DB_PATH);
    return;
  }

  ensureJsonStore(entry);
}

function getRegisteredStore(name: DataStoreName): StoreEntry {
  const entry = storeRegistry.get(name);
  if (entry) {
    return entry;
  }
  throw new Error(`storage key not registered: ${name}`);
}
