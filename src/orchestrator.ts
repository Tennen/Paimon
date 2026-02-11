import { Envelope, Image, Response } from "./types";
import { mockSTT } from "./mockSTT";
import { policyCheck } from "./policy";
import { ToolRouter } from "./toolRouter";
import { writeAudit } from "./auditLogger";
import { LLMEngine, LLMPlanMeta, LLMPlanResult, LLMRuntimeContext } from "./engines/llm/llm";
import { ActionType } from "./types";
import { MemoryStore } from "./memory/memoryStore";
import { SkillManager } from "./skills/skillManager";
import { ToolRegistry, ToolSchemaItem } from "./tools/toolRegistry";

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

    try {
      // Step 1: LLM Call - Determine the skill to use
      const llmResult = await this.llmCallStep(text, memory, envelope, start);
      if (llmResult.response) {
        this.processed.set(envelope.requestId, llmResult.response);
        this.appendMemory(envelope, text, llmResult.response);
        return llmResult.response;
      }

      // Step 2: Skill Plan - Get detailed skill plan with response templates
      const skillPlanResult = await this.skillPlanStep(llmResult.skillName!, text, memory, envelope, start);
      if (skillPlanResult.response) {
        this.processed.set(envelope.requestId, skillPlanResult.response);
        this.appendMemory(envelope, text, skillPlanResult.response);
        return skillPlanResult.response;
      }

      // Step 3: Tool Call - Execute the planned tool action
      const toolResult = await this.toolCallStep(skillPlanResult.toolAction!, text, memory, envelope, start);

      // Step 4: Respond - Generate final response based on tool result and prepared templates
      const response = await this.respondStep(
        toolResult.result,
        skillPlanResult.successResponse || "Task completed successfully",
        skillPlanResult.failureResponse || "Tool execution failed",
        text,
        envelope,
        start,
        pendingImage
      );

      return response;
    } catch (error) {
      console.error("Error in handle method:", error);
      return { text: "Processing failed due to an error" };
    }
  }

  // New step-based processing methods
  private async llmCallStep(
    text: string,
    memory: string,
    envelope: Envelope,
    start: number
  ): Promise<{ response?: Response; skillName?: string }> {
    const extraSkills = buildExtraSkillsContext(this.toolRegistry);
    const skillsContext = buildSkillsContext(this.skillManager, undefined, extraSkills);

    const runtimeContext: LLMRuntimeContext = {
      now: new Date().toISOString(),
      timezone: "Asia/Shanghai",
      memory,
      skills_context: skillsContext,
      tools_context: buildToolsSchemaContext(this.toolRegistry),
      next_step_context: {
        kind: "skill_selection"
      }
    };

    const planned = await this.planWithMeta(text, runtimeContext, this.actionSchema);
    const llmMeta = planned.meta;

    // Write audit log
    this.writeLlmAudit(envelope, llmMeta, ActionType.LlmCall, start);

    // Check if LLM directly wants to respond
    if (planned.action.type === ActionType.Respond) {
      const response = { text: String((planned.action.params as Record<string, unknown>).text ?? "").trim() || "OK" };
      this.appendMemory(envelope, text, response);
      return { response };
    }

    // Check if LLM wants to use a skill
    if (planned.action.type === ActionType.SkillCall) {
      const skillName = (planned.action.params as Record<string, unknown>).name as string;
      if (skillName && skillsContext?.[skillName]) {
        return { skillName };
      }
      const response = { text: `Unknown skill: ${skillName ?? "undefined"}` };
      this.appendMemory(envelope, text, response);
      return { response };
    }

    // Fallback response
    const response = { text: "I don't understand. Please try rephrasing your request." };
    this.appendMemory(envelope, text, response);
    return { response };
  }

  private async skillPlanStep(
    skillName: string,
    text: string,
    memory: string,
    envelope: Envelope,
    start: number
  ): Promise<{
    response?: Response;
    toolAction?: { type: ActionType.ToolCall; params: Record<string, unknown> };
    successResponse?: string;
    failureResponse?: string;
  }> {
    const actionHistory: Array<{ iteration: number; action: { type: string; params: Record<string, unknown> } }> = [];
    const extraSkills = buildExtraSkillsContext(this.toolRegistry);
    const detail = getSkillDetail(skillName, this.skillManager, extraSkills, this.toolRegistry);
    const skillContext = buildSkillsContext(this.skillManager, [skillName], extraSkills);
    const forceTools: string[] = [];

    if (skillName === "homeassistant") {
      forceTools.push("homeassistant");
    }
    if (skillName && skillContext?.[skillName]?.terminal) {
      forceTools.push("terminal");
    }

    const fullToolContext = this.toolRegistry.buildRuntimeContext();
    const toolContext = filterToolContextForSkill(detail, fullToolContext, forceTools);

    const runtimeContext: LLMRuntimeContext = {
      now: new Date().toISOString(),
      timezone: "Asia/Shanghai",
      memory,
      action_history: actionHistory,
      skills_context: skillContext,
      tools_context: toolContext,
      next_step_context: {
        kind: "skill_detail",
        skill_name: skillName,
        skill_detail: detail,
        instruction: "Plan the tool call execution with on_success and on_failure response templates."
      }
    };

    const planned = await this.planWithMeta(text, runtimeContext, this.actionSchema);
    const llmMeta = planned.meta;

    // Write audit log
    this.writeLlmAudit(envelope, llmMeta, ActionType.SkillCall, start);

    // Validate the planned action
    const validation = validatePlannedAction(planned.action, runtimeContext);
    if (validation.overrideAction) {
      planned.action = validation.overrideAction;
    }
    if (validation.followupAction) {
      // This shouldn't happen in our new flow, but handle it gracefully
      const response = { text: "Invalid skill plan. Please try again." };
      this.appendMemory(envelope, text, response);
      return { response };
    }

    // For ToolCall, extract response templates
    if (planned.action.type === ActionType.ToolCall) {
      const toolParams = planned.action.params as Record<string, unknown>;
      const successResponse = typeof toolParams.on_success === "object"
        ? String((toolParams.on_success as Record<string, unknown>).text ?? "").trim()
        : undefined;
      const failureResponse = typeof toolParams.on_failure === "object"
        ? String((toolParams.on_failure as Record<string, unknown>).text ?? "").trim()
        : undefined;

      return {
        toolAction: { type: ActionType.ToolCall, params: planned.action.params },
        successResponse,
        failureResponse: failureResponse || "Tool execution failed"
      };
    }

    // Convert other action types to ToolCall if possible
    if (planned.action.type === ActionType.SkillCall) {
      const skillName = (planned.action.params as Record<string, unknown>).name as string;
      const toolParams = {
        tool: skillName,
        op: "execute",
        params: { input: "" },
        on_success: { type: ActionType.Respond as const, params: { text: "Skill executed successfully" } },
        on_failure: { type: ActionType.Respond as const, params: { text: "Skill execution failed" } }
      };

      return {
        toolAction: { type: ActionType.ToolCall, params: toolParams },
        successResponse: "Skill executed successfully",
        failureResponse: "Skill execution failed"
      };
    }

    // Fallback for other action types
    const response = { text: "Invalid skill plan. Please try again." };
    this.appendMemory(envelope, text, response);
    return { response };
  }

  private async toolCallStep(
    toolAction: { type: ActionType; params: Record<string, unknown> },
    _text: string,
    memory: string,
    envelope: Envelope,
    _start: number
  ): Promise<{ result: { ok: boolean; output?: unknown; error?: string } }> {
    const policy = await policyCheck(toolAction as any);
    if (!policy.allowed) {
      return { result: { ok: false, error: "Policy rejected" } };
    }

    const { result } = await this.toolRouter.route(toolAction as any, {
      memory,
      sessionId: envelope.sessionId
    });

    return { result };
  }

  private async respondStep(
    toolResult: { ok: boolean; output?: unknown; error?: string },
    successResponse: string,
    failureResponse: string,
    text: string,
    envelope: Envelope,
    _start: number,
    pendingImage: Image | null
  ): Promise<Response> {
    let response: Response;

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

    // Handle image if present
    if (pendingImage) {
      response.data = { ...(response.data as Record<string, unknown> | undefined), image: pendingImage };
    }

    // Cache and log
    this.processed.set(envelope.requestId, response);
    this.appendMemory(envelope, text, response);

    return response;
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
}

