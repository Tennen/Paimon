import { exec } from "child_process";
import { promisify } from "util";
import { Express, Request, Response as ExResponse } from "express";
import { IngressAdapter } from "./types";
import { SessionManager } from "../sessionManager";
import { EnvConfigStore } from "../config/envConfigStore";
import {
  CreatePushUserInput,
  CreateScheduledTaskInput,
  SchedulerService,
  UpdatePushUserInput,
  UpdateScheduledTaskInput
} from "../scheduler/schedulerService";

const execAsync = promisify(exec);

export class AdminIngressAdapter implements IngressAdapter {
  private readonly envStore: EnvConfigStore;
  private readonly scheduler: SchedulerService;

  constructor(envStore: EnvConfigStore, scheduler: SchedulerService) {
    this.envStore = envStore;
    this.scheduler = scheduler;
  }

  register(app: Express, _sessionManager: SessionManager): void {
    app.get("/admin", (_req, res) => {
      res.type("html").send(renderAdminPage());
    });

    app.get("/admin/api/config", (_req, res) => {
      res.json({
        model: this.envStore.getModel(),
        envPath: this.envStore.getPath(),
        taskStorePath: this.scheduler.getStorePath(),
        userStorePath: this.scheduler.getUserStorePath(),
        timezone: this.scheduler.getTimezone(),
        tickMs: this.scheduler.getTickMs()
      });
    });

    app.get("/admin/api/models", async (_req, res) => {
      try {
        const { baseUrl, models } = await fetchOllamaModels();
        res.json({ baseUrl, models });
      } catch (error) {
        res.status(502).json({
          error: (error as Error).message ?? "failed to fetch ollama models"
        });
      }
    });

    app.post("/admin/api/config/model", async (req: Request, res: ExResponse) => {
      const body = (req.body ?? {}) as { model?: unknown; restart?: unknown };
      const model = typeof body.model === "string" ? body.model.trim() : "";
      if (!model) {
        res.status(400).json({ error: "model is required" });
        return;
      }

      try {
        this.envStore.setModel(model);
      } catch (error) {
        res.status(500).json({ error: (error as Error).message ?? "failed to save model" });
        return;
      }

      const restart = parseOptionalBoolean(body.restart) ?? false;
      if (!restart) {
        res.json({ ok: true, model, restarted: false });
        return;
      }

      try {
        const output = await restartPm2();
        res.json({ ok: true, model, restarted: true, output });
      } catch (error) {
        res.status(500).json({
          ok: false,
          model,
          restarted: false,
          error: (error as Error).message ?? "pm2 restart failed"
        });
      }
    });

    app.post("/admin/api/restart", async (_req: Request, res: ExResponse) => {
      try {
        const output = await restartPm2();
        res.json({ ok: true, output });
      } catch (error) {
        res.status(500).json({
          ok: false,
          error: (error as Error).message ?? "pm2 restart failed"
        });
      }
    });

    app.get("/admin/api/users", (_req: Request, res: ExResponse) => {
      res.json({ users: this.scheduler.listUsers() });
    });

    app.post("/admin/api/users", (req: Request, res: ExResponse) => {
      const input = parseCreateUserInput(req.body);
      if (!input) {
        res.status(400).json({ error: "invalid user payload" });
        return;
      }

      try {
        const user = this.scheduler.createUser(input);
        res.json({ ok: true, user });
      } catch (error) {
        res.status(400).json({ error: (error as Error).message ?? "failed to create user" });
      }
    });

    app.put("/admin/api/users/:id", (req: Request, res: ExResponse) => {
      const id = String(req.params.id ?? "").trim();
      if (!id) {
        res.status(400).json({ error: "user id is required" });
        return;
      }

      const input = parseUpdateUserInput(req.body);
      if (!input) {
        res.status(400).json({ error: "invalid user payload" });
        return;
      }

      try {
        const user = this.scheduler.updateUser(id, input);
        if (!user) {
          res.status(404).json({ error: "user not found" });
          return;
        }
        res.json({ ok: true, user });
      } catch (error) {
        res.status(400).json({ error: (error as Error).message ?? "failed to update user" });
      }
    });

    app.delete("/admin/api/users/:id", (req: Request, res: ExResponse) => {
      const id = String(req.params.id ?? "").trim();
      if (!id) {
        res.status(400).json({ error: "user id is required" });
        return;
      }

      const ok = this.scheduler.deleteUser(id);
      if (!ok) {
        res.status(404).json({ error: "user not found" });
        return;
      }
      res.json({ ok: true });
    });

    app.get("/admin/api/tasks", (_req: Request, res: ExResponse) => {
      res.json({ tasks: this.scheduler.listTasks() });
    });

    app.post("/admin/api/tasks", (req: Request, res: ExResponse) => {
      const input = parseCreateTaskInput(req.body);
      if (!input) {
        res.status(400).json({ error: "invalid task payload" });
        return;
      }

      try {
        const task = this.scheduler.createTask(input);
        res.json({ ok: true, task });
      } catch (error) {
        res.status(400).json({ error: (error as Error).message ?? "failed to create task" });
      }
    });

    app.put("/admin/api/tasks/:id", (req: Request, res: ExResponse) => {
      const id = String(req.params.id ?? "").trim();
      if (!id) {
        res.status(400).json({ error: "task id is required" });
        return;
      }

      const input = parseUpdateTaskInput(req.body);
      if (!input) {
        res.status(400).json({ error: "invalid task payload" });
        return;
      }

      try {
        const task = this.scheduler.updateTask(id, input);
        if (!task) {
          res.status(404).json({ error: "task not found" });
          return;
        }
        res.json({ ok: true, task });
      } catch (error) {
        res.status(400).json({ error: (error as Error).message ?? "failed to update task" });
      }
    });

    app.delete("/admin/api/tasks/:id", (req: Request, res: ExResponse) => {
      const id = String(req.params.id ?? "").trim();
      if (!id) {
        res.status(400).json({ error: "task id is required" });
        return;
      }

      const ok = this.scheduler.deleteTask(id);
      if (!ok) {
        res.status(404).json({ error: "task not found" });
        return;
      }
      res.json({ ok: true });
    });

    app.post("/admin/api/tasks/:id/run", async (req: Request, res: ExResponse) => {
      const id = String(req.params.id ?? "").trim();
      if (!id) {
        res.status(400).json({ error: "task id is required" });
        return;
      }

      try {
        const result = await this.scheduler.runTaskNow(id);
        res.json({
          ok: true,
          task: result.task,
          acceptedAsync: result.acceptedAsync,
          responseText: result.responseText,
          imageCount: result.imageCount
        });
      } catch (error) {
        res.status(400).json({ ok: false, error: (error as Error).message ?? "run failed" });
      }
    });
  }
}

