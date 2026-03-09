import test from "node:test";
import assert from "node:assert/strict";
import type { OllamaChatRequest, OllamaLLMOptions } from "./index";
import { OllamaLLMEngine } from "./index";

const PLANNING_RESPONSE = JSON.stringify({
  tool: "terminal",
  action: "run",
  params: { command: "echo hi" },
  success_response: "ok",
  failure_response: "failed"
});

function createEngineOptions(options?: Partial<OllamaLLMOptions>): Partial<OllamaLLMOptions> {
  return {
    baseUrl: "http://127.0.0.1:11434",
    model: "qwen3:4b",
    planningModel: "qwen3:4b",
    timeoutMs: 1000,
    planningTimeoutMs: 1000,
    maxRetries: 0,
    strictJson: true,
    thinkingBudgetEnabled: true,
    thinkingBudget: 1024,
    thinkingMaxNewTokens: 32768,
    ...options
  };
}

class MockOllamaLLMEngine extends OllamaLLMEngine {
  constructor(
    options: Partial<OllamaLLMOptions>,
    private readonly calls: OllamaChatRequest[]
  ) {
    super(options);
  }

  protected override async executeOllamaChat(request: OllamaChatRequest): Promise<string> {
    this.calls.push(request);
    return PLANNING_RESPONSE;
  }
}

test("plan uses override budget first and falls back to default budget", async () => {
  const calls: OllamaChatRequest[] = [];

  const engineWithOverride = new MockOllamaLLMEngine(createEngineOptions({
    thinkingBudgetEnabled: true,
    thinkingBudget: 1024,
    thinkingMaxNewTokens: 4096
  }), calls);
  const overridePlan = await engineWithOverride.plan(
    "run",
    {},
    { thinkingBudgetOverride: 2048 }
  );
  assert.ok("op" in overridePlan);
  assert.equal(overridePlan.op, "run");
  assert.equal(calls[0]?.thinkingBudget?.enabled, true);
  assert.equal(calls[0]?.thinkingBudget?.budgetTokens, 2048);
  assert.equal(calls[0]?.thinkingBudget?.maxNewTokens, 4096);

  const engineWithFallback = new MockOllamaLLMEngine(createEngineOptions({
    thinkingBudgetEnabled: true,
    thinkingBudget: 1536
  }), calls);
  await engineWithFallback.plan("run", {});
  assert.equal(calls[1]?.thinkingBudget?.enabled, true);
  assert.equal(calls[1]?.thinkingBudget?.budgetTokens, 1536);

  const disabledThinkingBudgetEngine = new MockOllamaLLMEngine(createEngineOptions({
    thinkingBudgetEnabled: false,
    thinkingBudget: 1536
  }), calls);
  await disabledThinkingBudgetEngine.plan(
    "run",
    {},
    { thinkingBudgetOverride: 3072 }
  );
  assert.equal(calls[2]?.thinkingBudget?.enabled, false);
  assert.equal(calls[2]?.thinkingBudget?.budgetTokens, undefined);
});
