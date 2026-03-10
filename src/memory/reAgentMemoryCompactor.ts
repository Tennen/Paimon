import { ReAgentRawMemoryRecord, ReAgentRawMemoryStore } from "./reAgentRawMemoryStore";
import { ReAgentSummaryMemoryStore, normalizeReAgentSummaryMemorySessionKey } from "./reAgentSummaryMemoryStore";
import { ReAgentSummaryVectorIndex } from "./reAgentSummaryVectorIndex";
const DEFAULT_COMPACT_EVERY_ROUNDS = 4;
const DEFAULT_MAX_BATCH_SIZE = 8;
const DEFAULT_FORCE_TRIGGER_META_KEYS = ["scheduler_task_id"];
export type ReAgentMemoryCompactorOptions = {
  rawStore?: ReAgentRawMemoryStore;
  summaryStore?: ReAgentSummaryMemoryStore;
  summaryVectorIndex?: ReAgentSummaryVectorIndex;
  llm?: ReAgentMemoryCompactorLlm;
  compactEveryRounds?: number;
  maxBatchSize?: number;
  forceTriggerMetaKeys?: string[];
  now?: () => string;
};

export type ReAgentMemoryCompactorInput = {
  sessionId: string;
  force?: boolean;
  requestId?: string;
  source?: string;
  meta?: Record<string, unknown>;
};

export type ReAgentMemoryCompactionReason = "compacted" | "threshold_not_met" | "no_pending_raw" | "invalid_session";

export type ReAgentMemoryCompactionResult = {
  sessionId: string;
  compacted: boolean;
  forced: boolean;
  reason: ReAgentMemoryCompactionReason;
  pendingCount: number;
  batchCount: number;
  rawIds: string[];
  summaryId?: string;
  usedFallback: boolean;
};

export type ReAgentMemoryCompactorLlmInput = {
  sessionId: string;
  requestId?: string;
  source?: string;
  prompt: string;
  rawBatch: ReAgentRawMemoryRecord[];
};

export type ReAgentMemoryCompactorLlm = (input: ReAgentMemoryCompactorLlmInput) => Promise<string>;

type StructuredSummary = {
  user_facts: string[];
  environment: string[];
  long_term_preferences: string[];
  task_results: string[];
  rawRefs: string[];
};

export class ReAgentMemoryCompactor {
  private readonly rawStore: ReAgentRawMemoryStore;
  private readonly summaryStore: ReAgentSummaryMemoryStore;
  private readonly summaryVectorIndex: ReAgentSummaryVectorIndex;
  private readonly llm?: ReAgentMemoryCompactorLlm;
  private readonly compactEveryRounds: number;
  private readonly maxBatchSize: number;
  private readonly forceTriggerMetaKeys: string[];
  private readonly now: () => string;

