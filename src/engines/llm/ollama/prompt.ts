import { LLMRuntimeContext } from "../llm";

export enum PromptMode {
  SkillSelection = "skill_selection",
  SkillPlanning = "skill_planning",
  PlannerError = "planner_error",
}

function detectPromptMode(runtimeContext?: LLMRuntimeContext): PromptMode {
  const kind = runtimeContext?.next_step_context && typeof runtimeContext.next_step_context === "object"
    ? (runtimeContext.next_step_context as Record<string, unknown>).kind
    : null;
  if (kind === "skill_detail") return PromptMode.SkillPlanning;
  if (kind === "planner_error") return PromptMode.PlannerError;
  if (kind === "skill_selection") return PromptMode.SkillSelection;
  return PromptMode.SkillSelection;
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

  const baseRules = [
    "You are a smart task assistant that helps users accomplish their goals.",
    strictRule,
    "Detect the user's language and respond in the same language.",
    "",
    "Output rules:",
    "- Return exactly one action object with fields {\"type\",\"params\"}.",
    "- Follow the Action schema constraints; do not invent actions, tools, or skills.",
    "- Never output llm.call.",
  ];

  const modeSpecificInstructions =
    mode === PromptMode.SkillSelection
      ? getSkillSelectionInstructions()
    : mode === PromptMode.SkillPlanning
      ? getSkillPlanningInstructions()
    : mode === PromptMode.PlannerError
      ? getPlannerErrorInstructions()
      : getSkillSelectionInstructions();

  return [...baseRules, ...modeSpecificInstructions, "", "Action schema:", actionSchema].join("\n") + hint;
}

function getSkillSelectionInstructions(): string[] {
  return [
    "=== Step 1: Skill Selection ===",
    "Your task is to analyze the user's request and decide which skill to use.",
    "- Review skills_context: Each skill has a description, keywords, and capabilities.",
    "- Review tools_context._tools.schema: Available tools for direct control.",
    "- Decision making:",
      "* Use 'respond' if the request is conversational or doesn't need any tool/skill.",
      "* Use 'skill_call' with skill name if you need to use a specific skill's functionality.",
      "* Use 'tool_call' ONLY if you need to control a device directly (e.g., lights, switches).",
    "- Important: Do not use tool_call for skill operations. Skills handle the complexity.",
    "- Match user intent using skill keywords and descriptions.",
    "Output format:",
      "* For skill: {\"type\":\"skill_call\",\"params\":{\"name\":\"skill_name\"}}",
      "* For direct response: {\"type\":\"respond\",\"params\":{\"text\":\"message\"}}",
  ];
}

function getSkillPlanningInstructions(): string[] {
  return [
    "=== Step 2: Skill Planning ===",
    "You have selected a skill and now need to plan the specific tool execution.",
    "- next_step_context.skill_detail contains the full skill documentation.",
    "- next_step_context.tools_context contains only relevant tools for this skill.",
    "- Your task:",
      "* Analyze the skill detail and user request.",
      "* Plan exactly ONE tool call that accomplishes the task.",
      "* Include on_success and on_failure response templates.",
    "- Tool call structure:",
      "{\"type\":\"tool_call\",\"params\":{\"tool\":\"tool_name\",\"op\":\"operation\",params:{...},\"on_success\":{\"type\":\"respond\",\"params\":{\"text\":\"success message\"}},\"on_failure\":{\"type\":\"respond\",\"params\":{\"text\":\"error message\"}}}}",
    "- Requirements:",
      "* on_success/on_failure MUST be respond type with appropriate text.",
      "* Text should be specific to the operation, not generic.",
      "* Include relevant details from tool result in success message if helpful.",
    "- Use only tools listed in next_step_context.tools_context.",
  ];
}

function getPlannerErrorInstructions(): string[] {
  return [
    "=== Planner Error Recovery ===",
    "A previous action was invalid. Review the error and choose a correct action.",
    "- next_step_context.error: The error message describing what went wrong.",
    "- next_step_context.allowed_tools: List of valid tool names.",
    "- next_step_context.allowed_skills: List of valid skill names.",
    "- next_step_context.allowed_ops (if present): Valid operations for the selected tool.",
    "- Your task:",
      "* Choose a valid tool/skill from the allowed lists.",
      "* If choosing a tool, use an allowed operation.",
      "* Provide a correct action that resolves the error.",
    "- Output: Return a valid action object matching Action schema.",
  ];
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
