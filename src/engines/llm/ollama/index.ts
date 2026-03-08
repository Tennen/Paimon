import { LLMExecutionStep, LLMPlanMeta } from "../llm";
import { InternalChatRequest, LLMChatEngine } from "../chat_engine";

export type OllamaMessage = {
  role: "system" | "user" | "assistant";
  content: string;
  images?: string[];
};

export type OllamaChatOptions = {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  num_predict?: number;
  presence_penalty?: number;
  repeat_penalty?: number;
  stop?: string[];
};

export type OllamaThinkingBudgetConfig = {
  enabled?: boolean;
  budgetTokens?: number;
  maxNewTokens?: number;
  earlyStoppingPrompt?: string;
  continuePrompt?: string;
};

export type OllamaChatRequest = {
  baseUrl: string;
  model: string;
  messages: OllamaMessage[];
  timeoutMs: number;
  keepAlive?: number;
  options?: OllamaChatOptions;
  thinkingBudget?: OllamaThinkingBudgetConfig;
};

type OllamaChatRawResponse = {
  message?: { content?: string; thinking?: string; reasoning?: string };
  response?: string;
  thinking?: string;
  reasoning?: string;
  done?: boolean;
  done_reason?: string;
};

type OllamaChatResult = {
  content: string;
  done: boolean;
  doneReason: string;
};

export type OllamaLLMOptions = {
  baseUrl: string;
  model: string;
  planningModel: string;
  timeoutMs: number;
  planningTimeoutMs: number;
  maxRetries: number;
  strictJson: boolean;
  thinkingBudgetEnabled: boolean;
  thinkingBudget: number;
  thinkingMaxNewTokens: number;
};

const DEFAULT_THINKING_MAX_NEW_TOKENS = 32768;
const DEFAULT_EARLY_STOPPING_PROMPT =
  "\n\nConsidering the limited time by the user, I have to give the solution based on the thinking directly now.\n</think>\n\n";
const DEFAULT_CONTINUE_PROMPT =
  "Continue and finish your pending response now. If you are still in thinking mode, stop thinking and provide the final answer directly.";

export class OllamaLLMEngine extends LLMChatEngine {
  private readonly options: OllamaLLMOptions;

  private static readonly THINKING_MODE_OPTIONS: OllamaChatOptions = {
    temperature: 0.6,
    top_p: 0.95,
    top_k: 20,
    min_p: 0,
    num_predict: 32768,
    presence_penalty: 0
  };

  constructor(options?: Partial<OllamaLLMOptions>) {
    const defaultModel = options?.model ?? process.env.OLLAMA_MODEL ?? "qwen3:4b";
    const defaultTimeoutMs = parseEnvPositiveInteger(process.env.LLM_TIMEOUT_MS, 30000);
    const maxRetries = parseEnvPositiveInteger(process.env.LLM_MAX_RETRIES, 2);
    const strictJson = parseEnvBoolean(process.env.LLM_STRICT_JSON, true);

    super({
      maxRetries: options?.maxRetries ?? maxRetries,
      strictJson: options?.strictJson ?? strictJson
    });

    this.options = {
      baseUrl: options?.baseUrl ?? process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
      model: defaultModel,
      planningModel: options?.planningModel ?? process.env.OLLAMA_PLANNING_MODEL ?? defaultModel,
      timeoutMs: options?.timeoutMs ?? defaultTimeoutMs,
      planningTimeoutMs: options?.planningTimeoutMs ?? parseEnvPositiveInteger(process.env.LLM_PLANNING_TIMEOUT_MS, defaultTimeoutMs),
      maxRetries: options?.maxRetries ?? maxRetries,
      strictJson: options?.strictJson ?? strictJson,
      thinkingBudgetEnabled: options?.thinkingBudgetEnabled ?? parseEnvBoolean(process.env.LLM_THINKING_BUDGET_ENABLED, false),
      thinkingBudget: options?.thinkingBudget ?? parseEnvPositiveInteger(process.env.LLM_THINKING_BUDGET, 1024),
      thinkingMaxNewTokens: options?.thinkingMaxNewTokens ?? parseEnvPositiveInteger(process.env.LLM_THINKING_MAX_NEW_TOKENS, 32768)
    };
  }

  getModelForStep(step: LLMExecutionStep): string {
    return step === "skill_planning" ? this.options.planningModel : this.options.model;
  }

  getProviderName(): "ollama" {
    return "ollama";
  }

  protected async executeChat(request: InternalChatRequest): Promise<string> {
    if (request.step === "general") {
      return this.executeOllamaChat({
        baseUrl: this.options.baseUrl,
        model: request.model,
        keepAlive: request.keepAlive,
        timeoutMs: request.timeoutMs ?? this.options.timeoutMs,
        options: toOllamaChatOptions(request.options),
        messages: request.messages.map(toOllamaMessage)
      });
    }

    if (request.step === "skill_selection") {
      return this.executeOllamaChat({
        baseUrl: this.options.baseUrl,
        model: request.model,
        keepAlive: request.keepAlive ?? 0,
        timeoutMs: request.timeoutMs ?? this.options.timeoutMs,
        options: toOllamaChatOptions(request.options),
        messages: request.messages.map(toOllamaMessage)
      });
    }

    const effectiveThinkingBudget = this.options.thinkingBudgetEnabled
      ? request.planningOptions?.thinkingBudgetOverride ?? this.options.thinkingBudget
      : undefined;
    const planningOptions = toOllamaChatOptions(request.options);

    return this.executeOllamaChat({
      baseUrl: this.options.baseUrl,
      model: request.model,
      timeoutMs: request.timeoutMs ?? this.options.planningTimeoutMs,
      options: planningOptions
        ? { ...OllamaLLMEngine.THINKING_MODE_OPTIONS, ...planningOptions }
        : OllamaLLMEngine.THINKING_MODE_OPTIONS,
      thinkingBudget: {
        enabled: this.options.thinkingBudgetEnabled,
        budgetTokens: effectiveThinkingBudget,
        maxNewTokens: this.options.thinkingMaxNewTokens
      },
      messages: request.messages.map(toOllamaMessage)
    });
  }

