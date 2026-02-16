import { exec } from "child_process";
import { promisify } from "util";
import { Express, Request, Response as ExResponse } from "express";
import { IngressAdapter } from "./types";
import { SessionManager } from "../sessionManager";
import { EnvConfigStore } from "../config/envConfigStore";
import {
  CreateScheduledTaskInput,
  SchedulerService,
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
        timezone: this.scheduler.getTimezone(),
        tickMs: this.scheduler.getTickMs()
      });
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
        const result = await restartPm2();
        res.json({ ok: true, model, restarted: true, output: result.trim() });
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
        const result = await restartPm2();
        res.json({ ok: true, output: result.trim() });
      } catch (error) {
        res.status(500).json({ ok: false, error: (error as Error).message ?? "pm2 restart failed" });
      }
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

function parseCreateTaskInput(rawBody: unknown): CreateScheduledTaskInput | null {
  if (!rawBody || typeof rawBody !== "object") {
    return null;
  }
  const body = rawBody as Record<string, unknown>;
  return {
    name: typeof body.name === "string" ? body.name : undefined,
    enabled: parseOptionalBoolean(body.enabled),
    time: typeof body.time === "string" ? body.time : "",
    toUser: typeof body.toUser === "string" ? body.toUser : "",
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
  if ("toUser" in body) {
    payload.toUser = typeof body.toUser === "string" ? body.toUser : "";
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
  <style>
    :root {
      --bg: #f5f3ef;
      --card: #fffdf8;
      --text: #17130f;
      --muted: #73685a;
      --line: #ddd2c3;
      --accent: #c05e2a;
      --accent-soft: #f4dacb;
      --danger: #9f1e1e;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "IBM Plex Sans", "PingFang SC", "Microsoft YaHei", sans-serif;
      background:
        radial-gradient(circle at 15% -10%, #f8e8db 0, transparent 40%),
        radial-gradient(circle at 88% 10%, #efe4cf 0, transparent 35%),
        var(--bg);
      color: var(--text);
      min-height: 100vh;
      padding: 24px;
    }
    h1, h2 {
      margin: 0 0 12px;
      font-family: "Space Grotesk", "IBM Plex Sans", sans-serif;
      letter-spacing: 0.02em;
    }
    .layout {
      max-width: 1100px;
      margin: 0 auto;
      display: grid;
      gap: 16px;
      grid-template-columns: 1fr;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 16px;
      box-shadow: 0 8px 30px rgba(26, 16, 5, 0.06);
    }
    .row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
    }
    input, textarea, button {
      font: inherit;
    }
    input, textarea {
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 10px 12px;
      background: #fff;
      width: 100%;
      color: var(--text);
    }
    textarea {
      min-height: 90px;
      resize: vertical;
    }
    .form-grid {
      display: grid;
      grid-template-columns: repeat(12, 1fr);
      gap: 8px;
      margin-top: 10px;
    }
    .col-3 { grid-column: span 3; }
    .col-4 { grid-column: span 4; }
    .col-6 { grid-column: span 6; }
    .col-12 { grid-column: span 12; }
    button {
      border: 1px solid var(--line);
      background: #fff;
      color: var(--text);
      border-radius: 10px;
      padding: 8px 12px;
      cursor: pointer;
    }
    button.primary {
      background: var(--accent);
      border-color: var(--accent);
      color: #fff;
    }
    button.soft {
      background: var(--accent-soft);
      border-color: var(--accent-soft);
    }
    button.danger {
      background: #fff;
      border-color: #e6bcbc;
      color: var(--danger);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
    }
    th, td {
      text-align: left;
      border-bottom: 1px solid var(--line);
      padding: 8px 6px;
      vertical-align: top;
      font-size: 13px;
    }
    .meta {
      color: var(--muted);
      font-size: 12px;
      margin-top: 8px;
      word-break: break-all;
    }
    #status {
      margin-top: 8px;
      min-height: 20px;
      color: var(--muted);
      font-size: 13px;
      white-space: pre-wrap;
    }
    @media (max-width: 840px) {
      .col-3, .col-4, .col-6 {
        grid-column: span 12;
      }
      th:nth-child(5), td:nth-child(5) {
        display: none;
      }
    }
  </style>
</head>
<body>
  <div class="layout">
    <section class="card">
      <h1>Paimon Admin</h1>
      <div class="row">
        <input id="model" placeholder="OLLAMA_MODEL" />
        <button class="primary" id="save-model">保存模型</button>
        <button class="soft" id="save-model-restart">保存并 pm2 restart 0</button>
        <button id="restart">仅执行 pm2 restart 0</button>
      </div>
      <div class="meta" id="config-meta"></div>
    </section>

    <section class="card">
      <h2>定时任务（每天）</h2>
      <form id="task-form" class="form-grid">
        <input type="hidden" id="task-id" />
        <div class="col-4"><input id="task-name" placeholder="任务名称（可选）" /></div>
        <div class="col-3"><input id="task-time" placeholder="HH:mm，例如 08:30" /></div>
        <div class="col-5"><input id="task-user" placeholder="推送用户 toUser" /></div>
        <div class="col-12"><textarea id="task-message" placeholder="模拟用户提问内容，例如：今天天气如何？"></textarea></div>
        <div class="col-3 row">
          <label><input type="checkbox" id="task-enabled" checked /> 启用</label>
        </div>
        <div class="col-9 row">
          <button class="primary" type="submit" id="save-task">新增任务</button>
          <button type="button" id="reset-task">清空表单</button>
        </div>
      </form>

      <table>
        <thead>
          <tr>
            <th>名称</th>
            <th>时间</th>
            <th>用户</th>
            <th>状态</th>
            <th>上次运行</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody id="task-rows"></tbody>
      </table>
    </section>

    <div id="status"></div>
  </div>

  <script>
    const statusEl = document.getElementById("status");
    const modelInput = document.getElementById("model");
    const configMeta = document.getElementById("config-meta");
    const taskRows = document.getElementById("task-rows");
    const taskForm = document.getElementById("task-form");
    const taskId = document.getElementById("task-id");
    const taskName = document.getElementById("task-name");
    const taskTime = document.getElementById("task-time");
    const taskUser = document.getElementById("task-user");
    const taskMessage = document.getElementById("task-message");
    const taskEnabled = document.getElementById("task-enabled");
    const saveTaskBtn = document.getElementById("save-task");

    let tasks = [];

    function setStatus(text) {
      statusEl.textContent = text || "";
    }

    function escapeHtml(text) {
      return String(text || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    async function fetchJson(url, init) {
      const res = await fetch(url, {
        headers: { "Content-Type": "application/json" },
        ...init
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload.error || ("HTTP " + res.status));
      }
      return payload;
    }

    function resetTaskForm() {
      taskId.value = "";
      taskName.value = "";
      taskTime.value = "";
      taskUser.value = "";
      taskMessage.value = "";
      taskEnabled.checked = true;
      saveTaskBtn.textContent = "新增任务";
    }

    function fillTaskForm(task) {
      taskId.value = task.id;
      taskName.value = task.name || "";
      taskTime.value = task.time || "";
      taskUser.value = task.toUser || "";
      taskMessage.value = task.message || "";
      taskEnabled.checked = Boolean(task.enabled);
      saveTaskBtn.textContent = "更新任务";
    }

    async function loadConfig() {
      const config = await fetchJson("/admin/api/config");
      modelInput.value = config.model || "";
      configMeta.textContent =
        "env: " + (config.envPath || "-") +
        " | tasks: " + (config.taskStorePath || "-") +
        " | timezone: " + (config.timezone || "-") +
        " | tick: " + (config.tickMs || "-") + "ms";
    }

    function renderTasks() {
      if (!tasks.length) {
        taskRows.innerHTML = '<tr><td colspan="6">暂无任务</td></tr>';
        return;
      }
      taskRows.innerHTML = tasks.map((task) => {
        return '<tr>' +
          '<td>' + escapeHtml(task.name || "-") + '</td>' +
          '<td>' + escapeHtml(task.time || "-") + '</td>' +
          '<td>' + escapeHtml(task.toUser || "-") + '</td>' +
          '<td>' + (task.enabled ? "启用" : "停用") + '</td>' +
          '<td>' + escapeHtml(task.lastRunAt || "-") + '</td>' +
          '<td class="row">' +
            '<button data-op="run" data-id="' + escapeHtml(task.id) + '">运行</button>' +
            '<button data-op="edit" data-id="' + escapeHtml(task.id) + '">编辑</button>' +
            '<button class="danger" data-op="delete" data-id="' + escapeHtml(task.id) + '">删除</button>' +
          '</td>' +
        '</tr>';
      }).join("");
    }

    async function loadTasks() {
      const payload = await fetchJson("/admin/api/tasks");
      tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
      renderTasks();
    }

    async function saveModel(restart) {
      setStatus("保存模型中...");
      const model = String(modelInput.value || "").trim();
      if (!model) {
        setStatus("模型不能为空");
        return;
      }
      const payload = await fetchJson("/admin/api/config/model", {
        method: "POST",
        body: JSON.stringify({ model, restart: Boolean(restart) })
      });
      setStatus(restart ? "模型已保存并触发重启" : "模型已保存");
      if (payload.output) {
        setStatus((restart ? "模型已保存并触发重启\\n" : "模型已保存\\n") + payload.output);
      }
    }

    async function restartPm2() {
      setStatus("正在执行 pm2 restart 0 ...");
      const payload = await fetchJson("/admin/api/restart", {
        method: "POST",
        body: "{}"
      });
      setStatus("重启完成\\n" + (payload.output || ""));
    }

    taskForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const payload = {
        name: taskName.value,
        time: taskTime.value,
        toUser: taskUser.value,
        message: taskMessage.value,
        enabled: taskEnabled.checked
      };
      const id = String(taskId.value || "").trim();
      try {
        setStatus(id ? "更新任务中..." : "创建任务中...");
        if (id) {
          await fetchJson("/admin/api/tasks/" + encodeURIComponent(id), {
            method: "PUT",
            body: JSON.stringify(payload)
          });
        } else {
          await fetchJson("/admin/api/tasks", {
            method: "POST",
            body: JSON.stringify(payload)
          });
        }
        await loadTasks();
        resetTaskForm();
        setStatus(id ? "任务已更新" : "任务已创建");
      } catch (error) {
        setStatus(String(error && error.message ? error.message : error));
      }
    });

    document.getElementById("reset-task").addEventListener("click", () => {
      resetTaskForm();
    });

    document.getElementById("save-model").addEventListener("click", async () => {
      try {
        await saveModel(false);
      } catch (error) {
        setStatus(String(error && error.message ? error.message : error));
      }
    });

    document.getElementById("save-model-restart").addEventListener("click", async () => {
      try {
        await saveModel(true);
      } catch (error) {
        setStatus(String(error && error.message ? error.message : error));
      }
    });

    document.getElementById("restart").addEventListener("click", async () => {
      try {
        await restartPm2();
      } catch (error) {
        setStatus(String(error && error.message ? error.message : error));
      }
    });

    taskRows.addEventListener("click", async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const op = target.getAttribute("data-op");
      const id = target.getAttribute("data-id");
      if (!op || !id) {
        return;
      }
      const task = tasks.find((item) => item.id === id);
      if (!task) {
        return;
      }

      if (op === "edit") {
        fillTaskForm(task);
        return;
      }
      if (op === "delete") {
        if (!window.confirm("确认删除该任务？")) {
          return;
        }
        try {
          setStatus("删除任务中...");
          await fetchJson("/admin/api/tasks/" + encodeURIComponent(id), {
            method: "DELETE",
            body: "{}"
          });
          await loadTasks();
          if (String(taskId.value || "") === id) {
            resetTaskForm();
          }
          setStatus("任务已删除");
        } catch (error) {
          setStatus(String(error && error.message ? error.message : error));
        }
        return;
      }
      if (op === "run") {
        try {
          setStatus("任务执行中...");
          const result = await fetchJson("/admin/api/tasks/" + encodeURIComponent(id) + "/run", {
            method: "POST",
            body: "{}"
          });
          if (result.acceptedAsync) {
            setStatus("任务已异步受理，结果将回调给用户。");
          } else {
            setStatus("任务已执行并推送。回复: " + (result.responseText || ""));
          }
          await loadTasks();
        } catch (error) {
          setStatus(String(error && error.message ? error.message : error));
        }
      }
    });

    (async () => {
      try {
        await loadConfig();
        await loadTasks();
      } catch (error) {
        setStatus(String(error && error.message ? error.message : error));
      }
    })();
  </script>
</body>
</html>`;
}
