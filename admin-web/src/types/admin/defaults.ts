import type { TaskFormState, UserFormState } from "./messages";
import type { MarketAnalysisConfig, MarketPortfolio } from "./market";
import type { TopicSummaryConfig, TopicSummaryState } from "./topicSummary";
import type { DirectInputMappingConfig, WeComMenuConfig } from "./wecom";

export const EMPTY_USER_FORM: UserFormState = {
  name: "",
  wecomUserId: "",
  enabled: true
};

export const EMPTY_TASK_FORM: TaskFormState = {
  name: "",
  time: "",
  userIds: [],
  message: "",
  enabled: true
};

export const DEFAULT_WECOM_MENU_CONFIG: WeComMenuConfig = {
  version: 1,
  buttons: [],
  updatedAt: ""
};

export const DEFAULT_DIRECT_INPUT_MAPPING_CONFIG: DirectInputMappingConfig = {
  version: 1,
  rules: [],
  updatedAt: ""
};

export const DEFAULT_MARKET_PORTFOLIO: MarketPortfolio = {
  funds: [],
  cash: 0
};

export const DEFAULT_MARKET_ANALYSIS_CONFIG: MarketAnalysisConfig = {
  version: 1,
  analysisEngine: "local",
  searchEngine: "default",
  gptPlugin: {
    timeoutMs: 20000,
    fallbackToLocal: true
  },
  fund: {
    enabled: true,
    maxAgeDays: 5,
    featureLookbackDays: 120,
    ruleRiskLevel: "medium",
    llmRetryMax: 1,
    newsQuerySuffix: "基金 公告 经理 申赎 风险"
  }
};

export const DEFAULT_TOPIC_SUMMARY_CONFIG: TopicSummaryConfig = {
  version: 1,
  summaryEngine: "local",
  defaultLanguage: "auto",
  sources: [],
  topics: {
    llm_apps: [],
    agents: [],
    multimodal: [],
    reasoning: [],
    rag: [],
    eval: [],
    on_device: [],
    safety: []
  },
  filters: {
    timeWindowHours: 24,
    minTitleLength: 8,
    blockedDomains: [],
    blockedKeywordsInTitle: [],
    maxPerDomain: 2,
    dedup: {
      titleSimilarityThreshold: 0.9,
      urlNormalization: true
    }
  },
  dailyQuota: {
    total: 20,
    engineering: 12,
    news: 5,
    ecosystem: 3
  }
};

export const DEFAULT_TOPIC_SUMMARY_STATE: TopicSummaryState = {
  version: 1,
  sentLog: [],
  updatedAt: ""
};
