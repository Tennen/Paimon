import {
  SENT_LOG_MAX_ITEMS,
  SENT_LOG_RETENTION_DAYS
} from "./defaults";
import { buildDigestSummary } from "./text";
import { refineSelectedItemsWithPlanningModel } from "./planning";
import {
  DigestRunResult,
  SelectedItem,
  TopicSummaryCategory,
  TopicSummaryConfig,
  TopicSummarySentLogItem,
  TopicSummaryState
} from "./types";
import { fetchSource } from "./runtime/fetch";
import {
  buildCandidates,
  deduplicateCandidates,
  getDefaultDigestType,
  selectCandidates
} from "./runtime/select";

export async function runDigest(
  config: TopicSummaryConfig,
  state: TopicSummaryState,
  now: Date,
  targetLanguage: string
): Promise<DigestRunResult> {
  const enabledSources = config.sources.filter((source) => source.enabled);
  if (enabledSources.length === 0) {
    throw new Error("No enabled RSS source, use /topic source add or enable first");
  }

  const fetchResults = await Promise.all(enabledSources.map((source) => fetchSource(source, now)));
  const rawItemCount = fetchResults.reduce((sum, item) => sum + item.entries.length, 0);

  const candidates = buildCandidates(fetchResults, config, now);
  const deduped = deduplicateCandidates(candidates, config.filters.dedup.titleSimilarityThreshold);
  const sentSet = new Set(state.sentLog.map((entry) => entry.urlNormalized));
  const unsent = deduped.filter((item) => !sentSet.has(item.urlNormalized));

  const selectedRaw: SelectedItem[] = selectCandidates(unsent, config.dailyQuota, config.filters.maxPerDomain)
    .map((item, index) => ({
      ...item,
      rank: index + 1,
      digestType: getDefaultDigestType(item.candidate),
      digestSummary: buildDigestSummary(item.candidate.summary)
    }));

  const selected = await refineSelectedItemsWithPlanningModel(selectedRaw, targetLanguage, config.summaryEngine);
  const selectedByCategory = {
    engineering: selected.filter((item) => item.candidate.category === "engineering").length,
    news: selected.filter((item) => item.candidate.category === "news").length,
    ecosystem: selected.filter((item) => item.candidate.category === "ecosystem").length
  } as Record<TopicSummaryCategory, number>;

  const fetchErrors = fetchResults
    .filter((item) => typeof item.error === "string")
    .map((item) => ({
      sourceId: item.source.id,
      sourceName: item.source.name,
      error: item.error ?? "unknown error"
    }));

  return {
    now: now.toISOString(),
    selected,
    selectedByCategory,
    fetchedSources: fetchResults.length - fetchErrors.length,
    totalSources: fetchResults.length,
    fetchErrors,
    rawItemCount,
    candidateCount: candidates.length,
    dedupedCount: deduped.length,
    unsentCount: unsent.length
  };
}

export function mergeSentLog(state: TopicSummaryState, selected: SelectedItem[], now: Date): TopicSummaryState {
  const cutoffMs = now.getTime() - SENT_LOG_RETENTION_DAYS * 24 * 3600 * 1000;
  const merged = new Map<string, TopicSummarySentLogItem>();

  for (const item of state.sentLog) {
    const sentMs = Date.parse(item.sentAt);
    if (!Number.isFinite(sentMs) || sentMs < cutoffMs || !item.urlNormalized) {
      continue;
    }
    merged.set(item.urlNormalized, item);
  }

  const nowIso = now.toISOString();
  for (const item of selected) {
    merged.set(item.candidate.urlNormalized, {
      urlNormalized: item.candidate.urlNormalized,
      sentAt: nowIso,
      title: item.candidate.title
    });
  }

  return {
    version: 1,
    sentLog: Array.from(merged.values())
      .sort((left, right) => Date.parse(right.sentAt) - Date.parse(left.sentAt))
      .slice(0, SENT_LOG_MAX_ITEMS),
    updatedAt: nowIso
  };
}
