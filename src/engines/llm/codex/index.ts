import path from "path";
import { InternalChatRequest, LLMChatEngine } from "../chat_engine";
import { LLMExecutionStep } from "../llm";
import { ensureDir, resolveDataPath } from "../../../storage/persistence";
import { runCodexCommand } from "./cli";
import { buildCodexArgs, buildCodexPrompt } from "./prompt";
import {
  buildTaskId,
  normalizeApprovalPolicy,
  normalizeReasoningEffort,
  normalizeSandbox,
  parseBoolean,
  parsePositiveInteger,
  readReasoningEffortOption,
  resolveFirstText
} from "./shared";
import type { CodexApprovalPolicy, CodexLLMOptions, CodexSandboxMode } from "./types";

export type * from "./types";

const DEFAULT_MODEL = "gpt-5-codex";
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_STRICT_JSON = true;

export class CodexLLMEngine extends LLMChatEngine {
  private readonly options: CodexLLMOptions;

  constructor(options?: Partial<CodexLLMOptions>) {
    const model = resolveFirstText(
      options?.model,
      process.env.LLM_CODEX_MODEL,
      process.env.CODEX_MODEL,
      process.env.EVOLUTION_CODEX_MODEL,
      process.env.LLM_MODEL,
      DEFAULT_MODEL
    ) || DEFAULT_MODEL;
    const planningModel = resolveFirstText(
      options?.planningModel,
      process.env.LLM_CODEX_PLANNING_MODEL,
      model
    ) || model;
    const timeoutMs = parsePositiveInteger(options?.timeoutMs ?? process.env.LLM_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
    const planningTimeoutMs = parsePositiveInteger(options?.planningTimeoutMs ?? process.env.LLM_PLANNING_TIMEOUT_MS, timeoutMs);
    const maxRetries = parsePositiveInteger(options?.maxRetries ?? process.env.LLM_MAX_RETRIES, DEFAULT_MAX_RETRIES);
    const strictJson = parseBoolean(options?.strictJson ?? process.env.LLM_STRICT_JSON, DEFAULT_STRICT_JSON);

    super({ maxRetries, strictJson });

    this.options = {
      model,
      planningModel,
      reasoningEffort: normalizeReasoningEffort(
        options?.reasoningEffort,
        process.env.LLM_CODEX_REASONING_EFFORT,
        process.env.CODEX_MODEL_REASONING_EFFORT,
        process.env.CODEX_REASONING_EFFORT,
        process.env.EVOLUTION_CODEX_REASONING_EFFORT
      ),
      planningReasoningEffort: normalizeReasoningEffort(
        options?.planningReasoningEffort,
        process.env.LLM_CODEX_PLANNING_REASONING_EFFORT
      ),
      timeoutMs,
      planningTimeoutMs,
      maxRetries,
      strictJson,
      approvalPolicy: normalizeApprovalPolicy(options?.approvalPolicy ?? process.env.LLM_CODEX_APPROVAL_POLICY),
      sandbox: normalizeSandbox(options?.sandbox ?? process.env.LLM_CODEX_SANDBOX),
      rootDir: resolveFirstText(options?.rootDir, process.cwd()) || process.cwd(),
      outputDir: resolveFirstText(options?.outputDir, resolveDataPath("llm", "codex")) || resolveDataPath("llm", "codex")
    };

    ensureDir(this.options.outputDir);
  }

  getModelForStep(step: LLMExecutionStep): string {
    return step === "planning" ? this.options.planningModel : this.options.model;
  }

  getProviderName(): "codex" {
    return "codex";
  }

  protected async executeChat(request: InternalChatRequest): Promise<string> {
    const isPlanning = request.step === "planning";
    const timeoutMs = request.timeoutMs ?? (isPlanning ? this.options.planningTimeoutMs : this.options.timeoutMs);
    const taskId = buildTaskId(request.step);
    const outputFile = path.join(this.options.outputDir, `${taskId}.txt`);
    const outputFileName = path.basename(outputFile);
    const reasoningEffort = normalizeReasoningEffort(
      readReasoningEffortOption(request.options),
      isPlanning
        ? (this.options.planningReasoningEffort || this.options.reasoningEffort)
        : this.options.reasoningEffort
    );

    const args = buildCodexArgs({
      approvalPolicy: this.options.approvalPolicy,
      sandbox: this.options.sandbox,
      outputFile,
      prompt: buildCodexPrompt(request),
      model: request.model,
      reasoningEffort
    });
    const startedAt = Date.now();

    console.log(
      `[LLM][codex][exec:${request.step}] start model=${request.model || "unknown"} timeout=${timeoutMs}ms reasoning=${reasoningEffort || "default"} output_file=${outputFileName}`
    );

    const result = await runCodexCommand(args, {
      cwd: this.options.rootDir,
      timeoutMs,
      outputFile
    });

    if (!result.ok) {
      console.error(
        `[LLM][codex][exec:${request.step}] failed model=${request.model || "unknown"} duration=${Date.now() - startedAt}ms output_file=${outputFileName} error=${result.error || "codex execution failed"}`
      );
      throw new Error(result.error || "codex execution failed");
    }

    const output = String(result.output ?? "").trim();
    if (!output) {
      console.error(
        `[LLM][codex][exec:${request.step}] failed model=${request.model || "unknown"} duration=${Date.now() - startedAt}ms output_file=${outputFileName} error=codex returned empty response`
      );
      throw new Error("codex returned empty response");
    }

    console.log(
      `[LLM][codex][exec:${request.step}] success model=${request.model || "unknown"} duration=${Date.now() - startedAt}ms output_file=${outputFileName} output_chars=${output.length}`
    );
    return output;
  }
}
