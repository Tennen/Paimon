import type { DataStoreDescriptor } from "./common";

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

export type SearchEngineType = "serpapi" | "qianfan";

export type SerpApiSearchEngineConfig = {
  endpoint: string;
  apiKey: string;
  engine: string;
  hl: string;
  gl: string;
  num: number;
};

export type QianfanSearchEngineConfig = {
  endpoint: string;
  apiKey: string;
  searchSource: string;
  edition: "standard" | "lite";
  topK: number;
  recencyFilter: "week" | "month" | "semiyear" | "year" | "";
  safeSearch: boolean;
};

type BaseSearchEngineProfile<TType extends SearchEngineType, TConfig> = {
  id: string;
  name: string;
  type: TType;
  enabled: boolean;
  config: TConfig;
};

export type SearchEngineProfile =
  | BaseSearchEngineProfile<"serpapi", SerpApiSearchEngineConfig>
  | BaseSearchEngineProfile<"qianfan", QianfanSearchEngineConfig>;

export type SearchEngineStore = {
  version: number;
  defaultEngineId: string;
  engines: SearchEngineProfile[];
};

export type SearchEnginesPayload = {
  store: SearchEngineStore;
  defaultEngine: SearchEngineProfile;
};

export type MainConversationMode = "classic" | "windowed-agent";

export type ConversationContextSkillOption = {
  name: string;
  source: "skill" | "builtin-tool";
  description?: string;
  command?: string;
  terminal?: boolean;
  tool?: string;
  action?: string;
  params?: string[];
  keywords?: string[];
};

export type ConversationContextToolOption = {
  name: string;
  description?: string;
  resource?: string;
  keywords?: string[];
  operations: Array<{ op: string; description?: string }>;
};

export type ConversationContextConfig = {
  version: 1;
  selectedSkillNames: string[] | null;
  selectedToolNames: string[] | null;
  updatedAt: string;
};

export type ConversationContextSnapshot = {
  config: ConversationContextConfig;
  store: DataStoreDescriptor;
  availableSkills: ConversationContextSkillOption[];
  availableTools: ConversationContextToolOption[];
};

export type SystemMemoryDraft = {
  llmMemoryContextEnabled: boolean;
  memoryCompactEveryRounds: string;
  memoryCompactMaxBatchSize: string;
  memorySummaryTopK: string;
  memoryRawRefLimit: string;
  memoryRawRecordLimit: string;
};

export type SystemRuntimeDraft = {
  storageDriver: "json-file" | "sqlite";
  storageSqlitePath: string;
  mainConversationMode: MainConversationMode;
  conversationWindowTimeoutSeconds: string;
  conversationWindowMaxTurns: string;
  conversationAgentMaxSteps: string;
  llmMemoryContextEnabled: boolean;
  memoryCompactEveryRounds: string;
  memoryCompactMaxBatchSize: string;
  memorySummaryTopK: string;
  memoryRawRefLimit: string;
  memoryRawRecordLimit: string;
  celestiaBaseUrl: string;
  celestiaToken: string;
  celestiaDeviceRefreshMs: string;
  selectedSkillNames: string[];
  selectedToolNames: string[];
};

export type SystemOperationState = {
  restarting: boolean;
  pullingRepo: boolean;
  buildingRepo: boolean;
  deployingRepo: boolean;
};

export type MainFlowProviderSelectionDraft = {
  defaultProviderId: string;
  routingProviderId: string;
  planningProviderId: string;
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
  mainConversationMode: MainConversationMode;
  conversationWindowTimeoutSeconds: string;
  conversationWindowMaxTurns: string;
  conversationAgentMaxSteps: string;
  celestiaBaseUrl: string;
  celestiaToken: string;
  celestiaDeviceRefreshMs: string;
  llmMemoryContextEnabled: boolean;
  memoryCompactEveryRounds: string;
  memoryCompactMaxBatchSize: string;
  memorySummaryTopK: string;
  memoryRawRefLimit: string;
  memoryRawRecordLimit: string;
  conversationContext: ConversationContextSnapshot;
  envPath: string;
  taskStore: DataStoreDescriptor;
  userStore: DataStoreDescriptor;
  timezone: string;
  tickMs: number;
};
