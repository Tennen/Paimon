import { useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { EvolutionSection } from "@/components/admin/EvolutionSection";
import { FeatureMenu } from "@/components/admin/FeatureMenu";
import { MarketSection } from "@/components/admin/MarketSection";
import { MessagesSection } from "@/components/admin/MessagesSection";
import { SystemSection } from "@/components/admin/SystemSection";
import { TopicPushSection } from "@/components/admin/TopicPushSection";
import { buildEvolutionQueueRows } from "@/lib/evolutionQueueRows";
import {
  AdminConfig,
  DEFAULT_TOPIC_PUSH_CONFIG,
  DEFAULT_TOPIC_PUSH_STATE,
  DEFAULT_MARKET_ANALYSIS_CONFIG,
  DEFAULT_MARKET_PORTFOLIO,
  EMPTY_TASK_FORM,
  EMPTY_USER_FORM,
  EvolutionGoal,
  EvolutionGoalHistory,
  EvolutionStateSnapshot,
  MarketConfig,
  MarketAnalysisConfig,
  MarketAnalysisEngine,
  MarketFundHolding,
  MarketPhase,
  MarketPortfolio,
  MarketRunOnceResponse,
  MarketRunSummary,
  MarketSecuritySearchItem,
  MenuKey,
  Notice,
  PushUser,
  ScheduledTask,
  TaskFormState,
  TopicPushCategory,
  TopicPushConfig,
  TopicPushDigestLanguage,
  TopicPushProfile,
  TopicPushProfilesPayload,
  TopicPushSummaryEngine,
  TopicPushSource,
  TopicPushState,
  UserFormState
} from "@/types/admin";

export default function App() {
  const [config, setConfig] = useState<AdminConfig | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [users, setUsers] = useState<PushUser[]>([]);
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [modelDraft, setModelDraft] = useState("");
  const [planningModelDraft, setPlanningModelDraft] = useState("");
  const [planningTimeoutDraft, setPlanningTimeoutDraft] = useState("");
  const [thinkingBudgetEnabledDraft, setThinkingBudgetEnabledDraft] = useState(false);
  const [thinkingBudgetDraft, setThinkingBudgetDraft] = useState("");
  const [codexModelDraft, setCodexModelDraft] = useState("");
  const [codexReasoningEffortDraft, setCodexReasoningEffortDraft] = useState("");

  const [notice, setNotice] = useState<Notice>(null);

  const [savingModel, setSavingModel] = useState(false);
  const [savingCodexConfig, setSavingCodexConfig] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [pullingRepo, setPullingRepo] = useState(false);
  const [buildingRepo, setBuildingRepo] = useState(false);

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
  const [marketSearchInputs, setMarketSearchInputs] = useState<string[]>([]);
  const [marketSearchResults, setMarketSearchResults] = useState<MarketSecuritySearchItem[][]>([]);
  const [searchingMarketFundIndex, setSearchingMarketFundIndex] = useState<number | null>(null);
  const [topicPushConfig, setTopicPushConfig] = useState<TopicPushConfig>(DEFAULT_TOPIC_PUSH_CONFIG);
  const [topicPushState, setTopicPushState] = useState<TopicPushState>(DEFAULT_TOPIC_PUSH_STATE);
  const [topicPushProfiles, setTopicPushProfiles] = useState<TopicPushProfile[]>([]);
  const [topicPushActiveProfileId, setTopicPushActiveProfileId] = useState("");
  const [topicPushSelectedProfileId, setTopicPushSelectedProfileId] = useState("");
  const [savingTopicPushProfileAction, setSavingTopicPushProfileAction] = useState(false);
  const [savingTopicPushConfig, setSavingTopicPushConfig] = useState(false);
  const [clearingTopicPushState, setClearingTopicPushState] = useState(false);

  const [evolutionSnapshot, setEvolutionSnapshot] = useState<EvolutionStateSnapshot | null>(null);
  const [loadingEvolution, setLoadingEvolution] = useState(false);
  const [evolutionGoalDraft, setEvolutionGoalDraft] = useState("");
  const [evolutionCommitDraft, setEvolutionCommitDraft] = useState("");
  const [submittingEvolutionGoal, setSubmittingEvolutionGoal] = useState(false);
  const [triggeringEvolutionTick, setTriggeringEvolutionTick] = useState(false);

  const enabledUsers = useMemo(() => users.filter((user) => user.enabled), [users]);

  const userMap = useMemo(() => {
    return new Map(users.map((user) => [user.id, user]));
  }, [users]);

  const modelFromList = useMemo(() => {
    return models.includes(modelDraft) ? modelDraft : undefined;
  }, [modelDraft, models]);

  const planningModelFromList = useMemo(() => {
    const draft = planningModelDraft.trim();
    return draft && models.includes(draft) ? draft : undefined;
  }, [planningModelDraft, models]);

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

  const evolutionGoalById = new Map(
    (evolutionSnapshot?.state.goals ?? []).map((goal) => [goal.id, goal] as const)
  );
  const evolutionHistoryById = new Map(
    (evolutionSnapshot?.state.history ?? []).map((item) => [item.id, item] as const)
  );
  const evolutionGoalsInQueueOrder = evolutionQueueRows
    .map((row) => evolutionGoalById.get(row.goalId))
    .filter((goal): goal is EvolutionGoal => Boolean(goal));
  const evolutionHistoryInQueueOrder = evolutionQueueRows
    .map((row) => evolutionHistoryById.get(row.goalId))
    .filter((item): item is EvolutionGoalHistory => Boolean(item));

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
        loadTopicPushConfig(),
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
    setModelDraft(payload.model || "");
    setPlanningModelDraft(payload.planningModel || "");
    setPlanningTimeoutDraft(payload.planningTimeoutMs || "");
    setThinkingBudgetEnabledDraft(payload.thinkingBudgetEnabled === true);
    setThinkingBudgetDraft(payload.thinkingBudgetDefault ?? payload.thinkingBudget ?? "");
    setCodexModelDraft(payload.codexModel || "");
    setCodexReasoningEffortDraft(payload.codexReasoningEffort || "");
  }

  async function loadModels(): Promise<void> {
    const payload = await request<{ baseUrl: string; models: string[] }>("/admin/api/models");
    const list = Array.isArray(payload.models) ? payload.models.filter(Boolean) : [];
    setModels(list);
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
    const analysisConfig = normalizeMarketAnalysisConfig(payload.config ?? DEFAULT_MARKET_ANALYSIS_CONFIG);
    setMarketPortfolio(portfolio);
    setMarketAnalysisConfig(analysisConfig);
    setMarketSavedFundsByRow(portfolio.funds.map((fund) => ({ ...fund })));
    setMarketSavedCash(portfolio.cash);
  }

  async function loadMarketRuns(): Promise<void> {
    const payload = await request<{ runs: MarketRunSummary[] }>("/admin/api/market/runs?limit=12");
    setMarketRuns(Array.isArray(payload.runs) ? payload.runs : []);
  }

  async function loadTopicPushConfig(): Promise<void> {
    const payload = await request<TopicPushProfilesPayload>("/admin/api/topic-push/config");
    const normalized = normalizeTopicPushProfilesPayload(payload);
    setTopicPushProfiles(normalized.profiles);
    setTopicPushActiveProfileId(normalized.activeProfileId);

    const selectedId = normalized.profiles.some((item) => item.id === topicPushSelectedProfileId)
      ? topicPushSelectedProfileId
      : normalized.activeProfileId;
    setTopicPushSelectedProfileId(selectedId);

    const selectedProfile = normalized.profiles.find((item) => item.id === selectedId)
      ?? normalized.profiles[0]
      ?? null;
    setTopicPushConfig(normalizeTopicPushConfig(selectedProfile?.config ?? payload.config ?? DEFAULT_TOPIC_PUSH_CONFIG));
    setTopicPushState(normalizeTopicPushState(selectedProfile?.state ?? payload.state ?? DEFAULT_TOPIC_PUSH_STATE));
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

  async function handleSaveModel(restartAfterSave: boolean): Promise<void> {
    const model = modelDraft.trim();
    if (!model) {
      setNotice({ type: "error", title: "模型不能为空" });
      return;
    }

    const planningModel = planningModelDraft.trim();
    const planningTimeoutMs = planningTimeoutDraft.trim();
    if (planningTimeoutMs) {
      const parsed = Number(planningTimeoutMs);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setNotice({ type: "error", title: "Planning 超时必须是正整数（毫秒）" });
        return;
      }
    }
    const thinkingBudgetDefault = thinkingBudgetDraft.trim();
    if (thinkingBudgetDefault) {
      const parsed = Number(thinkingBudgetDefault);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setNotice({ type: "error", title: "Planning Thinking Budget 默认值必须是正整数（tokens）" });
        return;
      }
    }
    if (thinkingBudgetEnabledDraft && !thinkingBudgetDefault) {
      setNotice({ type: "error", title: "开启 Thinking Budget 时必须设置 Planning Thinking Budget 默认值" });
      return;
    }

    setSavingModel(true);
    try {
      const payload = await request<{ output?: string }>("/admin/api/config/model", {
        method: "POST",
        body: JSON.stringify({
          model,
          planningModel,
          planningTimeoutMs,
          thinkingBudgetEnabled: thinkingBudgetEnabledDraft,
          thinkingBudgetDefault,
          thinkingBudget: thinkingBudgetDefault,
          restart: restartAfterSave
        })
      });
      await loadConfig();
      setNotice({
        type: "success",
        title: restartAfterSave ? "模型配置已保存并触发重启" : "模型配置已保存",
        text: payload.output
      });
    } catch (error) {
      notifyError("保存模型配置失败", error);
    } finally {
      setSavingModel(false);
    }
  }

  async function handleRestartPm2(): Promise<void> {
    setRestarting(true);
    try {
      const payload = await request<{ output?: string }>("/admin/api/restart", {
        method: "POST",
        body: "{}"
      });
      setNotice({ type: "success", title: "应用进程重启完成", text: payload.output });
    } catch (error) {
      notifyError("pm2 重启失败", error);
    } finally {
      setRestarting(false);
    }
  }

  async function handleSaveCodexConfig(): Promise<void> {
    const model = codexModelDraft.trim();
    const reasoningEffort = codexReasoningEffortDraft.trim().toLowerCase();
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

  async function handlePullRepo(): Promise<void> {
    setPullingRepo(true);
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
      setPullingRepo(false);
    }
  }

  async function handleBuildRepo(): Promise<void> {
    setBuildingRepo(true);
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
      setBuildingRepo(false);
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
      userId: task.userId ?? "",
      message: task.message,
      enabled: task.enabled
    });
  }

  async function handleSubmitTask(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const payload: TaskFormState = {
      name: taskForm.name.trim(),
      time: taskForm.time.trim(),
      userId: taskForm.userId,
      message: taskForm.message.trim(),
      enabled: taskForm.enabled
    };

    if (!payload.name || !payload.time || !payload.userId || !payload.message) {
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
      funds: prev.funds.concat([{ code: "", name: "", quantity: 0, avgCost: 0 }])
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

  function handleMarketAnalysisEngineChange(value: MarketAnalysisEngine): void {
    setMarketAnalysisConfig((prev) => ({
      ...prev,
      analysisEngine: value
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

        const numeric = Number(value);
        if (key === "quantity") {
          return {
            ...fund,
            quantity: Number.isFinite(numeric) ? numeric : 0
          };
        }

        return {
          ...fund,
          avgCost: Number.isFinite(numeric) ? numeric : 0
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
      setNotice({ type: "error", title: "请完善该行持仓后再保存（代码/数量/成本）" });
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

  async function handleSaveMarketAnalysisConfig(): Promise<void> {
    if (savingMarketPortfolio || savingMarketFundIndex !== null) {
      return;
    }

    const timeoutMs = Number(marketAnalysisConfig.gptPlugin.timeoutMs);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      setNotice({ type: "error", title: "GPT Plugin 超时必须为正整数毫秒" });
      return;
    }
    const normalizedConfig = normalizeMarketAnalysisConfig(marketAnalysisConfig);

    setSavingMarketAnalysisConfig(true);
    try {
      const response = await request<{ ok: boolean; portfolio: MarketPortfolio; config: MarketAnalysisConfig }>("/admin/api/market/config", {
        method: "PUT",
        body: JSON.stringify({
          config: normalizedConfig
        })
      });
      const nextConfig = normalizeMarketAnalysisConfig(response.config);
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
    const target = topicPushProfiles.find((item) => item.id === profileId);
    if (!target) {
      return;
    }
    setTopicPushSelectedProfileId(target.id);
    setTopicPushConfig(normalizeTopicPushConfig(target.config));
    setTopicPushState(normalizeTopicPushState(target.state));
  }

  async function handleAddTopicProfile(): Promise<void> {
    const name = window.prompt("请输入 profile 名称");
    const normalizedName = String(name ?? "").trim();
    if (!normalizedName) {
      return;
    }

    const rawId = window.prompt("请输入 profile id（可留空自动生成）");
    const normalizedId = normalizeTopicProfileId(String(rawId ?? "").trim());
    const cloneFrom = topicPushSelectedProfileId || topicPushActiveProfileId;

    setSavingTopicPushProfileAction(true);
    try {
      await request<{ ok: boolean }>("/admin/api/topic-push/profiles", {
        method: "POST",
        body: JSON.stringify({
          name: normalizedName,
          ...(normalizedId ? { id: normalizedId } : {}),
          ...(cloneFrom ? { cloneFrom } : {})
        })
      });
      await loadTopicPushConfig();
      setNotice({ type: "success", title: "Topic Push profile 已创建" });
    } catch (error) {
      notifyError("创建 Topic Push profile 失败", error);
    } finally {
      setSavingTopicPushProfileAction(false);
    }
  }

  async function handleRenameTopicProfile(): Promise<void> {
    const selected = topicPushProfiles.find((item) => item.id === topicPushSelectedProfileId);
    if (!selected) {
      setNotice({ type: "error", title: "请先选择 profile" });
      return;
    }

    const name = window.prompt("请输入新的 profile 名称", selected.name);
    const normalizedName = String(name ?? "").trim();
    if (!normalizedName || normalizedName === selected.name) {
      return;
    }

    setSavingTopicPushProfileAction(true);
    try {
      await request<{ ok: boolean }>(`/admin/api/topic-push/profiles/${encodeURIComponent(selected.id)}`, {
        method: "PUT",
        body: JSON.stringify({ name: normalizedName })
      });
      await loadTopicPushConfig();
      setNotice({ type: "success", title: "Topic Push profile 已重命名" });
    } catch (error) {
      notifyError("重命名 Topic Push profile 失败", error);
    } finally {
      setSavingTopicPushProfileAction(false);
    }
  }

  async function handleUseTopicProfile(): Promise<void> {
    const selected = topicPushProfiles.find((item) => item.id === topicPushSelectedProfileId);
    if (!selected) {
      setNotice({ type: "error", title: "请先选择 profile" });
      return;
    }
    if (selected.id === topicPushActiveProfileId) {
      return;
    }

    setSavingTopicPushProfileAction(true);
    try {
      await request<{ ok: boolean }>(`/admin/api/topic-push/profiles/${encodeURIComponent(selected.id)}/use`, {
        method: "POST",
        body: "{}"
      });
      await loadTopicPushConfig();
      setNotice({ type: "success", title: "已切换 active profile" });
    } catch (error) {
      notifyError("切换 Topic Push profile 失败", error);
    } finally {
      setSavingTopicPushProfileAction(false);
    }
  }

  async function handleDeleteTopicProfile(): Promise<void> {
    const selected = topicPushProfiles.find((item) => item.id === topicPushSelectedProfileId);
    if (!selected) {
      setNotice({ type: "error", title: "请先选择 profile" });
      return;
    }

    const confirmed = window.confirm(`确认删除 profile "${selected.id}" 吗？`);
    if (!confirmed) {
      return;
    }

    setSavingTopicPushProfileAction(true);
    try {
      await request<{ ok: boolean }>(`/admin/api/topic-push/profiles/${encodeURIComponent(selected.id)}`, {
        method: "DELETE",
        body: "{}"
      });
      await loadTopicPushConfig();
      setNotice({ type: "success", title: "Topic Push profile 已删除" });
    } catch (error) {
      notifyError("删除 Topic Push profile 失败", error);
    } finally {
      setSavingTopicPushProfileAction(false);
    }
  }

  function handleTopicSourceChange(index: number, patch: Partial<TopicPushSource>): void {
    setTopicPushConfig((prev) => {
      const nextSources = prev.sources.map((item, rowIndex) => {
        if (rowIndex !== index) {
          return item;
        }
        return normalizeTopicPushSource({ ...item, ...patch }, rowIndex);
      });
      return {
        ...prev,
        sources: nextSources
      };
    });
  }

  function handleTopicSummaryEngineChange(value: TopicPushSummaryEngine): void {
    setTopicPushConfig((prev) => ({
      ...prev,
      summaryEngine: value
    }));
  }

  function handleTopicDefaultLanguageChange(value: TopicPushDigestLanguage): void {
    setTopicPushConfig((prev) => ({
      ...prev,
      defaultLanguage: value
    }));
  }

  function handleAddTopicSource(): void {
    setTopicPushConfig((prev) => {
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
    setTopicPushConfig((prev) => ({
      ...prev,
      sources: prev.sources.filter((_, rowIndex) => rowIndex !== index)
    }));
  }

  async function handleSaveTopicPushConfig(): Promise<void> {
    const profileId = topicPushSelectedProfileId || topicPushActiveProfileId;
    if (!profileId) {
      setNotice({ type: "error", title: "请先选择 profile" });
      return;
    }

    const normalizedConfig = normalizeTopicPushConfig(topicPushConfig);
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

    setSavingTopicPushConfig(true);
    try {
      const payload = await request<{ ok: boolean; config: TopicPushConfig }>("/admin/api/topic-push/config", {
        method: "PUT",
        body: JSON.stringify({
          profileId,
          config: normalizedConfig
        })
      });
      setTopicPushConfig(normalizeTopicPushConfig(payload.config ?? normalizedConfig));
      await loadTopicPushConfig();
      setNotice({ type: "success", title: "Topic Push 配置已保存" });
    } catch (error) {
      notifyError("保存 Topic Push 配置失败", error);
    } finally {
      setSavingTopicPushConfig(false);
    }
  }

  async function handleClearTopicPushState(): Promise<void> {
    const profileId = topicPushSelectedProfileId || topicPushActiveProfileId;
    if (!profileId) {
      setNotice({ type: "error", title: "请先选择 profile" });
      return;
    }

    setClearingTopicPushState(true);
    try {
      const payload = await request<{ ok: boolean; state: TopicPushState }>("/admin/api/topic-push/state/clear", {
        method: "POST",
        body: JSON.stringify({ profileId })
      });
      setTopicPushState(normalizeTopicPushState(payload.state ?? DEFAULT_TOPIC_PUSH_STATE));
      await loadTopicPushConfig();
      setNotice({ type: "success", title: "Topic Push sent log 已清空" });
    } catch (error) {
      notifyError("清空 Topic Push sent log 失败", error);
    } finally {
      setClearingTopicPushState(false);
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
        <p className="text-sm text-muted-foreground">在一个页面中管理模型、消息任务、Market 分析与 Evolution 引擎</p>
      </header>

      {notice ? (
        <Alert variant={notice.type === "error" ? "destructive" : "default"}>
          <AlertTitle>{notice.title}</AlertTitle>
          {notice.text ? <AlertDescription>{notice.text}</AlertDescription> : null}
        </Alert>
      ) : null}

      <FeatureMenu activeMenu={activeMenu} onChange={setActiveMenu} />

      {activeMenu === "system" ? (
        <SystemSection
          config={config}
          models={models}
          modelFromList={modelFromList}
          planningModelFromList={planningModelFromList}
          modelDraft={modelDraft}
          planningModelDraft={planningModelDraft}
          planningTimeoutDraft={planningTimeoutDraft}
          thinkingBudgetEnabledDraft={thinkingBudgetEnabledDraft}
          thinkingBudgetDraft={thinkingBudgetDraft}
          codexModelDraft={codexModelDraft}
          codexReasoningEffortDraft={codexReasoningEffortDraft}
          savingModel={savingModel}
          savingCodexConfig={savingCodexConfig}
          restarting={restarting}
          pullingRepo={pullingRepo}
          buildingRepo={buildingRepo}
          onModelSelect={setModelDraft}
          onModelDraftChange={setModelDraft}
          onPlanningModelSelect={setPlanningModelDraft}
          onPlanningModelDraftChange={setPlanningModelDraft}
          onPlanningTimeoutDraftChange={setPlanningTimeoutDraft}
          onThinkingBudgetEnabledDraftChange={setThinkingBudgetEnabledDraft}
          onThinkingBudgetDraftChange={setThinkingBudgetDraft}
          onCodexModelDraftChange={setCodexModelDraft}
          onCodexReasoningEffortDraftChange={setCodexReasoningEffortDraft}
          onRefreshModels={() => void loadModels()}
          onSaveModel={(restartAfterSave) => void handleSaveModel(restartAfterSave)}
          onSaveCodexConfig={() => void handleSaveCodexConfig()}
          onRestartPm2={() => void handleRestartPm2()}
          onPullRepo={() => void handlePullRepo()}
          onBuildRepo={() => void handleBuildRepo()}
        />
      ) : null}

      {activeMenu === "evolution" ? (
        <EvolutionSection
          evolutionSnapshot={evolutionSnapshot}
          currentEvolutionGoal={currentEvolutionGoal}
          {...{
            evolutionQueueRows,
            sortedEvolutionGoals: evolutionGoalsInQueueOrder,
            sortedEvolutionHistory: evolutionHistoryInQueueOrder
          }}
          loadingEvolution={loadingEvolution}
          evolutionGoalDraft={evolutionGoalDraft}
          evolutionCommitDraft={evolutionCommitDraft}
          submittingEvolutionGoal={submittingEvolutionGoal}
          triggeringEvolutionTick={triggeringEvolutionTick}
          onGoalDraftChange={setEvolutionGoalDraft}
          onCommitDraftChange={setEvolutionCommitDraft}
          onSubmitGoal={(event) => void handleSubmitEvolutionGoal(event)}
          onTriggerTick={() => void handleTriggerEvolutionTick()}
          onRefresh={() => void loadEvolutionState()}
        />
      ) : null}

      {activeMenu === "market" ? (
        <MarketSection
          marketConfig={marketConfig}
          marketPortfolio={marketPortfolio}
          marketAnalysisConfig={marketAnalysisConfig}
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
          marketSearchInputs={marketSearchInputs}
          marketSearchResults={marketSearchResults}
          searchingMarketFundIndex={searchingMarketFundIndex}
          onCashChange={handleMarketCashChange}
          onMarketAnalysisEngineChange={handleMarketAnalysisEngineChange}
          onMarketGptPluginTimeoutMsChange={handleMarketGptPluginTimeoutMsChange}
          onMarketGptPluginFallbackToLocalChange={handleMarketGptPluginFallbackToLocalChange}
          onMarketTaskUserIdChange={setMarketTaskUserId}
          onMarketMiddayTimeChange={setMarketMiddayTime}
          onMarketCloseTimeChange={setMarketCloseTime}
          onAddMarketFund={handleAddMarketFund}
          onRemoveMarketFund={handleRemoveMarketFund}
          onMarketFundChange={handleMarketFundChange}
          onMarketSearchInputChange={handleMarketSearchInputChange}
          onSearchMarketByName={(index) => void handleSearchMarketByName(index)}
          onApplyMarketSearchResult={handleApplyMarketSearchResult}
          onSaveMarketFund={(index) => void handleSaveMarketFund(index)}
          onSaveMarketPortfolio={() => void handleSaveMarketPortfolio()}
          onSaveMarketAnalysisConfig={() => void handleSaveMarketAnalysisConfig()}
          onRefresh={() => void Promise.all([loadMarketConfig(), loadMarketRuns()])}
          onBootstrapMarketTasks={() => void handleBootstrapMarketTasks()}
          onMarketRunOnceWithExplanationChange={setMarketRunOnceWithExplanation}
          onRunMarketOnce={(phase, withExplanation) => void handleRunMarketOnce(phase, withExplanation)}
        />
      ) : null}

      {activeMenu === "topic" ? (
        <TopicPushSection
          topicPushProfiles={topicPushProfiles}
          topicPushActiveProfileId={topicPushActiveProfileId}
          topicPushSelectedProfileId={topicPushSelectedProfileId}
          topicPushConfig={topicPushConfig}
          topicPushState={topicPushState}
          savingTopicPushProfileAction={savingTopicPushProfileAction}
          savingTopicPushConfig={savingTopicPushConfig}
          clearingTopicPushState={clearingTopicPushState}
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
          onSaveConfig={() => void handleSaveTopicPushConfig()}
          onRefresh={() => void loadTopicPushConfig()}
          onClearSentLog={() => void handleClearTopicPushState()}
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
  return {
    code: digits ? digits.slice(-6).padStart(6, "0") : "",
    name: String(fund?.name ?? "").trim(),
    quantity: Number.isFinite(Number(fund?.quantity)) ? Number(fund?.quantity) : 0,
    avgCost: Number.isFinite(Number(fund?.avgCost)) ? Number(fund?.avgCost) : 0
  };
}

function normalizeMarketPortfolio(portfolio: MarketPortfolio): MarketPortfolio {
  return {
    cash: Number.isFinite(Number(portfolio?.cash)) ? Number(portfolio.cash) : 0,
    funds: Array.isArray(portfolio?.funds) ? portfolio.funds.map((fund) => normalizeMarketFund(fund)) : []
  };
}

function normalizeMarketAnalysisConfig(config: MarketAnalysisConfig): MarketAnalysisConfig {
  const engine = config?.analysisEngine === "gpt_plugin" ? "gpt_plugin" : "local";
  const timeoutMs = Number(config?.gptPlugin?.timeoutMs);
  const fallbackToLocal = typeof config?.gptPlugin?.fallbackToLocal === "boolean"
    ? config.gptPlugin.fallbackToLocal
    : DEFAULT_MARKET_ANALYSIS_CONFIG.gptPlugin.fallbackToLocal;
  return {
    version: 1,
    analysisEngine: engine,
    gptPlugin: {
      timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.floor(timeoutMs) : DEFAULT_MARKET_ANALYSIS_CONFIG.gptPlugin.timeoutMs,
      fallbackToLocal
    }
  };
}

function normalizeTopicPushConfig(config: TopicPushConfig | null | undefined): TopicPushConfig {
  const fallback = DEFAULT_TOPIC_PUSH_CONFIG;
  const source = config ?? fallback;
  const rawSources = Array.isArray(source.sources) ? source.sources : [];
  const sources = rawSources.map((item, index) => normalizeTopicPushSource(item, index));

  const topicKeys: Array<keyof TopicPushConfig["topics"]> = [
    "llm_apps",
    "agents",
    "multimodal",
    "reasoning",
    "rag",
    "eval",
    "on_device",
    "safety"
  ];
  const topics = topicKeys.reduce<TopicPushConfig["topics"]>((acc, key) => {
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
  const summaryEngine = source.summaryEngine === "gpt_plugin" ? "gpt_plugin" : "local";
  const defaultLanguage = normalizeTopicPushDefaultLanguage(source.defaultLanguage);

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

function normalizeTopicPushDefaultLanguage(raw: unknown): TopicPushDigestLanguage {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value.startsWith("zh")) {
    return "zh-CN";
  }
  if (value.startsWith("en")) {
    return "en";
  }
  return "auto";
}

function normalizeTopicPushSource(source: Partial<TopicPushSource> | null | undefined, index: number): TopicPushSource {
  const id = normalizeTopicSourceId(String(source?.id ?? ""));
  const category = normalizeTopicPushCategory(source?.category);
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

function normalizeTopicPushCategory(raw: unknown): TopicPushCategory {
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

function normalizeTopicPushState(state: TopicPushState | null | undefined): TopicPushState {
  const source = state ?? DEFAULT_TOPIC_PUSH_STATE;
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

function normalizeTopicPushProfilesPayload(
  payload: TopicPushProfilesPayload | null | undefined
): { activeProfileId: string; profiles: TopicPushProfile[] } {
  const source = payload ?? {
    activeProfileId: "",
    profiles: []
  } as TopicPushProfilesPayload;

  const rawProfiles = Array.isArray(source.profiles) ? source.profiles : [];
  const profiles: TopicPushProfile[] = [];
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
      config: normalizeTopicPushConfig(item?.config ?? DEFAULT_TOPIC_PUSH_CONFIG),
      state: normalizeTopicPushState(item?.state ?? DEFAULT_TOPIC_PUSH_STATE)
    });
  }

  if (profiles.length === 0) {
    const fallbackId = "ai-engineering";
    profiles.push({
      id: fallbackId,
      name: "AI Engineering",
      isActive: true,
      config: normalizeTopicPushConfig(source.config ?? DEFAULT_TOPIC_PUSH_CONFIG),
      state: normalizeTopicPushState(source.state ?? DEFAULT_TOPIC_PUSH_STATE)
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
  return Boolean(fund.code) && Number.isFinite(fund.quantity) && fund.quantity > 0 && Number.isFinite(fund.avgCost) && fund.avgCost >= 0;
}

function isSameMarketFund(left: MarketFundHolding, right: MarketFundHolding): boolean {
  return left.code === right.code
    && left.name === right.name
    && left.quantity === right.quantity
    && left.avgCost === right.avgCost;
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
