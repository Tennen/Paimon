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
  DATA_STORE,
  describeStore,
  getStore,
  registerStore,
  setStore
} from "../storage/persistence";
import {
  CreatePushUserInput,
  CreateScheduledTaskInput,
  SchedulerService,
  UpdatePushUserInput,
  UpdateScheduledTaskInput
} from "../scheduler/schedulerService";
import { ScheduledTask } from "../scheduler/taskStore";
import { EvolutionEngine } from "../integrations/evolution-operator/evolutionEngine";
import { EvolutionCodexConfigService } from "../integrations/evolution-operator/codexConfigService";
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
  OpenAIQuotaManager,
  readOpenAIQuotaPolicyFromEnv
} from "../integrations/openai/quotaManager";
import {
  deleteLLMProviderProfile,
  getDefaultLLMProviderProfile,
  readLLMProviderStore,
  setDefaultLLMProvider,
  upsertLLMProviderProfile
} from "../engines/llm/provider_store";

const execAsync = promisify(exec);

const DEFAULT_ADMIN_DIST_CANDIDATES = [
  path.resolve(process.cwd(), "dist/admin-web"),
  path.resolve(process.cwd(), "admin-web/dist")
];

type MarketPhase = "midday" | "close";

type MarketPortfolioFund = {
  code: string;
  name: string;
  quantity: number;
  avgCost: number;
};

type MarketPortfolio = {
  funds: MarketPortfolioFund[];
  cash: number;
};

type MarketAnalysisAssetType = "equity" | "fund";

type MarketAnalysisEngine = string;

type MarketGptPluginConfig = {
  timeoutMs: number;
  fallbackToLocal: boolean;
};

type MarketFundAnalysisConfig = {
  enabled: boolean;
  maxAgeDays: number;
  featureLookbackDays: number;
  ruleRiskLevel: "low" | "medium" | "high";
  llmRetryMax: number;
};

