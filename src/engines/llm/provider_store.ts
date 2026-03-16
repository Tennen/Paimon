import { OpenAIQuotaPolicy, readOpenAIQuotaPolicyFromEnv } from "../../integrations/openai/quotaManager";
import { DATA_STORE, getStore, registerStore, setStore } from "../../storage/persistence";

export type LLMProviderType = "ollama" | "llama-server" | "openai" | "gemini" | "gpt-plugin";

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

export type LLMProviderProfile =
  | OllamaProviderProfile
  | LlamaServerProviderProfile
  | OpenAIProviderProfile
  | GeminiProviderProfile
  | GptPluginProviderProfile;

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

const LLM_PROVIDER_STORE = DATA_STORE.LLM_PROVIDERS;
const DEFAULT_PROVIDER_ID = "default-ollama";
const DEFAULT_PROVIDER_NAME = "Default Ollama";
const DEFAULT_GEMINI_PROVIDER_ID = "default-gemini";
const DEFAULT_GPT_PLUGIN_PROVIDER_ID = "default-gpt-plugin";
let providerStoreRegistered = false;

export function ensureLLMProviderStore(): void {
  if (providerStoreRegistered) {
    return;
  }
  registerStore(LLM_PROVIDER_STORE, () => createDefaultProviderStoreFromEnv());
  providerStoreRegistered = true;
}

export function readLLMProviderStore(): LLMProviderStore {
  ensureLLMProviderStore();
  const raw = getStore<unknown>(LLM_PROVIDER_STORE);
  return normalizeProviderStore(raw);
}

export function writeLLMProviderStore(input: unknown): LLMProviderStore {
  const normalized = normalizeProviderStore(input);
  ensureLLMProviderStore();
  setStore(LLM_PROVIDER_STORE, normalized);
  return normalized;
}

export function listLLMProviderProfiles(): LLMProviderProfile[] {
  return readLLMProviderStore().providers;
}

export function getLLMProviderProfile(providerId: string): LLMProviderProfile | null {
  const normalizedId = normalizeProviderId(providerId);
  if (!normalizedId) {
    return null;
  }
  const store = readLLMProviderStore();
  return store.providers.find((item) => item.id === normalizedId) ?? null;
}

export function getDefaultLLMProviderProfile(): LLMProviderProfile {
  const store = readLLMProviderStore();
  const selected = store.providers.find((item) => item.id === store.defaultProviderId);
  if (selected) {
    return selected;
  }
  return store.providers[0] ?? createDefaultProviderProfile();
}

export function upsertLLMProviderProfile(input: unknown): LLMProviderStore {
  const profile = normalizeProviderProfile(input, 0);
  if (!profile) {
    throw new Error("invalid LLM provider payload");
  }

  const store = readLLMProviderStore();
  if (
    profile.type === "gpt-plugin"
    && store.providers.some((item) => item.type === "gpt-plugin" && item.id !== profile.id)
  ) {
    throw new Error("gpt-plugin provider only supports one profile");
  }

  const index = store.providers.findIndex((item) => item.id === profile.id);
  if (index >= 0) {
    store.providers[index] = profile;
  } else {
    store.providers.push(profile);
  }

  if (!store.defaultProviderId) {
    store.defaultProviderId = profile.id;
  }

  return writeLLMProviderStore(store);
}

export function deleteLLMProviderProfile(providerId: string): LLMProviderStore {
  const normalizedId = normalizeProviderId(providerId);
  if (!normalizedId) {
    throw new Error("providerId is required");
  }

  const store = readLLMProviderStore();
  if (store.providers.length <= 1) {
    throw new Error("at least one LLM provider must remain");
  }

  const nextProviders = store.providers.filter((item) => item.id !== normalizedId);
  if (nextProviders.length === store.providers.length) {
    throw new Error(`provider not found: ${normalizedId}`);
  }

  store.providers = nextProviders;
  if (store.defaultProviderId === normalizedId) {
    store.defaultProviderId = nextProviders[0].id;
  }

  return writeLLMProviderStore(store);
}

