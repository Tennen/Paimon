import { useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { EvolutionSection } from "@/components/admin/EvolutionSection";
import { FeatureMenu } from "@/components/admin/FeatureMenu";
import { MarketSection } from "@/components/admin/MarketSection";
import { MessagesSection } from "@/components/admin/MessagesSection";
import { SystemSection } from "@/components/admin/SystemSection";
import type {
  MainFlowProviderSelectionDraft,
  SystemMemoryDraft,
  SystemOperationState,
  SystemRuntimeDraft
} from "@/components/admin/SystemSection";
import { TopicSummarySection } from "@/components/admin/TopicSummarySection";
import { WritingOrganizerSection } from "@/components/admin/WritingOrganizerSection";
import { buildEvolutionQueueRows } from "@/lib/evolutionQueueRows";
import {
  AdminConfig,
  DEFAULT_TOPIC_SUMMARY_CONFIG,
  DEFAULT_TOPIC_SUMMARY_STATE,
  DEFAULT_MARKET_ANALYSIS_CONFIG,
  DEFAULT_MARKET_PORTFOLIO,
  EMPTY_TASK_FORM,
  EMPTY_USER_FORM,
  EvolutionGoal,
  EvolutionStateSnapshot,
  MarketConfig,
  MarketAnalysisConfig,
  MarketAnalysisAssetType,
  MarketAnalysisEngine,
  MarketFundRiskLevel,
  MarketFundHolding,
  MarketPhase,
  MarketPortfolio,
  MarketPortfolioImportResponse,
  MarketRunOnceResponse,
  MarketRunSummary,
  SearchEngineProfile,
  SearchEngineStore,
  MarketSecuritySearchItem,
  LLMProviderProfile,
  LLMProviderStore,
  MenuKey,
  Notice,
  PushUser,
  ScheduledTask,
  TaskFormState,
  TopicSummaryCategory,
  TopicSummaryConfig,
  TopicSummaryDigestLanguage,
  TopicSummaryProfile,
  TopicSummaryProfilesPayload,
  TopicSummaryEngine,
  TopicSummarySource,
  TopicSummaryState,
  WritingStateSection,
  WritingTopicDetail,
  WritingTopicMeta,
  WritingTopicState,
  WritingTopicsPayload,
  UserFormState
} from "@/types/admin";

type CodexDraft = {
  model: string;
  reasoningEffort: string;
};

const EMPTY_CODEX_DRAFT: CodexDraft = {
  model: "",
  reasoningEffort: ""
};

const EMPTY_MEMORY_DRAFT: SystemMemoryDraft = {
  llmMemoryContextEnabled: true,
  memoryCompactEveryRounds: "",
  memoryCompactMaxBatchSize: "",
  memorySummaryTopK: "",
  memoryRawRefLimit: "",
  memoryRawRecordLimit: "",
  memoryRagSummaryTopK: ""
};

const EMPTY_RUNTIME_DRAFT: SystemRuntimeDraft = {
  storageDriver: "json-file",
  storageSqlitePath: "data/storage/metadata.sqlite"
};

const DEFAULT_SYSTEM_OPERATION_STATE: SystemOperationState = {
  restarting: false,
  pullingRepo: false,
  buildingRepo: false,
  deployingRepo: false
};

const DEFAULT_WRITING_TOPIC_STATE: WritingTopicState = {
  summary: "",
  outline: "",
  draft: ""
};

export default function App() {
  const [config, setConfig] = useState<AdminConfig | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [users, setUsers] = useState<PushUser[]>([]);
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [llmProviderStore, setLlmProviderStore] = useState<LLMProviderStore | null>(null);
  const [marketSearchEngineStore, setMarketSearchEngineStore] = useState<SearchEngineStore | null>(null);
  const [savingLLMProvider, setSavingLLMProvider] = useState(false);
  const [deletingLLMProviderId, setDeletingLLMProviderId] = useState("");
  const [savingMarketSearchEngine, setSavingMarketSearchEngine] = useState(false);
  const [deletingMarketSearchEngineId, setDeletingMarketSearchEngineId] = useState("");
  const [updatingMainFlowProviders, setUpdatingMainFlowProviders] = useState(false);
  const [codexDraft, setCodexDraft] = useState<CodexDraft>(EMPTY_CODEX_DRAFT);
  const [memoryDraft, setMemoryDraft] = useState<SystemMemoryDraft>(EMPTY_MEMORY_DRAFT);
  const [runtimeDraft, setRuntimeDraft] = useState<SystemRuntimeDraft>(EMPTY_RUNTIME_DRAFT);

  const [notice, setNotice] = useState<Notice>(null);

  const [systemOperationState, setSystemOperationState] = useState<SystemOperationState>(DEFAULT_SYSTEM_OPERATION_STATE);
  const [savingCodexConfig, setSavingCodexConfig] = useState(false);
  const [savingMemoryConfig, setSavingMemoryConfig] = useState(false);
  const [savingRuntimeConfig, setSavingRuntimeConfig] = useState(false);

  const [editingUserId, setEditingUserId] = useState("");
  const [savingUser, setSavingUser] = useState(false);
  const [userForm, setUserForm] = useState<UserFormState>(EMPTY_USER_FORM);

  const [editingTaskId, setEditingTaskId] = useState("");
  const [savingTask, setSavingTask] = useState(false);
  const [runningTaskId, setRunningTaskId] = useState("");
  const [taskForm, setTaskForm] = useState<TaskFormState>(EMPTY_TASK_FORM);

  const [activeMenu, setActiveMenu] = useState<MenuKey>("system");

  const [marketConfig, setMarketConfig] = useState<MarketConfig | null>(null);
  const [marketPortfolio, setMarketPortfolio] = useState<MarketPortfolio>(DEFAULT_MARKET_PORTFOLIO);
  const [marketAnalysisConfig, setMarketAnalysisConfig] = useState<MarketAnalysisConfig>(DEFAULT_MARKET_ANALYSIS_CONFIG);
  const [marketRuns, setMarketRuns] = useState<MarketRunSummary[]>([]);
  const [savingMarketPortfolio, setSavingMarketPortfolio] = useState(false);
  const [savingMarketAnalysisConfig, setSavingMarketAnalysisConfig] = useState(false);
  const [savingMarketFundIndex, setSavingMarketFundIndex] = useState<number | null>(null);
  const [marketSavedFundsByRow, setMarketSavedFundsByRow] = useState<Array<MarketFundHolding | null>>([]);
  const [marketSavedCash, setMarketSavedCash] = useState(0);
  const [bootstrappingMarketTasks, setBootstrappingMarketTasks] = useState(false);
  const [runningMarketOncePhase, setRunningMarketOncePhase] = useState<MarketPhase | null>(null);
  const [marketRunOnceWithExplanation, setMarketRunOnceWithExplanation] = useState(true);
  const [marketTaskUserId, setMarketTaskUserId] = useState("");
  const [marketMiddayTime, setMarketMiddayTime] = useState("13:30");
  const [marketCloseTime, setMarketCloseTime] = useState("15:15");
  const [marketBatchCodesInput, setMarketBatchCodesInput] = useState("");
  const [importingMarketCodes, setImportingMarketCodes] = useState(false);
  const [marketSearchInputs, setMarketSearchInputs] = useState<string[]>([]);
  const [marketSearchResults, setMarketSearchResults] = useState<MarketSecuritySearchItem[][]>([]);
  const [searchingMarketFundIndex, setSearchingMarketFundIndex] = useState<number | null>(null);
  const [topicSummaryConfig, setTopicSummaryConfig] = useState<TopicSummaryConfig>(DEFAULT_TOPIC_SUMMARY_CONFIG);
  const [topicSummaryState, setTopicSummaryState] = useState<TopicSummaryState>(DEFAULT_TOPIC_SUMMARY_STATE);
  const [topicSummaryProfiles, setTopicSummaryProfiles] = useState<TopicSummaryProfile[]>([]);
  const [topicSummaryActiveProfileId, setTopicSummaryActiveProfileId] = useState("");
  const [topicSummarySelectedProfileId, setTopicSummarySelectedProfileId] = useState("");
  const [savingTopicSummaryProfileAction, setSavingTopicSummaryProfileAction] = useState(false);
  const [savingTopicSummaryConfig, setSavingTopicSummaryConfig] = useState(false);
  const [clearingTopicSummaryState, setClearingTopicSummaryState] = useState(false);
  const [writingTopics, setWritingTopics] = useState<WritingTopicMeta[]>([]);
  const [writingSelectedTopicId, setWritingSelectedTopicId] = useState("");
  const [writingTopicIdDraft, setWritingTopicIdDraft] = useState("");
  const [writingTopicTitleDraft, setWritingTopicTitleDraft] = useState("");
  const [writingAppendDraft, setWritingAppendDraft] = useState("");
  const [writingTopicDetail, setWritingTopicDetail] = useState<WritingTopicDetail | null>(null);
  const [loadingWritingTopics, setLoadingWritingTopics] = useState(false);
  const [loadingWritingDetail, setLoadingWritingDetail] = useState(false);
  const [writingActionState, setWritingActionState] = useState<"append" | "summarize" | "restore" | "set" | null>(null);
  const [writingManualSection, setWritingManualSection] = useState<WritingStateSection>("summary");
  const [writingManualContent, setWritingManualContent] = useState("");

  const [evolutionSnapshot, setEvolutionSnapshot] = useState<EvolutionStateSnapshot | null>(null);
  const [loadingEvolution, setLoadingEvolution] = useState(false);
  const [evolutionGoalDraft, setEvolutionGoalDraft] = useState("");
  const [evolutionCommitDraft, setEvolutionCommitDraft] = useState("");
  const [submittingEvolutionGoal, setSubmittingEvolutionGoal] = useState(false);
  const [triggeringEvolutionTick, setTriggeringEvolutionTick] = useState(false);

  const enabledUsers = useMemo(() => users.filter((user) => user.enabled), [users]);
  const llmProviders = useMemo(() => llmProviderStore?.providers ?? [], [llmProviderStore]);
  const defaultLlmProviderId = useMemo(() => resolveDefaultLlmProviderId(llmProviderStore), [llmProviderStore]);
  const marketSearchEngines = useMemo(() => marketSearchEngineStore?.engines ?? [], [marketSearchEngineStore]);
  const defaultMarketSearchEngineId = useMemo(
    () => resolveDefaultMarketSearchEngineId(marketSearchEngineStore),
    [marketSearchEngineStore]
  );

  const userMap = useMemo(() => {
    return new Map(users.map((user) => [user.id, user]));
  }, [users]);

  useEffect(() => {
    setMarketAnalysisConfig((prev) => {
      const nextAnalysisEngine = resolveMarketAnalysisProviderId(prev.analysisEngine, llmProviderStore);
      const nextSearchEngine = resolveMarketSearchEngineId(prev.searchEngine, marketSearchEngineStore);
      if (nextAnalysisEngine === prev.analysisEngine && nextSearchEngine === prev.searchEngine) {
        return prev;
      }
      return {
        ...prev,
        analysisEngine: nextAnalysisEngine,
        searchEngine: nextSearchEngine
      };
    });

    setTopicSummaryConfig((prev) => {
      const nextSummaryEngine = resolveTopicSummaryProviderId(prev.summaryEngine, llmProviderStore);
      if (nextSummaryEngine === prev.summaryEngine) {
        return prev;
      }
      return {
        ...prev,
        summaryEngine: nextSummaryEngine
      };
    });
  }, [llmProviderStore, marketSearchEngineStore]);

  function updateCodexDraft<K extends keyof CodexDraft>(key: K, value: CodexDraft[K]): void {
    setCodexDraft((prev) => ({ ...prev, [key]: value }));
  }

  function updateMemoryDraft<K extends keyof SystemMemoryDraft>(key: K, value: SystemMemoryDraft[K]): void {
    setMemoryDraft((prev) => ({ ...prev, [key]: value }));
  }

  function updateRuntimeDraft<K extends keyof SystemRuntimeDraft>(key: K, value: SystemRuntimeDraft[K]): void {
    setRuntimeDraft((prev) => ({ ...prev, [key]: value }));
  }

  function updateSystemOperationState<K extends keyof SystemOperationState>(key: K, value: SystemOperationState[K]): void {
    setSystemOperationState((prev) => ({ ...prev, [key]: value }));
  }

  const currentEvolutionGoal = useMemo(() => {
    if (!evolutionSnapshot?.state.currentGoalId) {
      return null;
    }
    return evolutionSnapshot.state.goals.find((goal) => goal.id === evolutionSnapshot.state.currentGoalId) ?? null;
  }, [evolutionSnapshot]);

  const evolutionQueueRows = useMemo(() => {
    return buildEvolutionQueueRows({
      goals: evolutionSnapshot?.state.goals,
      history: evolutionSnapshot?.state.history,
      retryItems: evolutionSnapshot?.retryQueue.items
    });
  }, [evolutionSnapshot]);

  const marketFundSaveStates = useMemo<Array<"saved" | "dirty" | "saving">>(() => {
    return marketPortfolio.funds.map((fund, index) => {
      if (savingMarketFundIndex === index) {
        return "saving";
      }
      const saved = marketSavedFundsByRow[index];
      if (!saved) {
        return "dirty";
      }
      return isSameMarketFund(normalizeMarketFund(saved), normalizeMarketFund(fund)) ? "saved" : "dirty";
    });
  }, [marketPortfolio.funds, marketSavedFundsByRow, savingMarketFundIndex]);

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    if (activeMenu !== "evolution") {
      return;
    }

    void loadEvolutionState({ silent: true });
    const timer = window.setInterval(() => {
      void loadEvolutionState({ silent: true });
    }, 8000);

    return () => {
      window.clearInterval(timer);
    };
  }, [activeMenu]);

  useEffect(() => {
    const nextLength = marketPortfolio.funds.length;
    setMarketSearchInputs((prev) => resizeStringArray(prev, nextLength));
    setMarketSearchResults((prev) => resizeSearchResultsArray(prev, nextLength));
  }, [marketPortfolio.funds.length]);

  async function bootstrap(): Promise<void> {
    try {
      await Promise.all([
        loadConfig(),
        loadModels(),
        loadUsers(),
        loadTasks(),
        loadMarketConfig(),
        loadMarketRuns(),
        loadTopicSummaryConfig(),
        loadWritingTopics(),
        loadEvolutionState({ silent: true })
      ]);
      setNotice(null);
    } catch (error) {
      notifyError("初始化失败", error);
    }
  }

  async function loadConfig(): Promise<void> {
    const payload = await request<AdminConfig>("/admin/api/config");
    setConfig(payload);
    if (payload.llmProviders?.store) {
      setLlmProviderStore(payload.llmProviders.store);
    } else {
      await loadLLMProviders();
    }
    if (payload.searchEngines?.store) {
      setMarketSearchEngineStore(payload.searchEngines.store);
    } else {
      await loadSearchEngines();
    }
    setCodexDraft({
      model: payload.codexModel || "",
      reasoningEffort: payload.codexReasoningEffort || ""
    });
    setMemoryDraft({
      llmMemoryContextEnabled: payload.llmMemoryContextEnabled ?? true,
      memoryCompactEveryRounds: payload.memoryCompactEveryRounds || "",
      memoryCompactMaxBatchSize: payload.memoryCompactMaxBatchSize || "",
      memorySummaryTopK: payload.memorySummaryTopK || "",
      memoryRawRefLimit: payload.memoryRawRefLimit || "",
      memoryRawRecordLimit: payload.memoryRawRecordLimit || "",
      memoryRagSummaryTopK: payload.memoryRagSummaryTopK || ""
    });
    setRuntimeDraft({
      storageDriver: payload.storageDriver === "sqlite" ? "sqlite" : "json-file",
      storageSqlitePath: payload.storageSqlitePath || "data/storage/metadata.sqlite"
    });
  }

  async function loadModels(): Promise<void> {
    const payload = await request<{ baseUrl: string; models: string[] }>("/admin/api/models");
    const list = Array.isArray(payload.models) ? payload.models.filter(Boolean) : [];
    setModels(list);
  }

  async function loadLLMProviders(): Promise<void> {
    const payload = await request<{
      ok: boolean;
      store: LLMProviderStore;
      defaultProvider: LLMProviderProfile;
    }>("/admin/api/llm/providers");
    if (payload.store && Array.isArray(payload.store.providers)) {
      setLlmProviderStore(payload.store);
    }
  }

  async function loadSearchEngines(): Promise<void> {
    const payload = await request<{
      ok: boolean;
      store: SearchEngineStore;
      defaultEngine: SearchEngineProfile;
    }>("/admin/api/search-engines");
    if (payload.store && Array.isArray(payload.store.engines)) {
      setMarketSearchEngineStore(payload.store);
    }
  }

  async function loadUsers(): Promise<void> {
    const payload = await request<{ users: PushUser[] }>("/admin/api/users");
    const nextUsers = Array.isArray(payload.users) ? payload.users : [];
    setUsers(nextUsers);

    if (!marketTaskUserId) {
      const preferred = nextUsers.find((user) => user.enabled);
      if (preferred) {
        setMarketTaskUserId(preferred.id);
      }
    } else {
      const exists = nextUsers.some((user) => user.id === marketTaskUserId);
      if (!exists) {
        const preferred = nextUsers.find((user) => user.enabled);
        setMarketTaskUserId(preferred?.id ?? "");
      }
    }
  }

  async function loadTasks(): Promise<void> {
    const payload = await request<{ tasks: ScheduledTask[] }>("/admin/api/tasks");
    setTasks(Array.isArray(payload.tasks) ? payload.tasks : []);
  }

  async function loadMarketConfig(): Promise<void> {
    const payload = await request<MarketConfig>("/admin/api/market/config");
    setMarketConfig(payload);
    const portfolio = normalizeMarketPortfolio(payload.portfolio ?? DEFAULT_MARKET_PORTFOLIO);
    const analysisConfigRaw = normalizeMarketAnalysisConfig(payload.config ?? DEFAULT_MARKET_ANALYSIS_CONFIG);
    const analysisConfig = {
      ...analysisConfigRaw,
      analysisEngine: resolveMarketAnalysisProviderId(analysisConfigRaw.analysisEngine, llmProviderStore),
      searchEngine: resolveMarketSearchEngineId(analysisConfigRaw.searchEngine, marketSearchEngineStore)
    };
    setMarketPortfolio(portfolio);
    setMarketAnalysisConfig(analysisConfig);
    setMarketSavedFundsByRow(portfolio.funds.map((fund) => ({ ...fund })));
    setMarketSavedCash(portfolio.cash);
  }

  async function loadMarketRuns(): Promise<void> {
    const payload = await request<{ runs: MarketRunSummary[] }>("/admin/api/market/runs?limit=12");
    setMarketRuns(Array.isArray(payload.runs) ? payload.runs : []);
  }

  async function loadTopicSummaryConfig(): Promise<void> {
    const payload = await request<TopicSummaryProfilesPayload>("/admin/api/topic-summary/config");
    const normalized = normalizeTopicSummaryProfilesPayload(payload);
    setTopicSummaryProfiles(normalized.profiles);
    setTopicSummaryActiveProfileId(normalized.activeProfileId);

    const selectedId = normalized.profiles.some((item) => item.id === topicSummarySelectedProfileId)
      ? topicSummarySelectedProfileId
      : normalized.activeProfileId;
    setTopicSummarySelectedProfileId(selectedId);

    const selectedProfile = normalized.profiles.find((item) => item.id === selectedId)
      ?? normalized.profiles[0]
      ?? null;
    const topicConfigRaw = normalizeTopicSummaryConfig(selectedProfile?.config ?? payload.config ?? DEFAULT_TOPIC_SUMMARY_CONFIG);
    setTopicSummaryConfig({
      ...topicConfigRaw,
      summaryEngine: resolveTopicSummaryProviderId(topicConfigRaw.summaryEngine, llmProviderStore)
    });
    setTopicSummaryState(normalizeTopicSummaryState(selectedProfile?.state ?? payload.state ?? DEFAULT_TOPIC_SUMMARY_STATE));
  }

  async function loadWritingTopics(options?: { preferredTopicId?: string }): Promise<void> {
    setLoadingWritingTopics(true);
    try {
      const payload = await request<WritingTopicsPayload>("/admin/api/writing/topics");
      const topics = normalizeWritingTopicMetaList(payload.topics);
      setWritingTopics(topics);

      const currentSelected = writingSelectedTopicId;
      const preferred = normalizeWritingTopicId(options?.preferredTopicId ?? "");
      const nextSelected = topics.some((item) => item.topicId === preferred)
        ? preferred
        : topics.some((item) => item.topicId === currentSelected)
          ? currentSelected
          : (topics[0]?.topicId ?? "");

      setWritingSelectedTopicId(nextSelected);
      if (!writingTopicIdDraft.trim() || writingTopicIdDraft.trim() === currentSelected) {
        setWritingTopicIdDraft(nextSelected);
      }

      if (nextSelected) {
        await loadWritingTopicDetail(nextSelected, { silent: true });
      } else {
        setWritingTopicDetail(null);
      }
    } finally {
      setLoadingWritingTopics(false);
    }
  }

  async function loadWritingTopicDetail(topicId: string, options?: { silent?: boolean }): Promise<void> {
    const normalizedTopicId = normalizeWritingTopicId(topicId);
    if (!normalizedTopicId) {
      setWritingTopicDetail(null);
      return;
    }

    const silent = options?.silent ?? false;
    if (!silent) {
      setLoadingWritingDetail(true);
    }

    try {
      const payload = await request<WritingTopicDetail>(`/admin/api/writing/topics/${encodeURIComponent(normalizedTopicId)}`);
      const detail = normalizeWritingTopicDetail(payload, normalizedTopicId);
      setWritingTopicDetail(detail);
      setWritingSelectedTopicId(detail.meta.topicId);
      setWritingTopicTitleDraft(detail.meta.title);
    } finally {
      if (!silent) {
        setLoadingWritingDetail(false);
      }
    }
  }

  async function loadEvolutionState(options?: { silent?: boolean }): Promise<void> {
    const silent = options?.silent ?? false;
    if (!silent) {
      setLoadingEvolution(true);
    }
    try {
      const payload = await request<EvolutionStateSnapshot>("/admin/api/evolution/state");
      setEvolutionSnapshot(payload);
    } finally {
      if (!silent) {
        setLoadingEvolution(false);
      }
    }
  }

  async function handleUpsertLLMProvider(provider: LLMProviderProfile): Promise<void> {
    setSavingLLMProvider(true);
    try {
      const payload = await request<{
        ok: boolean;
        store: LLMProviderStore;
        defaultProvider: LLMProviderProfile;
      }>("/admin/api/llm/providers", {
        method: "PUT",
        body: JSON.stringify({ provider })
      });
      setLlmProviderStore(payload.store);
      setConfig((prev) => {
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
      setNotice({ type: "success", title: "LLM Provider 已保存" });
    } catch (error) {
      notifyError("保存 LLM Provider 失败", error);
    } finally {
      setSavingLLMProvider(false);
    }
  }

  async function handleDeleteLLMProvider(providerId: string): Promise<void> {
    setDeletingLLMProviderId(providerId);
    try {
      const payload = await request<{
        ok: boolean;
        store: LLMProviderStore;
        defaultProvider: LLMProviderProfile;
      }>(`/admin/api/llm/providers/${encodeURIComponent(providerId)}`, {
        method: "DELETE"
      });
      setLlmProviderStore(payload.store);
      setConfig((prev) => {
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
      setNotice({ type: "success", title: "LLM Provider 已删除" });
    } catch (error) {
      notifyError("删除 LLM Provider 失败", error);
    } finally {
      setDeletingLLMProviderId("");
    }
  }

  async function handleSetMainFlowProviders(selection: MainFlowProviderSelectionDraft): Promise<void> {
    setUpdatingMainFlowProviders(true);
    try {
      const payload = await request<{
        ok: boolean;
        store: LLMProviderStore;
        defaultProvider: LLMProviderProfile;
      }>("/admin/api/llm/providers/default", {
        method: "POST",
        body: JSON.stringify(selection)
      });
      setLlmProviderStore(payload.store);
      setConfig((prev) => {
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
      setNotice({ type: "success", title: "主流程 Provider 选择已保存" });
    } catch (error) {
      notifyError("保存主流程 Provider 失败", error);
    } finally {
      setUpdatingMainFlowProviders(false);
    }
  }

  async function handleUpsertMarketSearchEngine(engine: SearchEngineProfile): Promise<void> {
    setSavingMarketSearchEngine(true);
    try {
      const payload = await request<{
        ok: boolean;
        store: SearchEngineStore;
        defaultEngine: SearchEngineProfile;
      }>("/admin/api/search-engines", {
        method: "PUT",
        body: JSON.stringify({ engine })
      });
      setMarketSearchEngineStore(payload.store);
      setConfig((prev) => {
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
      setNotice({ type: "success", title: "Search Engine 配置已保存" });
    } catch (error) {
      notifyError("保存 Search Engine 配置失败", error);
    } finally {
      setSavingMarketSearchEngine(false);
    }
  }

  async function handleDeleteMarketSearchEngine(engineId: string): Promise<void> {
    setDeletingMarketSearchEngineId(engineId);
    try {
      const payload = await request<{
        ok: boolean;
        store: SearchEngineStore;
        defaultEngine: SearchEngineProfile;
      }>(`/admin/api/search-engines/${encodeURIComponent(engineId)}`, {
        method: "DELETE"
      });
      setMarketSearchEngineStore(payload.store);
      setConfig((prev) => {
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
      setNotice({ type: "success", title: "Search Engine 已删除" });
    } catch (error) {
      notifyError("删除 Search Engine 失败", error);
    } finally {
      setDeletingMarketSearchEngineId("");
    }
  }

  async function handleSetDefaultMarketSearchEngine(engineId: string): Promise<void> {
    setSavingMarketSearchEngine(true);
    try {
      const payload = await request<{
        ok: boolean;
        store: SearchEngineStore;
        defaultEngine: SearchEngineProfile;
      }>("/admin/api/search-engines/default", {
        method: "POST",
        body: JSON.stringify({ engineId })
      });
      setMarketSearchEngineStore(payload.store);
      setConfig((prev) => {
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
      setNotice({ type: "success", title: "默认 Search Engine 已更新" });
    } catch (error) {
      notifyError("更新默认 Search Engine 失败", error);
    } finally {
      setSavingMarketSearchEngine(false);
    }
  }

  async function handleRestartPm2(): Promise<void> {
    updateSystemOperationState("restarting", true);
    try {
      const payload = await request<{ output?: string; accepted?: boolean; delayMs?: number }>("/admin/api/restart", {
        method: "POST",
        body: "{}"
      });
      const delayText = payload.delayMs && payload.delayMs > 0 ? `，预计 ${payload.delayMs}ms 后执行` : "";
      setNotice({
        type: "info",
        title: payload.accepted ? "重启指令已受理" : "应用进程重启完成",
        text: payload.output
          ? `${payload.output}${delayText}`
          : `服务可能会短暂断连，属于正常现象${delayText}`
      });
    } catch (error) {
      if (isLikelyRestartConnectionDrop(error)) {
        setNotice({
          type: "info",
          title: "重启过程中连接中断",
          text: "已触发 pm2 restart，请稍等 3-10 秒后刷新页面。"
        });
      } else {
        notifyError("pm2 重启失败", error);
      }
    } finally {
      updateSystemOperationState("restarting", false);
    }
  }

  async function handleSaveCodexConfig(): Promise<void> {
    const model = codexDraft.model.trim();
    const reasoningEffort = codexDraft.reasoningEffort.trim().toLowerCase();
    if (reasoningEffort) {
      const allowedValues = new Set(["minimal", "low", "medium", "high", "xhigh"]);
      if (!allowedValues.has(reasoningEffort)) {
        setNotice({ type: "error", title: "Codex Reasoning Effort 仅支持 minimal/low/medium/high/xhigh" });
        return;
      }
    }

    setSavingCodexConfig(true);
    try {
      await request<{ ok: boolean }>("/admin/api/config/codex", {
        method: "POST",
        body: JSON.stringify({
          model,
          reasoningEffort
        })
      });
      await loadConfig();
      setNotice({
        type: "success",
        title: "Codex 配置已保存"
      });
    } catch (error) {
      notifyError("保存 Codex 配置失败", error);
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
          memoryRawRecordLimit: memoryDraft.memoryRawRecordLimit.trim(),
          memoryRagSummaryTopK: memoryDraft.memoryRagSummaryTopK.trim()
        })
      });
      await loadConfig();
      setNotice({
        type: "success",
        title: "Memory 配置已保存"
      });
    } catch (error) {
      notifyError("保存 Memory 配置失败", error);
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
          storageSqlitePath: runtimeDraft.storageSqlitePath.trim()
        })
      });
      await loadConfig();
      setNotice({
        type: "success",
        title: "运行时配置已保存"
      });
    } catch (error) {
      notifyError("保存运行时配置失败", error);
    } finally {
      setSavingRuntimeConfig(false);
    }
  }

  async function handlePullRepo(): Promise<void> {
    updateSystemOperationState("pullingRepo", true);
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

      setNotice({
        type: "success",
        title: "远端代码同步完成",
        text: [
          `执行命令: ${payload.pullCommand}`,
          `工作目录: ${payload.cwd}`,
          payload.pullOutput
        ]
          .filter(Boolean)
          .join("\n\n")
      });
    } catch (error) {
      notifyError("同步远端代码失败", error);
    } finally {
      updateSystemOperationState("pullingRepo", false);
    }
  }

  async function handleBuildRepo(): Promise<void> {
    updateSystemOperationState("buildingRepo", true);
    try {
      const payload = await request<{
        ok: boolean;
        cwd: string;
        buildOutput: string;
      }>("/admin/api/repo/build", {
        method: "POST",
        body: "{}"
      });

      setNotice({
        type: "success",
        title: "项目构建完成",
        text: [
          `工作目录: ${payload.cwd}`,
          payload.buildOutput
        ]
          .filter(Boolean)
          .join("\n\n")
      });
    } catch (error) {
      notifyError("执行项目构建失败", error);
    } finally {
      updateSystemOperationState("buildingRepo", false);
    }
  }

  async function handleDeployRepo(): Promise<void> {
    updateSystemOperationState("deployingRepo", true);
    try {
      const payload = await request<{
        ok: boolean;
        cwd: string;
        pullCommand: string;
        pullOutput: string;
        buildOutput: string;
        restartOutput: string;
      }>("/admin/api/repo/deploy", {
        method: "POST",
        body: "{}"
      });

      setNotice({
        type: "success",
        title: "一键部署完成",
        text: [
          `执行命令: ${payload.pullCommand}`,
          `工作目录: ${payload.cwd}`,
          payload.pullOutput,
          payload.buildOutput,
          payload.restartOutput
        ]
          .filter(Boolean)
          .join("\n\n")
      });
    } catch (error) {
      notifyError("一键部署失败", error);
    } finally {
      updateSystemOperationState("deployingRepo", false);
    }
  }

  function beginCreateUser(): void {
    setEditingUserId("");
    setUserForm(EMPTY_USER_FORM);
  }

  function beginEditUser(user: PushUser): void {
    setEditingUserId(user.id);
    setUserForm({
      name: user.name,
      wecomUserId: user.wecomUserId,
      enabled: user.enabled
    });
  }

  async function handleSubmitUser(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const payload: UserFormState = {
      name: userForm.name.trim(),
      wecomUserId: userForm.wecomUserId.trim(),
      enabled: userForm.enabled
    };

    if (!payload.name || !payload.wecomUserId) {
      setNotice({ type: "error", title: "请填写完整用户信息" });
      return;
    }

    setSavingUser(true);
    try {
      if (editingUserId) {
        await request(`/admin/api/users/${encodeURIComponent(editingUserId)}`, {
          method: "PUT",
          body: JSON.stringify(payload)
        });
        setNotice({ type: "success", title: "推送用户已更新" });
      } else {
        await request("/admin/api/users", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        setNotice({ type: "success", title: "推送用户已创建" });
      }

      await Promise.all([loadUsers(), loadTasks()]);
      beginCreateUser();
    } catch (error) {
      notifyError("保存推送用户失败", error);
    } finally {
      setSavingUser(false);
    }
  }

  async function handleDeleteUser(user: PushUser): Promise<void> {
    try {
      await request(`/admin/api/users/${encodeURIComponent(user.id)}`, {
        method: "DELETE",
        body: "{}"
      });
      await Promise.all([loadUsers(), loadTasks()]);
      if (editingUserId === user.id) {
        beginCreateUser();
      }
      setNotice({ type: "success", title: "推送用户已删除" });
    } catch (error) {
      notifyError("删除推送用户失败", error);
    }
  }

  function beginCreateTask(): void {
    setEditingTaskId("");
    setTaskForm(EMPTY_TASK_FORM);
  }

  function beginEditTask(task: ScheduledTask): void {
    setEditingTaskId(task.id);
    setTaskForm({
      name: task.name,
      time: task.time,
      userIds: [...task.userIds],
      message: task.message,
      enabled: task.enabled
    });
  }

  async function handleSubmitTask(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const payload: TaskFormState = {
      name: taskForm.name.trim(),
      time: taskForm.time.trim(),
      userIds: taskForm.userIds,
      message: taskForm.message.trim(),
      enabled: taskForm.enabled
    };

    if (!payload.name || !payload.time || payload.userIds.length === 0 || !payload.message) {
      setNotice({ type: "error", title: "请填写完整任务信息" });
      return;
    }

    setSavingTask(true);
    try {
      if (editingTaskId) {
        await request(`/admin/api/tasks/${encodeURIComponent(editingTaskId)}`, {
          method: "PUT",
          body: JSON.stringify(payload)
        });
        setNotice({ type: "success", title: "定时任务已更新" });
      } else {
        await request("/admin/api/tasks", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        setNotice({ type: "success", title: "定时任务已创建" });
      }

      await loadTasks();
      beginCreateTask();
    } catch (error) {
      notifyError("保存定时任务失败", error);
    } finally {
      setSavingTask(false);
    }
  }

  async function handleDeleteTask(task: ScheduledTask): Promise<void> {
    try {
      await request(`/admin/api/tasks/${encodeURIComponent(task.id)}`, {
        method: "DELETE",
        body: "{}"
      });
      await loadTasks();
      if (editingTaskId === task.id) {
        beginCreateTask();
      }
      setNotice({ type: "success", title: "定时任务已删除" });
    } catch (error) {
      notifyError("删除定时任务失败", error);
    }
  }

  async function handleRunTask(task: ScheduledTask): Promise<void> {
    setRunningTaskId(task.id);
    try {
      const payload = await request<{ acceptedAsync: boolean; responseText?: string }>(
        `/admin/api/tasks/${encodeURIComponent(task.id)}/run`,
        {
          method: "POST",
          body: "{}"
        }
      );
      await loadTasks();
      if (payload.acceptedAsync) {
        setNotice({ type: "info", title: "任务已异步受理，稍后将回调用户" });
      } else {
        setNotice({ type: "success", title: "任务已执行并推送", text: payload.responseText });
      }
    } catch (error) {
      notifyError("手动触发任务失败", error);
    } finally {
      setRunningTaskId("");
    }
  }

  function handleAddMarketFund(): void {
    setMarketPortfolio((prev) => ({
      ...prev,
      funds: prev.funds.concat([{ code: "", name: "" }])
    }));
    setMarketSavedFundsByRow((prev) => prev.concat(null));
    setMarketSearchInputs((prev) => prev.concat(""));
    setMarketSearchResults((prev) => prev.concat([[]]));
  }

  function handleRemoveMarketFund(index: number): void {
    setMarketPortfolio((prev) => ({
      ...prev,
      funds: prev.funds.filter((_, idx) => idx !== index)
    }));
    setMarketSavedFundsByRow((prev) => prev.filter((_, idx) => idx !== index));
    setMarketSearchInputs((prev) => prev.filter((_, idx) => idx !== index));
    setMarketSearchResults((prev) => prev.filter((_, idx) => idx !== index));
    setSearchingMarketFundIndex((prev) => {
      if (prev === null) {
        return null;
      }
      if (prev === index) {
        return null;
      }
      return prev > index ? prev - 1 : prev;
    });
    setSavingMarketFundIndex((prev) => {
      if (prev === null) {
        return null;
      }
      if (prev === index) {
        return null;
      }
      return prev > index ? prev - 1 : prev;
    });
  }

  function handleMarketCashChange(value: number): void {
    setMarketPortfolio((prev) => ({
      ...prev,
      cash: Number.isFinite(value) ? value : 0
    }));
  }

  function handleMarketAssetTypeChange(value: MarketAnalysisAssetType): void {
    setMarketAnalysisConfig((prev) => ({
      ...prev,
      assetType: value
    }));
  }

  function handleMarketAnalysisEngineChange(value: MarketAnalysisEngine): void {
    setMarketAnalysisConfig((prev) => ({
      ...prev,
      analysisEngine: value
    }));
  }

  function handleMarketSearchEngineChange(value: string): void {
    setMarketAnalysisConfig((prev) => ({
      ...prev,
      searchEngine: value
    }));
  }

  function handleMarketGptPluginTimeoutMsChange(value: number): void {
    setMarketAnalysisConfig((prev) => ({
      ...prev,
      gptPlugin: {
        ...prev.gptPlugin,
        timeoutMs: Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
      }
    }));
  }

  function handleMarketGptPluginFallbackToLocalChange(value: boolean): void {
    setMarketAnalysisConfig((prev) => ({
      ...prev,
      gptPlugin: {
        ...prev.gptPlugin,
        fallbackToLocal: value
      }
    }));
  }

  function handleMarketFundEnabledChange(value: boolean): void {
    setMarketAnalysisConfig((prev) => ({
      ...prev,
      fund: {
        ...prev.fund,
        enabled: value
      }
    }));
  }

  function handleMarketFundMaxAgeDaysChange(value: number): void {
    setMarketAnalysisConfig((prev) => ({
      ...prev,
      fund: {
        ...prev.fund,
        maxAgeDays: Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1
      }
    }));
  }

  function handleMarketFundFeatureLookbackDaysChange(value: number): void {
    setMarketAnalysisConfig((prev) => ({
      ...prev,
      fund: {
        ...prev.fund,
        featureLookbackDays: Number.isFinite(value) ? Math.max(20, Math.floor(value)) : 20
      }
    }));
  }

  function handleMarketFundRiskLevelChange(value: MarketFundRiskLevel): void {
    setMarketAnalysisConfig((prev) => ({
      ...prev,
      fund: {
        ...prev.fund,
        ruleRiskLevel: value
      }
    }));
  }

  function handleMarketFundLlmRetryMaxChange(value: number): void {
    setMarketAnalysisConfig((prev) => ({
      ...prev,
      fund: {
        ...prev.fund,
        llmRetryMax: Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1
      }
    }));
  }

  function handleMarketFundNewsQuerySuffixChange(value: string): void {
    setMarketAnalysisConfig((prev) => ({
      ...prev,
      fund: {
        ...prev.fund,
        newsQuerySuffix: String(value || "")
      }
    }));
  }

  function handleMarketFundChange(index: number, key: keyof MarketFundHolding, value: string): void {
    setMarketPortfolio((prev) => ({
      ...prev,
      funds: prev.funds.map((fund, idx) => {
        if (idx !== index) {
          return fund;
        }

        if (key === "code") {
          return { ...fund, code: value };
        }
        if (key === "name") {
          return { ...fund, name: value };
        }

        const trimmed = value.trim();
        if (!trimmed) {
          return {
            ...fund,
            ...(key === "quantity" ? { quantity: undefined } : { avgCost: undefined })
          };
        }

        const numeric = Number(trimmed);
        if (key === "quantity") {
          return {
            ...fund,
            quantity: Number.isFinite(numeric) && numeric > 0 ? numeric : undefined
          };
        }

        return {
          ...fund,
          avgCost: Number.isFinite(numeric) && numeric >= 0 ? numeric : undefined
        };
      })
    }));
  }

  function handleMarketSearchInputChange(index: number, value: string): void {
    setMarketSearchInputs((prev) => {
      const next = resizeStringArray(prev, marketPortfolio.funds.length).slice();
      if (index < 0 || index >= next.length) {
        return next;
      }
      next[index] = value;
      return next;
    });
  }

  async function handleSearchMarketByName(index: number): Promise<void> {
    const keyword = (marketSearchInputs[index] ?? "").trim();
    if (!keyword) {
      setNotice({ type: "error", title: "请输入名称后再查找" });
      return;
    }

    setSearchingMarketFundIndex(index);
    try {
      const payload = await request<{ keyword: string; items: MarketSecuritySearchItem[] }>(
        `/admin/api/market/securities/search?keyword=${encodeURIComponent(keyword)}&limit=8`
      );
      const items = Array.isArray(payload.items) ? payload.items : [];
      setMarketSearchResults((prev) => {
        const next = resizeSearchResultsArray(prev, marketPortfolio.funds.length).slice();
        if (index >= 0 && index < next.length) {
          next[index] = items;
        }
        return next;
      });
      if (items.length === 0) {
        setNotice({ type: "info", title: `未找到“${keyword}”相关代码` });
      }
    } catch (error) {
      notifyError("名称查找 code 失败", error);
    } finally {
      setSearchingMarketFundIndex((prev) => (prev === index ? null : prev));
    }
  }

  function handleApplyMarketSearchResult(index: number, item: MarketSecuritySearchItem): void {
    setMarketPortfolio((prev) => ({
      ...prev,
      funds: prev.funds.map((fund, idx) => {
        if (idx !== index) {
          return fund;
        }
        return {
          ...fund,
          code: item.code,
          name: item.name
        };
      })
    }));
    setMarketSearchInputs((prev) => {
      const next = resizeStringArray(prev, marketPortfolio.funds.length).slice();
      if (index >= 0 && index < next.length) {
        next[index] = item.name;
      }
      return next;
    });
    setMarketSearchResults((prev) => {
      const next = resizeSearchResultsArray(prev, marketPortfolio.funds.length).slice();
      if (index >= 0 && index < next.length) {
        next[index] = [];
      }
      return next;
    });
  }

  async function handleSaveMarketFund(index: number): Promise<void> {
    if (savingMarketPortfolio || savingMarketFundIndex !== null) {
      return;
    }
    const fund = marketPortfolio.funds[index];
    if (!fund) {
      return;
    }
    const target = normalizeMarketFund(fund);
    if (!isValidMarketFund(target)) {
      setNotice({ type: "error", title: "请先填写合法代码后再保存该行" });
      return;
    }

    const funds = marketPortfolio.funds
      .map((_, rowIndex) => {
        if (rowIndex === index) {
          return target;
        }
        const saved = marketSavedFundsByRow[rowIndex];
        return saved ? normalizeMarketFund(saved) : null;
      })
      .filter((item): item is MarketFundHolding => item !== null && isValidMarketFund(item));

    setSavingMarketFundIndex(index);
    try {
      const response = await request<{ ok: boolean; portfolio: MarketPortfolio }>("/admin/api/market/config", {
        method: "PUT",
        body: JSON.stringify({
          portfolio: {
            funds,
            cash: marketSavedCash
          }
        })
      });
      const nextPortfolio = normalizeMarketPortfolio(response.portfolio);
      setMarketPortfolio((prev) => ({
        ...prev,
        funds: prev.funds.map((item, rowIndex) => (rowIndex === index ? target : item))
      }));
      setMarketSavedFundsByRow((prev) => {
        const next = resizeSavedFundsArray(prev, marketPortfolio.funds.length).slice();
        if (index >= 0 && index < next.length) {
          next[index] = { ...target };
        }
        return next;
      });
      setMarketSavedCash(nextPortfolio.cash);
      setNotice({ type: "success", title: "该行持仓已保存" });
    } catch (error) {
      notifyError("保存该行持仓失败", error);
    } finally {
      setSavingMarketFundIndex((current) => (current === index ? null : current));
    }
  }

  async function handleSaveMarketPortfolio(): Promise<void> {
    if (savingMarketFundIndex !== null || savingMarketAnalysisConfig) {
      return;
    }
    const normalizedFunds = marketPortfolio.funds
      .map((fund) => {
        return normalizeMarketFund(fund);
      })
      .filter((fund) => isValidMarketFund(fund));

    const payload: MarketPortfolio = {
      funds: normalizedFunds,
      cash: Number.isFinite(Number(marketPortfolio.cash)) && Number(marketPortfolio.cash) > 0
        ? Number(marketPortfolio.cash)
        : 0
    };

    setSavingMarketPortfolio(true);
    try {
      const response = await request<{ ok: boolean; portfolio: MarketPortfolio }>("/admin/api/market/config", {
        method: "PUT",
        body: JSON.stringify({ portfolio: payload })
      });
      const nextPortfolio = normalizeMarketPortfolio(response.portfolio);
      setMarketPortfolio(nextPortfolio);
      setMarketSavedFundsByRow(nextPortfolio.funds.map((item) => ({ ...item })));
      setMarketSavedCash(nextPortfolio.cash);
      setNotice({ type: "success", title: "Market 持仓配置已保存" });
    } catch (error) {
      notifyError("保存 Market 配置失败", error);
    } finally {
      setSavingMarketPortfolio(false);
    }
  }

  async function handleImportMarketCodes(): Promise<void> {
    if (savingMarketPortfolio || savingMarketFundIndex !== null || savingMarketAnalysisConfig || importingMarketCodes) {
      return;
    }

    const rawCodes = marketBatchCodesInput.trim();
    if (!rawCodes) {
      setNotice({ type: "error", title: "请先输入 code 列表" });
      return;
    }

    setImportingMarketCodes(true);
    try {
      const payload = await request<MarketPortfolioImportResponse>("/admin/api/market/portfolio/import-codes", {
        method: "POST",
        body: JSON.stringify({ codes: rawCodes })
      });
      const nextPortfolio = normalizeMarketPortfolio(payload.portfolio ?? DEFAULT_MARKET_PORTFOLIO);
      setMarketPortfolio(nextPortfolio);
      setMarketSavedFundsByRow(nextPortfolio.funds.map((item) => ({ ...item })));
      setMarketSavedCash(nextPortfolio.cash);

      const summary = payload.summary ?? {
        added: 0,
        updated: 0,
        exists: 0,
        not_found: 0,
        error: 0
      };
      const summaryText = [
        `新增 ${summary.added}`,
        `更新 ${summary.updated}`,
        `已存在 ${summary.exists}`,
        `未命中 ${summary.not_found}`,
        `失败 ${summary.error}`
      ].join("，");

      const issueCodes = (payload.results ?? [])
        .filter((item) => item.status === "not_found" || item.status === "error")
        .map((item) => item.code)
        .filter(Boolean)
        .slice(0, 8);

      setNotice({
        type: summary.error > 0 ? "error" : "success",
        title: "批量导入持仓完成",
        text: issueCodes.length > 0
          ? `${summaryText}。异常 code: ${issueCodes.join(", ")}`
          : summaryText
      });
    } catch (error) {
      notifyError("批量导入 market code 失败", error);
    } finally {
      setImportingMarketCodes(false);
    }
  }

  async function handleSaveMarketAnalysisConfig(): Promise<void> {
    if (savingMarketPortfolio || savingMarketFundIndex !== null) {
      return;
    }

    const timeoutMs = Number(marketAnalysisConfig.gptPlugin.timeoutMs);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      setNotice({ type: "error", title: "GPT Plugin 超时必须为正整数毫秒" });
      return;
    }
    if (!Number.isFinite(Number(marketAnalysisConfig.fund.maxAgeDays)) || Number(marketAnalysisConfig.fund.maxAgeDays) <= 0) {
      setNotice({ type: "error", title: "基金数据最大时效必须为正整数" });
      return;
    }
    if (!Number.isFinite(Number(marketAnalysisConfig.fund.featureLookbackDays)) || Number(marketAnalysisConfig.fund.featureLookbackDays) < 20) {
      setNotice({ type: "error", title: "基金特征回看天数至少 20 天" });
      return;
    }
    if (!Number.isFinite(Number(marketAnalysisConfig.fund.llmRetryMax)) || Number(marketAnalysisConfig.fund.llmRetryMax) <= 0) {
      setNotice({ type: "error", title: "基金 LLM 重试次数必须为正整数" });
      return;
    }
    const normalizedConfigRaw = normalizeMarketAnalysisConfig(marketAnalysisConfig);
    const normalizedConfig = {
      ...normalizedConfigRaw,
      analysisEngine: resolveMarketAnalysisProviderId(normalizedConfigRaw.analysisEngine, llmProviderStore),
      searchEngine: resolveMarketSearchEngineId(normalizedConfigRaw.searchEngine, marketSearchEngineStore)
    };

    setSavingMarketAnalysisConfig(true);
    try {
      const response = await request<{ ok: boolean; portfolio: MarketPortfolio; config: MarketAnalysisConfig }>("/admin/api/market/config", {
        method: "PUT",
        body: JSON.stringify({
          config: normalizedConfig
        })
      });
      const nextConfigRaw = normalizeMarketAnalysisConfig(response.config);
      const nextConfig = {
        ...nextConfigRaw,
        analysisEngine: resolveMarketAnalysisProviderId(nextConfigRaw.analysisEngine, llmProviderStore),
        searchEngine: resolveMarketSearchEngineId(nextConfigRaw.searchEngine, marketSearchEngineStore)
      };
      setMarketAnalysisConfig(nextConfig);
      setNotice({ type: "success", title: "Market 分析引擎配置已保存" });
    } catch (error) {
      notifyError("保存 Market 分析引擎配置失败", error);
    } finally {
      setSavingMarketAnalysisConfig(false);
    }
  }

  async function handleBootstrapMarketTasks(): Promise<void> {
    if (!marketTaskUserId) {
      setNotice({ type: "error", title: "请先选择推送用户" });
      return;
    }

    setBootstrappingMarketTasks(true);
    try {
      await request<{ ok: boolean; tasks: ScheduledTask[] }>("/admin/api/market/tasks/bootstrap", {
        method: "POST",
        body: JSON.stringify({
          userId: marketTaskUserId,
          middayTime: marketMiddayTime,
          closeTime: marketCloseTime,
          enabled: true
        })
      });

      await loadTasks();
      setNotice({
        type: "success",
        title: "Market 定时任务已创建/更新",
        text: "已生成 /market midday 和 /market close 两条每日任务"
      });
    } catch (error) {
      notifyError("创建 Market 定时任务失败", error);
    } finally {
      setBootstrappingMarketTasks(false);
    }
  }

  async function handleRunMarketOnce(phase: MarketPhase, withExplanation: boolean): Promise<void> {
    if (!marketTaskUserId) {
      setNotice({ type: "error", title: "请先选择推送用户" });
      return;
    }
    if (runningMarketOncePhase) {
      return;
    }

    setRunningMarketOncePhase(phase);
    try {
      const payload = await request<MarketRunOnceResponse>("/admin/api/market/run-once", {
        method: "POST",
        body: JSON.stringify({
          userId: marketTaskUserId,
          phase,
          withExplanation
        })
      });
      await loadMarketRuns();
      if (payload.acceptedAsync) {
        setNotice({
          type: "info",
          title: "Market 报告已异步受理",
          text: payload.responseText ?? payload.message
        });
      } else {
        setNotice({
          type: "success",
          title: "Market 报告已生成",
          text: payload.responseText ?? payload.message
        });
      }
    } catch (error) {
      notifyError("手动触发 Market 报告失败", error);
    } finally {
      setRunningMarketOncePhase((current) => (current === phase ? null : current));
    }
  }

  function handleTopicProfileSelect(profileId: string): void {
    const target = topicSummaryProfiles.find((item) => item.id === profileId);
    if (!target) {
      return;
    }
    setTopicSummarySelectedProfileId(target.id);
    const config = normalizeTopicSummaryConfig(target.config);
    setTopicSummaryConfig({
      ...config,
      summaryEngine: resolveTopicSummaryProviderId(config.summaryEngine, llmProviderStore)
    });
    setTopicSummaryState(normalizeTopicSummaryState(target.state));
  }

  async function handleAddTopicProfile(): Promise<void> {
    const name = window.prompt("请输入 profile 名称");
    const normalizedName = String(name ?? "").trim();
    if (!normalizedName) {
      return;
    }

    const rawId = window.prompt("请输入 profile id（可留空自动生成）");
    const normalizedId = normalizeTopicProfileId(String(rawId ?? "").trim());
    const cloneFrom = topicSummarySelectedProfileId || topicSummaryActiveProfileId;

    setSavingTopicSummaryProfileAction(true);
    try {
      await request<{ ok: boolean }>("/admin/api/topic-summary/profiles", {
        method: "POST",
        body: JSON.stringify({
          name: normalizedName,
          ...(normalizedId ? { id: normalizedId } : {}),
          ...(cloneFrom ? { cloneFrom } : {})
        })
      });
      await loadTopicSummaryConfig();
      setNotice({ type: "success", title: "Topic Summary profile 已创建" });
    } catch (error) {
      notifyError("创建 Topic Summary profile 失败", error);
    } finally {
      setSavingTopicSummaryProfileAction(false);
    }
  }

  async function handleRenameTopicProfile(): Promise<void> {
    const selected = topicSummaryProfiles.find((item) => item.id === topicSummarySelectedProfileId);
    if (!selected) {
      setNotice({ type: "error", title: "请先选择 profile" });
      return;
    }

    const name = window.prompt("请输入新的 profile 名称", selected.name);
    const normalizedName = String(name ?? "").trim();
    if (!normalizedName || normalizedName === selected.name) {
      return;
    }

    setSavingTopicSummaryProfileAction(true);
    try {
      await request<{ ok: boolean }>(`/admin/api/topic-summary/profiles/${encodeURIComponent(selected.id)}`, {
        method: "PUT",
        body: JSON.stringify({ name: normalizedName })
      });
      await loadTopicSummaryConfig();
      setNotice({ type: "success", title: "Topic Summary profile 已重命名" });
    } catch (error) {
      notifyError("重命名 Topic Summary profile 失败", error);
    } finally {
      setSavingTopicSummaryProfileAction(false);
    }
  }

  async function handleUseTopicProfile(): Promise<void> {
    const selected = topicSummaryProfiles.find((item) => item.id === topicSummarySelectedProfileId);
    if (!selected) {
      setNotice({ type: "error", title: "请先选择 profile" });
      return;
    }
    if (selected.id === topicSummaryActiveProfileId) {
      return;
    }

    setSavingTopicSummaryProfileAction(true);
    try {
      await request<{ ok: boolean }>(`/admin/api/topic-summary/profiles/${encodeURIComponent(selected.id)}/use`, {
        method: "POST",
        body: "{}"
      });
      await loadTopicSummaryConfig();
      setNotice({ type: "success", title: "已切换 active profile" });
    } catch (error) {
      notifyError("切换 Topic Summary profile 失败", error);
    } finally {
      setSavingTopicSummaryProfileAction(false);
    }
  }

  async function handleDeleteTopicProfile(): Promise<void> {
    const selected = topicSummaryProfiles.find((item) => item.id === topicSummarySelectedProfileId);
    if (!selected) {
      setNotice({ type: "error", title: "请先选择 profile" });
      return;
    }

    const confirmed = window.confirm(`确认删除 profile "${selected.id}" 吗？`);
    if (!confirmed) {
      return;
    }

    setSavingTopicSummaryProfileAction(true);
    try {
      await request<{ ok: boolean }>(`/admin/api/topic-summary/profiles/${encodeURIComponent(selected.id)}`, {
        method: "DELETE",
        body: "{}"
      });
      await loadTopicSummaryConfig();
      setNotice({ type: "success", title: "Topic Summary profile 已删除" });
    } catch (error) {
      notifyError("删除 Topic Summary profile 失败", error);
    } finally {
      setSavingTopicSummaryProfileAction(false);
    }
  }

  function handleTopicSourceChange(index: number, patch: Partial<TopicSummarySource>): void {
    setTopicSummaryConfig((prev) => {
      const nextSources = prev.sources.map((item, rowIndex) => {
        if (rowIndex !== index) {
          return item;
        }
        return normalizeTopicSummarySource({ ...item, ...patch }, rowIndex);
      });
      return {
        ...prev,
        sources: nextSources
      };
    });
  }

  function handleTopicSummaryEngineChange(value: TopicSummaryEngine): void {
    setTopicSummaryConfig((prev) => ({
      ...prev,
      summaryEngine: value
    }));
  }

  function handleTopicDefaultLanguageChange(value: TopicSummaryDigestLanguage): void {
    setTopicSummaryConfig((prev) => ({
      ...prev,
      defaultLanguage: value
    }));
  }

  function handleAddTopicSource(): void {
    setTopicSummaryConfig((prev) => {
      const baseId = `source-${prev.sources.length + 1}`;
      const dedupId = buildNextTopicSourceId(baseId, prev.sources.map((item) => item.id));
      return {
        ...prev,
        sources: prev.sources.concat([
          {
            id: dedupId,
            name: "",
            category: "engineering",
            feedUrl: "",
            weight: 1,
            enabled: true
          }
        ])
      };
    });
  }

  function handleRemoveTopicSource(index: number): void {
    setTopicSummaryConfig((prev) => ({
      ...prev,
      sources: prev.sources.filter((_, rowIndex) => rowIndex !== index)
    }));
  }

  async function handleSaveTopicSummaryConfig(): Promise<void> {
    const profileId = topicSummarySelectedProfileId || topicSummaryActiveProfileId;
    if (!profileId) {
      setNotice({ type: "error", title: "请先选择 profile" });
      return;
    }

    const normalizedConfigRaw = normalizeTopicSummaryConfig(topicSummaryConfig);
    const normalizedConfig = {
      ...normalizedConfigRaw,
      summaryEngine: resolveTopicSummaryProviderId(normalizedConfigRaw.summaryEngine, llmProviderStore)
    };
    const invalid = normalizedConfig.sources.find((item) => !item.id || !item.name || !item.feedUrl);
    if (invalid) {
      setNotice({ type: "error", title: `RSS 源字段不完整: ${invalid.id || "(id为空)"}` });
      return;
    }

    const idSet = new Set<string>();
    for (const source of normalizedConfig.sources) {
      if (idSet.has(source.id)) {
        setNotice({ type: "error", title: `RSS 源 id 重复: ${source.id}` });
        return;
      }
      idSet.add(source.id);
    }

    setSavingTopicSummaryConfig(true);
    try {
      const payload = await request<{ ok: boolean; config: TopicSummaryConfig }>("/admin/api/topic-summary/config", {
        method: "PUT",
        body: JSON.stringify({
          profileId,
          config: normalizedConfig
        })
      });
      const nextConfigRaw = normalizeTopicSummaryConfig(payload.config ?? normalizedConfig);
      setTopicSummaryConfig({
        ...nextConfigRaw,
        summaryEngine: resolveTopicSummaryProviderId(nextConfigRaw.summaryEngine, llmProviderStore)
      });
      await loadTopicSummaryConfig();
      setNotice({ type: "success", title: "Topic Summary 配置已保存" });
    } catch (error) {
      notifyError("保存 Topic Summary 配置失败", error);
    } finally {
      setSavingTopicSummaryConfig(false);
    }
  }

  async function handleClearTopicSummaryState(): Promise<void> {
    const profileId = topicSummarySelectedProfileId || topicSummaryActiveProfileId;
    if (!profileId) {
      setNotice({ type: "error", title: "请先选择 profile" });
      return;
    }

    setClearingTopicSummaryState(true);
    try {
      const payload = await request<{ ok: boolean; state: TopicSummaryState }>("/admin/api/topic-summary/state/clear", {
        method: "POST",
        body: JSON.stringify({ profileId })
      });
      setTopicSummaryState(normalizeTopicSummaryState(payload.state ?? DEFAULT_TOPIC_SUMMARY_STATE));
      await loadTopicSummaryConfig();
      setNotice({ type: "success", title: "Topic Summary sent log 已清空" });
    } catch (error) {
      notifyError("清空 Topic Summary sent log 失败", error);
    } finally {
      setClearingTopicSummaryState(false);
    }
  }

  function handleWritingTopicSelect(topicId: string): void {
    const normalizedTopicId = normalizeWritingTopicId(topicId);
    if (!normalizedTopicId) {
      return;
    }

    setWritingSelectedTopicId(normalizedTopicId);
    setWritingTopicIdDraft(normalizedTopicId);
    const target = writingTopics.find((item) => item.topicId === normalizedTopicId);
    if (target) {
      setWritingTopicTitleDraft(target.title);
    }
    setWritingManualContent("");
    void loadWritingTopicDetail(normalizedTopicId);
  }

  async function handleAppendWritingTopic(): Promise<void> {
    const topicId = normalizeWritingTopicId(writingTopicIdDraft);
    if (!topicId) {
      setNotice({ type: "error", title: "请先输入合法 topicId" });
      return;
    }

    const content = writingAppendDraft.trim();
    if (!content) {
      setNotice({ type: "error", title: "append content 不能为空" });
      return;
    }

    const title = writingTopicTitleDraft.trim();
    setWritingActionState("append");
    try {
      const payload = await request<{ ok: boolean; result?: { topicId?: string } }>(`/admin/api/writing/topics/${encodeURIComponent(topicId)}/append`, {
        method: "POST",
        body: JSON.stringify({
          content,
          ...(title ? { title } : {})
        })
      });
      const nextTopicId = normalizeWritingTopicId(payload.result?.topicId ?? topicId) || topicId;
      setWritingAppendDraft("");
      setWritingSelectedTopicId(nextTopicId);
      setWritingTopicIdDraft(nextTopicId);
      await loadWritingTopics({ preferredTopicId: nextTopicId });
      setNotice({ type: "success", title: `已追加内容到 topic: ${nextTopicId}` });
    } catch (error) {
      notifyError("追加 writing 内容失败", error);
    } finally {
      setWritingActionState(null);
    }
  }

  async function handleSummarizeWritingTopic(): Promise<void> {
    const topicId = normalizeWritingTopicId(writingSelectedTopicId || writingTopicIdDraft);
    if (!topicId) {
      setNotice({ type: "error", title: "请先选择或输入 topicId" });
      return;
    }

    setWritingActionState("summarize");
    try {
      await request<{ ok: boolean }>(`/admin/api/writing/topics/${encodeURIComponent(topicId)}/summarize`, {
        method: "POST",
        body: "{}"
      });
      await loadWritingTopics({ preferredTopicId: topicId });
      setNotice({ type: "success", title: `topic ${topicId} summarize 完成` });
    } catch (error) {
      notifyError("执行 writing summarize 失败", error);
    } finally {
      setWritingActionState(null);
    }
  }

  async function handleRestoreWritingTopic(): Promise<void> {
    const topicId = normalizeWritingTopicId(writingSelectedTopicId || writingTopicIdDraft);
    if (!topicId) {
      setNotice({ type: "error", title: "请先选择或输入 topicId" });
      return;
    }

    setWritingActionState("restore");
    try {
      await request<{ ok: boolean }>(`/admin/api/writing/topics/${encodeURIComponent(topicId)}/restore`, {
        method: "POST",
        body: "{}"
      });
      await loadWritingTopics({ preferredTopicId: topicId });
      setNotice({ type: "success", title: `topic ${topicId} 已恢复上一版` });
    } catch (error) {
      notifyError("执行 writing restore 失败", error);
    } finally {
      setWritingActionState(null);
    }
  }

  async function handleSetWritingTopicState(): Promise<void> {
    const topicId = normalizeWritingTopicId(writingSelectedTopicId || writingTopicIdDraft);
    if (!topicId) {
      setNotice({ type: "error", title: "请先选择或输入 topicId" });
      return;
    }

    const content = writingManualContent.trim();
    if (!content) {
      setNotice({ type: "error", title: "手动 state 内容不能为空" });
      return;
    }

    setWritingActionState("set");
    try {
      await request<{ ok: boolean }>(`/admin/api/writing/topics/${encodeURIComponent(topicId)}/state`, {
        method: "POST",
        body: JSON.stringify({
          section: writingManualSection,
          content
        })
      });
      await loadWritingTopics({ preferredTopicId: topicId });
      setNotice({ type: "success", title: `topic ${topicId} 的 ${writingManualSection} 已更新` });
    } catch (error) {
      notifyError("手动更新 writing state 失败", error);
    } finally {
      setWritingActionState(null);
    }
  }

  async function handleSubmitEvolutionGoal(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const goal = evolutionGoalDraft.trim();
    const commitMessage = evolutionCommitDraft.trim();

    if (!goal) {
      setNotice({ type: "error", title: "请先输入 Goal 需求" });
      return;
    }

    setSubmittingEvolutionGoal(true);
    try {
      const payload = await request<{ ok: boolean; goal: EvolutionGoal }>("/admin/api/evolution/goals", {
        method: "POST",
        body: JSON.stringify({
          goal,
          ...(commitMessage ? { commitMessage } : {})
        })
      });
      await loadEvolutionState({ silent: true });
      setEvolutionGoalDraft("");
      setNotice({
        type: "success",
        title: "Evolution Goal 已入队",
        text: `${payload.goal.id} (${payload.goal.status})`
      });
    } catch (error) {
      notifyError("提交 Evolution Goal 失败", error);
    } finally {
      setSubmittingEvolutionGoal(false);
    }
  }

  async function handleTriggerEvolutionTick(): Promise<void> {
    setTriggeringEvolutionTick(true);
    try {
      await request<{ ok: boolean }>("/admin/api/evolution/tick", {
        method: "POST",
        body: "{}"
      });
      await loadEvolutionState({ silent: true });
      setNotice({ type: "success", title: "已触发 Evolution Tick" });
    } catch (error) {
      notifyError("触发 Evolution Tick 失败", error);
    } finally {
      setTriggeringEvolutionTick(false);
    }
  }

  function notifyError(title: string, error: unknown): void {
    const text = error instanceof Error ? error.message : String(error ?? "unknown error");
    setNotice({ type: "error", title, text });
  }

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-6 md:px-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Paimon Admin</h1>
        <p className="text-sm text-muted-foreground">在一个页面中管理模型、消息任务、Market/Topic/Writing 模块与 Evolution 引擎</p>
      </header>

      {notice ? (
        <Alert variant={notice.type === "error" ? "destructive" : "default"}>
          <AlertTitle>{notice.title}</AlertTitle>
          {notice.text ? <AlertDescription>{notice.text}</AlertDescription> : null}
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <FeatureMenu activeMenu={activeMenu} onChange={setActiveMenu} />

        <section className="min-w-0 space-y-4">
          {activeMenu === "system" ? (
            <SystemSection
              config={config}
              models={models}
              llmProviderStore={llmProviderStore}
              searchEngineStore={marketSearchEngineStore}
              savingLLMProvider={savingLLMProvider}
              deletingLLMProviderId={deletingLLMProviderId}
              savingSearchEngine={savingMarketSearchEngine}
              deletingSearchEngineId={deletingMarketSearchEngineId}
              updatingMainFlowProviders={updatingMainFlowProviders}
              memoryDraft={memoryDraft}
              runtimeDraft={runtimeDraft}
              operationState={systemOperationState}
              savingMemoryConfig={savingMemoryConfig}
              savingRuntimeConfig={savingRuntimeConfig}
              onMemoryDraftChange={updateMemoryDraft}
              onRuntimeDraftChange={updateRuntimeDraft}
              onRefreshModels={() => void loadModels()}
              onRefreshConfig={() => void loadConfig()}
              onRefreshLLMProviders={() => void loadLLMProviders()}
              onRefreshSearchEngines={() => void loadSearchEngines()}
              onUpsertLLMProvider={(provider) => void handleUpsertLLMProvider(provider)}
              onDeleteLLMProvider={(providerId) => void handleDeleteLLMProvider(providerId)}
              onUpsertSearchEngine={(engine) => void handleUpsertMarketSearchEngine(engine)}
              onDeleteSearchEngine={(engineId) => void handleDeleteMarketSearchEngine(engineId)}
              onSetDefaultSearchEngine={(engineId) => void handleSetDefaultMarketSearchEngine(engineId)}
              onSetMainFlowProviders={(selection) => void handleSetMainFlowProviders(selection)}
              onSaveMemoryConfig={() => void handleSaveMemoryConfig()}
              onSaveRuntimeConfig={() => void handleSaveRuntimeConfig()}
              onRestartPm2={() => void handleRestartPm2()}
              onPullRepo={() => void handlePullRepo()}
              onBuildRepo={() => void handleBuildRepo()}
              onDeployRepo={() => void handleDeployRepo()}
            />
          ) : null}

          {activeMenu === "evolution" ? (
            <EvolutionSection
              evolutionSnapshot={evolutionSnapshot}
              currentEvolutionGoal={currentEvolutionGoal}
              evolutionQueueRows={evolutionQueueRows}
              loadingEvolution={loadingEvolution}
              evolutionGoalDraft={evolutionGoalDraft}
              evolutionCommitDraft={evolutionCommitDraft}
              submittingEvolutionGoal={submittingEvolutionGoal}
              triggeringEvolutionTick={triggeringEvolutionTick}
              codexModelDraft={codexDraft.model}
              codexReasoningEffortDraft={codexDraft.reasoningEffort}
              savingCodexConfig={savingCodexConfig}
              onGoalDraftChange={setEvolutionGoalDraft}
              onCommitDraftChange={setEvolutionCommitDraft}
              onCodexModelDraftChange={(value) => updateCodexDraft("model", value)}
              onCodexReasoningEffortDraftChange={(value) => updateCodexDraft("reasoningEffort", value)}
              onSubmitGoal={(event) => void handleSubmitEvolutionGoal(event)}
              onTriggerTick={() => void handleTriggerEvolutionTick()}
              onRefresh={() => void loadEvolutionState()}
              onSaveCodexConfig={() => void handleSaveCodexConfig()}
            />
          ) : null}

          {activeMenu === "market" ? (
            <MarketSection
              marketConfig={marketConfig}
              marketPortfolio={marketPortfolio}
              marketAnalysisConfig={marketAnalysisConfig}
              marketSearchEngines={marketSearchEngines}
              defaultMarketSearchEngineId={defaultMarketSearchEngineId}
              llmProviders={llmProviders}
              defaultLlmProviderId={defaultLlmProviderId}
              marketRuns={marketRuns}
              savingMarketPortfolio={savingMarketPortfolio}
              savingMarketAnalysisConfig={savingMarketAnalysisConfig}
              marketFundSaveStates={marketFundSaveStates}
              bootstrappingMarketTasks={bootstrappingMarketTasks}
              runningMarketOncePhase={runningMarketOncePhase}
              marketRunOnceWithExplanation={marketRunOnceWithExplanation}
              enabledUsers={enabledUsers}
              marketTaskUserId={marketTaskUserId}
              marketMiddayTime={marketMiddayTime}
              marketCloseTime={marketCloseTime}
              marketBatchCodesInput={marketBatchCodesInput}
              importingMarketCodes={importingMarketCodes}
              marketSearchInputs={marketSearchInputs}
              marketSearchResults={marketSearchResults}
              searchingMarketFundIndex={searchingMarketFundIndex}
              onCashChange={handleMarketCashChange}
              onMarketAssetTypeChange={handleMarketAssetTypeChange}
              onMarketAnalysisEngineChange={handleMarketAnalysisEngineChange}
              onMarketSearchEngineChange={handleMarketSearchEngineChange}
              onMarketFundNewsQuerySuffixChange={handleMarketFundNewsQuerySuffixChange}
              onMarketGptPluginTimeoutMsChange={handleMarketGptPluginTimeoutMsChange}
              onMarketGptPluginFallbackToLocalChange={handleMarketGptPluginFallbackToLocalChange}
              onMarketFundEnabledChange={handleMarketFundEnabledChange}
              onMarketFundMaxAgeDaysChange={handleMarketFundMaxAgeDaysChange}
              onMarketFundFeatureLookbackDaysChange={handleMarketFundFeatureLookbackDaysChange}
              onMarketFundRiskLevelChange={handleMarketFundRiskLevelChange}
              onMarketFundLlmRetryMaxChange={handleMarketFundLlmRetryMaxChange}
              onMarketTaskUserIdChange={setMarketTaskUserId}
              onMarketMiddayTimeChange={setMarketMiddayTime}
              onMarketCloseTimeChange={setMarketCloseTime}
              onMarketBatchCodesInputChange={setMarketBatchCodesInput}
              onAddMarketFund={handleAddMarketFund}
              onRemoveMarketFund={handleRemoveMarketFund}
              onMarketFundChange={handleMarketFundChange}
              onMarketSearchInputChange={handleMarketSearchInputChange}
              onSearchMarketByName={(index) => void handleSearchMarketByName(index)}
              onApplyMarketSearchResult={handleApplyMarketSearchResult}
              onSaveMarketFund={(index) => void handleSaveMarketFund(index)}
              onSaveMarketPortfolio={() => void handleSaveMarketPortfolio()}
              onSaveMarketAnalysisConfig={() => void handleSaveMarketAnalysisConfig()}
              onImportMarketCodes={() => void handleImportMarketCodes()}
              onRefresh={() => void Promise.all([loadMarketConfig(), loadMarketRuns()])}
              onBootstrapMarketTasks={() => void handleBootstrapMarketTasks()}
              onMarketRunOnceWithExplanationChange={setMarketRunOnceWithExplanation}
              onRunMarketOnce={(phase, withExplanation) => void handleRunMarketOnce(phase, withExplanation)}
            />
          ) : null}

          {activeMenu === "topic" ? (
            <TopicSummarySection
              topicSummaryProfiles={topicSummaryProfiles}
              topicSummaryActiveProfileId={topicSummaryActiveProfileId}
              topicSummarySelectedProfileId={topicSummarySelectedProfileId}
              topicSummaryConfig={topicSummaryConfig}
              llmProviders={llmProviders}
              defaultLlmProviderId={defaultLlmProviderId}
              topicSummaryState={topicSummaryState}
              savingTopicSummaryProfileAction={savingTopicSummaryProfileAction}
              savingTopicSummaryConfig={savingTopicSummaryConfig}
              clearingTopicSummaryState={clearingTopicSummaryState}
              onSelectProfile={handleTopicProfileSelect}
              onAddProfile={() => void handleAddTopicProfile()}
              onRenameProfile={() => void handleRenameTopicProfile()}
              onUseProfile={() => void handleUseTopicProfile()}
              onDeleteProfile={() => void handleDeleteTopicProfile()}
              onSummaryEngineChange={handleTopicSummaryEngineChange}
              onDefaultLanguageChange={handleTopicDefaultLanguageChange}
              onSourceChange={handleTopicSourceChange}
              onAddSource={handleAddTopicSource}
              onRemoveSource={handleRemoveTopicSource}
              onSaveConfig={() => void handleSaveTopicSummaryConfig()}
              onRefresh={() => void loadTopicSummaryConfig()}
              onClearSentLog={() => void handleClearTopicSummaryState()}
            />
          ) : null}

          {activeMenu === "writing" ? (
            <WritingOrganizerSection
              topics={writingTopics}
              selectedTopicId={writingSelectedTopicId}
              topicIdDraft={writingTopicIdDraft}
              topicTitleDraft={writingTopicTitleDraft}
              appendDraft={writingAppendDraft}
              detail={writingTopicDetail}
              loadingTopics={loadingWritingTopics}
              loadingDetail={loadingWritingDetail}
              actionState={writingActionState}
              manualSection={writingManualSection}
              manualContent={writingManualContent}
              onSelectTopic={handleWritingTopicSelect}
              onTopicIdDraftChange={setWritingTopicIdDraft}
              onTopicTitleDraftChange={setWritingTopicTitleDraft}
              onAppendDraftChange={setWritingAppendDraft}
              onManualSectionChange={setWritingManualSection}
              onManualContentChange={setWritingManualContent}
              onRefresh={() => void loadWritingTopics()}
              onAppend={() => void handleAppendWritingTopic()}
              onSummarize={() => void handleSummarizeWritingTopic()}
              onRestore={() => void handleRestoreWritingTopic()}
              onSetState={() => void handleSetWritingTopicState()}
            />
          ) : null}

          {activeMenu === "messages" ? (
            <MessagesSection
              users={users}
              tasks={tasks}
              userMap={userMap}
              enabledUsers={enabledUsers}
              editingUserId={editingUserId}
              savingUser={savingUser}
              userForm={userForm}
              editingTaskId={editingTaskId}
              savingTask={savingTask}
              runningTaskId={runningTaskId}
              taskForm={taskForm}
              onUserFormChange={(patch) => setUserForm((prev) => ({ ...prev, ...patch }))}
              onBeginCreateUser={beginCreateUser}
              onBeginEditUser={beginEditUser}
              onSubmitUser={(event) => void handleSubmitUser(event)}
              onDeleteUser={(user) => void handleDeleteUser(user)}
              onTaskFormChange={(patch) => setTaskForm((prev) => ({ ...prev, ...patch }))}
              onBeginCreateTask={beginCreateTask}
              onBeginEditTask={beginEditTask}
              onSubmitTask={(event) => void handleSubmitTask(event)}
              onDeleteTask={(task) => void handleDeleteTask(task)}
              onRunTask={(task) => void handleRunTask(task)}
            />
          ) : null}
        </section>
      </div>
    </main>
  );
}

function resizeStringArray(values: string[], targetLength: number): string[] {
  if (values.length === targetLength) {
    return values;
  }
  if (values.length > targetLength) {
    return values.slice(0, targetLength);
  }
  return values.concat(Array.from({ length: targetLength - values.length }, () => ""));
}

function resizeSearchResultsArray(values: MarketSecuritySearchItem[][], targetLength: number): MarketSecuritySearchItem[][] {
  if (values.length === targetLength) {
    return values;
  }
  if (values.length > targetLength) {
    return values.slice(0, targetLength);
  }
  return values.concat(Array.from({ length: targetLength - values.length }, () => [] as MarketSecuritySearchItem[]));
}

function resizeSavedFundsArray(values: Array<MarketFundHolding | null>, targetLength: number): Array<MarketFundHolding | null> {
  if (values.length === targetLength) {
    return values;
  }
  if (values.length > targetLength) {
    return values.slice(0, targetLength);
  }
  return values.concat(Array.from({ length: targetLength - values.length }, () => null));
}

function normalizeMarketFund(fund: Partial<MarketFundHolding> | null | undefined): MarketFundHolding {
  const digits = String(fund?.code ?? "").replace(/\D/g, "");
  const quantity = Number(fund?.quantity);
  const avgCost = Number(fund?.avgCost);
  return {
    code: digits ? digits.slice(-6).padStart(6, "0") : "",
    name: String(fund?.name ?? "").trim(),
    ...(Number.isFinite(quantity) && quantity > 0 ? { quantity } : {}),
    ...(Number.isFinite(avgCost) && avgCost >= 0 ? { avgCost } : {})
  };
}

function normalizeMarketPortfolio(portfolio: MarketPortfolio): MarketPortfolio {
  return {
    cash: Number.isFinite(Number(portfolio?.cash)) ? Number(portfolio.cash) : 0,
    funds: Array.isArray(portfolio?.funds) ? portfolio.funds.map((fund) => normalizeMarketFund(fund)) : []
  };
}

function normalizeMarketAnalysisConfig(config: MarketAnalysisConfig): MarketAnalysisConfig {
  const assetType = config?.assetType === "fund" ? "fund" : "equity";
  const engine = normalizeMarketAnalysisEngine(config?.analysisEngine);
  const searchEngine = normalizeMarketSearchEngine(config?.searchEngine);
  const timeoutMs = Number(config?.gptPlugin?.timeoutMs);
  const fallbackToLocal = typeof config?.gptPlugin?.fallbackToLocal === "boolean"
    ? config.gptPlugin.fallbackToLocal
    : DEFAULT_MARKET_ANALYSIS_CONFIG.gptPlugin.fallbackToLocal;
  const maxAgeDays = Number(config?.fund?.maxAgeDays);
  const featureLookbackDays = Number(config?.fund?.featureLookbackDays);
  const llmRetryMax = Number(config?.fund?.llmRetryMax);
  const newsQuerySuffix = typeof config?.fund?.newsQuerySuffix === "string"
    ? config.fund.newsQuerySuffix.trim()
    : DEFAULT_MARKET_ANALYSIS_CONFIG.fund.newsQuerySuffix;
  const riskLevel = config?.fund?.ruleRiskLevel === "low"
    ? "low"
    : config?.fund?.ruleRiskLevel === "high"
      ? "high"
      : "medium";
  return {
    version: 1,
    assetType,
    analysisEngine: engine,
    searchEngine,
    gptPlugin: {
      timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.floor(timeoutMs) : DEFAULT_MARKET_ANALYSIS_CONFIG.gptPlugin.timeoutMs,
      fallbackToLocal
    },
    fund: {
      enabled: typeof config?.fund?.enabled === "boolean"
        ? config.fund.enabled
        : DEFAULT_MARKET_ANALYSIS_CONFIG.fund.enabled,
      maxAgeDays: Number.isFinite(maxAgeDays) && maxAgeDays > 0
        ? Math.floor(maxAgeDays)
        : DEFAULT_MARKET_ANALYSIS_CONFIG.fund.maxAgeDays,
      featureLookbackDays: Number.isFinite(featureLookbackDays) && featureLookbackDays > 0
        ? Math.floor(featureLookbackDays)
        : DEFAULT_MARKET_ANALYSIS_CONFIG.fund.featureLookbackDays,
      ruleRiskLevel: riskLevel,
      llmRetryMax: Number.isFinite(llmRetryMax) && llmRetryMax > 0
        ? Math.floor(llmRetryMax)
        : DEFAULT_MARKET_ANALYSIS_CONFIG.fund.llmRetryMax,
      newsQuerySuffix: newsQuerySuffix || DEFAULT_MARKET_ANALYSIS_CONFIG.fund.newsQuerySuffix
    }
  };
}

function normalizeTopicSummaryConfig(config: TopicSummaryConfig | null | undefined): TopicSummaryConfig {
  const fallback = DEFAULT_TOPIC_SUMMARY_CONFIG;
  const source = config ?? fallback;
  const rawSources = Array.isArray(source.sources) ? source.sources : [];
  const sources = rawSources.map((item, index) => normalizeTopicSummarySource(item, index));

  const topicKeys: Array<keyof TopicSummaryConfig["topics"]> = [
    "llm_apps",
    "agents",
    "multimodal",
    "reasoning",
    "rag",
    "eval",
    "on_device",
    "safety"
  ];
  const topics = topicKeys.reduce<TopicSummaryConfig["topics"]>((acc, key) => {
    const list = Array.isArray(source.topics?.[key]) ? source.topics[key] : [];
    acc[key] = Array.from(new Set(list.map((item) => String(item ?? "").trim()).filter(Boolean)));
    return acc;
  }, {
    llm_apps: [],
    agents: [],
    multimodal: [],
    reasoning: [],
    rag: [],
    eval: [],
    on_device: [],
    safety: []
  });

  const filters = source.filters ?? fallback.filters;
  const dailyQuota = source.dailyQuota ?? fallback.dailyQuota;
  const summaryEngine = normalizeTopicSummaryEngine(source.summaryEngine);
  const defaultLanguage = normalizeTopicSummaryDefaultLanguage(source.defaultLanguage);

  return {
    version: 1,
    summaryEngine,
    defaultLanguage,
    sources,
    topics,
    filters: {
      timeWindowHours: clampNumberValue(filters.timeWindowHours, 24, 1, 168),
      minTitleLength: clampNumberValue(filters.minTitleLength, 8, 1, 80),
      blockedDomains: Array.isArray(filters.blockedDomains) ? filters.blockedDomains.map((item) => String(item ?? "").trim()).filter(Boolean) : [],
      blockedKeywordsInTitle: Array.isArray(filters.blockedKeywordsInTitle)
        ? filters.blockedKeywordsInTitle.map((item) => String(item ?? "").trim()).filter(Boolean)
        : [],
      maxPerDomain: clampNumberValue(filters.maxPerDomain, 2, 1, 10),
      dedup: {
        titleSimilarityThreshold: clampFloatValue(filters.dedup?.titleSimilarityThreshold, 0.9, 0.5, 1),
        urlNormalization: typeof filters.dedup?.urlNormalization === "boolean" ? filters.dedup.urlNormalization : true
      }
    },
    dailyQuota: {
      total: clampNumberValue(dailyQuota.total, fallback.dailyQuota.total, 1, 40),
      engineering: clampNumberValue(dailyQuota.engineering, fallback.dailyQuota.engineering, 0, 40),
      news: clampNumberValue(dailyQuota.news, fallback.dailyQuota.news, 0, 40),
      ecosystem: clampNumberValue(dailyQuota.ecosystem, fallback.dailyQuota.ecosystem, 0, 40)
    }
  };
}

function normalizeMarketAnalysisEngine(raw: unknown): string {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value || value === "local" || value === "default" || value === "auto") {
    return "local";
  }
  if (["gpt_plugin", "gpt-plugin", "gptplugin", "chatgpt-bridge", "chatgpt_bridge", "bridge"].includes(value)) {
    return "gpt_plugin";
  }
  if (value === "gemini") {
    return "gemini";
  }
  return value.replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "local";
}

function normalizeMarketSearchEngine(raw: unknown): string {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value || value === "default" || value === "auto" || value === "local") {
    return "default";
  }
  if (["serpapi", "serp-api", "serp_api", "google-news", "google_news"].includes(value)) {
    return "serpapi";
  }
  return value.replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "default";
}

function normalizeTopicSummaryEngine(raw: unknown): string {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value || value === "local" || value === "default" || value === "auto") {
    return "local";
  }
  if (["gpt_plugin", "gpt-plugin", "gptplugin", "chatgpt-bridge", "chatgpt_bridge", "bridge"].includes(value)) {
    return "gpt_plugin";
  }
  return value.replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "local";
}

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

function resolveMarketAnalysisProviderId(raw: unknown, store: LLMProviderStore | null | undefined): string {
  const normalized = normalizeMarketAnalysisEngine(raw);
  return resolveModuleProviderId(normalized, store, { allowGeminiLegacy: true });
}

function resolveTopicSummaryProviderId(raw: unknown, store: LLMProviderStore | null | undefined): string {
  const normalized = normalizeTopicSummaryEngine(raw);
  return resolveModuleProviderId(normalized, store);
}

function resolveMarketSearchEngineId(raw: unknown, store: SearchEngineStore | null | undefined): string {
  const normalized = normalizeMarketSearchEngine(raw);
  if (!store || !Array.isArray(store.engines) || store.engines.length === 0) {
    return normalized;
  }

  if (normalized === "default") {
    return resolveDefaultMarketSearchEngineId(store) || normalized;
  }
  if (normalized === "serpapi") {
    const serpApiEngineId = store.engines.find((item) => item.type === "serpapi" && item.enabled)?.id
      ?? store.engines.find((item) => item.type === "serpapi")?.id;
    return serpApiEngineId || resolveDefaultMarketSearchEngineId(store) || normalized;
  }
  if (store.engines.some((item) => item.id === normalized)) {
    return normalized;
  }
  return resolveDefaultMarketSearchEngineId(store) || normalized;
}

function resolveModuleProviderId(
  normalizedEngine: string,
  store: LLMProviderStore | null | undefined,
  options: { allowGeminiLegacy?: boolean } = {}
): string {
  if (!store || !Array.isArray(store.providers) || store.providers.length === 0) {
    return normalizedEngine;
  }

  if (store.providers.some((item) => item.id === normalizedEngine)) {
    return normalizedEngine;
  }

  const defaultProviderId = resolveDefaultLlmProviderId(store);
  if (normalizedEngine === "local") {
    return defaultProviderId || normalizedEngine;
  }
  if (normalizedEngine === "gpt_plugin") {
    const gptPluginProviderId = store.providers.find((item) => item.type === "gpt-plugin")?.id;
    return gptPluginProviderId || defaultProviderId || normalizedEngine;
  }
  if (options.allowGeminiLegacy && normalizedEngine === "gemini") {
    return normalizedEngine;
  }
  return defaultProviderId || normalizedEngine;
}

function normalizeTopicSummaryDefaultLanguage(raw: unknown): TopicSummaryDigestLanguage {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value.startsWith("zh")) {
    return "zh-CN";
  }
  if (value.startsWith("en")) {
    return "en";
  }
  return "auto";
}

