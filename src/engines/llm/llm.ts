import { Action } from "../../types";

export type LLMRuntimeContext = {
  now: string;
  timezone: string;
  defaults?: Record<string, unknown>;
  allowed_ha_entities?: string[];
  ha_entities?: Array<{
    entity_id: string;
    name: string;
    area?: string;
    device?: string;
    domain?: string;
  }>;
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
  plan(text: string, runtimeContext: LLMRuntimeContext, toolSchema: string): Promise<Action>;
}

export type LLMPlanResult = {
  action: Action;
  meta: LLMPlanMeta;
};
