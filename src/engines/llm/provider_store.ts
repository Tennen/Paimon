import { DATA_STORE, getStore, registerStore, setStore } from "../../storage/persistence";
import { createDefaultProviderProfile, createDefaultProviderStoreFromEnv } from "./provider_store_defaults";
import {
  normalizeOptionalSelectionProviderId,
  normalizeProviderProfile,
  normalizeProviderStore
} from "./provider_store_normalize";
import { normalizeProviderId, normalizeProviderType, resolveLegacyEngineSelector } from "./provider_store_shared";
import type { LLMProviderProfile, LLMProviderSelectionPatch, LLMProviderStore } from "./provider_store_types";

export type * from "./provider_store_types";
export { normalizeProviderId, normalizeProviderType, resolveLegacyEngineSelector } from "./provider_store_shared";

const LLM_PROVIDER_STORE = DATA_STORE.LLM_PROVIDERS;
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

function assertProviderExists(store: LLMProviderStore, providerId: string, fieldName: string): void {
  if (!store.providers.some((item) => item.id === providerId)) {
    throw new Error(`${fieldName} provider not found: ${providerId}`);
  }
}
