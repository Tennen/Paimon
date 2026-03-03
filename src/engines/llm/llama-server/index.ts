import { LLMEngine, LLMRuntimeContext, LLMExecutionStep } from "../llm";
import { buildSystemPrompt, buildUserPrompt, PromptMode } from "../ollama/prompt";
import { parseSkillSelectionResult, parseSkillPlanningResult } from "../json_guard";
import { llamaServerChat, LlamaServerChatOptions } from "./client";

export type LlamaServerLLMOptions = {
  baseUrl: string;
  model: string;
  planningModel: string;
  timeoutMs: number;
  planningTimeoutMs: number;
  maxRetries: number;
  strictJson: boolean;
  apiKey?: string;
  selectionOptions?: LlamaServerChatOptions;
  planningOptions?: LlamaServerChatOptions;
  chatTemplateKwargs?: Record<string, unknown> | null;
  planningChatTemplateKwargs?: Record<string, unknown> | null;
  extraBody?: Record<string, unknown> | null;
  planningExtraBody?: Record<string, unknown> | null;
};

export class LlamaServerLLMEngine implements LLMEngine {
  private readonly options: LlamaServerLLMOptions;

  private static readonly DEFAULT_PLANNING_OPTIONS: LlamaServerChatOptions = {
    temperature: 0.6,
    top_p: 0.95,
    top_k: 20,
    min_p: 0,
    max_tokens: 32768,
    presence_penalty: 0
  };

  constructor(options?: Partial<LlamaServerLLMOptions>) {
    const defaultModel = options?.model
      ?? process.env.LLAMA_SERVER_MODEL
      ?? process.env.OLLAMA_MODEL
      ?? "qwen3";
    const defaultTimeoutMs = parsePositiveInteger(process.env.LLM_TIMEOUT_MS, 30000);

    const selectionOptions = options?.selectionOptions
      ?? parseChatOptions(process.env.LLAMA_SERVER_CHAT_OPTIONS, undefined, "LLAMA_SERVER_CHAT_OPTIONS");
    const planningOptions = options?.planningOptions
      ?? parseChatOptions(
        process.env.LLAMA_SERVER_PLANNING_CHAT_OPTIONS,
        LlamaServerLLMEngine.DEFAULT_PLANNING_OPTIONS,
        "LLAMA_SERVER_PLANNING_CHAT_OPTIONS"
      )
      ?? LlamaServerLLMEngine.DEFAULT_PLANNING_OPTIONS;

    const chatTemplateKwargs = options?.chatTemplateKwargs
      ?? parseEnvObject(process.env.LLAMA_SERVER_CHAT_TEMPLATE_KWARGS, "LLAMA_SERVER_CHAT_TEMPLATE_KWARGS");
    const planningChatTemplateKwargs = options?.planningChatTemplateKwargs
      ?? parseEnvObject(process.env.LLAMA_SERVER_PLANNING_CHAT_TEMPLATE_KWARGS, "LLAMA_SERVER_PLANNING_CHAT_TEMPLATE_KWARGS")
      ?? chatTemplateKwargs;
    const extraBody = options?.extraBody
      ?? parseEnvObject(process.env.LLAMA_SERVER_EXTRA_BODY, "LLAMA_SERVER_EXTRA_BODY");
    const planningExtraBody = options?.planningExtraBody
      ?? parseEnvObject(process.env.LLAMA_SERVER_PLANNING_EXTRA_BODY, "LLAMA_SERVER_PLANNING_EXTRA_BODY")
      ?? extraBody;

    this.options = {
      baseUrl: options?.baseUrl ?? process.env.LLAMA_SERVER_BASE_URL ?? "http://127.0.0.1:8080",
      model: defaultModel,
      planningModel: options?.planningModel ?? process.env.LLAMA_SERVER_PLANNING_MODEL ?? defaultModel,
      timeoutMs: options?.timeoutMs ?? defaultTimeoutMs,
      planningTimeoutMs: options?.planningTimeoutMs ?? parsePositiveInteger(process.env.LLM_PLANNING_TIMEOUT_MS, defaultTimeoutMs),
      maxRetries: options?.maxRetries ?? parsePositiveInteger(process.env.LLM_MAX_RETRIES, 2),
      strictJson: options?.strictJson ?? parseBoolean(process.env.LLM_STRICT_JSON, true),
      apiKey: options?.apiKey ?? process.env.LLAMA_SERVER_API_KEY ?? process.env.OPENAI_API_KEY,
      selectionOptions,
      planningOptions,
      chatTemplateKwargs,
      planningChatTemplateKwargs,
      extraBody,
      planningExtraBody
    };
  }

  getModelForStep(step: LLMExecutionStep): string {
    return step === "skill_planning" ? this.options.planningModel : this.options.model;
  }

  getProviderName(): "llama-server" {
    return "llama-server";
  }

