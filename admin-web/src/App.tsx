import { useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { EvolutionSection } from "@/components/admin/EvolutionSection";
import { FeatureMenu } from "@/components/admin/FeatureMenu";
import { MarketSection } from "@/components/admin/MarketSection";
import { MessagesSection } from "@/components/admin/MessagesSection";
import { SystemSection } from "@/components/admin/SystemSection";
import {
  AdminConfig,
  DEFAULT_MARKET_PORTFOLIO,
  EMPTY_TASK_FORM,
  EMPTY_USER_FORM,
  EvolutionGoal,
  EvolutionStateSnapshot,
  MarketConfig,
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

  const [notice, setNotice] = useState<Notice>(null);

  const [savingModel, setSavingModel] = useState(false);
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
  const [marketRuns, setMarketRuns] = useState<MarketRunSummary[]>([]);
  const [savingMarketPortfolio, setSavingMarketPortfolio] = useState(false);
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

  const sortedEvolutionGoals = useMemo(() => {
    const goals = evolutionSnapshot?.state.goals ?? [];
    return goals.slice().sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  }, [evolutionSnapshot]);

  const sortedEvolutionHistory = useMemo(() => {
    const history = evolutionSnapshot?.state.history ?? [];
    return history.slice().sort((left, right) => Date.parse(right.completedAt) - Date.parse(left.completedAt));
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
    setMarketPortfolio(portfolio);
    setMarketSavedFundsByRow(portfolio.funds.map((fund) => ({ ...fund })));
    setMarketSavedCash(portfolio.cash);
  }

  async function loadMarketRuns(): Promise<void> {
    const payload = await request<{ runs: MarketRunSummary[] }>("/admin/api/market/runs?limit=12");
    setMarketRuns(Array.isArray(payload.runs) ? payload.runs : []);
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

    setSavingModel(true);
    try {
      const payload = await request<{ output?: string }>("/admin/api/config/model", {
        method: "POST",
        body: JSON.stringify({
          model,
          planningModel,
          planningTimeoutMs,
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
    if (savingMarketFundIndex !== null) {
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
          savingModel={savingModel}
          restarting={restarting}
          pullingRepo={pullingRepo}
          buildingRepo={buildingRepo}
          onModelSelect={setModelDraft}
          onModelDraftChange={setModelDraft}
          onPlanningModelSelect={setPlanningModelDraft}
          onPlanningModelDraftChange={setPlanningModelDraft}
          onPlanningTimeoutDraftChange={setPlanningTimeoutDraft}
          onRefreshModels={() => void loadModels()}
          onSaveModel={(restartAfterSave) => void handleSaveModel(restartAfterSave)}
          onRestartPm2={() => void handleRestartPm2()}
          onPullRepo={() => void handlePullRepo()}
          onBuildRepo={() => void handleBuildRepo()}
        />
      ) : null}

      {activeMenu === "evolution" ? (
        <EvolutionSection
          evolutionSnapshot={evolutionSnapshot}
          currentEvolutionGoal={currentEvolutionGoal}
          sortedEvolutionGoals={sortedEvolutionGoals}
          sortedEvolutionHistory={sortedEvolutionHistory}
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
          marketRuns={marketRuns}
          savingMarketPortfolio={savingMarketPortfolio}
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
          onRefresh={() => void Promise.all([loadMarketConfig(), loadMarketRuns()])}
          onBootstrapMarketTasks={() => void handleBootstrapMarketTasks()}
          onMarketRunOnceWithExplanationChange={setMarketRunOnceWithExplanation}
          onRunMarketOnce={(phase, withExplanation) => void handleRunMarketOnce(phase, withExplanation)}
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
