import { InternalChatRequest, LLMChatEngine } from "../chat_engine";
import { LLMExecutionStep } from "../llm";

export type GeminiGenerateContentRequest = {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  systemInstruction?: string;
  contents: GeminiContent[];
  generationConfig?: Record<string, unknown>;
};

export type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: unknown;
      }>;
    };
  }>;
  error?: {
    code?: unknown;
    message?: unknown;
    status?: unknown;
  };
};

type GeminiContent = {
  role: "user" | "model";
  parts: Array<{
    text: string;
  }>;
};

export type GeminiLLMOptions = {
  baseUrl: string;
  apiKey: string;
  model: string;
  planningModel: string;
  timeoutMs: number;
  planningTimeoutMs: number;
  maxRetries: number;
  strictJson: boolean;
  selectionOptions?: Record<string, unknown>;
  planningOptions?: Record<string, unknown>;
};

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-2.0-flash";

export class GeminiLLMEngine extends LLMChatEngine {
  private readonly options: GeminiLLMOptions;

  constructor(options?: Partial<GeminiLLMOptions>) {
    const defaultTimeoutMs = parsePositiveInteger(process.env.LLM_TIMEOUT_MS, 30000);
    const maxRetries = parsePositiveInteger(process.env.LLM_MAX_RETRIES, 2);
    const strictJson = parseBoolean(process.env.LLM_STRICT_JSON, true);
    const defaultModel = String(
      options?.model
      ?? process.env.GEMINI_MODEL
      ?? process.env.MARKET_ANALYSIS_GEMINI_MODEL
      ?? DEFAULT_MODEL
    ).trim() || DEFAULT_MODEL;

    super({
      maxRetries: options?.maxRetries ?? maxRetries,
      strictJson: options?.strictJson ?? strictJson
    });

    this.options = {
      baseUrl: String(options?.baseUrl ?? process.env.GEMINI_BASE_URL ?? DEFAULT_BASE_URL).trim() || DEFAULT_BASE_URL,
      apiKey: String(options?.apiKey ?? process.env.GEMINI_API_KEY ?? "").trim(),
      model: defaultModel,
      planningModel: String(options?.planningModel ?? process.env.GEMINI_PLANNING_MODEL ?? defaultModel).trim() || defaultModel,
      timeoutMs: options?.timeoutMs ?? defaultTimeoutMs,
      planningTimeoutMs: options?.planningTimeoutMs
        ?? parsePositiveInteger(process.env.LLM_PLANNING_TIMEOUT_MS, defaultTimeoutMs),
      maxRetries: options?.maxRetries ?? maxRetries,
      strictJson: options?.strictJson ?? strictJson,
      selectionOptions: options?.selectionOptions
        ?? parseEnvObject(process.env.GEMINI_CHAT_OPTIONS),
      planningOptions: options?.planningOptions
        ?? parseEnvObject(process.env.GEMINI_PLANNING_CHAT_OPTIONS)
    };
  }

  getModelForStep(step: LLMExecutionStep): string {
    return step === "planning" ? this.options.planningModel : this.options.model;
  }

  getProviderName(): "gemini" {
    return "gemini";
  }

  protected async executeChat(request: InternalChatRequest): Promise<string> {
    if (!this.options.apiKey) {
      throw new Error("missing GEMINI_API_KEY");
    }

    const isPlanning = request.step === "planning";
    const isSelection = request.step === "routing";
    const generationConfig = request.options
      ?? (isPlanning ? this.options.planningOptions : isSelection ? this.options.selectionOptions : undefined);

    const payload = buildGeminiPayload(request.messages);
    const content = await geminiGenerateContent({
      baseUrl: this.options.baseUrl,
      apiKey: this.options.apiKey,
      model: request.model,
      timeoutMs: request.timeoutMs ?? (isPlanning ? this.options.planningTimeoutMs : this.options.timeoutMs),
      systemInstruction: payload.systemInstruction,
      contents: payload.contents,
      generationConfig
    });

    const normalized = content.trim();
    if (!normalized) {
      throw new Error("gemini returned empty response");
    }
    return normalized;
  }
}

export async function geminiGenerateContent(request: GeminiGenerateContentRequest): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeoutMs);

  const baseUrl = request.baseUrl.replace(/\/$/, "");
  const endpoint = `${baseUrl}/models/${encodeURIComponent(request.model)}:generateContent`;
  const url = new URL(endpoint);
  url.searchParams.set("key", request.apiKey);

  try {
    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ...(request.systemInstruction
          ? {
              systemInstruction: {
                parts: [{ text: request.systemInstruction }]
              }
            }
          : {}),
        contents: request.contents,
        ...(request.generationConfig ? { generationConfig: request.generationConfig } : {})
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const detail = await parseErrorPayload(response);
      throw new Error(
        `gemini HTTP ${response.status}${detail.message ? `: ${truncate(detail.message, 240)}` : ""}`
      );
    }

    const payload = (await response.json()) as GeminiGenerateContentResponse;
    if (payload.error) {
      throw new Error(normalizeText(payload.error.message) || "gemini API error");
    }

    const text = extractCandidateText(payload);
    if (!text) {
      throw new Error("gemini response missing content");
    }

    return text;
  } finally {
    clearTimeout(timeout);
  }
}

function buildGeminiPayload(messages: Array<{
  role: "system" | "user" | "assistant";
  content: string;
  images?: string[];
}>): {
  systemInstruction?: string;
  contents: GeminiContent[];
} {
  const systemLines: string[] = [];
  const contents: GeminiContent[] = [];

  for (const message of messages) {
    const text = formatMessageText(message.content, message.images);
    if (!text) {
      continue;
    }

    if (message.role === "system") {
      systemLines.push(text);
      continue;
    }

    contents.push({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text }]
    });
  }

  if (contents.length === 0) {
    contents.push({
      role: "user",
      parts: [{ text: "请根据系统指令继续。" }]
    });
  }

  const systemInstruction = systemLines.join("\n\n").trim();
  return {
    ...(systemInstruction ? { systemInstruction } : {}),
    contents
  };
}

function formatMessageText(content: string, images?: string[]): string {
  const text = normalizeText(content);
  const imageLines = Array.isArray(images)
    ? images
      .map((item) => normalizeText(item))
      .filter(Boolean)
      .map((item, index) => `[image:${index + 1}] ${item}`)
    : [];

  if (!text && imageLines.length === 0) {
    return "";
  }
  return [text, ...imageLines].filter(Boolean).join("\n");
}

function extractCandidateText(payload: GeminiGenerateContentResponse): string {
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  const first = candidates[0];
  const parts = Array.isArray(first?.content?.parts) ? first.content.parts : [];
  return parts
    .map((part) => normalizeText(part?.text))
    .filter(Boolean)
    .join("\n")
    .trim();
}

async function parseErrorPayload(response: Response): Promise<{ message: string }> {
  const text = await response.text().catch(() => "");
  if (!text.trim()) {
    return { message: "" };
  }

  try {
    const parsed = JSON.parse(text) as GeminiGenerateContentResponse;
    if (parsed && parsed.error) {
      return {
        message: normalizeText(parsed.error.message)
      };
    }
  } catch {
    // Ignore JSON parse error and use raw text fallback.
  }

  return {
    message: text.trim()
  };
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

function parseEnvObject(raw: unknown): Record<string, unknown> | undefined {
  if (typeof raw !== "string" || !raw.trim()) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return asRecord(parsed) ?? undefined;
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeText(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}
