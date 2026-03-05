// @ts-nocheck
import * as chatgptBridge from "../chatgpt-bridge/service";
import {
  DATA_STORE,
  getStore,
  registerStore,
  setStore
} from "../../storage/persistence";

const MARKET_PORTFOLIO_STORE = DATA_STORE.MARKET_PORTFOLIO;
const MARKET_CONFIG_STORE = DATA_STORE.MARKET_CONFIG;
const MARKET_STATE_STORE = DATA_STORE.MARKET_STATE;
const MARKET_RUNS_STORE = DATA_STORE.MARKET_RUNS;

const DEFAULT_INDEX_CODES = ["000300", "000001", "399001"];
const DEFAULT_TIMEOUT_MS = 10000;
const HISTORY_LIMIT = 90;

const SH_INDEX_CODES = new Set(["000001", "000016", "000300", "000688", "000905", "000852"]);
const SZ_INDEX_CODES = new Set(["399001", "399005", "399006", "399102", "399303"]);
const DEFAULT_ANALYSIS_CONFIG = {
  version: 1,
  analysisEngine: "local",
  gptPlugin: {
    timeoutMs: 20000,
    fallbackToLocal: true
  }
};

export const directCommands = ["/market"];

export async function execute(input) {
  ensureStorage();

  const command = parseCommand(input);

  if (command.kind === "help") {
    return { text: buildHelpText() };
  }

  if (command.kind === "portfolio") {
    const portfolio = readPortfolio();
    return { text: formatPortfolio(portfolio) };
  }

  if (command.kind === "portfolio_add") {
    const result = addPortfolioHolding(command.holding);
    return { text: formatPortfolioAddResult(result) };
  }

  if (command.kind === "status") {
    return { text: formatStatus(readState()) };
  }

  const phase = command.phase;
  const withExplanation = command.withExplanation;

  const result = await runAnalysis(phase, withExplanation);
  return {
    text: buildRunResponseText(result),
    result: {
      runId: result.persisted.id,
      phase: result.signalResult.phase,
      marketState: result.signalResult.marketState,
      generatedAt: result.signalResult.generatedAt,
      signalResult: result.signalResult,
      explanation: result.explanation
    }
  };
}

function parseCommand(input) {
  const raw = String(input || "").trim();
  const fromSlash = /^\/market\b/i.test(raw);
  const body = fromSlash ? raw.replace(/^\/market\b/i, "").trim() : raw;
  const lower = body.toLowerCase();

  if (!body) {
    return { kind: "help" };
  }

  if (["help", "h", "?", "帮助"].includes(lower)) {
    return { kind: "help" };
  }

  if (/^(status|latest|最近|状态)$/i.test(body)) {
    return { kind: "status" };
  }

  if (/^(portfolio|holdings|position|持仓)$/i.test(body)) {
    return { kind: "portfolio" };
  }

  const addPayload = extractPortfolioAddPayload(body);
  if (addPayload) {
    return {
      kind: "portfolio_add",
      holding: parsePortfolioHoldingPayload(addPayload)
    };
  }

  const withExplanation = !/--no-llm\b/i.test(body);

  const explicitPhase = detectPhaseFromText(body);
  if (explicitPhase) {
    return {
      kind: "run",
      phase: explicitPhase,
      withExplanation
    };
  }

  if (/^run\b/i.test(lower)) {
    const rest = body.replace(/^run\b/i, "").trim();
    return {
      kind: "run",
      phase: detectPhaseFromText(rest) || inferPhaseFromLocalTime(),
      withExplanation
    };
  }

  if (!fromSlash) {
    return {
      kind: "run",
      phase: inferPhaseFromLocalTime(),
      withExplanation
    };
  }

  return {
    kind: "run",
    phase: inferPhaseFromLocalTime(),
    withExplanation
  };
}

function extractPortfolioAddPayload(body) {
  const matched = String(body || "").match(
    /^(?:(?:portfolio|holdings|position|持仓)\s+)?(?:add|new|append|create|新增|添加)\s+(.+)$/i
  );
  if (!matched || !matched[1]) {
    return "";
  }
  return matched[1].trim();
}

function parsePortfolioHoldingPayload(payload) {
  const tokens = String(payload || "")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (tokens.length < 3) {
    throw new Error("添加持仓参数不足。示例: /market add 510300 100 4.12 沪深300ETF");
  }

  const code = normalizeCode(tokens[0]);
  const quantity = toNumber(tokens[1]);
  const avgCost = toNumber(tokens[2]);
  const name = normalizeAssetName(tokens.slice(3).join(" "));

  if (!code) {
    throw new Error("持仓代码无效。示例: /market add 510300 100 4.12 沪深300ETF");
  }

  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("持仓数量必须是大于 0 的数字。示例: /market add 510300 100 4.12");
  }

  if (!Number.isFinite(avgCost) || avgCost < 0) {
    throw new Error("持仓成本必须是大于等于 0 的数字。示例: /market add 510300 100 4.12");
  }

  return {
    code,
    name,
    quantity: round(quantity, 4),
    avgCost: round(avgCost, 4)
  };
}

function detectPhaseFromText(text) {
  const source = String(text || "").trim().toLowerCase();
  if (!source) return null;

  if (
    source.includes("midday") ||
    source.includes("盘中") ||
    source.includes("午盘") ||
    source.includes("13:30")
  ) {
    return "midday";
  }

  if (
    source.includes("close") ||
    source.includes("收盘") ||
    source.includes("盘后") ||
    source.includes("15:15")
  ) {
    return "close";
  }

  return null;
}

function inferPhaseFromLocalTime() {
  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();

  if (hour > 15 || (hour === 15 && minute >= 15)) {
    return "close";
  }

  return "midday";
}

