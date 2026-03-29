import { useCallback } from "react";
import { useEvolutionAdminState } from "./useEvolutionAdminState";
import { useMarketAdminState } from "./useMarketAdminState";
import { useMessagesAdminState } from "./useMessagesAdminState";
import { useSharedAdminState } from "./useSharedAdminState";
import { useSystemAdminState } from "./useSystemAdminState";
import { useTopicAdminState } from "./useTopicAdminState";
import { useWritingAdminState } from "./useWritingAdminState";

export function useAdminPageState() {
  const shared = useSharedAdminState();
  const messages = useMessagesAdminState({ setNotice: shared.setNotice });
  const system = useSystemAdminState({
    config: shared.config,
    setConfig: shared.setConfig,
    models: shared.models,
    llmProviderStore: shared.llmProviderStore,
    setLlmProviderStore: shared.setLlmProviderStore,
    marketSearchEngineStore: shared.marketSearchEngineStore,
    setMarketSearchEngineStore: shared.setMarketSearchEngineStore,
    loadConfig: shared.loadConfig,
    loadLLMProviders: shared.loadLLMProviders,
    loadSearchEngines: shared.loadSearchEngines,
    setNotice: shared.setNotice
  });
  const market = useMarketAdminState({
    llmProviderStore: shared.llmProviderStore,
    marketSearchEngineStore: shared.marketSearchEngineStore,
    users: messages.users,
    loadTasks: messages.loadTasks,
    setNotice: shared.setNotice
  });
  const topic = useTopicAdminState({
    llmProviderStore: shared.llmProviderStore,
    setNotice: shared.setNotice
  });
  const writing = useWritingAdminState({ setNotice: shared.setNotice });
  const evolution = useEvolutionAdminState({ setNotice: shared.setNotice });

  const bootstrap = useCallback(async (): Promise<void> => {
    try {
      const resolvedStores = await shared.loadConfig();
      await Promise.all([
        shared.loadModels(),
        system.loadDirectInputMappings(),
        system.loadWeComMenu(),
        messages.loadUsers(),
        messages.loadTasks(),
        market.loadMarketConfig({
          llmProviderStore: resolvedStores.llmProviderStore,
          marketSearchEngineStore: resolvedStores.marketSearchEngineStore
        }),
        market.loadMarketRuns(),
        topic.loadTopicSummaryConfig({
          llmProviderStore: resolvedStores.llmProviderStore
        }),
        writing.loadWritingTopics(),
        evolution.loadEvolutionState({ silent: true })
      ]);
      shared.setNotice(null);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error ?? "unknown error");
      shared.setNotice({ type: "error", title: "初始化失败", text });
    }
  }, [evolution, market, messages, shared, system, topic, writing]);

  return {
    ...shared,
    ...messages,
    ...system,
    ...market,
    ...topic,
    ...writing,
    ...evolution,
    bootstrap
  };
}
