import type { OpenAIUsageDelta } from "../../../integrations/openai/quotaManager";
import {
  normalizeText,
  isRecord,
  parseErrorPayload,
  parsePositiveOrZero,
  truncate,
  OpenAIChatError
} from "./shared";
import type {
  OpenAIChatRequest,
  OpenAIChatResponse,
  OpenAIChatResult,
  OpenAIContentPart,
  OpenAIContentPartResponse,
  OpenAIMessage
} from "./types";

export async function openAIChat(request: OpenAIChatRequest): Promise<OpenAIChatResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
  const baseUrl = request.baseUrl.replace(/\/$/, "");
  const path = request.chatCompletionsPath.startsWith("/") ? request.chatCompletionsPath : `/${request.chatCompletionsPath}`;

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
    return { role: input.role, content };
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
      parts.push({ type: "image_url", image_url: { url } });
    }
  }
  return parts.length > 0 ? { role: input.role, content: parts } : { role: input.role, content };
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
  return /^https?:\/\//i.test(text) || /^data:/i.test(text) ? text : `data:image/jpeg;base64,${text}`;
}