async function runAnalysis(phase, withExplanation) {
  const portfolio = readPortfolio();
  const analysisConfig = readAnalysisConfig();
  const assetCodes = Array.from(new Set(portfolio.funds.map((item) => item.code)));
  const indexCodes = resolveIndexCodes();

  const marketData = await fetchMarketData({
    assetCodes,
    indexCodes
  });

  const featureLayer = calculateFeatureLayer(marketData);
  const signalResult = executeRuleEngine({
    phase,
    portfolio,
    marketData,
    featureLayer
  });

  const optionalNewsContext = await fetchOptionalNewsContext();

  let explanation = null;
  if (withExplanation && isExplanationEnabled()) {
    try {
      explanation = await generateExplanationByProvider(
        signalResult,
        optionalNewsContext,
        analysisConfig
      );
    } catch (error) {
      explanation = {
        summary: "",
        error: (error && error.message) ? error.message : String(error || "unknown error"),
        generatedAt: new Date().toISOString(),
        provider: analysisConfig.analysisEngine
      };
    }
  }

  const persisted = persistRun({
    phase,
    portfolio,
    marketData,
    signalResult,
    explanation,
    optionalNewsContext
  });

  return {
    phase,
    portfolio,
    marketData,
    signalResult,
    explanation,
    persisted
  };
}

async function fetchMarketData(input) {
  const indexCodes = Array.isArray(input.indexCodes) ? input.indexCodes : [];
  const assetCodes = Array.isArray(input.assetCodes) ? input.assetCodes : [];

  const indices = {};
  const assets = {};
  const raw = {
    indices: {},
    assets: {}
  };

  await Promise.all(
    indexCodes.map(async (code) => {
      try {
        const snapshot = await fetchSecuritySnapshot(code, "index");
        indices[code] = snapshot.normalized;
        raw.indices[code] = snapshot.raw;
      } catch (error) {
        raw.indices[code] = {
          error: (error && error.message) ? error.message : String(error || "unknown error")
        };
      }
    })
  );

  await Promise.all(
    assetCodes.map(async (code) => {
      try {
        const snapshot = await fetchSecuritySnapshot(code, "asset");
        assets[code] = snapshot.normalized;
        raw.assets[code] = snapshot.raw;
      } catch (error) {
        raw.assets[code] = {
          error: (error && error.message) ? error.message : String(error || "unknown error")
        };
      }
    })
  );

  return {
    fetchedAt: new Date().toISOString(),
    indices,
    assets,
    raw
  };
}

async function fetchSecuritySnapshot(code, kind) {
  const secid = toSecId(code, kind);
  if (!secid) {
    throw new Error(`Unable to infer secid for code: ${code}`);
  }

  const [quotePayload, historyPayload] = await Promise.all([
    fetchQuote(secid),
    fetchHistory(secid)
  ]);

  const normalized = normalizeSecurityData(code, quotePayload, historyPayload);

  if (!Number.isFinite(normalized.prevClose) || normalized.prevClose <= 0) {
    if (normalized.history.length >= 2) {
      normalized.prevClose = normalized.history[normalized.history.length - 2];
    } else {
      normalized.prevClose = normalized.price;
    }
  }

  if (!Number.isFinite(normalized.price) || normalized.price <= 0) {
    if (normalized.history.length > 0) {
      normalized.price = normalized.history[normalized.history.length - 1];
    } else {
      normalized.price = normalized.prevClose;
    }
  }

  const latestHistoryPrice = normalized.history.length > 0
    ? normalized.history[normalized.history.length - 1]
    : NaN;

  if (
    Number.isFinite(normalized.price) &&
    normalized.price > 0 &&
    (!Number.isFinite(latestHistoryPrice) || Math.abs(latestHistoryPrice - normalized.price) > 0.0001)
  ) {
    normalized.history = normalized.history.concat([normalized.price]).slice(-HISTORY_LIMIT);
  }

  const hasValidPrice = Number.isFinite(normalized.price) && normalized.price > 0;
  if (!hasValidPrice && normalized.history.length === 0) {
    throw new Error(`no usable market data for code ${code}`);
  }

  return {
    normalized,
    raw: {
      secid,
      quote: compactQuotePayload(quotePayload),
      history: compactHistoryPayload(historyPayload)
    }
  };
}

async function fetchQuote(secid) {
  const url = new URL("https://push2.eastmoney.com/api/qt/stock/get");
  url.searchParams.set("secid", secid);
  url.searchParams.set("fields", "f57,f58,f43,f60,f47,f170,f169");
  return fetchJson(url.toString(), DEFAULT_TIMEOUT_MS);
}

async function fetchHistory(secid) {
  const url = new URL("https://push2his.eastmoney.com/api/qt/stock/kline/get");
  url.searchParams.set("secid", secid);
  url.searchParams.set("klt", "101");
  url.searchParams.set("fqt", "1");
  url.searchParams.set("lmt", String(HISTORY_LIMIT));
  url.searchParams.set("end", "20500101");
  url.searchParams.set("fields1", "f1,f2,f3,f4,f5,f6");
  url.searchParams.set("fields2", "f51,f52,f53,f54,f55,f56,f57,f58");
  return fetchJson(url.toString(), DEFAULT_TIMEOUT_MS);
}

function normalizeSecurityData(code, quotePayload, historyPayload) {
  const quote = (quotePayload && quotePayload.data && typeof quotePayload.data === "object")
    ? quotePayload.data
    : {};

  const klines = historyPayload && historyPayload.data && Array.isArray(historyPayload.data.klines)
    ? historyPayload.data.klines
    : [];

  const history = [];
  const volumeHistory = [];

  for (const item of klines) {
    if (typeof item !== "string") {
      continue;
    }

    const parts = item.split(",");
    if (parts.length < 6) {
      continue;
    }

    const close = toNumber(parts[2]);
    const volume = toNumber(parts[5]);

    if (Number.isFinite(close) && close > 0) {
      history.push(round(close, 4));
    }
    if (Number.isFinite(volume) && volume >= 0) {
      volumeHistory.push(round(volume, 4));
    }
  }

  return {
    code,
    name: typeof quote.f58 === "string" ? quote.f58 : "",
    price: normalizePrice(quote.f43),
    prevClose: normalizePrice(quote.f60),
    volume: normalizeVolume(quote.f47),
    history,
    volumeHistory: volumeHistory.slice(-HISTORY_LIMIT)
  };
}

