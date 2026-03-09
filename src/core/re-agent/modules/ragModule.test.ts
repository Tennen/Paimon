import assert from "node:assert/strict";
import test from "node:test";
import { RagSearchHit, RagService } from "../../../integrations/rag/service";
import { ReAgentModuleContext } from "../types";
import { RAG_MODULE_SEARCH_ACTION, createRagModule } from "./ragModule";

function createContext(overrides: Partial<ReAgentModuleContext> = {}): ReAgentModuleContext {
  return {
    sessionId: "session-default",
    input: "",
    step: 1,
    maxSteps: 6,
    history: [],
    ...overrides
  };
}

test("ragModule returns fallback result when knowledge base is empty", async () => {
  const module = createRagModule(new RagService());

  const result = await module.execute(
    RAG_MODULE_SEARCH_ACTION,
    { query: "  RAG 是什么  " },
    createContext({ sessionId: "re-session-1" })
  );

  assert.equal(result.ok, true);
  if (!result.ok) {
    assert.fail("expected success result");
  }

  const output = result.output as {
    query: string;
    sessionId: string;
    empty: boolean;
    note?: string;
    hits: Array<{ id: string; content: string }>;
  };

  assert.equal(output.query, "RAG 是什么");
  assert.equal(output.sessionId, "re-session-1");
  assert.equal(output.empty, true);
  assert.equal(output.hits.length, 1);
  assert.equal(output.hits[0].id, "rag:empty");
  assert.match(output.hits[0].content, /知识库为空/);
  assert.match(output.note ?? "", /知识库为空/);
});

test("ragModule forwards query/sessionId and returns retriever hits", async () => {
  let receivedQuery = "";
  let receivedSessionId = "";

  const retriever = {
    search: async (query: string, sessionId: string): Promise<RagSearchHit[]> => {
      receivedQuery = query;
      receivedSessionId = sessionId;
      return [
        {
          id: "doc-1",
          content: "RAG = Retrieval Augmented Generation",
          source: "local://doc-1",
          score: 0.91
        }
      ];
    }
  };

  const module = createRagModule(new RagService(retriever));
  const result = await module.execute(
    RAG_MODULE_SEARCH_ACTION,
    { query: "  RAG  " },
    createContext({ sessionId: "re-session-2" })
  );

  assert.equal(receivedQuery, "RAG");
  assert.equal(receivedSessionId, "re-session-2");
  assert.equal(result.ok, true);
  if (!result.ok) {
    assert.fail("expected success result");
  }

  const output = result.output as {
    empty: boolean;
    hits: Array<{ id: string; content: string }>;
  };

  assert.equal(output.empty, false);
  assert.equal(output.hits.length, 1);
  assert.equal(output.hits[0].id, "doc-1");
  assert.match(output.hits[0].content, /Retrieval Augmented Generation/);
});

test("ragModule rejects unsupported action and missing query", async () => {
  const module = createRagModule();

  const unsupported = await module.execute(
    "lookup",
    { query: "test" },
    createContext()
  );
  assert.equal(unsupported.ok, false);
  assert.match(unsupported.error ?? "", /Unsupported rag action/);

  const missingQuery = await module.execute(
    RAG_MODULE_SEARCH_ACTION,
    { query: "   " },
    createContext()
  );
  assert.equal(missingQuery.ok, false);
  assert.equal(missingQuery.error, "Missing query");
});
