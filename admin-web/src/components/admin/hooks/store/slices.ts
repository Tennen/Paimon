import type { FormEvent, SetStateAction } from "react";
import type {
  AdminConfig,
  CelestiaDevice,
  CelestiaDeviceFilters,
  ConversationBenchmarkResponse,
  DirectInputMappingConfig,
  EvolutionStateSnapshot,
  LLMProviderProfile,
  LLMProviderStore,
  MainFlowProviderSelectionDraft,
  MainConversationMode,
  MarketAnalysisConfig,
  MarketAnalysisEngine,
  MarketConfig,
  MarketFundHolding,
  MarketFundRiskLevel,
  MarketPhase,
  MarketPortfolio,
  MarketRunSummary,
  MarketSecuritySearchItem,
  MenuKey,
  Notice,
  PushUser,
  ScheduledTask,
  SearchEngineProfile,
  SearchEngineStore,
  SystemMemoryDraft,
  SystemOperationState,
  SystemRuntimeDraft,
  TaskFormState,
  TopicSummaryConfig,
  TopicSummaryDigestLanguage,
  TopicSummaryEngine,
  TopicSummaryProfile,
  TopicSummarySource,
  TopicSummaryState,
  UserFormState,
  WeComMenuConfig,
  WeComMenuEventRecord,
  WeComMenuPublishPayload,
  WritingStateSection,
  WritingTopicDetail,
  WritingTopicMeta
} from "@/types/admin";

export type ConversationBenchmarkInput = {
  turns: string[];
  repeatCount: number;
  modes: MainConversationMode[];
};

export type SharedLoadConfigResult = {
  config: AdminConfig;
  llmProviderStore: LLMProviderStore | null;
  marketSearchEngineStore: SearchEngineStore | null;
};

export type TopicSummaryLoadOptions = {
  preferredProfileId?: string;
};

export type WritingTopicsLoadOptions = {
  preferredTopicId?: string;
};

export type EvolutionLoadOptions = {
  silent?: boolean;
};

export type StateUpdater<T> = SetStateAction<T>;

export interface AdminPageSlice {
  activeMenu: MenuKey;
  notice: Notice;
  conversationBenchmarkResult: ConversationBenchmarkResponse | null;
  runningConversationBenchmark: boolean;
  setActiveMenu: (menu: MenuKey) => void;
  setNotice: (notice: Notice) => void;
  bootstrap: () => Promise<void>;
  runConversationBenchmark: (input: ConversationBenchmarkInput) => Promise<void>;
}

export interface AdminSharedSlice {
  config: AdminConfig | null;
  models: string[];
  llmProviderStore: LLMProviderStore | null;
  llmProviders: LLMProviderProfile[];
  defaultLlmProviderId: string;
  marketSearchEngineStore: SearchEngineStore | null;
  marketSearchEngines: SearchEngineProfile[];
  defaultMarketSearchEngineId: string;
  setConfig: (config: AdminConfig | null) => void;
  applyLlmProvidersPayload: (payload: { store: LLMProviderStore; defaultProvider: LLMProviderProfile }) => void;
  applySearchEnginesPayload: (payload: { store: SearchEngineStore; defaultEngine: SearchEngineProfile }) => void;
  loadConfig: () => Promise<SharedLoadConfigResult>;
  loadModels: () => Promise<void>;
  loadLLMProviders: () => Promise<LLMProviderStore | null>;
  loadSearchEngines: () => Promise<SearchEngineStore | null>;
}

