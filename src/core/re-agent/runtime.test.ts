import assert from "node:assert/strict";
import test from "node:test";
import { ReAgentLlmClient, ReAgentLlmStepInput } from "./llmClient";
import { ReAgentRuntime } from "./runtime";
import { ReActAction, ReAgentModule } from "./types";

class MockLlmClient implements ReAgentLlmClient {
  readonly calls: ReAgentLlmStepInput[] = [];
  constructor(private readonly actions: ReActAction[]) {}
  async nextAction(input: ReAgentLlmStepInput): Promise<ReActAction> {
    this.calls.push({ ...input, history: input.history.slice(), tools: input.tools.slice() });
    return this.actions.shift() ?? { kind: "respond", response: "默认响应" };
  }
}

test("runtime loops tool->observation->respond", async () => {
  const module: ReAgentModule = {
    name: "rag",
    execute: async (_action, params, context) => {
      assert.equal(context.step, 1);
      assert.equal(context.history.length, 0);
      return { ok: true, output: { query: params.query, source: "mock" } };
    }
  };
  const llm = new MockLlmClient([
    { kind: "tool", tool: "rag", action: "search", params: { query: "ReAct" } },
    { kind: "respond", response: "检索完成" }
  ]);
  const result = await new ReAgentRuntime({ llmClient: llm, modules: [module], maxSteps: 4 }).run({
    sessionId: "s-1",
    input: "解释 ReAct"
  });

  assert.equal(result.reason, "responded");
  assert.equal(result.response, "/re 检索完成");
  assert.equal(result.trace.length, 2);
  assert.equal(result.trace[0].observation?.ok, true);
  assert.equal(llm.calls.length, 2);
  assert.equal(llm.calls[1].history.length, 1);
});

test("runtime records unknown module observation then continues", async () => {
  const llm = new MockLlmClient([
    { kind: "tool", tool: "missing", action: "run", params: {} },
    { kind: "respond", response: "继续完成" }
  ]);
  const result = await new ReAgentRuntime({ llmClient: llm, modules: [], maxSteps: 3 }).run({
    sessionId: "s-2",
    input: "测试模块缺失"
  });

  assert.equal(result.reason, "responded");
  assert.equal(result.response, "/re 继续完成");
  assert.equal(result.trace[0].observation?.ok, false);
  assert.match(result.trace[0].observation?.error ?? "", /Unknown re-agent module/);
});

test("runtime stops at max steps when model never responds", async () => {
  const loopLlm: ReAgentLlmClient = {
    async nextAction(): Promise<ReActAction> {
      return { kind: "tool", tool: "echo", action: "run", params: {} };
    }
  };
  const echoModule: ReAgentModule = { name: "echo", execute: async () => ({ ok: true, output: "ok" }) };
  const result = await new ReAgentRuntime({ llmClient: loopLlm, modules: [echoModule], maxSteps: 2 }).run({
    sessionId: "s-3",
    input: "一直调用工具"
  });

  assert.equal(result.reason, "max_steps");
  assert.equal(result.trace.length, 2);
  assert.match(result.response, /^\/re\s+/);
  assert.match(result.response, /最大推理步数/);
});
