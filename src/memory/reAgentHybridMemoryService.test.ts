import assert from "node:assert/strict";
import test from "node:test";
import { OllamaReAgentLlmClient } from "../core/re-agent/llmClient";
import { ReAgentRuntime } from "../core/re-agent/runtime";
import { ReAgentMemoryCompactor } from "./reAgentMemoryCompactor";
import { ReAgentRawMemoryStore } from "./reAgentRawMemoryStore";
import { ReAgentSummaryMemoryStore } from "./reAgentSummaryMemoryStore";
import { ReAgentSummaryVectorIndex } from "./reAgentSummaryVectorIndex";

function token(): string {
  return `${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

test("hybrid memory e2e: raw -> compact -> summary search -> raw replay -> prompt injection", { concurrency: false }, async () => {
  const rawStore = new ReAgentRawMemoryStore();
  const summaryStore = new ReAgentSummaryMemoryStore();
  const vectorIndex = new ReAgentSummaryVectorIndex({ dimension: 256 });
  const t = token();
  const sessionId = `re/hybrid:${t}`;
  const rawId1 = `raw-${t}-1`;
  const rawId2 = `raw-${t}-2`;
  const sentRequests: Array<Record<string, unknown>> = [];

  const compactor = new ReAgentMemoryCompactor({
    rawStore,
    summaryStore,
    summaryVectorIndex: vectorIndex,
    compactEveryRounds: 2,
    maxBatchSize: 4,
    llm: async () =>
      JSON.stringify({
        user_facts: ["用户常喝绿茶"],
        environment: ["source=http"],
        long_term_preferences: ["偏好中文回答"],
        task_results: ["任务A已完成并归档"],
        rawRefs: []
      })
  });

  try {
    rawStore.clear(sessionId);
    summaryStore.clear(sessionId);
    vectorIndex.clear(sessionId);

    rawStore.append({
      id: rawId1,
      sessionId,
      requestId: `req-${t}-1`,
      source: "http",
      user: "/re 帮我记住我常喝绿茶",
      assistant: "/re 已记录你的饮品偏好",
      meta: {}
    });
    const firstTry = await compactor.maybeCompact({
      sessionId,
      requestId: `req-${t}-1`,
      source: "http"
    });
    assert.equal(firstTry.compacted, false);
    assert.equal(firstTry.reason, "threshold_not_met");

    rawStore.append({
      id: rawId2,
      sessionId,
      requestId: `req-${t}-2`,
      source: "http",
      user: "/re 任务A做好了吗",
      assistant: "/re 任务A已完成并归档",
      meta: {}
    });
    const compacted = await compactor.maybeCompact({
      sessionId,
      requestId: `req-${t}-2`,
      source: "http"
    });

    assert.equal(compacted.compacted, true);
    assert.equal(compacted.usedFallback, false);
    assert.deepEqual(compacted.rawIds, [rawId1, rawId2]);

    const summaries = summaryStore.listBySession(sessionId);
    assert.equal(summaries.length, 1);
    assert.deepEqual(summaries[0].rawRefs, [rawId1, rawId2]);

    const hits = vectorIndex.search(sessionId, "任务A 完成", 3);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].id, summaries[0].id);

    const replayRaw = rawStore.getByIds(hits[0].rawRefs, sessionId);
    assert.deepEqual(replayRaw.map((item) => item.id), [rawId1, rawId2]);
    assert.equal(replayRaw[0].user, "/re 帮我记住我常喝绿茶");
    assert.equal(replayRaw[1].assistant, "/re 任务A已完成并归档");

    const llmClient = new OllamaReAgentLlmClient({
      baseUrl: "http://unit.test",
      model: "qwen3:4b",
      fetchImpl: async (_url, init) => {
        const bodyText = typeof init?.body === "string" ? init.body : "{}";
        sentRequests.push(JSON.parse(bodyText) as Record<string, unknown>);
        return new Response(
          JSON.stringify({
            message: {
              content: JSON.stringify({
                kind: "respond",
                response: "已注入记忆上下文"
              })
            }
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        );
      }
    });

    const runtime = new ReAgentRuntime({
      llmClient,
      modules: [],
      rawMemoryStore: rawStore,
      summaryMemoryStore: summaryStore,
      summaryVectorIndex: vectorIndex,
      summaryTopK: 2,
      rawRefLimit: 4,
      rawRecordLimit: 2
    });

    const runResult = await runtime.run({
      sessionId,
      input: "/re 帮我回忆任务A结果"
    });

    assert.equal(runResult.reason, "responded");
    assert.equal(runResult.response, "/re 已注入记忆上下文");
    assert.equal(sentRequests.length, 1);

    const request = sentRequests[0] as {
      messages?: Array<{ role?: string; content?: string }>;
    };
    const userMessage = request.messages?.find((item) => item.role === "user");
    assert.equal(typeof userMessage?.content, "string");

    const promptPayload = JSON.parse(String(userMessage?.content ?? "{}")) as {
      memoryContext?: {
        summaries?: Array<{ id: string; rawRefs: string[] }>;
        rawRecords?: Array<{ id: string; user: string; assistant: string }>;
      };
    };

    assert.equal(promptPayload.memoryContext?.summaries?.length, 1);
    assert.equal(promptPayload.memoryContext?.summaries?.[0].id, summaries[0].id);
    assert.deepEqual(promptPayload.memoryContext?.summaries?.[0].rawRefs, [rawId1, rawId2]);
    assert.deepEqual(
      promptPayload.memoryContext?.rawRecords?.map((item) => item.id),
      [rawId1, rawId2]
    );
    assert.equal(promptPayload.memoryContext?.rawRecords?.[1].assistant, "/re 任务A已完成并归档");
  } finally {
    rawStore.clear(sessionId);
    summaryStore.clear(sessionId);
    vectorIndex.clear(sessionId);
  }
});
