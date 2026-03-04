import { DATA_STORE, getStore, registerStore, setStore } from "../storage/persistence";

type MemorySessionsStore = {
  version: 1;
  sessions: Record<string, string>;
};

export class MemoryStore {
  private readonly storeName = DATA_STORE.MEMORY_SESSIONS;

  constructor(_baseDir?: string) {
    registerStore(this.storeName, () => createDefaultMemoryStore());
  }

  read(sessionId: string): string {
    const store = this.readStore();
    const key = this.toSessionKey(sessionId);
    return store.sessions[key] ?? "";
  }

  append(sessionId: string, entry: string): void {
    const store = this.readStore();
    const key = this.toSessionKey(sessionId);
    const current = store.sessions[key] ?? "";
    store.sessions[key] = `${current}${entry}\n`;
    setStore(this.storeName, store);
  }

  private readStore(): MemorySessionsStore {
    const parsed = getStore<unknown>(this.storeName);
    return normalizeMemoryStore(parsed);
  }

  private toSessionKey(sessionId: string): string {
    return sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
  }
}

function createDefaultMemoryStore(): MemorySessionsStore {
  return {
    version: 1,
    sessions: {}
  };
}

function normalizeMemoryStore(input: unknown): MemorySessionsStore {
  if (!input || typeof input !== "object") {
    return createDefaultMemoryStore();
  }

  const source = input as { sessions?: unknown };
  const sessions = source.sessions && typeof source.sessions === "object"
    ? source.sessions as Record<string, unknown>
    : {};

  const normalized: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(sessions)) {
    const key = rawKey.replace(/[^a-zA-Z0-9_-]/g, "_");
    if (!key) {
      continue;
    }
    normalized[key] = typeof rawValue === "string" ? rawValue : String(rawValue ?? "");
  }

  return {
    version: 1,
    sessions: normalized
  };
}
