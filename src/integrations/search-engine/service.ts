import { dedupStrings } from "./common";
import { executeQianfanSearch } from "./qianfan";
import { getSearchEngineProfile, resolveSearchEngineSelector } from "./store";
import { executeSerpApiSearch } from "./serpapi";
import type { SearchEngineProfile, SearchExecutionInput, SearchExecutionResult } from "./types";

export async function executeSearch(input: SearchExecutionInput): Promise<SearchExecutionResult> {
  const selectedSearchEngineId = resolveSearchEngineSelector(input.engineSelector);
  const selectedSearchEngine = getSearchEngineProfile(selectedSearchEngineId);
  const sourceChain: string[] = [];
  const errors: string[] = [];

  if (selectedSearchEngine) {
    sourceChain.push(`search_engine:${selectedSearchEngine.id}`);
  } else {
    sourceChain.push(`search_engine:missing:${selectedSearchEngineId}`);
    errors.push("search engine profile not found");
    return {
      items: [],
      source_chain: sourceChain,
      errors
    };
  }

  const engineResult = await executeSearchWithProfile(selectedSearchEngine, input);
  return {
    items: engineResult.items,
    source_chain: dedupStrings([...sourceChain, ...engineResult.source_chain]),
    errors: dedupStrings([...errors, ...engineResult.errors])
  };
}

async function executeSearchWithProfile(
  profile: SearchEngineProfile,
  input: SearchExecutionInput
): Promise<SearchExecutionResult> {
  if (!profile.enabled) {
    return {
      items: [],
      source_chain: [`search_engine:${profile.id}:disabled`, `search_provider:${profile.type}`],
      errors: []
    };
  }

  if (profile.type === "serpapi") {
    return executeSerpApiSearch({
      profile,
      timeoutMs: input.timeoutMs,
      maxItems: input.maxItems,
      plans: input.plans,
      logContext: input.logContext
    });
  }

  if (profile.type === "qianfan") {
    return executeQianfanSearch({
      profile,
      timeoutMs: input.timeoutMs,
      maxItems: input.maxItems,
      plans: input.plans,
      logContext: input.logContext
    });
  }

  const unsupportedType = String((profile as { type?: string }).type || "");
  return {
    items: [],
    source_chain: [`search_provider:${unsupportedType}`],
    errors: [`unsupported search engine type: ${unsupportedType}`]
  };
}
