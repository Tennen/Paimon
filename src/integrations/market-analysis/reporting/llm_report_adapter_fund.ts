import type { FundReportContext, FundSeriesSummary } from "../fund/fund_report_context";
import {
  describeRuleTilt,
  formatActionList,
  formatInvestorReadableList,
  formatRuleFlagList
} from "../readable_labels";
import {
  asArray,
  asRecord,
  formatCoverageLabel,
  formatHoldingHorizonLabel,
  formatMetricValue,
  formatRiskPreferenceLabel,
  joinReadableParts,
  mergeMetricRecords,
  metricStatement,
  normalizeText,
  readStringList,
  summarizeStringList,
  toFiniteNumber,
  compactMetricEntry,
  compactRankEntry,
  joinSlashParts,
  formatSeriesLatest,
  formatRangeStatement,
  rankStatement
} from "./llm_report_adapter_format";
import { describeNewsStatus, pickTopNewsHeadline } from "./llm_report_adapter_format";

export function buildFundMetricSummary(
  dashboard: Record<string, unknown>,
  reportContext: FundReportContext
): string[] {
  const metrics: string[] = [];
  const dataPerspective = asRecord(dashboard.data_perspective);
  const returns = mergeMetricRecords(asRecord(dataPerspective.return_metrics), asRecord(reportContext.feature_context.returns));
  const risks = mergeMetricRecords(asRecord(dataPerspective.risk_metrics), asRecord(reportContext.feature_context.risk));
  const relative = mergeMetricRecords(asRecord(dataPerspective.relative_metrics), asRecord(reportContext.feature_context.relative));
  const coverage = formatCoverageLabel(normalizeText(dataPerspective.feature_coverage));
  if (coverage) {
    metrics.push(`数据完整性: ${coverage}`);
  }

  const latestValue = compactMetricEntry("基金 ", reportContext.fund_series_summary.latest_value, 6, "", false);
  if (latestValue) {
    metrics.push(`最新值: ${latestValue}`);
  }

  const shortTerm = joinSlashParts([
    compactMetricEntry("1日", returns.ret_1d, 2, "%", true),
    compactMetricEntry("5日", returns.ret_5d, 2, "%", true)
  ]);
  if (shortTerm) {
    metrics.push(`短线回报: ${shortTerm}`);
  }

  const midTerm = joinSlashParts([
    compactMetricEntry("20日", returns.ret_20d, 2, "%", true),
    compactMetricEntry("60日", returns.ret_60d, 2, "%", true),
    compactMetricEntry("120日", returns.ret_120d, 2, "%", true)
  ]);
  if (midTerm) {
    metrics.push(`中期回报: ${midTerm}`);
  }

  const riskLine = joinSlashParts([
    compactMetricEntry("回撤", risks.max_drawdown, 2, "%", true),
    compactMetricEntry("波动", risks.volatility_annualized, 2, "%", false),
    compactMetricEntry("修复", risks.drawdown_recovery_days, 0, "天", false)
  ]);
  if (riskLine) {
    metrics.push(`风险刻画: ${riskLine}`);
  }

  const relativeLine = joinSlashParts([
    compactMetricEntry("同类分位", relative.peer_percentile, 2, "", false),
    compactMetricEntry("20日分位变化", relative.peer_percentile_change_20d, 2, "", true),
    compactMetricEntry("60日分位变化", relative.peer_percentile_change_60d, 2, "", true),
    compactRankEntry("同类排名", relative.peer_rank_position, relative.peer_rank_total)
  ]);
  if (relativeLine) {
    metrics.push(`相对表现: ${relativeLine}`);
  }

  return metrics.slice(0, 5);
}

export function buildFundRationaleLine(
  dashboard: Record<string, unknown>,
  reportContext: FundReportContext
): string {
  const conclusion = asRecord(dashboard.core_conclusion);
  const thesis = asArray(conclusion.thesis)
    .map((item) => normalizeText(item))
    .filter((item): item is string => Boolean(item))
    .slice(0, 2);
  const metrics = buildFundMetricSummary(dashboard, reportContext).slice(0, 4);
  const parts = [...thesis];
  if (metrics.length > 0) {
    parts.push(`可直接核对的数据包括 ${metrics.join("、")}`);
  }
  return parts.join("；");
}