function compactQuotePayload(payload) {
  const data = payload && payload.data && typeof payload.data === "object"
    ? payload.data
    : {};

  return {
    code: String(data.f57 || ""),
    name: String(data.f58 || ""),
    price: normalizePrice(data.f43),
    prevClose: normalizePrice(data.f60),
    volume: normalizeVolume(data.f47),
    pctChange: normalizePercent(data.f170)
  };
}

function compactHistoryPayload(payload) {
  const data = payload && payload.data && typeof payload.data === "object"
    ? payload.data
    : {};
  const klines = Array.isArray(data.klines) ? data.klines : [];

  const points = klines.slice(-30).map((item) => {
    if (typeof item !== "string") {
      return null;
    }
    const parts = item.split(",");
    if (parts.length < 6) {
      return null;
    }
    return {
      date: parts[0],
      close: toNumber(parts[2]),
      volume: toNumber(parts[5])
    };
  }).filter(Boolean);

  return {
    points
  };
}

function calculateFeatureLayer(marketData) {
  const indices = {};
  const assets = {};

  for (const [code, snapshot] of Object.entries(marketData.indices || {})) {
    indices[code] = calculateMetrics(snapshot);
  }

  for (const [code, snapshot] of Object.entries(marketData.assets || {})) {
    assets[code] = calculateMetrics(snapshot);
  }

  return { indices, assets };
}

function calculateMetrics(snapshot) {
  const history = Array.isArray(snapshot.history) ? snapshot.history.slice() : [];
  const volumeHistory = Array.isArray(snapshot.volumeHistory) ? snapshot.volumeHistory.slice() : [];

  const price = safeNumber(snapshot.price);
  const prevClose = safeNumber(snapshot.prevClose);
  const volume = Math.max(0, safeNumber(snapshot.volume));

  const ma5 = movingAverage(history, 5);
  const ma10 = movingAverage(history, 10);
  const ma20 = movingAverage(history, 20);

  const pctChange = prevClose > 0
    ? round(((price - prevClose) / prevClose) * 100, 4)
    : 0;

  const referenceVolume = average(volumeHistory.slice(-5));
  const volumeChangeRate = referenceVolume > 0
    ? round(((volume - referenceVolume) / referenceVolume) * 100, 4)
    : 0;

  return {
    price: round(price, 4),
    prevClose: round(prevClose, 4),
    volume: round(volume, 4),
    ma5,
    ma10,
    ma20,
    pctChange,
    volumeChangeRate
  };
}

function executeRuleEngine(input) {
  const phase = input.phase;
  const portfolio = input.portfolio;
  const marketData = input.marketData;
  const marketAssets = marketData && typeof marketData === "object" && marketData.assets && typeof marketData.assets === "object"
    ? marketData.assets
    : {};
  const featureLayer = input.featureLayer;

  const benchmarkCode = chooseBenchmarkCode(featureLayer.indices);
  const benchmarkMetrics = benchmarkCode ? featureLayer.indices[benchmarkCode] : null;

  const marketState = evaluateMarketState(benchmarkMetrics);

  const assetSignals = [];
  for (const holding of portfolio.funds) {
    const marketAsset = marketAssets[holding.code] || null;
    const name = normalizeAssetName(holding.name) || normalizeAssetName(marketAsset && marketAsset.name);
    const metrics = featureLayer.assets[holding.code] || null;
    if (!metrics) {
      assetSignals.push({
        code: holding.code,
        name,
        signal: "DATA_MISSING",
        metrics: {
          ma5: null,
          ma10: null,
          ma20: null,
          pctChange: null,
          volumeChangeRate: null,
          price: null,
          prevClose: null,
          quantity: holding.quantity,
          avgCost: holding.avgCost,
          positionPnLPct: null
        }
      });
      continue;
    }

    const signal = evaluateAssetSignal(phase, metrics);
    const positionPnLPct = holding.avgCost > 0
      ? round(((metrics.price - holding.avgCost) / holding.avgCost) * 100, 4)
      : 0;

    assetSignals.push({
      code: holding.code,
      name,
      signal,
      metrics: {
        ma5: metrics.ma5,
        ma10: metrics.ma10,
        ma20: metrics.ma20,
        pctChange: metrics.pctChange,
        volumeChangeRate: metrics.volumeChangeRate,
        price: metrics.price,
        prevClose: metrics.prevClose,
        quantity: holding.quantity,
        avgCost: holding.avgCost,
        positionPnLPct
      }
    });
  }

  return {
    phase,
    marketState,
    benchmark: benchmarkCode || "",
    generatedAt: new Date().toISOString(),
    assetSignals
  };
}

function evaluateMarketState(metrics) {
  if (!metrics) {
    return "MARKET_NEUTRAL";
  }

  if (isFiniteNumber(metrics.ma20) && metrics.price < metrics.ma20) {
    return "MARKET_WEAK";
  }

  if (
    isFiniteNumber(metrics.ma5) &&
    isFiniteNumber(metrics.ma10) &&
    isFiniteNumber(metrics.ma20) &&
    metrics.ma5 > metrics.ma10 &&
    metrics.price > metrics.ma20
  ) {
    return "MARKET_STRONG";
  }

  return "MARKET_NEUTRAL";
}

function evaluateAssetSignal(phase, metrics) {
  if (phase === "midday") {
    if (metrics.price < metrics.prevClose && metrics.volumeChangeRate > 0) {
      return "INTRADAY_WEAK";
    }
    if (metrics.price > metrics.prevClose) {
      return "INTRADAY_STABLE";
    }
    return "INTRADAY_NEUTRAL";
  }

  if (!isFiniteNumber(metrics.ma20)) {
    return "TREND_NEUTRAL";
  }

  if (metrics.price < metrics.ma20) {
    return "TREND_WEAK";
  }

  if (
    metrics.price > metrics.ma20 &&
    isFiniteNumber(metrics.ma5) &&
    isFiniteNumber(metrics.ma10) &&
    metrics.ma5 > metrics.ma10
  ) {
    return "TREND_UP";
  }

  return "TREND_NEUTRAL";
}

