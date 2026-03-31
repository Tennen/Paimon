import { policyCheck } from "../../policy";
import { LLMEngine, LLMExecutionStep, LLMRuntimeContext } from "../../engines/llm/llm";
import { HybridMemoryService } from "../../memory/hybridMemoryService";
import { SkillInfo, SkillManager } from "../../skills/skillManager";
import { ToolRegistry, ToolSchemaItem } from "../../tools/toolRegistry";
import { ToolRouter } from "../../tools/toolRouter";
import { Envelope, Image, Response, ToolExecution } from "../../types";
import {
  ConversationRuntimeSupportOptions,
  ExecuteToolFn,
  ToolExecutionResult
} from "./types";

export class ConversationRuntimeSupport {
  private readonly toolRouter: ToolRouter;
  private readonly defaultLLMEngine: LLMEngine;
  private readonly llmEngineResolver?: (step: LLMExecutionStep) => LLMEngine;
  private readonly hybridMemoryService: HybridMemoryService;
  readonly skillManager: SkillManager;
  readonly toolRegistry: ToolRegistry;
  private readonly writeAuditFn: ConversationRuntimeSupportOptions["writeLlmAudit"];

  constructor(options: ConversationRuntimeSupportOptions) {
    this.toolRouter = options.toolRouter;
    this.defaultLLMEngine = options.defaultLLMEngine;
    this.llmEngineResolver = options.llmEngineResolver;
    this.hybridMemoryService = options.hybridMemoryService;
    this.skillManager = options.skillManager;
    this.toolRegistry = options.toolRegistry;
    this.writeAuditFn = options.writeLlmAudit;
  }

  resolveLLMEngine(step: LLMExecutionStep): LLMEngine {
    if (!this.llmEngineResolver) {
      return this.defaultLLMEngine;
    }
    try {
      return this.llmEngineResolver(step);
    } catch (error) {
      console.error(`[ConversationRuntime] resolveLLMEngine failed for step=${step}, fallback to default`, error);
      return this.defaultLLMEngine;
    }
  }

  writeLlmAudit(envelope: Envelope, step: LLMExecutionStep, start: number, engine: LLMEngine): void {
    this.writeAuditFn(envelope, step, start, engine);
  }

  loadMemoryForNextStep(sessionId: string, query: string, readSessionMemory: () => string): string {
    if (!sessionId) {
      return "";
    }
    try {
      const hybrid = this.hybridMemoryService.build(sessionId, query);
      if (hybrid?.memory) {
        return hybrid.memory;
      }
    } catch (error) {
      console.error("[ConversationRuntime] hybrid memory load failed", error);
    }
    return readSessionMemory();
  }

  createToolExecutor(): ExecuteToolFn {
    return async (toolExecution: ToolExecution, memory: string, envelope: Envelope): Promise<ToolExecutionResult> => {
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
    };
  }

  buildRoutingSkillsContext(): Record<string, { description?: string; command?: string; terminal?: boolean; tool?: string; action?: string; params?: string[]; keywords?: string[] }> | null {
    return buildSkillsContext(this.skillManager, undefined, buildExtraSkillsContext(this.toolRegistry));
  }

  buildPlanningContext(skillName: string | undefined): {
    selectedSkill?: SkillInfo;
    detail: string;
    toolContext: Record<string, Record<string, unknown>> | null;
  } {
    const selectedSkill = skillName ? this.skillManager.get(skillName) : undefined;
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
    if (selectedSkill?.tool) {
      forceTools.push(selectedSkill.tool);
    }
    const fullToolContext = this.toolRegistry.buildRuntimeContext();
    const toolContext = skillName
      ? filterToolContextForSkill(detail, fullToolContext, forceTools)
      : null;
    return {
      ...(selectedSkill ? { selectedSkill } : {}),
      detail,
      toolContext
    };
  }
}

export function buildToolResponse(
  toolResult: { ok: boolean; output?: unknown; error?: string },
  successResponse: string,
  failureResponse: string,
  preferToolResult: boolean
): Response {
  let response: Response;

  if (preferToolResult) {
    response = buildToolResultResponse(toolResult);
    if (toolResult.ok && isGenericResponseText(response.text) && successResponse) {
      response = { text: successResponse };
    } else if (!toolResult.ok && isGenericResponseText(response.text) && failureResponse) {
      response = { text: failureResponse };
    }
  } else if (toolResult.ok) {
    response = successResponse ? { text: successResponse } : buildToolResultResponse(toolResult);
  } else if (failureResponse) {
    response = { text: failureResponse };
  } else {
    response = { text: toolResult.error ? `Tool error: ${toolResult.error}` : "Tool failed" };
  }

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

  return response;
}

