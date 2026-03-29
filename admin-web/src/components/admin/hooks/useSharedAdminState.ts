import { useCallback, useMemo, useState } from "react";
import type {
  AdminConfig,
  LLMProviderProfile,
  LLMProviderStore,
  Notice,
  SearchEngineProfile,
  SearchEngineStore
} from "@/types/admin";
import { request } from "./adminApi";

function resolveDefaultLlmProviderId(store: LLMProviderStore | null | undefined): string {
  if (!store || !Array.isArray(store.providers) || store.providers.length === 0) {
    return "";
  }
  if (store.providers.some((item) => item.id === store.defaultProviderId)) {
    return store.defaultProviderId;
  }
  return store.providers[0].id;
}

function resolveDefaultMarketSearchEngineId(store: SearchEngineStore | null | undefined): string {
  if (!store || !Array.isArray(store.engines) || store.engines.length === 0) {
    return "";
  }
  if (store.engines.some((item) => item.id === store.defaultEngineId)) {
    return store.defaultEngineId;
  }
  return store.engines[0].id;
}

export function useSharedAdminState() {
  const [config, setConfig] = useState<AdminConfig | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [llmProviderStore, setLlmProviderStore] = useState<LLMProviderStore | null>(null);
  const [marketSearchEngineStore, setMarketSearchEngineStore] = useState<SearchEngineStore | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const loadConfig = useCallback(async (): Promise<{
    config: AdminConfig;
    llmProviderStore: LLMProviderStore | null;
    marketSearchEngineStore: SearchEngineStore | null;
  }> => {
    const payload = await request<AdminConfig>("/admin/api/config");
    setConfig(payload);
    let nextLlmProviderStore: LLMProviderStore | null = null;
    if (payload.llmProviders?.store) {
      nextLlmProviderStore = payload.llmProviders.store;
      setLlmProviderStore(payload.llmProviders.store);
    } else {
      nextLlmProviderStore = await loadLLMProviders();
    }
    let nextMarketSearchEngineStore: SearchEngineStore | null = null;
    if (payload.searchEngines?.store) {
      nextMarketSearchEngineStore = payload.searchEngines.store;
      setMarketSearchEngineStore(payload.searchEngines.store);
    } else {
      nextMarketSearchEngineStore = await loadSearchEngines();
    }
    return {
      config: payload,
      llmProviderStore: nextLlmProviderStore,
      marketSearchEngineStore: nextMarketSearchEngineStore
    };
  }, []);

  const loadModels = useCallback(async (): Promise<void> => {
    const payload = await request<{ baseUrl: string; models: string[] }>("/admin/api/models");
    setModels(Array.isArray(payload.models) ? payload.models.filter(Boolean) : []);
  }, []);

  const loadLLMProviders = useCallback(async (): Promise<LLMProviderStore | null> => {
    const payload = await request<{
      ok: boolean;
      store: LLMProviderStore;
      defaultProvider: LLMProviderProfile;
    }>("/admin/api/llm/providers");
    if (payload.store && Array.isArray(payload.store.providers)) {
      setLlmProviderStore(payload.store);
      return payload.store;
    }
    return null;
  }, []);

  const loadSearchEngines = useCallback(async (): Promise<SearchEngineStore | null> => {
    const payload = await request<{
      ok: boolean;
      store: SearchEngineStore;
      defaultEngine: SearchEngineProfile;
    }>("/admin/api/search-engines");
    if (payload.store && Array.isArray(payload.store.engines)) {
      setMarketSearchEngineStore(payload.store);
      return payload.store;
    }
    return null;
  }, []);

  const llmProviders = useMemo(() => llmProviderStore?.providers ?? [], [llmProviderStore]);
  const defaultLlmProviderId = useMemo(() => resolveDefaultLlmProviderId(llmProviderStore), [llmProviderStore]);
  const marketSearchEngines = useMemo(() => marketSearchEngineStore?.engines ?? [], [marketSearchEngineStore]);
  const defaultMarketSearchEngineId = useMemo(
    () => resolveDefaultMarketSearchEngineId(marketSearchEngineStore),
    [marketSearchEngineStore]
  );

  return {
    config,
    setConfig,
    models,
    setModels,
    llmProviderStore,
    setLlmProviderStore,
    marketSearchEngineStore,
    setMarketSearchEngineStore,
    notice,
    setNotice,
    loadConfig,
    loadModels,
    loadLLMProviders,
    loadSearchEngines,
    llmProviders,
    defaultLlmProviderId,
    marketSearchEngines,
    defaultMarketSearchEngineId
  };
}
