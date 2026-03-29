import path from "path";
import { Express, Request, Response as ExResponse } from "express";
import { parseOptionalBoolean } from "./admin/utils";
import {
  DEFAULT_ADMIN_DIST_CANDIDATES,
  TOPIC_SUMMARY_CONFIG_STORE,
  TOPIC_SUMMARY_STATE_STORE,
  WRITING_ORGANIZER_INDEX_STORE
} from "./admin/constants";
import {
  MARKET_CONFIG_STORE,
  MARKET_PORTFOLIO_STORE,
  MARKET_STATE_STORE,
  type ImportMarketPortfolioCodesResult,
  type MarketPhase,
  type MarketPortfolioFund
} from "./admin/market/types";
import {
  isNonNegativeNumber,
  isPositiveNumber,
  parseMarketPhase,
  roundTo
} from "./admin/market/common";
import {
  normalizeMarketRouteLimit,
  parseBootstrapMarketTasksPayload,
  parseImportMarketPortfolioCodesPayload,
  parseMarketAnalysisConfigInput,
  parseMarketPortfolioInput,
  parseRunMarketOncePayload,
  upsertMarketTasks
} from "./admin/market/parsing";
import {
  resolveMarketSecurityByCode,
  searchMarketSecurities
} from "./admin/market/search";
import {
  listMarketRunSummaries,
  normalizeMarketPortfolio,
  readMarketAnalysisConfig,
  readMarketPortfolio,
  writeMarketAnalysisConfig,
  writeMarketPortfolio
} from "./admin/market/store";
import { registerConfigAdminRoutes } from "./admin/routes/config";
import { registerGeneralAdminRoutes } from "./admin/routes/general";
import { IngressAdapter } from "./types";
import { registerAdminWebRoutes } from "./admin/adminWeb";
import { SessionManager } from "../core/sessionManager";
import { EnvConfigStore } from "../config/envConfigStore";
import {
  DATA_STORE,
  describeStore
} from "../storage/persistence";
import {
  CreatePushUserInput,
  CreateScheduledTaskInput,
  SchedulerService,
  UpdatePushUserInput,
  UpdateScheduledTaskInput
} from "../scheduler/schedulerService";
import { EvolutionEngine } from "../integrations/evolution-operator/evolutionEngine";
import { CodexConfigService } from "../integrations/codex/configService";
import { EvolutionOperatorService } from "../integrations/evolution-operator/service";
import {
  addTopicSummaryProfile,
  clearTopicSummarySentLog,
  deleteTopicSummaryProfile,
  getTopicSummaryConfig,
  getTopicSummarySnapshot,
  getTopicSummaryState,
  setTopicSummaryConfig,
  updateTopicSummaryProfile,
  useTopicSummaryProfile
} from "../integrations/topic-summary/service";
import {
  appendWritingTopic,
  listWritingTopics,
  restoreWritingTopic,
  setWritingTopicState,
  showWritingTopic,
  summarizeWritingTopic
} from "../integrations/writing-organizer/service";
import {
  OpenAIQuotaManager
} from "../integrations/openai/quotaManager";
import { ObservableMenuService } from "../observable/menuService";
import { DirectInputMappingService } from "../config/directInputMappingService";
import { ConversationBenchmarkService } from "../core/conversation/benchmarkService";

type TopicSummaryProfileCreatePayload = {
  name: string;
  id?: string;
  cloneFrom?: string;
};

type TopicSummaryProfileUpdatePayload = {
  name: string;
};

type WritingTopicAppendPayload = {
  content: string;
  title?: string;
};

type WritingTopicSetStatePayload = {
  section: "summary" | "outline" | "draft";
  content: string;
};

export class AdminIngressAdapter implements IngressAdapter {
  private readonly envStore: EnvConfigStore;
  private readonly scheduler: SchedulerService;
  private readonly codexConfigService: CodexConfigService;
  private readonly evolutionService?: EvolutionOperatorService;
  private readonly adminDistCandidates: string[];
  private readonly openAIQuotaManager: OpenAIQuotaManager;
  private readonly observableMenuService: ObservableMenuService;
  private readonly directInputMappingService: DirectInputMappingService;
  private readonly conversationBenchmarkService?: ConversationBenchmarkService;

