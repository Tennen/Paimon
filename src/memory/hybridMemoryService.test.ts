import assert from "node:assert/strict";
import test from "node:test";
import { HybridMemoryService } from "./hybridMemoryService";
import { RawMemoryStore } from "./rawMemoryStore";
import { SummaryVectorIndex } from "./summaryVectorIndex";

function token(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

test("hybridMemoryService.build returns summary hits with raw replay", { concurrency: false }, () => {
  const rawStore = new RawMemoryStore();
  const summaryVectorIndex = new SummaryVectorIndex();
  const service = new HybridMemoryService({ rawStore, summaryVectorIndex });
  const t = token();
  const sessionId = `hybrid-hit-${t}`;
  const summaryId = `summary-${t}`;
  const rawId1 = `raw-${t}-1`;
  const rawId2 = `raw-${t}-2`;

  try {
    rawStore.clear(sessionId);
    summaryVectorIndex.clear(sessionId);

    rawStore.append({
      id: rawId1,
      sessionId,
      requestId: `req-${t}-1`,
      source: "http",
      user: "上周项目周报需要发给团队",
      assistant: "周报已发送给团队"
    });
    rawStore.append({
      id: rawId2,
      sessionId,
      requestId: `req-${t}-2`,
      source: "http",
      user: "我更喜欢中文总结",
      assistant: "已记住你偏好中文总结"
    });
    summaryVectorIndex.upsert({
      id: summaryId,
      sessionId,
      text: "上周项目周报已发送给团队 偏好中文总结",
      rawRefs: [rawId1, rawId2]
    });

    const result = service.build(sessionId, "上周周报发给谁了");
    assert.ok(result);
    assert.equal(result.summaries.length, 1);
    assert.equal(result.summaries[0].id, summaryId);
    assert.deepEqual(result.rawRecords.map((item) => item.id), [rawId1, rawId2]);
    assert.match(result.memory, /\[hybrid_memory\]/);
    assert.match(result.memory, /summary_hits:/);
    assert.match(result.memory, /raw_replay:/);
    assert.match(result.memory, /上周项目周报已发送给团队/);
    assert.match(result.memory, /周报已发送给团队/);
  } finally {
    rawStore.clear(sessionId);
    summaryVectorIndex.clear(sessionId);
  }
});

test("hybridMemoryService.build returns null when no summary hit exists in session", { concurrency: false }, () => {
  const rawStore = new RawMemoryStore();
  const summaryVectorIndex = new SummaryVectorIndex();
  const service = new HybridMemoryService({ rawStore, summaryVectorIndex });
  const t = token();
  const sessionId = `hybrid-miss-${t}`;

  try {
    rawStore.clear(sessionId);
    summaryVectorIndex.clear(sessionId);
    summaryVectorIndex.upsert({
      id: `summary-other-${t}`,
      sessionId: `other-${sessionId}`,
      text: "其他会话的记忆",
      rawRefs: []
    });

    const result = service.build(sessionId, "任何查询");
    assert.equal(result, null);
  } finally {
    rawStore.clear(sessionId);
    summaryVectorIndex.clear(sessionId);
    summaryVectorIndex.clear(`other-${sessionId}`);
  }
});

test("hybridMemoryService.build applies dedupe and limits for summaries/raw refs/raw records", { concurrency: false }, () => {
  const rawStore = new RawMemoryStore();
  const summaryVectorIndex = new SummaryVectorIndex();
  const service = new HybridMemoryService({
    rawStore,
    summaryVectorIndex,
    summaryTopK: 2,
    rawRefLimit: 3,
    rawRecordLimit: 2
  });
  const t = token();
  const sessionId = `hybrid-limit-${t}`;
  const rawId1 = `raw-${t}-1`;
  const rawId2 = `raw-${t}-2`;
  const rawId3 = `raw-${t}-3`;
  const rawId4 = `raw-${t}-4`;
  const summaryId1 = `summary-${t}-1`;
  const summaryId2 = `summary-${t}-2`;
  const summaryId3 = `summary-${t}-3`;

  try {
    rawStore.clear(sessionId);
    summaryVectorIndex.clear(sessionId);

    const rawIds = [rawId1, rawId2, rawId3, rawId4];
    for (let i = 0; i < rawIds.length; i += 1) {
      rawStore.append({
        id: rawIds[i],
        sessionId,
        requestId: `req-${t}-${i + 1}`,
        source: "http",
        user: `user-${i + 1}`,
        assistant: `assistant-${i + 1}`
      });
    }

    summaryVectorIndex.upsert({
      id: summaryId1,
      sessionId,
      text: "alpha",
      rawRefs: [rawId1, rawId2, rawId1, rawId3],
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    summaryVectorIndex.upsert({
      id: summaryId2,
      sessionId,
      text: "alpha secondary",
      rawRefs: [rawId3, rawId4],
      updatedAt: "2025-01-01T00:00:00.000Z"
    });
    summaryVectorIndex.upsert({
      id: summaryId3,
      sessionId,
      text: "beta only",
      rawRefs: [rawId4],
      updatedAt: "2024-01-01T00:00:00.000Z"
    });

    const result = service.build(sessionId, "alpha");
    assert.ok(result);
    assert.equal(result.summaries.length, 2);
    assert.equal(result.summaries[0].id, summaryId1);
    assert.deepEqual(
      result.summaries.map((item) => item.id),
      [summaryId1, summaryId2]
    );
    assert.deepEqual(result.rawRecords.map((item) => item.id), [rawId1, rawId2]);
  } finally {
    rawStore.clear(sessionId);
    summaryVectorIndex.clear(sessionId);
  }
});

test("hybridMemoryService.build formats output with one-line normalization and clipping", { concurrency: false }, () => {
  const rawStore = new RawMemoryStore();
  const summaryVectorIndex = new SummaryVectorIndex();
  const service = new HybridMemoryService({
    rawStore,
    summaryVectorIndex,
    summaryTopK: 1,
    rawRefLimit: 2,
    rawRecordLimit: 1,
    summaryTextLimit: 18,
    rawTextLimit: 10
  });
  const t = token();
  const sessionId = `hybrid-format-${t}`;
  const summaryId = `summary-${t}`;
  const rawId = `raw-${t}`;

  try {
    rawStore.clear(sessionId);
    summaryVectorIndex.clear(sessionId);

    rawStore.append({
      id: rawId,
      sessionId,
      requestId: `req-${t}`,
      source: "http",
      user: "第一行\n第二行\n第三行非常非常长",
      assistant: "回复第一行\n回复第二行\n回复第三行很长"
    });
    summaryVectorIndex.upsert({
      id: summaryId,
      sessionId,
      text: "总结第一行\n总结第二行并且描述非常非常长",
      rawRefs: [rawId]
    });

    const result = service.build(sessionId, "  我想\n回顾    上周   事项 ");
    assert.ok(result);
    const lines = result.memory.split("\n");
    assert.equal(lines[0], "[hybrid_memory]");
    assert.match(result.memory, /query: 我想 回顾 上周 事项/);
    const summaryLine = lines.find((line) => line.startsWith("  summary: "));
    const userLine = lines.find((line) => line.startsWith("  user: "));
    const assistantLine = lines.find((line) => line.startsWith("  assistant: "));
    assert.ok(summaryLine);
    assert.ok(userLine);
    assert.ok(assistantLine);
    assert.match(summaryLine, /\.\.\.$/);
    assert.match(userLine, /\.\.\.$/);
    assert.match(assistantLine, /\.\.\.$/);
    assert.equal(result.memory.includes("第一行\n第二行"), false);
    assert.equal(result.memory.includes("回复第一行\n回复第二行"), false);
  } finally {
    rawStore.clear(sessionId);
    summaryVectorIndex.clear(sessionId);
  }
});
