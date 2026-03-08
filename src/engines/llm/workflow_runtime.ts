import { SkillPlanningResult, SkillSelectionResult } from "../../types";
import { parseSkillPlanningResult, parseSkillSelectionResult } from "./json_guard";
import { LLMEngine, LLMExecutionStep, LLMPlanningOptions, LLMProvider, LLMRuntimeContext } from "./llm";
import { buildSystemPrompt, buildUserPrompt, PromptMode } from "./prompt";

const JSON_RETRY_HINT = "Output MUST be valid JSON only. No other text.";

type WorkflowEngineOptions = {
  maxRetries: number;
  strictJson: boolean;
};

export type WorkflowStepRequest = {
  step: LLMExecutionStep;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  planningOptions?: LLMPlanningOptions;
};

export abstract class LLMWorkflowEngine implements LLMEngine {
  private readonly maxRetries: number;
  private readonly strictJson: boolean;

  protected constructor(options: WorkflowEngineOptions) {
    this.maxRetries = options.maxRetries;
    this.strictJson = options.strictJson;
  }

  abstract getModelForStep(step: LLMExecutionStep): string;

  abstract getProviderName(): LLMProvider;

  protected abstract requestWorkflowStep(request: WorkflowStepRequest): Promise<string>;

  async selectSkill(text: string, runtimeContext: LLMRuntimeContext): Promise<SkillSelectionResult> {
    return this.executeWorkflowStep<SkillSelectionResult>({
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
    return this.executeWorkflowStep<SkillPlanningResult>({
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

  private async executeWorkflowStep<T>(request: {
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

        const raw = await this.requestWorkflowStep({
          step: request.step,
          model,
          systemPrompt,
          userPrompt,
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
}
