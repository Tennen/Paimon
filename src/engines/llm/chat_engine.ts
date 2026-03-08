import { SkillPlanningResult, SkillSelectionResult } from "../../types";
import { parseSkillPlanningResult, parseSkillSelectionResult } from "./json_guard";
import {
  LLMChatMessage,
  LLMChatRequest,
  LLMChatStep,
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
  options?: Record<string, unknown>;
  keepAlive?: number;
  planningOptions?: LLMPlanningOptions;
};

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
    return this.executeChat({
      step,
      model,
      messages: request.messages,
      timeoutMs: request.timeoutMs,
      options: request.options,
      keepAlive: request.keepAlive,
      planningOptions: request.planningOptions
    });
  }

  async selectSkill(text: string, runtimeContext: LLMRuntimeContext): Promise<SkillSelectionResult> {
    return this.executeStructuredStep<SkillSelectionResult>({
      step: "skill_selection",
      text,
      runtimeContext,
      parse: parseSkillSelectionResult,
      retryHint: JSON_RETRY_HINT,
      fallback: () => ({ decision: "respond", response_text: "OK" })
    });
  }

  async planToolExecution(
    text: string,
    runtimeContext: LLMRuntimeContext,
    planningOptions?: LLMPlanningOptions
  ): Promise<SkillPlanningResult> {
    return this.executeStructuredStep<SkillPlanningResult>({
      step: "skill_planning",
      text,
      runtimeContext,
      planningOptions,
      parse: parseSkillPlanningResult,
      retryHint: JSON_RETRY_HINT,
      fallback: () => ({
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
    const mode = request.step === "skill_planning" ? PromptMode.SkillPlanning : PromptMode.SkillSelection;
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
    if (step === "skill_planning") {
      return this.getModelForStep("skill_planning");
    }
    return this.getModelForStep("skill_selection");
  }
}
