import { Envelope, Image, Response, ToolExecution } from "../types";
import { policyCheck } from "../policy";
import { ToolRouter } from "../tools/toolRouter";
import { writeAudit } from "../auditLogger";
import { LLMEngine, LLMExecutionStep, LLMPlanMeta, LLMRuntimeContext } from "../engines/llm/llm";
import { MemoryStore } from "../memory/memoryStore";
import { SkillManager } from "../skills/skillManager";
import { DirectShortcutMatch, DirectToolCallMatch, ToolRegistry, ToolSchemaItem } from "../tools/toolRegistry";
import { CallbackDispatcher } from "../integrations/wecom/callbackDispatcher";
import { sttRuntime } from "../engines/stt";
import { isReAgentCommandInput, parseReAgentCommand } from "./re-agent";
import { RawMemoryMeta, RawMemoryStore } from "../memory/rawMemoryStore";
import { MemoryCompactor } from "../memory/memoryCompactor";
import { HybridMemoryService } from "../memory/hybridMemoryService";

export type OrchestratorLLMResolver = (step: LLMExecutionStep) => LLMEngine;

export class Orchestrator {
  private readonly processed = new Map<string, Response>();
  private readonly toolRouter: ToolRouter;
  private readonly defaultLLMEngine: LLMEngine;
  private readonly llmEngineResolver?: OrchestratorLLMResolver;
  private readonly memoryStore: MemoryStore;
  private readonly rawMemoryStore: RawMemoryStore;
  private readonly memoryCompactor: MemoryCompactor;
  private readonly hybridMemoryService: HybridMemoryService;
  private readonly skillManager: SkillManager;
  private readonly maxIterations: number;
  private readonly toolRegistry: ToolRegistry;
  private readonly callbackDispatcher: CallbackDispatcher;
  private readonly asyncDirectQueues = new Map<string, Promise<void>>();

  constructor(
    toolRouter: ToolRouter,
    llmEngine: LLMEngine,
    memoryStore: MemoryStore,
    skillManager: SkillManager,
    toolRegistry: ToolRegistry,
    callbackDispatcher: CallbackDispatcher,
    rawMemoryStore: RawMemoryStore = new RawMemoryStore(),
    memoryCompactor?: MemoryCompactor,
    hybridMemoryService?: HybridMemoryService,
    llmEngineResolver?: OrchestratorLLMResolver
  ) {
    this.toolRouter = toolRouter;
    this.defaultLLMEngine = llmEngine;
    this.llmEngineResolver = llmEngineResolver;
    this.memoryStore = memoryStore;
    this.rawMemoryStore = rawMemoryStore;
    this.memoryCompactor = memoryCompactor ?? new MemoryCompactor({ rawStore: rawMemoryStore });
    this.hybridMemoryService = hybridMemoryService ?? new HybridMemoryService({ rawStore: rawMemoryStore });
    this.skillManager = skillManager;
    this.maxIterations = Number(process.env.LLM_MAX_ITERATIONS ?? "5");
    this.toolRegistry = toolRegistry;
    this.callbackDispatcher = callbackDispatcher;
  }

  private resolveLLMEngine(step: LLMExecutionStep): LLMEngine {
    if (!this.llmEngineResolver) {
      return this.defaultLLMEngine;
    }
    try {
      return this.llmEngineResolver(step);
    } catch (error) {
      console.error(`[Orchestrator] resolveLLMEngine failed for step=${step}, fallback to default`, error);
      return this.defaultLLMEngine;
    }
  }