export function setDefaultLLMProvider(providerId: string): LLMProviderStore {
  return setLLMProviderSelections({ defaultProviderId: providerId });
}

export function setLLMProviderSelections(selection: LLMProviderSelectionPatch): LLMProviderStore {
  const store = readLLMProviderStore();
  const source = selection && typeof selection === "object" ? selection : {};

  const nextDefault = normalizeOptionalSelectionProviderId(source.defaultProviderId);
  if (nextDefault !== undefined) {
    assertProviderExists(store, nextDefault, "defaultProviderId");
    store.defaultProviderId = nextDefault;
  }

  const nextRouting = normalizeOptionalSelectionProviderId(source.routingProviderId);
  if (nextRouting !== undefined) {
    assertProviderExists(store, nextRouting, "routingProviderId");
    store.routingProviderId = nextRouting;
  }

  const nextPlanning = normalizeOptionalSelectionProviderId(source.planningProviderId);
  if (nextPlanning !== undefined) {
    assertProviderExists(store, nextPlanning, "planningProviderId");
    store.planningProviderId = nextPlanning;
  }

  return writeLLMProviderStore(store);
}

export function normalizeProviderType(raw: unknown): LLMProviderType {
  const value = String(raw ?? "").trim().toLowerCase();
  if (["llama-server", "llama_server", "llama.cpp", "llamacpp", "llama"].includes(value)) {
    return "llama-server";
  }
  if (["openai", "openai-like", "openai_like", "openai-api", "chatgpt", "gpt"].includes(value)) {
    return "openai";
  }
  if (["gemini", "gemini-like", "gemini_like", "google", "google-genai", "google-genai-api"].includes(value)) {
    return "gemini";
  }
  if (["gpt-plugin", "gpt_plugin", "gptplugin", "chatgpt-bridge", "chatgpt_bridge", "bridge"].includes(value)) {
    return "gpt-plugin";
  }
  return "ollama";
}

export function normalizeProviderId(raw: unknown): string {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return value;
}

export function resolveLegacyEngineSelector(selector: unknown): {
  isDefault: boolean;
  providerType?: LLMProviderType;
  providerId?: string;
} {
  const raw = String(selector ?? "").trim();
  if (!raw) {
    return { isDefault: true };
  }

  const lower = raw.toLowerCase();
  if (["default", "local", "auto"].includes(lower)) {
    return { isDefault: true };
  }
  if (["gpt_plugin", "gpt-plugin", "gptplugin", "chatgpt-bridge", "chatgpt_bridge", "bridge"].includes(lower)) {
    return { isDefault: false, providerType: "gpt-plugin" };
  }
  if (["openai", "openai-like", "openai_like", "openai-api", "chatgpt", "gpt"].includes(lower)) {
    return { isDefault: false, providerType: "openai" };
  }
  if (["gemini", "gemini-like", "gemini_like", "google", "google-genai", "google-genai-api"].includes(lower)) {
    return { isDefault: false, providerType: "gemini" };
  }
  if (["ollama"].includes(lower)) {
    return { isDefault: false, providerType: "ollama" };
  }
  if (["llama-server", "llama_server", "llama.cpp", "llamacpp", "llama"].includes(lower)) {
    return { isDefault: false, providerType: "llama-server" };
  }

  const normalizedId = normalizeProviderId(raw);
  if (!normalizedId) {
    return { isDefault: true };
  }
  return { isDefault: false, providerId: normalizedId };
}

function createDefaultProviderStoreFromEnv(): LLMProviderStore {
  const profile = createDefaultProviderProfileFromEnv();
  return {
    version: 2,
    defaultProviderId: profile.id,
    routingProviderId: profile.id,
    planningProviderId: profile.id,
    providers: [profile]
  };
}

function createDefaultProviderProfile(): LLMProviderProfile {
  return {
    id: DEFAULT_PROVIDER_ID,
    name: DEFAULT_PROVIDER_NAME,
    type: "ollama",
    config: {
      baseUrl: "http://127.0.0.1:11434",
      model: "qwen3:4b",
      planningModel: "qwen3:4b"
    }
  };
}

