import { DEFAULT_DIRECT_INPUT_MAPPING_CONFIG, DEFAULT_WECOM_MENU_CONFIG } from "@/types/admin";
import type {
  AdminConfig,
  DirectInputMappingSnapshot,
  LLMProviderProfile,
  LLMProviderStore,
  SearchEngineProfile,
  SearchEngineStore,
  SystemMemoryDraft,
  SystemOperationState,
  SystemRuntimeDraft,
  WeComMenuSnapshot
} from "@/types/admin";
import { request } from "../adminApi";
import {
  isLikelyRestartConnectionDrop,
  normalizeConversationMode,
  normalizeDirectInputMappingConfig,
  normalizeStorageDriver,
  resolveConversationContextSelection,
  normalizeStringList,
  normalizeWeComMenuConfig,
  normalizeWeComMenuEvents
} from "../systemAdminUtils";
import type { AdminSliceCreator } from "./types";
import type { AdminSystemSlice, StateUpdater } from "./slices";

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

function toErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "unknown error");
}

function resolveUpdater<T>(updater: StateUpdater<T>, prev: T): T {
  if (typeof updater === "function") {
    return (updater as (value: T) => T)(prev);
  }
  return updater;
}

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
  const availableSkillNames = config?.conversationContext?.availableSkills?.map((item) => item.name) ?? [];
  const availableToolNames = config?.conversationContext?.availableTools?.map((item) => item.name) ?? [];
  return {
    storageDriver: normalizeStorageDriver(String(config?.storageDriver ?? "")),
    storageSqlitePath: String(config?.storageSqlitePath ?? "data/storage/metadata.sqlite").trim(),
    mainConversationMode: normalizeConversationMode(String(config?.mainConversationMode ?? "")),
    conversationWindowTimeoutSeconds: String(config?.conversationWindowTimeoutSeconds ?? "180").trim(),
    conversationWindowMaxTurns: String(config?.conversationWindowMaxTurns ?? "6").trim(),
    conversationAgentMaxSteps: String(config?.conversationAgentMaxSteps ?? "4").trim(),
    selectedSkillNames: resolveConversationContextSelection(
      config?.conversationContext?.config?.selectedSkillNames,
      availableSkillNames
    ),
    selectedToolNames: resolveConversationContextSelection(
      config?.conversationContext?.config?.selectedToolNames,
      availableToolNames
    )
  };
}

