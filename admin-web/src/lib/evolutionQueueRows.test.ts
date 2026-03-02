import test from "node:test";
import assert from "node:assert/strict";
import { buildEvolutionQueueRows } from "./evolutionQueueRows";
import type {
  EvolutionGoal,
  EvolutionGoalHistory,
  EvolutionGoalStatus,
  EvolutionRetryItem
} from "../types/admin";

const BASE_CREATED_AT = "2026-03-01T00:00:00.000Z";
const TIME = {
  t0700: "2026-03-02T07:00:00.000Z",
  t0800: "2026-03-02T08:00:00.000Z",
  t0900: "2026-03-02T09:00:00.000Z",
  t0910: "2026-03-02T09:10:00.000Z",
  t0920: "2026-03-02T09:20:00.000Z",
  t0930: "2026-03-02T09:30:00.000Z",
  t1000: "2026-03-02T10:00:00.000Z",
  t1100: "2026-03-02T11:00:00.000Z",
  t1200: "2026-03-02T12:00:00.000Z",
  t1300: "2026-03-02T13:00:00.000Z",
  t1400: "2026-03-02T14:00:00.000Z"
} as const;

type GoalInput = {
  id: string;
  status: EvolutionGoalStatus;
  updatedAt: string;
  goal?: string;
  stage?: string;
  completedAt?: string;
  retries?: number;
  nextRetryAt?: string;
  steps?: string[];
  currentStep?: number;
};

function createGoal(input: GoalInput): EvolutionGoal {
  return {
    id: input.id,
    goal: input.goal ?? `Goal ${input.id}`,
    commitMessage: `chore: ${input.id}`,
    status: input.status,
    stage: input.stage ?? "planning",
    createdAt: BASE_CREATED_AT,
    updatedAt: input.updatedAt,
    completedAt: input.completedAt,
    retries: input.retries ?? 0,
    fixAttempts: 0,
    nextRetryAt: input.nextRetryAt,
    plan: {
      steps: input.steps ?? ["plan", "code"],
      currentStep: input.currentStep ?? 0
    },
    events: [],
    rawTail: []
  };
}

type HistoryInput = {
  id: string;
  status: "succeeded" | "failed";
  completedAt: string;
  goal?: string;
  retries?: number;
  totalSteps?: number;
};

function createHistory(input: HistoryInput): EvolutionGoalHistory {
  return {
    id: input.id,
    goal: input.goal ?? `History ${input.id}`,
    status: input.status,
    createdAt: BASE_CREATED_AT,
    completedAt: input.completedAt,
    retries: input.retries ?? 0,
    totalSteps: input.totalSteps ?? 0,
    fixAttempts: 0
  };
}

type RetryInput = {
  id: string;
  goalId: string;
  retryAt: string;
  taskType?: EvolutionRetryItem["taskType"];
  attempts?: number;
  stepIndex?: number;
};

function createRetryItem(input: RetryInput): EvolutionRetryItem {
  return {
    id: input.id,
    goalId: input.goalId,
    taskType: input.taskType ?? "step",
    attempts: input.attempts ?? 1,
    retryAt: input.retryAt,
    stepIndex: input.stepIndex,
    lastError: "retry-error"
  };
}

test("buildEvolutionQueueRows deduplicates overlapping goal and history by goalId", () => {
  const rows = buildEvolutionQueueRows({
    goals: [
      createGoal({
        id: "goal-overlap",
        goal: "goal text from active queue",
        status: "running",
        stage: "coding",
        updatedAt: TIME.t1000,
        currentStep: 1,
        steps: ["plan", "code", "test"]
      })
    ],
    history: [
      createHistory({
        id: "goal-overlap",
        goal: "goal text from history",
        status: "failed",
        completedAt: TIME.t1100,
        totalSteps: 6
      })
    ]
  });

  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    goalId: "goal-overlap",
    goal: "goal text from active queue",
    status: "running",
    stage: "coding",
    stepProgress: "1/3",
    retrySummary: "-",
    nextRetryAt: undefined,
    updatedAt: TIME.t1100,
    completedAt: TIME.t1100,
    source: "goal+history"
  });
});

test("buildEvolutionQueueRows merges retry queue details into goal row", () => {
  const rows = buildEvolutionQueueRows({
    goals: [
      createGoal({
        id: "goal-retry-merge",
        status: "failed",
        updatedAt: TIME.t0800,
        retries: 2,
        nextRetryAt: TIME.t0900
      })
    ],
    retryItems: [
      createRetryItem({
        id: "retry-fix",
        goalId: "goal-retry-merge",
        taskType: "fix",
        attempts: 1,
        retryAt: TIME.t0910
      }),
      createRetryItem({
        id: "retry-step",
        goalId: "goal-retry-merge",
        taskType: "step",
        attempts: 2,
        stepIndex: 2,
        retryAt: TIME.t0920
      }),
      createRetryItem({
        id: "retry-step",
        goalId: "goal-retry-merge",
        taskType: "step",
        attempts: 3,
        stepIndex: 2,
        retryAt: TIME.t0930
      })
    ]
  });

  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.goalId, "goal-retry-merge");
  assert.equal(row.status, "waiting_retry");
  assert.equal(row.source, "goal+retry");
  assert.equal(row.nextRetryAt, TIME.t0900);
  assert.equal(row.updatedAt, TIME.t0930);
  assert.match(row.retrySummary, /^2 \| step#2.*3, fix.*1$/);
});

test("buildEvolutionQueueRows supports history-only rows", () => {
  const rows = buildEvolutionQueueRows({
    history: [
      createHistory({
        id: "goal-history-only",
        goal: "history only goal",
        status: "failed",
        completedAt: TIME.t1200,
        retries: 1,
        totalSteps: 4
      })
    ]
  });

  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    goalId: "goal-history-only",
    goal: "history only goal",
    status: "failed",
    stage: "failed",
    stepProgress: "4/4",
    retrySummary: "1",
    nextRetryAt: undefined,
    updatedAt: TIME.t1200,
    completedAt: TIME.t1200,
    source: "history"
  });
});

test("buildEvolutionQueueRows sorts by status priority and then updatedAt desc", () => {
  const rows = buildEvolutionQueueRows({
    goals: [
      createGoal({ id: "goal-pending-old", status: "pending", updatedAt: TIME.t0900 }),
      createGoal({ id: "goal-running", status: "running", updatedAt: TIME.t0700 }),
      createGoal({ id: "goal-pending-new", status: "pending", updatedAt: TIME.t1200 })
    ],
    history: [
      createHistory({ id: "goal-succeeded", status: "succeeded", completedAt: TIME.t1300 }),
      createHistory({ id: "goal-failed", status: "failed", completedAt: TIME.t1400 })
    ],
    retryItems: [
      createRetryItem({
        id: "retry-only",
        goalId: "goal-waiting-retry",
        taskType: "structure",
        attempts: 1,
        retryAt: TIME.t1100
      })
    ]
  });

  assert.deepEqual(
    rows.map((row) => row.goalId),
    [
      "goal-running",
      "goal-waiting-retry",
      "goal-pending-new",
      "goal-pending-old",
      "goal-succeeded",
      "goal-failed"
    ]
  );
});
