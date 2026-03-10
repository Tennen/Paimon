import { RagRetriever, RagSearchHit, RagService } from "../../../integrations/rag/service";
import { SummaryVectorIndex } from "../../../memory/summaryVectorIndex";
import { ReAgentModule } from "../types";

export const RAG_MODULE_NAME = "rag";
export const RAG_MODULE_SEARCH_ACTION = "search";
const DEFAULT_SUMMARY_TOP_K = 4;

export function createRagModule(service: RagService = new RagService(createSummaryMemoryRetriever())): ReAgentModule {
  return {
    name: RAG_MODULE_NAME,
    description: "Search knowledge with RAG and return grounded snippets.",
    execute: async (action, params, context) => {
      if (action !== RAG_MODULE_SEARCH_ACTION) {
        return {
          ok: false,
          error: `Unsupported rag action: ${action || "unknown"}`
        };
      }

      const query = resolveQuery(params);
      if (!query) {
        return {
          ok: false,
          error: "Missing query"
        };
      }

      try {
        const output = await service.search(query, context.sessionId);
        return {
          ok: true,
          output
        };
      } catch (error) {
        return {
          ok: false,
          error: (error as Error).message
        };
      }
    }
  };
}

function resolveQuery(params: Record<string, unknown>): string {
  const raw =
    (typeof params.query === "string" ? params.query : "") ||
    (typeof params.input === "string" ? params.input : "");
  return raw.trim();
}

function createSummaryMemoryRetriever(
  index: SummaryVectorIndex = new SummaryVectorIndex(),
  topK: number = readPositiveInt(process.env.RE_AGENT_RAG_SUMMARY_TOP_K, DEFAULT_SUMMARY_TOP_K)
): RagRetriever {
  return {
    search: async (query: string, sessionId: string): Promise<RagSearchHit[]> => {
      const hits = index.search(sessionId, query, topK);
      return hits.map((item) => ({
        id: item.id,
        content: item.text,
        source: `memory-summary:${item.id}`,
        score: item.score,
        metadata: {
          rawRefs: item.rawRefs,
          updatedAt: item.updatedAt,
          memoryType: "summary"
        }
      }));
    }
  };
}

function readPositiveInt(raw: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