type MarketAnalysisConfig = {
  version: 1;
  assetType: MarketAnalysisAssetType;
  analysisEngine: MarketAnalysisEngine;
  gptPlugin: MarketGptPluginConfig;
  fund: MarketFundAnalysisConfig;
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

type MarketSecuritySearchItem = {
  code: string;
  name: string;
  market: string;
  securityType: string;
  secid?: string;
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

type RunMarketOncePayload = {
  userId: string;
  phase: MarketPhase;
  withExplanation?: boolean;
};

type RunMarketOncePayloadParseResult =
  | { payload: RunMarketOncePayload; error?: undefined }
  | { payload?: undefined; error: string };

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

const MARKET_PORTFOLIO_STORE = DATA_STORE.MARKET_PORTFOLIO;
const MARKET_CONFIG_STORE = DATA_STORE.MARKET_CONFIG;
const MARKET_STATE_STORE = DATA_STORE.MARKET_STATE;
const TOPIC_SUMMARY_CONFIG_STORE = DATA_STORE.TOPIC_SUMMARY_CONFIG;
const TOPIC_SUMMARY_STATE_STORE = DATA_STORE.TOPIC_SUMMARY_STATE;
const WRITING_ORGANIZER_INDEX_STORE = DATA_STORE.WRITING_ORGANIZER_INDEX;
const MARKET_SECURITY_SEARCH_TIMEOUT_MS = 8000;
const EASTMONEY_SEARCH_TOKEN = "D43BF722C8E33BDC906FB84D85E326E8";

const DEFAULT_MARKET_PORTFOLIO: MarketPortfolio = {
  funds: [],
  cash: 0
};

const DEFAULT_MARKET_ANALYSIS_CONFIG: MarketAnalysisConfig = {
  version: 1,
  assetType: "equity",
  analysisEngine: "local",
  gptPlugin: {
    timeoutMs: 20000,
    fallbackToLocal: true
  },
  fund: {
    enabled: true,
    maxAgeDays: 5,
    featureLookbackDays: 120,
    ruleRiskLevel: "medium",
    llmRetryMax: 1
  }
};

export class AdminIngressAdapter implements IngressAdapter {
  private readonly envStore: EnvConfigStore;
  private readonly scheduler: SchedulerService;
  private readonly codexConfigService: EvolutionCodexConfigService;
  private readonly evolutionService?: EvolutionOperatorService;
  private readonly adminDistCandidates: string[];
  private readonly openAIQuotaManager: OpenAIQuotaManager;

  constructor(
    envStore: EnvConfigStore,
    scheduler: SchedulerService,
    evolutionEngine?: EvolutionEngine,
    adminDistCandidates?: string[],
    evolutionService?: EvolutionOperatorService
  ) {
    this.envStore = envStore;
    this.scheduler = scheduler;
    this.codexConfigService = new EvolutionCodexConfigService(envStore);
    this.evolutionService = evolutionService
      ?? (evolutionEngine ? new EvolutionOperatorService(evolutionEngine, this.codexConfigService) : undefined);
    this.adminDistCandidates = adminDistCandidates && adminDistCandidates.length > 0
      ? adminDistCandidates.map((candidate) => path.resolve(process.cwd(), candidate))
      : DEFAULT_ADMIN_DIST_CANDIDATES;
    this.openAIQuotaManager = new OpenAIQuotaManager();
  }

  register(app: Express, _sessionManager: SessionManager): void {
    this.registerApiRoutes(app);
    this.registerAdminWebRoutes(app);
  }

  private registerApiRoutes(app: Express): void {
    app.get("/admin/api/config", (_req, res) => {
      const envPath = this.envStore.getPath();
      const evolutionSnapshot = this.evolutionService?.getSnapshot();
      const codexConfig = this.codexConfigService.getConfig();
      const thinkingBudgetDefault = getEnvValue(envPath, "LLM_THINKING_BUDGET");
      res.json({
        model: this.envStore.getModel(),
        planningModel: getEnvValue(envPath, "OLLAMA_PLANNING_MODEL"),
        planningTimeoutMs: getEnvValue(envPath, "LLM_PLANNING_TIMEOUT_MS"),
        thinkingBudgetEnabled: parseOptionalBoolean(getEnvValue(envPath, "LLM_THINKING_BUDGET_ENABLED")) ?? false,
        thinkingBudgetDefault,
        thinkingBudget: thinkingBudgetDefault,
        openaiBaseUrl: getEnvValue(envPath, "OPENAI_BASE_URL"),
        openaiApiKey: getEnvValue(envPath, "OPENAI_API_KEY"),
        openaiModel: getEnvValue(envPath, "OPENAI_MODEL"),
        openaiPlanningModel: getEnvValue(envPath, "OPENAI_PLANNING_MODEL"),
        openaiChatOptions: getEnvValue(envPath, "OPENAI_CHAT_OPTIONS"),
        openaiPlanningChatOptions: getEnvValue(envPath, "OPENAI_PLANNING_CHAT_OPTIONS"),
        openaiFallbackToChatgptBridge: parseOptionalBoolean(getEnvValue(envPath, "OPENAI_FALLBACK_TO_CHATGPT_BRIDGE")) ?? true,
        openaiForceBridge: parseOptionalBoolean(getEnvValue(envPath, "OPENAI_FORCE_BRIDGE")) ?? false,
        openaiQuotaResetDay: getEnvValue(envPath, "OPENAI_QUOTA_RESET_DAY"),
        openaiMonthlyTokenLimit: getEnvValue(envPath, "OPENAI_MONTHLY_TOKEN_LIMIT"),
        openaiMonthlyBudgetUsd: getEnvValue(envPath, "OPENAI_MONTHLY_BUDGET_USD"),
        openaiCostInputPer1M: getEnvValue(envPath, "OPENAI_COST_INPUT_PER_1M"),
        openaiCostOutputPer1M: getEnvValue(envPath, "OPENAI_COST_OUTPUT_PER_1M"),
        geminiApiKey: getEnvValue(envPath, "GEMINI_API_KEY"),
        serpApiKey: getEnvValue(envPath, "SERPAPI_KEY"),
        codexModel: codexConfig.codexModel,
        codexReasoningEffort: codexConfig.codexReasoningEffort,
        memoryCompactEveryRounds: getEnvValue(envPath, "MEMORY_COMPACT_EVERY_ROUNDS"),
        memoryCompactMaxBatchSize: getEnvValue(envPath, "MEMORY_COMPACT_MAX_BATCH_SIZE"),
        memorySummaryTopK: getEnvValue(envPath, "MEMORY_SUMMARY_TOP_K"),
        memoryRawRefLimit: getEnvValue(envPath, "MEMORY_RAW_REF_LIMIT"),
        memoryRawRecordLimit: getEnvValue(envPath, "MEMORY_RAW_RECORD_LIMIT"),
        memoryRagSummaryTopK: getEnvValue(envPath, "MEMORY_RAG_SUMMARY_TOP_K"),
        envPath,
        taskStore: this.scheduler.getTaskStore(),
        userStore: this.scheduler.getUserStore(),
        timezone: this.scheduler.getTimezone(),
        tickMs: this.scheduler.getTickMs(),
        evolution: evolutionSnapshot
          ? {
              tickMs: this.evolutionService?.getTickMs(),
              stateStore: evolutionSnapshot.storage.stores.state,
              retryQueueStore: evolutionSnapshot.storage.stores.retryQueue,
              metricsStore: evolutionSnapshot.storage.stores.metrics
            }
          : null
      });
    });

    app.get("/admin/api/evolution/state", (_req: Request, res: ExResponse) => {
      if (!this.evolutionService) {
        res.status(501).json({ ok: false, error: "evolution engine is not enabled" });
        return;
      }
      const snapshot = this.evolutionService.getSnapshot();
      res.json({
        ok: true,
        tickMs: this.evolutionService.getTickMs(),
        ...snapshot
      });
    });

    app.post("/admin/api/evolution/goals", async (req: Request, res: ExResponse) => {
      if (!this.evolutionService) {
        res.status(501).json({ ok: false, error: "evolution engine is not enabled" });
        return;
      }
      const input = parseEvolutionGoalInput(req.body);
      if (!input) {
        res.status(400).json({ ok: false, error: "goal is required" });
        return;
      }

      try {
        const goal = await this.evolutionService.enqueueGoal(input);
        res.json({
          ok: true,
          goal
        });
      } catch (error) {
        res.status(400).json({ ok: false, error: (error as Error).message ?? "failed to enqueue goal" });
      }
    });

    app.post("/admin/api/evolution/tick", async (_req: Request, res: ExResponse) => {
      if (!this.evolutionService) {
        res.status(501).json({ ok: false, error: "evolution engine is not enabled" });
        return;
      }
      try {
        this.evolutionService.triggerNowAsync();
        res.json({ ok: true, accepted: true });
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

    app.get("/admin/api/llm/openai/quota", (_req: Request, res: ExResponse) => {
      try {
        const policy = readOpenAIQuotaPolicyFromEnv();
        const snapshot = this.openAIQuotaManager.getSnapshot(policy);
        res.json({
          ok: true,
          ...snapshot
        });
      } catch (error) {
        res.status(500).json({
          ok: false,
          error: (error as Error).message ?? "failed to read openai quota"
        });
      }
    });

    app.post("/admin/api/llm/openai/quota", (req: Request, res: ExResponse) => {
      const body = (req.body ?? {}) as {
        action?: unknown;
      };
      const action = typeof body.action === "string" ? body.action.trim().toLowerCase() : "";
      const policy = readOpenAIQuotaPolicyFromEnv();

      try {
        if (!action || action === "unblock") {
          this.openAIQuotaManager.markAvailable(policy, "manual_unblock");
        } else if (action === "exhaust") {
          this.openAIQuotaManager.markExhausted(policy, "manual_exhausted");
        } else if (action === "reset") {
          this.openAIQuotaManager.resetUsage(policy);
        } else {
          res.status(400).json({
            ok: false,
            error: "action must be one of: unblock | exhaust | reset"
          });
          return;
        }

        const snapshot = this.openAIQuotaManager.getSnapshot(policy);
        res.json({
          ok: true,
          action: action || "unblock",
          ...snapshot
        });
      } catch (error) {
        res.status(500).json({
          ok: false,
          error: (error as Error).message ?? "failed to update openai quota"
        });
      }
    });

    app.get("/admin/api/llm/providers", (_req: Request, res: ExResponse) => {
      try {
        const store = readLLMProviderStore();
        res.json({
          ok: true,
          store,
          defaultProvider: getDefaultLLMProviderProfile()
        });
      } catch (error) {
        res.status(500).json({
          ok: false,
          error: (error as Error).message ?? "failed to read llm providers"
        });
      }
    });

    app.put("/admin/api/llm/providers", (req: Request, res: ExResponse) => {
      const body = req.body && typeof req.body === "object"
        ? req.body as Record<string, unknown>
        : {};
      const providerPayload = "provider" in body ? body.provider : body;
      const defaultProviderId = typeof body.defaultProviderId === "string"
        ? body.defaultProviderId.trim()
        : "";

      try {
        upsertLLMProviderProfile(providerPayload);
        if (defaultProviderId) {
          setDefaultLLMProvider(defaultProviderId);
        }
        res.json({
          ok: true,
          store: readLLMProviderStore(),
          defaultProvider: getDefaultLLMProviderProfile()
        });
      } catch (error) {
        res.status(400).json({
          ok: false,
          error: (error as Error).message ?? "failed to upsert llm provider"
        });
      }
    });

    app.post("/admin/api/llm/providers/default", (req: Request, res: ExResponse) => {
      const body = req.body && typeof req.body === "object"
        ? req.body as Record<string, unknown>
        : {};
      const providerId = typeof body.providerId === "string" ? body.providerId.trim() : "";
      if (!providerId) {
        res.status(400).json({
          ok: false,
          error: "providerId is required"
        });
        return;
      }

      try {
        setDefaultLLMProvider(providerId);
        res.json({
          ok: true,
          store: readLLMProviderStore(),
          defaultProvider: getDefaultLLMProviderProfile()
        });
      } catch (error) {
        res.status(400).json({
          ok: false,
          error: (error as Error).message ?? "failed to set default llm provider"
        });
      }
    });

    app.delete("/admin/api/llm/providers/:id", (req: Request, res: ExResponse) => {
      const providerId = String(req.params.id ?? "").trim();
      if (!providerId) {
        res.status(400).json({
          ok: false,
          error: "provider id is required"
        });
        return;
      }

      try {
        deleteLLMProviderProfile(providerId);
        res.json({
          ok: true,
          store: readLLMProviderStore(),
          defaultProvider: getDefaultLLMProviderProfile()
        });
      } catch (error) {
        res.status(400).json({
          ok: false,
          error: (error as Error).message ?? "failed to delete llm provider"
        });
      }
    });

    app.post("/admin/api/config/model", async (req: Request, res: ExResponse) => {
      const body = (req.body ?? {}) as {
        model?: unknown;
        planningModel?: unknown;
        planningTimeoutMs?: unknown;
        thinkingBudgetEnabled?: unknown;
        thinkingBudgetDefault?: unknown;
        thinkingBudget?: unknown;
        openaiBaseUrl?: unknown;
        openaiApiKey?: unknown;
        openaiModel?: unknown;
        openaiPlanningModel?: unknown;
        openaiChatOptions?: unknown;
        openaiPlanningChatOptions?: unknown;
        openaiFallbackToChatgptBridge?: unknown;
        openaiForceBridge?: unknown;
        openaiQuotaResetDay?: unknown;
        openaiMonthlyTokenLimit?: unknown;
        openaiMonthlyBudgetUsd?: unknown;
        openaiCostInputPer1M?: unknown;
        openaiCostOutputPer1M?: unknown;
        geminiApiKey?: unknown;
        serpApiKey?: unknown;
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
      const thinkingBudgetEnabled = parseOptionalBoolean(body.thinkingBudgetEnabled);
      if (body.thinkingBudgetEnabled !== undefined && thinkingBudgetEnabled === undefined) {
        res.status(400).json({ error: "thinkingBudgetEnabled must be boolean" });
        return;
      }
      const thinkingBudgetInput = body.thinkingBudgetDefault ?? body.thinkingBudget;
      const thinkingBudgetRaw = normalizeOptionalIntegerString(thinkingBudgetInput);
      if (thinkingBudgetRaw === null) {
        res.status(400).json({ error: "thinkingBudgetDefault must be a positive integer or empty" });
        return;
      }
      const effectiveThinkingBudgetEnabled = thinkingBudgetEnabled ?? false;
      if (effectiveThinkingBudgetEnabled && !thinkingBudgetRaw) {
        res.status(400).json({ error: "thinkingBudgetDefault is required when thinkingBudgetEnabled is true" });
        return;
      }

      const openaiBaseUrl = normalizeOptionalString(body.openaiBaseUrl);
      const openaiApiKey = normalizeOptionalString(body.openaiApiKey);
      const openaiModel = normalizeOptionalString(body.openaiModel);
      const openaiPlanningModel = normalizeOptionalString(body.openaiPlanningModel);
      const openaiChatOptionsRaw = normalizeOptionalJsonObjectString(body.openaiChatOptions);
      if (openaiChatOptionsRaw === null) {
        res.status(400).json({ error: "openaiChatOptions must be a JSON object or empty" });
        return;
      }
      const openaiPlanningChatOptionsRaw = normalizeOptionalJsonObjectString(body.openaiPlanningChatOptions);
      if (openaiPlanningChatOptionsRaw === null) {
        res.status(400).json({ error: "openaiPlanningChatOptions must be a JSON object or empty" });
        return;
      }
      const openaiFallbackToChatgptBridge = parseOptionalBoolean(body.openaiFallbackToChatgptBridge);
      if (body.openaiFallbackToChatgptBridge !== undefined && openaiFallbackToChatgptBridge === undefined) {
        res.status(400).json({ error: "openaiFallbackToChatgptBridge must be boolean" });
        return;
      }
      const openaiForceBridge = parseOptionalBoolean(body.openaiForceBridge);
      if (body.openaiForceBridge !== undefined && openaiForceBridge === undefined) {
        res.status(400).json({ error: "openaiForceBridge must be boolean" });
        return;
      }
      const openaiQuotaResetDayRaw = normalizeOptionalIntegerString(body.openaiQuotaResetDay);
      if (openaiQuotaResetDayRaw === null) {
        res.status(400).json({ error: "openaiQuotaResetDay must be a positive integer or empty" });
        return;
      }
      const openaiMonthlyTokenLimitRaw = normalizeOptionalIntegerString(body.openaiMonthlyTokenLimit);
      if (openaiMonthlyTokenLimitRaw === null) {
        res.status(400).json({ error: "openaiMonthlyTokenLimit must be a positive integer or empty" });
        return;
      }
      const openaiMonthlyBudgetUsdRaw = normalizeOptionalNumberString(body.openaiMonthlyBudgetUsd);
      if (openaiMonthlyBudgetUsdRaw === null) {
        res.status(400).json({ error: "openaiMonthlyBudgetUsd must be a positive number or empty" });
        return;
      }
      const openaiCostInputPer1MRaw = normalizeOptionalNumberString(body.openaiCostInputPer1M);
      if (openaiCostInputPer1MRaw === null) {
        res.status(400).json({ error: "openaiCostInputPer1M must be a positive number or empty" });
        return;
      }
      const openaiCostOutputPer1MRaw = normalizeOptionalNumberString(body.openaiCostOutputPer1M);
      if (openaiCostOutputPer1MRaw === null) {
        res.status(400).json({ error: "openaiCostOutputPer1M must be a positive number or empty" });
        return;
      }
      const geminiApiKey = normalizeOptionalString(body.geminiApiKey);
      const serpApiKey = normalizeOptionalString(body.serpApiKey);
      const effectiveOpenaiFallbackToChatgptBridge = openaiFallbackToChatgptBridge ?? true;
      const effectiveOpenaiForceBridge = openaiForceBridge ?? false;

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
        setEnvValue(envPath, "LLM_THINKING_BUDGET_ENABLED", effectiveThinkingBudgetEnabled ? "true" : "false");
        if (thinkingBudgetRaw) {
          setEnvValue(envPath, "LLM_THINKING_BUDGET", thinkingBudgetRaw);
        } else {
          unsetEnvValue(envPath, "LLM_THINKING_BUDGET");
        }
        if (openaiBaseUrl) {
          setEnvValue(envPath, "OPENAI_BASE_URL", openaiBaseUrl);
        } else {
          unsetEnvValue(envPath, "OPENAI_BASE_URL");
        }
        if (openaiApiKey) {
          setEnvValue(envPath, "OPENAI_API_KEY", openaiApiKey);
        } else {
          unsetEnvValue(envPath, "OPENAI_API_KEY");
        }
        if (openaiModel) {
          setEnvValue(envPath, "OPENAI_MODEL", openaiModel);
        } else {
          unsetEnvValue(envPath, "OPENAI_MODEL");
        }
        if (openaiPlanningModel) {
          setEnvValue(envPath, "OPENAI_PLANNING_MODEL", openaiPlanningModel);
        } else {
          unsetEnvValue(envPath, "OPENAI_PLANNING_MODEL");
        }
        if (openaiChatOptionsRaw) {
          setEnvValue(envPath, "OPENAI_CHAT_OPTIONS", openaiChatOptionsRaw);
        } else {
          unsetEnvValue(envPath, "OPENAI_CHAT_OPTIONS");
        }
        if (openaiPlanningChatOptionsRaw) {
          setEnvValue(envPath, "OPENAI_PLANNING_CHAT_OPTIONS", openaiPlanningChatOptionsRaw);
        } else {
          unsetEnvValue(envPath, "OPENAI_PLANNING_CHAT_OPTIONS");
        }
        setEnvValue(
          envPath,
          "OPENAI_FALLBACK_TO_CHATGPT_BRIDGE",
          effectiveOpenaiFallbackToChatgptBridge ? "true" : "false"
        );
        setEnvValue(
          envPath,
          "OPENAI_FORCE_BRIDGE",
          effectiveOpenaiForceBridge ? "true" : "false"
        );
        if (openaiQuotaResetDayRaw) {
          setEnvValue(envPath, "OPENAI_QUOTA_RESET_DAY", openaiQuotaResetDayRaw);
        } else {
          unsetEnvValue(envPath, "OPENAI_QUOTA_RESET_DAY");
        }
        if (openaiMonthlyTokenLimitRaw) {
          setEnvValue(envPath, "OPENAI_MONTHLY_TOKEN_LIMIT", openaiMonthlyTokenLimitRaw);
        } else {
          unsetEnvValue(envPath, "OPENAI_MONTHLY_TOKEN_LIMIT");
        }
        if (openaiMonthlyBudgetUsdRaw) {
          setEnvValue(envPath, "OPENAI_MONTHLY_BUDGET_USD", openaiMonthlyBudgetUsdRaw);
        } else {
          unsetEnvValue(envPath, "OPENAI_MONTHLY_BUDGET_USD");
        }
        if (openaiCostInputPer1MRaw) {
          setEnvValue(envPath, "OPENAI_COST_INPUT_PER_1M", openaiCostInputPer1MRaw);
        } else {
          unsetEnvValue(envPath, "OPENAI_COST_INPUT_PER_1M");
        }
        if (openaiCostOutputPer1MRaw) {
          setEnvValue(envPath, "OPENAI_COST_OUTPUT_PER_1M", openaiCostOutputPer1MRaw);
        } else {
          unsetEnvValue(envPath, "OPENAI_COST_OUTPUT_PER_1M");
        }
        if (geminiApiKey) {
          setEnvValue(envPath, "GEMINI_API_KEY", geminiApiKey);
        } else {
          unsetEnvValue(envPath, "GEMINI_API_KEY");
        }
        if (serpApiKey) {
          setEnvValue(envPath, "SERPAPI_KEY", serpApiKey);
        } else {
          unsetEnvValue(envPath, "SERPAPI_KEY");
        }
      } catch (error) {
        res.status(500).json({ error: (error as Error).message ?? "failed to save model config" });
        return;
      }

      const restart = parseOptionalBoolean(body.restart) ?? false;
      const effectivePlanningModel = planningModel || model;
      const effectivePlanningTimeoutMs = planningTimeoutRaw || "";
      const effectiveThinkingBudgetDefault = thinkingBudgetRaw || "";
      if (!restart) {
        res.json({
          ok: true,
          model,
          planningModel: effectivePlanningModel,
          planningTimeoutMs: effectivePlanningTimeoutMs,
          thinkingBudgetEnabled: effectiveThinkingBudgetEnabled,
          thinkingBudgetDefault: effectiveThinkingBudgetDefault,
          thinkingBudget: effectiveThinkingBudgetDefault,
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
          thinkingBudgetEnabled: effectiveThinkingBudgetEnabled,
          thinkingBudgetDefault: effectiveThinkingBudgetDefault,
          thinkingBudget: effectiveThinkingBudgetDefault,
          restarted: true,
          output
        });
      } catch (error) {
        res.status(500).json({
          ok: false,
          model,
          planningModel: effectivePlanningModel,
          planningTimeoutMs: effectivePlanningTimeoutMs,
          thinkingBudgetEnabled: effectiveThinkingBudgetEnabled,
          thinkingBudgetDefault: effectiveThinkingBudgetDefault,
          thinkingBudget: effectiveThinkingBudgetDefault,
          restarted: false,
          error: (error as Error).message ?? "pm2 restart failed"
        });
      }
    });

    app.post("/admin/api/config/codex", async (req: Request, res: ExResponse) => {
      const body = (req.body ?? {}) as {
        model?: unknown;
        codexModel?: unknown;
        reasoningEffort?: unknown;
        codexReasoningEffort?: unknown;
        restart?: unknown;
      };

      const hasModel = "model" in body || "codexModel" in body;
      const hasReasoningEffort = "reasoningEffort" in body || "codexReasoningEffort" in body;
      if (!hasModel && !hasReasoningEffort) {
        res.status(400).json({ error: "model or reasoningEffort is required" });
        return;
      }

      const modelRaw = "codexModel" in body ? body.codexModel : body.model;
      const model = typeof modelRaw === "string" ? modelRaw.trim() : null;
      if (hasModel && model === null) {
        res.status(400).json({ error: "model must be a string" });
        return;
      }

      const reasoningEffortRaw = "codexReasoningEffort" in body
        ? body.codexReasoningEffort
        : body.reasoningEffort;
      const reasoningEffort = typeof reasoningEffortRaw === "string" ? reasoningEffortRaw : null;
      if (hasReasoningEffort && reasoningEffort === null) {
        res.status(400).json({ error: "reasoningEffort must be a string" });
        return;
      }

      let configAfterUpdate: { codexModel: string; codexReasoningEffort: string; envPath: string };
      try {
        configAfterUpdate = this.codexConfigService.updateConfig({
          ...(hasModel ? { model: model ?? "" } : {}),
          ...(hasReasoningEffort ? { reasoningEffort: reasoningEffort ?? "" } : {})
        });
      } catch (error) {
        const message = (error as Error).message ?? "failed to save codex config";
        if (message.includes("must be one of")) {
          res.status(400).json({ error: message });
          return;
        }
        res.status(500).json({ error: message });
        return;
      }

      const restart = parseOptionalBoolean(body.restart) ?? false;
      if (!restart) {
        res.json({
          ok: true,
          codexModel: configAfterUpdate.codexModel,
          codexReasoningEffort: configAfterUpdate.codexReasoningEffort,
          restarted: false
        });
        return;
      }

      try {
        const output = await restartPm2();
        res.json({
          ok: true,
          codexModel: configAfterUpdate.codexModel,
          codexReasoningEffort: configAfterUpdate.codexReasoningEffort,
          restarted: true,
          output
        });
      } catch (error) {
        res.status(500).json({
          ok: false,
          codexModel: configAfterUpdate.codexModel,
          codexReasoningEffort: configAfterUpdate.codexReasoningEffort,
          restarted: false,
          error: (error as Error).message ?? "pm2 restart failed"
        });
      }
    });

    app.post("/admin/api/config/memory", async (req: Request, res: ExResponse) => {
      const body = (req.body ?? {}) as {
        memoryCompactEveryRounds?: unknown;
        memoryCompactMaxBatchSize?: unknown;
        memorySummaryTopK?: unknown;
        memoryRawRefLimit?: unknown;
        memoryRawRecordLimit?: unknown;
        memoryRagSummaryTopK?: unknown;
      };

      const envPath = this.envStore.getPath();
      const updates: Array<{ envKey: string; value: string | null }> = [
        { envKey: "MEMORY_COMPACT_EVERY_ROUNDS", value: normalizeOptionalIntegerString(body.memoryCompactEveryRounds) },
        { envKey: "MEMORY_COMPACT_MAX_BATCH_SIZE", value: normalizeOptionalIntegerString(body.memoryCompactMaxBatchSize) },
        { envKey: "MEMORY_SUMMARY_TOP_K", value: normalizeOptionalIntegerString(body.memorySummaryTopK) },
        { envKey: "MEMORY_RAW_REF_LIMIT", value: normalizeOptionalIntegerString(body.memoryRawRefLimit) },
        { envKey: "MEMORY_RAW_RECORD_LIMIT", value: normalizeOptionalIntegerString(body.memoryRawRecordLimit) },
        { envKey: "MEMORY_RAG_SUMMARY_TOP_K", value: normalizeOptionalIntegerString(body.memoryRagSummaryTopK) }
      ];

      const invalid = updates.find((item) => item.value === null);
      if (invalid) {
        res.status(400).json({ error: `${invalid.envKey} must be a positive integer or empty` });
        return;
      }

      try {
        for (const update of updates) {
          if (update.value) {
            setEnvValue(envPath, update.envKey, update.value);
          } else {
            unsetEnvValue(envPath, update.envKey);
          }
        }
      } catch (error) {
        res.status(500).json({ error: (error as Error).message ?? "failed to save memory config" });
        return;
      }

      res.json({
        ok: true,
        memoryCompactEveryRounds: getEnvValue(envPath, "MEMORY_COMPACT_EVERY_ROUNDS"),
        memoryCompactMaxBatchSize: getEnvValue(envPath, "MEMORY_COMPACT_MAX_BATCH_SIZE"),
        memorySummaryTopK: getEnvValue(envPath, "MEMORY_SUMMARY_TOP_K"),
        memoryRawRefLimit: getEnvValue(envPath, "MEMORY_RAW_REF_LIMIT"),
        memoryRawRecordLimit: getEnvValue(envPath, "MEMORY_RAW_RECORD_LIMIT"),
        memoryRagSummaryTopK: getEnvValue(envPath, "MEMORY_RAG_SUMMARY_TOP_K")
      });
    });

    app.post("/admin/api/restart", (_req: Request, res: ExResponse) => {
      try {
        const scheduled = schedulePm2Restart();
        res.json({
          ok: true,
          accepted: true,
          restartScheduled: true,
          delayMs: scheduled.delayMs,
          scheduledAt: scheduled.scheduledAt,
          output: `pm2 restart scheduled in ${scheduled.delayMs}ms`
        });
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

    app.post("/admin/api/repo/deploy", async (_req: Request, res: ExResponse) => {
      try {
        const result = await pullBuildAndRestart();
        res.json({
          ok: true,
          ...result
        });
      } catch (error) {
        res.status(500).json({
          ok: false,
          error: (error as Error).message ?? "repo deploy failed"
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
        || "assetType" in payload
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

      const limit = normalizeLimit(req.query.limit, 10, 1, 20);

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

    app.post("/admin/api/market/run-once", async (req: Request, res: ExResponse) => {
      const parsed = parseRunMarketOncePayload(req.body);
      if (!parsed.payload) {
        res.status(400).json({ ok: false, error: parsed.error });
        return;
      }
      const payload = parsed.payload;

      const baseMessage = `/market ${payload.phase}`;
      const message = payload.withExplanation === false
        ? `${baseMessage} --no-llm`
        : baseMessage;

      try {
        const result = await this.scheduler.runMessageNow(payload.userId, message);
        res.json({
          ok: true,
          phase: payload.phase,
          message,
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

function parseMarketAnalysisConfigInput(rawBody: unknown): MarketAnalysisConfig | null {
  if (!rawBody || typeof rawBody !== "object") {
    return null;
  }

  const body = rawBody as Record<string, unknown>;
  const payload = "config" in body ? body.config : rawBody;
  if (!payload || typeof payload !== "object") {
    return null;
  }
  return normalizeMarketAnalysisConfig(payload);
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

function parseRunMarketOncePayload(rawBody: unknown): RunMarketOncePayloadParseResult {
  if (!rawBody || typeof rawBody !== "object") {
    return { error: "invalid run-once payload" };
  }

  const body = rawBody as Record<string, unknown>;
  const allowedKeys = new Set(["userId", "phase", "withExplanation"]);
  const invalidKeys = Object.keys(body).filter((key) => !allowedKeys.has(key));
  if (invalidKeys.length > 0) {
    return { error: `unsupported fields: ${invalidKeys.join(", ")}` };
  }

  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  if (!userId) {
    return { error: "userId is required" };
  }

  const phase = parseMarketPhase(body.phase);
  if (!phase) {
    return { error: "phase must be midday or close" };
  }

  if ("withExplanation" in body) {
    const withExplanation = parseOptionalBoolean(body.withExplanation);
    if (withExplanation === undefined) {
      return { error: "withExplanation must be boolean" };
    }
    return { payload: { userId, phase, withExplanation } };
  }

  return { payload: { userId, phase } };
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
      task.userIds.length === 1 &&
      task.userIds[0] === payload.userId &&
      task.message.trim().toLowerCase() === spec.message
    );

    if (match) {
      const updated = scheduler.updateTask(match.id, {
        name: spec.name,
        enabled: spec.enabled,
        time: spec.time,
        userIds: [payload.userId],
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
      userIds: [payload.userId],
      message: spec.message
    });
    upserted.push(created);
  }

  return upserted;
}

function readMarketPortfolio(): MarketPortfolio {
  ensureMarketStorage();
  const parsed = getStore<unknown>(MARKET_PORTFOLIO_STORE);
  return normalizeMarketPortfolio(parsed);
}

function readMarketAnalysisConfig(): MarketAnalysisConfig {
  ensureMarketStorage();
  const parsed = getStore<unknown>(MARKET_CONFIG_STORE);
  return normalizeMarketAnalysisConfig(parsed);
}

function writeMarketPortfolio(portfolio: MarketPortfolio): void {
  ensureMarketStorage();
  setStore(MARKET_PORTFOLIO_STORE, normalizeMarketPortfolio(portfolio));
}

function writeMarketAnalysisConfig(config: MarketAnalysisConfig): void {
  ensureMarketStorage();
  setStore(MARKET_CONFIG_STORE, normalizeMarketAnalysisConfig(config));
}

function listMarketRunSummaries(limit: number, phase?: MarketPhase): MarketRunSummary[] {
  const state = readMarketStateFile();
  let summaries = state.recentRuns;

  if (summaries.length === 0) {
    summaries = loadMarketRunSummariesFromStore(Math.max(limit * 3, 24));
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
  const parsed = getStore<unknown>(MARKET_STATE_STORE);
  return normalizeMarketState(parsed);
}

function loadMarketRunSummariesFromStore(limit: number): MarketRunSummary[] {
  ensureMarketStorage();
  const parsed = getStore<unknown>(DATA_STORE.MARKET_RUNS);
  if (!parsed || typeof parsed !== "object") {
    return [];
  }

  const source = parsed as { runs?: unknown };
  const runs = source.runs && typeof source.runs === "object"
    ? source.runs as Record<string, unknown>
    : {};

  const summaries: MarketRunSummary[] = [];
  for (const [runId, run] of Object.entries(runs)) {
    if (!run || typeof run !== "object") {
      continue;
    }
    const summary = normalizeMarketRunSummaryFromRecord(run as Record<string, unknown>, runId);
    if (summary) {
      summaries.push(summary);
    }
  }

  summaries.sort((a, b) => {
    const left = Date.parse(a.createdAt);
    const right = Date.parse(b.createdAt);
    return (Number.isFinite(right) ? right : 0) - (Number.isFinite(left) ? left : 0);
  });

  return summaries.slice(0, limit);
}

function normalizeMarketRunSummaryFromRecord(
  parsed: Record<string, unknown>,
  fallbackId: string
): MarketRunSummary | null {
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
    id: typeof parsed.id === "string" ? parsed.id : fallbackId,
    createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : "",
    phase,
    marketState: typeof signalResult.marketState === "string" ? signalResult.marketState : "",
    benchmark: typeof signalResult.benchmark === "string" ? signalResult.benchmark : "",
    assetSignalCount: compactSignals.length,
    signals: compactSignals.slice(0, 8),
    explanationSummary: typeof explanation.summary === "string" ? explanation.summary : ""
  };
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

function normalizeMarketAnalysisConfig(input: unknown): MarketAnalysisConfig {
  const fallback = {
    ...DEFAULT_MARKET_ANALYSIS_CONFIG,
    gptPlugin: { ...DEFAULT_MARKET_ANALYSIS_CONFIG.gptPlugin },
    fund: { ...DEFAULT_MARKET_ANALYSIS_CONFIG.fund }
  };
  if (!input || typeof input !== "object") {
    return fallback;
  }

  const source = input as Record<string, unknown>;
  const assetTypeRaw = typeof source.assetType === "string" ? source.assetType.trim().toLowerCase() : "";
  const assetType: MarketAnalysisAssetType = assetTypeRaw === "fund" ? "fund" : "equity";
  const engineRaw = typeof source.analysisEngine === "string" ? source.analysisEngine.trim().toLowerCase() : "";
  const analysisEngine: MarketAnalysisEngine = normalizeMarketAnalysisEngine(engineRaw);
  const gptPlugin = source.gptPlugin && typeof source.gptPlugin === "object"
    ? source.gptPlugin as Record<string, unknown>
    : {};
  const timeoutMs = Number(gptPlugin.timeoutMs);
  const fallbackToLocal = parseOptionalBoolean(gptPlugin.fallbackToLocal);
  const fund = source.fund && typeof source.fund === "object"
    ? source.fund as Record<string, unknown>
    : {};
  const fundEnabled = parseOptionalBoolean(fund.enabled);
  const maxAgeDays = Number(fund.maxAgeDays);
  const featureLookbackDays = Number(fund.featureLookbackDays);
  const llmRetryMax = Number(fund.llmRetryMax);
  const ruleRiskLevelRaw = typeof fund.ruleRiskLevel === "string"
    ? fund.ruleRiskLevel.trim().toLowerCase()
    : "";
  const ruleRiskLevel: "low" | "medium" | "high" = ruleRiskLevelRaw === "low"
    ? "low"
    : ruleRiskLevelRaw === "high"
      ? "high"
      : "medium";

  return {
    version: 1,
    assetType,
    analysisEngine,
    gptPlugin: {
      timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0
        ? Math.floor(timeoutMs)
        : DEFAULT_MARKET_ANALYSIS_CONFIG.gptPlugin.timeoutMs,
      fallbackToLocal: fallbackToLocal ?? DEFAULT_MARKET_ANALYSIS_CONFIG.gptPlugin.fallbackToLocal
    },
    fund: {
      enabled: fundEnabled ?? DEFAULT_MARKET_ANALYSIS_CONFIG.fund.enabled,
      maxAgeDays: Number.isFinite(maxAgeDays) && maxAgeDays > 0
        ? Math.floor(maxAgeDays)
        : DEFAULT_MARKET_ANALYSIS_CONFIG.fund.maxAgeDays,
      featureLookbackDays: Number.isFinite(featureLookbackDays) && featureLookbackDays > 0
        ? Math.floor(featureLookbackDays)
        : DEFAULT_MARKET_ANALYSIS_CONFIG.fund.featureLookbackDays,
      ruleRiskLevel,
      llmRetryMax: Number.isFinite(llmRetryMax) && llmRetryMax > 0
        ? Math.floor(llmRetryMax)
        : DEFAULT_MARKET_ANALYSIS_CONFIG.fund.llmRetryMax
    }
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
    const name = typeof value.name === "string" ? value.name.trim() : "";
    const quantity = Number(value.quantity);
    const avgCost = Number(value.avgCost);
    if (!code || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(avgCost) || avgCost < 0) {
      continue;
    }
    funds.push({
      code,
      name,
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

async function searchMarketSecurities(keyword: string, limit: number): Promise<MarketSecuritySearchItem[]> {
  const query = keyword.trim();
  if (!query) {
    return [];
  }

  const endpointCandidates = [
    "https://searchapi.eastmoney.com/api/suggest/get",
    "https://searchadapter.eastmoney.com/api/suggest/get"
  ];

  const requestCount = Math.max(limit * 2, 20);
  const errors: string[] = [];
  let hasSuccessfulResponse = false;

  for (const endpoint of endpointCandidates) {
    const url = new URL(endpoint);
    url.searchParams.set("input", query);
    url.searchParams.set("type", "14");
    url.searchParams.set("count", String(requestCount));
    url.searchParams.set("token", EASTMONEY_SEARCH_TOKEN);
    url.searchParams.set("_", String(Date.now()));

    try {
      const rawText = await fetchTextWithTimeout(url.toString(), MARKET_SECURITY_SEARCH_TIMEOUT_MS);
      const payload = parseJsonOrJsonp(rawText);
      const items = normalizeEastmoneySearchResults(payload, query, limit);
      hasSuccessfulResponse = true;
      if (items.length > 0) {
        return items;
      }
    } catch (error) {
      errors.push((error as Error).message ?? String(error));
    }
  }

  if (hasSuccessfulResponse) {
    return [];
  }

  if (errors.length > 0) {
    throw new Error(`market search provider unavailable: ${errors.join(" | ")}`);
  }

  return [];
}

async function fetchTextWithTimeout(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseJsonOrJsonp(rawText: string): unknown {
  const text = rawText.trim();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    // no-op
  }

  const firstParen = text.indexOf("(");
  const lastParen = text.lastIndexOf(")");
  if (firstParen <= 0 || lastParen <= firstParen) {
    throw new Error("unexpected search payload");
  }

  const jsonPayload = text.slice(firstParen + 1, lastParen).trim();
  if (!jsonPayload) {
    return {};
  }
  return JSON.parse(jsonPayload);
}

function normalizeEastmoneySearchResults(payload: unknown, keyword: string, limit: number): MarketSecuritySearchItem[] {
  const rows = extractEastmoneySearchRows(payload);
  if (rows.length === 0) {
    return [];
  }

  const query = keyword.trim();
  const queryLower = query.toLowerCase();
  const queryDigits = extractSixDigitCode(query);
  const scored = new Map<string, { item: MarketSecuritySearchItem; score: number }>();

  for (const row of rows) {
    const normalized = normalizeEastmoneySearchRow(row);
    if (!normalized) {
      continue;
    }

    const pinyin = getStringField(row, ["PinYin", "PY", "py", "pinyin"]).toLowerCase();
    const score = calculateSearchScore(normalized, queryLower, queryDigits, pinyin);
    const existing = scored.get(normalized.code);
    if (!existing || score < existing.score) {
      scored.set(normalized.code, {
        item: normalized,
        score
      });
    }
  }

  return Array.from(scored.values())
    .sort((left, right) => {
      if (left.score !== right.score) {
        return left.score - right.score;
      }
      return left.item.code.localeCompare(right.item.code);
    })
    .slice(0, limit)
    .map((entry) => entry.item);
}

function extractEastmoneySearchRows(payload: unknown): Array<Record<string, unknown>> {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const source = payload as Record<string, unknown>;
  const table = source.QuotationCodeTable;
  if (table && typeof table === "object") {
    const tableRecord = table as Record<string, unknown>;
    if (Array.isArray(tableRecord.Data)) {
      return tableRecord.Data.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
    }
    if (Array.isArray(tableRecord.data)) {
      return tableRecord.data.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
    }
  }

  if (Array.isArray(source.Data)) {
    return source.Data.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  }
  if (Array.isArray(source.data)) {
    return source.data.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  }

  return [];
}

function normalizeEastmoneySearchRow(row: Record<string, unknown>): MarketSecuritySearchItem | null {
  const code = inferSearchCode(row);
  if (!code) {
    return null;
  }

  const name = getStringField(row, ["Name", "name", "SecurityName", "securityName", "ShortName", "Zqmc"]).trim();
  if (!name) {
    return null;
  }

  const market = inferSearchMarket(row, code);
  const securityType = getStringField(row, ["SecurityTypeName", "securityTypeName", "SecurityType", "Classify", "TypeName"]).trim();
  const rawSecid = getStringField(row, ["QuoteID", "quoteId", "SecID", "secid", "SecurityID", "securityId"]).trim();
  const secid = /^[01]\.\d{6}$/.test(rawSecid)
    ? rawSecid
    : (market ? `${market === "SH" ? "1" : "0"}.${code}` : undefined);

  return {
    code,
    name,
    market,
    securityType,
    ...(secid ? { secid } : {})
  };
}

function inferSearchCode(row: Record<string, unknown>): string {
  const candidates = [
    getStringField(row, ["Code", "code", "SecurityCode", "securityCode", "UnifiedCode", "unifiedCode"]),
    getStringField(row, ["QuoteID", "quoteId", "SecID", "secid"]),
    getStringField(row, ["ID", "id", "InnerCode", "innerCode"])
  ];

  for (const candidate of candidates) {
    const code = extractSixDigitCode(candidate);
    if (code) {
      return code;
    }
  }
  return "";
}

function inferSearchMarket(row: Record<string, unknown>, code: string): string {
  const exchange = getStringField(row, ["JYS", "Exchange", "exchange", "MktAbbr", "mktAbbr"]).trim().toUpperCase();
  if (exchange.includes("SH") || exchange.includes("SSE")) {
    return "SH";
  }
  if (exchange.includes("SZ")) {
    return "SZ";
  }

  const quoteId = getStringField(row, ["QuoteID", "quoteId", "SecID", "secid"]).trim();
  if (/^1\.\d{6}$/.test(quoteId)) {
    return "SH";
  }
  if (/^0\.\d{6}$/.test(quoteId)) {
    return "SZ";
  }

  const marketNum = getStringField(row, ["MktNum", "mktNum", "MarketType", "marketType"]).trim();
  if (marketNum === "1") {
    return "SH";
  }
  if (marketNum === "0") {
    return "SZ";
  }

  if (["5", "6", "9"].includes(code[0])) {
    return "SH";
  }
  if (["0", "1", "2", "3"].includes(code[0])) {
    return "SZ";
  }

  return "";
}

function calculateSearchScore(
  item: MarketSecuritySearchItem,
  queryLower: string,
  queryDigits: string,
  pinyin: string
): number {
  let score = 100;
  const nameLower = item.name.toLowerCase();

  if (queryDigits) {
    if (item.code === queryDigits) {
      score -= 80;
    } else if (item.code.includes(queryDigits)) {
      score -= 35;
    }
  }

  if (queryLower) {
    if (nameLower === queryLower) {
      score -= 70;
    } else if (nameLower.startsWith(queryLower)) {
      score -= 50;
    } else if (nameLower.includes(queryLower)) {
      score -= 30;
    }

    if (pinyin) {
      if (pinyin === queryLower) {
        score -= 25;
      } else if (pinyin.startsWith(queryLower)) {
        score -= 15;
      } else if (pinyin.includes(queryLower)) {
        score -= 8;
      }
    }
  }

  if (item.market === "SH" || item.market === "SZ") {
    score -= 2;
  }

  return score;
}

function getStringField(source: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return "";
}

function extractSixDigitCode(raw: string): string {
  const text = raw.trim();
  if (!text) {
    return "";
  }

  if (/^\d{6}$/.test(text)) {
    return text;
  }

  const secidMatch = text.match(/[01]\.(\d{6})/);
  if (secidMatch?.[1]) {
    return secidMatch[1];
  }

  const genericMatch = text.match(/(\d{6})/);
  return genericMatch?.[1] ?? "";
}

function ensureMarketStorage(): void {
  registerStore(MARKET_PORTFOLIO_STORE, () => DEFAULT_MARKET_PORTFOLIO);
  registerStore(MARKET_CONFIG_STORE, () => DEFAULT_MARKET_ANALYSIS_CONFIG);
  registerStore(MARKET_STATE_STORE, () => buildDefaultMarketState());
  registerStore(DATA_STORE.MARKET_RUNS, () => ({ version: 1, runs: {} }));
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
  const content = readEnvText(envPath);
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

  const lines = readEnvText(envPath).split(/\r?\n/);

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

  writeEnvText(envPath, `${lines.join("\n").replace(/\n+$/, "\n")}`);
  process.env[key] = text;
}

function unsetEnvValue(envPath: string, key: string): void {
  const lines = readEnvText(envPath).split(/\r?\n/);
  const nextLines = lines.filter((line) => {
    if (!line || /^\s*#/.test(line)) {
      return true;
    }
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    return match?.[1] !== key;
  });
  writeEnvText(envPath, `${nextLines.join("\n").replace(/\n+$/, "\n")}`);
  delete process.env[key];
}

function readEnvText(envPath: string): string {
  registerStore(DATA_STORE.ENV_CONFIG, {
    init: () => "",
    codec: "text",
    filePath: envPath
  });
  return getStore<string>(DATA_STORE.ENV_CONFIG);
}

function writeEnvText(envPath: string, content: string): void {
  registerStore(DATA_STORE.ENV_CONFIG, {
    init: () => "",
    codec: "text",
    filePath: envPath
  });
  setStore(DATA_STORE.ENV_CONFIG, content);
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

function normalizeOptionalNumberString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return "";
  }
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!raw) {
    return "";
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return String(parsed);
}

function normalizeOptionalString(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function normalizeOptionalJsonObjectString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return "";
  }
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    return "";
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return JSON.stringify(parsed);
  } catch {
    return null;
  }
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

function schedulePm2Restart(delayMs = 700): { delayMs: number; scheduledAt: string } {
  const normalizedDelayMs = Number.isFinite(delayMs)
    ? Math.max(100, Math.min(10_000, Math.floor(delayMs)))
    : 700;
  const scheduledAt = new Date().toISOString();

  setTimeout(() => {
    void restartPm2().catch((error) => {
      console.error(`[admin] pm2 restart failed: ${(error as Error).message ?? "unknown error"}`);
    });
  }, normalizedDelayMs);

  return {
    delayMs: normalizedDelayMs,
    scheduledAt
  };
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

async function pullBuildAndRestart(): Promise<{
  cwd: string;
  pullCommand: string;
  pullOutput: string;
  buildOutput: string;
  restartOutput: string;
}> {
  const pullResult = await pullRepoWithRebase();
  const buildResult = await buildProject();
  const restartOutput = await restartPm2();
  return {
    cwd: buildResult.cwd,
    pullCommand: pullResult.pullCommand,
    pullOutput: pullResult.pullOutput,
    buildOutput: buildResult.buildOutput,
    restartOutput
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
