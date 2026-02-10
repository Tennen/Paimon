import { LLMRuntimeContext } from "../llm";

type PromptMode = "initial" | "skill_detail" | "tool_result" | "skill_result" | "default";

function detectPromptMode(runtimeContext?: LLMRuntimeContext): PromptMode {
  const kind = runtimeContext?.next_step_context && typeof runtimeContext.next_step_context === "object"
    ? (runtimeContext.next_step_context as Record<string, unknown>).kind
    : null;
  if (kind === "skill_detail") return "skill_detail";
  if (kind === "tool_result") return "tool_result";
  if (kind === "skill_result") return "skill_result";
  if (runtimeContext?.next_step_context) return "default";
  return "initial";
}

export function buildSystemPrompt(
  actionSchema: string,
  strictJson: boolean,
  extraHint?: string,
  runtimeContext?: LLMRuntimeContext
): string {
  const strictRule = strictJson
    ? "You MUST output a single JSON object only. No markdown, no code fences, no explanations."
    : "Output a single JSON object only.";

  const hint = extraHint ? `\n${extraHint}` : "";
  const mode = detectPromptMode(runtimeContext);

  return [
    "You are a tool-planning engine.",
    strictRule,
    "Detect the user's language and respond in the same language.",
    "",
    "Output rules:",
    "- Return exactly one action object with fields {\"type\",\"params\"}.",
    "- Follow the Action schema constraints; do not invent actions, tools, or skills.",
    "- Never output llm.call.",
    "",
    ...(mode === "initial"
      ? [
          "Initial planning:",
          "- Use tools_context._tools.schema (tool list) and skills_context keys (skill list) to decide whether this is a tool or skill task.",
          "- Prefer skill for personal productivity intent; prefer tool for device/control intent.",
          "- Only use tool/op listed in tools_context._tools.schema.",
          "- Use keywords from tools_context._tools.schema[*].keywords and skills_context.{skill}.keywords to match intent.",
          "- If no tool/skill is suitable, return respond."
        ]
      : []),
    ...(mode === "skill_detail"
      ? [
          "Skill planning:",
          "- next_step_context contains the selected skill detail.",
          "- Decide the next action based on the skill detail and user request.",
          "- If terminal skill with command, prefer tool.call to terminal.exec.",
          "- When returning tool.call, include on_success/on_failure actions."
        ]
      : []),
    ...(mode === "tool_result"
      ? [
          "Tool result followup:",
          "- next_step_context contains tool_result.",
          "- Use the tool_result to decide the next action (respond or another tool/skill)."
        ]
      : []),
    ...(mode === "skill_result"
      ? [
          "Skill result followup:",
          "- next_step_context contains skill_result.",
          "- Use the skill_result to decide the next action (respond or another tool/skill)."
        ]
      : []),
    ...(mode === "default"
      ? [
          "Followup:",
          "- next_step_context is provided; follow its instruction with highest priority."
        ]
      : []),
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
