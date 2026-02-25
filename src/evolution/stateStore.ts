import fs from "fs";
import path from "path";
import {
  EvolutionGoal,
  EvolutionGoalEvent,
  EvolutionRawLine,
  EvolutionMetrics,
  EvolutionState,
  RetryQueueState
} from "./types";

export type EvolutionStorePaths = {
  stateDir: string;
  stateFile: string;
  retryQueueFile: string;
  metricsFile: string;
  codexOutputDir: string;
};

type CreateGoalInput = {
  id: string;
  goal: string;
  commitMessage: string;
  commitMessageProvidedByUser?: boolean;
};

const MAX_GOAL_EVENTS = 80;
const MAX_GOAL_RAW_LINES = 120;

export class EvolutionStateStore {
  private readonly paths: EvolutionStorePaths;

  constructor(stateDir?: string) {
    const resolvedStateDir = path.resolve(process.cwd(), stateDir ?? process.env.EVOLUTION_STATE_DIR ?? "state");
    this.paths = {
      stateDir: resolvedStateDir,
      stateFile: path.join(resolvedStateDir, "evolution.json"),
      retryQueueFile: path.join(resolvedStateDir, "retry_queue.json"),
      metricsFile: path.join(resolvedStateDir, "metrics.json"),
      codexOutputDir: path.join(resolvedStateDir, "codex")
    };
    this.ensureStorage();
  }

  getPaths(): EvolutionStorePaths {
    return { ...this.paths };
  }

  readEvolutionState(): EvolutionState {
    const fallback = createDefaultEvolutionState();
    const parsed = readJsonFile(this.paths.stateFile, fallback);
    return normalizeEvolutionState(parsed);
  }

  saveEvolutionState(value: EvolutionState): void {
    writeJsonFileAtomic(this.paths.stateFile, normalizeEvolutionState(value));
  }

  readRetryQueue(): RetryQueueState {
    const fallback = createDefaultRetryQueueState();
    const parsed = readJsonFile(this.paths.retryQueueFile, fallback);
    return normalizeRetryQueueState(parsed);
  }

  saveRetryQueue(value: RetryQueueState): void {
    writeJsonFileAtomic(this.paths.retryQueueFile, normalizeRetryQueueState(value));
  }

  readMetrics(): EvolutionMetrics {
    const fallback = createDefaultMetricsState();
    const parsed = readJsonFile(this.paths.metricsFile, fallback);
    return normalizeMetrics(parsed);
  }

  saveMetrics(value: EvolutionMetrics): void {
    writeJsonFileAtomic(this.paths.metricsFile, normalizeMetrics(value));
  }

  appendGoal(input: CreateGoalInput): EvolutionGoal {
    const state = this.readEvolutionState();
    const now = new Date().toISOString();
    const goal: EvolutionGoal = {
      id: input.id,
      goal: input.goal,
      commitMessage: input.commitMessage,
      ...(input.commitMessageProvidedByUser === true ? { commitMessageProvidedByUser: true } : {}),
      status: "pending",
      stage: "queued",
      createdAt: now,
      updatedAt: now,
      plan: {
        steps: [],
        currentStep: 0
      },
      fixAttempts: 0,
      retries: 0,
      events: [
        {
          at: now,
          stage: "goal",
          message: "Goal 已创建，等待调度",
          important: true
        }
      ],
      rawTail: [],
      git: {
        stableTagEnsured: false
      }
    };

    state.goals.push(goal);
    state.updatedAt = now;
    this.saveEvolutionState(state);
    return goal;
  }

  bumpMetricsForNewGoal(): void {
    const metrics = this.readMetrics();
    metrics.totalGoals += 1;
    metrics.updatedAt = new Date().toISOString();
    metrics.avgRetries = roundMetric(metrics.totalRetries, metrics.totalGoals);
    metrics.avgStepsPerGoal = roundMetric(metrics.totalSteps, metrics.totalGoals);
    this.saveMetrics(metrics);
  }

