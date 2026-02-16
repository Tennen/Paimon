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

export default function App() {
  const [config, setConfig] = useState<AdminConfig | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [users, setUsers] = useState<PushUser[]>([]);
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [modelDraft, setModelDraft] = useState("");

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

  const enabledUsers = useMemo(() => users.filter((user) => user.enabled), [users]);

  const userMap = useMemo(() => {
    return new Map(users.map((user) => [user.id, user]));
  }, [users]);

  const modelFromList = useMemo(() => {
    return models.includes(modelDraft) ? modelDraft : undefined;
  }, [modelDraft, models]);

  useEffect(() => {
    void bootstrap();
  }, []);

  async function bootstrap(): Promise<void> {
    try {
      await Promise.all([loadConfig(), loadModels(), loadUsers(), loadTasks()]);
      setNotice(null);
    } catch (error) {
      notifyError("初始化失败", error);
    }
  }

  async function loadConfig(): Promise<void> {
    const payload = await request<AdminConfig>("/admin/api/config");
    setConfig(payload);
    setModelDraft(payload.model || "");
  }

  async function loadModels(): Promise<void> {
    const payload = await request<{ baseUrl: string; models: string[] }>("/admin/api/models");
    const list = Array.isArray(payload.models) ? payload.models.filter(Boolean) : [];
    setModels(list);
  }

  async function loadUsers(): Promise<void> {
    const payload = await request<{ users: PushUser[] }>("/admin/api/users");
    setUsers(Array.isArray(payload.users) ? payload.users : []);
  }

  async function loadTasks(): Promise<void> {
    const payload = await request<{ tasks: ScheduledTask[] }>("/admin/api/tasks");
    setTasks(Array.isArray(payload.tasks) ? payload.tasks : []);
  }

  async function handleSaveModel(restartAfterSave: boolean): Promise<void> {
    const model = modelDraft.trim();
    if (!model) {
      setNotice({ type: "error", title: "模型不能为空" });
      return;
    }

    setSavingModel(true);
    try {
      const payload = await request<{ output?: string }>("/admin/api/config/model", {
        method: "POST",
        body: JSON.stringify({ model, restart: restartAfterSave })
      });
      await loadConfig();
      setNotice({
        type: "success",
        title: restartAfterSave ? "模型已保存并触发重启" : "模型已保存",
        text: payload.output
      });
    } catch (error) {
      notifyError("保存模型失败", error);
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
          <CardDescription>模型列表来自本机 Ollama `/api/tags`，保存后写入 `.env` 的 `OLLAMA_MODEL`</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
            <div className="space-y-2">
              <Label>模型列表（Ollama）</Label>
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
              <Label>目标模型（可手动输入）</Label>
              <Input
                value={modelDraft}
                onChange={(event) => setModelDraft(event.target.value)}
                placeholder="例如：qwen3:8b"
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
            <div className="mono">timezone: {config?.timezone ?? "-"}</div>
            <div className="mono">taskStore: {config?.taskStorePath ?? "-"}</div>
            <div className="mono">tickMs: {config?.tickMs ?? "-"}</div>
            <div className="mono md:col-span-2">userStore: {config?.userStorePath ?? "-"}</div>
          </div>
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