  async selectSkill(
    text: string,
    runtimeContext: LLMRuntimeContext
  ): Promise<{ decision: "respond" | "use_skill"; skill_name?: string; response_text?: string }> {
    const mode = PromptMode.SkillSelection;
    const model = this.options.model;
    const userPrompt = buildUserPrompt(text, runtimeContext, { mode });
    const logPrompts = process.env.LLM_LOG_PROMPTS === "true";

    for (let attempt = 0; attempt <= this.options.maxRetries; attempt += 1) {
      const extraHint = attempt > 0 ? "Output MUST be valid JSON only. No other text." : undefined;
      const systemPrompt = buildSystemPrompt(mode, this.options.strictJson, extraHint);

      try {
        if (logPrompts) {
          console.log(`[LLM][${model}][attempt ${attempt}] system_prompt:\n${systemPrompt}`);
          console.log(`[LLM][${model}][attempt ${attempt}] user_prompt:\n${userPrompt}`);
        }
        const raw = await llamaServerChat({
          baseUrl: this.options.baseUrl,
          model,
          apiKey: this.options.apiKey,
          timeoutMs: this.options.timeoutMs,
          options: this.options.selectionOptions,
          chatTemplateKwargs: this.options.chatTemplateKwargs,
          extraBody: this.options.extraBody,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ]
        });
        if (logPrompts) {
          console.log(`[LLM][${model}][attempt ${attempt}] raw_output:\n${raw}`);
        }
        return parseSkillSelectionResult(raw);
      } catch (err) {
        console.error("llamaServerChat failed", err);
        if (attempt < this.options.maxRetries) {
          continue;
        }
      }
    }

    return { decision: "respond", response_text: "OK" };
  }

  async planToolExecution(
    text: string,
    runtimeContext: LLMRuntimeContext
  ): Promise<{ tool: string; op: string; args: Record<string, unknown>; success_response: string; failure_response: string }> {
    const mode = PromptMode.SkillPlanning;
    const model = this.options.planningModel;
    const userPrompt = buildUserPrompt(text, runtimeContext, { mode });
    const logPrompts = process.env.LLM_LOG_PROMPTS === "true";

    for (let attempt = 0; attempt <= this.options.maxRetries; attempt += 1) {
      const extraHint = attempt > 0 ? "Output MUST be valid JSON only. No other text." : undefined;
      const systemPrompt = buildSystemPrompt(mode, this.options.strictJson, extraHint);

      try {
        if (logPrompts) {
          console.log(`[LLM][${model}][attempt ${attempt}] system_prompt:\n${systemPrompt}`);
          console.log(`[LLM][${model}][attempt ${attempt}] user_prompt:\n${userPrompt}`);
        }
        const raw = await llamaServerChat({
          baseUrl: this.options.baseUrl,
          model,
          apiKey: this.options.apiKey,
          timeoutMs: this.options.planningTimeoutMs,
          options: this.options.planningOptions,
          chatTemplateKwargs: this.options.planningChatTemplateKwargs,
          extraBody: this.options.planningExtraBody,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ]
        });
        if (logPrompts) {
          console.log(`[LLM][${model}][attempt ${attempt}] raw_output:\n${raw}`);
        }
        return parseSkillPlanningResult(raw);
      } catch (err) {
        console.error("llamaServerChat failed", err);
        if (attempt < this.options.maxRetries) {
          continue;
        }
      }
    }

    return {
      tool: "unknown",
      op: "unknown",
      args: {},
      success_response: "Tool execution succeeded",
      failure_response: "Tool execution failed"
    };
  }
}

function parsePositiveInteger(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (typeof raw !== "string") {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parseEnvObject(raw: string | undefined, envName: string): Record<string, unknown> | null {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      console.warn(`[LLM] ignore ${envName}: expected JSON object`);
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    console.warn(`[LLM] ignore ${envName}: ${(error as Error).message}`);
    return null;
  }
}

function parseChatOptions(
  raw: string | undefined,
  fallback?: LlamaServerChatOptions,
  envName = "LLAMA_SERVER_CHAT_OPTIONS"
): LlamaServerChatOptions | undefined {
  const parsed = parseEnvObject(raw, envName);
  if (!parsed) {
    return fallback;
  }

  const output: LlamaServerChatOptions = { ...(fallback ?? {}) };
  assignNumeric(output, "temperature", parsed.temperature);
  assignNumeric(output, "top_p", parsed.top_p);
  assignNumeric(output, "top_k", parsed.top_k);
  assignNumeric(output, "min_p", parsed.min_p);
  assignNumeric(output, "max_tokens", parsed.max_tokens);
  assignNumeric(output, "num_predict", parsed.num_predict);
  assignNumeric(output, "presence_penalty", parsed.presence_penalty);
  assignNumeric(output, "frequency_penalty", parsed.frequency_penalty);
  assignNumeric(output, "repeat_penalty", parsed.repeat_penalty);

  if (Array.isArray(parsed.stop)) {
    const stop = parsed.stop.filter((item): item is string => typeof item === "string");
    if (stop.length > 0) {
      output.stop = stop;
    }
  }

  return Object.keys(output).length > 0 ? output : undefined;
}

function assignNumeric(
  target: LlamaServerChatOptions,
  key: Exclude<keyof LlamaServerChatOptions, "stop">,
  value: unknown
): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return;
  }
  target[key] = value;
}
