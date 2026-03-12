import { RawMemoryRecord, RawMemoryStore } from "./rawMemoryStore";
import { SummaryVectorHit, SummaryVectorIndex } from "./summaryVectorIndex";

const DEFAULT_SUMMARY_TOP_K = 4;
const DEFAULT_RAW_REF_LIMIT = 8;
const DEFAULT_RAW_RECORD_LIMIT = 3;
const DEFAULT_SUMMARY_TEXT_LIMIT = 380;
const DEFAULT_RAW_TEXT_LIMIT = 260;

export type HybridMemoryServiceOptions = {
  rawStore?: RawMemoryStore;
  summaryVectorIndex?: SummaryVectorIndex;
  summaryTopK?: number;
  rawRefLimit?: number;
  rawRecordLimit?: number;
  summaryTextLimit?: number;
  rawTextLimit?: number;
};

export type HybridMemoryBuildResult = {
  memory: string;
  summaries: SummaryVectorHit[];
  rawRecords: RawMemoryRecord[];
};

export class HybridMemoryService {
  private readonly rawStore: RawMemoryStore;
  private readonly summaryVectorIndex: SummaryVectorIndex;
  private readonly summaryTopK: number;
  private readonly rawRefLimit: number;
  private readonly rawRecordLimit: number;
  private readonly summaryTextLimit: number;
  private readonly rawTextLimit: number;

  constructor(options: HybridMemoryServiceOptions = {}) {
    this.rawStore = options.rawStore ?? new RawMemoryStore();
    this.summaryVectorIndex = options.summaryVectorIndex ?? new SummaryVectorIndex();
    this.summaryTopK = readPositiveInt(options.summaryTopK, process.env.MEMORY_SUMMARY_TOP_K, DEFAULT_SUMMARY_TOP_K);
    this.rawRefLimit = readPositiveInt(options.rawRefLimit, process.env.MEMORY_RAW_REF_LIMIT, DEFAULT_RAW_REF_LIMIT);
    this.rawRecordLimit = readPositiveInt(options.rawRecordLimit, process.env.MEMORY_RAW_RECORD_LIMIT, DEFAULT_RAW_RECORD_LIMIT);
    this.summaryTextLimit = readPositiveInt(options.summaryTextLimit, undefined, DEFAULT_SUMMARY_TEXT_LIMIT);
    this.rawTextLimit = readPositiveInt(options.rawTextLimit, undefined, DEFAULT_RAW_TEXT_LIMIT);
  }

  build(sessionId: string, query: string): HybridMemoryBuildResult | null {
    const normalizedSessionId = text(sessionId);
    if (!normalizedSessionId) return null;
    const normalizedQuery = text(query);
    const summaries = this.summaryVectorIndex
      .search(normalizedSessionId, normalizedQuery, this.summaryTopK)
      .slice(0, this.summaryTopK);
    if (summaries.length === 0) return null;

    const rawRefIds = unique(summaries.flatMap((item) => item.rawRefs)).slice(0, this.rawRefLimit);
    const rawRecords = this.readRawRecords(normalizedSessionId, rawRefIds).slice(0, this.rawRecordLimit);

    return {
      memory: formatHybridMemory(normalizedQuery, summaries, rawRecords, this.summaryTextLimit, this.rawTextLimit),
      summaries,
      rawRecords
    };
  }

  private readRawRecords(sessionId: string, ids: string[]): RawMemoryRecord[] {
    if (ids.length === 0) return [];
    const store = this.rawStore as unknown as {
      getByIds?: (rawIds: string[], targetSessionId?: string) => RawMemoryRecord[];
    };
    if (typeof store.getByIds !== "function") return [];
    return store.getByIds(ids, sessionId);
  }
}

function formatHybridMemory(
  query: string,
  summaries: SummaryVectorHit[],
  rawRecords: RawMemoryRecord[],
  summaryTextLimit: number,
  rawTextLimit: number
): string {
  const lines: string[] = [
    "[hybrid_memory]",
    `query: ${clip(oneLine(query), summaryTextLimit) || "(empty)"}`,
    "summary_hits:"
  ];

  for (let i = 0; i < summaries.length; i += 1) {
    const item = summaries[i];
    lines.push(`- #${i + 1} id=${item.id} score=${item.score.toFixed(3)} updated_at=${item.updatedAt}`);
    lines.push(`  summary: ${clip(oneLine(item.text), summaryTextLimit)}`);
  }

  lines.push("raw_replay:");
  if (rawRecords.length === 0) {
    lines.push("- none");
  } else {
    for (let i = 0; i < rawRecords.length; i += 1) {
      const item = rawRecords[i];
      lines.push(`- #${i + 1} id=${item.id} request=${item.requestId} source=${item.source} created_at=${item.createdAt}`);
      lines.push(`  user: ${clip(oneLine(item.user), rawTextLimit)}`);
      lines.push(`  assistant: ${clip(oneLine(item.assistant), rawTextLimit)}`);
    }
  }

  return lines.join("\n");
}

function readPositiveInt(raw: unknown, envRaw: unknown, fallback: number): number {
  for (const value of [raw, envRaw]) {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return fallback;
}

function unique(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const value = text(raw);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function oneLine(input: string): string {
  return text(input).replace(/\s+/g, " ");
}

function clip(input: string, max: number): string {
  return input.length <= max ? input : `${input.slice(0, Math.max(0, max - 3))}...`;
}

function text(input: unknown): string {
  return typeof input === "string" ? input.trim() : "";
}
