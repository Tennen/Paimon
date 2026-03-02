export type DataStoreDescriptor = {
  name: string;
  driver: string;
};

export type AdminConfig = {
  model: string;
  planningModel: string;
  planningTimeoutMs: string;
  thinkingBudgetEnabled: boolean;
  thinkingBudgetDefault?: string;
  thinkingBudget?: string;
  codexModel: string;
  codexReasoningEffort: string;
  envPath: string;
  taskStore: DataStoreDescriptor;
  userStore: DataStoreDescriptor;
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
  name: string;
  quantity: number;
  avgCost: number;
};

export type MarketPortfolio = {
  funds: MarketFundHolding[];
  cash: number;
};

export type MarketAnalysisEngine = "local" | "gpt_plugin";

export type MarketAnalysisConfig = {
  version: 1;
  analysisEngine: MarketAnalysisEngine;
  gptPlugin: {
    timeoutMs: number;
    fallbackToLocal: boolean;
  };
};

export type MarketConfig = {
  portfolio: MarketPortfolio;
  config: MarketAnalysisConfig;
  portfolioStore: DataStoreDescriptor;
  configStore: DataStoreDescriptor;
  stateStore: DataStoreDescriptor;
  runsStore: string;
};

export type MarketPhase = "midday" | "close";

export type MarketRunSummary = {
  id: string;
  createdAt: string;
  phase: MarketPhase;
  marketState: string;
  benchmark?: string;
  assetSignalCount: number;
  signals: Array<{ code: string; signal: string }>;
  explanationSummary?: string;
  file?: string;
};

export type MarketRunOnceResponse = {
  ok: boolean;
  phase: MarketPhase;
  message: string;
  acceptedAsync: boolean;
  responseText?: string;
  imageCount?: number;
};

export type MarketSectionProps = {
  marketConfig: MarketConfig | null;
  marketPortfolio: MarketPortfolio;
  marketAnalysisConfig: MarketAnalysisConfig;
  marketRuns: MarketRunSummary[];
  savingMarketPortfolio: boolean;
  savingMarketAnalysisConfig: boolean;
  marketFundSaveStates: Array<"saved" | "dirty" | "saving">;
  bootstrappingMarketTasks: boolean;
  runningMarketOncePhase: MarketPhase | null;
  marketRunOnceWithExplanation: boolean;
  enabledUsers: PushUser[];
  marketTaskUserId: string;
  marketMiddayTime: string;
  marketCloseTime: string;
  marketSearchInputs: string[];
  marketSearchResults: MarketSecuritySearchItem[][];
  searchingMarketFundIndex: number | null;
  onCashChange: (value: number) => void;
  onMarketAnalysisEngineChange: (value: MarketAnalysisEngine) => void;
  onMarketGptPluginTimeoutMsChange: (value: number) => void;
  onMarketGptPluginFallbackToLocalChange: (value: boolean) => void;
  onMarketTaskUserIdChange: (value: string) => void;
  onMarketMiddayTimeChange: (value: string) => void;
  onMarketCloseTimeChange: (value: string) => void;
  onAddMarketFund: () => void;
  onRemoveMarketFund: (index: number) => void;
  onMarketFundChange: (index: number, key: keyof MarketFundHolding, value: string) => void;
  onMarketSearchInputChange: (index: number, value: string) => void;
  onSearchMarketByName: (index: number) => void;
  onApplyMarketSearchResult: (index: number, item: MarketSecuritySearchItem) => void;
  onSaveMarketFund: (index: number) => void;
  onSaveMarketPortfolio: () => void;
  onSaveMarketAnalysisConfig: () => void;
  onRefresh: () => void;
  onBootstrapMarketTasks: () => void;
  onMarketRunOnceWithExplanationChange: (value: boolean) => void;
  onRunMarketOnce: (phase: MarketPhase, withExplanation: boolean) => void;
};

export type MarketSecuritySearchItem = {
  code: string;
  name: string;
  market: string;
  securityType: string;
  secid?: string;
};

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

export const DEFAULT_MARKET_ANALYSIS_CONFIG: MarketAnalysisConfig = {
  version: 1,
  analysisEngine: "local",
  gptPlugin: {
    timeoutMs: 20000,
    fallbackToLocal: true
  }
};
