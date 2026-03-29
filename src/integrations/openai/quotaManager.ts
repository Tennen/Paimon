import {
  DATA_STORE,
  type DataStoreDescriptor,
  getStore,
  registerStore,
  setStore
} from "../../storage/persistence";
import {
  calculateRatio,
  createDefaultState,
  createDefaultStoreContainer,
  detectLocalLimit,
  normalizePolicy,
  normalizeInteger,
  normalizeNamespace,
  normalizeResetDay,
  normalizeState,
  normalizeText,
  normalizeUsageDelta,
  readOpenAIQuotaPolicyFromEnv,
  readQuotaStoreContainer,
  roundUsd,
  resolveWindowKey
} from "./quotaManager_shared";
import type {
  OpenAIQuotaCheckResult,
  OpenAIQuotaErrorInput,
  OpenAIQuotaManagerOptions,
  OpenAIQuotaPolicy,
  OpenAIQuotaSnapshot,
  OpenAIQuotaState,
  OpenAIUsageDelta
} from "./quotaManager_types";

export type * from "./quotaManager_types";
export { readOpenAIQuotaPolicyFromEnv } from "./quotaManager_shared";

const OPENAI_QUOTA_STORE = DATA_STORE.LLM_OPENAI_QUOTA;

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
