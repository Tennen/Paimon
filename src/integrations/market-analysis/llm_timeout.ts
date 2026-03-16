import {
  getDefaultLLMProviderProfile,
  getLLMProviderProfile,
  listLLMProviderProfiles,
  resolveLegacyEngineSelector,
  type LLMProviderProfile
} from "../../engines/llm/provider_store";

export const DEFAULT_MARKET_ANALYSIS_LLM_TIMEOUT_MS = 60000;

type ResolveLlmTimeoutInput = {
  engineSelector?: string;
};

export function resolveMarketAnalysisLlmTimeoutMs(input: ResolveLlmTimeoutInput = {}): number {
  const envOverride = parsePositiveInteger(process.env.MARKET_ANALYSIS_LLM_TIMEOUT_MS);
  if (envOverride !== undefined) {
    return envOverride;
  }

  const profileTimeout = resolveProviderTimeoutMs(input.engineSelector);
  if (profileTimeout !== undefined) {
    return profileTimeout;
  }

  const globalTimeout = parsePositiveInteger(process.env.LLM_TIMEOUT_MS);
  if (globalTimeout !== undefined) {
    return globalTimeout;
  }

  return DEFAULT_MARKET_ANALYSIS_LLM_TIMEOUT_MS;
}

function resolveProviderTimeoutMs(engineSelector?: string): number | undefined {
  const profile = resolveProviderProfile(engineSelector);
  if (!profile || !profile.config || typeof profile.config !== "object") {
    return undefined;
  }

  const config = profile.config as { timeoutMs?: unknown };
  return parsePositiveInteger(config.timeoutMs);
}

function resolveProviderProfile(engineSelector?: string): LLMProviderProfile | null {
  const resolved = resolveLegacyEngineSelector(engineSelector);

  if (resolved.isDefault) {
    return safeGetDefaultProviderProfile();
  }

  if (resolved.providerId) {
    const byId = getLLMProviderProfile(resolved.providerId);
    return byId ?? safeGetDefaultProviderProfile();
  }

  if (resolved.providerType) {
    const byType = listLLMProviderProfiles().find((item) => item.type === resolved.providerType);
    if (byType) {
      return byType;
    }
  }

  return safeGetDefaultProviderProfile();
}

function safeGetDefaultProviderProfile(): LLMProviderProfile | null {
  try {
    return getDefaultLLMProviderProfile();
  } catch {
    return null;
  }
}

function parsePositiveInteger(value: unknown): number | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return undefined;
  }
  return Math.floor(numeric);
}
