// @ts-nocheck
import { buildFundReportContext, createEmptyFundReportContext } from "./fund/fund_report_context";
import {
  MARKET_CONFIG_STORE,
  MARKET_PORTFOLIO_STORE,
  MARKET_RUNS_STORE,
  MARKET_STATE_STORE
} from "./defaults";
import { formatNumber, phaseLabel } from "./utils";

export function formatPortfolio(portfolio) {
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
    const metrics = [];
    if (Number.isFinite(Number(item.quantity)) && Number(item.quantity) > 0) {
      metrics.push(`quantity=${formatNumber(item.quantity)}`);
    }
    if (Number.isFinite(Number(item.avgCost)) && Number(item.avgCost) >= 0) {
      metrics.push(`avgCost=${formatNumber(item.avgCost)}`);
    }
    lines.push(`- ${item.code}${metrics.length > 0 ? ` | ${metrics.join(" | ")}` : ""}`);
  }
  lines.push(`持仓存储键: ${MARKET_PORTFOLIO_STORE}`);

  return lines.join("\n");
}

export function formatPortfolioAddResult(result) {
  const holding = result && result.holding ? result.holding : {};
  const actionText = result && result.action === "updated" ? "持仓已更新。" : "持仓已新增。";
  const holdingLabel = holding.name ? `${holding.code} (${holding.name})` : `${holding.code || "-"}`;

  return [
    actionText,
    `标的: ${holdingLabel}`,
    `数量: ${Number.isFinite(Number(holding.quantity)) && Number(holding.quantity) > 0 ? formatNumber(holding.quantity) : "-"}`,
    `平均成本: ${Number.isFinite(Number(holding.avgCost)) && Number(holding.avgCost) >= 0 ? formatNumber(holding.avgCost) : "-"}`,
    "",
    formatPortfolio(result.portfolio || { funds: [], cash: 0 })
  ].join("\n");
}

