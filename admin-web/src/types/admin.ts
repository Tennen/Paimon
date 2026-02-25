export type AdminConfig = {
  model: string;
  planningModel: string;
  planningTimeoutMs: string;
  envPath: string;
  taskStorePath: string;
  userStorePath: string;
  timezone: string;
  tickMs: number;
};

export type PushUser = {
  id: string;
  name: string;
  wecomUserId: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ScheduledTask = {
  id: string;
  name: string;
  enabled: boolean;
  type: "daily";
  time: string;
  userId?: string;
  toUser: string;
  message: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastRunKey?: string;
};

export type MarketFundHolding = {
  code: string;
  quantity: number;
  avgCost: number;
};

export type MarketPortfolio = {
  funds: MarketFundHolding[];
  cash: number;
};

export type MarketConfig = {
  portfolio: MarketPortfolio;
  portfolioPath: string;
  statePath: string;
  runsDir: string;
};

export type MarketRunSummary = {
  id: string;
  createdAt: string;
  phase: "midday" | "close";
  marketState: string;
  benchmark?: string;
  assetSignalCount: number;
  signals: Array<{ code: string; signal: string }>;
  explanationSummary?: string;
  file?: string;
};

export type EvolutionGoalStatus = "pending" | "running" | "waiting_retry" | "succeeded" | "failed";

export type EvolutionGoal = {
  id: string;
  goal: string;
  commitMessage: string;
  status: EvolutionGoalStatus;
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
  paths: {
    stateFile: string;
    retryQueueFile: string;
    metricsFile: string;
    codexOutputDir: string;
  };
};

export type Notice = {
  type: "success" | "error" | "info";
  title: string;
  text?: string;
} | null;

export type UserFormState = {
  name: string;
  wecomUserId: string;
  enabled: boolean;
};

export type TaskFormState = {
  name: string;
  time: string;
  userId: string;
  message: string;
  enabled: boolean;
};

export type MenuKey = "system" | "messages" | "market" | "evolution";

export const EMPTY_USER_FORM: UserFormState = {
  name: "",
  wecomUserId: "",
  enabled: true
};

export const EMPTY_TASK_FORM: TaskFormState = {
  name: "",
  time: "",
  userId: "",
  message: "",
  enabled: true
};

export const DEFAULT_MARKET_PORTFOLIO: MarketPortfolio = {
  funds: [],
  cash: 0
};
