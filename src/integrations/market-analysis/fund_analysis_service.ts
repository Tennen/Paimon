import { jsonrepair } from "jsonrepair";
import { createLLMEngine } from "../../engines/llm";
import { buildFundFeatureContext } from "./fund_feature_engine";
import { buildFundSystemPrompt, buildFundUserPrompt } from "./fund_prompt_builder";
import { evaluateFundRules } from "./fund_rule_engine";
import {
  buildFallbackFundDashboard,
  FundDecisionDashboard,
  validateFundDecisionDashboard
} from "./fund_schema";
import { fetchFundNews } from "./search_adapter";
import {
  FundAnalysisOutput,
  FundAuditStep,
  FundFeatureContext,
  FundIdentity,
  FundRawContext,
  FundRiskLevel,
  FundType,
  MarketAnalysisConfig,
  MarketPortfolio,
  MarketPhase,
  StrategyType,
  TradableType
} from "./fund_types";

const DEFAULT_TIMEOUT_MS = 12000;
const SH_INDEX_CODES = new Set(["000001", "000016", "000300", "000688", "000905", "000852"]);
const SZ_INDEX_CODES = new Set(["399001", "399005", "399006", "399102", "399303"]);

export type RunFundAnalysisInput = {
  phase: MarketPhase;
  withExplanation: boolean;
  portfolio: MarketPortfolio;
  analysisConfig: MarketAnalysisConfig;
};

export type RunFundAnalysisOutput = {
  marketData: {
    assetType: "fund";
    generatedAt: string;
    funds: Array<{
      identity: FundIdentity;
      raw_context: FundRawContext;
      feature_context: FundFeatureContext;
      rule_context: ReturnType<typeof evaluateFundRules>;
      raw_llm_text: string;
      llm_provider: string;
      llm_errors: string[];
    }>;
    source_chain: string[];
    errors: string[];
  };
  signalResult: FundAnalysisOutput;
  explanation: {
    summary: string;
    provider: string;
    generatedAt: string;
    dashboards: FundDecisionDashboard[];
    error?: string;
  };
  optionalNewsContext: {
    funds: Array<{
      fund_code: string;
      fund_name: string;
      market_news: FundRawContext["events"]["market_news"];
      source_chain: string[];
      errors: string[];
    }>;
  };
};

