import { Envelope, Image, Response } from "./types";
import { mockSTT } from "./mockSTT";
import { policyCheck } from "./policy";
import { ToolRouter } from "./toolRouter";
import { writeAudit } from "./auditLogger";
import { LLMEngine, LLMPlanResult, LLMRuntimeContext } from "./engines/llm/llm";
import { ActionType } from "./types";
import { MemoryStore } from "./memory/memoryStore";
import { SkillManager } from "./skills/skillManager";
import { ToolRegistry } from "./tools/toolRegistry";

export class Orchestrator {
  private readonly processed = new Map<string, Response>();
  private readonly toolRouter: ToolRouter;
  private readonly llmEngine: LLMEngine;
  private readonly toolSchema: string;
  private readonly memoryStore: MemoryStore;
  private readonly skillManager: SkillManager;
  private readonly maxIterations: number;
  private readonly toolRegistry: ToolRegistry;

  constructor(
    toolRouter: ToolRouter,
    llmEngine: LLMEngine,
    toolSchema: string,
    memoryStore: MemoryStore,
    skillManager: SkillManager,
    toolRegistry: ToolRegistry
  ) {
    this.toolRouter = toolRouter;
    this.llmEngine = llmEngine;
    this.toolSchema = toolSchema;
    this.memoryStore = memoryStore;
    this.skillManager = skillManager;
    this.maxIterations = Number(process.env.LLM_MAX_ITERATIONS ?? "5");
    this.toolRegistry = toolRegistry;
  }

  async handle(envelope: Envelope): Promise<Response> {
    const start = Date.now();

    const cached = this.processed.get(envelope.requestId);
    if (cached) {
      return cached;
    }

    const text = await mockSTT(envelope.text, envelope.audioPath);
    const memory = this.memoryStore.read(envelope.sessionId);

    let nextStep: NextStep = {
      promptText: text,
      context: null,
      image: null
    };
    const actionHistory: Array<{
      iteration: number;
      action: { type: string; params: Record<string, unknown> };
    }> = [];
    let llmResult: LLMPlanResult | null = null;
    let action: { type: ActionType; params: Record<string, unknown> } | null = null;
    const toolContext = this.toolRegistry.buildRuntimeContext();
    for (let i = 0; i < this.maxIterations; i += 1) {
      const runtimeContext: LLMRuntimeContext = {
        now: new Date().toISOString(),
        timezone: "Asia/Shanghai",
        memory: memory.length > 0 ? memory : undefined,
        action_history: actionHistory.length > 0 ? actionHistory : undefined,
        tools_context: toolContext,
        next_step_context: nextStep.context,
      };

      console.log(this.toolSchema);

      llmResult = await this.planWithMeta(
        nextStep.promptText,
        runtimeContext,
        this.toolSchema,
      );
      action = llmResult.action;

      const policy = await policyCheck(action as any);
      if (!policy.allowed) {
        const response = { text: "Policy rejected" };
        this.processed.set(envelope.requestId, response);
        return response;
      }

      const handler = this.getActionHandler(action.type);
      const result = await handler({
        action,
        llmResult,
        envelope,
        text,
        memory,
        start,
        iteration: i,
        pendingImage: nextStep.image
      });

      console.log("result", result);

      if (result.historyEntry) {
        actionHistory.push(result.historyEntry);
      }
      if (result.followupContext || result.followupPrompt || result.followupImage) {
        nextStep = {
          promptText: result.followupPrompt ?? nextStep.promptText,
          context: result.followupContext ?? null,
          image: result.followupImage ?? null
        };
        continue;
      }

      return result.response ?? { text: "No response" };
    }

    return { text: "LLM failed" };
  }

  private async planWithMeta(
    text: string,
    runtimeContext: LLMRuntimeContext,
    toolSchema: string,
  ): Promise<LLMPlanResult> {
    const engine = this.llmEngine as LLMEngine & {
      planWithMeta?: (t: string, rc: LLMRuntimeContext, ts: string, imgs?: string[]) => Promise<LLMPlanResult>;
    };

    if (engine.planWithMeta) {
      return engine.planWithMeta(text, runtimeContext, toolSchema);
    }

    const action = await engine.plan(text, runtimeContext, toolSchema);
    return {
      action,
      meta: {
        llm_provider: "ollama",
        model: process.env.OLLAMA_MODEL ?? "unknown",
        retries: 0,
        parse_ok: true,
        raw_output_length: 0,
        fallback: false
      }
    };
  }

