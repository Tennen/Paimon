export type RagSearchHit = {
  id: string;
  content: string;
  source?: string;
  score?: number;
  metadata?: Record<string, unknown>;
};

export type RagSearchResponse = {
  query: string;
  sessionId: string;
  hits: RagSearchHit[];
  empty: boolean;
  note?: string;
};

export type RagRetriever = {
  search: (query: string, sessionId: string) => Promise<RagSearchHit[]>;
};

const EMPTY_RAG_NOTE = "当前知识库为空，暂无可检索内容。";
const EMPTY_RAG_FALLBACK_HIT: RagSearchHit = {
  id: "rag:empty",
  content: EMPTY_RAG_NOTE,
  source: "rag-empty-fallback",
  score: 0
};

export class RagService {
  constructor(private readonly retriever: RagRetriever | null = null) {}

  async search(query: string, sessionId: string): Promise<RagSearchResponse> {
    const normalizedQuery = String(query ?? "").trim();
    const normalizedSessionId = String(sessionId ?? "").trim();

    if (!normalizedQuery) {
      return {
        query: "",
        sessionId: normalizedSessionId,
        hits: [EMPTY_RAG_FALLBACK_HIT],
        empty: true,
        note: EMPTY_RAG_NOTE
      };
    }

    const rawHits = this.retriever
      ? await this.retriever.search(normalizedQuery, normalizedSessionId)
      : [];

    const hits = normalizeRagHits(rawHits);
    if (hits.length === 0) {
      return {
        query: normalizedQuery,
        sessionId: normalizedSessionId,
        hits: [EMPTY_RAG_FALLBACK_HIT],
        empty: true,
        note: EMPTY_RAG_NOTE
      };
    }

    return {
      query: normalizedQuery,
      sessionId: normalizedSessionId,
      hits,
      empty: false
    };
  }
}

function normalizeRagHits(input: RagSearchHit[]): RagSearchHit[] {
  return input
    .map((item, index) => {
      const content = String(item.content ?? "").trim();
      if (!content) {
        return null;
      }
      const id = String(item.id ?? "").trim() || `rag:${index + 1}`;
      const source = typeof item.source === "string" && item.source.trim()
        ? item.source.trim()
        : undefined;
      const score = typeof item.score === "number" && Number.isFinite(item.score)
        ? item.score
        : undefined;
      return {
        ...item,
        id,
        content,
        ...(source ? { source } : {}),
        ...(typeof score === "number" ? { score } : {})
      };
    })
    .filter((item): item is RagSearchHit => Boolean(item));
}
