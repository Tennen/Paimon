import crypto from "crypto";
import { TRACKING_QUERY_PARAMS } from "./defaults";
import { TopicPushCategory } from "./types";

export function normalizeText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

export function clampText(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function buildStableHash(value: string): string {
  return crypto.createHash("sha1").update(value).digest("hex");
}

export function normalizeSourceId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function normalizeProfileId(raw: unknown): string {
  return normalizeText(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function normalizeCategory(raw: unknown): TopicPushCategory | null {
  const value = normalizeText(raw).toLowerCase();
  if (!value) {
    return null;
  }
  if (["engineering", "eng", "工程"].includes(value)) {
    return "engineering";
  }
  if (["news", "新闻"].includes(value)) {
    return "news";
  }
  if (["ecosystem", "eco", "生态"].includes(value)) {
    return "ecosystem";
  }
  return null;
}

export function clampInteger(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const rounded = Math.floor(value);
  if (rounded < min) {
    return min;
  }
  if (rounded > max) {
    return max;
  }
  return rounded;
}

export function clampNumber(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

export function clampWeight(raw: number): number {
  if (!Number.isFinite(raw)) {
    return 1;
  }
  if (raw < 0.1) {
    return 0.1;
  }
  if (raw > 5) {
    return 5;
  }
  return Math.round(raw * 100) / 100;
}

export function normalizeQuotaNumber(raw: unknown, fallback: number): number {
  return clampInteger(raw, fallback, 0, 40);
}

export function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return undefined;
}

export function parseOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

export function parseDateToIso(raw: unknown): string | null {
  const value = normalizeText(raw);
  if (!value) {
    return null;
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    return null;
  }
  return new Date(ms).toISOString();
}

export function normalizeUrl(rawUrl: string): string {
  const raw = normalizeText(rawUrl);
  if (!raw) {
    return "";
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }

  if (url.protocol === "http:") {
    url.protocol = "https:";
  }

  url.hash = "";

  const normalizedParams = new URLSearchParams();
  const sorted = Array.from(url.searchParams.entries()).sort(([left], [right]) => left.localeCompare(right));
  for (const [key, value] of sorted) {
    const keyLower = key.toLowerCase();
    if (keyLower.startsWith("utm_")) {
      continue;
    }
    if (TRACKING_QUERY_PARAMS.has(keyLower)) {
      continue;
    }
    normalizedParams.append(key, value);
  }

  const query = normalizedParams.toString();
  url.search = query ? `?${query}` : "";

  if (url.pathname.length > 1) {
    url.pathname = url.pathname.replace(/\/+$/g, "");
  }

  return url.toString();
}

export function normalizeFeedUrl(rawUrl: string): string {
  const normalized = normalizeUrl(rawUrl);
  if (!normalized) {
    return "";
  }

  try {
    const parsed = new URL(normalized);
    if (!parsed.protocol.startsWith("http")) {
      return "";
    }
  } catch {
    return "";
  }

  return normalized;
}

export function extractDomain(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    return url.hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

export function buildSourceId(name: string, feedUrl: string, index: number): string {
  const fromName = normalizeSourceId(name);
  if (fromName) {
    return fromName;
  }

  const domain = extractDomain(feedUrl);
  if (domain) {
    return normalizeSourceId(domain);
  }

  return `source-${index + 1}`;
}

export function formatLocalDate(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) {
    return iso;
  }
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function formatLocalTime(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) {
    return iso;
  }
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }
  return value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === null || value === undefined) {
    return [];
  }
  return [value];
}