  constructor(
    envStore: EnvConfigStore,
    scheduler: SchedulerService,
    evolutionEngine?: EvolutionEngine,
    adminDistCandidates?: string[],
    evolutionService?: EvolutionOperatorService,
    conversationBenchmarkService?: ConversationBenchmarkService
  ) {
    this.envStore = envStore;
    this.scheduler = scheduler;
    this.codexConfigService = new CodexConfigService(envStore);
    this.evolutionService = evolutionService
      ?? (evolutionEngine ? new EvolutionOperatorService(evolutionEngine, this.codexConfigService) : undefined);
    this.adminDistCandidates = adminDistCandidates && adminDistCandidates.length > 0
      ? adminDistCandidates.map((candidate) => path.resolve(process.cwd(), candidate))
      : DEFAULT_ADMIN_DIST_CANDIDATES;
    this.openAIQuotaManager = new OpenAIQuotaManager();
    this.observableMenuService = new ObservableMenuService();
    this.directInputMappingService = new DirectInputMappingService();
    this.conversationBenchmarkService = conversationBenchmarkService;
  }

  register(app: Express, _sessionManager: SessionManager): void {
    this.registerApiRoutes(app);
    registerAdminWebRoutes(app, this.adminDistCandidates);
  }

  private registerApiRoutes(app: Express): void {
    const routeContext = {
      envStore: this.envStore,
      scheduler: this.scheduler,
      codexConfigService: this.codexConfigService,
      evolutionService: this.evolutionService,
      adminDistCandidates: this.adminDistCandidates,
      openAIQuotaManager: this.openAIQuotaManager,
      observableMenuService: this.observableMenuService,
      directInputMappingService: this.directInputMappingService,
      conversationBenchmarkService: this.conversationBenchmarkService
    };

    registerGeneralAdminRoutes(app, routeContext);
    registerConfigAdminRoutes(app, routeContext);

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
      const config = readMarketAnalysisConfig();
      res.json({
        portfolio,
        config,
        portfolioStore: describeStore(MARKET_PORTFOLIO_STORE),
        configStore: describeStore(MARKET_CONFIG_STORE),
        stateStore: describeStore(MARKET_STATE_STORE),
        runsStore: describeStore(DATA_STORE.MARKET_RUNS)
      });
    });

    app.put("/admin/api/market/config", (req: Request, res: ExResponse) => {
      if (!req.body || typeof req.body !== "object") {
        res.status(400).json({ error: "invalid market config payload" });
        return;
      }

      const payload = req.body as Record<string, unknown>;
      const hasPortfolio = "portfolio" in payload || "funds" in payload || "cash" in payload;
      const hasConfig = "config" in payload
        || "analysisEngine" in payload
        || "searchEngine" in payload
        || "gptPlugin" in payload
        || "fund" in payload;
      if (!hasPortfolio && !hasConfig) {
        res.status(400).json({ error: "missing market portfolio/config payload" });
        return;
      }

      let portfolio = readMarketPortfolio();
      if (hasPortfolio) {
        const parsedPortfolio = parseMarketPortfolioInput(req.body);
        if (!parsedPortfolio) {
          res.status(400).json({ error: "invalid market portfolio payload" });
          return;
        }
        portfolio = parsedPortfolio;
        writeMarketPortfolio(portfolio);
      }

      let config = readMarketAnalysisConfig();
      if (hasConfig) {
        const parsedConfig = parseMarketAnalysisConfigInput(req.body);
        if (!parsedConfig) {
          res.status(400).json({ error: "invalid market analysis config payload" });
          return;
        }
        config = parsedConfig;
        writeMarketAnalysisConfig(config);
      }

      res.json({
        ok: true,
        portfolio,
        config
      });
    });

    app.get("/admin/api/market/securities/search", async (req: Request, res: ExResponse) => {
      const keyword = typeof req.query.keyword === "string" ? req.query.keyword.trim() : "";
      if (!keyword) {
        res.status(400).json({ error: "keyword is required" });
        return;
      }

      const limit = normalizeMarketRouteLimit(req.query.limit, 10, 1, 20);

      try {
        const items = await searchMarketSecurities(keyword, limit);
        res.json({
          keyword,
          items
        });
      } catch (error) {
        res.status(502).json({
          error: (error as Error).message ?? "failed to search market securities"
        });
      }
    });

    app.post("/admin/api/market/portfolio/import-codes", async (req: Request, res: ExResponse) => {
      const parsed = parseImportMarketPortfolioCodesPayload(req.body);
      if (!parsed || parsed.codes.length === 0) {
        res.status(400).json({ error: "codes is required" });
        return;
      }

      const portfolio = readMarketPortfolio();
      const byCode = new Map<string, MarketPortfolioFund>();
      for (const holding of portfolio.funds) {
        byCode.set(holding.code, holding);
      }

      const results = await Promise.all(parsed.codes.map(async (code): Promise<ImportMarketPortfolioCodesResult> => {
        try {
          const matched = await resolveMarketSecurityByCode(code);
          if (!matched) {
            return {
              code,
              status: "not_found",
              message: "未查询到证券名称"
            };
          }

          const existing = byCode.get(code);
          const name = matched.name || existing?.name || code;
          const nextHolding: MarketPortfolioFund = {
            code,
            name,
            ...(isPositiveNumber(existing?.quantity) ? { quantity: roundTo(existing.quantity, 4) } : {}),
            ...(isNonNegativeNumber(existing?.avgCost) ? { avgCost: roundTo(existing.avgCost, 4) } : {})
          };
          byCode.set(code, nextHolding);

          if (!existing) {
            return { code, name, status: "added" };
          }
          if ((existing.name || "") !== name) {
            return { code, name, status: "updated" };
          }
          return { code, name, status: "exists" };
        } catch (error) {
          return {
            code,
            status: "error",
            message: (error as Error).message ?? "failed to resolve code"
          };
        }
      }));

      const nextPortfolio = normalizeMarketPortfolio({
        ...portfolio,
        funds: Array.from(byCode.values())
      });
      writeMarketPortfolio(nextPortfolio);

      const summary = results.reduce((acc, item) => {
        acc[item.status] += 1;
        return acc;
      }, {
        added: 0,
        updated: 0,
        exists: 0,
        not_found: 0,
        error: 0
      });

      res.json({
        ok: true,
        portfolio: nextPortfolio,
        results,
        summary
      });
    });

    app.get("/admin/api/market/runs", (req: Request, res: ExResponse) => {
      const limit = normalizeMarketRouteLimit(req.query.limit, 10, 1, 80);
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

    app.post("/admin/api/market/run-once", async (req: Request, res: ExResponse) => {
      const parsed = parseRunMarketOncePayload(req.body);
      if (!parsed.payload) {
        res.status(400).json({ ok: false, error: parsed.error });
        return;
      }
      const payload = parsed.payload;

      const message = `/market ${payload.phase}`;

      try {
        const result = await this.scheduler.runMessageNow(payload.userId, message);
        res.json({
          ok: true,
          phase: payload.phase,
          message: result.acceptedAsync
            ? `已受理 ${payload.phase} 图片报告任务，稍后通过图片链路推送`
            : `已触发 ${payload.phase} 图片报告推送`,
          acceptedAsync: result.acceptedAsync,
          responseText: result.responseText,
          imageCount: result.imageCount
        });
      } catch (error) {
        const messageText = (error as Error).message ?? "run failed";
        const normalized = messageText.toLowerCase();
        if (normalized.includes("user") || normalized.includes("invalid") || normalized.includes("required")) {
          res.status(400).json({ ok: false, error: messageText });
          return;
        }
        res.status(500).json({ ok: false, error: messageText });
      }
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

    app.get("/admin/api/topic-summary/config", (_req: Request, res: ExResponse) => {
      const snapshot = getTopicSummarySnapshot();
      const activeProfileId = snapshot.activeProfileId;
      const config = getTopicSummaryConfig(activeProfileId);
      const state = getTopicSummaryState(activeProfileId);
      res.json({
        activeProfileId,
        profiles: snapshot.profiles,
        config,
        state,
        configStore: describeStore(TOPIC_SUMMARY_CONFIG_STORE),
        stateStore: describeStore(TOPIC_SUMMARY_STATE_STORE)
      });
    });

    app.put("/admin/api/topic-summary/config", (req: Request, res: ExResponse) => {
      if (!req.body || typeof req.body !== "object") {
        res.status(400).json({ error: "invalid topic-summary config payload" });
        return;
      }

      const body = req.body as Record<string, unknown>;
      const payload = "config" in body ? body.config : req.body;
      const profileIdRaw = typeof body.profileId === "string" ? body.profileId.trim() : "";
      const profileId = profileIdRaw || undefined;

      if (!payload || typeof payload !== "object") {
        res.status(400).json({ error: "missing topic-summary config payload" });
        return;
      }

      try {
        const config = setTopicSummaryConfig(payload, profileId);
        const snapshot = getTopicSummarySnapshot();
        res.json({
          ok: true,
          profileId: profileId ?? snapshot.activeProfileId,
          config,
          snapshot
        });
      } catch (error) {
        res.status(400).json({
          ok: false,
          error: (error as Error).message ?? "failed to save topic-summary config"
        });
      }
    });

    app.post("/admin/api/topic-summary/state/clear", (req: Request, res: ExResponse) => {
      const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
      const profileIdRaw = typeof body.profileId === "string" ? body.profileId.trim() : "";
      const profileId = profileIdRaw || undefined;
      try {
        const state = clearTopicSummarySentLog(profileId);
        const snapshot = getTopicSummarySnapshot();
        res.json({
          ok: true,
          profileId: profileId ?? snapshot.activeProfileId,
          state,
          snapshot
        });
      } catch (error) {
        res.status(500).json({
          ok: false,
          error: (error as Error).message ?? "failed to clear topic-summary state"
        });
      }
    });

    app.post("/admin/api/topic-summary/profiles", (req: Request, res: ExResponse) => {
      const payload = parseTopicSummaryProfileCreatePayload(req.body);
      if (!payload) {
        res.status(400).json({ error: "invalid topic-summary profile create payload" });
        return;
      }

      try {
        const snapshot = addTopicSummaryProfile(payload);
        res.json({
          ok: true,
          snapshot
        });
      } catch (error) {
        res.status(400).json({
          ok: false,
          error: (error as Error).message ?? "failed to add topic-summary profile"
        });
      }
    });

    app.put("/admin/api/topic-summary/profiles/:id", (req: Request, res: ExResponse) => {
      const id = String(req.params.id ?? "").trim();
      const payload = parseTopicSummaryProfileUpdatePayload(req.body);
      if (!id || !payload) {
        res.status(400).json({ error: "invalid topic-summary profile update payload" });
        return;
      }

      try {
        const snapshot = updateTopicSummaryProfile(id, payload);
        res.json({
          ok: true,
          snapshot
        });
      } catch (error) {
        res.status(400).json({
          ok: false,
          error: (error as Error).message ?? "failed to update topic-summary profile"
        });
      }
    });

    app.post("/admin/api/topic-summary/profiles/:id/use", (req: Request, res: ExResponse) => {
      const id = String(req.params.id ?? "").trim();
      if (!id) {
        res.status(400).json({ error: "invalid topic-summary profile id" });
        return;
      }

      try {
        const snapshot = useTopicSummaryProfile(id);
        res.json({
          ok: true,
          snapshot
        });
      } catch (error) {
        res.status(400).json({
          ok: false,
          error: (error as Error).message ?? "failed to switch topic-summary profile"
        });
      }
    });

    app.delete("/admin/api/topic-summary/profiles/:id", (req: Request, res: ExResponse) => {
      const id = String(req.params.id ?? "").trim();
      if (!id) {
        res.status(400).json({ error: "invalid topic-summary profile id" });
        return;
      }

      try {
        const snapshot = deleteTopicSummaryProfile(id);
        res.json({
          ok: true,
          snapshot
        });
      } catch (error) {
        res.status(400).json({
          ok: false,
          error: (error as Error).message ?? "failed to delete topic-summary profile"
        });
      }
    });

    app.get("/admin/api/writing/topics", (_req: Request, res: ExResponse) => {
      try {
        const topics = listWritingTopics();
        res.json({
          topics,
          indexStore: describeStore(WRITING_ORGANIZER_INDEX_STORE)
        });
      } catch (error) {
        res.status(500).json({
          error: (error as Error).message ?? "failed to list writing topics"
        });
      }
    });

    app.get("/admin/api/writing/topics/:topicId", (req: Request, res: ExResponse) => {
      const topicId = String(req.params.topicId ?? "").trim();
      if (!topicId) {
        res.status(400).json({ error: "topicId is required" });
        return;
      }

      try {
        const detail = showWritingTopic(topicId);
        res.json(detail);
      } catch (error) {
        res.status(400).json({
          error: (error as Error).message ?? "failed to get writing topic detail"
        });
      }
    });

    app.post("/admin/api/writing/topics/:topicId/append", (req: Request, res: ExResponse) => {
      const topicId = String(req.params.topicId ?? "").trim();
      const payload = parseWritingTopicAppendPayload(req.body);
      if (!topicId || !payload) {
        res.status(400).json({ error: "invalid writing append payload" });
        return;
      }

      try {
        const result = appendWritingTopic(topicId, payload.content, payload.title);
        res.json({
          ok: true,
          result
        });
      } catch (error) {
        res.status(400).json({
          ok: false,
          error: (error as Error).message ?? "failed to append writing topic content"
        });
      }
    });

    app.post("/admin/api/writing/topics/:topicId/summarize", (req: Request, res: ExResponse) => {
      const topicId = String(req.params.topicId ?? "").trim();
      if (!topicId) {
        res.status(400).json({ error: "topicId is required" });
        return;
      }

      try {
        const result = summarizeWritingTopic(topicId);
        res.json({
          ok: true,
          result
        });
      } catch (error) {
        res.status(400).json({
          ok: false,
          error: (error as Error).message ?? "failed to summarize writing topic"
        });
      }
    });

    app.post("/admin/api/writing/topics/:topicId/restore", (req: Request, res: ExResponse) => {
      const topicId = String(req.params.topicId ?? "").trim();
      if (!topicId) {
        res.status(400).json({ error: "topicId is required" });
        return;
      }

      try {
        const result = restoreWritingTopic(topicId);
        res.json({
          ok: true,
          result
        });
      } catch (error) {
        res.status(400).json({
          ok: false,
          error: (error as Error).message ?? "failed to restore writing topic"
        });
      }
    });

    app.post("/admin/api/writing/topics/:topicId/state", (req: Request, res: ExResponse) => {
      const topicId = String(req.params.topicId ?? "").trim();
      const payload = parseWritingTopicSetStatePayload(req.body);
      if (!topicId || !payload) {
        res.status(400).json({ error: "invalid writing state payload" });
        return;
      }

      try {
        const state = setWritingTopicState(topicId, payload.section, payload.content);
        res.json({
          ok: true,
          topicId,
          section: payload.section,
          state
        });
      } catch (error) {
        res.status(400).json({
          ok: false,
          error: (error as Error).message ?? "failed to update writing topic state"
        });
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
  if (!Array.isArray(body.userIds) || body.userIds.some((item) => typeof item !== "string")) {
    return null;
  }
  return {
    name: typeof body.name === "string" ? body.name : undefined,
    enabled: parseOptionalBoolean(body.enabled),
    time: typeof body.time === "string" ? body.time : "",
    userIds: body.userIds,
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
  if ("userIds" in body) {
    if (!Array.isArray(body.userIds) || body.userIds.some((item) => typeof item !== "string")) {
      return null;
    }
    payload.userIds = body.userIds;
  }
  if ("message" in body) {
    payload.message = typeof body.message === "string" ? body.message : "";
  }

  return payload;
}

function parseTopicSummaryProfileCreatePayload(rawBody: unknown): TopicSummaryProfileCreatePayload | null {
  if (!rawBody || typeof rawBody !== "object") {
    return null;
  }
  const body = rawBody as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return null;
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  const cloneFrom = typeof body.cloneFrom === "string" ? body.cloneFrom.trim() : "";
  return {
    name,
    ...(id ? { id } : {}),
    ...(cloneFrom ? { cloneFrom } : {})
  };
}

function parseTopicSummaryProfileUpdatePayload(rawBody: unknown): TopicSummaryProfileUpdatePayload | null {
  if (!rawBody || typeof rawBody !== "object") {
    return null;
  }
  const body = rawBody as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return null;
  }
  return { name };
}

function parseWritingTopicAppendPayload(rawBody: unknown): WritingTopicAppendPayload | null {
  if (!rawBody || typeof rawBody !== "object") {
    return null;
  }
  const body = rawBody as Record<string, unknown>;
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) {
    return null;
  }
  const title = typeof body.title === "string" ? body.title.trim() : "";
  return {
    content,
    ...(title ? { title } : {})
  };
}

function parseWritingTopicSetStatePayload(rawBody: unknown): WritingTopicSetStatePayload | null {
  if (!rawBody || typeof rawBody !== "object") {
    return null;
  }
  const body = rawBody as Record<string, unknown>;
  const sectionRaw = typeof body.section === "string" ? body.section.trim().toLowerCase() : "";
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) {
    return null;
  }
  if (sectionRaw !== "summary" && sectionRaw !== "outline" && sectionRaw !== "draft") {
    return null;
  }
  return {
    section: sectionRaw,
    content
  };
}
