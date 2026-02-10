import { Envelope, Image, Response } from "./types";
import { mockSTT } from "./mockSTT";
import { policyCheck } from "./policy";
import { ToolRouter } from "./toolRouter";
import { writeAudit } from "./auditLogger";
import { LLMEngine, LLMPlanMeta, LLMPlanResult, LLMRuntimeContext } from "./engines/llm/llm";
import { ActionType } from "./types";
import { MemoryStore } from "./memory/memoryStore";
import { SkillManager } from "./skills/skillManager";
import { ToolRegistry } from "./tools/toolRegistry";

export class Orchestrator {
  private readonly processed = new Map<string, Response>();
  private readonly toolRouter: ToolRouter;
  private readonly llmEngine: LLMEngine;
  private readonly actionSchema: string;
  private readonly memoryStore: MemoryStore;
  private readonly skillManager: SkillManager;
  private readonly maxIterations: number;
  private readonly toolRegistry: ToolRegistry;

  constructor(
    toolRouter: ToolRouter,
    llmEngine: LLMEngine,
    actionSchema: string,
    memoryStore: MemoryStore,
    skillManager: SkillManager,
    toolRegistry: ToolRegistry
  ) {
    this.toolRouter = toolRouter;
    this.llmEngine = llmEngine;
    this.actionSchema = actionSchema;
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

    let pendingImage: Image | null = null;
    const actionHistory: Array<{
      iteration: number;
      action: { type: string; params: Record<string, unknown> };
    }> = [];
    const toolContext = this.toolRegistry.buildRuntimeContext();
    const skillsContext = this.skillManager.list().length > 0
      ? buildSkillsContext(this.skillManager)
      : null;
    let action: { type: ActionType; params: Record<string, unknown> } | null = buildLlmCallAction({
      promptText: text,
      memory,
      actionHistory,
      toolsContext: toolContext,
      skillsContext
    });
    for (let i = 0; i < this.maxIterations; i += 1) {
      const step = await this.processStep({
        action: action ?? { type: ActionType.LlmCall, params: {} },
        envelope,
        text,
        memory,
        start,
        iteration: i,
        pendingImage,
        actionHistory,
        toolContext,
        skillsContext
      });
      action = step.action;
      const result = step.result;

      console.log("result", result);

      const advance = applyStepResult(result, action, pendingImage, actionHistory);
      pendingImage = advance.nextPendingImage;
      if (advance.nextAction) {
        action = advance.nextAction;
        continue;
      }

      return result.response ?? { text: "No response" };
    }

    return { text: "LLM failed" };
  }

  private async processStep(params: {
    action: { type: ActionType; params: Record<string, unknown> };
    envelope: Envelope;
    text: string;
    memory: string;
    start: number;
    iteration: number;
    pendingImage: Image | null;
    actionHistory: Array<{ iteration: number; action: { type: string; params: Record<string, unknown> } }>;
    toolContext: Record<string, Record<string, unknown>>;
    skillsContext: Record<string, { description?: string; command?: string; terminal?: boolean; has_handler?: boolean; keywords?: string[] }> | null;
  }): Promise<{
    action: { type: ActionType; params: Record<string, unknown> };
    result: ActionOutcome;
  }> {
    const { action, envelope, text, memory, start, iteration, pendingImage, actionHistory, toolContext, skillsContext } = params;
    if (action.type === ActionType.LlmCall) {
      const llmParams = action.params as LlmCallParams;
      const promptText = llmParams.promptText ?? text;
      const runtimeContext = normalizeLlmContext(llmParams.context);

      console.log(this.actionSchema);

      const planned = await this.planWithMeta(
        promptText,
        runtimeContext,
        this.actionSchema,
      );

      const plannedAction = attachLlmMeta(planned.action, planned.meta);
      propagateMetaToFollowups(plannedAction, planned.meta);
      const handler = this.getActionHandler(plannedAction.type);
      const outcome = await handler({
        action: plannedAction,
        llmMeta: planned.meta,
        envelope,
        text,
        memory,
        start,
        iteration,
        pendingImage,
        actionHistory,
        toolContext,
        skillsContext
      });
      return { action: plannedAction, result: outcome };
    }

    const policy = await policyCheck(action as any);
    if (!policy.allowed) {
      const response = { text: "Policy rejected" };
      this.processed.set(envelope.requestId, response);
      return { action, result: { response } };
    }

    const handler = this.getActionHandler(action.type);
    const outcome = await handler({
      action,
      llmMeta: getLlmMeta(action),
      envelope,
      text,
      memory,
      start,
      iteration,
      pendingImage,
      actionHistory,
      toolContext,
      skillsContext
    });

    return { action, result: outcome };
  }

