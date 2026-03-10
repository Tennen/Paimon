import assert from "node:assert/strict";
import test from "node:test";
import { ReAgentRawMemoryStore, normalizeReAgentRawMemorySessionKey } from "./reAgentRawMemoryStore";

const mkToken = (): string => `${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
const append = (s: ReAgentRawMemoryStore, sessionId: string, requestId: string, id: string, user = "u", assistant = "a"): void =>
  void s.append({ id, sessionId, requestId, source: "http", user, assistant, meta: { rid: requestId } });

test("ReAgentRawMemoryStore normalizes session keys", () => {
  const store = new ReAgentRawMemoryStore();
  const t = mkToken();
  const rawSessionId = `re/raw:${t}`;
  const normalizedSessionId = normalizeReAgentRawMemorySessionKey(rawSessionId);
  try {
    store.clear(rawSessionId);
    append(store, rawSessionId, `req-${t}`, `id-${t}`, "  raw user  ", "  raw assistant  ");
    assert.equal(store.listBySession(rawSessionId).length, 1);
    assert.equal(store.listBySession(normalizedSessionId)[0].assistant, "  raw assistant  ");
    assert.equal(store.listBySession(rawSessionId)[0].user, "  raw user  ");
  } finally { store.clear(rawSessionId); }
});

test("ReAgentRawMemoryStore keeps append order", () => {
  const store = new ReAgentRawMemoryStore();
  const t = mkToken();
  const sessionId = `re/order:${t}`;
  const ids = [`${t}-1`, `${t}-2`, `${t}-3`];
  try {
    store.clear(sessionId);
    append(store, sessionId, `${t}-req-1`, ids[0], "line-1\nline-1-extra");
    append(store, sessionId, `${t}-req-2`, ids[1], "line-2");
    append(store, sessionId, `${t}-req-3`, ids[2], "line-3");
    const records = store.listBySession(sessionId);
    assert.deepEqual(records.map((item) => item.id), ids);
    assert.equal(records[0].user, "line-1\nline-1-extra");
  } finally { store.clear(sessionId); }
});

test("ReAgentRawMemoryStore reads records by ids", () => {
  const store = new ReAgentRawMemoryStore();
  const t = mkToken();
  const sessionId = `re/get:${t}`;
  const ids = [`${t}-first`, `${t}-second`, `${t}-third`];
  try {
    store.clear(sessionId);
    append(store, sessionId, `${t}-req-1`, ids[0], "u1");
    append(store, sessionId, `${t}-req-2`, ids[1], "u2");
    append(store, sessionId, `${t}-req-3`, ids[2], "u3");
    const records = store.getByIds([ids[2], ids[0], `${t}-missing`], sessionId);
    assert.deepEqual(records.map((item) => item.id), [ids[2], ids[0]]);
    assert.deepEqual(records.map((item) => item.user), ["u3", "u1"]);
  } finally { store.clear(sessionId); }
});

test("ReAgentRawMemoryStore clear removes target session only", () => {
  const store = new ReAgentRawMemoryStore();
  const t = mkToken();
  const targetSessionId = `re/target:${t}`;
  const keepSessionId = `re/keep:${t}`;
  const targetId = `${t}-target`;
  const keepId = `${t}-keep`;
  try {
    store.clear(targetSessionId); store.clear(keepSessionId);
    append(store, targetSessionId, `${t}-target-req`, targetId, "target");
    append(store, keepSessionId, `${t}-keep-req`, keepId, "keep");
    store.clear(targetSessionId);
    assert.equal(store.listBySession(targetSessionId).length, 0);
    assert.equal(store.listBySession(keepSessionId).length, 1);
    assert.deepEqual(store.getByIds([targetId]), []);
    assert.deepEqual(store.getByIds([keepId]).map((item) => item.id), [keepId]);
  } finally { store.clear(targetSessionId); store.clear(keepSessionId); }
});
