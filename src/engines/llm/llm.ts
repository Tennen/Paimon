import { SkillSelectionResult, SkillPlanningResult } from "../../types";

export type LLMProvider = "ollama" | "llama-server" | "openai" | "gemini" | "gpt-plugin" | "codex";

export type LLMRuntimeContext = {
  now?: string;
  timezone?: string;
  isoTime?: string;
  userTimezone?: string;
  memory?: string;
  skill_detail?: string;
  planning_mode?: string;
  skill_contract?: Record<string, unknown> | null;
  thinking_budget?: Record<string, unknown> | null;
  action_history?: Array<{
    iteration: number;
    action: { type: string; params: Record<string, unknown> };
  }>;
  tools_context?: Record<string, Record<string, unknown>> | null;
  skills_context?: Record<string, { description?: string; command?: string; terminal?: boolean; tool?: string; action?: string; params?: string[]; keywords?: string[] }> | null;
  next_step_context?: Record<string, unknown> | null;
  [key: string]: unknown;
};

export type LLMPlanMeta = {
  llm_provider: LLMProvider;
  model: string;
  retries: number;
  parse_ok: boolean;
  raw_output_length: number;
  fallback: boolean;
};

export type LLMExecutionStep = "routing" | "planning";
export type LLMChatStep = "general" | LLMExecutionStep;

export type LLMChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
  images?: string[];
};

export type LLMEngineSystemPromptMode = "replace" | "append";

export type LLMChatRequest = {
  messages: LLMChatMessage[];
  step?: LLMChatStep;
  model?: string;
  timeoutMs?: number;
  engineSystemPrompt?: string;
  engineSystemPromptMode?: LLMEngineSystemPromptMode;
  options?: Record<string, unknown>;
  keepAlive?: number;
  planningOptions?: LLMPlanningOptions;
};

export type LLMPlanningOptions = {
  thinkingBudgetOverride?: number;
};

export interface LLMEngine {
  chat(request: LLMChatRequest): Promise<string>;
  route(text: string, runtimeContext: Record<string, unknown>): Promise<SkillSelectionResult>;
  plan(
    text: string,
    runtimeContext: Record<string, unknown>,
    planningOptions?: LLMPlanningOptions
  ): Promise<SkillPlanningResult>;
  getModelForStep(step: LLMExecutionStep): string;
  getProviderName(): LLMProvider;
}

export type LLMPlanResult = {
  action: unknown;
  meta: LLMPlanMeta;
};