function parseCreateUserInput(rawBody: unknown): CreatePushUserInput | null {
  if (!rawBody || typeof rawBody !== "object") {
    return null;
  }
  const body = rawBody as Record<string, unknown>;
  return {
    name: typeof body.name === "string" ? body.name : "",
    wecomUserId: typeof body.wecomUserId === "string" ? body.wecomUserId : "",
    enabled: parseOptionalBoolean(body.enabled)
  };
}

function parseUpdateUserInput(rawBody: unknown): UpdatePushUserInput | null {
  if (!rawBody || typeof rawBody !== "object") {
    return null;
  }
  const body = rawBody as Record<string, unknown>;
  const payload: UpdatePushUserInput = {};

  if ("name" in body) {
    payload.name = typeof body.name === "string" ? body.name : "";
  }
  if ("wecomUserId" in body) {
    payload.wecomUserId = typeof body.wecomUserId === "string" ? body.wecomUserId : "";
  }
  if ("enabled" in body) {
    const enabled = parseOptionalBoolean(body.enabled);
    if (enabled === undefined) {
      return null;
    }
    payload.enabled = enabled;
  }

  return payload;
}

function parseCreateTaskInput(rawBody: unknown): CreateScheduledTaskInput | null {
  if (!rawBody || typeof rawBody !== "object") {
    return null;
  }
  const body = rawBody as Record<string, unknown>;
  return {
    name: typeof body.name === "string" ? body.name : undefined,
    enabled: parseOptionalBoolean(body.enabled),
    time: typeof body.time === "string" ? body.time : "",
    userId: typeof body.userId === "string" ? body.userId : "",
    message: typeof body.message === "string" ? body.message : ""
  };
}

