import { resolveSearchEngineSelector } from "../../../integrations/search-engine/store";
import { MarketPhase } from "./types";

export function normalizeMarketCode(raw: unknown): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) {
    return "";
  }
  if (digits.length >= 6) {
    return digits.slice(-6);
  }
  return digits.padStart(6, "0");
}

export function parseMarketCodeList(raw: string): string[] {
  const text = String(raw ?? "").trim();
  if (!text) {
    return [];
  }

  const tokenized = text
    .split(/[\s,，;；|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const values = tokenized.length > 0 ? tokenized : [text];

  const dedup = new Set<string>();
  for (const item of values) {
    const extracted = extractSixDigitCode(item);
    const code = normalizeMarketCode(extracted);
    if (code) {
      dedup.add(code);
    }
  }
  return Array.from(dedup);
}

export function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function normalizeMarketAnalysisEngine(raw: unknown): string {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value || value === "local" || value === "default" || value === "auto") {
    return "local";
  }
  if (["gpt_plugin", "gpt-plugin", "gptplugin", "chatgpt-bridge", "chatgpt_bridge", "bridge"].includes(value)) {
    return "gpt_plugin";
  }
  if (value === "gemini") {
    return "gemini";
  }
  return value.replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "local";
}

export function normalizeMarketSearchEngine(raw: unknown): string {
  return resolveSearchEngineSelector(raw);
}

export function normalizeDailyTime(raw: string): string | null {
  const text = String(raw ?? "").trim();
  if (!/^\d{2}:\d{2}$/.test(text)) {
    return null;
  }

  const [hourRaw, minuteRaw] = text.split(":");
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function parseMarketPhase(raw: unknown): MarketPhase | null {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) {
    return null;
  }
  if (value === "midday") {
    return "midday";
  }
  if (value === "close") {
    return "close";
  }
  return null;
}

export function roundTo(value: number, digits: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function getStringField(source: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return "";
}

export function extractSixDigitCode(raw: string): string {
  const text = raw.trim();
  if (!text) {
    return "";
  }

  if (/^\d{6}$/.test(text)) {
    return text;
  }

  const secidMatch = text.match(/[01]\.(\d{6})/);
  if (secidMatch?.[1]) {
    return secidMatch[1];
  }

  const genericMatch = text.match(/(\d{6})/);
  return genericMatch?.[1] ?? "";
}