export function formatStatus(state) {
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

export function buildRunResponseText(result) {
  const signalResult = result.signalResult;
  const lines = [
    `Market Analysis ${phaseLabel(signalResult.phase)} 完成`,
    "分析对象: 基金组合",
    `市场状态: ${signalResult.marketState}${signalResult.benchmark ? ` (${signalResult.benchmark})` : ""}`
  ];

  const fundRecords = Array.isArray(result.marketData && result.marketData.funds)
    ? result.marketData.funds
    : [];
  const fundRecordMap = new Map();
  for (const record of fundRecords) {
    const code = String(record && record.identity && record.identity.fund_code || "").trim();
    if (!code) {
      continue;
    }
    fundRecordMap.set(code, record);
  }

  if (!Array.isArray(signalResult.fund_dashboards) || signalResult.fund_dashboards.length === 0) {
    lines.push("基金决策: 无可用标的");
  } else {
    lines.push("基金决策:");
    for (const dashboard of signalResult.fund_dashboards.slice(0, 24)) {
      const code = String(dashboard.fund_code || "").trim();
      const name = String(dashboard.fund_name || "").trim();
      const label = name && code ? `${name}(${code})` : (name || code || "-");
      const decision = String(dashboard.decision_type || "watch").trim();
      const score = Number.isFinite(Number(dashboard.sentiment_score))
        ? Math.round(Number(dashboard.sentiment_score))
        : 0;
      const confidence = Number.isFinite(Number(dashboard.confidence))
        ? Number(dashboard.confidence).toFixed(2)
        : "0.00";
      const conclusion = dashboard.core_conclusion && dashboard.core_conclusion.one_sentence
        ? String(dashboard.core_conclusion.one_sentence).trim()
        : "未提供";
      const actionSuggestion = dashboard.action_plan && dashboard.action_plan.suggestion
        ? String(dashboard.action_plan.suggestion).trim()
        : "";
      const positionChange = dashboard.action_plan && dashboard.action_plan.position_change
        ? String(dashboard.action_plan.position_change).trim()
        : "";
      const record = fundRecordMap.get(code);
      const reportContext = record && record.raw_context && record.feature_context
        ? buildFundReportContext(record.raw_context, record.feature_context)
        : createEmptyFundReportContext();
      const metricSummary = buildFundMetricSummary(dashboard, reportContext);
      const newsStatus = describeNewsStatus(reportContext);
      const newsHeadline = pickTopNewsHeadline(reportContext);
      const risks = Array.isArray(dashboard.risk_alerts) ? dashboard.risk_alerts.slice(0, 3) : [];
      const intelligenceSummary = buildFundIntelligenceSummary(dashboard, reportContext, newsStatus, newsHeadline);
      const executionContext = buildFundExecutionContext(dashboard, reportContext);
      const checklist = buildFundChecklistText(dashboard, reportContext);

      lines.push(`- ${label}`);
      lines.push(`  核心结论: ${decision}。${conclusion}`);
      lines.push(`  数据视角: ${metricSummary.length > 0 ? metricSummary.join("；") : "关键指标暂不充分"}；信号强弱=${score}/100，置信度=${confidence}`);
      lines.push(`  情报观察: ${intelligenceSummary.length > 0 ? intelligenceSummary.join("；") : (risks.length > 0 ? risks.join("；") : "暂无新增重点风险")}`);
      if (actionSuggestion || positionChange || executionContext) {
        lines.push(`  执行计划: ${actionSuggestion || "未提供"}${positionChange ? `；仓位处理=${positionChange}` : ""}${executionContext ? `；${executionContext}` : ""}`);
      }
      if (checklist.length > 0) {
        lines.push(`  检查清单: ${checklist.join("；")}`);
      }
    }
  }

  if (signalResult.portfolio_report && signalResult.portfolio_report.brief) {
    lines.push(`组合摘要: ${signalResult.portfolio_report.brief}`);
  }

  if (result.explanation && result.explanation.error) {
    lines.push(`解释生成失败: ${result.explanation.error}`);
  }

  return lines.join("\n");
}

export function buildHelpText() {
  return [
    "Market Analysis 命令:",
    "/market [fund] <midday|close>  运行基金分析主流程（标准化->特征->规则->LLM）",
    "/market midday         运行 13:30 盘中分析",
    "/market close          运行 15:15 收盘分析",
    "/market status         查看最近一次运行结果",
    "/market portfolio      查看当前持仓配置",
    "/market add <code> <quantity> <avgCost> [name]    添加/加仓持仓（同 code 自动加权成本）",
    "",
    "说明:",
    "- 当 analysisEngine 实际 provider=codex 且启用解释时，会切换为“单次 markdown 报告”模式，并尝试生成长图推送。",
    "",
    "配置存储键:",
    `- 持仓: ${MARKET_PORTFOLIO_STORE}`,
    `- 分析配置: ${MARKET_CONFIG_STORE}`,
    `- 状态: ${MARKET_STATE_STORE}`,
    `- 快照明细: ${MARKET_RUNS_STORE}`
  ].join("\n");
}

function buildFundMetricSummary(dashboard, reportContext) {
  const metrics = [];
  const returns = dashboard && dashboard.data_perspective && dashboard.data_perspective.return_metrics
    ? dashboard.data_perspective.return_metrics
    : {};
  const risks = dashboard && dashboard.data_perspective && dashboard.data_perspective.risk_metrics
    ? dashboard.data_perspective.risk_metrics
    : {};
  const relative = dashboard && dashboard.data_perspective && dashboard.data_perspective.relative_metrics
    ? dashboard.data_perspective.relative_metrics
    : {};
  const featureContext = reportContext && reportContext.feature_context ? reportContext.feature_context : {};
  const featureReturns = featureContext && featureContext.returns ? featureContext.returns : {};
  const featureRisks = featureContext && featureContext.risk ? featureContext.risk : {};
  const featureRelative = featureContext && featureContext.relative ? featureContext.relative : {};
  const trading = featureContext && featureContext.trading ? featureContext.trading : {};
  const stability = featureContext && featureContext.stability ? featureContext.stability : {};
  const nav = featureContext && featureContext.nav ? featureContext.nav : {};
  const coverage = dashboard && dashboard.data_perspective
    ? String(dashboard.data_perspective.feature_coverage || "").trim()
    : "";
  const mergedReturns = mergeMetricMaps(returns, featureReturns);
  const mergedRisks = mergeMetricMaps(risks, featureRisks);
  const mergedRelative = mergeMetricMaps(relative, featureRelative);

  if (coverage) {
    metrics.push(`数据完整性=${formatCoverageLabel(coverage)}`);
  }

  const latestLine = joinMetricSegments([
    compactMetric("基金 ", reportContext && reportContext.fund_series_summary ? reportContext.fund_series_summary.latest_value : null, 6, "", false),
    compactMetric("基准 ", reportContext && reportContext.benchmark_series_summary ? reportContext.benchmark_series_summary.latest_value : null, 6, "", false)
  ]);
  if (latestLine) {
    metrics.push(`最新值=${latestLine}`);
  }

  const shortTerm = joinMetricSegments([
    compactMetric("1日", mergedReturns.ret_1d, 2, "%", true),
    compactMetric("5日", mergedReturns.ret_5d, 2, "%", true)
  ]);
  if (shortTerm) {
    metrics.push(`短线回报=${shortTerm}`);
  }

  const midTerm = joinMetricSegments([
    compactMetric("20日", mergedReturns.ret_20d, 2, "%", true),
    compactMetric("60日", mergedReturns.ret_60d, 2, "%", true),
    compactMetric("120日", mergedReturns.ret_120d, 2, "%", true)
  ]);
  if (midTerm) {
    metrics.push(`中期回报=${midTerm}`);
  }

  const riskLine = joinMetricSegments([
    compactMetric("回撤", mergedRisks.max_drawdown, 2, "%", true),
    compactMetric("波动", mergedRisks.volatility_annualized, 2, "%", false),
    compactMetric("修复", mergedRisks.drawdown_recovery_days, 0, "天", false)
  ]);
  if (riskLine) {
    metrics.push(`风险=${riskLine}`);
  }

  const relativeLine = joinMetricSegments([
    compactMetric("20日超额", mergedRelative.benchmark_excess_20d, 2, "%", true),
    compactMetric("60日超额", mergedRelative.benchmark_excess_60d, 2, "%", true),
    compactMetric("跟踪偏离", mergedRelative.tracking_deviation, 2, "%", false),
    compactMetric("同类分位", mergedRelative.peer_percentile, 2, "", false)
  ]);
  if (relativeLine) {
    metrics.push(`相对表现=${relativeLine}`);
  }

  const tradingLine = joinMetricSegments([
    compactMetric("MA5 ", trading.ma5, 4, "", false),
    compactMetric("MA10 ", trading.ma10, 4, "", false),
    compactMetric("MA20 ", trading.ma20, 4, "", false),
    compactMetric("量能", trading.volume_change_rate, 2, "%", true),
    compactMetric("折溢价", trading.premium_discount, 2, "%", true)
  ]);
  if (tradingLine) {
    metrics.push(`交易结构=${tradingLine}`);
  }

  const stabilityLine = joinMetricSegments([
    compactMetric("超额稳定度", stability.excess_return_consistency, 2, "", false),
    compactMetric("Sharpe ", nav.sharpe, 2, "", false),
    compactMetric("Sortino ", nav.sortino, 2, "", false),
    compactMetric("Calmar ", nav.calmar, 2, "", false),
    compactMetric("20日斜率", nav.nav_slope_20d, 4, "", false)
  ]);
  if (stabilityLine) {
    metrics.push(`稳定性=${stabilityLine}`);
  }

  return metrics.slice(0, 6);
}

function buildFundIntelligenceSummary(dashboard, reportContext, newsStatus, newsHeadline) {
  const summary = [];
  const events = reportContext && reportContext.events ? reportContext.events : {};
  const riskAlerts = Array.isArray(dashboard && dashboard.risk_alerts) ? dashboard.risk_alerts.slice(0, 3) : [];

  if (riskAlerts.length > 0) {
    summary.push(`风险提示=${riskAlerts.join("；")}`);
  }

  const notices = summarizeTextList(events.notices, 2);
  if (notices) {
    summary.push(`公告/提示=${notices}`);
  }
  const managerChanges = summarizeTextList(events.manager_changes, 2);
  if (managerChanges) {
    summary.push(`基金经理变化=${managerChanges}`);
  }
  const subscriptionRedemption = summarizeTextList(events.subscription_redemption, 2);
  if (subscriptionRedemption) {
    summary.push(`申赎约束=${subscriptionRedemption}`);
  }
  const regulatoryRisks = summarizeTextList(events.regulatory_risks, 2);
  if (regulatoryRisks) {
    summary.push(`监管/异常=${regulatoryRisks}`);
  }
  if (newsStatus) {
    summary.push(newsStatus);
  }
  if (newsHeadline) {
    summary.push(`样本=${newsHeadline}`);
  }

  return summary.slice(0, 6);
}

function buildFundExecutionContext(dashboard, reportContext) {
  const segments = [];
  const ruleTrace = dashboard && dashboard.rule_trace ? dashboard.rule_trace : {};
  const blockedActions = summarizeTextList(ruleTrace.blocked_actions, 3);
  const ruleFlags = summarizeTextList(ruleTrace.rule_flags, 3);
  const positionContext = buildPositionContext(reportContext);

  if (blockedActions || ruleFlags) {
    segments.push(`规则约束=${joinMetricSegments([
      blockedActions ? `禁止${blockedActions}` : "",
      ruleFlags ? `风控标记${ruleFlags}` : ""
    ])}`);
  }
  if (positionContext) {
    segments.push(`持仓背景=${positionContext}`);
  }

  return segments.join("；");
}

function buildFundChecklistText(dashboard, reportContext) {
  const checklist = [];
  const perspective = dashboard && dashboard.data_perspective ? dashboard.data_perspective : {};
  const relative = perspective.relative_metrics || {};
  const risks = perspective.risk_metrics || {};
  const events = reportContext && reportContext.events ? reportContext.events : {};
  const coverage = String(perspective.feature_coverage || "").trim();
  const excess20d = Number(relative.benchmark_excess_20d);
  const maxDrawdown = Number(risks.max_drawdown);
  const riskAlerts = Array.isArray(dashboard && dashboard.risk_alerts) ? dashboard.risk_alerts : [];
  const newsStatus = describeNewsStatus(reportContext);
  const featureContext = reportContext && reportContext.feature_context ? reportContext.feature_context : {};
  const warnings = Array.isArray(featureContext && featureContext.warnings) ? featureContext.warnings : [];

  checklist.push(
    coverage === "ok"
      ? "✅ 数据完整"
      : coverage === "partial"
        ? "⚠️ 数据部分可用"
        : "❌ 数据不足"
  );
  if (Number.isFinite(excess20d)) {
    checklist.push(excess20d >= 0 ? "✅ 相对基准未转弱" : "⚠️ 相对基准偏弱");
  }
  if (Number.isFinite(maxDrawdown)) {
    checklist.push(maxDrawdown >= -5 ? "✅ 回撤可控" : "⚠️ 回撤偏大");
  }
  if (Array.isArray(events.subscription_redemption) && events.subscription_redemption.length > 0) {
    checklist.push("⚠️ 存在申赎约束");
  } else if (Array.isArray(events.manager_changes) && events.manager_changes.length > 0) {
    checklist.push("⚠️ 存在基金经理变动");
  } else if (Array.isArray(events.regulatory_risks) && events.regulatory_risks.length > 0) {
    checklist.push("⚠️ 存在监管或异常风险");
  } else {
    checklist.push(riskAlerts.length > 0 ? "⚠️ 风险事件待跟踪" : "✅ 暂无新增风险");
  }
  if (warnings.length > 0) {
    checklist.push("⚠️ 特征侧有额外提示");
  }
  checklist.push(newsStatus ? "✅ 已有公开信息样本" : "⚠️ 公开信息有限");

  return checklist.slice(0, 5);
}

function buildPositionContext(reportContext) {
  const account = reportContext && reportContext.account_context ? reportContext.account_context : {};
  const position = reportContext && reportContext.position_snapshot ? reportContext.position_snapshot : {};

  return joinMetricSegments([
    position.current_position !== undefined ? `当前持仓${formatNumber(position.current_position)}` : "",
    position.avg_cost !== undefined ? `成本${formatNumber(position.avg_cost)}` : "",
    position.estimated_market_value !== "not_supported" ? `估算市值${formatNumber(position.estimated_market_value)}` : "",
    position.estimated_position_pnl_pct !== "not_supported" ? `估算盈亏${formatMetricValue(position.estimated_position_pnl_pct, 2, "%", true)}` : "",
    Number.isFinite(Number(position.budget)) ? `预算${formatNumber(position.budget)}` : "",
    account.risk_preference ? `风险偏好${formatRiskPreferenceLabel(account.risk_preference)}` : "",
    account.holding_horizon ? `周期${formatHoldingHorizonLabel(account.holding_horizon)}` : ""
  ]);
}

function mergeMetricMaps(primary, fallback) {
  return {
    ...(fallback && typeof fallback === "object" ? fallback : {}),
    ...(primary && typeof primary === "object" ? primary : {})
  };
}

function compactMetric(label, value, digits, suffix, signed) {
  const rendered = formatMetricValue(value, digits, suffix, signed);
  return rendered ? `${label}${rendered}` : "";
}

function joinMetricSegments(items) {
  return items.filter(Boolean).join("/");
}

function summarizeTextList(values, limit) {
  if (!Array.isArray(values) || values.length === 0) {
    return "";
  }
  return values
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, limit)
    .join("；");
}

