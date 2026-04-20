import { Express, Request, Response as ExResponse } from "express";
import { getStorageDriver, getStorageSqlitePath } from "../../../storage/persistence";
import { readOpenAIQuotaPolicyFromEnv } from "../../../integrations/openai/quotaManager";
import {
  deleteLLMProviderProfile,
  getDefaultLLMProviderProfile,
  readLLMProviderStore,
  setDefaultLLMProvider,
  setLLMProviderSelections,
  upsertLLMProviderProfile
} from "../../../engines/llm/provider_store";
import {
  deleteSearchEngineProfile,
  getDefaultSearchEngineProfile,
  readSearchEngineStore,
  setDefaultSearchEngine,
  upsertSearchEngineProfile
} from "../../../integrations/search-engine/store";
import { readMainConversationMode } from "../../../core/conversation/mode";
import { AdminRouteContext } from "../context";
import { getEnvValue } from "../env";
import { fetchOllamaModels } from "../process";
import { parseOptionalBoolean } from "../utils";
import {
  parseDirectInputMappingConfigPayload,
  parseEvolutionGoalInput,
  parseWeComMenuConfigPayload
} from "./generalPayloads";
import { buildConversationContextAdminSnapshot } from "./conversationContextShared";

export function registerGeneralAdminRoutes(app: Express, context: AdminRouteContext): void {
  app.get("/admin/api/config", (_req, res) => {
    const envPath = context.envStore.getPath();
    const evolutionSnapshot = context.evolutionService?.getSnapshot();
    const codexConfig = context.codexConfigService.getConfig();
    const llmProviderStore = readLLMProviderStore();
    const defaultLLMProvider = getDefaultLLMProviderProfile();
    const marketSearchEngineStore = readSearchEngineStore();
    const defaultMarketSearchEngine = getDefaultSearchEngineProfile();
    const thinkingBudgetDefault = getEnvValue(envPath, "LLM_THINKING_BUDGET");
    res.json({
      llmProviders: {
        store: llmProviderStore,
        defaultProvider: defaultLLMProvider
      },
      searchEngines: {
        store: marketSearchEngineStore,
        defaultEngine: defaultMarketSearchEngine
      },
      model: context.envStore.getModel(),
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
      storageDriver: getEnvValue(envPath, "STORAGE_DRIVER") || getStorageDriver(),
      storageDriverEffective: getStorageDriver(),
      storageSqlitePath: getEnvValue(envPath, "STORAGE_SQLITE_PATH") || getStorageSqlitePath(),
      mainConversationMode: readMainConversationMode(getEnvValue(envPath, "MAIN_CONVERSATION_MODE")),
      conversationWindowTimeoutSeconds: getEnvValue(envPath, "CONVERSATION_WINDOW_TIMEOUT_SECONDS") || "180",
      conversationWindowMaxTurns: getEnvValue(envPath, "CONVERSATION_WINDOW_MAX_TURNS") || "6",
      conversationAgentMaxSteps: getEnvValue(envPath, "CONVERSATION_AGENT_MAX_STEPS") || "4",
      celestiaBaseUrl: getEnvValue(envPath, "CELESTIA_BASE_URL"),
      celestiaToken: getEnvValue(envPath, "CELESTIA_TOKEN"),
      celestiaDeviceRefreshMs: getEnvValue(envPath, "CELESTIA_DEVICE_REFRESH_MS") || "60000",
      llmMemoryContextEnabled: parseOptionalBoolean(getEnvValue(envPath, "LLM_MEMORY_CONTEXT_ENABLED")) ?? true,
      memoryCompactEveryRounds: getEnvValue(envPath, "MEMORY_COMPACT_EVERY_ROUNDS"),
      memoryCompactMaxBatchSize: getEnvValue(envPath, "MEMORY_COMPACT_MAX_BATCH_SIZE"),
      memorySummaryTopK: getEnvValue(envPath, "MEMORY_SUMMARY_TOP_K"),
      memoryRawRefLimit: getEnvValue(envPath, "MEMORY_RAW_REF_LIMIT"),
      memoryRawRecordLimit: getEnvValue(envPath, "MEMORY_RAW_RECORD_LIMIT"),
      conversationContext: buildConversationContextAdminSnapshot(context),
      envPath,
      taskStore: context.scheduler.getTaskStore(),
      userStore: context.scheduler.getUserStore(),
      timezone: context.scheduler.getTimezone(),
      tickMs: context.scheduler.getTickMs(),
      evolution: evolutionSnapshot
        ? {
            tickMs: context.evolutionService?.getTickMs(),
            stateStore: evolutionSnapshot.storage.stores.state,
            retryQueueStore: evolutionSnapshot.storage.stores.retryQueue,
            metricsStore: evolutionSnapshot.storage.stores.metrics
          }
        : null
    });
  });

  app.get("/admin/api/evolution/state", (_req: Request, res: ExResponse) => {
    if (!context.evolutionService) {
      res.status(501).json({ ok: false, error: "evolution engine is not enabled" });
      return;
    }
    const snapshot = context.evolutionService.getSnapshot();
    res.json({
      ok: true,
      tickMs: context.evolutionService.getTickMs(),
      ...snapshot
    });
  });

  app.post("/admin/api/evolution/goals", async (req: Request, res: ExResponse) => {
    if (!context.evolutionService) {
      res.status(501).json({ ok: false, error: "evolution engine is not enabled" });
      return;
    }
    const input = parseEvolutionGoalInput(req.body);
    if (!input) {
      res.status(400).json({ ok: false, error: "goal is required" });
      return;
    }

    try {
      const goal = await context.evolutionService.enqueueGoal(input);
      res.json({
        ok: true,
        goal
      });
    } catch (error) {
      res.status(400).json({ ok: false, error: (error as Error).message ?? "failed to enqueue goal" });
    }
  });

  app.post("/admin/api/evolution/tick", async (_req: Request, res: ExResponse) => {
    if (!context.evolutionService) {
      res.status(501).json({ ok: false, error: "evolution engine is not enabled" });
      return;
    }
    try {
      context.evolutionService.triggerNowAsync();
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
      const snapshot = context.openAIQuotaManager.getSnapshot(policy);
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
    const body = (req.body ?? {}) as { action?: unknown };
    const action = typeof body.action === "string" ? body.action.trim().toLowerCase() : "";
    const policy = readOpenAIQuotaPolicyFromEnv();

    try {
      if (!action || action === "unblock") {
        context.openAIQuotaManager.markAvailable(policy, "manual_unblock");
      } else if (action === "exhaust") {
        context.openAIQuotaManager.markExhausted(policy, "manual_exhausted");
      } else if (action === "reset") {
        context.openAIQuotaManager.resetUsage(policy);
      } else {
        res.status(400).json({
          ok: false,
          error: "action must be one of: unblock | exhaust | reset"
        });
        return;
      }

      const snapshot = context.openAIQuotaManager.getSnapshot(policy);
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

  app.get("/admin/api/wecom/menu", (_req: Request, res: ExResponse) => {
    try {
      res.json({
        ok: true,
        ...context.observableMenuService.getSnapshot()
      });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: (error as Error).message ?? "failed to read wecom menu config"
      });
    }
  });

  app.put("/admin/api/wecom/menu", (req: Request, res: ExResponse) => {
    const payload = parseWeComMenuConfigPayload(req.body);
    if (payload === null) {
      res.status(400).json({ ok: false, error: "invalid wecom menu payload" });
      return;
    }

    try {
      res.json({
        ok: true,
        ...context.observableMenuService.saveConfig(payload)
      });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: (error as Error).message ?? "failed to save wecom menu config"
      });
    }
  });

  app.post("/admin/api/wecom/menu/publish", async (req: Request, res: ExResponse) => {
    const payload = parseWeComMenuConfigPayload(req.body, { allowEmpty: true });
    if (payload === null) {
      res.status(400).json({ ok: false, error: "invalid wecom menu payload" });
      return;
    }

    try {
      res.json({
        ok: true,
        ...await context.observableMenuService.publishConfig(payload ?? undefined)
      });
    } catch (error) {
      res.status(502).json({
        ok: false,
        error: (error as Error).message ?? "failed to publish wecom menu"
      });
    }
  });

  app.get("/admin/api/direct-input-mappings", (_req: Request, res: ExResponse) => {
    try {
      res.json({
        ok: true,
        ...context.directInputMappingService.getSnapshot()
      });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: (error as Error).message ?? "failed to read direct input mappings"
      });
    }
  });

  app.put("/admin/api/direct-input-mappings", (req: Request, res: ExResponse) => {
    const payload = parseDirectInputMappingConfigPayload(req.body);
    if (payload === null) {
      res.status(400).json({ ok: false, error: "invalid direct input mapping payload" });
      return;
    }

    try {
      res.json({
        ok: true,
        ...context.directInputMappingService.saveConfig(payload)
      });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: (error as Error).message ?? "failed to save direct input mappings"
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
    const defaultProviderId = typeof body.defaultProviderId === "string" ? body.defaultProviderId.trim() : "";
    const routingProviderId = typeof body.routingProviderId === "string" ? body.routingProviderId.trim() : "";
    const planningProviderId = typeof body.planningProviderId === "string" ? body.planningProviderId.trim() : "";

    try {
      upsertLLMProviderProfile(providerPayload);
      if (defaultProviderId || routingProviderId || planningProviderId) {
        setLLMProviderSelections({
          ...(defaultProviderId ? { defaultProviderId } : {}),
          ...(routingProviderId ? { routingProviderId } : {}),
          ...(planningProviderId ? { planningProviderId } : {})
        });
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
    const defaultProviderId = typeof body.defaultProviderId === "string"
      ? body.defaultProviderId.trim()
      : (typeof body.providerId === "string" ? body.providerId.trim() : "");
    const routingProviderId = typeof body.routingProviderId === "string" ? body.routingProviderId.trim() : "";
    const planningProviderId = typeof body.planningProviderId === "string" ? body.planningProviderId.trim() : "";
    if (!defaultProviderId && !routingProviderId && !planningProviderId) {
      res.status(400).json({
        ok: false,
        error: "at least one of defaultProviderId/routingProviderId/planningProviderId is required"
      });
      return;
    }

    try {
      if (defaultProviderId && !routingProviderId && !planningProviderId) {
        setDefaultLLMProvider(defaultProviderId);
      } else {
        setLLMProviderSelections({
          ...(defaultProviderId ? { defaultProviderId } : {}),
          ...(routingProviderId ? { routingProviderId } : {}),
          ...(planningProviderId ? { planningProviderId } : {})
        });
      }
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
      res.status(400).json({ ok: false, error: "provider id is required" });
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

  app.get("/admin/api/search-engines", (_req: Request, res: ExResponse) => {
    try {
      const store = readSearchEngineStore();
      res.json({
        ok: true,
        store,
        defaultEngine: getDefaultSearchEngineProfile()
      });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: (error as Error).message ?? "failed to read search engines"
      });
    }
  });

  app.put("/admin/api/search-engines", (req: Request, res: ExResponse) => {
    const body = req.body && typeof req.body === "object"
      ? req.body as Record<string, unknown>
      : {};
    const enginePayload = "engine" in body ? body.engine : body;
    const defaultEngineId = typeof body.defaultEngineId === "string" ? body.defaultEngineId.trim() : "";

    try {
      upsertSearchEngineProfile(enginePayload);
      if (defaultEngineId) {
        setDefaultSearchEngine(defaultEngineId);
      }
      res.json({
        ok: true,
        store: readSearchEngineStore(),
        defaultEngine: getDefaultSearchEngineProfile()
      });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: (error as Error).message ?? "failed to upsert search engine"
      });
    }
  });

  app.post("/admin/api/search-engines/default", (req: Request, res: ExResponse) => {
    const body = req.body && typeof req.body === "object"
      ? req.body as Record<string, unknown>
      : {};
    const engineId = typeof body.engineId === "string"
      ? body.engineId.trim()
      : (typeof body.id === "string" ? body.id.trim() : "");
    if (!engineId) {
      res.status(400).json({ ok: false, error: "engineId is required" });
      return;
    }

    try {
      setDefaultSearchEngine(engineId);
      res.json({
        ok: true,
        store: readSearchEngineStore(),
        defaultEngine: getDefaultSearchEngineProfile()
      });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: (error as Error).message ?? "failed to set default search engine"
      });
    }
  });

  app.delete("/admin/api/search-engines/:id", (req: Request, res: ExResponse) => {
    const engineId = String(req.params.id ?? "").trim();
    if (!engineId) {
      res.status(400).json({ ok: false, error: "engine id is required" });
      return;
    }

    try {
      deleteSearchEngineProfile(engineId);
      res.json({
        ok: true,
        store: readSearchEngineStore(),
        defaultEngine: getDefaultSearchEngineProfile()
      });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: (error as Error).message ?? "failed to delete search engine"
      });
    }
  });
}
