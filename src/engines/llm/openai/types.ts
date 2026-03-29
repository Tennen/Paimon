import type { OpenAIQuotaPolicy } from "../../../integrations/openai/quotaManager";

export type OpenAIMessage = {
  role: "system" | "user" | "assistant";
  content: string | OpenAIContentPart[];
};

export type OpenAIContentPart = {
  type: "text";
  text: string;
} | {
  type: "image_url";
  image_url: {
    url: string;
  };
};

export type OpenAIChatRequest = {
  baseUrl: string;
  apiKey: string;
  chatCompletionsPath: string;
  model: string;
  messages: OpenAIMessage[];
  timeoutMs: number;
  options?: Record<string, unknown>;
  chatTemplateKwargs?: Record<string, unknown> | null;
};

export type OpenAIChatResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    total_tokens?: unknown;
  };
  error?: {
    code?: unknown;
    type?: unknown;
    message?: unknown;
  };
};

export type OpenAIContentPartResponse = {
  type?: unknown;
  text?: unknown;
};

export type OpenAIChatResult = {
  content: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
};

export type OpenAILLMOptions = {
  baseUrl: string;
  apiKey: string;
  chatCompletionsPath: string;
  model: string;
  planningModel: string;
  timeoutMs: number;
  planningTimeoutMs: number;
  maxRetries: number;
  strictJson: boolean;
  selectionOptions?: Record<string, unknown>;
  planningOptions?: Record<string, unknown>;
  chatTemplateKwargs?: Record<string, unknown>;
  planningChatTemplateKwargs?: Record<string, unknown>;
  fallbackToChatgptBridge: boolean;
  forceBridge: boolean;
  costInputPer1M: number | null;
  costOutputPer1M: number | null;
  quotaPolicy: OpenAIQuotaPolicy;
};

export type OpenAIErrorInfo = {
  status: number;
  code: string;
  type: string;
  message: string;
};
