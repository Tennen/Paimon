import {
  DATA_STORE,
  DataStoreDescriptor,
  getStore,
  registerStore,
  setStore
} from "../../storage/persistence";

export type OpenAIQuotaStatus = "available" | "exhausted";

export type OpenAIQuotaUsage = {
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
};

export type OpenAIQuotaError = {
  at: string;
  status: number;
  code: string;
  message: string;
};

export type OpenAIQuotaState = {
  version: 1;
  windowKey: string;
  resetDay: number;
  status: OpenAIQuotaStatus;
  statusReason: string;
  statusUpdatedAt: string;
  usage: OpenAIQuotaUsage;
  lastApiSuccessAt: string;
  lastApiError: OpenAIQuotaError | null;
  lastBridgeFallbackAt: string;
  updatedAt: string;
};

export type OpenAIQuotaPolicy = {
  resetDay: number;
  monthlyTokenLimit: number | null;
  monthlyBudgetUsdLimit: number | null;
};

export type OpenAIUsageDelta = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
};

export type OpenAIQuotaErrorInput = {
  status?: number;
  code?: string;
  message: string;
};

export type OpenAIQuotaCheckResult = {
  allowed: boolean;
  reason: string;
  state: OpenAIQuotaState;
};

export type OpenAIQuotaSnapshot = {
  state: OpenAIQuotaState;
  limits: {
    resetDay: number;
    monthlyTokenLimit: number | null;
    monthlyBudgetUsdLimit: number | null;
    tokenUsedRatio: number | null;
    budgetUsedRatio: number | null;
    apiAllowed: boolean;
    blockedBy: string | null;
  };
  store: DataStoreDescriptor;
};

const OPENAI_QUOTA_STORE = DATA_STORE.LLM_OPENAI_QUOTA;
const DEFAULT_NAMESPACE = "default";

type OpenAIQuotaStoreContainer = {
  version: 2;
  namespaces: Record<string, unknown>;
};

export type OpenAIQuotaManagerOptions = {
  namespace?: string;
};

export class OpenAIQuotaManager {
  private readonly store: DataStoreDescriptor;
  private readonly namespace: string;

  constructor(options: OpenAIQuotaManagerOptions = {}) {
    const now = new Date();
    const resetDay = 1;
    this.namespace = normalizeNamespace(options.namespace);
    this.store = registerStore(OPENAI_QUOTA_STORE, () =>
      createDefaultStoreContainer(this.namespace, now, resetDay)
    );
  }

  getStore(): DataStoreDescriptor {
    return this.store;
  }

  isApiAllowed(policy: OpenAIQuotaPolicy, now = new Date()): OpenAIQuotaCheckResult {
    const state = this.readState(policy, now);
    if (state.status === "exhausted") {
      return {
        allowed: false,
        reason: state.statusReason || "quota_exhausted",
        state
      };
    }

    const localLimitReason = detectLocalLimit(state, policy);
    if (localLimitReason) {
      const next = this.setExhausted(policy, localLimitReason, now);
      return {
        allowed: false,
        reason: localLimitReason,
        state: next
      };
    }

    return { allowed: true, reason: "", state };
  }

  recordApiSuccess(policy: OpenAIQuotaPolicy, delta: OpenAIUsageDelta, now = new Date()): OpenAIQuotaState {
    const nowIso = now.toISOString();
    const normalizedDelta = normalizeUsageDelta(delta);
    const next = this.updateState(policy, now, (state) => ({
      ...state,
      usage: {
        requestCount: state.usage.requestCount + 1,
        inputTokens: state.usage.inputTokens + normalizedDelta.inputTokens,
        outputTokens: state.usage.outputTokens + normalizedDelta.outputTokens,
        totalTokens: state.usage.totalTokens + normalizedDelta.totalTokens,
        estimatedCostUsd: roundUsd(state.usage.estimatedCostUsd + normalizedDelta.estimatedCostUsd)
      },
      lastApiSuccessAt: nowIso,
      updatedAt: nowIso
    }));

    const localLimitReason = detectLocalLimit(next, policy);
    if (localLimitReason) {
      return this.setExhausted(policy, localLimitReason, now);
    }

    return next;
  }

  recordApiError(policy: OpenAIQuotaPolicy, error: OpenAIQuotaErrorInput, now = new Date()): OpenAIQuotaState {
    const nowIso = now.toISOString();
    return this.updateState(policy, now, (state) => ({
      ...state,
      lastApiError: {
        at: nowIso,
        status: normalizeInteger(error.status),
        code: normalizeText(error.code),
        message: normalizeText(error.message) || "unknown error"
      },
      updatedAt: nowIso
    }));
  }

  recordBridgeFallback(policy: OpenAIQuotaPolicy, now = new Date()): OpenAIQuotaState {
    const nowIso = now.toISOString();
    return this.updateState(policy, now, (state) => ({
      ...state,
      lastBridgeFallbackAt: nowIso,
      updatedAt: nowIso
    }));
  }