  async handle(envelope: Envelope): Promise<Response> {
    const start = Date.now();

    const cached = this.processed.get(envelope.requestId);
    if (cached) {
      return cached;
    }

    const text = await sttRuntime.transcribe(envelope);
    let memoryLoaded = false;
    let memoryCache = "";
    const readSessionMemory = (): string => {
      if (!memoryLoaded) {
        memoryCache = this.readSessionMemory(envelope.sessionId);
        memoryLoaded = true;
      }
      return memoryCache;
    };

    try {
      const directRouteResponse = await this.handleDirectCommandRoute(text, envelope, start, readSessionMemory);
      if (directRouteResponse) {
        return directRouteResponse;
      }

      // Step 1: Routing - Decide direct response / planning / tool-oriented skill path
      const routingResult = await this.routingStep(text, envelope, start, readSessionMemory);
      if (routingResult.response) {
        this.processed.set(envelope.requestId, routingResult.response);
        this.appendMemory(envelope, text, routingResult.response);
        return routingResult.response;
      }

      // Step 2: Planning - Local thinking + direct response or tool call plan
      const planningResult = await this.planningStep(
        routingResult.skillName,
        routingResult.planningThinkingBudget,
        text,
        routingResult.memory,
        envelope,
        start
      );
      if (planningResult.response) {
        this.processed.set(envelope.requestId, planningResult.response);
        this.appendMemory(envelope, text, planningResult.response);
        return planningResult.response;
      }

      // Step 3: Tool Call - Execute the planned tool action
      if (!planningResult.toolExecution) {
        const response = { text: "I don't understand. Please try rephrasing." };
        this.processed.set(envelope.requestId, response);
        this.appendMemory(envelope, text, response);
        return response;
      }
      const toolResult = await this.toolCallStep(planningResult.toolExecution, text, routingResult.memory, envelope, start);

      // Step 4: Respond - Generate final response based on tool result and prepared templates
      const response = await this.respondStep(
        toolResult.result,
        planningResult.successResponse || "Task completed successfully",
        planningResult.failureResponse || "Tool execution failed",
        planningResult.preferToolResult ?? false,
        text,
        envelope,
        start
      );

      return response;
    } catch (error) {
      console.error("Error in handle method:", error);
      return { text: "Processing failed due to an error" };
    }
  }

  // New step-based processing methods
  private async handleDirectCommandRoute(
    text: string,
    envelope: Envelope,
    start: number,
    readSessionMemory: () => string
  ): Promise<Response | null> {
    const shortcutMatched = this.toolRegistry.matchDirectShortcut(text);
    if (shortcutMatched) {
      if (shortcutMatched.async) {
        const taskId = createAsyncTaskId(shortcutMatched.command);
        const taskEnvelope = createAsyncTaskEnvelope(envelope, taskId);
        const executionPromise = this.enqueueAsyncDirectTask(envelope.sessionId, () =>
          this.executeAsyncDirectShortcut(shortcutMatched, text, envelope, taskEnvelope, Date.now())
        );

        try {
          const settled = await waitForPromiseWithTimeout(executionPromise, shortcutMatched.acceptedDelayMs);
          if (settled.completed) {
            this.processed.set(envelope.requestId, settled.value.response);
            return settled.value.response;
          }
        } catch (error) {
          const fallback: Response = {
            text: `异步任务失败: ${(error as Error).message ?? "unknown error"}`
          };
          this.processed.set(envelope.requestId, fallback);
          this.appendMemory(envelope, text, fallback);
          return fallback;
        }

        void executionPromise
          .then(async ({ taskEnvelope: doneEnvelope, response }) => {
            await this.callbackDispatcher.send(doneEnvelope, response);
          })
          .catch(async (error) => {
            const fallback: Response = {
              text: `异步任务失败: ${(error as Error).message ?? "unknown error"}`
            };
            this.processed.set(taskEnvelope.requestId, fallback);
            this.appendMemory(taskEnvelope, text, fallback);
            await this.callbackDispatcher.send(taskEnvelope, fallback);
          });

        const acceptedResponse: Response = {
          text: shortcutMatched.acceptedText || "任务已受理，正在处理中，稍后回调结果。",
          data: {
            asyncTask: {
              id: taskId,
              status: "accepted"
            }
          }
        };
        this.processed.set(envelope.requestId, acceptedResponse);
        this.appendMemory(envelope, text, acceptedResponse);
        return acceptedResponse;
      }

      return this.executeDirectShortcut(shortcutMatched, text, readSessionMemory(), envelope, start);
    }

    const matched = this.toolRegistry.matchDirectToolCall(text);
    if (!matched) {
      return null;
    }

    if (matched.async) {
      const taskId = createAsyncTaskId(matched.command);
      const taskEnvelope = createAsyncTaskEnvelope(envelope, taskId);
      const executionPromise = this.enqueueAsyncDirectTask(envelope.sessionId, () =>
        this.executeAsyncDirectToolCall(matched, text, envelope, taskEnvelope, Date.now())
      );

      try {
        const settled = await waitForPromiseWithTimeout(executionPromise, matched.acceptedDelayMs);
        if (settled.completed) {
          this.processed.set(envelope.requestId, settled.value.response);
          return settled.value.response;
        }
      } catch (error) {
        const fallback: Response = {
          text: `异步任务失败: ${(error as Error).message ?? "unknown error"}`
        };
        this.processed.set(envelope.requestId, fallback);
        this.appendMemory(envelope, text, fallback);
        return fallback;
      }

      void executionPromise
        .then(async ({ taskEnvelope: doneEnvelope, response }) => {
          await this.callbackDispatcher.send(doneEnvelope, response);
        })
        .catch(async (error) => {
          const fallback: Response = {
            text: `异步任务失败: ${(error as Error).message ?? "unknown error"}`
          };
          this.processed.set(taskEnvelope.requestId, fallback);
          this.appendMemory(taskEnvelope, text, fallback);
          await this.callbackDispatcher.send(taskEnvelope, fallback);
        });

      const acceptedText = matched.acceptedText || "任务已受理，正在处理中，稍后回调结果。";
      const acceptedResponse: Response = {
        text: acceptedText,
        data: {
          asyncTask: {
            id: taskId,
            status: "accepted"
          }
        }
      };
      this.processed.set(envelope.requestId, acceptedResponse);
      this.appendMemory(envelope, text, acceptedResponse);
      return acceptedResponse;
    }

    const toolExecution: ToolExecution = {
      tool: matched.tool,
      op: matched.op,
      args: matched.args
    };
    const toolResult = await this.toolCallStep(toolExecution, text, readSessionMemory(), envelope, start);
    const response = await this.respondStep(
      toolResult.result,
      "",
      "",
      matched.preferToolResult,
      text,
      envelope,
      start
    );
    return response;
  }

