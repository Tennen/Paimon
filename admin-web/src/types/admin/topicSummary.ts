import type { DataStoreDescriptor } from "./common";

export type TopicSummaryCategory = "engineering" | "news" | "ecosystem";

export type TopicSummaryTopicKey =
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
  topics: Record<TopicSummaryTopicKey, string[]>;
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

export type TopicSummaryProfile = {
  id: string;
  name: string;
  isActive: boolean;
  config: TopicSummaryConfig;
  state: TopicSummaryState;
};

export type TopicSummaryProfilesPayload = {
  activeProfileId: string;
  profiles: TopicSummaryProfile[];
  config: TopicSummaryConfig;
  state: TopicSummaryState;
  configStore: DataStoreDescriptor;
  stateStore: DataStoreDescriptor;
};
