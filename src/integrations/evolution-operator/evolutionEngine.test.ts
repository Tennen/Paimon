import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDeterministicCommitMessage,
  EvolutionEngine,
  resolvePushTargetFromInputs,
  selectCommitMessage
} from "./evolutionEngine";
import { EvolutionStateStore } from "./stateStore";
import { EvolutionGoal, EvolutionMetrics, EvolutionState, RetryQueueState } from "./types";

test("commit message uses user input with highest priority", () => {
  const result = selectCommitMessage({
    commitMessageProvidedByUser: true,
    userCommitMessage: "  keep user text exactly  ",
    generatedCommitMessage: "feat: generated",
    fallbackCommitMessage: "chore: fallback"
  });
  assert.equal(result.source, "user");
  assert.equal(result.message, "  keep user text exactly  ");
});

test("commit message uses generated when user input not provided", () => {
  const result = selectCommitMessage({
    commitMessageProvidedByUser: false,
    userCommitMessage: "",
    generatedCommitMessage: "fix: handle edge case",
    fallbackCommitMessage: "chore: fallback"
  });
  assert.equal(result.source, "generated");
  assert.equal(result.message, "fix: handle edge case");
});

test("commit message falls back deterministically when generated is empty", () => {
  const fallbackA = buildDeterministicCommitMessage(
    "improve evolution checks",
    ["src/integrations/evolution-operator/evolutionEngine.ts", "package.json"],
    "diff-content"
  );
  const fallbackB = buildDeterministicCommitMessage(
    "improve evolution checks",
    ["src/integrations/evolution-operator/evolutionEngine.ts", "package.json"],
    "diff-content"
  );
  const selected = selectCommitMessage({
    commitMessageProvidedByUser: false,
    userCommitMessage: "",
    generatedCommitMessage: "",
    fallbackCommitMessage: fallbackA
  });
  assert.equal(selected.source, "fallback");
  assert.equal(selected.message, fallbackA);
  assert.equal(fallbackA, fallbackB);
  assert.match(fallbackA, /^chore\(evolution\): .+\[[0-9a-f]{8}\]$/);
});

test("push target resolution prefers env remote and branch over upstream", () => {
  const resolved = resolvePushTargetFromInputs({
    envRemote: "origin",
    envBranch: "feature/auto",
    upstreamRef: "upstream/main"
  });
  assert.deepEqual(resolved, { ok: true, remote: "origin", branch: "feature/auto" });
});

test("push target resolution combines partial env with upstream", () => {
  const resolved = resolvePushTargetFromInputs({
    envRemote: "origin",
    upstreamRef: "upstream/main"
  });
  assert.deepEqual(resolved, { ok: true, remote: "origin", branch: "main" });
});

test("push target resolution fails when neither env nor upstream is usable", () => {
  const resolved = resolvePushTargetFromInputs({
    envRemote: "",
    envBranch: "",
    upstreamRef: "invalid-upstream"
  });
  assert.equal(resolved.ok, false);
  if (resolved.ok) {
    assert.fail("expected failed resolution");
  }
  assert.match(resolved.error, /missing push remote and branch/);
});

test("auto tick notification triggers only for auto source and executable goal/retry", async () => {
  const activeGoal = createGoal("goal-auto-active", { status: "pending" });
  const retryGoal = createGoal("goal-auto-retry", { status: "waiting_retry" });
  const harness = createHarness({
    goals: [activeGoal, retryGoal],
    currentGoalId: activeGoal.id
  });

  const processed: string[] = [];
  harness.engine.processGoal = async (goalId: string) => {
    processed.push(goalId);
  };

  await harness.engine.processTick("auto");
  assert.equal(harness.sentTexts.length, 1);
  assert.match(harness.sentTexts[0], new RegExp(`自动 tick 已触发: Goal ${activeGoal.id}`));
  assert.deepEqual(processed, [activeGoal.id]);

  harness.sentTexts.length = 0;
  processed.length = 0;
  await harness.engine.processTick("manual");
  assert.equal(harness.sentTexts.length, 0);
  assert.deepEqual(processed, [activeGoal.id]);

  const state = harness.readState();
  state.currentGoalId = null;
  state.status = "idle";
  state.goals[0].status = "succeeded";
  state.goals[1].status = "waiting_retry";
  harness.setRetryQueue({
    version: 1,
    updatedAt: new Date().toISOString(),
    items: [{
      id: `${retryGoal.id}:plan`,
      goalId: retryGoal.id,
      taskType: "plan",
      attempts: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      retryAt: "2020-01-01T00:00:00.000Z",
      lastError: "rate limited"
    }]
  });

  harness.sentTexts.length = 0;
  processed.length = 0;
  await harness.engine.processTick("auto");
  assert.equal(harness.sentTexts.length, 1);
  assert.match(harness.sentTexts[0], new RegExp(`自动 tick 已触发: Retry ${retryGoal.id}`));
  assert.deepEqual(processed, [retryGoal.id]);
});

