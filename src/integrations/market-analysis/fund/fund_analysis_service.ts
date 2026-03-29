import { createLLMEngine } from "../../../engines/llm";
import {
  DEFAULT_COMPARISON_REFERENCE,
  buildEmptyHoldingsStyle,
  buildEmptyReferenceContext
} from "./fund_analysis_defaults";
import { buildFundFeatureContext } from "./fund_feature_engine";
import { fetchFundBaseData } from "./fund_analysis_fetch";
import {
  inferAsOfDate,
  inferFundType,
  inferMarket,
  inferStrategyType,
  inferTradableType,
  normalizeCode,
  normalizeFundLlmProvider,
  todayDate
} from "./fund_analysis_normalize";
import { buildFundSystemPrompt, buildFundUserPrompt } from "./fund_prompt_builder";
import { evaluateFundRules } from "./fund_rule_engine";
import {
  buildFallbackFundDashboard,
  FundDecisionDashboard,
  validateFundDecisionDashboard
} from "./fund_schema";
import { fetchFundNews } from "./search_adapter";
import { resolveMarketAnalysisLlmTimeoutMs } from "./llm_timeout";
import {
  clampInt,
  clampNumber,
  dedupStrings,
  normalizeNumber,
  normalizeOptionalNonNegativeNumber,
  parseJsonLoose,
  truncateText
} from "./fund_analysis_utils";
import {
  FundAnalysisOutput,
  FundAuditStep,
  FundFeatureContext,
  FundIdentity,
  FundRawContext,
  FundRiskLevel,
  MarketAnalysisConfig,
  MarketPortfolio,
  MarketPhase
} from "./fund_types";

