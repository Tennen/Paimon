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
import { ScheduledTask } from "../scheduler/taskStore";
import { EvolutionEngine } from "../evolution/evolutionEngine";

const execAsync = promisify(exec);

const DEFAULT_ADMIN_DIST_CANDIDATES = [
  path.resolve(process.cwd(), "dist/admin-web"),
  path.resolve(process.cwd(), "admin-web/dist")
];

type MarketPhase = "midday" | "close";

type MarketPortfolioFund = {
  code: string;
  quantity: number;
  avgCost: number;
};

type MarketPortfolio = {
  funds: MarketPortfolioFund[];
  cash: number;
};

type MarketRunSummary = {
  id: string;
  createdAt: string;
  phase: MarketPhase;
  marketState: string;
  benchmark?: string;
  assetSignalCount: number;
  signals: Array<{ code: string; signal: string }>;
  explanationSummary?: string;
  file?: string;
};

type MarketStateFile = {
  version: 1;
  latestRunId: string;
  latestByPhase: {
    midday: { id: string; createdAt: string; file?: string } | null;
    close: { id: string; createdAt: string; file?: string } | null;
  };
  recentRuns: MarketRunSummary[];
  updatedAt: string;
};

type BootstrapMarketTasksPayload = {
  userId: string;
  middayTime?: string;
  closeTime?: string;
  enabled?: boolean;
};

const MARKET_DATA_DIR = path.resolve(process.cwd(), "data/market-analysis");
const MARKET_RUNS_DIR = path.join(MARKET_DATA_DIR, "runs");
const MARKET_PORTFOLIO_FILE = path.join(MARKET_DATA_DIR, "portfolio.json");
const MARKET_STATE_FILE = path.join(MARKET_DATA_DIR, "state.json");

const DEFAULT_MARKET_PORTFOLIO: MarketPortfolio = {
  funds: [],
  cash: 0
};

export class AdminIngressAdapter implements IngressAdapter {
  private readonly envStore: EnvConfigStore;
  private readonly scheduler: SchedulerService;
  private readonly evolutionEngine?: EvolutionEngine;
  private readonly adminDistCandidates: string[];

