import { OpenAIQuotaErrorInput, OpenAIUsageDelta } from "../../../integrations/openai/quotaManager";
import {
  isRecord,
  normalizeText,
  parsePositiveOrZero,
  truncate
} from "./shared";
import type {
  OpenAIChatRequest,
  OpenAIChatResponse,
  OpenAIChatResult,
  OpenAIContentPart,
  OpenAIContentPartResponse,
  OpenAIErrorInfo,
  OpenAIMessage
} from "./types";

export async function openAIChat(request: OpenAIChatRequest): Promise<OpenAIChatResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
  const baseUrl = request.baseUrl.replace(/\/$/, "");
  const path = request.chatCompletionsPath.startsWith("/")
    ? request.chatCompletionsPath
    : `/${request.chatCompletionsPath}`;

  try {
    const requestPayload: Record<string, unknown> = {
      model: request.model,
      stream: false,
      messages: request.messages,
      ...(request.options ?? {})
    };
    if (request.chatTemplateKwargs && Object.keys(request.chatTemplateKwargs).length > 0) {
      requestPayload.chat_template_kwargs = request.chatTemplateKwargs;
    }

    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${request.apiKey}`
      },
      body: JSON.stringify(requestPayload),
      signal: controller.signal
    });

    if (!response.ok) {
      const detail = await parseErrorPayload(response);
      throw new OpenAIChatError(
        `openai HTTP ${response.status}${detail.message ? `: ${truncate(detail.message, 240)}` : ""}`,
        { status: response.status, code: detail.code, type: detail.type }
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

    return {
      content,
      usage: extractUsage(payload)
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function toOpenAIMessage(input: {
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
    parts.push({ type: "text", text: content });
  }
  for (const image of images) {
    const url = normalizeImageUrl(image);
    if (url) {
      parts.push({
        type: "image_url",
        image_url: { url }
      });
    }
  }

  return parts.length > 0
    ? { role: input.role, content: parts }
    : { role: input.role, content };
}

export function estimateCostUsd(
  inputTokens: number,
  outputTokens: number,
  inputRatePer1M: number | null,
  outputRatePer1M: number | null
): number {
  if (inputRatePer1M === null || outputRatePer1M === null) {
    return 0;
  }
  const value = (Math.max(0, inputTokens) * inputRatePer1M + Math.max(0, outputTokens) * outputRatePer1M) / 1_000_000;
  return Number.isFinite(value) && value > 0 ? Math.round(value * 1_000_000) / 1_000_000 : 0;
}

export function toOpenAIErrorInfo(error: unknown): OpenAIErrorInfo {
  if (error instanceof OpenAIChatError) {
    return {
      status: error.status,
      code: error.code,
      type: error.type,
      message: normalizeText(error.message)
    };
  }
  if (error instanceof Error) {
    return { status: 0, code: "", type: "", message: normalizeText(error.message) || "unknown error" };
  }
  return { status: 0, code: "", type: "", message: normalizeText(String(error ?? "")) || "unknown error" };
}

export function isQuotaExceededError(error: OpenAIErrorInfo): boolean {
  const code = error.code.toLowerCase();
  const type = error.type.toLowerCase();
  const message = error.message.toLowerCase();
  return ["insufficient_quota", "billing_hard_limit_reached", "quota_exceeded"].includes(code)
    || ["insufficient_quota", "billing_hard_limit_reached"].includes(type)
    || (error.status === 429 && /(quota|billing|hard limit|insufficient)/i.test(message));
}

export function toQuotaErrorInput(error: OpenAIErrorInfo): OpenAIQuotaErrorInput {
  return {
    status: error.status,
    code: error.code,
    message: error.message || "unknown error"
  };
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
    if (parsed.error) {
      return {
        message: normalizeText(parsed.error.message),
        code: normalizeText(parsed.error.code),
        type: normalizeText(parsed.error.type)
      };
    }
  } catch {
    // Keep raw text fallback below.
  }
  return { message: text.trim(), code: "", type: "" };
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