function normalizeTopicSummarySource(source: Partial<TopicSummarySource> | null | undefined, index: number): TopicSummarySource {
  const id = normalizeTopicSourceId(String(source?.id ?? ""));
  const category = normalizeTopicSummaryCategory(source?.category);
  const weight = Number(source?.weight);
  return {
    id: id || `source-${index + 1}`,
    name: String(source?.name ?? "").trim(),
    category,
    feedUrl: String(source?.feedUrl ?? "").trim(),
    weight: Number.isFinite(weight) ? clampFloatValue(weight, 1, 0.1, 5) : 1,
    enabled: typeof source?.enabled === "boolean" ? source.enabled : true
  };
}

function normalizeTopicSummaryCategory(raw: unknown): TopicSummaryCategory {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "news") {
    return "news";
  }
  if (value === "ecosystem") {
    return "ecosystem";
  }
  return "engineering";
}

function normalizeTopicSourceId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function buildNextTopicSourceId(baseId: string, existingIds: string[]): string {
  const normalizedBase = normalizeTopicSourceId(baseId) || "source";
  const used = new Set(existingIds.map((item) => normalizeTopicSourceId(item)));
  if (!used.has(normalizedBase)) {
    return normalizedBase;
  }

  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${normalizedBase}-${i}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }

  return `${normalizedBase}-${Date.now()}`;
}