  private async planWithMeta(
    text: string,
    runtimeContext: LLMRuntimeContext,
    actionSchema: string,
  ): Promise<LLMPlanResult> {
    const engine = this.llmEngine as LLMEngine & {
      planWithMeta?: (t: string, rc: LLMRuntimeContext, actionSchema: string, imgs?: string[]) => Promise<LLMPlanResult>;
    };

    if (engine.planWithMeta) {
      return engine.planWithMeta(text, runtimeContext, actionSchema);
    }

    const action = await engine.plan(text, runtimeContext, actionSchema);
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

  private writeLlmAudit(envelope: Envelope, llmMeta: LLMPlanMeta, actionType: ActionType, start: number): void {
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
      llm_provider: llmMeta.llm_provider,
      model: llmMeta.model,
      retries: llmMeta.retries,
      parse_ok: llmMeta.parse_ok,
      raw_output_length: llmMeta.raw_output_length,
      fallback: llmMeta.fallback
    });
  }

  private appendMemory(envelope: Envelope, text: string, response: Response): void {
    const memoryText = text || (envelope.kind === "image" ? "[image]" : "");
    this.memoryStore.append(envelope.sessionId, formatMemoryEntry(memoryText, response));
  }

  private getActionHandler(type: ActionType): ActionHandler {
    const handlers: Record<ActionType, ActionHandler> = {
      [ActionType.Respond]: this.handleRespond.bind(this),
      [ActionType.ToolCall]: this.handleToolCallFollowup.bind(this),
      [ActionType.SkillCall]: this.handleSkillPlan.bind(this),
      [ActionType.LlmCall]: this.handleLlmCall.bind(this)
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
    if (ctx.llmMeta) {
      this.writeLlmAudit(ctx.envelope, ctx.llmMeta, ctx.action.type, ctx.start);
    }
    this.appendMemory(ctx.envelope, ctx.text, response);
    return { response, historyEntry: { iteration: ctx.iteration, action: { type: ctx.action.type, params: ctx.action.params } } };
  }

  private async handleLlmCall(ctx: ActionContext): Promise<ActionOutcome> {
    const response: Response = { text: "LLM returned llm.call; expected a concrete action." };
    this.processed.set(ctx.envelope.requestId, response);
    if (ctx.llmMeta) {
      this.writeLlmAudit(ctx.envelope, ctx.llmMeta, ctx.action.type, ctx.start);
    }
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

    if (ctx.llmMeta) {
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
        llm_provider: ctx.llmMeta.llm_provider,
        model: ctx.llmMeta.model,
        retries: ctx.llmMeta.retries,
        parse_ok: ctx.llmMeta.parse_ok,
        raw_output_length: ctx.llmMeta.raw_output_length,
        fallback: ctx.llmMeta.fallback
      });
    }
    return { historyEntry: { iteration: ctx.iteration, action: { type: ctx.action.type, params: ctx.action.params } } };
  }

  private async handleSkillCall(ctx: ActionContext): Promise<ActionOutcome> {
    return this.handleToolCall(ctx);
  }

  private async handleSkillPlan(ctx: ActionContext): Promise<ActionOutcome> {
    const name = ctx.action.params.name as string | undefined;
    const input = (ctx.action.params.input as string | undefined) ?? "";
    if (name && input.trim().length > 0 && this.skillManager.hasHandler(name)) {
      try {
        const result = await this.skillManager.invoke(name, input, {
          sessionId: ctx.envelope.sessionId
        });
        const followupAction = buildLlmCallAction({
          promptText: ctx.text,
          memory: ctx.memory,
          actionHistory: ctx.actionHistory,
          nextStepContext: {
            kind: "skill_result",
            skill_name: name,
            skill_ok: true,
            skill_result: result,
            instruction: "Use the skill result to decide the next action."
          }
        });
        return {
          followupAction,
          historyEntry: { iteration: ctx.iteration, action: { type: ctx.action.type, params: ctx.action.params } }
        };
      } catch (error) {
        const followupAction = buildLlmCallAction({
          promptText: ctx.text,
          memory: ctx.memory,
          actionHistory: ctx.actionHistory,
          nextStepContext: {
            kind: "skill_result",
            skill_name: name,
            skill_ok: false,
            error: (error as Error).message,
            instruction: "Handle the skill error and decide the next action."
          }
        });
        return {
          followupAction,
          historyEntry: { iteration: ctx.iteration, action: { type: ctx.action.type, params: ctx.action.params } }
        };
      }
    }
    const detail = name ? this.skillManager.getDetail(name) : "";
    const skillContext = name ? buildSkillsContext(this.skillManager, [name]) : null;
    const forceTools: string[] = [];
    if (name && skillContext?.[name]?.terminal) {
      forceTools.push("terminal");
    }
    const toolContext = filterToolContextForSkill(detail, ctx.toolContext, forceTools);
    const followupAction = buildLlmCallAction({
      promptText: ctx.text,
      memory: ctx.memory,
      actionHistory: ctx.actionHistory,
      toolsContext: toolContext,
      skillsContext: skillContext,
      nextStepContext: {
        kind: "skill_detail",
        skill_name: name ?? "",
        skill_detail: detail,
        instruction:
          "Use the skill detail to decide the next action. If a tool call is needed, include on_success/on_failure actions."
      }
    });

    return {
      followupAction,
      historyEntry: { iteration: ctx.iteration, action: { type: ctx.action.type, params: ctx.action.params } }
    };
  }

  private async handleToolCallFollowup(ctx: ActionContext): Promise<ActionOutcome> {
    const { result, toolName } = await this.toolRouter.route(ctx.action as any, {
      memory: ctx.memory,
      sessionId: ctx.envelope.sessionId
    });

    const followup = selectFollowupAction(ctx.action, result.ok);
    if (followup) {
      if (followup.type === ActionType.Respond) {
        const textOut = String((followup.params as Record<string, unknown>).text ?? "").trim();
        const response: Response = { text: textOut || "OK" };
        const toolImage = extractImage(result.output);
        const finalImage = toolImage ?? ctx.pendingImage;
        if (finalImage) {
          response.data = { ...(response.data as Record<string, unknown> | undefined), image: finalImage };
        }
        this.processed.set(ctx.envelope.requestId, response);
        if (ctx.llmMeta) {
          this.writeLlmAudit(ctx.envelope, ctx.llmMeta, ctx.action.type, ctx.start);
        }
        this.appendMemory(ctx.envelope, ctx.text, response);
        return {
          response,
          historyEntry: { iteration: ctx.iteration, action: { type: ctx.action.type, params: ctx.action.params } }
        };
      }

      if (followup.type === ActionType.LlmCall) {
        const followupAction = ensureLlmCallParams(followup, {
          promptText: ctx.text,
          memory: ctx.memory,
          actionHistory: ctx.actionHistory,
          nextStepContext: {
            kind: "tool_result",
            tool_name: toolName,
            tool_ok: result.ok,
            tool_result: result,
            instruction: "Use the tool result to decide the next action."
          }
        });
        return {
          followupAction,
          historyEntry: { iteration: ctx.iteration, action: { type: ctx.action.type, params: ctx.action.params } }
        };
      }
    }

    if (ctx.iteration + 1 < this.maxIterations) {
      const image = extractImage(result.output);
      const followupAction = buildLlmCallAction({
        promptText: ctx.text,
        memory: ctx.memory,
        actionHistory: ctx.actionHistory,
        nextStepContext: {
          kind: "tool_result",
          tool_name: toolName,
          tool_ok: result.ok,
          tool_result: result,
          instruction: "Use the tool result to decide the next action."
        }
      });
      return {
        followupImage: image ?? null,
        followupAction,
        historyEntry: { iteration: ctx.iteration, action: { type: ctx.action.type, params: ctx.action.params } }
      };
    }

    return { historyEntry: { iteration: ctx.iteration, action: { type: ctx.action.type, params: ctx.action.params } } };
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
  llmMeta: LLMPlanMeta | null;
  envelope: Envelope;
  text: string;
  memory: string;
  start: number;
  iteration: number;
  pendingImage: Image | null;
  actionHistory: Array<{ iteration: number; action: { type: string; params: Record<string, unknown> } }>;
  toolContext: Record<string, Record<string, unknown>>;
  skillsContext: Record<string, { description?: string; command?: string; terminal?: boolean; has_handler?: boolean; keywords?: string[] }> | null;
};

