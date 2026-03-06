export type TopicPushCategory = "engineering" | "news" | "ecosystem";

export type TopicKey =
  | "llm_apps"
  | "agents"
  | "multimodal"
  | "reasoning"
  | "rag"
  | "eval"
  | "on_device"
  | "safety";

export type TopicPushSource = {
  id: string;
  name: string;
  category: TopicPushCategory;
  feedUrl: string;
  weight: number;
  enabled: boolean;
};

export type TopicPushFilters = {
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

export type TopicPushDailyQuota = {
  total: number;
  engineering: number;
  news: number;
  ecosystem: number;
};

export type TopicPushSummaryEngine = "local" | "gpt_plugin";
export type TopicPushDigestLanguage = "auto" | "zh-CN" | "en";

export type TopicPushConfig = {
  version: 1;
  summaryEngine: TopicPushSummaryEngine;
  defaultLanguage: TopicPushDigestLanguage;
  sources: TopicPushSource[];
  topics: Record<TopicKey, string[]>;
  filters: TopicPushFilters;
  dailyQuota: TopicPushDailyQuota;
};

export type TopicPushSentLogItem = {
  urlNormalized: string;
  sentAt: string;
  title: string;
};

export type TopicPushState = {
  version: 1;
  sentLog: TopicPushSentLogItem[];
  updatedAt: string;
};

export type TopicPushProfileSnapshot = {
  id: string;
  name: string;
  isActive: boolean;
  config: TopicPushConfig;
  state: TopicPushState;
};

export type TopicPushSnapshot = {
  activeProfileId: string;
  profiles: TopicPushProfileSnapshot[];
};

export type TopicPushProfileCreateInput = {
  id?: string;
  name: string;
  cloneFrom?: string;
};

export type TopicPushProfileUpdateInput = {
  name?: string;
};

export type TopicPushProfileConfig = {
  id: string;
  name: string;
  config: TopicPushConfig;
};

export type TopicPushProfileState = {
  id: string;
  state: TopicPushState;
};

export type TopicPushConfigStore = {
  version: 2;
  activeProfileId: string;
  profiles: TopicPushProfileConfig[];
};

export type TopicPushStateStore = {
  version: 2;
  profiles: TopicPushProfileState[];
};

export type FeedEntry = {
  title: string;
  link: string;
  publishedAtRaw: string;
  summary: string;
};

export type FeedFetchResult = {
  source: TopicPushSource;
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
  category: TopicPushCategory;
  publishedAt: string | null;
  fetchedAt: string;
  summary: string;
  lang: "zh" | "en" | "unknown";
  topicTags: TopicKey[];
  score: number;
  domain: string;
};

export type TopicDigestItemType = "news" | "deep_read";

export type TopicPushExecuteOptions = {
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
        category: TopicPushCategory;
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
        category?: TopicPushCategory;
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
  selectedByCategory: Record<TopicPushCategory, number>;
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

export type TopicPushProfileMeta = {
  id: string;
  name: string;
  config: TopicPushConfig;
  isActive: boolean;
};
