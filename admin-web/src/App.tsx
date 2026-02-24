import { useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

type AdminConfig = {
  model: string;
  planningModel: string;
  planningTimeoutMs: string;
  envPath: string;
  taskStorePath: string;
  userStorePath: string;
  timezone: string;
  tickMs: number;
};

type PushUser = {
  id: string;
  name: string;
  wecomUserId: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type ScheduledTask = {
  id: string;
  name: string;
  enabled: boolean;
  type: "daily";
  time: string;
  userId?: string;
  toUser: string;
  message: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastRunKey?: string;
};

type MarketFundHolding = {
  code: string;
  quantity: number;
  avgCost: number;
};

type MarketPortfolio = {
  funds: MarketFundHolding[];
  cash: number;
};

type MarketConfig = {
  portfolio: MarketPortfolio;
  portfolioPath: string;
  statePath: string;
  runsDir: string;
};

type MarketRunSummary = {
  id: string;
  createdAt: string;
  phase: "midday" | "close";
  marketState: string;
  benchmark?: string;
  assetSignalCount: number;
  signals: Array<{ code: string; signal: string }>;
  explanationSummary?: string;
  file?: string;
};

type Notice = {
  type: "success" | "error" | "info";
  title: string;
  text?: string;
} | null;

type UserFormState = {
  name: string;
  wecomUserId: string;
  enabled: boolean;
};

type TaskFormState = {
  name: string;
  time: string;
  userId: string;
  message: string;
  enabled: boolean;
};

const EMPTY_USER_FORM: UserFormState = {
  name: "",
  wecomUserId: "",
  enabled: true
};

const EMPTY_TASK_FORM: TaskFormState = {
  name: "",
  time: "",
  userId: "",
  message: "",
  enabled: true
};

const DEFAULT_MARKET_PORTFOLIO: MarketPortfolio = {
  funds: [],
  cash: 0
};

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

  const [editingUserId, setEditingUserId] = useState("");
  const [savingUser, setSavingUser] = useState(false);
  const [userForm, setUserForm] = useState<UserFormState>(EMPTY_USER_FORM);

  const [editingTaskId, setEditingTaskId] = useState("");
  const [savingTask, setSavingTask] = useState(false);
  const [runningTaskId, setRunningTaskId] = useState("");
  const [taskForm, setTaskForm] = useState<TaskFormState>(EMPTY_TASK_FORM);
  const [marketConfig, setMarketConfig] = useState<MarketConfig | null>(null);
  const [marketPortfolio, setMarketPortfolio] = useState<MarketPortfolio>(DEFAULT_MARKET_PORTFOLIO);
  const [marketRuns, setMarketRuns] = useState<MarketRunSummary[]>([]);
  const [savingMarketPortfolio, setSavingMarketPortfolio] = useState(false);
  const [bootstrappingMarketTasks, setBootstrappingMarketTasks] = useState(false);
  const [marketTaskUserId, setMarketTaskUserId] = useState("");
  const [marketMiddayTime, setMarketMiddayTime] = useState("13:30");
  const [marketCloseTime, setMarketCloseTime] = useState("15:15");

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

  useEffect(() => {
    void bootstrap();
  }, []);

  async function bootstrap(): Promise<void> {
    try {
      await Promise.all([loadConfig(), loadModels(), loadUsers(), loadTasks(), loadMarketConfig(), loadMarketRuns()]);
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
    setMarketPortfolio(payload.portfolio ?? DEFAULT_MARKET_PORTFOLIO);
  }

  async function loadMarketRuns(): Promise<void> {
    const payload = await request<{ runs: MarketRunSummary[] }>("/admin/api/market/runs?limit=12");
    setMarketRuns(Array.isArray(payload.runs) ? payload.runs : []);
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
      setNotice({ type: "success", title: "pm2 restart 0 执行完成", text: payload.output });
    } catch (error) {
      notifyError("pm2 重启失败", error);
    } finally {
      setRestarting(false);
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
      funds: prev.funds.concat([{ code: "", quantity: 0, avgCost: 0 }])
    }));
  }

  function handleRemoveMarketFund(index: number): void {
    setMarketPortfolio((prev) => ({
      ...prev,
      funds: prev.funds.filter((_, idx) => idx !== index)
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

  async function handleSaveMarketPortfolio(): Promise<void> {
    const normalizedFunds = marketPortfolio.funds
      .map((fund) => {
        const digits = fund.code.replace(/\D/g, "");
        const code = digits ? digits.slice(-6).padStart(6, "0") : "";
        return {
          code,
          quantity: Number(fund.quantity),
          avgCost: Number(fund.avgCost)
        };
      })
      .filter((fund) => fund.code && Number.isFinite(fund.quantity) && fund.quantity > 0 && Number.isFinite(fund.avgCost) && fund.avgCost >= 0);

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
      setMarketPortfolio(response.portfolio);
      await loadMarketConfig();
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

  function notifyError(title: string, error: unknown): void {
    const text = error instanceof Error ? error.message : String(error ?? "unknown error");
    setNotice({ type: "error", title, text });
  }

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-6 md:px-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Paimon Admin</h1>
        <p className="text-sm text-muted-foreground">模型配置、推送用户与定时任务管理（React + shadcn）</p>
      </header>

      {notice ? (
        <Alert variant={notice.type === "error" ? "destructive" : "default"}>
          <AlertTitle>{notice.title}</AlertTitle>
          {notice.text ? <AlertDescription>{notice.text}</AlertDescription> : null}
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>模型与服务控制</CardTitle>
          <CardDescription>模型列表来自本机 Ollama `/api/tags`，保存后写入 `.env`（`OLLAMA_MODEL` / `OLLAMA_PLANNING_MODEL` / `LLM_PLANNING_TIMEOUT_MS`）</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
            <div className="space-y-2">
              <Label>主模型列表（Ollama）</Label>
              <Select value={modelFromList} onValueChange={(value) => setModelDraft(value)}>
                <SelectTrigger>
                  <SelectValue placeholder="从本地模型中选择" />
                </SelectTrigger>
                <SelectContent>
                  {models.length === 0 ? (
                    <SelectItem value="__empty__" disabled>
                      未读取到模型
                    </SelectItem>
                  ) : (
                    models.map((model) => (
                      <SelectItem key={model} value={model}>
                        {model}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>主模型（`OLLAMA_MODEL`）</Label>
              <Input
                value={modelDraft}
                onChange={(event) => setModelDraft(event.target.value)}
                placeholder="例如：qwen3:8b"
              />
            </div>

            <div className="space-y-2">
              <Label>Planning 模型列表（可选）</Label>
              <Select value={planningModelFromList} onValueChange={(value) => setPlanningModelDraft(value)}>
                <SelectTrigger>
                  <SelectValue placeholder="可选：单独选择 Planning 模型" />
                </SelectTrigger>
                <SelectContent>
                  {models.length === 0 ? (
                    <SelectItem value="__empty__" disabled>
                      未读取到模型
                    </SelectItem>
                  ) : (
                    models.map((model) => (
                      <SelectItem key={`planning-${model}`} value={model}>
                        {model}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Planning 模型（`OLLAMA_PLANNING_MODEL`）</Label>
              <Input
                value={planningModelDraft}
                onChange={(event) => setPlanningModelDraft(event.target.value)}
                placeholder="留空则跟随主模型"
              />
            </div>

            <div className="space-y-2">
              <Label>Planning 超时（`LLM_PLANNING_TIMEOUT_MS`）</Label>
              <Input
                type="number"
                min={1}
                value={planningTimeoutDraft}
                onChange={(event) => setPlanningTimeoutDraft(event.target.value)}
                placeholder="留空则沿用 LLM_TIMEOUT_MS"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => void loadModels()}>
              刷新模型列表
            </Button>
            <Button type="button" disabled={savingModel} onClick={() => void handleSaveModel(false)}>
              {savingModel ? "保存中..." : "保存模型"}
            </Button>
            <Button type="button" disabled={savingModel} variant="secondary" onClick={() => void handleSaveModel(true)}>
              {savingModel ? "处理中..." : "保存并重启"}
            </Button>
            <Button type="button" variant="destructive" disabled={restarting} onClick={() => void handleRestartPm2()}>
              {restarting ? "重启中..." : "pm2 restart 0"}
            </Button>
          </div>

          <Separator />

          <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
            <div className="mono">env: {config?.envPath ?? "-"}</div>
            <div className="mono">planningModel: {config?.planningModel || "(follow OLLAMA_MODEL)"}</div>
            <div className="mono">timezone: {config?.timezone ?? "-"}</div>
            <div className="mono">planningTimeoutMs: {config?.planningTimeoutMs || "(follow LLM_TIMEOUT_MS)"}</div>
            <div className="mono">taskStore: {config?.taskStorePath ?? "-"}</div>
            <div className="mono">tickMs: {config?.tickMs ?? "-"}</div>
            <div className="mono md:col-span-2">userStore: {config?.userStorePath ?? "-"}</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Market Analysis</CardTitle>
          <CardDescription>管理持仓配置、查看最近分析结果，并一键生成 13:30 / 15:15 定时任务</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[220px_1fr]">
            <div className="space-y-1.5">
              <Label htmlFor="market-cash">现金</Label>
              <Input
                id="market-cash"
                type="number"
                min={0}
                step="0.01"
                value={marketPortfolio.cash}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setMarketPortfolio((prev) => ({
                    ...prev,
                    cash: Number.isFinite(value) ? value : 0
                  }));
                }}
                placeholder="可选现金余额"
              />
            </div>
            <div className="flex items-end justify-start gap-2">
              <Button type="button" variant="outline" onClick={handleAddMarketFund}>
                添加持仓
              </Button>
              <Button type="button" disabled={savingMarketPortfolio} onClick={() => void handleSaveMarketPortfolio()}>
                {savingMarketPortfolio ? "保存中..." : "保存 Market 配置"}
              </Button>
              <Button type="button" variant="secondary" onClick={() => void Promise.all([loadMarketConfig(), loadMarketRuns()])}>
                刷新
              </Button>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[180px]">代码</TableHead>
                <TableHead className="w-[160px]">持仓数量</TableHead>
                <TableHead className="w-[160px]">平均成本</TableHead>
                <TableHead className="w-[120px]">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {marketPortfolio.funds.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground">
                    暂无持仓，点击“添加持仓”开始配置
                  </TableCell>
                </TableRow>
              ) : (
                marketPortfolio.funds.map((fund, index) => (
                  <TableRow key={`market-fund-${index}`}>
                    <TableCell>
                      <Input
                        className="mono"
                        value={fund.code}
                        onChange={(event) => handleMarketFundChange(index, "code", event.target.value)}
                        placeholder="例如 510300"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={0}
                        step="0.0001"
                        value={fund.quantity}
                        onChange={(event) => handleMarketFundChange(index, "quantity", event.target.value)}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={0}
                        step="0.0001"
                        value={fund.avgCost}
                        onChange={(event) => handleMarketFundChange(index, "avgCost", event.target.value)}
                      />
                    </TableCell>
                    <TableCell>
                      <Button type="button" size="sm" variant="destructive" onClick={() => handleRemoveMarketFund(index)}>
                        删除
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          <Separator />

          <div className="space-y-3">
            <h3 className="text-sm font-medium">快速创建每日两次任务</h3>
            <div className="grid gap-3 md:grid-cols-4">
              <div className="space-y-1.5 md:col-span-2">
                <Label>推送用户</Label>
                <Select
                  value={marketTaskUserId || undefined}
                  onValueChange={(value) => setMarketTaskUserId(value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={enabledUsers.length > 0 ? "选择用户" : "请先创建启用用户"} />
                  </SelectTrigger>
                  <SelectContent>
                    {enabledUsers.length === 0 ? (
                      <SelectItem value="__empty__" disabled>
                        暂无启用用户
                      </SelectItem>
                    ) : (
                      enabledUsers.map((user) => (
                        <SelectItem key={`market-user-${user.id}`} value={user.id}>
                          {user.name} ({user.wecomUserId})
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="market-midday-time">盘中时间</Label>
                <Input
                  id="market-midday-time"
                  type="time"
                  value={marketMiddayTime}
                  onChange={(event) => setMarketMiddayTime(event.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="market-close-time">收盘时间</Label>
                <Input
                  id="market-close-time"
                  type="time"
                  value={marketCloseTime}
                  onChange={(event) => setMarketCloseTime(event.target.value)}
                />
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                disabled={bootstrappingMarketTasks || enabledUsers.length === 0}
                onClick={() => void handleBootstrapMarketTasks()}
              >
                {bootstrappingMarketTasks ? "处理中..." : "生成 / 更新 Market 定时任务"}
              </Button>
            </div>
          </div>

          <Separator />

          <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-3">
            <div className="mono">portfolio: {marketConfig?.portfolioPath ?? "-"}</div>
            <div className="mono">state: {marketConfig?.statePath ?? "-"}</div>
            <div className="mono">runs: {marketConfig?.runsDir ?? "-"}</div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>时间</TableHead>
                <TableHead>阶段</TableHead>
                <TableHead>市场状态</TableHead>
                <TableHead>资产信号</TableHead>
                <TableHead>说明</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {marketRuns.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    暂无运行记录
                  </TableCell>
                </TableRow>
              ) : (
                marketRuns.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className="text-xs text-muted-foreground">{formatDateTime(run.createdAt)}</TableCell>
                    <TableCell>{run.phase === "close" ? "收盘" : "盘中"}</TableCell>
                    <TableCell>
                      <div>{run.marketState || "-"}</div>
                      <div className="mono text-xs text-muted-foreground">{run.benchmark || "-"}</div>
                    </TableCell>
                    <TableCell className="text-xs">
                      {run.signals.length > 0
                        ? run.signals.map((signal) => `${signal.code}:${signal.signal}`).join(", ")
                        : "-"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {run.explanationSummary || "-"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1fr_1.25fr]">
        <Card>
          <CardHeader>
            <CardTitle>推送用户</CardTitle>
            <CardDescription>创建后可在任务中直接选择，不再手动输入 `toUser`</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form className="space-y-3" onSubmit={(event) => void handleSubmitUser(event)}>
              <div className="space-y-1.5">
                <Label htmlFor="user-name">名称</Label>
                <Input
                  id="user-name"
                  value={userForm.name}
                  onChange={(event) => setUserForm((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="例如：天气播报对象"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="user-wecom-id">WeCom UserId</Label>
                <Input
                  id="user-wecom-id"
                  className="mono"
                  value={userForm.wecomUserId}
                  onChange={(event) => setUserForm((prev) => ({ ...prev, wecomUserId: event.target.value }))}
                  placeholder="例如：zhangsan"
                />
              </div>

              <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                <Label htmlFor="user-enabled">启用</Label>
                <Switch
                  id="user-enabled"
                  checked={userForm.enabled}
                  onCheckedChange={(checked) => setUserForm((prev) => ({ ...prev, enabled: checked }))}
                />
              </div>

              <div className="flex gap-2">
                <Button type="submit" disabled={savingUser}>
                  {savingUser ? "保存中..." : editingUserId ? "更新用户" : "创建用户"}
                </Button>
                {editingUserId ? (
                  <Button type="button" variant="outline" onClick={beginCreateUser}>
                    取消编辑
                  </Button>
                ) : null}
              </div>
            </form>

            <Separator />

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>WeCom UserId</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="w-[180px]">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-muted-foreground">
                      暂无推送用户
                    </TableCell>
                  </TableRow>
                ) : (
                  users.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell>{user.name}</TableCell>
                      <TableCell className="mono text-xs">{user.wecomUserId}</TableCell>
                      <TableCell>
                        <Badge variant={user.enabled ? "default" : "secondary"}>{user.enabled ? "启用" : "停用"}</Badge>
                      </TableCell>
                      <TableCell className="space-x-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => beginEditUser(user)}>
                          编辑
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          onClick={() => {
                            if (window.confirm(`确认删除用户 ${user.name} ?`)) {
                              void handleDeleteUser(user);
                            }
                          }}
                        >
                          删除
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>定时任务（每天）</CardTitle>
            <CardDescription>任务必须绑定推送用户，定时触发后会走完整 orchestrator</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form className="space-y-3" onSubmit={(event) => void handleSubmitTask(event)}>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="task-name">任务名称</Label>
                  <Input
                    id="task-name"
                    value={taskForm.name}
                    onChange={(event) => setTaskForm((prev) => ({ ...prev, name: event.target.value }))}
                    placeholder="例如：天气晨报"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="task-time">时间（HH:mm）</Label>
                  <Input
                    id="task-time"
                    type="time"
                    value={taskForm.time}
                    onChange={(event) => setTaskForm((prev) => ({ ...prev, time: event.target.value }))}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>推送用户</Label>
                <Select
                  value={taskForm.userId || undefined}
                  onValueChange={(value) => setTaskForm((prev) => ({ ...prev, userId: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={enabledUsers.length > 0 ? "选择推送用户" : "请先创建并启用推送用户"} />
                  </SelectTrigger>
                  <SelectContent>
                    {users.length === 0 ? (
                      <SelectItem value="__empty__" disabled>
                        暂无推送用户
                      </SelectItem>
                    ) : (
                      users.map((user) => (
                        <SelectItem key={user.id} value={user.id}>
                          {user.name} ({user.wecomUserId}){user.enabled ? "" : " [停用]"}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="task-message">提问内容</Label>
                <Textarea
                  id="task-message"
                  value={taskForm.message}
                  onChange={(event) => setTaskForm((prev) => ({ ...prev, message: event.target.value }))}
                  placeholder="例如：请播报今天上海天气，并给出穿衣建议"
                />
              </div>

              <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                <Label htmlFor="task-enabled">启用</Label>
                <Switch
                  id="task-enabled"
                  checked={taskForm.enabled}
                  onCheckedChange={(checked) => setTaskForm((prev) => ({ ...prev, enabled: checked }))}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={savingTask || enabledUsers.length === 0}>
                  {savingTask ? "保存中..." : editingTaskId ? "更新任务" : "创建任务"}
                </Button>
                {editingTaskId ? (
                  <Button type="button" variant="outline" onClick={beginCreateTask}>
                    取消编辑
                  </Button>
                ) : null}
              </div>
            </form>

            <Separator />

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>任务</TableHead>
                  <TableHead>时间</TableHead>
                  <TableHead>推送用户</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>上次运行</TableHead>
                  <TableHead className="w-[210px]">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-muted-foreground">
                      暂无定时任务
                    </TableCell>
                  </TableRow>
                ) : (
                  tasks.map((task) => {
                    const user = task.userId ? userMap.get(task.userId) : undefined;
                    return (
                      <TableRow key={task.id}>
                        <TableCell>
                          <div className="font-medium">{task.name}</div>
                          <div className="line-clamp-2 text-xs text-muted-foreground">{task.message}</div>
                        </TableCell>
                        <TableCell className="mono text-xs">{task.time}</TableCell>
                        <TableCell>
                          {user ? (
                            <div>
                              <div>{user.name}</div>
                              <div className="mono text-xs text-muted-foreground">{user.wecomUserId}</div>
                            </div>
                          ) : (
                            <div className="mono text-xs text-muted-foreground">{task.toUser || "-"}</div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={task.enabled ? "default" : "secondary"}>{task.enabled ? "启用" : "停用"}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{formatDateTime(task.lastRunAt)}</TableCell>
                        <TableCell className="space-x-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={runningTaskId === task.id}
                            onClick={() => void handleRunTask(task)}
                          >
                            {runningTaskId === task.id ? "执行中..." : "立即执行"}
                          </Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => beginEditTask(task)}>
                            编辑
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            onClick={() => {
                              if (window.confirm(`确认删除任务 ${task.name} ?`)) {
                                void handleDeleteTask(task);
                              }
                            }}
                          >
                            删除
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </main>
  );
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

function formatDateTime(input: string | undefined): string {
  if (!input) {
    return "-";
  }
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return input;
  }
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
}