  constructor(options: ReAgentMemoryCompactorOptions = {}) {
    this.rawStore = options.rawStore ?? new ReAgentRawMemoryStore();
    this.summaryStore = options.summaryStore ?? new ReAgentSummaryMemoryStore();
    this.summaryVectorIndex = options.summaryVectorIndex ?? new ReAgentSummaryVectorIndex();
    this.llm = options.llm;
    this.compactEveryRounds = readPositiveInt(options.compactEveryRounds, process.env.RE_AGENT_MEMORY_COMPACT_EVERY_ROUNDS, DEFAULT_COMPACT_EVERY_ROUNDS);
    this.maxBatchSize = Math.max(this.compactEveryRounds, readPositiveInt(options.maxBatchSize, process.env.RE_AGENT_MEMORY_COMPACT_MAX_BATCH_SIZE, DEFAULT_MAX_BATCH_SIZE));
    this.forceTriggerMetaKeys = normalizeKeys(options.forceTriggerMetaKeys ?? DEFAULT_FORCE_TRIGGER_META_KEYS);
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async maybeCompact(input: ReAgentMemoryCompactorInput): Promise<ReAgentMemoryCompactionResult> {
    const sessionId = text(input.sessionId);
    if (!sessionId) return result("", false, false, "invalid_session", 0, 0, [], false);
    const pending = this.rawStore.listUnsummarized(sessionId);
    const forced = Boolean(input.force) || hasForceMeta(input.meta, this.forceTriggerMetaKeys);
    if (pending.length === 0) return result(sessionId, false, forced, "no_pending_raw", 0, 0, [], false);
    if (!forced && pending.length < this.compactEveryRounds) {
      return result(sessionId, false, false, "threshold_not_met", pending.length, 0, [], false);
    }

    const batch = forced ? pending : pending.slice(0, this.maxBatchSize);
    const rawIds = unique(batch.map((item) => item.id));
    if (rawIds.length === 0) return result(sessionId, false, forced, "no_pending_raw", pending.length, 0, [], false);

    const summaryId = createBatchSummaryId(sessionId, rawIds);
    const built = await this.buildSummary(sessionId, batch, input);
    const now = this.now();
    const summary = this.summaryStore.upsert({
      id: summaryId,
      sessionId,
      user_facts: built.summary.user_facts,
      environment: built.summary.environment,
      long_term_preferences: built.summary.long_term_preferences,
      task_results: built.summary.task_results,
      rawRefs: unique([...built.summary.rawRefs, ...rawIds]),
      createdAt: batch[0]?.createdAt || now,
      updatedAt: now
    });

    this.summaryVectorIndex.upsertFromSummary(summary);
    this.rawStore.markSummarized(sessionId, rawIds, now);
    return { ...result(sessionId, true, forced, "compacted", pending.length, rawIds.length, rawIds, built.usedFallback), summaryId: summary.id };
  }

  async compactNow(input: Omit<ReAgentMemoryCompactorInput, "force">): Promise<ReAgentMemoryCompactionResult> {
    return this.maybeCompact({ ...input, force: true });
  }

  private async buildSummary(
    sessionId: string,
    batch: ReAgentRawMemoryRecord[],
    input: ReAgentMemoryCompactorInput
  ): Promise<{ summary: StructuredSummary; usedFallback: boolean }> {
    if (!this.llm) return { summary: fallbackSummary(batch), usedFallback: true };
    try {
      const raw = await this.llm({
        sessionId,
        requestId: text(input.requestId) || undefined,
        source: text(input.source) || undefined,
        prompt: buildPrompt(sessionId, batch),
        rawBatch: batch.map(cloneRawRecord)
      });
      const parsed = parseSummary(raw);
      if (parsed && hasPayload(parsed)) return { summary: parsed, usedFallback: false };
    } catch {
      // fallback below
    }
    return { summary: fallbackSummary(batch), usedFallback: true };
  }
}

function result(
  sessionId: string,
  compacted: boolean,
  forced: boolean,
  reason: ReAgentMemoryCompactionReason,
  pendingCount: number,
  batchCount: number,
  rawIds: string[],
  usedFallback: boolean
): ReAgentMemoryCompactionResult {
  return { sessionId, compacted, forced, reason, pendingCount, batchCount, rawIds, usedFallback };
}

function buildPrompt(sessionId: string, batch: ReAgentRawMemoryRecord[]): string {
  return [
    "Compress memory into JSON only:",
    "{\"user_facts\":string[],\"environment\":string[],\"long_term_preferences\":string[],\"task_results\":string[],\"rawRefs\":string[]}",
    "Keep concise, unique, high-density facts. rawRefs must use raw IDs.",
    `sessionId=${sessionId}`,
    JSON.stringify(batch.map((item) => ({
      id: item.id,
      requestId: item.requestId,
      source: item.source,
      user: item.user,
      assistant: item.assistant,
      meta: item.meta,
      createdAt: item.createdAt
    })), null, 2)
  ].join("\n");
}

function parseSummary(raw: string): StructuredSummary | null {
  const payload = parseJsonObj(unfence(text(raw))) ?? parseJsonObj(extractJson(text(raw)) ?? "");
  if (!payload) return null;
  const summary: StructuredSummary = {
    user_facts: toList(pick(payload, ["user_facts", "userFacts", "facts"])),
    environment: toList(pick(payload, ["environment", "env"])),
    long_term_preferences: toList(pick(payload, ["long_term_preferences", "longTermPreferences", "preferences"])),
    task_results: toList(pick(payload, ["task_results", "taskResults", "results"])),
    rawRefs: toList(pick(payload, ["rawRefs", "raw_refs", "raw_ids", "rawIds"]))
  };
  return hasPayload(summary) ? summary : null;
}

function fallbackSummary(batch: ReAgentRawMemoryRecord[]): StructuredSummary {
  const environment = unique(batch.flatMap((item) => {
    const taskId = typeof item.meta.scheduler_task_id === "string" ? text(item.meta.scheduler_task_id) : "";
    return [item.source ? `source=${item.source}` : "", taskId ? `scheduler_task_id=${taskId}` : ""];
  }));
  return {
    user_facts: [],
    environment,
    long_term_preferences: [],
    task_results: batch.map((item) => `[${item.id}] user=\"${clip(oneLine(item.user), 120)}\" assistant=\"${clip(oneLine(item.assistant), 160)}\"`),
    rawRefs: unique(batch.map((item) => item.id))
  };
}

function cloneRawRecord(item: ReAgentRawMemoryRecord): ReAgentRawMemoryRecord {
  return { ...item, meta: { ...item.meta }, ...(item.summarizedAt ? { summarizedAt: item.summarizedAt } : {}) };
}

function createBatchSummaryId(sessionId: string, rawIds: string[]): string {
  return `summary_batch_${fnv1a(`${normalizeReAgentSummaryMemorySessionKey(sessionId) || "_"}|${rawIds.join("|")}`).toString(16).padStart(8, "0")}`;
}

function pick(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) if (key in record) return record[key];
  return undefined;
}

