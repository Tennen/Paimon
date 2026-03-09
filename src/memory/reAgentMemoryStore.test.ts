import assert from "node:assert/strict";
import test from "node:test";
import { ReAgentMemoryStore, normalizeReAgentSessionKey } from "./reAgentMemoryStore";

function createSessionToken(): string {
  return `${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

test("ReAgentMemoryStore normalizes session keys on read/write", () => {
  const store = new ReAgentMemoryStore();
  const token = createSessionToken();
  const rawSessionId = `re/session:${token}`;
  const normalizedSessionId = normalizeReAgentSessionKey(rawSessionId);

  try {
    store.clear(rawSessionId);
    store.append(rawSessionId, "hello");

    assert.equal(store.read(rawSessionId), "hello\n");
    assert.equal(store.read(normalizedSessionId), "hello\n");
  } finally {
    store.clear(rawSessionId);
  }
});

test("ReAgentMemoryStore clear removes only target session", () => {
  const store = new ReAgentMemoryStore();
  const token = createSessionToken();
  const targetSessionId = `re/clear:${token}`;
  const keepSessionId = `re/keep:${token}`;

  try {
    store.clear(targetSessionId);
    store.clear(keepSessionId);

    store.append(targetSessionId, "line1");
    store.append(targetSessionId, "line2");
    store.append(keepSessionId, "keep");

    assert.equal(store.read(targetSessionId), "line1\nline2\n");
    assert.equal(store.read(keepSessionId), "keep\n");

    store.clear(targetSessionId);

    assert.equal(store.read(targetSessionId), "");
    assert.equal(store.read(keepSessionId), "keep\n");
  } finally {
    store.clear(targetSessionId);
    store.clear(keepSessionId);
  }
});
