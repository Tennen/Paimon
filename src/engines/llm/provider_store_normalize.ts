import { createDefaultProviderStoreFromEnv } from "./provider_store_defaults";
import {
  asRecord,
  normalizeProviderId,
  normalizeProviderType,
  normalizeText,
  parseBoolean,
  parseEnvObject,
  parseNullablePositiveInteger,
  parseNullablePositiveNumber,
  parsePositiveInteger,
  parseReasoningEffort
} from "./provider_store_shared";
import type {
  CodexProviderConfig,
  GeminiLikeProviderConfig,
  GptPluginProviderConfig,
  LLMProviderProfile,
  LLMProviderStore,
  LlamaServerProviderConfig,
  OllamaProviderConfig,
  OpenAILikeProviderConfig
} from "./provider_store_types";

export function normalizeProviderStore(input: unknown): LLMProviderStore {
  const source = asRecord(input);
  if (!source) {
    return createDefaultProviderStoreFromEnv();
  }

  const rows = Array.isArray(source.providers) ? source.providers : [];
  const providers: LLMProviderProfile[] = [];
  const idSet = new Set<string>();
  let gptPluginTaken = false;

  for (let index = 0; index < rows.length; index += 1) {
    const normalized = normalizeProviderProfile(rows[index], index);
    if (!normalized || idSet.has(normalized.id)) {
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
  return {
    version: 2,
    defaultProviderId: effectiveDefault,
    routingProviderId: routingProviderId && providers.some((item) => item.id === routingProviderId)
      ? routingProviderId
      : effectiveDefault,
    planningProviderId: planningProviderId && providers.some((item) => item.id === planningProviderId)
      ? planningProviderId
      : effectiveDefault,
    providers
  };
}

export function normalizeProviderProfile(input: unknown, index: number): LLMProviderProfile | null {
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
    return { id, name, type, config: normalizeOpenAIConfig(configSource) };
  }
  if (type === "llama-server") {
    return { id, name, type, config: normalizeLlamaServerConfig(configSource) };
  }
  if (type === "gemini") {
    return { id, name, type, config: normalizeGeminiConfig(configSource) };
  }
  if (type === "gpt-plugin") {
    return { id, name, type, config: normalizeGptPluginConfig(configSource) };
  }
  if (type === "codex") {
    return { id, name, type, config: normalizeCodexConfig(configSource) };
  }
  return { id, name, type: "ollama", config: normalizeOllamaConfig(configSource) };
}

export function normalizeOptionalSelectionProviderId(raw: unknown): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const normalized = normalizeProviderId(raw);
  if (!normalized) {
    throw new Error("provider id is required");
  }
  return normalized;
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
    chatTemplateKwargs: asRecord(source.chatTemplateKwargs ?? source.chat_template_kwargs) ?? undefined,
    planningChatTemplateKwargs: asRecord(source.planningChatTemplateKwargs ?? source.planning_chat_template_kwargs) ?? undefined,
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

function normalizeCodexConfig(source: Record<string, unknown>): CodexProviderConfig {
  const reasoningEffort = parseReasoningEffort(source.reasoningEffort);
  return {
    model: normalizeText(source.model),
    planningModel: normalizeText(source.planningModel),
    reasoningEffort,
    planningReasoningEffort: parseReasoningEffort(source.planningReasoningEffort) ?? reasoningEffort,
    timeoutMs: parsePositiveInteger(source.timeoutMs),
    planningTimeoutMs: parsePositiveInteger(source.planningTimeoutMs),
    maxRetries: parsePositiveInteger(source.maxRetries),
    strictJson: parseBoolean(source.strictJson)
  };
}
