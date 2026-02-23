import { LLMEngine, LLMRuntimeContext, LLMPlanMeta, LLMExecutionStep } from "../llm";
import { mockLLM } from "../../../mockLLM";
import { ollamaChat } from "./client";
import { buildSystemPrompt, buildUserPrompt, PromptMode } from "./prompt";
import { parseSkillSelectionResult, parseSkillPlanningResult } from "../../../core/json_guard";

export type OllamaLLMOptions = {
  baseUrl: string;
  model: string;
  planningModel: string;
  timeoutMs: number;
  planningTimeoutMs: number;
  maxRetries: number;
  strictJson: boolean;
};

export class OllamaLLMEngine implements LLMEngine {
  private readonly options: OllamaLLMOptions;

  constructor(options?: Partial<OllamaLLMOptions>) {
    const defaultModel = options?.model ?? process.env.OLLAMA_MODEL ?? "qwen3:4b";
    const defaultTimeoutMs = parseInt(process.env.LLM_TIMEOUT_MS ?? "30000", 10);

    this.options = {
      baseUrl: options?.baseUrl ?? process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
      model: defaultModel,
      planningModel: options?.planningModel ?? process.env.OLLAMA_PLANNING_MODEL ?? defaultModel,
      timeoutMs: options?.timeoutMs ?? defaultTimeoutMs,
      planningTimeoutMs: options?.planningTimeoutMs ?? parseInt(process.env.LLM_PLANNING_TIMEOUT_MS ?? String(defaultTimeoutMs), 10),
      maxRetries: options?.maxRetries ?? parseInt(process.env.LLM_MAX_RETRIES ?? "2", 10),
      strictJson: options?.strictJson ?? (process.env.LLM_STRICT_JSON ?? "true") === "true"
    };
  }

  getModelForStep(step: LLMExecutionStep): string {
    return step === "skill_planning" ? this.options.planningModel : this.options.model;
  }

  async selectSkill(
    text: string,
    runtimeContext: LLMRuntimeContext
  ): Promise<{ decision: "respond" | "use_skill"; skill_name?: string; response_text?: string }> {
    const mode = PromptMode.SkillSelection;
    const model = this.options.model;
    const userPrompt = buildUserPrompt(text, runtimeContext);
    const logPrompts = process.env.LLM_LOG_PROMPTS === "true";

    let retries = 0;
    let lastRaw = "";

    for (let attempt = 0; attempt <= this.options.maxRetries; attempt += 1) {
      const extraHint = attempt > 0 ? "Output MUST be valid JSON only. No other text." : undefined;
      const systemPrompt = buildSystemPrompt(mode, this.options.strictJson, extraHint);

      try {
        if (logPrompts) {
          console.log(`[LLM][${model}][attempt ${attempt}] system_prompt:\n${systemPrompt}`);
          console.log(`[LLM][${model}][attempt ${attempt}] user_prompt:\n${userPrompt}`);
        }
        lastRaw = await ollamaChat({
          baseUrl: this.options.baseUrl,
          model,
          // keepAlive: -1,
          timeoutMs: this.options.timeoutMs,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ]
        });
        if (logPrompts) {
          console.log(`[LLM][${model}][attempt ${attempt}] raw_output:\n${lastRaw}`);
        }

        const result = parseSkillSelectionResult(lastRaw);
        return result;
      } catch (err) {
        console.error("ollamaChat failed", err);
        if (attempt < this.options.maxRetries) {
          retries += 1;
          continue;
        }
      }
    }

    const fallbackResult = await mockLLM(text);
    if (fallbackResult && "decision" in fallbackResult) {
      return fallbackResult as { decision: "respond" | "use_skill"; skill_name?: string; response_text?: string };
    }
    return { decision: "respond", response_text: "OK" };
  }

  async planToolExecution(
    text: string,
    runtimeContext: LLMRuntimeContext
  ): Promise<{ tool: string; op: string; args: Record<string, unknown>; success_response: string; failure_response: string }> {
    const mode = PromptMode.SkillPlanning;
    const model = this.options.planningModel;
    const userPrompt = buildUserPrompt(text, runtimeContext);
    const logPrompts = process.env.LLM_LOG_PROMPTS === "true";

    let retries = 0;
    let lastRaw = "";

    for (let attempt = 0; attempt <= this.options.maxRetries; attempt += 1) {
      const extraHint = attempt > 0 ? "Output MUST be valid JSON only. No other text." : undefined;
      const systemPrompt = buildSystemPrompt(mode, this.options.strictJson, extraHint);

      try {
        if (logPrompts) {
          console.log(`[LLM][${model}][attempt ${attempt}] system_prompt:\n${systemPrompt}`);
          console.log(`[LLM][${model}][attempt ${attempt}] user_prompt:\n${userPrompt}`);
        }
        lastRaw = await ollamaChat({
          baseUrl: this.options.baseUrl,
          model,
          timeoutMs: this.options.planningTimeoutMs,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ]
        });
        if (logPrompts) {
          console.log(`[LLM][${model}][attempt ${attempt}] raw_output:\n${lastRaw}`);
        }

        const result = parseSkillPlanningResult(lastRaw);
        return result;
      } catch (err) {
        console.error("ollamaChat failed", err);
        if (attempt < this.options.maxRetries) {
          retries += 1;
          continue;
        }
      }
    }

    const fallbackResult = await mockLLM(text);
    if (fallbackResult && "tool" in fallbackResult) {
      return fallbackResult as { tool: string; op: string; args: Record<string, unknown>; success_response: string; failure_response: string };
    }
    return {
      tool: "unknown",
      op: "unknown",
      args: {},
      success_response: "Tool execution succeeded",
      failure_response: "Tool execution failed"
    };
  }

  getMeta(retries: number, parseOk: boolean, rawOutputLength: number, fallback: boolean): LLMPlanMeta {
    return {
      llm_provider: "ollama",
      model: this.options.model,
      retries,
      parse_ok: parseOk,
      raw_output_length: rawOutputLength,
      fallback
    };
  }
}
