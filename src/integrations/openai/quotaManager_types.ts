import type { DataStoreDescriptor } from "../../storage/persistence";

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

export type OpenAIQuotaManagerOptions = {
  namespace?: string;
};
