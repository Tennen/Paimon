import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { jsonrepair } from "jsonrepair";
import { CodexAdapter, CodexRunEvent, CodexRunResult } from "./codexAdapter";
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

export type CommitMessageSource = "user" | "generated" | "fallback";

const SELF_EVOLUTION_FILE = "src/evolution/evolutionEngine.ts";
const MAX_GOAL_EVENTS = 80;
const MAX_GOAL_RAW_LINES = 120;

export class EvolutionEngine {
  private readonly store: EvolutionStateStore;
  private readonly codex: CodexAdapter;
  private readonly testRunner: TestRunner;
  private readonly options: EvolutionEngineOptions;
  private timer: NodeJS.Timeout | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(store?: EvolutionStateStore, codex?: CodexAdapter, testRunner?: TestRunner, options?: Partial<EvolutionEngineOptions>) {
    this.store = store ?? new EvolutionStateStore();
    this.codex = codex ?? new CodexAdapter({ outputDir: this.store.getBindings().artifacts.codexOutputDir });
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
      storage: this.store.getBindings()
    };
  }

  async enqueueGoal(input: EnqueueGoalInput): Promise<EvolutionGoal> {
    return this.enqueueWork(async () => {
      const goal = String(input.goal ?? "").trim();
      if (!goal) {
        throw new Error("goal is required");
      }
      const commitMessageProvidedByUser = typeof input.commitMessage === "string";
      const commitMessage = commitMessageProvidedByUser ? input.commitMessage ?? "" : "";
      const id = createGoalId();
      const created = this.store.appendGoal({
        id,
        goal,
        commitMessage,
        ...(commitMessageProvidedByUser ? { commitMessageProvidedByUser: true } : {})
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
      goal.stage = "retrying";
    }

    goal.status = "running";
    goal.stage = "running";
    goal.startedAt = goal.startedAt ?? new Date().toISOString();
    goal.updatedAt = new Date().toISOString();
    state.status = "running";
    state.currentGoalId = goal.id;
    state.updatedAt = new Date().toISOString();
    this.store.saveEvolutionState(state);
    if (retryItem) {
      this.pushGoalEvent(goal.id, "retry", `重试任务恢复: ${retryItem.taskType}${Number.isInteger(retryItem.stepIndex) ? `#${retryItem.stepIndex}` : ""}`, true);
    }
    this.pushGoalEvent(goal.id, "engine", "开始处理 Goal", true);

    try {
      this.setGoalStage(goal.id, "prepare", "准备 Git 安全检查");
      await this.ensureGitSafety(goal);
      this.updateGoal(goal.id, (latest) => {
        latest.git = {
          ...latest.git,
          ...goal.git
        };
      });

      if (goal.plan.steps.length === 0) {
        this.setGoalStage(goal.id, "plan", "开始生成执行计划");
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
        this.setGoalStage(goal.id, `step_${stepIndex + 1}`, `执行步骤 ${stepIndex + 1}/${goal.plan.steps.length}`);
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
        this.updateGoal(goal.id, (latest) => {
          latest.plan.currentStep = goal.plan.currentStep;
        });
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

      this.setGoalStage(goal.id, "commit", "准备提交变更");
      const committed = await this.commitGoal(goal);
      if (!committed.ok) {
        await this.failGoal(goal.id, committed.error || "commit failed");
        return;
      }

      this.setGoalStage(goal.id, "push", "准备推送远端");
      const pushed = await this.pushGoal(goal);
      if (!pushed.ok) {
        await this.failGoal(goal.id, pushed.error || "push failed");
        return;
      }

      await this.markGoalSucceeded(goal.id);
    } catch (error) {
      await this.failGoal(goal.id, (error as Error).message || String(error));
    }
  }

  private async ensureGitSafety(goal: EvolutionGoal): Promise<void> {
    if (!goal.git.stableTagEnsured) {
      const hasStable = await this.runCommand("git", ["rev-parse", "--verify", "stable"], 120000, goal.id);
      if (!hasStable.ok) {
        const tagged = await this.runCommand("git", ["tag", "stable"], 120000, goal.id);
        if (!tagged.ok) {
          throw new Error(`failed to create stable tag: ${tagged.error || tagged.stderr || tagged.stdout}`);
        }
        this.pushGoalEvent(goal.id, "git", "已创建 stable 标签", true);
      }
      goal.git.stableTagEnsured = true;
      this.pushGoalEvent(goal.id, "git", "stable 标签检查完成", false);
    }

    if (goal.git.startedFromRef) {
      return;
    }

    const baseRefResult = await this.runCommand("git", ["rev-parse", "--short", "HEAD"], 120000, goal.id);
    if (!baseRefResult.ok) {
      throw new Error(`failed to resolve HEAD: ${baseRefResult.error || baseRefResult.stderr || baseRefResult.stdout}`);
    }
    goal.git.startedFromRef = baseRefResult.stdout.trim();
    this.pushGoalEvent(goal.id, "git", `基线提交: ${goal.git.startedFromRef || "unknown"}`, false);
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

    const result = await this.runCodexWithTrace(goal, {
      stage: "plan",
      taskId: `${goal.id}-plan`,
      prompt: planPrompt,
      startedMessage: "开始生成计划"
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
    goal.stage = "plan_ready";
    goal.lastCodexOutput = trimForState(result.output, 4000);
    this.pushGoalEvent(goal.id, "plan", `计划生成完成，共 ${steps.length} 步`, true);

    const state = this.store.readEvolutionState();
    const latest = state.goals.find((item) => item.id === goal.id);
    if (latest) {
      latest.plan.steps = goal.plan.steps.slice();
      latest.plan.currentStep = goal.plan.currentStep;
      latest.stage = goal.stage;
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

    const result = await this.runCodexWithTrace(goal, {
      stage: `step_${stepIndex + 1}`,
      taskId: `${goal.id}-step-${stepIndex + 1}`,
      prompt,
      startedMessage: `开始执行步骤 ${stepIndex + 1}`
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
    goal.stage = `step_${stepIndex + 1}_done`;
    this.pushGoalEvent(goal.id, "step", `步骤 ${stepIndex + 1} 执行完成`, true);

    const state = this.store.readEvolutionState();
    const latest = state.goals.find((item) => item.id === goal.id);
    if (latest) {
      latest.stage = goal.stage;
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
    this.setGoalStage(goal.id, "checks", "执行自动检查");
    let testResult = await this.testRunner.run();
    if (testResult.ok) {
      this.pushGoalEvent(goal.id, "checks", "检查通过，无需修复", true);
      return { ok: true };
    }

    this.pushGoalEvent(goal.id, "checks", `检查失败，准备自动修复: ${trimForState(testResult.summary, 220)}`, true);

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

      this.setGoalStage(goal.id, "fix", `执行自动修复 ${attempt + 1}/${this.options.maxFixAttempts}`);
      const result = await this.runCodexWithTrace(goal, {
        stage: `fix_${attempt + 1}`,
        taskId: `${goal.id}-fix-${attempt + 1}`,
        prompt,
        startedMessage: `开始修复尝试 ${attempt + 1}`
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
      goal.stage = `fix_${attempt + 1}_done`;
      goal.lastCodexOutput = trimForState(result.output, 4000);
      this.pushGoalEvent(goal.id, "fix", `修复尝试 ${attempt + 1} 完成，重新跑检查`, true);
      if (latest) {
        latest.fixAttempts = goal.fixAttempts;
        latest.stage = goal.stage;
        latest.updatedAt = goal.updatedAt;
        latest.lastCodexOutput = goal.lastCodexOutput;
        this.store.saveEvolutionState(state);
      }

      testResult = await this.testRunner.run();
      if (testResult.ok) {
        this.pushGoalEvent(goal.id, "checks", `修复后检查通过（尝试 ${attempt + 1}）`, true);
        return { ok: true };
      }

      this.pushGoalEvent(goal.id, "checks", `检查仍未通过: ${trimForState(testResult.summary, 220)}`, true);
    }

    return { ok: false, error: testResult.summary || "checks failed after auto-fix" };
  }

  private async runStructureReview(
    goal: EvolutionGoal,
    previousRetryAttempts = 0
  ): Promise<{ ok: boolean; retryScheduled?: boolean; error?: string }> {
    this.setGoalStage(goal.id, "structure", "执行结构审查");
    const prompt = [
      "请审查当前仓库是否有结构重复或明显架构问题。",
      "只输出 JSON：",
      '{ "issues": ["issue1", "issue2"] }',
      "如果没有问题，issues 返回空数组。"
    ].join("\n");

    const result = await this.runCodexWithTrace(goal, {
      stage: "structure",
      taskId: `${goal.id}-structure`,
      prompt,
      startedMessage: "开始结构审查"
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
    goal.stage = "structure_done";
    goal.updatedAt = new Date().toISOString();
    this.pushGoalEvent(goal.id, "structure", issues.length > 0 ? `发现 ${issues.length} 个结构问题` : "未发现结构问题", true);
    if (latest) {
      latest.structureIssues = goal.structureIssues;
      latest.stage = goal.stage;
      latest.updatedAt = goal.updatedAt;
      this.store.saveEvolutionState(state);
    }

    return { ok: true };
  }

  private async commitGoal(goal: EvolutionGoal): Promise<{ ok: boolean; error?: string }> {
    this.setGoalStage(goal.id, "commit", "检查工作区改动");
    const changed = await this.runCommand("git", ["status", "--porcelain"], 120000, goal.id);
    if (!changed.ok) {
      return { ok: false, error: changed.error || changed.stderr || changed.stdout };
    }

    const changedLines = changed.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (changedLines.length === 0) {
      this.pushGoalEvent(goal.id, "commit", "无代码改动，跳过提交", true);
      return { ok: true };
    }

    const changedFiles = await this.runCommand("git", ["diff", "--name-only"], 120000, goal.id);
    if (!changedFiles.ok) {
      return { ok: false, error: changedFiles.error || changedFiles.stderr || changedFiles.stdout };
    }
    const fileList = changedFiles.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const touchedSelf = fileList.includes(SELF_EVOLUTION_FILE);

    if (touchedSelf) {
      const diffResult = await this.runCommand("git", ["diff", "--", SELF_EVOLUTION_FILE], 120000, goal.id);
      if (diffResult.ok && diffResult.stdout.trim()) {
        const bindings = this.store.getBindings();
        const diffFile = path.join(bindings.artifacts.workspaceDir, `self-evolution-${goal.id}.diff`);
        fs.writeFileSync(diffFile, diffResult.stdout, "utf-8");

        const state = this.store.readEvolutionState();
        const latest = state.goals.find((item) => item.id === goal.id);
        if (latest) {
          latest.git.selfEvolutionDiffFile = diffFile;
          latest.updatedAt = new Date().toISOString();
          this.store.saveEvolutionState(state);
        }
      }
      this.pushGoalEvent(goal.id, "commit", `检测到自修改，diff 已保存: ${SELF_EVOLUTION_FILE}`, true);

      const addSelf = await this.runCommand("git", ["add", SELF_EVOLUTION_FILE], 120000, goal.id);
      if (!addSelf.ok) {
        return { ok: false, error: addSelf.error || addSelf.stderr || addSelf.stdout };
      }
      const selfCommit = await this.runCommand("git", [
        "commit",
        "--allow-empty",
        "-m",
        `chore(evolution): self-update for ${goal.id}`
      ], 120000, goal.id);
      if (!selfCommit.ok) {
        return { ok: false, error: selfCommit.error || selfCommit.stderr || selfCommit.stdout };
      }
      this.pushGoalEvent(goal.id, "commit", "自修改已提交，开始自检", true);

      const selfCheck = await this.testRunner.run();
      if (!selfCheck.ok) {
        if (this.options.rollbackOnFailure) {
          await this.runCommand("git", ["reset", "--hard", "HEAD~1"], 120000, goal.id);
          this.pushGoalEvent(goal.id, "rollback", "自修改自检失败，已执行 rollback HEAD~1", true);
        }
        return {
          ok: false,
          error: `self-evolution checks failed: ${selfCheck.summary}`
        };
      }
    }

    const addAll = await this.runCommand("git", ["add", "-A"], 120000, goal.id);
    if (!addAll.ok) {
      return { ok: false, error: addAll.error || addAll.stderr || addAll.stdout };
    }

    const commitMessage = await this.resolveCommitMessage(goal);
    goal.commitMessage = commitMessage;
    this.updateGoal(goal.id, (latest) => {
      latest.commitMessage = commitMessage;
    });

    const commit = await this.runCommand("git", ["commit", "--allow-empty", "-m", commitMessage], 120000, goal.id);
    if (!commit.ok) {
      return { ok: false, error: commit.error || commit.stderr || commit.stdout };
    }
    this.pushGoalEvent(goal.id, "commit", `变更已提交: ${commitMessage}`, true);

    return { ok: true };
  }

  private async pushGoal(goal: EvolutionGoal): Promise<{ ok: boolean; error?: string }> {
    const target = await this.resolvePushTarget(goal.id);
    if (!target.ok) {
      this.updateGoal(goal.id, (latest) => {
        latest.git.push = {
          ...(latest.git.push ?? {}),
          lastError: trimForState(target.error, 800)
        };
      });
      this.pushGoalEvent(goal.id, "push", `推送目标解析失败: ${trimForState(target.error, 220)}`, true);
      return { ok: false, error: target.error };
    }

    const headResult = await this.runCommand("git", ["rev-parse", "HEAD"], 120000, goal.id);
    if (!headResult.ok) {
      const error = headResult.error || headResult.stderr || headResult.stdout || "failed to resolve HEAD";
      this.updateGoal(goal.id, (latest) => {
        latest.git.push = {
          ...(latest.git.push ?? {}),
          remote: target.remote,
          branch: target.branch,
          lastError: trimForState(error, 800)
        };
      });
      return { ok: false, error };
    }
    const commit = headResult.stdout.trim();

    const pushResult = await this.runCommand("git", ["push", target.remote, `HEAD:${target.branch}`], 120000, goal.id);
    if (!pushResult.ok) {
      const error = pushResult.error || pushResult.stderr || pushResult.stdout || "git push failed";
      this.updateGoal(goal.id, (latest) => {
        latest.git.push = {
          ...(latest.git.push ?? {}),
          remote: target.remote,
          branch: target.branch,
          commit,
          lastError: trimForState(error, 800)
        };
      });
      this.pushGoalEvent(goal.id, "push", `推送失败: ${trimForState(error, 220)}`, true);
      return { ok: false, error };
    }

    const pushedAt = new Date().toISOString();
    this.updateGoal(goal.id, (latest) => {
      latest.git.push = {
        ...(latest.git.push ?? {}),
        remote: target.remote,
        branch: target.branch,
        commit,
        pushedAt,
        lastError: undefined
      };
    });
    this.pushGoalEvent(goal.id, "push", `推送成功: ${target.remote} ${target.branch} (${commit.slice(0, 12)})`, true);
    return { ok: true };
  }

  private async resolvePushTarget(goalId: string): Promise<{ ok: true; remote: string; branch: string } | { ok: false; error: string }> {
    const envRemote = normalizeOptionalName(process.env.EVOLUTION_GIT_PUSH_REMOTE);
    const envBranch = normalizeOptionalName(process.env.EVOLUTION_GIT_PUSH_BRANCH);

    const upstreamResult = await this.runCommand(
      "git",
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
      120000,
      goalId
    );
    const upstreamParsed = upstreamResult.ok ? parseUpstreamRef(upstreamResult.stdout.trim()) : null;
    if (!upstreamResult.ok) {
      this.pushGoalEvent(
        goalId,
        "push",
        `读取 upstream 失败: ${trimForState(upstreamResult.error || upstreamResult.stderr || upstreamResult.stdout, 200)}`,
        true
      );
    }
    return resolvePushTargetFromInputs({
      envRemote,
      envBranch,
      upstreamRef: upstreamParsed ? `${upstreamParsed.remote}/${upstreamParsed.branch}` : ""
    });
  }

  private async resolveCommitMessage(goal: EvolutionGoal): Promise<string> {
    const stagedFilesResult = await this.runCommand("git", ["diff", "--cached", "--name-only"], 120000, goal.id);
    const stagedFiles = stagedFilesResult.ok
      ? stagedFilesResult.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
      : [];
    if (!stagedFilesResult.ok) {
      this.pushGoalEvent(
        goal.id,
        "commit",
        `读取 staged 文件失败，将使用 fallback: ${trimForState(stagedFilesResult.error || stagedFilesResult.stderr || stagedFilesResult.stdout, 200)}`,
        true
      );
    }

    const stagedDiffResult = await this.runCommand("git", ["diff", "--cached", "--", "."], 120000, goal.id);
    const stagedDiff = stagedDiffResult.ok ? stagedDiffResult.stdout : "";
    if (!stagedDiffResult.ok) {
      this.pushGoalEvent(
        goal.id,
        "commit",
        `读取 staged diff 失败，将使用 fallback: ${trimForState(stagedDiffResult.error || stagedDiffResult.stderr || stagedDiffResult.stdout, 200)}`,
        true
      );
    }

    const generated = await this.generateCommitMessageWithCodex(goal, stagedFiles, stagedDiff);
    const fallback = buildDeterministicCommitMessage(goal.goal, stagedFiles, stagedDiff);
    const selected = selectCommitMessage({
      commitMessageProvidedByUser: goal.commitMessageProvidedByUser === true,
      userCommitMessage: goal.commitMessage,
      generatedCommitMessage: generated,
      fallbackCommitMessage: fallback
    });
    if (selected.source === "user") {
      this.pushGoalEvent(goal.id, "commit", `使用用户提供的 commit message: ${selected.message}`, true);
    } else if (selected.source === "generated") {
      this.pushGoalEvent(goal.id, "commit", `自动生成 commit message: ${selected.message}`, true);
    } else {
      this.pushGoalEvent(goal.id, "commit", `commit message 生成失败，使用 fallback: ${selected.message}`, true);
    }
    return selected.message;
  }

  private async generateCommitMessageWithCodex(
    goal: EvolutionGoal,
    stagedFiles: string[],
    stagedDiff: string
  ): Promise<string> {
    const filesPreview = stagedFiles.length > 0 ? stagedFiles.slice(0, 60).join("\n") : "(none)";
    const diffPreview = clipForPrompt(stagedDiff, 12000);
    const prompt = [
      "你是资深 Git 提交信息生成助手。",
      "请仅基于给定 staged diff 生成一行 commit message。",
      "约束：",
      "- 只输出最终 commit message，不要 markdown，不要解释",
      "- 使用英文，单行，不超过 72 字符",
      "- 优先使用 Conventional Commits（feat/fix/chore/refactor/test/docs）",
      "",
      `GOAL: ${goal.goal}`,
      "",
      "STAGED FILES:",
      filesPreview,
      "",
      "STAGED DIFF:",
      diffPreview || "(empty)"
    ].join("\n");

    const result = await this.runCodexWithTrace(goal, {
      stage: "commit_message",
      taskId: `${goal.id}-commit-message`,
      prompt,
      startedMessage: "开始基于 staged diff 生成 commit message"
    });

    if (!result.ok) {
      this.pushGoalEvent(
        goal.id,
        "commit",
        `codex 生成 commit message 失败: ${trimForState(result.error || "unknown error", 180)}`,
        true
      );
      return "";
    }

    return normalizeGeneratedCommitMessage(result.output);
  }

  private async markGoalSucceeded(goalId: string): Promise<void> {
    const state = this.store.readEvolutionState();
    const goal = state.goals.find((item) => item.id === goalId);
    if (!goal) {
      return;
    }
    goal.status = "succeeded";
    goal.stage = "succeeded";
    goal.completedAt = new Date().toISOString();
    goal.updatedAt = goal.completedAt;
    goal.nextRetryAt = undefined;
    goal.lastError = undefined;
    appendGoalEvent(goal, "engine", "Goal 执行成功", true);

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
    goal.stage = "failed";
    goal.completedAt = new Date().toISOString();
    goal.updatedAt = goal.completedAt;
    goal.lastError = trimForState(errorMessage, 1600);
    goal.nextRetryAt = undefined;
    appendGoalEvent(goal, "error", goal.lastError || "Goal 执行失败", true);

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
      await this.runCommand("git", ["reset", "--hard", "stable"], 120000, goal.id);
      this.pushGoalEvent(goal.id, "rollback", "执行失败后已回滚到 stable", true);
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
    goal.stage = "waiting_retry";
    goal.retries += 1;
    goal.nextRetryAt = retryAt;
    goal.lastError = trimForState(errorMessage, 1000);
    goal.updatedAt = new Date().toISOString();
    appendGoalEvent(goal, "retry", `触发重试(${taskType})，将在 ${retryAt} 重试`, true);
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

  private async runCodexWithTrace(
    goal: EvolutionGoal,
    input: {
      stage: string;
      taskId: string;
      prompt: string;
      startedMessage: string;
    }
  ): Promise<CodexRunResult> {
    this.setGoalStage(goal.id, input.stage, input.startedMessage, true);
    goal.stage = input.stage;

    return this.codex.run({
      taskId: input.taskId,
      prompt: input.prompt,
      onEvent: (event) => {
        this.handleCodexEvent(goal.id, input.taskId, event);
      }
    });
  }

  private handleCodexEvent(goalId: string, taskId: string, event: CodexRunEvent): void {
    if (event.type === "started") {
      this.pushGoalEvent(goalId, "codex", `codex 任务已启动: ${taskId}`, true);
      return;
    }

    if (event.type === "stdout" || event.type === "stderr") {
      const line = event.line.trim();
      if (!line) {
        return;
      }
      this.pushGoalRawLine(goalId, `[codex ${event.type}] ${line}`);

      const parsed = parseCodexProgressLine(line);
      if (parsed) {
        this.pushGoalEvent(goalId, "codex", parsed, false);
        return;
      }

      if (event.type === "stderr" && line.toLowerCase().includes("error")) {
        this.pushGoalEvent(goalId, "error", trimForState(line, 260), true);
      }
      return;
    }

    if (event.type === "timeout") {
      this.pushGoalEvent(goalId, "error", `codex 执行超时 (${event.timeoutMs}ms): ${taskId}`, true);
      return;
    }

    if (event.type === "error") {
      this.pushGoalEvent(goalId, "error", event.message, true);
      return;
    }

    if (event.type === "closed") {
      this.pushGoalEvent(
        goalId,
        "codex",
        event.ok
          ? `codex 任务完成: ${taskId}`
          : `codex 任务失败: ${taskId}, code=${event.code ?? "null"}${event.signal ? `, signal=${event.signal}` : ""}`,
        true
      );
    }
  }

  private setGoalStage(goalId: string, stage: string, message?: string, important = false): void {
    this.updateGoal(goalId, (goal) => {
      goal.stage = trimForState(String(stage || "").trim() || "running", 80);
      if (message) {
        appendGoalEvent(goal, goal.stage, message, important);
      }
    });
  }

  private pushGoalEvent(goalId: string, stage: string, message: string, important = false): void {
    this.updateGoal(goalId, (goal) => {
      appendGoalEvent(goal, stage, message, important);
    });
  }

  private pushGoalRawLine(goalId: string, line: string): void {
    this.updateGoal(goalId, (goal) => {
      appendGoalRawLine(goal, line);
    });
  }

  private updateGoal(goalId: string, updater: (goal: EvolutionGoal) => void): void {
    const state = this.store.readEvolutionState();
    const goal = state.goals.find((item) => item.id === goalId);
    if (!goal) {
      return;
    }
    updater(goal);
    goal.updatedAt = new Date().toISOString();
    state.updatedAt = goal.updatedAt;
    this.store.saveEvolutionState(state);
  }

  private async runCommand(command: string, args: string[], timeoutMs = 120000, goalId?: string): Promise<CommandResult> {
    if (goalId) {
      this.pushGoalEvent(goalId, "cmd", `${command} ${args.map((item) => safePreview(item)).join(" ")}`, true);
    }

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
        if (goalId) {
          this.pushGoalEvent(goalId, "error", `${command} 超时 (${timeoutMs}ms)`, true);
          const stdoutTail = trimForState(stdout, 600).trim();
          const stderrTail = trimForState(stderr, 600).trim();
          if (stdoutTail) {
            this.pushGoalRawLine(goalId, `[${command} stdout] ${stdoutTail}`);
          }
          if (stderrTail) {
            this.pushGoalRawLine(goalId, `[${command} stderr] ${stderrTail}`);
          }
        }
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
        if (goalId) {
          this.pushGoalEvent(goalId, "error", `${command} 启动失败: ${(error as Error).message}`, true);
        }
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
        if (goalId) {
          const stdoutTail = tailLines(stdout, 4);
          const stderrTail = tailLines(stderr, 4);
          for (const line of stdoutTail) {
            this.pushGoalRawLine(goalId, `[${command} stdout] ${line}`);
          }
          for (const line of stderrTail) {
            this.pushGoalRawLine(goalId, `[${command} stderr] ${line}`);
          }

          if (code === 0) {
            this.pushGoalEvent(goalId, "cmd", `${command} 执行成功`, false);
          } else {
            this.pushGoalEvent(
              goalId,
              "error",
              `${command} 执行失败: code=${typeof code === "number" ? code : "null"}${signal ? `, signal=${signal}` : ""}`,
              true
            );
          }
        }
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

function buildRetryTaskId(goalId: string, taskType: RetryTaskType, stepIndex?: number): string {
  if (Number.isInteger(stepIndex)) {
    return `${goalId}:${taskType}:${stepIndex}`;
  }
  return `${goalId}:${taskType}`;
}

function normalizeGeneratedCommitMessage(raw: string): string {
  const text = stripCodeFence(String(raw ?? "").trim());
  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) {
    return "";
  }
  const cleaned = firstLine
    .replace(/^["'`]+/, "")
    .replace(/["'`]+$/, "")
    .trim();
  if (!cleaned) {
    return "";
  }
  return cleaned.slice(0, 120);
}

function normalizeOptionalName(value: string | undefined): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function parseUpstreamRef(value: string): { remote: string; branch: string } | null {
  const text = String(value ?? "").trim();
  if (!text) {
    return null;
  }
  const slash = text.indexOf("/");
  if (slash <= 0 || slash === text.length - 1) {
    return null;
  }
  const remote = text.slice(0, slash).trim();
  const branch = text.slice(slash + 1).trim();
  if (!remote || !branch) {
    return null;
  }
  return { remote, branch };
}

export function resolvePushTargetFromInputs(input: {
  envRemote?: string;
  envBranch?: string;
  upstreamRef?: string;
}): { ok: true; remote: string; branch: string } | { ok: false; error: string } {
  const envRemote = normalizeOptionalName(input.envRemote);
  const envBranch = normalizeOptionalName(input.envBranch);
  if (envRemote && envBranch) {
    return { ok: true, remote: envRemote, branch: envBranch };
  }

  const upstream = parseUpstreamRef(normalizeOptionalName(input.upstreamRef));
  const remote = envRemote || upstream?.remote || "";
  const branch = envBranch || upstream?.branch || "";
  if (!remote || !branch) {
    const missing: string[] = [];
    if (!remote) missing.push("remote");
    if (!branch) missing.push("branch");
    return {
      ok: false,
      error: `missing push ${missing.join(" and ")}; set EVOLUTION_GIT_PUSH_REMOTE/EVOLUTION_GIT_PUSH_BRANCH or configure git upstream`
    };
  }
  return { ok: true, remote, branch };
}

function clipForPrompt(text: string, maxLength: number): string {
  const value = String(text ?? "");
  if (value.length <= maxLength) {
    return value;
  }
  const head = value.slice(0, Math.floor(maxLength * 0.55));
  const tail = value.slice(value.length - Math.floor(maxLength * 0.45));
  return `${head}\n...\n${tail}`;
}

export function buildDeterministicCommitMessage(goal: string, files: string[], diff: string): string {
  const goalPart = normalizeGoalForMessage(goal);
  const filePart = files.length === 0
    ? "workspace"
    : files.length === 1
      ? simplifyPathForMessage(files[0])
      : `${files.length} files`;
  const fingerprint = hashStable(`${goal}\n${files.join("\n")}\n${diff}`).slice(0, 8);
  return `chore(evolution): ${goalPart} (${filePart}) [${fingerprint}]`.slice(0, 120);
}

export function selectCommitMessage(input: {
  commitMessageProvidedByUser: boolean;
  userCommitMessage: string;
  generatedCommitMessage: string;
  fallbackCommitMessage: string;
}): { source: CommitMessageSource; message: string } {
  if (input.commitMessageProvidedByUser) {
    return { source: "user", message: input.userCommitMessage };
  }
  if (input.generatedCommitMessage) {
    return { source: "generated", message: input.generatedCommitMessage };
  }
  return { source: "fallback", message: input.fallbackCommitMessage };
}

function normalizeGoalForMessage(goal: string): string {
  const compact = String(goal ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[^\w\-./ ]+/g, "");
  if (!compact) {
    return "apply updates";
  }
  return compact.slice(0, 48);
}

function simplifyPathForMessage(file: string): string {
  const text = String(file ?? "").trim();
  if (!text) {
    return "workspace";
  }
  const parts = text.split("/").filter(Boolean);
  if (parts.length === 0) {
    return "workspace";
  }
  return parts.slice(-2).join("/").slice(0, 28);
}

function hashStable(text: string): string {
  const value = String(text ?? "");
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
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

function appendGoalEvent(goal: EvolutionGoal, stage: string, message: string, important = false): void {
  const text = String(message ?? "").trim();
  if (!text) {
    return;
  }
  const stageText = String(stage ?? "").trim() || "event";
  goal.events.push({
    at: new Date().toISOString(),
    stage: stageText.slice(0, 80),
    message: text.slice(0, 500),
    important: !!important
  });
  if (goal.events.length > MAX_GOAL_EVENTS) {
    goal.events.splice(0, goal.events.length - MAX_GOAL_EVENTS);
  }
}

function appendGoalRawLine(goal: EvolutionGoal, line: string): void {
  const text = String(line ?? "").trim();
  if (!text) {
    return;
  }
  goal.rawTail.push({
    at: new Date().toISOString(),
    line: text.slice(0, 600)
  });
  if (goal.rawTail.length > MAX_GOAL_RAW_LINES) {
    goal.rawTail.splice(0, goal.rawTail.length - MAX_GOAL_RAW_LINES);
  }
}

function parseCodexProgressLine(line: string): string | null {
  const text = String(line ?? "").trim();
  if (!text.startsWith("{") || !text.endsWith("}")) {
    return null;
  }
  let parsed: Record<string, unknown> | null = null;
  try {
    const payload = JSON.parse(text);
    parsed = isRecord(payload) ? payload : null;
  } catch {
    parsed = null;
  }
  if (!parsed) {
    return null;
  }

  const type = typeof parsed.type === "string" ? parsed.type : "";
  if (!type) {
    return null;
  }

  if (type === "thread.started") {
    const threadId = typeof parsed.thread_id === "string" ? parsed.thread_id : "";
    return threadId ? `thread started (${threadId})` : "thread started";
  }
  if (type === "turn.started") return "turn started";
  if (type === "turn.completed") return "turn completed";
  if (type === "turn.failed") {
    const error = isRecord(parsed.error) && typeof parsed.error.message === "string"
      ? parsed.error.message
      : "turn failed";
    return `turn failed: ${error}`;
  }
  if (type === "error") {
    return `error: ${typeof parsed.message === "string" ? parsed.message : "unknown error"}`;
  }
  if (type.startsWith("agent_message") || type.includes("completed")) {
    return type;
  }
  return null;
}

function tailLines(text: string, maxLines: number): string[] {
  const clipped = String(text ?? "").trim();
  if (!clipped) {
    return [];
  }
  return clipped
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-Math.max(1, maxLines))
    .map((line) => line.slice(0, 500));
}

function safePreview(text: string): string {
  const value = String(text ?? "");
  if (/^[a-zA-Z0-9._/\-]+$/.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

function roundMetric(total: number, count: number): number {
  if (count <= 0) {
    return 0;
  }
  return Math.round((total / count) * 100) / 100;
}