export function buildFundDataPerspectiveLines(
  dashboard: Record<string, unknown>,
  reportContext: FundReportContext
): string[] {
  const dataPerspective = asRecord(dashboard.data_perspective);
  const returns = mergeMetricRecords(asRecord(dataPerspective.return_metrics), asRecord(reportContext.feature_context.returns));
  const risks = mergeMetricRecords(asRecord(dataPerspective.risk_metrics), asRecord(reportContext.feature_context.risk));
  const relative = mergeMetricRecords(asRecord(dataPerspective.relative_metrics), asRecord(reportContext.feature_context.relative));
  const trading = asRecord(reportContext.feature_context.trading);
  const stability = asRecord(reportContext.feature_context.stability);
  const nav = asRecord(reportContext.feature_context.nav);
  const warnings = formatInvestorReadableList(reportContext.feature_context.warnings, 4);
  const fundSeries = reportContext.fund_series_summary;
  const peerPercentileSeries = reportContext.peer_percentile_summary;
  const lines: string[] = [];

  const snapshotLine = joinReadableParts([
    formatSeriesLatest("基金最新值", fundSeries),
    formatSeriesLatest("同类百分位", peerPercentileSeries),
    formatRangeStatement("基金近60日区间", fundSeries)
  ]);
  if (snapshotLine) {
    lines.push(`净值快照: ${snapshotLine}`);
  }

  const returnLine = joinReadableParts([
    metricStatement("近1日回报", returns.ret_1d, 2, "%", true),
    metricStatement("近5日回报", returns.ret_5d, 2, "%", true),
    metricStatement("近20日回报", returns.ret_20d, 2, "%", true),
    metricStatement("近60日回报", returns.ret_60d, 2, "%", true),
    metricStatement("近120日回报", returns.ret_120d, 2, "%", true)
  ]);
  if (returnLine) {
    lines.push(`收益表现: ${returnLine}`);
  }

  const riskLine = joinReadableParts([
    metricStatement("最大回撤", risks.max_drawdown, 2, "%", true),
    metricStatement("年化波动", risks.volatility_annualized, 2, "%", false),
    metricStatement("回撤修复", risks.drawdown_recovery_days, 0, "天", false)
  ]);
  if (riskLine) {
    lines.push(`风险刻画: ${riskLine}`);
  }

  const relativeLine = joinReadableParts([
    metricStatement("同类分位", relative.peer_percentile, 2, "", false),
    metricStatement("20日分位变化", relative.peer_percentile_change_20d, 2, "", true),
    metricStatement("60日分位变化", relative.peer_percentile_change_60d, 2, "", true),
    rankStatement("同类排名", relative.peer_rank_position, relative.peer_rank_total)
  ]);
  if (relativeLine) {
    lines.push(`相对表现: ${relativeLine}`);
  }

  const tradingLine = joinReadableParts([
    metricStatement("MA5 ", trading.ma5, 4, "", false),
    metricStatement("MA10 ", trading.ma10, 4, "", false),
    metricStatement("MA20 ", trading.ma20, 4, "", false),
    metricStatement("折溢价", trading.premium_discount, 2, "%", true)
  ]);
  if (tradingLine) {
    lines.push(`交易结构: ${tradingLine}`);
  }

  const qualityLine = joinReadableParts([
    metricStatement("同类排名趋势", stability.excess_return_consistency, 2, "", false),
    metricStatement("风格漂移", stability.style_drift, 2, "", false),
    metricStatement("净值平滑异常", stability.nav_smoothing_anomaly, 2, "", false),
    metricStatement("20日净值斜率", nav.nav_slope_20d, 4, "", false),
    metricStatement("Sharpe ", nav.sharpe, 2, "", false),
    metricStatement("Sortino ", nav.sortino, 2, "", false),
    metricStatement("Calmar ", nav.calmar, 2, "", false),
    metricStatement("基金经理任职 ", nav.manager_tenure, 2, "", false)
  ]);
  if (qualityLine) {
    lines.push(`稳定性与质量: ${qualityLine}`);
  }

  const coverage = formatCoverageLabel(normalizeText(dataPerspective.feature_coverage));
  if (coverage) {
    lines.push(`数据质量: 数据完整性 ${coverage}${warnings.length > 0 ? `；额外提示 ${warnings.join("；")}` : ""}`);
  } else if (warnings.length > 0) {
    lines.push(`数据质量: 额外提示 ${warnings.join("；")}`);
  }

  if (lines.length === 0) {
    lines.push("暂时没有足够的数据透视信息。");
  }

  return lines;
}

