import fs from "fs";
import path from "path";
import { resolveDataPath } from "../../storage/persistence";
import { normalizeMultilineText } from "./shared";
import { WritingDocumentMode, WritingMaterialInputMode, WritingMaterialType } from "./types";

export const KNOWLEDGE_DIR_NAME = "knowledge";
export const MATERIALS_DIR_NAME = "materials";
export const INSIGHTS_DIR_NAME = "insights";
export const DOCUMENTS_DIR_NAME = "documents";
export const IMAGE_EXT_PATTERN = /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i;
export const DOCUMENT_META_SUFFIX = ".meta.json";

export function resolveTopicRoot(topicId: string): string {
  return resolveDataPath("writing", "topics", topicId);
}

export function resolveTopicKnowledgeRoot(topicId: string): string {
  return path.join(resolveTopicRoot(topicId), KNOWLEDGE_DIR_NAME);
}

export function resolveAbsolutePath(topicId: string, relativePath: string): string {
  return path.join(resolveTopicRoot(topicId), relativePath);
}

export function resolveKnowledgeFilePath(topicId: string, section: string, createdAt: string, fileName: string): string {
  const date = safeDate(createdAt);
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dir = path.join(resolveTopicKnowledgeRoot(topicId), section, year, month);
  ensureDir(dir);
  return path.join(dir, fileName);
}

export function listKnowledgeFiles(
  topicId: string,
  section: string,
  fileSuffix: string,
  filter?: (fileName: string) => boolean
): string[] {
  const targetDir = path.join(resolveTopicKnowledgeRoot(topicId), section);
  if (!fs.existsSync(targetDir)) {
    return [];
  }

  const result: string[] = [];
  const queue: string[] = [targetDir];

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) {
      continue;
    }

    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(absolutePath);
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith(fileSuffix)) {
        continue;
      }

      if (filter && !filter(entry.name)) {
        continue;
      }

      result.push(absolutePath);
    }
  }

  return result.sort();
}

export function createArtifactId(prefix: "mat" | "ins" | "doc", timestamp: string): string {
  const date = safeDate(timestamp);
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  const second = String(date.getUTCSeconds()).padStart(2, "0");
  const millis = String(date.getUTCMilliseconds()).padStart(3, "0");
  const random = Math.random().toString(36).slice(2, 6);

  return `${prefix}_${year}${month}${day}_${hour}${minute}${second}${millis}_${random}`;
}

export function writeJsonFile(filePath: string, payload: unknown): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
}

export function writeTextFile(filePath: string, payload: string): void {
  ensureDir(path.dirname(filePath));
  const normalized = normalizeMultilineText(payload);
  fs.writeFileSync(filePath, normalized ? `${normalized}\n` : "", "utf-8");
}

export function readJsonFile(filePath: string): unknown {
  try {
    const raw = fs.readFileSync(filePath, "utf-8").trim();
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function previewInline(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "(empty)";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(8, maxLength)).trim()}...`;
}

export function takeFirstNonEmptyLines(text: string, maxLines: number): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, Math.max(1, maxLines));
}

export function compareArtifactAsc(left: { created_at: string }, right: { created_at: string }): number {
  const leftMs = Date.parse(left.created_at);
  const rightMs = Date.parse(right.created_at);
  const safeLeft = Number.isFinite(leftMs) ? leftMs : 0;
  const safeRight = Number.isFinite(rightMs) ? rightMs : 0;

  if (safeLeft !== safeRight) {
    return safeLeft - safeRight;
  }

  return 0;
}

export function normalizePath(rawPath: string): string {
  return rawPath.replace(/\\/g, "/").replace(/^\/+/, "").trim();
}

export function normalizeMaterialType(raw: unknown): WritingMaterialType {
  const value = String(raw ?? "").trim().toLowerCase();
  if (
    value === "social_post"
    || value === "web_page"
    || value === "local_text"
    || value === "image"
    || value === "note"
    || value === "chat_record"
    || value === "mixed"
  ) {
    return value;
  }
  return "local_text";
}

export function normalizeInputMode(raw: unknown): WritingMaterialInputMode {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "url" || value === "text" || value === "image" || value === "mixed") {
    return value;
  }
  return "text";
}

export function normalizeDocumentMode(raw: unknown): WritingDocumentMode {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "knowledge_entry" || value === "article" || value === "memo" || value === "research_note") {
    return value;
  }
  return "knowledge_entry";
}

export function normalizeStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((item) => String(item ?? "").trim())
    .filter((item) => item.length > 0);
}

export function normalizeIdentifier(raw: string, prefix: "mat" | "ins" | "doc", timestamp: string): string {
  const normalized = raw.trim();
  if (normalized) {
    return normalized;
  }
  return createArtifactId(prefix, timestamp);
}

export function normalizeScore(raw: unknown): number {
  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Number(Math.max(0, Math.min(1, parsed)).toFixed(2));
}

export function safeVersion(raw: unknown): number {
  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }
  return Math.floor(parsed);
}

export function normalizeTimestamp(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") {
    return fallback;
  }
  const text = raw.trim();
  if (!text) {
    return fallback;
  }
  return text;
}

export function safeDate(rawTimestamp: string): Date {
  const parsed = Date.parse(rawTimestamp);
  if (Number.isFinite(parsed)) {
    return new Date(parsed);
  }
  return new Date();
}

export function createUrlPattern(): RegExp {
  return /https?:\/\/[^\s)]+/gi;
}

export function asRecord(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  return input as Record<string, unknown>;
}

export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}
