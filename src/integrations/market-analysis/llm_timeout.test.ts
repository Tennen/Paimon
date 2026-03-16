import test from "node:test";
import assert from "node:assert/strict";
import {
  readLLMProviderStore,
  writeLLMProviderStore,
  type LLMProviderStore
} from "../../engines/llm/provider_store";
import {
  DEFAULT_MARKET_ANALYSIS_LLM_TIMEOUT_MS,
  resolveMarketAnalysisLlmTimeoutMs
} from "./llm_timeout";

const ENV_KEYS = [
  "MARKET_ANALYSIS_LLM_TIMEOUT_MS",
  "LLM_TIMEOUT_MS"
] as const;

function writeStore(defaultTimeoutMs: number, codexTimeoutMs?: number): void {
  const providers: LLMProviderStore["providers"] = [
    {
      id: "default-openai",
      name: "Default OpenAI",
      type: "openai",
      config: { model: "gpt-4.1", timeoutMs: defaultTimeoutMs }
    }
  ];
  if (codexTimeoutMs !== undefined) {
    providers.push({
      id: "codex-fast",
      name: "Codex Fast",
      type: "codex",
      config: { model: "gpt-5-codex", timeoutMs: codexTimeoutMs }
    });
  }
  writeLLMProviderStore({
    version: 2,
    defaultProviderId: "default-openai",
    routingProviderId: "default-openai",
    planningProviderId: "default-openai",
    providers
  });
}

function withIsolatedState(run: () => void): void {
  const originalStore = readLLMProviderStore();
  const originalEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

  try {
    run();
  } finally {
    writeLLMProviderStore(originalStore);
    for (const key of ENV_KEYS) {
      const value = originalEnv.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("llm timeout resolver priority: market env > provider > global", { concurrency: false }, () => {
  withIsolatedState(() => {
    writeStore(34000);

    process.env.LLM_TIMEOUT_MS = "48000";
    process.env.MARKET_ANALYSIS_LLM_TIMEOUT_MS = "72000";
    assert.equal(resolveMarketAnalysisLlmTimeoutMs({ engineSelector: "default-openai" }), 72000);
  });
});

test("llm timeout resolver supports selector by provider id/type and default fallback", { concurrency: false }, () => {
  withIsolatedState(() => {
    writeStore(32000, 91000);

    delete process.env.MARKET_ANALYSIS_LLM_TIMEOUT_MS;
    delete process.env.LLM_TIMEOUT_MS;

    assert.equal(resolveMarketAnalysisLlmTimeoutMs({ engineSelector: "codex-fast" }), 91000);
    assert.equal(resolveMarketAnalysisLlmTimeoutMs({ engineSelector: "codex" }), 91000);
    assert.equal(resolveMarketAnalysisLlmTimeoutMs({ engineSelector: "missing-provider" }), 32000);
  });
});

test("llm timeout resolver boundary values: floor decimals, ignore non-positive, default fallback", { concurrency: false }, () => {
  withIsolatedState(() => {
    writeStore(15500.9);

    delete process.env.MARKET_ANALYSIS_LLM_TIMEOUT_MS;
    delete process.env.LLM_TIMEOUT_MS;
    assert.equal(resolveMarketAnalysisLlmTimeoutMs(), 15500);

    process.env.MARKET_ANALYSIS_LLM_TIMEOUT_MS = "60000.8";
    assert.equal(resolveMarketAnalysisLlmTimeoutMs(), 60000);

    process.env.MARKET_ANALYSIS_LLM_TIMEOUT_MS = "0";
    process.env.LLM_TIMEOUT_MS = "-1";
    writeStore(0);

    assert.equal(resolveMarketAnalysisLlmTimeoutMs(), DEFAULT_MARKET_ANALYSIS_LLM_TIMEOUT_MS);
  });
});
