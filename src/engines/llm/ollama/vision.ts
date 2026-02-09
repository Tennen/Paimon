import { ollamaChat } from "./client";

export type VisionDescribeOptions = {
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
  prompt: string;
};

export async function describeImage(base64: string, options: Partial<VisionDescribeOptions> = {}): Promise<string> {
  const settings: VisionDescribeOptions = {
    baseUrl: options.baseUrl ?? process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
    model: options.model ?? process.env.OLLAMA_VISION_MODEL ?? process.env.OLLAMA_MODEL ?? "qwen3:4b",
    timeoutMs: options.timeoutMs ?? parseInt(process.env.VISION_TIMEOUT_MS ?? "30000", 10),
    maxRetries: options.maxRetries ?? parseInt(process.env.VISION_MAX_RETRIES ?? "1", 10),
    prompt:
      options.prompt ??
      process.env.VISION_PROMPT ??
      "请用中文简短描述图片内容，1句话以内，不要臆测或编造。"
  };

  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= settings.maxRetries; attempt += 1) {
    try {
      const content = await ollamaChat({
        baseUrl: settings.baseUrl,
        model: settings.model,
        timeoutMs: settings.timeoutMs,
        messages: [
          { role: "system", content: settings.prompt },
          { role: "user", content: "描述这张图片。", images: [base64] }
        ]
      });
      return content.trim();
    } catch (err) {
      lastError = err as Error;
    }
  }

  throw lastError ?? new Error("Vision describe failed");
}
