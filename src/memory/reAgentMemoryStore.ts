import { DATA_STORE, getStore, registerStore, setStore } from "../storage/persistence";

type ReAgentMemorySessionsStore = {
  version: 1;
  sessions: Record<string, string>;
};

export class ReAgentMemoryStore {
  private readonly storeName = DATA_STORE.RE_AGENT_MEMORY_SESSIONS;

  constructor(_baseDir?: string) {
    registerStore(this.storeName, () => createDefaultReAgentMemoryStore());
  }

  read(sessionId: string): string {
    const store = this.readStore();
    const key = normalizeReAgentSessionKey(sessionId);
    return store.sessions[key] ?? "";
  }

  append(sessionId: string, entry: string): void {
    const store = this.readStore();
    const key = normalizeReAgentSessionKey(sessionId);
    const current = store.sessions[key] ?? "";
    store.sessions[key] = `${current}${entry}\n`;
    setStore(this.storeName, store);
  }

  clear(sessionId: string): void {
    const store = this.readStore();
    const key = normalizeReAgentSessionKey(sessionId);
    if (!(key in store.sessions)) {
      return;
    }
    delete store.sessions[key];
    setStore(this.storeName, store);
  }

  private readStore(): ReAgentMemorySessionsStore {
    const parsed = getStore<unknown>(this.storeName);
    return normalizeReAgentMemoryStore(parsed);
  }
}

export function normalizeReAgentSessionKey(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function createDefaultReAgentMemoryStore(): ReAgentMemorySessionsStore {
  return {
    version: 1,
    sessions: {}
  };
}

function normalizeReAgentMemoryStore(input: unknown): ReAgentMemorySessionsStore {
  if (!input || typeof input !== "object") {
    return createDefaultReAgentMemoryStore();
  }

  const source = input as { sessions?: unknown };
  const sessions = source.sessions && typeof source.sessions === "object"
    ? source.sessions as Record<string, unknown>
    : {};

  const normalized: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(sessions)) {
    const key = normalizeReAgentSessionKey(rawKey);
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