function formatMemoryEntry(userText: string, response: Response): string {
  const now = new Date().toISOString();
  const assistantText = response.text ?? "";
  return `- ${now}\\n  - user: ${userText}\\n  - assistant: ${assistantText}`;
}

type LlmCallParams = {
  promptText?: string;
  context?: Partial<LLMRuntimeContext> | null;
  image?: Image | null;
  _llm_meta?: LLMPlanMeta;
};

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
  extraSkills: Record<string, { description?: string; command?: string; terminal?: boolean; has_handler?: boolean; keywords?: string[] }> = {}
): Record<string, { description?: string; command?: string; terminal?: boolean; has_handler?: boolean; keywords?: string[] }> | null {
  const skills = skillManager.list().filter((skill) => !onlyNames || onlyNames.includes(skill.name));
  const entries = skills.map((skill) => {
    const command = skill.metadata?.command ?? skill.command;
    const keywords = skill.metadata?.keywords ?? skill.keywords;
    return [skill.name, { description: skill.description, command, terminal: skill.terminal, has_handler: skill.hasHandler, ...(keywords ? { keywords } : {}) }] as const;
  });
  const extraEntries = Object.entries(extraSkills).filter(([name]) => !onlyNames || onlyNames.includes(name));
  const merged = Object.fromEntries([...entries, ...extraEntries]);
  if (Object.keys(merged).length === 0) return null;
  return merged;
}