function createDefaultProviderProfileFromEnv(): LLMProviderProfile {
  const providerType = normalizeProviderType(process.env.LLM_PROVIDER);
  if (providerType === "openai") {
    return {
      id: "default-openai",
      name: "Default OpenAI-Like",
      type: "openai",
      config: {
        baseUrl: normalizeText(process.env.OPENAI_BASE_URL),
        apiKey: normalizeText(process.env.OPENAI_API_KEY ?? process.env.CHATGPT_API_KEY),
        chatCompletionsPath: normalizeText(process.env.OPENAI_CHAT_COMPLETIONS_PATH),
        model: normalizeText(process.env.OPENAI_MODEL ?? process.env.LLM_MODEL),
        planningModel: normalizeText(process.env.OPENAI_PLANNING_MODEL),
        timeoutMs: parsePositiveInteger(process.env.LLM_TIMEOUT_MS),
        planningTimeoutMs: parsePositiveInteger(process.env.LLM_PLANNING_TIMEOUT_MS),
        maxRetries: parsePositiveInteger(process.env.LLM_MAX_RETRIES),
        strictJson: parseBoolean(process.env.LLM_STRICT_JSON),
        selectionOptions: parseEnvObject(process.env.OPENAI_CHAT_OPTIONS),
        planningOptions: parseEnvObject(process.env.OPENAI_PLANNING_CHAT_OPTIONS),
        fallbackToChatgptBridge: parseBoolean(process.env.OPENAI_FALLBACK_TO_CHATGPT_BRIDGE),
        forceBridge: parseBoolean(process.env.OPENAI_FORCE_BRIDGE),
        costInputPer1M: parseNullablePositiveNumber(process.env.OPENAI_COST_INPUT_PER_1M),
        costOutputPer1M: parseNullablePositiveNumber(process.env.OPENAI_COST_OUTPUT_PER_1M),
        quotaPolicy: readOpenAIQuotaPolicyFromEnv()
      }
    };
  }

  if (providerType === "gemini") {
    return {
      id: DEFAULT_GEMINI_PROVIDER_ID,
      name: "Default Gemini-Like",
      type: "gemini",
      config: {
        baseUrl: normalizeText(process.env.GEMINI_BASE_URL),
        apiKey: normalizeText(process.env.GEMINI_API_KEY),
        model: normalizeText(process.env.GEMINI_MODEL ?? process.env.MARKET_ANALYSIS_GEMINI_MODEL),
        planningModel: normalizeText(process.env.GEMINI_PLANNING_MODEL),
        timeoutMs: parsePositiveInteger(process.env.LLM_TIMEOUT_MS ?? process.env.MARKET_ANALYSIS_GEMINI_TIMEOUT_MS),
        planningTimeoutMs: parsePositiveInteger(process.env.LLM_PLANNING_TIMEOUT_MS),
        maxRetries: parsePositiveInteger(process.env.LLM_MAX_RETRIES),
        strictJson: parseBoolean(process.env.LLM_STRICT_JSON),
        selectionOptions: parseEnvObject(process.env.GEMINI_CHAT_OPTIONS),
        planningOptions: parseEnvObject(process.env.GEMINI_PLANNING_CHAT_OPTIONS)
      }
    };
  }

  if (providerType === "llama-server") {
    return {
      id: "default-llama-server",
      name: "Default llama-server",
      type: "llama-server",
      config: {
        baseUrl: normalizeText(process.env.LLAMA_SERVER_BASE_URL),
        model: normalizeText(process.env.LLAMA_SERVER_MODEL ?? process.env.OLLAMA_MODEL),
        planningModel: normalizeText(process.env.LLAMA_SERVER_PLANNING_MODEL),
        timeoutMs: parsePositiveInteger(process.env.LLM_TIMEOUT_MS),
        planningTimeoutMs: parsePositiveInteger(process.env.LLM_PLANNING_TIMEOUT_MS),
        maxRetries: parsePositiveInteger(process.env.LLM_MAX_RETRIES),
        strictJson: parseBoolean(process.env.LLM_STRICT_JSON),
        apiKey: normalizeText(process.env.LLAMA_SERVER_API_KEY ?? process.env.OPENAI_API_KEY),
        selectionOptions: parseEnvObject(process.env.LLAMA_SERVER_CHAT_OPTIONS),
        planningOptions: parseEnvObject(process.env.LLAMA_SERVER_PLANNING_CHAT_OPTIONS),
        chatTemplateKwargs: parseEnvObject(process.env.LLAMA_SERVER_CHAT_TEMPLATE_KWARGS),
        planningChatTemplateKwargs: parseEnvObject(process.env.LLAMA_SERVER_PLANNING_CHAT_TEMPLATE_KWARGS),
        extraBody: parseEnvObject(process.env.LLAMA_SERVER_EXTRA_BODY),
        planningExtraBody: parseEnvObject(process.env.LLAMA_SERVER_PLANNING_EXTRA_BODY)
      }
    };
  }

  if (providerType === "gpt-plugin") {
    return {
      id: DEFAULT_GPT_PLUGIN_PROVIDER_ID,
      name: "Default GPT Plugin",
      type: "gpt-plugin",
      config: {
        model: normalizeText(process.env.GPT_PLUGIN_MODEL),
        planningModel: normalizeText(process.env.GPT_PLUGIN_PLANNING_MODEL),
        timeoutMs: parsePositiveInteger(process.env.GPT_PLUGIN_TIMEOUT_MS ?? process.env.LLM_TIMEOUT_MS),
        planningTimeoutMs: parsePositiveInteger(process.env.GPT_PLUGIN_PLANNING_TIMEOUT_MS ?? process.env.LLM_PLANNING_TIMEOUT_MS),
        maxRetries: parsePositiveInteger(process.env.LLM_MAX_RETRIES),
        strictJson: parseBoolean(process.env.LLM_STRICT_JSON)
      }
    };
  }

  const defaultModel = normalizeText(process.env.OLLAMA_MODEL) || "qwen3:4b";
  return {
    id: DEFAULT_PROVIDER_ID,
    name: DEFAULT_PROVIDER_NAME,
    type: "ollama",
    config: {
      baseUrl: normalizeText(process.env.OLLAMA_BASE_URL),
      model: defaultModel,
      planningModel: normalizeText(process.env.OLLAMA_PLANNING_MODEL) || defaultModel,
      timeoutMs: parsePositiveInteger(process.env.LLM_TIMEOUT_MS),
      planningTimeoutMs: parsePositiveInteger(process.env.LLM_PLANNING_TIMEOUT_MS),
      maxRetries: parsePositiveInteger(process.env.LLM_MAX_RETRIES),
      strictJson: parseBoolean(process.env.LLM_STRICT_JSON),
      thinkingBudgetEnabled: parseBoolean(process.env.LLM_THINKING_BUDGET_ENABLED),
      thinkingBudget: parsePositiveInteger(process.env.LLM_THINKING_BUDGET),
      thinkingMaxNewTokens: parsePositiveInteger(process.env.LLM_THINKING_MAX_NEW_TOKENS)
    }
  };
}