type ActionOutcome = {
  response?: Response;
  followupContext?: Partial<LLMRuntimeContext>;
  followupPrompt?: string;
  followupImage?: Image | null;
  followupAction?: { type: ActionType; params: Record<string, unknown> };
  historyEntry?: { iteration: number; action: { type: string; params: Record<string, unknown> } };
};

type ActionHandler = (ctx: ActionContext) => Promise<ActionOutcome>;

type LlmCallParams = {
  promptText?: string;
  context?: Partial<LLMRuntimeContext> | null;
  image?: Image | null;
  _llm_meta?: LLMPlanMeta;
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

function applyStepResult(
  result: ActionOutcome,
  currentAction: { type: ActionType; params: Record<string, unknown> },
  pendingImage: Image | null,
  history: Array<{ iteration: number; action: { type: string; params: Record<string, unknown> } }>
): {
  nextAction: { type: ActionType; params: Record<string, unknown> } | null;
  nextPendingImage: Image | null;
} {
  if (result.historyEntry) {
    history.push(result.historyEntry);
  }

  const hasFollowup =
    result.followupContext || result.followupPrompt || result.followupImage || result.followupAction;
  if (!hasFollowup) {
    return { nextAction: null, nextPendingImage: pendingImage };
  }

  const nextAction = result.followupAction ?? buildFallbackLlmCall(currentAction, result);

  const nextPendingImage = result.followupImage ?? pendingImage;
  return { nextAction, nextPendingImage };
}

function buildSkillsContext(
  skillManager: SkillManager,
  onlyNames?: string[]
): Record<string, { description?: string; command?: string; terminal?: boolean; has_handler?: boolean; keywords?: string[] }> | null {
  const skills = skillManager.list().filter((skill) => !onlyNames || onlyNames.includes(skill.name));
  if (skills.length === 0) return null;
  const entries = skills.map((skill) => {
    const command = skill.metadata?.command ?? skill.command;
    const keywords = skill.metadata?.keywords ?? skill.keywords;
    return [skill.name, { description: skill.description, command, terminal: skill.terminal, has_handler: skill.hasHandler, ...(keywords ? { keywords } : {}) }] as const;
  });
  return Object.fromEntries(entries);
}

function buildLlmCallAction(params: {
  promptText: string;
  memory: string;
  actionHistory: Array<{ iteration: number; action: { type: string; params: Record<string, unknown> } }>;
  toolsContext?: Record<string, Record<string, unknown>> | null;
  skillsContext?: Record<string, { description?: string; command?: string; terminal?: boolean; has_handler?: boolean; keywords?: string[] }> | null;
  nextStepContext?: Record<string, unknown> | null;
  image?: Image | null;
}): { type: ActionType.LlmCall; params: LlmCallParams } {
  const context: Partial<LLMRuntimeContext> = {
    now: new Date().toISOString(),
    timezone: "Asia/Shanghai",
    memory: params.memory.length > 0 ? params.memory : undefined,
    action_history: params.actionHistory.length > 0 ? params.actionHistory : undefined,
    ...(params.toolsContext ? { tools_context: params.toolsContext } : {}),
    ...(params.skillsContext ? { skills_context: params.skillsContext } : {}),
    ...(params.nextStepContext ? { next_step_context: params.nextStepContext } : {})
  };

  return {
    type: ActionType.LlmCall,
    params: {
      promptText: params.promptText,
      context,
      ...(params.image ? { image: params.image } : {})
    }
  };
}

function ensureLlmCallParams(
  action: { type: ActionType; params: Record<string, unknown> },
  defaults: {
    promptText: string;
    memory: string;
    actionHistory: Array<{ iteration: number; action: { type: string; params: Record<string, unknown> } }>;
    nextStepContext?: Record<string, unknown> | null;
  }
): { type: ActionType.LlmCall; params: LlmCallParams } {
  const params = (action.params as LlmCallParams) ?? {};
  const base = buildLlmCallAction({
    promptText: defaults.promptText,
    memory: defaults.memory,
    actionHistory: defaults.actionHistory,
    nextStepContext: defaults.nextStepContext
  });
  const mergedContext = mergeLlmContext(base.params.context ?? null, params.context ?? null);
  if (mergedContext) {
    delete mergedContext.tools_context;
    delete mergedContext.skills_context;
  }
  return {
    type: ActionType.LlmCall,
    params: {
      ...base.params,
      ...params,
      context: mergedContext
    }
  };
}

function mergeLlmContext(
  base: Partial<LLMRuntimeContext> | null,
  override: Partial<LLMRuntimeContext> | null
): Partial<LLMRuntimeContext> | null {
  if (!base && !override) return null;
  const merged = { ...(base ?? {}), ...(override ?? {}) } as Partial<LLMRuntimeContext>;
  if (override?.memory ?? base?.memory) merged.memory = override?.memory ?? base?.memory;
  if (override?.action_history ?? base?.action_history) merged.action_history = override?.action_history ?? base?.action_history;
  if (override?.tools_context ?? base?.tools_context) merged.tools_context = override?.tools_context ?? base?.tools_context;
  if (override?.skills_context ?? base?.skills_context) merged.skills_context = override?.skills_context ?? base?.skills_context;
  if (override?.next_step_context ?? base?.next_step_context) merged.next_step_context = override?.next_step_context ?? base?.next_step_context;
  return merged;
}

function buildFallbackLlmCall(
  currentAction: { type: ActionType; params: Record<string, unknown> },
  result: ActionOutcome
): { type: ActionType.LlmCall; params: LlmCallParams } {
  const currentParams = (currentAction.params as LlmCallParams) ?? {};
  const mergedContext = mergeLlmContext(currentParams.context ?? null, result.followupContext ?? null);
  if (mergedContext) {
    delete mergedContext.tools_context;
    delete mergedContext.skills_context;
  }
  return {
    type: ActionType.LlmCall,
    params: {
      promptText: result.followupPrompt ?? currentParams.promptText ?? "",
      context: mergedContext
    }
  };
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

function attachLlmMeta(action: { type: ActionType; params: Record<string, unknown> }, meta: LLMPlanMeta): { type: ActionType; params: Record<string, unknown> } {
  const params = action.params as Record<string, unknown>;
  return {
    ...action,
    params: { ...params, _llm_meta: meta }
  };
}

function getLlmMeta(action: { type: ActionType; params: Record<string, unknown> }): LLMPlanMeta | null {
  const meta = (action.params as Record<string, unknown>)?._llm_meta;
  if (!meta || typeof meta !== "object") return null;
  return meta as LLMPlanMeta;
}

function propagateMetaToFollowups(action: { type: ActionType; params: Record<string, unknown> }, meta: LLMPlanMeta): void {
  if (action.type !== ActionType.ToolCall) return;
  const params = action.params as Record<string, unknown>;
  const onSuccess = params.on_success as Record<string, unknown> | undefined;
  const onFailure = params.on_failure as Record<string, unknown> | undefined;
  if (onSuccess && typeof onSuccess === "object") {
    const obj = onSuccess as Record<string, unknown>;
    if (typeof obj.type === "string" && typeof obj.params === "object" && obj.params !== null) {
      params.on_success = attachLlmMeta({ type: obj.type as ActionType, params: obj.params as Record<string, unknown> }, meta);
    }
  }
  if (onFailure && typeof onFailure === "object") {
    const obj = onFailure as Record<string, unknown>;
    if (typeof obj.type === "string" && typeof obj.params === "object" && obj.params !== null) {
      params.on_failure = attachLlmMeta({ type: obj.type as ActionType, params: obj.params as Record<string, unknown> }, meta);
    }
  }
}

function normalizeLlmContext(context?: Partial<LLMRuntimeContext> | null): LLMRuntimeContext {
  const now = new Date().toISOString();
  const base = context ?? {};
  return {
    now: base.now ?? now,
    timezone: base.timezone ?? "Asia/Shanghai",
    memory: base.memory,
    action_history: base.action_history,
    tools_context: base.tools_context,
    skills_context: base.skills_context,
    next_step_context: base.next_step_context ?? null
  };
}

function selectFollowupAction(
  action: { type: ActionType; params: Record<string, unknown> },
  ok: boolean
): { type: ActionType; params: Record<string, unknown> } | null {
  if (action.type !== ActionType.ToolCall) return null;
  const params = action.params as Record<string, unknown>;
  const candidate = ok ? params.on_success : params.on_failure;
  if (!candidate || typeof candidate !== "object") return null;
  const obj = candidate as Record<string, unknown>;
  if (typeof obj.type !== "string" || typeof obj.params !== "object" || obj.params === null) return null;
  const followup = { type: obj.type as ActionType, params: obj.params as Record<string, unknown> };
  const meta = getLlmMeta(action);
  return meta ? attachLlmMeta(followup, meta) : followup;
}
