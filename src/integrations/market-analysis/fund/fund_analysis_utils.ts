import { jsonrepair } from "jsonrepair";

export const SENSITIVE_QUERY_KEYS = new Set([
  "api_key",
  "apikey",
  "token",
  "access_token",
  "auth",
  "authorization",
  "key",
  "secret"
]);

export function normalizePositiveNumber(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return NaN;
  }
  return numeric;
}

export function normalizeSignedNumber(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return NaN;
  }
  return numeric;
}

export function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
      .map((item) => String(item || "").trim())
      .filter(Boolean)
    : [];
}

export function normalizeNumber(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function normalizeOptionalNonNegativeNumber(value: unknown): number | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return undefined;
  }
  return numeric;
}

export function dedupStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)));
}

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  const rounded = Math.floor(numeric);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function round(value: number, digits: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeOptionalText(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function parseJsonLoose(input: string): unknown {
  const normalized = String(input || "").trim();
  if (!normalized) {
    return null;
  }

  try {
    return JSON.parse(normalized);
  } catch {
    // no-op
  }

  try {
    return JSON.parse(jsonrepair(normalized));
  } catch {
    return null;
  }
}

export function truncateText(input: string, maxLength: number): string {
  const source = String(input || "").trim();
  if (!source) {
    return "";
  }
  if (source.length <= maxLength) {
    return source;
  }
  return `${source.slice(0, Math.max(0, maxLength - 1))}…`;
}

export async function fetchJsonWithTimeout(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  const target = toSafeLogUrl(url);

  console.log(`[MarketAnalysis][HTTP][fund] request GET ${target} timeout=${timeoutMs}ms`);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    const durationMs = Date.now() - startedAt;
    console.log(`[MarketAnalysis][HTTP][fund] response GET ${target} status=${response.status} duration=${durationMs}ms`);
    return await response.json();
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[MarketAnalysis][HTTP][fund] failed GET ${target} duration=${durationMs}ms error=${message}`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchTextWithTimeout(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  const target = toSafeLogUrl(url);

  console.log(`[MarketAnalysis][HTTP][fund] request GET ${target} timeout=${timeoutMs}ms response=text`);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }

    const durationMs = Date.now() - startedAt;
    console.log(`[MarketAnalysis][HTTP][fund] response GET ${target} status=${response.status} duration=${durationMs}ms response=text`);
    return await response.text();
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[MarketAnalysis][HTTP][fund] failed GET ${target} duration=${durationMs}ms response=text error=${message}`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function toSafeLogUrl(input: string): string {
  const raw = String(input || "").trim();
  if (!raw) {
    return "-";
  }

  try {
    const parsed = new URL(raw);
    for (const [key] of parsed.searchParams) {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
        parsed.searchParams.set(key, "***");
      }
    }
    const search = parsed.searchParams.toString();
    return truncateLogText(`${parsed.origin}${parsed.pathname}${search ? `?${search}` : ""}`, 220);
  } catch {
    return truncateLogText(raw, 220);
  }
}

export function truncateLogText(input: string, maxLength: number): string {
  if (input.length <= maxLength) {
    return input;
  }
  return `${input.slice(0, maxLength)}...`;
}
