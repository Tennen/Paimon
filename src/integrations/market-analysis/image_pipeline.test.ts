import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";
import { CodexLLMEngine } from "../../engines/llm/codex";
import { renderMarkdownToImages } from "../md2img";
import { getStore, setStore } from "../../storage/persistence";
import {
  MARKET_CONFIG_STORE,
  MARKET_PORTFOLIO_STORE,
  MARKET_RUNS_STORE,
  MARKET_STATE_STORE
} from "./defaults";
import { runAnalysis } from "./runtime";
import { execute } from "./service";
import { ensureStorage } from "./storage";

const ENV_KEYS = [
  "MARKET_ANALYSIS_LLM_ENABLED",
  "ENABLE_FUND_ANALYSIS",
  "MARKET_ANALYSIS_LLM_MODEL"
] as const;

type MockProcessor = {
  use: (plugin: unknown, options?: unknown) => MockProcessor;
  process: (markdown: string) => Promise<string>;
};

function cloneJson<T>(input: T): T {
  return JSON.parse(JSON.stringify(input)) as T;
}

function createModuleNotFoundError(moduleName: string): NodeJS.ErrnoException {
  const error = new Error(`Cannot find module '${moduleName}'`) as NodeJS.ErrnoException;
  error.code = "MODULE_NOT_FOUND";
  return error;
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

test("renderMarkdownToImages should throw missing dependency error when playwright is unavailable", { concurrency: false }, async () => {
  const originalRequire = Module.prototype.require;
  Module.prototype.require = function patchedRequire(id: string): unknown {
    if (id === "playwright") {
      throw createModuleNotFoundError(id);
    }
    if (id === "unified") {
      return {
        unified: () => createMockProcessor()
      };
    }
    if (id === "remark-parse" || id === "remark-gfm" || id === "remark-rehype" || id === "rehype-stringify") {
      return () => undefined;
    }
    return originalRequire.call(this, id);
  };

  try {
    await assert.rejects(
      () => renderMarkdownToImages({ markdown: "# hi", mode: "long-image" }),
      /Missing dependency playwright/
    );
  } finally {
    Module.prototype.require = originalRequire;
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
        () => runAnalysis("close"),
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

  (CodexLLMEngine.prototype as unknown as { chat: () => Promise<string> }).chat = async () => {
    return "# 今日结论\n- 测试报告";
  };
  Module.prototype.require = function patchedRequire(id: string): unknown {
    if (id === "playwright") {
      throw createModuleNotFoundError(id);
    }
    if (id === "unified") {
      return {
        unified: () => createMockProcessor()
      };
    }
    if (id === "remark-parse" || id === "remark-gfm" || id === "remark-rehype" || id === "rehype-stringify") {
      return () => undefined;
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
  }
});

test("service execute should return image-only response for market analysis", { concurrency: false }, async () => {
  const originalChat = CodexLLMEngine.prototype.chat;
  const originalRequire = Module.prototype.require;
  (CodexLLMEngine.prototype as unknown as { chat: () => Promise<string> }).chat = async () => {
    return [
      "# 今日结论",
      "建议维持当前仓位。",
      "## 市场状态",
      "- 市场状态：震荡",
      "## 持仓逐项建议",
      "- 暂无持仓",
      "## 风险与观察点",
      "> 关注量能变化",
      "## 执行清单（短期/中期）",
      "- 暂不调仓"
    ].join("\n");
  };
  Module.prototype.require = function patchedRequire(id: string): unknown {
    if (id === "unified") {
      return {
        unified: () => createMockProcessor()
      };
    }
    if (id === "remark-parse" || id === "remark-gfm" || id === "remark-rehype" || id === "rehype-stringify") {
      return () => undefined;
    }
    if (id === "playwright") {
      return createMockPlaywright(["market-image"]);
    }
    return originalRequire.call(this, id);
  };

  try {
    await withIsolatedMarketState(async () => {
      const response = await execute("/market close");
      const typedResponse = response as {
        text: string;
        image?: { data?: string };
        result?: { markdownReport?: string };
      };

      assert.equal(typedResponse.text, "");
      assert.equal(typeof typedResponse.image?.data, "string");
      assert.equal((typedResponse.image?.data || "").length > 0, true);
      assert.match(String(typedResponse.result?.markdownReport || ""), /今日结论/);
    });
  } finally {
    CodexLLMEngine.prototype.chat = originalChat;
    Module.prototype.require = originalRequire;
  }
});

function createMockProcessor(): MockProcessor {
  return {
    use() {
      return this;
    },
    async process(markdown: string): Promise<string> {
      const safeMarkdown = String(markdown || "").replace(/[<&]/g, (value) => (value === "<" ? "&lt;" : "&amp;"));
      return [
        '<section data-block-id="b_1" data-block-type="heading" data-break-inside="avoid" data-keep-with-next="true"><h1>Mock</h1></section>',
        `<section data-block-id="b_2" data-block-type="paragraph" data-break-inside="auto" data-keep-with-next="false"><p>${safeMarkdown}</p></section>`
      ].join("");
    }
  };
}

function createMockPlaywright(screenshots: string[]): {
  chromium: {
    launch: () => Promise<{
      newPage: () => Promise<{
        setContent: () => Promise<void>;
        evaluate: <T>(fn: () => T | Promise<T>) => Promise<T | undefined>;
        waitForTimeout: () => Promise<void>;
        locator: (selector: string) => unknown;
      }>;
      close: () => Promise<void>;
    }>;
  };
} {
  return {
    chromium: {
      launch: async () => ({
        newPage: async () => ({
          async setContent(): Promise<void> {
            return undefined;
          },
          async evaluate<T>(pageFunction: () => T | Promise<T>): Promise<T | undefined> {
            const source = String(pageFunction);
            if (source.includes('querySelectorAll("[data-block-id]")')) {
              return [
                {
                  id: "b_1",
                  type: "heading",
                  top: 24,
                  height: 48,
                  breakInside: "avoid",
                  keepWithNext: true
                },
                {
                  id: "b_2",
                  type: "paragraph",
                  top: 84,
                  height: 120,
                  breakInside: "auto",
                  keepWithNext: false
                }
              ] as T;
            }
            return undefined;
          },
          async waitForTimeout(): Promise<void> {
            return undefined;
          },
          locator(selector: string): unknown {
            if (selector === ".mobile-canvas") {
              return {
                screenshot: async () => Buffer.from(screenshots[0] || "mock-image")
              };
            }
            if (selector === ".mobile-page") {
              return {
                count: async () => screenshots.length,
                nth: (index: number) => ({
                  screenshot: async () => Buffer.from(screenshots[index] || `mock-page-${index + 1}`)
                })
              };
            }
            throw new Error(`Unexpected selector: ${selector}`);
          }
        }),
        async close(): Promise<void> {
          return undefined;
        }
      })
    }
  };
}
