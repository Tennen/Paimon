import { Action } from "../../types";

export type LLMRuntimeContext = {
  now: string;
  timezone: string;
  memory?: string;
  action_history?: Array<{
    iteration: number;
    action: { type: string; params: Record<string, unknown> };
  }>;
  tools_context?: Record<string, Record<string, unknown>> | null;
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
  plan(text: string, runtimeContext: LLMRuntimeContext, toolSchema: string, images?: string[]): Promise<Action>;
}

export type LLMPlanResult = {
  action: Action;
  meta: LLMPlanMeta;
};
