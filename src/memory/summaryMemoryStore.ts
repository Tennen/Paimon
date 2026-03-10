import { DATA_STORE, getStore, registerStore, setStore } from "../storage/persistence";

type SummaryMemoryStoreState = {
  version: 1;
  sessions: Record<string, SummaryMemoryRecord[]>;
};

export type SummaryMemoryRecord = {
  id: string;
  sessionId: string;
  user_facts: string[];
  environment: string[];
  long_term_preferences: string[];
  task_results: string[];
  rawRefs: string[];
  createdAt: string;
  updatedAt: string;
};

export type SummaryMemoryUpsertInput = {
  id?: string;
  sessionId: string;
  user_facts?: unknown;
  environment?: unknown;
  long_term_preferences?: unknown;
  task_results?: unknown;
  rawRefs?: unknown;
  createdAt?: string;
  updatedAt?: string;
};

export class SummaryMemoryStore {
  private readonly storeName = DATA_STORE.MEMORY_SUMMARY;

  constructor(_baseDir?: string) {
    registerStore(this.storeName, () => createDefaultStore());
  }

  upsert(input: SummaryMemoryUpsertInput): SummaryMemoryRecord {
    const store = this.readStore();
    const key = toSessionKey(input.sessionId);
    const records = store.sessions[key] ?? [];
    const now = new Date().toISOString();
    const id = normalizeString(input.id) || generateId();
    const index = records.findIndex((item) => item.id === id);
    const existing = index >= 0 ? records[index] : undefined;
    const record: SummaryMemoryRecord = {
      id,
      sessionId: normalizeString(input.sessionId) || existing?.sessionId || key,
      user_facts: toStringList(input.user_facts),
      environment: toStringList(input.environment),
      long_term_preferences: toStringList(input.long_term_preferences),
      task_results: toStringList(input.task_results),
      rawRefs: toStringList(input.rawRefs),
      createdAt: normalizeString(input.createdAt) || existing?.createdAt || now,
      updatedAt: normalizeString(input.updatedAt) || now
    };
    if (index >= 0) {
      records[index] = record;
    } else {
      records.push(record);
    }
    store.sessions[key] = records;
    setStore(this.storeName, store);
    return cloneRecord(record);
  }

  listBySession(sessionId: string): SummaryMemoryRecord[] {
    const store = this.readStore();
    return (store.sessions[toSessionKey(sessionId)] ?? []).map(cloneRecord);
  }

  clear(sessionId: string): void {
    const store = this.readStore();
    const key = toSessionKey(sessionId);
    if (!(key in store.sessions)) {
      return;
    }
    delete store.sessions[key];
    setStore(this.storeName, store);
  }

  private readStore(): SummaryMemoryStoreState {
    return normalizeStore(getStore<unknown>(this.storeName));
  }
}

export function normalizeSummaryMemorySessionKey(sessionId: string): string {
  return String(sessionId ?? "").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function toSessionKey(sessionId: string): string {
  const key = normalizeSummaryMemorySessionKey(sessionId);
  return key || "_";
}

function normalizeStore(input: unknown): SummaryMemoryStoreState {
  if (!isRecord(input) || !isRecord(input.sessions)) {
    return createDefaultStore();
  }
  const sessions: Record<string, SummaryMemoryRecord[]> = {};
  for (const [rawSessionKey, rawValue] of Object.entries(input.sessions)) {
    const key = toSessionKey(rawSessionKey);
    sessions[key] = Array.isArray(rawValue) ? normalizeRecords(rawValue, key) : [];
  }
  return { version: 1, sessions };
}

function normalizeRecords(rawRecords: unknown[], fallbackSessionId: string): SummaryMemoryRecord[] {
  const output: SummaryMemoryRecord[] = [];
  const seen = new Set<string>();
  for (const rawRecord of rawRecords) {
    if (!isRecord(rawRecord)) {
      continue;
    }
    const id = normalizeString(rawRecord.id) || generateId();
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    const createdAt = normalizeString(rawRecord.createdAt) || new Date().toISOString();
    output.push({
      id,
      sessionId: normalizeString(rawRecord.sessionId) || fallbackSessionId,
      user_facts: toStringList(rawRecord.user_facts),
      environment: toStringList(rawRecord.environment),
      long_term_preferences: toStringList(rawRecord.long_term_preferences),
      task_results: toStringList(rawRecord.task_results),
      rawRefs: toStringList(rawRecord.rawRefs),
      createdAt,
      updatedAt: normalizeString(rawRecord.updatedAt) || createdAt
    });
  }
  return output;
}

function createDefaultStore(): SummaryMemoryStoreState {
  return { version: 1, sessions: {} };
}

function cloneRecord(record: SummaryMemoryRecord): SummaryMemoryRecord {
  return {
    ...record,
    user_facts: [...record.user_facts],
    environment: [...record.environment],
    long_term_preferences: [...record.long_term_preferences],
    task_results: [...record.task_results],
    rawRefs: [...record.rawRefs]
  };
}

function toStringList(input: unknown): string[] {
  const rawList = Array.isArray(input) ? input : [input];
  const output: string[] = [];
  const seen = new Set<string>();
  for (const item of rawList) {
    const value =
      typeof item === "string"
        ? item.trim()
        : typeof item === "number" || typeof item === "boolean"
          ? String(item)
          : "";
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    output.push(value);
  }
  return output;
}

function normalizeString(input: unknown): string {
  return typeof input === "string" ? input.trim() : "";
}

function generateId(): string {
  return `summary_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return Boolean(input) && typeof input === "object" && !Array.isArray(input);
}
