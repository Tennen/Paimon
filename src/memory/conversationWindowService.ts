import { LLMChatMessage } from "../engines/llm/llm";
import {
  ConversationSkillLease,
  ConversationWindowRecord,
  ConversationWindowStore
} from "./conversationWindowStore";

const DEFAULT_WINDOW_TIMEOUT_SECONDS = 180;
const DEFAULT_WINDOW_MAX_TURNS = 6;

export type ConversationWindowSnapshot = {
  windowId: string;
  sessionId: string;
  startedAt: string;
  lastAssistantAt?: string;
  messages: LLMChatMessage[];
  activeSkill?: ConversationSkillLease;
};

export type ConversationWindowCompleteTurnInput = {
  sessionId: string;
  userText: string;
  assistantText: string;
  userAt: string;
  assistantAt: string;
  activeSkill?: ConversationSkillLease;
};

export type ConversationWindowServiceOptions = {
  store?: ConversationWindowStore;
  timeoutSeconds?: number;
  maxTurns?: number;
};

export class ConversationWindowService {
  private readonly store: ConversationWindowStore;
  private readonly timeoutMs: number;
  private readonly maxTurns: number;

  constructor(options: ConversationWindowServiceOptions = {}) {
    this.store = options.store ?? new ConversationWindowStore();
    this.timeoutMs = readPositiveInt(options.timeoutSeconds, process.env.CONVERSATION_WINDOW_TIMEOUT_SECONDS, DEFAULT_WINDOW_TIMEOUT_SECONDS) * 1000;
    this.maxTurns = readPositiveInt(options.maxTurns, process.env.CONVERSATION_WINDOW_MAX_TURNS, DEFAULT_WINDOW_MAX_TURNS);
  }

  readActive(sessionId: string, at: string = new Date().toISOString()): ConversationWindowSnapshot | null {
    const record = this.store.read(sessionId);
    if (!record) {
      return null;
    }
    if (isExpired(record, at, this.timeoutMs)) {
      return null;
    }
    return toSnapshot(record);
  }

  completeTurn(input: ConversationWindowCompleteTurnInput): ConversationWindowSnapshot {
    const active = this.readActiveRecord(input.sessionId, input.userAt);
    const nextTurns = trimTurns(
      [
        ...(active?.turns.map((turn) => ({ ...turn })) ?? []),
        { role: "user" as const, content: input.userText, createdAt: input.userAt },
        { role: "assistant" as const, content: input.assistantText, createdAt: input.assistantAt }
      ],
      this.maxTurns
    );

    const record: ConversationWindowRecord = {
      sessionId: input.sessionId,
      windowId: active?.windowId ?? createWindowId(),
      startedAt: active?.startedAt ?? input.userAt,
      lastUserAt: input.userAt,
      lastAssistantAt: input.assistantAt,
      turns: nextTurns,
      ...(input.activeSkill ? { activeSkill: { ...input.activeSkill } } : {})
    };

    return toSnapshot(this.store.write(record));
  }

  clear(sessionId: string): void {
    this.store.clear(sessionId);
  }

  private readActiveRecord(sessionId: string, at: string): ConversationWindowRecord | null {
    const record = this.store.read(sessionId);
    if (!record || isExpired(record, at, this.timeoutMs)) {
      return null;
    }
    return record;
  }
}

function toSnapshot(record: ConversationWindowRecord): ConversationWindowSnapshot {
  return {
    windowId: record.windowId,
    sessionId: record.sessionId,
    startedAt: record.startedAt,
    ...(record.lastAssistantAt ? { lastAssistantAt: record.lastAssistantAt } : {}),
    messages: record.turns.map((turn) => ({
      role: turn.role,
      content: turn.content
    })),
    ...(record.activeSkill ? { activeSkill: { ...record.activeSkill } } : {})
  };
}

function trimTurns(
  turns: Array<{ role: "user" | "assistant"; content: string; createdAt: string }>,
  maxTurns: number
): Array<{ role: "user" | "assistant"; content: string; createdAt: string }> {
  const maxMessages = Math.max(1, maxTurns) * 2;
  return turns.slice(-maxMessages);
}

function isExpired(record: ConversationWindowRecord, at: string, timeoutMs: number): boolean {
  if (!record.lastAssistantAt) {
    return true;
  }
  const anchor = Date.parse(record.lastAssistantAt);
  const current = Date.parse(at);
  if (!Number.isFinite(anchor) || !Number.isFinite(current)) {
    return false;
  }
  return current - anchor > timeoutMs;
}

function readPositiveInt(raw: unknown, envRaw: unknown, fallback: number): number {
  for (const value of [raw, envRaw]) {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return fallback;
}

function createWindowId(): string {
  return `win_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