  private writeLlmAudit(envelope: Envelope, llmResult: LLMPlanResult, actionType: ActionType, start: number): void {
    const latencyMs = Date.now() - start;
    const ingressMessageId = (envelope.meta as Record<string, unknown> | undefined)?.ingress_message_id;
    writeAudit({
      requestId: envelope.requestId,
      sessionId: envelope.sessionId,
      source: envelope.source,
      ingress_message_id: typeof ingressMessageId === "string" ? ingressMessageId : undefined,
      actionType,
      latencyMs,
      tool: "llm",
      llm_provider: llmResult.meta.llm_provider,
      model: llmResult.meta.model,
      retries: llmResult.meta.retries,
      parse_ok: llmResult.meta.parse_ok,
      raw_output_length: llmResult.meta.raw_output_length,
      fallback: llmResult.meta.fallback
    });
  }

  private appendMemory(envelope: Envelope, text: string, response: Response): void {
    const memoryText = text || (envelope.kind === "image" ? "[image]" : "");
    this.memoryStore.append(envelope.sessionId, formatMemoryEntry(memoryText, response));
  }

  private getActionHandler(type: ActionType): ActionHandler {
    const handlers: Record<ActionType, ActionHandler> = {
      [ActionType.Respond]: this.handleRespond.bind(this),
      [ActionType.ToolCall]: this.handleToolCall.bind(this),
      [ActionType.SkillCall]: this.handleSkillCall.bind(this)
    };
    return handlers[type] ?? this.handleUnsupported.bind(this);
  }

  private async handleRespond(ctx: ActionContext): Promise<ActionOutcome> {
    const textOut = String((ctx.action.params as Record<string, unknown>).text ?? "").trim();
    const response: Response = { text: textOut || "OK" };
    if (ctx.pendingImage) {
      response.data = { ...(response.data as Record<string, unknown> | undefined), image: ctx.pendingImage };
    }
    this.processed.set(ctx.envelope.requestId, response);
    this.writeLlmAudit(ctx.envelope, ctx.llmResult, ctx.action.type, ctx.start);
    this.appendMemory(ctx.envelope, ctx.text, response);
    return { response, historyEntry: { iteration: ctx.iteration, action: { type: ctx.action.type, params: ctx.action.params } } };
  }

  private async handleToolCall(ctx: ActionContext): Promise<ActionOutcome> {
    const { result, toolName } = await this.toolRouter.route(ctx.action as any, {
      memory: ctx.memory,
      sessionId: ctx.envelope.sessionId
    });
    console.log("result", result);

    if (ctx.iteration + 1 < this.maxIterations) {
      const image = extractImage(result.output);
      return {
        followupPrompt: buildToolFollowup(ctx.text, result.output),
        followupImage: image ?? null,
        historyEntry: { iteration: ctx.iteration, action: { type: ctx.action.type, params: ctx.action.params } }
      };
    }

    const latencyMs = Date.now() - ctx.start;
    const ingressMessageId = (ctx.envelope.meta as Record<string, unknown> | undefined)?.ingress_message_id;
    const toolMeta = extractToolMeta(result.output);
    writeAudit({
      requestId: ctx.envelope.requestId,
      sessionId: ctx.envelope.sessionId,
      source: ctx.envelope.source,
      ingress_message_id: typeof ingressMessageId === "string" ? ingressMessageId : undefined,
      actionType: ctx.action.type,
      latencyMs,
      tool: toolName,
      tool_meta: toolMeta ?? undefined,
      llm_provider: ctx.llmResult.meta.llm_provider,
      model: ctx.llmResult.meta.model,
      retries: ctx.llmResult.meta.retries,
      parse_ok: ctx.llmResult.meta.parse_ok,
      raw_output_length: ctx.llmResult.meta.raw_output_length,
      fallback: ctx.llmResult.meta.fallback
    });
    return { historyEntry: { iteration: ctx.iteration, action: { type: ctx.action.type, params: ctx.action.params } } };
  }

