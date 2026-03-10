import { DATA_STORE, getStore, registerStore, setStore } from "../storage/persistence";
import { SummaryMemoryRecord, normalizeSummaryMemorySessionKey } from "./summaryMemoryStore";

const DEFAULT_DIMENSION = 128;
const DEFAULT_TOP_K = 5;

type VectorStoreState = {
  version: 1;
  sessions: Record<string, SummaryVectorRecord[]>;
};

export type SummaryVectorRecord = {
  id: string;
  sessionId: string;
  text: string;
  rawRefs: string[];
  vector: number[];
  updatedAt: string;
};

export type SummaryVectorInput = {
  id?: string;
  sessionId: string;
  text?: string;
  user_facts?: unknown;
  environment?: unknown;
  long_term_preferences?: unknown;
  task_results?: unknown;
  rawRefs?: unknown;
  updatedAt?: string;
};

export type SummaryVectorHit = {
  id: string;
  sessionId: string;
  text: string;
  rawRefs: string[];
  score: number;
  updatedAt: string;
};

export class SummaryVectorIndex {
  private readonly storeName = DATA_STORE.MEMORY_SUMMARY_INDEX;
  private readonly dimension: number;

  constructor(options: { dimension?: number } = {}) {
    this.dimension = normalizeDimension(options.dimension);
    registerStore(this.storeName, () => ({ version: 1, sessions: {} }));
  }

  upsert(input: SummaryVectorInput): SummaryVectorRecord {
    const store = this.readStore();
    const key = toSessionKey(input.sessionId);
    const list = store.sessions[key] ?? [];
    const record = toRecord(input, key, this.dimension);
    const i = list.findIndex((item) => item.id === record.id);
    if (i >= 0) list[i] = record;
    else list.push(record);
    store.sessions[key] = list;
    setStore(this.storeName, store);
    return cloneRecord(record);
  }

  upsertFromSummary(summary: SummaryMemoryRecord): SummaryVectorRecord {
    return this.upsert({
      id: summary.id,
      sessionId: summary.sessionId,
      user_facts: summary.user_facts,
      environment: summary.environment,
      long_term_preferences: summary.long_term_preferences,
      task_results: summary.task_results,
      rawRefs: summary.rawRefs,
      updatedAt: summary.updatedAt
    });
  }

  clear(sessionId: string): void {
    const store = this.readStore();
    const key = toSessionKey(sessionId);
    if (!(key in store.sessions)) return;
    delete store.sessions[key];
    setStore(this.storeName, store);
  }

  search(sessionId: string, query: string, topK: number = DEFAULT_TOP_K): SummaryVectorHit[] {
    const limit = normalizeTopK(topK);
    const records = (this.readStore().sessions[toSessionKey(sessionId)] ?? []).map(cloneRecord);
    if (limit <= 0 || records.length === 0) return [];
    const normalizedQuery = normalizeSearchText(query);
    const queryTokens = tokenize(normalizedQuery);
    if (queryTokens.length === 0) {
      return records.sort(byRecent).slice(0, limit).map((item) => toHit(item, 0));
    }
    const queryVector = buildHashedVector(normalizedQuery, this.dimension);
    const queryTokenFreq = countTokens(queryTokens);
    const queryTokenSet = new Set(queryTokens);

    const docs = records.map((item) => {
      const normalizedText = normalizeSearchText(item.text);
      const tokens = tokenize(normalizedText);
      const tokenFreq = countTokens(tokens);
      return {
        item,
        normalizedText,
        tokenFreq,
        docLen: Math.max(1, tokens.length)
      };
    });

    const avgDocLen = Math.max(1, docs.reduce((sum, doc) => sum + doc.docLen, 0) / docs.length);
    const idf = buildInverseDocumentFrequency(docs.map((doc) => doc.tokenFreq), docs.length);

    const scored = docs.map((doc) => {
      const vectorScore = isZeroVector(queryVector) ? 0 : Math.max(0, cosineSimilarity(queryVector, doc.item.vector));
      const bm25 = bm25Score(queryTokenFreq, doc.tokenFreq, doc.docLen, avgDocLen, idf);
      const coverage = tokenCoverage(queryTokenSet, doc.tokenFreq);
      const exact = exactMatchScore(normalizedQuery, doc.normalizedText);
      return { doc, vectorScore, bm25, coverage, exact };
    });

    const maxBm25 = Math.max(...scored.map((item) => item.bm25), 0);
    const scoredById = new Map(scored.map((item) => [item.doc.item.id, item]));

    return records
      .map((item) => {
        const scoreItem = scoredById.get(item.id);
        if (!scoreItem) {
          return { item, score: 0 };
        }
        const bm25Norm = maxBm25 > 0 ? scoreItem.bm25 / maxBm25 : 0;
        const lexicalScore = 0.55 * bm25Norm + 0.25 * scoreItem.coverage + 0.2 * scoreItem.exact;
        const score = 0.6 * scoreItem.vectorScore + 0.4 * lexicalScore;
        return { item, score };
      })
      .sort((a, b) => (b.score !== a.score ? b.score - a.score : byRecent(a.item, b.item)))
      .slice(0, limit)
      .map(({ item, score }) => toHit(item, score));
  }

