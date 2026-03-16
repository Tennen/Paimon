import { execFileSync } from "child_process";
import path from "path";
import {
  DataStoreCodec,
  DataStoreName,
  StoreEntry,
  decodeStorePayload,
  encodeStorePayload,
  ensureDir,
  normalizeCodec
} from "./shared";

const SQLITE_TABLE_NAME = "paimon_store";
const sqliteReady = new Set<string>();

type SqliteRow = {
  name: string;
  codec: DataStoreCodec;
  payload: string;
};

export function ensureSqliteStore(entry: StoreEntry, dbPath: string): void {
  ensureSqliteSchema(dbPath);

  const existing = readSqliteRow(entry.name, dbPath);
  if (existing) {
    if (existing.codec !== entry.codec) {
      throw new Error(
        `storage key already initialized with different codec in sqlite: ${entry.name} (${existing.codec} != ${entry.codec})`
      );
    }
    return;
  }

  const encoded = encodeStorePayload(entry.init(), entry.codec);
  upsertSqliteRow(dbPath, entry.name, entry.codec, encoded);
}

export function readSqliteStore(entry: StoreEntry, dbPath: string): unknown {
  ensureSqliteStore(entry, dbPath);
  const row = readSqliteRow(entry.name, dbPath);
  if (!row) {
    return entry.init();
  }

  return decodeStorePayload(row.payload, entry.codec, entry.init);
}

export function writeSqliteStore(entry: StoreEntry, payload: unknown, dbPath: string): void {
  ensureSqliteStore(entry, dbPath);
  const encoded = encodeStorePayload(payload, entry.codec);
  upsertSqliteRow(dbPath, entry.name, entry.codec, encoded);
}

export function appendSqliteStore(entry: StoreEntry, content: string, dbPath: string): void {
  ensureSqliteStore(entry, dbPath);
  appendSqliteRowPayload(dbPath, entry.name, entry.codec, content);
}

export function upsertSqliteRow(
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

function ensureSqliteSchema(dbPath: string): void {
  if (sqliteReady.has(dbPath)) {
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

  sqliteReady.add(dbPath);
}

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

function ensureParentDir(filePath: string): void {
  ensureDir(path.dirname(filePath));
}

function toSqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function toSqlHexText(value: string): string {
  return `CAST(X'${Buffer.from(value, "utf-8").toString("hex")}' AS TEXT)`;
}
