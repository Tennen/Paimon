import { XMLParser } from "fast-xml-parser";
import {
  DEFAULT_CONFIG,
  ENGINEERING_SIGNAL_KEYWORDS,
  FEED_FETCH_TIMEOUT_MS,
  SENT_LOG_MAX_ITEMS,
  SENT_LOG_RETENTION_DAYS,
  TOPIC_KEYS
} from "./defaults";
import {
  buildStableHash,
  clampWeight,
  extractDomain,
  normalizeQuotaNumber,
  normalizeText,
  normalizeUrl,
  parseDateToIso,
  toArray,
  asRecord
} from "./shared";
import {
  buildDigestSummary,
  detectLang,
  normalizeSummary,
  normalizeTitle,
  titleSimilarity,
  toText
} from "./text";
import { refineSelectedItemsWithPlanningModel } from "./planning";
import {
  Candidate,
  DigestRunResult,
  FeedEntry,
  FeedFetchResult,
  SelectedItem,
  TopicKey,
  TopicPushCategory,
  TopicPushConfig,
  TopicPushDailyQuota,
  TopicPushSentLogItem,
  TopicPushState,
  TopicPushSource
} from "./types";

export async function runDigest(
  config: TopicPushConfig,
  state: TopicPushState,
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
  } as Record<TopicPushCategory, number>;

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

export function mergeSentLog(state: TopicPushState, selected: SelectedItem[], now: Date): TopicPushState {
  const cutoffMs = now.getTime() - SENT_LOG_RETENTION_DAYS * 24 * 3600 * 1000;
  const merged = new Map<string, TopicPushSentLogItem>();

  for (const item of state.sentLog) {
    const sentMs = Date.parse(item.sentAt);
    if (!Number.isFinite(sentMs) || sentMs < cutoffMs) {
      continue;
    }
    if (!item.urlNormalized) {
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

  const sentLog = Array.from(merged.values())
    .sort((left, right) => Date.parse(right.sentAt) - Date.parse(left.sentAt))
    .slice(0, SENT_LOG_MAX_ITEMS);

  return {
    version: 1,
    sentLog,
    updatedAt: nowIso
  };
}

async function fetchSource(source: TopicPushSource, now: Date): Promise<FeedFetchResult> {
  const fetchedAt = now.toISOString();

  try {
    const xml = await fetchText(source.feedUrl, FEED_FETCH_TIMEOUT_MS);
    const entries = parseFeedEntries(xml);
    return {
      source,
      fetchedAt,
      entries
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
        "User-Agent": "Paimon-TopicPush/1.0",
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

function parseFeedEntries(xml: string): FeedEntry[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseTagValue: false,
    trimValues: true,
    processEntities: true
  });

  let parsed: unknown;
  try {
    parsed = parser.parse(xml);
  } catch {
    return [];
  }

  const root = asRecord(parsed);
  if (!root) {
    return [];
  }

  if (root.rss && asRecord(root.rss)) {
    return parseRssLikeItems(asRecord(root.rss)!);
  }
  if (root.feed && asRecord(root.feed)) {
    return parseAtomEntries(asRecord(root.feed)!);
  }
  if (root["rdf:RDF"] && asRecord(root["rdf:RDF"])) {
    return parseRssRdfEntries(asRecord(root["rdf:RDF"])!);
  }
  if (root.channel && asRecord(root.channel)) {
    return parseRssLikeItems({ channel: root.channel });
  }

  return [];
}

function parseRssLikeItems(rssRoot: Record<string, unknown>): FeedEntry[] {
  const channel = asRecord(rssRoot.channel) ?? rssRoot;
  const items = toArray(channel.item)
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));

  return items.map((item) => ({
    title: normalizeText(toText(item.title)),
    link: extractLink(item.link),
    publishedAtRaw: normalizeText(toText(item.pubDate ?? item.published ?? item.updated)),
    summary: normalizeText(toText(item.description ?? item.summary ?? item["content:encoded"] ?? item.content))
  }));
}

function parseAtomEntries(feed: Record<string, unknown>): FeedEntry[] {
  const entries = toArray(feed.entry)
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));

  return entries.map((item) => ({
    title: normalizeText(toText(item.title)),
    link: extractAtomLink(item.link),
    publishedAtRaw: normalizeText(toText(item.published ?? item.updated)),
    summary: normalizeText(toText(item.summary ?? item.content ?? item["content:encoded"]))
  }));
}

function parseRssRdfEntries(rdf: Record<string, unknown>): FeedEntry[] {
  const items = toArray(rdf.item)
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));

  return items.map((item) => ({
    title: normalizeText(toText(item.title)),
    link: extractLink(item.link),
    publishedAtRaw: normalizeText(toText(item["dc:date"] ?? item.pubDate ?? item.published)),
    summary: normalizeText(toText(item.description ?? item.summary ?? item["content:encoded"] ?? item.content))
  }));
}

