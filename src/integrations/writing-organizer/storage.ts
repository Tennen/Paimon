import fs from "fs";
import { getStore, registerStore, setStore } from "../../storage/persistence";
import {
  createDefaultIndexStore,
  WRITING_DEFAULT_TOPIC_STATUS,
  WRITING_ORGANIZER_INDEX_STORE
} from "./defaults";
import {
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
  WritingTopicState
} from "./types";
import {
  TopicPaths,
  appendFragmentsToRaw,
  compareTimestampDesc,
  computeRawStats,
  createMeta,
  ensureTopicPaths,
  ensureTopicsRootDir,
  normalizeNonNegativeInteger,
  normalizeTimestamp,
  readTextFile,
  readTopicMetaFile,
  readTopicRawLinesFromDir,
  readTopicRawFilesFromDir,
  requireTopicId,
  resolveLastSummarizedAt,
  uniqueTopicIds,
  writeTextFile,
  writeTopicMetaFile,
  listTopicIdsFromDisk
} from "./storage_files";

export function ensureWritingOrganizerStorage(): void {
  registerStore(WRITING_ORGANIZER_INDEX_STORE, () => createDefaultIndexStore());
  ensureTopicsRootDir();
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
  return readTopicRawLinesFromDir(paths.rawDir);
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

function asRecord(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  return input as Record<string, unknown>;
}