  private enqueueAsyncDirectTask<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
    const prior = this.asyncDirectQueues.get(sessionId) ?? Promise.resolve();
    const running = prior
      .catch(() => undefined)
      .then(() => runDeferred(task));
    const next = running
      .then(() => undefined)
      .catch((error) => {
        console.error("async direct task failed:", error);
      });
    this.asyncDirectQueues.set(sessionId, next);
    void next.finally(() => {
      if (this.asyncDirectQueues.get(sessionId) === next) {
        this.asyncDirectQueues.delete(sessionId);
      }
    });
    return running;
  }

  private async executeAsyncDirectToolCall(
    matched: DirectToolCallMatch,
    text: string,
    envelope: Envelope,
    taskEnvelope: Envelope,
    start: number
  ): Promise<{ taskEnvelope: Envelope; response: Response }> {
    const latestMemory = this.readSessionMemory(envelope.sessionId);
    const toolExecution: ToolExecution = {
      tool: matched.tool,
      op: matched.op,
      args: matched.args
    };
    const toolResult = await this.toolCallStep(toolExecution, text, latestMemory, taskEnvelope, start);
    const response = await this.respondStep(
      toolResult.result,
      "",
      "",
      matched.preferToolResult,
      text,
      taskEnvelope,
      start
    );
    return { taskEnvelope, response };
  }

  private async executeDirectShortcut(
    matched: DirectShortcutMatch,
    text: string,
    memory: string,
    envelope: Envelope,
    start: number
  ): Promise<Response> {
    const result = await matched.execute({
      command: matched.command,
      input: text,
      rest: matched.rest,
      sessionId: envelope.sessionId,
      memory
    });
    return this.respondStep(
      result,
      "",
      "",
      matched.preferToolResult,
      text,
      envelope,
      start
    );
  }

  private async executeAsyncDirectShortcut(
    matched: DirectShortcutMatch,
    text: string,
    envelope: Envelope,
    taskEnvelope: Envelope,
    start: number
  ): Promise<{ taskEnvelope: Envelope; response: Response }> {
    const latestMemory = this.readSessionMemory(envelope.sessionId);
    const response = await this.executeDirectShortcut(
      matched,
      text,
      latestMemory,
      taskEnvelope,
      start
    );
    return { taskEnvelope, response };
  }

  private async routingStep(
    text: string,
    envelope: Envelope,
    start: number,
    readSessionMemory: () => string
  ): Promise<{ response?: Response; skillName?: string; planningThinkingBudget?: number; memory: string }> {
    const llmEngine = this.resolveLLMEngine("routing");
    const extraSkills = buildExtraSkillsContext(this.toolRegistry);
    const skillsContext = buildSkillsContext(this.skillManager, undefined, extraSkills);

    const runtimeContext: LLMRuntimeContext = {
      isoTime: new Date().toISOString(),
      userTimezone: "Asia/Shanghai",
      // small model may confuse with memory, so we pass an empty string
      // memory,
      skills_context: skillsContext,
      // tools_context: buildToolsSchemaContext(this.toolRegistry),
    };

    const result = await llmEngine.route(text, runtimeContext);
    const memoryDecision = resolveMemoryDecision(result, text);
    const memoryContextEnabled = isLlmMemoryContextEnabled();
    const memory = memoryContextEnabled && memoryDecision.enabled
      ? this.loadMemoryForNextStep(envelope.sessionId, memoryDecision.query, readSessionMemory)
      : "";

    // Write audit log
    const llmMeta: LLMPlanMeta = {
      llm_provider: llmEngine.getProviderName(),
      model: llmEngine.getModelForStep("routing"),
      retries: 0,
      parse_ok: true,
      raw_output_length: 0,
      fallback: false
    };
    this.writeLlmAudit(envelope, llmMeta, "routing", start);

    if (result.decision === "respond") {
      const response = { text: result.response_text || "OK" };
      this.appendMemory(envelope, text, response);
      return { response, memory };
    }

    if (result.decision === "use_skill" && result.skill_name) {
      return {
        skillName: result.skill_name,
        planningThinkingBudget: result.planning_thinking_budget,
        memory
      };
    }

    if (result.decision === "use_planning") {
      return {
        planningThinkingBudget: result.planning_thinking_budget,
        memory
      };
    }

    const response = { text: "I don't understand. Please try rephrasing." };
    this.appendMemory(envelope, text, response);
    return { response, memory };
  }

  private async planningStep(
    skillName: string | undefined,
    planningThinkingBudget: number | undefined,
    text: string,
    memory: string,
    envelope: Envelope,
    start: number
  ): Promise<{
    response?: Response;
    toolExecution?: ToolExecution;
    successResponse?: string;
    failureResponse?: string;
    preferToolResult?: boolean;
  }> {
    const llmEngine = this.resolveLLMEngine("planning");
    const selectedSkill = skillName ? this.skillManager.get(skillName) : undefined;
    const toolName = selectedSkill?.tool;

    // const actionHistory: Array<{ iteration: number; action: { type: string; params: Record<string, unknown> } }> = [];
    const extraSkills = buildExtraSkillsContext(this.toolRegistry);
    const detail = skillName
      ? getSkillDetail(skillName, this.skillManager, extraSkills, this.toolRegistry)
      : "";
    const forceTools: string[] = [];

    if (skillName === "homeassistant") {
      forceTools.push("homeassistant");
    }
    if (skillName && selectedSkill?.terminal) {
      forceTools.push("terminal");
    }
    if (toolName) {
      forceTools.push(toolName);
    }

    const fullToolContext = this.toolRegistry.buildRuntimeContext();
    const toolContext = skillName
      ? filterToolContextForSkill(detail, fullToolContext, forceTools)
      : null;

    const runtimeContext: Record<string, unknown> = {
      isoTime: new Date().toISOString(),
      userTimezone: "Asia/Shanghai",
      ...(memory ? { memory } : {}),
      // action_history: actionHistory,
      // skills_context: skillContext,
      tools_context: toolContext,
      skill_detail: detail,
      planning_mode: skillName ? "skill_tool_planning" : "local_thinking",
      skill_contract: selectedSkill?.tool
        ? {
            tool: selectedSkill.tool,
            action: selectedSkill.action ?? "execute",
            params: selectedSkill.params ?? ["input"]
          }
        : null
    };

    const plan = await llmEngine.plan(
      text,
      runtimeContext,
      planningThinkingBudget === undefined
        ? undefined
        : { thinkingBudgetOverride: planningThinkingBudget }
    );

    // Write audit log
    const llmMeta: LLMPlanMeta = {
      llm_provider: llmEngine.getProviderName(),
      model: llmEngine.getModelForStep("planning"),
      retries: 0,
      parse_ok: true,
      raw_output_length: 0,
      fallback: false
    };
    this.writeLlmAudit(envelope, llmMeta, "planning", start);

    if (plan.decision === "respond") {
      return {
        response: { text: plan.response_text || "OK" }
      };
    }

    return {
      toolExecution: {
        tool: plan.tool,
        op: plan.op,
        args: plan.args
      },
      successResponse: plan.success_response,
      failureResponse: plan.failure_response,
      preferToolResult: selectedSkill?.preferToolResult ?? false
    };
  }

  private async toolCallStep(
    toolExecution: ToolExecution,
    _text: string,
    memory: string,
    envelope: Envelope,
    _start: number
  ): Promise<{ result: { ok: boolean; output?: unknown; error?: string } }> {
    // Policy check logic
    const policy = await policyCheck({
      type: "tool_call",
      params: toolExecution
    });

    if (!policy.allowed) {
      return { result: { ok: false, error: "Policy rejected" } };
    }

    console.log("tool execution", toolExecution);

    const { result } = await this.toolRouter.route(
      toolExecution.tool,
      {
        op: toolExecution.op,
        args: toolExecution.args
      },
      {
        memory,
        sessionId: envelope.sessionId
      }
    );

    console.log("tool result", result);

    return { result };
  }

  private async respondStep(
    toolResult: { ok: boolean; output?: unknown; error?: string },
    successResponse: string,
    failureResponse: string,
    preferToolResult: boolean,
    text: string,
    envelope: Envelope,
    _start: number
  ): Promise<Response> {
    let response: Response;

    if (preferToolResult) {
      response = buildToolResultResponse(toolResult);
      if (toolResult.ok && isGenericResponseText(response.text) && successResponse) {
        response = { text: successResponse };
      } else if (!toolResult.ok && isGenericResponseText(response.text) && failureResponse) {
        response = { text: failureResponse };
      }
    } else {
      if (toolResult.ok) {
        if (successResponse) {
          response = { text: successResponse };
        } else {
          // Fallback to building response from tool result
          response = buildToolResultResponse(toolResult);
        }
      } else {
        if (failureResponse) {
          response = { text: failureResponse };
        } else {
          response = { text: toolResult.error ? `Tool error: ${toolResult.error}` : "Tool failed" };
        }
      }
    }

    // Handle image if present
    const output = toolResult.output as { image?: Image; images?: Image[] } | undefined;
    const images = normalizeImages(output?.images);
    if (output?.image) {
      images.unshift(output.image);
    }
    if (images.length > 0) {
      response.data = {
        ...(response.data as Record<string, unknown> | undefined),
        image: images[0],
        ...(images.length > 1 ? { images } : {})
      };
    }

    // Cache and log
    this.processed.set(envelope.requestId, response);
    this.appendMemory(envelope, text, response);

    return response;
  }

  private writeLlmAudit(envelope: Envelope, llmMeta: LLMPlanMeta, actionType: string, start: number): void {
    const latencyMs = Date.now() - start;
    const ingressMessageId = (envelope.meta as Record<string, unknown> | undefined)?.ingress_message_id;
    writeAudit({
      requestId: envelope.requestId,
      sessionId: envelope.sessionId,
      source: envelope.source,
      ingress_message_id: typeof ingressMessageId === "string" ? ingressMessageId : undefined,
      actionType: actionType as any,
      latencyMs,
      tool: "llm",
      llm_provider: llmMeta.llm_provider,
      model: llmMeta.model,
      retries: llmMeta.retries,
      parse_ok: llmMeta.parse_ok,
      raw_output_length: llmMeta.raw_output_length,
      fallback: llmMeta.fallback
    });
  }

  private loadMemoryForNextStep(
    sessionId: string,
    query: string,
    readSessionMemory: () => string
  ): string {
    if (!sessionId) {
      return "";
    }
    try {
      const hybrid = this.hybridMemoryService.build(sessionId, query);
      if (hybrid?.memory) {
        return hybrid.memory;
      }
    } catch (error) {
      console.error("hybrid memory load failed:", error);
    }
    return readSessionMemory();
  }

  private appendMemory(envelope: Envelope, text: string, response: Response): void {
    const memoryText = text || inferNonTextMemoryMarker(envelope.kind);
    if (isReAgentResetInput(memoryText)) {
      return;
    }
    const entry = formatMemoryEntry(memoryText, response);
    this.memoryStore.append(envelope.sessionId, entry);
    const rawMeta = normalizeRawMemoryMeta(envelope.meta);
    this.rawMemoryStore.append({
      sessionId: envelope.sessionId,
      requestId: envelope.requestId,
      source: envelope.source,
      user: memoryText,
      assistant: response.text ?? "",
      meta: rawMeta,
      createdAt: envelope.receivedAt
    });
    void this.memoryCompactor.maybeCompact({
      sessionId: envelope.sessionId,
      requestId: envelope.requestId,
      source: envelope.source,
      meta: rawMeta
    }).catch((error) => {
      console.error("memory compaction failed:", error);
    });
  }

  private readSessionMemory(sessionId: string): string {
    return this.memoryStore.read(sessionId);
  }
}

