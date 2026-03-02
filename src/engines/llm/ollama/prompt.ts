import { LLMRuntimeContext } from "../llm";

export enum PromptMode {
  SkillSelection = "skill_selection",
  SkillPlanning = "skill_planning",
}

type UserPromptOptions = {
  hasImages?: boolean;
  mode?: PromptMode;
};

const DEFAULT_THINKING_BUDGET = 1024;
const DEFAULT_THINKING_BUDGET_MIN = 1;
const DEFAULT_THINKING_BUDGET_MAX = 32768;

function toRecord(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  return input as Record<string, unknown>;
}

function parsePositiveInteger(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0 || !Number.isInteger(numeric)) {
    return null;
  }
  return numeric;
}

function parseBooleanValue(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return null;
  }
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function buildThinkingBudgetContext(context: Record<string, unknown>): Record<string, unknown> {
  const source = toRecord(context.thinking_budget);
  const envEnabled = parseBooleanValue(process.env.LLM_THINKING_BUDGET_ENABLED) ?? false;
  const envDefaultBudget = parsePositiveInteger(process.env.LLM_THINKING_BUDGET) ?? DEFAULT_THINKING_BUDGET;
  const envMax = parsePositiveInteger(process.env.LLM_THINKING_MAX_NEW_TOKENS) ?? DEFAULT_THINKING_BUDGET_MAX;

  const min = parsePositiveInteger(source?.min) ?? DEFAULT_THINKING_BUDGET_MIN;
  const maxCandidate = parsePositiveInteger(source?.max) ?? envMax;
  const max = Math.max(min, maxCandidate);

  const enabled = parseBooleanValue(source?.enabled) ?? envEnabled;
  const defaultBudgetRaw = parsePositiveInteger(source?.default_budget) ?? envDefaultBudget;
  const defaultBudget = clamp(defaultBudgetRaw, min, max);

  return {
    enabled,
    default_budget: defaultBudget,
    min,
    max
  };
}

function detectPromptMode(runtimeContext?: LLMRuntimeContext): PromptMode {
  const context = toRecord(runtimeContext);
  const nextStep = toRecord(context?.next_step_context);
  const kind = typeof nextStep?.kind === "string" ? nextStep.kind : null;
  if (kind === PromptMode.SkillPlanning || kind === "skill_detail" || kind === "tool_planning") {
    return PromptMode.SkillPlanning;
  }
  if (kind === PromptMode.SkillSelection || kind === "skill_selection") {
    return PromptMode.SkillSelection;
  }
  if (typeof context?.skill_detail === "string" || toRecord(context?.tools_context)) {
    return PromptMode.SkillPlanning;
  }
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
    "Keep JSON keys/enum values/tool names/operation names/argument names exactly as defined in CONTEXT_JSON.",
    "Use the user's language for natural-language values (for example: response_text, success_response, failure_response, and user-facing text parameters).",
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
    "Read the user prompt sections in order: USER_REQUEST -> CONTEXT_JSON.",
    "Use CONTEXT_JSON.skills_context as the source of available skills.",
    "",
    "Output format:",
    '  {"decision":"respond","response_text":"your response here"}',
    '  OR',
    '  {"decision":"use_skill","skill_name":"skill_name","planning_thinking_budget":1024}',
    "",
    "Decision logic:",
    "- If request is conversational or doesn't need tools, use decision='respond'",
    "- If request requires a skill, use decision='use_skill' with skill_name from CONTEXT_JSON.skills_context",
    "- If CONTEXT_JSON.thinking_budget.enabled=true and decision='use_skill', planning_thinking_budget is required",
    "- planning_thinking_budget must be an integer within [CONTEXT_JSON.thinking_budget.min, CONTEXT_JSON.thinking_budget.max]",
    "- If CONTEXT_JSON.thinking_budget.enabled=false, omit planning_thinking_budget",
    "- Keep decision/skill_name keys and decision values in English exactly as specified",
  ];
}

