import fs from "fs";
import path from "path";
import { getStore, registerStore, resolveDataPath, setStore } from "../../storage/persistence";
import {
  createDefaultIndexStore,
  WRITING_DEFAULT_TOPIC_STATUS,
  WRITING_ORGANIZER_INDEX_STORE,
  WRITING_RAW_MAX_LINES
} from "./defaults";
import {
  countNonEmptyLines,
  normalizeMultilineText,
  normalizeTopicId,
  normalizeTopicTitle,
  splitFragments
} from "./shared";
import {
  WritingAppendResult,
  WritingOrganizerIndexStore,
  WritingStateSection,
  WritingTopicDetail,
  WritingTopicMeta,
  WritingTopicRawFile,
  WritingTopicState
} from "./types";

type TopicPaths = {
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

export function ensureWritingOrganizerStorage(): void {
  registerStore(WRITING_ORGANIZER_INDEX_STORE, () => createDefaultIndexStore());
  ensureDir(TOPICS_ROOT_DIR);
}

export function listTopicMeta(): WritingTopicMeta[] {
  ensureWritingOrganizerStorage();
  const index = readIndexStore();
  const fromDisk = listTopicIdsFromDisk();
  const topicIds = uniqueTopicIds([...index.topicIds, ...fromDisk]);

  if (topicIds.length !== index.topicIds.length || topicIds.some((id, i) => id !== index.topicIds[i])) {
    writeIndexStore({
      version: 1,
      topicIds,
      updatedAt: new Date().toISOString()
    });
  }

  return topicIds
    .map((topicId) => getTopicMeta(topicId))
    .sort((left, right) => compareTimestampDesc(left.updatedAt, right.updatedAt));
}

export function getTopicMeta(topicId: string): WritingTopicMeta {
  const normalizedTopicId = requireTopicId(topicId);
  const paths = ensureTopicPaths(normalizedTopicId);
  const existing = readTopicMetaFile(paths.metaFile, normalizedTopicId);
  if (existing) {
    ensureTopicInIndex(normalizedTopicId);
    return existing;
  }

  const stats = computeRawStats(paths.rawDir);
  const now = new Date().toISOString();
  const created = createMeta(
    normalizedTopicId,
    normalizeTopicTitle("", normalizedTopicId),
    stats.rawFileCount,
    stats.rawLineCount,
    now,
    now
  );
  writeTopicMetaFile(paths.metaFile, created);
  ensureTopicInIndex(normalizedTopicId);
  return created;
}

export function updateTopicMeta(
  topicId: string,
  patch?: {
    title?: string;
    status?: WritingTopicMeta["status"];
    lastSummarizedAt?: string;
  }
): WritingTopicMeta {
  const normalizedTopicId = requireTopicId(topicId);
  const paths = ensureTopicPaths(normalizedTopicId);
  const current = getTopicMeta(normalizedTopicId);
  const stats = computeRawStats(paths.rawDir);
  const now = new Date().toISOString();

  const next: WritingTopicMeta = {
    topicId: normalizedTopicId,
    title: normalizeTopicTitle(
      patch?.title ?? current.title,
      normalizedTopicId
    ),
    status: patch?.status === "archived" ? "archived" : (current.status ?? WRITING_DEFAULT_TOPIC_STATUS),
    rawFileCount: stats.rawFileCount,
    rawLineCount: stats.rawLineCount,
    createdAt: normalizeTimestamp(current.createdAt, now),
    updatedAt: now,
    ...resolveLastSummarizedAt(current.lastSummarizedAt, patch?.lastSummarizedAt)
  };

  writeTopicMetaFile(paths.metaFile, next);
  ensureTopicInIndex(normalizedTopicId);
  return next;
}

export function appendTopicRawContent(topicId: string, content: string, title?: string): WritingAppendResult {
  const normalizedTopicId = requireTopicId(topicId);
  const fragments = splitFragments(content);
  if (fragments.length === 0) {
    throw new Error("append 内容为空，至少提供一行文本");
  }

  const paths = ensureTopicPaths(normalizedTopicId);
  getTopicMeta(normalizedTopicId);

  const latestRawFile = appendFragmentsToRaw(paths.rawDir, fragments);
  const meta = updateTopicMeta(normalizedTopicId, title ? { title } : undefined);

  return {
    topicId: normalizedTopicId,
    appendedLines: fragments.length,
    latestRawFile,
    meta
  };
}

export function getTopicDetail(topicId: string): WritingTopicDetail {
  const normalizedTopicId = requireTopicId(topicId);
  const paths = ensureTopicPaths(normalizedTopicId);

  return {
    meta: getTopicMeta(normalizedTopicId),
    state: readTopicState(normalizedTopicId),
    backup: readTopicBackup(normalizedTopicId),
    rawFiles: readTopicRawFilesFromDir(paths.rawDir)
  };
}

export function readTopicRawLines(topicId: string): string[] {
  const normalizedTopicId = requireTopicId(topicId);
  const paths = ensureTopicPaths(normalizedTopicId);
  const rawFiles = listRawFileNames(paths.rawDir);
  const lines: string[] = [];

  for (const name of rawFiles) {
    const filePath = path.join(paths.rawDir, name);
    lines.push(...readRawFileLines(filePath));
  }

  return lines;
}

export function readTopicState(topicId: string): WritingTopicState {
  const normalizedTopicId = requireTopicId(topicId);
  const paths = ensureTopicPaths(normalizedTopicId);
  return {
    summary: readTextFile(paths.stateFiles.summary),
    outline: readTextFile(paths.stateFiles.outline),
    draft: readTextFile(paths.stateFiles.draft)
  };
}

export function writeTopicState(topicId: string, state: WritingTopicState): WritingTopicState {
  const normalizedTopicId = requireTopicId(topicId);
  const paths = ensureTopicPaths(normalizedTopicId);

  writeTextFile(paths.stateFiles.summary, state.summary);
  writeTextFile(paths.stateFiles.outline, state.outline);
  writeTextFile(paths.stateFiles.draft, state.draft);

  return readTopicState(normalizedTopicId);
}

export function readTopicBackup(topicId: string): WritingTopicState {
  const normalizedTopicId = requireTopicId(topicId);
  const paths = ensureTopicPaths(normalizedTopicId);
  return {
    summary: readTextFile(paths.backupFiles.summary),
    outline: readTextFile(paths.backupFiles.outline),
    draft: readTextFile(paths.backupFiles.draft)
  };
}

export function backupTopicState(topicId: string): WritingTopicState {
  const normalizedTopicId = requireTopicId(topicId);
  const paths = ensureTopicPaths(normalizedTopicId);
  const state = readTopicState(normalizedTopicId);

  writeTextFile(paths.backupFiles.summary, state.summary);
  writeTextFile(paths.backupFiles.outline, state.outline);
  writeTextFile(paths.backupFiles.draft, state.draft);

  return state;
}

export function restoreTopicStateFromBackup(topicId: string): WritingTopicState {
  const normalizedTopicId = requireTopicId(topicId);
  const paths = ensureTopicPaths(normalizedTopicId);

  const hasBackup = Object.values(paths.backupFiles).some((filePath) => fs.existsSync(filePath));
  if (!hasBackup) {
    throw new Error(`topic ${normalizedTopicId} 暂无 backup，可先执行 summarize`);
  }

  const backup = readTopicBackup(normalizedTopicId);
  return writeTopicState(normalizedTopicId, backup);
}

export function writeTopicStateSection(topicId: string, section: WritingStateSection, content: string): WritingTopicState {
  const normalizedTopicId = requireTopicId(topicId);
  const current = readTopicState(normalizedTopicId);
  const next: WritingTopicState = {
    ...current,
    [section]: content
  };
  return writeTopicState(normalizedTopicId, next);
}

function readIndexStore(): WritingOrganizerIndexStore {
  const parsed = getStore<unknown>(WRITING_ORGANIZER_INDEX_STORE);
  return normalizeIndexStore(parsed);
}

function writeIndexStore(store: WritingOrganizerIndexStore): void {
  setStore(WRITING_ORGANIZER_INDEX_STORE, normalizeIndexStore(store));
}

function ensureTopicInIndex(topicId: string): void {
  const normalized = requireTopicId(topicId);
  const store = readIndexStore();
  if (store.topicIds.includes(normalized)) {
    return;
  }

  writeIndexStore({
    version: 1,
    topicIds: uniqueTopicIds([...store.topicIds, normalized]),
    updatedAt: new Date().toISOString()
  });
}

function normalizeIndexStore(input: unknown): WritingOrganizerIndexStore {
  const source = asRecord(input);
  const topicIds = uniqueTopicIds(
    Array.isArray(source?.topicIds)
      ? source.topicIds.map((item) => normalizeTopicId(String(item ?? "")))
      : []
  );

  return {
    version: 1,
    topicIds,
    updatedAt: normalizeTimestamp(source?.updatedAt, new Date(0).toISOString())
  };
}

function listTopicIdsFromDisk(): string[] {
  if (!fs.existsSync(TOPICS_ROOT_DIR)) {
    return [];
  }

  return fs
    .readdirSync(TOPICS_ROOT_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => normalizeTopicId(entry.name))
    .filter((topicId) => topicId.length > 0);
}

function ensureTopicPaths(topicId: string): TopicPaths {
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

function readTopicMetaFile(metaFile: string, topicId: string): WritingTopicMeta | null {
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

function writeTopicMetaFile(metaFile: string, meta: WritingTopicMeta): void {
  fs.writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`, "utf-8");
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

function createMeta(
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

function resolveLastSummarizedAt(
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

function appendFragmentsToRaw(rawDir: string, fragments: string[]): string {
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

function readTopicRawFilesFromDir(rawDir: string): WritingTopicRawFile[] {
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

function computeRawStats(rawDir: string): { rawFileCount: number; rawLineCount: number } {
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

function listRawFileNames(rawDir: string): string[] {
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

function readRawFileLines(filePath: string): string[] {
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

function readTextFile(filePath: string): string {
  if (!fs.existsSync(filePath)) {
    return "";
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  return raw.replace(/\r\n/g, "\n").trim();
}

function writeTextFile(filePath: string, content: string): void {
  const normalized = normalizeMultilineText(content);
  fs.writeFileSync(filePath, normalized ? `${normalized}\n` : "", "utf-8");
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function requireTopicId(topicId: string): string {
  const normalized = normalizeTopicId(topicId);
  if (!normalized) {
    throw new Error("invalid topic-id");
  }
  return normalized;
}

function uniqueTopicIds(topicIds: string[]): string[] {
  return Array.from(new Set(topicIds.filter((id) => id.length > 0))).sort();
}

function normalizeNonNegativeInteger(raw: unknown): number {
  const value = typeof raw === "number" ? raw : Number(raw ?? 0);
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

function normalizeTimestamp(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") {
    return fallback;
  }
  const text = raw.trim();
  if (!text) {
    return fallback;
  }
  return text;
}

function compareTimestampDesc(left: string, right: string): number {
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  const safeLeft = Number.isFinite(leftMs) ? leftMs : 0;
  const safeRight = Number.isFinite(rightMs) ? rightMs : 0;
  return safeRight - safeLeft;
}

function asRecord(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  return input as Record<string, unknown>;
}
