import fs from "node:fs";
import path from "node:path";

const market = require("../skills/market-analysis/handler.js") as { execute: (input: string) => Promise<{ text: string }> };
const portfolioPath = path.resolve(process.cwd(), "data/market-analysis/portfolio.json");
const chatRequests: Array<Record<string, unknown>> = [];

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function parseJsonSafe(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

function mockFetch(
  input: string | URL,
  init?: { body?: BodyInit | null }
): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> {
  const url = String(input);
  if (url.includes("/api/qt/stock/get")) {
    const secid = new URL(url).searchParams.get("secid") || "0.000000";
    const code = secid.split(".")[1] || "000000";
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ data: { f57: code, f58: `TEST-${code}`, f43: 1234, f60: 1200, f47: 100000, f170: 150 } })
    });
  }
  if (url.includes("/api/qt/stock/kline/get")) {
    const klines = Array.from({ length: 30 }, (_, i) => {
      const close = (10 + i * 0.1).toFixed(2);
      const vol = 100000 + i * 1000;
      return `2026-01-${String((i % 28) + 1).padStart(2, "0")},0,${close},0,0,${vol}`;
    });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ data: { klines } }) });
  }
  if (url.includes("/api/chat")) {
    const bodyText = typeof init?.body === "string" ? init.body : "";
    const parsed = parseJsonSafe(bodyText);
    if (parsed && typeof parsed === "object") {
      chatRequests.push(parsed as Record<string, unknown>);
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({
        message: {
          content: JSON.stringify({
            summary: "mock summary",
            suggestions: ["mock suggestion"]
          })
        }
      })
    });
  }
  return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
}

async function main(): Promise<void> {
  const originalPortfolio = fs.readFileSync(portfolioPath, "utf8");
  const originalFetch = globalThis.fetch;
  const originalLlmModel = process.env.MARKET_ANALYSIS_LLM_MODEL;
  const originalLlmEnabled = process.env.MARKET_ANALYSIS_LLM_ENABLED;

  try {
    const before = await market.execute("/market portfolio");
    assert(before.text.includes("Market Analysis 持仓配置"), "读取持仓失败: 缺少标题");

    const nextPortfolio = {
      cash: 1234.5,
      funds: [
        { code: "161226", quantity: 500, avgCost: 1.2 },
        { code: "000001", quantity: 100, avgCost: 10.5 }
      ]
    };
    fs.writeFileSync(portfolioPath, `${JSON.stringify(nextPortfolio, null, 2)}\n`, "utf8");

    const after = await market.execute("/market portfolio");
    assert(after.text.includes("161226") && after.text.includes("000001"), "保存持仓后回读失败: 代码未回读");

    process.env.MARKET_ANALYSIS_LLM_ENABLED = "true";
    process.env.MARKET_ANALYSIS_LLM_MODEL = "mock-market-model";
    chatRequests.length = 0;
    globalThis.fetch = mockFetch as typeof fetch;

    const midday = await market.execute("/market midday --no-llm");
    assert(midday.text.includes("Market Analysis 盘中 完成"), "midday 文本结构错误: 缺少完成标题");
    assert(midday.text.includes("市场状态:"), "midday 文本结构错误: 缺少关键信息");
    assert(midday.text.includes("资产信号:"), "midday 文本结构错误: 缺少资产信号段落");
    assert(!midday.text.includes("时间:"), "midday 文本结构错误: 不应包含时间");
    assert(!midday.text.includes("记录ID:"), "midday 文本结构错误: 不应包含记录ID");
    assert(!midday.text.includes("快照:"), "midday 文本结构错误: 不应包含快照路径");
    assert(chatRequests.length === 0, "midday --no-llm 不应调用 /api/chat");

    const middayWithLlm = await market.execute("/market midday");
    assert(middayWithLlm.text.includes("解释:"), "midday(with llm) 文本结构错误: 缺少解释");
    assert(chatRequests.length > 0, "midday(with llm) 未调用 /api/chat");

    const chatPayload = chatRequests[chatRequests.length - 1] || {};
    const messages = Array.isArray(chatPayload.messages) ? chatPayload.messages : [];
    const userMessage = messages.find((item) => {
      return Boolean(item && typeof item === "object" && (item as Record<string, unknown>).role === "user");
    }) as Record<string, unknown> | undefined;
    assert(userMessage && typeof userMessage.content === "string", "LLM 请求错误: 缺少 user message");

    const userPayload = parseJsonSafe(userMessage.content as string) as Record<string, unknown> | null;
    assert(userPayload && typeof userPayload.signalResult === "object", "LLM 请求错误: 缺少 signalResult");
    const signalResult = userPayload.signalResult as Record<string, unknown>;
    const assetSignals = Array.isArray(signalResult.assetSignals) ? signalResult.assetSignals : [];
    assert(assetSignals.length > 0, "LLM 请求错误: 缺少 assetSignals");
    const invalidSignal = assetSignals.find((item) => {
      if (!item || typeof item !== "object") return true;
      const signal = item as Record<string, unknown>;
      return !Object.prototype.hasOwnProperty.call(signal, "name") || typeof signal.name !== "string";
    });
    assert(!invalidSignal, "LLM 请求错误: signalResult.assetSignals 每项都应包含字符串 name");

    const status = await market.execute("/market status");
    assert(status.text.includes("Market Analysis 最近状态"), "status 文本错误: 缺少标题");
    assert(status.text.includes("阶段:") && status.text.includes("快照文件:"), "status 文本错误: 缺少关键字段");

    console.log("market-smoke passed");
  } finally {
    fs.writeFileSync(portfolioPath, originalPortfolio, "utf8");
    globalThis.fetch = originalFetch;
    if (originalLlmModel === undefined) {
      delete process.env.MARKET_ANALYSIS_LLM_MODEL;
    } else {
      process.env.MARKET_ANALYSIS_LLM_MODEL = originalLlmModel;
    }
    if (originalLlmEnabled === undefined) {
      delete process.env.MARKET_ANALYSIS_LLM_ENABLED;
    } else {
      process.env.MARKET_ANALYSIS_LLM_ENABLED = originalLlmEnabled;
    }
  }
}

main().catch((error) => {
  console.error("market-smoke failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