function inferNonTextMemoryMarker(kind: string): string {
  if (kind === "image") {
    return "[image]";
  }
  if (kind === "audio" || kind === "voice") {
    return "[audio]";
  }
  return "";
}

function formatMemoryEntry(userText: string, response: Response): string {
  const now = new Date().toISOString();
  const assistantText = response.text ?? "";
  return `- ${now}\\n  - user: ${userText}\\n  - assistant: ${assistantText}`;
}

function normalizeRawMemoryMeta(meta: unknown): RawMemoryMeta {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return {};
  }
  return { ...(meta as Record<string, unknown>) };
}

function isReAgentResetInput(userText: string): boolean {
  if (!isReAgentCommandInput(userText)) {
    return false;
  }
  return parseReAgentCommand(userText).kind === "reset";
}

function resolveMemoryDecision(
  result: { decision: "respond" | "use_skill" | "use_planning"; memory_mode?: "on" | "off"; memory_query?: string },
  text: string
): { enabled: boolean; query: string } {
  if (result.decision === "respond") {
    return { enabled: false, query: text };
  }
  const defaultEnabled = true;
  const enabled = result.memory_mode === "on"
    ? true
    : result.memory_mode === "off"
      ? false
      : defaultEnabled;
  const query = typeof result.memory_query === "string" && result.memory_query.trim().length > 0
    ? result.memory_query.trim()
    : text;
  return { enabled, query };
}

