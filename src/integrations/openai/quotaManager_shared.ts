import type {
  OpenAIQuotaPolicy,
  OpenAIQuotaSnapshot,
  OpenAIQuotaState,
  OpenAIQuotaStatus,
  OpenAIUsageDelta
} from "./quotaManager_types";

const DEFAULT_NAMESPACE = "default";

type OpenAIQuotaStoreContainer = {
  version: 2;
  namespaces: Record<string, unknown>;
};

export function readOpenAIQuotaPolicyFromEnv(): OpenAIQuotaPolicy {
  return normalizePolicy({
    resetDay: normalizeResetDay(parseNumber(process.env.OPENAI_QUOTA_RESET_DAY, 1)),
    monthlyTokenLimit: parseNullablePositiveInteger(process.env.OPENAI_MONTHLY_TOKEN_LIMIT),
    monthlyBudgetUsdLimit: parseNullablePositiveNumber(process.env.OPENAI_MONTHLY_BUDGET_USD)
  });
}

export function normalizePolicy(policy: OpenAIQuotaPolicy): OpenAIQuotaPolicy {
  return {
    resetDay: normalizeResetDay(policy.resetDay),
    monthlyTokenLimit: normalizeNullablePositiveInteger(policy.monthlyTokenLimit),
    monthlyBudgetUsdLimit: normalizeNullablePositiveNumber(policy.monthlyBudgetUsdLimit)
  };
}

export function createDefaultStoreContainer(namespace: string, now: Date, resetDay: number): OpenAIQuotaStoreContainer {
  const nowIso = now.toISOString();
  return {
    version: 2,
    namespaces: {
      [normalizeNamespace(namespace)]: createDefaultState(resolveWindowKey(now, resetDay), normalizeResetDay(resetDay), nowIso)
    }
  } satisfies OpenAIQuotaStoreContainer;
}

export function readQuotaStoreContainer(raw: unknown): OpenAIQuotaStoreContainer {
  if (isRecord(raw) && Number(raw.version) === 2 && isRecord(raw.namespaces)) {
    return {
      version: 2,
      namespaces: { ...raw.namespaces }
    };
  }
  return {
    version: 2,
    namespaces: isRecord(raw) ? { [DEFAULT_NAMESPACE]: raw } : {}
  };
}

export function createDefaultState(windowKey: string, resetDay: number, nowIso: string): OpenAIQuotaState {
  return {
    version: 1,
    windowKey,
    resetDay: normalizeResetDay(resetDay),
    status: "available",
    statusReason: "",
    statusUpdatedAt: nowIso,
    usage: {
      requestCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0
    },
    lastApiSuccessAt: "",
    lastApiError: null,
    lastBridgeFallbackAt: "",
    updatedAt: nowIso
  };
}

export function normalizeState(raw: unknown, fallbackWindowKey: string, fallbackResetDay: number, nowIso: string): OpenAIQuotaState {
  const defaultState = createDefaultState(fallbackWindowKey, fallbackResetDay, nowIso);
  if (!isRecord(raw)) {
    return defaultState;
  }

  const usageRaw = isRecord(raw.usage) ? raw.usage : {};
  const lastApiErrorRaw = isRecord(raw.lastApiError) ? raw.lastApiError : null;
  const statusRaw = normalizeText(raw.status).toLowerCase();
  const status: OpenAIQuotaStatus = statusRaw === "exhausted" ? "exhausted" : "available";

  return {
    version: 1,
    windowKey: normalizeText(raw.windowKey) || defaultState.windowKey,
    resetDay: normalizeResetDay(parseNumber(raw.resetDay, fallbackResetDay)),
    status,
    statusReason: normalizeText(raw.statusReason),
    statusUpdatedAt: normalizeIsoText(raw.statusUpdatedAt),
    usage: {
      requestCount: normalizeNonNegativeInteger(usageRaw.requestCount),
      inputTokens: normalizeNonNegativeInteger(usageRaw.inputTokens),
      outputTokens: normalizeNonNegativeInteger(usageRaw.outputTokens),
      totalTokens: normalizeNonNegativeInteger(usageRaw.totalTokens),
      estimatedCostUsd: roundUsd(normalizeNonNegativeNumber(usageRaw.estimatedCostUsd))
    },
    lastApiSuccessAt: normalizeIsoText(raw.lastApiSuccessAt),
    lastApiError: lastApiErrorRaw
      ? {
          at: normalizeIsoText(lastApiErrorRaw.at),
          status: normalizeInteger(lastApiErrorRaw.status),
          code: normalizeText(lastApiErrorRaw.code),
          message: normalizeText(lastApiErrorRaw.message)
        }
      : null,
    lastBridgeFallbackAt: normalizeIsoText(raw.lastBridgeFallbackAt),
    updatedAt: normalizeIsoText(raw.updatedAt) || nowIso
  };
}