function normalizeTopicSummaryState(state: TopicSummaryState | null | undefined): TopicSummaryState {
  const source = state ?? DEFAULT_TOPIC_SUMMARY_STATE;
  const sentLog = Array.isArray(source.sentLog)
    ? source.sentLog
        .map((item) => ({
          urlNormalized: String(item?.urlNormalized ?? "").trim(),
          sentAt: String(item?.sentAt ?? "").trim(),
          title: String(item?.title ?? "").trim()
        }))
        .filter((item) => Boolean(item.urlNormalized))
    : [];

  return {
    version: 1,
    sentLog: sentLog.slice(0, 5000),
    updatedAt: String(source.updatedAt ?? "").trim()
  };
}

function normalizeTopicSummaryProfilesPayload(
  payload: TopicSummaryProfilesPayload | null | undefined
): { activeProfileId: string; profiles: TopicSummaryProfile[] } {
  const source = payload ?? {
    activeProfileId: "",
    profiles: []
  } as TopicSummaryProfilesPayload;

  const rawProfiles = Array.isArray(source.profiles) ? source.profiles : [];
  const profiles: TopicSummaryProfile[] = [];
  const idSet = new Set<string>();

  for (let i = 0; i < rawProfiles.length; i += 1) {
    const item = rawProfiles[i];
    const normalizedId = normalizeTopicProfileId(String(item?.id ?? ""));
    const id = normalizedId || `profile-${i + 1}`;
    if (idSet.has(id)) {
      continue;
    }
    idSet.add(id);
    profiles.push({
      id,
      name: String(item?.name ?? id).trim() || id,
      isActive: Boolean(item?.isActive),
      config: normalizeTopicSummaryConfig(item?.config ?? DEFAULT_TOPIC_SUMMARY_CONFIG),
      state: normalizeTopicSummaryState(item?.state ?? DEFAULT_TOPIC_SUMMARY_STATE)
    });
  }

  if (profiles.length === 0) {
    const fallbackId = "ai-engineering";
    profiles.push({
      id: fallbackId,
      name: "AI Engineering",
      isActive: true,
      config: normalizeTopicSummaryConfig(source.config ?? DEFAULT_TOPIC_SUMMARY_CONFIG),
      state: normalizeTopicSummaryState(source.state ?? DEFAULT_TOPIC_SUMMARY_STATE)
    });
  }

  const activeFromPayload = normalizeTopicProfileId(String(source.activeProfileId ?? ""));
  const activeId = profiles.some((item) => item.id === activeFromPayload)
    ? activeFromPayload
    : (profiles.find((item) => item.isActive)?.id ?? profiles[0].id);

  return {
    activeProfileId: activeId,
    profiles: profiles.map((item) => ({
      ...item,
      isActive: item.id === activeId
    }))
  };
}

