import test from "node:test";
import assert from "node:assert/strict";
import type { OllamaLLMOptions } from "./index";
import type { OllamaChatRequest } from "./client";

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

function createMockModule(modulePath: string, exports: Record<string, unknown>): NodeModule {
  const Module = require("node:module");
  const mod = new Module.Module(modulePath);
  mod.filename = modulePath;
  mod.paths = Module._nodeModulePaths(process.cwd());
  mod.loaded = true;
  mod.exports = exports;
  return mod as NodeModule;
}

test("planToolExecution uses override budget first and falls back to default budget", async () => {
  const calls: OllamaChatRequest[] = [];
  const mockOllamaChat = async (request: OllamaChatRequest): Promise<string> => {
    calls.push(request);
    return PLANNING_RESPONSE;
  };

  const clientPath = require.resolve("./client");
  const indexPath = require.resolve("./index");
  const originalClientCache = require.cache[clientPath];
  const originalIndexCache = require.cache[indexPath];

  try {
    delete require.cache[indexPath];
    require.cache[clientPath] = createMockModule(clientPath, { ollamaChat: mockOllamaChat });

    const { OllamaLLMEngine } = require("./index") as typeof import("./index");

    const engineWithOverride = new OllamaLLMEngine(createEngineOptions({
      thinkingBudgetEnabled: true,
      thinkingBudget: 1024,
      thinkingMaxNewTokens: 4096
    }));
    const overridePlan = await engineWithOverride.planToolExecution(
      "run",
      {},
      { thinkingBudgetOverride: 2048 }
    );
    assert.equal(overridePlan.op, "run");
    assert.equal(calls[0]?.thinkingBudget?.enabled, true);
    assert.equal(calls[0]?.thinkingBudget?.budgetTokens, 2048);
    assert.equal(calls[0]?.thinkingBudget?.maxNewTokens, 4096);

    const engineWithFallback = new OllamaLLMEngine(createEngineOptions({
      thinkingBudgetEnabled: true,
      thinkingBudget: 1536
    }));
    await engineWithFallback.planToolExecution("run", {});
    assert.equal(calls[1]?.thinkingBudget?.enabled, true);
    assert.equal(calls[1]?.thinkingBudget?.budgetTokens, 1536);

    const disabledThinkingBudgetEngine = new OllamaLLMEngine(createEngineOptions({
      thinkingBudgetEnabled: false,
      thinkingBudget: 1536
    }));
    await disabledThinkingBudgetEngine.planToolExecution(
      "run",
      {},
      { thinkingBudgetOverride: 3072 }
    );
    assert.equal(calls[2]?.thinkingBudget?.enabled, false);
    assert.equal(calls[2]?.thinkingBudget?.budgetTokens, undefined);
  } finally {
    delete require.cache[indexPath];
    if (originalIndexCache) {
      require.cache[indexPath] = originalIndexCache;
    }
    if (originalClientCache) {
      require.cache[clientPath] = originalClientCache;
    } else {
      delete require.cache[clientPath];
    }
  }
});
