import { executeInNewChat } from "../../../integrations/chatgpt-bridge/service";
import {
  OpenAIQuotaErrorInput,
  OpenAIQuotaManager,
  OpenAIQuotaPolicy,
  OpenAIUsageDelta,
  readOpenAIQuotaPolicyFromEnv
} from "../../../integrations/openai/quotaManager";
import { InternalChatRequest, LLMChatEngine } from "../chat_engine";
import { LLMExecutionStep } from "../llm";

export type OpenAIMessage = {
  role: "system" | "user" | "assistant";
  content: string | OpenAIContentPart[];
};

export type OpenAIContentPart = {
  type: "text";
  text: string;
} | {
  type: "image_url";
  image_url: {
    url: string;
  };
};

export type OpenAIChatRequest = {
  baseUrl: string;
  apiKey: string;
  chatCompletionsPath: string;
  model: string;
  messages: OpenAIMessage[];
  timeoutMs: number;
  options?: Record<string, unknown>;
};

type OpenAIChatResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    total_tokens?: unknown;
  };
  error?: {
    code?: unknown;
    type?: unknown;
    message?: unknown;
  };
};

type OpenAIContentPartResponse = {
  type?: unknown;
  text?: unknown;
};

export type OpenAIChatResult = {
  content: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
};

export type OpenAILLMOptions = {
  baseUrl: string;
  apiKey: string;
  chatCompletionsPath: string;
  model: string;
  planningModel: string;
  timeoutMs: number;
  planningTimeoutMs: number;
  maxRetries: number;
  strictJson: boolean;
  selectionOptions?: Record<string, unknown>;
  planningOptions?: Record<string, unknown>;
  fallbackToChatgptBridge: boolean;
  forceBridge: boolean;
  costInputPer1M: number | null;
  costOutputPer1M: number | null;
  quotaPolicy: OpenAIQuotaPolicy;
};

