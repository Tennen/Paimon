import { jsonrepair } from "jsonrepair";
import { createLLMEngine } from "../../../engines/llm";
import { buildFundFeatureContext } from "./fund_feature_engine";
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
const DEFAULT_COMPARISON_REFERENCE = "同类基金百分位";

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

function buildEmptyHoldingsStyle(): FundRawContext["holdings_style"] {
  return {
    top_holdings: [],
    sector_exposure: {},
    style_factor_exposure: {},
    duration_credit_profile: {}
  };
}

function buildEmptyReferenceContext(): FundRawContext["reference_context"] {
  return {
    comparison_reference: DEFAULT_COMPARISON_REFERENCE,
    peer_percentile_series: [],
    current_managers: []
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

type FundBaseDataResult = {
  series: FundRawContext["price_or_nav_series"];
  holdings_style: FundRawContext["holdings_style"];
  reference_context: FundRawContext["reference_context"];
  events: Pick<FundRawContext["events"], "notices" | "manager_changes" | "subscription_redemption" | "regulatory_risks">;
  source_chain: string[];
  errors: string[];
};

type FundEstimateResponse = {
  point?: FundRawContext["price_or_nav_series"][number];
  reference_context: Partial<FundRawContext["reference_context"]>;
  source_chain: string[];
  errors: string[];
};

type FundHistoryRow = {
  date: string;
  unit_nav?: number;
  cumulative_nav?: number;
  daily_growth?: number;
  purchase_status: string;
  redemption_status: string;
  dividend: string;
};

type FundHistoryResponse = {
  rows: FundHistoryRow[];
  points: FundRawContext["price_or_nav_series"];
  source_chain: string[];
  errors: string[];
};

type FundHistoryPageResponse = {
  rows: FundHistoryRow[];
  pages: number;
};

type FundHoldingsResponse = {
  holdings_style: FundRawContext["holdings_style"];
  source_chain: string[];
  errors: string[];
};

type FundPingzhongdataResponse = {
  points: FundRawContext["price_or_nav_series"];
  reference_context: Partial<FundRawContext["reference_context"]>;
  source_chain: string[];
  errors: string[];
};

async function fetchFundBaseData(code: string, lookbackDays: number, timeoutMs: number): Promise<FundBaseDataResult> {
  const [estimateResult, historyResult, holdingsResult, pingzhongdataResult] = await Promise.allSettled([
    fetchFundEstimate(code, timeoutMs),
    fetchFundHistory(code, lookbackDays, timeoutMs),
    fetchFundHoldings(code, timeoutMs),
    fetchFundPingzhongdata(code, timeoutMs)
  ]);

  const estimate = estimateResult.status === "fulfilled"
    ? estimateResult.value
    : {
        reference_context: {},
        source_chain: ["eastmoney:fundgz"],
        errors: [estimateResult.reason instanceof Error ? estimateResult.reason.message : String(estimateResult.reason)]
      } satisfies FundEstimateResponse;

  const history = historyResult.status === "fulfilled"
    ? historyResult.value
    : {
        rows: [],
        points: [],
        source_chain: ["eastmoney:fund_lsjz"],
        errors: [historyResult.reason instanceof Error ? historyResult.reason.message : String(historyResult.reason)]
      } satisfies FundHistoryResponse;

  const holdings = holdingsResult.status === "fulfilled"
    ? holdingsResult.value
    : {
        holdings_style: buildEmptyHoldingsStyle(),
        source_chain: ["eastmoney:fund_jjcc"],
        errors: [holdingsResult.reason instanceof Error ? holdingsResult.reason.message : String(holdingsResult.reason)]
      } satisfies FundHoldingsResponse;

  const pingzhongdata = pingzhongdataResult.status === "fulfilled"
    ? pingzhongdataResult.value
    : {
        points: [],
        reference_context: {},
        source_chain: ["eastmoney:fund_pingzhongdata"],
        errors: [pingzhongdataResult.reason instanceof Error ? pingzhongdataResult.reason.message : String(pingzhongdataResult.reason)]
      } satisfies FundPingzhongdataResponse;

  const targetLength = Math.max(30, lookbackDays + 10);
  const mergedHistory = mergeFundSeriesPoints([
    pingzhongdata.points,
    history.points
  ], targetLength);
  const series = mergedHistory.length > 0
    ? appendEstimatedPoint(mergedHistory, estimate.point).slice(-targetLength)
    : [];
  const historyEvents = buildHistoryDerivedEvents(history.rows);

  return {
    series,
    holdings_style: holdings.holdings_style,
    reference_context: {
      ...buildEmptyReferenceContext(),
      ...pingzhongdata.reference_context,
      ...estimate.reference_context,
      comparison_reference: pingzhongdata.reference_context.comparison_reference || DEFAULT_COMPARISON_REFERENCE,
      current_managers: dedupStrings([
        ...buildEmptyReferenceContext().current_managers,
        ...toStringArray(pingzhongdata.reference_context.current_managers)
      ]),
      peer_percentile_series: mergeFundSeriesPoints([
        buildEmptyReferenceContext().peer_percentile_series,
        Array.isArray(pingzhongdata.reference_context.peer_percentile_series)
          ? pingzhongdata.reference_context.peer_percentile_series
          : []
      ], targetLength)
    },
    events: {
      notices: historyEvents.notices,
      manager_changes: [],
      subscription_redemption: historyEvents.subscription_redemption,
      regulatory_risks: []
    },
    source_chain: dedupStrings([
      ...estimate.source_chain,
      ...history.source_chain,
      ...holdings.source_chain,
      ...pingzhongdata.source_chain
    ]),
    errors: dedupStrings([
      ...history.errors,
      ...pingzhongdata.errors,
      ...(series.length === 0 ? estimate.errors : []),
      ...(holdings.holdings_style.top_holdings.length === 0 && series.length === 0 ? holdings.errors : [])
    ])
  };
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

async function fetchFundEstimate(code: string, timeoutMs: number): Promise<FundEstimateResponse> {
  const url = `https://fundgz.1234567.com.cn/js/${encodeURIComponent(code)}.js?rt=${Date.now()}`;

  try {
    const script = await fetchTextWithTimeout(url, timeoutMs);
    const payload = parseFundEstimateScript(script);
    const estimateValue = normalizePositiveNumber(payload.gsz);
    const estimatedSource = typeof payload.gztime === "string"
      ? payload.gztime
      : typeof payload.jzrq === "string"
        ? payload.jzrq
        : "";
    const estimatedAt = normalizeDateTimeString(estimatedSource);
    const estimatedDate = normalizeDateString(estimatedAt || estimatedSource);
    const estimatedTime = extractTimeString(estimatedAt);

    return {
      ...(Number.isFinite(estimateValue) && estimateValue > 0
        ? {
            point: {
              date: estimatedDate,
              value: round(estimateValue, 6)
            }
          }
        : {}),
      reference_context: {
        ...(Number.isFinite(estimateValue) && estimateValue > 0 ? { estimated_nav: round(estimateValue, 6) } : {}),
        ...(estimatedDate ? { estimated_nav_date: estimatedDate } : {}),
        ...(estimatedTime ? { estimated_nav_time: estimatedTime } : {}),
        ...(Number.isFinite(normalizeSignedNumber(payload.gszzl))
          ? { estimated_change_pct: round(normalizeSignedNumber(payload.gszzl), 4) }
          : {})
      },
      source_chain: ["eastmoney:fundgz"],
      errors: []
    };
  } catch (error) {
    return {
      reference_context: {},
      source_chain: ["eastmoney:fundgz"],
      errors: [error instanceof Error ? error.message : String(error)]
    };
  }
}

async function fetchFundHistory(code: string, lookbackDays: number, timeoutMs: number): Promise<FundHistoryResponse> {
  const per = 49;
  const targetRows = Math.max(30, lookbackDays + 10);

  try {
    const firstPage = await fetchFundHistoryPage(code, 1, per, timeoutMs);
    const pageCount = Math.min(
      Math.max(1, firstPage.pages),
      Math.max(1, Math.ceil(targetRows / per))
    );

    const remainingPages = pageCount > 1
      ? await Promise.allSettled(
        Array.from({ length: pageCount - 1 }, (_, index) => fetchFundHistoryPage(code, index + 2, per, timeoutMs))
      )
      : [];

    const rows = firstPage.rows.slice();
    const errors: string[] = [];

    for (const page of remainingPages) {
      if (page.status === "fulfilled") {
        rows.push(...page.value.rows);
      } else {
        errors.push(page.reason instanceof Error ? page.reason.message : String(page.reason));
      }
    }

    const points = rows
      .map((row) => {
        const unitNav = normalizePositiveNumber(row.unit_nav);
        if (!Number.isFinite(unitNav) || unitNav <= 0) {
          return null;
        }
        return {
          date: row.date,
          value: round(unitNav, 6)
        };
      })
      .filter((item): item is { date: string; value: number } => Boolean(item));

    return {
      rows: dedupFundHistoryRows(rows).slice(-targetRows),
      points: mergeFundSeriesPoints([points], targetRows),
      source_chain: ["eastmoney:fund_lsjz"],
      errors: dedupStrings(errors)
    };
  } catch (error) {
    return {
      rows: [],
      points: [],
      source_chain: ["eastmoney:fund_lsjz"],
      errors: [error instanceof Error ? error.message : String(error)]
    };
  }
}

async function fetchFundHistoryPage(
  code: string,
  page: number,
  per: number,
  timeoutMs: number
): Promise<FundHistoryPageResponse> {
  const url = new URL("https://fundf10.eastmoney.com/F10DataApi.aspx");
  url.searchParams.set("type", "lsjz");
  url.searchParams.set("code", code);
  url.searchParams.set("page", String(Math.max(1, page)));
  url.searchParams.set("per", String(Math.max(1, per)));
  url.searchParams.set("sdate", "");
  url.searchParams.set("edate", "");

  const payload = await fetchTextWithTimeout(url.toString(), timeoutMs);
  const content = extractApidataContent(payload);
  const rows = parseFundHistoryRows(content);
  const pages = extractApidataNumberField(payload, "pages");

  return {
    rows,
    pages: Number.isFinite(pages) && pages > 0 ? Math.floor(pages) : 1
  };
}

async function fetchFundHoldings(code: string, timeoutMs: number): Promise<FundHoldingsResponse> {
  const url = new URL("https://fundf10.eastmoney.com/FundArchivesDatas.aspx");
  url.searchParams.set("type", "jjcc");
  url.searchParams.set("code", code);
  url.searchParams.set("topline", "10");
  url.searchParams.set("year", "");
  url.searchParams.set("month", "");
  url.searchParams.set("_", String(Date.now()));

  try {
    const payload = await fetchTextWithTimeout(url.toString(), timeoutMs);
    const content = extractApidataContent(payload);
    return {
      holdings_style: {
        ...buildEmptyHoldingsStyle(),
        top_holdings: parseFundHoldings(content)
      },
      source_chain: ["eastmoney:fund_jjcc"],
      errors: []
    };
  } catch (error) {
    return {
      holdings_style: buildEmptyHoldingsStyle(),
      source_chain: ["eastmoney:fund_jjcc"],
      errors: [error instanceof Error ? error.message : String(error)]
    };
  }
}

async function fetchFundPingzhongdata(code: string, timeoutMs: number): Promise<FundPingzhongdataResponse> {
  const url = `https://fund.eastmoney.com/pingzhongdata/${encodeURIComponent(code)}.js?v=${Date.now()}`;

  try {
    const script = await fetchTextWithTimeout(url, timeoutMs);
    const peerPercentile = parseFundPeerPercentile(script);
    const peerPercentileSeries = parseFundPeerPercentileSeries(script);
    const peerRankSnapshot = parseFundPeerRankSnapshot(script);
    return {
      points: parseOtcSeriesFromScript(script),
      reference_context: {
        comparison_reference: DEFAULT_COMPARISON_REFERENCE,
        ...(Number.isFinite(peerPercentile) ? { peer_percentile: round(peerPercentile, 4) } : {}),
        ...(Number.isFinite(peerRankSnapshot.position) ? { peer_rank_position: round(peerRankSnapshot.position, 0) } : {}),
        ...(Number.isFinite(peerRankSnapshot.total) ? { peer_rank_total: round(peerRankSnapshot.total, 0) } : {}),
        peer_percentile_series: peerPercentileSeries,
        current_managers: parseCurrentFundManagers(script)
      },
      source_chain: ["eastmoney:fund_pingzhongdata"],
      errors: []
    };
  } catch (error) {
    return {
      points: [],
      reference_context: {},
      source_chain: ["eastmoney:fund_pingzhongdata"],
      errors: [error instanceof Error ? error.message : String(error)]
    };
  }
}

function normalizeFundLlmProvider(engine: string): {
  selector?: string;
  providerLabel: string;
} {
  const value = String(engine || "").trim().toLowerCase();
  if (!value || value === "local" || value === "default" || value === "auto") {
    return {
      selector: undefined,
      providerLabel: "local"
    };
  }
  if (["gpt_plugin", "gpt-plugin", "gptplugin", "chatgpt-bridge", "chatgpt_bridge", "bridge"].includes(value)) {
    return {
      selector: "gpt-plugin",
      providerLabel: "gpt-plugin"
    };
  }

  const selector = value.replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return {
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

function normalizeDateTimeString(raw: string): string {
  const source = String(raw || "").trim();
  if (!source) {
    return "";
  }
  const normalized = source
    .replace(/\//g, "-")
    .replace(/\./g, "-")
    .replace(/\s+/g, " ")
    .trim();
  const exactMatch = normalized.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?$/);
  if (exactMatch) {
    return exactMatch[2]
      ? `${exactMatch[1]} ${exactMatch[2].length === 5 ? `${exactMatch[2]}:00` : exactMatch[2]}`
      : exactMatch[1];
  }
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) {
    return normalized;
  }
  const date = new Date(timestamp);
  return [
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
    `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`
  ].join(" ");
}

function extractTimeString(raw: string): string {
  const source = String(raw || "").trim();
  if (!source) {
    return "";
  }
  const matched = source.match(/\b(\d{2}:\d{2}(?::\d{2})?)\b/);
  return matched?.[1] || "";
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

function parseFundEstimateScript(script: string): Record<string, unknown> {
  const matched = script.match(/jsonpgz\s*\(\s*(\{[\s\S]*\})\s*\)\s*;?/);
  if (!matched?.[1]) {
    return {};
  }
  const parsed = parseJsonLoose(matched[1]);
  return parsed && typeof parsed === "object"
    ? (parsed as Record<string, unknown>)
    : {};
}

function extractApidataContent(payload: string): string {
  const matched = payload.match(/content\s*:\s*"([\s\S]*?)"\s*,\s*(?:records|arryear|curyear)\s*:/);
  if (!matched?.[1]) {
    return "";
  }
  return matched[1]
    .replace(/\\"/g, "\"")
    .replace(/\\'/g, "'")
    .replace(/\\\//g, "/")
    .replace(/\\r\\n|\\n|\\r/g, "");
}

function extractApidataNumberField(payload: string, field: string): number {
  const pattern = new RegExp(`${escapeRegExp(field)}\\s*:\\s*(\\d+)`);
  const matched = payload.match(pattern);
  return matched?.[1] ? Number(matched[1]) : NaN;
}

function parseFundHistoryRows(content: string): FundHistoryRow[] {
  const rows = extractHtmlTableRows(content);
  return rows
    .map((row): FundHistoryRow | null => {
      const cells = extractTableCellTexts(row);
      if (cells.length < 3) {
        return null;
      }
      const date = normalizeDateString(cells[0]);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return null;
      }
      return {
        date,
        unit_nav: normalizePositiveNumber(cells[1]),
        cumulative_nav: normalizePositiveNumber(cells[2]),
        daily_growth: normalizeSignedNumber(cells[3]),
        purchase_status: normalizeOptionalText(cells[4]),
        redemption_status: normalizeOptionalText(cells[5]),
        dividend: normalizeOptionalText(cells[6])
      };
    })
    .filter((item): item is FundHistoryRow => Boolean(item));
}

function parseFundHoldings(content: string): string[] {
  const table = content.match(/<table[\s\S]*?<\/table>/i)?.[0] || "";
  if (!table) {
    return [];
  }

  const rows = extractHtmlTableRows(table);
  const holdings: string[] = [];

  for (const row of rows) {
    const cells = extractTableCellTexts(row);
    if (cells.length < 2) {
      continue;
    }
    const weight = cells.find((item) => /\d+(?:\.\d+)?%/.test(item)) || "";
    const name = cells.find((item) => isFundHoldingName(item)) || "";
    if (!name) {
      continue;
    }
    holdings.push(weight ? `${name}(${weight})` : name);
  }

  return dedupStrings(holdings).slice(0, 10);
}

function buildHistoryDerivedEvents(rows: FundHistoryRow[]): {
  notices: string[];
  subscription_redemption: string[];
} {
  const sorted = dedupFundHistoryRows(rows)
    .slice()
    .sort((left, right) => Date.parse(right.date) - Date.parse(left.date))
    .slice(0, 12);

  const notices = sorted
    .filter((row) => Boolean(row.dividend) && !isHistoryEmptyField(row.dividend))
    .map((row) => `${row.date} ${row.dividend}`);

  const subscriptionRedemption = sorted.flatMap((row) => {
    const items: string[] = [];
    if (isRestrictionStatus(row.purchase_status)) {
      items.push(`${row.date} 申购状态: ${row.purchase_status}`);
    }
    if (isRestrictionStatus(row.redemption_status)) {
      items.push(`${row.date} 赎回状态: ${row.redemption_status}`);
    }
    return items;
  });

  return {
    notices: dedupStrings(notices),
    subscription_redemption: dedupStrings(subscriptionRedemption)
  };
}

function dedupFundHistoryRows(rows: FundHistoryRow[]): FundHistoryRow[] {
  const map = new Map<string, FundHistoryRow>();
  for (const row of rows) {
    if (!row.date) {
      continue;
    }
    map.set(row.date, row);
  }
  return Array.from(map.values())
    .sort((left, right) => Date.parse(left.date) - Date.parse(right.date));
}

function mergeFundSeriesPoints(
  groups: Array<FundRawContext["price_or_nav_series"]>,
  limit: number
): FundRawContext["price_or_nav_series"] {
  const merged = new Map<string, FundRawContext["price_or_nav_series"][number]>();
  for (const group of groups) {
    for (const point of group) {
      const value = normalizePositiveNumber(point?.value);
      if (!point?.date || !Number.isFinite(value) || value <= 0) {
        continue;
      }
      merged.set(normalizeDateString(point.date), {
        date: normalizeDateString(point.date),
        value: round(value, 6)
      });
    }
  }
  return Array.from(merged.values())
    .sort((left, right) => Date.parse(left.date) - Date.parse(right.date))
    .slice(-Math.max(1, limit));
}

function appendEstimatedPoint(
  points: FundRawContext["price_or_nav_series"],
  estimate?: FundRawContext["price_or_nav_series"][number]
): FundRawContext["price_or_nav_series"] {
  if (!estimate?.date) {
    return points.slice();
  }
  const estimateValue = normalizePositiveNumber(estimate.value);
  if (!Number.isFinite(estimateValue) || estimateValue <= 0) {
    return points.slice();
  }

  const normalizedDate = normalizeDateString(estimate.date);
  const existsSameDate = points.some((item) => normalizeDateString(item.date) === normalizedDate);
  if (existsSameDate) {
    return points.slice();
  }

  return [...points, { date: normalizedDate, value: round(estimateValue, 6) }]
    .sort((left, right) => Date.parse(left.date) - Date.parse(right.date));
}

function parseFundPeerPercentile(script: string): number {
  const source = parseScriptVariable(script, "Data_rateInSimilarPersent");
  if (!Array.isArray(source) || source.length === 0) {
    return NaN;
  }

  const last = source[source.length - 1];
  if (Array.isArray(last)) {
    return normalizeSignedNumber(last[1]);
  }
  if (last && typeof last === "object") {
    const row = last as Record<string, unknown>;
    return normalizeSignedNumber(row.y ?? row.value);
  }
  return NaN;
}

function parseFundPeerPercentileSeries(script: string): FundRawContext["price_or_nav_series"] {
  const source = parseScriptVariable(script, "Data_rateInSimilarPersent");
  if (!Array.isArray(source)) {
    return [];
  }

  return source
    .map((item) => {
      if (Array.isArray(item) && item.length >= 2) {
        const timestamp = Number(item[0]);
        const percentile = normalizePositiveNumber(item[1]);
        if (!Number.isFinite(timestamp) || !Number.isFinite(percentile)) {
          return null;
        }
        return {
          date: timestampToDate(timestamp),
          value: round(percentile, 4)
        };
      }

      if (item && typeof item === "object") {
        const row = item as Record<string, unknown>;
        const timestamp = Number(row.x ?? row.date);
        const percentile = normalizePositiveNumber(row.y ?? row.value);
        if (!Number.isFinite(timestamp) || !Number.isFinite(percentile)) {
          return null;
        }
        return {
          date: timestampToDate(timestamp),
          value: round(percentile, 4)
        };
      }

      return null;
    })
    .filter((item): item is { date: string; value: number } => Boolean(item));
}

function parseFundPeerRankSnapshot(script: string): { position: number; total: number } {
  const source = parseScriptVariable(script, "Data_rateInSimilarType");
  if (!Array.isArray(source) || source.length === 0) {
    return { position: NaN, total: NaN };
  }

  const last = source[source.length - 1];
  if (!last || typeof last !== "object" || Array.isArray(last)) {
    return { position: NaN, total: NaN };
  }

  const row = last as Record<string, unknown>;
  return {
    position: normalizePositiveNumber(row.y),
    total: normalizePositiveNumber(row.sc)
  };
}

function parseCurrentFundManagers(script: string): string[] {
  const source = parseScriptVariable(script, "Data_currentFundManager");
  if (!Array.isArray(source)) {
    return [];
  }
  return dedupStrings(
    source
      .map((item) => {
        if (!item || typeof item !== "object") {
          return "";
        }
        const row = item as Record<string, unknown>;
        return typeof row.name === "string" ? row.name.trim() : "";
      })
      .filter(Boolean)
  );
}

function extractHtmlTableRows(content: string): string[] {
  const matched = content.match(/<tr[\s\S]*?<\/tr>/gi);
  return Array.isArray(matched) ? matched : [];
}

function extractTableCellTexts(rowHtml: string): string[] {
  const matched = rowHtml.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi);
  if (!Array.isArray(matched)) {
    return [];
  }
  return matched
    .map((item) => normalizeOptionalText(stripHtmlTags(item)))
    .filter(Boolean);
}

function stripHtmlTags(input: string): string {
  return decodeHtmlEntities(String(input || ""))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'");
}

function isFundHoldingName(value: string): boolean {
  const text = normalizeOptionalText(value);
  if (!text) {
    return false;
  }
  if (/^\d+$/.test(text) || /^\d+(?:\.\d+)?%$/.test(text)) {
    return false;
  }
  if (/^(序号|股票代码|债券代码|股票名称|债券名称|占净值|持仓市值|相关资讯)$/i.test(text)) {
    return false;
  }
  return /[\u4e00-\u9fa5a-z]/i.test(text);
}

function isRestrictionStatus(value: string): boolean {
  const text = normalizeOptionalText(value);
  if (!text) {
    return false;
  }
  return /暂停|限制|限购|限赎|封闭|closed|停售/i.test(text);
}

function isHistoryEmptyField(value: string): boolean {
  const text = normalizeOptionalText(value);
  return !text || /^(--|---|暂无数据|不分红|开放申购|开放赎回)$/i.test(text);
}

function normalizeOptionalText(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
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

function truncateText(input: string, maxLength: number): string {
  const source = String(input || "").trim();
  if (!source) {
    return "";
  }
  if (source.length <= maxLength) {
    return source;
  }
  return `${source.slice(0, Math.max(0, maxLength - 1))}…`;
}

function normalizePositiveNumber(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return NaN;
  }
  return numeric;
}

function normalizeSignedNumber(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return NaN;
  }
  return numeric;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
      .map((item) => String(item || "").trim())
      .filter(Boolean)
    : [];
}

function normalizeNumber(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeOptionalNonNegativeNumber(value: unknown): number | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return undefined;
  }
  return numeric;
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

const SENSITIVE_QUERY_KEYS = new Set(["api_key", "apikey", "token", "access_token", "auth", "authorization", "key", "secret"]);

async function fetchJsonWithTimeout(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  const target = toSafeLogUrl(url);

  console.log(`[MarketAnalysis][HTTP][fund] request GET ${target} timeout=${timeoutMs}ms`);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    const durationMs = Date.now() - startedAt;
    console.log(`[MarketAnalysis][HTTP][fund] response GET ${target} status=${response.status} duration=${durationMs}ms`);
    return await response.json();
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[MarketAnalysis][HTTP][fund] failed GET ${target} duration=${durationMs}ms error=${message}`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTextWithTimeout(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  const target = toSafeLogUrl(url);

  console.log(`[MarketAnalysis][HTTP][fund] request GET ${target} timeout=${timeoutMs}ms response=text`);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }

    const durationMs = Date.now() - startedAt;
    console.log(`[MarketAnalysis][HTTP][fund] response GET ${target} status=${response.status} duration=${durationMs}ms response=text`);
    return await response.text();
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[MarketAnalysis][HTTP][fund] failed GET ${target} duration=${durationMs}ms response=text error=${message}`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function toSafeLogUrl(input: string): string {
  const raw = String(input || "").trim();
  if (!raw) {
    return "-";
  }

  try {
    const parsed = new URL(raw);
    for (const [key] of parsed.searchParams) {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
        parsed.searchParams.set(key, "***");
      }
    }
    const search = parsed.searchParams.toString();
    return truncateLogText(`${parsed.origin}${parsed.pathname}${search ? `?${search}` : ""}`, 220);
  } catch {
    return truncateLogText(raw, 220);
  }
}

function truncateLogText(input: string, maxLength: number): string {
  if (input.length <= maxLength) {
    return input;
  }
  return `${input.slice(0, maxLength)}...`;
}
