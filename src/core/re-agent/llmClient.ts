import { ReActAction, ReAgentTraceStep } from "./types";

export type ReAgentToolDescriptor = { name: string; description?: string };
export type ReAgentLlmStepInput = {
  sessionId: string;
  input: string;
  step: number;
  maxSteps: number;
  history: ReAgentTraceStep[];
  tools: ReAgentToolDescriptor[];
};

export interface ReAgentLlmClient {
  nextAction(input: ReAgentLlmStepInput): Promise<ReActAction>;
}

export type OllamaReAgentLlmClientOptions = {
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
};

const DEFAULT_MODEL = "qwen3.5:9b";
const DEFAULT_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_TIMEOUT_MS = 30_000;
const SYSTEM_PROMPT = "You are a ReAct sub-agent. Output one JSON object only. tool={\"kind\":\"tool\",\"tool\":\"name\",\"action\":\"op\",\"params\":{}} respond={\"kind\":\"respond\",\"response\":\"text\"}";

export class OllamaReAgentLlmClient implements ReAgentLlmClient {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: (input: string, init?: RequestInit) => Promise<Response>;

  constructor(options: OllamaReAgentLlmClientOptions = {}) {
    this.baseUrl = String(options.baseUrl ?? process.env.RE_AGENT_OLLAMA_BASE_URL ?? process.env.OLLAMA_BASE_URL ?? DEFAULT_BASE_URL)
      .trim()
      .replace(/\/$/, "");
    this.model = String(options.model ?? process.env.RE_AGENT_MODEL ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL;
    this.timeoutMs = readPositiveInt(options.timeoutMs, process.env.RE_AGENT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  async nextAction(input: ReAgentLlmStepInput): Promise<ReActAction> {
    const controller = typeof AbortController === "undefined" ? null : new AbortController();
    const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : undefined;

    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: JSON.stringify({ sessionId: input.sessionId, step: `${input.step}/${input.maxSteps}`, input: input.input, tools: input.tools, history: input.history }, null, 2) }
          ]
        }),
        ...(controller ? { signal: controller.signal } : {})
      });

      if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
      const payload = (await response.json()) as { message?: { content?: string }; response?: string };
      return parseAction(String(payload.message?.content ?? payload.response ?? "").trim());
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

function parseAction(text: string): ReActAction {
  const parsed = parseJson(unwrapFence(text));
  if (!parsed) return { kind: "respond", response: text || "暂时无法完成该请求。" };

  const kind = pick(parsed.kind, parsed.type).toLowerCase();
  const thought = pick(parsed.thought) || undefined;
  const response = pick(parsed.response, parsed.final, parsed.answer);
  const tool = pick(parsed.tool);
  const action = pick(parsed.action, parsed.op, parsed.name);

  if ((kind === "tool" || tool) && tool && action) {
    return { kind: "tool", ...(thought ? { thought } : {}), tool, action, params: isRecord(parsed.params) ? parsed.params : {} };
  }
  return { kind: "respond", ...(thought ? { thought } : {}), response: response || text || "暂时无法完成该请求。" };
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function unwrapFence(text: string): string {
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : text;
}

function pick(...values: unknown[]): string {
  for (const value of values) if (typeof value === "string" && value.trim()) return value.trim();
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPositiveInt(raw: unknown, envRaw: unknown, fallback: number): number {
  for (const value of [raw, envRaw]) {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return fallback;
}
