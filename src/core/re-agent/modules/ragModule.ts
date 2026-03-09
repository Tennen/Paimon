import { RagService } from "../../../integrations/rag/service";
import { ReAgentModule } from "../types";

export const RAG_MODULE_NAME = "rag";
export const RAG_MODULE_SEARCH_ACTION = "search";

export function createRagModule(service: RagService = new RagService()): ReAgentModule {
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
