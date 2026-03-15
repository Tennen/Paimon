export type TopicSummaryCategory = "engineering" | "news" | "ecosystem";

export type TopicKey =
  | "llm_apps"
  | "agents"
  | "multimodal"
  | "reasoning"
  | "rag"
  | "eval"
  | "on_device"
  | "safety";

export type TopicSummarySource = {
  id: string;
  name: string;
  category: TopicSummaryCategory;
  feedUrl: string;
  weight: number;
  enabled: boolean;
};

export type TopicSummaryFilters = {
  timeWindowHours: number;
  minTitleLength: number;
  blockedDomains: string[];
  blockedKeywordsInTitle: string[];
  maxPerDomain: number;
  dedup: {
    titleSimilarityThreshold: number;
    urlNormalization: boolean;
  };
};

export type TopicSummaryDailyQuota = {
  total: number;
  engineering: number;
  news: number;
  ecosystem: number;
};

export type TopicSummaryEngine = string;
export type TopicSummaryDigestLanguage = "auto" | "zh-CN" | "en";

export type TopicSummaryConfig = {
  version: 1;
  summaryEngine: TopicSummaryEngine;
  defaultLanguage: TopicSummaryDigestLanguage;
  sources: TopicSummarySource[];
  topics: Record<TopicKey, string[]>;
  filters: TopicSummaryFilters;
  dailyQuota: TopicSummaryDailyQuota;
};

export type TopicSummarySentLogItem = {
  urlNormalized: string;
  sentAt: string;
  title: string;
};

export type TopicSummaryState = {
  version: 1;
  sentLog: TopicSummarySentLogItem[];
  updatedAt: string;
};

export type TopicSummaryProfileSnapshot = {
  id: string;
  name: string;
  isActive: boolean;
  config: TopicSummaryConfig;
  state: TopicSummaryState;
};

export type TopicSummarySnapshot = {
  activeProfileId: string;
  profiles: TopicSummaryProfileSnapshot[];
};

export type TopicSummaryProfileCreateInput = {
  id?: string;
  name: string;
  cloneFrom?: string;
};

export type TopicSummaryProfileUpdateInput = {
  name?: string;
};

export type TopicSummaryProfileConfig = {
  id: string;
  name: string;
  config: TopicSummaryConfig;
};

export type TopicSummaryProfileState = {
  id: string;
  state: TopicSummaryState;
};

export type TopicSummaryConfigStore = {
  version: 2;
  activeProfileId: string;
  profiles: TopicSummaryProfileConfig[];
};

export type TopicSummaryStateStore = {
  version: 2;
  profiles: TopicSummaryProfileState[];
};

export type FeedEntry = {
  title: string;
  link: string;
  publishedAtRaw: string;
  summary: string;
};

export type FeedFetchResult = {
  source: TopicSummarySource;
  fetchedAt: string;
  entries: FeedEntry[];
  error?: string;
};

export type Candidate = {
  id: string;
  title: string;
  url: string;
  urlNormalized: string;
  sourceId: string;
  sourceName: string;
  category: TopicSummaryCategory;
  publishedAt: string | null;
  fetchedAt: string;
  summary: string;
  lang: "zh" | "en" | "unknown";
  topicTags: TopicKey[];
  score: number;
  domain: string;
};

export type TopicDigestItemType = "news" | "deep_read";

export type TopicSummaryExecuteOptions = {
  explicitLanguage?: string;
  inferredLanguage?: string;
};

export type SelectedItem = {
  candidate: Candidate;
  digestType: TopicDigestItemType;
  digestSummary: string;
  rank: number;
  fallbackFill: boolean;
};

export type ParsedCommand =
  | { kind: "run"; profileId?: string }
  | { kind: "help" }
  | { kind: "sources_list"; profileId?: string }
  | { kind: "sources_get"; id: string; profileId?: string }
  | {
      kind: "sources_add";
      profileId?: string;
      payload: {
        id?: string;
        name: string;
        category: TopicSummaryCategory;
        feedUrl: string;
        weight?: number;
        enabled?: boolean;
      };
    }
  | {
      kind: "sources_update";
      id: string;
      profileId?: string;
      patch: {
        name?: string;
        category?: TopicSummaryCategory;
        feedUrl?: string;
        weight?: number;
        enabled?: boolean;
      };
    }
  | { kind: "sources_delete"; id: string; profileId?: string }
  | { kind: "sources_toggle"; id: string; enabled: boolean; profileId?: string }
  | { kind: "profiles_list" }
  | { kind: "profiles_get"; id: string }
  | {
      kind: "profiles_add";
      payload: {
        id?: string;
        name: string;
        cloneFrom?: string;
      };
    }
  | {
      kind: "profiles_update";
      id: string;
      patch: {
        name?: string;
      };
    }
  | { kind: "profiles_use"; id: string }
  | { kind: "profiles_delete"; id: string }
  | { kind: "config_show"; profileId?: string }
  | { kind: "state_show"; profileId?: string }
  | { kind: "state_clear_sent"; profileId?: string };

export type DigestRunResult = {
  now: string;
  selected: SelectedItem[];
  selectedByCategory: Record<TopicSummaryCategory, number>;
  fetchedSources: number;
  totalSources: number;
  fetchErrors: Array<{ sourceId: string; sourceName: string; error: string }>;
  rawItemCount: number;
  candidateCount: number;
  dedupedCount: number;
  unsentCount: number;
};

export type PlanningDigestItemPatch = {
  id: string;
  titleLocalized?: string;
  digestType?: TopicDigestItemType;
  digestSummary?: string;
  topicTags?: TopicKey[];
};

export type TopicSummaryProfileMeta = {
  id: string;
  name: string;
  config: TopicSummaryConfig;
  isActive: boolean;
};