  private async handleSkillCall(ctx: ActionContext): Promise<ActionOutcome> {
    if (ctx.action.type === ActionType.SkillCall) {
      const name = ctx.action.params.name as string | undefined;
      const input = (ctx.action.params.input as string | undefined) ?? "";
      if (name && input.trim().length === 0) {
        const detail = this.skillManager.getDetail(name);
        if (detail) {
          return {
            followupPrompt: buildSkillFollowup(ctx.text, detail),
            historyEntry: { iteration: ctx.iteration, action: { type: ctx.action.type, params: ctx.action.params } }
          };
        }
      }

      const skillName = name || "";
      const result = await this.skillManager.invoke(skillName, input, {
        sessionId: ctx.envelope.sessionId
      });

      if (ctx.iteration + 1 < this.maxIterations) {
        return {
          followupPrompt: buildToolFollowup(ctx.text, result),
          historyEntry: { iteration: ctx.iteration, action: { type: ctx.action.type, params: ctx.action.params } }
        };
      }

      const latencyMs = Date.now() - ctx.start;
      const ingressMessageId = (ctx.envelope.meta as Record<string, unknown> | undefined)?.ingress_message_id;
      writeAudit({
        requestId: ctx.envelope.requestId,
        sessionId: ctx.envelope.sessionId,
        source: ctx.envelope.source,
        ingress_message_id: typeof ingressMessageId === "string" ? ingressMessageId : undefined,
        actionType: ctx.action.type,
        latencyMs,
        tool: "skill",
        llm_provider: ctx.llmResult.meta.llm_provider,
        model: ctx.llmResult.meta.model,
        retries: ctx.llmResult.meta.retries,
        parse_ok: ctx.llmResult.meta.parse_ok,
        raw_output_length: ctx.llmResult.meta.raw_output_length,
        fallback: ctx.llmResult.meta.fallback
      });
      return { historyEntry: { iteration: ctx.iteration, action: { type: ctx.action.type, params: ctx.action.params } } };
    }

    return this.handleToolCall(ctx);
  }

  private async handleUnsupported(ctx: ActionContext): Promise<ActionOutcome> {
    const response: Response = { text: `Unsupported action: ${ctx.action.type}` };
    this.processed.set(ctx.envelope.requestId, response);
    return { response };
  }
}

function extractToolMeta(output: unknown): Record<string, unknown> | null {
  if (!output || typeof output !== "object") return null;
  const meta = (output as { meta?: unknown }).meta;
  if (!meta || typeof meta !== "object") return null;
  return meta as Record<string, unknown>;
}

function formatMemoryEntry(userText: string, response: Response): string {
  const now = new Date().toISOString();
  const assistantText = response.text ?? "";
  return `- ${now}\\n  - user: ${userText}\\n  - assistant: ${assistantText}`;
}

type ActionContext = {
  action: { type: ActionType; params: Record<string, unknown> };
  llmResult: LLMPlanResult;
  envelope: Envelope;
  text: string;
  memory: string;
  start: number;
  iteration: number;
  pendingImage: Image | null;
};

type ActionOutcome = {
  response?: Response;
  followupContext?: Partial<LLMRuntimeContext>;
  followupPrompt?: string;
  followupImage?: Image | null;
  historyEntry?: { iteration: number; action: { type: string; params: Record<string, unknown> } };
};

type ActionHandler = (ctx: ActionContext) => Promise<ActionOutcome>;

type NextStep = {
  promptText: string;
  context: Partial<LLMRuntimeContext> | null;
  image: Image | null;
};

function buildToolFollowup(userText: string, toolResult: unknown): string {
  const sanitized = sanitizeToolResult(toolResult);
  const payload = JSON.stringify(sanitized ?? null, null, 2);
  return [
    "Original user input:",
    userText,
    "",
    "Tool result:",
    payload,
    "",
    "Use the tool result to respond to the user. Return {\"type\":\"respond\",\"params\":{\"text\":\"...\"}} only."
  ].join("\n");
}

function buildSkillFollowup(userText: string, detail: string): string {
  return [
    "Original user input:",
    userText,
    "",
    "Selected skill detail:",
    detail,
    "",
    "Decide the next action. If a skill call is needed, include input. Otherwise respond."
  ].join("\n");
}

function sanitizeToolResult(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  if (Array.isArray(input)) {
    return input.map((item) => sanitizeToolResult(item));
  }
  const obj = input as Record<string, unknown>;
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
    out[key] = sanitizeToolResult(value);
  }
  return out;
}

function extractImage(output: unknown): Image | null {
  if (!output || typeof output !== "object") return null;
  const image = (output as { image?: unknown }).image as Image | undefined;
  if (!image || typeof image.data !== "string" || image.data.length === 0) return null;
  const contentType = typeof image.contentType === "string" ? image.contentType : undefined;
  const filename = typeof image.filename === "string" ? image.filename : undefined;
  return { data: image.data, contentType, filename };
}