export interface AdminSystemSlice {
  codexDraft: { model: string; reasoningEffort: string };
  memoryDraft: SystemMemoryDraft;
  runtimeDraft: SystemRuntimeDraft;
  systemOperationState: SystemOperationState;
  savingLLMProvider: boolean;
  deletingLLMProviderId: string;
  savingMarketSearchEngine: boolean;
  deletingMarketSearchEngineId: string;
  updatingMainFlowProviders: boolean;
  savingCodexConfig: boolean;
  savingMemoryConfig: boolean;
  savingRuntimeConfig: boolean;
  directInputMappingConfig: DirectInputMappingConfig;
  savingDirectInputMappings: boolean;
  wecomMenuConfig: WeComMenuConfig;
  wecomMenuEvents: WeComMenuEventRecord[];
  wecomMenuPublishPayload: WeComMenuPublishPayload | null;
  wecomMenuValidationErrors: string[];
  savingWecomMenu: boolean;
  publishingWecomMenu: boolean;
  syncSystemDraftsFromConfig: (config: AdminConfig | null) => void;
  setCodexDraft: (value: StateUpdater<{ model: string; reasoningEffort: string }>) => void;
  setMemoryDraft: (value: StateUpdater<SystemMemoryDraft>) => void;
  setRuntimeDraft: (value: StateUpdater<SystemRuntimeDraft>) => void;
  setDirectInputMappingConfig: (config: DirectInputMappingConfig) => void;
  setWecomMenuConfig: (config: WeComMenuConfig) => void;
  loadDirectInputMappings: () => Promise<void>;
  loadWeComMenu: () => Promise<void>;
  handleUpsertLLMProvider: (provider: LLMProviderProfile) => Promise<void>;
  handleDeleteLLMProvider: (providerId: string) => Promise<void>;
  handleSetMainFlowProviders: (selection: MainFlowProviderSelectionDraft) => Promise<void>;
  handleUpsertMarketSearchEngine: (engine: SearchEngineProfile) => Promise<void>;
  handleDeleteMarketSearchEngine: (engineId: string) => Promise<void>;
  handleSetDefaultMarketSearchEngine: (engineId: string) => Promise<void>;
  handleRestartPm2: () => Promise<void>;
  handleSaveCodexConfig: () => Promise<void>;
  handleSaveMemoryConfig: () => Promise<void>;
  handleSaveRuntimeConfig: () => Promise<void>;
  handlePullRepo: () => Promise<void>;
  handleBuildRepo: () => Promise<void>;
  handleDeployRepo: () => Promise<void>;
  handleSaveWeComMenu: () => Promise<void>;
  handleSaveDirectInputMappings: () => Promise<void>;
  handlePublishWeComMenu: () => Promise<void>;
}

export interface AdminCelestiaSlice {
  celestiaDevices: CelestiaDevice[];
  celestiaConfigured: boolean;
  celestiaBaseUrl: string;
  celestiaFilters: CelestiaDeviceFilters;
  selectedCelestiaDeviceId: string;
  loadingCelestiaDevices: boolean;
  celestiaDeviceError: string;
  setCelestiaFilters: (value: StateUpdater<CelestiaDeviceFilters>) => void;
  setSelectedCelestiaDeviceId: (deviceId: string) => void;
  loadCelestiaDevices: () => Promise<void>;
}

export interface AdminMessagesSlice {
  users: PushUser[];
  tasks: ScheduledTask[];
  enabledUsers: PushUser[];
  userMap: Map<string, PushUser>;
  editingUserId: string;
  savingUser: boolean;
  userForm: UserFormState;
  editingTaskId: string;
  savingTask: boolean;
  runningTaskId: string;
  taskForm: TaskFormState;
  setUserForm: (value: StateUpdater<UserFormState>) => void;
  setTaskForm: (value: StateUpdater<TaskFormState>) => void;
  loadUsers: () => Promise<void>;
  loadTasks: () => Promise<void>;
  beginCreateUser: () => void;
  beginEditUser: (user: PushUser) => void;
  handleSubmitUser: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  handleDeleteUser: (user: PushUser) => Promise<void>;
  beginCreateTask: () => void;
  beginEditTask: (task: ScheduledTask) => void;
  handleSubmitTask: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  handleDeleteTask: (task: ScheduledTask) => Promise<void>;
  handleRunTask: (task: ScheduledTask) => Promise<void>;
}

export interface AdminMarketPortfolioSlice {
  marketConfig: MarketConfig | null;
  marketPortfolio: MarketPortfolio;
  marketAnalysisConfig: MarketAnalysisConfig;
  savingMarketPortfolio: boolean;
  savingMarketAnalysisConfig: boolean;
  savingMarketFundIndex: number | null;
  marketFundSaveStates: Array<"saved" | "dirty" | "saving">;
  marketSavedFundsByRow: Array<MarketFundHolding | null>;
  marketSavedCash: number;
  marketBatchCodesInput: string;
  importingMarketCodes: boolean;
  marketSearchInputs: string[];
  marketSearchResults: MarketSecuritySearchItem[][];
  searchingMarketFundIndex: number | null;
  syncMarketAnalysisBindings: () => void;
  setMarketBatchCodesInput: (value: string) => void;
  loadMarketConfig: () => Promise<void>;
  handleAddMarketFund: () => void;
  handleRemoveMarketFund: (index: number) => void;
  handleMarketCashChange: (value: number) => void;
  handleMarketAnalysisEngineChange: (value: MarketAnalysisEngine) => void;
  handleMarketSearchEngineChange: (value: string) => void;
  handleMarketFundNewsQuerySuffixChange: (value: string) => void;
  handleMarketGptPluginTimeoutMsChange: (value: number) => void;
  handleMarketGptPluginFallbackToLocalChange: (value: boolean) => void;
  handleMarketFundEnabledChange: (value: boolean) => void;
  handleMarketFundMaxAgeDaysChange: (value: number) => void;
  handleMarketFundFeatureLookbackDaysChange: (value: number) => void;
  handleMarketFundRiskLevelChange: (value: MarketFundRiskLevel) => void;
  handleMarketFundLlmRetryMaxChange: (value: number) => void;
  handleMarketFundChange: (index: number, key: keyof MarketFundHolding, value: string) => void;
  handleMarketSearchInputChange: (index: number, value: string) => void;
  handleSearchMarketByName: (index: number) => Promise<void>;
  handleApplyMarketSearchResult: (index: number, item: MarketSecuritySearchItem) => void;
  handleSaveMarketFund: (index: number) => Promise<void>;
  handleSaveMarketPortfolio: () => Promise<void>;
  handleSaveMarketAnalysisConfig: () => Promise<void>;
  handleImportMarketCodes: () => Promise<void>;
}

