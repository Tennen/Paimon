import type { CodexApprovalPolicy, CodexReasoningEffort, CodexSandboxMode } from "./types";

const DEFAULT_APPROVAL_POLICY: CodexApprovalPolicy = "never";
const DEFAULT_SANDBOX: CodexSandboxMode = "read-only";
const ALLOWED_REASONING_EFFORT = new Set<CodexReasoningEffort>(["minimal", "low", "medium", "high", "xhigh"]);

export function readReasoningEffortOption(options: Record<string, unknown> | undefined): string | undefined {
  if (!options) {
    return undefined;
  }
  const candidate = options.reasoningEffort ?? options.reasoning_effort ?? options.model_reasoning_effort;
  return typeof candidate === "string" ? candidate : undefined;
}

export function normalizeReasoningEffort(...values: Array<unknown>): CodexReasoningEffort | "" {
  for (const value of values) {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (normalized && ALLOWED_REASONING_EFFORT.has(normalized as CodexReasoningEffort)) {
      return normalized as CodexReasoningEffort;
    }
  }
  return "";
}

export function normalizeApprovalPolicy(value: unknown): CodexApprovalPolicy {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "on-request" || normalized === "on-failure" || normalized === "never" || normalized === "untrusted") {
    return normalized;
  }
  return DEFAULT_APPROVAL_POLICY;
}

export function normalizeSandbox(value: unknown): CodexSandboxMode {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "read-only" || normalized === "workspace-write" || normalized === "danger-full-access") {
    return normalized;
  }
  return DEFAULT_SANDBOX;
}

export function parsePositiveInteger(raw: unknown, fallback: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

export function parseBoolean(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === "boolean") {
    return raw;
  }
  if (typeof raw !== "string") {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

export function resolveFirstText(...values: Array<unknown>): string {
  for (const value of values) {
    if (typeof value === "string") {
      const text = value.trim();
      if (text) {
        return text;
      }
    }
  }
  return "";
}

export function buildTaskId(step: string): string {
  const safeStep = String(step ?? "general")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "general";
  return `llm-${safeStep}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

export function summarizeCodexArgs(args: string[]): string {
  const summary: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const token = String(args[i] ?? "");
    if (token === "--json") {
      summary.push("json=true");
      continue;
    }
    if ((token === "--model" || token === "--sandbox" || token === "-a" || token === "--config") && i + 1 < args.length) {
      const key = token === "--model"
        ? "model"
        : token === "--sandbox"
          ? "sandbox"
          : token === "-a"
            ? "approval"
            : "config";
      summary.push(`${key}=${truncateText(String(args[i + 1] ?? ""), 80)}`);
      i += 1;
    }
  }

  return summary.join(" ");
}

export function truncateText(text: string, maxLength: number): string {
  const normalized = String(text ?? "").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