  private readStore(): VectorStoreState {
    return normalizeStore(getStore<unknown>(this.storeName), this.dimension);
  }
}

export function normalizeSummaryVectorSessionKey(sessionId: string): string {
  return normalizeSummaryMemorySessionKey(sessionId);
}

export function buildHashedVector(input: string, dimension: number = DEFAULT_DIMENSION): number[] {
  const size = normalizeDimension(dimension);
  const vector = new Array<number>(size).fill(0);
  for (const token of tokenize(input)) vector[fnv1a(token) % size] += 1;
  return normalizeVector(vector);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return normA === 0 || normB === 0 ? 0 : dot / Math.sqrt(normA * normB);
}

function normalizeStore(input: unknown, dimension: number): VectorStoreState {
  if (!isRecord(input) || !isRecord(input.sessions)) return { version: 1, sessions: {} };
  const sessions: Record<string, SummaryVectorRecord[]> = {};
  for (const [rawSessionKey, rawValue] of Object.entries(input.sessions)) {
    const key = toSessionKey(rawSessionKey);
    const seen = new Set<string>();
    const records: SummaryVectorRecord[] = [];
    for (const rawItem of Array.isArray(rawValue) ? rawValue : []) {
      if (!isRecord(rawItem)) continue;
      const id = text(rawItem.id) || makeId();
      if (seen.has(id)) continue;
      seen.add(id);
      const itemText = text(rawItem.text) || text(rawItem.content);
      records.push({
        id,
        sessionId: text(rawItem.sessionId) || key,
        text: itemText,
        rawRefs: toStringList(rawItem.rawRefs),
        vector: toVector(rawItem.vector, dimension) ?? buildHashedVector(itemText, dimension),
        updatedAt: text(rawItem.updatedAt) || new Date().toISOString()
      });
    }
    sessions[key] = records;
  }
  return { version: 1, sessions };
}

function toRecord(input: SummaryVectorInput, fallbackSessionId: string, dimension: number): SummaryVectorRecord {
  const summaryText = text(input.text) || [
    ...toStringList(input.user_facts),
    ...toStringList(input.environment),
    ...toStringList(input.long_term_preferences),
    ...toStringList(input.task_results)
  ].join("\n");
  return {
    id: text(input.id) || makeId(),
    sessionId: text(input.sessionId) || fallbackSessionId,
    text: summaryText,
    rawRefs: toStringList(input.rawRefs),
    vector: buildHashedVector(summaryText, dimension),
    updatedAt: text(input.updatedAt) || new Date().toISOString()
  };
}

function toHit(record: SummaryVectorRecord, score: number): SummaryVectorHit {
  return { id: record.id, sessionId: record.sessionId, text: record.text, rawRefs: [...record.rawRefs], score, updatedAt: record.updatedAt };
}

function cloneRecord(record: SummaryVectorRecord): SummaryVectorRecord {
  return { ...record, rawRefs: [...record.rawRefs], vector: [...record.vector] };
}