function formatRiskPreferenceLabel(raw) {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "conservative") return "稳健";
  if (value === "balanced") return "均衡";
  if (value === "aggressive") return "进取";
  return String(raw || "").trim() || "-";
}

function formatHoldingHorizonLabel(raw) {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "short_term") return "短期";
  if (value === "medium_term") return "中期";
  if (value === "long_term") return "长期";
  return String(raw || "").trim() || "-";
}

function formatMetricValue(value, digits, suffix, signed) {
  if (value === null || value === undefined || value === "not_supported") {
    return "";
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "";
  }
  const normalized = Number(numeric.toFixed(digits));
  const prefix = signed && normalized > 0 ? "+" : "";
  return `${prefix}${normalized}${suffix || ""}`;
}

function describeNewsStatus(rawContext) {
  const sourceChain = Array.isArray(rawContext && rawContext.source_chain) ? rawContext.source_chain : [];
  const errors = Array.isArray(rawContext && rawContext.errors) ? rawContext.errors : [];
  const newsItems = rawContext && rawContext.events && Array.isArray(rawContext.events.market_news)
    ? rawContext.events.market_news
    : [];
  const newsCount = newsItems.length;

  // 如果没有新闻，返回空字符串（不在表格显示）
  if (newsCount === 0) {
    return "";
  }

  const disabledSearchEngine = sourceChain.find((item) => /search_engine:.+:disabled$/.test(String(item || "")));
  if (disabledSearchEngine) {
    const engineId = String(disabledSearchEngine).replace(/^search_engine:/, "").replace(/:disabled$/, "");
    return `Search Engine 已禁用（${engineId || "unknown"}）`;
  }
  const missingSearchEngine = sourceChain.find((item) => /search_engine:missing:/.test(String(item || "")));
  if (missingSearchEngine) {
    return `Search Engine 缺失（${String(missingSearchEngine).replace(/^search_engine:missing:/, "")}）`;
  }

  if (sourceChain.includes("env:MARKET_ANALYSIS_NEWS_CONTEXT")) {
    return `使用环境变量新闻上下文 (${newsCount}条)`;
  }
  const serpApiSource = sourceChain.find((item) => String(item || "").startsWith("serpapi:"));
  if (serpApiSource) {
    const serpApiEngine = String(serpApiSource).replace(/^serpapi:/, "") || "unknown";
    return `SerpAPI(${serpApiEngine}) 命中 ${newsCount} 条`;
  }
  const fallbackSource = sourceChain.find((item) => String(item).startsWith("fallback:"));
  if (fallbackSource) {
    return `回退新闻源命中 ${newsCount} 条`;
  }
  const serpError = errors.find((item) => /serpapi/i.test(String(item || "")));
  if (serpError) {
    return `SerpAPI 失败: ${serpError}`;
  }

  return `新闻命中 ${newsCount} 条`;
}

function pickTopNewsHeadline(rawContext) {
  const newsItems = rawContext && rawContext.events && Array.isArray(rawContext.events.market_news)
    ? rawContext.events.market_news
    : [];
  if (newsItems.length === 0) {
    return "";
  }
  const item = newsItems[0] || {};
  const title = String(item.title || "").trim();
  const source = String(item.source || "").trim();
  if (!title) {
    return "";
  }
  return source ? `${title} (${source})` : title;
}

function formatCoverageLabel(raw) {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "ok") return "完整";
  if (value === "partial") return "部分可用";
  if (value === "insufficient") return "不足";
  return value || "-";
}