function isLlmMemoryContextEnabled(): boolean {
  const raw = process.env.LLM_MEMORY_CONTEXT_ENABLED;
  if (raw === undefined || raw === null) {
    return true;
  }

  const normalized = String(raw).trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }
  return true;
}

function sanitizeToolResult(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  if (Array.isArray(input)) {
    return input.map((item) => sanitizeToolResult(item));
  }
  const obj = input as Record<string, unknown>;
  if (typeof obj.data === "string" && (typeof obj.contentType === "string" || typeof obj.filename === "string")) {
    return {
      ...(typeof obj.contentType === "string" ? { contentType: obj.contentType } : {}),
      ...(typeof obj.filename === "string" ? { filename: obj.filename } : {}),
      size: obj.data.length
    };
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === "image" && value && typeof value === "object") {
      const image = value as Record<string, unknown>;
      out[key] = {
        ...(typeof image.contentType === "string" ? { contentType: image.contentType } : {}),
        ...(typeof image.filename === "string" ? { filename: image.filename } : {}),
        ...(typeof image.size === "number" ? { size: image.size } : {})
      };
      continue;
    }
    if (key === "images" && Array.isArray(value)) {
      out[key] = value.map((item) => sanitizeToolResult(item));
      continue;
    }
    out[key] = sanitizeToolResult(value);
  }
  return out;
}

