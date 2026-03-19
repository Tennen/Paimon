import { DEFAULT_TIMEOUT_MS } from "../defaults";
import { fetchJson } from "../utils";

export async function fetchOptionalNewsContext() {
  const staticNews = String(process.env.MARKET_ANALYSIS_NEWS_CONTEXT || "").trim();
  if (staticNews) {
    return { source: "env", content: staticNews };
  }

  const endpoint = String(process.env.MARKET_ANALYSIS_NEWS_API || "").trim();
  if (!endpoint) {
    return null;
  }

  try {
    const payload = await fetchJson(endpoint, DEFAULT_TIMEOUT_MS, undefined);
    return {
      source: endpoint,
      content: payload
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error || "unknown error");
    console.error(`[MarketAnalysis][equity][news] optional_context_failed endpoint=${endpoint} error=${detail}`);
    return {
      source: endpoint,
      error: detail
    };
  }
}