test("goal completion sends notifications for success and failure", async () => {
  const commit = "abcdef1234567890abcdef1234567890abcdef12";
  const successGoal = createGoal("goal-success", {
    status: "running",
    git: {
      stableTagEnsured: true,
      startedFromRef: commit,
      push: { commit }
    }
  });
  const successHarness = createHarness({
    goals: [successGoal],
    currentGoalId: successGoal.id
  });

  await successHarness.engine.markGoalSucceeded(successGoal.id);
  assert.equal(successHarness.sentTexts.length, 1);
  assert.match(successHarness.sentTexts[0], /evolution 任务完成: Goal goal-success 成功 abcdef123456/);

  const failedGoal = createGoal("goal-failure", { status: "running" });
  const failedHarness = createHarness({
    goals: [failedGoal],
    currentGoalId: failedGoal.id
  });

  await failedHarness.engine.failGoal(failedGoal.id, "failed with {\"code\":500} ❌ `trace`");
  assert.equal(failedHarness.sentTexts.length, 1);
  assert.match(failedHarness.sentTexts[0], /evolution 任务完成: Goal goal-failure 失败/);
  assert.doesNotMatch(failedHarness.sentTexts[0], /[{}\[\]`❌]/);
});

test("git log summary notification is concise and symbol-cleaned", async () => {
  const goal = createGoal("goal-git-summary", {
    status: "running",
    git: {
      stableTagEnsured: true,
      startedFromRef: "1111111",
      push: { commit: "2222222" }
    }
  });
  const harness = createHarness({ goals: [goal], currentGoalId: goal.id });

  let gitLogCalls = 0;
  harness.engine.runCommand = async () => {
    gitLogCalls += 1;
    return {
      ok: true,
      stdout: [
        "a1b2c3d4|feat: add parser ✅",
        "a1b2c3d4|feat: add parser ✅",
        "b2c3d4e5|fix: sanitize {json} `payload` <>",
        "c3d4e5f6|refactor(core): simplify flow 🚀",
        "d4e5f6a7|docs: update readme ###",
        "e5f6a7b8|test: cover retry path ***",
        "f6a7b8c9|chore: trim symbols @@",
        "commit deadbeef",
        "Author: bot"
      ].join("\n"),
      stderr: "",
      exitCode: 0,
      signal: null
    };
  };

  await harness.engine.notifyGoalCompleted(goal, "succeeded");
  assert.equal(gitLogCalls, 1);
  assert.equal(harness.sentTexts.length, 2);

  const lines = harness.sentTexts[1].split(/\r?\n/).map((line: string) => line.trim()).filter(Boolean);
  assert.match(lines[0], /evolution 新增提交摘要: Goal goal-git-summary/);
  assert.ok(lines.length <= 7);
  assert.equal(lines.filter((line: string) => line.includes("a1b2c3d4")).length, 1);
  for (const line of lines.slice(1)) {
    assert.match(line, /^\d+\.\s+[0-9a-f]{7,12}\s+/);
    assert.doesNotMatch(line, /[{}\[\]`<>]/);
    assert.doesNotMatch(line, /✅|🚀|❌/);
  }
});

test("no git log summary notification when no new git log exists", async () => {
  const goal = createGoal("goal-no-new-log", {
    status: "running",
    git: {
      stableTagEnsured: true,
      startedFromRef: "aaa1111",
      push: { commit: "bbb2222" }
    }
  });
  const harness = createHarness({ goals: [goal], currentGoalId: goal.id });

  let gitLogCalls = 0;
  harness.engine.runCommand = async () => {
    gitLogCalls += 1;
    return {
      ok: true,
      stdout: "\n  \n",
      stderr: "",
      exitCode: 0,
      signal: null
    };
  };

  await harness.engine.notifyGoalCompleted(goal, "succeeded");
  assert.equal(gitLogCalls, 1);
  assert.equal(harness.sentTexts.length, 1);
  assert.match(harness.sentTexts[0], /evolution 任务完成: Goal goal-no-new-log 成功/);
});

