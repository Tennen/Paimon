import assert from "node:assert/strict";
import test from "node:test";
import { DATA_STORE, getStore, setStore } from "../storage/persistence";
import {
  ReAgentSummaryMemoryStore,
  normalizeReAgentSummaryMemorySessionKey
} from "./reAgentSummaryMemoryStore";

function createToken(): string {
  return `${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

type PersistedSummaryStore = {
  version: number;
  sessions: Record<string, unknown>;
};

test("ReAgentSummaryMemoryStore normalizes schema", { concurrency: false }, () => {
  const store = new ReAgentSummaryMemoryStore();
  const token = createToken();
  const rawSessionId = `re/summary:${token}`;
  const normalizedSessionId = normalizeReAgentSummaryMemorySessionKey(rawSessionId);

  try {
    store.clear(rawSessionId);
    store.upsert({
      id: `sum-${token}`,
      sessionId: rawSessionId,
      user_facts: ["  user.name=alice  ", "", "user.name=alice", 7, true],
      environment: "  macOS  ",
      long_term_preferences: ["  中文优先  ", "中文优先", null],
      task_results: ["  task done  ", 0, false],
      rawRefs: [" raw-1 ", "", "raw-1", "raw-2"]
    });

    const result = store.listBySession(normalizedSessionId);
    assert.equal(result.length, 1);
    assert.deepEqual(result[0].user_facts, ["user.name=alice", "7", "true"]);
    assert.deepEqual(result[0].environment, ["macOS"]);
    assert.deepEqual(result[0].long_term_preferences, ["中文优先"]);
    assert.deepEqual(result[0].task_results, ["task done", "0", "false"]);
    assert.deepEqual(result[0].rawRefs, ["raw-1", "raw-2"]);
  } finally {
    store.clear(rawSessionId);
  }
});

test("ReAgentSummaryMemoryStore dedupes rawRefs on upsert", { concurrency: false }, () => {
  const store = new ReAgentSummaryMemoryStore();
  const token = createToken();
  const sessionId = `re/raw-refs:${token}`;
  const summaryId = `sum-${token}`;

  try {
    store.clear(sessionId);
    store.upsert({
      id: summaryId,
      sessionId,
      rawRefs: [" raw-3 ", "raw-1", "raw-1", "raw-2", "", "raw-3"]
    });
    store.upsert({
      id: summaryId,
      sessionId,
      task_results: ["done"],
      rawRefs: ["raw-2", "raw-2", "raw-4"]
    });

    const records = store.listBySession(sessionId);
    assert.equal(records.length, 1);
    assert.deepEqual(records[0].rawRefs, ["raw-2", "raw-4"]);
    assert.deepEqual(records[0].task_results, ["done"]);
  } finally {
    store.clear(sessionId);
  }
});

test("ReAgentSummaryMemoryStore rolls back unknown version to v1", { concurrency: false }, () => {
  const store = new ReAgentSummaryMemoryStore();
  const token = createToken();
  const sessionId = `re/version:${token}`;
  const normalizedSessionId = normalizeReAgentSummaryMemorySessionKey(sessionId);

  try {
    store.clear(sessionId);
    setStore(DATA_STORE.RE_AGENT_MEMORY_SUMMARY, {
      version: 3,
      sessions: {
        [normalizedSessionId]: [
          {
            id: `legacy-${token}`,
            sessionId,
            user_facts: "name=bob",
            environment: ["linux", "linux"],
            long_term_preferences: [],
            task_results: "task:ok",
            rawRefs: ["raw-legacy", "raw-legacy"],
            createdAt: "2024-01-01T00:00:00.000Z"
          }
        ]
      }
    });

    const list = store.listBySession(sessionId);
    assert.equal(list.length, 1);
    assert.deepEqual(list[0].user_facts, ["name=bob"]);
    assert.deepEqual(list[0].rawRefs, ["raw-legacy"]);

    store.upsert({
      id: list[0].id,
      sessionId,
      user_facts: list[0].user_facts,
      environment: list[0].environment,
      long_term_preferences: list[0].long_term_preferences,
      task_results: [...list[0].task_results, "replayed"],
      rawRefs: [...list[0].rawRefs, "raw-new"]
    });

    const persisted = getStore<PersistedSummaryStore>(DATA_STORE.RE_AGENT_MEMORY_SUMMARY);
    assert.equal(persisted.version, 1);
  } finally {
    store.clear(sessionId);
  }
});