async function fetchOptionalNewsContext() {
  const staticNews = String(process.env.MARKET_ANALYSIS_NEWS_CONTEXT || "").trim();
  if (staticNews) {
    return { source: "env", content: staticNews };
  }

  const endpoint = String(process.env.MARKET_ANALYSIS_NEWS_API || "").trim();
  if (!endpoint) {
    return null;
  }

  try {
    const payload = await fetchJson(endpoint, DEFAULT_TIMEOUT_MS);
    return {
      source: endpoint,
      content: payload
    };
  } catch (error) {
    return {
      source: endpoint,
      error: (error && error.message) ? error.message : String(error || "unknown error")
    };
  }
}

function isExplanationEnabled() {
  const flag = String(process.env.MARKET_ANALYSIS_LLM_ENABLED || "true").trim().toLowerCase();
  return flag !== "false" && flag !== "0";
}

async function generateExplanationByProvider(signalResult, optionalNewsContext, analysisConfig) {
  const config = normalizeAnalysisConfig(analysisConfig);
  if (config.analysisEngine === "gpt_plugin") {
    return generateExplanationViaGptPlugin(signalResult, optionalNewsContext, config);
  }
  return generateExplanationViaLocalModel(signalResult, optionalNewsContext);
}

async function generateExplanationViaLocalModel(signalResult, optionalNewsContext) {
  const baseUrl = String(process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
  const model = String(process.env.MARKET_ANALYSIS_LLM_MODEL || process.env.OLLAMA_MODEL || "").trim();
  const timeoutMs = parsePositiveInteger(process.env.MARKET_ANALYSIS_LLM_TIMEOUT_MS, 15000);

  if (!model) {
    throw new Error("missing model for explanation");
  }

  const payload = await fetchJson(`${baseUrl}/api/chat`, timeoutMs, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        {
          role: "system",
          content: [
            "你是A股持仓分析助手，给用户直接可执行的中文建议。",
            "必须严格保持给定 signalResult 原样，不得更改任何信号，不得新增/删除决策，不得改变风险等级。",
            "写作风格要求：自然、具体、克制；禁止套话和机器人口吻，例如“根据以上分析”“综合来看”“仅供参考请谨慎”等空泛词。",
            "必须覆盖每个 assetSignals 持仓项，并且逐项给出：1) 股票名称与代码 2) 输入关键数据 3) 短期建议 4) 长期建议。",
            "输入关键数据至少包含可用字段：price/pctChange/ma5/ma10/ma20/volumeChangeRate/quantity/avgCost/positionPnLPct；缺失字段必须写“数据缺失”。",
            "短期建议定义为1-5个交易日，长期建议定义为1-3个月；建议必须明确为“增持/减持/持有(或观望)”之一，并附一句理由。",
            "允许额外给出 1-3 条组合层面的“参考建议”，且不能与既有 signalResult 冲突。",
            "请只输出 JSON，不要 markdown，不要额外说明，格式如下：",
            "{\"summary\":\"整体结论，2-4句\",\"holdings\":[{\"code\":\"600519\",\"name\":\"贵州茅台\",\"input_data\":\"price=..., pctChange=..., ma5=..., ma10=..., ma20=..., volumeChangeRate=..., quantity=..., avgCost=..., positionPnLPct=...\",\"short_term_advice\":\"增持/减持/持有 + 一句理由\",\"long_term_advice\":\"增持/减持/持有 + 一句理由\"}],\"suggestions\":[\"参考建议1\",\"参考建议2\"]}"
          ].join("\n")
        },
        {
          role: "user",
          content: JSON.stringify({
            signalResult,
            optionalNewsContext: optionalNewsContext || null
          })
        }
      ]
    })
  });

  const content = payload
    && payload.message
    && typeof payload.message === "object"
    && typeof payload.message.content === "string"
      ? payload.message.content
      : (typeof payload.response === "string" ? payload.response : "");
  const parsed = normalizeExplanationOutput(content);

  return {
    summary: parsed.summary,
    suggestions: parsed.suggestions,
    holdings: parsed.holdings,
    model,
    generatedAt: new Date().toISOString(),
    provider: "local"
  };
}

async function generateExplanationViaGptPlugin(_signalResult, _optionalNewsContext, _analysisConfig) {
  const signalResult = _signalResult || {};
  const optionalNewsContext = _optionalNewsContext || null;
  const analysisConfig = normalizeAnalysisConfig(_analysisConfig);
  const timeoutMs = parsePositiveInteger(
    analysisConfig && analysisConfig.gptPlugin && analysisConfig.gptPlugin.timeoutMs,
    DEFAULT_ANALYSIS_CONFIG.gptPlugin.timeoutMs
  );
  const fallbackToLocal = Boolean(
    analysisConfig
    && analysisConfig.gptPlugin
    && analysisConfig.gptPlugin.fallbackToLocal
  );

  const bridgeHandler = chatgptBridge;
  if (!bridgeHandler || typeof bridgeHandler.execute !== "function") {
    const reason = "gpt_plugin bridge execute() is missing";
    if (!fallbackToLocal) {
      throw new Error(reason);
    }
    const localFallback = await generateExplanationViaLocalModel(signalResult, optionalNewsContext);
    return {
      ...localFallback,
      provider: "local",
      fallbackFrom: "gpt_plugin",
      fallbackReason: reason
    };
  }

  const prompt = buildGptPluginExplanationPrompt(signalResult, optionalNewsContext);
  try {
    const response = await withTimeout(
      Promise.resolve(bridgeHandler.execute(prompt)),
      timeoutMs,
      "gpt_plugin request timeout"
    );
    const summary = extractTextFromBridgeResponse(response);
    if (!summary) {
      throw new Error("gpt_plugin returned empty response");
    }
    return {
      summary,
      generatedAt: new Date().toISOString(),
      provider: "gpt_plugin"
    };
  } catch (error) {
    const detail = (error && error.message) ? error.message : String(error || "unknown error");
    if (!fallbackToLocal) {
      throw new Error(`gpt_plugin failed: ${detail}`);
    }
    const localFallback = await generateExplanationViaLocalModel(signalResult, optionalNewsContext);
    return {
      ...localFallback,
      provider: "local",
      fallbackFrom: "gpt_plugin",
      fallbackReason: `gpt_plugin failed: ${detail}`
    };
  }
}

