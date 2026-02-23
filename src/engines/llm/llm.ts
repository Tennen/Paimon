import { SkillSelectionResult, SkillPlanningResult } from "../../types";

export type LLMRuntimeContext = {
  now: string;
  timezone: string;
  memory?: string;
  action_history?: Array<{
    iteration: number;
    action: { type: string; params: Record<string, unknown> };
  }>;
  tools_context?: Record<string, Record<string, unknown>> | null;
  skills_context?: Record<string, { description?: string; command?: string; terminal?: boolean; has_handler?: boolean; keywords?: string[] }> | null;
  next_step_context?: Record<string, unknown> | null;
};

export type LLMPlanMeta = {
  llm_provider: "ollama";
  model: string;
  retries: number;
  parse_ok: boolean;
  raw_output_length: number;
  fallback: boolean;
};

export interface LLMEngine {
  selectSkill(text: string, runtimeContext: Record<string, unknown>): Promise<SkillSelectionResult>;
  planToolExecution(text: string, runtimeContext: Record<string, unknown>): Promise<SkillPlanningResult>;
}

export type LLMPlanResult = {
  action: unknown;
  meta: LLMPlanMeta;
};
