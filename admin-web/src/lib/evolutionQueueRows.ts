import {
  EvolutionGoal,
  EvolutionGoalHistory,
  EvolutionGoalStatus,
  EvolutionRetryItem
} from "@/types/admin";

export type EvolutionQueueRowSource =
  | "goal"
  | "history"
  | "retry"
  | "goal+history"
  | "goal+retry"
  | "history+retry"
  | "goal+history+retry";

export type EvolutionQueueRow = {
  goalId: string;
  goal: string;
  status: EvolutionGoalStatus;
  stage: string;
  stepProgress: string;
  retrySummary: string;
  nextRetryAt?: string;
  updatedAt?: string;
  completedAt?: string;
  source: EvolutionQueueRowSource;
};

export type BuildEvolutionQueueRowsInput = {
  goals?: EvolutionGoal[] | null;
  history?: EvolutionGoalHistory[] | null;
  retryItems?: EvolutionRetryItem[] | null;
};

type EvolutionQueueAccumulator = {
  goalId: string;
  goal?: EvolutionGoal;
  history?: EvolutionGoalHistory;
  retryItems: EvolutionRetryItem[];
  sourceFlags: {
    goal: boolean;
    history: boolean;
    retry: boolean;
  };
  firstSeen: number;
};

type ScoredRow = {
  row: EvolutionQueueRow;
  firstSeen: number;
};

const STATUS_PRIORITY: Record<EvolutionGoalStatus, number> = {
  running: 0,
  waiting_retry: 1,
  pending: 2,
  succeeded: 3,
  failed: 4
};

export function buildEvolutionQueueRows(input: BuildEvolutionQueueRowsInput): EvolutionQueueRow[] {
  const map = new Map<string, EvolutionQueueAccumulator>();
  let order = 0;

  const goals = input.goals ?? [];
  for (const goal of goals) {
    const key = normalizeGoalId(goal.id);
    if (!key) {
      continue;
    }
    const entry = ensureAccumulator(map, key, () => order++);
    entry.goal = pickNewerGoal(entry.goal, goal);
    entry.sourceFlags.goal = true;
  }

  const history = input.history ?? [];
  for (const item of history) {
    const key = normalizeGoalId(item.id);
    if (!key) {
      continue;
    }
    const entry = ensureAccumulator(map, key, () => order++);
    entry.history = pickNewerHistory(entry.history, item);
    entry.sourceFlags.history = true;
  }

  const retryItems = input.retryItems ?? [];
  for (const item of retryItems) {
    const key = normalizeGoalId(item.goalId);
    if (!key) {
      continue;
    }
    const entry = ensureAccumulator(map, key, () => order++);
    upsertRetryItem(entry.retryItems, item);
    entry.sourceFlags.retry = true;
  }

  const rows: ScoredRow[] = [];
  for (const entry of map.values()) {
    rows.push({
      row: toEvolutionQueueRow(entry),
      firstSeen: entry.firstSeen
    });
  }

  rows.sort((left, right) => compareRows(left, right));
  return rows.map((item) => item.row);
}

function toEvolutionQueueRow(entry: EvolutionQueueAccumulator): EvolutionQueueRow {
  const nextRetryAt = pickEarliestTimestamp([
    entry.goal?.nextRetryAt,
    findEarliestRetryAt(entry.retryItems)
  ]);
  const completedAt = entry.goal?.completedAt ?? entry.history?.completedAt;
  const updatedAt = pickLatestTimestamp([
    entry.goal?.updatedAt,
    completedAt,
    findLatestRetryAt(entry.retryItems),
    nextRetryAt
  ]);

  return {
    goalId: entry.goalId,
    goal: entry.goal?.goal ?? entry.history?.goal ?? "-",
    status: resolveStatus(entry),
    stage: entry.goal?.stage || resolveFallbackStage(entry),
    stepProgress: resolveStepProgress(entry),
    retrySummary: resolveRetrySummary(entry),
    nextRetryAt,
    updatedAt,
    completedAt,
    source: resolveSource(entry.sourceFlags)
  };
}

function resolveStatus(entry: EvolutionQueueAccumulator): EvolutionGoalStatus {
  if (entry.goal && isActiveStatus(entry.goal.status)) {
    return entry.goal.status;
  }
  if (entry.retryItems.length > 0) {
    return "waiting_retry";
  }
  if (entry.goal) {
    return entry.goal.status;
  }
  if (entry.history) {
    return entry.history.status;
  }
  return "pending";
}

function resolveFallbackStage(entry: EvolutionQueueAccumulator): string {
  if (entry.retryItems.length > 0) {
    return "waiting_retry";
  }
  if (entry.history?.status) {
    return entry.history.status;
  }
  return "-";
}

function resolveStepProgress(entry: EvolutionQueueAccumulator): string {
  if (entry.goal) {
    const total = Array.isArray(entry.goal.plan.steps) ? entry.goal.plan.steps.length : 0;
    const current = Number.isInteger(entry.goal.plan.currentStep) ? Math.max(0, entry.goal.plan.currentStep) : 0;
    return `${current}/${total}`;
  }
  if (entry.history) {
    const total = Number.isInteger(entry.history.totalSteps) ? Math.max(0, entry.history.totalSteps) : 0;
    return `${total}/${total}`;
  }
  return "-";
}