export function buildFundIntelligenceLines(
  dashboard: Record<string, unknown>,
  reportContext: FundReportContext
): string[] {
  const lines: string[] = [];
  const events = reportContext.events;
  const reference = reportContext.reference_context;
  const holdings = reportContext.holdings_style;
  const riskAlerts = formatInvestorReadableList(dashboard.risk_alerts, 4);
  const positiveSignals = pickPositiveIntel(reportContext).slice(0, 3);
  const newsStatus = describeNewsStatus(reportContext);
  const headline = pickTopNewsHeadline(reportContext);

  lines.push(`风险情报: ${riskAlerts.length > 0 ? riskAlerts.join("；") : "暂无新增重点风险。"}`);
  if (positiveSignals.length > 0) {
    lines.push(`积极线索: ${positiveSignals.join("；")}`);
  }
  const notices = summarizeStringList(events.notices, 3);
  if (notices) {
    lines.push(`公告/提示: ${notices}`);
  }
  const managerChanges = summarizeStringList(events.manager_changes, 3);
  if (managerChanges) {
    lines.push(`基金经理变化: ${managerChanges}`);
  }
  const currentManagers = summarizeStringList(reference.current_managers, 3);
  if (currentManagers) {
    lines.push(`现任基金经理: ${currentManagers}`);
  }
  const topHoldings = summarizeStringList(holdings.top_holdings, 5);
  if (topHoldings) {
    lines.push(`十大重仓参考: ${topHoldings}`);
  }
  const subscriptionRedemption = summarizeStringList(events.subscription_redemption, 3);
  if (subscriptionRedemption) {
    lines.push(`申购赎回约束: ${subscriptionRedemption}`);
  }
  const regulatoryRisks = summarizeStringList(events.regulatory_risks, 3);
  if (regulatoryRisks) {
    lines.push(`监管/异常风险: ${regulatoryRisks}`);
  }
  if (newsStatus) {
    lines.push(`新闻检索: ${newsStatus}`);
  }
  if (headline) {
    lines.push(`代表性新闻: ${headline}`);
  }

  return lines;
}

export function buildFundExecutionLines(
  dashboard: Record<string, unknown>,
  reportContext: FundReportContext
): string[] {
  const lines: string[] = [];
  const action = asRecord(dashboard.action_plan);
  const suggestion = normalizeText(action.suggestion);
  const positionChange = normalizeText(action.position_change);
  const executionConditions = asArray(action.execution_conditions)
    .map((item) => normalizeText(item))
    .filter((item): item is string => Boolean(item))
    .slice(0, 4);
  const stopConditions = asArray(action.stop_conditions)
    .map((item) => normalizeText(item))
    .filter((item): item is string => Boolean(item))
    .slice(0, 4);
  const checklist = buildFundChecklist(dashboard, reportContext);
  const ruleConstraint = buildRuleConstraintLine(dashboard);
  const positionContext = buildPositionContext(reportContext);

  lines.push(`操作建议: ${suggestion || "未提供"}`);
  if (positionChange) {
    lines.push(`仓位处理: ${positionChange}`);
  }
  if (executionConditions.length > 0) {
    lines.push(`执行条件: ${executionConditions.join("；")}`);
  }
  if (stopConditions.length > 0) {
    lines.push(`停止条件: ${stopConditions.join("；")}`);
  }
  if (ruleConstraint) {
    lines.push(ruleConstraint);
  }
  if (positionContext) {
    lines.push(`持仓背景: ${positionContext}`);
  }
  if (checklist.length > 0) {
    lines.push(`检查清单: ${checklist.join("；")}`);
  }

  return lines;
}

