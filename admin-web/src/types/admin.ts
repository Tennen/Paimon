export type DataStoreDescriptor = {
  name: string;
  driver: string;
  codec?: "json" | "text";
};

export type AdminConfig = {
  model: string;
  planningModel: string;
  planningTimeoutMs: string;
  thinkingBudgetEnabled: boolean;
  thinkingBudgetDefault?: string;
  thinkingBudget?: string;
  openaiBaseUrl: string;
  openaiApiKey: string;
  openaiModel: string;
  openaiPlanningModel: string;
  openaiChatOptions: string;
  openaiPlanningChatOptions: string;
  openaiFallbackToChatgptBridge: boolean;
  openaiForceBridge: boolean;
  openaiQuotaResetDay: string;
  openaiMonthlyTokenLimit: string;
  openaiMonthlyBudgetUsd: string;
  openaiCostInputPer1M: string;
  openaiCostOutputPer1M: string;
  geminiApiKey: string;
  serpApiKey: string;
  codexModel: string;
  codexReasoningEffort: string;
  memoryCompactEveryRounds: string;
  memoryCompactMaxBatchSize: string;
  memorySummaryTopK: string;
  memoryRawRefLimit: string;
  memoryRawRecordLimit: string;
  memoryRagSummaryTopK: string;
  envPath: string;
  taskStore: DataStoreDescriptor;
  userStore: DataStoreDescriptor;
  timezone: string;
  tickMs: number;
};