  markAvailable(policy: OpenAIQuotaPolicy, reason = "manual_unblock", now = new Date()): OpenAIQuotaState {
    const nowIso = now.toISOString();
    return this.updateState(policy, now, (state) => ({
      ...state,
      status: "available",
      statusReason: normalizeText(reason),
      statusUpdatedAt: nowIso,
      updatedAt: nowIso
    }));
  }

  markExhausted(policy: OpenAIQuotaPolicy, reason = "manual_exhausted", now = new Date()): OpenAIQuotaState {
    return this.setExhausted(policy, reason, now);
  }

  resetUsage(policy: OpenAIQuotaPolicy, now = new Date()): OpenAIQuotaState {
    const nowIso = now.toISOString();
    const windowKey = resolveWindowKey(now, normalizeResetDay(policy.resetDay));
    const next = createDefaultState(windowKey, normalizeResetDay(policy.resetDay), nowIso);
    this.writeNamespaceState(next);
    return next;
  }

  getSnapshot(policy: OpenAIQuotaPolicy, now = new Date()): OpenAIQuotaSnapshot {
    const normalizedPolicy = normalizePolicy(policy);
    const state = this.readState(normalizedPolicy, now);
    const blockedBy = state.status === "exhausted" ? (state.statusReason || "quota_exhausted") : null;

    return {
      state,
      limits: {
        resetDay: normalizedPolicy.resetDay,
        monthlyTokenLimit: normalizedPolicy.monthlyTokenLimit,
        monthlyBudgetUsdLimit: normalizedPolicy.monthlyBudgetUsdLimit,
        tokenUsedRatio: calculateRatio(state.usage.totalTokens, normalizedPolicy.monthlyTokenLimit),
        budgetUsedRatio: calculateRatio(state.usage.estimatedCostUsd, normalizedPolicy.monthlyBudgetUsdLimit),
        apiAllowed: blockedBy === null,
        blockedBy
      },
      store: this.store
    };
  }

  private setExhausted(policy: OpenAIQuotaPolicy, reason: string, now: Date): OpenAIQuotaState {
    const nowIso = now.toISOString();
    const normalizedReason = normalizeText(reason) || "quota_exhausted";
    return this.updateState(policy, now, (state) => ({
      ...state,
      status: "exhausted",
      statusReason: normalizedReason,
      statusUpdatedAt: nowIso,
      updatedAt: nowIso
    }));
  }

  private readState(policy: OpenAIQuotaPolicy, now: Date): OpenAIQuotaState {
    const normalizedPolicy = normalizePolicy(policy);
    const nowIso = now.toISOString();
    const currentWindowKey = resolveWindowKey(now, normalizedPolicy.resetDay);
    const state = normalizeState(
      this.readNamespaceState(),
      currentWindowKey,
      normalizedPolicy.resetDay,
      nowIso
    );

    if (state.windowKey !== currentWindowKey || state.resetDay !== normalizedPolicy.resetDay) {
      const next = createDefaultState(currentWindowKey, normalizedPolicy.resetDay, nowIso);
      this.writeNamespaceState(next);
      return next;
    }

    this.writeNamespaceState(state);
    return state;
  }

  private updateState(
    policy: OpenAIQuotaPolicy,
    now: Date,
    updater: (state: OpenAIQuotaState) => OpenAIQuotaState
  ): OpenAIQuotaState {
    const current = this.readState(policy, now);
    const next = normalizeState(
      updater({
        ...current,
        usage: { ...current.usage },
        lastApiError: current.lastApiError ? { ...current.lastApiError } : null
      }),
      current.windowKey,
      current.resetDay,
      now.toISOString()
    );
    this.writeNamespaceState(next);
    return next;
  }

  private readNamespaceState(): unknown {
    const container = readQuotaStoreContainer(getStore<unknown>(OPENAI_QUOTA_STORE));
    return container.namespaces[this.namespace];
  }

  private writeNamespaceState(nextState: OpenAIQuotaState): void {
    const raw = getStore<unknown>(OPENAI_QUOTA_STORE);
    const container = readQuotaStoreContainer(raw);
    container.namespaces[this.namespace] = nextState;
    setStore(OPENAI_QUOTA_STORE, container);
  }
}

export function readOpenAIQuotaPolicyFromEnv(): OpenAIQuotaPolicy {
  return normalizePolicy({
    resetDay: normalizeResetDay(parseNumber(process.env.OPENAI_QUOTA_RESET_DAY, 1)),
    monthlyTokenLimit: parseNullablePositiveInteger(process.env.OPENAI_MONTHLY_TOKEN_LIMIT),
    monthlyBudgetUsdLimit: parseNullablePositiveNumber(process.env.OPENAI_MONTHLY_BUDGET_USD)
  });
}

