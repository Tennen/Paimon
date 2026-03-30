import type {
  AdminConfig,
  LLMProviderProfile,
  LLMProviderStore,
  SearchEngineProfile,
  SearchEngineStore
} from "@/types/admin";
import { request } from "../adminApi";
import type { AdminSharedSlice } from "./slices";
import type { AdminSliceCreator } from "./types";

export function resolveDefaultLlmProviderId(store: LLMProviderStore | null | undefined): string {
  if (!store || !Array.isArray(store.providers) || store.providers.length === 0) {
    return "";
  }
  if (store.providers.some((item) => item.id === store.defaultProviderId)) {
    return store.defaultProviderId;
  }
  return store.providers[0].id;
}

export function resolveDefaultMarketSearchEngineId(store: SearchEngineStore | null | undefined): string {
  if (!store || !Array.isArray(store.engines) || store.engines.length === 0) {
    return "";
  }
  if (store.engines.some((item) => item.id === store.defaultEngineId)) {
    return store.defaultEngineId;
  }
  return store.engines[0].id;
}

type LlmProvidersResponse = {
  ok: boolean;
  store: LLMProviderStore;
  defaultProvider: LLMProviderProfile;
};

type SearchEnginesResponse = {
  ok: boolean;
  store: SearchEngineStore;
  defaultEngine: SearchEngineProfile;
};

function patchConfigWithProviders(
  config: AdminConfig | null,
  payload: { store: LLMProviderStore; defaultProvider: LLMProviderProfile }
): AdminConfig | null {
  if (!config) {
    return config;
  }
  return {
    ...config,
    llmProviders: {
      store: payload.store,
      defaultProvider: payload.defaultProvider
    }
  };
}

function patchConfigWithSearchEngines(
  config: AdminConfig | null,
  payload: { store: SearchEngineStore; defaultEngine: SearchEngineProfile }
): AdminConfig | null {
  if (!config) {
    return config;
  }
  return {
    ...config,
    searchEngines: {
      store: payload.store,
      defaultEngine: payload.defaultEngine
    }
  };
}

export const createSharedSlice: AdminSliceCreator<AdminSharedSlice> = (set, get) => ({
  config: null,
  models: [],
  llmProviderStore: null,
  llmProviders: [],
  defaultLlmProviderId: "",
  marketSearchEngineStore: null,
  marketSearchEngines: [],
  defaultMarketSearchEngineId: "",
  setConfig: (config) => {
    set({ config });
    get().syncSystemDraftsFromConfig(config);
  },
  applyLlmProvidersPayload: (payload) => {
    set((state) => ({
      llmProviderStore: payload.store,
      llmProviders: payload.store.providers ?? [],
      defaultLlmProviderId: resolveDefaultLlmProviderId(payload.store),
      config: patchConfigWithProviders(state.config, payload)
    }));
    get().syncMarketAnalysisBindings();
    get().syncTopicSummaryProviderBinding();
  },
  applySearchEnginesPayload: (payload) => {
    set((state) => ({
      marketSearchEngineStore: payload.store,
      marketSearchEngines: payload.store.engines ?? [],
      defaultMarketSearchEngineId: resolveDefaultMarketSearchEngineId(payload.store),
      config: patchConfigWithSearchEngines(state.config, payload)
    }));
    get().syncMarketAnalysisBindings();
  },
  loadConfig: async () => {
    const payload = await request<AdminConfig>("/admin/api/config");
    set({ config: payload });
    get().syncSystemDraftsFromConfig(payload);

    let nextLlmProviderStore: LLMProviderStore | null = null;
    if (payload.llmProviders?.store) {
      nextLlmProviderStore = payload.llmProviders.store;
      get().applyLlmProvidersPayload(payload.llmProviders);
    } else {
      nextLlmProviderStore = await get().loadLLMProviders();
    }

    let nextMarketSearchEngineStore: SearchEngineStore | null = null;
    if (payload.searchEngines?.store) {
      nextMarketSearchEngineStore = payload.searchEngines.store;
      get().applySearchEnginesPayload(payload.searchEngines);
    } else {
      nextMarketSearchEngineStore = await get().loadSearchEngines();
    }

    return {
      config: payload,
      llmProviderStore: nextLlmProviderStore,
      marketSearchEngineStore: nextMarketSearchEngineStore
    };
  },
  loadModels: async () => {
    const payload = await request<{ baseUrl: string; models: string[] }>("/admin/api/models");
    set({
      models: Array.isArray(payload.models) ? payload.models.filter(Boolean) : []
    });
  },
  loadLLMProviders: async () => {
    const payload = await request<LlmProvidersResponse>("/admin/api/llm/providers");
    if (payload.store && Array.isArray(payload.store.providers)) {
      get().applyLlmProvidersPayload(payload);
      return payload.store;
    }
    return null;
  },
  loadSearchEngines: async () => {
    const payload = await request<SearchEnginesResponse>("/admin/api/search-engines");
    if (payload.store && Array.isArray(payload.store.engines)) {
      get().applySearchEnginesPayload(payload);
      return payload.store;
    }
    return null;
  }
});
