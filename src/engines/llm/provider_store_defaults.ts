import { readOpenAIQuotaPolicyFromEnv } from "../../integrations/openai/quotaManager";
import type { LLMProviderProfile, LLMProviderStore } from "./provider_store_types";
import {
  DEFAULT_CODEX_PROVIDER_ID,
  DEFAULT_GEMINI_PROVIDER_ID,
  DEFAULT_GPT_PLUGIN_PROVIDER_ID,
  DEFAULT_PROVIDER_ID,
  DEFAULT_PROVIDER_NAME,
  normalizeProviderType,
  normalizeText,
  parseBoolean,
  parseEnvObject,
  parseNullablePositiveNumber,
  parsePositiveInteger,
  parseReasoningEffort
} from "./provider_store_shared";

export function createDefaultProviderStoreFromEnv(): LLMProviderStore {
  const profile = createDefaultProviderProfileFromEnv();
  return {
    version: 2,
    defaultProviderId: profile.id,
    routingProviderId: profile.id,
    planningProviderId: profile.id,
    providers: [profile]
  };
}

export function createDefaultProviderProfile(): LLMProviderProfile {
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

export function createDefaultProviderProfileFromEnv(): LLMProviderProfile {
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

  if (providerType === "codex") {
    const codexModel = normalizeText(
      process.env.LLM_CODEX_MODEL
      ?? process.env.CODEX_MODEL
      ?? process.env.EVOLUTION_CODEX_MODEL
      ?? process.env.LLM_MODEL
    );
    const codexReasoning = parseReasoningEffort(
      process.env.LLM_CODEX_REASONING_EFFORT
      ?? process.env.CODEX_MODEL_REASONING_EFFORT
      ?? process.env.CODEX_REASONING_EFFORT
      ?? process.env.EVOLUTION_CODEX_REASONING_EFFORT
    );
    return {
      id: DEFAULT_CODEX_PROVIDER_ID,
      name: "Default Codex CLI",
      type: "codex",
      config: {
        model: codexModel,
        planningModel: normalizeText(process.env.LLM_CODEX_PLANNING_MODEL) ?? codexModel,
        reasoningEffort: codexReasoning,
        planningReasoningEffort: parseReasoningEffort(process.env.LLM_CODEX_PLANNING_REASONING_EFFORT) ?? codexReasoning,
        timeoutMs: parsePositiveInteger(process.env.LLM_TIMEOUT_MS),
        planningTimeoutMs: parsePositiveInteger(process.env.LLM_PLANNING_TIMEOUT_MS),
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
