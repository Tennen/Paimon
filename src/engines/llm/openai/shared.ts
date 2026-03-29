import type { OpenAIErrorInfo, OpenAIChatResponse } from "./types";

export class OpenAIChatError extends Error {
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

export async function parseErrorPayload(response: Response): Promise<{ message: string; code: string; type: string }> {
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
    // keep raw fallback below
  }
  return {
    message: text.trim(),
    code: "",
    type: ""
  };
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
    return {
      status: 0,
      code: "",
      type: "",
      message: normalizeText(error.message) || "unknown error"
    };
  }
  return {
    status: 0,
    code: "",
    type: "",
    message: normalizeText(String(error ?? "")) || "unknown error"
  };
}

export function isQuotaExceededError(error: OpenAIErrorInfo): boolean {
  const code = error.code.toLowerCase();
  const type = error.type.toLowerCase();
  const message = error.message.toLowerCase();
  return ["insufficient_quota", "billing_hard_limit_reached", "quota_exceeded"].includes(code)
    || ["insufficient_quota", "billing_hard_limit_reached"].includes(type)
    || (error.status === 429 && /(quota|billing|hard limit|insufficient)/i.test(message));
}

export function toQuotaErrorInput(error: OpenAIErrorInfo): { status: number; code: string; message: string } {
  return {
    status: error.status,
    code: error.code,
    message: error.message || "unknown error"
  };
}

export function parsePositiveInteger(raw: unknown, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export function parseNullablePositiveNumber(raw: unknown): number | null {
  if (raw === undefined || raw === null) {
    return null;
  }
  const text = String(raw).trim();
  if (!text) {
    return null;
  }
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function parsePositiveOrZero(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

export function parseBoolean(raw: unknown, fallback: boolean): boolean {
  if (typeof raw !== "string") {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

export function parseEnvObject(raw: unknown, envName: string): Record<string, unknown> | undefined {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      console.warn(`[LLM] ignore ${envName}: expected JSON object`);
      return undefined;
    }
    return parsed;
  } catch (error) {
    console.warn(`[LLM] ignore ${envName}: ${(error as Error).message}`);
    return undefined;
  }
}

export function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}

export function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