const DEFAULT_TIMEOUT_MS = 12000;

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
      accountCash: input.portfolio.cash,
      searchEngine: input.analysisConfig.searchEngine,
      querySuffix: input.analysisConfig.fund.newsQuerySuffix
    });
    auditSteps.push(ingestion.auditStep);
    if (ingestion.raw.errors.length > 0) {
      auditErrors.push(...ingestion.raw.errors);
    }

    if (!hasRequiredFundBaseData(ingestion.raw)) {
      const skipStart = Date.now();
      const skipFeature = buildSkippedFundFeatureContext();
      const skipRules = buildSkippedFundRuleContext();
      const skipDashboard = buildSkippedFundDashboard({
        identity,
        raw: ingestion.raw,
        feature: skipFeature
      });

      auditSteps.push({
        step: `skip:${identity.fund_code}`,
        duration_ms: Date.now() - skipStart,
        source_chain: ["fund_base_data_guard"],
        errors: ingestion.raw.errors
      });

      records.push({
        identity,
        raw: ingestion.raw,
        feature: skipFeature,
        rules: skipRules,
        dashboard: skipDashboard,
        rawLlmText: "",
        provider: "base_data_skip",
        llmErrors: []
      });
      continue;
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
  const comparisonReference = records.find((item) => item.raw.reference_context.comparison_reference)
    ?.raw.reference_context.comparison_reference
    || DEFAULT_COMPARISON_REFERENCE;

  const signalResult: FundAnalysisOutput = {
    phase: input.phase,
    marketState: inferMarketState(records),
    comparisonReference,
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
  quantity?: number;
  avgCost?: number;
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
      quantity: normalizeOptionalNonNegativeNumber(holding.quantity),
      avg_cost: normalizeOptionalNonNegativeNumber(holding.avgCost)
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
  options: { lookbackDays: number; timeoutMs: number; accountCash: number; searchEngine: string; querySuffix: string }
): Promise<{ raw: FundRawContext; auditStep: FundAuditStep }> {
  const start = Date.now();
  const sourceChain: string[] = [];
  const errors: string[] = [];

  const baseData = await fetchFundBaseData(identity.fund_code, options.lookbackDays, options.timeoutMs);

  sourceChain.push(...baseData.source_chain);
  errors.push(...baseData.errors);

  if (baseData.series.length === 0) {
    logFundBaseDataFailure(identity, {
      sourceChain: baseData.source_chain,
      errors: baseData.errors
    });
    const raw = buildBaseDataFailureRawContext(identity, options.accountCash, {
      sourceChain,
      errors
    });
    return {
      raw,
      auditStep: {
        step: `ingestion:${identity.fund_code}`,
        duration_ms: Date.now() - start,
        source_chain: raw.source_chain,
        errors: raw.errors
      }
    };
  }

  const news = await fetchFundNews({
    fundCode: identity.fund_code,
    fundName: identity.fund_name,
    fundType: identity.fund_type,
    strategyType: identity.strategy_type,
    searchEngine: options.searchEngine,
    querySuffix: options.querySuffix,
    timeoutMs: options.timeoutMs,
    maxItems: 8
  });
  sourceChain.push(...news.source_chain);
  errors.push(...news.errors);

  const newsEvents = classifyEventsFromNews(news.items);
  const asOfDate = inferAsOfDate(baseData.series);

  const raw: FundRawContext = {
    identity,
    as_of_date: asOfDate,
    price_or_nav_series: baseData.series,
    holdings_style: baseData.holdings_style,
    reference_context: baseData.reference_context,
    events: {
      notices: dedupStrings([...baseData.events.notices, ...newsEvents.notices]),
      manager_changes: dedupStrings([...baseData.events.manager_changes, ...newsEvents.manager_changes]),
      subscription_redemption: dedupStrings([
        ...baseData.events.subscription_redemption,
        ...newsEvents.subscription_redemption
      ]),
      regulatory_risks: dedupStrings([...baseData.events.regulatory_risks, ...newsEvents.regulatory_risks]),
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
  const systemPrompt = buildFundSystemPrompt();
  const baseUserPrompt = buildFundUserPrompt({
    raw: input.raw,
    features: input.feature,
    rules: input.rules
  });

  let lastRawText = "";
  const errors: string[] = [];
  let currentUserPrompt = baseUserPrompt;

  for (let attempt = 0; attempt <= retryMax; attempt += 1) {
    try {
      const llmResponse = await generateWithConfiguredProvider(
        systemPrompt,
        currentUserPrompt,
        providerSelection.selector
      );

      lastRawText = llmResponse.text;
      const parsed = parseDashboardFromText(lastRawText);
      if (!parsed) {
        errors.push(`attempt_${attempt + 1}: invalid_json`);
        if (attempt < retryMax) {
          currentUserPrompt = buildDashboardRepairUserPrompt(baseUserPrompt, lastRawText, ["invalid_json"]);
        }
        continue;
      }

      const validated = validateFundDecisionDashboard(parsed, input.fallbackDashboard);
      if (!validated.isValid) {
        errors.push(`attempt_${attempt + 1}: missing_fields:${validated.missingFields.join(",")}`);
        if (attempt < retryMax) {
          currentUserPrompt = buildDashboardRepairUserPrompt(
            baseUserPrompt,
            lastRawText,
            validated.missingFields.map((field) => `missing_field:${field}`)
          );
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
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(`attempt_${attempt + 1}: ${errorMessage}`);

      if (!isTimeoutLikeError(errorMessage)) {
        continue;
      }

      errors.push(`attempt_${attempt + 1}: timeout_retry_strategy=stop_after_timeout`);
      break;
    }
  }

  return {
    dashboard: input.fallbackDashboard,
    rawText: lastRawText,
    provider,
    errors
  };
}

function buildDashboardRepairUserPrompt(basePrompt: string, previousOutput: string, issues: string[]): string {
  const payload = {
    repair_mode: true,
    issues,
    requirements: [
      "仅输出一个完整 JSON 对象",
      "必须覆盖 FundDecisionDashboard 全部字段",
      "若数据不足必须写 insufficient_data",
      "decision_type 不能与 blocked_actions 冲突"
    ],
    previous_output_excerpt: truncateText(previousOutput, 2400)
  };

  return [
    basePrompt,
    "",
    "# 修复任务",
    JSON.stringify(payload, null, 2)
  ].join("\n");
}

function isTimeoutLikeError(message: string): boolean {
  const normalized = String(message || "").toLowerCase();
  return normalized.includes("timeout")
    || normalized.includes("timed out")
    || normalized.includes("abort")
    || normalized.includes("stream disconnected before completion")
    || normalized.includes("reconnecting...");
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

  const timeoutMs = resolveMarketAnalysisLlmTimeoutMs({ engineSelector: selector });
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
    .map((item) => item.feature.relative.peer_percentile)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  if (values.length === 0) {
    return "MARKET_NEUTRAL";
  }

  const avgPercentile = values.reduce((acc, item) => acc + item, 0) / values.length;

  if (avgPercentile >= 65) {
    return "MARKET_STRONG";
  }
  if (avgPercentile <= 35) {
    return "MARKET_WEAK";
  }
  return "MARKET_NEUTRAL";
}

function inferMissingFields(raw: FundRawContext, feature: FundFeatureContext): string[] {
  const missing: string[] = [];

  if (raw.price_or_nav_series.length === 0) {
    missing.push("price_or_nav_series");
  }
  if (!raw.as_of_date) {
    missing.push("as_of_date");
  }
  if (feature.coverage === "insufficient") {
    missing.push("feature_coverage_insufficient");
  }

  return dedupStrings(missing);
}

function hasRequiredFundBaseData(raw: FundRawContext): boolean {
  return Array.isArray(raw.price_or_nav_series) && raw.price_or_nav_series.length > 0;
}

function buildSkippedFundFeatureContext(): FundFeatureContext {
  return {
    returns: {
      ret_1d: "not_supported",
      ret_5d: "not_supported",
      ret_20d: "not_supported",
      ret_60d: "not_supported",
      ret_120d: "not_supported"
    },
    risk: {
      volatility_annualized: "not_supported",
      max_drawdown: "not_supported",
      drawdown_recovery_days: "not_supported"
    },
    stability: {
      excess_return_consistency: "not_supported",
      style_drift: "not_supported",
      nav_smoothing_anomaly: "not_supported"
    },
    relative: {
      peer_percentile: "not_supported",
      peer_percentile_change_20d: "not_supported",
      peer_percentile_change_60d: "not_supported",
      peer_rank_position: "not_supported",
      peer_rank_total: "not_supported"
    },
    trading: {
      ma5: "not_supported",
      ma10: "not_supported",
      ma20: "not_supported",
      premium_discount: "not_supported"
    },
    nav: {
      nav_slope_20d: "not_supported",
      sharpe: "not_supported",
      sortino: "not_supported",
      calmar: "not_supported",
      manager_tenure: "not_supported",
      style_drift_alert: "not_supported"
    },
    coverage: "insufficient",
    confidence: 0.1,
    warnings: ["base_market_data_unavailable"]
  };
}

function buildSkippedFundRuleContext(): ReturnType<typeof evaluateFundRules> {
  return {
    rule_flags: [],
    rule_adjusted_score: 50,
    blocked_actions: [],
    hard_blocked: false
  };
}

function buildSkippedFundDashboard(input: {
  identity: FundIdentity;
  raw: FundRawContext;
  feature: FundFeatureContext;
}): FundDecisionDashboard {
  return {
    fund_code: input.identity.fund_code,
    fund_name: input.identity.fund_name,
    as_of_date: input.raw.as_of_date,
    decision_type: "watch",
    sentiment_score: 50,
    confidence: 0.1,
    core_conclusion: {
      one_sentence: "基础行情数据获取失败，本次跳过该基金分析。",
      thesis: [
        "本次未取得可用的基金净值/价格序列，收益与回撤分析不成立。",
        "这属于流程数据异常，不代表基金本身风险升高。"
      ]
    },
    risk_alerts: [],
    action_plan: {
      suggestion: "持仓者先不要依据本次结果调整；未持仓者也不要据此做判断，优先等待数据恢复后重跑。",
      position_change: "本次结果不用于仓位决策",
      execution_conditions: [
        "基础行情数据恢复正常后重新运行分析"
      ],
      stop_conditions: [
        "在基础数据仍缺失前，不依据本次结果做投资判断"
      ]
    },
    data_perspective: {
      return_metrics: {},
      risk_metrics: {},
      relative_metrics: {},
      feature_coverage: input.feature.coverage
    },
    rule_trace: {
      rule_flags: [],
      blocked_actions: [],
      adjusted_score: 50
    },
    insufficient_data: {
      is_insufficient: true,
      missing_fields: inferMissingFields(input.raw, input.feature)
    }
  };
}

function buildBaseDataFailureRawContext(
  identity: FundIdentity,
  accountCash: number,
  input: {
    sourceChain: string[];
    errors: string[];
  }
): FundRawContext {
  return {
    identity,
    as_of_date: todayDate(),
    price_or_nav_series: [],
    holdings_style: buildEmptyHoldingsStyle(),
    reference_context: buildEmptyReferenceContext(),
    events: {
      notices: [],
      manager_changes: [],
      subscription_redemption: [],
      regulatory_risks: [],
      market_news: []
    },
    account_context: {
      current_position: identity.account_position.quantity,
      avg_cost: identity.account_position.avg_cost,
      budget: normalizeNumber(accountCash, 0),
      risk_preference: String(process.env.FUND_ACCOUNT_RISK_PREFERENCE || "balanced").trim() || "balanced",
      holding_horizon: String(process.env.FUND_ACCOUNT_HOLDING_HORIZON || "medium_term").trim() || "medium_term"
    },
    source_chain: dedupStrings(input.sourceChain),
    errors: dedupStrings([
      ...input.errors,
      "base_fund_series_unavailable"
    ])
  };
}

function logFundBaseDataFailure(
  identity: FundIdentity,
  input: {
    sourceChain: string[];
    errors: string[];
  }
): void {
  const label = identity.fund_name
    ? `${identity.fund_name}(${identity.fund_code})`
    : identity.fund_code || "-";
  const errors = dedupStrings(input.errors);
  const sources = dedupStrings(input.sourceChain);
  console.error(
    `[MarketAnalysis][fund][base_data] failed fund=${label} sources=${sources.join(",") || "-"} errors=${errors.join(" | ") || "unknown"}`
  );
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
