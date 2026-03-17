import { SkillPlanningResult, SkillSelectionResult } from "../../types";
import { parseSkillPlanningResult, parseSkillSelectionResult } from "./json_guard";
import {
  LLMChatMessage,
  LLMChatRequest,
  LLMChatStep,
  LLMEngineSystemPromptMode,
  LLMEngine,
  LLMExecutionStep,
  LLMPlanningOptions,
  LLMProvider,
  LLMRuntimeContext
} from "./llm";
import { buildSystemPrompt, buildUserPrompt, PromptMode } from "./prompt";

const JSON_RETRY_HINT = "Output MUST be valid JSON only. No other text.";

type ChatEngineOptions = {
  maxRetries: number;
  strictJson: boolean;
};

export type InternalChatRequest = {
  step: LLMChatStep;
  model: string;
  messages: LLMChatMessage[];
  timeoutMs?: number;
  engineSystemPrompt?: string;
  engineSystemPromptMode?: LLMEngineSystemPromptMode;
  options?: Record<string, unknown>;
  keepAlive?: number;
  planningOptions?: LLMPlanningOptions;
};

export function resolveEngineSystemPrompt(input: {
  defaultPrompt: string;
  customPrompt?: string;
  mode?: LLMEngineSystemPromptMode;
}): string {
  const defaultPrompt = normalizePromptText(input.defaultPrompt);
  const customPrompt = normalizePromptText(input.customPrompt);
  if (!customPrompt) {
    return defaultPrompt;
  }
  if (input.mode === "append") {
    return [defaultPrompt, customPrompt].filter(Boolean).join("\n");
  }
  return customPrompt;
}

export abstract class LLMChatEngine implements LLMEngine {
  private readonly maxRetries: number;
  private readonly strictJson: boolean;

  protected constructor(options: ChatEngineOptions) {
    this.maxRetries = options.maxRetries;
    this.strictJson = options.strictJson;
  }

  abstract getModelForStep(step: LLMExecutionStep): string;

  abstract getProviderName(): LLMProvider;

  protected abstract executeChat(request: InternalChatRequest): Promise<string>;

  async chat(request: LLMChatRequest): Promise<string> {
    const step = request.step ?? "general";
    const model = request.model ?? this.resolveModelForChatStep(step);
    const provider = this.getProviderName();
    const startedAt = Date.now();
    const timeoutText = typeof request.timeoutMs === "number" && Number.isFinite(request.timeoutMs) && request.timeoutMs > 0
      ? ` timeout=${Math.floor(request.timeoutMs)}ms`
      : "";

    console.log(
      `[LLM][${provider}][chat:${step}] request model=${model || "unknown"} messages=${request.messages.length}${timeoutText}`
    );

    try {
      const output = await this.executeChat({
        step,
        model,
        messages: request.messages,
        timeoutMs: request.timeoutMs,
        engineSystemPrompt: request.engineSystemPrompt,
        engineSystemPromptMode: request.engineSystemPromptMode,
        options: request.options,
        keepAlive: request.keepAlive,
        planningOptions: request.planningOptions
      });
      console.log(
        `[LLM][${provider}][chat:${step}] success model=${model || "unknown"} duration=${Date.now() - startedAt}ms output_chars=${output.length}`
      );
      return output;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[LLM][${provider}][chat:${step}] failed model=${model || "unknown"} duration=${Date.now() - startedAt}ms error=${message}`
      );
      throw error;
    }
  }

  async route(text: string, runtimeContext: LLMRuntimeContext): Promise<SkillSelectionResult> {
    return this.executeStructuredStep<SkillSelectionResult>({
      step: "routing",
      text,
      runtimeContext,
      parse: parseSkillSelectionResult,
      retryHint: JSON_RETRY_HINT,
      fallback: () => ({ decision: "respond", response_text: "OK" })
    });
  }

  async plan(
    text: string,
    runtimeContext: LLMRuntimeContext,
    planningOptions?: LLMPlanningOptions
  ): Promise<SkillPlanningResult> {
    return this.executeStructuredStep<SkillPlanningResult>({
      step: "planning",
      text,
      runtimeContext,
      planningOptions,
      parse: parseSkillPlanningResult,
      retryHint: JSON_RETRY_HINT,
      fallback: () => ({
        decision: "tool_call",
        tool: "unknown",
        op: "unknown",
        args: {},
        success_response: "Tool execution succeeded",
        failure_response: "Tool execution failed"
      })
    });
  }

  private async executeStructuredStep<T>(request: {
    step: LLMExecutionStep;
    text: string;
    runtimeContext: LLMRuntimeContext;
    planningOptions?: LLMPlanningOptions;
    parse: (raw: string) => T;
    fallback: () => T;
    retryHint?: string;
  }): Promise<T> {
    const mode = request.step === "planning" ? PromptMode.Planning : PromptMode.Routing;
    const model = this.getModelForStep(request.step);
    const userPrompt = buildUserPrompt(request.text, request.runtimeContext, { mode });
    const shouldLogPrompts = process.env.LLM_LOG_PROMPTS === "true";

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const extraHint = attempt > 0 ? request.retryHint : undefined;
      const systemPrompt = buildSystemPrompt(mode, this.strictJson, extraHint);

      try {
        if (shouldLogPrompts) {
          console.log(`[LLM][${model}][attempt ${attempt}] system_prompt:\n${systemPrompt}`);
          console.log(`[LLM][${model}][attempt ${attempt}] user_prompt:\n${userPrompt}`);
        }

        const raw = await this.executeChat({
          step: request.step,
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          planningOptions: request.planningOptions
        });

        if (shouldLogPrompts) {
          console.log(`[LLM][${model}][attempt ${attempt}] raw_output:\n${raw}`);
        }

        return request.parse(raw);
      } catch (error) {
        console.error(
          `[LLM][${this.getProviderName()}][${request.step}][attempt ${attempt}] failed`,
          error
        );
        if (attempt < this.maxRetries) {
          continue;
        }
      }
    }

    return request.fallback();
  }

  private resolveModelForChatStep(step: LLMChatStep): string {
    if (step === "planning") {
      return this.getModelForStep("planning");
    }
    return this.getModelForStep("routing");
  }
}

function normalizePromptText(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}