  private ensureStorage(): void {
    if (!fs.existsSync(this.paths.stateDir)) {
      fs.mkdirSync(this.paths.stateDir, { recursive: true });
    }
    if (!fs.existsSync(this.paths.codexOutputDir)) {
      fs.mkdirSync(this.paths.codexOutputDir, { recursive: true });
    }
    if (!fs.existsSync(this.paths.stateFile)) {
      this.saveEvolutionState(createDefaultEvolutionState());
    }
    if (!fs.existsSync(this.paths.retryQueueFile)) {
      this.saveRetryQueue(createDefaultRetryQueueState());
    }
    if (!fs.existsSync(this.paths.metricsFile)) {
      this.saveMetrics(createDefaultMetricsState());
    }
  }
}

function createDefaultEvolutionState(): EvolutionState {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    status: "idle",
    currentGoalId: null,
    goals: [],
    history: []
  };
}

function createDefaultRetryQueueState(): RetryQueueState {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    items: []
  };
}

function createDefaultMetricsState(): EvolutionMetrics {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    totalGoals: 0,
    totalFailures: 0,
    totalRetries: 0,
    totalSteps: 0,
    avgRetries: 0,
    avgStepsPerGoal: 0
  };
}

function readJsonFile<T>(filePath: string, fallback: T): unknown {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  const raw = fs.readFileSync(filePath, "utf-8").trim();
  if (!raw) {
    return fallback;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJsonFileAtomic(filePath: string, payload: unknown): void {
  const tmpFile = `${filePath}.tmp`;
  fs.writeFileSync(tmpFile, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
  fs.renameSync(tmpFile, filePath);
}

function normalizeEvolutionState(raw: unknown): EvolutionState {
  if (!raw || typeof raw !== "object") {
    return createDefaultEvolutionState();
  }
  const value = raw as Partial<EvolutionState>;
  const goals = Array.isArray(value.goals)
    ? value.goals.map((goal) => normalizeGoal(goal)).filter((goal): goal is EvolutionGoal => Boolean(goal))
    : [];
  const history = Array.isArray(value.history)
    ? value.history
        .map((item) => normalizeGoalHistory(item))
        .filter((item): item is EvolutionState["history"][number] => Boolean(item))
        .slice(-80)
    : [];

  return {
    version: 1,
    updatedAt: normalizeIso(value.updatedAt),
    status: value.status === "running" ? "running" : "idle",
    currentGoalId: typeof value.currentGoalId === "string" && value.currentGoalId ? value.currentGoalId : null,
    goals,
    history
  };
}

function normalizeGoal(raw: unknown): EvolutionGoal | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const goal = raw as Partial<EvolutionGoal>;
  if (typeof goal.id !== "string" || typeof goal.goal !== "string" || typeof goal.commitMessage !== "string") {
    return null;
  }
  const status = normalizeGoalStatus(goal.status);
  const steps = Array.isArray(goal.plan?.steps)
    ? goal.plan.steps.filter((step): step is string => typeof step === "string" && step.trim().length > 0)
    : [];
  const currentStep = Number.isInteger(goal.plan?.currentStep)
    ? Math.max(0, Math.min(steps.length, Number(goal.plan?.currentStep)))
    : 0;
  const gitPush = normalizeGoalGitPush(goal.git?.push);

  return {
    id: goal.id,
    goal: goal.goal,
    commitMessage: goal.commitMessage,
    ...(goal.commitMessageProvidedByUser === true ? { commitMessageProvidedByUser: true } : {}),
    status,
    stage: normalizeGoalStage(goal.stage, status),
    createdAt: normalizeIso(goal.createdAt),
    updatedAt: normalizeIso(goal.updatedAt),
    ...(typeof goal.startedAt === "string" ? { startedAt: normalizeIso(goal.startedAt) } : {}),
    ...(typeof goal.completedAt === "string" ? { completedAt: normalizeIso(goal.completedAt) } : {}),
    plan: {
      steps,
      currentStep
    },
    fixAttempts: toNonNegativeInt(goal.fixAttempts),
    retries: toNonNegativeInt(goal.retries),
    ...(typeof goal.nextRetryAt === "string" ? { nextRetryAt: normalizeIso(goal.nextRetryAt) } : {}),
    ...(typeof goal.lastError === "string" && goal.lastError ? { lastError: goal.lastError } : {}),
    ...(typeof goal.lastCodexOutput === "string" && goal.lastCodexOutput
      ? { lastCodexOutput: goal.lastCodexOutput }
      : {}),
    ...(Array.isArray(goal.structureIssues)
      ? {
          structureIssues: goal.structureIssues
            .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
            .slice(0, 40)
        }
      : {}),
    events: Array.isArray(goal.events)
      ? goal.events
          .map((item) => normalizeGoalEvent(item))
          .filter((item): item is EvolutionGoalEvent => Boolean(item))
          .slice(-MAX_GOAL_EVENTS)
      : [],
    rawTail: Array.isArray(goal.rawTail)
      ? goal.rawTail
          .map((item) => normalizeGoalRawLine(item))
          .filter((item): item is EvolutionRawLine => Boolean(item))
          .slice(-MAX_GOAL_RAW_LINES)
      : [],
    git: {
      stableTagEnsured: goal.git?.stableTagEnsured === true,
      ...(typeof goal.git?.startedFromRef === "string" && goal.git.startedFromRef
        ? { startedFromRef: goal.git.startedFromRef }
        : {}),
      ...(typeof goal.git?.selfEvolutionDiffFile === "string" && goal.git.selfEvolutionDiffFile
        ? { selfEvolutionDiffFile: goal.git.selfEvolutionDiffFile }
        : {}),
      ...(gitPush ? { push: gitPush } : {})
    }
  };
}

function normalizeGoalGitPush(raw: unknown): EvolutionGoal["git"]["push"] | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const value = raw as NonNullable<EvolutionGoal["git"]["push"]>;
  const normalized: NonNullable<EvolutionGoal["git"]["push"]> = {};

  if (typeof value.remote === "string" && value.remote.trim().length > 0) {
    normalized.remote = value.remote.trim().slice(0, 200);
  }
  if (typeof value.branch === "string" && value.branch.trim().length > 0) {
    normalized.branch = value.branch.trim().slice(0, 200);
  }
  if (typeof value.commit === "string" && value.commit.trim().length > 0) {
    normalized.commit = value.commit.trim().slice(0, 80);
  }
  if (typeof value.pushedAt === "string") {
    normalized.pushedAt = normalizeIso(value.pushedAt);
  }
  if (typeof value.lastError === "string" && value.lastError.trim().length > 0) {
    normalized.lastError = value.lastError.trim().slice(0, 800);
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeGoalHistory(raw: unknown): EvolutionState["history"][number] | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const value = raw as Partial<EvolutionState["history"][number]>;
  if (
    typeof value.id !== "string" ||
    typeof value.goal !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.completedAt !== "string"
  ) {
    return null;
  }
  const status = value.status === "succeeded" ? "succeeded" : value.status === "failed" ? "failed" : null;
  if (!status) {
    return null;
  }
  return {
    id: value.id,
    goal: value.goal,
    status,
    createdAt: normalizeIso(value.createdAt),
    completedAt: normalizeIso(value.completedAt),
    retries: toNonNegativeInt(value.retries),
    totalSteps: toNonNegativeInt(value.totalSteps),
    fixAttempts: toNonNegativeInt(value.fixAttempts),
    ...(typeof value.error === "string" && value.error ? { error: value.error } : {})
  };
}

function normalizeRetryQueueState(raw: unknown): RetryQueueState {
  if (!raw || typeof raw !== "object") {
    return createDefaultRetryQueueState();
  }
  const value = raw as Partial<RetryQueueState>;
  const items = Array.isArray(value.items)
    ? value.items
        .map((item) => normalizeRetryQueueItem(item))
        .filter((item): item is RetryQueueState["items"][number] => Boolean(item))
    : [];
  return {
    version: 1,
    updatedAt: normalizeIso(value.updatedAt),
    items
  };
}

function normalizeRetryQueueItem(raw: unknown): RetryQueueState["items"][number] | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const item = raw as Partial<RetryQueueState["items"][number]>;
  if (
    typeof item.id !== "string" ||
    typeof item.goalId !== "string" ||
    typeof item.createdAt !== "string" ||
    typeof item.retryAt !== "string" ||
    typeof item.lastError !== "string"
  ) {
    return null;
  }
  const taskType = item.taskType;
  if (!taskType || !["plan", "step", "fix", "structure"].includes(taskType)) {
    return null;
  }
  return {
    id: item.id,
    goalId: item.goalId,
    taskType,
    ...(Number.isInteger(item.stepIndex) ? { stepIndex: toNonNegativeInt(item.stepIndex) } : {}),
    attempts: Math.max(1, toNonNegativeInt(item.attempts)),
    createdAt: normalizeIso(item.createdAt),
    retryAt: normalizeIso(item.retryAt),
    lastError: item.lastError.slice(0, 800)
  };
}

function normalizeMetrics(raw: unknown): EvolutionMetrics {
  if (!raw || typeof raw !== "object") {
    return createDefaultMetricsState();
  }
  const value = raw as Partial<EvolutionMetrics>;
  const totalGoals = toNonNegativeInt(value.totalGoals);
  const totalRetries = toNonNegativeInt(value.totalRetries);
  const totalSteps = toNonNegativeInt(value.totalSteps);
  return {
    version: 1,
    updatedAt: normalizeIso(value.updatedAt),
    totalGoals,
    totalFailures: toNonNegativeInt(value.totalFailures),
    totalRetries,
    totalSteps,
    avgRetries: value.avgRetries && Number.isFinite(value.avgRetries)
      ? value.avgRetries
      : roundMetric(totalRetries, totalGoals),
    avgStepsPerGoal: value.avgStepsPerGoal && Number.isFinite(value.avgStepsPerGoal)
      ? value.avgStepsPerGoal
      : roundMetric(totalSteps, totalGoals)
  };
}

function normalizeGoalStatus(raw: unknown): EvolutionGoal["status"] {
  if (raw === "pending") return "pending";
  if (raw === "running") return "running";
  if (raw === "waiting_retry") return "waiting_retry";
  if (raw === "succeeded") return "succeeded";
  if (raw === "failed") return "failed";
  return "pending";
}

function normalizeGoalStage(raw: unknown, status: EvolutionGoal["status"]): string {
  if (typeof raw === "string" && raw.trim()) {
    return raw.trim().slice(0, 80);
  }
  if (status === "pending") return "queued";
  if (status === "running") return "running";
  if (status === "waiting_retry") return "waiting_retry";
  if (status === "succeeded") return "succeeded";
  return "failed";
}

function normalizeGoalEvent(raw: unknown): EvolutionGoalEvent | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const value = raw as Partial<EvolutionGoalEvent>;
  if (typeof value.stage !== "string" || typeof value.message !== "string") {
    return null;
  }
  return {
    at: normalizeIso(value.at),
    stage: value.stage.trim().slice(0, 80) || "event",
    message: value.message.slice(0, 500),
    important: value.important === true
  };
}

function normalizeGoalRawLine(raw: unknown): EvolutionRawLine | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const value = raw as Partial<EvolutionRawLine>;
  if (typeof value.line !== "string") {
    return null;
  }
  const line = value.line.trim();
  if (!line) {
    return null;
  }
  return {
    at: normalizeIso(value.at),
    line: line.slice(0, 600)
  };
}

function normalizeIso(raw: unknown): string {
  const date = typeof raw === "string" ? new Date(raw) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }
  return date.toISOString();
}

function toNonNegativeInt(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

function roundMetric(total: number, count: number): number {
  if (count <= 0) {
    return 0;
  }
  return Math.round((total / count) * 100) / 100;
}
