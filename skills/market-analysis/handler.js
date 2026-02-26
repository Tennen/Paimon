const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..", "..");
const DATA_DIR = path.join(ROOT_DIR, "data", "market-analysis");
const RUNS_DIR = path.join(DATA_DIR, "runs");
const PORTFOLIO_FILE = path.join(DATA_DIR, "portfolio.json");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const STATE_FILE = path.join(DATA_DIR, "state.json");

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

module.exports.directCommands = ["/market"];

module.exports.execute = async function execute(input) {
  ensureStorage();

  const command = parseCommand(input);

  if (command.kind === "help") {
    return { text: buildHelpText() };
  }

  if (command.kind === "portfolio") {
    const portfolio = readPortfolio();
    return { text: formatPortfolio(portfolio) };
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
};

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
            "你是市场分析解释器与建议助手。",
            "必须严格保持给定 signalResult 原样，不得更改任何信号，不得新增/删除决策，不得改变风险等级。",
            "允许基于 signalResult 与可选新闻上下文，给出 1-3 条“可选建议举措”（用户可以不采纳）。",
            "建议必须明确标注为“参考建议”，且不能与既有 signalResult 冲突。",
            "请只输出 JSON，不要 markdown，不要额外字段：",
            "{\"summary\":\"简短中文总结，最多6句话\",\"suggestions\":[\"参考建议1\",\"参考建议2\"]}"
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

  let bridgeHandler = null;
  try {
    bridgeHandler = require(path.join(ROOT_DIR, "skills", "chatgpt-bridge", "handler.js"));
  } catch (error) {
    const detail = (error && error.message) ? error.message : String(error || "unknown error");
    if (!fallbackToLocal) {
      throw new Error(`gpt_plugin bridge unavailable: ${detail}`);
    }
    const localFallback = await generateExplanationViaLocalModel(signalResult, optionalNewsContext);
    return {
      ...localFallback,
      provider: "local",
      fallbackFrom: "gpt_plugin",
      fallbackReason: `gpt_plugin bridge unavailable: ${detail}`
    };
  }

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
    "你是市场分析解释器与建议助手。",
    "必须严格保持给定 signalResult 原样，不得更改任何信号，不得新增/删除决策，不得改变风险等级。",
    "硬约束:summary 必须同时包含“信号结论”和“输入数据依据”,缺一不可。",
    "summary 必须明确提及 benchmark 与 assetSignals,并覆盖每个 assetSignals 项的 code/name/signal。",
    "summary 必须引用可用关键数据:price/changePct/ma5/ma10/ma20/volume/volumeChangeRate;若字段缺失、为空或非数值,必须明确说明“数据缺失/未提供”,不得跳过。",
    "summary 不得编造任何输入中不存在的指标、数值或结论。",
    "允许基于 signalResult 与可选新闻上下文，给出 1-3 条“可选建议举措”（用户可以不采纳）。",
    "建议必须明确标注为“参考建议”，且不能与既有 signalResult 冲突。",
    "请只输出既有 JSON 结构且字段仅允许 summary/suggestions,不要 markdown,不要额外字段：",
    "{\"summary\":\"简短中文总结，最多6句话\",\"suggestions\":[\"参考建议1\",\"参考建议2\"]}",
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
    suggestions: extractSuggestionLines(text)
  };
}

function tryParseExplanationJson(rawText) {
  const text = String(rawText || "").trim();
  if (!text) {
    return {
      summary: "",
      suggestions: []
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

    if (!summary && suggestions.length === 0) {
      continue;
    }
    return {
      summary,
      suggestions
    };
  }

  return null;
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

  const fileName = `${timestamp.replace(/[:.]/g, "-")}_${input.phase}_${id}.json`;
  const runPath = path.join(RUNS_DIR, fileName);
  writeJsonAtomic(runPath, run);

  const summary = summarizeRun(run, fileName);

  const state = readState();
  state.latestRunId = id;
  state.latestByPhase = state.latestByPhase || { midday: null, close: null };
  state.latestByPhase[input.phase] = {
    id,
    createdAt: timestamp,
    file: fileName
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

  writeJsonAtomic(STATE_FILE, state);

  return {
    id,
    file: fileName,
    path: runPath,
    createdAt: timestamp,
    summary
  };
}

function summarizeRun(run, fileName) {
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
      : "",
    file: fileName
  };
}

function readPortfolio() {
  ensureStorage();

  let parsed = null;
  if (fs.existsSync(PORTFOLIO_FILE)) {
    try {
      parsed = JSON.parse(fs.readFileSync(PORTFOLIO_FILE, "utf8"));
    } catch (_error) {
      parsed = null;
    }
  }

  const normalized = normalizePortfolio(parsed);
  if (!fs.existsSync(PORTFOLIO_FILE)) {
    writeJsonAtomic(PORTFOLIO_FILE, normalized);
  }

  return normalized;
}

function readAnalysisConfig() {
  ensureStorage();

  let parsed = null;
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    } catch (_error) {
      parsed = null;
    }
  }

  const normalized = normalizeAnalysisConfig(parsed);
  if (!fs.existsSync(CONFIG_FILE)) {
    writeJsonAtomic(CONFIG_FILE, normalized);
  }

  return normalized;
}

function readState() {
  ensureStorage();

  if (!fs.existsSync(STATE_FILE)) {
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

  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
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
  } catch (_error) {
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
    lines.push(`配置文件: ${PORTFOLIO_FILE}`);
    return lines.join("\n");
  }

  lines.push("持仓:");
  for (const item of portfolio.funds) {
    lines.push(`- ${item.code} | quantity=${formatNumber(item.quantity)} | avgCost=${formatNumber(item.avgCost)}`);
  }
  lines.push(`配置文件: ${PORTFOLIO_FILE}`);

  return lines.join("\n");
}

function formatStatus(state) {
  const recent = Array.isArray(state.recentRuns) ? state.recentRuns : [];
  if (recent.length === 0) {
    return [
      "尚无 Market Analysis 运行记录。",
      `运行后记录会写入: ${RUNS_DIR}`
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

  if (latest.file) {
    lines.push(`快照文件: ${path.join(RUNS_DIR, latest.file)}`);
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
    "",
    "配置文件:",
    `- 持仓: ${PORTFOLIO_FILE}`,
    `- 运行快照目录: ${RUNS_DIR}`
  ].join("\n");
}

function ensureStorage() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(RUNS_DIR, { recursive: true });

  if (!fs.existsSync(PORTFOLIO_FILE)) {
    writeJsonAtomic(PORTFOLIO_FILE, {
      funds: [],
      cash: 0
    });
  }

  if (!fs.existsSync(CONFIG_FILE)) {
    writeJsonAtomic(CONFIG_FILE, DEFAULT_ANALYSIS_CONFIG);
  }

  if (!fs.existsSync(STATE_FILE)) {
    writeJsonAtomic(STATE_FILE, {
      version: 1,
      latestRunId: "",
      latestByPhase: {
        midday: null,
        close: null
      },
      recentRuns: [],
      updatedAt: ""
    });
  }
}

function writeJsonAtomic(filePath, payload) {
  const tempFile = `${filePath}.tmp`;
  fs.writeFileSync(tempFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.renameSync(tempFile, filePath);
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