function getSkillPlanningInstructions(): string[] {
  return [
    "=== Step 2: Skill Planning ===",
    "You have selected a skill. Plan the tool execution.",
    "Read the user prompt sections in order: USER_REQUEST -> CONTEXT_JSON.",
    "Understand skill intent from CONTEXT_JSON.selected_skill.detail.",
    "If CONTEXT_JSON.skill_runtime_contract exists, it has highest priority for tool/action/params shape.",
    "Use the tool/action from CONTEXT_JSON.tools_schema.",
    "Use CONTEXT_JSON.tools_context runtime data to fill params (entity_id/device names/etc).",
    "",
    "Output format:",
    '{',
    '  "tool": "tool_name",',
    '  "action": "operation",',
    '  "params": {...},',
    '  "success_response": "success message",',
    '  "failure_response": "error message"',
    '}',
    "",
    "Requirements:",
    "- Do not invent tool names or operations outside CONTEXT_JSON.tools_schema",
    "- For the selected tool/action, params keys must strictly match the params defined in CONTEXT_JSON.tools_schema (no extra keys, no missing required keys)",
    "- For params typed as string[], each array element must be one complete value/token; keep values containing spaces as a single element",
    "- Use tools_schema descriptions (tool description / operation description / param_descriptions) when available to pick the right operation and arguments",
    "- success_response/failure_response should be specific to the operation",
    "- Do not overthinking"
  ];
}

function buildCurrentTimeBlock(context: Record<string, unknown>): Record<string, string> {
  return {
    isoTime: typeof context.isoTime === "string" ? context.isoTime : "",
    userTimezone: typeof context.userTimezone === "string" ? context.userTimezone : ""
  };
}

function omitKeys(context: Record<string, unknown>, excluded: string[]): Record<string, unknown> {
  const blocked = new Set(excluded);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (!blocked.has(key)) {
      out[key] = value;
    }
  }
  return out;
}

function buildSelectionRuntimeContext(context: Record<string, unknown>): Record<string, unknown> {
  const skillsContext = toRecord(context.skills_context);
  const nextStep = toRecord(context.next_step_context);
  const base: Record<string, unknown> = {
    current_time: buildCurrentTimeBlock(context),
    skills_context: skillsContext ?? null,
    skill_names: skillsContext ? Object.keys(skillsContext).sort() : [],
    thinking_budget: buildThinkingBudgetContext(context)
  };

  if (nextStep) {
    base.next_step_context = nextStep;
  }

  if (typeof context.memory === "string" && context.memory.trim().length > 0) {
    base.memory = context.memory;
  }

  const others = omitKeys(context, ["now", "timezone", "memory", "skills_context", "next_step_context", "thinking_budget"]);
  if (Object.keys(others).length > 0) {
    base.other_context = others;
  }

  return base;
}

function extractToolsSchema(toolsContext: Record<string, unknown> | null): Array<Record<string, unknown>> {
  const toolsMeta = toRecord(toolsContext?._tools);
  const schema = toolsMeta?.schema;
  if (!Array.isArray(schema)) {
    return [];
  }
  return schema
    .map((item) => toRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));
}

function extractToolRuntimeData(toolsContext: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!toolsContext) {
    return null;
  }

  const entries = Object.entries(toolsContext).filter(([name]) => name !== "_tools");
  if (entries.length === 0) {
    return null;
  }
  return Object.fromEntries(entries);
}

function buildPlanningRuntimeContext(context: Record<string, unknown>): Record<string, unknown> {
  const toolsContext = toRecord(context.tools_context);
  const nextStep = toRecord(context.next_step_context);
  const selectedSkillDetail = typeof context.skill_detail === "string" ? context.skill_detail : "";
  const base: Record<string, unknown> = {
    current_time: buildCurrentTimeBlock(context),
    selected_skill: {
      detail: selectedSkillDetail
    },
    tools_schema: extractToolsSchema(toolsContext),
    tools_context: extractToolRuntimeData(toolsContext)
  };

  if (nextStep) {
    base.next_step_context = nextStep;
  }

  if (typeof context.memory === "string" && context.memory.trim().length > 0) {
    base.memory = context.memory;
  }

  const others = omitKeys(context, ["isoTime", "userTimezone", "memory", "tools_context", "skill_detail", "next_step_context"]);
  if (Object.keys(others).length > 0) {
    base.other_context = others;
  }

  return base;
}

function buildReadableRuntimeContext(mode: PromptMode, runtimeContext: LLMRuntimeContext): Record<string, unknown> {
  const context = toRecord(runtimeContext) ?? {};
  return mode === PromptMode.SkillPlanning
    ? buildPlanningRuntimeContext(context)
    : buildSelectionRuntimeContext(context);
}

export function buildUserPrompt(
  text: string,
  runtimeContext: LLMRuntimeContext,
  options: UserPromptOptions = {}
): string {
  const mode = options.mode ?? detectPromptMode(runtimeContext);
  const context = JSON.stringify(buildReadableRuntimeContext(mode, runtimeContext), null, 2);

  return [
    "=== USER_REQUEST ===",
    text,
    ...(options.hasImages ? ["", "=== IMAGE_NOTE ===", "An image is attached to this user request."] : []),
    "",
    "=== CONTEXT_JSON ===",
    context
  ].join("\n");
}
