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
import { ConversationContextService } from "../config/conversationContextService";
import { DirectCommandRuntime } from "./orchestrator_direct";
import {
  buildToolResultResponse,
  formatMemoryEntry,
  inferNonTextMemoryMarker,
  isGenericResponseText,
  normalizeImages,
  normalizeRawMemoryMeta
} from "./orchestrator_shared";

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
  private readonly directCommandRuntime: DirectCommandRuntime;

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
    conversationWindowService?: ConversationWindowService,
    conversationContextService?: ConversationContextService
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
      conversationContextService,
      llmEngineResolver: this.llmEngineResolver,
      writeLlmAudit: (envelope, step, start, engine) => this.writeLlmAudit(envelope, step, start, engine)
    });
    this.classicRuntime = new ClassicConversationRuntime(this.conversationSupport);
    this.windowedAgentRuntime = new WindowedAgentConversationRuntime(
      this.conversationSupport,
      this.conversationWindowService
    );
    this.directCommandRuntime = new DirectCommandRuntime({
      toolRegistry: this.toolRegistry,
      callbackDispatcher: this.callbackDispatcher,
      processed: this.processed,
      appendMemory: (targetEnvelope, text, response) => this.appendMemory(targetEnvelope, text, response),
      readSessionMemory: (sessionId) => this.readSessionMemory(sessionId),
      toolCallStep: (toolExecution, text, memory, targetEnvelope, targetStart) =>
        this.toolCallStep(toolExecution, text, memory, targetEnvelope, targetStart),
      respondStep: (toolResult, successResponse, failureResponse, preferToolResult, text, targetEnvelope, targetStart) =>
        this.respondStep(toolResult, successResponse, failureResponse, preferToolResult, text, targetEnvelope, targetStart)
    });
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
      const directRouteResponse = await this.directCommandRuntime.handleDirectCommandRoute(
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
