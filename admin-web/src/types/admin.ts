export type DataStoreDescriptor = {
  name: string;
  driver: string;
  codec?: "json" | "text";
};

export type LLMProviderType = "ollama" | "llama-server" | "openai" | "gemini" | "gpt-plugin" | "codex";

export type LLMProviderOpenAIQuotaPolicy = {
  resetDay: number;
  monthlyTokenLimit: number | null;
  monthlyBudgetUsdLimit: number | null;
};

export type OllamaProviderConfig = {
  baseUrl?: string;
  model?: string;
  planningModel?: string;
  timeoutMs?: number;
  planningTimeoutMs?: number;
  maxRetries?: number;
  strictJson?: boolean;
  thinkingBudgetEnabled?: boolean;
  thinkingBudget?: number;
  thinkingMaxNewTokens?: number;
};

export type LlamaServerProviderConfig = {
  baseUrl?: string;
  model?: string;
  planningModel?: string;
  timeoutMs?: number;
  planningTimeoutMs?: number;
  maxRetries?: number;
  strictJson?: boolean;
  apiKey?: string;
  selectionOptions?: Record<string, unknown>;
  planningOptions?: Record<string, unknown>;
  chatTemplateKwargs?: Record<string, unknown>;
  planningChatTemplateKwargs?: Record<string, unknown>;
  extraBody?: Record<string, unknown>;
  planningExtraBody?: Record<string, unknown>;
};

export type OpenAILikeProviderConfig = {
  baseUrl?: string;
  apiKey?: string;
  chatCompletionsPath?: string;
  model?: string;
  planningModel?: string;
  timeoutMs?: number;
  planningTimeoutMs?: number;
  maxRetries?: number;
  strictJson?: boolean;
  selectionOptions?: Record<string, unknown>;
  planningOptions?: Record<string, unknown>;
  chatTemplateKwargs?: Record<string, unknown>;
  planningChatTemplateKwargs?: Record<string, unknown>;
  fallbackToChatgptBridge?: boolean;
  forceBridge?: boolean;
  costInputPer1M?: number | null;
  costOutputPer1M?: number | null;
  quotaPolicy?: LLMProviderOpenAIQuotaPolicy;
};

export type GeminiLikeProviderConfig = {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  planningModel?: string;
  timeoutMs?: number;
  planningTimeoutMs?: number;
  maxRetries?: number;
  strictJson?: boolean;
  selectionOptions?: Record<string, unknown>;
  planningOptions?: Record<string, unknown>;
};

export type GptPluginProviderConfig = {
  model?: string;
  planningModel?: string;
  timeoutMs?: number;
  planningTimeoutMs?: number;
  maxRetries?: number;
  strictJson?: boolean;
};

export type CodexProviderConfig = {
  model?: string;
  planningModel?: string;
  reasoningEffort?: string;
  planningReasoningEffort?: string;
  timeoutMs?: number;
  planningTimeoutMs?: number;
  maxRetries?: number;
  strictJson?: boolean;
};

export type OllamaProviderProfile = {
  id: string;
  name: string;
  type: "ollama";
  config: OllamaProviderConfig;
};

export type LlamaServerProviderProfile = {
  id: string;
  name: string;
  type: "llama-server";
  config: LlamaServerProviderConfig;
};

export type OpenAIProviderProfile = {
  id: string;
  name: string;
  type: "openai";
  config: OpenAILikeProviderConfig;
};

export type GeminiProviderProfile = {
  id: string;
  name: string;
  type: "gemini";
  config: GeminiLikeProviderConfig;
};

export type GptPluginProviderProfile = {
  id: string;
  name: string;
  type: "gpt-plugin";
  config: GptPluginProviderConfig;
};

export type CodexProviderProfile = {
  id: string;
  name: string;
  type: "codex";
  config: CodexProviderConfig;
};

export type LLMProviderProfile =
  | OllamaProviderProfile
  | LlamaServerProviderProfile
  | OpenAIProviderProfile
  | GeminiProviderProfile
  | GptPluginProviderProfile
  | CodexProviderProfile;

export type LLMProviderStore = {
  version: number;
  defaultProviderId: string;
  routingProviderId: string;
  planningProviderId: string;
  providers: LLMProviderProfile[];
};

export type LLMProvidersPayload = {
  store: LLMProviderStore;
  defaultProvider: LLMProviderProfile;
};

export type SearchEngineType = "serpapi";

export type SerpApiSearchEngineConfig = {
  endpoint: string;
  apiKey: string;
  engine: string;
  hl: string;
  gl: string;
  num: number;
};

export type SearchEngineProfile = {
  id: string;
  name: string;
  type: SearchEngineType;
  enabled: boolean;
  config: SerpApiSearchEngineConfig;
};

export type SearchEngineStore = {
  version: number;
  defaultEngineId: string;
  engines: SearchEngineProfile[];
};

