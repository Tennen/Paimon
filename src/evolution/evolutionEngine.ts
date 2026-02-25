import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { jsonrepair } from "jsonrepair";
import { CodexAdapter } from "./codexAdapter";
import { EvolutionStateStore } from "./stateStore";
import { TestRunner } from "./testRunner";
import {
  EvolutionGoal,
  EvolutionGoalHistory,
  EvolutionMetrics,
  EvolutionSnapshot,
  RetryQueueItem,
  RetryTaskType
} from "./types";

type EnqueueGoalInput = {
  goal: string;
  commitMessage?: string;
};

type EvolutionEngineOptions = {
  tickMs: number;
  maxFixAttempts: number;
  maxRetryAttempts: number;
  retryBaseMs: number;
  retryMaxMs: number;
  rollbackOnFailure: boolean;
};

type CommandResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  error?: string;
};

const SELF_EVOLUTION_FILE = "src/evolution/evolutionEngine.ts";

export class EvolutionEngine {
  private readonly store: EvolutionStateStore;
  private readonly codex: CodexAdapter;
  private readonly testRunner: TestRunner;
  private readonly options: EvolutionEngineOptions;
  private timer: NodeJS.Timeout | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(store?: EvolutionStateStore, codex?: CodexAdapter, testRunner?: TestRunner, options?: Partial<EvolutionEngineOptions>) {
    this.store = store ?? new EvolutionStateStore();
    this.codex = codex ?? new CodexAdapter({ outputDir: this.store.getPaths().codexOutputDir });
    this.testRunner = testRunner ?? new TestRunner();
    this.options = {
      tickMs: options?.tickMs ?? parseInt(process.env.EVOLUTION_TICK_MS ?? "30000", 10),
      maxFixAttempts: options?.maxFixAttempts ?? parseInt(process.env.EVOLUTION_MAX_FIX_ATTEMPTS ?? "2", 10),
      maxRetryAttempts: options?.maxRetryAttempts ?? parseInt(process.env.EVOLUTION_MAX_RETRY_ATTEMPTS ?? "6", 10),
      retryBaseMs: options?.retryBaseMs ?? parseInt(process.env.EVOLUTION_RETRY_BASE_MS ?? String(10 * 60 * 1000), 10),
      retryMaxMs: options?.retryMaxMs ?? parseInt(process.env.EVOLUTION_RETRY_MAX_MS ?? String(6 * 60 * 60 * 1000), 10),
      rollbackOnFailure: options?.rollbackOnFailure ?? process.env.EVOLUTION_ENABLE_HARD_ROLLBACK === "true"
    };
  }

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.triggerNow();
    }, this.options.tickMs);
    void this.triggerNow();
  }

  stop(): void {
    if (!this.timer) {
      return;
    }
    clearInterval(this.timer);
    this.timer = null;
  }

  getTickMs(): number {
    return this.options.tickMs;
  }

  getSnapshot(): EvolutionSnapshot {
    return {
      state: this.store.readEvolutionState(),
      retryQueue: this.store.readRetryQueue(),
      metrics: this.store.readMetrics(),
      paths: this.store.getPaths()
    };
  }

  async enqueueGoal(input: EnqueueGoalInput): Promise<EvolutionGoal> {
    return this.enqueueWork(async () => {
      const goal = String(input.goal ?? "").trim();
      if (!goal) {
        throw new Error("goal is required");
      }
      const commitMessage = normalizeCommitMessage(input.commitMessage, goal);
      const id = createGoalId();
      const created = this.store.appendGoal({
        id,
        goal,
        commitMessage
      });
      this.store.bumpMetricsForNewGoal();
      return created;
    }, true);
  }

  async triggerNow(): Promise<void> {
    return this.enqueueWork(async () => {
      await this.processTick();
    });
  }

  private async enqueueWork<T>(job: () => Promise<T>, triggerAfter = false): Promise<T> {
    let resolveValue!: (value: T | PromiseLike<T>) => void;
    let rejectValue!: (reason?: unknown) => void;

    const result = new Promise<T>((resolve, reject) => {
      resolveValue = resolve;
      rejectValue = reject;
    });

    this.queue = this.queue
      .catch(() => undefined)
      .then(async () => {
        try {
          const value = await job();
          resolveValue(value);
        } catch (error) {
          rejectValue(error);
        }
      });

    if (triggerAfter) {
      this.queue = this.queue
        .catch(() => undefined)
        .then(async () => {
          await this.processTick();
        });
    }

    return result;
  }

  private async processTick(): Promise<void> {
    const state = this.store.readEvolutionState();
    const retryQueue = this.store.readRetryQueue();
    const nowMs = Date.now();

    const currentGoal = state.currentGoalId
      ? state.goals.find((goal) => goal.id === state.currentGoalId)
      : undefined;
    if (currentGoal && (currentGoal.status === "running" || currentGoal.status === "waiting_retry" || currentGoal.status === "pending")) {
      await this.processGoal(currentGoal.id);
      return;
    }

    const dueRetry = retryQueue.items
      .slice()
      .sort((a, b) => Date.parse(a.retryAt) - Date.parse(b.retryAt))
      .find((item) => Date.parse(item.retryAt) <= nowMs);
    if (dueRetry) {
      await this.processGoal(dueRetry.goalId, dueRetry);
      return;
    }

    const nextGoal = state.goals.find((goal) => goal.status === "pending");
    if (nextGoal) {
      await this.processGoal(nextGoal.id);
      return;
    }

    state.status = "idle";
    state.currentGoalId = null;
    state.updatedAt = new Date().toISOString();
    this.store.saveEvolutionState(state);
  }

  private async processGoal(goalId: string, retryItem?: RetryQueueItem): Promise<void> {
    const state = this.store.readEvolutionState();
    const retryQueue = this.store.readRetryQueue();
    const goal = state.goals.find((item) => item.id === goalId);
    if (!goal) {
      if (retryItem) {
        this.removeRetryItem(retryQueue, retryItem.id);
      }
      return;
    }

    if (goal.status === "succeeded" || goal.status === "failed") {
      if (retryItem) {
        this.removeRetryItem(retryQueue, retryItem.id);
      }
      return;
    }

    if (retryItem) {
      this.removeRetryItem(retryQueue, retryItem.id);
      goal.nextRetryAt = undefined;
    }

    goal.status = "running";
    goal.startedAt = goal.startedAt ?? new Date().toISOString();
    goal.updatedAt = new Date().toISOString();
    state.status = "running";
    state.currentGoalId = goal.id;
    state.updatedAt = new Date().toISOString();
    this.store.saveEvolutionState(state);

    try {
      await this.ensureGitSafety(goal);
      this.store.saveEvolutionState(state);

      if (goal.plan.steps.length === 0) {
        const planned = await this.generatePlan(
          goal,
          retryItem?.taskType === "plan" ? retryItem.attempts : 0
        );
        if (!planned.ok) {
          if (planned.retryScheduled) {
            return;
          }
          await this.failGoal(goal.id, planned.error || "failed to generate plan");
          return;
        }
      }

      while (goal.plan.currentStep < goal.plan.steps.length) {
        const stepIndex = goal.plan.currentStep;
        const stepResult = await this.executePlanStep(
          goal,
          stepIndex,
          retryItem?.taskType === "step" && retryItem.stepIndex === stepIndex ? retryItem.attempts : 0
        );
        if (!stepResult.ok) {
          if (stepResult.retryScheduled) {
            return;
          }
          await this.failGoal(goal.id, stepResult.error || `step ${stepIndex + 1} failed`);
          return;
        }
        goal.plan.currentStep += 1;
        goal.updatedAt = new Date().toISOString();
        this.store.saveEvolutionState(state);
      }

      const checked = await this.runChecksAndRepair(
        goal,
        retryItem?.taskType === "fix" ? retryItem.attempts : 0
      );
      if (!checked.ok) {
        if (checked.retryScheduled) {
          return;
        }
        await this.failGoal(goal.id, checked.error || "checks failed");
        return;
      }

      const structureChecked = await this.runStructureReview(
        goal,
        retryItem?.taskType === "structure" ? retryItem.attempts : 0
      );
      if (!structureChecked.ok) {
        if (structureChecked.retryScheduled) {
          return;
        }
        await this.failGoal(goal.id, structureChecked.error || "structure review failed");
        return;
      }

      const committed = await this.commitGoal(goal);
      if (!committed.ok) {
        await this.failGoal(goal.id, committed.error || "commit failed");
        return;
      }

      await this.markGoalSucceeded(goal.id);
    } catch (error) {
      await this.failGoal(goal.id, (error as Error).message || String(error));
    }
  }

  private async ensureGitSafety(goal: EvolutionGoal): Promise<void> {
    if (!goal.git.stableTagEnsured) {
      const hasStable = await this.runCommand("git", ["rev-parse", "--verify", "stable"]);
      if (!hasStable.ok) {
        const tagged = await this.runCommand("git", ["tag", "stable"]);
        if (!tagged.ok) {
          throw new Error(`failed to create stable tag: ${tagged.error || tagged.stderr || tagged.stdout}`);
        }
      }
      goal.git.stableTagEnsured = true;
    }

    if (goal.git.branchName) {
      return;
    }

    const baseRefResult = await this.runCommand("git", ["rev-parse", "--short", "HEAD"]);
    if (!baseRefResult.ok) {
      throw new Error(`failed to resolve HEAD: ${baseRefResult.error || baseRefResult.stderr || baseRefResult.stdout}`);
    }
    goal.git.startedFromRef = baseRefResult.stdout.trim();

    const branchName = `evolution_run_${goal.id.replace(/[^a-z0-9]+/gi, "_").slice(0, 24)}`;
    const checkoutNew = await this.runCommand("git", ["checkout", "-b", branchName]);
    if (!checkoutNew.ok) {
      const checkoutExisting = await this.runCommand("git", ["checkout", branchName]);
      if (!checkoutExisting.ok) {
        throw new Error(`failed to switch branch ${branchName}: ${checkoutExisting.error || checkoutExisting.stderr || checkoutExisting.stdout}`);
      }
    }
    goal.git.branchName = branchName;
  }

  private async generatePlan(goal: EvolutionGoal, previousRetryAttempts = 0): Promise<{ ok: boolean; retryScheduled?: boolean; error?: string }> {
    const planPrompt = [
      "你是资深 TypeScript 架构师。",
      "目标是让当前仓库具备自进化能力。",
      `当前 GOAL: ${goal.goal}`,
      "请先分析仓库，再输出严格 JSON：",
      '{ "steps": ["step 1", "step 2"] }',
      "要求：",
      "- 只输出 JSON，不要 markdown",
      "- 每一步保持可执行、可验证",
      "- 单步建议改动不超过 300 行",
      "- 覆盖实现、测试/检查、必要文档更新"
    ].join("\n");

    const result = await this.codex.run({
      taskId: `${goal.id}-plan`,
      prompt: planPrompt
    });

    if (!result.ok) {
      const error = result.error || "codex plan failed";
      if (result.rateLimited) {
        const retry = await this.scheduleRetry(goal.id, "plan", error, undefined, previousRetryAttempts);
        if (retry.scheduled) {
          return { ok: false, retryScheduled: true };
        }
      }
      return { ok: false, error: `${error}\n${tailToText(result.rawTail)}`.trim() };
    }

    const parsed = parseJsonObject(result.output);
    const steps = extractSteps(parsed);
    if (steps.length === 0) {
      return { ok: false, error: "plan output missing steps" };
    }

    goal.plan.steps = steps;
    goal.plan.currentStep = Math.min(goal.plan.currentStep, steps.length);
    goal.updatedAt = new Date().toISOString();
    goal.lastCodexOutput = trimForState(result.output, 4000);

    const state = this.store.readEvolutionState();
    const latest = state.goals.find((item) => item.id === goal.id);
    if (latest) {
      latest.plan.steps = goal.plan.steps.slice();
      latest.plan.currentStep = goal.plan.currentStep;
      latest.updatedAt = goal.updatedAt;
      latest.lastCodexOutput = goal.lastCodexOutput;
      this.store.saveEvolutionState(state);
    }
    return { ok: true };
  }

  private async executePlanStep(
    goal: EvolutionGoal,
    stepIndex: number,
    previousRetryAttempts = 0
  ): Promise<{ ok: boolean; retryScheduled?: boolean; error?: string }> {
    const stepText = goal.plan.steps[stepIndex] ?? "";
    const prompt = [
      "你是当前仓库的实现工程师。",
      `GOAL: ${goal.goal}`,
      "执行计划：",
      ...goal.plan.steps.map((step, idx) => `${idx + 1}. ${step}`),
      `现在只执行第 ${stepIndex + 1} 步：${stepText}`,
      "要求：",
      "- 只修改必要文件",
      "- 修改后保证可以继续后续步骤",
      "- 不要输出解释，只需完成代码修改"
    ].join("\n");

    const result = await this.codex.run({
      taskId: `${goal.id}-step-${stepIndex + 1}`,
      prompt
    });

    if (!result.ok) {
      const error = result.error || `codex step ${stepIndex + 1} failed`;
      if (result.rateLimited) {
        const retry = await this.scheduleRetry(goal.id, "step", error, stepIndex, previousRetryAttempts);
        if (retry.scheduled) {
          return { ok: false, retryScheduled: true };
        }
      }
      return { ok: false, error: `${error}\n${tailToText(result.rawTail)}`.trim() };
    }

    goal.lastCodexOutput = trimForState(result.output, 4000);
    goal.updatedAt = new Date().toISOString();

    const state = this.store.readEvolutionState();
    const latest = state.goals.find((item) => item.id === goal.id);
    if (latest) {
      latest.lastCodexOutput = goal.lastCodexOutput;
      latest.updatedAt = goal.updatedAt;
      this.store.saveEvolutionState(state);
    }
    return { ok: true };
  }

  private async runChecksAndRepair(
    goal: EvolutionGoal,
    previousRetryAttempts = 0
  ): Promise<{ ok: boolean; retryScheduled?: boolean; error?: string }> {
    let testResult = await this.testRunner.run();
    if (testResult.ok) {
      return { ok: true };
    }

    for (let attempt = goal.fixAttempts; attempt < this.options.maxFixAttempts; attempt += 1) {
      const prompt = [
        "你是当前仓库的修复工程师。",
        `GOAL: ${goal.goal}`,
        "请根据以下错误修复代码，只修改相关文件：",
        testResult.summary,
        "要求：",
        "- 只修复导致检查失败的问题",
        "- 不要引入额外不相关重构",
        "- 修复后保持原有功能"
      ].join("\n");

      const result = await this.codex.run({
        taskId: `${goal.id}-fix-${attempt + 1}`,
        prompt
      });

      if (!result.ok) {
        const error = result.error || `fix attempt ${attempt + 1} failed`;
        if (result.rateLimited) {
          const retry = await this.scheduleRetry(goal.id, "fix", error, undefined, previousRetryAttempts);
          if (retry.scheduled) {
            return { ok: false, retryScheduled: true };
          }
        }
        return { ok: false, error: `${error}\n${tailToText(result.rawTail)}`.trim() };
      }

      const state = this.store.readEvolutionState();
      const latest = state.goals.find((item) => item.id === goal.id);
      goal.fixAttempts = attempt + 1;
      goal.updatedAt = new Date().toISOString();
      goal.lastCodexOutput = trimForState(result.output, 4000);
      if (latest) {
        latest.fixAttempts = goal.fixAttempts;
        latest.updatedAt = goal.updatedAt;
        latest.lastCodexOutput = goal.lastCodexOutput;
        this.store.saveEvolutionState(state);
      }

      testResult = await this.testRunner.run();
      if (testResult.ok) {
        return { ok: true };
      }
    }

    return { ok: false, error: testResult.summary || "checks failed after auto-fix" };
  }

  private async runStructureReview(
    goal: EvolutionGoal,
    previousRetryAttempts = 0
  ): Promise<{ ok: boolean; retryScheduled?: boolean; error?: string }> {
    const prompt = [
      "请审查当前仓库是否有结构重复或明显架构问题。",
      "只输出 JSON：",
      '{ "issues": ["issue1", "issue2"] }',
      "如果没有问题，issues 返回空数组。"
    ].join("\n");

    const result = await this.codex.run({
      taskId: `${goal.id}-structure`,
      prompt
    });

    if (!result.ok) {
      const error = result.error || "structure review failed";
      if (result.rateLimited) {
        const retry = await this.scheduleRetry(goal.id, "structure", error, undefined, previousRetryAttempts);
        if (retry.scheduled) {
          return { ok: false, retryScheduled: true };
        }
      }
      return { ok: false, error: `${error}\n${tailToText(result.rawTail)}`.trim() };
    }

    const parsed = parseJsonObject(result.output);
    const issuesRaw = parsed?.issues;
    const issues = Array.isArray(issuesRaw)
      ? issuesRaw.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 20)
      : [];

    const state = this.store.readEvolutionState();
    const latest = state.goals.find((item) => item.id === goal.id);
    goal.structureIssues = issues;
    goal.updatedAt = new Date().toISOString();
    if (latest) {
      latest.structureIssues = goal.structureIssues;
      latest.updatedAt = goal.updatedAt;
      this.store.saveEvolutionState(state);
    }

    return { ok: true };
  }

  private async commitGoal(goal: EvolutionGoal): Promise<{ ok: boolean; error?: string }> {
    const changed = await this.runCommand("git", ["status", "--porcelain"]);
    if (!changed.ok) {
      return { ok: false, error: changed.error || changed.stderr || changed.stdout };
    }

    const changedLines = changed.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (changedLines.length === 0) {
      return { ok: true };
    }

    const changedFiles = await this.runCommand("git", ["diff", "--name-only"]);
    if (!changedFiles.ok) {
      return { ok: false, error: changedFiles.error || changedFiles.stderr || changedFiles.stdout };
    }
    const fileList = changedFiles.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const touchedSelf = fileList.includes(SELF_EVOLUTION_FILE);

    if (touchedSelf) {
      const diffResult = await this.runCommand("git", ["diff", "--", SELF_EVOLUTION_FILE]);
      if (diffResult.ok && diffResult.stdout.trim()) {
        const paths = this.store.getPaths();
        const diffFile = path.join(paths.stateDir, `self-evolution-${goal.id}.diff`);
        fs.writeFileSync(diffFile, diffResult.stdout, "utf-8");

        const state = this.store.readEvolutionState();
        const latest = state.goals.find((item) => item.id === goal.id);
        if (latest) {
          latest.git.selfEvolutionDiffFile = diffFile;
          latest.updatedAt = new Date().toISOString();
          this.store.saveEvolutionState(state);
        }
      }

      const addSelf = await this.runCommand("git", ["add", SELF_EVOLUTION_FILE]);
      if (!addSelf.ok) {
        return { ok: false, error: addSelf.error || addSelf.stderr || addSelf.stdout };
      }
      const selfCommit = await this.runCommand("git", [
        "commit",
        "--allow-empty",
        "-m",
        `chore(evolution): self-update for ${goal.id}`
      ]);
      if (!selfCommit.ok) {
        return { ok: false, error: selfCommit.error || selfCommit.stderr || selfCommit.stdout };
      }

      const selfCheck = await this.testRunner.run();
      if (!selfCheck.ok) {
        if (this.options.rollbackOnFailure) {
          await this.runCommand("git", ["reset", "--hard", "HEAD~1"]);
        }
        return {
          ok: false,
          error: `self-evolution checks failed: ${selfCheck.summary}`
        };
      }
    }

    const addAll = await this.runCommand("git", ["add", "-A"]);
    if (!addAll.ok) {
      return { ok: false, error: addAll.error || addAll.stderr || addAll.stdout };
    }

    const commit = await this.runCommand("git", ["commit", "--allow-empty", "-m", goal.commitMessage]);
    if (!commit.ok) {
      return { ok: false, error: commit.error || commit.stderr || commit.stdout };
    }

    return { ok: true };
  }

  private async markGoalSucceeded(goalId: string): Promise<void> {
    const state = this.store.readEvolutionState();
    const goal = state.goals.find((item) => item.id === goalId);
    if (!goal) {
      return;
    }
    goal.status = "succeeded";
    goal.completedAt = new Date().toISOString();
    goal.updatedAt = goal.completedAt;
    goal.nextRetryAt = undefined;
    goal.lastError = undefined;

    const historyEntry: EvolutionGoalHistory = {
      id: goal.id,
      goal: goal.goal,
      status: "succeeded",
      createdAt: goal.createdAt,
      completedAt: goal.completedAt,
      retries: goal.retries,
      totalSteps: goal.plan.steps.length,
      fixAttempts: goal.fixAttempts
    };
    state.history.push(historyEntry);
    if (state.history.length > 120) {
      state.history = state.history.slice(state.history.length - 120);
    }
    state.status = "idle";
    state.currentGoalId = null;
    state.updatedAt = new Date().toISOString();
    this.store.saveEvolutionState(state);

    const metrics = this.store.readMetrics();
    metrics.totalSteps += goal.plan.steps.length;
    metrics.avgRetries = roundMetric(metrics.totalRetries, metrics.totalGoals);
    metrics.avgStepsPerGoal = roundMetric(metrics.totalSteps, metrics.totalGoals);
    metrics.updatedAt = new Date().toISOString();
    this.store.saveMetrics(metrics);

    this.clearRetryItemsForGoal(goal.id);
  }

  private async failGoal(goalId: string, errorMessage: string): Promise<void> {
    const state = this.store.readEvolutionState();
    const goal = state.goals.find((item) => item.id === goalId);
    if (!goal) {
      return;
    }

    goal.status = "failed";
    goal.completedAt = new Date().toISOString();
    goal.updatedAt = goal.completedAt;
    goal.lastError = trimForState(errorMessage, 1600);
    goal.nextRetryAt = undefined;

    const historyEntry: EvolutionGoalHistory = {
      id: goal.id,
      goal: goal.goal,
      status: "failed",
      createdAt: goal.createdAt,
      completedAt: goal.completedAt,
      retries: goal.retries,
      totalSteps: goal.plan.currentStep,
      fixAttempts: goal.fixAttempts,
      error: goal.lastError
    };
    state.history.push(historyEntry);
    if (state.history.length > 120) {
      state.history = state.history.slice(state.history.length - 120);
    }
    state.status = "idle";
    state.currentGoalId = null;
    state.updatedAt = new Date().toISOString();
    this.store.saveEvolutionState(state);

    const metrics = this.store.readMetrics();
    metrics.totalFailures += 1;
    metrics.avgRetries = roundMetric(metrics.totalRetries, metrics.totalGoals);
    metrics.avgStepsPerGoal = roundMetric(metrics.totalSteps, metrics.totalGoals);
    metrics.updatedAt = new Date().toISOString();
    this.store.saveMetrics(metrics);

    this.clearRetryItemsForGoal(goal.id);

    if (this.options.rollbackOnFailure) {
      await this.runCommand("git", ["reset", "--hard", "stable"]);
    }
  }

  private async scheduleRetry(
    goalId: string,
    taskType: RetryTaskType,
    errorMessage: string,
    stepIndex?: number,
    previousAttempts = 0
  ): Promise<{ scheduled: boolean; retryAt?: string }> {
    const attempts = previousAttempts + 1;
    if (attempts > this.options.maxRetryAttempts) {
      return { scheduled: false };
    }

    const delayMs = Math.min(this.options.retryBaseMs * 2 ** Math.max(0, attempts - 1), this.options.retryMaxMs);
    const retryAt = new Date(Date.now() + delayMs).toISOString();

    const state = this.store.readEvolutionState();
    const goal = state.goals.find((item) => item.id === goalId);
    if (!goal) {
      return { scheduled: false };
    }

    goal.status = "waiting_retry";
    goal.retries += 1;
    goal.nextRetryAt = retryAt;
    goal.lastError = trimForState(errorMessage, 1000);
    goal.updatedAt = new Date().toISOString();
    state.status = "idle";
    state.currentGoalId = null;
    state.updatedAt = goal.updatedAt;
    this.store.saveEvolutionState(state);

    const retryState = this.store.readRetryQueue();
    const id = buildRetryTaskId(goalId, taskType, stepIndex);
    const now = new Date().toISOString();
    const existingIndex = retryState.items.findIndex((item) => item.id === id);
    const payload: RetryQueueItem = {
      id,
      goalId,
      taskType,
      ...(Number.isInteger(stepIndex) ? { stepIndex } : {}),
      attempts,
      createdAt: existingIndex >= 0 ? retryState.items[existingIndex].createdAt : now,
      retryAt,
      lastError: trimForState(errorMessage, 1000)
    };
    if (existingIndex >= 0) {
      retryState.items[existingIndex] = payload;
    } else {
      retryState.items.push(payload);
    }
    retryState.updatedAt = now;
    this.store.saveRetryQueue(retryState);

    const metrics = this.store.readMetrics();
    metrics.totalRetries += 1;
    metrics.avgRetries = roundMetric(metrics.totalRetries, metrics.totalGoals);
    metrics.avgStepsPerGoal = roundMetric(metrics.totalSteps, metrics.totalGoals);
    metrics.updatedAt = now;
    this.store.saveMetrics(metrics);

    return { scheduled: true, retryAt };
  }

  private clearRetryItemsForGoal(goalId: string): void {
    const retryState = this.store.readRetryQueue();
    const filtered = retryState.items.filter((item) => item.goalId !== goalId);
    if (filtered.length === retryState.items.length) {
      return;
    }
    retryState.items = filtered;
    retryState.updatedAt = new Date().toISOString();
    this.store.saveRetryQueue(retryState);
  }

  private removeRetryItem(retryState: ReturnType<EvolutionStateStore["readRetryQueue"]>, id: string): void {
    const next = retryState.items.filter((item) => item.id !== id);
    if (next.length === retryState.items.length) {
      return;
    }
    retryState.items = next;
    retryState.updatedAt = new Date().toISOString();
    this.store.saveRetryQueue(retryState);
  }

  private async runCommand(command: string, args: string[], timeoutMs = 120000): Promise<CommandResult> {
    return new Promise((resolve) => {
      const child = spawn(command, args, {
        cwd: process.cwd(),
        env: process.env
      });

      let stdout = "";
      let stderr = "";
      let finished = false;

      const timer = setTimeout(() => {
        if (finished) return;
        finished = true;
        child.kill("SIGKILL");
        resolve({
          ok: false,
          stdout: trimForState(stdout, 3000),
          stderr: trimForState(stderr, 3000),
          exitCode: null,
          signal: "SIGKILL",
          error: `${command} timeout after ${timeoutMs}ms`
        });
      }, timeoutMs);

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString("utf8");
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });

      child.on("error", (error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve({
          ok: false,
          stdout: trimForState(stdout, 3000),
          stderr: trimForState(stderr, 3000),
          exitCode: null,
          signal: null,
          error: (error as Error).message
        });
      });

      child.on("close", (code, signal) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve({
          ok: code === 0,
          stdout: trimForState(stdout, 3000),
          stderr: trimForState(stderr, 3000),
          exitCode: typeof code === "number" ? code : null,
          signal
        });
      });
    });
  }
}

