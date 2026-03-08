import { LLMExecutionStep } from "../llm";
import { InternalChatRequest, LLMChatEngine } from "../chat_engine";

export type LlamaServerMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LlamaServerChatOptions = {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  max_tokens?: number;
  num_predict?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  repeat_penalty?: number;
  stop?: string[];
};

export type LlamaServerChatRequest = {
  baseUrl: string;
  model: string;
  messages: LlamaServerMessage[];
  timeoutMs: number;
  apiKey?: string;
  options?: LlamaServerChatOptions;
  chatTemplateKwargs?: Record<string, unknown> | null;
  extraBody?: Record<string, unknown> | null;
};

type LlamaServerChatResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
};

type LlamaServerContentPart = {
  type?: string;
  text?: string;
  content?: string;
};

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

export class LlamaServerLLMEngine extends LLMChatEngine {
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
    const maxRetries = parsePositiveInteger(process.env.LLM_MAX_RETRIES, 2);
    const strictJson = parseBoolean(process.env.LLM_STRICT_JSON, true);

    super({
      maxRetries: options?.maxRetries ?? maxRetries,
      strictJson: options?.strictJson ?? strictJson
    });

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
      maxRetries: options?.maxRetries ?? maxRetries,
      strictJson: options?.strictJson ?? strictJson,
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

  protected async executeChat(request: InternalChatRequest): Promise<string> {
    const isPlanning = request.step === "skill_planning";
    const isSelection = request.step === "skill_selection";

    return this.executeLlamaServerChat({
      baseUrl: this.options.baseUrl,
      model: request.model,
      apiKey: this.options.apiKey,
      timeoutMs: request.timeoutMs ?? (isPlanning ? this.options.planningTimeoutMs : this.options.timeoutMs),
      options: toLlamaServerChatOptions(request.options)
        ?? (isPlanning ? this.options.planningOptions : isSelection ? this.options.selectionOptions : undefined),
      chatTemplateKwargs: isPlanning ? this.options.planningChatTemplateKwargs : isSelection ? this.options.chatTemplateKwargs : undefined,
      extraBody: isPlanning ? this.options.planningExtraBody : isSelection ? this.options.extraBody : undefined,
      messages: request.messages.map((message) => ({
        role: message.role,
        content: message.content
      }))
    });
  }

  protected async executeLlamaServerChat(request: LlamaServerChatRequest): Promise<string> {
    return llamaServerChat(request);
  }
}

export async function llamaServerChat(request: LlamaServerChatRequest): Promise<string> {
  const baseUrl = request.baseUrl.replace(/\/$/, "");
  const url = `${baseUrl}/v1/chat/completions`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeoutMs);

  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  if (request.apiKey && request.apiKey.trim().length > 0) {
    headers.Authorization = `Bearer ${request.apiKey.trim()}`;
  }

  const payload: Record<string, unknown> = {
    model: request.model,
    messages: request.messages,
    stream: false,
    ...(request.options ?? {})
  };
  if (request.chatTemplateKwargs && Object.keys(request.chatTemplateKwargs).length > 0) {
    payload.chat_template_kwargs = request.chatTemplateKwargs;
  }
  if (request.extraBody && Object.keys(request.extraBody).length > 0) {
    Object.assign(payload, request.extraBody);
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`llama-server HTTP ${response.status}${body ? `: ${truncate(body, 240)}` : ""}`);
    }

    const data = (await response.json()) as LlamaServerChatResponse;
    const content = extractAssistantText(data);
    if (!content.trim()) {
      throw new Error("llama-server response missing content");
    }
    return content;
  } finally {
    clearTimeout(timeout);
  }
}

function extractAssistantText(data: LlamaServerChatResponse): string {
  if (!Array.isArray(data.choices) || data.choices.length === 0) {
    return "";
  }
  return normalizeContent(data.choices[0]?.message?.content);
}

function normalizeContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }

  const chunks: string[] = [];
  for (const part of content) {
    if (typeof part === "string") {
      chunks.push(part);
      continue;
    }
    if (!part || typeof part !== "object") {
      continue;
    }
    const typedPart = part as LlamaServerContentPart;
    if (typeof typedPart.text === "string") {
      chunks.push(typedPart.text);
      continue;
    }
    if (typeof typedPart.content === "string" && typedPart.type === "text") {
      chunks.push(typedPart.content);
    }
  }
  return chunks.join("");
}

function truncate(input: string, maxLength: number): string {
  if (input.length <= maxLength) {
    return input;
  }
  return `${input.slice(0, maxLength)}...`;
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

function toLlamaServerChatOptions(
  options: Record<string, unknown> | undefined
): LlamaServerChatOptions | undefined {
  if (!options) {
    return undefined;
  }
  return options as LlamaServerChatOptions;
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
