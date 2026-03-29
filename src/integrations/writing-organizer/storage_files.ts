import fs from "fs";
import path from "path";
import { resolveDataPath } from "../../storage/persistence";
import { WRITING_DEFAULT_TOPIC_STATUS, WRITING_RAW_MAX_LINES } from "./defaults";
import {
  countNonEmptyLines,
  normalizeMultilineText,
  normalizeTopicId,
  normalizeTopicTitle
} from "./shared";
import {
  WritingStateSection,
  WritingTopicMeta,
  WritingTopicRawFile
} from "./types";

export type TopicPaths = {
  rootDir: string;
  rawDir: string;
  stateDir: string;
  backupDir: string;
  metaFile: string;
  stateFiles: Record<WritingStateSection, string>;
  backupFiles: Record<WritingStateSection, string>;
};

const RAW_FILE_PATTERN = /^\d+\.md$/i;
const TOPICS_ROOT_DIR = resolveDataPath("writing", "topics");

export function ensureTopicsRootDir(): void {
  ensureDir(TOPICS_ROOT_DIR);
}

export function listTopicIdsFromDisk(): string[] {
  if (!fs.existsSync(TOPICS_ROOT_DIR)) {
    return [];
  }

  return fs
    .readdirSync(TOPICS_ROOT_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => normalizeTopicId(entry.name))
    .filter((topicId) => topicId.length > 0);
}

export function ensureTopicPaths(topicId: string): TopicPaths {
  const normalizedTopicId = requireTopicId(topicId);
  const rootDir = resolveDataPath("writing", "topics", normalizedTopicId);
  const rawDir = path.join(rootDir, "raw");
  const stateDir = path.join(rootDir, "state");
  const backupDir = path.join(rootDir, "backup");
  const paths: TopicPaths = {
    rootDir,
    rawDir,
    stateDir,
    backupDir,
    metaFile: path.join(rootDir, "meta.json"),
    stateFiles: {
      summary: path.join(stateDir, "summary.md"),
      outline: path.join(stateDir, "outline.md"),
      draft: path.join(stateDir, "draft.md")
    },
    backupFiles: {
      summary: path.join(backupDir, "summary.prev.md"),
      outline: path.join(backupDir, "outline.prev.md"),
      draft: path.join(backupDir, "draft.prev.md")
    }
  };

  ensureDir(paths.rootDir);
  ensureDir(paths.rawDir);
  ensureDir(paths.stateDir);
  ensureDir(paths.backupDir);

  return paths;
}

export function readTopicMetaFile(metaFile: string, topicId: string): WritingTopicMeta | null {
  if (!fs.existsSync(metaFile)) {
    return null;
  }

  const raw = fs.readFileSync(metaFile, "utf-8");
  if (!raw.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return normalizeTopicMeta(parsed, topicId);
  } catch {
    return null;
  }
}