function buildToolResultResponse(result: { ok: boolean; output?: unknown; error?: string }): Response {
  if (!result.ok) {
    const errorText = result.error ? `Tool error: ${result.error}` : "Tool failed";
    return { text: errorText };
  }
  const output = result.output as Record<string, unknown> | string | undefined;
  if (typeof output === "string") {
    return { text: output.trim() || "OK" };
  }
  if (output && typeof output === "object") {
    const text = output.text;
    if (typeof text === "string" && text.trim().length > 0) {
      return { text: text.trim() };
    }
  }
  const sanitized = sanitizeToolResult(output);
  if (sanitized !== undefined) {
    return { text: JSON.stringify(sanitized, null, 2) };
  }
  return { text: "OK" };
}

function buildSkillsContext(
  skillManager: SkillManager,
  onlyNames?: string[],
  extraSkills: Record<string, { description?: string; command?: string; terminal?: boolean; tool?: string; action?: string; params?: string[]; keywords?: string[] }> = {}
): Record<string, { description?: string; command?: string; terminal?: boolean; tool?: string; action?: string; params?: string[]; keywords?: string[] }> | null {
  const skills = skillManager.list().filter((skill) => !onlyNames || onlyNames.includes(skill.name));
  const entries = skills.map((skill) => {
    const command = skill.metadata?.command ?? skill.command;
    const keywords = skill.metadata?.keywords ?? skill.keywords;
    return [
      skill.name,
      {
        description: skill.description,
        command,
        terminal: skill.terminal,
        ...(skill.tool ? { tool: skill.tool } : {}),
        ...(skill.action ? { action: skill.action } : {}),
        ...(skill.params && skill.params.length > 0 ? { params: skill.params } : {}),
        ...(keywords ? { keywords } : {})
      }
    ] as const;
  });
  const extraEntries = Object.entries(extraSkills).filter(([name]) => !onlyNames || onlyNames.includes(name));
  const merged = Object.fromEntries([...entries, ...extraEntries]);
  if (Object.keys(merged).length === 0) return null;
  return merged;
}

