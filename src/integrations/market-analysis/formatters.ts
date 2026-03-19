// @ts-nocheck
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
      const metricSummary = buildFundMetricSummary(dashboard);
      const record = fundRecordMap.get(code);
      const newsStatus = describeNewsStatus(record && record.raw_context);
      const newsHeadline = pickTopNewsHeadline(record && record.raw_context);
      const risks = Array.isArray(dashboard.risk_alerts) ? dashboard.risk_alerts.slice(0, 3) : [];
      const checklist = buildFundChecklistText(dashboard, record && record.raw_context);

      lines.push(`- ${label}`);
      lines.push(`  核心结论: ${decision}。${conclusion}`);
      lines.push(`  数据视角: ${metricSummary.length > 0 ? metricSummary.join("；") : "关键指标暂不充分"}；信号强弱=${score}/100，置信度=${confidence}`);
      lines.push(`  情报观察: ${risks.length > 0 ? risks.join("；") : "暂无新增重点风险"}${newsStatus ? `；${newsStatus}` : ""}${newsHeadline ? `；样本=${newsHeadline}` : ""}`);
      if (actionSuggestion || positionChange) {
        lines.push(`  执行计划: ${actionSuggestion || "未提供"}${positionChange ? `；仓位处理=${positionChange}` : ""}`);
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

function buildFundMetricSummary(dashboard) {
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
  const coverage = dashboard && dashboard.data_perspective
    ? String(dashboard.data_perspective.feature_coverage || "").trim()
    : "";

  if (coverage) {
    metrics.push(`数据完整性=${formatCoverageLabel(coverage)}`);
  }

  const ret20d = formatMetricValue(returns.ret_20d, 2, "%", true);
  if (ret20d) {
    metrics.push(`近20日回报=${ret20d}`);
  }
  const ret60d = formatMetricValue(returns.ret_60d, 2, "%", true);
  if (ret60d) {
    metrics.push(`近60日回报=${ret60d}`);
  }
  const drawdown = formatMetricValue(risks.max_drawdown, 2, "%", true);
  if (drawdown) {
    metrics.push(`最大回撤=${drawdown}`);
  }
  const volatility = formatMetricValue(risks.volatility_annualized, 2, "%", false);
  if (volatility) {
    metrics.push(`年化波动=${volatility}`);
  }
  const excess20d = formatMetricValue(relative.benchmark_excess_20d, 2, "%", true);
  if (excess20d) {
    metrics.push(`近20日超额=${excess20d}`);
  }

  return metrics.slice(0, 5);
}

function buildFundChecklistText(dashboard, rawContext) {
  const checklist = [];
  const perspective = dashboard && dashboard.data_perspective ? dashboard.data_perspective : {};
  const relative = perspective.relative_metrics || {};
  const risks = perspective.risk_metrics || {};
  const coverage = String(perspective.feature_coverage || "").trim();
  const excess20d = Number(relative.benchmark_excess_20d);
  const maxDrawdown = Number(risks.max_drawdown);
  const riskAlerts = Array.isArray(dashboard && dashboard.risk_alerts) ? dashboard.risk_alerts : [];
  const newsStatus = describeNewsStatus(rawContext);

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
  checklist.push(riskAlerts.length > 0 ? "⚠️ 风险事件待跟踪" : "✅ 暂无新增风险");
  checklist.push(newsStatus ? "✅ 已有公开信息样本" : "⚠️ 公开信息有限");

  return checklist.slice(0, 5);
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
