import { LLMRuntimeContext } from "../llm";

export enum PromptMode {
  SkillSelection = "skill_selection",
  SkillPlanning = "skill_planning",
}

function detectPromptMode(runtimeContext?: LLMRuntimeContext): PromptMode {
  const kind = runtimeContext?.next_step_context && typeof runtimeContext.next_step_context === "object"
    ? (runtimeContext.next_step_context as Record<string, unknown>).kind
    : null;
  if (kind === "skill_detail") return PromptMode.SkillPlanning;
  if (kind === "skill_selection") return PromptMode.SkillSelection;
  return PromptMode.SkillSelection;
}

export function buildSystemPrompt(
  mode: PromptMode,
  strictJson: boolean,
  extraHint?: string
): string {
  const strictRule = strictJson
    ? "You MUST output a single JSON object only. No markdown, no code fences, no explanations."
    : "Output a single JSON object only.";

  const hint = extraHint ? `\n${extraHint}` : "";

  const baseRules = [
    "You are a smart task assistant that helps users accomplish their goals.",
    strictRule,
    "Detect the user's language and respond in the same language.",
  ];

  const modeSpecificInstructions =
    mode === PromptMode.SkillSelection
      ? getSkillSelectionInstructions()
    : mode === PromptMode.SkillPlanning
      ? getSkillPlanningInstructions()
      : getSkillSelectionInstructions();

  return [...baseRules, ...modeSpecificInstructions].join("\n") + hint;
}

function getSkillSelectionInstructions(): string[] {
  return [
    "=== Step 1: Skill Selection ===",
    "Your task is to analyze the user's request and decide how to respond.",
    "",
    "Review skills_context for available skills.",
    "",
    "Output format:",
    '  {"decision":"respond","response_text":"your response here"}',
    '  OR',
    '  {"decision":"use_skill","skill_name":"skill_name"}',
    "",
    "Decision logic:",
    "- If request is conversational or doesn't need tools, use decision='respond'",
    "- If request requires a skill, use decision='use_skill' with skill_name from skills_context",
  ];
}

function getSkillPlanningInstructions(): string[] {
  return [
    "=== Step 2: Skill Planning ===",
    "You have selected a skill. Plan the tool execution.",
    "",
    "Output format:",
    '{',
    '  "tool": "tool_name",',
    '  "op": "operation",',
    '  "args": {...},',
    '  "success_response": "success message",',
    '  "failure_response": "error message"',
    '}',
    "",
    "Requirements:",
    "- Use only tools in tools_context",
    "- success_response/failure_response should be specific to the operation",
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
