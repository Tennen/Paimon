import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";
import { CodexLLMEngine } from "../../engines/llm/codex";
import { getStore, setStore } from "../../storage/persistence";
import {
  MARKET_CONFIG_STORE,
  MARKET_PORTFOLIO_STORE,
  MARKET_RUNS_STORE,
  MARKET_STATE_STORE
} from "./defaults";
import { renderMarkdownAsLongImage } from "../user-message/markdownImageAdapter";
import { runAnalysis } from "./runtime";
import { execute } from "./service";
import { ensureStorage } from "./storage";

const childProcess = require("node:child_process") as {
  spawnSync: typeof import("node:child_process").spawnSync;
};

const ENV_KEYS = [
  "MARKET_ANALYSIS_LLM_ENABLED",
  "ENABLE_FUND_ANALYSIS",
  "MARKET_ANALYSIS_LLM_MODEL"
] as const;

function cloneJson<T>(input: T): T {
  return JSON.parse(JSON.stringify(input)) as T;
}

function createModuleNotFoundError(moduleName: string): NodeJS.ErrnoException {
  const error = new Error(`Cannot find module '${moduleName}'`) as NodeJS.ErrnoException;
  error.code = "MODULE_NOT_FOUND";
  return error;
}

function mockSpawnSyncFailure(): () => void {
  const originalSpawnSync = childProcess.spawnSync;
  childProcess.spawnSync = (() =>
    ({
      pid: 0,
      output: [],
      stdout: null,
      stderr: null,
      status: 1,
      signal: null,
      error: new Error("auto-install disabled in unit test")
    }) as unknown as ReturnType<typeof childProcess.spawnSync>) as typeof childProcess.spawnSync;
  return () => {
    childProcess.spawnSync = originalSpawnSync;
  };
}

async function withIsolatedMarketState(run: () => Promise<void>): Promise<void> {
  ensureStorage();
  const originalEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  const originalStores = {
    portfolio: cloneJson(getStore<unknown>(MARKET_PORTFOLIO_STORE)),
    config: cloneJson(getStore<unknown>(MARKET_CONFIG_STORE)),
    state: cloneJson(getStore<unknown>(MARKET_STATE_STORE)),
    runs: cloneJson(getStore<unknown>(MARKET_RUNS_STORE))
  };

  try {
    process.env.MARKET_ANALYSIS_LLM_ENABLED = "true";
    process.env.ENABLE_FUND_ANALYSIS = "true";
    process.env.MARKET_ANALYSIS_LLM_MODEL = "gpt-5-codex";

    setStore(MARKET_PORTFOLIO_STORE, {
      funds: [],
      cash: 0
    });
    setStore(MARKET_CONFIG_STORE, {
      version: 1,
      assetType: "fund",
      analysisEngine: "codex",
      searchEngine: "default",
      gptPlugin: {
        timeoutMs: 20000,
        fallbackToLocal: true
      },
      fund: {
        enabled: true,
        maxAgeDays: 5,
        featureLookbackDays: 120,
        ruleRiskLevel: "medium",
        llmRetryMax: 1,
        newsQuerySuffix: "基金 公告 经理 申赎 风险"
      }
    });

    await run();
  } finally {
    setStore(MARKET_PORTFOLIO_STORE, originalStores.portfolio);
    setStore(MARKET_CONFIG_STORE, originalStores.config);
    setStore(MARKET_STATE_STORE, originalStores.state);
    setStore(MARKET_RUNS_STORE, originalStores.runs);

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

test("renderMarkdownAsLongImage should throw missing dependency error when remark is unavailable", { concurrency: false }, async () => {
  const originalRequire = Module.prototype.require;
  const restoreSpawnSync = mockSpawnSyncFailure();
  Module.prototype.require = function patchedRequire(id: string): unknown {
    if (id === "remark") {
      throw createModuleNotFoundError(id);
    }
    return originalRequire.call(this, id);
  };

  try {
    await assert.rejects(
      () => renderMarkdownAsLongImage({ markdown: "# hi" }),
      /Missing dependency remark/
    );
  } finally {
    Module.prototype.require = originalRequire;
    restoreSpawnSync();
  }
});

test("runAnalysis should fail when codex markdown generation fails", { concurrency: false }, async () => {
  const originalChat = CodexLLMEngine.prototype.chat;
  (CodexLLMEngine.prototype as unknown as { chat: () => Promise<string> }).chat = async () => {
    throw new Error("codex markdown generation failed");
  };

  try {
    await withIsolatedMarketState(async () => {
      await assert.rejects(
        () => runAnalysis("close", true, { assetType: "fund" }),
        (error: unknown) => {
          assert.equal(error instanceof Error, true);
          const typedError = error as Error & { code?: string };
          assert.equal(typedError.code, "MARKET_IMAGE_PIPELINE_FAILED");
          assert.match(typedError.message, /failed to generate markdown report/);
          assert.match(typedError.message, /codex markdown generation failed/);
          return true;
        }
      );
    });
  } finally {
    CodexLLMEngine.prototype.chat = originalChat;
  }
});

test("service execute should not fallback to pure text when markdown image render fails", { concurrency: false }, async () => {
  const originalChat = CodexLLMEngine.prototype.chat;
  const originalRequire = Module.prototype.require;
  const restoreSpawnSync = mockSpawnSyncFailure();

  (CodexLLMEngine.prototype as unknown as { chat: () => Promise<string> }).chat = async () => {
    return "# 今日结论\n- 测试报告";
  };
  Module.prototype.require = function patchedRequire(id: string): unknown {
    if (id === "remark") {
      throw createModuleNotFoundError(id);
    }
    return originalRequire.call(this, id);
  };

  try {
    await withIsolatedMarketState(async () => {
      await assert.rejects(
        () => execute("/market close"),
        (error: unknown) => {
          assert.equal(error instanceof Error, true);
          const typedError = error as Error & { code?: string };
          assert.equal(typedError.code, "MARKET_IMAGE_PIPELINE_FAILED");
          assert.match(
            typedError.message,
            /^MARKET_IMAGE_PIPELINE_FAILED: failed to render markdown image/
          );
          return true;
        }
      );
    });
  } finally {
    CodexLLMEngine.prototype.chat = originalChat;
    Module.prototype.require = originalRequire;
    restoreSpawnSync();
  }
});