export function writeTopicMetaFile(metaFile: string, meta: WritingTopicMeta): void {
  fs.writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`, "utf-8");
}

export function createMeta(
  topicId: string,
  title: string,
  rawFileCount: number,
  rawLineCount: number,
  createdAt: string,
  updatedAt: string
): WritingTopicMeta {
  return {
    topicId,
    title,
    status: WRITING_DEFAULT_TOPIC_STATUS,
    rawFileCount,
    rawLineCount,
    createdAt,
    updatedAt
  };
}

export function resolveLastSummarizedAt(
  current: string | undefined,
  patch: unknown
): { lastSummarizedAt?: string } {
  if (typeof patch === "string" && patch.trim()) {
    return { lastSummarizedAt: patch.trim() };
  }
  if (typeof current === "string" && current.trim()) {
    return { lastSummarizedAt: current.trim() };
  }
  return {};
}

export function appendFragmentsToRaw(rawDir: string, fragments: string[]): string {
  const files = listRawFileNames(rawDir);
  let currentName = files[files.length - 1] ?? formatRawFileName(1);
  let currentPath = path.join(rawDir, currentName);
  let currentIndex = parseRawIndex(currentName);
  let currentLines = readRawFileLines(currentPath);

  for (const fragment of fragments) {
    if (currentLines.length >= WRITING_RAW_MAX_LINES) {
      writeRawFileLines(currentPath, currentLines);
      currentIndex += 1;
      currentName = formatRawFileName(currentIndex);
      currentPath = path.join(rawDir, currentName);
      currentLines = readRawFileLines(currentPath);
    }
    currentLines.push(fragment);
  }

  writeRawFileLines(currentPath, currentLines);
  return currentName;
}

export function readTopicRawFilesFromDir(rawDir: string): WritingTopicRawFile[] {
  return listRawFileNames(rawDir).map((name) => {
    const filePath = path.join(rawDir, name);
    const content = readTextFile(filePath);
    return {
      name,
      lineCount: countNonEmptyLines(content),
      content
    };
  });
}

export function readTopicRawLinesFromDir(rawDir: string): string[] {
  const lines: string[] = [];
  for (const name of listRawFileNames(rawDir)) {
    const filePath = path.join(rawDir, name);
    lines.push(...readRawFileLines(filePath));
  }
  return lines;
}

export function computeRawStats(rawDir: string): { rawFileCount: number; rawLineCount: number } {
  const fileNames = listRawFileNames(rawDir);
  let rawLineCount = 0;

  for (const name of fileNames) {
    const filePath = path.join(rawDir, name);
    const content = readTextFile(filePath);
    rawLineCount += countNonEmptyLines(content);
  }

  return {
    rawFileCount: fileNames.length,
    rawLineCount
  };
}

export function readTextFile(filePath: string): string {
  if (!fs.existsSync(filePath)) {
    return "";
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  return raw.replace(/\r\n/g, "\n").trim();
}

export function writeTextFile(filePath: string, content: string): void {
  const normalized = normalizeMultilineText(content);
  fs.writeFileSync(filePath, normalized ? `${normalized}\n` : "", "utf-8");
}

export function requireTopicId(topicId: string): string {
  const normalized = normalizeTopicId(topicId);
  if (!normalized) {
    throw new Error("invalid topic-id");
  }
  return normalized;
}

export function uniqueTopicIds(topicIds: string[]): string[] {
  return Array.from(new Set(topicIds.filter((id) => id.length > 0))).sort();
}

export function normalizeNonNegativeInteger(raw: unknown): number {
  const value = typeof raw === "number" ? raw : Number(raw ?? 0);
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
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

export function compareTimestampDesc(left: string, right: string): number {
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  const safeLeft = Number.isFinite(leftMs) ? leftMs : 0;
  const safeRight = Number.isFinite(rightMs) ? rightMs : 0;
  return safeRight - safeLeft;
}

function normalizeTopicMeta(input: unknown, topicId: string): WritingTopicMeta {
  const source = asRecord(input);
  const now = new Date().toISOString();

  const rawFileCount = normalizeNonNegativeInteger(source?.rawFileCount);
  const rawLineCount = normalizeNonNegativeInteger(source?.rawLineCount);

  return {
    topicId,
    title: normalizeTopicTitle(String(source?.title ?? ""), topicId),
    status: source?.status === "archived" ? "archived" : WRITING_DEFAULT_TOPIC_STATUS,
    rawFileCount,
    rawLineCount,
    ...resolveLastSummarizedAt(undefined, source?.lastSummarizedAt),
    createdAt: normalizeTimestamp(source?.createdAt, now),
    updatedAt: normalizeTimestamp(source?.updatedAt, now)
  };
}

export function listRawFileNames(rawDir: string): string[] {
  if (!fs.existsSync(rawDir)) {
    return [];
  }

  return fs
    .readdirSync(rawDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && RAW_FILE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => parseRawIndex(left) - parseRawIndex(right));
}

function parseRawIndex(fileName: string): number {
  const matched = fileName.match(/^(\d+)\.md$/i);
  if (!matched) {
    return 1;
  }
  const parsed = Number.parseInt(matched[1], 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1;
  }
  return parsed;
}

function formatRawFileName(index: number): string {
  const safe = Math.max(1, Math.floor(index));
  return `${String(safe).padStart(3, "0")}.md`;
}

export function readRawFileLines(filePath: string): string[] {
  const content = readTextFile(filePath);
  if (!content) {
    return [];
  }

  return content
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function writeRawFileLines(filePath: string, lines: string[]): void {
  const normalized = lines.map((line) => line.trim()).filter((line) => line.length > 0);
  const content = normalized.length > 0 ? `${normalized.join("\n")}\n` : "";
  fs.writeFileSync(filePath, content, "utf-8");
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function asRecord(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  return input as Record<string, unknown>;
}
