// @ts-nocheck
import { executeInNewChat } from "../chatgpt-bridge/service";
import { DEFAULT_ANALYSIS_CONFIG, DEFAULT_TIMEOUT_MS } from "./defaults";
import { normalizeAnalysisConfig } from "./storage";
import { fetchJson, parsePositiveInteger } from "./utils";

export async function fetchOptionalNewsContext() {
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

export function isExplanationEnabled() {
  const flag = String(process.env.MARKET_ANALYSIS_LLM_ENABLED || "true").trim().toLowerCase();
  return flag !== "false" && flag !== "0";
}

export async function generateExplanationByProvider(signalResult, optionalNewsContext, analysisConfig) {
  const config = normalizeAnalysisConfig(analysisConfig);
  if (config.analysisEngine === "gemini") {
    return generateExplanationViaGeminiModel(signalResult, optionalNewsContext);
  }
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

  const prompt = buildGptPluginExplanationPrompt(signalResult, optionalNewsContext);
  try {
    const request = executeInNewChat(prompt);
    const response = await withTimeout(
      Promise.resolve(request),
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

async function generateExplanationViaGeminiModel(signalResult, optionalNewsContext) {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("missing GEMINI_API_KEY");
  }

  const model = String(process.env.MARKET_ANALYSIS_GEMINI_MODEL || process.env.GEMINI_MODEL || "gemini-2.0-flash").trim();
  const timeoutMs = parsePositiveInteger(process.env.MARKET_ANALYSIS_GEMINI_TIMEOUT_MS, 15000);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const payload = await fetchJson(endpoint, timeoutMs, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [
          {
            text: [
              "你是A股持仓分析助手，给用户直接可执行的中文建议。",
              "必须严格保持给定 signalResult 原样，不得更改任何信号，不得新增/删除决策，不得改变风险等级。",
              "请只输出 JSON，不要 markdown，不要额外说明。"
            ].join("\n")
          }
        ]
      },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: JSON.stringify({
                signalResult,
                optionalNewsContext: optionalNewsContext || null
              })
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json"
      }
    })
  });

  const candidates = payload && Array.isArray(payload.candidates) ? payload.candidates : [];
  const first = candidates[0] && typeof candidates[0] === "object" ? candidates[0] : null;
  const content = first && first.content && typeof first.content === "object" ? first.content : null;
  const parts = content && Array.isArray(content.parts) ? content.parts : [];
  const text = parts
    .map((item) => (item && typeof item === "object" && typeof item.text === "string") ? item.text : "")
    .join("\n")
    .trim();

  if (!text) {
    throw new Error("gemini returned empty response");
  }

  const parsed = normalizeExplanationOutput(text);

  return {
    summary: parsed.summary,
    suggestions: parsed.suggestions,
    holdings: parsed.holdings,
    model,
    generatedAt: new Date().toISOString(),
    provider: "gemini"
  };
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