function byRecent(a: SummaryVectorRecord, b: SummaryVectorRecord): number {
  return a.updatedAt === b.updatedAt ? b.id.localeCompare(a.id) : b.updatedAt.localeCompare(a.updatedAt);
}

function toSessionKey(sessionId: string): string {
  const key = normalizeSummaryVectorSessionKey(sessionId);
  return key || "_";
}

function toVector(input: unknown, dimension: number): number[] | null {
  if (!Array.isArray(input) || input.length !== dimension) return null;
  const vector: number[] = [];
  for (const value of input) {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    vector.push(value);
  }
  return normalizeVector(vector);
}

function normalizeVector(vector: number[]): number[] {
  let norm = 0;
  for (const value of vector) norm += value * value;
  if (norm === 0) return vector;
  const length = Math.sqrt(norm);
  return vector.map((value) => value / length);
}

function countTokens(tokens: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const token of tokens) {
    freq.set(token, (freq.get(token) ?? 0) + 1);
  }
  return freq;
}

function buildInverseDocumentFrequency(
  docs: Array<Map<string, number>>,
  docCount: number
): Map<string, number> {
  const docFreq = new Map<string, number>();
  for (const doc of docs) {
    for (const token of doc.keys()) {
      docFreq.set(token, (docFreq.get(token) ?? 0) + 1);
    }
  }
  const idf = new Map<string, number>();
  for (const [token, df] of docFreq.entries()) {
    idf.set(token, Math.log(1 + (docCount - df + 0.5) / (df + 0.5)));
  }
  return idf;
}

function bm25Score(
  queryTokenFreq: Map<string, number>,
  docTokenFreq: Map<string, number>,
  docLen: number,
  avgDocLen: number,
  idf: Map<string, number>
): number {
  const k1 = 1.2;
  const b = 0.75;
  let score = 0;
  for (const [token, qtf] of queryTokenFreq.entries()) {
    const tf = docTokenFreq.get(token) ?? 0;
    if (tf <= 0) continue;
    const tokenIdf = idf.get(token) ?? 0;
    const denom = tf + k1 * (1 - b + b * (docLen / avgDocLen));
    score += tokenIdf * ((tf * (k1 + 1)) / denom) * Math.max(1, qtf);
  }
  return score;
}

function tokenCoverage(queryTokens: Set<string>, docTokenFreq: Map<string, number>): number {
  if (queryTokens.size === 0) return 0;
  let matched = 0;
  for (const token of queryTokens) {
    if ((docTokenFreq.get(token) ?? 0) > 0) {
      matched += 1;
    }
  }
  return matched / queryTokens.size;
}

function exactMatchScore(query: string, document: string): number {
  if (!query || !document) return 0;
  if (document === query) return 1;
  if (document.startsWith(query)) return 0.9;
  if (document.includes(query)) return 0.75;
  return 0;
}

function tokenize(input: string): string[] {
  return text(input).toLowerCase().match(/[a-z0-9]+|[\u4e00-\u9fff]/g) ?? [];
}

function normalizeSearchText(input: string): string {
  return text(input).toLowerCase().replace(/\s+/g, " ").trim();
}

function fnv1a(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function isZeroVector(vector: number[]): boolean {
  return vector.every((value) => value === 0);
}

function toStringList(input: unknown): string[] {
  const list = Array.isArray(input) ? input : [input];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const value = typeof item === "string" ? item.trim() : typeof item === "number" || typeof item === "boolean" ? String(item) : "";
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function normalizeDimension(input?: number): number {
  const value = typeof input === "number" ? Math.floor(input) : DEFAULT_DIMENSION;
  return Number.isFinite(value) && value >= 16 && value <= 4096 ? value : DEFAULT_DIMENSION;
}

function normalizeTopK(input: number): number {
  if (!Number.isFinite(input)) return DEFAULT_TOP_K;
  const value = Math.floor(input);
  return value <= 0 ? 0 : Math.min(value, 50);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function makeId(): string {
  return `summary_idx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return Boolean(input) && typeof input === "object" && !Array.isArray(input);
}
