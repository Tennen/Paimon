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

const DEFAULT_THINKING_MAX_NEW_TOKENS = 32768;
const DEFAULT_EARLY_STOPPING_PROMPT =
  "\n\nConsidering the limited time by the user, I have to give the solution based on the thinking directly now.\n</think>\n\n";
const DEFAULT_CONTINUE_PROMPT =
  "Continue and finish your pending response now. If you are still in thinking mode, stop thinking and provide the final answer directly.";

export async function ollamaChat(request: OllamaChatRequest): Promise<string> {
  const thinkingConfig = request.thinkingBudget;
  const budget = normalizePositiveInteger(thinkingConfig?.budgetTokens);
  const thinkingEnabled = thinkingConfig?.enabled === true && budget !== null && isQwenModel(request.model);

  if (!thinkingEnabled || budget === null) {
    const single = await executeOllamaChat(request, request.messages, request.options);
    if (!hasText(single.content)) {
      throw new Error("Ollama response missing content");
    }
    return single.content;
  }

  // Pass 1: enforce a thinking-token budget.
  const firstPass = await executeOllamaChat(
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

  const secondPass = await executeOllamaChat(
    request,
    secondPassMessages,
    resolveSecondPassOptions(request.options, thinkingConfig?.maxNewTokens)
  );
  if (!hasText(secondPass.content)) {
    throw new Error("Ollama response missing content");
  }
  return secondPass.content;
}

async function executeOllamaChat(
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
        "keep_alive": request.keepAlive ?? 300,
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
