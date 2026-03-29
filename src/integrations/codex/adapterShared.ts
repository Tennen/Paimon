import { CodexRunEvent, CodexRunRequest } from "./adapterTypes";

export function sanitizeTaskId(input: string): string {
  const cleaned = String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_.]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "");
  return cleaned || `task-${Date.now()}`;
}

export function emitCodexEvent(listener: CodexRunRequest["onEvent"], event: CodexRunEvent): void {
  if (!listener) {
    return;
  }
  try {
    listener(event);
  } catch {
    // ignore listener errors
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function resolveCodexModel(...candidates: Array<string | undefined>): string {
  const fromOptions = candidates.find((item) => typeof item === "string" && item.trim().length > 0);
  if (fromOptions) {
    return fromOptions.trim();
  }
  const fromEnv = String(process.env.EVOLUTION_CODEX_MODEL ?? process.env.CODEX_MODEL ?? "").trim();
  return fromEnv;
}

export function resolveCodexReasoningEffort(...candidates: Array<string | undefined>): string {
  for (const candidate of candidates) {
    const normalized = normalizeReasoningEffort(candidate);
    if (normalized) {
      return normalized;
    }
  }
  return normalizeReasoningEffort(
    process.env.EVOLUTION_CODEX_REASONING_EFFORT
      ?? process.env.CODEX_MODEL_REASONING_EFFORT
      ?? process.env.CODEX_REASONING_EFFORT
  );
}

export function normalizeApprovalPolicy(value: unknown): string {
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "untrusted" || text === "on-request" || text === "on-failure" || text === "never") {
    return text;
  }
  return "on-request";
}

export function normalizeReasoningEffort(value: unknown): string {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) {
    return "";
  }
  return text;
}

export function formatTomlString(value: string): string {
  return JSON.stringify(value);
}