function normalizeProviderStore(input: unknown): LLMProviderStore {
  const source = asRecord(input);
  if (!source) {
    return createDefaultProviderStoreFromEnv();
  }

  const rows = Array.isArray(source.providers) ? source.providers : [];
  const providers: LLMProviderProfile[] = [];
  const idSet = new Set<string>();
  let gptPluginTaken = false;

  for (let i = 0; i < rows.length; i += 1) {
    const normalized = normalizeProviderProfile(rows[i], i);
    if (!normalized) {
      continue;
    }
    if (idSet.has(normalized.id)) {
      continue;
    }
    if (normalized.type === "gpt-plugin") {
      if (gptPluginTaken) {
        continue;
      }
      gptPluginTaken = true;
    }
    idSet.add(normalized.id);
    providers.push(normalized);
  }

  if (providers.length === 0) {
    return createDefaultProviderStoreFromEnv();
  }

  const defaultProviderId = normalizeProviderId(source.defaultProviderId);
  const effectiveDefault = defaultProviderId && providers.some((item) => item.id === defaultProviderId)
    ? defaultProviderId
    : providers[0].id;
  const routingProviderId = normalizeProviderId(source.routingProviderId);
  const planningProviderId = normalizeProviderId(source.planningProviderId);
  const effectiveRouting = routingProviderId && providers.some((item) => item.id === routingProviderId)
    ? routingProviderId
    : effectiveDefault;
  const effectivePlanning = planningProviderId && providers.some((item) => item.id === planningProviderId)
    ? planningProviderId
    : effectiveDefault;

  return {
    version: 2,
    defaultProviderId: effectiveDefault,
    routingProviderId: effectiveRouting,
    planningProviderId: effectivePlanning,
    providers
  };
}

