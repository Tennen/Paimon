import type { LLMProviderType } from "./provider_store_types";

export const DEFAULT_PROVIDER_ID = "default-ollama";
export const DEFAULT_PROVIDER_NAME = "Default Ollama";
export const DEFAULT_GEMINI_PROVIDER_ID = "default-gemini";
export const DEFAULT_GPT_PLUGIN_PROVIDER_ID = "default-gpt-plugin";
export const DEFAULT_CODEX_PROVIDER_ID = "default-codex";

export function normalizeProviderType(raw: unknown): LLMProviderType {
  const value = String(raw ?? "").trim().toLowerCase();
  if (["llama-server", "llama_server", "llama.cpp", "llamacpp", "llama"].includes(value)) {
    return "llama-server";
  }
  if (["openai", "openai-like", "openai_like", "openai-api", "chatgpt", "gpt"].includes(value)) {
    return "openai";
  }
  if (["gemini", "gemini-like", "gemini_like", "google", "google-genai", "google-genai-api"].includes(value)) {
    return "gemini";
  }
  if (["gpt-plugin", "gpt_plugin", "gptplugin", "chatgpt-bridge", "chatgpt_bridge", "bridge"].includes(value)) {
    return "gpt-plugin";
  }
  if (["codex", "codex-cli", "codex_cli"].includes(value)) {
    return "codex";
  }
  return "ollama";
}

export function normalizeProviderId(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function resolveLegacyEngineSelector(selector: unknown): {
  isDefault: boolean;
  providerType?: LLMProviderType;
  providerId?: string;
} {
  const raw = String(selector ?? "").trim();
  if (!raw) {
    return { isDefault: true };
  }

  const lower = raw.toLowerCase();
  if (["default", "local", "auto"].includes(lower)) {
    return { isDefault: true };
  }
  if (["gpt_plugin", "gpt-plugin", "gptplugin", "chatgpt-bridge", "chatgpt_bridge", "bridge"].includes(lower)) {
    return { isDefault: false, providerType: "gpt-plugin" };
  }
  if (["codex", "codex-cli", "codex_cli"].includes(lower)) {
    return { isDefault: false, providerType: "codex" };
  }
  if (["openai", "openai-like", "openai_like", "openai-api", "chatgpt", "gpt"].includes(lower)) {
    return { isDefault: false, providerType: "openai" };
  }
  if (["gemini", "gemini-like", "gemini_like", "google", "google-genai", "google-genai-api"].includes(lower)) {
    return { isDefault: false, providerType: "gemini" };
  }
  if (lower === "ollama") {
    return { isDefault: false, providerType: "ollama" };
  }
  if (["llama-server", "llama_server", "llama.cpp", "llamacpp", "llama"].includes(lower)) {
    return { isDefault: false, providerType: "llama-server" };
  }

  const normalizedId = normalizeProviderId(raw);
  return normalizedId ? { isDefault: false, providerId: normalizedId } : { isDefault: true };
}

export function parseEnvObject(raw: unknown): Record<string, unknown> | undefined {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return asRecord(parsed) ?? undefined;
  } catch {
    return undefined;
  }
}

export function parsePositiveInteger(raw: unknown): number | undefined {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.floor(value);
}

export function parseNullablePositiveInteger(raw: unknown): number | null {
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return null;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.floor(value);
}

export function parseNullablePositiveNumber(raw: unknown): number | null {
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return null;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
}

export function parseBoolean(raw: unknown): boolean | undefined {
  if (typeof raw === "boolean") {
    return raw;
  }
  if (typeof raw !== "string") {
    return undefined;
  }
  const value = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(value)) {
    return false;
  }
  return undefined;
}

export function parseReasoningEffort(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const value = raw.trim().toLowerCase();
  if (!value) {
    return undefined;
  }
  if (!["minimal", "low", "medium", "high", "xhigh"].includes(value)) {
    return undefined;
  }
  return value;
}

export function normalizeText(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const value = raw.trim();
  return value || undefined;
}

export function asRecord(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  return input as Record<string, unknown>;
}