function buildCandidates(fetchResults: FeedFetchResult[], config: TopicPushConfig, now: Date): Candidate[] {
  const out: Candidate[] = [];
  const cutoffMs = now.getTime() - config.filters.timeWindowHours * 3600 * 1000;
  const blockedDomains = config.filters.blockedDomains.map((item) => item.toLowerCase());
  const blockedTitleKeywords = config.filters.blockedKeywordsInTitle.map((item) => item.toLowerCase());

  for (const result of fetchResults) {
    for (const entry of result.entries) {
      const title = normalizeTitle(entry.title);
      if (!title || title.length < config.filters.minTitleLength) {
        continue;
      }

      const rawUrl = normalizeText(entry.link);
      if (!rawUrl) {
        continue;
      }

      const urlNormalized = config.filters.dedup.urlNormalization
        ? normalizeUrl(rawUrl)
        : rawUrl;
      if (!urlNormalized) {
        continue;
      }

      const domain = extractDomain(urlNormalized);
      if (domain && isDomainBlocked(domain, blockedDomains)) {
        continue;
      }

      const titleLower = title.toLowerCase();
      if (blockedTitleKeywords.some((keyword) => keyword && titleLower.includes(keyword))) {
        continue;
      }

      const publishedAt = parseDateToIso(entry.publishedAtRaw);
      if (publishedAt) {
        const publishedMs = Date.parse(publishedAt);
        if (Number.isFinite(publishedMs) && publishedMs < cutoffMs) {
          continue;
        }
      }

      const summary = normalizeSummary(entry.summary);
      const topicTags = detectTopicTags(title, summary, config.topics);
      const lang = detectLang(`${title} ${summary}`);
      const score = scoreCandidate({
        title,
        summary,
        topicTags,
        publishedAt,
        lang,
        sourceWeight: result.source.weight,
        now
      });

      out.push({
        id: buildStableHash(urlNormalized),
        title,
        url: rawUrl,
        urlNormalized,
        sourceId: result.source.id,
        sourceName: result.source.name,
        category: result.source.category,
        publishedAt,
        fetchedAt: result.fetchedAt,
        summary,
        lang,
        topicTags,
        score,
        domain
      });
    }
  }

  return out;
}

function deduplicateCandidates(candidates: Candidate[], titleThreshold: number): Candidate[] {
  const dedupByUrl = new Map<string, Candidate>();

  for (const item of candidates) {
    const existing = dedupByUrl.get(item.urlNormalized);
    if (!existing || isBetterCandidate(item, existing)) {
      dedupByUrl.set(item.urlNormalized, item);
    }
  }

  const dedupedByUrl = Array.from(dedupByUrl.values())
    .sort((left, right) => right.score - left.score);

  const kept: Candidate[] = [];
  for (const item of dedupedByUrl) {
    const duplicated = kept.some((existing) => titleSimilarity(existing.title, item.title) >= titleThreshold);
    if (!duplicated) {
      kept.push(item);
    }
  }

  return kept;
}

function selectCandidates(candidates: Candidate[], quota: TopicPushDailyQuota, maxPerDomain: number): SelectedItem[] {
  const maxDomain = maxPerDomain <= 0 ? Number.POSITIVE_INFINITY : maxPerDomain;
  const sorted = candidates.slice().sort((left, right) => right.score - left.score);

  const buckets: Record<TopicPushCategory, Candidate[]> = {
    engineering: sorted.filter((item) => item.category === "engineering"),
    news: sorted.filter((item) => item.category === "news"),
    ecosystem: sorted.filter((item) => item.category === "ecosystem")
  };

  const used = new Set<string>();
  const domainCounter = new Map<string, number>();
  const selected: Array<Omit<SelectedItem, "rank" | "digestType" | "digestSummary">> = [];

  pickFromBucket(
    buckets.engineering,
    normalizeQuotaNumber(quota.engineering, DEFAULT_CONFIG.dailyQuota.engineering),
    false,
    selected,
    used,
    domainCounter,
    maxDomain
  );
  pickFromBucket(
    buckets.news,
    normalizeQuotaNumber(quota.news, DEFAULT_CONFIG.dailyQuota.news),
    false,
    selected,
    used,
    domainCounter,
    maxDomain
  );
  pickFromBucket(
    buckets.ecosystem,
    normalizeQuotaNumber(quota.ecosystem, DEFAULT_CONFIG.dailyQuota.ecosystem),
    false,
    selected,
    used,
    domainCounter,
    maxDomain
  );

  const total = normalizeQuotaNumber(quota.total, DEFAULT_CONFIG.dailyQuota.total);
  let needed = Math.max(0, total - selected.length);

  if (needed > 0) {
    const fallbackOrder: TopicPushCategory[] = ["engineering", "ecosystem", "news"];
    for (const category of fallbackOrder) {
      if (needed <= 0) break;
      const before = selected.length;
      pickFromBucket(buckets[category], needed, true, selected, used, domainCounter, maxDomain);
      needed -= selected.length - before;
    }
  }

  if (needed > 0) {
    const before = selected.length;
    pickFromBucket(sorted, needed, true, selected, used, domainCounter, maxDomain);
    needed -= selected.length - before;
  }

  return selected
    .slice(0, total)
    .sort((left, right) => right.candidate.score - left.candidate.score)
    .map((item) => ({
      ...item,
      rank: 0,
      digestType: getDefaultDigestType(item.candidate),
      digestSummary: ""
    }));
}