  constructor(
    envStore: EnvConfigStore,
    scheduler: SchedulerService,
    evolutionEngine?: EvolutionEngine,
    adminDistCandidates?: string[]
  ) {
    this.envStore = envStore;
    this.scheduler = scheduler;
    this.evolutionEngine = evolutionEngine;
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
      const evolutionSnapshot = this.evolutionEngine?.getSnapshot();
      res.json({
        model: this.envStore.getModel(),
        planningModel: getEnvValue(envPath, "OLLAMA_PLANNING_MODEL"),
        planningTimeoutMs: getEnvValue(envPath, "LLM_PLANNING_TIMEOUT_MS"),
        envPath,
        taskStorePath: this.scheduler.getStorePath(),
        userStorePath: this.scheduler.getUserStorePath(),
        timezone: this.scheduler.getTimezone(),
        tickMs: this.scheduler.getTickMs(),
        evolution: evolutionSnapshot
          ? {
              tickMs: this.evolutionEngine?.getTickMs(),
              statePath: evolutionSnapshot.paths.stateFile,
              retryQueuePath: evolutionSnapshot.paths.retryQueueFile,
              metricsPath: evolutionSnapshot.paths.metricsFile
            }
          : null
      });
    });

    app.get("/admin/api/evolution/state", (_req: Request, res: ExResponse) => {
      if (!this.evolutionEngine) {
        res.status(501).json({ ok: false, error: "evolution engine is not enabled" });
        return;
      }
      const snapshot = this.evolutionEngine.getSnapshot();
      res.json({
        ok: true,
        tickMs: this.evolutionEngine.getTickMs(),
        ...snapshot
      });
    });

    app.post("/admin/api/evolution/goals", async (req: Request, res: ExResponse) => {
      if (!this.evolutionEngine) {
        res.status(501).json({ ok: false, error: "evolution engine is not enabled" });
        return;
      }
      const input = parseEvolutionGoalInput(req.body);
      if (!input) {
        res.status(400).json({ ok: false, error: "goal is required" });
        return;
      }

      try {
        const goal = await this.evolutionEngine.enqueueGoal(input);
        res.json({
          ok: true,
          goal
        });
      } catch (error) {
        res.status(400).json({ ok: false, error: (error as Error).message ?? "failed to enqueue goal" });
      }
    });

    app.post("/admin/api/evolution/tick", async (_req: Request, res: ExResponse) => {
      if (!this.evolutionEngine) {
        res.status(501).json({ ok: false, error: "evolution engine is not enabled" });
        return;
      }
      try {
        await this.evolutionEngine.triggerNow();
        res.json({ ok: true });
      } catch (error) {
        res.status(500).json({
          ok: false,
          error: (error as Error).message ?? "failed to trigger evolution tick"
        });
      }
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

    app.post("/admin/api/repo/pull", async (_req: Request, res: ExResponse) => {
      try {
        const result = await pullRepoWithRebase();
        res.json({
          ok: true,
          ...result
        });
      } catch (error) {
        res.status(500).json({
          ok: false,
          error: (error as Error).message ?? "repo pull failed"
        });
      }
    });

    app.post("/admin/api/repo/build", async (_req: Request, res: ExResponse) => {
      try {
        const result = await buildProject();
        res.json({
          ok: true,
          ...result
        });
      } catch (error) {
        res.status(500).json({
          ok: false,
          error: (error as Error).message ?? "repo build failed"
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

    app.get("/admin/api/market/config", (_req: Request, res: ExResponse) => {
      const portfolio = readMarketPortfolio();
      res.json({
        portfolio,
        portfolioPath: MARKET_PORTFOLIO_FILE,
        statePath: MARKET_STATE_FILE,
        runsDir: MARKET_RUNS_DIR
      });
    });

    app.put("/admin/api/market/config", (req: Request, res: ExResponse) => {
      const portfolio = parseMarketPortfolioInput(req.body);
      if (!portfolio) {
        res.status(400).json({ error: "invalid market portfolio payload" });
        return;
      }

      writeMarketPortfolio(portfolio);
      res.json({
        ok: true,
        portfolio
      });
    });

    app.get("/admin/api/market/runs", (req: Request, res: ExResponse) => {
      const limit = normalizeLimit(req.query.limit, 10, 1, 80);
      const phaseRaw = req.query.phase;
      const phaseInput = typeof phaseRaw === "string" ? phaseRaw.trim() : "";
      let phase: MarketPhase | undefined;
      if (phaseInput) {
        const parsed = parseMarketPhase(phaseInput);
        if (!parsed) {
          res.status(400).json({ error: "phase must be midday or close" });
          return;
        }
        phase = parsed;
      }

      const summaries = listMarketRunSummaries(limit, phase);
      res.json({ runs: summaries });
    });

    app.get("/admin/api/market/runs/latest", (req: Request, res: ExResponse) => {
      const phaseRaw = req.query.phase;
      const phaseInput = typeof phaseRaw === "string" ? phaseRaw.trim() : "";
      let phase: MarketPhase | undefined;
      if (phaseInput) {
        const parsed = parseMarketPhase(phaseInput);
        if (!parsed) {
          res.status(400).json({ error: "phase must be midday or close" });
          return;
        }
        phase = parsed;
      }

      const latest = listMarketRunSummaries(1, phase)[0] ?? null;
      res.json({ latest });
    });

    app.post("/admin/api/market/tasks/bootstrap", (req: Request, res: ExResponse) => {
      const payload = parseBootstrapMarketTasksPayload(req.body);
      if (!payload) {
        res.status(400).json({ error: "invalid bootstrap payload" });
        return;
      }

      try {
        const tasks = upsertMarketTasks(this.scheduler, payload);
        res.json({
          ok: true,
          tasks
        });
      } catch (error) {
        res.status(400).json({
          ok: false,
          error: (error as Error).message ?? "failed to bootstrap market tasks"
        });
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

function parseEvolutionGoalInput(rawBody: unknown): { goal: string; commitMessage?: string } | null {
  if (!rawBody || typeof rawBody !== "object") {
    return null;
  }
  const body = rawBody as Record<string, unknown>;
  const goal = typeof body.goal === "string" ? body.goal.trim() : "";
  if (!goal) {
    return null;
  }
  const commitMessage = typeof body.commitMessage === "string" ? body.commitMessage.trim() : "";
  return commitMessage ? { goal, commitMessage } : { goal };
}

function parseMarketPortfolioInput(rawBody: unknown): MarketPortfolio | null {
  if (!rawBody || typeof rawBody !== "object") {
    return null;
  }

  const body = rawBody as Record<string, unknown>;
  const payload = "portfolio" in body ? body.portfolio : rawBody;
  if (!payload || typeof payload !== "object") {
    return null;
  }
  return normalizeMarketPortfolio(payload);
}

function parseBootstrapMarketTasksPayload(rawBody: unknown): BootstrapMarketTasksPayload | null {
  if (!rawBody || typeof rawBody !== "object") {
    return null;
  }

  const body = rawBody as Record<string, unknown>;
  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  if (!userId) {
    return null;
  }

  const middayTime = normalizeDailyTime(typeof body.middayTime === "string" ? body.middayTime : "13:30");
  const closeTime = normalizeDailyTime(typeof body.closeTime === "string" ? body.closeTime : "15:15");
  if (!middayTime || !closeTime) {
    return null;
  }

  const enabled = parseOptionalBoolean(body.enabled);
  return {
    userId,
    middayTime,
    closeTime,
    ...(enabled === undefined ? {} : { enabled })
  };
}

function upsertMarketTasks(scheduler: SchedulerService, payload: BootstrapMarketTasksPayload): ScheduledTask[] {
  const specs: Array<{ name: string; time: string; message: string; enabled: boolean }> = [
    {
      name: "Market Analysis 盘中",
      time: payload.middayTime ?? "13:30",
      message: "/market midday",
      enabled: payload.enabled ?? true
    },
    {
      name: "Market Analysis 收盘",
      time: payload.closeTime ?? "15:15",
      message: "/market close",
      enabled: payload.enabled ?? true
    }
  ];

  const existing = scheduler.listTasks();
  const upserted: ScheduledTask[] = [];

  for (const spec of specs) {
    const match = existing.find((task) =>
      task.userId === payload.userId &&
      task.message.trim().toLowerCase() === spec.message
    );

    if (match) {
      const updated = scheduler.updateTask(match.id, {
        name: spec.name,
        enabled: spec.enabled,
        time: spec.time,
        userId: payload.userId,
        message: spec.message
      });
      if (!updated) {
        throw new Error(`failed to update market task: ${match.id}`);
      }
      upserted.push(updated);
      continue;
    }

    const created = scheduler.createTask({
      name: spec.name,
      enabled: spec.enabled,
      time: spec.time,
      userId: payload.userId,
      message: spec.message
    });
    upserted.push(created);
  }

  return upserted;
}

function readMarketPortfolio(): MarketPortfolio {
  ensureMarketStorage();

  if (!fs.existsSync(MARKET_PORTFOLIO_FILE)) {
    writeJsonFileAtomic(MARKET_PORTFOLIO_FILE, DEFAULT_MARKET_PORTFOLIO);
    return { ...DEFAULT_MARKET_PORTFOLIO, funds: [] };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(MARKET_PORTFOLIO_FILE, "utf-8"));
    return normalizeMarketPortfolio(parsed);
  } catch {
    return { ...DEFAULT_MARKET_PORTFOLIO, funds: [] };
  }
}

function writeMarketPortfolio(portfolio: MarketPortfolio): void {
  ensureMarketStorage();
  writeJsonFileAtomic(MARKET_PORTFOLIO_FILE, normalizeMarketPortfolio(portfolio));
}

function listMarketRunSummaries(limit: number, phase?: MarketPhase): MarketRunSummary[] {
  const state = readMarketStateFile();
  let summaries = state.recentRuns;

  if (summaries.length === 0) {
    summaries = loadMarketRunSummariesFromFiles(Math.max(limit * 3, 24));
  }

  const filtered = phase ? summaries.filter((item) => item.phase === phase) : summaries.slice();

  filtered.sort((a, b) => {
    const left = Date.parse(a.createdAt);
    const right = Date.parse(b.createdAt);
    return (Number.isFinite(right) ? right : 0) - (Number.isFinite(left) ? left : 0);
  });

  return filtered.slice(0, limit);
}

function readMarketStateFile(): MarketStateFile {
  ensureMarketStorage();

  if (!fs.existsSync(MARKET_STATE_FILE)) {
    return buildDefaultMarketState();
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(MARKET_STATE_FILE, "utf-8"));
    return normalizeMarketState(parsed);
  } catch {
    return buildDefaultMarketState();
  }
}

function loadMarketRunSummariesFromFiles(limit: number): MarketRunSummary[] {
  if (!fs.existsSync(MARKET_RUNS_DIR)) {
    return [];
  }

  const files = fs.readdirSync(MARKET_RUNS_DIR)
    .filter((file) => file.endsWith(".json"))
    .sort((a, b) => b.localeCompare(a))
    .slice(0, limit);

  const summaries: MarketRunSummary[] = [];
  for (const file of files) {
    const summary = readMarketRunSummaryFromFile(file);
    if (summary) {
      summaries.push(summary);
    }
  }
  return summaries;
}

function readMarketRunSummaryFromFile(fileName: string): MarketRunSummary | null {
  const fullPath = path.join(MARKET_RUNS_DIR, fileName);
  if (!fs.existsSync(fullPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(fullPath, "utf-8")) as Record<string, unknown>;
    const phase = parseMarketPhase(parsed.phase);
    if (!phase) {
      return null;
    }

    const signalResult = parsed.signalResult && typeof parsed.signalResult === "object"
      ? parsed.signalResult as Record<string, unknown>
      : {};

    const assetSignals = Array.isArray(signalResult.assetSignals)
      ? signalResult.assetSignals
      : [];

    const compactSignals = assetSignals
      .map((item) => {
        if (!item || typeof item !== "object") {
          return null;
        }
        const value = item as Record<string, unknown>;
        const code = typeof value.code === "string" ? value.code : "";
        const signal = typeof value.signal === "string" ? value.signal : "";
        if (!code || !signal) {
          return null;
        }
        return { code, signal };
      })
      .filter((item): item is { code: string; signal: string } => Boolean(item));

    const explanation = parsed.explanation && typeof parsed.explanation === "object"
      ? parsed.explanation as Record<string, unknown>
      : {};

    return {
      id: typeof parsed.id === "string" ? parsed.id : fileName.replace(/\.json$/i, ""),
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : "",
      phase,
      marketState: typeof signalResult.marketState === "string" ? signalResult.marketState : "",
      benchmark: typeof signalResult.benchmark === "string" ? signalResult.benchmark : "",
      assetSignalCount: compactSignals.length,
      signals: compactSignals.slice(0, 8),
      explanationSummary: typeof explanation.summary === "string" ? explanation.summary : "",
      file: fileName
    };
  } catch {
    return null;
  }
}

function buildDefaultMarketState(): MarketStateFile {
  return {
    version: 1,
    latestRunId: "",
    latestByPhase: {
      midday: null,
      close: null
    },
    recentRuns: [],
    updatedAt: ""
  };
}

function normalizeMarketState(input: unknown): MarketStateFile {
  const fallback = buildDefaultMarketState();
  if (!input || typeof input !== "object") {
    return fallback;
  }

  const source = input as Record<string, unknown>;
  const recent = Array.isArray(source.recentRuns) ? source.recentRuns : [];
  const normalizedRuns = recent
    .map((item) => normalizeMarketRunSummary(item))
    .filter((item): item is MarketRunSummary => Boolean(item));

  return {
    version: 1,
    latestRunId: typeof source.latestRunId === "string" ? source.latestRunId : "",
    latestByPhase: {
      midday: normalizeMarketPhasePointer(source.latestByPhase, "midday"),
      close: normalizeMarketPhasePointer(source.latestByPhase, "close")
    },
    recentRuns: normalizedRuns,
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : ""
  };
}

function normalizeMarketPhasePointer(
  input: unknown,
  phase: MarketPhase
): { id: string; createdAt: string; file?: string } | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const source = input as Record<string, unknown>;
  const raw = source[phase];
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const value = raw as Record<string, unknown>;
  const id = typeof value.id === "string" ? value.id : "";
  const createdAt = typeof value.createdAt === "string" ? value.createdAt : "";
  if (!id || !createdAt) {
    return null;
  }

  const file = typeof value.file === "string" ? value.file : undefined;
  return file ? { id, createdAt, file } : { id, createdAt };
}

function normalizeMarketRunSummary(input: unknown): MarketRunSummary | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const source = input as Record<string, unknown>;
  const phase = parseMarketPhase(source.phase);
  if (!phase) {
    return null;
  }

  const id = typeof source.id === "string" ? source.id.trim() : "";
  if (!id) {
    return null;
  }

  const signals = Array.isArray(source.signals)
    ? source.signals
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const value = item as Record<string, unknown>;
          const code = typeof value.code === "string" ? value.code : "";
          const signal = typeof value.signal === "string" ? value.signal : "";
          if (!code || !signal) return null;
          return { code, signal };
        })
        .filter((item): item is { code: string; signal: string } => Boolean(item))
    : [];

  return {
    id,
    createdAt: typeof source.createdAt === "string" ? source.createdAt : "",
    phase,
    marketState: typeof source.marketState === "string" ? source.marketState : "",
    benchmark: typeof source.benchmark === "string" ? source.benchmark : "",
    assetSignalCount: Number.isFinite(Number(source.assetSignalCount))
      ? Math.max(0, Math.floor(Number(source.assetSignalCount)))
      : signals.length,
    signals,
    explanationSummary: typeof source.explanationSummary === "string" ? source.explanationSummary : "",
    file: typeof source.file === "string" ? source.file : undefined
  };
}

function normalizeMarketPortfolio(input: unknown): MarketPortfolio {
  if (!input || typeof input !== "object") {
    return {
      funds: [],
      cash: 0
    };
  }

  const source = input as Record<string, unknown>;
  const funds: MarketPortfolioFund[] = [];
  const rawFunds = Array.isArray(source.funds) ? source.funds : [];

  for (const item of rawFunds) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const value = item as Record<string, unknown>;
    const code = normalizeMarketCode(value.code);
    const quantity = Number(value.quantity);
    const avgCost = Number(value.avgCost);
    if (!code || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(avgCost) || avgCost < 0) {
      continue;
    }
    funds.push({
      code,
      quantity: roundTo(quantity, 4),
      avgCost: roundTo(avgCost, 4)
    });
  }

  const dedupMap = new Map<string, MarketPortfolioFund>();
  for (const item of funds) {
    dedupMap.set(item.code, item);
  }

  const cash = Number(source.cash);
  return {
    funds: Array.from(dedupMap.values()),
    cash: Number.isFinite(cash) && cash > 0 ? roundTo(cash, 4) : 0
  };
}

function normalizeMarketCode(raw: unknown): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) {
    return "";
  }
  if (digits.length >= 6) {
    return digits.slice(-6);
  }
  return digits.padStart(6, "0");
}

function normalizeDailyTime(raw: string): string | null {
  const text = String(raw ?? "").trim();
  if (!/^\d{2}:\d{2}$/.test(text)) {
    return null;
  }

  const [hourRaw, minuteRaw] = text.split(":");
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeLimit(raw: unknown, fallback: number, min: number, max: number): number {
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

function parseMarketPhase(raw: unknown): MarketPhase | null {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) {
    return null;
  }
  if (value === "midday") {
    return "midday";
  }
  if (value === "close") {
    return "close";
  }
  return null;
}

function ensureMarketStorage(): void {
  if (!fs.existsSync(MARKET_DATA_DIR)) {
    fs.mkdirSync(MARKET_DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(MARKET_RUNS_DIR)) {
    fs.mkdirSync(MARKET_RUNS_DIR, { recursive: true });
  }
}

function writeJsonFileAtomic(filePath: string, payload: unknown): void {
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
  fs.renameSync(tempPath, filePath);
}

function roundTo(value: number, digits: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
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

async function pullRepoWithRebase(): Promise<{
  cwd: string;
  pullCommand: string;
  pullOutput: string;
}> {
  const cwd = process.cwd();
  const gprResult = await runCommandWithOutput("zsh -lic 'gpr'");

  let pullCommand = "gpr";
  let pullOutput = joinCommandOutput(gprResult);

  if (!gprResult.ok) {
    if (!isGprNotFound(gprResult)) {
      throw new Error(`gpr failed:\n${pullOutput || gprResult.error || "unknown error"}`);
    }

    const fallbackResult = await runCommandWithOutput("git pull --rebase");
    if (!fallbackResult.ok) {
      const fallbackOutput = joinCommandOutput(fallbackResult);
      throw new Error(`git pull --rebase failed:\n${fallbackOutput || fallbackResult.error || "unknown error"}`);
    }

    pullCommand = "git pull --rebase";
    pullOutput = [
      "gpr not found, fallback to git pull --rebase",
      joinCommandOutput(fallbackResult)
    ]
      .filter(Boolean)
      .join("\n");
  }

  return {
    cwd,
    pullCommand,
    pullOutput
  };
}

async function buildProject(): Promise<{
  cwd: string;
  buildOutput: string;
}> {
  const cwd = process.cwd();
  const buildResult = await runCommandWithOutput("npm run build");
  if (!buildResult.ok) {
    const buildOutput = joinCommandOutput(buildResult);
    throw new Error(`npm run build failed:\n${buildOutput || buildResult.error || "unknown error"}`);
  }
  return {
    cwd,
    buildOutput: joinCommandOutput(buildResult)
  };
}

async function runCommandWithOutput(command: string): Promise<{
  ok: boolean;
  stdout: string;
  stderr: string;
  error: string;
}> {
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: process.cwd(),
      env: process.env,
      maxBuffer: 32 * 1024 * 1024
    });
    return {
      ok: true,
      stdout: (stdout ?? "").trim(),
      stderr: (stderr ?? "").trim(),
      error: ""
    };
  } catch (error) {
    const detail = error as {
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    return {
      ok: false,
      stdout: (detail.stdout ?? "").toString().trim(),
      stderr: (detail.stderr ?? "").toString().trim(),
      error: String(detail.message ?? "command failed")
    };
  }
}

function joinCommandOutput(result: { stdout: string; stderr: string; error: string }): string {
  return [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
}

function isGprNotFound(result: { stdout: string; stderr: string; error: string }): boolean {
  const text = `${result.stdout}\n${result.stderr}\n${result.error}`.toLowerCase();
  if (!text.includes("gpr")) {
    return false;
  }
  return text.includes("not found") || text.includes("command not found");
}