export function buildFundChecklist(
  dashboard: Record<string, unknown>,
  reportContext: FundReportContext
): string[] {
  const items: string[] = [];
  const dataPerspective = asRecord(dashboard.data_perspective);
  const relative = mergeMetricRecords(asRecord(dataPerspective.relative_metrics), asRecord(reportContext.feature_context.relative));
  const risks = mergeMetricRecords(asRecord(dataPerspective.risk_metrics), asRecord(reportContext.feature_context.risk));
  const events = reportContext.events;
  const coverage = normalizeText(dataPerspective.feature_coverage);
  const peerPercentile = toFiniteNumber(relative.peer_percentile);
  const peerPercentileChange20d = toFiniteNumber(relative.peer_percentile_change_20d);
  const maxDrawdown = toFiniteNumber(risks.max_drawdown);
  const riskAlerts = asArray(dashboard.risk_alerts);
  const hasNews = Boolean(describeNewsStatus(reportContext));
  const warnings = readStringList(reportContext.feature_context.warnings);

  items.push(
    coverage === "ok"
      ? "✅ 数据完整度可用"
      : coverage === "partial"
        ? "⚠️ 数据仅部分可用"
        : "❌ 数据完整度不足"
  );
  if (peerPercentile !== null) {
    items.push(peerPercentile >= 50 ? "✅ 当前同类位置仍在中上区间" : "⚠️ 当前同类位置偏弱");
  }
  if (peerPercentileChange20d !== null) {
    items.push(peerPercentileChange20d >= 0 ? "✅ 近20日同类位置未走弱" : "⚠️ 近20日同类位置回落");
  }
  if (maxDrawdown !== null) {
    items.push(maxDrawdown >= -5 ? "✅ 回撤仍在可控区间" : "⚠️ 回撤压力偏大");
  }
  if (asArray(events.subscription_redemption).length > 0) {
    items.push("⚠️ 存在申购赎回约束");
  } else if (asArray(events.manager_changes).length > 0) {
    items.push("⚠️ 存在基金经理变化");
  } else if (asArray(events.regulatory_risks).length > 0) {
    items.push("⚠️ 存在监管或异常风险");
  } else {
    items.push(riskAlerts.length > 0 ? "⚠️ 需要持续跟踪风险事件" : "✅ 暂无新增公开风险");
  }
  if (warnings.length > 0) {
    items.push("⚠️ 特征侧提示需复核");
  }
  items.push(hasNews ? "✅ 已有公开信息样本可跟踪" : "⚠️ 公开信息样本有限");

  return items.slice(0, 6);
}

export function pickPositiveIntel(reportContext: FundReportContext): string[] {
  const newsItems = reportContext.events.market_news;
  const positives: string[] = [];

  for (const item of newsItems) {
    const row = asRecord(item);
    const title = normalizeText(row.title);
    const snippet = normalizeText(row.snippet);
    const text = `${title} ${snippet}`;
    if (/分红|扩容|获批|增长|回暖|修复|净流入|份额增长|创新高/.test(text)) {
      positives.push(title || text);
    }
  }

  return positives.filter(Boolean);
}

export function buildRuleConstraintLine(dashboard: Record<string, unknown>): string {
  const ruleTrace = asRecord(dashboard.rule_trace);
  const blockedActions = formatActionList(ruleTrace.blocked_actions, "");
  const ruleFlags = formatRuleFlagList(ruleTrace.rule_flags, "");
  const adjustedScore = toFiniteNumber(ruleTrace.adjusted_score);
  const content = joinReadableParts([
    blockedActions ? `当前不宜做 ${blockedActions}` : "",
    ruleFlags ? `需要留意 ${ruleFlags}` : "",
    adjustedScore === null ? "" : `规则倾向 ${describeRuleTilt(adjustedScore)}`
  ]);
  return content ? `规则约束: ${content}` : "";
}

export function buildPositionContext(reportContext: FundReportContext): string {
  const account = reportContext.account_context;
  const position = reportContext.position_snapshot;

  return joinReadableParts([
    position.current_position === undefined ? "" : `当前持仓 ${formatMetricValue(position.current_position, 4, "", false)}`,
    position.avg_cost === undefined ? "" : `持仓成本 ${formatMetricValue(position.avg_cost, 4, "", false)}`,
    position.estimated_market_value === "not_supported" ? "" : `估算市值 ${formatMetricValue(position.estimated_market_value, 2, "", false)}`,
    position.estimated_position_pnl_pct === "not_supported" ? "" : `浮动盈亏 ${formatMetricValue(position.estimated_position_pnl_pct, 2, "%", true)}`,
    `可用预算 ${formatMetricValue(position.budget, 2, "", false)}`,
    normalizeText(account.risk_preference) ? `风险偏好 ${formatRiskPreferenceLabel(normalizeText(account.risk_preference))}` : "",
    normalizeText(account.holding_horizon) ? `持有周期 ${formatHoldingHorizonLabel(normalizeText(account.holding_horizon))}` : ""
  ]);
}