export const createSystemSlice: AdminSliceCreator<AdminSystemSlice> = (set, get) => {
  const setOperationState = (patch: Partial<SystemOperationState>): void => {
    set((state) => ({
      systemOperationState: {
        ...state.systemOperationState,
        ...patch
      }
    }));
  };

  const applyWeComMenuPayload = (payload: WeComMenuSnapshot): void => {
    set({
      wecomMenuConfig: normalizeWeComMenuConfig(payload.config),
      wecomMenuEvents: normalizeWeComMenuEvents(payload.recentEvents),
      wecomMenuPublishPayload: payload.publishPayload ?? null,
      wecomMenuValidationErrors: normalizeStringList(payload.validationErrors)
    });
  };

  return {
    codexDraft: buildCodexDraft(null),
    memoryDraft: buildMemoryDraft(null),
    runtimeDraft: buildRuntimeDraft(null),
    systemOperationState: {
      restarting: false,
      pullingRepo: false,
      buildingRepo: false,
      deployingRepo: false
    },
    savingLLMProvider: false,
    deletingLLMProviderId: "",
    savingMarketSearchEngine: false,
    deletingMarketSearchEngineId: "",
    updatingMainFlowProviders: false,
    savingCodexConfig: false,
    savingMemoryConfig: false,
    savingRuntimeConfig: false,
    directInputMappingConfig: DEFAULT_DIRECT_INPUT_MAPPING_CONFIG,
    savingDirectInputMappings: false,
    wecomMenuConfig: DEFAULT_WECOM_MENU_CONFIG,
    wecomMenuEvents: [],
    wecomMenuPublishPayload: null,
    wecomMenuValidationErrors: [],
    savingWecomMenu: false,
    publishingWecomMenu: false,
    syncSystemDraftsFromConfig: (config) => {
      set({
        codexDraft: buildCodexDraft(config),
        memoryDraft: buildMemoryDraft(config),
        runtimeDraft: buildRuntimeDraft(config)
      });
    },
    setCodexDraft: (value) => {
      set((state) => ({
        codexDraft: resolveUpdater(value, state.codexDraft)
      }));
    },
    setMemoryDraft: (value) => {
      set((state) => ({
        memoryDraft: resolveUpdater(value, state.memoryDraft)
      }));
    },
    setRuntimeDraft: (value) => {
      set((state) => ({
        runtimeDraft: resolveUpdater(value, state.runtimeDraft)
      }));
    },
    setDirectInputMappingConfig: (config) => {
      set({
        directInputMappingConfig: normalizeDirectInputMappingConfig(config)
      });
    },
    setWecomMenuConfig: (config) => {
      set({
        wecomMenuConfig: normalizeWeComMenuConfig(config)
      });
    },
    loadDirectInputMappings: async () => {
      const payload = await request<DirectInputMappingSnapshot>("/admin/api/direct-input-mappings");
      set({
        directInputMappingConfig: normalizeDirectInputMappingConfig(payload.config)
      });
    },
    loadWeComMenu: async () => {
      const payload = await request<WeComMenuSnapshot>("/admin/api/wecom/menu");
      applyWeComMenuPayload(payload);
    },
    handleUpsertLLMProvider: async (provider) => {
      set({ savingLLMProvider: true });
      try {
        const payload = await request<LlmProvidersResponse>("/admin/api/llm/providers", {
          method: "PUT",
          body: JSON.stringify({ provider })
        });
        get().applyLlmProvidersPayload(payload);
        get().setNotice({ type: "success", title: "LLM Provider 已保存" });
      } catch (error) {
        get().setNotice({ type: "error", title: "保存 LLM Provider 失败", text: toErrorText(error) });
      } finally {
        set({ savingLLMProvider: false });
      }
    },
    handleDeleteLLMProvider: async (providerId) => {
      set({ deletingLLMProviderId: providerId });
      try {
        const payload = await request<LlmProvidersResponse>(`/admin/api/llm/providers/${encodeURIComponent(providerId)}`, {
          method: "DELETE"
        });
        get().applyLlmProvidersPayload(payload);
        get().setNotice({ type: "success", title: "LLM Provider 已删除" });
      } catch (error) {
        get().setNotice({ type: "error", title: "删除 LLM Provider 失败", text: toErrorText(error) });
      } finally {
        set({ deletingLLMProviderId: "" });
      }
    },
    handleSetMainFlowProviders: async (selection) => {
      set({ updatingMainFlowProviders: true });
      try {
        const payload = await request<LlmProvidersResponse>("/admin/api/llm/providers/default", {
          method: "POST",
          body: JSON.stringify(selection)
        });
        get().applyLlmProvidersPayload(payload);
        get().setNotice({ type: "success", title: "主流程 Provider 选择已保存" });
      } catch (error) {
        get().setNotice({ type: "error", title: "保存主流程 Provider 失败", text: toErrorText(error) });
      } finally {
        set({ updatingMainFlowProviders: false });
      }
    },
    handleUpsertMarketSearchEngine: async (engine) => {
      set({ savingMarketSearchEngine: true });
      try {
        const payload = await request<SearchEnginesResponse>("/admin/api/search-engines", {
          method: "PUT",
          body: JSON.stringify({ engine })
        });
        get().applySearchEnginesPayload(payload);
        get().setNotice({ type: "success", title: "Search Engine 配置已保存" });
      } catch (error) {
        get().setNotice({ type: "error", title: "保存 Search Engine 配置失败", text: toErrorText(error) });
      } finally {
        set({ savingMarketSearchEngine: false });
      }
    },
    handleDeleteMarketSearchEngine: async (engineId) => {
      set({ deletingMarketSearchEngineId: engineId });
      try {
        const payload = await request<SearchEnginesResponse>(`/admin/api/search-engines/${encodeURIComponent(engineId)}`, {
          method: "DELETE"
        });
        get().applySearchEnginesPayload(payload);
        get().setNotice({ type: "success", title: "Search Engine 已删除" });
      } catch (error) {
        get().setNotice({ type: "error", title: "删除 Search Engine 失败", text: toErrorText(error) });
      } finally {
        set({ deletingMarketSearchEngineId: "" });
      }
    },
    handleSetDefaultMarketSearchEngine: async (engineId) => {
      set({ savingMarketSearchEngine: true });
      try {
        const payload = await request<SearchEnginesResponse>("/admin/api/search-engines/default", {
          method: "POST",
          body: JSON.stringify({ engineId })
        });
        get().applySearchEnginesPayload(payload);
        get().setNotice({ type: "success", title: "默认 Search Engine 已更新" });
      } catch (error) {
        get().setNotice({ type: "error", title: "更新默认 Search Engine 失败", text: toErrorText(error) });
      } finally {
        set({ savingMarketSearchEngine: false });
      }
    },
    handleRestartPm2: async () => {
      setOperationState({ restarting: true });
      try {
        const payload = await request<{ output?: string; accepted?: boolean; delayMs?: number }>("/admin/api/restart", {
          method: "POST",
          body: "{}"
        });
        const delayText = payload.delayMs && payload.delayMs > 0 ? `，预计 ${payload.delayMs}ms 后执行` : "";
        get().setNotice({
          type: "info",
          title: payload.accepted ? "重启指令已受理" : "应用进程重启完成",
          text: payload.output
            ? `${payload.output}${delayText}`
            : `服务可能会短暂断连，属于正常现象${delayText}`
        });
      } catch (error) {
        if (isLikelyRestartConnectionDrop(error)) {
          get().setNotice({
            type: "info",
            title: "重启过程中连接中断",
            text: "已触发 pm2 restart，请稍等 3-10 秒后刷新页面。"
          });
        } else {
          get().setNotice({ type: "error", title: "pm2 重启失败", text: toErrorText(error) });
        }
      } finally {
        setOperationState({ restarting: false });
      }
    },
    handleSaveCodexConfig: async () => {
      const model = get().codexDraft.model.trim();
      const reasoningEffort = get().codexDraft.reasoningEffort.trim().toLowerCase();
      if (reasoningEffort) {
        const allowedValues = new Set(["minimal", "low", "medium", "high", "xhigh"]);
        if (!allowedValues.has(reasoningEffort)) {
          get().setNotice({ type: "error", title: "Codex Reasoning Effort 仅支持 minimal/low/medium/high/xhigh" });
          return;
        }
      }

      set({ savingCodexConfig: true });
      try {
        await request<{ ok: boolean }>("/admin/api/config/codex", {
          method: "POST",
          body: JSON.stringify({ model, reasoningEffort })
        });
        await get().loadConfig();
        get().setNotice({ type: "success", title: "Codex 配置已保存" });
      } catch (error) {
        get().setNotice({ type: "error", title: "保存 Codex 配置失败", text: toErrorText(error) });
      } finally {
        set({ savingCodexConfig: false });
      }
    },
    handleSaveMemoryConfig: async () => {
      set({ savingMemoryConfig: true });
      try {
        await request<{ ok: boolean }>("/admin/api/config/memory", {
          method: "POST",
          body: JSON.stringify({
            llmMemoryContextEnabled: get().memoryDraft.llmMemoryContextEnabled,
            memoryCompactEveryRounds: get().memoryDraft.memoryCompactEveryRounds.trim(),
            memoryCompactMaxBatchSize: get().memoryDraft.memoryCompactMaxBatchSize.trim(),
            memorySummaryTopK: get().memoryDraft.memorySummaryTopK.trim(),
            memoryRawRefLimit: get().memoryDraft.memoryRawRefLimit.trim(),
            memoryRawRecordLimit: get().memoryDraft.memoryRawRecordLimit.trim()
          })
        });
        await get().loadConfig();
        get().setNotice({ type: "success", title: "Memory 配置已保存" });
      } catch (error) {
        get().setNotice({ type: "error", title: "保存 Memory 配置失败", text: toErrorText(error) });
      } finally {
        set({ savingMemoryConfig: false });
      }
    },
    handleSaveRuntimeConfig: async () => {
      set({ savingRuntimeConfig: true });
      try {
        await request<{ ok: boolean }>("/admin/api/config/runtime", {
          method: "POST",
          body: JSON.stringify({
            storageDriver: get().runtimeDraft.storageDriver,
            storageSqlitePath: get().runtimeDraft.storageSqlitePath.trim(),
            mainConversationMode: get().runtimeDraft.mainConversationMode,
            conversationWindowTimeoutSeconds: get().runtimeDraft.conversationWindowTimeoutSeconds.trim(),
            conversationWindowMaxTurns: get().runtimeDraft.conversationWindowMaxTurns.trim(),
            conversationAgentMaxSteps: get().runtimeDraft.conversationAgentMaxSteps.trim(),
            selectedSkillNames: get().runtimeDraft.selectedSkillNames,
            selectedToolNames: get().runtimeDraft.selectedToolNames
          })
        });
        await get().loadConfig();
        get().setNotice({ type: "success", title: "运行时配置已保存" });
      } catch (error) {
        get().setNotice({ type: "error", title: "保存运行时配置失败", text: toErrorText(error) });
      } finally {
        set({ savingRuntimeConfig: false });
      }
    },
    handlePullRepo: async () => {
      setOperationState({ pullingRepo: true });
      try {
        const payload = await request<{
          ok: boolean;
          cwd: string;
          pullCommand: string;
          pullOutput: string;
        }>("/admin/api/repo/pull", {
          method: "POST",
          body: "{}"
        });
        get().setNotice({
          type: "success",
          title: "远端代码同步完成",
          text: [`执行命令: ${payload.pullCommand}`, `工作目录: ${payload.cwd}`, payload.pullOutput].filter(Boolean).join("\n\n")
        });
      } catch (error) {
        get().setNotice({ type: "error", title: "同步远端代码失败", text: toErrorText(error) });
      } finally {
        setOperationState({ pullingRepo: false });
      }
    },
    handleBuildRepo: async () => {
      setOperationState({ buildingRepo: true });
      try {
        const payload = await request<{
          ok: boolean;
          cwd: string;
          installCommand: string;
          installOutput: string;
          buildOutput: string;
        }>("/admin/api/repo/build", {
          method: "POST",
          body: "{}"
        });
        get().setNotice({
          type: "success",
          title: "依赖安装 + 项目构建完成",
          text: [
            `工作目录: ${payload.cwd}`,
            `执行命令: ${payload.installCommand}`,
            payload.installOutput,
            payload.buildOutput
          ]
            .filter(Boolean)
            .join("\n\n")
        });
      } catch (error) {
        get().setNotice({ type: "error", title: "执行项目构建失败", text: toErrorText(error) });
      } finally {
        setOperationState({ buildingRepo: false });
      }
    },
    handleDeployRepo: async () => {
      setOperationState({ deployingRepo: true });
      try {
        const payload = await request<{
          ok: boolean;
          cwd: string;
          pullCommand: string;
          pullOutput: string;
          installCommand: string;
          installOutput: string;
          buildOutput: string;
          restartOutput: string;
        }>("/admin/api/repo/deploy", {
          method: "POST",
          body: "{}"
        });
        get().setNotice({
          type: "success",
          title: "一键部署完成",
          text: [
            `执行命令: ${payload.pullCommand}`,
            `工作目录: ${payload.cwd}`,
            payload.pullOutput,
            `执行命令: ${payload.installCommand}`,
            payload.installOutput,
            payload.buildOutput,
            payload.restartOutput
          ]
            .filter(Boolean)
            .join("\n\n")
        });
      } catch (error) {
        get().setNotice({ type: "error", title: "一键部署失败", text: toErrorText(error) });
      } finally {
        setOperationState({ deployingRepo: false });
      }
    },
    handleSaveWeComMenu: async () => {
      set({ savingWecomMenu: true });
      try {
        const payload = await request<WeComMenuSnapshot>("/admin/api/wecom/menu", {
          method: "PUT",
          body: JSON.stringify({ config: get().wecomMenuConfig })
        });
        applyWeComMenuPayload(payload);
        get().setNotice({ type: "success", title: "企业微信菜单配置已保存" });
      } catch (error) {
        get().setNotice({ type: "error", title: "保存企业微信菜单失败", text: toErrorText(error) });
      } finally {
        set({ savingWecomMenu: false });
      }
    },
    handleSaveDirectInputMappings: async () => {
      set({ savingDirectInputMappings: true });
      try {
        const payload = await request<DirectInputMappingSnapshot>("/admin/api/direct-input-mappings", {
          method: "PUT",
          body: JSON.stringify({ config: get().directInputMappingConfig })
        });
        set({
          directInputMappingConfig: normalizeDirectInputMappingConfig(payload.config)
        });
        get().setNotice({ type: "success", title: "输入映射配置已保存" });
      } catch (error) {
        get().setNotice({ type: "error", title: "保存输入映射失败", text: toErrorText(error) });
      } finally {
        set({ savingDirectInputMappings: false });
      }
    },
    handlePublishWeComMenu: async () => {
      set({ publishingWecomMenu: true });
      try {
        const payload = await request<WeComMenuSnapshot>("/admin/api/wecom/menu/publish", {
          method: "POST",
          body: JSON.stringify({ config: get().wecomMenuConfig })
        });
        applyWeComMenuPayload(payload);
        get().setNotice({ type: "success", title: "企业微信菜单已发布" });
      } catch (error) {
        get().setNotice({ type: "error", title: "发布企业微信菜单失败", text: toErrorText(error) });
      } finally {
        set({ publishingWecomMenu: false });
      }
    }
  };
};