function normalizePolicy(policy: OpenAIQuotaPolicy): OpenAIQuotaPolicy {
  return {
    resetDay: normalizeResetDay(policy.resetDay),
    monthlyTokenLimit: normalizeNullablePositiveInteger(policy.monthlyTokenLimit),
    monthlyBudgetUsdLimit: normalizeNullablePositiveNumber(policy.monthlyBudgetUsdLimit)
  };
}

function createDefaultStoreContainer(namespace: string, now: Date, resetDay: number): OpenAIQuotaStoreContainer {
  const nowIso = now.toISOString();
  return {
    version: 2,
    namespaces: {
      [normalizeNamespace(namespace)]: createDefaultState(
        resolveWindowKey(now, resetDay),
        normalizeResetDay(resetDay),
        nowIso
      )
    }
  };
}

function readQuotaStoreContainer(raw: unknown): OpenAIQuotaStoreContainer {
  if (isRecord(raw) && Number(raw.version) === 2 && isRecord(raw.namespaces)) {
    return {
      version: 2,
      namespaces: { ...raw.namespaces }
    };
  }
  return {
    version: 2,
    namespaces: isRecord(raw)
      ? { [DEFAULT_NAMESPACE]: raw }
      : {}
  };
}

function createDefaultState(windowKey: string, resetDay: number, nowIso: string): OpenAIQuotaState {
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

function normalizeState(raw: unknown, fallbackWindowKey: string, fallbackResetDay: number, nowIso: string): OpenAIQuotaState {
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

function detectLocalLimit(state: OpenAIQuotaState, policy: OpenAIQuotaPolicy): string {
  const tokenLimit = policy.monthlyTokenLimit;
  if (tokenLimit !== null && state.usage.totalTokens >= tokenLimit) {
    return "local:token_limit_reached";
  }
  const budgetLimit = policy.monthlyBudgetUsdLimit;
  if (budgetLimit !== null && state.usage.estimatedCostUsd >= budgetLimit) {
    return "local:budget_limit_reached";
  }
  return "";
}

function resolveWindowKey(now: Date, resetDay: number): string {
  const normalizedResetDay = normalizeResetDay(resetDay);
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const day = now.getUTCDate();

  let windowStartYear = year;
  let windowStartMonth = month;
  if (day < normalizedResetDay) {
    windowStartMonth -= 1;
    if (windowStartMonth < 0) {
      windowStartMonth = 11;
      windowStartYear -= 1;
    }
  }

  const monthText = String(windowStartMonth + 1).padStart(2, "0");
  return `${windowStartYear}-${monthText}`;
}

function calculateRatio(used: number, limit: number | null): number | null {
  if (limit === null || limit <= 0) {
    return null;
  }
  const ratio = used / limit;
  if (!Number.isFinite(ratio)) {
    return null;
  }
  return Math.max(0, roundRatio(ratio));
}

function roundRatio(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function normalizeUsageDelta(delta: OpenAIUsageDelta): OpenAIUsageDelta {
  const inputTokens = normalizeNonNegativeInteger(delta.inputTokens);
  const outputTokens = normalizeNonNegativeInteger(delta.outputTokens);
  const totalTokens = normalizeNonNegativeInteger(
    delta.totalTokens > 0 ? delta.totalTokens : inputTokens + outputTokens
  );
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCostUsd: roundUsd(normalizeNonNegativeNumber(delta.estimatedCostUsd))
  };
}

function normalizeResetDay(value: unknown): number {
  const parsed = Math.floor(parseNumber(value, 1));
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  if (parsed < 1) return 1;
  if (parsed > 28) return 28;
  return parsed;
}

function parseNullablePositiveInteger(raw: unknown): number | null {
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return null;
  }
  return normalizeNullablePositiveInteger(parseNumber(raw, NaN));
}

function parseNullablePositiveNumber(raw: unknown): number | null {
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return null;
  }
  return normalizeNullablePositiveNumber(parseNumber(raw, NaN));
}

function normalizeNullablePositiveInteger(value: unknown): number | null {
  const parsed = Math.floor(parseNumber(value, NaN));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function normalizeNullablePositiveNumber(value: unknown): number | null {
  const parsed = parseNumber(value, NaN);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return roundUsd(parsed);
}

function normalizeNonNegativeInteger(value: unknown): number {
  const parsed = Math.floor(parseNumber(value, 0));
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

function normalizeInteger(value: unknown): number {
  const parsed = Math.floor(parseNumber(value, 0));
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return parsed;
}

function normalizeNonNegativeNumber(value: unknown): number {
  const parsed = parseNumber(value, 0);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

function parseNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
}

function normalizeText(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function normalizeIsoText(value: unknown): string {
  const text = normalizeText(value);
  if (!text) {
    return "";
  }
  const time = Date.parse(text);
  if (!Number.isFinite(time)) {
    return "";
  }
  return new Date(time).toISOString();
}

function normalizeNamespace(raw: unknown): string {
  const normalized = normalizeText(raw)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || DEFAULT_NAMESPACE;
}

function roundUsd(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value * 1_000_000) / 1_000_000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