export type SearchEnginesPayload = {
  store: SearchEngineStore;
  defaultEngine: SearchEngineProfile;
};

export type AdminConfig = {
  llmProviders?: LLMProvidersPayload;
  searchEngines?: SearchEnginesPayload;
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
  storageDriver: string;
  storageDriverEffective?: string;
  storageSqlitePath: string;
  llmMemoryContextEnabled: boolean;
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

export type WeComMenuLeafButton = {
  id: string;
  name: string;
  key: string;
  enabled: boolean;
  dispatchText: string;
};

export type WeComMenuButton = WeComMenuLeafButton & {
  subButtons: WeComMenuLeafButton[];
};

export type WeComMenuConfig = {
  version: 1;
  buttons: WeComMenuButton[];
  updatedAt: string;
  lastPublishedAt?: string;
};

export type WeComMenuEventRecord = {
  id: string;
  source: "wecom";
  eventType: "click";
  eventKey: string;
  fromUser: string;
  toUser: string;
  agentId?: string;
  matchedButtonId?: string;
  matchedButtonName?: string;
  dispatchText?: string;
  status: "recorded" | "dispatched" | "ignored" | "failed";
  error?: string;
  receivedAt: string;
};

export type WeComMenuPublishLeafButton = {
  type: "click";
  name: string;
  key: string;
};

export type WeComMenuPublishGroupButton = {
  name: string;
  sub_button: WeComMenuPublishLeafButton[];
};

export type WeComMenuPublishPayload = {
  button: Array<WeComMenuPublishLeafButton | WeComMenuPublishGroupButton>;
};

export type WeComMenuSnapshot = {
  config: WeComMenuConfig;
  recentEvents: WeComMenuEventRecord[];
  publishPayload: WeComMenuPublishPayload | null;
  validationErrors: string[];
};

export type DirectInputMatchMode = "exact" | "fuzzy";

export type DirectInputMappingRule = {
  id: string;
  name: string;
  pattern: string;
  targetText: string;
  matchMode: DirectInputMatchMode;
  enabled: boolean;
};

export type DirectInputMappingConfig = {
  version: 1;
  rules: DirectInputMappingRule[];
  updatedAt: string;
};

export type DirectInputMappingSnapshot = {
  config: DirectInputMappingConfig;
  store: DataStoreDescriptor;
};

export type MarketFundHolding = {
  code: string;
  name: string;
  quantity?: number;
  avgCost?: number;
};

export type MarketPortfolio = {
  funds: MarketFundHolding[];
  cash: number;
};

export type MarketAnalysisEngine = string;

export type MarketFundRiskLevel = "low" | "medium" | "high";

export type MarketAnalysisConfig = {
  version: 1;
  analysisEngine: MarketAnalysisEngine;
  searchEngine: string;
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
    newsQuerySuffix: string;
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
  comparisonReference?: string;
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

export type MarketPortfolioImportResultItem = {
  code: string;
  name?: string;
  status: "added" | "updated" | "exists" | "not_found" | "error";
  message?: string;
};

export type MarketPortfolioImportResponse = {
  ok: boolean;
  portfolio: MarketPortfolio;
  results: MarketPortfolioImportResultItem[];
  summary: {
    added: number;
    updated: number;
    exists: number;
    not_found: number;
    error: number;
  };
};

export type MarketSectionProps = {
  marketConfig: MarketConfig | null;
  marketPortfolio: MarketPortfolio;
  marketAnalysisConfig: MarketAnalysisConfig;
  marketSearchEngines: SearchEngineProfile[];
  defaultMarketSearchEngineId: string;
  llmProviders: LLMProviderProfile[];
  defaultLlmProviderId: string;
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
  marketBatchCodesInput: string;
  importingMarketCodes: boolean;
  marketSearchInputs: string[];
  marketSearchResults: MarketSecuritySearchItem[][];
  searchingMarketFundIndex: number | null;
  onCashChange: (value: number) => void;
  onMarketAnalysisEngineChange: (value: MarketAnalysisEngine) => void;
  onMarketSearchEngineChange: (value: string) => void;
  onMarketFundNewsQuerySuffixChange: (value: string) => void;
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
  onMarketBatchCodesInputChange: (value: string) => void;
  onAddMarketFund: () => void;
  onRemoveMarketFund: (index: number) => void;
  onMarketFundChange: (index: number, key: keyof MarketFundHolding, value: string) => void;
  onMarketSearchInputChange: (index: number, value: string) => void;
  onSearchMarketByName: (index: number) => void;
  onApplyMarketSearchResult: (index: number, item: MarketSecuritySearchItem) => void;
  onSaveMarketFund: (index: number) => void;
  onSaveMarketPortfolio: () => void;
  onSaveMarketAnalysisConfig: () => void;
  onImportMarketCodes: () => void;
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

export type MenuKey = "system" | "messages" | "direct_input" | "wecom" | "market" | "topic" | "writing" | "evolution";

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