type OpenAIErrorInfo = {
  status: number;
  code: string;
  type: string;
  message: string;
};

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

    try {
      const result = await this.executeOpenAIChat({
        baseUrl: this.options.baseUrl,
        apiKey: this.options.apiKey,
        chatCompletionsPath: this.options.chatCompletionsPath,
        model: request.model,
        timeoutMs: request.timeoutMs ?? (isPlanning ? this.options.planningTimeoutMs : this.options.timeoutMs),
        options: requestOptions,
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

  protected async executeOpenAIChat(request: OpenAIChatRequest): Promise<OpenAIChatResult> {
    return openAIChat(request);
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

export async function openAIChat(request: OpenAIChatRequest): Promise<OpenAIChatResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeoutMs);

  const baseUrl = request.baseUrl.replace(/\/$/, "");
  const path = request.chatCompletionsPath.startsWith("/")
    ? request.chatCompletionsPath
    : `/${request.chatCompletionsPath}`;
  const url = `${baseUrl}${path}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${request.apiKey}`
      },
      body: JSON.stringify({
        model: request.model,
        stream: false,
        messages: request.messages,
        ...(request.options ?? {})
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const detail = await parseErrorPayload(response);
      throw new OpenAIChatError(
        `openai HTTP ${response.status}${detail.message ? `: ${truncate(detail.message, 240)}` : ""}`,
        {
          status: response.status,
          code: detail.code,
          type: detail.type
        }
      );
    }

    const payload = (await response.json()) as OpenAIChatResponse;
    if (payload.error) {
      throw new OpenAIChatError(normalizeText(payload.error.message) || "openai API error", {
        status: response.status,
        code: normalizeText(payload.error.code),
        type: normalizeText(payload.error.type)
      });
    }

    const content = extractAssistantContent(payload);
    if (!content) {
      throw new OpenAIChatError("openai response missing content", {
        status: response.status,
        code: "missing_content"
      });
    }

    const usage = extractUsage(payload);
    return {
      content,
      usage
    };
  } finally {
    clearTimeout(timeout);
  }
}

class OpenAIChatError extends Error {
  readonly status: number;
  readonly code: string;
  readonly type: string;

  constructor(message: string, options?: { status?: number; code?: string; type?: string }) {
    super(message);
    this.name = "OpenAIChatError";
    this.status = parsePositiveOrZero(options?.status);
    this.code = normalizeText(options?.code);
    this.type = normalizeText(options?.type);
  }
}

async function parseErrorPayload(response: Response): Promise<{ message: string; code: string; type: string }> {
  const text = await response.text().catch(() => "");
  if (!text.trim()) {
    return { message: "", code: "", type: "" };
  }
  try {
    const parsed = JSON.parse(text) as OpenAIChatResponse;
    if (parsed && parsed.error) {
      return {
        message: normalizeText(parsed.error.message),
        code: normalizeText(parsed.error.code),
        type: normalizeText(parsed.error.type)
      };
    }
  } catch {
    // Keep raw text fallback below.
  }
  return {
    message: text.trim(),
    code: "",
    type: ""
  };
}

function extractAssistantContent(payload: OpenAIChatResponse): string {
  if (!Array.isArray(payload.choices) || payload.choices.length === 0) {
    return "";
  }
  return normalizeAssistantContent(payload.choices[0]?.message?.content);
}

function normalizeAssistantContent(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const chunks: string[] = [];
  for (const item of content) {
    if (typeof item === "string") {
      const text = item.trim();
      if (text) chunks.push(text);
      continue;
    }
    if (!isRecord(item)) {
      continue;
    }
    const part = item as OpenAIContentPartResponse;
    if (part.type === "text" && typeof part.text === "string" && part.text.trim()) {
      chunks.push(part.text.trim());
    }
  }
  return chunks.join("");
}

function extractUsage(payload: OpenAIChatResponse): OpenAIUsageDelta {
  const inputTokens = parsePositiveOrZero(payload.usage?.prompt_tokens);
  const outputTokens = parsePositiveOrZero(payload.usage?.completion_tokens);
  const totalTokensCandidate = parsePositiveOrZero(payload.usage?.total_tokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens: totalTokensCandidate > 0 ? totalTokensCandidate : inputTokens + outputTokens,
    estimatedCostUsd: 0
  };
}

function toOpenAIMessage(input: {
  role: "system" | "user" | "assistant";
  content: string;
  images?: string[];
}): OpenAIMessage {
  const content = String(input.content ?? "");
  const images = Array.isArray(input.images) ? input.images.filter((item) => typeof item === "string" && item.trim()) : [];

  if (images.length === 0) {
    return {
      role: input.role,
      content
    };
  }

  if (input.role !== "user") {
    return {
      role: input.role,
      content: `${content}\n\n[${images.length} image(s) attached]`
    };
  }

  const parts: OpenAIContentPart[] = [];
  if (content.trim()) {
    parts.push({
      type: "text",
      text: content
    });
  }
  for (const image of images) {
    const url = normalizeImageUrl(image);
    if (!url) continue;
    parts.push({
      type: "image_url",
      image_url: {
        url
      }
    });
  }

  if (parts.length === 0) {
    return {
      role: input.role,
      content
    };
  }
  return {
    role: input.role,
    content: parts
  };
}

function normalizeImageUrl(raw: string): string {
  const text = raw.trim();
  if (!text) {
    return "";
  }
  if (/^https?:\/\//i.test(text) || /^data:/i.test(text)) {
    return text;
  }
  return `data:image/jpeg;base64,${text}`;
}

function buildBridgeFallbackPrompt(request: InternalChatRequest, reason: string): string {
  const messageText = request.messages
    .map((message, index) => formatBridgeMessage(message, index + 1))
    .join("\n\n");

  return [
    "You are acting as a fallback model for an automation runtime.",
    "Read the message list and answer exactly as the assistant.",
    "If the prompt asks for strict JSON, output strict JSON only.",
    `fallback_reason: ${reason}`,
    `step: ${request.step}`,
    `model_hint: ${request.model}`,
    "",
    "<messages>",
    messageText,
    "</messages>"
  ].join("\n");
}

function formatBridgeMessage(
  message: { role: "system" | "user" | "assistant"; content: string; images?: string[] },
  index: number
): string {
  const images = Array.isArray(message.images) ? message.images.filter((item) => typeof item === "string" && item.trim()) : [];
  const lines = [
    `#${index} role=${message.role}`,
    String(message.content ?? "")
  ];
  if (images.length > 0) {
    lines.push(`[images: ${images.length}]`);
  }
  return lines.join("\n");
}

function extractTextFromBridgeResponse(response: unknown): string {
  if (typeof response === "string") {
    return response.trim();
  }
  if (!isRecord(response)) {
    return "";
  }
  const directText = normalizeText(response.text);
  if (directText) {
    return directText;
  }
  if (!isRecord(response.output)) {
    return "";
  }
  return normalizeText(response.output.text);
}

function estimateCostUsd(
  inputTokens: number,
  outputTokens: number,
  inputRatePer1M: number | null,
  outputRatePer1M: number | null
): number {
  if (inputRatePer1M === null || outputRatePer1M === null) {
    return 0;
  }
  const value = (Math.max(0, inputTokens) * inputRatePer1M + Math.max(0, outputTokens) * outputRatePer1M) / 1_000_000;
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.round(value * 1_000_000) / 1_000_000;
}

function toOpenAIErrorInfo(error: unknown): OpenAIErrorInfo {
  if (error instanceof OpenAIChatError) {
    return {
      status: error.status,
      code: error.code,
      type: error.type,
      message: normalizeText(error.message)
    };
  }
  if (error instanceof Error) {
    return {
      status: 0,
      code: "",
      type: "",
      message: normalizeText(error.message) || "unknown error"
    };
  }
  return {
    status: 0,
    code: "",
    type: "",
    message: normalizeText(String(error ?? "")) || "unknown error"
  };
}

function isQuotaExceededError(error: OpenAIErrorInfo): boolean {
  const code = error.code.toLowerCase();
  const type = error.type.toLowerCase();
  const message = error.message.toLowerCase();

  if (["insufficient_quota", "billing_hard_limit_reached", "quota_exceeded"].includes(code)) {
    return true;
  }
  if (["insufficient_quota", "billing_hard_limit_reached"].includes(type)) {
    return true;
  }
  if (error.status === 429 && /(quota|billing|hard limit|insufficient)/i.test(message)) {
    return true;
  }
  return false;
}

function toQuotaErrorInput(error: OpenAIErrorInfo): OpenAIQuotaErrorInput {
  return {
    status: error.status,
    code: error.code,
    message: error.message || "unknown error"
  };
}

function parsePositiveInteger(raw: unknown, fallback: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

function parseNullablePositiveNumber(raw: unknown): number | null {
  if (raw === undefined || raw === null) {
    return null;
  }
  const text = String(raw).trim();
  if (!text) {
    return null;
  }
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
}

function parsePositiveOrZero(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.floor(parsed);
}

function parseBoolean(raw: unknown, fallback: boolean): boolean {
  if (typeof raw !== "string") {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parseEnvObject(raw: unknown, envName: string): Record<string, unknown> | undefined {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      console.warn(`[LLM] ignore ${envName}: expected JSON object`);
      return undefined;
    }
    return parsed;
  } catch (error) {
    console.warn(`[LLM] ignore ${envName}: ${(error as Error).message}`);
    return undefined;
  }
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}

function normalizeText(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
