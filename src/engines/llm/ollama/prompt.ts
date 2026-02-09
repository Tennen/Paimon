import { LLMRuntimeContext } from "../llm";

export function buildSystemPrompt(toolSchema: string, strictJson: boolean, extraHint?: string): string {
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
    "Runtime context may include tools_context.{toolName}. If a tool schema defines a resource field, use tools_context.{toolName}.{resource} for matching.",
    "Use skill calls as {\"type\":\"skill.call\",\"params\":{\"name\":\"...\",\"input\":\"...\"}}.",
    "If no tool is suitable, you may return {\"type\":\"respond\",\"params\":{\"text\":\"...\"}} to answer the user directly.",
    "If runtime context contains action_history, use it to avoid repeating tool calls.",
    "",
    "Tool schema:",
    toolSchema
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
