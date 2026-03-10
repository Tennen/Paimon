import assert from "node:assert/strict";
import test from "node:test";
import { SummaryVectorIndex } from "./summaryVectorIndex";

function createToken(): string {
  return `${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

test("SummaryVectorIndex search isolates sessions", { concurrency: false }, () => {
  const index = new SummaryVectorIndex({ dimension: 256 });
  const token = createToken();
  const sessionA = `re/vector-a:${token}`;
  const sessionB = `re/vector-b:${token}`;
  const idA = `sum-a-${token}`;
  const idB = `sum-b-${token}`;

  try {
    index.clear(sessionA);
    index.clear(sessionB);
    index.upsert({
      id: idA,
      sessionId: sessionA,
      user_facts: ["user plans a museum travel itinerary"],
      rawRefs: ["raw-a-1"]
    });
    index.upsert({
      id: idB,
      sessionId: sessionB,
      user_facts: ["user tracks stock portfolio risk"],
      rawRefs: ["raw-b-1"]
    });

    const hits = index.search(sessionA, "museum itinerary", 5);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].id, idA);
    assert.deepEqual(hits[0].rawRefs, ["raw-a-1"]);
  } finally {
    index.clear(sessionA);
    index.clear(sessionB);
  }
});

test("SummaryVectorIndex ranks more relevant summaries first", { concurrency: false }, () => {
  const index = new SummaryVectorIndex({ dimension: 256 });
  const token = createToken();
  const sessionId = `re/vector-rank:${token}`;
  const high = `sum-high-${token}`;
  const medium = `sum-medium-${token}`;
  const low = `sum-low-${token}`;

  try {
    index.clear(sessionId);
    index.upsert({
      id: high,
      sessionId,
      user_facts: ["python static typing preferences"],
      task_results: ["implemented vector retrieval for python memory"],
      rawRefs: ["raw-high"]
    });
    index.upsert({
      id: medium,
      sessionId,
      task_results: ["python retrieval api integrated"],
      rawRefs: ["raw-medium"]
    });
    index.upsert({
      id: low,
      sessionId,
      task_results: ["kitchen pasta recipe finished"],
      rawRefs: ["raw-low"]
    });

    const hits = index.search(sessionId, "python vector typing retrieval", 3);
    assert.equal(hits.length, 3);
    assert.deepEqual(hits.slice(0, 2).map((item) => item.id), [high, medium]);
    assert.ok(hits[0].score > hits[1].score);
    assert.ok(hits[1].score > hits[2].score);
  } finally {
    index.clear(sessionId);
  }
});

test("SummaryVectorIndex falls back to recent summaries on empty query", { concurrency: false }, () => {
  const index = new SummaryVectorIndex({ dimension: 128 });
  const token = createToken();
  const sessionId = `re/vector-fallback:${token}`;
  const oldId = `sum-old-${token}`;
  const middleId = `sum-middle-${token}`;
  const newId = `sum-new-${token}`;

  try {
    index.clear(sessionId);
    index.upsert({
      id: oldId,
      sessionId,
      text: "older summary",
      updatedAt: "2024-01-01T00:00:00.000Z"
    });
    index.upsert({
      id: middleId,
      sessionId,
      text: "middle summary",
      updatedAt: "2024-01-02T00:00:00.000Z"
    });
    index.upsert({
      id: newId,
      sessionId,
      text: "newest summary",
      updatedAt: "2024-01-03T00:00:00.000Z"
    });

    const blankQueryHits = index.search(sessionId, "   ", 2);
    assert.deepEqual(blankQueryHits.map((item) => item.id), [newId, middleId]);
    assert.deepEqual(blankQueryHits.map((item) => item.score), [0, 0]);

    const noTokenHits = index.search(sessionId, "!!!", 2);
    assert.deepEqual(noTokenHits.map((item) => item.id), [newId, middleId]);
  } finally {
    index.clear(sessionId);
  }
});

test("SummaryVectorIndex boosts exact query match in hybrid ranking", { concurrency: false }, () => {
  const index = new SummaryVectorIndex({ dimension: 256 });
  const token = createToken();
  const sessionId = `re/vector-hybrid:${token}`;
  const exactId = `sum-exact-${token}`;
  const relatedId = `sum-related-${token}`;
  const query = "release checklist for project alpha";

  try {
    index.clear(sessionId);
    index.upsert({
      id: relatedId,
      sessionId,
      text: "project alpha timeline planning and work breakdown"
    });
    index.upsert({
      id: exactId,
      sessionId,
      text: "release checklist for project alpha"
    });

    const hits = index.search(sessionId, query, 2);
    assert.equal(hits.length, 2);
    assert.equal(hits[0].id, exactId);
    assert.ok(hits[0].score > hits[1].score);
  } finally {
    index.clear(sessionId);
  }
});