function buildExtraSkillsContext(
  toolRegistry: ToolRegistry
): Record<string, { description?: string; command?: string; terminal?: boolean; tool?: string; action?: string; params?: string[]; keywords?: string[] }> {
  const extra: Record<string, { description?: string; command?: string; terminal?: boolean; tool?: string; action?: string; params?: string[]; keywords?: string[] }> = {};
  const haSchema = toolRegistry.listSchema().find((tool) => tool.name === "homeassistant");
  if (haSchema) {
    extra.homeassistant = {
      description: "Control and query Home Assistant devices (services, state, snapshots).",
      command: "homeassistant",
      terminal: false,
      tool: "homeassistant",
      action: "call_service",
      ...(haSchema.keywords ? { keywords: haSchema.keywords } : {})
    };
  }
  return extra;
}

function getSkillDetail(
  name: string,
  skillManager: SkillManager,
  extraSkills: Record<string, { description?: string; command?: string; terminal?: boolean; tool?: string; action?: string; params?: string[]; keywords?: string[] }>,
  toolRegistry: ToolRegistry
): string {
  if (extraSkills[name] && name === "homeassistant") {
    const schema = toolRegistry.listSchema().find((tool) => tool.name === "homeassistant");
    return buildHomeAssistantSkillDetail(schema);
  }
  return skillManager.getDetail(name);
}