export interface AdminMarketExecutionSlice {
  marketRuns: MarketRunSummary[];
  bootstrappingMarketTasks: boolean;
  runningMarketOncePhase: MarketPhase | null;
  marketTaskUserId: string;
  marketMiddayTime: string;
  marketCloseTime: string;
  syncMarketTaskUserSelection: () => void;
  setMarketTaskUserId: (value: string) => void;
  setMarketMiddayTime: (value: string) => void;
  setMarketCloseTime: (value: string) => void;
  loadMarketRuns: () => Promise<void>;
  handleBootstrapMarketTasks: () => Promise<void>;
  handleRunMarketOnce: (phase: MarketPhase) => Promise<void>;
}

export interface AdminTopicSlice {
  topicSummaryProfiles: TopicSummaryProfile[];
  topicSummaryActiveProfileId: string;
  topicSummarySelectedProfileId: string;
  topicSummaryConfig: TopicSummaryConfig;
  topicSummaryState: TopicSummaryState;
  savingTopicSummaryProfileAction: boolean;
  savingTopicSummaryConfig: boolean;
  clearingTopicSummaryState: boolean;
  syncTopicSummaryProviderBinding: () => void;
  loadTopicSummaryConfig: (options?: TopicSummaryLoadOptions) => Promise<void>;
  handleTopicProfileSelect: (profileId: string) => void;
  handleAddTopicProfile: () => Promise<void>;
  handleRenameTopicProfile: () => Promise<void>;
  handleUseTopicProfile: () => Promise<void>;
  handleDeleteTopicProfile: () => Promise<void>;
  handleTopicSummaryEngineChange: (value: TopicSummaryEngine) => void;
  handleTopicDefaultLanguageChange: (value: TopicSummaryDigestLanguage) => void;
  handleTopicSourceChange: (index: number, patch: Partial<TopicSummarySource>) => void;
  handleAddTopicSource: () => void;
  handleRemoveTopicSource: (index: number) => void;
  handleSaveTopicSummaryConfig: () => Promise<void>;
  handleClearTopicSummaryState: () => Promise<void>;
}

export interface AdminWritingSlice {
  writingTopics: WritingTopicMeta[];
  writingSelectedTopicId: string;
  writingTopicIdDraft: string;
  writingTopicTitleDraft: string;
  writingAppendDraft: string;
  writingTopicDetail: WritingTopicDetail | null;
  loadingWritingTopics: boolean;
  loadingWritingDetail: boolean;
  writingActionState: "append" | "summarize" | "restore" | "set" | null;
  writingManualSection: WritingStateSection;
  writingManualContent: string;
  setWritingTopicIdDraft: (value: string) => void;
  setWritingTopicTitleDraft: (value: string) => void;
  setWritingAppendDraft: (value: string) => void;
  setWritingManualSection: (value: WritingStateSection) => void;
  setWritingManualContent: (value: string) => void;
  loadWritingTopics: (options?: WritingTopicsLoadOptions) => Promise<void>;
  handleWritingTopicSelect: (topicId: string) => void;
  handleAppendWritingTopic: () => Promise<void>;
  handleSummarizeWritingTopic: () => Promise<void>;
  handleRestoreWritingTopic: () => Promise<void>;
  handleSetWritingTopicState: () => Promise<void>;
}

export interface AdminEvolutionSlice {
  evolutionSnapshot: EvolutionStateSnapshot | null;
  loadingEvolution: boolean;
  evolutionGoalDraft: string;
  evolutionCommitDraft: string;
  submittingEvolutionGoal: boolean;
  triggeringEvolutionTick: boolean;
  setEvolutionGoalDraft: (value: string) => void;
  setEvolutionCommitDraft: (value: string) => void;
  loadEvolutionState: (options?: EvolutionLoadOptions) => Promise<void>;
  handleSubmitEvolutionGoal: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  handleTriggerEvolutionTick: () => Promise<void>;
}
