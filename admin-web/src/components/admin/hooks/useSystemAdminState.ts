import { useEffect, useState } from "react";
import type {
  AdminConfig,
  DirectInputMappingConfig,
  DirectInputMappingSnapshot,
  LLMProviderProfile,
  LLMProviderStore,
  Notice,
  SearchEngineProfile,
  SearchEngineStore,
  WeComMenuConfig,
  WeComMenuEventRecord,
  WeComMenuPublishPayload,
  WeComMenuSnapshot
} from "@/types/admin";
import { DEFAULT_DIRECT_INPUT_MAPPING_CONFIG, DEFAULT_WECOM_MENU_CONFIG } from "@/types/admin";
import type { SystemMemoryDraft, SystemRuntimeDraft } from "../SystemSection";
import { request } from "./adminApi";
import {
  normalizeConversationMode,
  normalizeDirectInputMappingConfig,
  normalizeStorageDriver,
  normalizeStringList,
  normalizeWeComMenuConfig,
  normalizeWeComMenuEvents
} from "./systemAdminUtils";
import { useSystemOperationsState } from "./useSystemOperationsState";

type NoticeSetter = React.Dispatch<React.SetStateAction<Notice>>;

type MainFlowProviderSelectionDraft = {
  defaultProviderId: string;
  routingProviderId: string;
  planningProviderId: string;
};

type UseSystemAdminStateArgs = {
  config: AdminConfig | null;
  setConfig: React.Dispatch<React.SetStateAction<AdminConfig | null>>;
  models: string[];
  llmProviderStore: LLMProviderStore | null;
  setLlmProviderStore: React.Dispatch<React.SetStateAction<LLMProviderStore | null>>;
  marketSearchEngineStore: SearchEngineStore | null;
  setMarketSearchEngineStore: React.Dispatch<React.SetStateAction<SearchEngineStore | null>>;
  loadConfig: () => Promise<unknown>;
  loadLLMProviders: () => Promise<unknown>;
  loadSearchEngines: () => Promise<unknown>;
  setNotice: NoticeSetter;
};

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

function buildCodexDraft(config: AdminConfig | null): { model: string; reasoningEffort: string } {
  return {
    model: String(config?.codexModel ?? "").trim(),
    reasoningEffort: String(config?.codexReasoningEffort ?? "").trim()
  };
}

function buildMemoryDraft(config: AdminConfig | null): SystemMemoryDraft {
  return {
    llmMemoryContextEnabled: config?.llmMemoryContextEnabled ?? true,
    memoryCompactEveryRounds: String(config?.memoryCompactEveryRounds ?? "").trim(),
    memoryCompactMaxBatchSize: String(config?.memoryCompactMaxBatchSize ?? "").trim(),
    memorySummaryTopK: String(config?.memorySummaryTopK ?? "").trim(),
    memoryRawRefLimit: String(config?.memoryRawRefLimit ?? "").trim(),
    memoryRawRecordLimit: String(config?.memoryRawRecordLimit ?? "").trim()
  };
}

function buildRuntimeDraft(config: AdminConfig | null): SystemRuntimeDraft {
  return {
    storageDriver: normalizeStorageDriver(String(config?.storageDriver ?? "")),
    storageSqlitePath: String(config?.storageSqlitePath ?? "data/storage/metadata.sqlite").trim(),
    mainConversationMode: normalizeConversationMode(String(config?.mainConversationMode ?? "")),
    conversationWindowTimeoutSeconds: String(config?.conversationWindowTimeoutSeconds ?? "180").trim(),
    conversationWindowMaxTurns: String(config?.conversationWindowMaxTurns ?? "6").trim(),
    conversationAgentMaxSteps: String(config?.conversationAgentMaxSteps ?? "4").trim()
  };
}

function toErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "unknown error");
}

