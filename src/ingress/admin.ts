import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import express, { Express, Request, Response as ExResponse } from "express";
import dotenv from "dotenv";
import { IngressAdapter } from "./types";
import { SessionManager } from "../core/sessionManager";
import { EnvConfigStore } from "../config/envConfigStore";
import {
  CreatePushUserInput,
  CreateScheduledTaskInput,
  SchedulerService,
  UpdatePushUserInput,
  UpdateScheduledTaskInput
} from "../scheduler/schedulerService";

const execAsync = promisify(exec);

const DEFAULT_ADMIN_DIST_CANDIDATES = [
  path.resolve(process.cwd(), "dist/admin-web"),
  path.resolve(process.cwd(), "admin-web/dist")
];

export class AdminIngressAdapter implements IngressAdapter {
  private readonly envStore: EnvConfigStore;
  private readonly scheduler: SchedulerService;
  private readonly adminDistCandidates: string[];

  constructor(envStore: EnvConfigStore, scheduler: SchedulerService, adminDistCandidates?: string[]) {
    this.envStore = envStore;
    this.scheduler = scheduler;
    this.adminDistCandidates = adminDistCandidates && adminDistCandidates.length > 0
      ? adminDistCandidates.map((candidate) => path.resolve(process.cwd(), candidate))
      : DEFAULT_ADMIN_DIST_CANDIDATES;
  }

  register(app: Express, _sessionManager: SessionManager): void {
    this.registerApiRoutes(app);
    this.registerAdminWebRoutes(app);
  }

