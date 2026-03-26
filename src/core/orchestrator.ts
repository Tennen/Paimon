import { Envelope, Image, Response, ToolExecution } from "../types";
import { policyCheck } from "../policy";
import { ToolRouter } from "../tools/toolRouter";
import { writeAudit } from "../auditLogger";
import { LLMEngine, LLMExecutionStep, LLMPlanMeta } from "../engines/llm/llm";
import { MemoryStore } from "../memory/memoryStore";
import { SkillManager } from "../skills/skillManager";
import { DirectShortcutMatch, DirectToolCallMatch, ToolRegistry } from "../tools/toolRegistry";
import { CallbackDispatcher } from "../integrations/wecom/callbackDispatcher";
import { readWeComClickEventContext } from "../integrations/wecom/eventEnvelope";
import { sttRuntime } from "../engines/stt";
import { isReAgentCommandInput, parseReAgentCommand } from "./re-agent";
import { RawMemoryMeta, RawMemoryStore } from "../memory/rawMemoryStore";
import { MemoryCompactor } from "../memory/memoryCompactor";
import { HybridMemoryService } from "../memory/hybridMemoryService";
import { ObservableMenuService } from "../observable/menuService";
import { DirectInputMappingService, ResolvedDirectInputMapping } from "../config/directInputMappingService";
import { ConversationRuntimeSupport } from "./conversation/shared";
import { ClassicConversationRuntime } from "./conversation/classic/runtime";
import { WindowedAgentConversationRuntime } from "./conversation/agent/runtime";
import { resolveMainConversationMode } from "./conversation/mode";
import { ConversationWindowService } from "../memory/conversationWindowService";

