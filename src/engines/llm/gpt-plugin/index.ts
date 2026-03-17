import { executeInNewChat } from "../../../integrations/chatgpt-bridge/service";
import { InternalChatRequest, LLMChatEngine, resolveEngineSystemPrompt } from "../chat_engine";
import { LLMExecutionStep } from "../llm";

export type GPTPluginLLMOptions = {
  model: string;
  planningModel: string;
  timeoutMs: number;
  planningTimeoutMs: number;
  maxRetries: number;
  strictJson: boolean;
};

const DEFAULT_MODEL = "gpt-plugin";

export class GPTPluginLLMEngine extends LLMChatEngine {
  private readonly options: GPTPluginLLMOptions;

  constructor(options?: Partial<GPTPluginLLMOptions>) {
    const timeoutMs = parsePositiveInteger(options?.timeoutMs ?? process.env.GPT_PLUGIN_TIMEOUT_MS ?? process.env.LLM_TIMEOUT_MS, 30000);
    const planningTimeoutMs = parsePositiveInteger(
      options?.planningTimeoutMs
      ?? process.env.GPT_PLUGIN_PLANNING_TIMEOUT_MS
      ?? process.env.LLM_PLANNING_TIMEOUT_MS,
      timeoutMs
    );
    const maxRetries = parsePositiveInteger(options?.maxRetries ?? process.env.LLM_MAX_RETRIES, 2);
    const strictJson = parseBoolean(options?.strictJson ?? process.env.LLM_STRICT_JSON, true);
    const model = String(options?.model ?? process.env.GPT_PLUGIN_MODEL ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL;
    const planningModel = String(options?.planningModel ?? process.env.GPT_PLUGIN_PLANNING_MODEL ?? model).trim() || model;

    super({ maxRetries, strictJson });

    this.options = {
      model,
      planningModel,
      timeoutMs,
      planningTimeoutMs,
      maxRetries,
      strictJson
    };
  }

  getModelForStep(step: LLMExecutionStep): string {
    return step === "planning" ? this.options.planningModel : this.options.model;
  }

  getProviderName(): "gpt-plugin" {
    return "gpt-plugin";
  }

  protected async executeChat(request: InternalChatRequest): Promise<string> {
    const timeoutMs = request.timeoutMs
      ?? (request.step === "planning" ? this.options.planningTimeoutMs : this.options.timeoutMs);

    const prompt = buildBridgePrompt(request);
    const response = await withTimeout(
      Promise.resolve(executeInNewChat(prompt)),
      timeoutMs,
      "gpt-plugin request timeout"
    );
    const text = extractTextFromBridgeResponse(response);
    if (!text) {
      throw new Error("gpt-plugin returned empty response");
    }
    return text;
  }
}

function buildBridgePrompt(request: InternalChatRequest): string {
  const messageText = request.messages
    .map((message, index) => formatBridgeMessage(message, index + 1))
    .join("\n\n");
  const systemPrompt = resolveEngineSystemPrompt({
    defaultPrompt: [
      "You are acting as an LLM backend for an automation runtime.",
      "Read the provided conversation messages and output only the assistant reply body.",
      "If the messages demand strict JSON, output strict JSON only.",
      "Do not output markdown fences."
    ].join("\n"),
    customPrompt: request.engineSystemPrompt,
    mode: request.engineSystemPromptMode
  });

  return [
    systemPrompt,
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
  const images = Array.isArray(message.images)
    ? message.images.filter((item) => typeof item === "string" && item.trim())
    : [];
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
  const messageText = normalizeText(response.message);
  if (messageText) {
    return messageText;
  }
  if (!isRecord(response.output)) {
    return "";
  }
  return normalizeText(response.output.text);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function parsePositiveInteger(raw: unknown, fallback: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

function parseBoolean(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === "boolean") {
    return raw;
  }
  if (typeof raw !== "string") {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
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
