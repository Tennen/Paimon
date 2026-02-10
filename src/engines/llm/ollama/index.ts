import { Action } from "../../../types";
import { LLMEngine, LLMPlanMeta, LLMPlanResult, LLMRuntimeContext } from "../llm";
import { mockLLM } from "../../../mockLLM";
import { ollamaChat } from "./client";
import { buildSystemPrompt, buildUserPrompt } from "./prompt";
import { parseAction } from "./parser";

export type OllamaLLMOptions = {
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
  strictJson: boolean;
};

export class OllamaLLMEngine implements LLMEngine {
  private readonly options: OllamaLLMOptions;

  constructor(options?: Partial<OllamaLLMOptions>) {
    this.options = {
      baseUrl: options?.baseUrl ?? process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
      model: options?.model ?? process.env.OLLAMA_MODEL ?? "qwen3:4b",
      timeoutMs: options?.timeoutMs ?? parseInt(process.env.LLM_TIMEOUT_MS ?? "30000", 10),
      maxRetries: options?.maxRetries ?? parseInt(process.env.LLM_MAX_RETRIES ?? "2", 10),
      strictJson: options?.strictJson ?? (process.env.LLM_STRICT_JSON ?? "true") === "true"
    };
  }

  async plan(text: string, runtimeContext: LLMRuntimeContext, actionSchema: string, images?: string[]): Promise<Action> {
    const result = await this.planWithMeta(text, runtimeContext, actionSchema, images);
    return result.action;
  }

  async planWithMeta(text: string, runtimeContext: LLMRuntimeContext, actionSchema: string, images?: string[]): Promise<LLMPlanResult> {
    const basePrompt = buildSystemPrompt(actionSchema, this.options.strictJson, undefined, runtimeContext);
    let retries = 0;
    let lastRaw = "";
    const userPrompt = buildUserPrompt(text, runtimeContext, !!(images && images.length));
    const logPrompts = process.env.LLM_LOG_PROMPTS === "true";

    for (let attempt = 0; attempt <= this.options.maxRetries; attempt += 1) {
      const extraHint = attempt > 0 ? "Output MUST be valid JSON only. No other text." : undefined;
      const systemPrompt = attempt > 0
        ? buildSystemPrompt(actionSchema, this.options.strictJson, extraHint, runtimeContext)
        : basePrompt;

      try {
        if (logPrompts) {
          console.log(`[LLM][${this.options.model}][attempt ${attempt}] system_prompt:\n${systemPrompt}`);
          console.log(`[LLM][${this.options.model}][attempt ${attempt}] user_prompt:\n${userPrompt}`);
        }
        lastRaw = await ollamaChat({
          baseUrl: this.options.baseUrl,
          model: this.options.model,
          timeoutMs: this.options.timeoutMs,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt, images }
          ]
        });
        if (logPrompts) {
          console.log(`[LLM][${this.options.model}][attempt ${attempt}] raw_output:\n${lastRaw}`);
        }

        const action = parseAction(lastRaw);
        return {
          action,
          meta: {
            llm_provider: "ollama",
            model: this.options.model,
            retries,
            parse_ok: true,
            raw_output_length: lastRaw.length,
            fallback: false
          }
        };
      } catch (err) {
        console.error("ollamaChat failed", err);
        if (attempt < this.options.maxRetries) {
          retries += 1;
          continue;
        }
      }
    }

    const fallbackAction = await mockLLM(text);
    const meta: LLMPlanMeta = {
      llm_provider: "ollama",
      model: this.options.model,
      retries,
      parse_ok: false,
      raw_output_length: lastRaw.length,
      fallback: true
    };

    return { action: fallbackAction, meta };
  }
}