export type OrchestratorLLMResolver = (step: LLMExecutionStep) => LLMEngine;
type ObservableMenuEventResolver = Pick<ObservableMenuService, "handleWeComClickEvent" | "markEventDispatchFailed">;
type DirectInputResolver = Pick<DirectInputMappingService, "resolveInput">;

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
  private readonly toolRegistry: ToolRegistry;
  private readonly callbackDispatcher: CallbackDispatcher;
  private readonly asyncDirectQueues = new Map<string, Promise<void>>();
  private readonly observableMenuService?: ObservableMenuEventResolver;
  private readonly directInputResolver?: DirectInputResolver;
  private readonly conversationWindowService: ConversationWindowService;
  private readonly conversationSupport: ConversationRuntimeSupport;
  private readonly classicRuntime: ClassicConversationRuntime;
  private readonly windowedAgentRuntime: WindowedAgentConversationRuntime;

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
    llmEngineResolver?: OrchestratorLLMResolver,
    observableMenuService?: ObservableMenuEventResolver,
    directInputResolver?: DirectInputResolver,
    conversationWindowService?: ConversationWindowService
  ) {
    this.toolRouter = toolRouter;
    this.defaultLLMEngine = llmEngine;
    this.llmEngineResolver = llmEngineResolver;
    this.memoryStore = memoryStore;
    this.rawMemoryStore = rawMemoryStore;
    this.memoryCompactor = memoryCompactor ?? new MemoryCompactor({ rawStore: rawMemoryStore });
    this.hybridMemoryService = hybridMemoryService ?? new HybridMemoryService({ rawStore: rawMemoryStore });
    this.skillManager = skillManager;
    this.toolRegistry = toolRegistry;
    this.callbackDispatcher = callbackDispatcher;
    this.observableMenuService = observableMenuService;
    this.directInputResolver = directInputResolver;
    this.conversationWindowService = conversationWindowService ?? new ConversationWindowService();
    this.conversationSupport = new ConversationRuntimeSupport({
      toolRouter: this.toolRouter,
      defaultLLMEngine: this.defaultLLMEngine,
      skillManager: this.skillManager,
      toolRegistry: this.toolRegistry,
      hybridMemoryService: this.hybridMemoryService,
      llmEngineResolver: this.llmEngineResolver,
      writeLlmAudit: (envelope, step, start, engine) => this.writeLlmAudit(envelope, step, start, engine)
    });
    this.classicRuntime = new ClassicConversationRuntime(this.conversationSupport);
    this.windowedAgentRuntime = new WindowedAgentConversationRuntime(
      this.conversationSupport,
      this.conversationWindowService
    );
  }

  async handle(envelope: Envelope): Promise<Response> {
    const start = Date.now();

    const cached = this.processed.get(envelope.requestId);
    if (cached) {
      return cached;
    }

    let dispatchedMenuEventId: string | undefined;
    let workingEnvelope = envelope;
    let memoryLoaded = false;
    let memoryCache = "";
    const readSessionMemory = (): string => {
      if (!memoryLoaded) {
        memoryCache = this.readSessionMemory(workingEnvelope.sessionId);
        memoryLoaded = true;
      }
      return memoryCache;
    };

    try {
      const menuEventResolution = this.resolveIngressEvent(workingEnvelope);
      workingEnvelope = menuEventResolution.envelope;
      dispatchedMenuEventId = menuEventResolution.dispatchedMenuEventId;
      if (menuEventResolution.response) {
        this.processed.set(workingEnvelope.requestId, menuEventResolution.response);
        return menuEventResolution.response;
      }

      const originalText = await sttRuntime.transcribe(workingEnvelope);
      const mapped = this.resolveMappedInput(originalText);
      const text = mapped?.targetText ?? originalText;
      const directRouteResponse = await this.handleDirectCommandRoute(
        text,
        workingEnvelope,
        start,
        readSessionMemory,
        originalText
      );
      if (directRouteResponse) {
        return directRouteResponse;
      }

      const conversationMode = resolveMainConversationMode(workingEnvelope.meta);
      const response = await (conversationMode === "windowed-agent" ? this.windowedAgentRuntime : this.classicRuntime).handleTurn({
        text,
        envelope: workingEnvelope,
        start,
        readSessionMemory
      });
      this.processed.set(workingEnvelope.requestId, response);
      this.appendMemory(workingEnvelope, originalText, response);
      return response;
    } catch (error) {
      if (dispatchedMenuEventId) {
        this.observableMenuService?.markEventDispatchFailed(dispatchedMenuEventId, error);
      }
      console.error("Error in handle method:", error);
      return { text: "Processing failed due to an error" };
    }
  }

  private resolveIngressEvent(envelope: Envelope): {
    envelope: Envelope;
    response?: Response;
    dispatchedMenuEventId?: string;
  } {
    if (!this.observableMenuService) {
      return { envelope };
    }

    const wecomClickEvent = readWeComClickEventContext(envelope);
    if (!wecomClickEvent) {
      return { envelope };
    }

    const handled = this.observableMenuService.handleWeComClickEvent(wecomClickEvent);
    if (!handled.dispatchText) {
      return {
        envelope,
        response: handled.replyText ? { text: handled.replyText } : { text: "" }
      };
    }

    return {
      envelope: {
        ...envelope,
        kind: "text",
        text: handled.dispatchText,
        meta: {
          ...(envelope.meta ?? {}),
          observable_menu_event_id: handled.event.id,
          observable_menu_dispatch_text: handled.dispatchText
        }
      },
      dispatchedMenuEventId: handled.event.id
    };
  }

  // New step-based processing methods
  private async handleDirectCommandRoute(
    text: string,
    envelope: Envelope,
    start: number,
    readSessionMemory: () => string,
    memoryText: string = text
  ): Promise<Response | null> {
    const shortcutMatched = this.toolRegistry.matchDirectShortcut(text);
    if (shortcutMatched) {
      if (shortcutMatched.async) {
        const taskId = createAsyncTaskId(shortcutMatched.command);
        const taskEnvelope = createAsyncTaskEnvelope(envelope, taskId);
        const executionPromise = this.enqueueAsyncDirectTask(envelope.sessionId, () =>
          this.executeAsyncDirectShortcut(shortcutMatched, text, envelope, taskEnvelope, Date.now(), memoryText)
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
          this.appendMemory(envelope, memoryText, fallback);
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
            this.appendMemory(taskEnvelope, memoryText, fallback);
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
        this.appendMemory(envelope, memoryText, acceptedResponse);
        return acceptedResponse;
      }

      return this.executeDirectShortcut(shortcutMatched, text, readSessionMemory(), envelope, start, memoryText);
    }

    const matched = this.toolRegistry.matchDirectToolCall(text);
    if (!matched) {
      return null;
    }

    if (matched.async) {
      const taskId = createAsyncTaskId(matched.command);
      const taskEnvelope = createAsyncTaskEnvelope(envelope, taskId);
      const executionPromise = this.enqueueAsyncDirectTask(envelope.sessionId, () =>
        this.executeAsyncDirectToolCall(matched, text, envelope, taskEnvelope, Date.now(), memoryText)
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
        this.appendMemory(envelope, memoryText, fallback);
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
          this.appendMemory(taskEnvelope, memoryText, fallback);
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
      this.appendMemory(envelope, memoryText, acceptedResponse);
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
      memoryText,
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
    start: number,
    memoryText: string = text
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
      memoryText,
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
    start: number,
    memoryText: string = text
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
      memoryText,
      envelope,
      start
    );
  }

  private async executeAsyncDirectShortcut(
    matched: DirectShortcutMatch,
    text: string,
    envelope: Envelope,
    taskEnvelope: Envelope,
    start: number,
    memoryText: string = text
  ): Promise<{ taskEnvelope: Envelope; response: Response }> {
    const latestMemory = this.readSessionMemory(envelope.sessionId);
    const response = await this.executeDirectShortcut(
      matched,
      text,
      latestMemory,
      taskEnvelope,
      start,
      memoryText
    );
    return { taskEnvelope, response };
  }

  private resolveMappedInput(input: string): ResolvedDirectInputMapping | null {
    if (!this.directInputResolver) {
      return null;
    }
    try {
      const resolved = this.directInputResolver.resolveInput(input);
      if (resolved?.targetText) {
        console.log(
          `[Orchestrator] direct input mapped by rule=${resolved.ruleId} mode=${resolved.matchMode}: ${JSON.stringify(input)} -> ${JSON.stringify(resolved.targetText)}`
        );
      }
      return resolved;
    } catch (error) {
      console.error("[Orchestrator] direct input mapping failed", error);
      return null;
    }
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

  private writeLlmAudit(envelope: Envelope, step: LLMExecutionStep, start: number, engine: LLMEngine): void {
    const latencyMs = Date.now() - start;
    const ingressMessageId = (envelope.meta as Record<string, unknown> | undefined)?.ingress_message_id;
    const llmMeta: LLMPlanMeta = {
      llm_provider: engine.getProviderName(),
      model: engine.getModelForStep(step),
      retries: 0,
      parse_ok: true,
      raw_output_length: 0,
      fallback: false
    };
    writeAudit({
      requestId: envelope.requestId,
      sessionId: envelope.sessionId,
      source: envelope.source,
      ingress_message_id: typeof ingressMessageId === "string" ? ingressMessageId : undefined,
      actionType: step as any,
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
    if (rawMeta.benchmark === true) {
      return;
    }
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
    const hasTextField = Object.prototype.hasOwnProperty.call(output, "text");
    if (hasTextField && typeof text === "string") {
      return { text: text.trim() };
    }

    const hasImageField = Object.prototype.hasOwnProperty.call(output, "image")
      || Object.prototype.hasOwnProperty.call(output, "images");
    if (hasImageField) {
      return { text: "" };
    }
  }
  const sanitized = sanitizeToolResult(output);
  if (sanitized !== undefined) {
    return { text: JSON.stringify(sanitized, null, 2) };
  }
  return { text: "OK" };
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