function createHarness(input?: {
  goals?: EvolutionGoal[];
  currentGoalId?: string | null;
  retryItems?: RetryQueueState["items"];
}): {
  engine: any;
  sentTexts: string[];
  readState: () => EvolutionState;
  setRetryQueue: (value: RetryQueueState) => void;
} {
  const now = "2026-03-12T00:00:00.000Z";
  let state: EvolutionState = {
    version: 1,
    updatedAt: now,
    status: "idle",
    currentGoalId: input?.currentGoalId ?? null,
    goals: (input?.goals ?? []).map((goal) => createGoal(goal.id, goal)),
    history: []
  };
  let retryQueue: RetryQueueState = {
    version: 1,
    updatedAt: now,
    items: (input?.retryItems ?? []).map((item) => ({ ...item }))
  };
  let metrics: EvolutionMetrics = {
    version: 1,
    updatedAt: now,
    totalGoals: state.goals.length,
    totalFailures: 0,
    totalRetries: 0,
    totalSteps: 0,
    avgRetries: 0,
    avgStepsPerGoal: 0
  };

  const store = {
    readEvolutionState: () => state,
    saveEvolutionState: (value: EvolutionState) => {
      state = value;
    },
    readRetryQueue: () => retryQueue,
    saveRetryQueue: (value: RetryQueueState) => {
      retryQueue = value;
    },
    readMetrics: () => metrics,
    saveMetrics: (value: EvolutionMetrics) => {
      metrics = value;
    }
  } as unknown as EvolutionStateStore;

  const sentTexts: string[] = [];
  const notifier = {
    sendText: async (content: string) => {
      sentTexts.push(content);
      return { sent: true, toUser: "tester", chunks: 1 };
    }
  };

  return {
    engine: new EvolutionEngine(store, {} as never, {} as never, { tickMs: 10, notifier }) as any,
    sentTexts,
    readState: () => state,
    setRetryQueue: (value: RetryQueueState) => {
      retryQueue = value;
    }
  };
}

function createGoal(id: string, overrides?: Partial<EvolutionGoal>): EvolutionGoal {
  const now = "2026-03-12T00:00:00.000Z";
  return {
    id,
    goal: overrides?.goal ?? `goal ${id}`,
    commitMessage: overrides?.commitMessage ?? "",
    ...(overrides?.commitMessageProvidedByUser ? { commitMessageProvidedByUser: true } : {}),
    status: overrides?.status ?? "pending",
    stage: overrides?.stage ?? "queued",
    createdAt: overrides?.createdAt ?? now,
    updatedAt: overrides?.updatedAt ?? now,
    ...(overrides?.startedAt ? { startedAt: overrides.startedAt } : {}),
    ...(overrides?.completedAt ? { completedAt: overrides.completedAt } : {}),
    plan: {
      steps: overrides?.plan?.steps ? overrides.plan.steps.slice() : [],
      currentStep: overrides?.plan?.currentStep ?? 0
    },
    fixAttempts: overrides?.fixAttempts ?? 0,
    retries: overrides?.retries ?? 0,
    ...(overrides?.nextRetryAt ? { nextRetryAt: overrides.nextRetryAt } : {}),
    ...(overrides?.lastError ? { lastError: overrides.lastError } : {}),
    ...(overrides?.lastCodexOutput ? { lastCodexOutput: overrides.lastCodexOutput } : {}),
    ...(overrides?.structureIssues ? { structureIssues: overrides.structureIssues.slice() } : {}),
    events: overrides?.events ? overrides.events.map((item) => ({ ...item })) : [],
    rawTail: overrides?.rawTail ? overrides.rawTail.map((item) => ({ ...item })) : [],
    git: {
      stableTagEnsured: overrides?.git?.stableTagEnsured ?? false,
      ...(overrides?.git?.startedFromRef ? { startedFromRef: overrides.git.startedFromRef } : {}),
      ...(overrides?.git?.selfEvolutionDiffFile ? { selfEvolutionDiffFile: overrides.git.selfEvolutionDiffFile } : {}),
      ...(overrides?.git?.push ? { push: { ...overrides.git.push } } : {})
    }
  };
}