function buildGptPluginExplanationPrompt(signalResult, optionalNewsContext) {
  return [
    "你是A股持仓分析助手。",
    "必须严格保持给定 signalResult 原样，不得更改任何信号，不得新增/删除决策，不得改变风险等级。",
    "输出自然中文，不要JSON，不要代码块，不要markdown标题。",
    "禁止空话和机器人口吻，例如“根据以上分析”“综合来看”“总体而言”“仅供参考请谨慎”等。",
    "请按以下结构输出：",
    "1) 整体信号结论：1-2句，明确提及 benchmark 与市场状态。",
    "2) 持仓逐项解读：必须覆盖每个 assetSignals 项。每项都要写：股票名称+代码、输入关键数据、短期建议、长期建议。",
    "3) 参考建议：1-3条组合层面的补充建议（可选），不得与既有 signalResult 冲突。",
    "输入关键数据必须优先引用：price/pctChange/ma5/ma10/ma20/volumeChangeRate/quantity/avgCost/positionPnLPct；缺失字段写“数据缺失”。",
    "短期建议定义为1-5个交易日，长期建议定义为1-3个月；建议动作用词必须明确为“增持/减持/持有(或观望)”并给出一句理由。",
    "文案不得编造任何输入中不存在的指标、数值或结论。",
    "输入数据(JSON):",
    JSON.stringify({
      signalResult: signalResult || null,
      optionalNewsContext: optionalNewsContext || null
    })
  ].join("");
}

function extractTextFromBridgeResponse(response) {
  if (typeof response === "string") {
    return response.trim();
  }
  if (!response || typeof response !== "object") {
    return "";
  }
  if (typeof response.text === "string") {
    return response.text.trim();
  }
  if (typeof response.message === "string") {
    return response.message.trim();
  }
  return "";
}

function normalizeExplanationOutput(raw) {
  const text = String(raw || "").trim();
  const parsed = tryParseExplanationJson(text);
  if (parsed) {
    return parsed;
  }

  return {
    summary: text.slice(0, 1200),
    suggestions: extractSuggestionLines(text),
    holdings: []
  };
}

function tryParseExplanationJson(rawText) {
  const text = String(rawText || "").trim();
  if (!text) {
    return {
      summary: "",
      suggestions: [],
      holdings: []
    };
  }

  const candidates = [text, stripJsonCodeFence(text)];
  for (const candidate of candidates) {
    const parsed = parseJsonSafe(candidate);
    if (!parsed || typeof parsed !== "object") {
      continue;
    }
    const summary = typeof parsed.summary === "string"
      ? parsed.summary.trim().slice(0, 1200)
      : "";

    const suggestionsRaw = Array.isArray(parsed.suggestions)
      ? parsed.suggestions
      : Array.isArray(parsed.advice)
        ? parsed.advice
        : Array.isArray(parsed.recommendations)
          ? parsed.recommendations
          : Array.isArray(parsed.actions)
            ? parsed.actions
            : [];
    const suggestions = suggestionsRaw
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .slice(0, 3);
    const holdingsRaw = Array.isArray(parsed.holdings)
      ? parsed.holdings
      : Array.isArray(parsed.positions)
        ? parsed.positions
        : Array.isArray(parsed.assets)
          ? parsed.assets
          : [];
    const holdings = normalizeExplanationHoldings(holdingsRaw);

    if (!summary && suggestions.length === 0 && holdings.length === 0) {
      continue;
    }
    return {
      summary,
      suggestions,
      holdings
    };
  }

  return null;
}

function normalizeExplanationHoldings(input) {
  const rows = Array.isArray(input) ? input : [];
  const out = [];

  for (const row of rows) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const item = row;
    const code = String(item.code || item.symbol || "").trim().slice(0, 16);
    const name = String(item.name || item.stock_name || item.asset_name || "").trim().slice(0, 64);
    const inputData = String(
      item.input_data
      || item.inputData
      || item.key_data
      || item.keyData
      || item.metrics
      || ""
    ).trim().slice(0, 500);
    const shortTermAdvice = String(
      item.short_term_advice
      || item.shortTermAdvice
      || item.short_term
      || item.shortTerm
      || ""
    ).trim().slice(0, 240);
    const longTermAdvice = String(
      item.long_term_advice
      || item.longTermAdvice
      || item.long_term
      || item.longTerm
      || ""
    ).trim().slice(0, 240);

    if (!code && !name && !shortTermAdvice && !longTermAdvice) {
      continue;
    }

    out.push({
      code,
      name,
      inputData,
      shortTermAdvice,
      longTermAdvice
    });
  }

  return out.slice(0, 24);
}

function stripJsonCodeFence(text) {
  const trimmed = String(text || "").trim();
  const matched = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (!matched || !matched[1]) {
    return trimmed;
  }
  return matched[1].trim();
}

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch (_error) {
    return null;
  }
}

function extractSuggestionLines(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const suggestions = [];
  for (const line of lines) {
    if (
      /^[-*•]\s+/.test(line)
      || /^\d+[.)、]\s+/.test(line)
      || /^(建议|建议举措|建议动作|action|advice)[:：]/i.test(line)
    ) {
      suggestions.push(line.replace(/^[-*•]\s+/, "").replace(/^\d+[.)、]\s+/, "").trim());
    }
    if (suggestions.length >= 3) {
      break;
    }
  }
  return suggestions;
}

