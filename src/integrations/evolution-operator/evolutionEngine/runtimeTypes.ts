import { CodexAdapter, CodexPendingApproval, CodexRunEvent, CodexRunResult } from "../../codex/adapter";
import { EvolutionNotifier } from "../evolutionNotifier";
import { EvolutionStateStore } from "../stateStore";
import { TestRunner } from "../testRunner";
import { EvolutionGoal, EvolutionSnapshot, RetryQueueItem, RetryTaskType } from "../types";

export type EnqueueGoalInput = {
  goal: string;
  commitMessage?: string;
};

export type EvolutionEngineOptions = {
  tickMs: number;
  maxFixAttempts: number;
  maxRetryAttempts: number;
  retryBaseMs: number;
  retryMaxMs: number;
  rollbackOnFailure: boolean;
};

export type TickTriggerSource = "auto" | "manual" | "enqueue";

export type EvolutionEngineConstructorOptions = Partial<EvolutionEngineOptions> & {
  notifier?: Pick<EvolutionNotifier, "sendText">;
};

export type CommandResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  error?: string;
};

export interface EvolutionEngineRuntime {
  store: EvolutionStateStore;
  codex: CodexAdapter;
  testRunner: TestRunner;
  notifier: Pick<EvolutionNotifier, "sendText">;
  options: EvolutionEngineOptions;
  timer: NodeJS.Timeout | null;
  queue: Promise<void>;
  codexTaskGoalMap: Map<string, string>;
  processTick(triggerSource: TickTriggerSource): Promise<void>;
  notifyAutoTickTriggered(
    triggerSource: TickTriggerSource,
    goalId: string,
    taskType: "goal" | "retry"
  ): Promise<void>;
  processGoal(goalId: string, retryItem?: RetryQueueItem): Promise<void>;
  ensureGitSafety(goal: EvolutionGoal): Promise<void>;
  generatePlan(
    goal: EvolutionGoal,
    previousRetryAttempts?: number
  ): Promise<{ ok: boolean; retryScheduled?: boolean; error?: string }>;
  executePlanStep(
    goal: EvolutionGoal,
    stepIndex: number,
    previousRetryAttempts?: number
  ): Promise<{ ok: boolean; retryScheduled?: boolean; error?: string }>;
  runChecksAndRepair(
    goal: EvolutionGoal,
    previousRetryAttempts?: number
  ): Promise<{ ok: boolean; retryScheduled?: boolean; error?: string }>;
  runStructureReview(
    goal: EvolutionGoal,
    previousRetryAttempts?: number
  ): Promise<{ ok: boolean; retryScheduled?: boolean; error?: string }>;
  commitGoal(goal: EvolutionGoal): Promise<{ ok: boolean; error?: string }>;
  pushGoal(goal: EvolutionGoal): Promise<{ ok: boolean; error?: string }>;
  resolvePushTarget(goalId: string): Promise<{ ok: true; remote: string; branch: string } | { ok: false; error: string }>;
  resolveCommitMessage(goal: EvolutionGoal): Promise<string>;
  generateCommitMessageWithCodex(goal: EvolutionGoal, stagedFiles: string[], stagedDiff: string): Promise<string>;
  markGoalSucceeded(goalId: string): Promise<void>;
  failGoal(goalId: string, errorMessage: string): Promise<void>;
  notifyGoalCompleted(goal: EvolutionGoal, status: "succeeded" | "failed"): Promise<void>;
  notifyGoalGitLogSummary(goal: EvolutionGoal): Promise<void>;
  scheduleRetry(
    goalId: string,
    taskType: RetryTaskType,
    errorMessage: string,
    stepIndex?: number,
    previousAttempts?: number
  ): Promise<{ scheduled: boolean; retryAt?: string }>;
  clearRetryItemsForGoal(goalId: string): void;
  removeRetryItem(retryState: ReturnType<EvolutionStateStore["readRetryQueue"]>, id: string): void;
  runCodexWithTrace(
    goal: EvolutionGoal,
    input: {
      stage: string;
      taskId: string;
      prompt: string;
      startedMessage: string;
    }
  ): Promise<CodexRunResult>;
  handleCodexEvent(goalId: string, taskId: string, event: CodexRunEvent): void;
  setGoalStage(goalId: string, stage: string, message?: string, important?: boolean): void;
  pushGoalEvent(goalId: string, stage: string, message: string, important?: boolean): void;
  pushGoalRawLine(goalId: string, line: string): void;
  updateGoal(goalId: string, updater: (goal: EvolutionGoal) => void): void;
  runCommand(command: string, args: string[], timeoutMs?: number, goalId?: string): Promise<CommandResult>;
}