function normalizeProviderProfile(input: unknown, index: number): LLMProviderProfile | null {
  const source = asRecord(input);
  if (!source) {
    return null;
  }

  const type = normalizeProviderType(source.type ?? source.provider ?? source.engine ?? source.kind);
  const idRaw = source.id ?? source.providerId ?? source.key ?? source.name ?? `${type}-${index + 1}`;
  const id = normalizeProviderId(idRaw);
  if (!id) {
    return null;
  }

  const name = normalizeText(source.name) || `${type}:${id}`;
  const configSource = asRecord(source.config) ?? source;

  if (type === "openai") {
    return {
      id,
      name,
      type,
      config: normalizeOpenAIConfig(configSource)
    };
  }

  if (type === "llama-server") {
    return {
      id,
      name,
      type,
      config: normalizeLlamaServerConfig(configSource)
    };
  }

  if (type === "gemini") {
    return {
      id,
      name,
      type,
      config: normalizeGeminiConfig(configSource)
    };
  }

  if (type === "gpt-plugin") {
    return {
      id,
      name,
      type,
      config: normalizeGptPluginConfig(configSource)
    };
  }

  return {
    id,
    name,
    type: "ollama",
    config: normalizeOllamaConfig(configSource)
  };
}

function normalizeOllamaConfig(source: Record<string, unknown>): OllamaProviderConfig {
  return {
    baseUrl: normalizeText(source.baseUrl),
    model: normalizeText(source.model),
    planningModel: normalizeText(source.planningModel),
    timeoutMs: parsePositiveInteger(source.timeoutMs),
    planningTimeoutMs: parsePositiveInteger(source.planningTimeoutMs),
    maxRetries: parsePositiveInteger(source.maxRetries),
    strictJson: parseBoolean(source.strictJson),
    thinkingBudgetEnabled: parseBoolean(source.thinkingBudgetEnabled),
    thinkingBudget: parsePositiveInteger(source.thinkingBudget),
    thinkingMaxNewTokens: parsePositiveInteger(source.thinkingMaxNewTokens)
  };
}

function normalizeLlamaServerConfig(source: Record<string, unknown>): LlamaServerProviderConfig {
  return {
    baseUrl: normalizeText(source.baseUrl),
    model: normalizeText(source.model),
    planningModel: normalizeText(source.planningModel),
    timeoutMs: parsePositiveInteger(source.timeoutMs),
    planningTimeoutMs: parsePositiveInteger(source.planningTimeoutMs),
    maxRetries: parsePositiveInteger(source.maxRetries),
    strictJson: parseBoolean(source.strictJson),
    apiKey: normalizeText(source.apiKey),
    selectionOptions: asRecord(source.selectionOptions) ?? undefined,
    planningOptions: asRecord(source.planningOptions) ?? undefined,
    chatTemplateKwargs: asRecord(source.chatTemplateKwargs) ?? undefined,
    planningChatTemplateKwargs: asRecord(source.planningChatTemplateKwargs) ?? undefined,
    extraBody: asRecord(source.extraBody) ?? undefined,
    planningExtraBody: asRecord(source.planningExtraBody) ?? undefined
  };
}

