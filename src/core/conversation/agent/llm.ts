import { jsonrepair } from "jsonrepair";
import { LLMChatMessage, LLMChatStep, LLMEngine } from "../../../engines/llm/llm";

export type AgentBootstrapDecision =
  | {
      decision: "respond";
      response_text: string;
    }
  | {
      decision: "use_planning";
      memory_mode?: "on" | "off";
      memory_query?: string;
    }
  | {
      decision: "use_skill";
      skill_name: string;
      memory_mode?: "on" | "off";
      memory_query?: string;
    };

export type AgentFollowupMode = "none" | "awaiting_user" | "continue_same_skill";

export type AgentLoopAction =
  | {
      decision: "respond";
      response_text: string;
      followup_mode?: AgentFollowupMode;
      objective?: string;
    }
  | {
      decision: "tool_call";
      tool: string;
      action: string;
      params: Record<string, unknown>;
      followup_mode?: AgentFollowupMode;
      objective?: string;
    }
  | {
      decision: "reroute";
      reason?: string;
    };

const JSON_RETRY_HINT = "Output MUST be valid JSON only. No markdown, no code fences, no explanations.";

const BOOTSTRAP_SYSTEM_PROMPT = [
  "You are the main conversation bootstrap router.",
  "You MUST output a single JSON object only.",
  "Decide whether the current user turn should reply directly, use local planning, or enter a specific skill.",
  "Use the prior conversation messages when present.",
  'Output one of:',
  '{"decision":"respond","response_text":"..."}',
  '{"decision":"use_planning","memory_mode":"on|off","memory_query":"optional"}',
  '{"decision":"use_skill","skill_name":"...","memory_mode":"on|off","memory_query":"optional"}'
].join("\n");

const AGENT_SYSTEM_PROMPT = [
  "You are the main conversation agent loop.",
  "You MUST output a single JSON object only.",
  "You may reply directly, call one tool, or ask the runtime to reroute.",
  'Output one of:',
  '{"decision":"respond","response_text":"...","followup_mode":"none|awaiting_user|continue_same_skill","objective":"optional"}',
  '{"decision":"tool_call","tool":"...","action":"...","params":{},"followup_mode":"none|awaiting_user|continue_same_skill","objective":"optional"}',
  '{"decision":"reroute","reason":"optional"}',
  "Use followup_mode=none when the skill should not be sticky into the next turn.",
  "Only call tools defined in AGENT_CONTEXT_JSON.tools_schema."
].join("\n");

export async function runBootstrapDecision(input: {
  engine: LLMEngine;
  historyMessages: LLMChatMessage[];
  text: string;
  context: Record<string, unknown>;
}): Promise<AgentBootstrapDecision> {
  const raw = await executeJsonChat({
    engine: input.engine,
    step: "routing",
    systemPrompt: BOOTSTRAP_SYSTEM_PROMPT,
    historyMessages: input.historyMessages,
    text: input.text,
    context: input.context
  });
  return parseBootstrapDecision(raw);
}

export async function runAgentLoopAction(input: {
  engine: LLMEngine;
  historyMessages: LLMChatMessage[];
  text: string;
  context: Record<string, unknown>;
}): Promise<AgentLoopAction> {
  const raw = await executeJsonChat({
    engine: input.engine,
    step: "planning",
    systemPrompt: AGENT_SYSTEM_PROMPT,
    historyMessages: input.historyMessages,
    text: input.text,
    context: input.context
  });
  return parseAgentLoopAction(raw);
}

async function executeJsonChat(input: {
  engine: LLMEngine;
  step: LLMChatStep;
  systemPrompt: string;
  historyMessages: LLMChatMessage[];
  text: string;
  context: Record<string, unknown>;
}): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const systemPrompt = attempt === 0
      ? input.systemPrompt
      : `${input.systemPrompt}\n${JSON_RETRY_HINT}`;
    try {
      return await input.engine.chat({
        step: input.step,
        messages: [
          { role: "system", content: systemPrompt },
          ...input.historyMessages,
          { role: "system", content: buildContextMessage(input.context) },
          { role: "user", content: input.text }
        ]
      });
    } catch (error) {
      lastError = error as Error;
    }
  }

  if (lastError) {
    throw lastError;
  }
  throw new Error("agent chat failed");
}