export async function runFundAnalysis(input: RunFundAnalysisInput): Promise<RunFundAnalysisOutput> {
  const auditSteps: FundAuditStep[] = [];
  const auditErrors: string[] = [];

  const fundConfig = input.analysisConfig.fund;
  const lookbackDays = clampInt(fundConfig.featureLookbackDays, 30, 365, 120);

  const records: Array<{
    identity: FundIdentity;
    raw: FundRawContext;
    feature: FundFeatureContext;
    rules: ReturnType<typeof evaluateFundRules>;
    dashboard: FundDecisionDashboard;
    rawLlmText: string;
    provider: string;
    llmErrors: string[];
  }> = [];

  for (const holding of input.portfolio.funds) {
    const identity = buildFundIdentity(holding);

    const ingestion = await collectRawContext(identity, {
      lookbackDays,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      accountCash: input.portfolio.cash
    });
    auditSteps.push(ingestion.auditStep);
    if (ingestion.raw.errors.length > 0) {
      auditErrors.push(...ingestion.raw.errors);
    }

    const featureStart = Date.now();
    const feature = buildFundFeatureContext(ingestion.raw);
    auditSteps.push({
      step: `feature:${identity.fund_code}`,
      duration_ms: Date.now() - featureStart,
      source_chain: ["fund_feature_engine"],
      errors: []
    });

    const rulesStart = Date.now();
    const rules = evaluateFundRules({
      raw: ingestion.raw,
      features: feature,
      analysisConfig: input.analysisConfig
    });
    auditSteps.push({
      step: `rule:${identity.fund_code}`,
      duration_ms: Date.now() - rulesStart,
      source_chain: ["fund_rule_engine"],
      errors: []
    });

    const missingFields = inferMissingFields(ingestion.raw, feature);
    const fallbackDashboard = buildFallbackFundDashboard({
      fundCode: identity.fund_code,
      fundName: identity.fund_name,
      asOfDate: ingestion.raw.as_of_date,
      featureCoverage: feature.coverage,
      adjustedScore: rules.rule_adjusted_score,
      ruleFlags: rules.rule_flags,
      blockedActions: rules.blocked_actions,
      insufficient: missingFields.length > 0 || feature.coverage === "insufficient",
      missingFields
    });

    let dashboard = fallbackDashboard;
    let rawLlmText = "";
    let provider = "rule_template";
    const llmErrors: string[] = [];

    if (input.withExplanation) {
      const llmStart = Date.now();
      const llmResult = await generateDashboardWithRetry({
        raw: ingestion.raw,
        feature,
        rules,
        fallbackDashboard,
        analysisConfig: input.analysisConfig
      });
      dashboard = llmResult.dashboard;
      rawLlmText = llmResult.rawText;
      provider = llmResult.provider;
      llmErrors.push(...llmResult.errors);

      auditSteps.push({
        step: `llm:${identity.fund_code}`,
        duration_ms: Date.now() - llmStart,
        source_chain: [provider],
        errors: llmErrors
      });
    }

    const normalizedDashboard = applyRuleAndFeatureOverlay(dashboard, fallbackDashboard, feature, rules);

    records.push({
      identity,
      raw: ingestion.raw,
      feature,
      rules,
      dashboard: normalizedDashboard,
      rawLlmText,
      provider,
      llmErrors
    });
  }

  const generatedAt = new Date().toISOString();
  const benchmark = records.find((item) => item.raw.benchmark_code)?.raw.benchmark_code || "";

  const signalResult: FundAnalysisOutput = {
    phase: input.phase,
    marketState: inferMarketState(records),
    benchmark,
    generatedAt,
    assetSignals: records.map((item) => ({
      code: item.identity.fund_code,
      signal: item.dashboard.decision_type.toUpperCase()
    })),
    assetType: "fund",
    fund_dashboards: records.map((item) => item.dashboard),
    portfolio_report: buildPortfolioReport(records),
    audit: {
      steps: auditSteps,
      errors: dedupStrings(auditErrors)
    }
  };

  const summaryProvider = records.find((item) => item.provider !== "rule_template")?.provider ?? "rule_template";

  return {
    marketData: {
      assetType: "fund",
      generatedAt,
      funds: records.map((item) => ({
        identity: item.identity,
        raw_context: item.raw,
        feature_context: item.feature,
        rule_context: item.rules,
        raw_llm_text: item.rawLlmText,
        llm_provider: item.provider,
        llm_errors: item.llmErrors
      })),
      source_chain: dedupStrings(records.flatMap((item) => item.raw.source_chain)),
      errors: dedupStrings([
        ...auditErrors,
        ...records.flatMap((item) => item.llmErrors)
      ])
    },
    signalResult,
    explanation: {
      summary: signalResult.portfolio_report.brief,
      provider: summaryProvider,
      generatedAt,
      dashboards: records.map((item) => item.dashboard)
    },
    optionalNewsContext: {
      funds: records.map((item) => ({
        fund_code: item.identity.fund_code,
        fund_name: item.identity.fund_name,
        market_news: item.raw.events.market_news,
        source_chain: item.raw.source_chain,
        errors: item.raw.errors
      }))
    }
  };
}

function buildFundIdentity(holding: {
  code: string;
  name: string;
  quantity: number;
  avgCost: number;
}): FundIdentity {
  const fundCode = normalizeCode(holding.code);
  const fundName = String(holding.name || "").trim();

  const fundType = inferFundType(fundCode, fundName);
  const strategyType = inferStrategyType(fundName);
  const tradable = inferTradableType(fundType);
  const market = inferMarket(fundCode, tradable);

  return {
    fund_code: fundCode,
    fund_name: fundName || fundCode,
    market,
    currency: "CNY",
    account_position: {
      quantity: normalizeNumber(holding.quantity, 0),
      avg_cost: normalizeNumber(holding.avgCost, 0)
    },
    fund_type: fundType,
    strategy_type: strategyType,
    tradable,
    source_chain: ["fund_identity:heuristics"],
    errors: fundCode ? [] : ["invalid_fund_code"]
  };
}