function pickFromBucket(
  bucket: Candidate[],
  count: number,
  fallbackFill: boolean,
  selected: Array<Omit<SelectedItem, "rank" | "digestType" | "digestSummary">>,
  used: Set<string>,
  domainCounter: Map<string, number>,
  maxPerDomain: number
): void {
  if (count <= 0) {
    return;
  }

  let picked = 0;
  for (const item of bucket) {
    if (picked >= count) {
      return;
    }
    if (used.has(item.id)) {
      continue;
    }

    const domain = item.domain;
    if (domain) {
      const usedCount = domainCounter.get(domain) ?? 0;
      if (usedCount >= maxPerDomain) {
        continue;
      }
      domainCounter.set(domain, usedCount + 1);
    }

    used.add(item.id);
    selected.push({
      candidate: item,
      fallbackFill
    });
    picked += 1;
  }
}

function detectTopicTags(
  title: string,
  summary: string,
  topics: Record<TopicKey, string[]>
): TopicKey[] {
  const haystack = `${title}\n${summary}`.toLowerCase();
  const tags: TopicKey[] = [];

  for (const key of TOPIC_KEYS) {
    const keywords = topics[key] ?? [];
    if (keywords.some((keyword) => keyword && haystack.includes(keyword.toLowerCase()))) {
      tags.push(key);
    }
  }

  return tags;
}

function scoreCandidate(input: {
  title: string;
  summary: string;
  topicTags: TopicKey[];
  publishedAt: string | null;
  lang: "zh" | "en" | "unknown";
  sourceWeight: number;
  now: Date;
}): number {
  let base = 1.0;

  if (input.publishedAt) {
    const diffHours = (input.now.getTime() - Date.parse(input.publishedAt)) / 3600000;
    if (Number.isFinite(diffHours) && diffHours <= 6) {
      base += 1.0;
    } else if (Number.isFinite(diffHours) && diffHours <= 24) {
      base += 0.5;
    }
  } else {
    base -= 0.2;
  }

  if (input.topicTags.length > 0) {
    base += Math.min(0.8, 0.3 * input.topicTags.length);
  }

  const lowerTitle = input.title.toLowerCase();
  const engineeringSignal = ENGINEERING_SIGNAL_KEYWORDS.some((keyword) => lowerTitle.includes(keyword));
  if (engineeringSignal) {
    base += 0.2;
  }

  if (input.lang === "unknown") {
    base -= 0.1;
  }

  const weight = clampWeight(input.sourceWeight);
  const jitter = buildDeterministicJitter(`${input.title}\n${input.summary}`);

  return base * weight + jitter;
}

function isBetterCandidate(left: Candidate, right: Candidate): boolean {
  if (left.score !== right.score) {
    return left.score > right.score;
  }

  const leftPublished = left.publishedAt ? Date.parse(left.publishedAt) : 0;
  const rightPublished = right.publishedAt ? Date.parse(right.publishedAt) : 0;
  if (leftPublished !== rightPublished) {
    return leftPublished > rightPublished;
  }

  return left.fetchedAt > right.fetchedAt;
}

function buildDeterministicJitter(seed: string): number {
  const hash = buildStableHash(seed);
  const chunk = Number.parseInt(hash.slice(0, 6), 16);
  if (!Number.isFinite(chunk)) {
    return 0;
  }
  return ((chunk % 61) - 30) / 1000;
}

function isDomainBlocked(domain: string, blocked: string[]): boolean {
  const normalized = domain.toLowerCase();
  return blocked.some((item) => normalized === item || normalized.endsWith(`.${item}`));
}

function extractLink(raw: unknown): string {
  if (typeof raw === "string") {
    return normalizeText(raw);
  }

  if (Array.isArray(raw)) {
    for (const item of raw) {
      const link = extractLink(item);
      if (link) {
        return link;
      }
    }
    return "";
  }

  const source = asRecord(raw);
  if (!source) {
    return "";
  }

  const href = normalizeText(source["@_href"] ?? source.href ?? source["#text"] ?? source["$text"]);
  if (href) {
    return href;
  }

  return "";
}

function extractAtomLink(raw: unknown): string {
  const entries = toArray(raw)
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));

  for (const entry of entries) {
    const rel = normalizeText(entry["@_rel"] ?? entry.rel).toLowerCase();
    const href = normalizeText(entry["@_href"] ?? entry.href ?? entry["#text"]);
    if (!href) {
      continue;
    }
    if (!rel || rel === "alternate" || rel === "self") {
      return href;
    }
  }

  for (const entry of entries) {
    const href = normalizeText(entry["@_href"] ?? entry.href ?? entry["#text"]);
    if (href) {
      return href;
    }
  }

  return "";
}

function getDefaultDigestType(candidate: Candidate): SelectedItem["digestType"] {
  return candidate.category === "news" ? "news" : "deep_read";
}
