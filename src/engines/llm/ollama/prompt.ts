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
    "",
    "Output rules:",
    "- Return exactly one action object with fields {\"type\",\"params\"}.",
    "- Follow the Action schema constraints; do not invent actions, tools, or skills.",
    "",
    "Tool selection:",
    "- Only use tool/op listed in tools_context._tools.schema.",
    "- If a tool schema defines a resource field, use tools_context.{toolName}.{resource} for matching.",
    "- Use tools_context._tools.schema[*].keywords to match device/control intent.",
    "",
    "Skill selection:",
    "- Skills are tool-agnostic; use skill.call to select a skill and read its detail when needed.",
    "- If skills_context.{skill}.has_handler is true, you may execute via skill.call with params.input.",
    "- If skills_context.{skill}.terminal is true and a command is provided, prefer terminal tool execution.",
    "- Use skills_context.{skill}.keywords to match personal productivity intent.",
    "",
    "Planning flow:",
    "- Use llm.call to request another reasoning step; put extra LLM context into params.context.",
    "- When returning tool.call, include params.on_success and params.on_failure as action objects.",
    "- If next_step_context is provided, follow its instruction with highest priority.",
    "- If runtime context contains action_history, use it to avoid repeating tool calls.",
    "- If no tool/skill is suitable, return respond with text.",
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
