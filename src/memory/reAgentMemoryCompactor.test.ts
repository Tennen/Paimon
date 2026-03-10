import assert from "node:assert/strict";
import test from "node:test";
import { ReAgentMemoryCompactor } from "./reAgentMemoryCompactor";
import { ReAgentRawMemoryRecord, ReAgentRawMemoryStore } from "./reAgentRawMemoryStore";
import { ReAgentSummaryMemoryStore } from "./reAgentSummaryMemoryStore";
import { ReAgentSummaryVectorIndex } from "./reAgentSummaryVectorIndex";

function token(): string {
  return `${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function appendRaw(
  store: ReAgentRawMemoryStore,
  input: {
    id: string;
    sessionId: string;
    requestId: string;
    user: string;
    assistant: string;
    source?: string;
    meta?: Record<string, unknown>;
    createdAt?: string;
  }
): void {
  store.append({
    id: input.id,
    sessionId: input.sessionId,
    requestId: input.requestId,
    source: input.source ?? "http",
    user: input.user,
    assistant: input.assistant,
    meta: input.meta ?? {},
    ...(input.createdAt ? { createdAt: input.createdAt } : {})
  });
}

function stripSummarizedAt(record: ReAgentRawMemoryRecord): Omit<ReAgentRawMemoryRecord, "summarizedAt"> {
  const { summarizedAt: _summarizedAt, ...rest } = record;
  return rest;
}

test("ReAgentMemoryCompactor keeps raw content unchanged and uses fallback on invalid LLM JSON", { concurrency: false }, async () => {
  const rawStore = new ReAgentRawMemoryStore();
  const summaryStore = new ReAgentSummaryMemoryStore();
  const vectorIndex = new ReAgentSummaryVectorIndex({ dimension: 128 });
  const compactor = new ReAgentMemoryCompactor({
    rawStore,
    summaryStore,
    summaryVectorIndex: vectorIndex,
    compactEveryRounds: 1,
    llm: async () => "not-a-json"
  });
  const t = token();
  const sessionId = `re/compact-raw:${t}`;
  const rawIds = [`raw-${t}-1`, `raw-${t}-2`];

  try {
    rawStore.clear(sessionId);
    summaryStore.clear(sessionId);
    vectorIndex.clear(sessionId);
    appendRaw(rawStore, {
      id: rawIds[0],
      sessionId,
      requestId: `req-${t}-1`,
      user: "  用户原文 A  ",
      assistant: "  助手原文 A  ",
      meta: { scheduler_task_id: `task-${t}` }
    });
    appendRaw(rawStore, {
      id: rawIds[1],
      sessionId,
      requestId: `req-${t}-2`,
      user: "line1\nline2",
      assistant: "答复\n第二行"
    });
    const before = rawStore.listBySession(sessionId).map(stripSummarizedAt);

    const result = await compactor.maybeCompact({ sessionId });

    assert.equal(result.compacted, true);
    assert.equal(result.usedFallback, true);
    assert.deepEqual(result.rawIds, rawIds);

    const after = rawStore.listBySession(sessionId);
    assert.deepEqual(after.map(stripSummarizedAt), before);
    assert.equal(after.every((item) => typeof item.summarizedAt === "string" && item.summarizedAt.length > 0), true);

    const summaries = summaryStore.listBySession(sessionId);
    assert.equal(summaries.length, 1);
    assert.deepEqual(summaries[0].rawRefs, rawIds);
    assert.equal(summaries[0].task_results.length, 2);
  } finally {
    rawStore.clear(sessionId);
    summaryStore.clear(sessionId);
    vectorIndex.clear(sessionId);
  }
});

test("ReAgentMemoryCompactor compacts same batch idempotently", { concurrency: false }, async () => {
  const rawStore = new ReAgentRawMemoryStore();
  const summaryStore = new ReAgentSummaryMemoryStore();
  const vectorIndex = new ReAgentSummaryVectorIndex({ dimension: 128 });
  const compactor = new ReAgentMemoryCompactor({
    rawStore,
    summaryStore,
    summaryVectorIndex: vectorIndex,
    compactEveryRounds: 1,
    llm: async () =>
      JSON.stringify({
        user_facts: ["name=alice"],
        environment: ["macOS"],
        long_term_preferences: ["中文回复"],
        task_results: ["任务执行完成"],
        rawRefs: []
      })
  });
  const t = token();
  const sessionId = `re/compact-idempotent:${t}`;
  const rawId = `raw-${t}-1`;

  try {
    rawStore.clear(sessionId);
    summaryStore.clear(sessionId);
    vectorIndex.clear(sessionId);
    appendRaw(rawStore, {
      id: rawId,
      sessionId,
      requestId: `req-${t}-1`,
      user: "第一次输入",
      assistant: "第一次输出"
    });

    const first = await compactor.compactNow({ sessionId });
    assert.equal(first.compacted, true);

    const firstSummary = summaryStore.listBySession(sessionId);
    assert.equal(firstSummary.length, 1);
    const stableSummaryId = firstSummary[0].id;

    appendRaw(rawStore, {
      id: rawId,
      sessionId,
      requestId: `req-${t}-2`,
      user: "第一次输入",
      assistant: "第一次输出"
    });

    const replay = await compactor.compactNow({ sessionId });
    assert.equal(replay.compacted, true);
    assert.equal(replay.summaryId, stableSummaryId);
    assert.equal(summaryStore.listBySession(sessionId).length, 1);

    const third = await compactor.compactNow({ sessionId });
    assert.equal(third.compacted, false);
    assert.equal(third.reason, "no_pending_raw");
  } finally {
    rawStore.clear(sessionId);
    summaryStore.clear(sessionId);
    vectorIndex.clear(sessionId);
  }
});

test("ReAgentMemoryCompactor supports threshold trigger and scheduler task force trigger", { concurrency: false }, async () => {
  const rawStore = new ReAgentRawMemoryStore();
  const summaryStore = new ReAgentSummaryMemoryStore();
  const vectorIndex = new ReAgentSummaryVectorIndex({ dimension: 128 });
  const compactor = new ReAgentMemoryCompactor({
    rawStore,
    summaryStore,
    summaryVectorIndex: vectorIndex,
    compactEveryRounds: 3,
    maxBatchSize: 3,
    llm: async () => JSON.stringify({ task_results: ["ok"], rawRefs: [] })
  });
  const t = token();
  const thresholdSession = `re/compact-threshold:${t}`;
  const forceSession = `re/compact-force:${t}`;

  try {
    rawStore.clear(thresholdSession);
    rawStore.clear(forceSession);
    summaryStore.clear(thresholdSession);
    summaryStore.clear(forceSession);
    vectorIndex.clear(thresholdSession);
    vectorIndex.clear(forceSession);

    appendRaw(rawStore, {
      id: `raw-${t}-a1`,
      sessionId: thresholdSession,
      requestId: `req-${t}-a1`,
      user: "u1",
      assistant: "a1"
    });
    appendRaw(rawStore, {
      id: `raw-${t}-a2`,
      sessionId: thresholdSession,
      requestId: `req-${t}-a2`,
      user: "u2",
      assistant: "a2"
    });
    const beforeThreshold = await compactor.maybeCompact({ sessionId: thresholdSession });
    assert.equal(beforeThreshold.compacted, false);
    assert.equal(beforeThreshold.reason, "threshold_not_met");
    assert.equal(summaryStore.listBySession(thresholdSession).length, 0);

    appendRaw(rawStore, {
      id: `raw-${t}-a3`,
      sessionId: thresholdSession,
      requestId: `req-${t}-a3`,
      user: "u3",
      assistant: "a3"
    });
    const thresholdHit = await compactor.maybeCompact({ sessionId: thresholdSession });
    assert.equal(thresholdHit.compacted, true);
    assert.equal(thresholdHit.forced, false);
    assert.equal(thresholdHit.batchCount, 3);
    assert.equal(summaryStore.listBySession(thresholdSession).length, 1);

    appendRaw(rawStore, {
      id: `raw-${t}-force-1`,
      sessionId: forceSession,
      requestId: `req-${t}-force-1`,
      user: "forced-user",
      assistant: "forced-assistant"
    });
    const forced = await compactor.maybeCompact({
      sessionId: forceSession,
      meta: { scheduler_task_id: `task-${t}` }
    });
    assert.equal(forced.compacted, true);
    assert.equal(forced.forced, true);
    assert.equal(summaryStore.listBySession(forceSession).length, 1);
  } finally {
    rawStore.clear(thresholdSession);
    rawStore.clear(forceSession);
    summaryStore.clear(thresholdSession);
    summaryStore.clear(forceSession);
    vectorIndex.clear(thresholdSession);
    vectorIndex.clear(forceSession);
  }
});