export function detectLocalLimit(state: OpenAIQuotaState, policy: OpenAIQuotaPolicy): string {
  if (policy.monthlyTokenLimit !== null && state.usage.totalTokens >= policy.monthlyTokenLimit) {
    return "local:token_limit_reached";
  }
  if (policy.monthlyBudgetUsdLimit !== null && state.usage.estimatedCostUsd >= policy.monthlyBudgetUsdLimit) {
    return "local:budget_limit_reached";
  }
  return "";
}

export function resolveWindowKey(now: Date, resetDay: number): string {
  const normalizedResetDay = normalizeResetDay(resetDay);
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth();
  if (now.getUTCDate() < normalizedResetDay) {
    month -= 1;
    if (month < 0) {
      month = 11;
      year -= 1;
    }
  }
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

export function calculateRatio(used: number, limit: number | null): number | null {
  if (limit === null || limit <= 0) {
    return null;
  }
  const ratio = used / limit;
  return Number.isFinite(ratio) ? Math.max(0, roundRatio(ratio)) : null;
}

export function normalizeUsageDelta(delta: OpenAIUsageDelta): OpenAIUsageDelta {
  const inputTokens = normalizeNonNegativeInteger(delta.inputTokens);
  const outputTokens = normalizeNonNegativeInteger(delta.outputTokens);
  const totalTokens = normalizeNonNegativeInteger(delta.totalTokens > 0 ? delta.totalTokens : inputTokens + outputTokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCostUsd: roundUsd(normalizeNonNegativeNumber(delta.estimatedCostUsd))
  };
}

export function normalizeResetDay(value: unknown): number {
  const parsed = Math.floor(parseNumber(value, 1));
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return Math.max(1, Math.min(28, parsed));
}

export function normalizeInteger(value: unknown): number {
  const parsed = Math.floor(parseNumber(value, 0));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeNamespace(raw: unknown): string {
  const normalized = normalizeText(raw)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || DEFAULT_NAMESPACE;
}

export function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function roundUsd(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 1_000_000) / 1_000_000 : 0;
}

export function parseNullablePositiveInteger(raw: unknown): number | null {
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return null;
  }
  return normalizeNullablePositiveInteger(parseNumber(raw, Number.NaN));
}

export function parseNullablePositiveNumber(raw: unknown): number | null {
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return null;
  }
  return normalizeNullablePositiveNumber(parseNumber(raw, Number.NaN));
}

function normalizeNullablePositiveInteger(value: unknown): number | null {
  const parsed = Math.floor(parseNumber(value, Number.NaN));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeNullablePositiveNumber(value: unknown): number | null {
  const parsed = parseNumber(value, Number.NaN);
  return Number.isFinite(parsed) && parsed > 0 ? roundUsd(parsed) : null;
}

function normalizeNonNegativeInteger(value: unknown): number {
  const parsed = Math.floor(parseNumber(value, 0));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeNonNegativeNumber(value: unknown): number {
  const parsed = parseNumber(value, 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function parseNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeIsoText(value: unknown): string {
  const text = normalizeText(value);
  if (!text) {
    return "";
  }
  const time = Date.parse(text);
  return Number.isFinite(time) ? new Date(time).toISOString() : "";
}

function roundRatio(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
