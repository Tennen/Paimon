import { OpenAIQuotaManager, readOpenAIQuotaPolicyFromEnv } from "../../integrations/openai/quotaManager";
import { GPTPluginLLMEngine, GPTPluginLLMOptions } from "./gpt-plugin";
import { LlamaServerLLMEngine, LlamaServerLLMOptions } from "./llama-server";
import { LLMEngine, LLMProvider } from "./llm";
import { OllamaLLMEngine, OllamaLLMOptions } from "./ollama";
import { OpenAILLMEngine, OpenAILLMOptions } from "./openai";
import {
  getDefaultLLMProviderProfile,
  getLLMProviderProfile,
  LLMProviderProfile,
  resolveLegacyEngineSelector
} from "./provider_store";

export function createLLMEngine(providerRaw: string | undefined = process.env.LLM_PROVIDER): LLMEngine {
  const resolved = resolveLegacyEngineSelector(providerRaw);

  if (resolved.isDefault) {
    return createLLMEngineFromProfile(getDefaultLLMProviderProfile());
  }

  if (resolved.providerId) {
    const profile = getLLMProviderProfile(resolved.providerId);
    if (profile) {
      return createLLMEngineFromProfile(profile);
    }
    console.warn(`[LLM] unknown provider id '${providerRaw}', fallback to default provider`);
    return createLLMEngineFromProfile(getDefaultLLMProviderProfile());
  }

  if (resolved.providerType) {
    return createLLMEngineFromProviderType(resolved.providerType);
  }

  return createLLMEngineFromProfile(getDefaultLLMProviderProfile());
}

export function createLLMEngineFromProfile(profile: LLMProviderProfile): LLMEngine {
  if (profile.type === "llama-server") {
    return new LlamaServerLLMEngine(profile.config as Partial<LlamaServerLLMOptions>);
  }

  if (profile.type === "openai") {
    const options = profile.config as Partial<OpenAILLMOptions>;
    return new OpenAILLMEngine({
      ...options,
      quotaPolicy: options.quotaPolicy ?? readOpenAIQuotaPolicyFromEnv(),
      quotaManager: new OpenAIQuotaManager({ namespace: profile.id })
    });
  }

  if (profile.type === "gpt-plugin") {
    return new GPTPluginLLMEngine(profile.config as Partial<GPTPluginLLMOptions>);
  }

  return new OllamaLLMEngine(profile.config as Partial<OllamaLLMOptions>);
}

export function createLLMEngineFromProviderType(provider: LLMProvider): LLMEngine {
  if (provider === "llama-server") {
    return new LlamaServerLLMEngine();
  }
  if (provider === "openai") {
    return new OpenAILLMEngine({
      quotaManager: new OpenAIQuotaManager({ namespace: "default" })
    });
  }
  if (provider === "gpt-plugin") {
    return new GPTPluginLLMEngine();
  }
  return new OllamaLLMEngine();
}

export function normalizeProvider(providerRaw: string | undefined): LLMProvider {
  const value = String(providerRaw ?? "").trim().toLowerCase();
  if (!value) {
    return "ollama";
  }
  if (["llama-server", "llama_server", "llama.cpp", "llamacpp", "llama"].includes(value)) {
    return "llama-server";
  }
  if (["openai", "openai-api", "openai-like", "openai_like", "chatgpt", "gpt"].includes(value)) {
    return "openai";
  }
  if (["gpt-plugin", "gpt_plugin", "gptplugin", "chatgpt-bridge", "chatgpt_bridge", "bridge"].includes(value)) {
    return "gpt-plugin";
  }
  if (value !== "ollama") {
    console.warn(`[LLM] unknown provider '${providerRaw}', fallback to ollama`);
  }
  return "ollama";
}
