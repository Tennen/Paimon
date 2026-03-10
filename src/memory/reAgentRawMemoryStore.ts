import { DATA_STORE, getStore, registerStore, setStore } from "../storage/persistence";
type RawMemoryStoreState = { version: 1; sessions: Record<string, ReAgentRawMemoryRecord[]> };
export type ReAgentRawMemoryMeta = Record<string, unknown>;
export type ReAgentRawMemoryRecord = {
  id: string;
  sessionId: string;
  requestId: string;
  source: string;
  user: string;
  assistant: string;
  meta: ReAgentRawMemoryMeta;
  createdAt: string;
  summarizedAt?: string;
};
export type ReAgentRawMemoryAppendInput = {
  id?: string;
  sessionId: string;
  requestId: string;
  source: string;
  user: string;
  assistant: string;
  meta?: ReAgentRawMemoryMeta;
  createdAt?: string;
};
export class ReAgentRawMemoryStore {
  private readonly storeName = DATA_STORE.RE_AGENT_MEMORY_RAW;
  constructor(_baseDir?: string) { registerStore(this.storeName, () => createDefaultStore()); }

  append(input: ReAgentRawMemoryAppendInput): ReAgentRawMemoryRecord {
    const store = this.readStore();
    const key = toSessionKey(input.sessionId);
    const records = store.sessions[key] ?? [];
    const record = toRecord(input);
    const index = records.findIndex((item) => item.id === record.id);
    if (index >= 0) records[index] = record;
    else records.push(record);
    store.sessions[key] = records;
    setStore(this.storeName, store);
    return cloneRecord(record);
  }

  listBySession(sessionId: string): ReAgentRawMemoryRecord[] {
    return (this.readStore().sessions[toSessionKey(sessionId)] ?? []).map(cloneRecord);
  }

  listUnsummarized(sessionId: string, limit?: number): ReAgentRawMemoryRecord[] {
    const records = this.listBySession(sessionId).filter((item) => !item.summarizedAt);
    return typeof limit === "number" && limit > 0 ? records.slice(0, limit) : records;
  }

  getByIds(ids: string[], sessionId?: string): ReAgentRawMemoryRecord[] {
    const requested = dedupeIds(ids);
    if (requested.length === 0) return [];
    const store = this.readStore();
    const source = sessionId
      ? store.sessions[toSessionKey(sessionId)] ?? []
      : Object.values(store.sessions).flat();
    const byId = new Map(source.map((item) => [item.id, item]));
    return requested.map((id) => byId.get(id)).filter((item): item is ReAgentRawMemoryRecord => Boolean(item)).map(cloneRecord);
  }

  markSummarized(sessionId: string, ids: string[], summarizedAt: string = new Date().toISOString()): number {
    const wanted = new Set(dedupeIds(ids));
    if (wanted.size === 0) return 0;
    const store = this.readStore();
    const key = toSessionKey(sessionId);
    const records = store.sessions[key];
    if (!records || records.length === 0) return 0;
    let changed = 0;
    for (let i = 0; i < records.length; i += 1) {
      const item = records[i];
      if (!wanted.has(item.id) || item.summarizedAt === summarizedAt) continue;
      records[i] = { ...item, summarizedAt };
      changed += 1;
    }
    if (changed > 0) {
      store.sessions[key] = records;
      setStore(this.storeName, store);
    }
    return changed;
  }

  clear(sessionId: string): void {
    const store = this.readStore();
    const key = toSessionKey(sessionId);
    if (!(key in store.sessions)) return;
    delete store.sessions[key];
    setStore(this.storeName, store);
  }

  private readStore(): RawMemoryStoreState {
    return normalizeStore(getStore<unknown>(this.storeName));
  }
}

export function normalizeReAgentRawMemorySessionKey(sessionId: string): string {
  return String(sessionId ?? "").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function toSessionKey(sessionId: string): string {
  const key = normalizeReAgentRawMemorySessionKey(sessionId);
  return key || "_";
}

function normalizeStore(input: unknown): RawMemoryStoreState {
  if (!isRecord(input) || !isRecord(input.sessions)) return createDefaultStore();
  const sessions: Record<string, ReAgentRawMemoryRecord[]> = {};
  for (const [rawSessionKey, rawValue] of Object.entries(input.sessions)) {
    const key = toSessionKey(rawSessionKey);
    sessions[key] = Array.isArray(rawValue) ? normalizeRecords(rawValue, key) : [];
  }
  return { version: 1, sessions };
}

function normalizeRecords(input: unknown[], fallbackSessionId: string): ReAgentRawMemoryRecord[] {
  const out: ReAgentRawMemoryRecord[] = [];
  const seen = new Set<string>();
  for (const rawRecord of input) {
    if (!isRecord(rawRecord)) continue;
    const id = normalizeId(rawRecord.id) || generateId();
    if (seen.has(id)) continue;
    seen.add(id);
    const summarizedAt = typeof rawRecord.summarizedAt === "string" && rawRecord.summarizedAt.length > 0
      ? rawRecord.summarizedAt
      : undefined;
    out.push({
      id,
      sessionId: typeof rawRecord.sessionId === "string" && rawRecord.sessionId.length > 0
        ? rawRecord.sessionId
        : fallbackSessionId,
      requestId: typeof rawRecord.requestId === "string" ? rawRecord.requestId : "",
      source: typeof rawRecord.source === "string" ? rawRecord.source : "",
      user: typeof rawRecord.user === "string" ? rawRecord.user : String(rawRecord.user ?? ""),
      assistant: typeof rawRecord.assistant === "string" ? rawRecord.assistant : String(rawRecord.assistant ?? ""),
      meta: isRecord(rawRecord.meta) ? { ...rawRecord.meta } : {},
      createdAt: typeof rawRecord.createdAt === "string" && rawRecord.createdAt.length > 0
        ? rawRecord.createdAt
        : new Date().toISOString(),
      ...(summarizedAt ? { summarizedAt } : {})
    });
  }
  return out;
}

function toRecord(input: ReAgentRawMemoryAppendInput): ReAgentRawMemoryRecord {
  return {
    id: normalizeId(input.id) || generateId(),
    sessionId: input.sessionId,
    requestId: input.requestId,
    source: input.source,
    user: input.user,
    assistant: input.assistant,
    meta: input.meta ? { ...input.meta } : {},
    createdAt: input.createdAt && input.createdAt.length > 0 ? input.createdAt : new Date().toISOString()
  };
}

function cloneRecord(input: ReAgentRawMemoryRecord): ReAgentRawMemoryRecord {
  return { ...input, meta: { ...input.meta } };
}

function dedupeIds(ids: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const rawId of ids) {
    const id = normalizeId(rawId);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

function createDefaultStore(): RawMemoryStoreState {
  return { version: 1, sessions: {} };
}

function normalizeId(input: unknown): string {
  return typeof input === "string" ? input.trim() : "";
}

function generateId(): string {
  return `raw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return Boolean(input) && typeof input === "object" && !Array.isArray(input);
}
