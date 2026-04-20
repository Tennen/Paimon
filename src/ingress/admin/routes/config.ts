import { Express, Request, Response as ExResponse } from "express";
import { ConversationBenchmarkRequest } from "../../../core/conversation/benchmarkService";
import { MainConversationMode } from "../../../core/conversation/types";
import { normalizeMainConversationMode, readMainConversationMode } from "../../../core/conversation/mode";
import { getStorageDriver, getStorageSqlitePath } from "../../../storage/persistence";
import { AdminRouteContext } from "../context";
import { getEnvValue, setEnvValue, unsetEnvValue } from "../env";
import {
  buildProject,
  pullBuildAndRestart,
  pullRepoWithRebase,
  restartPm2,
  schedulePm2Restart
} from "../process";
import {
  normalizeOptionalIntegerString,
  normalizeOptionalJsonObjectString,
  normalizeOptionalNumberString,
  normalizeOptionalString,
  parseOptionalBoolean,
  writeOptionalEnvValue
} from "../utils";
import {
  buildConversationContextAdminSnapshot,
  getAvailableConversationContextNames,
  normalizeOptionalStringArray
} from "./conversationContextShared";

export function registerConfigAdminRoutes(app: Express, context: AdminRouteContext): void {
  app.post("/admin/api/config/model", async (req: Request, res: ExResponse) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const model = typeof body.model === "string" ? body.model.trim() : "";
    if (!model) {
      res.status(400).json({ error: "model is required" });
      return;
    }

    const planningModel = typeof body.planningModel === "string" ? body.planningModel.trim() : "";
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

    const envPath = context.envStore.getPath();
    try {
      context.envStore.setModel(model);
      writeStringEnv(envPath, "OLLAMA_PLANNING_MODEL", planningModel);
      writeStringEnv(envPath, "LLM_PLANNING_TIMEOUT_MS", planningTimeoutRaw || "");
      setEnvValue(envPath, "LLM_THINKING_BUDGET_ENABLED", effectiveThinkingBudgetEnabled ? "true" : "false");
      writeStringEnv(envPath, "LLM_THINKING_BUDGET", thinkingBudgetRaw || "");
      writeStringEnv(envPath, "OPENAI_BASE_URL", openaiBaseUrl);
      writeStringEnv(envPath, "OPENAI_API_KEY", openaiApiKey);
      writeStringEnv(envPath, "OPENAI_MODEL", openaiModel);
      writeStringEnv(envPath, "OPENAI_PLANNING_MODEL", openaiPlanningModel);
      writeStringEnv(envPath, "OPENAI_CHAT_OPTIONS", openaiChatOptionsRaw || "");
      writeStringEnv(envPath, "OPENAI_PLANNING_CHAT_OPTIONS", openaiPlanningChatOptionsRaw || "");
      setEnvValue(envPath, "OPENAI_FALLBACK_TO_CHATGPT_BRIDGE", (openaiFallbackToChatgptBridge ?? true) ? "true" : "false");
      setEnvValue(envPath, "OPENAI_FORCE_BRIDGE", (openaiForceBridge ?? false) ? "true" : "false");
      writeStringEnv(envPath, "OPENAI_QUOTA_RESET_DAY", openaiQuotaResetDayRaw || "");
      writeStringEnv(envPath, "OPENAI_MONTHLY_TOKEN_LIMIT", openaiMonthlyTokenLimitRaw || "");
      writeStringEnv(envPath, "OPENAI_MONTHLY_BUDGET_USD", openaiMonthlyBudgetUsdRaw || "");
      writeStringEnv(envPath, "OPENAI_COST_INPUT_PER_1M", openaiCostInputPer1MRaw || "");
      writeStringEnv(envPath, "OPENAI_COST_OUTPUT_PER_1M", openaiCostOutputPer1MRaw || "");
      writeStringEnv(envPath, "GEMINI_API_KEY", normalizeOptionalString(body.geminiApiKey));
      writeStringEnv(envPath, "SERPAPI_KEY", normalizeOptionalString(body.serpApiKey));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message ?? "failed to save model config" });
      return;
    }

    const restart = parseOptionalBoolean(body.restart) ?? false;
    const payload = {
      ok: true,
      model,
      planningModel: planningModel || model,
      planningTimeoutMs: planningTimeoutRaw || "",
      thinkingBudgetEnabled: effectiveThinkingBudgetEnabled,
      thinkingBudgetDefault: thinkingBudgetRaw || "",
      thinkingBudget: thinkingBudgetRaw || ""
    };

    if (!restart) {
      res.json({
        ...payload,
        restarted: false
      });
      return;
    }

    try {
      const output = await restartPm2();
      res.json({
        ...payload,
        restarted: true,
        output
      });
    } catch (error) {
      res.status(500).json({
        ...payload,
        ok: false,
        restarted: false,
        error: (error as Error).message ?? "pm2 restart failed"
      });
    }
  });

  app.post("/admin/api/config/codex", async (req: Request, res: ExResponse) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
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

    const reasoningEffortRaw = "codexReasoningEffort" in body ? body.codexReasoningEffort : body.reasoningEffort;
    const reasoningEffort = typeof reasoningEffortRaw === "string" ? reasoningEffortRaw : null;
    if (hasReasoningEffort && reasoningEffort === null) {
      res.status(400).json({ error: "reasoningEffort must be a string" });
      return;
    }

    let configAfterUpdate: { codexModel: string; codexReasoningEffort: string; envPath: string };
    try {
      configAfterUpdate = context.codexConfigService.updateConfig({
        ...(hasModel ? { model: model ?? "" } : {}),
        ...(hasReasoningEffort ? { reasoningEffort: reasoningEffort ?? "" } : {})
      });
    } catch (error) {
      const message = (error as Error).message ?? "failed to save codex config";
      res.status(message.includes("must be one of") ? 400 : 500).json({ error: message });
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
    const body = (req.body ?? {}) as Record<string, unknown>;
    const envPath = context.envStore.getPath();
    const updates: Array<{ envKey: string; value: string | null }> = [
      { envKey: "MEMORY_COMPACT_EVERY_ROUNDS", value: normalizeOptionalIntegerString(body.memoryCompactEveryRounds) },
      { envKey: "MEMORY_COMPACT_MAX_BATCH_SIZE", value: normalizeOptionalIntegerString(body.memoryCompactMaxBatchSize) },
      { envKey: "MEMORY_SUMMARY_TOP_K", value: normalizeOptionalIntegerString(body.memorySummaryTopK) },
      { envKey: "MEMORY_RAW_REF_LIMIT", value: normalizeOptionalIntegerString(body.memoryRawRefLimit) },
      { envKey: "MEMORY_RAW_RECORD_LIMIT", value: normalizeOptionalIntegerString(body.memoryRawRecordLimit) }
    ];

    const invalid = updates.find((item) => item.value === null);
    if (invalid) {
      res.status(400).json({ error: `${invalid.envKey} must be a positive integer or empty` });
      return;
    }

    const llmMemoryContextEnabled = parseOptionalBoolean(body.llmMemoryContextEnabled);
    if (body.llmMemoryContextEnabled !== undefined && llmMemoryContextEnabled === undefined) {
      res.status(400).json({ error: "llmMemoryContextEnabled must be boolean" });
      return;
    }

    try {
      for (const update of updates) {
        writeStringEnv(envPath, update.envKey, update.value || "");
      }
      if (llmMemoryContextEnabled !== undefined) {
        setEnvValue(envPath, "LLM_MEMORY_CONTEXT_ENABLED", llmMemoryContextEnabled ? "true" : "false");
      }
    } catch (error) {
      res.status(500).json({ error: (error as Error).message ?? "failed to save memory config" });
      return;
    }

    res.json({
      ok: true,
      llmMemoryContextEnabled: parseOptionalBoolean(getEnvValue(envPath, "LLM_MEMORY_CONTEXT_ENABLED")) ?? true,
      memoryCompactEveryRounds: getEnvValue(envPath, "MEMORY_COMPACT_EVERY_ROUNDS"),
      memoryCompactMaxBatchSize: getEnvValue(envPath, "MEMORY_COMPACT_MAX_BATCH_SIZE"),
      memorySummaryTopK: getEnvValue(envPath, "MEMORY_SUMMARY_TOP_K"),
      memoryRawRefLimit: getEnvValue(envPath, "MEMORY_RAW_REF_LIMIT"),
      memoryRawRecordLimit: getEnvValue(envPath, "MEMORY_RAW_RECORD_LIMIT")
    });
  });

  app.post("/admin/api/config/runtime", async (req: Request, res: ExResponse) => {
    const body = (req.body ?? {}) as Record<string, unknown>;

    if (body.storageDriver !== undefined && typeof body.storageDriver !== "string") {
      res.status(400).json({ error: "storageDriver must be string" });
      return;
    }
    if (body.storageSqlitePath !== undefined && typeof body.storageSqlitePath !== "string") {
      res.status(400).json({ error: "storageSqlitePath must be string" });
      return;
    }
    if (body.mainConversationMode !== undefined && typeof body.mainConversationMode !== "string") {
      res.status(400).json({ error: "mainConversationMode must be string" });
      return;
    }

    const envPath = context.envStore.getPath();
    const storageDriver = normalizeOptionalString(body.storageDriver).toLowerCase();
    const storageSqlitePath = normalizeOptionalString(body.storageSqlitePath);
    const mainConversationMode = normalizeOptionalString(body.mainConversationMode);
    const conversationWindowTimeoutSeconds = normalizeOptionalIntegerString(body.conversationWindowTimeoutSeconds);
    const conversationWindowMaxTurns = normalizeOptionalIntegerString(body.conversationWindowMaxTurns);
    const conversationAgentMaxSteps = normalizeOptionalIntegerString(body.conversationAgentMaxSteps);
    const celestiaBaseUrl = normalizeOptionalString(body.celestiaBaseUrl);
    const celestiaToken = normalizeOptionalString(body.celestiaToken);
    const celestiaDeviceRefreshMs = normalizeOptionalIntegerString(body.celestiaDeviceRefreshMs);
    const selectedSkillNames = body.selectedSkillNames === undefined
      ? undefined
      : normalizeOptionalStringArray(body.selectedSkillNames);
    const selectedToolNames = body.selectedToolNames === undefined
      ? undefined
      : normalizeOptionalStringArray(body.selectedToolNames);

    if (storageDriver && !["json-file", "sqlite"].includes(storageDriver)) {
      res.status(400).json({ error: "STORAGE_DRIVER must be json-file or sqlite" });
      return;
    }
    if (mainConversationMode && !["classic", "windowed-agent"].includes(mainConversationMode)) {
      res.status(400).json({ error: "MAIN_CONVERSATION_MODE must be classic or windowed-agent" });
      return;
    }
    if (conversationWindowTimeoutSeconds === null) {
      res.status(400).json({ error: "CONVERSATION_WINDOW_TIMEOUT_SECONDS must be positive integer or empty" });
      return;
    }
    if (conversationWindowMaxTurns === null) {
      res.status(400).json({ error: "CONVERSATION_WINDOW_MAX_TURNS must be positive integer or empty" });
      return;
    }
    if (conversationAgentMaxSteps === null) {
      res.status(400).json({ error: "CONVERSATION_AGENT_MAX_STEPS must be positive integer or empty" });
      return;
    }
    if (celestiaDeviceRefreshMs === null) {
      res.status(400).json({ error: "CELESTIA_DEVICE_REFRESH_MS must be positive integer or empty" });
      return;
    }
    if (body.selectedSkillNames !== undefined && selectedSkillNames === null) {
      res.status(400).json({ error: "selectedSkillNames must be string[]" });
      return;
    }
    if (body.selectedToolNames !== undefined && selectedToolNames === null) {
      res.status(400).json({ error: "selectedToolNames must be string[]" });
      return;
    }

    try {
      writeStringEnv(envPath, "STORAGE_DRIVER", storageDriver);
      writeStringEnv(envPath, "STORAGE_SQLITE_PATH", storageSqlitePath);
      if (mainConversationMode) {
        setEnvValue(envPath, "MAIN_CONVERSATION_MODE", normalizeMainConversationMode(mainConversationMode));
      } else if (body.mainConversationMode !== undefined) {
        unsetEnvValue(envPath, "MAIN_CONVERSATION_MODE");
      }
      writeOptionalEnvValue(
        envPath,
        "CONVERSATION_WINDOW_TIMEOUT_SECONDS",
        conversationWindowTimeoutSeconds,
        body.conversationWindowTimeoutSeconds,
        setEnvValue,
        unsetEnvValue
      );
      writeOptionalEnvValue(
        envPath,
        "CONVERSATION_WINDOW_MAX_TURNS",
        conversationWindowMaxTurns,
        body.conversationWindowMaxTurns,
        setEnvValue,
        unsetEnvValue
      );
      writeOptionalEnvValue(
        envPath,
        "CONVERSATION_AGENT_MAX_STEPS",
        conversationAgentMaxSteps,
        body.conversationAgentMaxSteps,
        setEnvValue,
        unsetEnvValue
      );
      writeStringEnv(envPath, "CELESTIA_BASE_URL", celestiaBaseUrl);
      writeStringEnv(envPath, "CELESTIA_TOKEN", celestiaToken);
      writeOptionalEnvValue(
        envPath,
        "CELESTIA_DEVICE_REFRESH_MS",
        celestiaDeviceRefreshMs,
        body.celestiaDeviceRefreshMs,
        setEnvValue,
        unsetEnvValue
      );
      if (selectedSkillNames !== undefined || selectedToolNames !== undefined) {
        const availableNames = getAvailableConversationContextNames(context);
        const current = context.conversationContextService.getSnapshot().config;
        context.conversationContextService.saveConfig({
          ...current,
          ...(selectedSkillNames !== undefined ? { selectedSkillNames } : {}),
          ...(selectedToolNames !== undefined ? { selectedToolNames } : {})
        }, {
          availableSkillNames: availableNames.skillNames,
          availableToolNames: availableNames.toolNames
        });
      }
    } catch (error) {
      res.status(500).json({ error: (error as Error).message ?? "failed to save runtime config" });
      return;
    }

    res.json({
      ok: true,
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
      conversationContext: buildConversationContextAdminSnapshot(context)
    });
  });

  app.post("/admin/api/conversation/benchmark", async (req: Request, res: ExResponse) => {
    if (!context.conversationBenchmarkService) {
      res.status(501).json({ error: "conversation benchmark is not enabled" });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const turns = Array.isArray(body.turns)
      ? body.turns.map((item) => normalizeOptionalString(item)).filter(Boolean)
      : [];
    if (turns.length === 0) {
      res.status(400).json({ error: "turns must be a non-empty string array" });
      return;
    }

    const repeatCountRaw = normalizeOptionalIntegerString(body.repeatCount);
    if (repeatCountRaw === null) {
      res.status(400).json({ error: "repeatCount must be positive integer" });
      return;
    }
    const repeatCount = Math.max(1, Math.min(10, Number(repeatCountRaw || "1")));
    const modes = Array.isArray(body.modes)
      ? body.modes
          .map((item) => normalizeMainConversationMode(item))
          .filter((item, index, list) => list.indexOf(item) === index)
      : (["classic", "windowed-agent"] as MainConversationMode[]);

    try {
      const payload = await context.conversationBenchmarkService.run({
        turns,
        repeatCount,
        modes
      } satisfies ConversationBenchmarkRequest);
      res.json(payload);
    } catch (error) {
      console.error("[admin] conversation benchmark failed", error);
      res.status(500).json({ error: (error as Error).message ?? "conversation benchmark failed" });
    }
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
      res.status(500).json({ ok: false, error: (error as Error).message ?? "pm2 restart failed" });
    }
  });

  app.post("/admin/api/repo/pull", async (_req: Request, res: ExResponse) => {
    try {
      res.json({ ok: true, ...await pullRepoWithRebase() });
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message ?? "repo pull failed" });
    }
  });

  app.post("/admin/api/repo/build", async (_req: Request, res: ExResponse) => {
    try {
      res.json({ ok: true, ...await buildProject() });
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message ?? "repo build failed" });
    }
  });

  app.post("/admin/api/repo/deploy", async (_req: Request, res: ExResponse) => {
    try {
      res.json({ ok: true, ...await pullBuildAndRestart() });
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message ?? "repo deploy failed" });
    }
  });
}

function writeStringEnv(envPath: string, key: string, value: string): void {
  if (value) {
    setEnvValue(envPath, key, value);
  } else {
    unsetEnvValue(envPath, key);
  }
}