async function collectRawContext(
  identity: FundIdentity,
  options: { lookbackDays: number; timeoutMs: number; accountCash: number }
): Promise<{ raw: FundRawContext; auditStep: FundAuditStep }> {
  const start = Date.now();
  const sourceChain: string[] = [];
  const errors: string[] = [];

  const seriesResult = identity.tradable === "intraday"
    ? await fetchExchangeFundSeries(identity.fund_code, options.lookbackDays, options.timeoutMs)
    : await fetchOtcFundSeries(identity.fund_code, options.lookbackDays, options.timeoutMs);

  sourceChain.push(...seriesResult.source_chain);
  errors.push(...seriesResult.errors);

  const benchmarkCode = chooseBenchmarkCode(identity.strategy_type);
  const benchmarkSeries = await fetchBenchmarkSeries(benchmarkCode, options.lookbackDays, options.timeoutMs);
  sourceChain.push(...benchmarkSeries.source_chain);
  errors.push(...benchmarkSeries.errors);

  const news = await fetchFundNews({
    fundCode: identity.fund_code,
    fundName: identity.fund_name,
    timeoutMs: options.timeoutMs,
    maxItems: 8
  });
  sourceChain.push(...news.source_chain);
  errors.push(...news.errors);

  const events = classifyEventsFromNews(news.items);
  const asOfDate = inferAsOfDate(seriesResult.series);

  const raw: FundRawContext = {
    identity,
    as_of_date: asOfDate,
    price_or_nav_series: seriesResult.series,
    benchmark_series: benchmarkSeries.series,
    benchmark_code: benchmarkCode,
    holdings_style: {
      top_holdings: [],
      sector_exposure: {},
      style_factor_exposure: {},
      duration_credit_profile: {}
    },
    events: {
      notices: events.notices,
      manager_changes: events.manager_changes,
      subscription_redemption: events.subscription_redemption,
      regulatory_risks: events.regulatory_risks,
      market_news: news.items
    },
    account_context: {
      current_position: identity.account_position.quantity,
      avg_cost: identity.account_position.avg_cost,
      budget: normalizeNumber(options.accountCash, 0),
      risk_preference: String(process.env.FUND_ACCOUNT_RISK_PREFERENCE || "balanced").trim() || "balanced",
      holding_horizon: String(process.env.FUND_ACCOUNT_HOLDING_HORIZON || "medium_term").trim() || "medium_term"
    },
    source_chain: dedupStrings(sourceChain),
    errors: dedupStrings(errors)
  };

  const auditStep: FundAuditStep = {
    step: `ingestion:${identity.fund_code}`,
    duration_ms: Date.now() - start,
    source_chain: raw.source_chain,
    errors: raw.errors
  };

  return {
    raw,
    auditStep
  };
}

type LlmRetryInput = {
  raw: FundRawContext;
  feature: FundFeatureContext;
  rules: ReturnType<typeof evaluateFundRules>;
  fallbackDashboard: FundDecisionDashboard;
  analysisConfig: MarketAnalysisConfig;
};