  protected async executeOllamaChat(request: OllamaChatRequest): Promise<string> {
    return ollamaChat(request);
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

export async function ollamaChat(request: OllamaChatRequest): Promise<string> {
  const thinkingConfig = request.thinkingBudget;
  const budget = normalizePositiveInteger(thinkingConfig?.budgetTokens);
  const thinkingEnabled = thinkingConfig?.enabled === true && budget !== null && isQwenModel(request.model);

  if (!thinkingEnabled || budget === null) {
    const single = await executeOllamaChatRequest(request, request.messages, request.options);
    if (!hasText(single.content)) {
      throw new Error("Ollama response missing content");
    }
    return single.content;
  }

  // Pass 1: enforce a thinking-token budget.
  const firstPass = await executeOllamaChatRequest(
    request,
    request.messages,
    { ...(request.options ?? {}), num_predict: budget }
  );
  if (firstPass.doneReason !== "length") {
    if (!hasText(firstPass.content)) {
      throw new Error("Ollama response missing content");
    }
    return firstPass.content;
  }

  // Pass 2: budget reached on pass 1, append early-stop prompt and continue.
  const firstPassText = hasText(firstPass.content) ? firstPass.content : "";
  const secondPassMessages: OllamaMessage[] = [
    ...request.messages,
    {
      role: "assistant",
      content: `${firstPassText}${thinkingConfig?.earlyStoppingPrompt ?? DEFAULT_EARLY_STOPPING_PROMPT}`
    },
    {
      role: "user",
      content: thinkingConfig?.continuePrompt ?? DEFAULT_CONTINUE_PROMPT
    }
  ];

  const secondPass = await executeOllamaChatRequest(
    request,
    secondPassMessages,
    resolveSecondPassOptions(request.options, thinkingConfig?.maxNewTokens)
  );
  if (!hasText(secondPass.content)) {
    throw new Error("Ollama response missing content");
  }
  return secondPass.content;
}

async function executeOllamaChatRequest(
  request: OllamaChatRequest,
  messages: OllamaMessage[],
  options: OllamaChatOptions | undefined
): Promise<OllamaChatResult> {
  const baseUrl = request.baseUrl.replace(/\/$/, "");
  const url = `${baseUrl}/api/chat`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: request.model,
        messages,
        keep_alive: request.keepAlive ?? 300,
        stream: false,
        options
      }),
      signal: controller.signal
    });

    if (!res.ok) {
      throw new Error(`Ollama HTTP ${res.status}`);
    }

    const data = (await res.json()) as OllamaChatRawResponse;
    const content = extractAssistantText(data);

    return {
      content,
      done: data.done === true,
      doneReason: typeof data.done_reason === "string" ? data.done_reason : ""
    };
  } finally {
    clearTimeout(timeout);
  }
}

function hasText(content: string): boolean {
  return String(content ?? "").trim().length > 0;
}

function toOllamaMessage(message: {
  role: "system" | "user" | "assistant";
  content: string;
  images?: string[];
}): OllamaMessage {
  return {
    role: message.role,
    content: message.content,
    images: Array.isArray(message.images) ? message.images : undefined
  };
}

function toOllamaChatOptions(
  options: Record<string, unknown> | undefined
): OllamaChatOptions | undefined {
  if (!options) {
    return undefined;
  }
  return options as OllamaChatOptions;
}

function extractAssistantText(data: OllamaChatRawResponse): string {
  const contentCandidates = [data.message?.content, data.response];
  for (const candidate of contentCandidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }

  const thinkingCandidates = [
    data.message?.thinking,
    data.message?.reasoning,
    data.thinking,
    data.reasoning
  ];
  for (const candidate of thinkingCandidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return `<think>\n${candidate.trim()}\n`;
    }
  }
  return "";
}

function isQwenModel(model: string): boolean {
  return /qwen/i.test(String(model ?? ""));
}

function normalizePositiveInteger(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }
  return Math.floor(n);
}

function resolveSecondPassOptions(
  base: OllamaChatOptions | undefined,
  maxNewTokens: unknown
): OllamaChatOptions {
  const maxTokens = normalizePositiveInteger(maxNewTokens)
    ?? normalizePositiveInteger(base?.num_predict)
    ?? DEFAULT_THINKING_MAX_NEW_TOKENS;
  return {
    ...(base ?? {}),
    num_predict: maxTokens
  };
}

function parseEnvPositiveInteger(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

function parseEnvBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (typeof raw !== "string") {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}