export function buildToolResultResponse(result: { ok: boolean; output?: unknown; error?: string }): Response {
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

export function buildToolObservationText(result: { ok: boolean; output?: unknown; error?: string }): string {
  if (!result.ok) {
    return result.error ? `Tool error: ${result.error}` : "Tool failed";
  }
  const output = result.output as Record<string, unknown> | string | undefined;
  if (typeof output === "string") {
    return output.trim() || "OK";
  }
  if (output && typeof output === "object") {
    const text = output.text;
    if (typeof text === "string" && text.trim()) {
      return text.trim();
    }
    const image = output.image;
    const images = Array.isArray(output.images) ? output.images : [];
    if (image && typeof image === "object" && !Array.isArray(image)) {
      const filename = typeof (image as Record<string, unknown>).filename === "string"
        ? (image as Record<string, unknown>).filename
        : "";
      return filename ? `Tool succeeded and returned image output (${filename}).` : "Tool succeeded and returned image output.";
    }
    if (images.length > 0) {
      return `Tool succeeded and returned ${images.length} image outputs.`;
    }
  }
  const sanitized = sanitizeToolResult(output);
  if (sanitized !== undefined) {
    return JSON.stringify(sanitized, null, 2);
  }
  return "OK";
}

export function resolveMemoryDecision(
  result: { decision: "respond" | "use_skill" | "use_planning"; memory_mode?: "on" | "off"; memory_query?: string },
  text: string
): { enabled: boolean; query: string } {
  if (result.decision === "respond") {
    return { enabled: false, query: text };
  }
  const enabled = result.memory_mode === "off" ? false : true;
  const query = typeof result.memory_query === "string" && result.memory_query.trim()
    ? result.memory_query.trim()
    : text;
  return { enabled, query };
}

export function isLlmMemoryContextEnabled(): boolean {
  const raw = process.env.LLM_MEMORY_CONTEXT_ENABLED;
  if (raw === undefined || raw === null) {
    return true;
  }
  const normalized = String(raw).trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }
  return true;
}

export function buildReadablePlanningMemory(
  context: LLMRuntimeContext,
  memory: string
): LLMRuntimeContext {
  return memory ? { ...context, memory } : context;
}

function sanitizeToolResult(input: unknown): unknown {
  if (!input || typeof input !== "object") {
    return input;
  }
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

function buildSkillsContext(
  skillManager: SkillManager,
  onlyNames?: string[],
  extraSkills: Record<string, { description?: string; command?: string; terminal?: boolean; tool?: string; action?: string; params?: string[]; keywords?: string[] }> = {}
): Record<string, { description?: string; command?: string; terminal?: boolean; tool?: string; action?: string; params?: string[]; keywords?: string[] }> | null {
  const skills = skillManager.list().filter((skill) => !onlyNames || onlyNames.includes(skill.name));
  const entries = skills.map((skill) => {
    const command = skill.metadata?.command ?? skill.command;
    // const keywords = skill.metadata?.keywords ?? skill.keywords;
    return [
      skill.name,
      {
        description: skill.description,
        // command,
        // terminal: skill.terminal,
        // ...(skill.tool ? { tool: skill.tool } : {}),
        // ...(skill.action ? { action: skill.action } : {}),
        // ...(skill.params && skill.params.length > 0 ? { params: skill.params } : {}),
        // ...(keywords ? { keywords } : {})
      }
    ] as const;
  });
  const extraEntries = Object.entries(extraSkills).filter(([name]) => !onlyNames || onlyNames.includes(name));
  const merged = Object.fromEntries([...entries, ...extraEntries]);
  return Object.keys(merged).length > 0 ? merged : null;
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
  const keywordsLine = schema?.keywords ? `    "keywords": ${JSON.stringify(schema.keywords)}` : "";
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
    '    "tool": "homeassistant"',
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
  for (const name of forced) {
    matchedNames.add(name);
  }

  const result: Record<string, Record<string, unknown>> = Object.fromEntries(matches);
  const toolsSchema = toolContext._tools as { schema?: Array<{ name: string }> } | undefined;
  const schemaList = Array.isArray(toolsSchema?.schema) ? toolsSchema.schema : [];
  if (schemaList.length > 0) {
    const filteredSchema = schemaList.filter((item) => matchedNames.has(item.name));
    if (filteredSchema.length > 0) {
      result._tools = { schema: filteredSchema };
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

function normalizeImages(images: Image[] | undefined): Image[] {
  if (!Array.isArray(images)) {
    return [];
  }
  return images.filter((image) => Boolean(image && typeof image.data === "string" && image.data.length > 0));
}

function isGenericResponseText(text: string | undefined): boolean {
  const normalized = String(text ?? "").trim().toLowerCase();
  return normalized.length === 0 || normalized === "ok" || normalized === "tool failed";
}
