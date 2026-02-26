export type OllamaMessage = {
  role: "system" | "user" | "assistant";
  content: string;
  images?: string[];
};

export type OllamaChatRequest = {
  baseUrl: string;
  model: string;
  messages: OllamaMessage[];
  timeoutMs: number;
  keepAlive?: number;
  options?: {
    temperature?: number;
    top_p?: number;
    top_k?: number;
    min_p?: number;
  };
};

export async function ollamaChat(request: OllamaChatRequest): Promise<string> {
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
        messages: request.messages,
        "keep_alive": request.keepAlive ?? 300,
        stream: false,
        options: request.options
      }),
      signal: controller.signal
    });

    if (!res.ok) {
      throw new Error(`Ollama HTTP ${res.status}`);
    }

    const data = (await res.json()) as {
      message?: { content?: string };
      response?: string;
    };

    const content = data.message?.content ?? data.response;
    console.log(data);
    if (!content) {
      throw new Error("Ollama response missing content");
    }

    return content;
  } finally {
    clearTimeout(timeout);
  }
}
