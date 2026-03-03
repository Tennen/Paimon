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
