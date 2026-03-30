import type { SystemMemoryDraft, SystemRuntimeDraft } from "@/types/admin";
import { useShallow } from "zustand/react/shallow";
import { useAdminStore } from "./useAdminStore";

export function useSystemSectionState() {
  const state = useAdminStore(useShallow((store) => ({
    config: store.config,
    models: store.models,
    llmProviderStore: store.llmProviderStore,
    marketSearchEngineStore: store.marketSearchEngineStore,
    savingLLMProvider: store.savingLLMProvider,
    deletingLLMProviderId: store.deletingLLMProviderId,
    savingMarketSearchEngine: store.savingMarketSearchEngine,
    deletingMarketSearchEngineId: store.deletingMarketSearchEngineId,
    updatingMainFlowProviders: store.updatingMainFlowProviders,
    memoryDraft: store.memoryDraft,
    runtimeDraft: store.runtimeDraft,
    systemOperationState: store.systemOperationState,
    savingMemoryConfig: store.savingMemoryConfig,
    savingRuntimeConfig: store.savingRuntimeConfig,
    setMemoryDraft: store.setMemoryDraft,
    setRuntimeDraft: store.setRuntimeDraft,
    loadModels: store.loadModels,
    loadConfig: store.loadConfig,
    loadLLMProviders: store.loadLLMProviders,
    loadSearchEngines: store.loadSearchEngines,
    handleUpsertLLMProvider: store.handleUpsertLLMProvider,
    handleDeleteLLMProvider: store.handleDeleteLLMProvider,
    handleUpsertMarketSearchEngine: store.handleUpsertMarketSearchEngine,
    handleDeleteMarketSearchEngine: store.handleDeleteMarketSearchEngine,
    handleSetDefaultMarketSearchEngine: store.handleSetDefaultMarketSearchEngine,
    handleSetMainFlowProviders: store.handleSetMainFlowProviders,
    handleSaveMemoryConfig: store.handleSaveMemoryConfig,
    handleSaveRuntimeConfig: store.handleSaveRuntimeConfig,
    handleRestartPm2: store.handleRestartPm2,
    handlePullRepo: store.handlePullRepo,
    handleBuildRepo: store.handleBuildRepo,
    handleDeployRepo: store.handleDeployRepo
  })));

  return {
    config: state.config,
    models: state.models,
    llmProviderStore: state.llmProviderStore,
    searchEngineStore: state.marketSearchEngineStore,
    savingLLMProvider: state.savingLLMProvider,
    deletingLLMProviderId: state.deletingLLMProviderId,
    savingSearchEngine: state.savingMarketSearchEngine,
    deletingSearchEngineId: state.deletingMarketSearchEngineId,
    updatingMainFlowProviders: state.updatingMainFlowProviders,
    memoryDraft: state.memoryDraft,
    runtimeDraft: state.runtimeDraft,
    operationState: state.systemOperationState,
    savingMemoryConfig: state.savingMemoryConfig,
    savingRuntimeConfig: state.savingRuntimeConfig,
    onMemoryDraftChange: <K extends keyof SystemMemoryDraft>(key: K, value: SystemMemoryDraft[K]) => {
      state.setMemoryDraft((prev) => ({ ...prev, [key]: value }));
    },
    onRuntimeDraftChange: <K extends keyof SystemRuntimeDraft>(key: K, value: SystemRuntimeDraft[K]) => {
      state.setRuntimeDraft((prev) => ({ ...prev, [key]: value }));
    },
    onRefreshModels: () => {
      void state.loadModels();
    },
    onRefreshConfig: () => {
      void state.loadConfig();
    },
    onRefreshLLMProviders: () => {
      void state.loadLLMProviders();
    },
    onRefreshSearchEngines: () => {
      void state.loadSearchEngines();
    },
    onUpsertLLMProvider: (provider: Parameters<typeof state.handleUpsertLLMProvider>[0]) => {
      void state.handleUpsertLLMProvider(provider);
    },
    onDeleteLLMProvider: (providerId: string) => {
      void state.handleDeleteLLMProvider(providerId);
    },
    onUpsertSearchEngine: (engine: Parameters<typeof state.handleUpsertMarketSearchEngine>[0]) => {
      void state.handleUpsertMarketSearchEngine(engine);
    },
    onDeleteSearchEngine: (engineId: string) => {
      void state.handleDeleteMarketSearchEngine(engineId);
    },
    onSetDefaultSearchEngine: (engineId: string) => {
      void state.handleSetDefaultMarketSearchEngine(engineId);
    },
    onSetMainFlowProviders: (selection: Parameters<typeof state.handleSetMainFlowProviders>[0]) => {
      void state.handleSetMainFlowProviders(selection);
    },
    onSaveMemoryConfig: () => {
      void state.handleSaveMemoryConfig();
    },
    onSaveRuntimeConfig: () => {
      void state.handleSaveRuntimeConfig();
    },
    onRestartPm2: () => {
      void state.handleRestartPm2();
    },
    onPullRepo: () => {
      void state.handlePullRepo();
    },
    onBuildRepo: () => {
      void state.handleBuildRepo();
    },
    onDeployRepo: () => {
      void state.handleDeployRepo();
    }
  };
}