function createGoalId(): string {
  return `goal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeCommitMessage(raw: string | undefined, goal: string): string {
  const text = String(raw ?? "").trim();
  if (text) {
    return text.slice(0, 120);
  }
  return `feat(evolution): ${goal.slice(0, 88)}`;
}

function buildRetryTaskId(goalId: string, taskType: RetryTaskType, stepIndex?: number): string {
  if (Number.isInteger(stepIndex)) {
    return `${goalId}:${taskType}:${stepIndex}`;
  }
  return `${goalId}:${taskType}`;
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const text = String(raw ?? "").trim();
  if (!text) {
    return {};
  }
  const normalized = stripCodeFence(extractLikelyJsonObject(text));
  if (!normalized) {
    return {};
  }

  try {
    const parsed = JSON.parse(normalized);
    return isRecord(parsed) ? parsed : {};
  } catch {
    try {
      const repaired = jsonrepair(normalized);
      const parsed = JSON.parse(repaired);
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
}

function extractSteps(obj: Record<string, unknown>): string[] {
  const raw = obj.steps;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .slice(0, 24);
}

function extractLikelyJsonObject(text: string): string {
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) {
    return text;
  }
  return text.slice(first, last + 1);
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }
  const lines = trimmed.split(/\r?\n/);
  if (lines.length < 3) {
    return trimmed;
  }
  if (!lines[lines.length - 1].trim().startsWith("```")) {
    return trimmed;
  }
  return lines.slice(1, -1).join("\n").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function trimForState(value: string, maxLength: number): string {
  const text = String(value ?? "");
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(text.length - maxLength);
}

function tailToText(lines: string[]): string {
  if (!Array.isArray(lines) || lines.length === 0) {
    return "";
  }
  return lines.slice(-8).join("\n");
}

function roundMetric(total: number, count: number): number {
  if (count <= 0) {
    return 0;
  }
  return Math.round((total / count) * 100) / 100;
}
