import { executeInNewChat } from "../../../integrations/chatgpt-bridge/service";
import {
  OpenAIQuotaManager,
  readOpenAIQuotaPolicyFromEnv
} from "../../../integrations/openai/quotaManager";
import { InternalChatRequest, LLMChatEngine } from "../chat_engine";
import { LLMExecutionStep } from "../llm";
import { buildBridgeFallbackPrompt, extractTextFromBridgeResponse } from "./bridge";
import {
  estimateCostUsd,
  isQuotaExceededError,
  openAIChat,
  toOpenAIErrorInfo,
  toOpenAIMessage,
  toQuotaErrorInput
} from "./chat";
import {
  parseBoolean,
  parseEnvObject,
  parseNullablePositiveNumber,
  parsePositiveInteger
} from "./shared";
import type { OpenAILLMOptions } from "./types";

export type * from "./types";
export { openAIChat } from "./chat";

const DEFAULT_MODEL = "gpt-4.1-mini";

export class OpenAILLMEngine extends LLMChatEngine {
  private readonly options: OpenAILLMOptions;
  private readonly quotaManager: OpenAIQuotaManager;

  constructor(options?: Partial<OpenAILLMOptions> & { quotaManager?: OpenAIQuotaManager }) {
    const defaultTimeoutMs = parsePositiveInteger(process.env.LLM_TIMEOUT_MS, 30000);
    const maxRetries = parsePositiveInteger(process.env.LLM_MAX_RETRIES, 2);
    const strictJson = parseBoolean(process.env.LLM_STRICT_JSON, true);
    const defaultModel = String(
      options?.model
      ?? process.env.OPENAI_MODEL
      ?? process.env.LLM_MODEL
      ?? DEFAULT_MODEL
    )
      .trim()
      || DEFAULT_MODEL;

    super({
      maxRetries: options?.maxRetries ?? maxRetries,
      strictJson: options?.strictJson ?? strictJson
    });

    this.options = {
      baseUrl: String(options?.baseUrl ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").trim(),
      apiKey: String(options?.apiKey ?? process.env.OPENAI_API_KEY ?? process.env.CHATGPT_API_KEY ?? "").trim(),
      chatCompletionsPath: String(options?.chatCompletionsPath ?? process.env.OPENAI_CHAT_COMPLETIONS_PATH ?? "/chat/completions").trim() || "/chat/completions",
      model: defaultModel,
      planningModel: String(options?.planningModel ?? process.env.OPENAI_PLANNING_MODEL ?? defaultModel).trim() || defaultModel,
      timeoutMs: options?.timeoutMs ?? defaultTimeoutMs,
      planningTimeoutMs: options?.planningTimeoutMs
        ?? parsePositiveInteger(process.env.LLM_PLANNING_TIMEOUT_MS, defaultTimeoutMs),
      maxRetries: options?.maxRetries ?? maxRetries,
      strictJson: options?.strictJson ?? strictJson,
      selectionOptions: options?.selectionOptions
        ?? parseEnvObject(process.env.OPENAI_CHAT_OPTIONS, "OPENAI_CHAT_OPTIONS"),
      planningOptions: options?.planningOptions
        ?? parseEnvObject(process.env.OPENAI_PLANNING_CHAT_OPTIONS, "OPENAI_PLANNING_CHAT_OPTIONS"),
      chatTemplateKwargs: options?.chatTemplateKwargs,
      planningChatTemplateKwargs: options?.planningChatTemplateKwargs,
      fallbackToChatgptBridge: options?.fallbackToChatgptBridge
        ?? parseBoolean(process.env.OPENAI_FALLBACK_TO_CHATGPT_BRIDGE, true),
      forceBridge: options?.forceBridge ?? parseBoolean(process.env.OPENAI_FORCE_BRIDGE, false),
      costInputPer1M: options?.costInputPer1M ?? parseNullablePositiveNumber(process.env.OPENAI_COST_INPUT_PER_1M),
      costOutputPer1M: options?.costOutputPer1M ?? parseNullablePositiveNumber(process.env.OPENAI_COST_OUTPUT_PER_1M),
      quotaPolicy: options?.quotaPolicy ?? readOpenAIQuotaPolicyFromEnv()
    };
    this.quotaManager = options?.quotaManager ?? new OpenAIQuotaManager();
  }

  getModelForStep(step: LLMExecutionStep): string {
    return step === "planning" ? this.options.planningModel : this.options.model;
  }

  getProviderName(): "openai" {
    return "openai";
  }

  protected async executeChat(request: InternalChatRequest): Promise<string> {
    if (this.options.forceBridge) {
      return this.executeBridgeFallback(request, "force_bridge");
    }

    const quotaCheck = this.quotaManager.isApiAllowed(this.options.quotaPolicy);
    if (!quotaCheck.allowed) {
      return this.executeBridgeFallback(request, quotaCheck.reason);
    }

    if (!this.options.apiKey) {
      return this.executeBridgeFallback(request, "missing_api_key");
    }

    const isPlanning = request.step === "planning";
    const isSelection = request.step === "routing";
    const requestOptions = request.options
      ?? (isPlanning ? this.options.planningOptions : isSelection ? this.options.selectionOptions : undefined);
    const requestChatTemplateKwargs = isPlanning
      ? (this.options.planningChatTemplateKwargs ?? this.options.chatTemplateKwargs)
      : this.options.chatTemplateKwargs;

    try {
      const result = await openAIChat({
        baseUrl: this.options.baseUrl,
        apiKey: this.options.apiKey,
        chatCompletionsPath: this.options.chatCompletionsPath,
        model: request.model,
        timeoutMs: request.timeoutMs ?? (isPlanning ? this.options.planningTimeoutMs : this.options.timeoutMs),
        options: requestOptions,
        chatTemplateKwargs: requestChatTemplateKwargs,
        messages: request.messages.map(toOpenAIMessage)
      });
      this.quotaManager.recordApiSuccess(this.options.quotaPolicy, {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        totalTokens: result.usage.totalTokens,
        estimatedCostUsd: estimateCostUsd(
          result.usage.inputTokens,
          result.usage.outputTokens,
          this.options.costInputPer1M,
          this.options.costOutputPer1M
        )
      });
      return result.content;
    } catch (error) {
      const errorInfo = toOpenAIErrorInfo(error);
      this.quotaManager.recordApiError(this.options.quotaPolicy, toQuotaErrorInput(errorInfo));
      if (isQuotaExceededError(errorInfo)) {
        this.quotaManager.markExhausted(
          this.options.quotaPolicy,
          errorInfo.code || "api:insufficient_quota"
        );
        return this.executeBridgeFallback(request, errorInfo.message || "api_quota_exceeded");
      }
      throw error;
    }
  }

  protected async executeBridgeChat(prompt: string): Promise<string> {
    const response = await Promise.resolve(executeInNewChat(prompt));
    const text = extractTextFromBridgeResponse(response);
    if (!text) {
      throw new Error("chatgpt-bridge returned empty response");
    }
    return text;
  }

  private async executeBridgeFallback(request: InternalChatRequest, reason: string): Promise<string> {
    if (!this.options.fallbackToChatgptBridge) {
      throw new Error(`openai unavailable (${reason}) and OPENAI_FALLBACK_TO_CHATGPT_BRIDGE=false`);
    }
    const prompt = buildBridgeFallbackPrompt(request, reason);
    const text = await this.executeBridgeChat(prompt);
    this.quotaManager.recordBridgeFallback(this.options.quotaPolicy);
    return text;
  }
}
