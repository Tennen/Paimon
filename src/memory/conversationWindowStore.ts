import { DATA_STORE, getStore, registerStore, setStore } from "../storage/persistence";

export type ConversationSkillLease = {
  skillName: string;
  objective?: string;
  followupMode: "awaiting_user" | "continue_same_skill";
};

export type ConversationWindowTurn = {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

export type ConversationWindowRecord = {
  sessionId: string;
  windowId: string;
  startedAt: string;
  lastUserAt?: string;
  lastAssistantAt?: string;
  turns: ConversationWindowTurn[];
  activeSkill?: ConversationSkillLease;
};

type ConversationWindowStoreState = {
  version: 1;
  sessions: Record<string, ConversationWindowRecord>;
};

export class ConversationWindowStore {
  private readonly storeName = DATA_STORE.MEMORY_CONVERSATION_WINDOWS;

  constructor(_baseDir?: string) {
    registerStore(this.storeName, () => createDefaultStore());
  }

  read(sessionId: string): ConversationWindowRecord | null {
    const store = this.readStore();
    const key = normalizeConversationWindowSessionKey(sessionId);
    const record = store.sessions[key];
    return record ? cloneWindowRecord(record) : null;
  }

  write(record: ConversationWindowRecord): ConversationWindowRecord {
    const store = this.readStore();
    const key = normalizeConversationWindowSessionKey(record.sessionId);
    const normalized = normalizeWindowRecord(record, key);
    store.sessions[key] = normalized;
    setStore(this.storeName, store);
    return cloneWindowRecord(normalized);
  }

  clear(sessionId: string): void {
    const store = this.readStore();
    const key = normalizeConversationWindowSessionKey(sessionId);
    if (!(key in store.sessions)) {
      return;
    }
    delete store.sessions[key];
    setStore(this.storeName, store);
  }

  private readStore(): ConversationWindowStoreState {
    return normalizeStore(getStore<unknown>(this.storeName));
  }
}

export function normalizeConversationWindowSessionKey(sessionId: string): string {
  return String(sessionId ?? "").replace(/[^a-zA-Z0-9_-]/g, "_") || "_";
}

function createDefaultStore(): ConversationWindowStoreState {
  return {
    version: 1,
    sessions: {}
  };
}

function normalizeStore(input: unknown): ConversationWindowStoreState {
  if (!isRecord(input) || !isRecord(input.sessions)) {
    return createDefaultStore();
  }

  const sessions: Record<string, ConversationWindowRecord> = {};
  for (const [rawKey, rawValue] of Object.entries(input.sessions)) {
    const key = normalizeConversationWindowSessionKey(rawKey);
    if (!isRecord(rawValue)) {
      continue;
    }
    sessions[key] = normalizeWindowRecord(rawValue, key);
  }

  return {
    version: 1,
    sessions
  };
}

function normalizeWindowRecord(input: unknown, fallbackSessionId: string): ConversationWindowRecord {
  const source = isRecord(input) ? input : {};
  const sessionId = text(source.sessionId) || fallbackSessionId;
  const windowId = text(source.windowId) || createWindowId();
  const startedAt = text(source.startedAt) || new Date().toISOString();
  const turns = Array.isArray(source.turns)
    ? source.turns.map((item) => normalizeTurn(item)).filter((item): item is ConversationWindowTurn => Boolean(item))
    : [];
  const activeSkill = normalizeSkillLease(source.activeSkill);

  return {
    sessionId,
    windowId,
    startedAt,
    ...(text(source.lastUserAt) ? { lastUserAt: text(source.lastUserAt) } : {}),
    ...(text(source.lastAssistantAt) ? { lastAssistantAt: text(source.lastAssistantAt) } : {}),
    turns,
    ...(activeSkill ? { activeSkill } : {})
  };
}

function normalizeTurn(input: unknown): ConversationWindowTurn | null {
  if (!isRecord(input)) {
    return null;
  }
  const role = input.role === "assistant" ? "assistant" : input.role === "user" ? "user" : "";
  const content = text(input.content);
  if (!role || !content) {
    return null;
  }
  return {
    role,
    content,
    createdAt: text(input.createdAt) || new Date().toISOString()
  };
}

function normalizeSkillLease(input: unknown): ConversationSkillLease | undefined {
  if (!isRecord(input)) {
    return undefined;
  }
  const skillName = text(input.skillName);
  const objective = text(input.objective);
  const followupMode = input.followupMode === "awaiting_user" || input.followupMode === "continue_same_skill"
    ? input.followupMode
    : "";
  if (!skillName || !followupMode) {
    return undefined;
  }
  return {
    skillName,
    ...(objective ? { objective } : {}),
    followupMode
  };
}

function cloneWindowRecord(input: ConversationWindowRecord): ConversationWindowRecord {
  return {
    ...input,
    turns: input.turns.map((turn) => ({ ...turn })),
    ...(input.activeSkill ? { activeSkill: { ...input.activeSkill } } : {})
  };
}

function createWindowId(): string {
  return `win_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function text(input: unknown): string {
  return typeof input === "string" ? input.trim() : "";
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return Boolean(input) && typeof input === "object" && !Array.isArray(input);
}