function resolveRetrySummary(entry: EvolutionQueueAccumulator): string {
  const retriesFromGoal = entry.goal?.retries ?? 0;
  const retriesFromHistory = entry.history?.retries ?? 0;
  const totalRetries = Math.max(0, retriesFromGoal, retriesFromHistory);
  if (entry.retryItems.length === 0) {
    return totalRetries > 0 ? String(totalRetries) : "-";
  }

  const queueParts = entry.retryItems
    .slice()
    .sort((left, right) => parseTimestamp(right.retryAt) - parseTimestamp(left.retryAt))
    .map((item) => {
      const stepSuffix = Number.isInteger(item.stepIndex) ? `#${item.stepIndex}` : "";
      return `${item.taskType}${stepSuffix}×${item.attempts}`;
    });

  if (totalRetries > 0) {
    return `${totalRetries} | ${queueParts.join(", ")}`;
  }
  return queueParts.join(", ");
}

function compareRows(left: ScoredRow, right: ScoredRow): number {
  const statusDiff = STATUS_PRIORITY[left.row.status] - STATUS_PRIORITY[right.row.status];
  if (statusDiff !== 0) {
    return statusDiff;
  }

  const timeDiff = parseTimestamp(right.row.updatedAt) - parseTimestamp(left.row.updatedAt);
  if (timeDiff !== 0) {
    return timeDiff;
  }

  return left.firstSeen - right.firstSeen;
}

function ensureAccumulator(
  map: Map<string, EvolutionQueueAccumulator>,
  goalId: string,
  createOrder: () => number
): EvolutionQueueAccumulator {
  const existing = map.get(goalId);
  if (existing) {
    return existing;
  }

  const created: EvolutionQueueAccumulator = {
    goalId,
    retryItems: [],
    sourceFlags: { goal: false, history: false, retry: false },
    firstSeen: createOrder()
  };
  map.set(goalId, created);
  return created;
}

function resolveSource(flags: EvolutionQueueAccumulator["sourceFlags"]): EvolutionQueueRowSource {
  const parts: string[] = [];
  if (flags.goal) {
    parts.push("goal");
  }
  if (flags.history) {
    parts.push("history");
  }
  if (flags.retry) {
    parts.push("retry");
  }
  return (parts.join("+") || "goal") as EvolutionQueueRowSource;
}

function upsertRetryItem(items: EvolutionRetryItem[], item: EvolutionRetryItem): void {
  const index = items.findIndex((existing) => existing.id === item.id);
  if (index < 0) {
    items.push(item);
    return;
  }

  const existing = items[index];
  const keepIncoming = parseTimestamp(item.retryAt) >= parseTimestamp(existing.retryAt);
  if (keepIncoming) {
    items[index] = item;
  }
}

function pickNewerGoal(current: EvolutionGoal | undefined, candidate: EvolutionGoal): EvolutionGoal {
  if (!current) {
    return candidate;
  }
  return parseTimestamp(candidate.updatedAt) >= parseTimestamp(current.updatedAt) ? candidate : current;
}

function pickNewerHistory(
  current: EvolutionGoalHistory | undefined,
  candidate: EvolutionGoalHistory
): EvolutionGoalHistory {
  if (!current) {
    return candidate;
  }
  return parseTimestamp(candidate.completedAt) >= parseTimestamp(current.completedAt) ? candidate : current;
}

function findEarliestRetryAt(items: EvolutionRetryItem[]): string | undefined {
  return items.reduce<string | undefined>((earliest, item) => {
    if (!earliest || parseTimestamp(item.retryAt) < parseTimestamp(earliest)) {
      return item.retryAt;
    }
    return earliest;
  }, undefined);
}

function findLatestRetryAt(items: EvolutionRetryItem[]): string | undefined {
  return items.reduce<string | undefined>((latest, item) => {
    if (!latest || parseTimestamp(item.retryAt) > parseTimestamp(latest)) {
      return item.retryAt;
    }
    return latest;
  }, undefined);
}

function pickLatestTimestamp(values: Array<string | undefined>): string | undefined {
  let latest: string | undefined;
  for (const value of values) {
    if (!value) {
      continue;
    }
    if (!latest || parseTimestamp(value) > parseTimestamp(latest)) {
      latest = value;
    }
  }
  return latest;
}

function pickEarliestTimestamp(values: Array<string | undefined>): string | undefined {
  let earliest: string | undefined;
  for (const value of values) {
    if (!value) {
      continue;
    }
    if (!earliest || parseTimestamp(value) < parseTimestamp(earliest)) {
      earliest = value;
    }
  }
  return earliest;
}

function parseTimestamp(value: string | undefined): number {
  if (!value) {
    return Number.NEGATIVE_INFINITY;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function normalizeGoalId(value: string | undefined): string {
  return (value || "").trim();
}

function isActiveStatus(status: EvolutionGoalStatus): boolean {
  return status === "running" || status === "waiting_retry" || status === "pending";
}