function buildContextMessage(context: Record<string, unknown>): string {
  return [
    "=== AGENT_CONTEXT_JSON ===",
    JSON.stringify(context, null, 2)
  ].join("\n");
}

function parseBootstrapDecision(rawText: string): AgentBootstrapDecision {
  const obj = parseJsonObject(rawText);
  if (obj.decision === "respond") {
    return {
      decision: "respond",
      response_text: text(obj.response_text) || "OK"
    };
  }
  if (obj.decision === "use_planning") {
    return {
      decision: "use_planning",
      ...(parseMemoryMode(obj.memory_mode) ? { memory_mode: parseMemoryMode(obj.memory_mode) } : {}),
      ...(text(obj.memory_query) ? { memory_query: text(obj.memory_query) } : {})
    };
  }
  if (obj.decision === "use_skill") {
    const skillName = text(obj.skill_name);
    if (!skillName) {
      throw new Error("bootstrap skill_name is required");
    }
    return {
      decision: "use_skill",
      skill_name: skillName,
      ...(parseMemoryMode(obj.memory_mode) ? { memory_mode: parseMemoryMode(obj.memory_mode) } : {}),
      ...(text(obj.memory_query) ? { memory_query: text(obj.memory_query) } : {})
    };
  }
  throw new Error(`invalid bootstrap decision: ${String(obj.decision ?? "")}`);
}

function parseAgentLoopAction(rawText: string): AgentLoopAction {
  const obj = parseJsonObject(rawText);
  if (obj.decision === "respond") {
    const responseText = text(obj.response_text) || text(obj.response) || "OK";
    return {
      decision: "respond",
      response_text: responseText,
      ...(parseFollowupMode(obj.followup_mode) ? { followup_mode: parseFollowupMode(obj.followup_mode) } : {}),
      ...(text(obj.objective) ? { objective: text(obj.objective) } : {})
    };
  }
  if (obj.decision === "reroute") {
    return {
      decision: "reroute",
      ...(text(obj.reason) ? { reason: text(obj.reason) } : {})
    };
  }
  const decision = text(obj.decision);
  if (decision && decision !== "tool_call") {
    throw new Error(`invalid agent decision: ${decision}`);
  }
  const tool = text(obj.tool);
  const action = text(obj.action) || text(obj.op);
  const params = isRecord(obj.params)
    ? obj.params
    : isRecord(obj.args)
      ? obj.args
      : null;
  if (!tool || !action || !params) {
    throw new Error("agent tool_call missing tool/action/params");
  }
  return {
    decision: "tool_call",
    tool,
    action,
    params,
    ...(parseFollowupMode(obj.followup_mode) ? { followup_mode: parseFollowupMode(obj.followup_mode) } : {}),
    ...(text(obj.objective) ? { objective: text(obj.objective) } : {})
  };
}

function parseJsonObject(rawText: string): Record<string, unknown> {
  const normalized = unwrapFence(String(rawText ?? "").trim());
  const candidate = tryParseJson(normalized)
    ?? tryParseJson(safeJsonRepair(normalized))
    ?? tryParseJson(extractJson(normalized));
  if (!candidate) {
    throw new Error("agent output is not valid JSON object");
  }
  return candidate;
}

function safeJsonRepair(raw: string): string {
  try {
    return jsonrepair(raw);
  } catch {
    return "";
  }
}

function tryParseJson(raw: string): Record<string, unknown> | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function unwrapFence(raw: string): string {
  const match = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : raw;
}

function extractJson(raw: string): string {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return "";
  }
  return raw.slice(start, end + 1);
}

function parseMemoryMode(raw: unknown): "on" | "off" | undefined {
  return raw === "on" || raw === "off" ? raw : undefined;
}

function parseFollowupMode(raw: unknown): AgentFollowupMode | undefined {
  return raw === "awaiting_user" || raw === "continue_same_skill" || raw === "none"
    ? raw
    : undefined;
}

function text(input: unknown): string {
  return typeof input === "string" ? input.trim() : "";
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return Boolean(input) && typeof input === "object" && !Array.isArray(input);
}
