import type { OpenAIQuotaPolicy } from "../../integrations/openai/quotaManager";

export type LLMProviderType = "ollama" | "llama-server" | "openai" | "gemini" | "gpt-plugin" | "codex";

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
  quotaPolicy?: OpenAIQuotaPolicy;
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
  version: 2;
  defaultProviderId: string;
  routingProviderId: string;
  planningProviderId: string;
  providers: LLMProviderProfile[];
};

export type LLMProviderSelectionPatch = {
  defaultProviderId?: string;
  routingProviderId?: string;
  planningProviderId?: string;
};