function normalizeTopicProfileId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function isLikelyRestartConnectionDrop(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const lower = message.toLowerCase();
  return lower.includes("failed to fetch")
    || lower.includes("networkerror")
    || lower.includes("network request failed")
    || lower.includes("load failed");
}

function normalizeWritingTopicId(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9\u4e00-\u9fff-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function normalizeWritingTopicMetaList(input: unknown): WritingTopicMeta[] {
  const list = Array.isArray(input) ? input : [];
  const normalized: WritingTopicMeta[] = [];
  const idSet = new Set<string>();

  for (const item of list) {
    const topicId = normalizeWritingTopicId(String((item as { topicId?: unknown } | null)?.topicId ?? ""));
    if (!topicId || idSet.has(topicId)) {
      continue;
    }
    idSet.add(topicId);
    normalized.push(normalizeWritingTopicMeta(item as Partial<WritingTopicMeta>, topicId));
  }

  return normalized.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

function normalizeWritingTopicMeta(input: Partial<WritingTopicMeta> | null | undefined, fallbackTopicId: string): WritingTopicMeta {
  const topicId = normalizeWritingTopicId(String(input?.topicId ?? fallbackTopicId)) || fallbackTopicId || "untitled-topic";
  const rawFileCount = Number(input?.rawFileCount);
  const rawLineCount = Number(input?.rawLineCount);
  return {
    topicId,
    title: String(input?.title ?? topicId).trim() || topicId,
    status: input?.status === "archived" ? "archived" : "active",
    rawFileCount: Number.isFinite(rawFileCount) && rawFileCount >= 0 ? Math.floor(rawFileCount) : 0,
    rawLineCount: Number.isFinite(rawLineCount) && rawLineCount >= 0 ? Math.floor(rawLineCount) : 0,
    lastSummarizedAt: String(input?.lastSummarizedAt ?? "").trim() || undefined,
    createdAt: String(input?.createdAt ?? "").trim(),
    updatedAt: String(input?.updatedAt ?? "").trim()
  };
}

function normalizeWritingTopicState(state: WritingTopicState | null | undefined): WritingTopicState {
  return {
    summary: String(state?.summary ?? "").trim(),
    outline: String(state?.outline ?? "").trim(),
    draft: String(state?.draft ?? "").trim()
  };
}

function normalizeWritingTopicDetail(detail: WritingTopicDetail | null | undefined, fallbackTopicId: string): WritingTopicDetail {
  const topicId = normalizeWritingTopicId(detail?.meta?.topicId ?? fallbackTopicId) || fallbackTopicId || "untitled-topic";
  const meta = normalizeWritingTopicMeta(detail?.meta, topicId);
  const rawFiles = Array.isArray(detail?.rawFiles)
    ? detail.rawFiles
        .map((file) => ({
          name: String(file?.name ?? "").trim(),
          lineCount: Number.isFinite(Number(file?.lineCount)) ? Math.max(0, Math.floor(Number(file?.lineCount))) : 0,
          content: String(file?.content ?? "").trim()
        }))
        .filter((file) => Boolean(file.name))
    : [];
  return {
    meta,
    state: normalizeWritingTopicState(detail?.state ?? DEFAULT_WRITING_TOPIC_STATE),
    backup: normalizeWritingTopicState(detail?.backup ?? DEFAULT_WRITING_TOPIC_STATE),
    rawFiles
  };
}

function clampNumberValue(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const rounded = Math.floor(value);
  if (rounded < min) {
    return min;
  }
  if (rounded > max) {
    return max;
  }
  return rounded;
}

function clampFloatValue(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return Math.round(value * 100) / 100;
}

function isValidMarketFund(fund: MarketFundHolding): boolean {
  return Boolean(fund.code);
}

function isSameMarketFund(left: MarketFundHolding, right: MarketFundHolding): boolean {
  const leftQuantity = typeof left.quantity === "number" ? left.quantity : null;
  const rightQuantity = typeof right.quantity === "number" ? right.quantity : null;
  const leftAvgCost = typeof left.avgCost === "number" ? left.avgCost : null;
  const rightAvgCost = typeof right.avgCost === "number" ? right.avgCost : null;
  return left.code === right.code
    && left.name === right.name
    && leftQuantity === rightQuantity
    && leftAvgCost === rightAvgCost;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  const raw = await response.text();
  let payload: unknown = {};
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = { error: raw };
    }
  }

  if (!response.ok) {
    const errorObject = payload as { error?: string };
    throw new Error(errorObject?.error ?? `HTTP ${response.status}`);
  }

  return payload as T;
}
