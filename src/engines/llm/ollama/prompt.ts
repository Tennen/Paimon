import { LLMRuntimeContext } from "../llm";

export function buildSystemPrompt(actionSchema: string, strictJson: boolean, extraHint?: string): string {
  const strictRule = strictJson
    ? "You MUST output a single JSON object only. No markdown, no code fences, no explanations."
    : "Output a single JSON object only.";

  const hint = extraHint ? `\n${extraHint}` : "";

  return [
    "You are a tool-planning engine.",
    strictRule,
    "Detect the user's language and respond in the same language.",
    "Return exactly one action object with fields {\"type\", \"params\"}.",
    "Use tool calls as {\"type\":\"tool.call\",\"params\":{\"tool\":\"...\",\"op\":\"...\",\"args\":{...}}}.",
    "You MUST only use tool names and ops provided in tools_context._tools.schema. Never invent tools or ops.",
    "Runtime context may include tools_context.{toolName}. If tools_context._tools.schema defines a resource field, use tools_context.{toolName}.{resource} for matching.",
    "Use skill calls as {\"type\":\"skill.call\",\"params\":{\"name\":\"...\",\"input\":\"...\"}}.",
    "Skills are tool-agnostic; use skill.call to select a skill and read its detail when needed.",
    "If skills_context.{skill}.has_handler is true, you may execute via skill.call with params.input; otherwise use skill.call to request detail (no input).",
    "If skills_context.{skill}.terminal is true and a command is provided, prefer terminal tool execution: {\"type\":\"tool.call\",\"params\":{\"tool\":\"terminal\",\"op\":\"exec\",\"args\":{\"command\":\"<command>\",\"args\":[...]}}}.",
    "Do not invent other tool actions for terminal skills; use the command and args implied by the skill and user request.",
    "Use skills_context.{skill}.keywords and tools_context._tools.schema[*].keywords to match user intent; prefer skill matches for personal productivity tasks and tool matches for device/control tasks.",
    "Use llm.call as {\"type\":\"llm.call\",\"params\":{\"promptText\":\"...\",\"context\":{...}}} to request another reasoning step.",
    "When returning llm.call, put any extra LLM context into params.context (not as a separate tool/skill list).",
    "When you return tool.call, include params.on_success and params.on_failure as action objects to be used after tool execution.",
    "When next_step_context is provided, follow its instruction with highest priority and avoid re-listing full tool/skill catalogs.",
    "If no tool is suitable, you may return {\"type\":\"respond\",\"params\":{\"text\":\"...\"}} to answer the user directly.",
    "If runtime context contains action_history, use it to avoid repeating tool calls.",
    "",
    "Action schema:",
    actionSchema
  ].join("\n") + hint;
}

export function buildUserPrompt(text: string, runtimeContext: LLMRuntimeContext, hasImages?: boolean): string {
  const context = JSON.stringify(runtimeContext, null, 2);
  return [
    "User input:",
    text,
    ...(hasImages ? ["", "Note: An image is attached to this message."] : []),
    "",
    "Runtime context:",
    context
  ].join("\n");
}
