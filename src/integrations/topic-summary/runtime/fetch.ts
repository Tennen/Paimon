import { FEED_FETCH_TIMEOUT_MS } from "../defaults";
import type { FeedFetchResult, TopicSummarySource } from "../types";
import { parseFeedEntries } from "./parsing";

export async function fetchSource(source: TopicSummarySource, now: Date): Promise<FeedFetchResult> {
  const fetchedAt = now.toISOString();

  try {
    const xml = await fetchText(source.feedUrl, FEED_FETCH_TIMEOUT_MS);
    return {
      source,
      fetchedAt,
      entries: parseFeedEntries(xml)
    };
  } catch (error) {
    return {
      source,
      fetchedAt,
      entries: [],
      error: (error as Error).message ?? "fetch failed"
    };
  }
}

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "Paimon-TopicSummary/1.0",
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.6"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}