function parseJsonObj(input: string): Record<string, unknown> | null {
  if (!input) return null;
  try {
    const parsed = JSON.parse(input);
    if (isRecord(parsed)) return parsed;
    if (Array.isArray(parsed)) return (parsed.find((item) => isRecord(item)) as Record<string, unknown> | undefined) ?? null;
  } catch {
    return null;
  }
  return null;
}

function hasForceMeta(meta: Record<string, unknown> | undefined, keys: string[]): boolean {
  if (!meta) return false;
  for (const key of keys) {
    const value = meta[key];
    if ((typeof value === "string" && value.trim()) || typeof value === "number" || typeof value === "boolean") return true;
  }
  return false;
}

function hasPayload(summary: StructuredSummary): boolean {
  return summary.user_facts.length > 0 || summary.environment.length > 0 || summary.long_term_preferences.length > 0 || summary.task_results.length > 0;
}

function toList(input: unknown): string[] {
  const source = Array.isArray(input) ? input : [input];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of source) {
    const value = typeof item === "string" ? item.trim() : typeof item === "number" || typeof item === "boolean" ? String(item) : "";
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function unique(values: string[]): string[] {
  return toList(values);
}

function oneLine(input: string): string {
  return text(input).replace(/\s+/g, " ");
}

function clip(input: string, max: number): string {
  return input.length <= max ? input : `${input.slice(0, Math.max(0, max - 3))}...`;
}

function unfence(input: string): string {
  const m = input.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return m ? m[1].trim() : input;
}

function extractJson(input: string): string | null {
  const start = input.indexOf("{");
  const end = input.lastIndexOf("}");
  return start >= 0 && end > start ? input.slice(start, end + 1) : null;
}

function normalizeKeys(keys: string[]): string[] {
  const normalized = unique(keys.map((key) => text(key)));
  return normalized.length > 0 ? normalized : [...DEFAULT_FORCE_TRIGGER_META_KEYS];
}

function text(input: unknown): string {
  return typeof input === "string" ? input.trim() : "";
}

function readPositiveInt(raw: unknown, envRaw: unknown, fallback: number): number {
  for (const value of [raw, envRaw]) {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return fallback;
}

function fnv1a(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return Boolean(input) && typeof input === "object" && !Array.isArray(input);
}