function parseUpdateTaskInput(rawBody: unknown): UpdateScheduledTaskInput | null {
  if (!rawBody || typeof rawBody !== "object") {
    return null;
  }
  const body = rawBody as Record<string, unknown>;
  const payload: UpdateScheduledTaskInput = {};

  if ("name" in body) {
    payload.name = typeof body.name === "string" ? body.name : "";
  }
  if ("enabled" in body) {
    const enabled = parseOptionalBoolean(body.enabled);
    if (enabled === undefined) {
      return null;
    }
    payload.enabled = enabled;
  }
  if ("time" in body) {
    payload.time = typeof body.time === "string" ? body.time : "";
  }
  if ("userId" in body) {
    payload.userId = typeof body.userId === "string" ? body.userId : "";
  }
  if ("message" in body) {
    payload.message = typeof body.message === "string" ? body.message : "";
  }

  return payload;
}

function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return undefined;
}

async function fetchOllamaModels(): Promise<{ baseUrl: string; models: string[] }> {
  const baseUrl = (process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(/\/$/, "");
  const endpoint = `${baseUrl}/api/tags`;

  const response = await fetch(endpoint, {
    method: "GET"
  });

  if (!response.ok) {
    throw new Error(`Failed to query Ollama models: HTTP ${response.status}`);
  }

  const payload = (await response.json()) as {
    models?: Array<{ name?: unknown; model?: unknown }>;
  };

  const names = Array.isArray(payload.models)
    ? payload.models
        .map((item) => {
          if (typeof item?.name === "string" && item.name.trim()) {
            return item.name.trim();
          }
          if (typeof item?.model === "string" && item.model.trim()) {
            return item.model.trim();
          }
          return "";
        })
        .filter(Boolean)
    : [];

  return {
    baseUrl,
    models: Array.from(new Set(names)).sort((a, b) => a.localeCompare(b))
  };
}

async function restartPm2(): Promise<string> {
  const { stdout, stderr } = await execAsync("pm2 restart 0");
  return `${stdout ?? ""}${stderr ?? ""}`.trim();
}

function renderAdminPage(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Paimon Admin</title>
  <link rel="stylesheet" href="https://unpkg.com/antd@5/dist/reset.css" />
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      background:
        radial-gradient(circle at 12% -8%, #f9e8d6 0, transparent 35%),
        radial-gradient(circle at 88% 0%, #ecf5ff 0, transparent 32%),
        #f4f6fa;
      font-family: "IBM Plex Sans", "PingFang SC", "Microsoft YaHei", sans-serif;
    }
    #root {
      min-height: 100vh;
      padding: 20px;
    }
    .mono {
      font-family: "JetBrains Mono", Menlo, Consolas, monospace;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div id="root"></div>

  <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://unpkg.com/dayjs@1/dayjs.min.js"></script>
  <script src="https://unpkg.com/antd@5/dist/antd.min.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>

  <script type="text/babel">
    const {
      Typography,
      Card,
      Row,
      Col,
      Space,
      Button,
      Form,
      Input,
      Select,
      Switch,
      Table,
      Tag,
      Popconfirm,
      TimePicker,
      Divider,
      message
    } = antd;

    const { useEffect, useMemo, useState } = React;

    async function request(url, options) {
      const init = options || {};
      const headers = {
        "Content-Type": "application/json"
      };
      const res = await fetch(url, {
        ...init,
        headers: {
          ...headers,
          ...(init.headers || {})
        }
      });
      const text = await res.text();
      const payload = text ? JSON.parse(text) : {};
      if (!res.ok) {
        throw new Error(payload.error || ("HTTP " + res.status));
      }
      return payload;
    }

    function timeToDayjs(value) {
      if (!value || typeof value !== "string") {
        return null;
      }
      const parts = value.split(":");
      if (parts.length !== 2) {
        return null;
      }
      const hour = Number(parts[0]);
      const minute = Number(parts[1]);
      if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
        return null;
      }
      return dayjs().hour(hour).minute(minute).second(0).millisecond(0);
    }

    function formatDate(iso) {
      if (!iso) {
        return "-";
      }
      const d = dayjs(iso);
      if (!d.isValid()) {
        return String(iso);
      }
      return d.format("YYYY-MM-DD HH:mm:ss");
    }

    function AdminPage() {
      const [config, setConfig] = useState(null);
      const [models, setModels] = useState([]);
      const [users, setUsers] = useState([]);
      const [tasks, setTasks] = useState([]);
      const [modelDraft, setModelDraft] = useState("");
      const [savingModel, setSavingModel] = useState(false);
      const [restarting, setRestarting] = useState(false);
      const [savingUser, setSavingUser] = useState(false);
      const [savingTask, setSavingTask] = useState(false);
      const [runningTaskId, setRunningTaskId] = useState("");
      const [editingUserId, setEditingUserId] = useState("");
      const [editingTaskId, setEditingTaskId] = useState("");

      const [userForm] = Form.useForm();
      const [taskForm] = Form.useForm();

      const userMap = useMemo(() => {
        const map = new Map();
        users.forEach((user) => map.set(user.id, user));
        return map;
      }, [users]);

      const userOptions = useMemo(() => {
        return users
          .filter((user) => user.enabled)
          .map((user) => ({
            label: user.name + " (" + user.wecomUserId + ")",
            value: user.id
          }));
      }, [users]);

      async function loadConfig() {
        const payload = await request("/admin/api/config");
        setConfig(payload);
        setModelDraft(payload.model || "");
      }

      async function loadModels() {
        const payload = await request("/admin/api/models");
        setModels(Array.isArray(payload.models) ? payload.models : []);
      }

      async function loadUsers() {
        const payload = await request("/admin/api/users");
        setUsers(Array.isArray(payload.users) ? payload.users : []);
      }

      async function loadTasks() {
        const payload = await request("/admin/api/tasks");
        setTasks(Array.isArray(payload.tasks) ? payload.tasks : []);
      }

      async function init() {
        try {
          await Promise.all([loadConfig(), loadModels(), loadUsers(), loadTasks()]);
        } catch (error) {
          message.error(error.message || String(error));
        }
      }

      useEffect(() => {
        init();
      }, []);

      async function saveModel(restart) {
        const model = String(modelDraft || "").trim();
        if (!model) {
          message.warning("请先选择或输入模型");
          return;
        }

        setSavingModel(true);
        try {
          const payload = await request("/admin/api/config/model", {
            method: "POST",
            body: JSON.stringify({ model, restart: Boolean(restart) })
          });
          message.success(payload.restarted ? "模型已保存并重启" : "模型已保存");
          if (payload.output) {
            message.info(payload.output);
          }
          await loadConfig();
        } catch (error) {
          message.error(error.message || String(error));
        } finally {
          setSavingModel(false);
        }
      }

      async function restartPm2() {
        setRestarting(true);
        try {
          const payload = await request("/admin/api/restart", {
            method: "POST",
            body: "{}"
          });
          message.success("pm2 restart 0 执行完成");
          if (payload.output) {
            message.info(payload.output);
          }
        } catch (error) {
          message.error(error.message || String(error));
        } finally {
          setRestarting(false);
        }
      }

      function resetUserForm() {
        setEditingUserId("");
        userForm.setFieldsValue({
          name: "",
          wecomUserId: "",
          enabled: true
        });
      }

      function editUser(record) {
        setEditingUserId(record.id);
        userForm.setFieldsValue({
          name: record.name,
          wecomUserId: record.wecomUserId,
          enabled: Boolean(record.enabled)
        });
      }

      async function submitUser(values) {
        setSavingUser(true);
        try {
          if (editingUserId) {
            await request("/admin/api/users/" + encodeURIComponent(editingUserId), {
              method: "PUT",
              body: JSON.stringify(values)
            });
            message.success("用户已更新");
          } else {
            await request("/admin/api/users", {
              method: "POST",
              body: JSON.stringify(values)
            });
            message.success("用户已创建");
          }
          await Promise.all([loadUsers(), loadTasks()]);
          resetUserForm();
        } catch (error) {
          message.error(error.message || String(error));
        } finally {
          setSavingUser(false);
        }
      }

      async function removeUser(record) {
        try {
          await request("/admin/api/users/" + encodeURIComponent(record.id), {
            method: "DELETE",
            body: "{}"
          });
          message.success("用户已删除");
          await Promise.all([loadUsers(), loadTasks()]);
          if (editingUserId === record.id) {
            resetUserForm();
          }
        } catch (error) {
          message.error(error.message || String(error));
        }
      }

      function resetTaskForm() {
        setEditingTaskId("");
        taskForm.setFieldsValue({
          name: "",
          time: null,
          userId: undefined,
          message: "",
          enabled: true
        });
      }

      function editTask(record) {
        setEditingTaskId(record.id);
        taskForm.setFieldsValue({
          name: record.name,
          time: timeToDayjs(record.time),
          userId: record.userId,
          message: record.message,
          enabled: Boolean(record.enabled)
        });
      }

      async function submitTask(values) {
        const payload = {
          name: values.name,
          time: values.time ? values.time.format("HH:mm") : "",
          userId: values.userId,
          message: values.message,
          enabled: values.enabled
        };

        setSavingTask(true);
        try {
          if (editingTaskId) {
            await request("/admin/api/tasks/" + encodeURIComponent(editingTaskId), {
              method: "PUT",
              body: JSON.stringify(payload)
            });
            message.success("任务已更新");
          } else {
            await request("/admin/api/tasks", {
              method: "POST",
              body: JSON.stringify(payload)
            });
            message.success("任务已创建");
          }
          await loadTasks();
          resetTaskForm();
        } catch (error) {
          message.error(error.message || String(error));
        } finally {
          setSavingTask(false);
        }
      }

      async function removeTask(record) {
        try {
          await request("/admin/api/tasks/" + encodeURIComponent(record.id), {
            method: "DELETE",
            body: "{}"
          });
          message.success("任务已删除");
          await loadTasks();
          if (editingTaskId === record.id) {
            resetTaskForm();
          }
        } catch (error) {
          message.error(error.message || String(error));
        }
      }

      async function runTask(record) {
        setRunningTaskId(record.id);
        try {
          const payload = await request("/admin/api/tasks/" + encodeURIComponent(record.id) + "/run", {
            method: "POST",
            body: "{}"
          });
          if (payload.acceptedAsync) {
            message.success("任务已异步受理，稍后回调用户");
          } else {
            message.success("任务已执行并推送");
          }
          await loadTasks();
        } catch (error) {
          message.error(error.message || String(error));
        } finally {
          setRunningTaskId("");
        }
      }

      const userColumns = [
        {
          title: "名称",
          dataIndex: "name",
          key: "name"
        },
        {
          title: "WeCom User",
          dataIndex: "wecomUserId",
          key: "wecomUserId",
          render: (value) => <span className="mono">{value}</span>
        },
        {
          title: "状态",
          key: "enabled",
          render: (_, record) => record.enabled ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>
        },
        {
          title: "更新时间",
          key: "updatedAt",
          render: (_, record) => formatDate(record.updatedAt)
        },
        {
          title: "操作",
          key: "actions",
          render: (_, record) => (
            <Space>
              <Button size="small" onClick={() => editUser(record)}>编辑</Button>
              <Popconfirm title="确认删除该用户？" onConfirm={() => removeUser(record)}>
                <Button size="small" danger>删除</Button>
              </Popconfirm>
            </Space>
          )
        }
      ];

      const taskColumns = [
        {
          title: "任务",
          dataIndex: "name",
          key: "name",
          width: 150
        },
        {
          title: "时间",
          dataIndex: "time",
          key: "time",
          width: 90,
          render: (value) => <span className="mono">{value}</span>
        },
        {
          title: "推送用户",
          key: "user",
          width: 220,
          render: (_, record) => {
            const user = record.userId ? userMap.get(record.userId) : null;
            if (user) {
              return (
                <Space direction="vertical" size={0}>
                  <span>{user.name}</span>
                  <span className="mono">{user.wecomUserId}</span>
                </Space>
              );
            }
            return <span className="mono">{record.toUser || "-"}</span>;
          }
        },
        {
          title: "状态",
          key: "enabled",
          width: 90,
          render: (_, record) => record.enabled ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>
        },
        {
          title: "上次运行",
          key: "lastRunAt",
          width: 170,
          render: (_, record) => formatDate(record.lastRunAt)
        },
        {
          title: "消息",
          dataIndex: "message",
          key: "message",
          render: (value) => <Typography.Text>{String(value || "")}</Typography.Text>
        },
        {
          title: "操作",
          key: "actions",
          width: 220,
          render: (_, record) => (
            <Space>
              <Button
                size="small"
                type="primary"
                ghost
                loading={runningTaskId === record.id}
                onClick={() => runTask(record)}
              >
                立即执行
              </Button>
              <Button size="small" onClick={() => editTask(record)}>编辑</Button>
              <Popconfirm title="确认删除该任务？" onConfirm={() => removeTask(record)}>
                <Button size="small" danger>删除</Button>
              </Popconfirm>
            </Space>
          )
        }
      ];

      const modelOptions = models.map((model) => ({ label: model, value: model }));

      return (
        <div style={{ maxWidth: 1400, margin: "0 auto" }}>
          <Typography.Title level={3} style={{ marginTop: 0 }}>Paimon Admin</Typography.Title>

          <Card style={{ marginBottom: 16 }}>
            <Row gutter={[16, 16]} align="middle">
              <Col xs={24} md={14}>
                <Space direction="vertical" style={{ width: "100%" }}>
                  <Typography.Text strong>当前模型</Typography.Text>
                  <Select
                    mode="tags"
                    maxCount={1}
                    style={{ width: "100%" }}
                    placeholder="选择或输入 OLLAMA_MODEL"
                    value={modelDraft ? [modelDraft] : []}
                    options={modelOptions}
                    onChange={(value) => setModelDraft(Array.isArray(value) ? (value[0] || "") : "")}
                  />
                  <Space wrap>
                    <Button onClick={loadModels}>刷新模型列表</Button>
                    <Button type="primary" loading={savingModel} onClick={() => saveModel(false)}>保存模型</Button>
                    <Button type="primary" danger loading={savingModel} onClick={() => saveModel(true)}>保存并重启</Button>
                    <Button loading={restarting} onClick={restartPm2}>pm2 restart 0</Button>
                  </Space>
                </Space>
              </Col>

              <Col xs={24} md={10}>
                <Space direction="vertical" size={4} style={{ width: "100%" }}>
                  <Typography.Text className="mono">env: {config && config.envPath ? config.envPath : "-"}</Typography.Text>
                  <Typography.Text className="mono">tasks: {config && config.taskStorePath ? config.taskStorePath : "-"}</Typography.Text>
                  <Typography.Text className="mono">users: {config && config.userStorePath ? config.userStorePath : "-"}</Typography.Text>
                  <Typography.Text className="mono">timezone: {config && config.timezone ? config.timezone : "-"}</Typography.Text>
                  <Typography.Text className="mono">tick: {config && config.tickMs ? config.tickMs : "-"}ms</Typography.Text>
                </Space>
              </Col>
            </Row>
          </Card>

          <Row gutter={[16, 16]}>
            <Col xs={24} xl={10}>
              <Card title="推送用户" extra={<Button size="small" onClick={resetUserForm}>清空表单</Button>}>
                <Form
                  layout="vertical"
                  form={userForm}
                  initialValues={{ enabled: true }}
                  onFinish={submitUser}
                >
                  <Form.Item label="名称" name="name" rules={[{ required: true, message: "请输入名称" }]}> 
                    <Input placeholder="例如：晨报对象" />
                  </Form.Item>

                  <Form.Item label="WeCom UserId" name="wecomUserId" rules={[{ required: true, message: "请输入 WeCom UserId" }]}> 
                    <Input placeholder="例如：zhangsan" className="mono" />
                  </Form.Item>

                  <Form.Item label="启用" name="enabled" valuePropName="checked">
                    <Switch />
                  </Form.Item>

                  <Form.Item style={{ marginBottom: 0 }}>
                    <Space>
                      <Button type="primary" htmlType="submit" loading={savingUser}>
                        {editingUserId ? "更新用户" : "创建用户"}
                      </Button>
                      {editingUserId ? <Button onClick={resetUserForm}>取消编辑</Button> : null}
                    </Space>
                  </Form.Item>
                </Form>

                <Divider />

                <Table
                  rowKey="id"
                  dataSource={users}
                  columns={userColumns}
                  size="small"
                  pagination={{ pageSize: 5 }}
                />
              </Card>
            </Col>

            <Col xs={24} xl={14}>
              <Card title="定时任务（每天）" extra={<Button size="small" onClick={resetTaskForm}>清空表单</Button>}>
                <Form
                  layout="vertical"
                  form={taskForm}
                  initialValues={{ enabled: true }}
                  onFinish={submitTask}
                >
                  <Row gutter={12}>
                    <Col xs={24} md={10}>
                      <Form.Item label="任务名" name="name" rules={[{ required: true, message: "请输入任务名" }]}> 
                        <Input placeholder="例如：天气晨报" />
                      </Form.Item>
                    </Col>

                    <Col xs={24} md={7}>
                      <Form.Item label="时间" name="time" rules={[{ required: true, message: "请选择时间" }]}> 
                        <TimePicker format="HH:mm" minuteStep={1} style={{ width: "100%" }} />
                      </Form.Item>
                    </Col>

                    <Col xs={24} md={7}>
                      <Form.Item label="推送用户" name="userId" rules={[{ required: true, message: "请选择推送用户" }]}> 
                        <Select
                          options={userOptions}
                          placeholder={userOptions.length > 0 ? "选择用户" : "请先创建用户"}
                        />
                      </Form.Item>
                    </Col>
                  </Row>

                  <Form.Item label="提问内容" name="message" rules={[{ required: true, message: "请输入提问内容" }]}> 
                    <Input.TextArea rows={3} placeholder="例如：请播报今天的天气和穿衣建议" />
                  </Form.Item>

                  <Form.Item label="启用" name="enabled" valuePropName="checked">
                    <Switch />
                  </Form.Item>

                  <Form.Item style={{ marginBottom: 0 }}>
                    <Space>
                      <Button
                        type="primary"
                        htmlType="submit"
                        loading={savingTask}
                        disabled={userOptions.length === 0}
                      >
                        {editingTaskId ? "更新任务" : "创建任务"}
                      </Button>
                      {editingTaskId ? <Button onClick={resetTaskForm}>取消编辑</Button> : null}
                    </Space>
                  </Form.Item>
                </Form>

                <Divider />

                <Table
                  rowKey="id"
                  dataSource={tasks}
                  columns={taskColumns}
                  size="small"
                  scroll={{ x: 1080 }}
                  pagination={{ pageSize: 6 }}
                />
              </Card>
            </Col>
          </Row>
        </div>
      );
    }

    const root = ReactDOM.createRoot(document.getElementById("root"));
    root.render(<AdminPage />);
  </script>
</body>
</html>`;
}
