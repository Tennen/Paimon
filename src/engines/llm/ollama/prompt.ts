import { LLMRuntimeContext } from "../llm";

export function buildSystemPrompt(runtimeContext: LLMRuntimeContext, toolSchema: string, strictJson: boolean, extraHint?: string): string {
  const strictRule = strictJson
    ? "You MUST output a single JSON object only. No markdown, no code fences, no explanations."
    : "Output a single JSON object only.";

  const hint = extraHint ? `\n${extraHint}` : "";

  return [
    "You are a tool-planning engine.",
    strictRule,
    "Detect the user's language and respond in the same language.",
    "Return exactly one action object with fields {\"type\", \"params\"}.",
    "If no tool is suitable, you may respond the user directly.",
    "",
    "Tool schema:",
    toolSchema,
    "",
    "Runtime context:",
    JSON.stringify(runtimeContext, null, 2)
  ].join("\n") + hint;
}
