export type EvolutionGoalStatus =
  | "pending"
  | "running"
  | "waiting_retry"
  | "succeeded"
  | "failed";

export type RetryTaskType = "plan" | "step" | "fix" | "structure";

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
  plan: {
    steps: string[];
    currentStep: number;
  };
  fixAttempts: number;
  retries: number;
  nextRetryAt?: string;
  lastError?: string;
  lastCodexOutput?: string;
  structureIssues?: string[];
  events: EvolutionGoalEvent[];
  rawTail: EvolutionRawLine[];
  git: {
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
  status: Exclude<EvolutionGoalStatus, "pending" | "running" | "waiting_retry">;
  createdAt: string;
  completedAt: string;
  retries: number;
  totalSteps: number;
  fixAttempts: number;
  error?: string;
};

export type EvolutionState = {
  version: 1;
  updatedAt: string;
  status: "idle" | "running";
  currentGoalId: string | null;
  goals: EvolutionGoal[];
  history: EvolutionGoalHistory[];
};

export type RetryQueueItem = {
  id: string;
  goalId: string;
  taskType: RetryTaskType;
  stepIndex?: number;
  attempts: number;
  createdAt: string;
  retryAt: string;
  lastError: string;
};

export type RetryQueueState = {
  version: 1;
  updatedAt: string;
  items: RetryQueueItem[];
};

export type EvolutionMetrics = {
  version: 1;
  updatedAt: string;
  totalGoals: number;
  totalFailures: number;
  totalRetries: number;
  totalSteps: number;
  avgRetries: number;
  avgStepsPerGoal: number;
};

export type EvolutionSnapshot = {
  state: EvolutionState;
  retryQueue: RetryQueueState;
  metrics: EvolutionMetrics;
  storage: {
    stores: {
      state: { name: string; driver: string };
      retryQueue: { name: string; driver: string };
      metrics: { name: string; driver: string };
    };
    artifacts: {
      workspaceDir: string;
      codexOutputDir: string;
    };
  };
};