export type PushUser = {
  id: string;
  name: string;
  wecomUserId: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ScheduledTask = {
  id: string;
  name: string;
  enabled: boolean;
  type: "daily";
  time: string;
  userIds: string[];
  toUser: string;
  message: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastRunKey?: string;
};

export type MarketFundHolding = {
  code: string;
  name: string;
  quantity: number;
  avgCost: number;
};

export type MarketPortfolio = {
  funds: MarketFundHolding[];
  cash: number;
};

export type MarketAnalysisAssetType = "equity" | "fund";

export type MarketAnalysisEngine = "local" | "gpt_plugin" | "gemini";

export type MarketFundRiskLevel = "low" | "medium" | "high";

export type MarketAnalysisConfig = {
  version: 1;
  assetType: MarketAnalysisAssetType;
  analysisEngine: MarketAnalysisEngine;
  gptPlugin: {
    timeoutMs: number;
    fallbackToLocal: boolean;
  };
  fund: {
    enabled: boolean;
    maxAgeDays: number;
    featureLookbackDays: number;
    ruleRiskLevel: MarketFundRiskLevel;
    llmRetryMax: number;
  };
};

export type MarketConfig = {
  portfolio: MarketPortfolio;
  config: MarketAnalysisConfig;
  portfolioStore: DataStoreDescriptor;
  configStore: DataStoreDescriptor;
  stateStore: DataStoreDescriptor;
  runsStore: DataStoreDescriptor;
};

export type MarketPhase = "midday" | "close";

export type MarketRunSummary = {
  id: string;
  createdAt: string;
  phase: MarketPhase;
  marketState: string;
  benchmark?: string;
  assetSignalCount: number;
  signals: Array<{ code: string; signal: string }>;
  explanationSummary?: string;
  file?: string;
};

export type MarketRunOnceResponse = {
  ok: boolean;
  phase: MarketPhase;
  message: string;
  acceptedAsync: boolean;
  responseText?: string;
  imageCount?: number;
};

export type MarketSectionProps = {
  marketConfig: MarketConfig | null;
  marketPortfolio: MarketPortfolio;
  marketAnalysisConfig: MarketAnalysisConfig;
  marketRuns: MarketRunSummary[];
  savingMarketPortfolio: boolean;
  savingMarketAnalysisConfig: boolean;
  marketFundSaveStates: Array<"saved" | "dirty" | "saving">;
  bootstrappingMarketTasks: boolean;
  runningMarketOncePhase: MarketPhase | null;
  marketRunOnceWithExplanation: boolean;
  enabledUsers: PushUser[];
  marketTaskUserId: string;
  marketMiddayTime: string;
  marketCloseTime: string;
  marketSearchInputs: string[];
  marketSearchResults: MarketSecuritySearchItem[][];
  searchingMarketFundIndex: number | null;
  onCashChange: (value: number) => void;
  onMarketAssetTypeChange: (value: MarketAnalysisAssetType) => void;
  onMarketAnalysisEngineChange: (value: MarketAnalysisEngine) => void;
  onMarketGptPluginTimeoutMsChange: (value: number) => void;
  onMarketGptPluginFallbackToLocalChange: (value: boolean) => void;
  onMarketFundEnabledChange: (value: boolean) => void;
  onMarketFundMaxAgeDaysChange: (value: number) => void;
  onMarketFundFeatureLookbackDaysChange: (value: number) => void;
  onMarketFundRiskLevelChange: (value: MarketFundRiskLevel) => void;
  onMarketFundLlmRetryMaxChange: (value: number) => void;
  onMarketTaskUserIdChange: (value: string) => void;
  onMarketMiddayTimeChange: (value: string) => void;
  onMarketCloseTimeChange: (value: string) => void;
  onAddMarketFund: () => void;
  onRemoveMarketFund: (index: number) => void;
  onMarketFundChange: (index: number, key: keyof MarketFundHolding, value: string) => void;
  onMarketSearchInputChange: (index: number, value: string) => void;
  onSearchMarketByName: (index: number) => void;
  onApplyMarketSearchResult: (index: number, item: MarketSecuritySearchItem) => void;
  onSaveMarketFund: (index: number) => void;
  onSaveMarketPortfolio: () => void;
  onSaveMarketAnalysisConfig: () => void;
  onRefresh: () => void;
  onBootstrapMarketTasks: () => void;
  onMarketRunOnceWithExplanationChange: (value: boolean) => void;
  onRunMarketOnce: (phase: MarketPhase, withExplanation: boolean) => void;
};

export type MarketSecuritySearchItem = {
  code: string;
  name: string;
  market: string;
  securityType: string;
  secid?: string;
};

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

export type TopicSummaryEngine = "local" | "gpt_plugin";
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

export type WritingTopicStatus = "active" | "archived";

export type WritingTopicMeta = {
  topicId: string;
  title: string;
  status: WritingTopicStatus;
  rawFileCount: number;
  rawLineCount: number;
  lastSummarizedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type WritingTopicState = {
  summary: string;
  outline: string;
  draft: string;
};

export type WritingStateSection = keyof WritingTopicState;

export type WritingTopicRawFile = {
  name: string;
  lineCount: number;
  content: string;
};

export type WritingTopicDetail = {
  meta: WritingTopicMeta;
  state: WritingTopicState;
  backup: WritingTopicState;
  rawFiles: WritingTopicRawFile[];
};

export type WritingTopicsPayload = {
  topics: WritingTopicMeta[];
  indexStore: DataStoreDescriptor;
};

export type WritingOrganizerSectionProps = {
  topics: WritingTopicMeta[];
  selectedTopicId: string;
  topicIdDraft: string;
  topicTitleDraft: string;
  appendDraft: string;
  detail: WritingTopicDetail | null;
  loadingTopics: boolean;
  loadingDetail: boolean;
  actionState: "append" | "summarize" | "restore" | "set" | null;
  manualSection: WritingStateSection;
  manualContent: string;
  onSelectTopic: (topicId: string) => void;
  onTopicIdDraftChange: (value: string) => void;
  onTopicTitleDraftChange: (value: string) => void;
  onAppendDraftChange: (value: string) => void;
  onManualSectionChange: (value: WritingStateSection) => void;
  onManualContentChange: (value: string) => void;
  onRefresh: () => void;
  onAppend: () => void;
  onSummarize: () => void;
  onRestore: () => void;
  onSetState: () => void;
};

export type EvolutionGoalStatus = "pending" | "running" | "waiting_retry" | "succeeded" | "failed";

export type EvolutionGoalEvent = {
  at: string;
  stage: string;
  message: string;
  important: boolean;
};

export type EvolutionRawLine = {
  at: string;
  line: string;
};

export type EvolutionGoal = {
  id: string;
  goal: string;
  commitMessage: string;
  commitMessageProvidedByUser?: boolean;
  status: EvolutionGoalStatus;
  stage: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  retries: number;
  fixAttempts: number;
  nextRetryAt?: string;
  lastError?: string;
  plan: {
    steps: string[];
    currentStep: number;
  };
  events: EvolutionGoalEvent[];
  rawTail: EvolutionRawLine[];
  git?: {
    stableTagEnsured: boolean;
    startedFromRef?: string;
    selfEvolutionDiffFile?: string;
    push?: {
      remote?: string;
      branch?: string;
      commit?: string;
      pushedAt?: string;
      lastError?: string;
    };
  };
};

export type EvolutionGoalHistory = {
  id: string;
  goal: string;
  status: "succeeded" | "failed";
  createdAt: string;
  completedAt: string;
  retries: number;
  totalSteps: number;
  fixAttempts: number;
  error?: string;
};

export type EvolutionRetryItem = {
  id: string;
  goalId: string;
  taskType: "plan" | "step" | "fix" | "structure";
  attempts: number;
  retryAt: string;
  stepIndex?: number;
  lastError: string;
};

export type EvolutionStateSnapshot = {
  ok: boolean;
  tickMs: number;
  state: {
    status: "idle" | "running";
    currentGoalId: string | null;
    updatedAt: string;
    goals: EvolutionGoal[];
    history: EvolutionGoalHistory[];
  };
  retryQueue: {
    updatedAt: string;
    items: EvolutionRetryItem[];
  };
  metrics: {
    updatedAt: string;
    totalGoals: number;
    totalFailures: number;
    totalRetries: number;
    totalSteps: number;
    avgRetries: number;
    avgStepsPerGoal: number;
  };
  storage: {
    stores: {
      state: DataStoreDescriptor;
      retryQueue: DataStoreDescriptor;
      metrics: DataStoreDescriptor;
    };
    artifacts: {
      workspaceDir: string;
      codexOutputDir: string;
    };
  };
};

export type Notice = {
  type: "success" | "error" | "info";
  title: string;
  text?: string;
} | null;

export type UserFormState = {
  name: string;
  wecomUserId: string;
  enabled: boolean;
};

export type TaskFormState = {
  name: string;
  time: string;
  userIds: string[];
  message: string;
  enabled: boolean;
};

export type MenuKey = "system" | "messages" | "market" | "topic" | "writing" | "evolution";

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

export const DEFAULT_MARKET_PORTFOLIO: MarketPortfolio = {
  funds: [],
  cash: 0
};

export const DEFAULT_MARKET_ANALYSIS_CONFIG: MarketAnalysisConfig = {
  version: 1,
  assetType: "equity",
  analysisEngine: "local",
  gptPlugin: {
    timeoutMs: 20000,
    fallbackToLocal: true
  },
  fund: {
    enabled: true,
    maxAgeDays: 5,
    featureLookbackDays: 120,
    ruleRiskLevel: "medium",
    llmRetryMax: 1
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