async function withTimeout(task, timeoutMs, message) {
  let timer = null;
  try {
    return await Promise.race([
      Promise.resolve(task),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(message || `timeout after ${timeoutMs}ms`));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function persistRun(input) {
  ensureStorage();

  const now = new Date();
  const timestamp = now.toISOString();
  const id = `market-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`;

  const run = {
    id,
    createdAt: timestamp,
    phase: input.phase,
    portfolioSnapshot: input.portfolio,
    marketSnapshot: input.marketData,
    signalResult: input.signalResult,
    explanation: input.explanation,
    optionalNewsContext: input.optionalNewsContext
  };

  const runsStore = readRunsStore();
  runsStore.runs[id] = run;
  runsStore.runs = pruneRunsByCreatedAt(runsStore.runs, 120);
  setStore(MARKET_RUNS_STORE, runsStore);

  const summary = summarizeRun(run);

  const state = readState();
  state.latestRunId = id;
  state.latestByPhase = state.latestByPhase || { midday: null, close: null };
  state.latestByPhase[input.phase] = {
    id,
    createdAt: timestamp
  };
  state.recentRuns = [summary]
    .concat(Array.isArray(state.recentRuns) ? state.recentRuns : [])
    .filter((item, idx, arr) => {
      if (!item || typeof item !== "object") return false;
      const runId = String(item.id || "");
      if (!runId) return false;
      return arr.findIndex((candidate) => candidate && candidate.id === runId) === idx;
    })
    .slice(0, 80);
  state.updatedAt = timestamp;

  setStore(MARKET_STATE_STORE, state);

  return {
    id,
    createdAt: timestamp,
    summary
  };
}

function summarizeRun(run) {
  const signals = Array.isArray(run.signalResult && run.signalResult.assetSignals)
    ? run.signalResult.assetSignals
    : [];

  return {
    id: run.id,
    createdAt: run.createdAt,
    phase: run.phase,
    marketState: run.signalResult ? run.signalResult.marketState : "",
    benchmark: run.signalResult ? run.signalResult.benchmark : "",
    assetSignalCount: signals.length,
    signals: signals.slice(0, 8).map((item) => ({
      code: item.code,
      signal: item.signal
    })),
    explanationSummary: run.explanation && typeof run.explanation.summary === "string"
      ? run.explanation.summary
      : ""
  };
}

function readPortfolio() {
  ensureStorage();
  const parsed = getStore(MARKET_PORTFOLIO_STORE);
  const normalized = normalizePortfolio(parsed);
  return normalized;
}

function addPortfolioHolding(holdingInput) {
  ensureStorage();

  const code = normalizeCode(holdingInput && holdingInput.code);
  const quantity = toNumber(holdingInput && holdingInput.quantity);
  const avgCost = toNumber(holdingInput && holdingInput.avgCost);
  const name = normalizeAssetName(holdingInput && holdingInput.name);

  if (!code) {
    throw new Error("持仓代码无效。");
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("持仓数量必须是大于 0 的数字。");
  }
  if (!Number.isFinite(avgCost) || avgCost < 0) {
    throw new Error("持仓成本必须是大于等于 0 的数字。");
  }

  const portfolio = readPortfolio();
  const funds = Array.isArray(portfolio.funds) ? portfolio.funds.slice() : [];
  const index = funds.findIndex((item) => item && item.code === code);

  let action = "added";
  let updatedHolding = null;

  if (index >= 0) {
    const existing = funds[index];
    const existingQuantity = Math.max(0, toNumber(existing.quantity));
    const existingAvgCost = Math.max(0, toNumber(existing.avgCost));
    const nextQuantity = round(existingQuantity + quantity, 4);
    const nextAvgCost = nextQuantity > 0
      ? round(((existingQuantity * existingAvgCost) + (quantity * avgCost)) / nextQuantity, 4)
      : round(avgCost, 4);

    updatedHolding = {
      code,
      name: name || normalizeAssetName(existing.name),
      quantity: nextQuantity,
      avgCost: nextAvgCost
    };
    funds[index] = updatedHolding;
    action = "updated";
  } else {
    updatedHolding = {
      code,
      name,
      quantity: round(quantity, 4),
      avgCost: round(avgCost, 4)
    };
    funds.push(updatedHolding);
  }

  const nextPortfolio = normalizePortfolio({
    ...portfolio,
    funds
  });
  setStore(MARKET_PORTFOLIO_STORE, nextPortfolio);

  const normalizedHolding = nextPortfolio.funds.find((item) => item.code === code) || updatedHolding;
  return {
    action,
    holding: normalizedHolding,
    portfolio: nextPortfolio
  };
}

function readAnalysisConfig() {
  ensureStorage();
  const parsed = getStore(MARKET_CONFIG_STORE);
  const normalized = normalizeAnalysisConfig(parsed);
  return normalized;
}

function readState() {
  ensureStorage();
  const parsed = getStore(MARKET_STATE_STORE);
  if (!parsed || typeof parsed !== "object") {
    return buildDefaultState();
  }
  return {
    version: 1,
    latestRunId: typeof parsed.latestRunId === "string" ? parsed.latestRunId : "",
    latestByPhase: {
      midday: parsed.latestByPhase && parsed.latestByPhase.midday ? parsed.latestByPhase.midday : null,
      close: parsed.latestByPhase && parsed.latestByPhase.close ? parsed.latestByPhase.close : null
    },
    recentRuns: Array.isArray(parsed.recentRuns) ? parsed.recentRuns : [],
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : ""
  };
}

function readRunsStore() {
  ensureStorage();
  const parsed = getStore(MARKET_RUNS_STORE);
  if (!parsed || typeof parsed !== "object") {
    return buildDefaultRunsStore();
  }
  const runs = parsed.runs && typeof parsed.runs === "object"
    ? parsed.runs
    : {};
  return {
    version: 1,
    runs
  };
}

function pruneRunsByCreatedAt(input, maxSize) {
  const entries = Object.entries(input || {});
  entries.sort((left, right) => {
    const leftRun = left[1] && typeof left[1] === "object" ? left[1] : {};
    const rightRun = right[1] && typeof right[1] === "object" ? right[1] : {};
    const leftTime = Date.parse(leftRun.createdAt || "");
    const rightTime = Date.parse(rightRun.createdAt || "");
    return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
  });

  const next = {};
  for (const [runId, run] of entries.slice(0, Math.max(1, maxSize))) {
    next[runId] = run;
  }
  return next;
}

function normalizePortfolio(input) {
  const funds = [];
  const rawFunds = input && Array.isArray(input.funds) ? input.funds : [];

  for (const item of rawFunds) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const code = normalizeCode(item.code);
    const name = normalizeAssetName(item.name);
    const quantity = toNumber(item.quantity);
    const avgCost = toNumber(item.avgCost);

    if (!code || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(avgCost) || avgCost < 0) {
      continue;
    }

    funds.push({
      code,
      name,
      quantity: round(quantity, 4),
      avgCost: round(avgCost, 4)
    });
  }

  const dedup = new Map();
  for (const item of funds) {
    dedup.set(item.code, item);
  }

  const cash = Math.max(0, round(toNumber(input && input.cash), 4));

  return {
    funds: Array.from(dedup.values()),
    cash
  };
}

function normalizeAnalysisConfig(input) {
  const source = (input && typeof input === "object") ? input : {};
  const engineRaw = typeof source.analysisEngine === "string"
    ? source.analysisEngine.trim().toLowerCase()
    : "";
  const analysisEngine = engineRaw === "gpt_plugin" ? "gpt_plugin" : "local";

  const gptPlugin = source.gptPlugin && typeof source.gptPlugin === "object"
    ? source.gptPlugin
    : {};
  const timeoutMs = parsePositiveInteger(gptPlugin.timeoutMs, DEFAULT_ANALYSIS_CONFIG.gptPlugin.timeoutMs);
  const fallbackFlag = String(gptPlugin.fallbackToLocal ?? DEFAULT_ANALYSIS_CONFIG.gptPlugin.fallbackToLocal)
    .trim()
    .toLowerCase();
  const fallbackToLocal = !(fallbackFlag === "false" || fallbackFlag === "0" || fallbackFlag === "off");

  return {
    version: 1,
    analysisEngine,
    gptPlugin: {
      timeoutMs,
      fallbackToLocal
    }
  };
}

function resolveIndexCodes() {
  const envCodes = String(process.env.MARKET_ANALYSIS_INDEX_CODES || "").trim();
  const rawCodes = envCodes ? envCodes.split(",") : DEFAULT_INDEX_CODES;

  const normalized = [];
  for (const raw of rawCodes) {
    const code = normalizeCode(raw);
    if (!code) continue;
    if (!normalized.includes(code)) {
      normalized.push(code);
    }
  }

  return normalized.length > 0 ? normalized : DEFAULT_INDEX_CODES.slice();
}

function chooseBenchmarkCode(indicesMetrics) {
  const available = Object.keys(indicesMetrics || {});
  if (available.length === 0) {
    return "";
  }

  if (available.includes("000300")) {
    return "000300";
  }

  if (available.includes("000001")) {
    return "000001";
  }

  return available.sort()[0];
}

function formatPortfolio(portfolio) {
  const lines = [
    "Market Analysis 持仓配置",
    `现金: ${formatNumber(portfolio.cash)}`
  ];

  if (portfolio.funds.length === 0) {
    lines.push("持仓: (空)");
    lines.push(`持仓存储键: ${MARKET_PORTFOLIO_STORE}`);
    return lines.join("\n");
  }

  lines.push("持仓:");
  for (const item of portfolio.funds) {
    lines.push(`- ${item.code} | quantity=${formatNumber(item.quantity)} | avgCost=${formatNumber(item.avgCost)}`);
  }
  lines.push(`持仓存储键: ${MARKET_PORTFOLIO_STORE}`);

  return lines.join("\n");
}

function formatPortfolioAddResult(result) {
  const holding = result && result.holding ? result.holding : {};
  const actionText = result && result.action === "updated" ? "持仓已更新。" : "持仓已新增。";
  const holdingLabel = holding.name ? `${holding.code} (${holding.name})` : `${holding.code || "-"}`;

  return [
    actionText,
    `标的: ${holdingLabel}`,
    `数量: ${formatNumber(holding.quantity)}`,
    `平均成本: ${formatNumber(holding.avgCost)}`,
    "",
    formatPortfolio(result.portfolio || { funds: [], cash: 0 })
  ].join("\n");
}

function formatStatus(state) {
  const recent = Array.isArray(state.recentRuns) ? state.recentRuns : [];
  if (recent.length === 0) {
    return [
      "尚无 Market Analysis 运行记录。",
      `运行状态存储键: ${MARKET_STATE_STORE}`
    ].join("\n");
  }

  const latest = recent[0];
  const lines = [
    "Market Analysis 最近状态",
    `最近运行: ${latest.createdAt || "-"}`,
    `阶段: ${phaseLabel(latest.phase)}`,
    `市场状态: ${latest.marketState || "-"}`,
    `基准指数: ${latest.benchmark || "-"}`,
    `资产信号数: ${latest.assetSignalCount || 0}`
  ];

  if (latest.explanationSummary) {
    lines.push(`解释: ${latest.explanationSummary}`);
  }

  return lines.join("\n");
}

function buildRunResponseText(result) {
  const signalResult = result.signalResult;
  const lines = [
    `Market Analysis ${phaseLabel(signalResult.phase)} 完成`,
    `市场状态: ${signalResult.marketState}${signalResult.benchmark ? ` (${signalResult.benchmark})` : ""}`
  ];

  if (Array.isArray(signalResult.assetSignals) && signalResult.assetSignals.length > 0) {
    lines.push("资产信号:");
    for (const signal of signalResult.assetSignals) {
      lines.push(`- ${signal.code}: ${signal.signal}`);
    }
  } else {
    lines.push("资产信号: 无持仓或无可用资产数据");
  }

  if (result.explanation && result.explanation.summary) {
    lines.push(`解释: ${result.explanation.summary}`);
  }

  if (result.explanation && Array.isArray(result.explanation.holdings) && result.explanation.holdings.length > 0) {
    lines.push("持仓逐项建议:");
    for (const holding of result.explanation.holdings.slice(0, 24)) {
      const code = String(holding.code || "").trim();
      const name = String(holding.name || "").trim();
      const label = name && code ? `${name}(${code})` : (name || code || "-");
      const inputData = String(holding.inputData || "").trim();
      const shortTermAdvice = String(holding.shortTermAdvice || "").trim();
      const longTermAdvice = String(holding.longTermAdvice || "").trim();
      lines.push(`- ${label}`);
      lines.push(`  关键数据: ${inputData || "数据缺失"}`);
      lines.push(`  短期(1-5日): ${shortTermAdvice || "未提供"}`);
      lines.push(`  长期(1-3月): ${longTermAdvice || "未提供"}`);
    }
  }

  if (result.explanation && Array.isArray(result.explanation.suggestions) && result.explanation.suggestions.length > 0) {
    lines.push("参考建议(可不采纳，不改变既有信号):");
    for (const suggestion of result.explanation.suggestions.slice(0, 3)) {
      lines.push(`- ${suggestion}`);
    }
  }

  if (result.explanation && result.explanation.error) {
    lines.push(`解释生成失败: ${result.explanation.error}`);
  }

  return lines.join("\n");
}

function buildHelpText() {
  return [
    "Market Analysis 命令:",
    "/market midday         运行 13:30 盘中分析",
    "/market close          运行 15:15 收盘分析",
    "/market status         查看最近一次运行结果",
    "/market portfolio      查看当前持仓配置",
    "/market add <code> <quantity> <avgCost> [name]    添加/加仓持仓（同 code 自动加权成本）",
    "",
    "配置存储键:",
    `- 持仓: ${MARKET_PORTFOLIO_STORE}`,
    `- 分析配置: ${MARKET_CONFIG_STORE}`,
    `- 状态: ${MARKET_STATE_STORE}`,
    `- 快照明细: ${MARKET_RUNS_STORE}`
  ].join("\n");
}

function buildDefaultState() {
  return {
    version: 1,
    latestRunId: "",
    latestByPhase: {
      midday: null,
      close: null
    },
    recentRuns: [],
    updatedAt: ""
  };
}

function buildDefaultRunsStore() {
  return {
    version: 1,
    runs: {}
  };
}

function ensureStorage() {
  registerStore(MARKET_PORTFOLIO_STORE, () => ({
    funds: [],
    cash: 0
  }));
  registerStore(MARKET_CONFIG_STORE, () => normalizeAnalysisConfig(DEFAULT_ANALYSIS_CONFIG));
  registerStore(MARKET_STATE_STORE, () => buildDefaultState());
  registerStore(MARKET_RUNS_STORE, () => buildDefaultRunsStore());
}

async function fetchJson(url, timeoutMs, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      ...(init || {}),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function toSecId(code, kind) {
  const normalized = normalizeCode(code);
  if (!normalized) {
    return "";
  }

  if (kind === "index") {
    if (SH_INDEX_CODES.has(normalized)) {
      return `1.${normalized}`;
    }
    if (SZ_INDEX_CODES.has(normalized)) {
      return `0.${normalized}`;
    }
  }

  if (normalized.startsWith("6") || normalized.startsWith("5") || normalized.startsWith("9")) {
    return `1.${normalized}`;
  }

  return `0.${normalized}`;
}

function normalizeCode(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length >= 6) {
    return digits.slice(-6);
  }
  return digits.padStart(6, "0");
}

function normalizeAssetName(raw) {
  if (raw === null || raw === undefined) {
    return "";
  }
  return String(raw).trim();
}

function movingAverage(values, period) {
  if (!Array.isArray(values) || values.length < period) {
    return null;
  }
  const slice = values.slice(-period);
  return round(average(slice), 4);
}

function average(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }

  let sum = 0;
  let count = 0;

  for (const item of values) {
    const value = toNumber(item);
    if (!Number.isFinite(value)) continue;
    sum += value;
    count += 1;
  }

  if (count === 0) {
    return 0;
  }

  return sum / count;
}

function normalizePrice(value) {
  const numeric = toNumber(value);
  if (!Number.isFinite(numeric)) {
    return NaN;
  }

  if (Math.abs(numeric) >= 1000000) {
    return round(numeric / 10000, 4);
  }

  if (Math.abs(numeric) >= 1000) {
    return round(numeric / 100, 4);
  }

  return round(numeric, 4);
}

function normalizePercent(value) {
  const numeric = toNumber(value);
  if (!Number.isFinite(numeric)) {
    return NaN;
  }

  if (Math.abs(numeric) >= 1000) {
    return round(numeric / 100, 4);
  }

  return round(numeric, 4);
}

function normalizeVolume(value) {
  const numeric = toNumber(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, round(numeric, 4));
}

function parsePositiveInteger(raw, fallback) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

function toNumber(input) {
  if (typeof input === "number") {
    return input;
  }

  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return NaN;
    return Number(trimmed);
  }

  return Number(input);
}

function safeNumber(input) {
  const value = toNumber(input);
  if (!Number.isFinite(value)) {
    return 0;
  }
  return value;
}

function round(value, digits) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const scale = Math.pow(10, digits);
  return Math.round(value * scale) / scale;
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function formatNumber(value) {
  const numeric = toNumber(value);
  if (!Number.isFinite(numeric)) {
    return "0";
  }
  return String(round(numeric, 4));
}

function phaseLabel(phase) {
  if (phase === "close") {
    return "收盘";
  }
  return "盘中";
}