function buildHomeAssistantSkillDetail(schema?: ToolSchemaItem): string {
  const keywordsLine = schema?.keywords ? `    \"keywords\": ${JSON.stringify(schema.keywords)}` : "";
  const ops = (schema?.operations ?? []).map((op) => `- ${op.op}: params ${JSON.stringify(op.params)}`);
  const operations = ops.length > 0
    ? ["Operations", ...ops]
    : [
        "Operations",
        "- call_service: params { domain, service, entity_id, data? }",
        "- get_state: params { entity_id }",
        "- camera_snapshot: params { entity_id }"
      ];
  return [
    "---",
    "name: homeassistant",
    "description: Control and query Home Assistant devices (services, state, snapshots).",
    "terminal: false",
    "metadata:",
    "  {",
    "    \"tool\": \"homeassistant\"",
    ...(keywordsLine ? [keywordsLine] : []),
    "  }",
    "---",
    "",
    "# Home Assistant Tool",
    "",
    "Use the `homeassistant` tool via tool.call to control devices and query state.",
    "Refer to tools_context.homeassistant.entities for available entities.",
    "",
    ...operations
  ].join("\n");
}

function buildToolsSchemaContext(registry: ToolRegistry): Record<string, Record<string, unknown>> {
  return { _tools: { schema: registry.listSchema() } };
}

function filterToolContextForSkill(
  detail: string,
  toolContext: Record<string, Record<string, unknown>>,
  forceTools: string[] = []
): Record<string, Record<string, unknown>> | null {
  const lower = detail.toLowerCase();
  const forced = new Set(forceTools);
  const entries = Object.entries(toolContext).filter(([name]) => name !== "_tools");
  const matches = entries.filter(([name]) => lower.includes(name.toLowerCase()) || forced.has(name));
  const matchedNames = new Set<string>(matches.map(([name]) => name));
  for (const name of forced) matchedNames.add(name);

  const result: Record<string, Record<string, unknown>> = Object.fromEntries(matches);
  const toolsSchema = (toolContext as Record<string, Record<string, unknown>>)._tools as { schema?: Array<{ name: string }> } | undefined;
  const schemaList = Array.isArray(toolsSchema?.schema) ? toolsSchema?.schema : [];
  if (schemaList.length > 0) {
    const filteredSchema = schemaList.filter((item) => matchedNames.has(item.name));
    if (filteredSchema.length > 0) {
      result._tools = { schema: filteredSchema };
    }
  }

  if (Object.keys(result).length === 0) return null;
  return result;
}

function normalizeImages(images: Image[] | undefined): Image[] {
  if (!Array.isArray(images)) return [];
  return images.filter((image) => Boolean(image && typeof image.data === "string" && image.data.length > 0));
}

function isGenericResponseText(text: string | undefined): boolean {
  const normalized = String(text ?? "").trim().toLowerCase();
  return normalized.length === 0 || normalized === "ok" || normalized === "tool failed";
}

function createAsyncTaskId(command: string): string {
  const normalized = String(command ?? "").trim().replace(/[^a-z0-9]+/gi, "").toLowerCase() || "task";
  return `${normalized}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createAsyncTaskEnvelope(envelope: Envelope, taskId: string): Envelope {
  return {
    ...envelope,
    requestId: `${envelope.requestId}:async:${taskId}`
  };
}

async function waitForPromiseWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<{ completed: true; value: T } | { completed: false }> {
  if (timeoutMs <= 0) {
    return { completed: false };
  }

  let timer: NodeJS.Timeout | null = null;
  const timeout = new Promise<{ completed: false }>((resolve) => {
    timer = setTimeout(() => resolve({ completed: false }), timeoutMs);
  });

  const settled = await Promise.race([
    promise.then((value) => ({ completed: true as const, value })),
    timeout
  ]);

  if (timer) {
    clearTimeout(timer);
  }

  return settled;
}

function runDeferred<T>(task: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      void task().then(resolve).catch(reject);
    });
  });
}
