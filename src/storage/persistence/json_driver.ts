import fs from "fs";
import path from "path";
import { StoreEntry, normalizeTextPayload } from "./shared";

export function ensureJsonStore(entry: StoreEntry): void {
  ensureParentDir(entry.filePath);
  if (!fs.existsSync(entry.filePath)) {
    writeJsonStore(entry, entry.init());
  }
}

export function readJsonStore(entry: StoreEntry): unknown {
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

export function writeJsonStore(entry: StoreEntry, payload: unknown): void {
  if (entry.codec === "text") {
    writeFileAtomic(entry.filePath, normalizeTextPayload(payload));
    return;
  }

  writeFileAtomic(entry.filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

export function appendJsonStore(entry: StoreEntry, content: string): void {
  ensureJsonStore(entry);
  fs.appendFileSync(entry.filePath, content, "utf-8");
}

export function readRawJsonStoreFile(filePath: string): string | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return fs.readFileSync(filePath, "utf-8");
}

function writeFileAtomic(filePath: string, content: string): void {
  ensureParentDir(filePath);
  const tempPath = `${filePath}.${process.pid}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  fs.writeFileSync(tempPath, content, "utf-8");
  fs.renameSync(tempPath, filePath);
}

function ensureParentDir(filePath: string): void {
  const parent = path.dirname(filePath);
  if (!fs.existsSync(parent)) {
    fs.mkdirSync(parent, { recursive: true });
  }
}
