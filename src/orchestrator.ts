import { Envelope, Image, Response, ToolExecution } from "./types";
import { mockSTT } from "./mockSTT";
import { policyCheck } from "./policy";
import { ToolRouter } from "./toolRouter";
import { writeAudit } from "./auditLogger";
import { LLMRuntimeContext, LLMPlanMeta } from "./engines/llm/llm";
import { MemoryStore } from "./memory/memoryStore";
import { SkillManager } from "./skills/skillManager";
import { ToolRegistry, ToolSchemaItem } from "./tools/toolRegistry";
import { LLMEngine } from "./engines/llm/llm";

export class Orchestrator {
  private readonly processed = new Map<string, Response>();
  private readonly toolRouter: ToolRouter;
  private readonly llmEngine: LLMEngine;
  private readonly memoryStore: MemoryStore;
  private readonly skillManager: SkillManager;
  private readonly maxIterations: number;
  private readonly toolRegistry: ToolRegistry;

  constructor(
    toolRouter: ToolRouter,
    llmEngine: LLMEngine,
    memoryStore: MemoryStore,
    skillManager: SkillManager,
    toolRegistry: ToolRegistry
  ) {
    this.toolRouter = toolRouter;
    this.llmEngine = llmEngine;
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
      const toolResult = await this.toolCallStep(skillPlanResult.toolExecution!, text, memory, envelope, start);

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

    const result = await this.llmEngine.selectSkill(text, runtimeContext);

    // Write audit log
    const llmMeta: LLMPlanMeta = {
      llm_provider: "ollama",
      model: process.env.OLLAMA_MODEL ?? "unknown",
      retries: 0,
      parse_ok: true,
      raw_output_length: 0,
      fallback: false
    };
    this.writeLlmAudit(envelope, llmMeta, "llm_call", start);

    if (result.decision === "respond") {
      const response = { text: result.response_text || "OK" };
      this.appendMemory(envelope, text, response);
      return { response };
    }

    if (result.decision === "use_skill" && result.skill_name) {
      return { skillName: result.skill_name };
    }

    const response = { text: "I don't understand. Please try rephrasing." };
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
    toolExecution?: ToolExecution;
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
        instruction: "Plan the tool call execution with success and failure response templates."
      }
    };

    const plan = await this.llmEngine.planToolExecution(text, runtimeContext);

    // Write audit log
    const llmMeta: LLMPlanMeta = {
      llm_provider: "ollama",
      model: process.env.OLLAMA_MODEL ?? "unknown",
      retries: 0,
      parse_ok: true,
      raw_output_length: 0,
      fallback: false
    };
    this.writeLlmAudit(envelope, llmMeta, "tool_call", start);

    return {
      toolExecution: {
        tool: plan.tool,
        op: plan.op,
        args: plan.args
      },
      successResponse: plan.success_response,
      failureResponse: plan.failure_response
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
