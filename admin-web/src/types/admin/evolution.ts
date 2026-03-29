import type { DataStoreDescriptor } from "./common";

export type EvolutionGoalStatus = "pending" | "running" | "waiting_retry" | "succeeded" | "failed";

export type EvolutionGoalEvent = {
  at: string;
  stage: string;
  message: string;
  important: boolean;
};

export type EvolutionRawLine = {
  at: string;
  line: string;
};

export type EvolutionGoal = {
  id: string;
  goal: string;
  commitMessage: string;
  commitMessageProvidedByUser?: boolean;
  status: EvolutionGoalStatus;
  stage: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  retries: number;
  fixAttempts: number;
  nextRetryAt?: string;
  lastError?: string;
  plan: {
    steps: string[];
    currentStep: number;
  };
  events: EvolutionGoalEvent[];
  rawTail: EvolutionRawLine[];
  git?: {
    stableTagEnsured: boolean;
    startedFromRef?: string;
    selfEvolutionDiffFile?: string;
    push?: {
      remote?: string;
      branch?: string;
      commit?: string;
      pushedAt?: string;
      lastError?: string;
    };
  };
};

export type EvolutionGoalHistory = {
  id: string;
  goal: string;
  status: "succeeded" | "failed";
  createdAt: string;
  completedAt: string;
  retries: number;
  totalSteps: number;
  fixAttempts: number;
  error?: string;
};

export type EvolutionRetryItem = {
  id: string;
  goalId: string;
  taskType: "plan" | "step" | "fix" | "structure";
  attempts: number;
  retryAt: string;
  stepIndex?: number;
  lastError: string;
};

export type EvolutionStateSnapshot = {
  ok: boolean;
  tickMs: number;
  state: {
    status: "idle" | "running";
    currentGoalId: string | null;
    updatedAt: string;
    goals: EvolutionGoal[];
    history: EvolutionGoalHistory[];
  };
  retryQueue: {
    updatedAt: string;
    items: EvolutionRetryItem[];
  };
  metrics: {
    updatedAt: string;
    totalGoals: number;
    totalFailures: number;
    totalRetries: number;
    totalSteps: number;
    avgRetries: number;
    avgStepsPerGoal: number;
  };
  storage: {
    stores: {
      state: DataStoreDescriptor;
      retryQueue: DataStoreDescriptor;
      metrics: DataStoreDescriptor;
    };
    artifacts: {
      workspaceDir: string;
      codexOutputDir: string;
    };
  };
};
