import {
  DEFAULT_CONFIG,
  ENGINEERING_SIGNAL_KEYWORDS,
  TOPIC_KEYS
} from "../defaults";
import {
  buildStableHash,
  clampWeight,
  extractDomain,
  normalizeQuotaNumber,
  normalizeText,
  normalizeUrl,
  parseDateToIso
} from "../shared";
import {
  detectLang,
  normalizeSummary,
  normalizeTitle,
  titleSimilarity
} from "../text";
import type {
  Candidate,
  FeedFetchResult,
  SelectedItem,
  TopicKey,
  TopicSummaryCategory,
  TopicSummaryConfig,
  TopicSummaryDailyQuota
} from "../types";

export function buildCandidates(fetchResults: FeedFetchResult[], config: TopicSummaryConfig, now: Date): Candidate[] {
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

      const urlNormalized = config.filters.dedup.urlNormalization ? normalizeUrl(rawUrl) : rawUrl;
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
        score: scoreCandidate({
          title,
          summary,
          topicTags,
          publishedAt,
          lang,
          sourceWeight: result.source.weight,
          now
        }),
        domain
      });
    }
  }

  return out;
}

export function deduplicateCandidates(candidates: Candidate[], titleThreshold: number): Candidate[] {
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

export function selectCandidates(
  candidates: Candidate[],
  quota: TopicSummaryDailyQuota,
  maxPerDomain: number
): SelectedItem[] {
  const maxDomain = maxPerDomain <= 0 ? Number.POSITIVE_INFINITY : maxPerDomain;
  const sorted = candidates.slice().sort((left, right) => right.score - left.score);

  const buckets: Record<TopicSummaryCategory, Candidate[]> = {
    engineering: sorted.filter((item) => item.category === "engineering"),
    news: sorted.filter((item) => item.category === "news"),
    ecosystem: sorted.filter((item) => item.category === "ecosystem")
  };

  const used = new Set<string>();
  const domainCounter = new Map<string, number>();
  const selected: Array<Omit<SelectedItem, "rank" | "digestType" | "digestSummary">> = [];

  pickFromBucket(buckets.engineering, normalizeQuotaNumber(quota.engineering, DEFAULT_CONFIG.dailyQuota.engineering), false, selected, used, domainCounter, maxDomain);
  pickFromBucket(buckets.news, normalizeQuotaNumber(quota.news, DEFAULT_CONFIG.dailyQuota.news), false, selected, used, domainCounter, maxDomain);
  pickFromBucket(buckets.ecosystem, normalizeQuotaNumber(quota.ecosystem, DEFAULT_CONFIG.dailyQuota.ecosystem), false, selected, used, domainCounter, maxDomain);

  const total = normalizeQuotaNumber(quota.total, DEFAULT_CONFIG.dailyQuota.total);
  let needed = Math.max(0, total - selected.length);

  if (needed > 0) {
    for (const category of ["engineering", "ecosystem", "news"] as TopicSummaryCategory[]) {
      if (needed <= 0) {
        break;
      }
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

export function getDefaultDigestType(candidate: Candidate): SelectedItem["digestType"] {
  return candidate.category === "news" ? "news" : "deep_read";
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
    selected.push({ candidate: item, fallbackFill });
    picked += 1;
  }
}

function detectTopicTags(title: string, summary: string, topics: Record<TopicKey, string[]>): TopicKey[] {
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

  if (ENGINEERING_SIGNAL_KEYWORDS.some((keyword) => input.title.toLowerCase().includes(keyword))) {
    base += 0.2;
  }

  if (input.lang === "unknown") {
    base -= 0.1;
  }

  return base * clampWeight(input.sourceWeight) + buildDeterministicJitter(`${input.title}\n${input.summary}`);
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
  return Number.isFinite(chunk) ? ((chunk % 61) - 30) / 1000 : 0;
}

function isDomainBlocked(domain: string, blocked: string[]): boolean {
  const normalized = domain.toLowerCase();
  return blocked.some((item) => normalized === item || normalized.endsWith(`.${item}`));
}