async function generateDashboardWithRetry(input: LlmRetryInput): Promise<{
  dashboard: FundDecisionDashboard;
  rawText: string;
  provider: string;
  errors: string[];
}> {
  const retryMax = clampInt(input.analysisConfig.fund.llmRetryMax, 1, 3, 1);
  const providerSelection = normalizeFundLlmProvider(input.analysisConfig.analysisEngine);
  const provider = providerSelection.providerLabel;

  let lastRawText = "";
  const errors: string[] = [];

  for (let attempt = 0; attempt <= retryMax; attempt += 1) {
    const prompt = {
      system: buildFundSystemPrompt(),
      user: buildFundUserPrompt({
        raw: input.raw,
        features: input.feature,
        rules: input.rules
      })
    };

    try {
      const llmResponse = providerSelection.useGemini
        ? await generateWithGemini(prompt.system, prompt.user)
        : await generateWithConfiguredProvider(prompt.system, prompt.user, providerSelection.selector);

      lastRawText = llmResponse.text;
      const parsed = parseDashboardFromText(lastRawText);
      if (!parsed) {
        errors.push(`attempt_${attempt + 1}: invalid_json`);
        continue;
      }

      const validated = validateFundDecisionDashboard(parsed, input.fallbackDashboard);
      if (!validated.isValid) {
        errors.push(`attempt_${attempt + 1}: missing_fields:${validated.missingFields.join(",")}`);
        if (attempt < retryMax) {
          continue;
        }
      }

      return {
        dashboard: validated.dashboard,
        rawText: lastRawText,
        provider: llmResponse.provider || provider,
        errors
      };
    } catch (error) {
      errors.push(`attempt_${attempt + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    dashboard: input.fallbackDashboard,
    rawText: lastRawText,
    provider,
    errors
  };
}

async function generateWithConfiguredProvider(
  systemPrompt: string,
  userPrompt: string,
  selector?: string
): Promise<{ text: string; provider: string }> {
  const llmEngine = createLLMEngine(selector);
  const provider = selector || llmEngine.getProviderName();
  const model = String(
    process.env.MARKET_ANALYSIS_FUND_LOCAL_MODEL
    || process.env.MARKET_ANALYSIS_LLM_MODEL
    || llmEngine.getModelForStep("planning")
    || llmEngine.getModelForStep("routing")
    || ""
  ).trim();
  if (!model) {
    throw new Error("missing local model for fund analysis");
  }

  const timeoutMs = clampInt(Number(process.env.MARKET_ANALYSIS_LLM_TIMEOUT_MS), 5000, 60000, 15000);
  const text = await llmEngine.chat({
    step: "general",
    model,
    timeoutMs,
    ...(llmEngine.getProviderName() === "ollama"
      ? {
          options: {
            temperature: 0.2,
            top_p: 0.9,
            num_predict: 1024
          }
        }
      : {}),
    messages: [
      {
        role: "system",
        content: systemPrompt
      },
      {
        role: "user",
        content: userPrompt
      }
    ]
  });

  if (!text.trim()) {
    throw new Error("local model returned empty text");
  }

  return {
    text,
    provider
  };
}

async function generateWithGemini(systemPrompt: string, userPrompt: string): Promise<{ text: string; provider: string }> {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("missing GEMINI_API_KEY");
  }

  const model = String(process.env.MARKET_ANALYSIS_GEMINI_MODEL || process.env.GEMINI_MODEL || "gemini-2.0-flash").trim();
  const timeoutMs = clampInt(Number(process.env.MARKET_ANALYSIS_GEMINI_TIMEOUT_MS), 5000, 60000, 15000);

  const url = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`);
  url.searchParams.set("key", apiKey);

  const payload = await postJsonWithTimeout(url.toString(), timeoutMs, {
    systemInstruction: {
      parts: [{ text: systemPrompt }]
    },
    contents: [
      {
        role: "user",
        parts: [{ text: userPrompt }]
      }
    ],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json"
    }
  });

  if (!payload || typeof payload !== "object") {
    throw new Error("gemini returned empty payload");
  }

  const source = payload as Record<string, unknown>;
  const candidates = Array.isArray(source.candidates)
    ? source.candidates
    : [];
  const first = candidates[0] && typeof candidates[0] === "object"
    ? (candidates[0] as Record<string, unknown>)
    : null;
  const content = first?.content && typeof first.content === "object"
    ? (first.content as Record<string, unknown>)
    : null;
  const parts = content?.parts && Array.isArray(content.parts)
    ? content.parts
    : [];
  const text = parts
    .map((part) => (part && typeof part === "object" ? (part as Record<string, unknown>).text : ""))
    .filter((item): item is string => typeof item === "string")
    .join("\n")
    .trim();

  if (!text) {
    throw new Error("gemini returned empty text");
  }

  return {
    text,
    provider: "gemini"
  };
}

function parseDashboardFromText(text: string): unknown {
  const normalized = String(text || "").trim();
  if (!normalized) {
    return null;
  }

  const candidates = [
    normalized,
    stripJsonFence(normalized),
    extractFirstJsonObject(normalized)
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    const parsed = parseJsonLoose(candidate);
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  }

  return null;
}

function applyRuleAndFeatureOverlay(
  dashboard: FundDecisionDashboard,
  fallback: FundDecisionDashboard,
  feature: FundFeatureContext,
  rules: ReturnType<typeof evaluateFundRules>
): FundDecisionDashboard {
  const blocked = new Set(rules.blocked_actions.map((item) => item.toLowerCase()));

  const normalizedDecision = blocked.has(dashboard.decision_type)
    ? (rules.hard_blocked ? "watch" : "hold")
    : dashboard.decision_type;

  const missingFields = dedupStrings([
    ...fallback.insufficient_data.missing_fields,
    ...dashboard.insufficient_data.missing_fields
  ]);

  const insufficient = dashboard.insufficient_data.is_insufficient
    || fallback.insufficient_data.is_insufficient
    || feature.coverage === "insufficient";

  const actionSuggestion = normalizedDecision === dashboard.decision_type
    ? dashboard.action_plan.suggestion
    : "规则层存在 blocked_actions，已降级为保守动作。";

  return {
    ...dashboard,
    decision_type: normalizedDecision,
    confidence: clampNumber(Math.min(dashboard.confidence, Math.max(0.2, feature.confidence)), 0, 1),
    risk_alerts: dedupStrings([
      ...dashboard.risk_alerts,
      ...rules.rule_flags
    ]),
    action_plan: {
      ...dashboard.action_plan,
      suggestion: actionSuggestion || fallback.action_plan.suggestion
    },
    data_perspective: {
      return_metrics: {
        ...feature.returns,
        ...dashboard.data_perspective.return_metrics
      },
      risk_metrics: {
        ...feature.risk,
        ...dashboard.data_perspective.risk_metrics
      },
      relative_metrics: {
        ...feature.relative,
        ...dashboard.data_perspective.relative_metrics
      },
      feature_coverage: feature.coverage
    },
    rule_trace: {
      rule_flags: rules.rule_flags,
      blocked_actions: rules.blocked_actions,
      adjusted_score: rules.rule_adjusted_score
    },
    insufficient_data: {
      is_insufficient: insufficient,
      missing_fields: missingFields
    }
  };
}

function buildPortfolioReport(records: Array<{
  identity: FundIdentity;
  dashboard: FundDecisionDashboard;
  rules: ReturnType<typeof evaluateFundRules>;
}>): { brief: string; full: string } {
  if (records.length === 0) {
    return {
      brief: "组合内暂无可分析基金。",
      full: "组合内暂无可分析基金。"
    };
  }

  const decisionCount = new Map<string, number>();
  const riskFlags = new Map<string, number>();

  for (const item of records) {
    decisionCount.set(item.dashboard.decision_type, (decisionCount.get(item.dashboard.decision_type) || 0) + 1);
    for (const flag of item.rules.rule_flags) {
      riskFlags.set(flag, (riskFlags.get(flag) || 0) + 1);
    }
  }

  const decisionSummary = Array.from(decisionCount.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([decision, count]) => `${decision}:${count}`)
    .join(" | ");

  const topRisks = Array.from(riskFlags.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([flag, count]) => `${flag}(${count})`)
    .join("; ");

  const brief = `基金组合结论: ${decisionSummary || "无"}。主要风险: ${topRisks || "无"}。`;

  const fullLines = [
    "基金组合完整报告",
    `- 决策分布: ${decisionSummary || "无"}`,
    `- 主要风险: ${topRisks || "无"}`,
    "- 单基金明细:"
  ];

  for (const item of records) {
    const oneSentence = item.dashboard.core_conclusion.one_sentence || "未提供结论";
    const ruleFlags = item.rules.rule_flags.join(", ") || "none";
    fullLines.push(
      `  - ${item.identity.fund_code} ${item.identity.fund_name}: ${item.dashboard.decision_type}, score=${item.rules.rule_adjusted_score}, flags=${ruleFlags}, conclusion=${oneSentence}`
    );
  }

  return {
    brief,
    full: fullLines.join("\n")
  };
}

function inferMarketState(records: Array<{ feature: FundFeatureContext }>): string {
  if (records.length === 0) {
    return "MARKET_NEUTRAL";
  }

  const values = records
    .map((item) => item.feature.relative.benchmark_excess_20d)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  if (values.length === 0) {
    return "MARKET_NEUTRAL";
  }

  const avgExcess = values.reduce((acc, item) => acc + item, 0) / values.length;

  if (avgExcess >= 1.5) {
    return "MARKET_STRONG";
  }
  if (avgExcess <= -1.5) {
    return "MARKET_WEAK";
  }
  return "MARKET_NEUTRAL";
}

function inferMissingFields(raw: FundRawContext, feature: FundFeatureContext): string[] {
  const missing: string[] = [];

  if (raw.price_or_nav_series.length === 0) {
    missing.push("price_or_nav_series");
  }
  if (raw.benchmark_series.length === 0) {
    missing.push("benchmark_series");
  }
  if (!raw.as_of_date) {
    missing.push("as_of_date");
  }
  if (feature.coverage === "insufficient") {
    missing.push("feature_coverage_insufficient");
  }

  return dedupStrings(missing);
}

function chooseBenchmarkCode(strategy: StrategyType): string {
  if (strategy === "bond") {
    return "000012";
  }
  if (strategy === "money_market") {
    return "000001";
  }
  return "000300";
}

function classifyEventsFromNews(items: FundRawContext["events"]["market_news"]): {
  notices: string[];
  manager_changes: string[];
  subscription_redemption: string[];
  regulatory_risks: string[];
} {
  const notices: string[] = [];
  const managerChanges: string[] = [];
  const subscriptionRedemption: string[] = [];
  const regulatoryRisks: string[] = [];

  for (const item of items) {
    const text = `${item.title} ${item.snippet || ""}`;

    if (/公告|分红|拆分|清盘/.test(text)) {
      notices.push(item.title);
    }
    if (/基金经理|离任|任职|变更/.test(text)) {
      managerChanges.push(item.title);
    }
    if (/限购|限赎|暂停申购|暂停赎回|赎回/.test(text)) {
      subscriptionRedemption.push(item.title);
    }
    if (/监管|处罚|风险提示|警示/.test(text)) {
      regulatoryRisks.push(item.title);
    }
  }

  return {
    notices: dedupStrings(notices),
    manager_changes: dedupStrings(managerChanges),
    subscription_redemption: dedupStrings(subscriptionRedemption),
    regulatory_risks: dedupStrings(regulatoryRisks)
  };
}

async function fetchBenchmarkSeries(code: string, lookbackDays: number, timeoutMs: number): Promise<{
  series: FundRawContext["benchmark_series"];
  source_chain: string[];
  errors: string[];
}> {
  const secid = toSecId(code, "index");
  if (!secid) {
    return {
      series: [],
      source_chain: ["benchmark:secid_missing"],
      errors: ["benchmark secid missing"]
    };
  }

  try {
    const history = await fetchHistoryKline(secid, lookbackDays, timeoutMs);
    return {
      series: history.points,
      source_chain: ["eastmoney:index_history"],
      errors: []
    };
  } catch (error) {
    return {
      series: [],
      source_chain: ["eastmoney:index_history"],
      errors: [error instanceof Error ? error.message : String(error)]
    };
  }
}

async function fetchExchangeFundSeries(code: string, lookbackDays: number, timeoutMs: number): Promise<{
  series: FundRawContext["price_or_nav_series"];
  source_chain: string[];
  errors: string[];
}> {
  const secid = toSecId(code, "fund");
  if (!secid) {
    return {
      series: [],
      source_chain: ["exchange_fund:secid_missing"],
      errors: ["fund secid missing"]
    };
  }

  try {
    const [quote, history] = await Promise.all([
      fetchQuote(secid, timeoutMs),
      fetchHistoryKline(secid, lookbackDays, timeoutMs)
    ]);

    const points = history.points.slice();
    if (Number.isFinite(quote.price) && quote.price > 0) {
      const lastDate = points.length > 0 ? points[points.length - 1].date : todayDate();
      const existsSame = points.length > 0 && Math.abs(points[points.length - 1].value - quote.price) < 0.0001;
      if (!existsSame) {
        points.push({
          date: lastDate,
          value: quote.price,
          ...(Number.isFinite(quote.volume) ? { volume: quote.volume } : {})
        });
      }
    }

    return {
      series: points,
      source_chain: ["eastmoney:fund_quote", "eastmoney:fund_history"],
      errors: []
    };
  } catch (error) {
    return {
      series: [],
      source_chain: ["eastmoney:fund_quote", "eastmoney:fund_history"],
      errors: [error instanceof Error ? error.message : String(error)]
    };
  }
}

async function fetchOtcFundSeries(code: string, lookbackDays: number, timeoutMs: number): Promise<{
  series: FundRawContext["price_or_nav_series"];
  source_chain: string[];
  errors: string[];
}> {
  const url = `https://fund.eastmoney.com/pingzhongdata/${encodeURIComponent(code)}.js?v=${Date.now()}`;

  try {
    const script = await fetchTextWithTimeout(url, timeoutMs);
    const points = parseOtcSeriesFromScript(script).slice(-lookbackDays);
    if (points.length === 0) {
      return {
        series: [],
        source_chain: ["eastmoney:fund_pingzhongdata"],
        errors: ["otc fund series empty"]
      };
    }
    return {
      series: points,
      source_chain: ["eastmoney:fund_pingzhongdata"],
      errors: []
    };
  } catch (error) {
    return {
      series: [],
      source_chain: ["eastmoney:fund_pingzhongdata"],
      errors: [error instanceof Error ? error.message : String(error)]
    };
  }
}

function parseOtcSeriesFromScript(script: string): FundRawContext["price_or_nav_series"] {
  const netWorth = parseScriptVariable(script, "Data_netWorthTrend");
  if (Array.isArray(netWorth) && netWorth.length > 0) {
    const points = netWorth
      .map((item) => {
        if (!item || typeof item !== "object") {
          return null;
        }
        const row = item as Record<string, unknown>;
        const x = Number(row.x);
        const y = Number(row.y);
        if (!Number.isFinite(x) || !Number.isFinite(y) || y <= 0) {
          return null;
        }
        return {
          date: timestampToDate(x),
          value: round(y, 6)
        };
      })
      .filter((item): item is { date: string; value: number } => Boolean(item));

    if (points.length > 0) {
      return points;
    }
  }

  const acWorth = parseScriptVariable(script, "Data_ACWorthTrend");
  if (Array.isArray(acWorth) && acWorth.length > 0) {
    const points = acWorth
      .map((item) => {
        if (!Array.isArray(item) || item.length < 2) {
          return null;
        }

        const x = Number(item[0]);
        const y = Number(item[1]);
        if (!Number.isFinite(x) || !Number.isFinite(y) || y <= 0) {
          return null;
        }

        return {
          date: timestampToDate(x),
          value: round(y, 6)
        };
      })
      .filter((item): item is { date: string; value: number } => Boolean(item));

    return points;
  }

  return [];
}

function parseScriptVariable(script: string, variableName: string): unknown {
  const pattern = new RegExp(`var\\s+${escapeRegExp(variableName)}\\s*=\\s*([\\s\\S]*?);`);
  const matched = script.match(pattern);
  if (!matched || !matched[1]) {
    return null;
  }

  const raw = matched[1].trim();
  if (!raw) {
    return null;
  }

  return parseJsonLoose(raw);
}

async function fetchQuote(secid: string, timeoutMs: number): Promise<{ price: number; volume: number }> {
  const url = new URL("https://push2.eastmoney.com/api/qt/stock/get");
  url.searchParams.set("secid", secid);
  url.searchParams.set("fields", "f43,f47");

  const payload = await fetchJsonWithTimeout(url.toString(), timeoutMs);
  const source = payload && typeof payload === "object"
    ? (payload as Record<string, unknown>)
    : {};
  const data = source.data && typeof source.data === "object"
    ? (source.data as Record<string, unknown>)
    : {};

  return {
    price: normalizePrice(data.f43),
    volume: normalizeVolume(data.f47)
  };
}

async function fetchHistoryKline(secid: string, lookbackDays: number, timeoutMs: number): Promise<{
  points: FundRawContext["price_or_nav_series"];
}> {
  const url = new URL("https://push2his.eastmoney.com/api/qt/stock/kline/get");
  url.searchParams.set("secid", secid);
  url.searchParams.set("klt", "101");
  url.searchParams.set("fqt", "1");
  url.searchParams.set("lmt", String(Math.max(30, lookbackDays + 30)));
  url.searchParams.set("end", "20500101");
  url.searchParams.set("fields1", "f1,f2,f3,f4,f5,f6");
  url.searchParams.set("fields2", "f51,f52,f53,f54,f55,f56,f57,f58");

  const payload = await fetchJsonWithTimeout(url.toString(), timeoutMs);
  const source = payload && typeof payload === "object"
    ? (payload as Record<string, unknown>)
    : {};
  const data = source.data && typeof source.data === "object"
    ? (source.data as Record<string, unknown>)
    : {};
  const klines = Array.isArray(data.klines)
    ? data.klines
    : [];

  const points = klines
    .map((item) => {
      if (typeof item !== "string") {
        return null;
      }

      const parts = item.split(",");
      if (parts.length < 6) {
        return null;
      }

      const close = Number(parts[2]);
      const volume = Number(parts[5]);
      if (!Number.isFinite(close) || close <= 0) {
        return null;
      }

      const date = normalizeDateString(parts[0]);
      return {
        date,
        value: round(close, 4),
        ...(Number.isFinite(volume) ? { volume: round(volume, 4) } : {})
      };
    })
    .filter((item): item is { date: string; value: number; volume?: number } => Boolean(item));

  return {
    points
  };
}

function normalizeFundLlmProvider(engine: string): {
  useGemini: boolean;
  selector?: string;
  providerLabel: string;
} {
  const value = String(engine || "").trim().toLowerCase();
  if (value === "gemini") {
    return {
      useGemini: true,
      providerLabel: "gemini"
    };
  }
  if (!value || value === "local" || value === "default" || value === "auto") {
    return {
      useGemini: false,
      selector: undefined,
      providerLabel: "local"
    };
  }
  if (["gpt_plugin", "gpt-plugin", "gptplugin", "chatgpt-bridge", "chatgpt_bridge", "bridge"].includes(value)) {
    return {
      useGemini: false,
      selector: "gpt-plugin",
      providerLabel: "gpt-plugin"
    };
  }

  const selector = value.replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return {
    useGemini: false,
    ...(selector ? { selector } : {}),
    providerLabel: selector || "local"
  };
}

function inferFundType(code: string, name: string): FundType {
  const normalizedName = name.toLowerCase();

  if (/lof/.test(normalizedName) || code.startsWith("16")) {
    return "lof";
  }
  if (/etf/.test(normalizedName) || code.startsWith("5") || code.startsWith("15") || code.startsWith("56")) {
    return "etf";
  }
  if (code) {
    return "otc_public";
  }
  return "unknown";
}

function inferStrategyType(name: string): StrategyType {
  const normalized = name.toLowerCase();

  if (/qdii/.test(normalized)) {
    return "qdii";
  }
  if (/货币/.test(name)) {
    return "money_market";
  }
  if (/债/.test(name)) {
    return "bond";
  }
  if (/fof/i.test(name)) {
    return "fof";
  }
  if (/混合/.test(name)) {
    return "mixed";
  }
  if (/指数|etf/.test(name) || /index/.test(normalized)) {
    return "index";
  }
  if (name) {
    return "active_equity";
  }
  return "unknown";
}

function inferTradableType(fundType: FundType): TradableType {
  if (fundType === "etf" || fundType === "lof") {
    return "intraday";
  }
  if (fundType === "otc_public") {
    return "nav_t_plus_n";
  }
  return "unknown";
}

function inferMarket(code: string, tradable: TradableType): string {
  if (!code) {
    return "unknown";
  }

  if (tradable === "nav_t_plus_n") {
    return "otc";
  }

  if (code.startsWith("6") || code.startsWith("5") || code.startsWith("9")) {
    return "sh";
  }

  if (code.startsWith("0") || code.startsWith("1") || code.startsWith("3")) {
    return "sz";
  }

  return "unknown";
}

function inferAsOfDate(series: FundRawContext["price_or_nav_series"]): string {
  if (series.length === 0) {
    return todayDate();
  }
  return normalizeDateString(series[series.length - 1].date);
}

function toSecId(code: string, kind: "fund" | "index"): string {
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

function normalizeCode(raw: string): string {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) {
    return "";
  }
  return digits.length >= 6 ? digits.slice(-6) : digits.padStart(6, "0");
}

function normalizeDateString(raw: string): string {
  const source = String(raw || "").trim();
  if (!source) {
    return todayDate();
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(source)) {
    return source;
  }

  if (/^\d{8}$/.test(source)) {
    return `${source.slice(0, 4)}-${source.slice(4, 6)}-${source.slice(6, 8)}`;
  }

  const timestamp = Date.parse(source);
  if (!Number.isFinite(timestamp)) {
    return todayDate();
  }

  return timestampToDate(timestamp);
}

function timestampToDate(timestamp: number): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return todayDate();
  }
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function todayDate(): string {
  return timestampToDate(Date.now());
}

function parseJsonLoose(input: string): unknown {
  const normalized = String(input || "").trim();
  if (!normalized) {
    return null;
  }

  try {
    return JSON.parse(normalized);
  } catch {
    // no-op
  }

  try {
    return JSON.parse(jsonrepair(normalized));
  } catch {
    return null;
  }
}

function stripJsonFence(text: string): string {
  return text
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
}

function extractFirstJsonObject(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return "";
  }
  return text.slice(start, end + 1).trim();
}

function normalizePrice(value: unknown): number {
  const numeric = Number(value);
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

function normalizeVolume(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return round(Math.max(0, numeric), 4);
}

function normalizeNumber(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function dedupStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)));
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  const rounded = Math.floor(numeric);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function round(value: number, digits: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function fetchJsonWithTimeout(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
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

async function postJsonWithTimeout(url: string, timeoutMs: number, payload: unknown): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!response.ok) {
      const text = await safeReadText(response);
      throw new Error(`HTTP ${response.status} for ${url}${text ? `: ${text.slice(0, 240)}` : ""}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTextWithTimeout(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
