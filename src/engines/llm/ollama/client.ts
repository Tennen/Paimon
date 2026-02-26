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
  message?: { content?: string };
  response?: string;
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
    return single.content;
  }

  // Pass 1: enforce a thinking-token budget.
  const firstPass = await executeOllamaChat(
    request,
    request.messages,
    { ...(request.options ?? {}), num_predict: budget }
  );
  if (firstPass.doneReason !== "length") {
    return firstPass.content;
  }

  // If no open think block was observed, fall back to a normal full generation.
  if (!hasOpenThinkBlock(firstPass.content)) {
    const secondPassFallback = await executeOllamaChat(
      request,
      request.messages,
      resolveSecondPassOptions(request.options, thinkingConfig?.maxNewTokens)
    );
    return secondPassFallback.content;
  }

  // Pass 2: append early-stop prompt and continue generation.
  const secondPassMessages: OllamaMessage[] = [
    ...request.messages,
    {
      role: "assistant",
      content: `${firstPass.content}${thinkingConfig?.earlyStoppingPrompt ?? DEFAULT_EARLY_STOPPING_PROMPT}`
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

    const content = data.message?.content ?? data.response;
    if (!content) {
      throw new Error("Ollama response missing content");
    }

    return {
      content,
      done: data.done === true,
      doneReason: typeof data.done_reason === "string" ? data.done_reason : ""
    };
  } finally {
    clearTimeout(timeout);
  }
}

function hasOpenThinkBlock(content: string): boolean {
  const text = String(content ?? "");
  return text.includes("<think>") && !text.includes("</think>");
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