function normalizeOpenAIConfig(source: Record<string, unknown>): OpenAILikeProviderConfig {
  const quotaSource = asRecord(source.quotaPolicy);
  return {
    baseUrl: normalizeText(source.baseUrl),
    apiKey: normalizeText(source.apiKey),
    chatCompletionsPath: normalizeText(source.chatCompletionsPath),
    model: normalizeText(source.model),
    planningModel: normalizeText(source.planningModel),
    timeoutMs: parsePositiveInteger(source.timeoutMs),
    planningTimeoutMs: parsePositiveInteger(source.planningTimeoutMs),
    maxRetries: parsePositiveInteger(source.maxRetries),
    strictJson: parseBoolean(source.strictJson),
    selectionOptions: asRecord(source.selectionOptions) ?? undefined,
    planningOptions: asRecord(source.planningOptions) ?? undefined,
    fallbackToChatgptBridge: parseBoolean(source.fallbackToChatgptBridge),
    forceBridge: parseBoolean(source.forceBridge),
    costInputPer1M: parseNullablePositiveNumber(source.costInputPer1M),
    costOutputPer1M: parseNullablePositiveNumber(source.costOutputPer1M),
    quotaPolicy: quotaSource
      ? {
          resetDay: Math.max(1, Math.min(28, parsePositiveInteger(quotaSource.resetDay) ?? 1)),
          monthlyTokenLimit: parseNullablePositiveInteger(quotaSource.monthlyTokenLimit),
          monthlyBudgetUsdLimit: parseNullablePositiveNumber(quotaSource.monthlyBudgetUsdLimit)
        }
      : undefined
  };
}

function normalizeGeminiConfig(source: Record<string, unknown>): GeminiLikeProviderConfig {
  return {
    baseUrl: normalizeText(source.baseUrl),
    apiKey: normalizeText(source.apiKey),
    model: normalizeText(source.model),
    planningModel: normalizeText(source.planningModel),
    timeoutMs: parsePositiveInteger(source.timeoutMs),
    planningTimeoutMs: parsePositiveInteger(source.planningTimeoutMs),
    maxRetries: parsePositiveInteger(source.maxRetries),
    strictJson: parseBoolean(source.strictJson),
    selectionOptions: asRecord(source.selectionOptions) ?? undefined,
    planningOptions: asRecord(source.planningOptions) ?? undefined
  };
}

function normalizeGptPluginConfig(source: Record<string, unknown>): GptPluginProviderConfig {
  return {
    model: normalizeText(source.model),
    planningModel: normalizeText(source.planningModel),
    timeoutMs: parsePositiveInteger(source.timeoutMs),
    planningTimeoutMs: parsePositiveInteger(source.planningTimeoutMs),
    maxRetries: parsePositiveInteger(source.maxRetries),
    strictJson: parseBoolean(source.strictJson)
  };
}

function parseEnvObject(raw: unknown): Record<string, unknown> | undefined {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return asRecord(parsed) ?? undefined;
  } catch {
    return undefined;
  }
}

function parsePositiveInteger(raw: unknown): number | undefined {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.floor(value);
}

function parseNullablePositiveInteger(raw: unknown): number | null {
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return null;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.floor(value);
}

function parseNullablePositiveNumber(raw: unknown): number | null {
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return null;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
}

function parseBoolean(raw: unknown): boolean | undefined {
  if (typeof raw === "boolean") {
    return raw;
  }
  if (typeof raw !== "string") {
    return undefined;
  }
  const value = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(value)) {
    return false;
  }
  return undefined;
}

function normalizeText(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const value = raw.trim();
  return value || undefined;
}

function asRecord(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  return input as Record<string, unknown>;
}

function normalizeOptionalSelectionProviderId(raw: unknown): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const normalized = normalizeProviderId(raw);
  if (!normalized) {
    throw new Error("provider id is required");
  }
  return normalized;
}

function assertProviderExists(store: LLMProviderStore, providerId: string, fieldName: string): void {
  if (!store.providers.some((item) => item.id === providerId)) {
    throw new Error(`${fieldName} provider not found: ${providerId}`);
  }
}