  private registerApiRoutes(app: Express): void {
    app.get("/admin/api/config", (_req, res) => {
      const envPath = this.envStore.getPath();
      res.json({
        model: this.envStore.getModel(),
        planningModel: getEnvValue(envPath, "OLLAMA_PLANNING_MODEL"),
        planningTimeoutMs: getEnvValue(envPath, "LLM_PLANNING_TIMEOUT_MS"),
        envPath,
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
      const body = (req.body ?? {}) as {
        model?: unknown;
        planningModel?: unknown;
        planningTimeoutMs?: unknown;
        restart?: unknown;
      };
      const model = typeof body.model === "string" ? body.model.trim() : "";
      if (!model) {
        res.status(400).json({ error: "model is required" });
        return;
      }

      const planningModel = typeof body.planningModel === "string"
        ? body.planningModel.trim()
        : "";
      const planningTimeoutRaw = normalizeOptionalIntegerString(body.planningTimeoutMs);
      if (planningTimeoutRaw === null) {
        res.status(400).json({ error: "planningTimeoutMs must be a positive integer or empty" });
        return;
      }

      const envPath = this.envStore.getPath();

      try {
        this.envStore.setModel(model);
        if (planningModel) {
          setEnvValue(envPath, "OLLAMA_PLANNING_MODEL", planningModel);
        } else {
          unsetEnvValue(envPath, "OLLAMA_PLANNING_MODEL");
        }
        if (planningTimeoutRaw) {
          setEnvValue(envPath, "LLM_PLANNING_TIMEOUT_MS", planningTimeoutRaw);
        } else {
          unsetEnvValue(envPath, "LLM_PLANNING_TIMEOUT_MS");
        }
      } catch (error) {
        res.status(500).json({ error: (error as Error).message ?? "failed to save model config" });
        return;
      }

      const restart = parseOptionalBoolean(body.restart) ?? false;
      const effectivePlanningModel = planningModel || model;
      const effectivePlanningTimeoutMs = planningTimeoutRaw || "";
      if (!restart) {
        res.json({
          ok: true,
          model,
          planningModel: effectivePlanningModel,
          planningTimeoutMs: effectivePlanningTimeoutMs,
          restarted: false
        });
        return;
      }

      try {
        const output = await restartPm2();
        res.json({
          ok: true,
          model,
          planningModel: effectivePlanningModel,
          planningTimeoutMs: effectivePlanningTimeoutMs,
          restarted: true,
          output
        });
      } catch (error) {
        res.status(500).json({
          ok: false,
          model,
          planningModel: effectivePlanningModel,
          planningTimeoutMs: effectivePlanningTimeoutMs,
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

  private registerAdminWebRoutes(app: Express): void {
    const adminDist = this.resolveAdminDist();

    if (!adminDist) {
      app.get("/admin", (_req, res) => {
        res.status(503).send("Admin web build not found. Run: npm run build:admin");
      });
      app.get("/admin/*", (req, res, next) => {
        if (req.path.startsWith("/admin/api/")) {
          next();
          return;
        }
        res.status(503).send("Admin web build not found. Run: npm run build:admin");
      });
      return;
    }

    const assetsDir = path.join(adminDist, "assets");
    if (fs.existsSync(assetsDir)) {
      app.use("/admin/assets", express.static(assetsDir, {
        immutable: true,
        maxAge: "365d"
      }));
    }

    const indexFile = path.join(adminDist, "index.html");
    app.get("/admin", (_req, res) => {
      res.sendFile(indexFile);
    });

    app.get("/admin/*", (req, res, next) => {
      if (req.path.startsWith("/admin/api/")) {
        next();
        return;
      }
      res.sendFile(indexFile);
    });
  }

  private resolveAdminDist(): string | null {
    for (const candidate of this.adminDistCandidates) {
      const indexFile = path.join(candidate, "index.html");
      if (fs.existsSync(indexFile)) {
        return candidate;
      }
    }
    return null;
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

function readEnvValues(envPath: string): Record<string, string> {
  if (!fs.existsSync(envPath)) {
    return {};
  }
  const content = fs.readFileSync(envPath, "utf-8");
  return dotenv.parse(content);
}

function getEnvValue(envPath: string, key: string): string {
  const values = readEnvValues(envPath);
  return values[key] ?? process.env[key] ?? "";
}

function setEnvValue(envPath: string, key: string, value: string): void {
  const text = value.trim();
  if (!text) {
    throw new Error(`${key} cannot be empty`);
  }

  const dir = path.dirname(envPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const lines = fs.existsSync(envPath)
    ? fs.readFileSync(envPath, "utf-8").split(/\r?\n/)
    : [];

  const escapedValue = formatEnvValue(text);
  const targetPrefix = `${key}=`;
  let replaced = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line || /^\s*#/.test(line)) {
      continue;
    }
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match?.[1] === key) {
      lines[i] = `${targetPrefix}${escapedValue}`;
      replaced = true;
      break;
    }
  }

  if (!replaced) {
    if (lines.length > 0 && lines[lines.length - 1] !== "") {
      lines.push("");
    }
    lines.push(`${targetPrefix}${escapedValue}`);
  }

  fs.writeFileSync(envPath, `${lines.join("\n").replace(/\n+$/, "\n")}`, "utf-8");
  process.env[key] = text;
}

function unsetEnvValue(envPath: string, key: string): void {
  if (!fs.existsSync(envPath)) {
    delete process.env[key];
    return;
  }

  const lines = fs.readFileSync(envPath, "utf-8").split(/\r?\n/);
  const nextLines = lines.filter((line) => {
    if (!line || /^\s*#/.test(line)) {
      return true;
    }
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    return match?.[1] !== key;
  });
  fs.writeFileSync(envPath, `${nextLines.join("\n").replace(/\n+$/, "\n")}`, "utf-8");
  delete process.env[key];
}

function formatEnvValue(value: string): string {
  if (/[\s#"'`]/.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}

function normalizeOptionalIntegerString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return "";
  }

  const raw = typeof value === "number"
    ? String(Math.floor(value))
    : typeof value === "string"
      ? value.trim()
      : "";

  if (!raw) {
    return "";
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return String(Math.floor(parsed));
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
