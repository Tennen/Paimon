import type { SearchResultItem } from "./types";

type FetchJsonRequest = {
  method: "GET" | "POST";
  timeoutMs: number;
  headers?: Record<string, string>;
  body?: string;
};

const SENSITIVE_QUERY_KEYS = new Set([
  "api_key",
  "apikey",
  "token",
  "access_token",
  "auth",
  "authorization",
  "key",
  "secret"
]);

export async function fetchJsonWithTimeout(url: string, input: FetchJsonRequest): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  const startedAt = Date.now();
  const target = toSafeLogUrl(url);

  console.log(`[SearchEngine][HTTP] request ${input.method} ${target} timeout=${input.timeoutMs}ms`);

  try {
    const response = await fetch(url, {
      method: input.method,
      headers: input.headers,
      body: input.body,
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }

    const durationMs = Date.now() - startedAt;
    console.log(`[SearchEngine][HTTP] response ${input.method} ${target} status=${response.status} duration=${durationMs}ms`);
    return await response.json();
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[SearchEngine][HTTP] failed ${input.method} ${target} duration=${durationMs}ms error=${message}`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function dedupSearchItems(items: SearchResultItem[]): SearchResultItem[] {
  const map = new Map<string, SearchResultItem>();
  for (const item of items) {
    const key = `${item.title.toLowerCase()}|${String(item.link || "")}`;
    if (!map.has(key)) {
      map.set(key, item);
    }
  }
  return Array.from(map.values());
}

export function dedupStrings(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => String(item || "").trim()).filter(Boolean)));
}

export function readNestedString(input: unknown, key: string): string {
  if (!input || typeof input !== "object") {
    return "";
  }
  const source = input as Record<string, unknown>;
  const value = source[key];
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeText(raw: unknown): string {
  return String(raw ?? "").trim();
}

export function truncateLogText(input: string, maxLength: number): string {
  if (input.length <= maxLength) {
    return input;
  }
  return `${input.slice(0, maxLength)}...`;
}

export function clipText(input: string, maxLength: number): string {
  const normalized = String(input || "").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
}

function toSafeLogUrl(input: string): string {
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