export function useSystemAdminState(args: UseSystemAdminStateArgs) {
  const operations = useSystemOperationsState({ setNotice: args.setNotice });
  const [codexDraft, setCodexDraft] = useState(() => buildCodexDraft(args.config));
  const [memoryDraft, setMemoryDraft] = useState<SystemMemoryDraft>(() => buildMemoryDraft(args.config));
  const [runtimeDraft, setRuntimeDraft] = useState<SystemRuntimeDraft>(() => buildRuntimeDraft(args.config));
  const [savingLLMProvider, setSavingLLMProvider] = useState(false);
  const [deletingLLMProviderId, setDeletingLLMProviderId] = useState("");
  const [savingMarketSearchEngine, setSavingMarketSearchEngine] = useState(false);
  const [deletingMarketSearchEngineId, setDeletingMarketSearchEngineId] = useState("");
  const [updatingMainFlowProviders, setUpdatingMainFlowProviders] = useState(false);
  const [savingCodexConfig, setSavingCodexConfig] = useState(false);
  const [savingMemoryConfig, setSavingMemoryConfig] = useState(false);
  const [savingRuntimeConfig, setSavingRuntimeConfig] = useState(false);
  const [directInputMappingConfig, setDirectInputMappingConfig] = useState<DirectInputMappingConfig>(
    DEFAULT_DIRECT_INPUT_MAPPING_CONFIG
  );
  const [savingDirectInputMappings, setSavingDirectInputMappings] = useState(false);
  const [wecomMenuConfig, setWecomMenuConfig] = useState<WeComMenuConfig>(DEFAULT_WECOM_MENU_CONFIG);
  const [wecomMenuEvents, setWecomMenuEvents] = useState<WeComMenuEventRecord[]>([]);
  const [wecomMenuPublishPayload, setWecomMenuPublishPayload] = useState<WeComMenuPublishPayload | null>(null);
  const [wecomMenuValidationErrors, setWecomMenuValidationErrors] = useState<string[]>([]);
  const [savingWecomMenu, setSavingWecomMenu] = useState(false);
  const [publishingWecomMenu, setPublishingWecomMenu] = useState(false);

  useEffect(() => {
    setCodexDraft(buildCodexDraft(args.config));
    setMemoryDraft(buildMemoryDraft(args.config));
    setRuntimeDraft(buildRuntimeDraft(args.config));
  }, [
    args.config?.codexModel,
    args.config?.codexReasoningEffort,
    args.config?.llmMemoryContextEnabled,
    args.config?.memoryCompactEveryRounds,
    args.config?.memoryCompactMaxBatchSize,
    args.config?.memorySummaryTopK,
    args.config?.memoryRawRefLimit,
    args.config?.memoryRawRecordLimit,
    args.config?.storageDriver,
    args.config?.storageSqlitePath,
    args.config?.mainConversationMode,
    args.config?.conversationWindowTimeoutSeconds,
    args.config?.conversationWindowMaxTurns,
    args.config?.conversationAgentMaxSteps
  ]);

  function applyLlmProvidersPayload(payload: LlmProvidersResponse): void {
    args.setLlmProviderStore(payload.store);
    args.setConfig((prev) => {
      if (!prev) {
        return prev;
      }
      return {
        ...prev,
        llmProviders: {
          store: payload.store,
          defaultProvider: payload.defaultProvider
        }
      };
    });
  }

  function applySearchEnginesPayload(payload: SearchEnginesResponse): void {
    args.setMarketSearchEngineStore(payload.store);
    args.setConfig((prev) => {
      if (!prev) {
        return prev;
      }
      return {
        ...prev,
        searchEngines: {
          store: payload.store,
          defaultEngine: payload.defaultEngine
        }
      };
    });
  }

  function applyWeComMenuPayload(payload: WeComMenuSnapshot): void {
    setWecomMenuConfig(normalizeWeComMenuConfig(payload.config));
    setWecomMenuEvents(normalizeWeComMenuEvents(payload.recentEvents));
    setWecomMenuPublishPayload(payload.publishPayload ?? null);
    setWecomMenuValidationErrors(normalizeStringList(payload.validationErrors));
  }

  async function loadDirectInputMappings(): Promise<void> {
    const payload = await request<DirectInputMappingSnapshot>("/admin/api/direct-input-mappings");
    setDirectInputMappingConfig(normalizeDirectInputMappingConfig(payload.config));
  }

  async function loadWeComMenu(): Promise<void> {
    const payload = await request<WeComMenuSnapshot>("/admin/api/wecom/menu");
    applyWeComMenuPayload(payload);
  }

  async function handleUpsertLLMProvider(provider: LLMProviderProfile): Promise<void> {
    setSavingLLMProvider(true);
    try {
      const payload = await request<LlmProvidersResponse>("/admin/api/llm/providers", {
        method: "PUT",
        body: JSON.stringify({ provider })
      });
      applyLlmProvidersPayload(payload);
      args.setNotice({ type: "success", title: "LLM Provider 已保存" });
    } catch (error) {
      args.setNotice({ type: "error", title: "保存 LLM Provider 失败", text: toErrorText(error) });
    } finally {
      setSavingLLMProvider(false);
    }
  }

  async function handleDeleteLLMProvider(providerId: string): Promise<void> {
    setDeletingLLMProviderId(providerId);
    try {
      const payload = await request<LlmProvidersResponse>(`/admin/api/llm/providers/${encodeURIComponent(providerId)}`, {
        method: "DELETE"
      });
      applyLlmProvidersPayload(payload);
      args.setNotice({ type: "success", title: "LLM Provider 已删除" });
    } catch (error) {
      args.setNotice({ type: "error", title: "删除 LLM Provider 失败", text: toErrorText(error) });
    } finally {
      setDeletingLLMProviderId("");
    }
  }

  async function handleSetMainFlowProviders(selection: MainFlowProviderSelectionDraft): Promise<void> {
    setUpdatingMainFlowProviders(true);
    try {
      const payload = await request<LlmProvidersResponse>("/admin/api/llm/providers/default", {
        method: "POST",
        body: JSON.stringify(selection)
      });
      applyLlmProvidersPayload(payload);
      args.setNotice({ type: "success", title: "主流程 Provider 选择已保存" });
    } catch (error) {
      args.setNotice({ type: "error", title: "保存主流程 Provider 失败", text: toErrorText(error) });
    } finally {
      setUpdatingMainFlowProviders(false);
    }
  }

  async function handleUpsertMarketSearchEngine(engine: SearchEngineProfile): Promise<void> {
    setSavingMarketSearchEngine(true);
    try {
      const payload = await request<SearchEnginesResponse>("/admin/api/search-engines", {
        method: "PUT",
        body: JSON.stringify({ engine })
      });
      applySearchEnginesPayload(payload);
      args.setNotice({ type: "success", title: "Search Engine 配置已保存" });
    } catch (error) {
      args.setNotice({ type: "error", title: "保存 Search Engine 配置失败", text: toErrorText(error) });
    } finally {
      setSavingMarketSearchEngine(false);
    }
  }

  async function handleDeleteMarketSearchEngine(engineId: string): Promise<void> {
    setDeletingMarketSearchEngineId(engineId);
    try {
      const payload = await request<SearchEnginesResponse>(`/admin/api/search-engines/${encodeURIComponent(engineId)}`, {
        method: "DELETE"
      });
      applySearchEnginesPayload(payload);
      args.setNotice({ type: "success", title: "Search Engine 已删除" });
    } catch (error) {
      args.setNotice({ type: "error", title: "删除 Search Engine 失败", text: toErrorText(error) });
    } finally {
      setDeletingMarketSearchEngineId("");
    }
  }

  async function handleSetDefaultMarketSearchEngine(engineId: string): Promise<void> {
    setSavingMarketSearchEngine(true);
    try {
      const payload = await request<SearchEnginesResponse>("/admin/api/search-engines/default", {
        method: "POST",
        body: JSON.stringify({ engineId })
      });
      applySearchEnginesPayload(payload);
      args.setNotice({ type: "success", title: "默认 Search Engine 已更新" });
    } catch (error) {
      args.setNotice({ type: "error", title: "更新默认 Search Engine 失败", text: toErrorText(error) });
    } finally {
      setSavingMarketSearchEngine(false);
    }
  }

  async function handleSaveCodexConfig(): Promise<void> {
    const model = codexDraft.model.trim();
    const reasoningEffort = codexDraft.reasoningEffort.trim().toLowerCase();
    if (reasoningEffort) {
      const allowedValues = new Set(["minimal", "low", "medium", "high", "xhigh"]);
      if (!allowedValues.has(reasoningEffort)) {
        args.setNotice({ type: "error", title: "Codex Reasoning Effort 仅支持 minimal/low/medium/high/xhigh" });
        return;
      }
    }

    setSavingCodexConfig(true);
    try {
      await request<{ ok: boolean }>("/admin/api/config/codex", {
        method: "POST",
        body: JSON.stringify({ model, reasoningEffort })
      });
      await args.loadConfig();
      args.setNotice({ type: "success", title: "Codex 配置已保存" });
    } catch (error) {
      args.setNotice({ type: "error", title: "保存 Codex 配置失败", text: toErrorText(error) });
    } finally {
      setSavingCodexConfig(false);
    }
  }

  async function handleSaveMemoryConfig(): Promise<void> {
    setSavingMemoryConfig(true);
    try {
      await request<{ ok: boolean }>("/admin/api/config/memory", {
        method: "POST",
        body: JSON.stringify({
          llmMemoryContextEnabled: memoryDraft.llmMemoryContextEnabled,
          memoryCompactEveryRounds: memoryDraft.memoryCompactEveryRounds.trim(),
          memoryCompactMaxBatchSize: memoryDraft.memoryCompactMaxBatchSize.trim(),
          memorySummaryTopK: memoryDraft.memorySummaryTopK.trim(),
          memoryRawRefLimit: memoryDraft.memoryRawRefLimit.trim(),
          memoryRawRecordLimit: memoryDraft.memoryRawRecordLimit.trim()
        })
      });
      await args.loadConfig();
      args.setNotice({ type: "success", title: "Memory 配置已保存" });
    } catch (error) {
      args.setNotice({ type: "error", title: "保存 Memory 配置失败", text: toErrorText(error) });
    } finally {
      setSavingMemoryConfig(false);
    }
  }

  async function handleSaveRuntimeConfig(): Promise<void> {
    setSavingRuntimeConfig(true);
    try {
      await request<{ ok: boolean }>("/admin/api/config/runtime", {
        method: "POST",
        body: JSON.stringify({
          storageDriver: runtimeDraft.storageDriver,
          storageSqlitePath: runtimeDraft.storageSqlitePath.trim(),
          mainConversationMode: runtimeDraft.mainConversationMode,
          conversationWindowTimeoutSeconds: runtimeDraft.conversationWindowTimeoutSeconds.trim(),
          conversationWindowMaxTurns: runtimeDraft.conversationWindowMaxTurns.trim(),
          conversationAgentMaxSteps: runtimeDraft.conversationAgentMaxSteps.trim()
        })
      });
      await args.loadConfig();
      args.setNotice({ type: "success", title: "运行时配置已保存" });
    } catch (error) {
      args.setNotice({ type: "error", title: "保存运行时配置失败", text: toErrorText(error) });
    } finally {
      setSavingRuntimeConfig(false);
    }
  }

  async function handleSaveWeComMenu(): Promise<void> {
    setSavingWecomMenu(true);
    try {
      const payload = await request<WeComMenuSnapshot>("/admin/api/wecom/menu", {
        method: "PUT",
        body: JSON.stringify({ config: wecomMenuConfig })
      });
      applyWeComMenuPayload(payload);
      args.setNotice({ type: "success", title: "企业微信菜单配置已保存" });
    } catch (error) {
      args.setNotice({ type: "error", title: "保存企业微信菜单失败", text: toErrorText(error) });
    } finally {
      setSavingWecomMenu(false);
    }
  }

  async function handleSaveDirectInputMappings(): Promise<void> {
    setSavingDirectInputMappings(true);
    try {
      const payload = await request<DirectInputMappingSnapshot>("/admin/api/direct-input-mappings", {
        method: "PUT",
        body: JSON.stringify({ config: directInputMappingConfig })
      });
      setDirectInputMappingConfig(normalizeDirectInputMappingConfig(payload.config));
      args.setNotice({ type: "success", title: "输入映射配置已保存" });
    } catch (error) {
      args.setNotice({ type: "error", title: "保存输入映射失败", text: toErrorText(error) });
    } finally {
      setSavingDirectInputMappings(false);
    }
  }

  async function handlePublishWeComMenu(): Promise<void> {
    setPublishingWecomMenu(true);
    try {
      const payload = await request<WeComMenuSnapshot>("/admin/api/wecom/menu/publish", {
        method: "POST",
        body: JSON.stringify({ config: wecomMenuConfig })
      });
      applyWeComMenuPayload(payload);
      args.setNotice({ type: "success", title: "企业微信菜单已发布" });
    } catch (error) {
      args.setNotice({ type: "error", title: "发布企业微信菜单失败", text: toErrorText(error) });
    } finally {
      setPublishingWecomMenu(false);
    }
  }

  return {
    codexDraft,
    setCodexDraft,
    memoryDraft,
    setMemoryDraft,
    runtimeDraft,
    setRuntimeDraft,
    systemOperationState: operations.systemOperationState,
    savingLLMProvider,
    deletingLLMProviderId,
    savingMarketSearchEngine,
    deletingMarketSearchEngineId,
    updatingMainFlowProviders,
    savingCodexConfig,
    savingMemoryConfig,
    savingRuntimeConfig,
    directInputMappingConfig,
    setDirectInputMappingConfig,
    savingDirectInputMappings,
    wecomMenuConfig,
    setWecomMenuConfig,
    wecomMenuEvents,
    wecomMenuPublishPayload,
    wecomMenuValidationErrors,
    savingWecomMenu,
    publishingWecomMenu,
    loadDirectInputMappings,
    loadWeComMenu,
    handleUpsertLLMProvider,
    handleDeleteLLMProvider,
    handleSetMainFlowProviders,
    handleUpsertMarketSearchEngine,
    handleDeleteMarketSearchEngine,
    handleSetDefaultMarketSearchEngine,
    handleRestartPm2: operations.handleRestartPm2,
    handleSaveCodexConfig,
    handleSaveMemoryConfig,
    handleSaveRuntimeConfig,
    handlePullRepo: operations.handlePullRepo,
    handleBuildRepo: operations.handleBuildRepo,
    handleDeployRepo: operations.handleDeployRepo,
    handleSaveWeComMenu,
    handleSaveDirectInputMappings,
    handlePublishWeComMenu
  };
}