function buildExtraSkillsContext(
  toolRegistry: ToolRegistry
): Record<string, { description?: string; command?: string; terminal?: boolean; has_handler?: boolean; keywords?: string[] }> {
  const extra: Record<string, { description?: string; command?: string; terminal?: boolean; has_handler?: boolean; keywords?: string[] }> = {};
  const haSchema = toolRegistry.listSchema().find((tool) => tool.name === "homeassistant");
  if (haSchema) {
    extra.homeassistant = {
      description: "Control and query Home Assistant devices (services, state, snapshots).",
      command: "homeassistant",
      terminal: false,
      has_handler: false,
      ...(haSchema.keywords ? { keywords: haSchema.keywords } : {})
    };
  }
  return extra;
}

function getSkillDetail(
  name: string,
  skillManager: SkillManager,
  extraSkills: Record<string, { description?: string; command?: string; terminal?: boolean; has_handler?: boolean; keywords?: string[] }>,
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

function buildLlmCallAction(params: {
  promptText: string;
  memory: string;
  actionHistory: Array<{ iteration: number; action: { type: string; params: Record<string, unknown> } }>;
  toolsContext?: Record<string, Record<string, unknown>> | null;
  skillsContext?: Record<string, { description?: string; command?: string; terminal?: boolean; has_handler?: boolean; keywords?: string[] }> | null;
  nextStepContext?: Record<string, unknown> | null;
  image?: Image | null;
}): { type: ActionType.LlmCall; params: LlmCallParams } {
  const history = params.actionHistory.map((entry) => ({
    iteration: entry.iteration,
    action: { type: entry.action.type }
  })) as Array<{ iteration: number; action: { type: string } }>;
  const context: Partial<LLMRuntimeContext> = {
    now: new Date().toISOString(),
    timezone: "Asia/Shanghai",
    memory: params.memory.length > 0 ? params.memory : undefined,
    action_history: history.length > 0 ? (history as any) : undefined,
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

function getLlmPrompt(action: { type: ActionType; params: Record<string, unknown> }): string | undefined {
  const params = action.params as Record<string, unknown>;
  if (action.type === ActionType.LlmCall) {
    const llmParams = action.params as LlmCallParams;
    return llmParams.promptText;
  }
  const prompt = params._llm_prompt;
  return typeof prompt === "string" ? prompt : undefined;
}

function getToolSchemaFromContext(
  context: Partial<LLMRuntimeContext> | null
): Array<{ name: string; operations?: Array<{ op: string }> }> {
  const toolsContext = context?.tools_context as Record<string, unknown> | undefined;
  const schema = toolsContext?._tools as { schema?: Array<{ name: string; operations?: Array<{ op: string }> }> } | undefined;
  return Array.isArray(schema?.schema) ? schema!.schema! : [];
}

function getSkillNamesFromContext(context: Partial<LLMRuntimeContext> | null): string[] {
  const skillsContext = context?.skills_context as Record<string, unknown> | undefined;
  return skillsContext ? Object.keys(skillsContext) : [];
}

function buildPlannerErrorFollowup(
  context: Partial<LLMRuntimeContext> | null,
  promptText: string | undefined,
  error: string,
  allowedTools: string[],
  allowedSkills: string[],
  allowedOps?: string[]
): { type: ActionType.LlmCall; params: LlmCallParams } {
  const memory = typeof context?.memory === "string" ? context.memory : "";
  const actionHistory = Array.isArray(context?.action_history) ? (context!.action_history as any) : [];
  return buildLlmCallAction({
    promptText: promptText ?? "",
    memory,
    actionHistory,
    toolsContext: context?.tools_context ?? undefined,
    skillsContext: context?.skills_context ?? undefined,
    nextStepContext: {
      kind: "planner_error",
      error,
      allowed_tools: allowedTools,
      allowed_skills: allowedSkills,
      ...(allowedOps ? { allowed_ops: allowedOps } : {})
    }
  });
}

function validatePlannedAction(
  action: { type: ActionType; params: Record<string, unknown> },
  context: Partial<LLMRuntimeContext> | null
): {
  overrideAction?: { type: ActionType; params: Record<string, unknown> };
  followupAction?: { type: ActionType; params: Record<string, unknown> };
} {
  if (!context) return {};
  const stepKind = (context.next_step_context as Record<string, unknown> | null)?.kind;
  const hasSkillDetail = stepKind === "skill_detail";

  if (action.type === ActionType.ToolCall) {
    const toolsSchema = getToolSchemaFromContext(context);
    const toolName = action.params.tool as string | undefined;
    const allowedTools = toolsSchema.map((t) => t.name);
    const allowedSkills = getSkillNamesFromContext(context);
    const toolSpec = toolsSchema.find((t) => t.name === toolName);
    if (!toolSpec) {
      if (toolName && allowedSkills.includes(toolName)) {
        return { overrideAction: { type: ActionType.SkillCall, params: { name: toolName, input: "" } } };
      }
      return {
        followupAction: buildPlannerErrorFollowup(
          context,
          getLlmPrompt(action),
          `Unknown tool: ${toolName ?? "undefined"}`,
          allowedTools,
          allowedSkills
        )
      };
    }
    const op = action.params.op as string | undefined;
    const allowedOps = (toolSpec.operations ?? []).map((o) => o.op);
    if (op && allowedOps.length > 0 && !allowedOps.includes(op)) {
      return {
        followupAction: buildPlannerErrorFollowup(
          context,
          getLlmPrompt(action),
          `Unknown op '${op}' for tool '${toolName}'`,
          allowedTools,
          allowedSkills,
          allowedOps
        )
      };
    }
  }

  if (action.type === ActionType.SkillCall) {
    const allowedSkills = getSkillNamesFromContext(context);
    const name = action.params.name as string | undefined;
    const input = (action.params.input as string | undefined) ?? "";
    if (name && !allowedSkills.includes(name)) {
      const allowedTools = getToolSchemaFromContext(context).map((t) => t.name);
      return {
        followupAction: buildPlannerErrorFollowup(
          context,
          getLlmPrompt(action),
          `Unknown skill: ${name}`,
          allowedTools,
          allowedSkills
        )
      };
    }
    if (!hasSkillDetail && name && input.trim().length > 0) {
      return { overrideAction: { type: ActionType.SkillCall, params: { name, input: "" } } };
    }
  }

  return {};
}
